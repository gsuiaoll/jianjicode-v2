/**
 * jianjicode Curator — 增量技能审查引擎
 *
 * 功能：
 * - 增量回顾新会话，分析通用工作流模式
 * - 技能合并/优化/归档建议
 * - 生命周期管理（stale → archive）
 *
 * 设计原则：
 * - 增量处理：只分析上次 review 后的新会话
 * - 零 Token 成本：使用启发式而非 LLM
 * - 不删除、不修改 pinned skill
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { LifecycleAction } from "./skill-manager.js"
import {
  archiveSkill,
  getReviewCandidates,
  listSkills,
  pinSkill,
  rateSkill,
  runLifecycleCheck,
  staleSkill,
  unpinSkill,
} from "./skill-manager.js"

// ============================================================================
// 路径
// ============================================================================

function getCuratorDir(): string {
  return (
    process.env.JIANGJICODE_CURATOR_DIR ||
    path.join(os.homedir(), ".jianjicode", "curator")
  )
}

function getStatePath(): string {
  return path.join(getCuratorDir(), "state.json")
}

function getReportsDir(): string {
  const dir = path.join(getCuratorDir(), "reports")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ============================================================================
// 状态管理
// ============================================================================

interface CuratorState {
  lastReviewedAt: string | null
  nudgeSuppressions: Record<string, number> // skillName → nudge count
  lastNudgeAt: string | null
  consecutiveNoMatch: number // 连续无匹配次数
}

function defaultState(): CuratorState {
  return {
    lastReviewedAt: null,
    nudgeSuppressions: {},
    lastNudgeAt: null,
    consecutiveNoMatch: 0,
  }
}

function loadState(): CuratorState {
  const statePath = getStatePath()
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, "utf-8"))
    }
  } catch {
    // 损坏的状态文件，重新初始化
  }
  return defaultState()
}

function saveState(state: CuratorState): void {
  try {
    const dir = getCuratorDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), "utf-8")
  } catch {
    // 写入失败不阻塞
  }
}

/**
 * 获取上次 review 时间。
 */
export function getLastReviewedAt(): string | null {
  return loadState().lastReviewedAt
}

/**
 * 设置上次 review 时间。
 */
export function setLastReviewedAt(date: string): void {
  const state = loadState()
  state.lastReviewedAt = date
  saveState(state)
}

/**
 * 获取指定 skill 的 nudge 次数。
 */
export function getNudgeCount(name: string): number {
  return loadState().nudgeSuppressions[name] || 0
}

/**
 * 递增指定 skill 的 nudge 次数。
 */
export function bumpNudgeCount(name: string): void {
  const state = loadState()
  state.nudgeSuppressions[name] = (state.nudgeSuppressions[name] || 0) + 1
  saveState(state)
}

/**
 * 获取连续无匹配计数。
 */
export function getConsecutiveNoMatch(): number {
  return loadState().consecutiveNoMatch
}

/**
 * 重置连续无匹配计数。
 */
export function resetConsecutiveNoMatch(): void {
  const state = loadState()
  state.consecutiveNoMatch = 0
  saveState(state)
}

/**
 * 递增连续无匹配计数。
 */
export function bumpConsecutiveNoMatch(): void {
  const state = loadState()
  state.consecutiveNoMatch++
  saveState(state)
}

// ============================================================================
// 类型
// ============================================================================

export type SuggestionType = "merge" | "optimize" | "archive" | "create"

export interface CuratorSuggestion {
  type: SuggestionType
  skillName?: string
  reason: string
  details?: string
  confidence: "high" | "medium" | "low"
}

export interface CuratorReport {
  reviewedAt: string
  sessionsAnalyzed: number
  suggestions: CuratorSuggestion[]
  lifecycleActions: LifecycleAction[]
  skillCount: number
}

// ============================================================================
// 增量 Review
// ============================================================================

/**
 * 分析 sessions 目录中的会话，提取工具调用模式。
 * 返回每个会话中使用的工具名集合（去重）。
 */
function analyzeSessions(sessionIds: string[]): Array<{
  sessionId: string
  toolNames: string[]
}> {
  const sessionsDir =
    process.env.JIANGJICODE_SESSIONS_DIR ||
    path.join(os.homedir(), ".jianjicode", "sessions")

  if (!fs.existsSync(sessionsDir)) return []

  const results: Array<{ sessionId: string; toolNames: string[] }> = []

  for (const id of sessionIds) {
    try {
      const metaPath = path.join(sessionsDir, `${id}.meta.json`)
      if (!fs.existsSync(metaPath)) continue

      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
      // 只分析 compactedSummary（如果有）或解析会话内容
      if (meta.compactedSummary) {
        // 从 compactedSummary 中提取工具名
        const toolMatches: string[] =
          (typeof meta.compactedSummary === "string"
            ? meta.compactedSummary.match(/\b[A-Z][a-zA-Z]+\b/g)
            : null) || []
        const uniqueTools = [...new Set(toolMatches)]
        results.push({ sessionId: id, toolNames: uniqueTools })
      }
    } catch {
      // 跳过损坏会话
    }
  }

  return results
}

/**
 * 运行增量 review。
 *
 * 流程：
 * 1. 获取上次 review 时间
 * 2. 查找新增会话
 * 3. 分析工具使用模式
 * 4. 检查技能生命周期
 * 5. 生成建议报告
 */
export async function runIncrementalReview(): Promise<CuratorReport> {
  const state = loadState()
  const now = new Date().toISOString()

  // 1. 记录 review 时间
  const lastReviewed = state.lastReviewedAt
  setLastReviewedAt(now)

  // 2. 查找新会话（通过 sessions dir 的 meta 文件 lastActive 判断）
  const sessionsDir =
    process.env.JIANGJICODE_SESSIONS_DIR ||
    path.join(os.homedir(), ".jianjicode", "sessions")
  const newSessionIds: string[] = []

  if (lastReviewed && fs.existsSync(sessionsDir)) {
    const lastTime = new Date(lastReviewed).getTime()
    try {
      const entries = fs.readdirSync(sessionsDir)
      for (const entry of entries) {
        if (!entry.endsWith(".meta.json")) continue
        try {
          const meta = JSON.parse(
            fs.readFileSync(path.join(sessionsDir, entry), "utf-8"),
          )
          const activeTime = new Date(
            meta.lastActive || meta.createdAt,
          ).getTime()
          if (activeTime > lastTime) {
            const id = entry.replace(".meta.json", "")
            newSessionIds.push(id)
          }
        } catch {
          /* skip corrupt meta */
        }
      }
    } catch {
      /* skip dir errors */
    }
  }

  // 3. 生命周期检查
  const lifecycleActions = runLifecycleCheck()

  // 4. 生成建议
  const suggestions: CuratorSuggestion[] = []

  // 4a. 检查 review candidates
  const candidates = getReviewCandidates()
  for (const rec of candidates) {
    if (rec.state === "broken") {
      suggestions.push({
        type: "optimize",
        skillName: rec.name,
        reason: `Skill "${rec.name}" has been patched ${rec.patchCount} times without success`,
        details: "Consider reviewing the skill steps manually",
        confidence: "high",
      })
    } else if (rec.state === "stale") {
      suggestions.push({
        type: "archive",
        skillName: rec.name,
        reason: `Skill "${rec.name}" is stale (no recent use)`,
        confidence: "medium",
      })
    } else if (rec.userRating !== null && rec.userRating < 3) {
      suggestions.push({
        type: "optimize",
        skillName: rec.name,
        reason: `Skill "${rec.name}" has low rating (${rec.userRating}/5)`,
        confidence: "medium",
      })
    } else if (rec.patchCount >= 2) {
      suggestions.push({
        type: "optimize",
        skillName: rec.name,
        reason: `Skill "${rec.name}" has ${rec.patchCount} patches — may need review`,
        confidence: "low",
      })
    }
  }

  // 4b. 检查新会话中是否有重复的工具模式
  const sessions = analyzeSessions(newSessionIds)
  const toolPatternCounts = new Map<string, number>()
  for (const s of sessions) {
    const key = [...s.toolNames].sort().join(",")
    toolPatternCounts.set(key, (toolPatternCounts.get(key) || 0) + 1)
  }
  for (const [pattern, count] of toolPatternCounts) {
    if (count >= 3) {
      suggestions.push({
        type: "create",
        reason: `Repeated tool pattern (×${count}): ${pattern.slice(0, 80)}`,
        details: "Consider creating a skill for this recurring workflow",
        confidence: "high",
      })
    }
  }

  // 5. 生成报告
  const report: CuratorReport = {
    reviewedAt: now,
    sessionsAnalyzed: newSessionIds.length,
    suggestions,
    lifecycleActions,
    skillCount: (await listSkills()).length,
  }

  // 6. 保存报告
  try {
    const reportPath = path.join(
      getReportsDir(),
      `review-${now.replace(/[:.]/g, "-")}.json`,
    )
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8")
  } catch {
    /* ignore */
  }

  return report
}

/**
 * 检查是否需要触发 review。
 * 触发条件：
 * 1. 距离上次 review 超过 7 天
 * 2. skill 数量 > 10
 * 3. 连续无匹配次数 >= 3
 */
export function shouldRunReview(): boolean {
  const state = loadState()

  // 条件 1: 超过 7 天
  if (state.lastReviewedAt) {
    const daysSince =
      (Date.now() - new Date(state.lastReviewedAt).getTime()) / 86400000
    if (daysSince >= 7) return true
  } else {
    // 从未 review 过，触发
    return true
  }

  // 条件 3: 连续无匹配 >= 3
  if (state.consecutiveNoMatch >= 3) return true

  return false
}

/**
 * 检查是否需要触发轻量 review（skill > 10）。
 */
export function needsLightReview(skillCount: number): boolean {
  // 事件触发: skill > 10 触发的轻量 review
  return skillCount > 10
}

/**
 * 获取最新 curator 审查报告。
 * 按文件名排序取最新的。
 */
export function getLatestReport(): CuratorReport | null {
  const dir = getReportsDir()
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("review-"))
    if (files.length === 0) return null
    files.sort().reverse()
    const latest = path.join(dir, files[0])
    return JSON.parse(fs.readFileSync(latest, "utf-8"))
  } catch {
    return null
  }
}

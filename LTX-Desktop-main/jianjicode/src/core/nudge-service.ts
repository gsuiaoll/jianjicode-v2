/**
 * jianjicode Nudge Service — 前台用户交互服务
 *
 * 三种前台交互，均采用非侵入式设计：
 * 1. 技能创建确认 — 检测到可复用工作流后的非阻塞提示
 * 2. 技能优化报告 — Curator 的结构化优化建议
 * 3. 技能建议 Nudge — 检测到重复模式时的创建建议
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { CuratorReport, CuratorSuggestion } from "./curator.js"

// ============================================================================
// 路径
// ============================================================================

function getNudgeDir(): string {
  return (
    process.env.JIANGJICODE_NUDGE_DIR ||
    path.join(os.homedir(), ".jianjicode", "nudges")
  )
}

/**
 * 记录 nudge 到日志文件。
 */
function logNudge(type: string, content: string): void {
  try {
    const dir = getNudgeDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const logFile = path.join(dir, "nudge-log.jsonl")
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      type,
      content,
    })
    fs.appendFileSync(logFile, entry + "\n", "utf-8")
  } catch {
    // 日志写入失败不阻塞
  }
}

// ============================================================================
// Nudge 类型
// ============================================================================

export interface NudgeCreateConfirm {
  type: "create-confirm"
  name: string
  description: string
  toolCount: number
  message: string
}

export interface NudgeOptimizationReport {
  type: "optimization-report"
  suggestions: CuratorSuggestion[]
  lifecycleActions: Array<{ name: string; action: string; reason: string }>
  message: string
}

export interface NudgeSkillSuggestion {
  type: "skill-suggestion"
  toolPattern: string[]
  frequency: number
  message: string
}

export type NudgeMessage =
  | NudgeCreateConfirm
  | NudgeOptimizationReport
  | NudgeSkillSuggestion

// ============================================================================
// 内存待推送缓冲 — 确保 nudge 可以随当前请求返回，而非等待下次轮询
// ============================================================================

const pendingBuffer: NudgeMessage[] = []

/**
 * 将 nudge 加入内存缓冲，供 chat 响应时随结果一起返回。
 */
export function pushPendingNudge(nudge: NudgeMessage): void {
  pendingBuffer.push(nudge)
}

/**
 * 取出并清空所有待推送 nudge。
 */
export function drainPendingNudges(): NudgeMessage[] {
  const copy = pendingBuffer.slice()
  pendingBuffer.length = 0
  return copy
}

/**
 * 查询是否有待推送 nudge。
 */
export function hasPendingNudges(): boolean {
  return pendingBuffer.length > 0
}

// ============================================================================
// Nudge 生成函数
// ============================================================================

/**
 * 生成技能创建确认 nudge。
 * 检测到可复用工作流后调用，建议用户保存为技能。
 */
export function nudgeCreateSkill(
  name: string,
  description: string,
  toolCount: number,
): NudgeCreateConfirm {
  const message = [
    `💡 检测到可复用的剪辑工作流：`,
    `   「${description}」`,
    `   共使用 ${toolCount} 个工具。是否保存为专属技能？`,
    `   下次直接说「${description}」就能一键完成！`,
  ].join("\n")

  const nudge: NudgeCreateConfirm = {
    type: "create-confirm",
    name,
    description,
    toolCount,
    message,
  }

  logNudge("create-confirm", JSON.stringify(nudge))
  pushPendingNudge(nudge)
  return nudge
}

/**
 * 生成技能优化报告 nudge。
 * Curator review 后调用，展示优化建议。
 */
export function nudgeOptimizationReport(
  report: CuratorReport,
): NudgeOptimizationReport {
  const parts: string[] = ["📊 技能优化报告"]

  if (report.suggestions.length > 0) {
    parts.push("")
    parts.push("建议：")
    for (const s of report.suggestions) {
      parts.push(`  • [${s.type}] ${s.reason}`)
    }
  }

  if (report.lifecycleActions.length > 0) {
    parts.push("")
    parts.push("生命周期：")
    for (const a of report.lifecycleActions) {
      parts.push(`  • [${a.action}] ${a.name}: ${a.reason}`)
    }
  }

  if (report.suggestions.length === 0 && report.lifecycleActions.length === 0) {
    parts.push("  一切正常，无需优化。")
  }

  parts.push("")
  parts.push(
    `共审查 ${report.sessionsAnalyzed} 个会话，${report.skillCount} 个技能`,
  )

  const nudge: NudgeOptimizationReport = {
    type: "optimization-report",
    suggestions: report.suggestions,
    lifecycleActions: report.lifecycleActions,
    message: parts.join("\n"),
  }

  logNudge("optimization-report", JSON.stringify(nudge))
  pushPendingNudge(nudge)
  return nudge
}

/**
 * 生成技能建议 nudge。
 * 检测到重复工具模式但无匹配 skill 时调用。
 */
export function nudgeSkillSuggestion(
  toolPattern: string[],
  frequency: number,
): NudgeSkillSuggestion {
  const message = [
    `💡 您最近 ${frequency} 次都在做类似操作：`,
    `   ${toolPattern.join(" → ")}`,
    `   是否想创建一个快捷技能？`,
  ].join("\n")

  const nudge: NudgeSkillSuggestion = {
    type: "skill-suggestion",
    toolPattern,
    frequency,
    message,
  }

  logNudge("skill-suggestion", JSON.stringify(nudge))
  pushPendingNudge(nudge)
  return nudge
}

/**
 * 获取最近的 nudge 消息列表。
 * 供前端展示使用。
 */
export function getRecentNudges(limit = 10): NudgeMessage[] {
  const logFile = path.join(getNudgeDir(), "nudge-log.jsonl")
  if (!fs.existsSync(logFile)) return []

  try {
    const content = fs.readFileSync(logFile, "utf-8")
    const lines = content.trim().split("\n").filter(Boolean)
    const recent = lines.slice(-limit)

    return recent
      .map((line) => {
        try {
          return JSON.parse(JSON.parse(line).content)
        } catch {
          return null
        }
      })
      .filter(Boolean) as NudgeMessage[]
  } catch {
    return []
  }
}

/**
 * 清除所有 nudge 日志。
 */
export function clearNudges(): void {
  const logFile = path.join(getNudgeDir(), "nudge-log.jsonl")
  try {
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile)
  } catch {
    /* ignore */
  }
}

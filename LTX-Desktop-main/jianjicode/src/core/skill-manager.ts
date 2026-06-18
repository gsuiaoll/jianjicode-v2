/**
 * jianjicode Skill 管理器
 *
 * 负责：
 * - Phase 1: Skill Auto-Creation（3层过滤 + 生成）
 * - Phase 2: Self-Patching（归因 + 灰度 patch）
 * - Phase 3: Curator 集成
 *
 * 借鉴 Hermes Agent 的设计模式（MIT 许可证），仅借鉴思路，不复制代码。
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { generateText, stepCountIs } from "ai"
import { SimpleProvider } from "../../ai/provider/simple-provider.js"
import { atomicWriteJson, atomicWriteText } from "./atomic-write.js"
import { fixJson, parseFixedJson } from "./json-fix.js"
import {
  hasTraversalComponent,
  safeJoin,
  validateWithinDir,
} from "./path-security.js"
import { PROMPTS } from "./prompts.js"
import type { NudgeMessage } from "./nudge-service.js"

// ============================================================================
// 类型定义
// ============================================================================

export interface AgentStepInfo {
  stepNumber: number
  text: string
  toolCalls: Array<{
    toolName: string
    args: Record<string, unknown>
    result: {
      title: string
      output: string
      metadata: Record<string, unknown>
    }
  }>
  finishReason: string
}

export interface SkillInfo {
  name: string
  description: string
  category: string
  tags: string[]
  filePath: string
  createdAt: string
  toolCount: number
  toolVersion?: string
  compatible?: boolean
}

export interface SkillUsageRecord {
  name: string
  useCount: number
  lastUsedAt: string | null
  patchCount: number
  failCount: number
  consecutiveFails: number
  userRating: 1 | 2 | 3 | 4 | 5 | null
  createdAt: string
  state: "active" | "stale" | "archived" | "broken"
  pinned: boolean
}

// ============================================================================
// 路径常量
// ============================================================================

/** Skill 根目录：~/.jianjicode/skills/，可通过 JIANGJICODE_SKILLS_DIR 环境变量覆盖用于测试 */
export function getSkillsDir(): string {
  return (
    process.env.JIANGJICODE_SKILLS_DIR ||
    path.join(os.homedir(), ".jianjicode", "skills")
  )
}

/** 使用追踪数据文件 */
function getUsageFilePath(): string {
  return path.join(getSkillsDir(), ".usage.json")
}

/** 结构化日志文件 */
function getLogFilePath(): string {
  return path.join(os.homedir(), ".jianjicode", "logs", "skill-evolution.log")
}

// ============================================================================
// 日志
// ============================================================================

function log(op: string, info: string, error?: string): void {
  const logFile = getLogFilePath()
  try {
    const dir = path.dirname(logFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      operation: op,
      info,
      ...(error ? { error } : {}),
    })
    fs.appendFileSync(logFile, entry + "\n", "utf-8")
  } catch {
    // 日志写入失败不阻塞主流程
  }
}

// ============================================================================
// 使用追踪
// ============================================================================

function loadUsageData(): Record<string, SkillUsageRecord> {
  const file = getUsageFilePath()
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"))
    }
  } catch {
    // 损坏的数据文件，重新初始化
  }
  return {}
}

function saveUsageData(data: Record<string, SkillUsageRecord>): void {
  try {
    const dir = path.dirname(getUsageFilePath())
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    atomicWriteJson(getUsageFilePath(), data)
  } catch {
    // 写入失败不阻塞
  }
}

function ensureRecord(name: string): SkillUsageRecord {
  const data = loadUsageData()
  if (!data[name]) {
    data[name] = {
      name,
      useCount: 0,
      lastUsedAt: null,
      patchCount: 0,
      failCount: 0,
      consecutiveFails: 0,
      userRating: null,
      createdAt: new Date().toISOString(),
      state: "active",
      pinned: false,
    }
    saveUsageData(data)
  }
  return data[name]
}

export function bumpUsage(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.useCount++
  rec.lastUsedAt = new Date().toISOString()
  // 如果之前是 stale，重新激活
  if (rec.state === "stale") rec.state = "active"
  data[name] = rec
  saveUsageData(data)
}

export function recordFailure(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.failCount++
  rec.consecutiveFails++
  data[name] = rec
  saveUsageData(data)
  log("failure", `Skill "${name}" consecutiveFails=${rec.consecutiveFails}`)
}

export function recordSuccess(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.consecutiveFails = 0 // 重置连续失败计数
  data[name] = rec
  saveUsageData(data)
}

// ============================================================================
// 语义去重（轻量级实现）
// ============================================================================

/**
 * 用 string-similarity 做文本初筛（零成本，毫秒级）。
 * 初筛未命中 → 直接判定无同类（0 Token 消耗）。
 * 初筛命中 → 标记为待确认（可后续用 LLM 兜底确认）。
 */
export async function findSimilarSkills(
  description: string,
): Promise<SkillInfo[]> {
  const allSkills = await listSkills()
  if (allSkills.length === 0) return []

  try {
    const { compareTwoStrings } = await import("string-similarity")
    const results: Array<{ skill: SkillInfo; score: number }> = []

    for (const skill of allSkills) {
      const score = compareTwoStrings(description, skill.description)
      if (score > 0.7) {
        results.push({ skill, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.map((r) => r.skill)
  } catch {
    // 依赖加载失败，返回空（不阻塞流程）
    return []
  }
}

// ============================================================================
// LLM 调用封装（轻量级，通过 SimpleProvider + generateText）
// ============================================================================

/**
 * 从 config.json 加载 LLM 模型配置，用于归因 / 判断 / 生成等后台调用。
 * 配置优先级：
 *   1. config.json 中的 judgeModel 字段（专用廉价模型）
 *   2. config.json 中的 deepseek 配置
 *   3. config.json 中的 dashscope 配置
 *   4. 环境变量 DEEPSEEK_API_KEY / DASHSCOPE_API_KEY
 */
export function loadJudgeConfig(): {
  providerID: string
  modelID: string
  apiKey?: string
  baseURL?: string
} | null {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.join(process.cwd(), "config.json"),
    path.join(__dirname, "../../../config.json"),
    path.join(__dirname, "../../config.json"),
  ]

  for (const configPath of candidates) {
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
        // 优先用 judgeModel 专用配置（低成本模型）
        if (config.judgeModel) {
          return {
            providerID: config.judgeModel.providerID || "openai-compatible",
            modelID: config.judgeModel.modelID || "deepseek-chat",
            apiKey: config.judgeModel.apiKey,
            baseURL: config.judgeModel.baseURL,
          }
        }
        // 回退到 deepseek
        if (config.deepseek?.apiKey) {
          return {
            providerID: "openai-compatible",
            modelID: "deepseek-chat",
            apiKey: config.deepseek.apiKey,
            baseURL: config.deepseek.baseURL,
          }
        }
        // 回退到 dashscope
        if (config.dashscope?.apiKey) {
          return {
            providerID: "alibaba-cn",
            modelID: config.dashscope?.model || "qwen-plus",
            apiKey: config.dashscope.apiKey,
            baseURL: config.dashscope.baseURL,
          }
        }
      } catch {
        /* skip invalid config */
      }
    }
  }

  // 最后尝试环境变量
  const envDeepseekKey = process.env.DEEPSEEK_API_KEY
  const envDashscopeKey = process.env.DASHSCOPE_API_KEY
  if (envDeepseekKey) {
    return {
      providerID: "openai-compatible",
      modelID: "deepseek-chat",
      apiKey: envDeepseekKey,
      baseURL: process.env.DEEPSEEK_BASE_URL,
    }
  }
  if (envDashscopeKey) {
    return {
      providerID: "alibaba-cn",
      modelID: process.env.DASHSCOPE_MODEL || "qwen-plus",
      apiKey: envDashscopeKey,
      baseURL: process.env.DASHSCOPE_BASE_URL,
    }
  }

  return null
}

/** 缓存的 LLM judge 模型实例 */
let _judgeModel: any = null
let _judgeModelFailed = false

/**
 * 获取缓存的 LLM judge 模型。
 * 失败后会标记为不可用，后续调用直接返回 null。
 */
async function getJudgeModel(): Promise<any> {
  if (_judgeModel) return _judgeModel
  if (_judgeModelFailed) return null
  if (process.env.JIANGJICODE_DISABLE_JUDGE) {
    _judgeModelFailed = true
    return null
  }

  try {
    const config = loadJudgeConfig()
    if (!config) {
      _judgeModelFailed = true
      return null
    }
    const model = await SimpleProvider.getLanguage(
      { providerID: config.providerID as any, id: config.modelID },
      { apiKey: config.apiKey, baseURL: config.baseURL },
    )
    _judgeModel = model
    return model
  } catch (err) {
    _judgeModelFailed = true
    console.warn("[skill-manager] Failed to init LLM judge model:", err)
    return null
  }
}

/**
 * 调用 LLM 进行判断/生成。
 * 使用轻量模型（judgeModel 或 deepseek-chat），低 temperature。
 * 失败时返回 null，由调用方回退到启发式逻辑。
 */
async function callLlm(prompt: string): Promise<string | null> {
  const model = await getJudgeModel()
  if (!model) return null

  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: prompt }],
      stopWhen: stepCountIs(1),
      temperature: 0.1,
    })
    return result.text || null
  } catch (err) {
    console.warn("[skill-manager] LLM call failed:", err)
    return null
  }
}

/**
 * 从 LLM 响应中提取 JSON（包含 fixJson 修复）。
 */
function extractJson(text: string): string {
  return fixJson(text)
}

// ============================================================================
// LLM 调用封装（轻量级，通过 AI SDK 的 generateText）
// ============================================================================

/**
 * 用 LLM 判断一段执行轨迹是否为可复用的通用剪辑工作流。
 * 优先使用 LLM，失败时回退到启发式判断。
 */
async function isReusableWorkflow(steps: AgentStepInfo[]): Promise<boolean> {
  // 优先用 LLM 判断
  try {
    const stepsDesc = describeSteps(steps)
    const prompt = PROMPTS.isReusableWorkflow.replace("{steps}", stepsDesc)
    const response = await callLlm(prompt)
    if (response) {
      const cleaned = extractJson(response)
      const parsed = JSON.parse(cleaned)
      if (typeof parsed.reusable === "boolean") {
        log(
          "llm-judge",
          `Reusable: ${parsed.reusable} — ${parsed.reason || ""}`,
        )
        return parsed.reusable
      }
    }
  } catch {
    log("llm-judge", "LLM judge failed, falling back to heuristic")
  }

  // 回退：启发式判断
  const toolArgs = JSON.stringify(
    steps.map((s) => s.toolCalls.map((tc) => tc.args)),
  )
  if (/第\d+秒/.test(toolArgs)) return false
  return true
}

// ============================================================================
// 3 层过滤：是否应该自动创建 Skill
// ============================================================================

export interface ShouldCreateResult {
  shouldCreate: boolean
  reason: string
}

/**
 * 3 层过滤判断是否应触发 skill 创建。
 * 条件 1: toolCalls > 3（复杂度门槛）
 * 条件 2: 完全成功（无 error）
 * 条件 3: 语义去重（初筛 + LLM 兜底）
 * 条件 4: 泛化性校验（通用工作流 vs 一次性定制）
 */
export async function shouldAutoCreate(
  steps: AgentStepInfo[],
  configMode: "always" | "confirm" | "off",
): Promise<ShouldCreateResult> {
  // 开关检查
  if (configMode === "off") {
    return { shouldCreate: false, reason: "autoCreateSkill is off" }
  }

  // 条件 1: toolCalls > 3
  const totalToolCalls = steps.reduce((sum, s) => sum + s.toolCalls.length, 0)
  if (totalToolCalls <= 3) {
    return {
      shouldCreate: false,
      reason: `Too few tool calls: ${totalToolCalls} (need > 3)`,
    }
  }

  // 条件 2: 完全成功
  const hasError = steps.some((s) =>
    s.toolCalls.some((tc) => tc.result.metadata?.error === true),
  )
  if (hasError) {
    return { shouldCreate: false, reason: "Steps contain errors" }
  }

  // 获取步骤描述用于语义去重
  const stepDescriptions = steps
    .map((s) => s.toolCalls.map((tc) => tc.toolName).join(", "))
    .filter(Boolean)
    .join(" → ")

  // 条件 3: 语义去重
  const similar = await findSimilarSkills(stepDescriptions)
  if (similar.length > 0) {
    return {
      shouldCreate: false,
      reason: `Similar skill already exists: "${similar[0].name}" (${similar[0].description})`,
    }
  }

  // 条件 4: 泛化性校验
  const reusable = await isReusableWorkflow(steps)
  if (!reusable) {
    return {
      shouldCreate: false,
      reason: "Task is a one-time custom operation, not a reusable workflow",
    }
  }

  return { shouldCreate: true, reason: "All conditions met" }
}

// ============================================================================
// Skill 读写
// ============================================================================

/**
 * 列出所有 auto-created skills。
 */
export async function listSkills(): Promise<SkillInfo[]> {
  const skillsDir = getSkillsDir()
  if (!fs.existsSync(skillsDir)) return []

  const skills: SkillInfo[] = []
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md")
      if (!fs.existsSync(skillMdPath)) continue

      try {
        const content = fs.readFileSync(skillMdPath, "utf-8")
        const frontmatter = parseFrontmatter(content)
        if (frontmatter) {
          const toolVersion = frontmatter.toolVersion || ""
          skills.push({
            name: frontmatter.name || entry.name,
            description: frontmatter.description || "",
            category: frontmatter.category || "other",
            tags: frontmatter.tags || [],
            filePath: skillMdPath,
            createdAt: frontmatter.created || "",
            toolCount: frontmatter.toolCount || 0,
            toolVersion,
            compatible: toolVersion
              ? toolVersion === CURRENT_TOOL_VERSION
              : false,
          })
        }
      } catch {
        // 跳过损坏的 SKILL.md
      }
    }
  } catch {
    // 目录读取失败
  }

  return skills
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 支持嵌套对象、数组，不依赖外部 yaml 库。
 */
export function parseFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)/)
  if (!match) return null

  const yaml = match[1]
  return parseYamlValue(yaml.trim(), 0).value as Record<string, any> | null
}

/**
 * 轻量 YAML 解析器（仅支持 frontmatter 所需子集）。
 * 支持：key: value, 嵌套对象, 内联数组 [a,b], 块数组 - item
 */
function parseYamlValue(
  text: string,
  indent: number,
): { value: any; consumed: number } {
  const lines = text.split("\n")
  const firstLine = lines[0]
  const firstTrimmed = firstLine.trimStart()
  const currentIndent = firstLine.length - firstTrimmed.length

  // 只在根层级检查 indent（子层级递归中自动对齐）
  if (indent === 0 && currentIndent > 0) {
    // 跳过空行
    let skip = 0
    while (skip < lines.length && lines[skip].trim() === "") skip++
    if (skip > 0) return parseYamlValue(lines.slice(skip).join("\n"), indent)
  }

  // 空
  if (firstTrimmed === "") return { value: null, consumed: 0 }

  // 块数组: "- item"
  if (firstTrimmed.startsWith("- ")) {
    return parseYamlArray(text, indent)
  }

  // key: value 对
  const colonIndex = firstTrimmed.indexOf(":")
  if (colonIndex === -1) return { value: firstTrimmed, consumed: 1 }

  // 整个文本是一个对象
  return parseYamlObject(text, indent)
}

function parseYamlArray(
  text: string,
  _indent: number,
): { value: any[]; consumed: number } {
  const lines = text.split("\n")
  const items: any[] = []
  let consumed = 0

  // 确定基准缩进（第一个 - 的缩进）
  let baseIndent = 0
  for (const line of lines) {
    const trimmed = line.trimStart()
    if (trimmed.startsWith("- ")) {
      baseIndent = line.length - trimmed.length
      break
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    const lineIndent = line.length - trimmed.length

    if (trimmed === "") continue
    if (lineIndent !== baseIndent) break
    if (!trimmed.startsWith("- ")) break

    const valueText = trimmed.slice(2)
    const parsed = parseInlineValue(valueText)
    items.push(parsed)
    consumed = i + 1
  }

  return { value: items, consumed: Math.max(consumed, 1) }
}

function parseYamlObject(
  text: string,
  baseIndent: number,
): { value: Record<string, any>; consumed: number } {
  const lines = text.split("\n")
  const result: Record<string, any> = {}
  let consumed = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()
    const lineIndent = line.length - trimmed.length

    if (trimmed === "" || trimmed.startsWith("#")) {
      consumed = i + 1
      continue
    }

    // 缩进小于 baseIndent → 属于上一级，停止
    if (lineIndent < baseIndent) break

    // 只处理这一层的 key（缩进 == baseIndent）
    if (lineIndent !== baseIndent) {
      // 可能是多行值的延续，但不支持，直接跳过
      continue
    }

    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) {
      consumed = i + 1
      continue
    }

    const key = trimmed.slice(0, colonIndex).trim()
    const valuePart = trimmed.slice(colonIndex + 1).trim()

    if (valuePart === "") {
      // 值在下一行（嵌套对象或块数组）
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        const nextTrimmed = nextLine.trimStart()
        const nextIndent = nextLine.length - nextTrimmed.length

        if (nextIndent > lineIndent) {
          const remainingLines = lines.slice(i + 1).join("\n")
          const parsed = parseYamlValue(remainingLines, nextIndent)
          result[key] = parsed.value
          consumed = i + 1 + parsed.consumed
          i += parsed.consumed
          continue
        }
      }
      result[key] = null
      consumed = i + 1
    } else {
      result[key] = parseInlineValue(valuePart)
      consumed = i + 1
    }
  }

  return { value: result, consumed: Math.max(consumed, 1) }
}

/**
 * 解析行内值（数字、布尔、内联数组、字符串）。
 */
function parseInlineValue(text: string): any {
  const trimmed = text.trim()

  // 空值
  if (trimmed === "" || trimmed === "null" || trimmed === "~") return null

  // 布尔值
  if (trimmed === "true" || trimmed === "yes" || trimmed === "on") return true
  if (trimmed === "false" || trimmed === "no" || trimmed === "off") return false

  // 内联数组: [a, b, c]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((s: string) => {
          const v = s.trim().replace(/^['"]|['"]$/g, "")
          const num = Number(v)
          return isNaN(num) ? v : num
        })
    }
  }

  // 数字
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed.includes(".") ? parseFloat(trimmed) : parseInt(trimmed, 10)
  }

  // 引号字符串
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

/**
 * 生成描述执行轨迹的文本摘要，用于 LLM 生成 skill。
 */
function describeSteps(steps: AgentStepInfo[]): string {
  return steps
    .map((s) => {
      const calls = s.toolCalls
        .map((tc) => {
          const args = JSON.stringify(tc.args, null, 2)
          return `  工具: ${tc.toolName}\n  参数: ${args}`
        })
        .join("\n")
      return `第 ${s.stepNumber} 步:\n${calls}`
    })
    .join("\n\n")
}

/**
 * 从执行轨迹创建 Skill。
 * LLM 生成 SKILL.md → 写入 ~/.jianjicode/skills/<name>/SKILL.md。
 */
export async function createSkillFromTrajectory(
  name: string,
  description: string,
  steps: AgentStepInfo[],
): Promise<void> {
  const skillsDir = getSkillsDir()
  const skillDir = path.join(skillsDir, name)

  // 创建目录
  fs.mkdirSync(skillDir, { recursive: true })

  const toolCount = steps.reduce((sum, s) => sum + s.toolCalls.length, 0)
  const stepsDesc = describeSteps(steps)

  // 构建 SKILL.md
  const skillContent = `---
name: ${name}
description: ${description}
category: other
tags: []
created: ${new Date().toISOString().split("T")[0]}
toolCount: ${toolCount}
toolVersion: "1.0.0"
inputSchema:
  type: object
  required: []
  properties: {}
---

# ${name}

${description}

## 步骤

${stepsDesc}
`

  // 写入文件
  const skillMdPath = path.join(skillDir, "SKILL.md")
  atomicWriteText(skillMdPath, skillContent)

  // 初始化使用记录
  ensureRecord(name)

  log("create", `Skill "${name}" created at ${skillMdPath}`)
}

// ============================================================================
// 主入口：maybeCreateSkill（由 agent-loop.ts 调用）
// ============================================================================

/**
 * 尝试用 LLM 从执行轨迹生成完整的 SKILL.md。
 * 成功时返回 skill 名称，失败时返回 null。
 */
async function tryCreateSkillFromLlm(
  steps: AgentStepInfo[],
): Promise<string | null> {
  const stepsDesc = describeSteps(steps)
  const prompt = PROMPTS.generateSkill.replace("{steps}", stepsDesc)

  const response = await callLlm(prompt)
  if (!response) {
    log("llm-skill", "LLM returned empty response")
    return null
  }

  const fm = parseFrontmatter(response)
  if (!fm?.name) {
    log("llm-skill", "LLM returned SKILL.md without valid name frontmatter")
    return null
  }

  const name = fm.name

  // 验证 name 格式
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    log("llm-skill", `LLM generated invalid name "${name}", falling back`)
    return null
  }

  // 检查是否已存在同名 skill
  const skillsDir = getSkillsDir()
  const skillDir = path.join(skillsDir, name)
  if (fs.existsSync(skillDir)) {
    log("llm-skill", `Skill "${name}" already exists, skipping`)
    return null
  }

  // 写入 LLM 生成的内容
  try {
    fs.mkdirSync(skillDir, { recursive: true })
    atomicWriteText(path.join(skillDir, "SKILL.md"), response)
    ensureRecord(name)
    log("llm-skill", `Skill "${name}" created from LLM-generated SKILL.md`)
    return name
  } catch (err: any) {
    log(
      "error",
      `Failed to write LLM-generated skill "${name}": ${err.message}`,
    )
    return null
  }
}

/**
 * agent-loop 完成后调用的非阻塞入口。
 * 3 层过滤 → 优先用 LLM 生成完整 SKILL.md → 失败时回退到工具名拼接。
 *
 * @param steps agent-loop 的所有执行步骤
 * @param sessionId 会话 ID
 * @param configMode 配置模式（默认 "confirm"）
 */
export async function maybeCreateSkill(
  steps: AgentStepInfo[],
  sessionId: string,
  configMode: "always" | "confirm" | "off" = "confirm",
): Promise<NudgeMessage | null> {
  try {
    // 3 层过滤
    const { shouldCreate, reason } = await shouldAutoCreate(steps, configMode)
    if (!shouldCreate) {
      log("skip", `Session ${sessionId}: ${reason}`)
      return null
    }

    // Phase 3: 优先用 LLM 生成完整 SKILL.md（含名、描述、inputSchema、步骤）
    const llmCreated = await tryCreateSkillFromLlm(steps)
    if (llmCreated) {
      log(
        "create",
        `Skill "${llmCreated}" created via LLM for session ${sessionId}`,
      )
      if (configMode === "always") {
        log(
          "auto-create",
          `Skill "${llmCreated}" created silently (mode: always)`,
        )
      }
      return {
        type: "create-confirm",
        name: llmCreated,
        description: `LLM-created skill: ${llmCreated}`,
        toolCount: steps.flatMap((s) => s.toolCalls).length,
        message: `💡 已自动创建技能「${llmCreated}」`,
      }
    }

    // 回退：从工具调用中提取名称和描述（粗糙拼接）
    const toolNames = [
      ...new Set(steps.flatMap((s) => s.toolCalls.map((tc) => tc.toolName))),
    ]
    const name =
      toolNames
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/--+/g, "-")
        .replace(/^-|-$/g, "") || `skill-${Date.now()}`
    const description = `Auto-created skill: ${toolNames.join(", ")}`

    // 创建技能
    await createSkillFromTrajectory(name, description, steps)

    // 确认/静默模式下创建技能
    if (configMode === "confirm") {
      // 写入 nudge，供前端通过 GET /nudges 拉取
      try {
        const { nudgeCreateSkill } = await import("./nudge-service.js")
        const nudge = nudgeCreateSkill(name, description, toolNames.length)
        log("nudge", `Nudge created for skill "${name}"`)
        return nudge
      } catch {
        // nudge 写入失败不阻塞
      }
    } else if (configMode === "always") {
      log("auto-create", `Skill "${name}" created silently (mode: always)`)
    }

    log("create", `Skill "${name}" created for session ${sessionId}`)
    return null
  } catch (error: any) {
    log("error", `maybeCreateSkill failed: ${error.message}`, error.stack)
    return null
  }
}

// ============================================================================
// Phase 2: Self-Patching（归因 + 灰度 patch）
// ============================================================================

/**
 * 灰度 patch 文件名常量
 */
const PATCH_SUFFIX = ".patch"
const BACKUP_PREFIX = ".v"

/**
 * 获取 skill 目录路径。
 */
function getSkillDir(name: string): string {
  return path.join(getSkillsDir(), name)
}

/**
 * 获取 SKILL.md 路径。
 */
function getSkillMdPath(name: string): string {
  return path.join(getSkillDir(name), "SKILL.md")
}

/**
 * 获取 SKILL.md.patch 路径。
 */
function getPatchPath(name: string): string {
  return path.join(getSkillDir(name), `SKILL.md${PATCH_SUFFIX}`)
}

/**
 * 获取历史版本路径。
 */
function getBackupPath(name: string, version: number): string {
  return path.join(getSkillDir(name), `SKILL.md${BACKUP_PREFIX}${version}`)
}

/**
 * 列出 skill 目录下的所有历史版本号。
 */
function listBackupVersions(name: string): number[] {
  const dir = getSkillDir(name)
  if (!fs.existsSync(dir)) return []

  const versions: number[] = []
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const match = entry.match(/^SKILL\.md\.v(\d+)$/)
      if (match) versions.push(parseInt(match[1], 10))
    }
  } catch {
    /* ignore */
  }
  return versions.sort((a, b) => a - b)
}

/**
 * 备份当前 SKILL.md 为历史版本（保留最近 3 个）。
 * - 将 SKILL.md → SKILL.md.v{nextVersion}
 * - 删除超出 3 个的最旧版本
 */
export function backupSkill(name: string): void {
  const skillMdPath = getSkillMdPath(name)
  if (!fs.existsSync(skillMdPath)) return

  const versions = listBackupVersions(name)
  const nextVersion = versions.length > 0 ? Math.max(...versions) + 1 : 1
  const backupPath = getBackupPath(name, nextVersion)

  try {
    fs.copyFileSync(skillMdPath, backupPath)
    log("backup", `Skill "${name}" backed up as v${nextVersion}`)

    // 保留最近 3 个历史版本，删除更旧的
    const allVersions = listBackupVersions(name)
    while (allVersions.length > 3) {
      const oldest = allVersions.shift()!
      try {
        fs.unlinkSync(getBackupPath(name, oldest))
        log("cleanup", `Removed old backup v${oldest} for "${name}"`)
      } catch {
        /* ignore */
      }
    }
  } catch (err: any) {
    log("error", `Failed to backup skill "${name}": ${err.message}`)
  }
}

/**
 * 将灰度 patch 提升为稳定版本。
 * - SKILL.md.patch → 覆盖 SKILL.md
 * - 删除 SKILL.md.patch
 */
export function promotePatch(name: string): void {
  const patchPath = getPatchPath(name)
  const skillMdPath = getSkillMdPath(name)

  if (!fs.existsSync(patchPath)) return

  try {
    fs.copyFileSync(patchPath, skillMdPath)
    fs.unlinkSync(patchPath)
    log("promote", `Patch promoted to stable for "${name}"`)
  } catch (err: any) {
    log("error", `Failed to promote patch for "${name}": ${err.message}`)
  }
}

/**
 * 回滚灰度 patch（执行失败时）。
 * - 删除 SKILL.md.patch
 */
export function rollbackPatch(name: string): void {
  const patchPath = getPatchPath(name)

  if (!fs.existsSync(patchPath)) return

  try {
    fs.unlinkSync(patchPath)
    log("rollback", `Patch rolled back for "${name}"`)
  } catch (err: any) {
    log("error", `Failed to rollback patch for "${name}": ${err.message}`)
  }
}

/**
 * 替换 skill 内容中的模板变量。
 * 支持：${INPUT_DIR}, ${INPUT_PATH}, ${OUTPUT_DIR}, ${PROJECT_DIR}
 * 未提供的变量保留原样。
 */
export function applyTemplateVars(
  content: string,
  vars?: Record<string, string>,
): string {
  if (!vars || Object.keys(vars).length === 0) return content
  return content.replace(/\$\{(\w+)\}/g, (_match, key) => {
    return vars[key] !== undefined ? vars[key] : _match
  })
}

/**
 * 加载 skill 内容，优先返回 .patch 版本（灰度测试用）。
 * 返回 null 当文件不存在。
 * @param name skill 名称
 * @param vars 可选的模板变量（如 {INPUT_DIR: "/path/to/video"}）
 */
export function loadSkillContent(
  name: string,
  vars?: Record<string, string>,
): string | null {
  // 优先检测 .patch 文件（灰度版本）
  const patchPath = getPatchPath(name)
  if (fs.existsSync(patchPath)) {
    try {
      return applyTemplateVars(fs.readFileSync(patchPath, "utf-8"), vars)
    } catch {
      log("error", `Failed to read patch file for "${name}"`)
    }
  }

  // 回退到稳定版本
  const skillMdPath = getSkillMdPath(name)
  if (fs.existsSync(skillMdPath)) {
    try {
      return applyTemplateVars(fs.readFileSync(skillMdPath, "utf-8"), vars)
    } catch {
      log("error", `Failed to read SKILL.md for "${name}"`)
    }
  }

  return null
}

/**
 * 写入灰度 patch 文件。
 * 调用前应先调用 backupSkill() 做备份。
 */
export function writePatch(name: string, content: string): void {
  const patchPath = getPatchPath(name)
  const dir = path.dirname(patchPath)

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // 写入临时文件后 rename，保证原子性
    atomicWriteText(patchPath, content)

    // 更新 patch 计数
    const data = loadUsageData()
    const rec = ensureRecord(name)
    rec.patchCount = (rec.patchCount || 0) + 1
    data[name] = rec
    saveUsageData(data)

    log("patch", `Patch written for "${name}" (patch #${rec.patchCount})`)
  } catch (err: any) {
    log("error", `Failed to write patch for "${name}": ${err.message}`)
  }
}

/**
 * 检查 skill 是否已损坏（patchCount >= 3）。
 * 损坏的 skill 标记为 "broken" 状态，停止自动修复。
 */
export function checkBroken(name: string): boolean {
  const data = loadUsageData()
  const rec = ensureRecord(name)

  if (rec.patchCount >= 3) {
    rec.state = "broken"
    data[name] = rec
    saveUsageData(data)
    log(
      "broken",
      `Skill "${name}" marked as broken (${rec.patchCount} patches failed)`,
    )
    return true
  }
  return false
}

/**
 * 启发式归因分析：判断错误是否为 Skill 本身的问题。
 *
 * 检查逻辑：
 * 1. 如果错误信息包含 "permission" 或 "denied" → 非 Skill 问题
 * 2. 如果错误信息包含 "not found" 且指向文件 → 非 Skill 问题
 * 3. 如果错误信息包含 "timeout" 或 "timed out" → 非 Skill 问题
 * 4. 如果错误信息包含 "invalid"、"required"、"must be" → 可能是 Skill 问题
 * 5. 默认：非 Skill 问题（保守策略，避免错误 patch）
 *
 * Phase 3 中替换为 LLM-based 归因（PROMPTS.errorAttribution）。
 */
function heuristicAttributeError(errorLog: string): {
  isSkillProblem: boolean
  reason: string
  fixSuggestion: string
} {
  const lower = errorLog.toLowerCase()

  // 非 Skill 问题模式
  if (
    /permission\s*denied|access\s*denied|not\s*(a|an)?\s*(authorized|allowed)/.test(
      lower,
    )
  ) {
    return {
      isSkillProblem: false,
      reason: "Permission denied — user authorization issue",
      fixSuggestion: "",
    }
  }
  if (/(file|path|directory)\s+not\s+found|enoent/.test(lower)) {
    return {
      isSkillProblem: false,
      reason: "File not found — source file or path issue",
      fixSuggestion: "",
    }
  }
  if (/(timed?\s*out|timeout|econnrefused|econnreset|network)/.test(lower)) {
    return {
      isSkillProblem: false,
      reason: "Network/API timeout — external service issue",
      fixSuggestion: "",
    }
  }
  if (
    /(source\s+file|input\s+file).*corrupt|invalid\s+data|invalid\s+file/.test(
      lower,
    )
  ) {
    return {
      isSkillProblem: false,
      reason: "Source file corrupt or invalid",
      fixSuggestion: "",
    }
  }

  // 可能是 Skill 问题模式
  if (
    /(invalid|must\s+be|required|expected).*(parameter|argument|option|flag)/.test(
      lower,
    )
  ) {
    const match = lower.match(/(invalid|must\s+be|required|expected)\s+[^:.;]+/)
    const detail = match ? match[0] : "parameter validation failed"
    return {
      isSkillProblem: true,
      reason: `Tool parameter issue: ${detail}`,
      fixSuggestion: "Check tool parameter names and values in the skill steps",
    }
  }
  if (
    /ffmpeg.*(unknown\s+encoder|unknown\s+decoder|not\s+recognized)/.test(lower)
  ) {
    return {
      isSkillProblem: true,
      reason: "FFmpeg command uses unsupported codec or flag",
      fixSuggestion:
        "Verify FFmpeg command flags are correct for the target format",
    }
  }
  if (/error.*unexpected|unexpected.*error/.test(lower)) {
    return {
      isSkillProblem: true,
      reason:
        "Unexpected error during tool execution — may be skill logic issue",
      fixSuggestion: "Review the skill steps for potential logic errors",
    }
  }

  return {
    isSkillProblem: false,
    reason: "No clear skill-related pattern detected",
    fixSuggestion: "",
  }
}

/**
 * 从错误步骤中提取工具名称列表。
 */
function extractToolNamesFromSteps(steps: AgentStepInfo[]): string[] {
  return [
    ...new Set(steps.flatMap((s) => s.toolCalls.map((tc) => tc.toolName))),
  ]
}

/**
 * 在已有 skills 中查找匹配给定工具名列表的 skill。
 * 返回匹配度最高的 skill 名称（按工具名交集大小排序）。
 */
async function findMatchingSkill(toolNames: string[]): Promise<string | null> {
  if (toolNames.length === 0) return null

  const skills = await listSkills()
  if (skills.length === 0) return null

  // 加载每个 skill 的内容，计算工具名交集
  const scored = skills.map((skill) => {
    const content = loadSkillContent(skill.name)
    if (!content) return { name: skill.name, score: 0 }

    // 简单匹配：skill 描述或内容中出现的工具名数量
    const matchCount = toolNames.filter((t) => content.includes(t)).length
    return { name: skill.name, score: matchCount / toolNames.length }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0].score > 0.3 ? scored[0].name : null
}

/**
 * 从 error 步骤构建错误日志文本。
 */
function buildErrorLog(steps: AgentStepInfo[]): string {
  return steps
    .filter((s) => s.toolCalls.some((tc) => tc.result.metadata?.error === true))
    .map((s) => {
      const errors = s.toolCalls
        .filter((tc) => tc.result.metadata?.error === true)
        .map(
          (tc) =>
            `  工具: ${tc.toolName}\n  参数: ${JSON.stringify(tc.args)}\n  结果: ${tc.result.output}`,
        )
        .join("\n")
      return `第 ${s.stepNumber} 步:\n${errors}`
    })
    .join("\n\n")
}

/**
 * 计算跳过步骤中的成功工具调用数（用于检测连续失败）。
 */
function countConsecutiveErrors(steps: AgentStepInfo[]): number {
  let count = 0
  for (const s of [...steps].reverse()) {
    const hasError = s.toolCalls.some(
      (tc) => tc.result.metadata?.error === true,
    )
    if (hasError) count++
    else break
  }
  return count
}

/**
 * 处理工具执行失败：归因分析 + 灰度 patch。
 *
 * 完整流程：
 * 1. 从 steps 中提取工具名，匹配已注册 skill
 * 2. 构建错误日志
 * 3. 启发式归因分析
 * 4. SKill 问题 → 备份当前 SKILL.md → 生成灰度 patch → 写入 .patch
 * 5. 非 Skill 问题 → 仅记录失败
 * 6. patchCount >= 3 → 标记 broken
 *
 * @param steps agent-loop 的执行步骤（含错误）
 * @param sessionId 会话 ID
 */
export async function handleToolError(
  steps: AgentStepInfo[],
  sessionId: string,
): Promise<void> {
  try {
    // 1. 提取工具名，匹配 skill
    const toolNames = extractToolNamesFromSteps(steps)
    const skillName = await findMatchingSkill(toolNames)
    if (!skillName) {
      log(
        "skip",
        `Session ${sessionId}: no matching skill found for tools: ${toolNames.join(", ")}`,
      )
      return
    }

    // 2. 记录失败
    recordFailure(skillName)

    // 3. 构建错误日志
    const errorLog = buildErrorLog(steps)
    if (!errorLog) {
      log("skip", `Session ${sessionId}: no error details found`)
      return
    }

    // 4. 归因分析 — 优先用 LLM，失败时回退到启发式
    let attribution = heuristicAttributeError(errorLog)

    // 尝试 LLM 归因（仅在启发式判定为非 skill 问题时提升准确性）
    try {
      const currentContent = loadSkillContent(skillName)
      if (currentContent) {
        const llmPrompt = PROMPTS.errorAttribution
          .replace("{errorLog}", errorLog)
          .replace("{skillContent}", currentContent)
        const llmResponse = await callLlm(llmPrompt)
        if (llmResponse) {
          const cleaned = extractJson(llmResponse)
          const parsed = JSON.parse(cleaned)
          if (typeof parsed.isSkillProblem === "boolean") {
            attribution = {
              isSkillProblem: parsed.isSkillProblem,
              reason: parsed.reason || attribution.reason,
              fixSuggestion: parsed.fixSuggestion || attribution.fixSuggestion,
            }
          }
        }
      }
    } catch {
      log(
        "attribution",
        `LLM attribution failed for "${skillName}", using heuristic result`,
      )
    }

    if (!attribution.isSkillProblem) {
      log(
        "attribution",
        `Session ${sessionId}: "${skillName}" error is NOT skill-related: ${attribution.reason}`,
      )
      return
    }

    // 5. 是 Skill 问题 → 灰度 patch
    log(
      "attribution",
      `Session ${sessionId}: "${skillName}" error IS skill-related: ${attribution.reason}`,
    )

    // 检查是否已标记 broken
    const data = loadUsageData()
    const rec = ensureRecord(skillName)
    if (rec.state === "broken") {
      log(
        "skip",
        `Session ${sessionId}: "${skillName}" is already marked broken, skipping auto-patch`,
      )
      return
    }

    // 备份当前版本
    backupSkill(skillName)

    // 构建 patch 内容（在现有内容基础上加入修复建议注释）
    const currentContent = loadSkillContent(skillName) || ""

    const patchContent = `---
# PATCH NOTE: Auto-generated fix for: ${attribution.reason}
# Patch #${rec.patchCount + 1} | ${new Date().toISOString().split("T")[0]}
---

${currentContent}

<!--
## 自动修复建议
${attribution.fixSuggestion}

注意：这是一个灰度 patch，下次执行时会优先使用。
如果执行成功，该 patch 会自动提升为稳定版本。
如果执行失败，该 patch 会被自动回滚。
-->
`

    // 写入 patch
    writePatch(skillName, patchContent)

    // 检查是否 broken
    checkBroken(skillName)

    log(
      "handle-error",
      `Session ${sessionId}: auto-patch applied to "${skillName}"`,
    )
  } catch (error: any) {
    log("error", `handleToolError failed: ${error.message}`, error.stack)
  }
}

// ============================================================================
// Phase 2: 便捷查询 — 检测是否有灰度 patch
// ============================================================================

/**
 * 检测指定 skill 是否有灰度 patch 待测试。
 */
export function hasPatch(name: string): boolean {
  return fs.existsSync(getPatchPath(name))
}

/**
 * 获取 skill 的完整文件列表（用于调试/管理）。
 */
export function getSkillFiles(name: string): string[] {
  const dir = getSkillDir(name)
  if (!fs.existsSync(dir)) return []
  try {
    return fs.readdirSync(dir).map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

// ============================================================================
// Skill 删除
// ============================================================================

/**
 * 删除一个 skill 及其所有文件。
 * 包括 SKILL.md, 历史版本, patch 文件, 以及 supporting files。
 * 同时清理 .usage.json 中的记录。
 *
 * @param name skill 名称
 * @returns 是否成功删除
 */
export function deleteSkill(name: string): boolean {
  const dir = getSkillDir(name)
  if (!fs.existsSync(dir)) return false

  try {
    // 递归删除整个 skill 目录
    fs.rmSync(dir, { recursive: true, force: true })

    // 清理使用记录
    const data = loadUsageData()
    if (data[name]) {
      delete data[name]
      saveUsageData(data)
    }

    log("delete", `Skill "${name}" deleted`)
    return true
  } catch (err: any) {
    log("error", `Failed to delete skill "${name}": ${err.message}`)
    return false
  }
}

// ============================================================================
// Supporting Files — skill 可附带参考文件、模板、脚本、资源文件
// ============================================================================

export interface SupportingFile {
  type: "reference" | "template" | "script" | "asset"
  fileName: string
  filePath: string
  size: number
  updatedAt: string
}

/** 支持的文件子目录映射 */
const SUPPORTING_DIRS: Record<string, string> = {
  reference: "references",
  template: "templates",
  script: "scripts",
  asset: "assets",
}

/**
 * 获取 skill 的 supporting files 目录路径。
 */
export function getSupportingDir(
  name: string,
  type: "reference" | "template" | "script" | "asset",
): string {
  const subDir = SUPPORTING_DIRS[type]
  return path.join(getSkillDir(name), subDir)
}

/**
 * 列出 skill 的所有 supporting files。
 */
export function listSupportingFiles(name: string): SupportingFile[] {
  const dir = getSkillDir(name)
  if (!fs.existsSync(dir)) return []

  const files: SupportingFile[] = []

  for (const [type, subDir] of Object.entries(SUPPORTING_DIRS)) {
    const fullPath = path.join(dir, subDir)
    if (!fs.existsSync(fullPath)) continue

    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = path.join(fullPath, entry.name)
        try {
          const stat = fs.statSync(filePath)
          files.push({
            type: type as SupportingFile["type"],
            fileName: entry.name,
            filePath,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
          })
        } catch {
          /* skip */
        }
      }
    } catch {
      /* skip */
    }
  }

  return files
}

/**
 * 向 skill 写入 supporting file。
 * 自动创建必要的子目录。
 */
export function writeSupportingFile(
  name: string,
  type: "reference" | "template" | "script" | "asset",
  fileName: string,
  content: string,
): { success: boolean; filePath: string; error?: string } {
  // 路径安全检查：防止目录遍历
  if (hasTraversalComponent(fileName)) {
    return {
      success: false,
      filePath: "",
      error: `Path traversal detected in file name: "${fileName}"`,
    }
  }

  const skillDir = getSkillDir(name)
  const subDir = SUPPORTING_DIRS[type]
  const targetDir = path.join(skillDir, subDir)

  // 使用 safeJoin 确保最终路径在 targetDir 内
  const safePath = safeJoin(targetDir, fileName)
  if (!safePath) {
    return {
      success: false,
      filePath: "",
      error: `Security: resolved path is outside "${name}/${subDir}"`,
    }
  }

  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
    atomicWriteText(safePath, content)
    log("supporting-file", `File "${fileName}" written to "${name}/${subDir}"`)
    return { success: true, filePath: safePath }
  } catch (err: any) {
    log(
      "error",
      `Failed to write supporting file "${fileName}" for "${name}": ${err.message}`,
    )
    return { success: false, filePath: "", error: err.message }
  }
}

/**
 * 删除 skill 的 supporting file。
 */
export function removeSupportingFile(
  name: string,
  type: "reference" | "template" | "script" | "asset",
  fileName: string,
): { success: boolean; error?: string } {
  const subDir = SUPPORTING_DIRS[type]
  const baseDir = path.join(getSkillDir(name), subDir)

  // 路径安全检查
  if (hasTraversalComponent(fileName)) {
    return {
      success: false,
      error: `Path traversal detected in file name: "${fileName}"`,
    }
  }

  const safePath = safeJoin(baseDir, fileName)
  if (!safePath) {
    return {
      success: false,
      error: `Security: resolved path is outside "${name}/${subDir}"`,
    }
  }

  try {
    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `File "${fileName}" not found in "${name}/${subDir}"`,
      }
    }
    fs.unlinkSync(safePath)
    log(
      "supporting-file",
      `File "${fileName}" removed from "${name}/${subDir}"`,
    )
    return { success: true }
  } catch (err: any) {
    log(
      "error",
      `Failed to remove supporting file "${fileName}" for "${name}": ${err.message}`,
    )
    return { success: false, error: err.message }
  }
}

/**
 * 读取 skill 的 supporting file 内容。
 */
export function readSupportingFile(
  name: string,
  type: "reference" | "template" | "script" | "asset",
  fileName: string,
): { success: boolean; content?: string; error?: string } {
  const subDir = SUPPORTING_DIRS[type]
  const baseDir = path.join(getSkillDir(name), subDir)

  if (hasTraversalComponent(fileName)) {
    return {
      success: false,
      error: `Path traversal detected in file name: "${fileName}"`,
    }
  }

  const safePath = safeJoin(baseDir, fileName)
  if (!safePath) {
    return {
      success: false,
      error: `Security: resolved path is outside "${name}/${subDir}"`,
    }
  }

  try {
    if (!fs.existsSync(safePath)) {
      return {
        success: false,
        error: `File "${fileName}" not found in "${name}/${subDir}"`,
      }
    }
    const content = fs.readFileSync(safePath, "utf-8")
    return { success: true, content }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ============================================================================
// Phase 3: 技能生命周期管理
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  filled: Record<string, unknown> // params with defaults applied
}

/**
 * 轻量 JSON Schema 校验器。
 * 对 SKILL.md frontmatter 中的 inputSchema 做运行时校验。
 *
 * 支持：
 * - required 必填检查
 * - type 类型检查（string / number / boolean）
 * - default 默认值填充
 * - minimum / maximum 数值范围
 * - enum 枚举值检查
 */
function validateJsonSchema(
  params: Record<string, unknown>,
  schema: Record<string, any>,
): ValidationResult {
  const errors: string[] = []
  const filled: Record<string, unknown> = { ...params }

  if (!schema || schema.type !== "object") {
    return { valid: true, errors: [], filled } // 无 schema 时跳过校验
  }

  const properties = schema.properties || {}
  const required: string[] = schema.required || []

  // 1. required 必填检查
  for (const key of required) {
    if (
      filled[key] === undefined ||
      filled[key] === null ||
      filled[key] === ""
    ) {
      errors.push(`Missing required parameter: "${key}"`)
    }
  }

  // 2. 逐属性校验 + 默认值填充
  for (const [key, prop] of Object.entries(properties)) {
    const propDef = prop as Record<string, any>
    const value = filled[key]

    // 默认值填充
    if (value === undefined && propDef.default !== undefined) {
      filled[key] = propDef.default
      continue
    }

    if (value === undefined) continue

    // type 检查
    if (propDef.type) {
      const actualType = typeof value
      if (actualType !== propDef.type) {
        errors.push(
          `Parameter "${key}": expected type ${propDef.type}, got ${actualType}`,
        )
        continue
      }
    }

    // number 范围检查
    if (typeof value === "number") {
      if (propDef.minimum !== undefined && value < propDef.minimum) {
        errors.push(
          `Parameter "${key}": ${value} is less than minimum ${propDef.minimum}`,
        )
      }
      if (propDef.maximum !== undefined && value > propDef.maximum) {
        errors.push(
          `Parameter "${key}": ${value} is greater than maximum ${propDef.maximum}`,
        )
      }
    }

    // enum 检查
    if (propDef.enum && Array.isArray(propDef.enum)) {
      if (!propDef.enum.includes(value)) {
        errors.push(
          `Parameter "${key}": "${value}" is not in allowed values: ${propDef.enum.join(", ")}`,
        )
      }
    }
  }

  return { valid: errors.length === 0, errors, filled }
}

/**
 * 校验 skill 参数（基于 SKILL.md 中的 inputSchema）。
 * 返回校验结果 + 默认值填充后的参数。
 */
export function validateSkillParams(
  name: string,
  params: Record<string, unknown>,
): ValidationResult {
  const content = loadSkillContent(name)
  if (!content) {
    return {
      valid: false,
      errors: [`Skill "${name}" not found`],
      filled: params,
    }
  }

  const fm = parseFrontmatter(content)
  if (!fm || !fm.inputSchema) {
    return { valid: true, errors: [], filled: params } // 无 schema 时放行
  }

  return validateJsonSchema(params, fm.inputSchema)
}

/**
 * 当前工具 API 版本。
 * 当任何一个工具的输入参数发生不兼容变更时递增此版本号。
 */
export const CURRENT_TOOL_VERSION = "1.0.0"

/**
 * 获取指定 skill 的 toolVersion（从 frontmatter 读取）。
 */
function getSkillToolVersion(name: string): string | null {
  const content = loadSkillContent(name)
  if (!content) return null
  const fm = parseFrontmatter(content)
  return fm?.toolVersion || null
}

/**
 * 检查 skill 是否与当前工具版本兼容。
 * 不兼容的 skill 不会被 AI 自动建议使用。
 */
export function isSkillCompatible(name: string): boolean {
  const skillVersion = getSkillToolVersion(name)
  if (!skillVersion) return false
  return skillVersion === CURRENT_TOOL_VERSION
}

/**
 * 将 skill 标记为 stale（30 天未使用）。
 */
export function staleSkill(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  if (rec.pinned) {
    log("lifecycle", `Skill "${name}" is pinned, skipping stale`)
    return
  }
  rec.state = "stale"
  data[name] = rec
  saveUsageData(data)
  log("lifecycle", `Skill "${name}" marked as stale`)
}

/**
 * 将 skill 标记为 archived。
 */
export function archiveSkill(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  if (rec.pinned) {
    log("lifecycle", `Skill "${name}" is pinned, skipping archive`)
    return
  }
  rec.state = "archived"
  data[name] = rec
  saveUsageData(data)
  log("lifecycle", `Skill "${name}" archived`)
}

/**
 * 固定/取消固定 skill，固定后跳过所有自动操作。
 */
export function pinSkill(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.pinned = true
  data[name] = rec
  saveUsageData(data)
  log("lifecycle", `Skill "${name}" pinned`)
}

export function unpinSkill(name: string): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.pinned = false
  data[name] = rec
  saveUsageData(data)
  log("lifecycle", `Skill "${name}" unpinned`)
}

/**
 * 用户评分（1-5）。
 */
export function rateSkill(name: string, rating: 1 | 2 | 3 | 4 | 5): void {
  const data = loadUsageData()
  const rec = ensureRecord(name)
  rec.userRating = rating
  data[name] = rec
  saveUsageData(data)
  log("lifecycle", `Skill "${name}" rated ${rating}`)

  // 评分 < 3 自动标记 stale
  if (rating < 3 && rec.state === "active" && !rec.pinned) {
    rec.state = "stale"
    data[name] = rec
    saveUsageData(data)
    log("lifecycle", `Skill "${name}" auto-staled due to low rating`)
  }
}

export interface LifecycleAction {
  name: string
  action: "stale" | "archive" | "reactivate"
  reason: string
}

/**
 * 全量生命周期检查。
 *
 * 规则：
 * - active + 30 天未使用 → stale
 * - stale + 90 天未使用 → archive（需用户确认）
 * - archived 不做变动（保留文件）
 * - pinned 跳过所有自动操作
 *
 * 返回建议的操作列表（不实际执行 archive，只建议）。
 */
export function runLifecycleCheck(): LifecycleAction[] {
  const data = loadUsageData()
  const actions: LifecycleAction[] = []
  const now = Date.now()

  for (const [name, rec] of Object.entries(data)) {
    if (rec.pinned) continue
    if (rec.state === "broken") continue

    const lastUsed = rec.lastUsedAt ? new Date(rec.lastUsedAt).getTime() : 0
    const daysSinceLastUse =
      lastUsed > 0 ? (now - lastUsed) / 86400000 : Infinity

    // active → stale（30 天未使用）
    if (rec.state === "active" && daysSinceLastUse >= 30) {
      staleSkill(name)
      actions.push({
        name,
        action: "stale",
        reason: `No use for ${Math.round(daysSinceLastUse)} days`,
      })
    }
    // stale → archive（90 天未使用）
    if (rec.state === "stale" && daysSinceLastUse >= 90) {
      actions.push({
        name,
        action: "archive",
        reason: `Stale for ${Math.round(daysSinceLastUse)} days without use`,
      })
    }
  }

  if (actions.length > 0) {
    log("lifecycle", `Lifecycle check: ${actions.length} actions suggested`)
  }

  return actions
}

/**
 * 获取需要 curator 关注的候选 skill 列表。
 * 包括：stale、broken、低评分、高 patchCount。
 */
export function getReviewCandidates(): SkillUsageRecord[] {
  const data = loadUsageData()
  const candidates: SkillUsageRecord[] = []

  for (const rec of Object.values(data)) {
    if (rec.pinned) continue
    if (rec.state === "stale" || rec.state === "broken") {
      candidates.push(rec)
    } else if (rec.userRating !== null && rec.userRating < 3) {
      candidates.push(rec)
    } else if (rec.patchCount >= 2) {
      candidates.push(rec)
    }
  }

  return candidates
}

// ============================================================================
// Phase 3: runReview — 向后兼容别名
// ============================================================================

/**
 * 执行运行时 review（触发生命周期检查）。
 */
export async function runReview(): Promise<LifecycleAction[]> {
  const actions = runLifecycleCheck()
  log("review", `Review complete: ${actions.length} lifecycle actions`)
  return actions
}

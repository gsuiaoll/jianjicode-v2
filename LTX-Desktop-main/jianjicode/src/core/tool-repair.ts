/**
 * jianjicode Tool Arg Repair — LLM 驱动的工具参数自动修复
 *
 * 当工具调用因参数错误失败时，利用 LLM 分析错误信息并生成修复后的参数，
 * 实现自动化重执行，无需等待 AI 自我纠正。
 *
 * @license MIT
 */

import { generateText, stepCountIs } from "ai"
import { SimpleProvider } from "../../ai/provider/simple-provider.js"
import { PROMPTS } from "./prompts.js"
import { loadJudgeConfig } from "./skill-manager.js"

// ============================================================================
// 类型
// ============================================================================

export interface ToolRepairResult {
  /** 是否成功修复 */
  repaired: boolean
  /** 修复后的参数 */
  correctedArgs?: Record<string, unknown>
  /** 修改说明 */
  explanation?: string
}

// ============================================================================
// 快速过滤 — 避免不必要的 LLM 调用
// ============================================================================

/** 判断错误消息是否可能是参数错误 */
export function isLikelyArgError(msg: string): boolean {
  const lower = msg.toLowerCase()
  return (
    lower.includes("invalid args") ||
    lower.includes("invalid arguments") ||
    lower.includes("validation") ||
    lower.includes("required parameter") ||
    lower.includes("invalid input") ||
    lower.includes("not found") ||
    lower.includes("no such file") ||
    lower.includes("invalid path") ||
    lower.includes("invalid format") ||
    lower.includes("unsupported") ||
    lower.includes("must be") ||
    lower.includes("expected") ||
    lower.includes("should be") ||
    lower.includes("incorrect")
  )
}

// ============================================================================
// LLM 缓存
// ============================================================================

let _repairModel: any = null
let _repairModelFailed = false

async function getRepairModel(): Promise<any> {
  if (_repairModel) return _repairModel
  if (_repairModelFailed) return null

  try {
    const config = loadJudgeConfig()
    if (!config) {
      _repairModelFailed = true
      return null
    }
    const model = await SimpleProvider.getLanguage(
      { providerID: config.providerID as any, id: config.modelID },
      { apiKey: config.apiKey, baseURL: config.baseURL },
    )
    _repairModel = model
    return model
  } catch (err) {
    _repairModelFailed = true
    console.warn("[tool-repair] Failed to init judge model:", err)
    return null
  }
}

// ============================================================================
// 核心修复函数
// ============================================================================

/**
 * 使用 LLM 分析工具调用错误并修复参数。
 *
 * @param toolName 工具名称
 * @param originalArgs 原始参数
 * @param errorMessage 错误消息
 * @param toolDescription 工具描述（可选）
 * @param toolSchema 参数 Schema（可选）
 * @returns 修复结果
 */
export async function repairToolArgs(
  toolName: string,
  originalArgs: Record<string, unknown>,
  errorMessage: string,
  toolDescription?: string,
  toolSchema?: Record<string, unknown>,
): Promise<ToolRepairResult> {
  const model = await getRepairModel()
  if (!model) {
    return { repaired: false }
  }

  const prompt = PROMPTS.toolArgRepair
    .replace("{toolName}", toolName)
    .replace("{originalArgs}", JSON.stringify(originalArgs, null, 2))
    .replace("{errorMessage}", errorMessage)
    .replace(
      "{toolDescription}",
      toolDescription ? `【工具描述】\n${toolDescription}` : "【工具描述】\n无",
    )
    .replace(
      "{toolSchema}",
      toolSchema
        ? `【参数 Schema】\n${JSON.stringify(toolSchema, null, 2)}`
        : "【参数 Schema】\n无",
    )

  try {
    const result = await generateText({
      model,
      messages: [{ role: "user", content: prompt }],
      stopWhen: stepCountIs(1),
      temperature: 0.1,
    })

    const text = result.text || ""
    const parsed = parseRepairResponse(text)

    if (
      parsed &&
      parsed.correctedArgs &&
      typeof parsed.correctedArgs === "object"
    ) {
      // 验证修复后的参数不为空且与原始参数不同
      const keys = Object.keys(parsed.correctedArgs)
      if (keys.length > 0) {
        return {
          repaired: true,
          correctedArgs: parsed.correctedArgs,
          explanation: parsed.explanation || "",
        }
      }
    }

    return { repaired: false }
  } catch (err) {
    console.warn(`[tool-repair] LLM repair failed for ${toolName}:`, err)
    return { repaired: false }
  }
}

// ============================================================================
// 响应解析
// ============================================================================

/** 从 LLM 响应中提取并解析修复结果 JSON */
export function parseRepairResponse(
  text: string,
): { correctedArgs?: Record<string, unknown>; explanation?: string } | null {
  // 尝试直接解析（期望纯 JSON 响应）
  try {
    return JSON.parse(text)
  } catch {
    // 非纯 JSON，尝试从代码块或花括号中提取
  }

  // 尝试提取 JSON 代码块
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim())
    } catch {
      /* ignore */
    }
  }

  // 尝试提取顶层花括号对象
  const braceMatch = text.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0])
    } catch {
      /* ignore */
    }
  }

  return null
}

/**
 * 错误澄清和恢复机制
 *
 * 当 AI 无法理解用户指令或工具执行失败时，生成有用的澄清问题和恢复建议。
 * 支持以下场景：
 *   1. 意图不明确 → 生成澄清问题
 *   2. 参数缺失 → 列出需要补充的参数
 *   3. 工具失败 → 分析原因并建议替代方案
 *   4. 多意图冲突 → 帮助用户理清执行顺序
 */

import type { EditContext } from "./edit-context.js"
import type { IntentResult } from "./intent-mapper.js"

// ============================================================================
// 类型定义
// ============================================================================

export interface ClarificationQuestion {
  /** 问题 ID */
  id: string
  /** 问题文本 */
  question: string
  /** 选项（如果适用） */
  options?: string[]
  /** 问题类别 */
  category: "missing_param" | "ambiguous_intent" | "confirmation" | "suggestion"
  /** 相关参数名 */
  paramName?: string
}

export interface RecoverySuggestion {
  /** 建议描述 */
  message: string
  /** 替代工具 */
  alternativeTool?: string
  /** 是否需要用户确认 */
  requiresConfirmation: boolean
}

// ============================================================================
// 澄清问题生成
// ============================================================================

/**
 * 根据意图识别结果生成澄清问题。
 */
export function generateClarifications(
  intent: IntentResult,
  _editContext?: EditContext,
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = []

  if (intent.category === "unknown") {
    questions.push({
      id: "unknown_intent",
      question:
        "抱歉，我没有完全理解您的意思。请问您想对视频进行什么操作？例如：裁剪、加滤镜、添加字幕、调整速度等。",
      category: "ambiguous_intent",
    })
    return questions
  }

  // 低置信度 → 确认意图
  if (intent.confidence < 0.4) {
    questions.push({
      id: "low_confidence",
      question: `您是想进行"${categoryLabel(intent.category)}"操作吗？如果是，请提供更多细节。`,
      options: ["是，继续", "不是，我重新描述"],
      category: "confirmation",
    })
  }

  // 检查必要参数
  const paramQuestions = checkRequiredParams(intent)
  questions.push(...paramQuestions)

  return questions
}

// ============================================================================
// 参数检查
// ============================================================================

const REQUIRED_PARAMS: Record<string, string[]> = {
  trim: ["输入文件", "开始时间或结束时间"],
  concat: ["要合并的视频文件列表"],
  filter: ["输入文件", "滤镜类型"],
  subtitle: ["输入文件"],
  transition: ["输入文件", "转场类型"],
  speed: ["输入文件", "速度倍率"],
  pip: ["输入文件", "画中画文件"],
  watermark: ["输入文件", "水印内容或图片"],
  format: ["输入文件", "目标格式"],
  audio: ["输入文件", "音频处理类型"],
  mask: ["输入文件", "遮罩区域"],
  animation: ["输入文件", "动画效果描述"],
  crop: ["输入文件", "目标比例或区域"],
  style: ["输入文件", "目标风格"],
  frame: ["输入文件", "提取时间点"],
  batch: ["要处理的文件或文件夹"],
}

function checkRequiredParams(intent: IntentResult): ClarificationQuestion[] {
  const required = REQUIRED_PARAMS[intent.category]
  if (!required) return []

  const missing = required.filter((param) => {
    const extracted = intent.extractedParams
    switch (param) {
      case "输入文件":
        return !extracted.files
      case "开始时间或结束时间":
        return !extracted.times
      case "速度倍率":
        return !extracted.speed
      case "目标格式":
        return !extracted.files // 检查是否提到了格式后缀
      default:
        return false
    }
  })

  if (missing.length === 0) return []

  return [
    {
      id: "missing_params",
      question: `要进行${categoryLabel(intent.category)}操作，还需要以下信息：${missing.join("、")}。请补充。`,
      category: "missing_param",
    },
  ]
}

// ============================================================================
// 恢复建议
// ============================================================================

/**
 * 工具执行失败时，生成恢复建议。
 */
export function generateRecoverySuggestions(
  toolName: string,
  errorMessage: string,
  intent?: IntentResult,
): RecoverySuggestion[] {
  const suggestions: RecoverySuggestion[] = []

  // 通用错误分析
  if (errorMessage.includes("ENOENT") || errorMessage.includes("not found")) {
    suggestions.push({
      message: `文件未找到。请检查文件路径是否正确，确保文件存在且可访问。`,
      requiresConfirmation: true,
    })
  }

  if (errorMessage.includes("permission") || errorMessage.includes("denied")) {
    suggestions.push({
      message: `权限不足。请检查文件读写权限，或联系管理员。`,
      requiresConfirmation: true,
    })
  }

  if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
    suggestions.push({
      message: `操作超时。视频文件可能过大，建议先压缩或分段处理。`,
      requiresConfirmation: true,
    })
  }

  if (errorMessage.includes("invalid") || errorMessage.includes("validation")) {
    suggestions.push({
      message: `参数格式不正确。请检查输入参数是否符合工具要求。`,
      requiresConfirmation: true,
    })
  }

  // 基于 intent 建议替代工具
  if (intent && intent.fallbackTools.length > 0) {
    for (const alt of intent.fallbackTools) {
      if (alt !== toolName) {
        suggestions.push({
          message: `当前工具 ${toolName} 执行失败，可以尝试使用 ${alt} 实现类似功能。`,
          alternativeTool: alt,
          requiresConfirmation: true,
        })
      }
    }
  }

  // 没有具体建议时给出通用提示
  if (suggestions.length === 0) {
    suggestions.push({
      message: `工具 ${toolName} 执行时出现错误：${errorMessage}。请检查输入参数或尝试其他方法。`,
      requiresConfirmation: false,
    })
  }

  return suggestions
}

// ============================================================================
// 意图确认
// ============================================================================

/**
 * 当检测到多个可能意图时，生成确认请求。
 */
export function generateIntentConfirmation(
  candidates: IntentResult[],
): ClarificationQuestion | null {
  if (candidates.length < 2) return null

  const labels = candidates.map((c) => categoryLabel(c.category))
  const uniqueLabels = [...new Set(labels)]

  if (uniqueLabels.length < 2) return null

  return {
    id: "multiple_intents",
    question: `您的指令可能包含多个操作：${uniqueLabels.join("、")}。请问要按什么顺序执行？`,
    options: ["按提及顺序依次执行", "只执行第一个操作", "让我重新描述需求"],
    category: "confirmation",
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  trim: "裁剪视频片段",
  concat: "合并视频",
  filter: "色彩调整/滤镜",
  subtitle: "添加字幕",
  transition: "添加转场",
  effect: "添加特效",
  speed: "调整速度",
  stabilization: "视频稳定",
  pip: "画中画",
  watermark: "添加水印",
  mask: "遮罩处理",
  audio: "音频处理",
  music: "背景音乐",
  analysis: "视频分析",
  frame: "提取帧",
  animation: "关键帧动画",
  crop: "裁剪画面",
  style: "风格迁移",
  format: "格式转换",
  scene: "场景检测",
  batch: "批量处理",
  unknown: "未知操作",
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category
}

/**
 * Agent Loop 类型定义
 *
 * 从 agent-loop.ts 拆分，收敛所有 Agent Loop 相关的类型、接口和辅助函数。
 */

import type { LanguageModel } from "ai"
import type {
  CostEstimate,
  ModelConfig,
  TokenUsage,
} from "../../ai/provider/fallback-provider.js"
import type { EditMetadata } from "../types/edit-result.js"
import type { AiEditResult } from "./ai-stream.js"

// ============================================================================
// 流式事件类型
// ============================================================================

/**
 * Agent Loop 执行过程中的流式事件。
 * 调用方可通过 onStream 回调实时获取文本增量、工具调用状态等。
 */
export type StreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "text-start" }
  | { type: "text-end"; text: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-start"; toolName: string; args: unknown }
  | { type: "tool-end"; toolName: string; result: any }
  | { type: "tool-error"; toolName: string; error: string }
  | { type: "step-start"; step: number }
  | { type: "step-end"; step: number; finishReason: string; usage?: TokenUsage }
  | {
      type: "nudge"
      nudge: { type: string; message: string; [key: string]: unknown }
    }
  | { type: "error"; error: string }
  | {
      type: "permission-request"
      request: {
        id: string
        sessionID: string
        permission: string
        patterns: string[]
        toolID?: string
        metadata: Record<string, unknown>
        alwaysPatterns: string[]
      }
    }
  | {
      type: "intent-form-required"
      formId: string
      message: string
      options: Array<{
        id: string
        label: string
        description: string
      }>
      allowCustomInput?: boolean
      customInputPlaceholder?: string
    }

// ============================================================================
// Agent Loop 核心类型
// ============================================================================

export interface AgentStep {
  /** 第几步（从 1 开始） */
  stepNumber: number
  /** AI 的文本回复（如果有） */
  text: string
  /** 工具调用列表 */
  toolCalls: NonNullable<AiEditResult["toolCalls"]>
  /** finishReason */
  finishReason: string
}

export interface AgentLoopResult {
  /** 整体是否成功 */
  success: boolean
  /** 会话 ID */
  sessionId: string
  /** AI 最终文本回复（所有步骤合并） */
  aiText: string
  /** 所有步骤的详细记录 */
  steps: AgentStep[]
  /** 总共执行了几步 */
  totalSteps: number
  /** 是否因 maxSteps 终止 */
  stoppedByMaxSteps: boolean
  /** 是否被用户取消 */
  stoppedByAbort: boolean
  /** 最后一步的工具结果摘要（向后兼容） */
  title?: string
  output?: string
  operation?: string
  toolId?: string
  metadata?: EditMetadata
  /** 总 token 用量 */
  usage?: TokenUsage
  /** 成本估算 */
  cost?: CostEstimate
  /** fallback 元信息 */
  fallback?: {
    modelUsed: string
    providerUsed: string
    retryCount: number
    fellBack: boolean
  }
  /** 本次执行产生的 nudge 消息（技能建议、优化报告等） */
  nudges?: Array<{
    type: string
    message: string
    [key: string]: unknown
  }>
}

export interface AgentLoopOptions {
  /** AI LanguageModel */
  model: LanguageModel
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** 自定义 system prompt（默认自动构建） */
  system?: string
  /** 最大循环步数（默认 10） */
  maxSteps?: number
  /** 触发压缩的 token 阈值（默认 8000） */
  maxTokens?: number
  /** 上下文限制（模型 context window，默认 100000），用于溢出检测 */
  contextLimit?: number
  /** 溢出检测的保留缓冲区（默认 20000），预留输出 token 空间 */
  contextBuffer?: number
  /** Skill 自动创建模式（默认 "confirm"） */
  autoCreateSkill?: "always" | "confirm" | "off"
  /** 取消信号 */
  abortSignal?: AbortSignal
  /** 每一步的回调 */
  onStep?: (step: AgentStep) => void
  /** 流式事件回调（实时推送 text delta / tool call / tool result 等） */
  onStream?: (event: StreamEvent) => void
  /** provider 透传选项（temperature, thinking budget 等） */
  providerOptions?: any
  /** temperature */
  temperature?: number
  /** maxOutputTokens per response */
  maxOutputTokens?: number
  /** DashScope API Key（用于 OSS 视频上传，若不传则从环境变量/config 自动获取） */
  dashscopeApiKey?: string
  /** DashScope 模型名（用于 OSS 视频上传） */
  dashscopeModel?: string
  /**
   * Fallback 配置：主模型失败时的重试 + 备用模型切换。
   * 传递 ModelConfig[] 作为 fallback 链：
   *   [primary, backup1, backup2]
   * 第一个可用模型为主模型，后续为 fallback 链。
   */
  fallbackModels?: ModelConfig[]
  /** 每个模型的最大重试次数（默认 2） */
  maxRetries?: number
  /** 指数退避基础延迟毫秒数（默认 1000） */
  baseDelayMs?: number
  /** 编辑器上下文（前端透传的当前项目素材列表等） */
  editorContext?: {
    projectName?: string
    mediaFiles?: Array<{
      name: string
      path: string
      type: "video" | "audio" | "image"
      duration?: number
    }>
    selectedClips?: Array<{
      id: string
      type: string
      trackIndex: number
      startTime: number
      duration: number
      trimStart?: number
      trimEnd?: number
      speed?: number
      assetName: string
      assetPath: string
      assetType?: "video" | "audio" | "image"
    }>
    timelineClips?: Array<{
      id: string
      type: string
      trackIndex: number
      startTime: number
      duration: number
      assetName: string
      assetPath: string
      assetType?: "video" | "audio" | "image"
    }>
    currentTime?: number
    totalDuration?: number
  }
}

// ============================================================================
// 内部类型（GenerateText SDK 的中间表示）
// ============================================================================

export interface GenerateTextStep {
  text?: string
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    toolCallId: string
  }>
  toolResults?: Array<{
    toolCallId: string
    output: any
    isError?: boolean
  }>
  finishReason?: string
}

// ============================================================================
// 辅助函数
// ============================================================================

export function extractToolCalls(
  step: GenerateTextStep,
): AiEditResult["toolCalls"] {
  if (!step.toolCalls || step.toolCalls.length === 0) return []

  return step.toolCalls.map((call, i) => {
    const toolResult = step.toolResults?.find(
      (r) => r.toolCallId === call.toolCallId,
    )
    const resultData = toolResult?.output || {}
    return {
      toolName: call.toolName,
      args: call.args,
      result: {
        title: resultData.title || call.toolName,
        output:
          typeof resultData.output === "string"
            ? resultData.output
            : JSON.stringify(resultData),
        metadata: resultData.metadata || {},
      },
    }
  })
}

export function getLastToolResultData(steps: AgentStep[]): {
  title: string
  output: string
  operation: string
  toolId: string | undefined
  metadata: EditMetadata | undefined
} | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const toolCalls = steps[i].toolCalls
    if (toolCalls && toolCalls.length > 0) {
      const last = toolCalls[toolCalls.length - 1]
      const metadata: EditMetadata = {
        ...(last.result.metadata || {}),
        success: last.result.metadata?.error !== true,
        error: last.result.metadata?.error === true,
      }
      return {
        title: last.result.title,
        output: last.result.output,
        operation: (last.result.metadata?.operation as string) || last.toolName,
        toolId: last.toolName,
        metadata,
      }
    }
  }
  return null
}

/**
 * Agent Loop — Step Runner
 *
 * 从 agent-loop.ts 拆分，负责执行单次 AI 步骤：
 * - runStreamStep: 一次 streamText 调用，处理 fullStream 事件
 * - executeStep: runStreamStep + 重试 + 断路器 + fallback 模型切换
 *
 * 不包含：while(true) 循环编排、上下文压缩、后处理 hooks。
 */

import type { LanguageModel, ToolSet } from "ai"
import { stepCountIs, streamText } from "ai"
import type { TokenUsage } from "../../ai/provider/fallback-provider.js"
import { FallbackProvider } from "../../ai/provider/fallback-provider.js"
import { getCircuitBreaker } from "./circuit-breaker.js"
import { classifyErrorDetailed } from "./error-classifier.js"
import type { GenerateTextStep, StreamEvent } from "./agent-types.js"

// ============================================================================
// runStreamStep — 一次 streamText（含 fullStream 事件 -> onStream 回调）
// ============================================================================

export interface StreamStepResult {
  step: GenerateTextStep
  usage?: TokenUsage
}

/**
 * 执行一次 streamText，通过 fullStream 逐事件处理。
 * 每次只允许 AI SDK 执行 1 步（stepCountIs(1)），不自动循环。
 */
export async function runStreamStep(
  model: LanguageModel,
  systemPrompt: string,
  tools: ToolSet,
  history: any[],
  opts: {
    onStream?: (event: StreamEvent) => void
    temperature?: number
    maxOutputTokens?: number
    providerOptions?: any
    toolChoice?: "auto" | "required" | "none"
  },
  stepNumber: number,
): Promise<StreamStepResult> {
  const textChunks: string[] = []
  const toolCalls: any[] = []
  const toolResults: any[] = []
  let finishReason = ""
  let finalUsage: TokenUsage | undefined

  opts.onStream?.({ type: "step-start", step: stepNumber })

  const result = await streamText({
    model,
    system: systemPrompt,
    messages: history as any,
    tools,
    stopWhen: stepCountIs(1),
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    providerOptions: opts.providerOptions,
    toolChoice: opts.toolChoice,
  })

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "text-delta":
        textChunks.push(event.text)
        opts.onStream?.({ type: "text-delta", delta: event.text })
        break
      case "text-start":
        opts.onStream?.({ type: "text-start" })
        break
      case "text-end":
        opts.onStream?.({ type: "text-end", text: textChunks.join("") })
        break
      case "reasoning-delta":
        opts.onStream?.({ type: "reasoning-delta", delta: event.text })
        break
      case "tool-call":
        toolCalls.push(event)
        opts.onStream?.({
          type: "tool-start",
          toolName: event.toolName,
          args: event.input,
        })
        break
      case "tool-result":
        toolResults.push(event)
        opts.onStream?.({
          type: "tool-end",
          toolName: event.toolName,
          result: event.output,
        })
        break
      case "tool-error":
        opts.onStream?.({
          type: "tool-error",
          toolName: event.toolName,
          error: String(event.error),
        })
        break
      case "finish-step":
        finishReason = event.finishReason
        if (event.usage) {
          finalUsage = {
            promptTokens: event.usage.inputTokens || 0,
            completionTokens: event.usage.outputTokens || 0,
            totalTokens:
              (event.usage.inputTokens || 0) + (event.usage.outputTokens || 0),
          }
        }
        break
      case "error":
        throw event.error
    }
  }

  const step: GenerateTextStep = {
    text: textChunks.join(""),
    toolCalls: toolCalls.map((tc: any) => ({
      toolName: tc.toolName,
      args: tc.input,
      toolCallId: tc.toolCallId,
    })),
    toolResults: toolResults.map((tr: any) => ({
      toolCallId: tr.toolCallId,
      output: tr.output,
    })),
    finishReason,
  }

  opts.onStream?.({
    type: "step-end",
    step: stepNumber,
    finishReason,
    usage: finalUsage,
  })

  return { step, usage: finalUsage }
}

// ============================================================================
// Fallback 状态
// ============================================================================

export interface FallbackState {
  currentModel: LanguageModel
  currentModelId: string
  currentProviderId: string
  modelIndex: number
  retryCount: number
  fellBack: boolean
}

export function createFallbackState(
  initialModel: LanguageModel,
): FallbackState {
  return {
    currentModel: initialModel,
    currentModelId: "unknown",
    currentProviderId: "unknown",
    modelIndex: -1,
    retryCount: 0,
    fellBack: false,
  }
}

interface FallbackModelConfig {
  fallbackModels: NonNullable<import("./agent-types.js").AgentLoopOptions["fallbackModels"]>
  maxRetries: number
  baseDelayMs: number
}

/**
 * 创建带 fallback 的 executeStep 函数。
 * 返回闭包，捕获 fallbackModels / maxRetries / baseDelayMs 配置。
 */
export function createExecuteStep(
  fallbackConfig: FallbackModelConfig,
  runConfig: {
    systemPrompt: string
    tools: ToolSet
    onStream?: (event: StreamEvent) => void
    temperature?: number
    maxOutputTokens?: number
    providerOptions?: any
    toolChoice?: "auto" | "required" | "none"
  },
  state: FallbackState,
) {
  const { fallbackModels, maxRetries, baseDelayMs } = fallbackConfig
  let backupModelCache: LanguageModel | null = null

  async function getBackupModel(): Promise<LanguageModel | null> {
    if (backupModelCache) return backupModelCache
    const idx = state.modelIndex + 1
    if (idx >= fallbackModels.length) return null
    try {
      const cfg = fallbackModels[idx]
      const lm = await FallbackProvider.createModel(cfg)
      state.currentModelId = cfg.modelID
      state.currentProviderId = cfg.providerID
      state.modelIndex = idx
      state.fellBack = true
      backupModelCache = lm
      return lm
    } catch {
      return null
    }
  }

  async function switchToFallbackModel(): Promise<boolean> {
    backupModelCache = null
    const next = await getBackupModel()
    if (!next) return false
    state.currentModel = next
    return true
  }

  /**
   * 执行一次 AI 步骤（streamText + 重试 + fallback + 断路器）。
   * 返回 { step, usage, classification }。
   */
  return async function executeStep(
    history: any[],
    stepNumber: number,
    perStepToolChoice?: "auto" | "required" | "none",
  ): Promise<StreamStepResult & {
    classification?: ReturnType<typeof classifyErrorDetailed>
  }> {
    const toolChoice = perStepToolChoice ?? runConfig.toolChoice
    const lastError: Error[] = []
    const breaker = getCircuitBreaker(`model:${state.currentModelId}`, {
      failureThreshold: 5,
      timeout: 30_000,
      halfOpenMaxRequests: 1,
    })

    // 断路器 OPEN → 跳过重试，直接尝试 fallback 模型
    if (breaker.getState() === "OPEN") {
      if (fallbackModels.length > 0) {
        const switched = await switchToFallbackModel()
        if (switched) {
          try {
            const result = await runStreamStep(
              state.currentModel,
              runConfig.systemPrompt,
              runConfig.tools,
              history,
              {
                onStream: runConfig.onStream,
                temperature: runConfig.temperature,
                maxOutputTokens: runConfig.maxOutputTokens,
                providerOptions: runConfig.providerOptions,
                toolChoice,
              },
              stepNumber,
            )
            breaker.reset()
            return result
          } catch (fallbackError: any) {
            lastError.push(fallbackError)
          }
        }
      }
      throw new Error(
        `Circuit "${breaker.name}" open and no fallback available`,
      )
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = FallbackProvider.backoffDelay(attempt - 1, baseDelayMs)
        await FallbackProvider.sleep(delay)
        state.retryCount++
      }

      try {
        const result = await runStreamStep(
          state.currentModel,
          runConfig.systemPrompt,
          runConfig.tools,
          history,
          {
            onStream: runConfig.onStream,
            temperature: runConfig.temperature,
            maxOutputTokens: runConfig.maxOutputTokens,
            providerOptions: runConfig.providerOptions,
            toolChoice,
          },
          stepNumber,
        )
        breaker.recordSuccess()
        return result
      } catch (error: any) {
        lastError.push(error)
        const classification = classifyErrorDetailed(error)
        breaker.recordFailure(error)
        if (!classification.retryable) break
      }
    }

    // 本模型重试耗尽 → 尝试 fallback 模型
    if (fallbackModels.length > 0) {
      const switched = await switchToFallbackModel()
      if (switched) {
        try {
          const result = await runStreamStep(
            state.currentModel,
            runConfig.systemPrompt,
            runConfig.tools,
            history,
            {
              onStream: runConfig.onStream,
              temperature: runConfig.temperature,
              maxOutputTokens: runConfig.maxOutputTokens,
              providerOptions: runConfig.providerOptions,
              toolChoice,
            },
            stepNumber,
          )
          breaker.reset()
          return result
        } catch (fallbackError: any) {
          lastError.push(fallbackError)
        }
      }
    }

    const msg = lastError.map((e) => e.message).join("; ")
    throw Object.assign(
      new Error(`All models failed after ${state.retryCount} retries: ${msg}`),
      { classification: classifyErrorDetailed(lastError[lastError.length - 1]) },
    )
  }
}

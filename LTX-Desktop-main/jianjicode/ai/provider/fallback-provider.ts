/**
 * jianjicode Fallback Provider
 *
 * 模型 fallback 链 + 指数退避重试 + 成本估算。
 *
 * 使用：
 *   const model = await FallbackProvider.createModel(primaryConfig)
 *   const cost = FallbackProvider.estimateCost(usage, "gpt-4o")
 */

import type { LanguageModel } from "ai"
import { SimpleProvider } from "./simple-provider.js"

// ============================================================================
// 类型
// ============================================================================

export interface ModelConfig {
  providerID: string
  modelID: string
  apiKey?: string
  baseURL?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CostEstimate {
  inputCost: number
  outputCost: number
  totalCost: number
  currency: "USD"
  modelId: string
}

export interface FallbackConfig {
  /** 主模型配置 */
  primary: ModelConfig
  /** 备用模型配置（主模型重试耗尽后切换） */
  backup?: ModelConfig
  /** 每个模型的最大重试次数（默认 2） */
  maxRetries?: number
  /** 指数退避基础延迟毫秒数（默认 1000） */
  baseDelayMs?: number
}

export interface FallbackMetadata {
  /** 实际使用的模型 ID */
  modelUsed: string
  /** 实际使用的 provider */
  providerUsed: string
  /** 总重试次数 */
  retryCount: number
  /** 是否触发了备用模型 */
  fellBack: boolean
}

// ============================================================================
// 模型定价（每 1M token，USD）
// ============================================================================

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },

  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },

  // Anthropic
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku": { input: 0.8, output: 4.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
  "claude-3-opus": { input: 15.0, output: 75.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },

  // Google
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.0-pro": { input: 2.0, output: 10.0 },
  "gemini-1.5-pro": { input: 1.25, output: 5.0 },

  // Qwen / Alibaba
  "qwen-max": { input: 2.0, output: 8.0 },
  "qwen-turbo": { input: 0.3, output: 0.6 },
  "qwen-plus": { input: 0.8, output: 2.0 },
  "qwen3.6-plus": { input: 2.0, output: 8.0 },

  // Other
  "mixtral-8x7b": { input: 0.5, output: 1.5 },
  "llama-3-70b": { input: 0.9, output: 2.5 },
}

// ============================================================================
// FallbackProvider
// ============================================================================

export class FallbackProvider {
  /**
   * 创建 LanguageModel（委托 SimpleProvider，无 fallback）。
   * 当不需要 fallback 逻辑时可直接用此方法。
   */
  static async createModel(config: ModelConfig): Promise<LanguageModel> {
    return SimpleProvider.getLanguage(
      // biome-ignore lint/suspicious/noExplicitAny: 待后续使用具体 ProviderID 类型
      { providerID: config.providerID as any, id: config.modelID },
      { apiKey: config.apiKey, baseURL: config.baseURL },
    )
  }

  /**
   * 等待指定毫秒数（用于指数退避）。
   */
  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 估算一次调用的成本。
   *
   * @param usage  token 用量
   * @param modelId  模型 ID（用于查定价表）
   * @returns      成本估算（USD）
   */
  static estimateCost(usage: TokenUsage, modelId: string): CostEstimate {
    const pricing = MODEL_PRICING[modelId] || { input: 1.0, output: 4.0 }
    const inputCost = (usage.promptTokens / 1_000_000) * pricing.input
    const outputCost = (usage.completionTokens / 1_000_000) * pricing.output
    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: "USD",
      modelId,
    }
  }

  /**
   * 判断错误是否为可重试的临时错误。
   */
  static isRetryableError(error: unknown): boolean {
    const message = (error as Error)?.message?.toLowerCase() || ""
    const retryablePatterns = [
      "rate limit",
      "rate_limit",
      "too many requests",
      "429",
      "503",
      "502",
      "504",
      "timeout",
      "abort",
      "internal server error",
      "service unavailable",
      "overloaded",
      "try again",
      "temporary",
    ]
    return retryablePatterns.some((p) => message.includes(p))
  }

  /**
   * 计算指数退避延迟。
   *
   * @param attempt  当前重试次数（从 0 开始）
   * @param baseDelayMs  基础延迟
   * @returns        带抖动的延迟毫秒数
   */
  static backoffDelay(attempt: number, baseDelayMs = 1000): number {
    const delay = baseDelayMs * 2 ** attempt
    // 添加 ±25% 抖动，避免 thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1)
    return Math.round(delay + jitter)
  }
}

export { SimpleProvider } from "./simple-provider.js"

/**
 * 阿里通义 (Ali Tongyi) 适配器
 * 支持通义千问系列模型，OpenAI兼容API
 */

import type { AIProviderConfig } from "../types/index.js"
import { OpenAICompatibleProvider } from "./openai.js"

export class AliTongyiProvider extends OpenAICompatibleProvider {
  readonly id = "ali-tongyi"
  readonly name = "阿里通义 (Qwen)"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      provider: "ali-tongyi",
      defaultModel: config.defaultModel || "qwen-max",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    // 阿里通义API端点
    const tongyiConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1/",
      defaultModel: config.defaultModel || "qwen-max",
    }

    await super.initialize(tongyiConfig)
  }

  protected getDefaultModel(): string {
    return "qwen-max"
  }

  protected requiresAPIKey(): boolean {
    return true
  }
}

/**
 * Qwen-Turbo适配器（轻量版）
 */
export class QwenTurboProvider extends AliTongyiProvider {
  // @ts-expect-error - Override with different value
  readonly id = "qwen-turbo"
  // @ts-expect-error - Override with different value
  readonly name = "Qwen-Turbo"
  // @ts-expect-error - Override with different value
  readonly supportsMultimodal = false
  // @ts-expect-error - Override with different value
  readonly maxImageSize = 0

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      defaultModel: "qwen-turbo",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    const qwenConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1/",
      defaultModel: "qwen-turbo",
    }

    await super.initialize(qwenConfig)
  }
}

/**
 * Qwen-Plus适配器（增强版）
 */
export class QwenPlusProvider extends AliTongyiProvider {
  // @ts-expect-error - Override with different value
  readonly id = "qwen-plus"
  // @ts-expect-error - Override with different value
  readonly name = "Qwen-Plus"
  // @ts-expect-error - Override with different value
  readonly supportsMultimodal = true
  // @ts-expect-error - Override with different value
  readonly maxImageSize = 2048

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      defaultModel: "qwen-plus",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    const qwenConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1/",
      defaultModel: "qwen-plus",
    }

    await super.initialize(qwenConfig)
  }
}

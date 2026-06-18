/**
 * 智谱AI (ZhiPu AI) 适配器
 * 支持GLM系列模型，OpenAI兼容API
 */

import type { AIProviderConfig } from "../types/index.js"
import { OpenAICompatibleProvider } from "./openai.js"

export class ZhiPuAIProvider extends OpenAICompatibleProvider {
  readonly id = "zhipuai"
  readonly name = "智谱AI (GLM)"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      provider: "zhipuai",
      defaultModel: config.defaultModel || "glm-4",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    // 确保使用智谱AI的API端点
    const zhipuConfig = {
      ...config,
      apiBaseUrl: config.apiBaseUrl || "https://open.bigmodel.cn/api/paas/v4/",
      defaultModel: config.defaultModel || "glm-4",
    }

    await super.initialize(zhipuConfig)
  }

  protected getDefaultModel(): string {
    return "glm-4"
  }

  protected requiresAPIKey(): boolean {
    return true
  }
}

/**
 * GLM-3-Turbo适配器（轻量版）
 */
export class GLM3TurboProvider extends ZhiPuAIProvider {
  // @ts-expect-error - Override with different value
  readonly id = "glm-3-turbo"
  // @ts-expect-error - Override with different value
  readonly name = "GLM-3-Turbo"
  // @ts-expect-error - Override with different value
  readonly supportsMultimodal = false // GLM-3-Turbo可能不支持多模态
  // @ts-expect-error - Override with different value
  readonly maxImageSize = 0

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      defaultModel: "glm-3-turbo",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    const glmConfig = {
      ...config,
      apiBaseUrl: config.apiBaseUrl || "https://open.bigmodel.cn/api/paas/v4/",
      defaultModel: "glm-3-turbo",
    }

    await super.initialize(glmConfig)
  }
}

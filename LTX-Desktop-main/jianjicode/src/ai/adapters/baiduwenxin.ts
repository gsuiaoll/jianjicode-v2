/**
 * 百度文心 (Baidu ERNIE) 适配器
 * 支持ERNIE系列模型，OpenAI兼容API
 */

import type { AIProviderConfig } from "../types/index.js"
import { OpenAICompatibleProvider } from "./openai.js"

export class BaiduErnieProvider extends OpenAICompatibleProvider {
  readonly id = "baidu-ernie"
  readonly name = "百度文心 (ERNIE)"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      provider: "baidu-ernie",
      defaultModel: config.defaultModel || "ernie-4.0",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    // 百度文心API端点
    const ernieConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/",
      defaultModel: config.defaultModel || "ernie-4.0",
    }

    await super.initialize(ernieConfig)
  }

  protected getDefaultModel(): string {
    return "ernie-4.0"
  }

  protected requiresAPIKey(): boolean {
    return true
  }
}

/**
 * ERNIE-3.5适配器（轻量版）
 */
export class Ernie35Provider extends BaiduErnieProvider {
  // @ts-expect-error - Override with different value
  readonly id = "ernie-3.5"
  // @ts-expect-error - Override with different value
  readonly name = "ERNIE-3.5"
  // @ts-expect-error - Override with different value
  readonly supportsMultimodal = false
  // @ts-expect-error - Override with different value
  readonly maxImageSize = 0

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      defaultModel: "ernie-3.5",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    const ernieConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/",
      defaultModel: "ernie-3.5",
    }

    await super.initialize(ernieConfig)
  }
}

/**
 * ERNIE-Speed适配器（高速版）
 */
export class ErnieSpeedProvider extends BaiduErnieProvider {
  // @ts-expect-error - Override with different value
  readonly id = "ernie-speed"
  // @ts-expect-error - Override with different value
  readonly name = "ERNIE-Speed"
  // @ts-expect-error - Override with different value
  readonly supportsMultimodal = true
  // @ts-expect-error - Override with different value
  readonly maxImageSize = 1024

  constructor(config: AIProviderConfig) {
    super({
      ...config,
      defaultModel: "ernie-speed",
    })
  }

  async initialize(config: AIProviderConfig): Promise<void> {
    const ernieConfig = {
      ...config,
      apiBaseUrl:
        config.apiBaseUrl ||
        "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/",
      defaultModel: "ernie-speed",
    }

    await super.initialize(ernieConfig)
  }
}

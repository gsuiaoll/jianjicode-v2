/**
 * OpenAI兼容适配器
 * 支持OpenAI API兼容的提供商：DeepSeek、OpenAI、Azure OpenAI等
 */

import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText } from "ai"
import { BaseAIProvider } from "../providers/base.js"
import type { AIAnalysisRequest, AIAnalysisResponse } from "../types/index.js"

export class OpenAICompatibleProvider extends BaseAIProvider {
  readonly id = "openai-compatible" as string
  readonly name = "OpenAI兼容提供商" as string
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048 // OpenAI支持较大图像

  private languageModel: any
  private modelFactory: any
  private defaultModelId: string = "gpt-4-turbo"

  constructor(config: any) {
    super(config)
  }

  protected requiresAPIKey(): boolean {
    return true
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config)

    // 设置默认模型ID
    this.defaultModelId = this.config.defaultModel || this.getDefaultModel()

    // 创建模型工厂
    if (this.config.apiBaseUrl) {
      // 自定义兼容端点（如DeepSeek）
      this.modelFactory = createOpenAICompatible({
        name: this.config.provider || "custom",
        baseURL: this.config.apiBaseUrl,
        apiKey: this.config.apiKey,
        headers: {
          "Content-Type": "application/json",
        },
      })
    } else {
      // 标准OpenAI
      this.modelFactory = createOpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.apiBaseUrl,
      })
    }

    // 为默认模型创建语言模型
    this.languageModel = this.modelFactory(this.defaultModelId)
  }

  protected getDefaultModel(): string {
    // 根据提供商选择默认模型
    if (this.config.apiBaseUrl?.includes("deepseek")) {
      return "deepseek-chat"
    } else if (this.config.apiBaseUrl?.includes("openrouter")) {
      return "openrouter/auto"
    } else {
      return "gpt-4-turbo"
    }
  }

  protected async performAnalysis(
    request: AIAnalysisRequest,
  ): Promise<AIAnalysisResponse> {
    try {
      // 准备消息
      const messages = this.prepareMessages(request)

      // 准备模型
      const modelId = request.model || this.defaultModelId

      // 获取或创建语言模型
      let languageModel = this.languageModel
      if (modelId !== this.defaultModelId) {
        // 使用工厂创建指定模型的语言模型
        languageModel = this.modelFactory(modelId)
      }

      // 生成文本
      const { text, usage } = await generateText({
        model: languageModel,
        messages,
        system: request.systemPrompt,
        // @ts-expect-error
        maxTokens: request.maxTokens || 128000,
        temperature: request.temperature || 0.7,
      })

      return {
        success: true,
        result: text,
        analysis: {},
        confidence: 0.9,
        metadata: {
          model: modelId,
          provider: this.id,
          usage: usage,
        },
        provider: this.id,
        model: modelId,
        tokensUsed: usage?.totalTokens || 0,
      }
    } catch (error: any) {
      throw new Error(`OpenAI兼容API错误: ${error.message}`)
    }
  }

  private prepareMessages(request: AIAnalysisRequest): any[] {
    const messages: any[] = []
    let currentTextContent = ""

    // 处理所有内容
    for (const content of request.contents) {
      if (content.type === "text") {
        // 合并文本内容
        if (currentTextContent) {
          currentTextContent += "\n\n"
        }
        currentTextContent += content.data
      } else if (content.type === "image") {
        // 如果有累积的文本，先添加文本消息
        if (currentTextContent) {
          messages.push({ role: "user", content: currentTextContent })
          currentTextContent = ""
        }

        // 添加图像消息
        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: content.description || "图像内容",
            },
            {
              type: "image",
              image: this.processImageData(content.data, content.mimeType),
            },
          ],
        })
      } else if (content.type === "video_frame") {
        // 视频帧作为图像处理
        if (currentTextContent) {
          messages.push({ role: "user", content: currentTextContent })
          currentTextContent = ""
        }

        messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: content.description || "视频帧",
            },
            {
              type: "image",
              image: this.processImageData(
                content.data,
                content.mimeType || "image/jpeg",
              ),
            },
          ],
        })
      }
    }

    // 添加剩余的文本内容
    if (currentTextContent) {
      messages.push({ role: "user", content: currentTextContent })
    }

    return messages
  }

  private processImageData(data: string, mimeType?: string): string {
    // 处理base64图像数据
    // 移除data URL前缀（如果有）
    if (data.startsWith("data:")) {
      const parts = data.split(",")
      if (parts.length > 1) {
        return parts[1] // 返回纯base64数据
      }
    }
    return data
  }

  // 重写健康检查方法
  async healthCheck(): Promise<boolean> {
    try {
      // 尝试简单的文本生成
      const testResponse = await this.generateText(
        '测试连接，请回复"OK"',
        "系统健康检查",
        10,
      )
      return testResponse.includes("OK") || testResponse.length > 0
    } catch (error) {
      console.error("OpenAI提供商健康检查失败:", error)
      return false
    }
  }
}

/**
 * DeepSeek专用适配器（OpenAI兼容）
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  readonly id = "deepseek"
  readonly name = "DeepSeek AI"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048

  constructor(config: any) {
    super({
      ...config,
      provider: "deepseek",
      defaultModel: "deepseek-chat",
    })
  }

  async initialize(config: any): Promise<void> {
    // 确保使用DeepSeek的API端点
    const deepseekConfig = {
      ...config,
      apiBaseUrl: config.apiBaseUrl || "https://api.deepseek.com",
      defaultModel: config.defaultModel || "deepseek-chat",
    }

    await super.initialize(deepseekConfig)
  }

  protected getDefaultModel(): string {
    return "deepseek-chat"
  }
}

/**
 * Azure OpenAI适配器
 */
export class AzureOpenAIProvider extends OpenAICompatibleProvider {
  readonly id = "azure-openai"
  readonly name = "Azure OpenAI"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048

  constructor(config: any) {
    super(config)
  }

  async initialize(config: any): Promise<void> {
    // Azure OpenAI需要特定的配置
    if (!config.apiBaseUrl || !config.apiKey) {
      throw new Error("Azure OpenAI需要apiBaseUrl和apiKey")
    }

    await super.initialize({
      ...config,
      provider: "azure-openai",
    })
  }
}

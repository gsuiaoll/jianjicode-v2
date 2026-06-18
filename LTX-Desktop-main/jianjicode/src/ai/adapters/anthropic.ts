/**
 * Anthropic适配器（Claude）
 */

import { anthropic } from "@ai-sdk/anthropic"
import { generateText } from "ai"
import { BaseAIProvider } from "../providers/base.js"
import type { AIAnalysisRequest, AIAnalysisResponse } from "../types/index.js"

export class AnthropicProvider extends BaseAIProvider {
  readonly id = "anthropic"
  readonly name = "Anthropic (Claude)"
  readonly supportsMultimodal = true
  readonly maxImageSize = 2048 // Claude支持图像

  private client: any
  private model: string = "claude-3-5-sonnet-20241022"

  constructor(config: any) {
    super(config)
  }

  protected requiresAPIKey(): boolean {
    return true
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config)

    // 使用Anthropic AI SDK
    this.client = anthropic

    // 设置默认模型
    this.model = this.config.defaultModel || this.getDefaultModel()
  }

  private getDefaultModel(): string {
    // Anthropic模型选择
    if (this.config.defaultModel) {
      return this.config.defaultModel
    }

    // 根据功能选择最佳模型
    return "claude-3-5-sonnet-20241022" // 最新Sonnet模型
  }

  protected async performAnalysis(
    request: AIAnalysisRequest,
  ): Promise<AIAnalysisResponse> {
    try {
      // 准备消息（Claude格式）
      const messages = this.prepareClaudeMessages(request)

      // 准备模型
      const modelName = request.model || this.model

      // 生成文本
      const { text, usage } = await generateText({
        model: this.client(modelName),
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
          model: modelName,
          provider: this.id,
          usage: usage,
        },
        provider: this.id,
        model: modelName,
        tokensUsed: usage?.totalTokens || 0,
      }
    } catch (error: any) {
      throw new Error(`Anthropic API错误: ${error.message}`)
    }
  }

  private prepareClaudeMessages(request: AIAnalysisRequest): any[] {
    const messages: any[] = []
    let currentContent: any[] = []

    // 处理所有内容
    for (const content of request.contents) {
      if (content.type === "text") {
        currentContent.push({
          type: "text",
          text: content.data,
        })
      } else if (content.type === "image") {
        // 如果有文本内容，先添加文本
        if (currentContent.length > 0) {
          messages.push({
            role: "user",
            content: currentContent,
          })
          currentContent = []
        }

        // 添加图像消息
        messages.push({
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: content.mimeType || "image/jpeg",
                data: this.processImageData(content.data),
              },
            },
            {
              type: "text",
              text: content.description || "请分析此图像",
            },
          ],
        })
      } else if (content.type === "video_frame") {
        // 视频帧作为图像处理
        if (currentContent.length > 0) {
          messages.push({
            role: "user",
            content: currentContent,
          })
          currentContent = []
        }

        messages.push({
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: content.mimeType || "image/jpeg",
                data: this.processImageData(content.data),
              },
            },
            {
              type: "text",
              text: content.description || "视频帧分析",
            },
          ],
        })
      }
    }

    // 添加剩余的文本内容
    if (currentContent.length > 0) {
      messages.push({
        role: "user",
        content: currentContent,
      })
    }

    return messages
  }

  private processImageData(data: string): string {
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
      console.error("Anthropic提供商健康检查失败:", error)
      return false
    }
  }
}

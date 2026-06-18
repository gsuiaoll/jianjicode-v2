/**
 * Google AI适配器（Gemini等）
 */

import { google } from "@ai-sdk/google"
import { generateText } from "ai"
import { BaseAIProvider } from "../providers/base.js"
import type { AIAnalysisRequest, AIAnalysisResponse } from "../types/index.js"

export class GoogleProvider extends BaseAIProvider {
  readonly id = "google"
  readonly name = "Google AI (Gemini)"
  readonly supportsMultimodal = true
  readonly maxImageSize = 3072 // Gemini支持高分辨率图像

  private client: any
  private model: string = "gemini-2.0-flash"

  constructor(config: any) {
    super(config)
  }

  protected requiresAPIKey(): boolean {
    return true
  }

  async initialize(config: any): Promise<void> {
    await super.initialize(config)

    // 使用Google AI SDK
    this.client = google

    // 设置默认模型
    this.model = this.config.defaultModel || this.getDefaultModel()
  }

  private getDefaultModel(): string {
    // Google Gemini模型选择
    if (this.config.defaultModel) {
      return this.config.defaultModel
    }

    // 根据功能选择最佳模型
    return "gemini-2.0-flash" // 平衡速度和能力
  }

  protected async performAnalysis(
    request: AIAnalysisRequest,
  ): Promise<AIAnalysisResponse> {
    try {
      // 准备消息（Gemini格式）
      const messages = this.prepareGeminiMessages(request)

      // 准备模型
      const modelName = request.model || this.model

      // 生成文本
      const { text, usage } = await generateText({
        model: this.client(modelName, {
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE",
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE",
            },
          ],
        }),
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
      throw new Error(`Google AI API错误: ${error.message}`)
    }
  }

  private prepareGeminiMessages(request: AIAnalysisRequest): any[] {
    const messages: any[] = []
    let currentParts: any[] = []

    // 添加系统提示（如果有）
    if (request.systemPrompt) {
      messages.push({
        role: "user",
        content: request.systemPrompt,
      })
      messages.push({
        role: "model",
        content: "好的，我理解了。请提供具体内容进行分析。",
      })
    }

    // 处理所有内容
    for (const content of request.contents) {
      if (content.type === "text") {
        currentParts.push({
          type: "text",
          text: content.data,
        })
      } else if (content.type === "image") {
        // 添加描述文本（如果有）
        if (content.description) {
          currentParts.push({
            type: "text",
            text: content.description,
          })
        }

        // 添加图像
        currentParts.push({
          type: "image",
          image: this.processImageData(content.data, content.mimeType),
        })
      } else if (content.type === "video_frame") {
        // 视频帧作为图像处理
        if (content.description) {
          currentParts.push({
            type: "text",
            text: content.description,
          })
        }

        currentParts.push({
          type: "image",
          image: this.processImageData(
            content.data,
            content.mimeType || "image/jpeg",
          ),
        })
      }

      // 如果parts太多，分批发送
      if (currentParts.length >= 10) {
        messages.push({
          role: "user",
          content: currentParts,
        })
        currentParts = []
      }
    }

    // 添加剩余的部分
    if (currentParts.length > 0) {
      messages.push({
        role: "user",
        content: currentParts,
      })
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
      console.error("Google提供商健康检查失败:", error)
      return false
    }
  }

  // 重写场景过渡建议以使用Gemini特定格式
  async suggestSceneTransition(
    beforeFrame?: string,
    afterFrame?: string,
    beforePrompt?: string,
    afterPrompt?: string,
    gapDuration: number = 5,
    mode: string = "t2v",
    inputImage?: string,
  ): Promise<string> {
    // 使用与LTX相同的系统提示
    const isImageGen = mode === "text-to-image" || mode === "t2i"
    const isImageToVideo = mode === "image-to-video" || mode === "i2v"

    const systemText =
      "You are a video production assistant. The user is editing a video timeline and has a gap " +
      `of ${gapDuration.toFixed(1)} seconds between two shots. Your job is to suggest a detailed prompt ` +
      `for generating ${isImageGen ? "an image" : "a video clip"} to fill this gap, so that it flows naturally between the ` +
      "preceding and following shots.\n\n" +
      "Guidelines:\n" +
      `- Describe the scene, ${isImageGen ? "composition" : "action, camera movement"}, lighting, and mood\n` +
      "- Match the visual style and tone of the surrounding shots\n" +
      "- Create a smooth narrative or visual transition between the two shots\n" +
      "- Keep the prompt concise (2-4 sentences max)\n" +
      "- Write only the prompt text, no explanations or labels\n" +
      "- If only one neighboring shot is available, suggest something that naturally leads into or out of it\n"

    const request: AIAnalysisRequest = {
      operation: "scene_transition_suggestion",
      contents: [],
      systemPrompt: systemText,
      parameters: {
        gapDuration,
        mode,
        generationType: isImageGen ? "image" : "video",
      },
    }

    // 添加文本内容
    if (beforePrompt) {
      request.contents.push({
        type: "text",
        data: `SHOT BEFORE THE GAP:\nPrompt: ${beforePrompt}`,
      })
    }

    if (afterPrompt) {
      request.contents.push({
        type: "text",
        data: `SHOT AFTER THE GAP:\nPrompt: ${afterPrompt}`,
      })
    }

    // 添加图像内容
    if (beforeFrame) {
      request.contents.push({
        type: "image",
        data: beforeFrame,
        mimeType: "image/jpeg",
        description: "Last frame of the shot BEFORE the gap:",
      })
    }

    if (afterFrame) {
      request.contents.push({
        type: "image",
        data: afterFrame,
        mimeType: "image/jpeg",
        description: "First frame of the shot AFTER the gap:",
      })
    }

    if (inputImage) {
      request.contents.push({
        type: "image",
        data: inputImage,
        mimeType: "image/jpeg",
        description: "Reference image for the start of the generated shot:",
      })
    }

    const response = await this.analyze(request)

    if (!response.success) {
      throw new Error(`场景过渡建议生成失败: ${response.result}`)
    }

    return response.result
  }
}

/**
 * 通用AI提供商基类
 * 定义所有AI模型提供商必须实现的接口
 */

import type {
  AIAnalysisRequest,
  AIAnalysisResponse,
  AIProviderConfig,
} from "../types/index.js"

export interface AIProvider {
  // 提供商标识
  readonly id: string
  readonly name: string
  readonly supportsMultimodal: boolean
  readonly maxImageSize: number // 最大图像尺寸（像素）

  // 配置
  config: AIProviderConfig

  // 初始化
  initialize(config: Partial<AIProviderConfig>): Promise<void>

  // 分析请求
  analyze(request: AIAnalysisRequest): Promise<AIAnalysisResponse>

  // 场景过渡建议（LTX兼容）
  suggestSceneTransition(
    beforeFrame?: string,
    afterFrame?: string,
    beforePrompt?: string,
    afterPrompt?: string,
    gapDuration?: number,
    mode?: string,
    inputImage?: string,
  ): Promise<string>

  // 视觉风格分析
  analyzeVisualStyle(
    image: string,
    referenceStyles?: string[],
    analysisDepth?: "basic" | "detailed" | "comprehensive",
  ): Promise<string>

  // 视频帧分析
  analyzeVideoFrames(
    frames: string[],
    frameInterval?: number,
    analysisTypes?: string[],
  ): Promise<string>

  // 通用文本生成
  generateText(
    prompt: string,
    systemPrompt?: string,
    maxTokens?: number,
    temperature?: number,
  ): Promise<string>

  // 健康检查
  healthCheck(): Promise<boolean>

  // 获取使用统计
  getUsageStats(): Promise<{
    tokensUsed: number
    requestsMade: number
    lastRequestTime: Date | null
  }>
}

/**
 * 基础AI提供商实现
 * 提供通用功能和错误处理
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly supportsMultimodal: boolean
  abstract readonly maxImageSize: number

  config: AIProviderConfig
  protected usageStats = {
    tokensUsed: 0,
    requestsMade: 0,
    lastRequestTime: null as Date | null,
  }

  constructor(config: Partial<AIProviderConfig> = {}) {
    this.config = {
      provider: config.provider || "",
      apiKey: "",
      apiBaseUrl: "",
      defaultModel: "",
      timeout: 30000,
      maxRetries: 3,
      enabled: true,
      ...config,
    }
  }

  async initialize(config: Partial<AIProviderConfig>): Promise<void> {
    this.config = { ...this.config, ...config }

    // 验证必要配置
    if (!this.config.apiKey && this.requiresAPIKey()) {
      throw new Error(`API key is required for ${this.name} provider`)
    }

    // 测试连接
    await this.healthCheck()
  }

  async analyze(request: AIAnalysisRequest): Promise<AIAnalysisResponse> {
    try {
      // 更新使用统计
      this.usageStats.requestsMade++
      this.usageStats.lastRequestTime = new Date()

      // 调用具体实现
      const result = await this.performAnalysis(request)

      // 更新token使用统计
      if (result.tokensUsed) {
        this.usageStats.tokensUsed += result.tokensUsed
      }

      return result
    } catch (error: any) {
      return {
        success: false,
        result: `分析失败: ${error.message}`,
        provider: this.id,
        model: request.model || this.config.defaultModel || "unknown",
        metadata: { error: error.message, stack: error.stack },
      }
    }
  }

  async suggestSceneTransition(
    beforeFrame?: string,
    afterFrame?: string,
    beforePrompt?: string,
    afterPrompt?: string,
    gapDuration: number = 5,
    mode: string = "t2v",
    inputImage?: string,
  ): Promise<string> {
    // 构建分析请求
    const contents = []

    if (beforePrompt) {
      contents.push({
        type: "text" as const,
        data: `前一个镜头的描述: ${beforePrompt}`,
        description: "前镜头文本描述",
      })
    }

    if (afterPrompt) {
      contents.push({
        type: "text" as const,
        data: `后一个镜头的描述: ${afterPrompt}`,
        description: "后镜头文本描述",
      })
    }

    if (beforeFrame) {
      contents.push({
        type: "image" as const,
        data: beforeFrame,
        mimeType: "image/jpeg",
        description: "前镜头最后一帧",
      })
    }

    if (afterFrame) {
      contents.push({
        type: "image" as const,
        data: afterFrame,
        mimeType: "image/jpeg",
        description: "后镜头第一帧",
      })
    }

    if (inputImage) {
      contents.push({
        type: "image" as const,
        data: inputImage,
        mimeType: "image/jpeg",
        description: "参考图像",
      })
    }

    const systemPrompt = `你是一个视频制作助手。用户正在编辑视频时间线，两个镜头之间有${gapDuration}秒的间隙。
    你的工作是为生成${mode === "t2i" ? "图像" : "视频片段"}提供详细的提示词，使其能够自然地在前一个镜头和后一个镜头之间流动。

    指导原则：
    - 描述场景、${mode === "t2i" ? "构图" : "动作、摄像机运动"}、光线和氛围
    - 匹配周围镜头的视觉风格和基调
    - 在两个镜头之间创建平滑的叙事或视觉过渡
    - 保持提示词简洁（最多2-4句话）
    - 只写提示词文本，不要解释或标签
    - 如果只有一个相邻镜头可用，建议自然过渡到或从中过渡出来的内容`

    const request: AIAnalysisRequest = {
      operation: "scene_transition_suggestion",
      contents,
      systemPrompt,
      parameters: {
        gapDuration,
        mode,
        generationType: mode === "t2i" ? "image" : "video",
      },
    }

    const response = await this.analyze(request)

    if (!response.success) {
      throw new Error(`场景过渡建议生成失败: ${response.result}`)
    }

    return response.result
  }

  async analyzeVisualStyle(
    image: string,
    referenceStyles?: string[],
    analysisDepth: "basic" | "detailed" | "comprehensive" = "detailed",
  ): Promise<string> {
    const contents = [
      {
        type: "image" as const,
        data: image,
        mimeType: "image/jpeg",
        description: "待分析图像",
      },
    ]

    if (referenceStyles && referenceStyles.length > 0) {
      contents.push({
        // @ts-expect-error
        type: "text" as const,
        data: `参考风格: ${referenceStyles.join(", ")}`,
        description: "参考风格列表",
      })
    }

    let systemPrompt = "分析图像的视觉风格，包括："
    if (analysisDepth === "basic") {
      systemPrompt += "主要色彩、整体氛围、简单描述"
    } else if (analysisDepth === "detailed") {
      systemPrompt += "色彩搭配、构图方式、光影效果、纹理质感、艺术风格影响"
    } else {
      systemPrompt +=
        "色彩理论应用、构图原则、光影层次、材质表现、文化参考、情感影响、艺术历史背景"
    }

    const request: AIAnalysisRequest = {
      operation: "visual_style_analysis",
      contents,
      systemPrompt,
      parameters: { analysisDepth },
    }

    const response = await this.analyze(request)

    if (!response.success) {
      throw new Error(`视觉风格分析失败: ${response.result}`)
    }

    return response.result
  }

  async analyzeVideoFrames(
    frames: string[],
    frameInterval?: number,
    analysisTypes?: string[],
  ): Promise<string> {
    const contents = frames.map((frame, index) => ({
      type: "image" as const,
      data: frame,
      mimeType: "image/jpeg",
      description: `视频帧 ${index + 1}`,
    }))

    let systemPrompt = "分析视频帧序列，提供：场景识别、对象检测、动作分析"
    if (analysisTypes && analysisTypes.length > 0) {
      systemPrompt = `分析视频帧序列，重点关注：${analysisTypes.join("、")}`
    }

    const request: AIAnalysisRequest = {
      operation: "frame_analysis",
      contents,
      systemPrompt,
      parameters: {
        frameCount: frames.length,
        frameInterval,
        analysisTypes,
      },
    }

    const response = await this.analyze(request)

    if (!response.success) {
      throw new Error(`视频帧分析失败: ${response.result}`)
    }

    return response.result
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    maxTokens?: number,
    temperature?: number,
  ): Promise<string> {
    const request: AIAnalysisRequest = {
      operation: "custom_analysis",
      contents: [{ type: "text", data: prompt }],
      systemPrompt,
      parameters: { maxTokens, temperature },
    }

    const response = await this.analyze(request)

    if (!response.success) {
      throw new Error(`文本生成失败: ${response.result}`)
    }

    return response.result
  }

  async healthCheck(): Promise<boolean> {
    try {
      // 默认实现：尝试生成简短文本
      const testResponse = await this.generateText(
        "测试连接",
        '回复"OK"即可',
        10,
      )
      return testResponse.includes("OK") || testResponse.length > 0
    } catch {
      return false
    }
  }

  async getUsageStats() {
    return {
      tokensUsed: this.usageStats.tokensUsed,
      requestsMade: this.usageStats.requestsMade,
      lastRequestTime: this.usageStats.lastRequestTime,
    }
  }

  // 抽象方法 - 子类必须实现
  protected abstract performAnalysis(
    request: AIAnalysisRequest,
  ): Promise<AIAnalysisResponse>
  protected abstract requiresAPIKey(): boolean
}

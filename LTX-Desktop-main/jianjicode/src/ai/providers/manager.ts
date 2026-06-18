/**
 * AI提供商管理器
 * 管理多个AI模型提供商，提供统一的访问接口
 */

import type {
  AIAnalysisRequest,
  AIAnalysisResponse,
  AIProviderConfig,
} from "../types/index.js"
import { type AIProvider, BaseAIProvider } from "./base.js"

export class AIProviderManager {
  private providers: Map<string, AIProvider> = new Map()
  private defaultProvider: string | null = null
  private configs: Map<string, AIProviderConfig> = new Map()
  private providerFactories: Map<
    string,
    (config: AIProviderConfig) => Promise<AIProvider>
  > = new Map()

  constructor() {
    // 自动注册已知的提供商工厂
    this.registerProviderFactory("deepseek", this.createDeepSeekProvider)
    this.registerProviderFactory("openai", this.createOpenAIProvider)
    this.registerProviderFactory("google", this.createGoogleProvider)
    this.registerProviderFactory("anthropic", this.createAnthropicProvider)
    // 注册国产模型提供商
    this.registerProviderFactory("zhipuai", this.createZhiPuAIProvider)
    this.registerProviderFactory("baidu-ernie", this.createBaiduErnieProvider)
    this.registerProviderFactory("ali-tongyi", this.createAliTongyiProvider)
  }

  /**
   * 注册提供商工厂
   */
  registerProviderFactory(
    id: string,
    factory: (config: AIProviderConfig) => Promise<AIProvider>,
  ): void {
    this.providerFactories.set(id, factory)
  }

  /**
   * 添加提供商
   */
  async addProvider(provider: AIProvider): Promise<void> {
    this.providers.set(provider.id, provider)

    // 如果是第一个提供商，设为默认
    if (!this.defaultProvider) {
      this.defaultProvider = provider.id
    }
  }

  /**
   * 配置提供商
   */
  async configureProvider(
    id: string,
    config: Partial<AIProviderConfig>,
  ): Promise<void> {
    // 存储配置
    const fullConfig: AIProviderConfig = {
      provider: id,
      apiKey: "",
      apiBaseUrl: "",
      defaultModel: "",
      timeout: 30000,
      maxRetries: 3,
      enabled: true,
      ...config,
    }

    this.configs.set(id, fullConfig)

    // 如果提供商已存在，重新初始化
    const existingProvider = this.providers.get(id)
    if (existingProvider) {
      await existingProvider.initialize(fullConfig)
      return
    }

    // 如果提供商不存在但存在工厂，创建提供商实例
    const factory = this.providerFactories.get(id)
    if (factory) {
      try {
        const provider = await factory(fullConfig)
        await this.addProvider(provider)
      } catch (error: any) {
        console.error(`创建提供商 ${id} 失败:`, error.message)
        throw error
      }
    }
  }

  /**
   * 获取提供商
   */
  getProvider(id?: string): AIProvider | null {
    const providerId = id || this.defaultProvider
    if (!providerId) {
      return null
    }
    return this.providers.get(providerId) || null
  }

  /**
   * 获取所有提供商
   */
  getAllProviders(): AIProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * 设置默认提供商
   */
  setDefaultProvider(id: string): void {
    if (this.providers.has(id)) {
      this.defaultProvider = id
    } else {
      throw new Error(`提供商 ${id} 未注册`)
    }
  }

  /**
   * 执行分析（使用默认或指定提供商）
   */
  async analyze(
    request: AIAnalysisRequest,
    providerId?: string,
  ): Promise<AIAnalysisResponse> {
    const provider = this.getProvider(providerId)
    if (!provider) {
      throw new Error(`找不到可用的AI提供商: ${providerId || "默认"}`)
    }

    // 如果请求中指定了提供商，使用指定提供商
    if (request.provider && request.provider !== provider.id) {
      const requestedProvider = this.getProvider(request.provider)
      if (requestedProvider) {
        return requestedProvider.analyze(request)
      }
    }

    return provider.analyze(request)
  }

  /**
   * 健康检查所有提供商
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [id, provider] of this.providers.entries()) {
      try {
        results[id] = await provider.healthCheck()
      } catch (error) {
        results[id] = false
      }
    }

    return results
  }

  /**
   * 获取提供商使用统计
   */
  async getUsageStats() {
    const stats: Record<string, any> = {}

    for (const [id, provider] of this.providers.entries()) {
      stats[id] = await provider.getUsageStats()
    }

    return stats
  }

  /**
   * 创建DeepSeek提供商
   */
  private async createDeepSeekProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { DeepSeekProvider } = await import("../adapters/openai.js")
    const provider = new DeepSeekProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建OpenAI提供商
   */
  private async createOpenAIProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { OpenAICompatibleProvider } = await import("../adapters/openai.js")
    const provider = new OpenAICompatibleProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建Google提供商
   */
  private async createGoogleProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { GoogleProvider } = await import("../adapters/google.js")
    const provider = new GoogleProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建Anthropic提供商
   */
  private async createAnthropicProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { AnthropicProvider } = await import("../adapters/anthropic.js")
    const provider = new AnthropicProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建智谱AI提供商
   */
  private async createZhiPuAIProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { ZhiPuAIProvider } = await import("../adapters/zhipuai.js")
    const provider = new ZhiPuAIProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建百度文心提供商
   */
  private async createBaiduErnieProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { BaiduErnieProvider } = await import("../adapters/baiduwenxin.js")
    const provider = new BaiduErnieProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 创建阿里通义提供商
   */
  private async createAliTongyiProvider(
    config: AIProviderConfig,
  ): Promise<AIProvider> {
    const { AliTongyiProvider } = await import("../adapters/alitongyi.js")
    const provider = new AliTongyiProvider(config)
    await provider.initialize(config)
    return provider
  }

  /**
   * 静态实例
   */
  private static instance: AIProviderManager | null = null

  static getInstance(): AIProviderManager {
    if (!AIProviderManager.instance) {
      AIProviderManager.instance = new AIProviderManager()
    }
    return AIProviderManager.instance
  }
}

// 导出单例
export const aiProviderManager = AIProviderManager.getInstance()

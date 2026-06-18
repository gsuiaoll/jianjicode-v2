/**
 * 计算机视觉模型提供商管理器
 * 管理多个CV模型提供商，提供统一的访问接口
 */

import type {
  CVModelConfig,
  CVModelProvider,
  DepthEstimationRequest,
  DepthEstimationResult,
  PoseEstimationRequest,
  PoseEstimationResult,
} from "../types/index.js"

// 提供商工厂函数类型
type CVProviderFactory = (config: CVModelConfig) => Promise<CVModelProvider>

/**
 * CV模型提供商管理器
 */
export class CVModelProviderManager {
  private static instance: CVModelProviderManager
  private providers: Map<string, CVModelProvider> = new Map()
  private providerFactories: Map<string, CVProviderFactory> = new Map()
  private defaultProvider: string = "midas-dpt"

  private constructor() {
    // 私有构造函数，确保单例
  }

  /**
   * 获取单例实例
   */
  static getInstance(): CVModelProviderManager {
    if (!CVModelProviderManager.instance) {
      CVModelProviderManager.instance = new CVModelProviderManager()
    }
    return CVModelProviderManager.instance
  }

  /**
   * 注册提供商工厂
   */
  registerProviderFactory(
    providerId: string,
    factory: CVProviderFactory,
  ): void {
    this.providerFactories.set(providerId, factory)
    console.log(`注册CV模型提供商工厂: ${providerId}`)
  }

  /**
   * 配置提供商
   */
  async configureProvider(
    providerId: string,
    config: Partial<CVModelConfig>,
  ): Promise<void> {
    try {
      const fullConfig: CVModelConfig = {
        provider: providerId,
        device: "cpu",
        downloadModels: true,
        ...config,
      }

      const factory = this.providerFactories.get(providerId)
      if (!factory) {
        throw new Error(`未找到CV模型提供商工厂: ${providerId}`)
      }

      // 创建并初始化提供商
      const provider = await factory(fullConfig)
      await provider.initialize(config.modelPath)

      this.providers.set(providerId, provider)
      console.log(`CV模型提供商 ${providerId} 配置完成`)
    } catch (error: any) {
      console.error(`配置CV模型提供商 ${providerId} 失败:`, error.message)
      throw error
    }
  }

  /**
   * 获取提供商
   */
  getProvider(providerId?: string): CVModelProvider {
    const id = providerId || this.defaultProvider
    const provider = this.providers.get(id)

    if (!provider) {
      throw new Error(`未找到CV模型提供商: ${id}`)
    }

    return provider
  }

  /**
   * 设置默认提供商
   */
  setDefaultProvider(providerId: string): void {
    if (
      !this.providers.has(providerId) &&
      !this.providerFactories.has(providerId)
    ) {
      throw new Error(`无法设置不存在的提供商为默认: ${providerId}`)
    }

    this.defaultProvider = providerId
    console.log(`设置默认CV模型提供商为: ${providerId}`)
  }

  /**
   * 深度估计
   */
  async estimateDepth(
    request: DepthEstimationRequest,
    providerId?: string,
  ): Promise<DepthEstimationResult> {
    try {
      const provider = this.getProvider(providerId)
      return await provider.estimateDepth(request)
    } catch (error: any) {
      console.error("深度估计失败:", error.message)
      throw error
    }
  }

  /**
   * 姿态估计
   */
  async estimatePose(
    request: PoseEstimationRequest,
    providerId?: string,
  ): Promise<PoseEstimationResult> {
    try {
      const provider = this.getProvider(providerId)
      return await provider.estimatePose(request)
    } catch (error: any) {
      console.error("姿态估计失败:", error.message)
      throw error
    }
  }

  /**
   * 健康检查所有提供商
   */
  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}

    for (const [providerId, provider] of this.providers.entries()) {
      try {
        const isHealthy = await provider.healthCheck()
        results[providerId] = isHealthy
      } catch (error) {
        console.error(`提供商 ${providerId} 健康检查失败:`, error)
        results[providerId] = false
      }
    }

    return results
  }

  /**
   * 获取所有已配置的提供商
   */
  getAllProviders(): CVModelProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * 获取提供商状态
   */
  getProviderStatus(): Array<{
    id: string
    name: string
    initialized: boolean
    supportedModels: string[]
  }> {
    return Array.from(this.providers.values()).map((provider) => ({
      id: provider.id,
      name: provider.name,
      initialized: true, // 假设在管理器中的提供商都已初始化
      supportedModels: provider.supportedModels,
    }))
  }

  /**
   * 清理所有提供商
   */
  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.providers.values()).map(
      (provider) =>
        provider.cleanup().catch((error) => {
          console.error(`清理提供商 ${provider.id} 失败:`, error)
        }),
    )

    await Promise.all(cleanupPromises)
    this.providers.clear()
    console.log("所有CV模型提供商已清理")
  }

  /**
   * 获取支持的模型列表
   */
  getSupportedModels(providerId?: string): string[] {
    const provider = this.getProvider(providerId)
    return provider.supportedModels
  }

  /**
   * 检查模型是否支持
   */
  isModelSupported(model: string, providerId?: string): boolean {
    const provider = this.getProvider(providerId)
    return provider.supportedModels.includes(model)
  }
}

// 导出单例实例
export const cvModelProviderManager = CVModelProviderManager.getInstance()

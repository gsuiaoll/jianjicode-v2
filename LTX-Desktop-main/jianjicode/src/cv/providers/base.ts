/**
 * 计算机视觉模型提供商基类
 * 提供深度估计、姿态估计等CV功能的统一接口
 */

import type {
  CVModelConfig,
  CVModelProvider,
  DepthEstimationRequest,
  DepthEstimationResult,
  PoseEstimationRequest,
  PoseEstimationResult,
} from "../types/index.js"

/**
 * 抽象基类，定义所有CV模型提供商的通用行为
 */
export abstract class BaseCVModelProvider implements CVModelProvider {
  readonly id: string
  readonly name: string
  readonly supportedModels: string[] = []

  protected config: CVModelConfig
  protected initialized: boolean = false
  protected modelLoaded: boolean = false

  constructor(config: CVModelConfig) {
    this.id = config.provider
    this.name = config.provider
    this.config = config
  }

  /**
   * 初始化模型提供商
   */
  async initialize(modelPath?: string): Promise<void> {
    try {
      console.log(`初始化CV模型提供商: ${this.name}`)

      // 设置模型路径
      if (modelPath) {
        this.config.modelPath = modelPath
      }

      // 检查模型文件是否存在，不存在则下载
      await this.ensureModelExists()

      // 加载模型
      await this.loadModel()

      this.initialized = true
      this.modelLoaded = true

      console.log(`CV模型提供商 ${this.name} 初始化完成`)
    } catch (error: any) {
      console.error(`CV模型提供商 ${this.name} 初始化失败:`, error.message)
      throw new Error(`初始化失败: ${error.message}`)
    }
  }

  /**
   * 确保模型文件存在（抽象方法，由子类实现）
   */
  protected abstract ensureModelExists(): Promise<void>

  /**
   * 加载模型（抽象方法，由子类实现）
   */
  protected abstract loadModel(): Promise<void>

  /**
   * 深度估计（抽象方法，由子类实现）
   */
  abstract estimateDepth(
    request: DepthEstimationRequest,
  ): Promise<DepthEstimationResult>

  /**
   * 姿态估计（抽象方法，由子类实现）
   */
  abstract estimatePose(
    request: PoseEstimationRequest,
  ): Promise<PoseEstimationResult>

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    if (!this.initialized) {
      return false
    }

    try {
      // 简单测试：尝试处理一个小的测试图像
      const testImage = this.createTestImage()
      const depthRequest: DepthEstimationRequest = {
        image: testImage,
        model: "midas",
        outputFormat: "colormap",
        normalize: true,
        device: this.config.device || "cpu",
      }

      // 快速健康检查，不实际处理
      return this.modelLoaded
    } catch (error) {
      console.error("CV提供商健康检查失败:", error)
      return false
    }
  }

  /**
   * 资源清理
   */
  async cleanup(): Promise<void> {
    try {
      await this.unloadModel()
      this.modelLoaded = false
      this.initialized = false
      console.log(`CV模型提供商 ${this.name} 已清理`)
    } catch (error: any) {
      console.error(`清理CV模型提供商 ${this.name} 失败:`, error.message)
    }
  }

  /**
   * 卸载模型（抽象方法，由子类实现）
   */
  protected abstract unloadModel(): Promise<void>

  /**
   * 创建测试图像（用于健康检查）
   */
  protected createTestImage(): any {
    // 创建一个简单的1x1红色像素测试图像
    const redPixel =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    return {
      type: "base64" as const,
      data: `data:image/png;base64,${redPixel}`,
      format: "png" as const,
      width: 1,
      height: 1,
      channels: 3,
    }
  }

  /**
   * 解析图像输入
   */
  protected async parseImageInput(imageInput: any): Promise<{
    data: Buffer | string
    width: number
    height: number
    channels: number
  }> {
    switch (imageInput.type) {
      case "file_path": {
        // 读取文件
        const { readFileSync } = await import("fs")
        const data = readFileSync(imageInput.data)
        // 获取图像尺寸（简化版，实际需要解析图像）
        return {
          data,
          width: imageInput.width || 0,
          height: imageInput.height || 0,
          channels: imageInput.channels || 3,
        }
      }

      case "base64": {
        // 解码base64
        const base64Data = imageInput.data.startsWith("data:")
          ? imageInput.data.split(",")[1]
          : imageInput.data
        const buffer = Buffer.from(base64Data, "base64")
        return {
          data: buffer,
          width: imageInput.width || 0,
          height: imageInput.height || 0,
          channels: imageInput.channels || 3,
        }
      }

      case "frame_array":
        // 帧数组（需要序列化/反序列化）
        throw new Error("frame_array类型暂不支持，请使用base64或file_path")

      default:
        throw new Error(`不支持的图像输入类型: ${imageInput.type}`)
    }
  }

  /**
   * 处理错误
   */
  protected handleError(
    operation: string,
    error: any,
  ): DepthEstimationResult | PoseEstimationResult {
    console.error(`${this.name} ${operation} 失败:`, error)

    const errorResult = {
      success: false,
      metadata: {
        model: this.id,
        processingTime: 0,
        imageSize: { width: 0, height: 0 },
        error: error.message,
      },
    } as any

    if (operation.includes("depth")) {
      return {
        ...errorResult,
        depthMap: "",
      } as DepthEstimationResult
    } else {
      return {
        ...errorResult,
        persons: [],
      } as PoseEstimationResult
    }
  }

  /**
   * 获取设备配置
   */
  protected getDeviceConfig(): { device: string; useGPU: boolean } {
    const device = this.config.device || "cpu"
    const useGPU = device === "cuda" || device === "mps"

    return { device, useGPU }
  }

  /**
   * 计算处理时间
   */
  protected calculateProcessingTime(startTime: number): number {
    return Date.now() - startTime
  }
}

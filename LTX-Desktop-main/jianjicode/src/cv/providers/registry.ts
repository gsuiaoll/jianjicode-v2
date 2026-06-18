/**
 * 计算机视觉模型提供商注册
 * 注册所有可用的CV模型提供商
 */

import { DWPoseProvider } from "../adapters/dw_pose.js"
import { MiDaSDPTProvider } from "../adapters/midas_dpt.js"
import type { CVModelConfig } from "../types/index.js"
import { cvModelProviderManager } from "./manager.js"

/**
 * 注册所有CV模型提供商
 */
export async function registerCVProviders(): Promise<void> {
  console.log("注册计算机视觉模型提供商...")

  // 注册MiDaS DPT深度估计提供商
  cvModelProviderManager.registerProviderFactory(
    "midas-dpt",
    async (config: CVModelConfig) => {
      return new MiDaSDPTProvider(config)
    },
  )

  // 注册DW Pose姿态估计提供商
  cvModelProviderManager.registerProviderFactory(
    "dw-pose",
    async (config: CVModelConfig) => {
      return new DWPoseProvider(config)
    },
  )

  // 注册更多提供商...
  // cvModelProviderManager.registerProviderFactory('zoedepth', ...)
  // cvModelProviderManager.registerProviderFactory('mediapipe', ...)

  console.log("CV模型提供商注册完成")
}

/**
 * 配置默认CV模型提供商
 */
export async function configureDefaultCVProviders(): Promise<void> {
  // 确保提供商已注册
  await registerCVProviders()

  const providers = [
    {
      id: "midas-dpt",
      config: {
        provider: "midas-dpt",
        device: "cpu" as const,
        downloadModels: false, // 禁用下载，避免huggingface-cli依赖
        modelPath: undefined, // 使用默认路径
      },
    },
    {
      id: "dw-pose",
      config: {
        provider: "dw-pose",
        device: "cpu" as const,
        downloadModels: false, // 禁用下载，使用模拟模式
        modelPath: undefined, // 使用默认路径
      },
    },
  ]

  let configuredCount = 0

  for (const provider of providers) {
    try {
      await cvModelProviderManager.configureProvider(
        provider.id,
        provider.config,
      )
      console.log(`CV模型提供商 ${provider.id} 配置完成`)
      configuredCount++
    } catch (error: any) {
      console.error(`配置CV模型提供商 ${provider.id} 失败:`, error.message)
      // 继续配置下一个提供商
    }
  }

  console.log(
    `默认CV模型提供商配置完成: ${configuredCount}/${providers.length} 个提供商成功配置`,
  )

  // 健康检查
  if (configuredCount > 0) {
    try {
      const healthStatus = await cvModelProviderManager.healthCheckAll()
      console.log("CV提供商健康状态:", healthStatus)
    } catch (healthError) {
      console.warn("CV提供商健康检查失败:", healthError)
    }
  }
}

/**
 * 获取CV提供商管理器
 */
/**
 * 导出所有提供商类（用于测试和高级用法）
 */
export { cvModelProviderManager, DWPoseProvider, MiDaSDPTProvider }

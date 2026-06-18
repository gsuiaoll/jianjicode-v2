/**
 * 管道注册表 - 集成LTX风格的管道架构到jianjicode工具系统
 * 借鉴LTX的管道工厂模式，提供统一的管道创建和管理
 */

import { Tool } from "../../tool/tool.js"
import {
  type PipelineConfig,
  PipelineFactory,
  type VideoEditPipeline,
} from "../pipeline.js"
import { FfmpegEditPipeline } from "./ffmpeg-edit-pipeline.js"
import { FfmpegExportPipeline } from "./ffmpeg-export-pipeline.js"
import { LtxAnalyzePipeline } from "./ltx-analyze-pipeline.js"

/**
 * 管道工具包装器
 * 将LTX风格的管道转换为jianjicode工具接口
 */
export class PipelineToolWrapper {
  private pipeline: VideoEditPipeline | null = null

  constructor(
    private pipelineType: string,
    private pipelineClass: new () => VideoEditPipeline,
  ) {}

  /**
   * 初始化管道
   */
  async initialize(config: PipelineConfig): Promise<void> {
    if (this.pipeline) {
      return
    }

    const instance = new this.pipelineClass()
    this.pipeline = await instance.create(config)

    // 预热管道
    if (this.pipeline.warmup) {
      await this.pipeline.warmup()
    }
  }

  /**
   * 执行管道处理
   */
  async process(
    task: {
      operation: string
      inputPath: string | string[]
      outputPath: string
      // biome-ignore lint/suspicious/noExplicitAny: 待后续重构具体类型
      parameters: Record<string, any>
    },
    progressCallback?: (progress: {
      percent: number
      step: string
      details?: string
    }) => void,
  ): Promise<{
    success: boolean
    outputPath?: string
    // biome-ignore lint/suspicious/noExplicitAny: 待后续重构具体类型
    outputData?: any
    error?: string
    statistics?: {
      processingTime: number
      inputSize: number
      outputSize?: number
    }
  }> {
    if (!this.pipeline) {
      throw new Error("管道未初始化，请先调用initialize()")
    }

    // 验证操作类型是否为有效的管道操作
    const validOperations = [
      "trim",
      "concat",
      "convert",
      "filter",
      "subtitle",
      "watermark",
      "transition",
      "analyze",
      "composite",
    ] as const
    // biome-ignore lint/suspicious/noExplicitAny: 待后续重构联合类型
    if (!validOperations.includes(task.operation as any)) {
      throw new Error(`无效的管道操作类型: ${task.operation}`)
    }

    const pipelineTask = {
      operation: task.operation as
        | "trim"
        | "concat"
        | "convert"
        | "filter"
        | "subtitle"
        | "watermark"
        | "transition"
        | "analyze"
        | "composite",
      inputPath: task.inputPath,
      outputPath: task.outputPath,
      parameters: task.parameters,
    }

    const pipelineProgressCallback = progressCallback
      ? (progress: { percent: number; step: string; details?: string }) => {
          progressCallback(progress)
        }
      : undefined

    const result = await this.pipeline.process(
      pipelineTask,
      pipelineProgressCallback,
    )
    return result
  }

  /**
   * 清理管道资源
   */
  async cleanup(): Promise<void> {
    if (this.pipeline && this.pipeline.cleanup) {
      await this.pipeline.cleanup()
    }
    this.pipeline = null
  }
}

/**
 * 注册所有LTX风格的管道
 */
export function registerLtxStylePipelines(): void {
  // 注册FFmpeg编辑管道
  PipelineFactory.registerPipeline("ffmpeg-edit", FfmpegEditPipeline)
  // 注册LTX分析管道
  PipelineFactory.registerPipeline("ltx-analyze", LtxAnalyzePipeline)
  // 注册FFmpeg导出管道
  PipelineFactory.registerPipeline("ffmpeg-export", FfmpegExportPipeline)

  console.log(
    "[PipelineRegistry] 已注册LTX风格管道: ffmpeg-edit, ltx-analyze, ffmpeg-export",
  )
}

/**
 * 管道工具映射
 * 将管道操作映射到工具参数
 */
export const pipelineToolMap: Record<
  string,
  {
    toolName: string
    // biome-ignore lint/suspicious/noExplicitAny: 待后续重构具体类型
    parameters: Record<string, any>
  }
> = {
  trim: {
    toolName: "ffmpeg-edit-pipeline",
    parameters: {
      operation: "trim",
      start_time: "参数: 开始时间 (格式: HH:MM:SS)",
      end_time: "参数: 结束时间 (格式: HH:MM:SS)",
      duration: "参数: 时长 (秒)",
      codec: "可选: 编码器 (默认: libx264)",
      preset: "可选: 预设 (默认: medium)",
      crf: "可选: CRF质量 (默认: 23)",
    },
  },
  concat: {
    toolName: "ffmpeg-edit-pipeline",
    parameters: {
      operation: "concat",
      input_files: "参数: 输入文件路径数组",
      method: "可选: 合并方法 (默认: concat)",
    },
  },
  convert: {
    toolName: "ffmpeg-edit-pipeline",
    parameters: {
      operation: "convert",
      format: "参数: 目标格式 (mp4, mov, avi, webm, gif)",
      codec: "可选: 视频编码器",
      quality: "可选: 质量参数对象",
      resolution: "可选: 分辨率对象 {width, height}",
    },
  },
  analyze: {
    toolName: "ltx-analyze-pipeline",
    parameters: {
      operation: "analyze",
      analysis_type:
        "可选: 分析类型 (pose|object|scene|action|audio|comprehensive)",
      frame_rate: "可选: 分析帧率 (默认: 10)",
      max_frames: "可选: 最大分析帧数 (默认: 100)",
      confidence_threshold: "可选: 置信度阈值 (默认: 0.5)",
      output_format: "可选: 输出格式 (json|csv|text|visualization)",
      specific_options: "可选: 特定分析参数",
    },
  },
}

/**
 * 创建管道工具实例
 */
export function createPipelineTool(
  pipelineType: string,
  config: PipelineConfig = {
    type: "edit",
    hardwareAcceleration: true,
    device: "cpu",
    maxConcurrent: 1,
    tempDir: process.env.TEMP || "/tmp",
    logLevel: "info",
  },
): PipelineToolWrapper {
  const pipelineClass = {
    "ffmpeg-edit": FfmpegEditPipeline,
    "ltx-analyze": LtxAnalyzePipeline,
  }[pipelineType]

  if (!pipelineClass) {
    throw new Error(`未知的管道类型: ${pipelineType}`)
  }

  return new PipelineToolWrapper(pipelineType, pipelineClass)
}

/**
 * 获取管道工具描述
 */
export function getPipelineToolDescription(pipelineType: string): string {
  const descriptions: Record<string, string> = {
    "ffmpeg-edit":
      "FFmpeg视频编辑管道 - 基于LTX管道架构，提供trim、concat、convert、analyze等视频编辑操作，支持硬件加速",
    "ltx-analyze":
      "LTX视频分析管道 - 集成LTX的DWPose、ObjectDetection、SceneAnalysis等分析功能，提供pose、object、scene、action、audio等全面视频分析",
  }

  return descriptions[pipelineType] || `未知管道: ${pipelineType}`
}

/**
 * 管道工具集成器
 * 将管道工具添加到jianjicode工具系统
 */
export class PipelineToolIntegrator {
  private static instance: PipelineToolIntegrator | null = null
  private registeredTools = new Map<string, PipelineToolWrapper>()

  private constructor() {
    // 私有构造函数
  }

  static getInstance(): PipelineToolIntegrator {
    if (!PipelineToolIntegrator.instance) {
      PipelineToolIntegrator.instance = new PipelineToolIntegrator()
    }
    return PipelineToolIntegrator.instance
  }

  /**
   * 初始化所有管道工具
   */
  async initializeAllPipelines(): Promise<void> {
    console.log("[PipelineToolIntegrator] 初始化所有LTX风格管道...")

    // 注册管道类型
    registerLtxStylePipelines()

    // 创建和初始化FFmpeg编辑管道
    const ffmpegEditTool = createPipelineTool("ffmpeg-edit", {
      type: "edit",
      hardwareAcceleration: true,
      device: "cuda",
      maxConcurrent: 2,
      tempDir: process.env.TEMP || "/tmp",
      logLevel: "info",
    })

    await ffmpegEditTool.initialize({
      type: "edit",
      hardwareAcceleration: true,
      device: "cuda",
      maxConcurrent: 2,
      tempDir: process.env.TEMP || "/tmp",
      logLevel: "info",
    })

    this.registeredTools.set("ffmpeg-edit", ffmpegEditTool)

    console.log("[PipelineToolIntegrator] 管道初始化完成")
  }

  /**
   * 获取管道工具
   */
  getPipelineTool(type: string): PipelineToolWrapper | undefined {
    return this.registeredTools.get(type)
  }

  /**
   * 获取所有可用的管道操作
   */
  getAvailableOperations(): Array<{
    operation: string
    toolName: string
    description: string
    // biome-ignore lint/suspicious/noExplicitAny: 待后续重构具体类型
    parameters: Record<string, any>
  }> {
    return Object.entries(pipelineToolMap).map(([operation, config]) => ({
      operation,
      toolName: config.toolName,
      description: getPipelineToolDescription(
        config.toolName.replace("-pipeline", ""),
      ),
      parameters: config.parameters,
    }))
  }

  /**
   * 清理所有管道资源
   */
  async cleanupAllPipelines(): Promise<void> {
    console.log("[PipelineToolIntegrator] 清理所有管道资源...")

    for (const [type, tool] of this.registeredTools) {
      try {
        await tool.cleanup()
        console.log(`[PipelineToolIntegrator] 已清理管道: ${type}`)
      } catch (error) {
        console.error(`[PipelineToolIntegrator] 清理管道失败 ${type}:`, error)
      }
    }

    this.registeredTools.clear()
  }
}

// 导出单例实例
export const pipelineToolIntegrator = PipelineToolIntegrator.getInstance()

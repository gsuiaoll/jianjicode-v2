/**
 * 视频编辑管道接口 - 借鉴LTX的Pipeline架构模式
 *
 * LTX的架构启示：
 * 1. 清晰的Pipeline接口 (FastVideoPipeline, A2VPipeline, RetakePipeline)
 * 2. 统一的create()工厂方法
 * 3. 标准化的generate()/process()方法
 * 4. 硬件加速和资源管理
 * 5. 进度反馈和错误处理
 */

export interface PipelineConfig {
  /** 管道类型 */
  type: "edit" | "analyze" | "export" | "composite"
  /** 硬件加速配置 */
  hardwareAcceleration?: boolean
  /** GPU设备 (cuda, mps, cpu) */
  device?: "cpu" | "cuda" | "mps"
  /** 最大并发任务数 */
  maxConcurrent?: number
  /** 临时目录 */
  tempDir?: string
  /** 日志级别 */
  logLevel?: "error" | "warn" | "info" | "debug"
}

export type ProgressCallback = (progress: PipelineProgress) => void

export interface PipelineProgress {
  /** 进度百分比 (0-100) */
  percent: number
  /** 当前步骤 */
  step: string
  /** 步骤详情 */
  details?: string
  /** 估计剩余时间 (秒) */
  estimatedRemaining?: number
  /** 当前处理的文件 */
  currentFile?: string
}

export interface PipelineResult {
  /** 是否成功 */
  success: boolean
  /** 输出文件路径 */
  outputPath?: string
  /** 输出数据 (JSON, 文本等) */
  outputData?: any
  /** 错误信息 */
  error?: string
  /** 处理统计 */
  statistics?: {
    /** 处理时间 (毫秒) */
    processingTime: number
    /** 输入文件大小 (字节) */
    inputSize: number
    /** 输出文件大小 (字节) */
    outputSize?: number
    /** 压缩率 (如果适用) */
    compressionRatio?: number
  }
  /** 元数据 */
  metadata?: Record<string, any>
}

/**
 * 基础视频编辑管道接口
 * 借鉴LTX的Pipeline模式，但专注于视频编辑而非生成
 */
export interface VideoEditPipeline {
  /** 管道类型 */
  readonly pipelineType: string

  /**
   * 创建管道实例 (借鉴LTX的静态create()工厂方法)
   */
  create(config: PipelineConfig): Promise<VideoEditPipeline>

  /**
   * 处理视频编辑任务 (类似LTX的generate()方法)
   */
  process(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult>

  /**
   * 预热管道 (借鉴LTX的warmup()方法)
   */
  warmup?(): Promise<void>

  /**
   * 清理资源
   */
  cleanup?(): Promise<void>

  /**
   * 获取管道能力
   */
  getCapabilities?(): PipelineCapabilities
}

/**
 * 视频编辑任务定义
 */
export interface VideoEditTask {
  /** 任务类型 */
  operation:
    | "trim"
    | "concat"
    | "convert"
    | "filter"
    | "subtitle"
    | "watermark"
    | "transition"
    | "analyze"
    | "composite"
  /** 输入文件路径 */
  inputPath: string | string[]
  /** 输出文件路径 */
  outputPath: string
  /** 任务参数 */
  parameters: Record<string, any>
  /** 任务优先级 (1-10, 越高越优先) */
  priority?: number
  /** 超时时间 (毫秒) */
  timeout?: number
}

/**
 * 管道能力描述
 */
export interface PipelineCapabilities {
  /** 支持的输入格式 */
  supportedInputFormats: string[]
  /** 支持的输出格式 */
  supportedOutputFormats: string[]
  /** 支持的操作类型 */
  supportedOperations: string[]
  /** 硬件加速支持 */
  hardwareAcceleration: {
    cuda: boolean
    mps: boolean
    opencl: boolean
    vaapi: boolean
    qsv: boolean
  }
  /** 最大分辨率支持 */
  maxResolution: {
    width: number
    height: number
  }
  /** 并发处理能力 */
  maxConcurrentTasks: number
}

/**
 * 视频分析管道 (专门用于视频内容分析)
 * 借鉴LTX的DWPosePipeline等分析管道
 */
export interface VideoAnalyzePipeline extends VideoEditPipeline {
  readonly pipelineType: "analyze"

  /**
   * 分析视频内容 (类似LTX的apply()方法)
   */
  analyze(
    videoPath: string,
    options: AnalyzeOptions,
    progressCallback?: ProgressCallback,
  ): Promise<AnalyzeResult>
}

export interface AnalyzeOptions {
  /** 分析类型 */
  analysisType:
    | "pose"
    | "object"
    | "scene"
    | "action"
    | "audio"
    | "comprehensive"
  /** 帧率 (分析采样率) */
  frameRate?: number
  /** 最大分析帧数 */
  maxFrames?: number
  /** 置信度阈值 */
  confidenceThreshold?: number
  /** 输出格式 */
  outputFormat?: "json" | "csv" | "text" | "visualization"
  /** 特定分析参数 */
  specificOptions?: Record<string, any>
}

export interface AnalyzeResult extends PipelineResult {
  /** 分析数据 */
  analysisData: {
    /** 时间戳 */
    timestamp: number
    /** 检测结果 */
    detections: any[]
    /** 统计信息 */
    statistics: Record<string, any>
    /** 可视化数据 (Base64图片等) */
    visualizations?: string[]
  }
  /** 分析摘要 */
  summary: {
    /** 关键事件 */
    keyEvents: Array<{ time: number; description: string; confidence: number }>
    /** 统计摘要 */
    stats: Record<string, number | string>
    /** 建议编辑操作 */
    editSuggestions: Array<{
      timeRange: [number, number]
      operation: string
      reason: string
    }>
  }
}

/**
 * 视频导出管道 (专门用于视频导出和编码)
 * 借鉴LTX的编码和导出逻辑
 */
export interface VideoExportPipeline extends VideoEditPipeline {
  readonly pipelineType: "export"

  /**
   * 导出视频 (类似LTX的编码逻辑)
   */
  export(
    inputPath: string,
    exportOptions: ExportOptions,
    progressCallback?: ProgressCallback,
  ): Promise<ExportResult>
}

export interface ExportOptions {
  /** 输出格式 */
  format: "mp4" | "mov" | "avi" | "webm" | "gif"
  /** 视频编码器 */
  videoCodec: string
  /** 音频编码器 */
  audioCodec?: string
  /** 视频质量参数 */
  quality: {
    /** CRF值 (H.264/H.265) */
    crf?: number
    /** 比特率 */
    bitrate?: string
    /** 预设 */
    preset?: string
  }
  /** 分辨率 */
  resolution?: {
    width: number
    height: number
  }
  /** 帧率 */
  frameRate?: number
  /** 硬件加速 */
  hardwareAcceleration?: {
    encoder: string
    device?: number
  }
}

export interface ExportResult extends PipelineResult {
  /** 导出统计 */
  exportStats: {
    /** 原始文件大小 */
    originalSize: number
    /** 导出文件大小 */
    exportedSize: number
    /** 压缩率 */
    compressionRatio: number
    /** 编码时间 */
    encodingTime: number
    /** 平均编码速度 (帧/秒) */
    encodingSpeed: number
  }
}

/**
 * 管道工厂 - 创建和管理管道实例
 * 借鉴LTX的服务注册和依赖注入模式
 */
export class PipelineFactory {
  private static pipelines = new Map<string, new () => VideoEditPipeline>()
  private static instances = new Map<string, VideoEditPipeline>()

  /**
   * 注册管道类型
   */
  static registerPipeline(
    type: string,
    pipelineClass: new () => VideoEditPipeline,
  ): void {
    PipelineFactory.pipelines.set(type, pipelineClass)
    console.log(`[PipelineFactory] 注册管道类型: ${type}`)
  }

  /**
   * 创建管道实例 (类似LTX的create()工厂方法)
   */
  static async createPipeline(
    type: string,
    config: PipelineConfig,
  ): Promise<VideoEditPipeline> {
    const PipelineClass = PipelineFactory.pipelines.get(type)
    if (!PipelineClass) {
      throw new Error(`未注册的管道类型: ${type}`)
    }

    const instanceKey = `${type}:${JSON.stringify(config)}`

    // 重用现有实例 (如果配置相同)
    if (PipelineFactory.instances.has(instanceKey)) {
      console.log(`[PipelineFactory] 重用现有管道实例: ${type}`)
      return PipelineFactory.instances.get(instanceKey)!
    }

    // 创建新实例
    console.log(`[PipelineFactory] 创建新管道实例: ${type}`)
    const instance = new PipelineClass()
    await instance.create(config)

    PipelineFactory.instances.set(instanceKey, instance)
    return instance
  }

  /**
   * 获取所有注册的管道类型
   */
  static getRegisteredPipelines(): string[] {
    return Array.from(PipelineFactory.pipelines.keys())
  }

  /**
   * 根据文件类型和操作推荐管道
   */
  static recommendPipeline(
    fileType: string,
    operation: string,
    requirements?: { hardwareAcceleration?: boolean },
  ): string | null {
    // 简单的推荐逻辑
    const recommendations: Record<string, Record<string, string>> = {
      video: {
        trim: "ffmpeg-edit-pipeline",
        concat: "ffmpeg-edit-pipeline",
        convert: "ffmpeg-export-pipeline",
        analyze: "ltx-analyze-pipeline",
        filter: "ltx-effects-pipeline",
      },
      audio: {
        extract: "ffmpeg-edit-pipeline",
        merge: "ffmpeg-edit-pipeline",
      },
    }

    return recommendations[fileType]?.[operation] || null
  }
}

/**
 * 管道执行上下文
 * 跟踪管道执行状态和资源使用
 */
export class PipelineExecutionContext {
  private startTime: number
  private progressCallbacks: ProgressCallback[] = []

  constructor(
    public readonly taskId: string,
    public readonly pipeline: VideoEditPipeline,
    public readonly task: VideoEditTask,
  ) {
    this.startTime = Date.now()
  }

  /**
   * 添加进度回调
   */
  addProgressCallback(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback)
  }

  /**
   * 报告进度 (借鉴LTX的进度反馈机制)
   */
  reportProgress(progress: PipelineProgress): void {
    console.log(
      `[Pipeline ${this.taskId}] ${progress.step}: ${progress.percent}%`,
    )
    for (const callback of this.progressCallbacks) {
      try {
        callback(progress)
      } catch (error) {
        console.error(`进度回调错误:`, error)
      }
    }
  }

  /**
   * 执行任务
   */
  async execute(): Promise<PipelineResult> {
    try {
      this.reportProgress({
        percent: 0,
        step: "准备执行任务",
        details: `操作: ${this.task.operation}`,
      })

      const result = await this.pipeline.process(
        this.task,
        this.reportProgress.bind(this),
      )

      this.reportProgress({
        percent: 100,
        step: "任务完成",
        details: `输出: ${result.outputPath || "无文件输出"}`,
      })

      return result
    } catch (error: any) {
      this.reportProgress({
        percent: 100,
        step: "任务失败",
        details: error.message,
      })

      return {
        success: false,
        error: error.message,
      }
    }
  }

  /**
   * 获取执行统计
   */
  getStatistics(): { executionTime: number } {
    return {
      executionTime: Date.now() - this.startTime,
    }
  }
}

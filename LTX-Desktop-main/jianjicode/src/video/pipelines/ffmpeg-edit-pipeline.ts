/**
 * FFmpeg编辑管道 - 基于FFmpeg的视频编辑管道实现
 * 借鉴LTX的Pipeline架构模式，包装现有FFmpeg工具
 */

import { existsSync } from "fs"
import path from "path"
import { findFfmpegPath, runFfmpegEx } from "../../tool/ffmpeg-utils.js"
import type {
  PipelineConfig,
  PipelineProgress,
  PipelineResult,
  ProgressCallback,
  VideoEditPipeline,
  VideoEditTask,
} from "../pipeline.js"

export class FfmpegEditPipeline implements VideoEditPipeline {
  readonly pipelineType = "ffmpeg-edit"

  private config: PipelineConfig | null = null
  private ffmpegPath: string | null = null

  async create(config: PipelineConfig): Promise<VideoEditPipeline> {
    console.log(`[${this.pipelineType}] 创建管道实例`)
    this.config = config

    // 查找FFmpeg路径
    this.ffmpegPath = await findFfmpegPath()
    if (!this.ffmpegPath) {
      throw new Error("FFmpeg未找到，请安装FFmpeg或设置FFMPEG_PATH环境变量")
    }

    console.log(`[${this.pipelineType}] FFmpeg路径: ${this.ffmpegPath}`)
    return this
  }

  async process(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult> {
    if (!this.config || !this.ffmpegPath) {
      throw new Error("管道未初始化，请先调用create()方法")
    }

    const startTime = Date.now()

    try {
      // 报告进度
      this.reportProgress(progressCallback, {
        percent: 0,
        step: "开始处理",
        details: `操作: ${task.operation}`,
      })

      // 验证输入文件
      const inputPaths = Array.isArray(task.inputPath)
        ? task.inputPath
        : [task.inputPath]
      for (const inputPath of inputPaths) {
        if (!existsSync(inputPath)) {
          throw new Error(`输入文件不存在: ${inputPath}`)
        }
      }

      // 根据操作类型调用相应的FFmpeg命令
      let result: PipelineResult
      switch (task.operation) {
        case "trim":
          result = await this.processTrim(task, progressCallback)
          break
        case "concat":
          result = await this.processConcat(task, progressCallback)
          break
        case "convert":
          result = await this.processConvert(task, progressCallback)
          break
        case "analyze":
          result = await this.processAnalyze(task, progressCallback)
          break
        default:
          throw new Error(`不支持的操作类型: ${task.operation}`)
      }

      // 添加处理统计
      const processingTime = Date.now() - startTime
      if (result.success && result.statistics) {
        result.statistics.processingTime = processingTime
      } else if (result.success) {
        result.statistics = { processingTime, inputSize: 0 }
      }

      return result
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        statistics: {
          processingTime: Date.now() - startTime,
          inputSize: 0,
        },
      }
    }
  }

  private async processTrim(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult> {
    this.reportProgress(progressCallback, {
      percent: 20,
      step: "准备裁剪参数",
      details: "解析时间范围",
    })

    const inputPath = task.inputPath as string
    const { start_time, end_time, duration } = task.parameters

    if (!start_time) {
      throw new Error("裁剪操作需要start_time参数")
    }

    // 构建FFmpeg参数
    const args = ["-i", inputPath, "-ss", start_time.toString()]

    if (end_time) {
      args.push("-to", end_time.toString())
    } else if (duration) {
      args.push("-t", duration.toString())
    } else {
      // 如果没有结束时间或时长，裁剪到视频结束
      args.push("-c", "copy")
    }

    // 添加编码参数
    const codec = task.parameters.codec || "libx264"
    const preset = task.parameters.preset || "medium"
    const crf = task.parameters.crf || "23"

    if (!end_time && !duration) {
      // 如果使用copy编码，不需要额外的编码参数
      args.push(task.outputPath)
    } else {
      // 使用重新编码
      args.push(
        "-c:v",
        codec,
        "-preset",
        preset,
        "-crf",
        crf,
        "-c:a",
        "copy",
        task.outputPath,
      )
    }

    this.reportProgress(progressCallback, {
      percent: 40,
      step: "执行视频裁剪",
      details: "调用FFmpeg处理",
    })

    // 执行FFmpeg命令
    const ffmpegResult = await runFfmpegEx(args, {
      logProgress: this.config?.logLevel === "debug",
      encoder: this.config?.hardwareAcceleration
        ? this.getHardwareEncoder(codec)
        : undefined,
    })

    if (!ffmpegResult.success) {
      throw new Error(`FFmpeg裁剪失败: ${ffmpegResult.error}`)
    }

    this.reportProgress(progressCallback, {
      percent: 90,
      step: "裁剪完成",
      details: "验证输出文件",
    })

    // 验证输出文件
    if (!existsSync(task.outputPath)) {
      throw new Error("裁剪后输出文件未创建")
    }

    return {
      success: true,
      outputPath: task.outputPath,
      statistics: {
        processingTime: 0, // 将在外层填充
        inputSize: await this.getFileSize(inputPath),
        outputSize: await this.getFileSize(task.outputPath),
      },
    }
  }

  private async processConcat(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult> {
    this.reportProgress(progressCallback, {
      percent: 20,
      step: "准备合并参数",
      details: "解析输入文件列表",
    })

    const inputPaths = task.inputPath as string[]
    if (inputPaths.length < 2) {
      throw new Error("合并操作需要至少2个输入文件")
    }

    // 创建临时文件列表
    const fileListContent = inputPaths
      .map((p) => `file '${path.resolve(p)}'`)
      .join("\n")
    const tempListPath = path.join(
      this.config?.tempDir || path.dirname(task.outputPath),
      "concat_list.txt",
    )

    const fs = await import("fs")
    fs.writeFileSync(tempListPath, fileListContent, "utf8")

    try {
      // 构建FFmpeg参数
      const args = [
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        tempListPath,
        "-c",
        "copy",
        task.outputPath,
      ]

      this.reportProgress(progressCallback, {
        percent: 40,
        step: "执行视频合并",
        details: `合并 ${inputPaths.length} 个文件`,
      })

      // 执行FFmpeg命令
      const ffmpegResult = await runFfmpegEx(args, {
        logProgress: this.config?.logLevel === "debug",
      })

      if (!ffmpegResult.success) {
        throw new Error(`FFmpeg合并失败: ${ffmpegResult.error}`)
      }

      this.reportProgress(progressCallback, {
        percent: 90,
        step: "合并完成",
        details: "验证输出文件",
      })

      // 验证输出文件
      if (!existsSync(task.outputPath)) {
        throw new Error("合并后输出文件未创建")
      }

      // 计算总输入大小
      let totalInputSize = 0
      for (const inputPath of inputPaths) {
        totalInputSize += await this.getFileSize(inputPath)
      }

      return {
        success: true,
        outputPath: task.outputPath,
        statistics: {
          processingTime: 0,
          inputSize: totalInputSize,
          outputSize: await this.getFileSize(task.outputPath),
        },
      }
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(tempListPath)
      } catch (e) {
        // 忽略清理错误
      }
    }
  }

  private async processConvert(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult> {
    this.reportProgress(progressCallback, {
      percent: 20,
      step: "准备转换参数",
      details: "解析输出格式",
    })

    const inputPath = task.inputPath as string
    const { format, codec, quality } = task.parameters

    if (!format) {
      throw new Error("转换操作需要format参数")
    }

    // 构建FFmpeg参数
    const args = ["-i", inputPath]

    // 添加视频编码参数
    const videoCodec = codec || this.getDefaultCodecForFormat(format)
    const qualityParams = this.getQualityParams(videoCodec, quality)

    args.push(
      "-c:v",
      videoCodec,
      ...qualityParams,
      "-c:a",
      "copy",
      task.outputPath,
    )

    this.reportProgress(progressCallback, {
      percent: 40,
      step: "执行格式转换",
      details: `转换为 ${format} 格式`,
    })

    // 执行FFmpeg命令
    const ffmpegResult = await runFfmpegEx(args, {
      logProgress: this.config?.logLevel === "debug",
      encoder: this.config?.hardwareAcceleration
        ? this.getHardwareEncoder(videoCodec)
        : undefined,
    })

    if (!ffmpegResult.success) {
      throw new Error(`FFmpeg转换失败: ${ffmpegResult.error}`)
    }

    this.reportProgress(progressCallback, {
      percent: 90,
      step: "转换完成",
      details: "验证输出文件",
    })

    // 验证输出文件
    if (!existsSync(task.outputPath)) {
      throw new Error("转换后输出文件未创建")
    }

    return {
      success: true,
      outputPath: task.outputPath,
      statistics: {
        processingTime: 0,
        inputSize: await this.getFileSize(inputPath),
        outputSize: await this.getFileSize(task.outputPath),
      },
    }
  }

  private async processAnalyze(
    task: VideoEditTask,
    progressCallback?: ProgressCallback,
  ): Promise<PipelineResult> {
    this.reportProgress(progressCallback, {
      percent: 20,
      step: "准备分析参数",
      details: "初始化视频分析",
    })

    // 这里可以集成universal_video_analyzer工具
    // 目前先返回一个简单的分析结果
    const inputPath = task.inputPath as string

    // 获取视频信息
    const infoArgs = ["-i", inputPath]
    const ffmpegResult = await runFfmpegEx(infoArgs, {
      logProgress: false,
    })

    this.reportProgress(progressCallback, {
      percent: 60,
      step: "分析视频信息",
      details: "解析元数据",
    })

    // 简单解析视频信息
    const videoInfo = this.parseVideoInfo(ffmpegResult.output || "")

    this.reportProgress(progressCallback, {
      percent: 90,
      step: "分析完成",
      details: "生成分析报告",
    })

    return {
      success: true,
      outputData: {
        videoInfo,
        analysisType: "basic",
        timestamp: new Date().toISOString(),
      },
      statistics: {
        processingTime: 0,
        inputSize: await this.getFileSize(inputPath),
      },
    }
  }

  private getHardwareEncoder(codec: string): string | undefined {
    // 简单的硬件编码器映射
    const encoderMap: Record<string, string> = {
      libx264: "h264_nvenc",
      libx265: "hevc_nvenc",
      h264: "h264_nvenc",
      hevc: "hevc_nvenc",
    }
    return encoderMap[codec]
  }

  private getDefaultCodecForFormat(format: string): string {
    const codecMap: Record<string, string> = {
      mp4: "libx264",
      mov: "libx264",
      avi: "mpeg4",
      webm: "libvpx-vp9",
      gif: "gif",
    }
    return codecMap[format] || "libx264"
  }

  private getQualityParams(codec: string, quality: any): string[] {
    if (quality && typeof quality === "object") {
      const params: string[] = []
      if (quality.crf !== undefined) {
        params.push("-crf", quality.crf.toString())
      }
      if (quality.bitrate) {
        params.push("-b:v", quality.bitrate)
      }
      if (quality.preset) {
        params.push("-preset", quality.preset)
      }
      return params
    }

    // 默认质量参数
    if (codec.includes("264") || codec.includes("265")) {
      return ["-crf", "23", "-preset", "medium"]
    } else if (codec.includes("vp9")) {
      return ["-b:v", "1M", "-crf", "30"]
    } else {
      return []
    }
  }

  private parseVideoInfo(ffmpegOutput: string): any {
    const info: any = {
      duration: null,
      resolution: null,
      bitrate: null,
      codec: null,
    }

    // 简单解析FFmpeg输出
    const durationMatch = ffmpegOutput.match(
      /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
    )
    if (durationMatch) {
      const hours = parseInt(durationMatch[1])
      const minutes = parseInt(durationMatch[2])
      const seconds = parseFloat(durationMatch[3])
      info.duration = hours * 3600 + minutes * 60 + seconds
    }

    const resolutionMatch = ffmpegOutput.match(/(\d+)x(\d+)/)
    if (resolutionMatch) {
      info.resolution = {
        width: parseInt(resolutionMatch[1]),
        height: parseInt(resolutionMatch[2]),
      }
    }

    const bitrateMatch = ffmpegOutput.match(/bitrate: (\d+ kb\/s)/)
    if (bitrateMatch) {
      info.bitrate = bitrateMatch[1]
    }

    return info
  }

  private async getFileSize(filePath: string): Promise<number> {
    try {
      const fs = await import("fs")
      const stats = fs.statSync(filePath)
      return stats.size
    } catch {
      return 0
    }
  }

  private reportProgress(
    callback: ProgressCallback | undefined,
    progress: PipelineProgress,
  ): void {
    if (callback) {
      try {
        callback(progress)
      } catch (error) {
        console.error("进度回调错误:", error)
      }
    }
  }

  async warmup(): Promise<void> {
    console.log(`[${this.pipelineType}] 预热管道`)
    // 可以执行一个简单的测试命令来预热
  }

  async cleanup(): Promise<void> {
    console.log(`[${this.pipelineType}] 清理管道资源`)
    this.config = null
    this.ffmpegPath = null
  }
}

/**
 * FFmpeg导出管道 - 基于FFmpeg的视频导出和编码管道
 * 借鉴LTX的视频导出和编码逻辑，提供专业的视频导出功能
 */

import { existsSync } from "fs"
import path from "path"
import { findFfmpegPath, runFfmpegEx } from "../../tool/ffmpeg-utils.js"
import type {
  ExportOptions,
  ExportResult,
  PipelineConfig,
  PipelineProgress,
  PipelineResult,
  ProgressCallback,
  VideoEditTask,
  VideoExportPipeline,
} from "../pipeline.js"

export class FfmpegExportPipeline implements VideoExportPipeline {
  readonly pipelineType = "export"

  private config: PipelineConfig | null = null
  private ffmpegPath: string | null = null

  async create(config: PipelineConfig): Promise<VideoExportPipeline> {
    console.log(`[${this.pipelineType}] 创建导出管道实例`)
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
    // 对于转换操作，使用专门的export方法
    if (task.operation === "convert") {
      const exportOptions: ExportOptions = {
        format: task.parameters.format || "mp4",
        videoCodec:
          task.parameters.codec ||
          this.getDefaultCodecForFormat(task.parameters.format || "mp4"),
        audioCodec: task.parameters.audio_codec,
        quality: task.parameters.quality || { crf: 23, preset: "medium" },
        resolution: task.parameters.resolution,
        frameRate: task.parameters.frame_rate,
        hardwareAcceleration: task.parameters.hardware_acceleration,
      }

      return this.export(
        task.inputPath as string,
        exportOptions,
        progressCallback,
      )
    }

    throw new Error(`不支持的操作类型: ${task.operation}`)
  }

  async export(
    inputPath: string,
    exportOptions: ExportOptions,
    progressCallback?: ProgressCallback,
  ): Promise<ExportResult> {
    const startTime = Date.now()

    try {
      if (!this.config || !this.ffmpegPath) {
        throw new Error("管道未初始化，请先调用create()方法")
      }

      // 验证输入文件
      if (!existsSync(inputPath)) {
        throw new Error(`输入文件不存在: ${inputPath}`)
      }

      // 生成输出路径
      const outputPath = this.generateOutputPath(inputPath, exportOptions)

      this.reportProgress(progressCallback, {
        percent: 10,
        step: "准备导出参数",
        details: `格式: ${exportOptions.format}, 编码器: ${exportOptions.videoCodec}`,
      })

      // 获取原始文件信息
      const originalSize = await this.getFileSize(inputPath)

      // 构建FFmpeg参数
      const args = this.buildExportArgs(inputPath, outputPath, exportOptions)

      this.reportProgress(progressCallback, {
        percent: 20,
        step: "开始视频导出",
        details: "调用FFmpeg编码",
      })

      // 执行FFmpeg命令
      const ffmpegResult = await runFfmpegEx(args, {
        logProgress: this.config?.logLevel === "debug",
        encoder: exportOptions.hardwareAcceleration?.encoder,
        hwDevice: exportOptions.hardwareAcceleration?.device,
      })

      if (!ffmpegResult.success) {
        throw new Error(`FFmpeg导出失败: ${ffmpegResult.error}`)
      }

      this.reportProgress(progressCallback, {
        percent: 90,
        step: "导出完成",
        details: "验证输出文件",
      })

      // 验证输出文件
      if (!existsSync(outputPath)) {
        throw new Error("导出后输出文件未创建")
      }

      // 获取导出文件信息
      const exportedSize = await this.getFileSize(outputPath)
      const processingTime = Date.now() - startTime

      this.reportProgress(progressCallback, {
        percent: 100,
        step: "导出完成",
        details: `文件大小: ${this.formatFileSize(exportedSize)}`,
      })

      return {
        success: true,
        outputPath,
        exportStats: {
          originalSize,
          exportedSize,
          compressionRatio: exportedSize / originalSize,
          encodingTime: processingTime,
          encodingSpeed: await this.calculateEncodingSpeed(
            inputPath,
            processingTime,
          ),
        },
        statistics: {
          processingTime,
          inputSize: originalSize,
          outputSize: exportedSize,
        },
      }
    } catch (error: any) {
      this.reportProgress(progressCallback, {
        percent: 100,
        step: "导出失败",
        details: error.message,
      })

      return {
        success: false,
        error: error.message,
        exportStats: {
          originalSize: 0,
          exportedSize: 0,
          compressionRatio: 0,
          encodingTime: Date.now() - startTime,
          encodingSpeed: 0,
        },
        statistics: {
          processingTime: Date.now() - startTime,
          inputSize: 0,
        },
      }
    }
  }

  /**
   * 构建导出参数
   */
  private buildExportArgs(
    inputPath: string,
    outputPath: string,
    options: ExportOptions,
  ): string[] {
    const args: string[] = ["-i", inputPath]

    // 硬件加速配置
    if (options.hardwareAcceleration?.encoder) {
      const hwaccel = this.getHardwareAccelerationMethod(
        options.hardwareAcceleration.encoder,
      )
      if (hwaccel) {
        args.push("-hwaccel", hwaccel)
      }

      if (options.hardwareAcceleration.device !== undefined) {
        args.push(
          "-hwaccel_device",
          options.hardwareAcceleration.device.toString(),
        )
      }
    }

    // 视频编码参数
    args.push(
      "-c:v",
      options.hardwareAcceleration?.encoder || options.videoCodec,
    )

    // 质量参数
    if (options.quality) {
      if (options.quality.crf !== undefined) {
        args.push("-crf", options.quality.crf.toString())
      }
      if (options.quality.bitrate) {
        args.push("-b:v", options.quality.bitrate)
      }
      if (options.quality.preset) {
        args.push("-preset", options.quality.preset)
      }
    } else {
      // 默认质量参数
      args.push("-crf", "23", "-preset", "medium")
    }

    // 分辨率缩放
    if (options.resolution) {
      args.push(
        "-vf",
        `scale=${options.resolution.width}:${options.resolution.height}`,
      )
    }

    // 帧率设置
    if (options.frameRate) {
      args.push("-r", options.frameRate.toString())
    }

    // 音频编码参数
    if (options.audioCodec) {
      args.push("-c:a", options.audioCodec)
    } else {
      args.push("-c:a", "copy") // 保持原音频编码
    }

    // 输出格式
    if (options.format === "gif") {
      // GIF格式特殊处理
      args.push(
        "-filter_complex",
        "[0:v] split [a][b];[a] palettegen [p];[b][p] paletteuse",
      )
    }

    args.push(outputPath)

    return args
  }

  /**
   * 根据编码器获取硬件加速方法
   */
  private getHardwareAccelerationMethod(encoder: string): string | null {
    const accelerationMap: Record<string, string> = {
      h264_nvenc: "cuda",
      hevc_nvenc: "cuda",
      h264_qsv: "qsv",
      hevc_qsv: "qsv",
      h264_amf: "d3d11va",
      hevc_amf: "d3d11va",
      h264_vaapi: "vaapi",
      hevc_vaapi: "vaapi",
      h264_videotoolbox: "videotoolbox",
      hevc_videotoolbox: "videotoolbox",
    }

    return accelerationMap[encoder] || null
  }

  /**
   * 根据格式获取默认编码器
   */
  private getDefaultCodecForFormat(format: string): string {
    const codecMap: Record<string, string> = {
      mp4: "libx264",
      mov: "libx264",
      avi: "mpeg4",
      webm: "libvpx-vp9",
      gif: "gif",
      mkv: "libx264",
      flv: "libx264",
    }

    return codecMap[format] || "libx264"
  }

  /**
   * 生成输出路径
   */
  private generateOutputPath(
    inputPath: string,
    options: ExportOptions,
  ): string {
    const inputDir = path.dirname(inputPath)
    const inputName = path.basename(inputPath, path.extname(inputPath))

    // 添加格式和编码器信息
    let outputName = `${inputName}_export_${options.format}`

    if (options.resolution) {
      outputName += `_${options.resolution.width}x${options.resolution.height}`
    }

    if (options.quality?.crf) {
      outputName += `_crf${options.quality.crf}`
    }

    const extension =
      options.format === "webm"
        ? ".webm"
        : options.format === "mov"
          ? ".mov"
          : options.format === "avi"
            ? ".avi"
            : options.format === "gif"
              ? ".gif"
              : ".mp4"

    return path.join(inputDir, outputName + extension)
  }

  /**
   * 计算编码速度（帧/秒）
   */
  private async calculateEncodingSpeed(
    inputPath: string,
    encodingTime: number,
  ): Promise<number> {
    try {
      // 获取视频时长和帧率信息
      const videoInfo = await this.getVideoInfo(inputPath)

      if (videoInfo.duration && videoInfo.frameRate) {
        const totalFrames = videoInfo.duration * videoInfo.frameRate
        return totalFrames / (encodingTime / 1000) // 帧/秒
      }
    } catch (error) {
      console.warn(`无法计算编码速度: ${error}`)
    }

    return 0
  }

  /**
   * 获取视频信息
   */
  private async getVideoInfo(
    videoPath: string,
  ): Promise<{ duration: number; frameRate: number }> {
    try {
      const infoArgs = ["-i", videoPath]
      const ffmpegResult = await runFfmpegEx(infoArgs, {
        logProgress: false,
      })

      if (ffmpegResult.output) {
        const durationMatch = ffmpegResult.output.match(
          /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
        )
        const frameRateMatch = ffmpegResult.output.match(/(\d+(\.\d+)?) fps/)

        let duration = 0
        let frameRate = 30 // 默认值

        if (durationMatch) {
          const hours = parseInt(durationMatch[1])
          const minutes = parseInt(durationMatch[2])
          const seconds = parseFloat(durationMatch[3])
          duration = hours * 3600 + minutes * 60 + seconds
        }

        if (frameRateMatch) {
          frameRate = parseFloat(frameRateMatch[1])
        }

        return { duration, frameRate }
      }
    } catch (error) {
      console.warn(`获取视频信息失败: ${error}`)
    }

    return { duration: 0, frameRate: 30 }
  }

  /**
   * 获取文件大小
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const fs = await import("fs")
      const stats = fs.statSync(filePath)
      return stats.size
    } catch {
      return 0
    }
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B"

    const k = 1024
    const sizes = ["B", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i]
  }

  /**
   * 报告进度
   */
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
    console.log(`[${this.pipelineType}] 预热导出管道`)
    // 可以执行测试编码来预热
  }

  async cleanup(): Promise<void> {
    console.log(`[${this.pipelineType}] 清理导出管道资源`)
    this.config = null
    this.ffmpegPath = null
  }
}

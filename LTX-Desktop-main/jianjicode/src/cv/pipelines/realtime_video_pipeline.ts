/**
 * 实时视频分析管道
 * 支持从视频文件中提取帧并进行实时CV分析
 */

import { spawn, spawnSync } from "child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { basename, dirname, extname, join } from "path"
import { fileURLToPath } from "url"
import { cvModelProviderManager } from "../providers/manager.js"
import type {
  CVAnalysisType,
  DepthEstimationRequest,
  PoseEstimationRequest,
} from "../types/index.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 视频分析配置
 */
export interface VideoAnalysisConfig {
  /** 分析类型列表 */
  analysisTypes: CVAnalysisType[]
  /** 帧提取间隔（秒） */
  frameInterval: number
  /** 最大分析帧数（0表示无限制） */
  maxFrames: number
  /** 输出格式：'video' - 带标注的视频，'images' - 标注图像，'json' - JSON报告 */
  outputFormat: "video" | "images" | "json"
  /** 输出目录 */
  outputDir: string
  /** CV模型提供商ID */
  provider?: string
  /** 计算设备 */
  device?: "cpu" | "cuda" | "mps"
  /** 是否保持临时文件 */
  keepTempFiles?: boolean
}

/**
 * 视频分析结果
 */
export interface VideoAnalysisResult {
  /** 输入视频文件路径 */
  inputVideo: string
  /** 总帧数 */
  totalFrames: number
  /** 已分析帧数 */
  analyzedFrames: number
  /** 分析类型 */
  analysisTypes: CVAnalysisType[]
  /** 每帧结果 */
  frameResults: FrameAnalysisResult[]
  /** 汇总统计 */
  summary: AnalysisSummary
  /** 输出文件路径 */
  outputFiles: string[]
  /** 处理时间（毫秒） */
  processingTime: number
}

/**
 * 单帧分析结果
 */
export interface FrameAnalysisResult {
  /** 帧索引 */
  frameIndex: number
  /** 时间戳（秒） */
  timestamp: number
  /** 深度估计结果（如有） */
  depth?: DepthEstimationResult
  /** 姿态估计结果（如有） */
  pose?: PoseEstimationResult
  /** 分析错误（如有） */
  error?: string
}

/**
 * 深度估计结果
 */
export interface DepthEstimationResult {
  minDepth: number
  maxDepth: number
  meanDepth: number
  depthMap?: string // base64编码的深度图
  processingTime: number
}

/**
 * 姿态估计结果
 */
export interface PoseEstimationResult {
  persons: PersonPose[]
  annotatedImage?: string // base64编码的标注图像
  processingTime: number
}

/**
 * 人物姿态
 */
export interface PersonPose {
  bbox: {
    x: number
    y: number
    width: number
    height: number
    confidence: number
  }
  keypoints: Array<{ name: string; x: number; y: number; confidence: number }>
}

/**
 * 分析汇总
 */
export interface AnalysisSummary {
  averageDepth?: number
  depthRange?: { min: number; max: number }
  totalPersons?: number
  averagePersonsPerFrame?: number
  errors: number
}

/**
 * 实时视频分析管道
 */
export class RealtimeVideoPipeline {
  private ffmpegPath: string | null = null

  /**
   * 初始化管道
   */
  async initialize(): Promise<void> {
    this.ffmpegPath = await this.findFfmpegPath()
    if (!this.ffmpegPath) {
      throw new Error(
        "FFmpeg not found. Please install FFmpeg or ensure it is in PATH.",
      )
    }
  }

  /**
   * 分析视频文件
   */
  async analyzeVideo(
    videoPath: string,
    config: VideoAnalysisConfig,
  ): Promise<VideoAnalysisResult> {
    const startTime = Date.now()

    // 验证输入文件
    if (!existsSync(videoPath)) {
      throw new Error(`Video file not found: ${videoPath}`)
    }

    // 创建输出目录
    if (!existsSync(config.outputDir)) {
      mkdirSync(config.outputDir, { recursive: true })
    }

    // 获取视频信息
    const videoInfo = await this.getVideoInfo(videoPath)
    const totalFrames = this.calculateTotalFrames(videoInfo)

    // 计算要提取的帧
    const frameIndices = this.calculateFrameIndices(videoInfo, config)
    console.log(`📹 视频分析: ${basename(videoPath)}`)
    console.log(`   - 总时长: ${videoInfo.duration?.toFixed(2) || "N/A"}秒`)
    console.log(`   - 总帧数: ${totalFrames}`)
    console.log(`   - 分析帧数: ${frameIndices.length}`)
    console.log(`   - 分析类型: ${config.analysisTypes.join(", ")}`)

    // 提取帧
    const tempDir = join(config.outputDir, "temp_frames")
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    const frameFiles = await this.extractFrames(
      videoPath,
      frameIndices,
      tempDir,
    )
    console.log(`   - 已提取 ${frameFiles.length} 帧到临时目录`)

    // 分析每一帧
    const frameResults: FrameAnalysisResult[] = []
    let errorCount = 0

    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i]
      const frameIndex = frameIndices[i]
      const timestamp = this.calculateTimestamp(frameIndex, videoInfo)

      console.log(
        `   🔍 分析帧 ${i + 1}/${frameFiles.length} (时间: ${timestamp.toFixed(2)}s)`,
      )

      try {
        const frameResult: FrameAnalysisResult = {
          frameIndex,
          timestamp,
          depth: undefined,
          pose: undefined,
        }

        // 读取帧图像为base64
        const frameData = await this.readImageAsBase64(frameFile)

        // 执行深度估计
        if (config.analysisTypes.includes("depth_estimation")) {
          try {
            const depthResult = await this.estimateDepth(frameData, config)
            frameResult.depth = depthResult
          } catch (depthError: any) {
            console.log(`     ❌ 深度估计失败: ${depthError.message}`)
          }
        }

        // 执行姿态估计
        if (config.analysisTypes.includes("pose_estimation")) {
          try {
            const poseResult = await this.estimatePose(frameData, config)
            frameResult.pose = poseResult
          } catch (poseError: any) {
            console.log(`     ❌ 姿态估计失败: ${poseError.message}`)
          }
        }

        frameResults.push(frameResult)
      } catch (error: any) {
        console.log(`     ❌ 帧分析失败: ${error.message}`)
        errorCount++
        frameResults.push({
          frameIndex,
          timestamp,
          error: error.message,
        })
      }

      // 清理临时帧文件（如果不保留）
      if (!config.keepTempFiles) {
        try {
          unlinkSync(frameFile)
        } catch (e) {
          // 忽略清理错误
        }
      }
    }

    // 清理临时目录
    if (!config.keepTempFiles) {
      try {
        const fs = await import("fs")
        fs.rmSync(tempDir, { recursive: true, force: true })
      } catch (e) {
        // 忽略清理错误
      }
    }

    // 生成汇总统计
    const summary = this.generateSummary(frameResults, config.analysisTypes)

    // 生成输出文件
    const outputFiles = await this.generateOutputs(
      videoPath,
      frameResults,
      config,
      videoInfo,
    )

    const processingTime = Date.now() - startTime

    console.log(`✅ 视频分析完成 (耗时: ${processingTime}ms)`)
    console.log(`   - 成功分析: ${frameResults.length - errorCount} 帧`)
    console.log(`   - 错误: ${errorCount}`)
    console.log(`   - 输出文件: ${outputFiles.length} 个`)

    return {
      inputVideo: videoPath,
      totalFrames,
      analyzedFrames: frameResults.length,
      analysisTypes: config.analysisTypes,
      frameResults,
      summary: {
        ...summary,
        errors: errorCount,
      },
      outputFiles,
      processingTime,
    }
  }

  /**
   * 查找FFmpeg路径
   */
  private async findFfmpegPath(): Promise<string | null> {
    // 首先检查环境变量
    const envPath =
      process.env.JIANJICODE_FFMPEG_PATH || process.env.FFMPEG_PATH
    if (envPath && existsSync(envPath)) {
      return envPath
    }

    // 检查是否在PATH中
    try {
      const { execSync } = await import("child_process")
      execSync("ffmpeg -version", { stdio: "ignore" })
      return "ffmpeg"
    } catch {
      // 尝试使用ffmpeg-static包
      try {
        const ffmpegStatic = await import("ffmpeg-static")
        if (
          ffmpegStatic &&
          ffmpegStatic.default &&
          typeof ffmpegStatic.default === "string"
        ) {
          const staticPath = ffmpegStatic.default as string
          if (existsSync(staticPath)) {
            return staticPath
          }
        }
      } catch (staticError) {
        // 忽略并回退到路径搜索
        console.log(
          "[ffmpeg] ffmpeg-static import failed, falling back:",
          (staticError as Error).message,
        )
      }

      // 尝试在常见位置查找ffmpeg
      const platform = process.platform
      const possiblePaths = [
        join(
          __dirname,
          "..",
          "..",
          "..",
          "resources",
          "ffmpeg",
          platform,
          platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
        ),
        join(
          process.cwd(),
          "resources",
          "ffmpeg",
          platform,
          platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
        ),
        join(
          __dirname,
          "..",
          "..",
          "..",
          "node_modules",
          "ffmpeg-static",
          platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
        ),
        join(
          process.cwd(),
          "node_modules",
          "ffmpeg-static",
          platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
        ),
        // Windows常见位置
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
        "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        // macOS/Linux常见位置
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
      ]

      for (const path of possiblePaths) {
        if (existsSync(path)) {
          return path
        }
      }

      return null
    }
  }

  /**
   * 获取视频信息
   */
  private async getVideoInfo(videoPath: string): Promise<any> {
    if (!this.ffmpegPath) {
      throw new Error("FFmpeg not initialized")
    }

    // 使用ffprobe（如果可用）
    const probePath = this.ffmpegPath.replace("ffmpeg", "ffprobe")
    const probeExists = existsSync(probePath) || this.ffmpegPath === "ffmpeg"

    if (probeExists) {
      const cmd = this.ffmpegPath === "ffmpeg" ? "ffprobe" : probePath
      const result = spawnSync(
        cmd,
        [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          videoPath,
        ],
        { encoding: "utf8" },
      )

      if (result.status === 0) {
        return JSON.parse(result.stdout)
      }
    }

    // 回退：使用ffmpeg获取基本信息
    const result = spawnSync(this.ffmpegPath, ["-i", videoPath], {
      encoding: "utf8",
    })
    const output = (result.stdout || "") + (result.stderr || "")

    // 解析输出获取基本信息
    const durationMatch = output.match(
      /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
    )
    const frameRateMatch = output.match(/(\d+(\.\d+)?) fps/)
    const resolutionMatch = output.match(/(\d+)x(\d+)/)

    const duration = durationMatch
      ? parseInt(durationMatch[1]) * 3600 +
        parseInt(durationMatch[2]) * 60 +
        parseFloat(durationMatch[3])
      : 0

    const fps = frameRateMatch ? parseFloat(frameRateMatch[1]) : 30
    const width = resolutionMatch ? parseInt(resolutionMatch[1]) : 1920
    const height = resolutionMatch ? parseInt(resolutionMatch[2]) : 1080

    return {
      format: { duration: duration.toString() },
      streams: [
        {
          codec_type: "video",
          width,
          height,
          r_frame_rate: `${fps}/1`,
        },
      ],
      duration,
      fps,
      width,
      height,
    }
  }

  /**
   * 计算总帧数
   */
  private calculateTotalFrames(videoInfo: any): number {
    const duration = parseFloat(
      videoInfo.format?.duration || videoInfo.duration || 0,
    )
    const fps = this.extractFPS(videoInfo)
    return Math.floor(duration * fps)
  }

  /**
   * 提取帧率
   */
  private extractFPS(videoInfo: any): number {
    const videoStream = (videoInfo.streams || []).find(
      (s: any) => s.codec_type === "video",
    )
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/")
      return den ? parseFloat(num) / parseFloat(den) : parseFloat(num)
    }
    return 30 // 默认帧率
  }

  /**
   * 计算要提取的帧索引
   */
  private calculateFrameIndices(
    videoInfo: any,
    config: VideoAnalysisConfig,
  ): number[] {
    const totalFrames = this.calculateTotalFrames(videoInfo)
    const fps = this.extractFPS(videoInfo)
    const frameIntervalFrames = Math.floor(config.frameInterval * fps)

    const indices: number[] = []

    if (config.maxFrames > 0 && config.maxFrames < totalFrames) {
      // 均匀采样指定数量的帧
      const step = Math.floor(totalFrames / config.maxFrames)
      for (let i = 0; i < config.maxFrames && i * step < totalFrames; i++) {
        indices.push(Math.min(i * step, totalFrames - 1))
      }
    } else if (frameIntervalFrames > 0) {
      // 按时间间隔采样
      for (let i = 0; i < totalFrames; i += frameIntervalFrames) {
        indices.push(i)
      }
    } else {
      // 默认：每秒1帧
      const step = Math.floor(fps)
      for (let i = 0; i < totalFrames; i += step) {
        indices.push(i)
      }
    }

    return indices
  }

  /**
   * 计算时间戳
   */
  private calculateTimestamp(frameIndex: number, videoInfo: any): number {
    const fps = this.extractFPS(videoInfo)
    return frameIndex / fps
  }

  /**
   * 提取帧
   */
  private async extractFrames(
    videoPath: string,
    frameIndices: number[],
    outputDir: string,
  ): Promise<string[]> {
    if (!this.ffmpegPath) {
      throw new Error("FFmpeg not initialized")
    }

    const frameFiles: string[] = []

    // 为每个帧索引提取一帧
    for (let i = 0; i < frameIndices.length; i++) {
      const frameIndex = frameIndices[i]
      const outputFile = join(
        outputDir,
        `frame_${i.toString().padStart(5, "0")}.jpg`,
      )

      const fps = 30 // 假设帧率
      const timestamp = frameIndex / fps
      const hh = Math.floor(timestamp / 3600)
      const mm = Math.floor((timestamp % 3600) / 60)
      const ss = timestamp % 60
      const timeStr = `${hh.toString().padStart(2, "0")}:${mm.toString().padStart(2, "0")}:${ss.toFixed(3)}`

      const args = [
        "-i",
        videoPath,
        "-ss",
        timeStr,
        "-vframes",
        "1",
        "-q:v",
        "2", // 高质量JPEG
        "-y",
        outputFile,
      ]

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.ffmpegPath!, args)
        proc.on("close", (code) => {
          if (code === 0) {
            if (existsSync(outputFile)) {
              frameFiles.push(outputFile)
              resolve()
            } else {
              reject(
                new Error(`Frame extraction failed: ${outputFile} not created`),
              )
            }
          } else {
            reject(new Error(`FFmpeg failed with code ${code}`))
          }
        })
        proc.on("error", reject)
      })
    }

    return frameFiles
  }

  /**
   * 读取图像为base64
   */
  private async readImageAsBase64(filePath: string): Promise<string> {
    const data = readFileSync(filePath)
    const base64 = data.toString("base64")
    return `data:image/jpeg;base64,${base64}`
  }

  /**
   * 估计深度
   */
  private async estimateDepth(
    imageData: string,
    config: VideoAnalysisConfig,
  ): Promise<DepthEstimationResult> {
    const provider = config.provider || "midas-dpt"

    const request: DepthEstimationRequest = {
      image: {
        type: "base64" as const,
        data: imageData,
        format: "jpg" as const,
      },
      model: "midas",
      outputFormat: "colormap",
      normalize: true,
      colormap: "inferno",
      device: config.device || "cpu",
    }

    const startTime = Date.now()
    const result = await cvModelProviderManager.estimateDepth(request, provider)
    const processingTime = Date.now() - startTime

    return {
      minDepth: result.minDepth || 0,
      maxDepth: result.maxDepth || 0,
      meanDepth: result.meanDepth || 0,
      depthMap: result.depthMap,
      processingTime,
    }
  }

  /**
   * 估计姿态
   */
  private async estimatePose(
    imageData: string,
    config: VideoAnalysisConfig,
  ): Promise<PoseEstimationResult> {
    const provider = config.provider || "dw-pose"

    const request: PoseEstimationRequest = {
      image: {
        type: "base64" as const,
        data: imageData,
        format: "jpg" as const,
      },
      model: "dwpose",
      detectMultiplePersons: true,
      includeHands: true,
      includeFace: true,
      confidenceThreshold: 0.3,
      renderStyle: "openpose",
      device: config.device || "cpu",
    }

    const startTime = Date.now()
    const result = await cvModelProviderManager.estimatePose(request, provider)
    const processingTime = Date.now() - startTime

    return {
      persons: result.persons.map((person) => ({
        bbox: {
          x: person.bbox?.x || 0,
          y: person.bbox?.y || 0,
          width: person.bbox?.width || 0,
          height: person.bbox?.height || 0,
          confidence: person.bbox?.confidence || 0,
        },
        keypoints:
          person.keypoints?.map((kp) => ({
            name: kp?.name || "",
            x: kp?.x || 0,
            y: kp?.y || 0,
            confidence: kp?.confidence || 0,
            id: kp?.id,
          })) || [],
      })),
      annotatedImage: result.annotatedImage,
      processingTime,
    }
  }

  /**
   * 生成汇总统计
   */
  private generateSummary(
    frameResults: FrameAnalysisResult[],
    analysisTypes: CVAnalysisType[],
  ): AnalysisSummary {
    const summary: AnalysisSummary = {
      errors: 0,
    }

    // 深度统计
    if (analysisTypes.includes("depth_estimation")) {
      const depths = frameResults
        .filter((r) => r.depth)
        .map((r) => r.depth!.meanDepth)

      if (depths.length > 0) {
        summary.averageDepth = depths.reduce((a, b) => a + b, 0) / depths.length
        summary.depthRange = {
          min: Math.min(...depths),
          max: Math.max(...depths),
        }
      }
    }

    // 姿态统计
    if (analysisTypes.includes("pose_estimation")) {
      const personCounts = frameResults
        .filter((r) => r.pose)
        .map((r) => r.pose!.persons.length)

      if (personCounts.length > 0) {
        summary.totalPersons = personCounts.reduce((a, b) => a + b, 0)
        summary.averagePersonsPerFrame =
          summary.totalPersons / personCounts.length
      }
    }

    return summary
  }

  /**
   * 生成输出文件
   */
  private async generateOutputs(
    videoPath: string,
    frameResults: FrameAnalysisResult[],
    config: VideoAnalysisConfig,
    videoInfo: any,
  ): Promise<string[]> {
    const outputFiles: string[] = []
    const videoName = basename(videoPath, extname(videoPath))

    switch (config.outputFormat) {
      case "json": {
        // 生成JSON报告
        const report = {
          video: videoPath,
          analysisTypes: config.analysisTypes,
          frameResults,
          summary: this.generateSummary(frameResults, config.analysisTypes),
          timestamp: new Date().toISOString(),
        }
        const reportPath = join(
          config.outputDir,
          `${videoName}_analysis_report.json`,
        )
        writeFileSync(reportPath, JSON.stringify(report, null, 2))
        outputFiles.push(reportPath)
        break
      }

      case "images":
        // 保存带标注的图像
        for (let i = 0; i < frameResults.length; i++) {
          const result = frameResults[i]
          if (result.pose?.annotatedImage) {
            const imagePath = join(
              config.outputDir,
              `${videoName}_frame_${i.toString().padStart(4, "0")}_pose.jpg`,
            )
            await this.saveBase64Image(result.pose.annotatedImage, imagePath)
            outputFiles.push(imagePath)
          }
          if (result.depth?.depthMap) {
            const imagePath = join(
              config.outputDir,
              `${videoName}_frame_${i.toString().padStart(4, "0")}_depth.jpg`,
            )
            await this.saveBase64Image(result.depth.depthMap, imagePath)
            outputFiles.push(imagePath)
          }
        }
        break

      case "video":
        // 生成带标注的视频（简化版本）
        console.log("⚠️  视频输出功能正在开发中，目前保存为图像序列")
        // 临时实现：保存为图像序列
        for (let i = 0; i < frameResults.length; i++) {
          const result = frameResults[i]
          if (result.pose?.annotatedImage) {
            const imagePath = join(
              config.outputDir,
              `${videoName}_frame_${i.toString().padStart(4, "0")}_pose.jpg`,
            )
            await this.saveBase64Image(result.pose.annotatedImage, imagePath)
            outputFiles.push(imagePath)
          }
        }
        break
    }

    return outputFiles
  }

  /**
   * 保存base64图像
   */
  private async saveBase64Image(
    base64Data: string,
    outputPath: string,
  ): Promise<void> {
    // 移除data URL前缀
    const data = base64Data.replace(/^data:image\/\w+;base64,/, "")
    const buffer = Buffer.from(data, "base64")

    const dir = dirname(outputPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(outputPath, buffer)
  }
}

/**
 * 创建实时视频分析管道实例
 */
export async function createRealtimeVideoPipeline(): Promise<RealtimeVideoPipeline> {
  const pipeline = new RealtimeVideoPipeline()
  await pipeline.initialize()
  return pipeline
}

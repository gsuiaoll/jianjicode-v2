/**
 * 篮球投篮检测工具 - 使用 AI 分析篮球视频，识别投篮成功和失败的片段
 *
 * 功能:
 * 1. 从篮球视频中提取关键帧
 * 2. 使用多模态 AI 模型分析帧内容
 * 3. 识别投篮动作、成功投篮和失败投篮
 * 4. 返回投篮片段的时间戳和分类
 */

import { generateText } from "ai"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { basename, dirname, join } from "path"
import z from "zod"
import { SimpleProvider } from "../../ai/provider/simple-provider.js"
import { cvModelProviderManager } from "../cv/providers/manager.js"
import { configureDefaultCVProviders } from "../cv/providers/registry.js"
import {
  detectBestHardwareAcceleration,
  type FfmpegOptions,
  runFfmpegEx,
} from "./ffmpeg-utils.js"
import { Tool } from "./tool.js"

/**
 * 篮球投篮检测工具
 */
export const BasketballShotDetectionTool = Tool.define(
  "basketball_shot_detection",
  {
    description:
      "使用 AI 分析篮球视频，识别投篮成功和失败的片段，自动标记没投中的片段",
    parameters: z.object({
      // 输入输出
      input: z.string().describe("输入篮球视频文件路径"),
      output: z
        .string()
        .optional()
        .describe("输出 JSON 文件路径 (默认: <input>_shots.json)"),

      // 帧提取参数
      frame_rate: z
        .number()
        .min(0.1)
        .max(10)
        .optional()
        .default(2)
        .describe("每秒提取的帧数 (篮球视频建议: 2帧/秒)"),
      frame_quality: z
        .number()
        .min(1)
        .max(31)
        .optional()
        .default(3)
        .describe("JPEG 帧质量 (1-31，越低质量越好，默认: 3)"),
      max_frames: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe(
          "最大分析帧数 (限制分析的帧数以加快测试，不设置则分析所有帧)",
        ),

      // 硬件加速参数
      hardware_acceleration: z
        .boolean()
        .optional()
        .default(true)
        .describe("启用硬件加速 (自动检测最佳方法，默认开启)"),
      hwaccel: z
        .string()
        .optional()
        .describe(
          "硬件加速方法 (cuda, dxva2, qsv, vaapi, videotoolbox, d3d11va, opencl)",
        ),
      encoder: z
        .string()
        .optional()
        .describe(
          "硬件编码器 (h264_nvenc, h264_qsv, h264_amf, h264_vaapi, h264_videotoolbox)",
        ),
      hw_device: z.number().optional().describe("硬件设备索引 (多GPU系统)"),

      // AI 分析参数
      provider: z
        .string()
        .optional()
        .default("deepseek")
        .describe(
          "AI 提供商: deepseek, openai, anthropic, google, openrouter, vercel, azure, custom",
        ),
      model: z
        .string()
        .optional()
        .default("deepseek-chat")
        .describe(
          "AI 模型: deepseek-chat, gpt-4o, claude-3.5-sonnet, gemini-2.0-flash, 等",
        ),
      api_key: z
        .string()
        .optional()
        .describe("API 密钥 (可选，默认使用环境变量)"),
      api_base_url: z
        .string()
        .optional()
        .describe("自定义 API 基础 URL (用于 OpenAI 兼容端点)"),

      // LTX 视觉分析参数
      use_ltx_analysis: z
        .boolean()
        .optional()
        .default(false)
        .describe("启用 LTX 视觉分析 (使用 DW Pose 姿态估计和物体检测)"),
      pose_model: z
        .string()
        .optional()
        .default("dwpose")
        .describe("姿态估计模型: dwpose, openpose, wholebody"),
      pose_confidence_threshold: z
        .number()
        .min(0.1)
        .max(1)
        .optional()
        .default(0.3)
        .describe("姿态估计置信度阈值 (0.1-1，默认: 0.3)"),
      max_pose_frames: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("最大姿态估计帧数 (限制分析帧数以节省时间)"),

      // 批处理参数
      batch_size: z
        .number()
        .min(5)
        .max(100)
        .optional()
        .default(40)
        .describe(
          "批处理大小 (每批处理的帧数，默认: 40，根据AI模型token限制调整)",
        ),

      // 检测选项
      detect_shots: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否检测投篮动作"),
      detect_makes: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否检测成功投篮"),
      detect_misses: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否检测失败投篮"),
      min_shot_duration: z
        .number()
        .min(0.5)
        .max(10)
        .optional()
        .default(2)
        .describe("最小投篮片段持续时间 (秒，默认: 2)"),
      confidence_threshold: z
        .number()
        .min(0.1)
        .max(1)
        .optional()
        .default(0.6)
        .describe("置信度阈值 (0.1-1，默认: 0.6)"),

      // 输出选项
      include_frame_previews: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否在输出中包含帧预览 (base64)"),
      generate_summary: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否生成视频内容摘要"),
      mark_misses_for_editing: z
        .boolean()
        .optional()
        .default(true)
        .describe("是否标记没投中的片段用于后续剪辑"),

      // R3D深度学习模型参数
      use_r3d_model: z
        .boolean()
        .optional()
        .default(false)
        .describe("启用R3D深度学习模型分析 (使用PyTorch R3D-18模型)"),
      r3d_device: z
        .string()
        .optional()
        .default("auto")
        .describe("R3D模型设备类型: auto, cuda, cpu"),
      r3d_num_frames: z
        .number()
        .min(4)
        .max(64)
        .optional()
        .default(16)
        .describe("R3D分析的帧数 (默认: 16)"),
      r3d_confidence_threshold: z
        .number()
        .min(0.01)
        .max(1)
        .optional()
        .default(0.1)
        .describe("R3D篮球动作置信度阈值 (默认: 0.1)"),
      r3d_batch_size: z
        .number()
        .min(1)
        .max(16)
        .optional()
        .default(4)
        .describe("R3D批处理大小 (默认: 4)"),

      // 安全参数
      allow_overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否允许覆盖已存在的输出文件 (默认: false)"),
      temp_dir: z
        .string()
        .optional()
        .describe("临时文件目录 (默认: 系统临时目录)"),
    }),

    execute: async (args: any, ctx: any) => {
      try {
        // 1. 验证输入文件
        if (!existsSync(args.input)) {
          return {
            title: "篮球投篮检测失败",
            metadata: { operation: "basketball_shot_detection", error: true },
            output: `输入文件不存在: ${args.input}`,
          }
        }

        // 2. 创建临时目录
        const tempDir =
          args.temp_dir ||
          join(dirname(args.input), `.shot_detection_${Date.now()}`)
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true })
        }

        // 3. 提取关键帧
        console.log(`[BasketballShotDetection] 从篮球视频提取关键帧...`)
        const frameRate = args.frame_rate || 2
        const frameQuality = args.frame_quality || 3
        console.log(
          `[BasketballShotDetection] 参数: frameRate=${frameRate}, frameQuality=${frameQuality}`,
        )

        // 配置硬件加速选项（帧提取只需要解码加速，不需要编码器）
        const hardwareAccelerationEnabled = args.hardware_acceleration !== false // 默认启用，除非显式设置为 false
        const ffmpegOptions: FfmpegOptions = {}

        if (hardwareAccelerationEnabled) {
          // 自动检测最佳硬件加速方法
          const bestHw = detectBestHardwareAcceleration()

          if (bestHw.hwaccel) {
            ffmpegOptions.hwaccel = bestHw.hwaccel
            console.log(
              `[BasketballShotDetection] 使用硬件加速: ${bestHw.hwaccel}`,
            )
          }

          // 帧提取不需要编码器，只使用硬件解码加速
          // 不设置 ffmpegOptions.encoder，避免在帧提取命令中添加 -c:v

          if (args.hw_device !== undefined) {
            ffmpegOptions.hwDevice = args.hw_device
          }
        } else if (args.hwaccel) {
          // 即使硬件加速未启用，也允许手动指定硬件加速方法
          if (args.hwaccel) {
            ffmpegOptions.hwaccel = args.hwaccel
          }
          if (args.hw_device !== undefined) {
            ffmpegOptions.hwDevice = args.hw_device
          }
          // 帧提取不设置编码器
        }

        const frames = await extractKeyFrames(
          args.input,
          tempDir,
          frameRate,
          frameQuality,
          ffmpegOptions,
          args.max_frames,
        )

        if (frames.length === 0) {
          return {
            title: "篮球投篮检测失败",
            metadata: { operation: "basketball_shot_detection", error: true },
            output: "无法从视频中提取关键帧",
          }
        }

        console.log(
          `[BasketballShotDetection] 提取了 ${frames.length} 个关键帧`,
        )

        // 4. 使用 AI 分析帧 (篮球特定分析)
        console.log(`[BasketballShotDetection] 使用 AI 分析篮球投篮内容...`)
        let analysisResult = await analyzeBasketballFramesWithAI(frames, args)

        // 4.1 如果启用R3D模型，进行深度学习分析
        if (args.use_r3d_model) {
          try {
            console.log(`[BasketballShotDetection] 启用R3D深度学习模型分析...`)
            const r3dResult = await analyzeWithR3D(args.input, args)

            // 合并R3D结果与AI分析结果
            analysisResult = mergeR3DWithAIResults(
              analysisResult,
              r3dResult,
              args,
            )
            console.log(`[BasketballShotDetection] R3D分析完成并合并`)
          } catch (r3dError: any) {
            console.error(
              `[BasketballShotDetection] R3D分析失败，继续使用AI分析: ${r3dError.message}`,
            )
            // 继续使用AI分析结果
          }
        }

        // 5. 后处理：识别投篮片段
        console.log(`[BasketballShotDetection] 识别投篮片段...`)
        const shotSegments = detectShotSegments(analysisResult, args)

        // 6. 标记没投中的片段
        const missSegments = shotSegments.filter(
          (s: any) => s.shot_result === "miss",
        )
        const makeSegments = shotSegments.filter(
          (s: any) => s.shot_result === "make",
        )
        const shotAttemptSegments = shotSegments.filter(
          (s: any) => s.shot_result === "attempt" || !s.shot_result,
        )

        // 7. 生成输出
        const outputPath =
          args.output || `${args.input.replace(/\.[^/.]+$/, "")}_shots.json`

        // 安全检查
        if (!args.allow_overwrite && existsSync(outputPath)) {
          return {
            title: "安全验证失败",
            metadata: {
              operation: "basketball_shot_detection",
              error: true,
              success: false,
            },
            output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
          }
        }

        const result = {
          video_path: args.input,
          total_frames_analyzed: frames.length,
          total_shots_detected: shotSegments.length,
          makes_detected: makeSegments.length,
          misses_detected: missSegments.length,
          shot_attempts_detected: shotAttemptSegments.length,
          shot_segments: shotSegments,
          miss_segments_for_editing: args.mark_misses_for_editing
            ? missSegments
            : [],
          analysis_summary: args.generate_summary
            ? analysisResult.summary
            : undefined,
          detection_settings: {
            frame_rate: args.frame_rate,
            detect_shots: args.detect_shots,
            detect_makes: args.detect_makes,
            detect_misses: args.detect_misses,
            min_shot_duration: args.min_shot_duration,
            confidence_threshold: args.confidence_threshold,
          },
          // LTX 视觉分析信息
          ltx_analysis_used: args.use_ltx_analysis || false,
          ltx_pose_model: args.pose_model || "dwpose",
          ltx_confidence_threshold: args.pose_confidence_threshold || 0.3,
          ltx_analysis_info: analysisResult.ltx_analysis_info || undefined,
          ltx_frames_analyzed:
            analysisResult.pose_estimation_results?.frames_analyzed || 0,
          ltx_features_extracted:
            analysisResult.pose_estimation_results?.total_persons_detected || 0,
          // R3D深度学习模型信息
          r3d_analysis_used: args.use_r3d_model || false,
          r3d_device: analysisResult.r3d_analysis?.device || "未使用",
          r3d_inference_time: analysisResult.r3d_analysis?.inference_time || 0,
          r3d_basketball_detected:
            analysisResult.r3d_analysis?.has_basketball_action || false,
          r3d_top_predictions:
            analysisResult.r3d_analysis?.top_predictions || [],
          r3d_basketball_predictions:
            analysisResult.r3d_analysis?.basketball_predictions || [],
          r3d_confidence_threshold: args.r3d_confidence_threshold || 0.1,
          timestamp: new Date().toISOString(),
        }

        // 写入 JSON 文件
        writeFileSync(outputPath, JSON.stringify(result, null, 2))

        // 8. 清理临时文件
        try {
          for (const frame of frames) {
            if (existsSync(frame.path)) {
              unlinkSync(frame.path)
            }
          }
          if (existsSync(tempDir)) {
            // 仅删除空目录
            try {
              const files = readdirSync(tempDir)
              if (files.length === 0) {
                rmdirSync(tempDir)
              }
            } catch (e) {
              // 忽略
            }
          }
        } catch (cleanupError) {
          console.warn(
            `[BasketballShotDetection] 临时文件清理失败: ${cleanupError}`,
          )
        }

        // 9. 返回结果
        const makeDescriptions = makeSegments
          .map(
            (s: any, i: number) =>
              `✅ 成功 ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - 置信度: ${s.confidence.toFixed(2)}`,
          )
          .join("\n")

        const missDescriptions = missSegments
          .map(
            (s: any, i: number) =>
              `❌ 失败 ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - 置信度: ${s.confidence.toFixed(2)}`,
          )
          .join("\n")

        const attemptDescriptions = shotAttemptSegments
          .map(
            (s: any, i: number) =>
              `🤔 尝试 ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - 置信度: ${s.confidence.toFixed(2)}`,
          )
          .join("\n")

        let outputText = `🏀 篮球投篮检测完成\n`
        outputText += `📁 输出文件: ${outputPath}\n`
        outputText += `🎬 视频: ${basename(args.input)}\n`
        outputText += `📊 分析帧数: ${frames.length}\n`
        outputText += `🎯 检测到投篮: ${shotSegments.length} 个 (成功: ${makeSegments.length}, 失败: ${missSegments.length}, 尝试: ${shotAttemptSegments.length})\n\n`

        if (makeSegments.length > 0) {
          outputText += `✅ 成功投篮:\n${makeDescriptions}\n\n`
        }

        if (missSegments.length > 0) {
          outputText += `❌ 失败投篮 (可剪辑):\n${missDescriptions}\n\n`
        }

        if (shotAttemptSegments.length > 0) {
          outputText += `🤔 投篮尝试 (结果不明):\n${attemptDescriptions}\n\n`
        }

        if (missSegments.length > 0 && args.mark_misses_for_editing) {
          outputText += `✂️ 建议剪辑 ${missSegments.length} 个失败投篮片段\n`
          outputText += `   使用以下命令剪辑: jianjicode run "trim misses from ${basename(args.input)} using ${basename(outputPath)}"\n`
        }

        if (analysisResult.summary) {
          outputText += `📋 分析摘要: ${analysisResult.summary}\n`
        }

        // 添加R3D分析信息
        if (args.use_r3d_model && analysisResult.r3d_analysis) {
          const r3d = analysisResult.r3d_analysis
          outputText += `\n🤖 R3D深度学习分析:\n`
          outputText += `  设备: ${r3d.device}\n`
          outputText += `  推理时间: ${(r3d.inference_time * 1000).toFixed(1)}ms\n`
          outputText += `  篮球动作检测: ${r3d.has_basketball_action ? "✅ 是" : "❌ 否"}\n`

          if (
            r3d.basketball_predictions &&
            r3d.basketball_predictions.length > 0
          ) {
            outputText += `  篮球相关预测:\n`
            r3d.basketball_predictions.forEach((pred: any, i: number) => {
              if (i < 3) {
                // 只显示前3个
                outputText += `    - ${pred.class_name}: ${(pred.probability * 100).toFixed(1)}%\n`
              }
            })
          }
        }

        return {
          title: "篮球投篮检测成功",
          metadata: {
            operation: "basketball_shot_detection",
            success: true,
            error: false,
            outputPath: outputPath,
            shotsDetected: shotSegments.length,
            makesDetected: makeSegments.length,
            missesDetected: missSegments.length,
            videoDuration: analysisResult.video_duration,
            editingSuggested:
              missSegments.length > 0 && args.mark_misses_for_editing,
            // R3D分析元数据
            r3dUsed: args.use_r3d_model || false,
            r3dBasketballDetected:
              analysisResult.r3d_analysis?.has_basketball_action || false,
            r3dInferenceTime: analysisResult.r3d_analysis?.inference_time || 0,
            r3dDevice: analysisResult.r3d_analysis?.device || "未使用",
          },
          output: outputText,
        }
      } catch (error: any) {
        return {
          title: "篮球投篮检测错误",
          metadata: {
            operation: "basketball_shot_detection",
            error: true,
            success: false,
          },
          output: `❌ 篮球投篮检测过程中发生错误: ${error.message}`,
        }
      }
    },
  } as any,
)

/**
 * 从视频中提取关键帧
 */
async function extractKeyFrames(
  videoPath: string,
  outputDir: string,
  frameRate: number,
  quality: number,
  hardwareOptions: FfmpegOptions = {},
  maxFrames?: number,
): Promise<Array<{ path: string; timestamp: number; frame_num: number }>> {
  const frames: Array<{ path: string; timestamp: number; frame_num: number }> =
    []

  // 获取视频时长以计算总帧数
  const duration = await getVideoDuration(videoPath)
  if (duration <= 0) {
    return frames
  }

  // 计算要提取的帧数 - 基于时长和帧率
  const totalFrames = Math.floor(duration * frameRate)
  const timeInterval = 1.0 / frameRate // 帧之间的时间间隔（秒）

  // 批量提取所有帧：使用单条FFmpeg命令提取所有帧，大幅提高性能
  const outputPattern = join(outputDir, "frame_%04d.jpg")

  const args = [
    "-i",
    videoPath,
    "-vf",
    `fps=fps=${frameRate}`,
    "-q:v",
    quality.toString(),
    outputPattern,
  ]

  // 如果指定了最大帧数，添加到FFmpeg参数
  if (maxFrames && maxFrames > 0) {
    args.splice(-1, 0, "-frames:v", maxFrames.toString())
    console.log(`[extractKeyFrames] 限制最大帧数: ${maxFrames}`)
  }

  const expectedFrames =
    maxFrames && maxFrames > 0 ? Math.min(maxFrames, totalFrames) : totalFrames
  console.log(
    `[extractKeyFrames] 批量提取帧: ${expectedFrames}帧 (${maxFrames ? `限制为${maxFrames}帧, ` : ""}帧率: ${frameRate}fps)`,
  )
  console.log(`[extractKeyFrames] FFmpeg命令: ffmpeg ${args.join(" ")}`)

  const result = await runFfmpegEx(args, hardwareOptions)

  if (!result.success) {
    console.error(`[extractKeyFrames] 批量帧提取失败: ${result.error}`)
    // 回退到逐个提取（兼容性）
    return await extractKeyFramesFallback(
      videoPath,
      outputDir,
      frameRate,
      quality,
      hardwareOptions,
      duration,
      maxFrames,
    )
  }

  // 读取提取的帧文件
  const fs = await import("fs")
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".jpg") && f.startsWith("frame_"))
    .sort() // 按名称排序：frame_0000.jpg, frame_0001.jpg, ...

  // 验证提取的帧数
  if (files.length === 0) {
    console.error(`[extractKeyFrames] 未提取到任何帧文件`)
    return await extractKeyFramesFallback(
      videoPath,
      outputDir,
      frameRate,
      quality,
      hardwareOptions,
      duration,
      maxFrames,
    )
  }

  console.log(
    `[extractKeyFrames] 成功提取 ${files.length} 帧 (预期: ${expectedFrames})`,
  )

  // 构建帧数据数组
  for (let i = 0; i < files.length; i++) {
    const filename = files[i]
    const framePath = join(outputDir, filename)

    // 从文件名解析帧编号：frame_0000.jpg → 0
    const frameNumMatch = filename.match(/frame_(\d+)\.jpg/)
    const frameNum = frameNumMatch ? parseInt(frameNumMatch[1]) : i

    // 计算时间戳：基于帧编号和帧率
    const timestamp = parseFloat((frameNum * timeInterval).toFixed(3))

    if (existsSync(framePath)) {
      frames.push({
        path: framePath,
        timestamp: timestamp,
        frame_num: frameNum,
      })
    }
  }

  return frames
}

/**
 * 回退方法：逐个提取帧（当批量提取失败时使用）
 */
async function extractKeyFramesFallback(
  videoPath: string,
  outputDir: string,
  frameRate: number,
  quality: number,
  hardwareOptions: FfmpegOptions = {},
  duration: number,
  maxFrames?: number,
): Promise<Array<{ path: string; timestamp: number; frame_num: number }>> {
  const frames: Array<{ path: string; timestamp: number; frame_num: number }> =
    []

  console.warn(`[extractKeyFramesFallback] 使用回退方法：逐个提取帧`)

  const totalFrames = Math.floor(duration * frameRate)
  const actualFrames =
    maxFrames && maxFrames > 0 ? Math.min(maxFrames, totalFrames) : totalFrames
  const timeInterval = duration / totalFrames

  console.warn(
    `[extractKeyFramesFallback] 提取${actualFrames}帧 (${maxFrames ? `限制为${maxFrames}帧, ` : ""}总帧: ${totalFrames})`,
  )

  for (let i = 0; i < actualFrames; i++) {
    const timestamp = parseFloat((i * timeInterval).toFixed(3))
    const framePath = join(
      outputDir,
      `frame_${i.toString().padStart(4, "0")}.jpg`,
    )

    // 使用 FFmpeg 提取帧
    const args = [
      "-i",
      videoPath,
      "-ss",
      timestamp.toString(),
      "-vframes",
      "1",
      "-q:v",
      quality.toString(),
      framePath,
    ]

    const result = await runFfmpegEx(args, hardwareOptions)
    if (result.success && existsSync(framePath)) {
      frames.push({
        path: framePath,
        timestamp: timestamp,
        frame_num: i,
      })
    }
  }

  console.warn(`[extractKeyFramesFallback] 回退方法提取了 ${frames.length} 帧`)
  return frames
}

/**
 * 获取视频时长
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    // 使用 FFmpeg 获取时长
    const { spawnSync } = await import("child_process")
    const { findFfmpegPath } = await import("./ffmpeg-utils.js")

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return 0
    }

    const result = spawnSync(ffmpegPath, ["-i", videoPath, "-hide_banner"], {
      encoding: "utf8",
    })

    const output = result.stderr || ""
    // 解析时长信息
    const durationMatch = output.match(
      /Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/,
    )
    if (durationMatch) {
      const hours = parseInt(durationMatch[1])
      const minutes = parseInt(durationMatch[2])
      const seconds = parseFloat(durationMatch[3])
      return hours * 3600 + minutes * 60 + seconds
    }
  } catch (error) {
    console.warn(`无法获取视频时长: ${error}`)
  }
  return 0
}

/**
 * 使用 AI 分析篮球帧 (篮球特定分析)
 */
async function analyzeBasketballFramesWithAI(
  frames: Array<{ path: string; timestamp: number; frame_num: number }>,
  args: any,
): Promise<any> {
  try {
    // 批处理大小 (从参数获取，默认40)
    const BATCH_SIZE = args?.batch_size || 40

    console.log(`[BasketballShotDetection] AI分析开始，参数:`, {
      provider: args?.provider,
      model: args?.model,
      api_key: args?.api_key ? `${args.api_key.substring(0, 10)}...` : "未设置",
      api_base_url: args?.api_base_url,
      frame_count: frames.length,
      use_ltx_analysis: args?.use_ltx_analysis || false,
      batch_size: BATCH_SIZE,
      batch_processing: frames.length > BATCH_SIZE,
    })

    // 1. 准备帧数据
    const frameData: Array<{
      timestamp: number
      base64?: string
      path: string
    }> = []

    for (const frame of frames) {
      if (args.include_frame_previews) {
        // 将帧转换为 base64
        const buffer = readFileSync(frame.path)
        const base64 = buffer.toString("base64")
        frameData.push({
          timestamp: frame.timestamp,
          base64: `data:image/jpeg;base64,${base64}`,
          path: frame.path,
        })
      } else {
        frameData.push({
          timestamp: frame.timestamp,
          path: frame.path,
        })
      }
    }

    // 2. 如果启用 LTX 视觉分析，调用 CV 提供商进行姿态估计
    const poseResults: any[] = []
    if (args.use_ltx_analysis && cvModelProviderManager) {
      console.log(
        `[BasketballShotDetection] 启用 LTX 视觉分析，使用姿态估计模型: ${args.pose_model}`,
      )

      // 初始化CV提供商（如果尚未初始化）
      try {
        console.log(`[BasketballShotDetection] 初始化CV模型提供商...`)
        await configureDefaultCVProviders()
        console.log(`[BasketballShotDetection] CV模型提供商初始化完成`)
      } catch (cvInitError: any) {
        console.warn(
          `[BasketballShotDetection] CV模型提供商初始化失败: ${cvInitError.message}`,
        )
        console.warn(`[BasketballShotDetection] 将跳过姿态估计，仅使用AI分析`)
      }

      // 限制分析的帧数以节省时间
      const maxPoseFrames = args.max_pose_frames || 20
      const framesToAnalyze = frameData.slice(
        0,
        Math.min(maxPoseFrames, frameData.length),
      )

      console.log(
        `[BasketballShotDetection] 对 ${framesToAnalyze.length} 帧进行姿态估计...`,
      )

      try {
        // 检查 CV 提供商是否已初始化
        const providerStatus = cvModelProviderManager.getProviderStatus()
        const dwPoseProvider = providerStatus.find(
          (p: any) => p.id === "dw-pose",
        )

        if (dwPoseProvider && dwPoseProvider.initialized) {
          // 对每帧调用姿态估计
          for (let i = 0; i < framesToAnalyze.length; i++) {
            const frame = framesToAnalyze[i]
            try {
              const poseRequest = {
                image: {
                  type: "file_path" as const,
                  data: frame.path,
                  format: "jpg" as const,
                },
                model: args.pose_model || "dwpose",
                detectMultiplePersons: true,
                includeHands: false,
                includeFace: false,
                confidenceThreshold: args.pose_confidence_threshold || 0.3,
                renderStyle: "simple" as const,
                device: "cpu" as const,
              }

              console.log(
                `[BasketballShotDetection] 姿态估计帧 ${i + 1}/${framesToAnalyze.length} (时间戳: ${frame.timestamp}s)`,
              )
              const poseResult = await cvModelProviderManager.estimatePose(
                poseRequest,
                "dw-pose",
              )

              poseResults.push({
                frame_index: i,
                timestamp: frame.timestamp,
                persons_count: poseResult.persons.length,
                persons: poseResult.persons.map((p: any) => ({
                  bbox: p.bbox,
                  keypoints_count: p.keypoints.length,
                  confidence: p.confidence,
                })),
              })
            } catch (poseError: any) {
              console.warn(
                `[BasketballShotDetection] 姿态估计失败 (帧 ${i + 1}): ${poseError.message}`,
              )
              poseResults.push({
                frame_index: i,
                timestamp: frame.timestamp,
                persons_count: 0,
                error: poseError.message,
              })
            }
          }

          console.log(
            `[BasketballShotDetection] 姿态估计完成: ${poseResults.filter((r) => r.persons_count > 0).length}/${framesToAnalyze.length} 帧检测到人物`,
          )
        } else {
          console.warn(
            `[BasketballShotDetection] DW Pose 提供商未初始化，跳过姿态估计`,
          )
        }
      } catch (ltxError: any) {
        console.warn(
          `[BasketballShotDetection] LTX 视觉分析失败: ${ltxError.message}`,
        )
      }
    }

    // 3. 分批处理帧数据 (避免 DeepSeek API 令牌限制)
    const batches: Array<
      Array<{ timestamp: number; base64?: string; path: string }>
    > = []
    for (let i = 0; i < frameData.length; i += BATCH_SIZE) {
      batches.push(frameData.slice(i, i + BATCH_SIZE))
    }

    console.log(
      `[BasketballShotDetection] 帧数据分成 ${batches.length} 批, 每批最多 ${BATCH_SIZE} 帧`,
    )

    const allResults: any[] = []

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batchFrames = batches[batchIndex]
      const batchStartFrame = batchIndex * BATCH_SIZE

      console.log(
        `[BasketballShotDetection] 处理批次 ${batchIndex + 1}/${batches.length} (帧 ${batchStartFrame + 1}-${batchStartFrame + batchFrames.length})`,
      )

      // 获取当前批次的姿态估计结果 (如果可用)
      const batchPoseResults = poseResults.filter(
        (r: any) =>
          r.frame_index >= batchStartFrame &&
          r.frame_index < batchStartFrame + batchFrames.length,
      )

      // 4. 准备篮球特定的 AI 提示词 (包含批次信息)
      const prompt = createBasketballAnalysisPrompt(batchFrames, args, {
        batch_index: batchIndex,
        total_batches: batches.length,
        pose_results: batchPoseResults,
      })

      // 5. 调用 AI 模型
      // 将 deepseek 和 custom 映射到 openai-compatible (SimpleProvider 要求)
      const providerID =
        args.provider === "deepseek" || args.provider === "custom"
          ? "openai-compatible"
          : args.provider
      const model = {
        providerID: providerID,
        id: args.model,
      }

      const languageModel = await SimpleProvider.getLanguage(model, {
        apiKey: args.api_key,
        baseURL: args.api_base_url,
      })

      const { text } = await generateText({
        model: languageModel,
        prompt: prompt,
      })

      // 6. 解析 AI 响应
      const batchResult = parseBasketballAIResponse(text, batchFrames, args)

      // 调整批次结果的帧索引
      if (batchResult.frame_analysis) {
        batchResult.frame_analysis.forEach((frameAnalysis: any) => {
          frameAnalysis.frame_index += batchStartFrame
        })
      }

      if (batchResult.detected_shots) {
        batchResult.detected_shots.forEach((shot: any) => {
          if (shot.key_frames) {
            shot.key_frames = shot.key_frames.map(
              (idx: number) => idx + batchStartFrame,
            )
          }
        })
      }

      allResults.push(batchResult)

      // 批次间短暂延迟，避免 API 速率限制
      if (batchIndex < batches.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // 7. 合并所有批次的结果
    const mergedResult = mergeBatchResults(allResults, frameData.length)

    // 8. 添加 LTX 分析信息 (如果可用)
    if (poseResults.length > 0) {
      mergedResult.ltx_analysis_info = `姿态估计分析完成: ${poseResults.filter((r) => r.persons_count > 0).length}/${poseResults.length} 帧检测到人物`
      mergedResult.pose_estimation_results = {
        frames_analyzed: poseResults.length,
        frames_with_persons: poseResults.filter((r) => r.persons_count > 0)
          .length,
        total_persons_detected: poseResults.reduce(
          (sum, r) => sum + r.persons_count,
          0,
        ),
        sample_results: poseResults.slice(0, 5), // 只保留前5个结果作为样本
      }
    }

    return mergedResult
  } catch (error: any) {
    console.error(`篮球 AI 分析失败: ${error}`)
    throw new Error(`篮球 AI 分析失败: ${error.message}`)
  }
}

/**
 * 创建篮球分析提示词
 */
function createBasketballAnalysisPrompt(
  frameData: any[],
  args: any,
  options?: any,
): string {
  const frameDescriptions = frameData
    .map((frame, i) => `帧 ${i + 1}: 时间戳 ${formatTime(frame.timestamp)}`)
    .join("\n")

  // 添加批次信息（如果提供）
  let batchInfo = ""
  if (options && options.batch_index !== undefined) {
    batchInfo = `\n批次信息: 第 ${options.batch_index + 1}/${options.total_batches} 批 (共 ${frameData.length} 帧)`
  }

  // 添加姿态估计信息（如果提供）
  let poseInfo = ""
  if (options && options.pose_results && options.pose_results.length > 0) {
    const framesWithPose = options.pose_results.filter(
      (r: any) => r.persons_count > 0,
    )
    poseInfo = `\n姿态估计信息: ${framesWithPose.length}/${options.pose_results.length} 帧检测到人物姿态`
  }

  return `你是一个专业的篮球视频分析 AI。请分析以下篮球视频的关键帧，识别投篮动作、成功投篮和失败投篮。${batchInfo}${poseInfo}

视频信息:
- 总帧数: ${frameData.length}
- 检测投篮: ${args.detect_shots}
- 检测成功投篮: ${args.detect_makes}
- 检测失败投篮: ${args.detect_misses}
- 最小投篮时长: ${args.min_shot_duration}秒
- 置信度阈值: ${args.confidence_threshold}

关键帧时间戳 (均匀间隔的样本帧):
${frameDescriptions}

重要说明:
- 这些帧是视频的稀疏采样（每秒 ${args.frame_rate || 2} 帧），不是连续视频
- 相邻帧之间的时间间隔是固定的（约 ${frameData.length > 1 ? (frameData[frameData.length - 1].timestamp / (frameData.length - 1)).toFixed(2) : "未知"} 秒）
- 投篮动作应该只持续几秒（典型3-8秒），不应超过相邻帧时间间隔的3-4倍

任务要求:
1. 分析每帧的篮球相关内容（球员、篮球、篮筐、投篮动作、得分显示等）
2. 识别投篮动作（准备、起跳、出手、跟进动作）
3. 识别成功投篮（篮球入网、得分显示、球员庆祝等）
4. 识别失败投篮（篮球未入网、打铁、空气球、球员失望反应等）
5. 为每个检测到的投篮片段生成描述和分类

输出格式 (JSON):
{
  "video_duration": 估算的视频总时长（秒）,
  "frame_analysis": [
    {
      "frame_index": 帧序号,
      "timestamp": 时间戳（秒）,
      "basketball_content": "篮球相关内容描述",
      "shot_action_probability": 0.0-1.0,
      "shot_make_probability": 0.0-1.0,
      "shot_miss_probability": 0.0-1.0,
      "keywords": ["篮球", "球员", "投篮", "篮筐", ...]
    }
  ],
  "detected_shots": [
    {
      "shot_index": 投篮序号,
      "start_time": 开始时间（秒）,
      "end_time": 结束时间（秒）,
      "duration": 时长（秒）,
      "shot_type": "投篮类型（跳投、上篮、三分等）",
      "shot_result": "make（成功）/miss（失败）/attempt（尝试）",
      "confidence": 0.0-1.0,
      "description": "投篮描述",
      "key_frames": [相关帧序号],
      "reasoning": "判断理由"
    }
  ],
  "summary": "视频内容摘要（投篮统计、主要发现等）"
}

请确保:
- 时间戳精确到秒
- 投篮时长不低于${args.min_shot_duration}秒，但通常不超过10秒（典型投篮动作持续3-8秒）
- 如果一个投篮片段超过15秒，可能是多个投篮或包含无关内容，请将其拆分为多个投篮或重新评估
- 置信度低于${args.confidence_threshold}的投篮标记为低置信度
- 描述具体且有信息量
- 重点关注投篮成功/失败的视觉证据
- 投篮开始时间应该对应投篮准备动作的开始，结束时间应该对应投篮结果明确后的时刻

现在开始分析:`
}

/**
 * 修复 AI 返回的非标准 JSON 响应
 * 处理常见问题：未加引号的中文字符串、尾部逗号、JavaScript 风格注释等
 * 增强版本：处理更多边缘情况，提高修复成功率
 */
function repairJSONResponse(
  jsonText: string,
  verbose: boolean = false,
): string {
  // 首先修剪字符串，移除前导和尾随空白
  let repaired = jsonText.trim()

  if (verbose) {
    console.log(
      `[repairJSONResponse] 输入JSON长度: ${jsonText.length}字符，修剪后长度: ${repaired.length}字符`,
    )
    console.log(
      `[repairJSONResponse] 修剪后前200字符: ${repaired.substring(0, 200)}...`,
    )
    // 检查前几个字符的字符代码
    console.log(
      `[repairJSONResponse] 修剪后前10个字符的ASCII码: ${Array.from(
        repaired.substring(0, Math.min(10, repaired.length)),
      )
        .map((c) => c.charCodeAt(0))
        .join(", ")}`,
    )
  }

  // 0. 移除可能包裹JSON的markdown代码块（如果修剪后仍有）
  repaired = repaired.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gs, "$1")

  // 0.1 移除控制字符（除了标准的空白字符）
  repaired = repaired.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, "")

  if (verbose) {
    console.log(
      `[repairJSONResponse] 移除markdown后: ${repaired.substring(0, 200)}...`,
    )
  }

  // 1. 修复未加引号的字符串值（模式："key": 中文文本。 或 "key": 无...）
  // 更智能的匹配：寻找 "key": 后面跟着非JSON值的模式
  repaired = repaired.replace(
    /"([^"]+)":\s*([^{}[\],\s][^{}[\],]*?(?=\s*,|\s*}|$))/g,
    (match, key, value) => {
      const trimmedValue = value.trim()
      // 如果 value 不是 JSON 值（不以 {, [, ", true, false, null, number 开头）
      // 同时排除已包含引号的情况
      if (
        !/^(\{|\[|"|true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)/.test(
          trimmedValue,
        ) &&
        !/(^".*"$|^'.*'$)/.test(trimmedValue)
      ) {
        // 检查值是否包含需要转义的字符
        const escapedValue = trimmedValue
          .replace(/"/g, '\\"') // 转义双引号
          .replace(/\n/g, "\\n") // 转义换行
          .replace(/\t/g, "\\t") // 转义制表符
        return `"${key}": "${escapedValue}"`
      }
      return match
    },
  )

  // 2. 修复尾部逗号（模式：, } 或 , ]）
  repaired = repaired.replace(/,\s*}/g, "}")
  repaired = repaired.replace(/,\s*]/g, "]")

  // 2.1 修复缺失的逗号（模式："} "key": 或 "] "key":）
  repaired = repaired.replace(/([}\]"])\s*"/g, '$1, "')

  // 3. 移除单行注释
  repaired = repaired.replace(/\/\/.*$/gm, "")

  // 4. 移除多行注释
  repaired = repaired.replace(/\/\*[\s\S]*?\*\//g, "")

  // 5. 修复 JavaScript 对象属性（无引号键名）
  repaired = repaired.replace(
    /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g,
    '$1"$2":',
  )

  // 6. 修复缺失的引号闭合（模式："key: value）
  repaired = repaired.replace(/"([^":\s]+):\s*([^",}\]]+)/g, '"$1": "$2"')

  // 7. 修复布尔值的大小写（True/False -> true/false）
  repaired = repaired.replace(/\bTrue\b/g, "true")
  repaired = repaired.replace(/\bFalse\b/g, "false")

  // 8. 修复未转义的控制字符
  repaired = repaired.replace(/\n/g, "\\n")
  repaired = repaired.replace(/\r/g, "\\r")
  repaired = repaired.replace(/\t/g, "\\t")

  // 9. 确保JSON以大括号开始和结束（如果已经是完整的JSON）
  if (!repaired.trim().startsWith("{") && repaired.includes("{")) {
    repaired = repaired.substring(repaired.indexOf("{"))
  }
  if (!repaired.trim().endsWith("}") && repaired.includes("}")) {
    repaired = repaired.substring(0, repaired.lastIndexOf("}") + 1)
  }

  // 10. 尝试验证修复后的JSON，如果失败则返回更保守的修复
  try {
    JSON.parse(repaired)
    return repaired
  } catch (e: any) {
    console.warn(`修复后的JSON仍然无效，尝试保守修复: ${e.message}`)
    if (verbose) {
      console.log(
        `[repairJSONResponse] 修复失败，原始文本: ${jsonText.substring(0, 300)}...`,
      )
      console.log(
        `[repairJSONResponse] 修复失败时前10字符ASCII码: ${Array.from(
          jsonText.substring(0, 10),
        )
          .map((c) => c.charCodeAt(0))
          .join(", ")}`,
      )
    }

    // 保守修复：只处理最明显的问题，使用原始文本但修剪
    let conservative = jsonText.trim()
    // 移除注释
    conservative = conservative
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
    // 修复尾部逗号
    conservative = conservative.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")
    // 提取第一个完整的JSON对象
    const jsonMatch = conservative.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      if (verbose) {
        console.log(
          `[repairJSONResponse] 保守修复提取JSON长度: ${jsonMatch[0].length}`,
        )
      }
      return jsonMatch[0]
    }
    // 最后手段：返回空对象
    if (verbose) {
      console.log(`[repairJSONResponse] 无法提取JSON，返回空对象`)
    }
    return '{"frame_analysis": [], "detected_shots": [], "summary": "JSON修复失败"}'
  }
}

/**
 * 解析 AI 响应
 */
function parseBasketballAIResponse(
  text: string,
  frameData: any[],
  args: any,
): any {
  // 记录原始响应用于调试（仅当verbose模式启用时）
  if (args.verbose) {
    console.log(
      `[parseBasketballAIResponse] 原始AI响应长度: ${text.length}字符`,
    )
    console.log(
      `[parseBasketballAIResponse] 原始响应前200字符: ${text.substring(0, 200)}...`,
    )
  }

  // 尝试提取 JSON（可能被文本包围）
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    if (args.verbose) {
      console.log(`[parseBasketballAIResponse] 未找到JSON，完整响应: ${text}`)
    }
    // 返回默认结构
    return createDefaultAnalysis(frameData, "AI 响应中未找到 JSON 数据")
  }

  if (args.verbose) {
    console.log(
      `[parseBasketballAIResponse] 提取的JSON长度: ${jsonMatch[0].length}字符`,
    )
    console.log(
      `[parseBasketballAIResponse] 提取的JSON前200字符: ${jsonMatch[0].substring(0, 200)}...`,
    )
  }

  // 先尝试修复 JSON，然后解析
  const repairedJSON = repairJSONResponse(jsonMatch[0], args.verbose)

  if (args.verbose) {
    console.log(
      `[parseBasketballAIResponse] 修复后的JSON长度: ${repairedJSON.length}字符`,
    )
    console.log(
      `[parseBasketballAIResponse] 修复后的JSON前200字符: ${repairedJSON.substring(0, 200)}...`,
    )
    console.log(`[parseBasketballAIResponse] 尝试解析修复后的JSON...`)
  }

  try {
    const parsed = JSON.parse(repairedJSON)

    if (args.verbose) {
      console.log(
        `[parseBasketballAIResponse] JSON解析成功，字段: frame_analysis=${parsed.frame_analysis?.length}, detected_shots=${parsed.detected_shots?.length}`,
      )
    }

    // 验证必要字段
    if (!parsed.frame_analysis || !parsed.detected_shots) {
      throw new Error("AI 响应缺少必要字段")
    }

    return parsed
  } catch (error: any) {
    console.warn(`解析篮球 AI 响应失败: ${error}`)
    if (args.verbose) {
      console.log(`[parseBasketballAIResponse] 错误详情:`, error.message)
      console.log(
        `[parseBasketballAIResponse] 尝试解析的文本前500字符: ${repairedJSON.substring(0, 500)}`,
      )
      // 显示错误位置
      const match = error.message.match(/position (\d+)/)
      if (match) {
        const pos = parseInt(match[1])
        console.log(`[parseBasketballAIResponse] 错误位置 ${pos} 周围的文本:`)
        console.log(
          `...${repairedJSON.substring(Math.max(0, pos - 30), Math.min(repairedJSON.length, pos + 30))}...`,
        )
      }
    }
    // 返回默认结构
    return createDefaultAnalysis(frameData, `AI 分析失败: ${error.message}`)
  }
}

// 辅助函数：创建默认分析结构
function createDefaultAnalysis(frameData: any[], summary: string) {
  return {
    video_duration:
      frameData.length > 0 ? frameData[frameData.length - 1].timestamp : 0,
    frame_analysis: frameData.map((frame, i) => ({
      frame_index: i,
      timestamp: frame.timestamp,
      basketball_content: "未分析",
      shot_action_probability: 0.5,
      shot_make_probability: 0.5,
      shot_miss_probability: 0.5,
      keywords: [],
    })),
    detected_shots: [],
    summary: summary,
  }
}

/**
 * 合并批次结果
 */
function mergeBatchResults(batchResults: any[], totalFrames: number): any {
  if (batchResults.length === 0) {
    return {
      video_duration: 0,
      frame_analysis: [],
      detected_shots: [],
      summary: "无分析结果",
    }
  }

  if (batchResults.length === 1) {
    return batchResults[0]
  }

  // 合并 frame_analysis
  const allFrameAnalysis: any[] = []
  batchResults.forEach((batch, batchIndex) => {
    if (batch.frame_analysis) {
      allFrameAnalysis.push(...batch.frame_analysis)
    }
  })

  // 合并 detected_shots，重新编号 shot_index
  const allDetectedShots: any[] = []
  let shotIndexCounter = 1

  batchResults.forEach((batch, batchIndex) => {
    if (batch.detected_shots) {
      batch.detected_shots.forEach((shot: any) => {
        // 创建副本以避免修改原始数据
        const mergedShot = { ...shot }
        mergedShot.shot_index = shotIndexCounter++
        allDetectedShots.push(mergedShot)
      })
    }
  })

  // 使用第一个批次的 video_duration（假设相同）
  const videoDuration = batchResults[0].video_duration || 0

  // 合并摘要
  const summaryParts = batchResults.map((b) => b.summary).filter(Boolean)
  const summary =
    summaryParts.length > 0
      ? `批次合并摘要: ${summaryParts.join(" | ")}`
      : "篮球投篮分析完成 (批次处理)"

  return {
    video_duration: videoDuration,
    frame_analysis: allFrameAnalysis,
    detected_shots: allDetectedShots,
    summary: summary,
    batch_processing_info: {
      total_batches: batchResults.length,
      total_frames: totalFrames,
    },
  }
}

/**
 * 检测投篮片段（基于 AI 分析结果）
 */
function detectShotSegments(analysisResult: any, args: any): any[] {
  const shots = analysisResult.detected_shots || []

  // 应用过滤器
  const filteredShots = shots.filter((shot: any) => {
    // 最小时长检查
    if (shot.duration < args.min_shot_duration) {
      return false
    }
    // 置信度检查
    if (shot.confidence < args.confidence_threshold) {
      return false
    }
    // 根据用户设置过滤
    if (!args.detect_makes && shot.shot_result === "make") {
      return false
    }
    if (!args.detect_misses && shot.shot_result === "miss") {
      return false
    }
    if (
      !args.detect_shots &&
      (shot.shot_result === "attempt" || !shot.shot_result)
    ) {
      return false
    }
    return true
  })

  // 合并重叠的投篮片段
  return mergeOverlappingShots(filteredShots)
}

/**
 * 合并重叠的投篮片段
 */
function mergeOverlappingShots(shots: any[]): any[] {
  if (shots.length <= 1) {
    return shots
  }

  // 按开始时间排序
  const sorted = [...shots].sort((a, b) => a.start_time - b.start_time)
  const merged: any[] = []

  let current = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]

    // 如果投篮片段重叠或非常接近（< 1秒）
    if (next.start_time <= current.end_time + 1.0) {
      // 合并投篮片段
      current.end_time = Math.max(current.end_time, next.end_time)
      current.duration = current.end_time - current.start_time

      // 处理投篮结果：如果有一个是失败，标记为失败
      if (next.shot_result === "miss" || current.shot_result === "miss") {
        current.shot_result = "miss"
      } else if (
        next.shot_result === "make" ||
        current.shot_result === "make"
      ) {
        current.shot_result = "make"
      } else {
        current.shot_result = "attempt"
      }

      current.confidence = Math.min(current.confidence, next.confidence)
      current.description = `${current.description} | ${next.description}`
      current.key_frames = [
        ...new Set([...(current.key_frames || []), ...(next.key_frames || [])]),
      ]
      current.reasoning = `${current.reasoning}; ${next.reasoning}`
    } else {
      merged.push(current)
      current = next
    }
  }

  merged.push(current)
  return merged
}

/**
 * 格式化时间（秒 → HH:MM:SS）
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = (seconds % 60).toFixed(2)

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.padStart(5, "0")}`
  } else {
    return `${minutes.toString().padStart(2, "0")}:${secs.padStart(5, "0")}`
  }
}

/**
 * 使用R3D模型分析视频 — [已归档] jianjicode-python 已隔离
 */
async function analyzeWithR3D(_videoPath: string, _args: any): Promise<any> {
  console.warn(
    "[BasketballShotDetection] R3D 分析已归档（jianjicode-python 已隔离），跳过",
  )
  return { method: "r3d_archived", frames: [], shots: [] }
}

/**
 * 合并R3D结果与AI分析结果
 */
function mergeR3DWithAIResults(aiResult: any, r3dResult: any, args: any): any {
  if (!r3dResult || !r3dResult.results || r3dResult.results.length === 0) {
    console.log(`[BasketballShotDetection] 无R3D结果可合并`)
    return aiResult
  }

  const r3dAnalysis = r3dResult.results[0] // 假设只有一个视频

  console.log(
    `[BasketballShotDetection] 合并R3D结果: ${r3dAnalysis.basketball_predictions?.length || 0} 个篮球相关预测`,
  )

  // 将R3D置信度信息添加到AI分析结果中
  const mergedResult = { ...aiResult }

  // 添加R3D信息
  mergedResult.r3d_analysis = {
    enabled: true,
    device: r3dResult.device,
    inference_time: r3dAnalysis.inference_time,
    top_predictions: r3dAnalysis.top_predictions?.slice(0, 3) || [],
    basketball_predictions: r3dAnalysis.basketball_predictions || [],
    has_basketball_action: r3dAnalysis.has_basketball_action || false,
    confidence_threshold: args.r3d_confidence_threshold || 0.1,
  }

  // 如果R3D检测到篮球动作，增强AI结果的置信度
  if (r3dAnalysis.has_basketball_action && r3dAnalysis.basketball_predictions) {
    const basketballProbs = r3dAnalysis.basketball_predictions.map(
      (p: any) => p.probability,
    )
    const maxBasketballProb = Math.max(...basketballProbs, 0)

    // 增强帧分析中的篮球概率
    if (mergedResult.frame_analysis) {
      mergedResult.frame_analysis.forEach((frame: any) => {
        // 如果R3D置信度高于阈值，增加投篮动作概率
        if (maxBasketballProb >= (args.r3d_confidence_threshold || 0.1)) {
          frame.shot_action_probability = Math.min(
            0.9,
            frame.shot_action_probability + maxBasketballProb * 0.5,
          )
          frame.keywords = [
            ...new Set([...(frame.keywords || []), "深度学习检测"]),
          ]
        }
      })
    }

    // 增强检测到的投篮片段
    if (mergedResult.detected_shots) {
      mergedResult.detected_shots.forEach((shot: any) => {
        if (maxBasketballProb >= (args.r3d_confidence_threshold || 0.1)) {
          shot.confidence = Math.min(
            0.95,
            shot.confidence + maxBasketballProb * 0.3,
          )
          shot.reasoning = `${shot.reasoning || ""} [R3D模型确认篮球动作: ${maxBasketballProb.toFixed(2)}]`
        }
      })
    }

    console.log(
      `[BasketballShotDetection] R3D增强应用: 最高篮球概率 ${maxBasketballProb.toFixed(3)}`,
    )
  }

  return mergedResult
}

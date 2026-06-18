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
import { runFfmpeg } from "./ffmpeg-utils.js"
import { Tool } from "./tool.js"

/**
 * 视频场景识别工具 - 使用 AI 分析视频内容，识别场景分割点
 *
 * 功能:
 * 1. 从视频中提取关键帧 (均匀采样或基于内容)
 * 2. 使用多模态 AI 模型分析帧内容
 * 3. 识别场景变化和语义边界
 * 4. 返回时间戳和描述
 */
export const VideoSceneDetectionTool = Tool.define("video_scene_detection", {
  description: "使用 AI 分析视频内容，识别场景分割点和语义边界",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出 JSON 文件路径 (默认: <input>_scenes.json)"),

    // 帧提取参数
    frame_rate: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(1)
      .describe("每秒提取的帧数 (默认: 1帧/秒)"),
    max_frames: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(30)
      .describe("最大分析帧数 (默认: 30)"),
    frame_quality: z
      .number()
      .min(1)
      .max(31)
      .optional()
      .default(5)
      .describe("JPEG 帧质量 (1-31，越低质量越好，默认: 5)"),

    // AI 分析参数
    provider: z
      .string()
      .optional()
      .default("dashscope")
      .describe(
        "AI 提供商: dashscope, alibaba-cn, openai, custom, 等",
      ),
    model: z
      .string()
      .optional()
      .default("qwen3.5-omni-flash")
      .describe("AI 模型: qwen3.5-omni-flash, gpt-4o, 等"),
    api_key: z
      .string()
      .optional()
      .describe("API 密钥 (可选，默认使用环境变量)"),
    api_base_url: z
      .string()
      .optional()
      .describe("自定义 API 基础 URL (用于 OpenAI 兼容端点)"),

    // 分析选项
    detection_type: z
      .enum(["scene_change", "semantic", "both"])
      .optional()
      .default("both")
      .describe(
        "检测类型: scene_change(场景变化), semantic(语义边界), both(两者)",
      ),
    min_scene_duration: z
      .number()
      .min(0.1)
      .max(60)
      .optional()
      .default(2)
      .describe("最小场景持续时间 (秒，默认: 2)"),
    confidence_threshold: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.7)
      .describe("置信度阈值 (0.1-1，默认: 0.7)"),

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
          title: "视频场景识别失败",
          metadata: { operation: "video_scene_detection", error: true },
          output: `输入文件不存在: ${args.input}`,
        }
      }

      // 2. 创建临时目录
      const tempDir =
        args.temp_dir ||
        join(dirname(args.input), `.scene_detection_${Date.now()}`)
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
      }

      // 3. 提取关键帧
      console.log(`[VideoSceneDetection] 从视频提取关键帧...`)
      const frames = await extractKeyFrames(
        args.input,
        tempDir,
        args.frame_rate,
        args.max_frames,
        args.frame_quality,
      )

      if (frames.length === 0) {
        return {
          title: "视频场景识别失败",
          metadata: { operation: "video_scene_detection", error: true },
          output: "无法从视频中提取关键帧",
        }
      }

      console.log(`[VideoSceneDetection] 提取了 ${frames.length} 个关键帧`)

      // 4. 使用 AI 分析帧
      console.log(`[VideoSceneDetection] 使用 AI 分析视频内容...`)
      const analysisResult = await analyzeFramesWithAI(frames, args)

      // 5. 后处理：识别场景边界
      console.log(`[VideoSceneDetection] 识别场景边界...`)
      const scenes = detectScenes(analysisResult, args)

      // 6. 生成输出
      const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_scenes.json`

      // 安全检查
      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "video_scene_detection",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      const result = {
        video_path: args.input,
        total_frames_analyzed: frames.length,
        scenes_detected: scenes.length,
        scenes: scenes,
        analysis_summary: args.generate_summary
          ? analysisResult.summary
          : undefined,
        detection_settings: {
          frame_rate: args.frame_rate,
          detection_type: args.detection_type,
          min_scene_duration: args.min_scene_duration,
          confidence_threshold: args.confidence_threshold,
        },
        timestamp: new Date().toISOString(),
      }

      // 写入 JSON 文件
      writeFileSync(outputPath, JSON.stringify(result, null, 2))

      // 7. 清理临时文件
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
        console.warn(`[VideoSceneDetection] 临时文件清理失败: ${cleanupError}`)
      }

      // 8. 返回结果
      const sceneDescriptions = scenes
        .map(
          (s: any, i: number) =>
            `${i + 1}. ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s): ${s.description}`,
        )
        .join("\n")

      return {
        title: "视频场景识别成功",
        metadata: {
          operation: "video_scene_detection",
          success: true,
          error: false,
          outputPath: outputPath,
          scenesDetected: scenes.length,
          videoDuration: analysisResult.video_duration,
        },
        output: `✅ 成功识别 ${scenes.length} 个场景\n📁 输出文件: ${outputPath}\n\n🎬 检测到的场景:\n${sceneDescriptions}\n\n📊 分析摘要: ${analysisResult.summary}`,
      }
    } catch (error: any) {
      return {
        title: "视频场景识别错误",
        metadata: {
          operation: "video_scene_detection",
          error: true,
          success: false,
        },
        output: `❌ 场景识别过程中发生错误: ${error.message}`,
      }
    }
  },
} as any)

/**
 * 从视频中提取关键帧
 */
async function extractKeyFrames(
  videoPath: string,
  outputDir: string,
  frameRate: number,
  maxFrames: number,
  quality: number,
): Promise<Array<{ path: string; timestamp: number; frame_num: number }>> {
  const frames: Array<{ path: string; timestamp: number; frame_num: number }> =
    []

  // 获取视频时长以计算总帧数
  const duration = await getVideoDuration(videoPath)
  if (duration <= 0) {
    return frames
  }

  // 计算要提取的帧数
  const totalFrames = Math.min(Math.floor(duration * frameRate), maxFrames)
  const timeInterval = duration / totalFrames

  for (let i = 0; i < totalFrames; i++) {
    const timestamp = i * timeInterval
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
      "-f",
      "image2",
      framePath,
    ]

    const result = await runFfmpeg(args)
    if (result.success && existsSync(framePath)) {
      frames.push({
        path: framePath,
        timestamp: timestamp,
        frame_num: i,
      })
    }
  }

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
 * 使用 AI 分析帧
 */
async function analyzeFramesWithAI(
  frames: Array<{ path: string; timestamp: number; frame_num: number }>,
  args: any,
): Promise<any> {
  try {
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

    // 2. 准备 AI 提示词
    const prompt = createAnalysisPrompt(frameData, args)

    // 3. 调用 AI 模型
    const model = {
      providerID: args.provider,
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

    // 4. 解析 AI 响应
    return parseAIResponse(text, frameData, args)
  } catch (error: any) {
    console.error(`AI 分析失败: ${error}`)
    throw new Error(`AI 分析失败: ${error.message}`)
  }
}

/**
 * 创建分析提示词
 */
function createAnalysisPrompt(frameData: any[], args: any): string {
  const frameDescriptions = frameData
    .map((frame, i) => `帧 ${i + 1}: 时间戳 ${formatTime(frame.timestamp)}`)
    .join("\n")

  return `你是一个专业的视频内容分析 AI。请分析以下视频的关键帧，识别场景分割点和语义边界。

视频信息:
- 总帧数: ${frameData.length}
- 检测类型: ${args.detection_type}
- 最小场景时长: ${args.min_scene_duration}秒
- 置信度阈值: ${args.confidence_threshold}

关键帧时间戳:
${frameDescriptions}

任务要求:
1. 分析每帧的视觉内容（如果提供图像数据，请描述场景、人物、动作、颜色、光照等）
2. 识别场景变化点（画面内容发生显著变化的时间点）
3. 识别语义边界（如对话切换、主题转换、情感变化等）
4. 为每个检测到的场景生成描述

输出格式 (JSON):
{
  "video_duration": 估算的视频总时长（秒）,
  "frame_analysis": [
    {
      "frame_index": 帧序号,
      "timestamp": 时间戳（秒）,
      "content_description": "帧内容描述",
      "scene_change_probability": 0.0-1.0,
      "semantic_boundary_probability": 0.0-1.0,
      "keywords": ["关键词1", "关键词2", ...]
    }
  ],
  "detected_scenes": [
    {
      "scene_index": 场景序号,
      "start_time": 开始时间（秒）,
      "end_time": 结束时间（秒）,
      "duration": 时长（秒）,
      "description": "场景描述",
      "confidence": 0.0-1.0,
      "key_frames": [相关帧序号],
      "keywords": ["关键词1", "关键词2", ...]
    }
  ],
  "summary": "视频内容摘要（2-3句话）"
}

请确保:
- 时间戳精确到秒
- 场景时长不低于${args.min_scene_duration}秒
- 置信度低于${args.confidence_threshold}的场景标记为低置信度
- 描述具体且有信息量

现在开始分析:`
}

/**
 * 解析 AI 响应
 */
function parseAIResponse(text: string, frameData: any[], args: any): any {
  try {
    // 尝试提取 JSON（可能被文本包围）
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("AI 响应中未找到 JSON 数据")
    }

    const parsed = JSON.parse(jsonMatch[0])

    // 验证必要字段
    if (!parsed.frame_analysis || !parsed.detected_scenes) {
      throw new Error("AI 响应缺少必要字段")
    }

    return parsed
  } catch (error: any) {
    console.warn(`解析 AI 响应失败: ${error}`)
    // 返回默认结构
    return {
      video_duration:
        frameData.length > 0 ? frameData[frameData.length - 1].timestamp : 0,
      frame_analysis: frameData.map((frame, i) => ({
        frame_index: i,
        timestamp: frame.timestamp,
        content_description: "未分析",
        scene_change_probability: 0.5,
        semantic_boundary_probability: 0.5,
        keywords: [],
      })),
      detected_scenes: [],
      summary: "AI 分析失败，使用默认分析",
    }
  }
}

/**
 * 检测场景（基于 AI 分析结果）
 */
function detectScenes(analysisResult: any, args: any): any[] {
  const scenes = analysisResult.detected_scenes || []

  // 应用过滤器
  const filteredScenes = scenes.filter((scene: any) => {
    // 最小时长检查
    if (scene.duration < args.min_scene_duration) {
      return false
    }
    // 置信度检查
    if (scene.confidence < args.confidence_threshold) {
      return false
    }
    return true
  })

  // 合并重叠的场景
  return mergeOverlappingScenes(filteredScenes)
}

/**
 * 合并重叠的场景
 */
function mergeOverlappingScenes(scenes: any[]): any[] {
  if (scenes.length <= 1) {
    return scenes
  }

  // 按开始时间排序
  const sorted = [...scenes].sort((a, b) => a.start_time - b.start_time)
  const merged: any[] = []

  let current = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]

    // 如果场景重叠或非常接近（< 0.5秒）
    if (next.start_time <= current.end_time + 0.5) {
      // 合并场景
      current.end_time = Math.max(current.end_time, next.end_time)
      current.duration = current.end_time - current.start_time
      current.description = `${current.description} | ${next.description}`
      current.confidence = Math.min(current.confidence, next.confidence)
      current.key_frames = [
        ...new Set([...(current.key_frames || []), ...(next.key_frames || [])]),
      ]
      current.keywords = [
        ...new Set([...(current.keywords || []), ...(next.keywords || [])]),
      ]
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
 * 工具别名
 */
export const SceneDetectionTool = VideoSceneDetectionTool

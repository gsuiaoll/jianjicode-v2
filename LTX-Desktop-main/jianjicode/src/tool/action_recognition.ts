/**
 * 动作识别工具 - 使用 AI 分析视频，识别人物动作和物体运动的通用功能
 *
 * 功能:
 * 1. 从视频中提取关键帧
 * 2. 使用多模态 AI 模型分析帧内容
 * 3. 识别人物动作（跑步、跳跃、投篮等）和物体运动（球、车辆等）
 * 4. 返回动作片段的时间戳、分类和置信度
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
import { runFfmpeg } from "./ffmpeg-utils.js"
import { Tool } from "./tool.js"

/**
 * 动作识别工具
 */
export const ActionRecognitionTool = Tool.define("action_recognition", {
  description:
    "使用 AI 分析视频，识别人物动作和物体运动的通用功能，支持多种动作类别检测",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出 JSON 文件路径 (默认: <input>_actions.json)"),

    // 帧提取参数
    frame_rate: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(2)
      .describe("每秒提取的帧数 (建议: 2-5帧/秒)"),
    max_frames: z
      .number()
      .min(1)
      .max(200)
      .optional()
      .default(60)
      .describe("最大分析帧数 (默认: 60)"),
    frame_quality: z
      .number()
      .min(1)
      .max(31)
      .optional()
      .default(3)
      .describe("JPEG 帧质量 (1-31，越低质量越好，默认: 3)"),

    // 动作检测配置
    action_categories: z
      .array(
        z.enum([
          "person_actions", // 人物动作
          "object_motions", // 物体运动
          "sports_actions", // 体育动作
          "vehicle_motions", // 车辆运动
          "animal_motions", // 动物运动
          "interaction_actions", // 交互动作
          "custom_actions", // 自定义动作
        ]),
      )
      .optional()
      .default(["person_actions", "object_motions"])
      .describe("动作检测类别"),

    // 特定动作类型
    specific_actions: z
      .array(z.string())
      .optional()
      .describe(
        "要检测的特定动作类型 (如: 'running', 'jumping', 'shooting', 'throwing', 'driving', 'falling')",
      ),

    // 目标对象
    target_objects: z
      .array(z.string())
      .optional()
      .describe(
        "要跟踪的目标物体 (如: 'ball', 'car', 'person', 'animal', 'vehicle')",
      ),

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

    // 检测选项
    detect_persons: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否检测人物动作"),
    detect_objects: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否检测物体运动"),
    min_action_duration: z
      .number()
      .min(0.5)
      .max(20)
      .optional()
      .default(1.5)
      .describe("最小动作片段持续时间 (秒，默认: 1.5)"),
    confidence_threshold: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.5)
      .describe("置信度阈值 (0.1-1，默认: 0.5)"),

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
    mark_for_editing: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否标记检测到的片段用于后续剪辑"),

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
          title: "动作识别失败",
          metadata: { operation: "action_recognition", error: true },
          output: `输入文件不存在: ${args.input}`,
        }
      }

      // 2. 创建临时目录
      const tempDir =
        args.temp_dir ||
        join(dirname(args.input), `.action_recognition_${Date.now()}`)
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
      }

      // 3. 提取关键帧
      console.log(`[ActionRecognition] 从视频提取关键帧...`)
      const frames = await extractKeyFrames(
        args.input,
        tempDir,
        args.frame_rate,
        args.max_frames,
        args.frame_quality,
      )

      if (frames.length === 0) {
        return {
          title: "动作识别失败",
          metadata: { operation: "action_recognition", error: true },
          output: "无法从视频中提取关键帧",
        }
      }

      console.log(`[ActionRecognition] 提取了 ${frames.length} 个关键帧`)

      // 4. 使用 AI 分析帧 (通用动作分析)
      console.log(`[ActionRecognition] 使用 AI 分析动作内容...`)
      const analysisResult = await analyzeActionFramesWithAI(frames, args)

      // 5. 后处理：识别动作片段
      console.log(`[ActionRecognition] 识别动作片段...`)
      const actionSegments = detectActionSegments(analysisResult, args)

      // 6. 分类动作片段
      const personSegments = actionSegments.filter(
        (s: any) => s.category === "person_action",
      )
      const objectSegments = actionSegments.filter(
        (s: any) => s.category === "object_motion",
      )
      const otherSegments = actionSegments.filter(
        (s: any) => !["person_action", "object_motion"].includes(s.category),
      )

      // 7. 生成输出
      const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_actions.json`

      // 安全检查
      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "action_recognition",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      const result = {
        video_path: args.input,
        total_frames_analyzed: frames.length,
        total_actions_detected: actionSegments.length,
        person_actions_detected: personSegments.length,
        object_motions_detected: objectSegments.length,
        other_actions_detected: otherSegments.length,
        action_segments: actionSegments,
        segments_for_editing: args.mark_for_editing
          ? actionSegments.filter((s: any) => s.mark_for_editing)
          : [],
        analysis_summary: args.generate_summary
          ? analysisResult.summary
          : undefined,
        detection_settings: {
          frame_rate: args.frame_rate,
          action_categories: args.action_categories,
          specific_actions: args.specific_actions,
          target_objects: args.target_objects,
          min_action_duration: args.min_action_duration,
          confidence_threshold: args.confidence_threshold,
        },
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
        console.warn(`[ActionRecognition] 临时文件清理失败: ${cleanupError}`)
      }

      // 9. 返回结果
      let outputText = `🎬 动作识别完成\n`
      outputText += `📁 输出文件: ${outputPath}\n`
      outputText += `🎬 视频: ${basename(args.input)}\n`
      outputText += `📊 分析帧数: ${frames.length}\n`
      outputText += `🎯 检测到动作: ${actionSegments.length} 个 (人物动作: ${personSegments.length}, 物体运动: ${objectSegments.length}, 其他: ${otherSegments.length})\n\n`

      if (personSegments.length > 0) {
        outputText += `👤 人物动作:\n`
        outputText +=
          personSegments
            .map(
              (s: any, i: number) =>
                `${getActionEmoji(s.action_type)} ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - ${s.action_type} - 置信度: ${s.confidence.toFixed(2)}`,
            )
            .join("\n") + "\n\n"
      }

      if (objectSegments.length > 0) {
        outputText += `🔧 物体运动:\n`
        outputText +=
          objectSegments
            .map(
              (s: any, i: number) =>
                `${getObjectEmoji(s.object_type)} ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - ${s.object_type} - 置信度: ${s.confidence.toFixed(2)}`,
            )
            .join("\n") + "\n\n"
      }

      if (otherSegments.length > 0) {
        outputText += `📦 其他动作:\n`
        outputText +=
          otherSegments
            .map(
              (s: any, i: number) =>
                `📌 ${i + 1}: ${formatTime(s.start_time)}-${formatTime(s.end_time)} (${s.duration.toFixed(1)}s) - ${s.action_type || s.category} - 置信度: ${s.confidence.toFixed(2)}`,
            )
            .join("\n") + "\n\n"
      }

      if (args.mark_for_editing && result.segments_for_editing.length > 0) {
        outputText += `✂️ 建议剪辑 ${result.segments_for_editing.length} 个片段\n`
        outputText += `   使用以下命令剪辑: jianjicode run "trim segments from ${basename(args.input)} using ${basename(outputPath)}"\n`
      }

      if (analysisResult.summary) {
        outputText += `📋 分析摘要: ${analysisResult.summary}\n`
      }

      return {
        title: "动作识别成功",
        metadata: {
          operation: "action_recognition",
          success: true,
          error: false,
          outputPath: outputPath,
          actionsDetected: actionSegments.length,
          personActions: personSegments.length,
          objectMotions: objectSegments.length,
          videoDuration: analysisResult.video_duration,
          editingSuggested:
            result.segments_for_editing.length > 0 && args.mark_for_editing,
        },
        output: outputText,
      }
    } catch (error: any) {
      return {
        title: "动作识别错误",
        metadata: {
          operation: "action_recognition",
          error: true,
          success: false,
        },
        output: `❌ 动作识别过程中发生错误: ${error.message}`,
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
 * 使用 AI 分析动作帧 (通用分析)
 */
async function analyzeActionFramesWithAI(
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

    // 2. 准备动作分析提示词
    const prompt = createActionAnalysisPrompt(frameData, args)

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
    return parseActionAIResponse(text, frameData, args)
  } catch (error: any) {
    console.error(`动作 AI 分析失败: ${error}`)
    throw new Error(`动作 AI 分析失败: ${error.message}`)
  }
}

/**
 * 创建动作分析提示词
 */
function createActionAnalysisPrompt(frameData: any[], args: any): string {
  const frameDescriptions = frameData
    .map((frame, i) => `帧 ${i + 1}: 时间戳 ${formatTime(frame.timestamp)}`)
    .join("\n")

  const actionCategories = args.action_categories?.join(", ") || "所有类别"
  const specificActions = args.specific_actions?.join(", ") || "所有动作"
  const targetObjects = args.target_objects?.join(", ") || "所有物体"

  return `你是一个专业的视频分析 AI。请分析以下视频的关键帧，识别人物动作和物体运动。

视频信息:
- 总帧数: ${frameData.length}
- 动作类别: ${actionCategories}
- 特定动作: ${specificActions}
- 目标物体: ${targetObjects}
- 检测人物动作: ${args.detect_persons}
- 检测物体运动: ${args.detect_objects}
- 最小动作时长: ${args.min_action_duration}秒
- 置信度阈值: ${args.confidence_threshold}

关键帧时间戳:
${frameDescriptions}

任务要求:
1. 分析每帧的视频内容（人物、物体、背景、动作）
2. 识别人物动作（跑步、跳跃、投掷、射击、跌倒、站立、坐等）
3. 识别物体运动（球体运动、车辆移动、物体掉落、物体旋转等）
4. 根据动作类别和特定动作进行检测
5. 为每个检测到的动作片段生成描述和分类

输出格式 (JSON):
{
  "video_duration": 估算的视频总时长（秒）,
  "frame_analysis": [
    {
      "frame_index": 帧序号,
      "timestamp": 时间戳（秒）,
      "content_description": "内容描述",
      "persons_detected": true/false,
      "objects_detected": ["物体类型"],
      "action_probabilities": {
        "running": 0.0-1.0,
        "jumping": 0.0-1.0,
        "throwing": 0.0-1.0,
        "shooting": 0.0-1.0,
        "driving": 0.0-1.0,
        "falling": 0.0-1.0
        // 其他动作...
      },
      "keywords": ["关键词1", "关键词2", ...]
    }
  ],
  "detected_actions": [
    {
      "action_index": 动作序号,
      "start_time": 开始时间（秒）,
      "end_time": 结束时间（秒）,
      "duration": 时长（秒）,
      "category": "person_action/object_motion/other",
      "action_type": "动作类型（running, jumping, throwing等）",
      "object_type": "物体类型（如果适用）",
      "confidence": 0.0-1.0,
      "description": "动作描述",
      "key_frames": [相关帧序号],
      "reasoning": "判断理由",
      "mark_for_editing": true/false（是否标记为需要剪辑）
    }
  ],
  "summary": "视频内容摘要（动作统计、主要发现等）"
}

请确保:
- 时间戳精确到秒
- 动作时长不低于${args.min_action_duration}秒
- 置信度低于${args.confidence_threshold}的动作标记为低置信度
- 描述具体且有信息量
- 重点关注运动模式和动作连续性

现在开始分析:`
}

/**
 * 解析 AI 响应
 */
function parseActionAIResponse(text: string, frameData: any[], args: any): any {
  try {
    // 尝试提取 JSON（可能被文本包围）
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("AI 响应中未找到 JSON 数据")
    }

    const parsed = JSON.parse(jsonMatch[0])

    // 验证必要字段
    if (!parsed.frame_analysis || !parsed.detected_actions) {
      throw new Error("AI 响应缺少必要字段")
    }

    return parsed
  } catch (error: any) {
    console.warn(`解析动作 AI 响应失败: ${error}`)
    // 返回默认结构
    return {
      video_duration:
        frameData.length > 0 ? frameData[frameData.length - 1].timestamp : 0,
      frame_analysis: frameData.map((frame, i) => ({
        frame_index: i,
        timestamp: frame.timestamp,
        content_description: "未分析",
        persons_detected: false,
        objects_detected: [],
        action_probabilities: {},
        keywords: [],
      })),
      detected_actions: [],
      summary: "AI 分析失败，使用默认分析",
    }
  }
}

/**
 * 检测动作片段（基于 AI 分析结果）
 */
function detectActionSegments(analysisResult: any, args: any): any[] {
  const actions = analysisResult.detected_actions || []

  // 应用过滤器
  const filteredActions = actions.filter((action: any) => {
    // 最小时长检查
    if (action.duration < args.min_action_duration) {
      return false
    }
    // 置信度检查
    if (action.confidence < args.confidence_threshold) {
      return false
    }
    // 根据用户设置过滤
    if (!args.detect_persons && action.category === "person_action") {
      return false
    }
    if (!args.detect_objects && action.category === "object_motion") {
      return false
    }
    // 检查是否在特定动作列表中
    if (args.specific_actions && args.specific_actions.length > 0) {
      if (!args.specific_actions.includes(action.action_type)) {
        return false
      }
    }
    // 检查目标物体
    if (
      args.target_objects &&
      args.target_objects.length > 0 &&
      action.object_type
    ) {
      if (!args.target_objects.includes(action.object_type)) {
        return false
      }
    }
    return true
  })

  // 合并重叠的动作片段
  return mergeOverlappingActions(filteredActions)
}

/**
 * 合并重叠的动作片段
 */
function mergeOverlappingActions(actions: any[]): any[] {
  if (actions.length <= 1) {
    return actions
  }

  // 按开始时间排序
  const sorted = [...actions].sort((a, b) => a.start_time - b.start_time)
  const merged: any[] = []

  let current = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]

    // 如果动作片段重叠或非常接近（< 1秒）
    if (next.start_time <= current.end_time + 1.0) {
      // 合并动作片段
      current.end_time = Math.max(current.end_time, next.end_time)
      current.duration = current.end_time - current.start_time

      // 处理类别：如果不同，标记为混合
      if (next.category !== current.category) {
        current.category = "mixed"
      }

      // 动作类型合并
      if (next.action_type !== current.action_type) {
        current.action_type = `${current.action_type}|${next.action_type}`
      }

      // 物体类型合并
      if (
        next.object_type &&
        current.object_type &&
        next.object_type !== current.object_type
      ) {
        current.object_type = `${current.object_type}|${next.object_type}`
      } else if (next.object_type && !current.object_type) {
        current.object_type = next.object_type
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
 * 获取动作表情符号
 */
function getActionEmoji(actionType: string): string {
  const emojiMap: Record<string, string> = {
    running: "🏃",
    jumping: "🤸",
    throwing: "🤾",
    shooting: "🏀",
    dribbling: "🏀",
    kicking: "⚽",
    driving: "🚗",
    falling: "⚠️",
    standing: "🧍",
    sitting: "🧘",
    walking: "🚶",
    dancing: "💃",
    fighting: "🥊",
    swimming: "🏊",
    cycling: "🚴",
    lifting: "🏋️",
    climbing: "🧗",
  }
  return emojiMap[actionType.toLowerCase()] || "🎯"
}

/**
 * 获取物体表情符号
 */
function getObjectEmoji(objectType: string): string {
  const emojiMap: Record<string, string> = {
    ball: "🏀",
    car: "🚗",
    vehicle: "🚗",
    person: "👤",
    animal: "🐕",
    bicycle: "🚲",
    motorcycle: "🏍️",
    plane: "✈️",
    boat: "🚤",
    train: "🚂",
    phone: "📱",
    book: "📖",
    food: "🍕",
    drink: "🥤",
    bag: "🎒",
    box: "📦",
  }
  return emojiMap[objectType.toLowerCase()] || "📦"
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

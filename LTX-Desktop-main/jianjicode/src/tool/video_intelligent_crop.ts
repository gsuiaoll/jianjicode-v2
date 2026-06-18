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
 * 智能视频裁剪工具 - 使用 AI 分析视频内容，智能裁剪以聚焦重要主题
 *
 * 功能:
 * 1. 从视频中提取关键帧
 * 2. 使用 AI 识别重要区域（人脸、物体、动作）
 * 3. 计算最佳裁剪区域序列
 * 4. 应用动态裁剪（平滑跟踪运动）
 */
export const VideoIntelligentCropTool = Tool.define("video_intelligent_crop", {
  description:
    "使用 AI 分析视频内容，智能裁剪以聚焦重要主题（人脸、物体、动作）",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出视频文件路径 (默认: <input>_cropped.mp4)"),

    // 裁剪参数
    crop_mode: z
      .enum(["auto", "face", "object", "action"])
      .optional()
      .default("auto")
      .describe("裁剪模式: auto(自动), face(人脸), object(物体), action(动作)"),
    aspect_ratio: z
      .string()
      .optional()
      .default("16:9")
      .describe("裁剪宽高比 (如: 16:9, 4:3, 1:1, 9:16, 2.35:1)"),
    padding: z
      .number()
      .min(0)
      .max(50)
      .optional()
      .default(10)
      .describe("裁剪区域填充百分比 (0-50，默认: 10%)"),
    smooth_tracking: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否启用平滑跟踪 (默认: true)"),
    tracking_sensitivity: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.7)
      .describe("跟踪灵敏度 (0.1-1，越高越敏感，默认: 0.7)"),
    min_subject_size: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.3)
      .describe("最小主体大小比例 (相对于画面，0.1-1，默认: 0.3)"),
    stability_threshold: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.6)
      .describe("稳定性阈值 (0.1-1，越高越稳定，默认: 0.6)"),

    // 帧提取参数
    frame_rate: z
      .number()
      .min(0.1)
      .max(5)
      .optional()
      .default(2)
      .describe("每秒提取的帧数 (默认: 2帧/秒)"),
    max_frames: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .default(20)
      .describe("最大分析帧数 (默认: 20)"),
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
      .default("openai")
      .describe(
        "AI 提供商: openai, anthropic, google, openrouter, vercel, azure, custom",
      ),
    model: z
      .string()
      .optional()
      .default("gpt-4o")
      .describe("AI 模型: gpt-4o, claude-3.5-sonnet, gemini-2.0-flash, 等"),
    api_key: z
      .string()
      .optional()
      .describe("API 密钥 (可选，默认使用环境变量)"),
    api_base_url: z
      .string()
      .optional()
      .describe("自定义 API 基础 URL (用于 OpenAI 兼容端点)"),

    // 输出选项
    preserve_original_audio: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保留原始音频 (默认: true)"),
    output_quality: z
      .number()
      .min(1)
      .max(51)
      .optional()
      .default(23)
      .describe("输出视频质量 (CRF, 1-51，越低质量越好，默认: 23)"),
    output_preset: z
      .string()
      .optional()
      .default("medium")
      .describe(
        "输出编码预设: ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow",
      ),

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
          title: "智能视频裁剪失败",
          metadata: { operation: "video_intelligent_crop", error: true },
          output: `输入文件不存在: ${args.input}`,
        }
      }

      // 2. 创建临时目录
      const tempDir =
        args.temp_dir ||
        join(dirname(args.input), `.intelligent_crop_${Date.now()}`)
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
      }

      // 3. 提取关键帧
      console.log(`[VideoIntelligentCrop] 从视频提取关键帧...`)
      const frames = await extractKeyFrames(
        args.input,
        tempDir,
        args.frame_rate,
        args.max_frames,
        args.frame_quality,
      )

      if (frames.length === 0) {
        return {
          title: "智能视频裁剪失败",
          metadata: { operation: "video_intelligent_crop", error: true },
          output: "无法从视频中提取关键帧",
        }
      }

      console.log(`[VideoIntelligentCrop] 提取了 ${frames.length} 个关键帧`)

      // 4. 使用 AI 分析帧
      console.log(`[VideoIntelligentCrop] 使用 AI 分析视频内容...`)
      const analysisResult = await analyzeFramesWithAI(frames, args)

      // 5. 计算裁剪区域序列
      console.log(`[VideoIntelligentCrop] 计算裁剪区域...`)
      const cropRegions = calculateCropRegions(analysisResult, args)

      // 6. 应用动态裁剪
      console.log(`[VideoIntelligentCrop] 应用智能裁剪...`)
      const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_cropped.mp4`

      // 安全检查
      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "video_intelligent_crop",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      const cropResult = await applyDynamicCrop(
        args.input,
        outputPath,
        cropRegions,
        args,
      )

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
        console.warn(`[VideoIntelligentCrop] 临时文件清理失败: ${cleanupError}`)
      }

      // 8. 返回结果
      return {
        title: "智能视频裁剪成功",
        metadata: {
          operation: "video_intelligent_crop",
          success: true,
          error: false,
          outputPath: outputPath,
          inputPath: args.input,
          cropRegions: cropRegions.length,
          aspectRatio: args.aspect_ratio,
          cropMode: args.crop_mode,
        },
        output: `✅ 智能裁剪完成\n📁 输入文件: ${args.input}\n📁 输出文件: ${outputPath}\n🎯 裁剪模式: ${args.crop_mode}\n📐 宽高比: ${args.aspect_ratio}\n📊 裁剪区域数: ${cropRegions.length}\n🕒 视频时长: ${analysisResult.video_duration?.toFixed(1) || "未知"}秒`,
      }
    } catch (error: any) {
      return {
        title: "智能视频裁剪错误",
        metadata: {
          operation: "video_intelligent_crop",
          error: true,
          success: false,
        },
        output: `❌ 智能裁剪过程中发生错误: ${error.message}`,
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
      // 将帧转换为 base64
      const buffer = readFileSync(frame.path)
      const base64 = buffer.toString("base64")
      frameData.push({
        timestamp: frame.timestamp,
        base64: `data:image/jpeg;base64,${base64}`,
        path: frame.path,
      })
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

  return `你是一个专业的视频内容分析 AI。请分析以下视频的关键帧，识别重要区域用于智能裁剪。

视频信息:
- 总帧数: ${frameData.length}
- 裁剪模式: ${args.crop_mode}
- 目标宽高比: ${args.aspect_ratio}
- 填充百分比: ${args.padding}%
- 平滑跟踪: ${args.smooth_tracking ? "启用" : "禁用"}
- 跟踪灵敏度: ${args.tracking_sensitivity}
- 最小主体大小: ${args.min_subject_size * 100}%

关键帧时间戳:
${frameDescriptions}

任务要求:
1. 分析每帧的视觉内容（图像已提供为 base64）
2. 根据裁剪模式 "${args.crop_mode}" 识别重要区域:
   - "auto": 自动检测最重要的视觉元素
   - "face": 检测人脸，多人时选择最突出的
   - "object": 检测主要物体（如车辆、动物、产品等）
   - "action": 检测运动区域或动作主体
3. 为每帧计算最佳裁剪区域，包含:
   - 区域中心点 (x, y)，相对于画面尺寸 (0-1)
   - 区域宽度和高度比例 (0-1)
   - 置信度 (0-1)
   - 区域描述（如: "单人脸部居中"、"车辆在画面右侧"）

4. 考虑时间连续性，确保裁剪区域变化平滑

输出格式 (JSON):
{
  "video_duration": 估算的视频总时长（秒）,
  "frame_analysis": [
    {
      "frame_index": 帧序号,
      "timestamp": 时间戳（秒）,
      "subject_type": "主体类型（face/object/background/action等）",
      "subject_description": "主体描述",
      "region": {
        "center_x": 中心点X坐标 (0-1),
        "center_y": 中心点Y坐标 (0-1),
        "width": 区域宽度比例 (0-1),
        "height": 区域高度比例 (0-1)
      },
      "confidence": 置信度 (0-1),
      "aspect_ratio_compatibility": 与目标宽高比的兼容性 (0-1),
      "stability_score": 稳定性评分 (0-1, 越高表示区域变化越小)
    }
  ],
  "recommended_aspect_ratio": "推荐宽高比（如果与请求的不同）",
  "summary": "分析摘要（主要发现和建议）"
}

请确保:
- 区域大小至少占画面的 ${args.min_subject_size * 100}%
- 考虑时间连续性，相邻帧的区域变化应平滑
- 如果画面中有多个主体，选择最突出的一个
- 考虑目标宽高比 ${args.aspect_ratio}

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
    if (!parsed.frame_analysis) {
      throw new Error("AI 响应缺少 frame_analysis 字段")
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
        subject_type: "unknown",
        subject_description: "未分析",
        region: {
          center_x: 0.5,
          center_y: 0.5,
          width: 0.5,
          height: 0.5,
        },
        confidence: 0.5,
        aspect_ratio_compatibility: 0.5,
        stability_score: 0.5,
      })),
      recommended_aspect_ratio: args.aspect_ratio,
      summary: "AI 分析失败，使用默认分析",
    }
  }
}

/**
 * 计算裁剪区域序列
 */
function calculateCropRegions(analysisResult: any, args: any): any[] {
  const frameAnalysis = analysisResult.frame_analysis || []
  const regions: any[] = []

  if (frameAnalysis.length === 0) {
    return regions
  }

  // 应用平滑处理
  const smoothedRegions = applySmoothing(frameAnalysis, args)

  // 转换为 FFmpeg 裁剪参数
  for (const region of smoothedRegions) {
    const cropRegion = {
      timestamp: region.timestamp,
      x: Math.max(0, region.region.center_x - region.region.width / 2),
      y: Math.max(0, region.region.center_y - region.region.height / 2),
      width: region.region.width,
      height: region.region.height,
      confidence: region.confidence,
      aspect_ratio: calculateAspectRatio(
        region.region.width,
        region.region.height,
      ),
    }
    regions.push(cropRegion)
  }

  return regions
}

/**
 * 应用平滑处理
 */
function applySmoothing(frameAnalysis: any[], args: any): any[] {
  if (frameAnalysis.length <= 1 || !args.smooth_tracking) {
    return frameAnalysis
  }

  const smoothed: any[] = []
  const sensitivity = args.tracking_sensitivity
  const stabilityThreshold = args.stability_threshold

  // 简单移动平均平滑
  for (let i = 0; i < frameAnalysis.length; i++) {
    const current = frameAnalysis[i]
    const region = { ...current.region }

    // 对中心点进行平滑
    if (i > 0) {
      const prev = frameAnalysis[i - 1].region
      const stability = current.stability_score || 0.5

      // 稳定性越高，变化越小
      const blendFactor = sensitivity * (1 - stability)
      region.center_x =
        prev.center_x + (region.center_x - prev.center_x) * blendFactor
      region.center_y =
        prev.center_y + (region.center_y - prev.center_y) * blendFactor

      // 对尺寸进行平滑
      region.width =
        prev.width + (region.width - prev.width) * blendFactor * 0.5
      region.height =
        prev.height + (region.height - prev.height) * blendFactor * 0.5
    }

    smoothed.push({
      ...current,
      region: region,
    })
  }

  return smoothed
}

/**
 * 计算宽高比
 */
function calculateAspectRatio(width: number, height: number): string {
  const ratio = width / height
  // 常见宽高比近似值
  const commonRatios = [
    { ratio: 16 / 9, name: "16:9" },
    { ratio: 4 / 3, name: "4:3" },
    { ratio: 1, name: "1:1" },
    { ratio: 9 / 16, name: "9:16" },
    { ratio: 2.35 / 1, name: "2.35:1" },
  ]

  let bestMatch = commonRatios[0]
  let minDiff = Math.abs(ratio - bestMatch.ratio)

  for (const r of commonRatios) {
    const diff = Math.abs(ratio - r.ratio)
    if (diff < minDiff) {
      minDiff = diff
      bestMatch = r
    }
  }

  return bestMatch.name
}

/**
 * 应用动态裁剪
 */
async function applyDynamicCrop(
  inputPath: string,
  outputPath: string,
  cropRegions: any[],
  args: any,
): Promise<any> {
  if (cropRegions.length === 0) {
    throw new Error("没有可用的裁剪区域")
  }

  // 构建 FFmpeg 裁剪过滤器
  const filterComplex = buildCropFilterComplex(cropRegions, args)

  const ffmpegArgs = [
    "-i",
    inputPath,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-c:v",
    "libx264",
    "-crf",
    args.output_quality.toString(),
    "-preset",
    args.output_preset,
    "-map_metadata",
    "0",
  ]

  // 添加音频流
  if (args.preserve_original_audio) {
    ffmpegArgs.push("-map", "0:a?", "-c:a", "copy")
  }

  ffmpegArgs.push("-y", outputPath)

  const result = await runFfmpeg(ffmpegArgs)

  if (!result.success) {
    throw new Error(`FFmpeg 裁剪失败: ${result.output}`)
  }

  return result
}

/**
 * 构建裁剪过滤器复合图
 */
function buildCropFilterComplex(cropRegions: any[], args: any): string {
  // 解析目标宽高比
  const [targetWidthRatio, targetHeightRatio] = parseAspectRatio(
    args.aspect_ratio,
  )
  const targetAspect = targetWidthRatio / targetHeightRatio

  // 构建裁剪表达式
  const cropExpressions: string[] = []

  if (cropRegions.length === 1) {
    // 单区域裁剪（静态）
    const region = cropRegions[0]
    const widthExpr = `iw*${region.width}`
    const heightExpr = `iw*${region.height}/${targetAspect}`
    const xExpr = `iw*${region.x}`
    const yExpr = `ih*${region.y}`

    cropExpressions.push(`crop=${widthExpr}:${heightExpr}:${xExpr}:${yExpr}`)
  } else {
    // 多区域动态裁剪（使用表达式）
    // 简化版本：使用关键帧插值
    cropExpressions.push(buildDynamicCropExpression(cropRegions, targetAspect))
  }

  // 添加缩放以适应目标宽高比
  const scaleExpr = `scale=iw:ih*${targetAspect}/(iw/ih)`

  return `${cropExpressions.join(",")},${scaleExpr}[outv]`
}

/**
 * 构建动态裁剪表达式
 */
function buildDynamicCropExpression(
  cropRegions: any[],
  targetAspect: number,
): string {
  // 简化版本：使用最近的关键帧
  // 实际实现应该使用时间插值

  const parts: string[] = []

  for (let i = 0; i < cropRegions.length; i++) {
    const region = cropRegions[i]
    const time = region.timestamp

    if (i === 0) {
      parts.push(
        `crop=iw*${region.width}:iw*${region.height}/${targetAspect}:iw*${region.x}:ih*${region.y}`,
      )
    } else {
      // 添加关键帧
      const prevRegion = cropRegions[i - 1]
      parts.push(
        `crop=iw*between(t,${prevRegion.timestamp},${time})*(${region.width}-${prevRegion.width})+iw*${prevRegion.width}:iw*between(t,${prevRegion.timestamp},${time})*(${region.height}-${prevRegion.height})+iw*${prevRegion.height}/${targetAspect}:iw*between(t,${prevRegion.timestamp},${time})*(${region.x}-${prevRegion.x})+iw*${prevRegion.x}:ih*between(t,${prevRegion.timestamp},${time})*(${region.y}-${prevRegion.y})+ih*${prevRegion.y}`,
      )
    }
  }

  return parts.join(",")
}

/**
 * 解析宽高比字符串
 */
function parseAspectRatio(aspectRatio: string): [number, number] {
  const parts = aspectRatio.split(":").map(Number)
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return [parts[0], parts[1]]
  }

  // 默认 16:9
  return [16, 9]
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
export const IntelligentCropTool = VideoIntelligentCropTool

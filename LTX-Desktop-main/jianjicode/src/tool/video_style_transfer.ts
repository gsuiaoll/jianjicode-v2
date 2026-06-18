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
 * 视频风格迁移工具 - 使用 AI 分析视频内容，应用艺术风格
 *
 * 功能:
 * 1. 从视频中提取关键帧
 * 2. 使用 AI 分析帧内容和风格特征
 * 3. 生成风格化参数或滤镜配置
 * 4. 应用 FFmpeg 滤镜实现风格迁移
 */
export const VideoStyleTransferTool = Tool.define("video_style_transfer", {
  description: "使用 AI 分析视频内容，应用艺术风格（电影感、复古、现代等）",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出视频文件路径 (默认: <input>_styled.mp4)"),

    // 风格参数
    style_type: z
      .enum([
        "artistic",
        "cinematic",
        "vintage",
        "modern",
        "noir",
        "fantasy",
        "sci_fi",
        "documentary",
        "custom",
      ])
      .optional()
      .default("cinematic")
      .describe(
        "风格类型: artistic(艺术), cinematic(电影感), vintage(复古), modern(现代), noir(黑色电影), fantasy(奇幻), sci_fi(科幻), documentary(纪录片), custom(自定义)",
      ),
    style_reference: z
      .string()
      .optional()
      .describe("参考风格图像文件路径 (用于自定义风格)"),
    style_strength: z
      .number()
      .min(0.1)
      .max(1)
      .optional()
      .default(0.7)
      .describe("风格强度 (0.1-1，默认: 0.7)"),
    preserve_colors: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否保留原始颜色 (默认: false)"),
    temporal_consistency: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保持时间一致性 (默认: true)"),
    luminance_adjustment: z
      .number()
      .min(-50)
      .max(50)
      .optional()
      .default(0)
      .describe("亮度调整 (-50到50，默认: 0)"),
    saturation_adjustment: z
      .number()
      .min(-50)
      .max(50)
      .optional()
      .default(0)
      .describe("饱和度调整 (-50到50，默认: 0)"),
    contrast_adjustment: z
      .number()
      .min(-50)
      .max(50)
      .optional()
      .default(0)
      .describe("对比度调整 (-50到50，默认: 0)"),

    // 帧提取参数
    frame_rate: z
      .number()
      .min(0.1)
      .max(3)
      .optional()
      .default(1)
      .describe("每秒提取的帧数 (默认: 1帧/秒)"),
    max_frames: z
      .number()
      .min(1)
      .max(30)
      .optional()
      .default(15)
      .describe("最大分析帧数 (默认: 15)"),
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
    maintain_framerate: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保持原始帧率 (默认: true)"),

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
          title: "视频风格迁移失败",
          metadata: { operation: "video_style_transfer", error: true },
          output: `输入文件不存在: ${args.input}`,
        }
      }

      // 验证参考风格图像（如果提供）
      if (args.style_reference && !existsSync(args.style_reference)) {
        return {
          title: "视频风格迁移失败",
          metadata: { operation: "video_style_transfer", error: true },
          output: `参考风格图像不存在: ${args.style_reference}`,
        }
      }

      // 2. 创建临时目录
      const tempDir =
        args.temp_dir ||
        join(dirname(args.input), `.style_transfer_${Date.now()}`)
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true })
      }

      // 3. 提取关键帧
      console.log(`[VideoStyleTransfer] 从视频提取关键帧...`)
      const frames = await extractKeyFrames(
        args.input,
        tempDir,
        args.frame_rate,
        args.max_frames,
        args.frame_quality,
      )

      if (frames.length === 0) {
        return {
          title: "视频风格迁移失败",
          metadata: { operation: "video_style_transfer", error: true },
          output: "无法从视频中提取关键帧",
        }
      }

      console.log(`[VideoStyleTransfer] 提取了 ${frames.length} 个关键帧`)

      // 4. 使用 AI 分析帧和风格
      console.log(`[VideoStyleTransfer] 使用 AI 分析视频内容和风格...`)
      const analysisResult = await analyzeFramesWithAI(frames, args)

      // 5. 生成风格化滤镜参数
      console.log(`[VideoStyleTransfer] 生成风格化滤镜参数...`)
      const filterParams = generateFilterParameters(analysisResult, args)

      // 6. 应用风格化滤镜
      console.log(`[VideoStyleTransfer] 应用风格化滤镜...`)
      const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_styled.mp4`

      // 安全检查
      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "video_style_transfer",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      const styleResult = await applyStyleFilter(
        args.input,
        outputPath,
        filterParams,
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
        console.warn(`[VideoStyleTransfer] 临时文件清理失败: ${cleanupError}`)
      }

      // 8. 返回结果
      return {
        title: "视频风格迁移成功",
        metadata: {
          operation: "video_style_transfer",
          success: true,
          error: false,
          outputPath: outputPath,
          inputPath: args.input,
          styleType: args.style_type,
          styleStrength: args.style_strength,
          filterParameters: filterParams,
        },
        output: `✅ 风格迁移完成\n📁 输入文件: ${args.input}\n📁 输出文件: ${outputPath}\n🎨 风格类型: ${args.style_type}\n💪 风格强度: ${args.style_strength}\n🎬 分析帧数: ${frames.length}\n🕒 视频时长: ${analysisResult.video_duration?.toFixed(1) || "未知"}秒\n🔧 应用滤镜: ${filterParams.filter_chain?.length || 0}个`,
      }
    } catch (error: any) {
      return {
        title: "视频风格迁移错误",
        metadata: {
          operation: "video_style_transfer",
          error: true,
          success: false,
        },
        output: `❌ 风格迁移过程中发生错误: ${error.message}`,
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
 * 使用 AI 分析帧和风格
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

    // 2. 准备风格参考图像（如果提供）
    let styleReferenceBase64 = ""
    if (args.style_reference && existsSync(args.style_reference)) {
      const buffer = readFileSync(args.style_reference)
      styleReferenceBase64 = buffer.toString("base64")
    }

    // 3. 准备 AI 提示词
    const prompt = createAnalysisPrompt(frameData, styleReferenceBase64, args)

    // 4. 调用 AI 模型
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

    // 5. 解析 AI 响应
    return parseAIResponse(text, frameData, args)
  } catch (error: any) {
    console.error(`AI 分析失败: ${error}`)
    throw new Error(`AI 分析失败: ${error.message}`)
  }
}

/**
 * 创建分析提示词
 */
function createAnalysisPrompt(
  frameData: any[],
  styleReferenceBase64: string,
  args: any,
): string {
  const frameDescriptions = frameData
    .map((frame, i) => `帧 ${i + 1}: 时间戳 ${formatTime(frame.timestamp)}`)
    .join("\n")

  const styleDescription =
    args.style_type === "custom" && styleReferenceBase64
      ? `自定义风格参考图像已提供 (base64)`
      : `预定义风格: ${args.style_type}`

  return `你是一个专业的视频风格分析 AI。请分析以下视频的关键帧，并为风格迁移生成滤镜参数。

视频信息:
- 总帧数: ${frameData.length}
- 目标风格: ${args.style_type}
- 风格强度: ${args.style_strength}
- 保持时间一致性: ${args.temporal_consistency ? "是" : "否"}
- 保留原始颜色: ${args.preserve_colors ? "是" : "否"}
${styleDescription}

关键帧时间戳:
${frameDescriptions}

任务要求:
1. 分析每帧的视觉内容（图像已提供为 base64）
2. 分析当前视频的视觉特征:
   - 色彩调性（冷暖、饱和度、亮度）
   - 对比度特征
   - 细节层次（纹理、锐度）
   - 整体氛围（明亮/阴暗、活泼/沉静）

3. 根据目标风格 "${args.style_type}" 生成 FFmpeg 滤镜参数:
   - 色彩平衡 (colorbalance)
   - 颜色等级 (colorlevels)
   - 曲线调整 (curves)
   - 色调/饱和度/亮度 (hue/saturation/brightness)
   - 对比度 (contrast)
   - 锐化/模糊 (unsharp/blur)
   - 颗粒/噪点 (noise)

4. 考虑时间一致性: ${args.temporal_consistency ? "确保滤镜参数随时间平滑变化" : "每帧可以独立处理"}

输出格式 (JSON):
{
  "video_duration": 估算的视频总时长（秒）,
  "current_style_analysis": {
    "color_tone": "色彩调性描述",
    "contrast_level": "对比度等级 (低/中/高)",
    "brightness_level": "亮度等级 (低/中/高)",
    "saturation_level": "饱和度等级 (低/中/高)",
    "detail_level": "细节等级 (低/中/高)",
    "overall_mood": "整体氛围描述"
  },
  "target_style_characteristics": {
    "description": "目标风格特征描述",
    "color_palette": ["主色调1", "主色调2", "辅助色调"],
    "contrast_tendency": "对比度倾向 (增强/减弱/保持)",
    "brightness_tendency": "亮度倾向 (提高/降低/保持)",
    "saturation_tendency": "饱和度倾向 (提高/降低/保持)",
    "detail_tendency": "细节倾向 (锐化/柔化/保持)",
    "atmospheric_effects": ["氛围效果1", "氛围效果2"]
  },
  "filter_parameters": {
    "colorbalance": {
      "rs": 红-阴影调整 (-1到1),
      "gs": 绿-阴影调整 (-1到1),
      "bs": 蓝-阴影调整 (-1到1),
      "rm": 红-中间调调整 (-1到1),
      "gm": 绿-中间调调整 (-1到1),
      "bm": 蓝-中间调调整 (-1到1),
      "rh": 红-高光调整 (-1到1),
      "gh": 绿-高光调整 (-1到1),
      "bh": 蓝-高光调整 (-1到1)
    },
    "colorlevels": {
      "rimin": 红输入最小值 (0-1),
      "gimin": 绿输入最小值 (0-1),
      "bimin": 蓝输入最小值 (0-1),
      "rimax": 红输入最大值 (0-1),
      "gimax": 绿输入最大值 (0-1),
      "bimax": 蓝输入最大值 (0-1),
      "romin": 红输出最小值 (0-1),
      "gomin": 绿输出最小值 (0-1),
      "bomin": 蓝输出最小值 (0-1),
      "romax": 红输出最大值 (0-1),
      "gomax": 绿输出最大值 (0-1),
      "bomax": 蓝输出最大值 (0-1)
    },
    "curves": {
      "preset": "预设名称 (none, color_negative, cross_process, darker, increase_contrast, lighter, linear_contrast, medium_contrast, negative, strong_contrast, vsco)",
      "master": "主曲线 (逗号分隔的点)",
      "red": "红色曲线 (逗号分隔的点)",
      "green": "绿色曲线 (逗号分隔的点)",
      "blue": "蓝色曲线 (逗号分隔的点)"
    },
    "hue": {
      "hue": "色调角度 (-180到180)",
      "saturation": "饱和度乘数 (0-3)",
      "brightness": "亮度乘数 (0-3)"
    },
    "contrast": {
      "contrast": "对比度调整 (-1000到1000)"
    },
    "unsharp": {
      "luma_msize_x": "亮度矩阵X尺寸 (3-23, 奇数)",
      "luma_msize_y": "亮度矩阵Y尺寸 (3-23, 奇数)",
      "luma_amount": "亮度强度 (-1.5到1.5)"
    },
    "noise": {
      "alls": "所有通道强度 (0-100)",
      "allf": "所有通道淡入淡出 (0-100)"
    }
  },
  "filter_chain": [
    "建议的滤镜链 (如: colorbalance=rs=0.1:gs=-0.1,hue=h=10:s=1.2)"
  ],
  "summary": "分析摘要和建议"
}

请确保:
- 滤镜参数适合 FFmpeg 语法
- 风格强度 ${args.style_strength} 应反映在参数值中
- ${args.preserve_colors ? "尽量保留原始色彩关系" : "可以根据风格需要改变色彩"}
- 考虑视频内容的匹配性

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
    if (!parsed.filter_parameters) {
      throw new Error("AI 响应缺少 filter_parameters 字段")
    }

    return parsed
  } catch (error: any) {
    console.warn(`解析 AI 响应失败: ${error}`)
    // 返回默认结构
    return {
      video_duration:
        frameData.length > 0 ? frameData[frameData.length - 1].timestamp : 0,
      current_style_analysis: {
        color_tone: "neutral",
        contrast_level: "medium",
        brightness_level: "medium",
        saturation_level: "medium",
        detail_level: "medium",
        overall_mood: "neutral",
      },
      target_style_characteristics: {
        description: args.style_type,
        color_palette: ["neutral"],
        contrast_tendency: "保持",
        brightness_tendency: "保持",
        saturation_tendency: "保持",
        detail_tendency: "保持",
        atmospheric_effects: [],
      },
      filter_parameters: getDefaultFilterParameters(args),
      filter_chain: [getDefaultFilterChain(args)],
      summary: "AI 分析失败，使用默认滤镜参数",
    }
  }
}

/**
 * 获取默认滤镜参数
 */
function getDefaultFilterParameters(args: any): any {
  // 基于风格类型提供默认参数
  const styleDefaults: Record<string, any> = {
    cinematic: {
      colorbalance: {
        rs: 0.1,
        gs: -0.1,
        bs: -0.2,
        rm: 0.05,
        gm: 0,
        bm: -0.1,
        rh: 0,
        gh: 0.05,
        bh: 0.1,
      },
      contrast: { contrast: 150 },
      saturation: { saturation: 1.2 },
    },
    vintage: {
      colorbalance: {
        rs: 0.2,
        gs: 0.1,
        bs: -0.1,
        rm: 0.1,
        gm: 0.05,
        bm: -0.05,
        rh: -0.1,
        gh: -0.05,
        bh: 0.1,
      },
      hue: { hue: 10, saturation: 0.9, brightness: 0.95 },
      noise: { alls: 5, allf: 50 },
    },
    noir: {
      colorbalance: {
        rs: -0.1,
        gs: -0.1,
        bs: -0.1,
        rm: -0.05,
        gm: -0.05,
        bm: -0.05,
        rh: 0.1,
        gh: 0.1,
        bh: 0.1,
      },
      contrast: { contrast: 300 },
      saturation: { saturation: 0.3 },
    },
    fantasy: {
      colorbalance: {
        rs: 0.1,
        gs: 0.2,
        bs: -0.1,
        rm: 0.05,
        gm: 0.1,
        bm: -0.05,
        rh: -0.1,
        gh: 0.05,
        bh: 0.2,
      },
      saturation: { saturation: 1.5 },
      hue: { hue: -5, saturation: 1.3, brightness: 1.1 },
    },
  }

  const defaultParams =
    styleDefaults[args.style_type] || styleDefaults["cinematic"]

  // 应用风格强度
  const strength = args.style_strength
  for (const category in defaultParams) {
    for (const param in defaultParams[category]) {
      if (typeof defaultParams[category][param] === "number") {
        defaultParams[category][param] =
          defaultParams[category][param] * strength
      }
    }
  }

  // 添加用户手动调整
  if (args.luminance_adjustment !== 0) {
    defaultParams.brightness = defaultParams.brightness || {}
    defaultParams.brightness.brightness = (args.luminance_adjustment / 100) * 2 // 转换为乘数
  }

  if (args.saturation_adjustment !== 0) {
    defaultParams.saturation = defaultParams.saturation || {}
    defaultParams.saturation.saturation = 1 + args.saturation_adjustment / 100
  }

  if (args.contrast_adjustment !== 0) {
    defaultParams.contrast = defaultParams.contrast || {}
    defaultParams.contrast.contrast = args.contrast_adjustment * 10
  }

  return defaultParams
}

/**
 * 获取默认滤镜链
 */
function getDefaultFilterChain(args: any): string {
  const params = getDefaultFilterParameters(args)
  const filters: string[] = []

  if (params.colorbalance) {
    const cb = params.colorbalance
    filters.push(
      `colorbalance=rs=${cb.rs || 0}:gs=${cb.gs || 0}:bs=${cb.bs || 0}:rm=${cb.rm || 0}:gm=${cb.gm || 0}:bm=${cb.bm || 0}:rh=${cb.rh || 0}:gh=${cb.gh || 0}:bh=${cb.bh || 0}`,
    )
  }

  if (params.contrast) {
    filters.push(`contrast=${params.contrast.contrast || 100}`)
  }

  if (params.saturation) {
    filters.push(`saturation=${params.saturation.saturation || 1}`)
  }

  if (params.hue) {
    const h = params.hue
    filters.push(
      `hue=h=${h.hue || 0}:s=${h.saturation || 1}:b=${h.brightness || 1}`,
    )
  }

  if (params.noise) {
    filters.push(
      `noise=alls=${params.noise.alls || 0}:allf=${params.noise.allf || 0}`,
    )
  }

  return filters.join(",")
}

/**
 * 生成风格化滤镜参数
 */
function generateFilterParameters(analysisResult: any, args: any): any {
  // 使用 AI 分析结果，或回退到默认参数
  const filterParams =
    analysisResult.filter_parameters || getDefaultFilterParameters(args)
  const filterChain = analysisResult.filter_chain || [
    getDefaultFilterChain(args),
  ]

  return {
    ...filterParams,
    filter_chain: filterChain,
    style_type: args.style_type,
    style_strength: args.style_strength,
    temporal_consistency: args.temporal_consistency,
  }
}

/**
 * 应用风格化滤镜
 */
async function applyStyleFilter(
  inputPath: string,
  outputPath: string,
  filterParams: any,
  args: any,
): Promise<any> {
  // 选择滤镜链
  const filterChain =
    Array.isArray(filterParams.filter_chain) &&
    filterParams.filter_chain.length > 0
      ? filterParams.filter_chain[0]
      : getDefaultFilterChain(args)

  const ffmpegArgs = [
    "-i",
    inputPath,
    "-vf",
    filterChain,
    "-c:v",
    "libx264",
    "-crf",
    args.output_quality.toString(),
    "-preset",
    args.output_preset,
    "-map_metadata",
    "0",
    "-map",
    "0:a?",
    "-c:a",
    "copy",
  ]

  if (args.maintain_framerate) {
    ffmpegArgs.push("-r", "copy")
  }

  ffmpegArgs.push("-y", outputPath)

  const result = await runFfmpeg(ffmpegArgs)

  if (!result.success) {
    throw new Error(`FFmpeg 风格迁移失败: ${result.output}`)
  }

  return result
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
export const StyleTransferTool = VideoStyleTransferTool

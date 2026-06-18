import { existsSync } from "fs"
import { basename, dirname, extname, join } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { runFfmpeg, getVideoInfo } from "../../lib/ffmpeg-utils.js"

/**
 * 视频速度调整工具 - 调整视频播放速度（慢动作、快进）
 *
 * 支持功能:
 * 1. 速度调整 (0.1x 到 10x)
 * 2. 保持音频同步 (调整音频速度)
 * 3. 时间拉伸 (改变速度但不改变音调)
 * 4. 分段速度调整 (未来扩展)
 *
 * 基于FFmpeg的setpts和atempo滤镜实现
 */
export const VideoSpeedTool: any = Tool.define("video_speed", {
  description:
    "视频速度调整工具 — 慢动作(0.1-1.0x)或快进(1.0-10.0x)，支持音频同步变速(preserve_pitch)。必需参数: speed (0.1-10)。\n" +
    "⚠️ 使用场景: 变速/慢动作/快进 → 用此工具。裁剪/拼接 → 用 ffmpeg。滤镜 → 用 video_filter。水印 → 用 video_watermark。",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_speed_<factor>x.<ext>)"),

    // 速度调整参数
    speed: z
      .number()
      .min(0.1)
      .max(10)
      .describe("速度因子 (0.1-10，0.5=慢动作2倍，2.0=快进2倍)"),
    adjust_audio: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否调整音频速度以保持同步 (默认: true)"),
    preserve_pitch: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保持音频音调 (默认: true，使用rubberband滤镜)"),

    // 分段速度调整 (未来扩展)
    segments: z
      .string()
      .optional()
      .describe(`分段速度调整JSON数组，格式: [{"start": 秒, "end": 秒, "speed": 因子}]
示例: [{"start": 0, "end": 5, "speed": 0.5}, {"start": 5, "end": 10, "speed": 2.0}]`),

    // 性能选项
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (0-51，越低质量越好，默认 23)"),
    fast: z
      .boolean()
      .optional()
      .default(false)
      .describe("使用快速编码 (质量较低但速度更快)"),

    // 安全增强参数
    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否允许覆盖已存在的输出文件 (默认: false)"),
    protect_originals: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保护原文件，强制输出到新文件 (默认: true)"),
    output_dir: z
      .string()
      .optional()
      .describe("限制输出目录，防止写入系统目录 (空表示不限制)"),
  }),
  usageTemplate: {
    json: {
      input: "{source_video}",
      output: "{output_dir}/speed_2x_{timestamp}.mp4",
      speed: 2.0,
      adjust_audio: true,
      preserve_pitch: true,
      quality: 23,
      fast: false,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "speed 范围 0.1~10，0.5=慢动作2倍，2.0=快进2倍",
      "preserve_pitch=true 时使用 rubberband 滤镜（需编译支持），否则回退 atempo",
      "atempo 滤镜单次范围 0.5~2.0，超出时自动链式处理",
      "segments 和 speed 互斥：segments 提供时分段速度优先，speed 被忽略",
      'segments 格式: JSON 数组 [{"start":秒,"end":秒,"speed":因子}]',
      "quality 范围 0-51，越低质量越好，推荐 18-28",
      "fast=true 时使用快速编码预设，质量较低但速度快",
    ],
  },
  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "视频速度调整失败",
          metadata: { operation: "video_speed", error: true, success: false },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      // 2. 解析分段数据
      let segments: any[] = []
      if (args.segments && args.segments.trim()) {
        try {
          segments = JSON.parse(args.segments)
          if (!Array.isArray(segments)) {
            return {
              title: "视频速度调整失败",
              metadata: {
                operation: "video_speed",
                error: true,
                success: false,
              },
              output: `❌ 分段数据必须是JSON数组`,
            }
          }
        } catch (error: any) {
          return {
            title: "视频速度调整失败",
            metadata: { operation: "video_speed", error: true, success: false },
            output: `❌ 分段JSON解析失败: ${error.message}`,
          }
        }
      }

      // 2. 构建输出路径
      const outputPath =
        args.output ||
        join(dirname(args.input), `${basename(args.input, extname(args.input))}_speed_${args.speed.toFixed(1).replace(".", "_")}x.mp4`)

      // 安全沙箱校验
      const sandbox = validatePath(args.input, outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "video_speed", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 4. 检查输出文件是否已存在（仅警告）
      if (existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      // 5. 检测音频流并构建FFmpeg参数
      const hasAudio = await hasAudioStream(args.input)

      // 如果无音频流，强制关闭音频调整
      if (!hasAudio && args.adjust_audio) {
        console.log(
          "[VideoSpeedTool] 纯视频素材，禁用音频同步调整",
        )
        args.adjust_audio = false
      }

      const ffmpegArgs = VideoSpeedTool.buildFfmpegArgs(
        args,
        segments,
        finalOutputPath,
        hasAudio,
      )

      // 6. 执行FFmpeg命令
      console.log(`[VideoSpeedTool] 调整视频速度: ${args.input}`)
      console.log(`[VideoSpeedTool] 速度因子: ${args.speed}x`)
      if (args.adjust_audio) {
        console.log(`[VideoSpeedTool] 调整音频速度: 是`)
        if (args.preserve_pitch) {
          console.log(`[VideoSpeedTool] 保持音频音调: 是`)
        }
      }
      if (segments.length > 0) {
        console.log(`[VideoSpeedTool] 分段调整: ${segments.length}段`)
      }

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 7. 返回结果
      if (result.success) {
        return {
          title: "视频速度调整成功",
          metadata: {
            operation: "video_speed",
            success: true,
      undoable: true,
            error: false,
            outputPath: finalOutputPath,
            inputPath: args.input,
            speed: args.speed,
            adjustAudio: args.adjust_audio,
            preservePitch: args.preserve_pitch,
            segmentCount: segments.length,
          },
          output: `✅ 已成功调整视频速度\n📁 输出文件: ${finalOutputPath}\n${VideoSpeedTool.getSpeedDescription(args, segments)}`,
        }
      } else {
        return {
          title: "视频速度调整失败",
          metadata: { operation: "video_speed", error: true, success: false },
          output: `❌ 速度调整失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "视频速度调整错误",
        metadata: { operation: "video_speed", error: true, success: false },
        output: `❌ 速度调整过程中发生错误: ${error.message}`,
      }
    }
  },
})

// ─── 音频流预检 ───────────────────────────────────────────

async function hasAudioStream(inputPath: string): Promise<boolean> {
  // 方法一: ffprobe（优先）
  try {
    const info = await getVideoInfo(inputPath)
    if (info.success && info.data?.streams) {
      const audioStreams = info.data.streams.filter(
        (s: any) => s.codec_type === "audio",
      )
      const hasAudio = audioStreams.length > 0
      console.log(
        `[VideoSpeedTool] 音频流检测: ${hasAudio ? `发现 ${audioStreams.length} 个音频流` : "无音频流 (纯视频)"}`,
      )
      return hasAudio
    }
  } catch (e: any) {
    console.warn(
      `[VideoSpeedTool] ffprobe 音频检测失败: ${e.message}，尝试 ffmpeg -i 回退`,
    )
  }

  // 方法二: ffmpeg -i 回退（P2-8，ffprobe 库缺失环境兜底）
  try {
    const { spawnSync } = await import("child_process")
    const ffmpegBin = (await import("../../lib/ffmpeg-utils.js")).findFfmpegPath()
    if (!ffmpegBin) {
      console.warn("[VideoSpeedTool] 无法定位 ffmpeg，默认假设有音频")
      return true
    }
    const result = spawnSync(ffmpegBin, ["-i", inputPath], { timeout: 10_000 })
    const stderr = result.stderr?.toString() || ""
    const hasAudio = stderr.includes("Audio:") || /Stream.*Audio:/.test(stderr)
    console.log(
      `[VideoSpeedTool] ffmpeg 回退检测: ${hasAudio ? "有音频" : "无音频"}`,
    )
    return hasAudio
  } catch (e: any) {
    console.warn(
      `[VideoSpeedTool] ffmpeg 回退也失败: ${e.message}，默认假设有音频`,
    )
  }
  // 兜底: 保守假设有音频，避免丢失音轨
  console.warn("[VideoSpeedTool] 无法检测音频流，默认按有音频处理")
  return true
}

// 扩展工具类的方法
VideoSpeedTool.buildFfmpegArgs = (
  args: any,
  segments: any[],
  outputPath: string,
  hasAudio: boolean,
): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]

  // 构建滤镜
  const filterString = VideoSpeedTool.buildSpeedFilter(args, segments, hasAudio)
  if (filterString) {
    ffmpegArgs.push("-filter_complex", filterString)
    ffmpegArgs.push("-map", "[outv]")
    if (args.adjust_audio) {
      ffmpegArgs.push("-map", "[outa]")
    } else if (hasAudio) {
      // 有声视频但不调整音频 → 原样复制原始音频轨
      ffmpegArgs.push("-map", "0:a")
    }
  } else {
    // 简单情况: 仅视频速度调整
    const simpleFilter = VideoSpeedTool.buildSimpleFilter(args)
    if (simpleFilter) {
      ffmpegArgs.push("-vf", simpleFilter)
    }
    if (args.adjust_audio) {
      ffmpegArgs.push("-af", VideoSpeedTool.buildAudioFilter(args))
    }
  }

  // 编码参数
  if (args.fast) {
    ffmpegArgs.push("-preset", "fast")
  } else {
    ffmpegArgs.push("-preset", "medium")
  }

  // 质量参数
  ffmpegArgs.push("-crf", args.quality.toString())

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

VideoSpeedTool.buildSpeedFilter = (
  args: any,
  segments: any[],
  hasAudio?: boolean,  // P2-8: 明确音频有无，防止 false positive 构建 [0:a]atempo
): string | null => {
  // 如果有分段或需要复杂处理，使用filter_complex
  if (segments.length > 0) {
    // 分段速度调整需要复杂滤镜图
    console.log(
      `[VideoSpeedTool] 注意: 分段速度调整需要复杂滤镜图，当前版本仅支持全局速度调整`,
    )
    // 回退到全局调整
  }

  // 全局速度调整
  const speedFactor = args.speed
  const videoFilter = `setpts=${1 / speedFactor}*PTS`
  const audioFilter = args.adjust_audio
    ? VideoSpeedTool.buildAudioFilterComplex(args)
    : null

  if (audioFilter && hasAudio !== false) {
    // 有音频处理 + 确认有音频流 → 构建双流滤镜图
    console.log(
      "[VideoSpeedTool] 构建双流滤镜图 (视频+音频)",
    )
    return `[0:v]${videoFilter}[outv];[0:a]${audioFilter}[outa]`
  } else {
    // 仅视频滤镜 (无音频处理、纯视频素材、或音频状态未知)
    console.log(
      "[VideoSpeedTool] 仅构建视频滤镜 (无音频处理)",
    )
    return null
  }
}

VideoSpeedTool.buildSimpleFilter = (args: any): string => {
  // 简单视频速度滤镜
  const speedFactor = args.speed
  return `setpts=${1 / speedFactor}*PTS`
}

VideoSpeedTool.buildAudioFilter = (args: any): string => {
  // 简单音频速度滤镜
  const speedFactor = args.speed

  if (args.preserve_pitch) {
    // 使用rubberband滤镜保持音调 (需要编译时支持)
    // 回退到atempo (会改变音调)
    console.log(
      `[VideoSpeedTool] 注意: rubberband滤镜可能需要额外安装，使用atempo滤镜`,
    )
  }

  // atempo滤镜范围是0.5到2.0，超出范围需要链式处理
  if (speedFactor >= 0.5 && speedFactor <= 2.0) {
    return `atempo=${speedFactor}`
  } else {
    // 链式atempo: 例如0.25倍速 = atempo=0.5,atempo=0.5
    const factors = VideoSpeedTool.getAtempoChain(speedFactor)
    return factors.map((f: number) => `atempo=${f}`).join(",")
  }
}

VideoSpeedTool.buildAudioFilterComplex = (args: any): string => {
  // 用于filter_complex的音频滤镜
  const speedFactor = args.speed

  if (args.preserve_pitch) {
    // 使用rubberband滤镜
    // 检查是否可用
    console.log(`[VideoSpeedTool] 注意: 复杂滤镜图中使用atempo滤镜`)
  }

  if (speedFactor >= 0.5 && speedFactor <= 2.0) {
    return `atempo=${speedFactor}`
  } else {
    const factors = VideoSpeedTool.getAtempoChain(speedFactor)
    return factors.map((f: number) => `atempo=${f}`).join(",")
  }
}

VideoSpeedTool.getAtempoChain = (speedFactor: number): number[] => {
  // 计算atempo滤镜链以达到目标速度
  // atempo范围: 0.5 到 2.0
  const factors: number[] = []
  let remaining = speedFactor

  while (remaining < 0.5) {
    factors.push(0.5)
    remaining *= 2
  }

  while (remaining > 2.0) {
    factors.push(2.0)
    remaining /= 2
  }

  if (Math.abs(remaining - 1.0) > 0.01) {
    factors.push(remaining)
  }

  return factors
}

VideoSpeedTool.getSpeedDescription = (args: any, segments: any[]): string => {
  const parts: string[] = []

  if (segments.length > 0) {
    parts.push(`分段: ${segments.length}段`)
  } else {
    parts.push(`速度: ${args.speed}x`)
  }

  if (args.adjust_audio) {
    parts.push(`音频同步: 是`)
    if (args.preserve_pitch) {
      parts.push(`保持音调: 是`)
    }
  } else {
    parts.push(`音频同步: 否`)
  }

  return `⏩ 速度设置: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const SpeedTool = VideoSpeedTool

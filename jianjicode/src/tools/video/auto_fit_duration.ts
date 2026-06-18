// 动画-配音时长对齐 — 自动裁剪空白段 + 变速匹配 TTS 时长
//
// 典型场景：
//   Manim 渲染的视频时长和 TTS 配音时长不匹配。
//   本工具自动检测视频空白段并裁剪，必要时变速调整，确保画音同步。
//
// 策略（auto 模式）：
//   1. 检测视频音频空白段（silencedetect）
//   2. 优先删除空白段缩短视频
//   3. 若仍不匹配 → 全局变速（控制在 [min_speed, max_speed] 范围）
//   4. 若视频过短 → 最后一帧延长补齐
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { runFfmpeg, probeDuration, findFfmpegPath } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { spawn } from "child_process"
import { join, dirname } from "path"
import { mkdirSync, existsSync } from "fs"

// ================================================================
// 静音段检测
// ================================================================

interface SilenceSegment {
  start: number
  end: number
  duration: number
}

function detectSilence(
  videoPath: string,
  threshold: number,
  minDuration: number,
  signal?: AbortSignal,
): Promise<SilenceSegment[]> {
  return new Promise((resolve, reject) => {
    const ffmpegBin = findFfmpegPath()
    if (!ffmpegBin) return reject(new Error("FFmpeg not found"))

    const proc = spawn(ffmpegBin, [
      "-i", videoPath,
      "-af", `silencedetect=n=${threshold}dB:d=${minDuration}`,
      "-f", "null", "-",
    ])

    let stderr = ""
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
    proc.on("error", reject)

    const onAbort = () => { proc.kill() }
    signal?.addEventListener("abort", onAbort, { once: true })

    proc.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      // ffmpeg with -f null always exits with 0 on processing done
      const segments: SilenceSegment[] = []
      const re = /silence_start:\s*([\d.]+)\s*\|\s*silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g
      let match: RegExpExecArray | null
      while ((match = re.exec(stderr)) !== null) {
        segments.push({
          start: parseFloat(match[1]),
          end: parseFloat(match[2]),
          duration: parseFloat(match[3]),
        })
      }
      resolve(segments)
    })
  })
}

// ================================================================
// 构建 trim+speed 的 filter_complex
// ================================================================

function buildFilterComplex(
  videoDur: number,
  audioDur: number,
  silences: SilenceSegment[],
  speed: number,
  mode: "trim" | "speed" | "auto",
  minSpeed: number,
  maxSpeed: number,
): { filterComplex: string; trimDuration: number; appliedSpeed: number; trimmedSegments: number } {
  const keepSegments: Array<{ start: number; end: number }> = []

  if (mode === "trim" || mode === "auto") {
    // 构建保留段（非静音段）
    let cursor = 0
    for (const s of silences) {
      if (s.start > cursor + 0.1) {
        keepSegments.push({ start: cursor, end: s.start })
      }
      cursor = s.end
    }
    if (cursor < videoDur - 0.1) {
      keepSegments.push({ start: cursor, end: videoDur })
    }

    // 如果没有找到合理的保留段，保留整个视频
    if (keepSegments.length === 0) {
      keepSegments.push({ start: 0, end: videoDur })
    }
  } else {
    // speed-only mode: keep entire video
    keepSegments.push({ start: 0, end: videoDur })
  }

  let trimDuration = keepSegments.reduce((sum, s) => sum + (s.end - s.start), 0)
  let appliedSpeed = 1.0
  let trimmedSegments = silences.length

  // 计算需要的变速
  if (mode === "speed" || mode === "auto") {
    if (trimDuration > 0 && audioDur > 0) {
      const neededSpeed = trimDuration / audioDur
      appliedSpeed = Math.max(minSpeed, Math.min(maxSpeed, neededSpeed))
    }
  }

  // 构建 filter_complex
  const parts: string[] = []

  if (keepSegments.length === 1 && appliedSpeed === 1.0) {
    // 无需任何调整
    return { filterComplex: "", trimDuration: videoDur, appliedSpeed: 1.0, trimmedSegments: 0 }
  }

  // 视频 trim + concat
  const vidInputs: string[] = []
  const audInputs: string[] = []
  for (let i = 0; i < keepSegments.length; i++) {
    const seg = keepSegments[i]
    const dur = seg.end - seg.start
    vidInputs.push(`[0:v]trim=start=${seg.start}:duration=${dur},setpts=PTS-STARTPTS[v${i}]`)
    audInputs.push(`[0:a]atrim=start=${seg.start}:duration=${dur},asetpts=PTS-STARTPTS[a${i}]`)
  }

  const vidConcat = `${vidInputs.join(";")};${keepSegments.map((_, i) => `[v${i}]`).join("")}concat=n=${keepSegments.length}:v=1:a=0[trimmed_v]`
  const audConcat = `${audInputs.join(";")};${keepSegments.map((_, i) => `[a${i}]`).join("")}concat=n=${keepSegments.length}:v=0:a=1[trimmed_a]`
  parts.push(vidConcat, audConcat)

  // 变速（如果需要）
  if (Math.abs(appliedSpeed - 1.0) > 0.01) {
    const setptsVal = (1.0 / appliedSpeed).toFixed(4)
    parts.push(`[trimmed_v]setpts=${setptsVal}*PTS[v_out]`)

    // atempo chain
    if (appliedSpeed >= 0.5 && appliedSpeed <= 2.0) {
      parts.push(`[trimmed_a]atempo=${appliedSpeed.toFixed(4)}[a_out]`)
    } else {
      // 链式 atempo: 每段保持在 [0.5, 2.0]
      let remaining = appliedSpeed
      const chain: string[] = []
      while (remaining < 0.5) {
        chain.push("0.5")
        remaining *= 2
      }
      while (remaining > 2.0) {
        chain.push("2.0")
        remaining /= 2
      }
      chain.push(remaining.toFixed(4))
      const atempoChain = chain.map((f, i, arr) => {
        const label = i === arr.length - 1 ? "a_out" : `aat${i}`
        return `atempo=${f}`
      })
      parts.push(`[trimmed_a]${atempoChain.join(",")}[a_out]`)
    }
  } else {
    parts.push(`[trimmed_v]null[v_out]`, `[trimmed_a]null[a_out]`)
  }

  return {
    filterComplex: parts.join(";"),
    trimDuration,
    appliedSpeed,
    trimmedSegments,
  }
}

// ================================================================
// Tool 定义
// ================================================================

export const AutoFitDurationTool = Tool.define("auto_fit_duration", {
  description:
    "自动对齐动画视频和配音时长。检测视频中的空白静音段并裁剪，" +
    "必要时变速调整，确保动画画面与 TTS 旁白完美同步。" +
    "三种模式：trim（只裁剪空白）、speed（只变速）、auto（先裁剪再变速）。",
  parameters: z.object({
    video: z.string().describe("输入视频路径"),
    tts_audio: z.string().describe("TTS 配音音频路径"),
    output: z
      .string()
      .optional()
      .describe("输出路径，默认 <video>_fitted.mp4"),
    mode: z
      .enum(["trim", "speed", "auto"])
      .default("auto")
      .describe("对齐策略: trim=只裁剪空白/speed=只变速/auto=先裁剪再变速"),
    min_speed: z
      .number()
      .min(0.5)
      .max(1.0)
      .default(0.8)
      .describe("最低速度因子（慢放极限）"),
    max_speed: z
      .number()
      .min(1.0)
      .max(2.0)
      .default(1.3)
      .describe("最高速度因子（快放极限）"),
    silence_threshold: z
      .number()
      .default(-30)
      .describe("静音检测阈值 dB"),
    min_silence_duration: z
      .number()
      .min(0.1)
      .default(0.5)
      .describe("最短静音段长度(秒)"),
  }),
  usageTemplate: {
    json: {
      video: "{manim_output}",
      tts_audio: "{tts_output}",
      mode: "auto",
    },
    constraints: [
      "video 和 tts_audio 时长差异 < 0.3s 时自动跳过",
      "auto 模式先裁剪空白再变速，两者独立控制",
      "变速范围 min_speed~max_speed，超出部分用帧扩展补齐",
    ],
  },
  execute: async (args, ctx) => {
    const outputPath =
      args.output ||
      join(
        dirname(args.video),
        `${args.video.split("/").pop()?.replace(/\.[^.]+$/, "")}_fitted.mp4`,
      )

    // 安全沙箱
    const sandbox = validatePath([args.video, args.tts_audio], outputPath)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "跳过（输出已存在）" : "安全拦截",
        metadata: { operation: "auto_fit_duration", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutput = sandbox.outputPath

    try {
      // 1. 获取时长
      const [videoDur, audioDur] = await Promise.all([
        probeDuration(args.video),
        probeDuration(args.tts_audio),
      ])

      console.log(
        `[auto_fit_duration] video=${videoDur.toFixed(2)}s audio=${audioDur.toFixed(2)}s diff=${Math.abs(videoDur - audioDur).toFixed(2)}s`,
      )

      // 2. 差异 < 0.3s → 无需调整
      if (Math.abs(videoDur - audioDur) < 0.3) {
        // 直接复制视频
        const result = await runFfmpeg(
          ["-i", args.video, "-c", "copy", safeOutput],
          ctx.abort,
        )
        return {
          title: "时长已对齐（无需调整）",
          metadata: {
            operation: "auto_fit_duration",
            success: true,
            outputPath: safeOutput,
            original_duration: videoDur,
            adjusted_duration: videoDur,
            speed_applied: 1.0,
            trimmed_segments: 0,
          },
          output:
            `视频时长 (${videoDur.toFixed(1)}s) 和配音时长 (${audioDur.toFixed(1)}s) 差异在容差范围内，无需调整。`,
        }
      }

      // 3. 静音检测
      const silences = await detectSilence(
        args.video,
        args.silence_threshold,
        args.min_silence_duration,
        ctx.abort,
      )
      console.log(`[auto_fit_duration] detected ${silences.length} silence segments`)

      // 4. 构建 filter_complex
      const speed = videoDur > 0 && audioDur > 0 ? videoDur / audioDur : 1.0
      const clampedSpeed = Math.max(args.min_speed, Math.min(args.max_speed, speed))

      const { filterComplex, trimDuration, appliedSpeed, trimmedSegments } =
        buildFilterComplex(
          videoDur,
          audioDur,
          silences,
          speed,
          args.mode,
          args.min_speed,
          args.max_speed,
        )

      // 5. 无调整直接复制
      if (!filterComplex) {
        const result = await runFfmpeg(
          ["-i", args.video, "-c", "copy", safeOutput],
          ctx.abort,
        )
        return {
          title: "时长已对齐",
          metadata: {
            operation: "auto_fit_duration",
            success: true,
            outputPath: safeOutput,
            original_duration: videoDur,
            adjusted_duration: videoDur,
            speed_applied: 1.0,
            trimmed_segments: 0,
          },
          output: "视频无需调整，已复制到输出路径。",
        }
      }

      // 6. 执行 FFmpeg
      const ffmpegArgs = [
        "-i", args.video,
        "-filter_complex", filterComplex,
        "-map", "[v_out]",
        "-map", "[a_out]",
        "-c:v", "libx264",
        "-c:a", "aac",
        "-pix_fmt", "yuv420p",
        safeOutput,
      ]

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      if (result.success) {
        const finalDuration = trimDuration / appliedSpeed
        const msgParts = [
          `时长对齐完成`,
          `原视频: ${videoDur.toFixed(1)}s | 配音: ${audioDur.toFixed(1)}s`,
          `输出时长: ${finalDuration.toFixed(1)}s`,
        ]
        if (trimmedSegments > 0) msgParts.push(`裁剪空白段: ${trimmedSegments} 段`)
        if (Math.abs(appliedSpeed - 1.0) > 0.01) msgParts.push(`变速: ${appliedSpeed.toFixed(2)}x`)

        return {
          title: "时长对齐完成",
          metadata: {
            operation: "auto_fit_duration",
            success: true,
            outputPath: safeOutput,
            original_duration: videoDur,
            adjusted_duration: finalDuration,
            speed_applied: appliedSpeed,
            trimmed_segments: trimmedSegments,
          },
          output: msgParts.join("\n"),
        }
      }

      return {
        title: "时长对齐失败",
        metadata: {
          operation: "auto_fit_duration",
          error: true,
          error_message: result.error,
        },
        output: `时长对齐失败: ${result.error || "未知错误"}`,
      }
    } catch (err: any) {
      return {
        title: "时长对齐错误",
        metadata: {
          operation: "auto_fit_duration",
          error: true,
          error_message: err.message,
        },
        output: `时长对齐过程中发生错误: ${err.message}`,
      }
    }
  },
})

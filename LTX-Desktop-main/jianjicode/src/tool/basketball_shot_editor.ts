/**
 * 篮球投篮剪辑工具 - 基于投篮检测结果剪辑视频，移除没投中的片段
 *
 * 功能:
 * 1. 读取篮球投篮检测工具生成的 JSON 文件
 * 2. 提取失败投篮片段的时间戳 (miss_segments_for_editing)
 * 3. 使用 FFmpeg 移除这些时间段，保留成功投篮和其他内容
 * 4. 生成剪辑后的视频文件
 */

import { existsSync, readFileSync } from "fs"
import { basename, dirname, join } from "path"
import z from "zod"
// 导入 FFmpeg 工具中的函数
import {
  detectBestHardwareAcceleration,
  type FfmpegOptions,
  findFfmpegPath,
  runFfmpeg,
  runFfmpegEx,
} from "./ffmpeg-utils.js"
import { Tool } from "./tool.js"

/**
 * 篮球投篮剪辑工具
 */
export const BasketballShotEditorTool = Tool.define("basketball_shot_editor", {
  description: "基于篮球投篮检测结果剪辑视频，自动移除没投中的片段",
  parameters: z.object({
    // 输入输出
    input: z
      .string()
      .optional()
      .describe("输入视频文件路径 (可选，如果 JSON 中已包含)"),
    shots_json: z
      .string()
      .describe("投篮检测 JSON 文件路径 (包含 miss_segments_for_editing)"),
    output: z
      .string()
      .optional()
      .describe(
        "输出视频文件路径 (默认: <input>_trimmed.mp4 或 <json>_trimmed.mp4)",
      ),

    // 剪辑选项
    remove_misses: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否移除失败投篮片段"),
    keep_makes: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保留成功投篮片段"),
    keep_attempts: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否保留投篮尝试片段 (结果不明)"),
    remove_silence: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否移除长时间静默片段 (无投篮动作)"),
    buffer_before: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .default(0.5)
      .describe("片段开始前缓冲时间 (秒，默认: 0.5)"),
    buffer_after: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .default(0.5)
      .describe("片段结束后缓冲时间 (秒，默认: 0.5)"),

    // FFmpeg 参数
    video_codec: z
      .string()
      .optional()
      .default("libx264")
      .describe("视频编码器 (libx264, libx265, vp9, etc.)"),
    audio_codec: z
      .string()
      .optional()
      .default("aac")
      .describe("音频编码器 (aac, mp3, copy)"),
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("视频质量 (0-51, 越低质量越好, H.264 默认: 23)"),
    preset: z
      .string()
      .optional()
      .default("medium")
      .describe(
        "编码预设 (ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow)",
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
    log_progress: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否显示FFmpeg进度日志"),

    // 安全参数
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

  execute: async (args: any, ctx: any) => {
    try {
      console.log(`[BasketballShotEditor] 开始篮球投篮剪辑...`)

      // 1. 验证 JSON 文件
      if (!existsSync(args.shots_json)) {
        return {
          title: "篮球投篮剪辑失败",
          metadata: { operation: "basketball_shot_editor", error: true },
          output: `投篮检测 JSON 文件不存在: ${args.shots_json}`,
        }
      }

      // 2. 读取并解析 JSON
      console.log(`[BasketballShotEditor] 读取投篮检测结果: ${args.shots_json}`)
      const jsonData = JSON.parse(readFileSync(args.shots_json, "utf8"))

      // 3. 确定视频文件路径
      let videoPath = args.input || jsonData.video_path
      if (!videoPath) {
        return {
          title: "篮球投篮剪辑失败",
          metadata: { operation: "basketball_shot_editor", error: true },
          output:
            "未找到视频文件路径。请在参数中提供 input 或确保 JSON 包含 video_path 字段。",
        }
      }

      if (!existsSync(videoPath)) {
        // 尝试使用 JSON 文件所在目录的相对路径
        const jsonDir = dirname(args.shots_json)
        const relativePath = join(jsonDir, videoPath)
        if (existsSync(relativePath)) {
          videoPath = relativePath
        } else {
          return {
            title: "篮球投篮剪辑失败",
            metadata: { operation: "basketball_shot_editor", error: true },
            output: `视频文件不存在: ${videoPath} (尝试相对路径: ${relativePath} 也不存在)`,
          }
        }
      }

      // 4. 提取失败投篮片段
      const missSegments = jsonData.miss_segments_for_editing || []
      const allSegments = jsonData.shot_segments || []

      let segmentsToRemove = []
      if (args.remove_misses) {
        segmentsToRemove.push(...missSegments)
      }

      // 如果用户不想保留成功投篮，也移除成功片段
      if (!args.keep_makes) {
        const makeSegments = allSegments.filter(
          (s: any) => s.shot_result === "make",
        )
        segmentsToRemove.push(...makeSegments)
      }

      // 如果用户不想保留投篮尝试，也移除尝试片段
      if (!args.keep_attempts) {
        const attemptSegments = allSegments.filter(
          (s: any) => s.shot_result === "attempt" || !s.shot_result,
        )
        segmentsToRemove.push(...attemptSegments)
      }

      // 去重和排序
      segmentsToRemove = segmentsToRemove
        .filter(
          (s: any) => s.start_time !== undefined && s.end_time !== undefined,
        )
        .sort((a: any, b: any) => a.start_time - b.start_time)

      console.log(`[BasketballShotEditor] 视频: ${basename(videoPath)}`)
      console.log(
        `[BasketballShotEditor] 需要移除的片段: ${segmentsToRemove.length} 个`,
      )

      if (segmentsToRemove.length === 0) {
        return {
          title: "篮球投篮剪辑完成",
          metadata: {
            operation: "basketball_shot_editor",
            success: true,
            warning: true,
          },
          output: `未找到需要移除的投篮片段。视频保持不变。\n建议检查 JSON 文件中的 miss_segments_for_editing 字段。`,
        }
      }

      // 5. 获取视频总时长
      const videoDuration = await getVideoDuration(videoPath)
      if (videoDuration <= 0) {
        return {
          title: "篮球投篮剪辑失败",
          metadata: { operation: "basketball_shot_editor", error: true },
          output: "无法获取视频时长",
        }
      }

      console.log(
        `[BasketballShotEditor] 视频总时长: ${videoDuration.toFixed(2)} 秒`,
      )

      // 6. 计算要保留的时间段 (移除失败片段后的时间段)
      const keepSegments = calculateKeepSegments(
        segmentsToRemove,
        videoDuration,
        args.buffer_before,
        args.buffer_after,
      )
      console.log(
        `[BasketballShotEditor] 需要保留的片段: ${keepSegments.length} 个`,
      )

      // 7. 生成输出文件路径
      let outputPath = args.output
      if (!outputPath) {
        const baseName = videoPath.replace(/\.[^/.]+$/, "")
        outputPath = `${baseName}_trimmed.mp4`
      }

      // 安全验证：防止覆盖原文件
      if (args.protect_originals) {
        const inputResolved = join(process.cwd(), videoPath)
        const outputResolved = join(process.cwd(), outputPath)
        if (inputResolved === outputResolved) {
          const ext = videoPath.substring(videoPath.lastIndexOf("."))
          const base = basename(videoPath, ext)
          const dir = dirname(videoPath)
          outputPath = join(dir, `${base}_trimmed${ext}`)
          console.log(
            `[BasketballShotEditor] 原文件保护已启用，输出路径修改为: ${outputPath}`,
          )
        }
      }

      // 安全验证：检查文件是否已存在
      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "basketball_shot_editor",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      // 8. 使用 FFmpeg 剪辑视频
      console.log(`[BasketballShotEditor] 开始剪辑视频...`)
      const ffmpegResult = await trimVideoSegments(
        videoPath,
        outputPath,
        keepSegments,
        args,
      )

      if (!ffmpegResult.success) {
        return {
          title: "篮球投篮剪辑失败",
          metadata: { operation: "basketball_shot_editor", error: true },
          output: `FFmpeg 剪辑失败: ${ffmpegResult.error || "未知错误"}`,
        }
      }

      // 9. 计算剪辑统计（考虑缓冲时间）
      const originalDuration = videoDuration
      // 计算应用缓冲后的实际移除时长
      const removedDuration = segmentsToRemove.reduce(
        (sum: number, seg: any) => {
          const segStart = Math.max(0, seg.start_time - args.buffer_before)
          const segEnd = Math.min(
            videoDuration,
            seg.end_time + args.buffer_after,
          )
          return sum + (segEnd - segStart)
        },
        0,
      )
      const finalDuration = Math.max(0, originalDuration - removedDuration)
      const reductionPercent =
        originalDuration > 0
          ? ((removedDuration / originalDuration) * 100).toFixed(1)
          : "0.0"

      // 10. 返回结果
      const segmentDescriptions = segmentsToRemove
        .map((seg: any, i: number) => {
          const segStart = Math.max(0, seg.start_time - args.buffer_before)
          const segEnd = Math.min(
            videoDuration,
            seg.end_time + args.buffer_after,
          )
          const originalDuration = seg.end_time - seg.start_time
          const bufferedDuration = segEnd - segStart
          const bufferInfo =
            args.buffer_before > 0 || args.buffer_after > 0
              ? ` (原: ${formatTime(seg.start_time)}-${formatTime(seg.end_time)}, 缓冲: ${formatTime(segStart)}-${formatTime(segEnd)})`
              : ""
          return `  ${i + 1}. ${formatTime(segStart)} - ${formatTime(segEnd)} (${bufferedDuration.toFixed(1)} 秒${bufferInfo})`
        })
        .join("\n")

      let outputText = `🏀 篮球投篮剪辑完成\n`
      outputText += `📁 原视频: ${basename(videoPath)}\n`
      outputText += `📊 剪辑结果: ${basename(outputPath)}\n`
      outputText += `⏱️  原时长: ${formatTime(originalDuration)} (${originalDuration.toFixed(1)} 秒)\n`
      outputText += `✂️  移除时长: ${formatTime(removedDuration)} (${removedDuration.toFixed(1)} 秒, ${reductionPercent}%)\n`
      outputText += `🎬 新时长: ${formatTime(finalDuration)} (${finalDuration.toFixed(1)} 秒)\n`
      outputText += `❌ 移除的失败投篮片段: ${segmentsToRemove.length} 个\n`

      if (segmentsToRemove.length > 0) {
        outputText += `\n移除片段详情:\n${segmentDescriptions}\n`
      }

      outputText += `\n✅ 视频已保存至: ${outputPath}`

      return {
        title: "篮球投篮剪辑成功",
        metadata: {
          operation: "basketball_shot_editor",
          success: true,
          videoPath: videoPath,
          outputPath: outputPath,
          originalDuration: originalDuration,
          removedDuration: removedDuration,
          finalDuration: finalDuration,
          segmentsRemoved: segmentsToRemove.length,
        },
        output: outputText,
      }
    } catch (error: any) {
      return {
        title: "篮球投篮剪辑错误",
        metadata: {
          operation: "basketball_shot_editor",
          error: true,
          success: false,
        },
        output: `❌ 篮球投篮剪辑过程中发生错误: ${error.message}`,
      }
    }
  },
} as any)

/**
 * 获取视频时长
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const ffmpegPath = await findFfmpegPath()
    if (!ffmpegPath) {
      throw new Error("FFmpeg not found")
    }

    const { spawnSync } = await import("child_process")
    const result = spawnSync(ffmpegPath, ["-i", videoPath, "-hide_banner"], {
      encoding: "utf8",
    })

    const output = result.stderr || ""
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
 * 计算要保留的时间段
 * 输入: 要移除的片段数组 [{start_time, end_time}]
 * 输出: 要保留的片段数组 [{start, end}]
 */
function calculateKeepSegments(
  removeSegments: Array<{ start_time: number; end_time: number }>,
  totalDuration: number,
  bufferBefore: number = 0.5,
  bufferAfter: number = 0.5,
): Array<{ start: number; end: number }> {
  const keepSegments: Array<{ start: number; end: number }> = []

  // 如果没有要移除的片段，保留整个视频
  if (removeSegments.length === 0) {
    return [{ start: 0, end: totalDuration }]
  }

  let currentTime = 0

  for (const segment of removeSegments) {
    // 应用缓冲时间
    const segStart = Math.max(0, segment.start_time - bufferBefore)
    const segEnd = Math.min(totalDuration, segment.end_time + bufferAfter)

    // 如果当前时间在移除片段开始之前，则保留之间的部分
    if (currentTime < segStart) {
      keepSegments.push({
        start: currentTime,
        end: segStart,
      })
    }

    // 更新当前时间到移除片段结束
    currentTime = Math.max(currentTime, segEnd)
  }

  // 处理最后一个移除片段之后的部分
  if (currentTime < totalDuration) {
    keepSegments.push({
      start: currentTime,
      end: totalDuration,
    })
  }

  return keepSegments
}

/**
 * 使用 FFmpeg 剪辑视频，保留指定的时间段
 */
async function trimVideoSegments(
  inputPath: string,
  outputPath: string,
  keepSegments: Array<{ start: number; end: number }>,
  args: any,
): Promise<{ success: boolean; error?: string }> {
  if (keepSegments.length === 0) {
    return { success: false, error: "没有需要保留的片段" }
  }

  // 构建 FFmpeg 选项
  const ffmpegOptions: FfmpegOptions = {
    logProgress: args.log_progress !== false,
  }

  // 处理硬件加速
  const enableHardwareAcceleration = args.hardware_acceleration !== false // 默认为 true，除非显式设置为 false
  if (enableHardwareAcceleration) {
    // 自动检测最佳硬件加速方法
    const bestHw = detectBestHardwareAcceleration()

    if (bestHw.hwaccel) {
      ffmpegOptions.hwaccel = bestHw.hwaccel
      console.log(`[BasketballShotEditor] 使用硬件加速: ${bestHw.hwaccel}`)
    }

    // 优先使用用户指定的编码器，否则使用自动检测的编码器
    if (args.encoder) {
      ffmpegOptions.encoder = args.encoder
      console.log(`[BasketballShotEditor] 使用指定编码器: ${args.encoder}`)
    } else if (bestHw.encoder) {
      ffmpegOptions.encoder = bestHw.encoder
      console.log(
        `[BasketballShotEditor] 使用自动检测编码器: ${bestHw.encoder}`,
      )
    }

    if (args.hw_device !== undefined) {
      ffmpegOptions.hwDevice = args.hw_device
    }
  } else if (args.hwaccel || args.encoder) {
    // 即使硬件加速未启用，也允许手动指定
    if (args.hwaccel) {
      ffmpegOptions.hwaccel = args.hwaccel
    }
    if (args.encoder) {
      ffmpegOptions.encoder = args.encoder
    }
    if (args.hw_device !== undefined) {
      ffmpegOptions.hwDevice = args.hw_device
    }
  }

  // 如果只有一个保留片段，使用简单的 trim 命令
  if (keepSegments.length === 1) {
    const segment = keepSegments[0]
    const ffmpegArgs = [
      "-i",
      inputPath,
      "-ss",
      segment.start.toString(),
      "-to",
      segment.end.toString(),
      "-c:v",
      args.video_codec || "libx264",
      "-preset",
      args.preset || "medium",
      "-crf",
      (args.quality || 23).toString(),
      "-c:a",
      args.audio_codec || "aac",
      "-y",
      outputPath,
    ]

    // 如果指定了硬件编码器，覆盖视频编码器
    if (ffmpegOptions.encoder) {
      // 替换 -c:v 参数
      for (let i = 0; i < ffmpegArgs.length; i++) {
        if (ffmpegArgs[i] === "-c:v" && i + 1 < ffmpegArgs.length) {
          ffmpegArgs[i + 1] = ffmpegOptions.encoder
          break
        }
      }
    }

    const result = await runFfmpegEx(ffmpegArgs, ffmpegOptions)
    return { success: result.success, error: result.error }
  }

  // 多个保留片段，使用 filter_complex 和 select 滤镜
  // 构建 select 表达式: between(t,start1,end1)+between(t,start2,end2)+...
  const selectExpr = keepSegments
    .map((seg) => `between(t,${seg.start},${seg.end})`)
    .join("+")

  // FFmpeg 命令
  const ffmpegArgs = [
    "-i",
    inputPath,
    "-filter_complex",
    `[0:v]select='${selectExpr}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${selectExpr}',asetpts=N/SR/TB[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    args.video_codec || "libx264",
    "-preset",
    args.preset || "medium",
    "-crf",
    (args.quality || 23).toString(),
    "-c:a",
    args.audio_codec || "aac",
    "-y",
    outputPath,
  ]

  // 如果指定了硬件编码器，覆盖视频编码器
  if (ffmpegOptions.encoder) {
    // 替换 -c:v 参数
    for (let i = 0; i < ffmpegArgs.length; i++) {
      if (ffmpegArgs[i] === "-c:v" && i + 1 < ffmpegArgs.length) {
        ffmpegArgs[i + 1] = ffmpegOptions.encoder
        break
      }
    }
  }

  const result = await runFfmpegEx(ffmpegArgs, ffmpegOptions)
  return { success: result.success, error: result.error }
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

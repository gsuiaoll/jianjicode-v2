import { existsSync } from "fs"
import { join } from "path"
import z from "zod"
import { Tool } from "../tool.js"
import { resolveInputPath } from "../../../src/core/path-resolver.js"
import {
  getCurrentPhase,
  FINECUT_MAX_TRIM_SECONDS,
} from "../../../src/core/video-phase.js"
import {
  concatVideos,
  convertVideo,
  extractAudio,
  findFfmpegPath,
  getVideoInfo,
  mergeAudio,
  trimVideo,
} from "./ffmpeg-utils.js"

function parseVideoCommand(command: string): {
  operation: string
  params: any
} {
  const cmd = command.toLowerCase()

  function extractOutputPath(
    cmd: string,
    inputPaths: string[] = [],
  ): string | undefined {
    const outputKeywords = [
      "output",
      "save as",
      "save to",
      "export",
      "export as",
      "as",
    ]
    for (const keyword of outputKeywords) {
      const pattern = new RegExp(
        `${keyword}\\s+([^\\s]+\\.(mp4|avi|mov|mkv|flv|wmv|webm|mp3|wav|aac|flac|ogg|m4a))`,
        "i",
      )
      const match = cmd.match(pattern)
      if (match) {
        const outputPath = match[1]
        console.log(
          `[parseVideoCommand] extractOutputPath: found output path "${outputPath}" via keyword "${keyword}"`,
        )
        return outputPath
      }
    }

    const allFileMatches = Array.from(
      cmd.matchAll(
        /([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm|mp3|wav|aac|flac|ogg|m4a))/gi,
      ),
    )
    for (const match of allFileMatches) {
      const file = match[0]
      if (!inputPaths.includes(file)) {
        const idx = cmd.indexOf(file)
        const before = cmd.substring(Math.max(0, idx - 20), idx)
        if (
          before.includes(" to ") ||
          before.includes(" as ") ||
          before.includes(" output ") ||
          before.includes(" save ")
        ) {
          return file
        }
      }
    }

    return undefined
  }

  if (cmd.includes("trim") || cmd.includes("cut")) {
    const fileMatch = cmd.match(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/i)
    const inputPath = fileMatch ? fileMatch[0] : ""
    const outputPath = extractOutputPath(cmd, inputPath ? [inputPath] : [])

    const timePattern =
      /(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}|\b\d+\b(?=\s*(?:seconds?|minutes?|hours?|s|m|h)?\b))/gi
    const timeMatches = Array.from(cmd.matchAll(timePattern))

    let startTime = "0"
    let endTime: string | undefined

    const fromToMatch = cmd.match(/from\s+([\d:.]+)\s+to\s+([\d:.]+)/i)
    if (fromToMatch) {
      startTime = fromToMatch[1].trim()
      endTime = fromToMatch[2].trim()
    } else {
      const startMatch = cmd.match(/start\s+([^\s]+(?:\s+[^\s]+)?)/i)
      const endMatch = cmd.match(/end\s+([^\s]+(?:\s+[^\s]+)?)/i)

      if (startMatch) {
        startTime = startMatch[1].trim()
      } else if (timeMatches.length >= 1) {
        startTime = timeMatches[0][0]
      }

      if (endMatch) {
        endTime = endMatch[1].trim()
      } else if (timeMatches.length >= 2) {
        endTime = timeMatches[1][0]
      }
    }

    return {
      operation: "trim",
      params: { inputPath, startTime, endTime, outputPath },
    }
  } else if (
    cmd.includes("merge audio") ||
    cmd.includes("add audio") ||
    cmd.includes("combine audio")
  ) {
    const videoMatches = Array.from(
      cmd.matchAll(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/gi),
    )
    const audioMatches = Array.from(
      cmd.matchAll(/([^\s]+\.(mp3|wav|aac|flac|ogg|m4a))/gi),
    )

    const videoPath = videoMatches.length > 0 ? videoMatches[0][0] : ""
    const audioPath = audioMatches.length > 0 ? audioMatches[0][0] : ""
    const outputPath = extractOutputPath(
      cmd,
      [videoPath, audioPath].filter(Boolean),
    )

    return {
      operation: "merge_audio",
      params: { inputPath: videoPath, videoPath, audioPath, outputPath },
    }
  } else if (
    cmd.includes("concat") ||
    (cmd.includes("merge") && !cmd.includes("audio")) ||
    cmd.includes("join")
  ) {
    const fileMatches = Array.from(
      cmd.matchAll(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/gi),
    )
    let inputPaths: string[] = fileMatches.map((match) => match[0]) || []
    const outputPath = extractOutputPath(cmd, inputPaths)
    if (outputPath && inputPaths.includes(outputPath)) {
      inputPaths = inputPaths.filter((p) => p !== outputPath)
    }
    return { operation: "concat", params: { inputPaths, outputPath } }
  } else if (cmd.includes("convert") || cmd.includes("transcode")) {
    const fileMatch = cmd.match(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/i)
    const inputPath = fileMatch ? fileMatch[0] : ""
    const formatMatch = cmd.match(/to (\w+)/i)
    const format = formatMatch ? formatMatch[1] : "mp4"
    const outputPath = extractOutputPath(cmd, [inputPath])
    return { operation: "convert", params: { inputPath, format, outputPath } }
  } else if (cmd.includes("extract audio") || cmd.includes("get audio")) {
    const fileMatch = cmd.match(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/i)
    const inputPath = fileMatch ? fileMatch[0] : ""
    const outputPath = extractOutputPath(cmd, [inputPath])
    return { operation: "extract_audio", params: { inputPath, outputPath } }
  } else if (cmd.includes("info") || cmd.includes("metadata")) {
    const fileMatch = cmd.match(/([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/i)
    return {
      operation: "get_info",
      params: { inputPath: fileMatch ? fileMatch[0] : "" },
    }
  }

  return { operation: "unknown", params: {} }
}

export const FfmpegTool = Tool.define("ffmpeg", {
  description:
    "Execute FFmpeg commands for video editing operations like trim, concat, convert, extract audio, etc.",
  parameters: z.object({
    command: z
      .string()
      .describe("Video editing command or natural language instruction"),
    operation: z
      .string()
      .optional()
      .describe(
        "Explicit operation type (trim, concat, convert, extract_audio, merge_audio, get_info)",
      ),
    input: z.string().optional().describe("Input video file path"),
    output: z.string().optional().describe("Output file path"),
    start_time: z
      .string()
      .optional()
      .describe("Start time for trim operation (format: HH:MM:SS or seconds)"),
    end_time: z
      .string()
      .optional()
      .describe("End time for trim operation (format: HH:MM:SS or seconds)"),
    format: z
      .string()
      .optional()
      .describe("Target format for conversion (e.g., mp4, avi, mov)"),
    ffmpeg_path: z
      .string()
      .optional()
      .describe("Custom FFmpeg executable path (overrides auto-detection)"),
    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Allow overwriting existing output files"),
    protect_originals: z
      .boolean()
      .optional()
      .default(true)
      .describe("Protect original files, force output to new file"),
    audio_file: z
      .string()
      .optional()
      .describe("Audio file path (required for merge_audio operation)"),
    video_file: z
      .string()
      .optional()
      .describe("Video file path (for merge_audio when input is audio)"),
    replace_audio: z
      .boolean()
      .optional()
      .default(false)
      .describe("Replace original audio entirely with new BGM (true=replace, false=mix)"),
    output_dir: z.string().optional().describe("Restrict output directory"),
  }),
  execute: async (args: any, ctx: Tool.Context) => {
    console.log(
      `[ffmpeg] execute called with args: ${JSON.stringify(args, null, 2)}`,
    )
    console.log(`[ffmpeg] command parameter: "${args.command}"`)

    if (args.ffmpeg_path) {
      process.env.JIANJICODE_FFMPEG_PATH = args.ffmpeg_path
    }

    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      return {
        title: "FFmpeg not found",
        metadata: { error: true },
        output:
          "FFmpeg is not installed or not in PATH. Please install FFmpeg first.",
      }
    }

    const allowOverwrite =
      args.allow_overwrite !== undefined ? args.allow_overwrite : false
    const protectOriginals =
      args.protect_originals !== undefined ? args.protect_originals : true
    const outputDir = args.output_dir

    const path = await import("path")
    const fs = await import("fs")

    const validateOutputPath = (
      inputPath: string,
      outputPath: string,
    ): { valid: boolean; message?: string; newPath?: string } => {
      if (protectOriginals) {
        const inputResolved = path.resolve(inputPath)
        const outputResolved = path.resolve(outputPath)
        if (inputResolved === outputResolved) {
          const ext = path.extname(inputPath)
          const base = path.basename(inputPath, ext)
          const dir = path.dirname(inputPath)
          const newOutputPath = path.join(dir, `${base}_edited${ext}`)
          return {
            valid: true,
            message: `Original file protection enabled, auto-adjusted output path to: ${newOutputPath}`,
            newPath: newOutputPath,
          }
        }
      }

      if (outputDir && outputDir.trim()) {
        const outputDirResolved = path.resolve(outputDir)
        const outputPathResolved = path.resolve(outputPath)
        const relative = path.relative(outputDirResolved, outputPathResolved)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return {
            valid: false,
            message: `Output path must be within: ${outputDirResolved}`,
          }
        }
      }

      if (!allowOverwrite && fs.existsSync(outputPath)) {
        return {
          valid: false,
          message: `Output file already exists and overwrite not allowed: ${outputPath}`,
        }
      }

      return { valid: true }
    }

    const command = args.command ? args.command.toLowerCase() : ""
    let parsed: { operation: string; params: any } = {
      operation: "unknown",
      params: {},
    }

    if (command) {
      parsed = parseVideoCommand(command)
    }

    const rawInputPath = args.input || parsed.params.inputPath

    // 容错：LLM 可能修改中文路径（如 "卡点-节奏" → "卡点 - 节奏"）
    let inputPath: string | undefined
    if (rawInputPath) {
      const resolved = await resolveInputPath(rawInputPath)
      inputPath = resolved.resolvedPath
      if (resolved.wasCorrected) {
        console.log(`[ffmpeg] 输入路径已自动纠正: ${rawInputPath} → ${inputPath}`)
      }
    }

    // 同样容错 audio_file / video_file 路径
    let resolvedAudioFile: string | undefined
    if (args.audio_file) {
      const r = await resolveInputPath(args.audio_file)
      resolvedAudioFile = r.resolvedPath
      if (r.wasCorrected) console.log(`[ffmpeg] audio_file 路径已纠正: ${args.audio_file} → ${r.resolvedPath}`)
    }
    let resolvedVideoFile: string | undefined
    if (args.video_file) {
      const r = await resolveInputPath(args.video_file)
      resolvedVideoFile = r.resolvedPath
      if (r.wasCorrected) console.log(`[ffmpeg] video_file 路径已纠正: ${args.video_file} → ${r.resolvedPath}`)
    }
    const outputPath =
      parsed.params.outputPath ||
      args.output ||
      (inputPath ? `${inputPath.split(".")[0]}_edited.mp4` : "output.mp4")

    let finalOutputPath = outputPath
    if (inputPath) {
      const validation = validateOutputPath(inputPath, outputPath)
      if (!validation.valid) {
        return {
          title: "Security validation failed",
          metadata: { error: true },
          output: `❌ ${validation.message}`,
        }
      }
      if (validation.newPath) {
        finalOutputPath = validation.newPath
        console.log(`[security] ${validation.message}`)
      }
    }

    let result: any
    let operation = parsed.operation

    if (args.operation && typeof args.operation === "string") {
      operation = args.operation.toLowerCase()
    }

    if (operation === "unknown") {
      if (command) {
        if (command.includes("trim") || command.includes("cut"))
          operation = "trim"
        else if (
          command.includes("concat") ||
          (command.includes("merge") && !command.includes("audio"))
        )
          operation = "concat"
        else if (command.includes("convert")) operation = "convert"
        else if (command.includes("extract audio")) operation = "extract_audio"
        else if (
          command.includes("merge audio") ||
          command.includes("add audio")
        )
          operation = "merge_audio"
        else if (command.includes("info")) operation = "get_info"
      } else {
        if (args.start_time !== undefined || args.end_time !== undefined)
          operation = "trim"
        else if (args.format !== undefined) operation = "convert"
        else if (
          args.input_files !== undefined ||
          (Array.isArray(args.input) && args.input.length > 1)
        )
          operation = "concat"
        else if (args.audio_file !== undefined) operation = "merge_audio"
        else if (
          args.extract_audio !== undefined ||
          args.audio_only !== undefined
        )
          operation = "extract_audio"
        else if (args.get_info !== undefined || args.info !== undefined)
          operation = "get_info"
      }
    }

    // 阶段门禁：精剪阶段限制 trim/concat
    const phase = getCurrentPhase()
    if (phase === "fine_cut") {
      if (operation === "concat" || operation === "merge" || operation === "concat_videos") {
        return {
          title: "精剪阶段不允许拼接",
          metadata: { error: true, phaseBlocked: true },
          output: "精剪阶段不允许拼接操作。时间轴已锁定，如需拼接新片段请先切换到粗剪阶段 (set_edit_phase rough_cut)。",
        }
      }
      if (operation === "trim") {
        const startTime = parseFloat(args.start_time || parsed.params.startTime || "0")
        const endTime = parseFloat(args.end_time || parsed.params.endTime || "0")
        if (!isNaN(startTime) && !isNaN(endTime) && Math.abs(endTime - startTime) > FINECUT_MAX_TRIM_SECONDS) {
          return {
            title: "精剪阶段仅允许切点微调",
            metadata: { error: true, phaseBlocked: true },
            output: `精剪阶段仅允许 ≤${FINECUT_MAX_TRIM_SECONDS}秒 的切点微调。当前裁剪范围 ${Math.abs(endTime - startTime).toFixed(1)}秒 超出限制。如需大段裁剪，请先切换到粗剪阶段 (set_edit_phase rough_cut)。`,
          }
        }
      }
    }

    try {
      switch (operation) {
        case "trim": {
          const startTime = args.start_time || parsed.params.startTime || "0"
          const endTime = args.end_time || parsed.params.endTime
          if (!inputPath) {
            return {
              title: "Trim operation failed",
              metadata: { error: true },
              output: "No input file specified for trim operation.",
            }
          }
          result = await trimVideo(
            inputPath,
            finalOutputPath,
            startTime,
            endTime,
          )
          break
        }
        case "concat": {
          const inputPaths: string[] = parsed.params.inputPaths || []
          if (inputPath) {
            const parts = inputPath.split(",").map((p: string) => p.trim()).filter(Boolean)
            inputPaths.push(...parts)
          }
          if (inputPaths.length < 2) {
            return {
              title: "Concat operation failed",
              metadata: { error: true },
              output: "Concatenation requires at least 2 input video files.",
            }
          }
          result = await concatVideos(inputPaths, finalOutputPath)
          break
        }
        case "convert": {
          const format = args.format || parsed.params.format || "mp4"
          const codecMap: Record<string, string> = {
            mp4: "libx264",
            webm: "libvpx-vp9",
            avi: "mpeg4",
          }
          const codec = codecMap[format] || "copy"
          if (!inputPath) {
            return {
              title: "Convert operation failed",
              metadata: { error: true },
              output: "No input file specified for conversion.",
            }
          }
          const convertOutput = finalOutputPath.endsWith(`.${format}`)
            ? finalOutputPath
            : `${finalOutputPath.split(".")[0]}.${format}`
          result = await convertVideo(inputPath, convertOutput, codec)
          break
        }
        case "extract_audio": {
          if (!inputPath) {
            return {
              title: "Extract audio operation failed",
              metadata: { error: true },
              output: "No input file specified for audio extraction.",
            }
          }
          const audioOutput = finalOutputPath.endsWith(".mp3")
            ? finalOutputPath
            : `${finalOutputPath.split(".")[0]}.mp3`
          result = await extractAudio(inputPath, audioOutput)
          break
        }
        case "merge_audio": {
          const videoPath =
            resolvedVideoFile || parsed.params.videoPath || args.video_file || args.input
          const audioPath = resolvedAudioFile || parsed.params.audioPath || args.audio_file
          if (!videoPath || !audioPath) {
            return {
              title: "Merge audio operation failed",
              metadata: { error: true },
              output: "Both video and audio files must be specified.",
            }
          }
          // Use BGM volume from src version (default 3.0 for BGM mode)
          const bgmVolume = args.bgm_volume || 3.0
          const replaceAudio = args.replace_audio === true
          result = await mergeAudio(
            videoPath,
            audioPath,
            finalOutputPath,
            bgmVolume,
            replaceAudio,
          )
          break
        }
        case "get_info": {
          if (!inputPath) {
            return {
              title: "Get video info failed",
              metadata: { error: true },
              output: "No input file specified.",
            }
          }
          const info = await getVideoInfo(inputPath)
          if (info.success) {
            if (info.data) {
              const formatInfo = info.data.format || {}
              const videoStream = (info.data.streams || []).find(
                (s: any) => s.codec_type === "video",
              )
              const audioStream = (info.data.streams || []).find(
                (s: any) => s.codec_type === "audio",
              )
              return {
                title: `Video information for ${inputPath}`,
                metadata: { success: true, ...info.data },
                output: `File: ${formatInfo.filename || inputPath}\nDuration: ${formatInfo.duration || "N/A"} seconds\nSize: ${formatInfo.size || "N/A"} bytes\nFormat: ${formatInfo.format_name || "N/A"}\n\nVideo: ${videoStream ? `${videoStream.codec_name} ${videoStream.width}x${videoStream.height} @${videoStream.r_frame_rate || "N/A"} fps` : "No video stream"}\nAudio: ${audioStream ? `${audioStream.codec_name} ${audioStream.sample_rate || "N/A"}Hz ${audioStream.channels || "N/A"} channels` : "No audio stream"}`,
              }
            } else {
              return {
                title: `Video information for ${inputPath}`,
                metadata: { success: true },
                output: info.raw || "No information available",
              }
            }
          } else {
            return {
              title: "Failed to get video information",
              metadata: { error: true },
              output: info.error || "Unknown error",
            }
          }
        }
        default:
          return {
            title: "Unknown video editing command",
            metadata: { error: true },
            output: `Could not understand the video editing command: "${args.command}". Supported operations: trim, concat, convert, extract_audio, merge_audio, get_info.`,
          }
      }

      if (result.success) {
        return {
          title: `Video editing ${operation} completed`,
          metadata: { operation, success: true, inputPath, outputPath: finalOutputPath },
          output: `Successfully executed ${operation} operation.\nOutput saved to: ${finalOutputPath}`,
        }
      } else {
        return {
          title: `Video editing ${operation} failed`,
          metadata: { operation, error: true, inputPath },
          output: `Failed to execute ${operation}: ${result.error || "Unknown error"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "Video editing operation error",
        metadata: { operation, error: true, inputPath },
        output: `Error during ${operation}: ${error.message}`,
      }
    }
  },
})

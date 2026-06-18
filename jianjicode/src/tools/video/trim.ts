import z from "zod"
import { Tool } from "../../lib/tool.js"
import { trimVideo } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

function parseTimeToSeconds(timeStr: string): number {
  const num = Number(timeStr)
  if (!isNaN(num)) return num
  const parts = timeStr.split(":").map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

export const TrimVideoTool = Tool.define("trim_video", {
  description: "Trim video to specified time range",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
    start_time: z.string().describe("Start time in format HH:MM:SS or seconds"),
    end_time: z
      .string()
      .optional()
      .describe("End time in format HH:MM:SS or seconds"),
    output_file: z
      .string()
      .optional()
      .describe("Path to output video file (default: <input>_trimmed.mp4)"),
  }),
  usageTemplate: {
    json: {
      input_file: "{source_video}",
      start_time: "00:00:05",
      end_time: "00:00:30",
      output_file: "{output_dir}/trimmed_{timestamp}.mp4",
    },
    constraints: [
      "start_time 格式 HH:MM:SS 或纯秒数，必填",
      "end_time 可选，不填=裁剪到视频结尾",
      "start_time 必须小于 end_time",
    ],
  },
  execute: async (args, ctx) => {
    const outputPath =
      args.output_file || `${args.input_file.split(".")[0]}_trimmed.mp4`
    const startSec = parseTimeToSeconds(args.start_time)
    const endSec = args.end_time ? parseTimeToSeconds(args.end_time) : undefined

    // 安全沙箱校验
    const sandbox = validatePath(args.input_file, outputPath)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
        metadata: { operation: "trim_video", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutputPath = sandbox.outputPath

    const localResult = await trimVideo(
      args.input_file,
      safeOutputPath,
      args.start_time,
      args.end_time,
      ctx.abort,
    )
    const result = {
      success: localResult.success,
      operation: "trim_video",
      title: localResult.success ? "Video Trimmed" : "Video Trim Failed",
      output: localResult.success
        ? `Successfully trimmed video from ${args.start_time} to ${args.end_time || "end"}\nOutput saved to: ${safeOutputPath}`
        : `Failed to trim video: ${localResult.error || "Unknown error"}`,
      metadata: {
        outputPath: localResult.success ? safeOutputPath : undefined,
        success: localResult.success,
        error: !localResult.success,
        error_message: localResult.error,
      },
    } as any

    if (result.success) {
      return {
        title: result.title || "Video Trimmed",
        metadata: {
          operation: "trim_video",
          success: true,
      undoable: true,
          inputPath: args.input_file,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || safeOutputPath,
          start_time: args.start_time,
          end_time: args.end_time,
        },
        output:
          result.output ||
          `Successfully trimmed video from ${args.start_time} to ${args.end_time || "end"}\nOutput saved to: ${result.metadata?.outputPath || safeOutputPath}`,
      }
    } else {
      return {
        title: "Video Trim Failed",
        metadata: {
          operation: "trim_video",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to trim video: ${result.error || "Unknown error"}`,
      }
    }
  },
})

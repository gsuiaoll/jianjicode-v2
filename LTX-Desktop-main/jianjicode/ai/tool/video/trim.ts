import z from "zod"
import { trimVideo as pythonTrimVideo } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { trimVideo } from "./ffmpeg-utils.js"

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
  execute: async (args, ctx) => {
    const outputPath =
      args.output_file || `${args.input_file.split(".")[0]}_trimmed.mp4`
    const startSec = parseTimeToSeconds(args.start_time)
    const endSec = args.end_time ? parseTimeToSeconds(args.end_time) : undefined

    const result = await pythonTrimVideo(
      args.input_file,
      startSec,
      endSec,
      outputPath,
      async () => {
        const localResult = await trimVideo(
          args.input_file,
          outputPath,
          args.start_time,
          args.end_time,
        )
        return {
          success: localResult.success,
          operation: "trim_video",
          title: localResult.success ? "Video Trimmed" : "Video Trim Failed",
          output: localResult.success
            ? `Successfully trimmed video from ${args.start_time} to ${args.end_time || "end"}\nOutput saved to: ${outputPath}`
            : `Failed to trim video: ${localResult.error || "Unknown error"}`,
          metadata: {
            outputPath: localResult.success ? outputPath : undefined,
            success: localResult.success,
            error: !localResult.success,
            error_message: localResult.error,
          },
        } as any
      },
    )

    if (result.success) {
      return {
        title: result.title || "Video Trimmed",
        metadata: {
          operation: "trim_video",
          success: true,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || outputPath,
          start_time: args.start_time,
          end_time: args.end_time,
        },
        output:
          result.output ||
          `Successfully trimmed video from ${args.start_time} to ${args.end_time || "end"}\nOutput saved to: ${result.metadata?.outputPath || outputPath}`,
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

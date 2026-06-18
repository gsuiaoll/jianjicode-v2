import z from "zod"
import { concatVideos as pythonConcatVideos } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { concatVideos } from "./ffmpeg-utils.js"

export const ConcatVideosTool = Tool.define("concat_videos", {
  description: "Concatenate multiple video files into a single video",
  parameters: z.object({
    input_files: z.array(z.string()).describe("List of input video file paths"),
    output_file: z.string().describe("Path to output video file"),
  }),
  execute: async (args, ctx) => {
    if (args.input_files.length < 2) {
      return {
        title: "Concat Operation Failed",
        metadata: {
          operation: "concat_videos",
          error: true,
          error_message: "At least 2 input files are required",
        },
        output: "Concatenation requires at least 2 input video files.",
      }
    }

    const result = await pythonConcatVideos(
      args.input_files,
      args.output_file,
      async () => {
        const localResult = await concatVideos(
          args.input_files,
          args.output_file,
        )
        return {
          success: localResult.success,
          operation: "concat_videos",
          title: localResult.success
            ? "Videos Concatenated"
            : "Video Concat Failed",
          output: localResult.success
            ? `Successfully concatenated ${args.input_files.length} videos\nOutput saved to: ${args.output_file}`
            : `Failed to concatenate videos: ${localResult.error || "Unknown error"}`,
          metadata: {
            outputPath: localResult.success ? args.output_file : undefined,
            success: localResult.success,
            error: !localResult.success,
            error_message: localResult.error,
          },
        } as any
      },
    )

    if (result.success) {
      return {
        title: result.title || "Videos Concatenated",
        metadata: {
          operation: "concat_videos",
          success: true,
          input_files: args.input_files,
          output_file: result.metadata?.outputPath || args.output_file,
        },
        output:
          result.output ||
          `Successfully concatenated ${args.input_files.length} videos\nOutput saved to: ${result.metadata?.outputPath || args.output_file}`,
      }
    } else {
      return {
        title: "Video Concat Failed",
        metadata: {
          operation: "concat_videos",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to concatenate videos: ${result.error || "Unknown error"}`,
      }
    }
  },
})

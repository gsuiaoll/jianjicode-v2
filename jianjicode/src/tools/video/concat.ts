import z from "zod"
import { Tool } from "../../lib/tool.js"
import { concatVideos } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

export const ConcatVideosTool = Tool.define("concat_videos", {
  description: "Concatenate multiple video files into a single video",
  parameters: z.object({
    input_files: z.array(z.string()).describe("List of input video file paths"),
    output_file: z.string().describe("Path to output video file"),
  }),
  usageTemplate: {
    json: {
      input_files: ["{source_video}", "{output_dir}/clip2.mp4"],
      output_file: "{output_dir}/concatenated_{timestamp}.mp4",
    },
    constraints: [
      "input_files 至少需要 2 个视频文件",
      "所有视频应有相同的分辨率和编码格式，否则可能失败",
      "拼接按数组顺序依次连接",
    ],
  },
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

    // 安全沙箱校验
    const sandbox = validatePath(args.input_files, args.output_file)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
        metadata: { operation: "concat_videos", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutputPath = sandbox.outputPath

    const localResult = await concatVideos(
      args.input_files,
      safeOutputPath,
      ctx.abort,
    )
    const result = {
      success: localResult.success,
      operation: "concat_videos",
      title: localResult.success
        ? "Videos Concatenated"
        : "Video Concat Failed",
      output: localResult.success
        ? `Successfully concatenated ${args.input_files.length} videos\nOutput saved to: ${safeOutputPath}`
        : `Failed to concatenate videos: ${localResult.error || "Unknown error"}`,
      metadata: {
        outputPath: localResult.success ? safeOutputPath : undefined,
        success: localResult.success,
        error: !localResult.success,
        error_message: localResult.error,
      },
    } as any

    if (result.success) {
      return {
        title: result.title || "Videos Concatenated",
        metadata: {
          operation: "concat_videos",
          success: true,
      undoable: true,
          inputPath: args.input_files?.[0],
          input_files: args.input_files,
          output_file: result.metadata?.outputPath || safeOutputPath,
        },
        output:
          result.output ||
          `Successfully concatenated ${args.input_files.length} videos\nOutput saved to: ${result.metadata?.outputPath || safeOutputPath}`,
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

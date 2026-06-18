import z from "zod"
import { Tool } from "../../lib/tool.js"
import { extractAudio } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

export const ExtractAudioTool = Tool.define("extract_audio", {
  description: "Extract audio track from a video file",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
    output_file: z
      .string()
      .optional()
      .describe("Path to output audio file (default: <input>_audio.mp3)"),
  }),
  usageTemplate: {
    json: {
      input_file: "{source_video}",
      output_file: "{output_dir}/audio_{timestamp}.mp3",
    },
    constraints: ["从视频中提取音频轨道", "输出格式默认 mp3"],
  },
  execute: async (args, ctx) => {
    const outputPath =
      args.output_file || `${args.input_file.split(".")[0]}_audio.mp3`

    // 安全沙箱校验
    const sandbox = validatePath(args.input_file, outputPath)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
        metadata: { operation: "extract_audio", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutputPath = sandbox.outputPath

    const localResult = await extractAudio(args.input_file, safeOutputPath, ctx.abort)
    const result = {
      success: localResult.success,
      operation: "extract_audio",
      title: localResult.success
        ? "Audio Extracted"
        : "Audio Extraction Failed",
      output: localResult.success
        ? `Successfully extracted audio from video\nAudio saved to: ${safeOutputPath}`
        : `Failed to extract audio: ${localResult.error || "Unknown error"}`,
      metadata: {
        outputPath: localResult.success ? safeOutputPath : undefined,
        success: localResult.success,
        error: !localResult.success,
        error_message: localResult.error,
      },
    } as any

    if (result.success) {
      return {
        title: result.title || "Audio Extracted",
        metadata: {
          operation: "extract_audio",
          success: true,
      undoable: true,
          inputPath: args.input_file,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || safeOutputPath,
        },
        output:
          result.output ||
          `Successfully extracted audio from video\nAudio saved to: ${result.metadata?.outputPath || safeOutputPath}`,
      }
    } else {
      return {
        title: "Audio Extraction Failed",
        metadata: {
          operation: "extract_audio",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to extract audio: ${result.error || "Unknown error"}`,
      }
    }
  },
})

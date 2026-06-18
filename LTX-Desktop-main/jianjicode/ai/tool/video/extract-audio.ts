import z from "zod"
import { extractAudio as pythonExtractAudio } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { extractAudio } from "./ffmpeg-utils.js"

export const ExtractAudioTool = Tool.define("extract_audio", {
  description: "Extract audio track from a video file",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
    output_file: z
      .string()
      .optional()
      .describe("Path to output audio file (default: <input>_audio.mp3)"),
  }),
  execute: async (args, ctx) => {
    const outputPath =
      args.output_file || `${args.input_file.split(".")[0]}_audio.mp3`

    const result = await pythonExtractAudio(
      args.input_file,
      outputPath,
      async () => {
        const localResult = await extractAudio(args.input_file, outputPath)
        return {
          success: localResult.success,
          operation: "extract_audio",
          title: localResult.success
            ? "Audio Extracted"
            : "Audio Extraction Failed",
          output: localResult.success
            ? `Successfully extracted audio from video\nAudio saved to: ${outputPath}`
            : `Failed to extract audio: ${localResult.error || "Unknown error"}`,
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
        title: result.title || "Audio Extracted",
        metadata: {
          operation: "extract_audio",
          success: true,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || outputPath,
        },
        output:
          result.output ||
          `Successfully extracted audio from video\nAudio saved to: ${result.metadata?.outputPath || outputPath}`,
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

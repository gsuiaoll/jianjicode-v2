import z from "zod"
import { convertFormat as pythonConvertFormat } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { convertVideo } from "./ffmpeg-utils.js"

export const ConvertVideoTool = Tool.define("convert_video", {
  description: "Convert video format or change codec",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
    output_file: z.string().describe("Path to output video file"),
    format: z
      .string()
      .optional()
      .describe("Output format (mp4, mov, avi, webm, etc.)"),
    codec: z
      .string()
      .optional()
      .describe(
        "Video codec (h264, h265, vp9, etc.) - if not specified, will use default for format",
      ),
  }),
  execute: async (args, ctx) => {
    let codec = args.codec
    if (!codec && args.format) {
      const formatCodecs: Record<string, string> = {
        mp4: "libx264",
        webm: "libvpx-vp9",
        avi: "mpeg4",
        mov: "libx264",
        mkv: "libx264",
        flv: "flv",
        wmv: "wmv2",
      }
      codec = formatCodecs[args.format.toLowerCase()] || "libx264"
    }

    // Python bridge wants output_format; pass the format (or derive from output file extension)
    const outputFormat =
      args.format || args.output_file.split(".").pop() || "mp4"

    const result = await pythonConvertFormat(
      args.input_file,
      outputFormat,
      args.output_file,
      async () => {
        const localResult = await convertVideo(
          args.input_file,
          args.output_file,
          codec,
        )
        return {
          success: localResult.success,
          operation: "convert_video",
          title: localResult.success
            ? "Video Converted"
            : "Video Convert Failed",
          output: localResult.success
            ? `Successfully converted video\nOutput saved to: ${args.output_file}`
            : `Failed to convert video: ${localResult.error || "Unknown error"}`,
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
        title: result.title || "Video Converted",
        metadata: {
          operation: "convert_video",
          success: true,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || args.output_file,
          format: args.format,
          codec: codec || "default",
        },
        output:
          result.output ||
          `Successfully converted video\nOutput saved to: ${result.metadata?.outputPath || args.output_file}`,
      }
    } else {
      return {
        title: "Video Convert Failed",
        metadata: {
          operation: "convert_video",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to convert video: ${result.error || "Unknown error"}`,
      }
    }
  },
})

import z from "zod"
import { Tool } from "../../lib/tool.js"
import { convertVideo } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

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
  usageTemplate: {
    json: {
      input_file: "{source_video}",
      output_file: "{output_dir}/converted_{timestamp}.mp4",
      format: "mp4",
    },
    constraints: [
      "format 支持 mp4/avi/mov/mkv/webm/flv/wmv",
      "mp4 使用 libx264 编码，webm 使用 libvpx-vp9",
      "转换后自动添加正确的文件扩展名",
    ],
  },
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

    // 安全沙箱校验
    const sandbox = validatePath(args.input_file, args.output_file)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
        metadata: { operation: "convert_video", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutputPath = sandbox.outputPath

    const localResult = await convertVideo(
      args.input_file,
      safeOutputPath,
      codec,
      ctx.abort as unknown as string,
    )
    const result = {
      success: localResult.success,
      operation: "convert_video",
      title: localResult.success
        ? "Video Converted"
        : "Video Convert Failed",
      output: localResult.success
        ? `Successfully converted video\nOutput saved to: ${safeOutputPath}`
        : `Failed to convert video: ${localResult.error || "Unknown error"}`,
      metadata: {
        outputPath: localResult.success ? safeOutputPath : undefined,
        success: localResult.success,
        error: !localResult.success,
        error_message: localResult.error,
      },
    } as any

    if (result.success) {
      return {
        title: result.title || "Video Converted",
        metadata: {
          operation: "convert_video",
          success: true,
      undoable: true,
          inputPath: args.input_file,
          input_file: args.input_file,
          output_file: result.metadata?.outputPath || safeOutputPath,
          format: args.format,
          codec: codec || "default",
        },
        output:
          result.output ||
          `Successfully converted video\nOutput saved to: ${result.metadata?.outputPath || safeOutputPath}`,
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

import z from "zod"
import { Tool } from "../../lib/tool.js"
import { getVideoInfo } from "../../lib/ffmpeg-utils.js"

export const GetVideoInfoTool = Tool.define("get_video_info", {
  description: "Get metadata information about a video file",
  parameters: z.object({
    input_file: z.string().describe("Path to input video file"),
  }),
  usageTemplate: {
    json: {
      input_file: "{source_video}",
    },
    constraints: [
      "返回视频的时长/分辨率/编码格式/帧率/音频信息",
      "只读操作，不修改任何文件",
      "结果包含 format 和 streams 详细信息",
    ],
  },
  execute: async (args, ctx) => {
    const localResult = await getVideoInfo(args.input_file)
    const result = (() => {
      if (localResult.success && localResult.data) {
        const formatInfo = localResult.data.format || {}
        const videoStream = (localResult.data.streams || []).find(
          (s: any) => s.codec_type === "video",
        )
        const audioStream = (localResult.data.streams || []).find(
          (s: any) => s.codec_type === "audio",
        )

        const output = `Video information for ${args.input_file}:
• Duration: ${formatInfo.duration || "N/A"} seconds
• Size: ${formatInfo.size || "N/A"} bytes
• Format: ${formatInfo.format_name || "N/A"}
• Video: ${videoStream ? `${videoStream.codec_name} ${videoStream.width}x${videoStream.height} @${videoStream.r_frame_rate || "N/A"} fps` : "No video stream"}
• Audio: ${audioStream ? `${audioStream.codec_name} ${audioStream.sample_rate || "N/A"}Hz ${audioStream.channels || "N/A"} channels` : "No audio stream"}`

        return {
          success: true,
          operation: "get_video_info",
          title: "Video Information",
          output,
          metadata: { success: true, ...localResult.data },
        } as any
      } else {
        return {
          success: localResult.success,
          operation: "get_video_info",
          title: localResult.success
            ? "Video Information"
            : "Failed to Get Video Information",
          output: localResult.success
            ? localResult.raw || "No detailed information available"
            : `Failed: ${localResult.error}`,
          metadata: {
            success: localResult.success,
            error: !localResult.success,
            error_message: localResult.error,
          },
          error: localResult.error,
        } as any
      }
    })()

    if (result.success) {
      return {
        title: result.title || "Video Information",
        metadata: {
          operation: "get_video_info",
          success: true,
          ...result.metadata,
        },
        output: result.output || "Video information retrieved successfully",
      }
    } else {
      return {
        title: "Failed to Get Video Information",
        metadata: {
          operation: "get_video_info",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to get video information: ${result.error || "Unknown error"}`,
      }
    }
  },
})

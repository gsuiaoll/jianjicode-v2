import z from "zod"
import { mergeAudioVideo as pythonMergeAudioVideo } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { mergeAudio } from "./ffmpeg-utils.js"
import { resolveInputPath } from "../../../src/core/path-resolver.js"

export const MergeAudioTool = Tool.define("merge_audio", {
  description: "Merge audio file with video file",
  parameters: z.object({
    video_file: z.string().describe("Path to input video file"),
    audio_file: z.string().describe("Path to input audio file"),
    output_file: z.string().describe("Path to output video file"),
  }),
  execute: async (args, ctx) => {
    // 容错：LLM 可能修改中文路径（如 "卡点-节奏" → "卡点 - 节奏"）
    const videoResolved = await resolveInputPath(args.video_file)
    const audioResolved = await resolveInputPath(args.audio_file)
    const videoFile = videoResolved.resolvedPath
    const audioFile = audioResolved.resolvedPath
    if (videoResolved.wasCorrected || audioResolved.wasCorrected) {
      console.log(`[merge_audio] 路径已自动纠正: video=${videoFile}, audio=${audioFile}`)
    }

    const result = await pythonMergeAudioVideo(
      videoFile,
      audioFile,
      args.output_file,
      async () => {
        const localResult = await mergeAudio(
          videoFile,
          audioFile,
          args.output_file,
        )
        return {
          success: localResult.success,
          operation: "merge_audio",
          title: localResult.success
            ? "Audio Merged with Video"
            : "Audio Merge Failed",
          output: localResult.success
            ? `Successfully merged audio with video\nOutput saved to: ${args.output_file}`
            : `Failed to merge audio: ${localResult.error || "Unknown error"}`,
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
        title: result.title || "Audio Merged with Video",
        metadata: {
          operation: "merge_audio",
          success: true,
          video_file: videoFile,
          audio_file: audioFile,
          output_file: result.metadata?.outputPath || args.output_file,
        },
        output:
          result.output ||
          `Successfully merged audio with video\nOutput saved to: ${result.metadata?.outputPath || args.output_file}`,
      }
    } else {
      return {
        title: "Audio Merge Failed",
        metadata: {
          operation: "merge_audio",
          error: true,
          error_message: result.error || result.metadata?.error_message,
        },
        output:
          result.output ||
          `Failed to merge audio: ${result.error || "Unknown error"}`,
      }
    }
  },
})

import z from "zod"
import { resolveInputPath } from "../../lib/path-resolver.js"
import { Tool } from "../../lib/tool.js"
import { mergeAudio } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

export const MergeAudioTool = Tool.define("merge_audio", {
  description: "Merge audio file with video file",
  parameters: z.object({
    video_file: z.string().describe("Path to input video file"),
    audio_file: z.string().describe("Path to input audio file"),
    output_file: z.string().describe("Path to output video file"),
  }),
  usageTemplate: {
    json: {
      video_file: "{source_video}",
      audio_file: "{output_dir}/bgm.mp3",
      output_file: "{output_dir}/merged_audio_{timestamp}.mp4",
    },
    constraints: [
      "video_file 和 audio_file 必须都存在",
      "将音频文件合并到视频中",
      "替换或混合原视频的音频轨道",
    ],
  },
  execute: async (args, ctx) => {
    // 容错：LLM 可能修改中文路径（如 "卡点-节奏" → "卡点 - 节奏"）
    const videoResolved = await resolveInputPath(args.video_file)
    const audioResolved = await resolveInputPath(args.audio_file)
    const videoFile = videoResolved.resolvedPath
    const audioFile = audioResolved.resolvedPath
    if (videoResolved.wasCorrected || audioResolved.wasCorrected) {
      console.log(
        `[merge_audio] 路径已自动纠正: video=${videoFile}, audio=${audioFile}`,
      )
    }

    // 安全沙箱校验 — 以 video 所在目录作为安全根目录
    const sandbox = validatePath(videoFile, args.output_file)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
        metadata: { operation: "merge_audio", error: !sandbox.skipped, skipped: sandbox.skipped },
        output: sandbox.error,
      }
    }
    const safeOutputPath = sandbox.outputPath

    const localResult = await mergeAudio(
      videoFile,
      audioFile,
      safeOutputPath,
      ctx.abort as unknown as number,
    )
    const result = {
      success: localResult.success,
      operation: "merge_audio",
      title: localResult.success
        ? "Audio Merged with Video"
        : "Audio Merge Failed",
      output: localResult.success
        ? `Successfully merged audio with video\nOutput saved to: ${safeOutputPath}`
        : `Failed to merge audio: ${localResult.error || "Unknown error"}`,
      metadata: {
        outputPath: localResult.success ? safeOutputPath : undefined,
        success: localResult.success,
        error: !localResult.success,
        error_message: localResult.error,
      },
    } as any

    if (result.success) {
      return {
        title: result.title || "Audio Merged with Video",
        metadata: {
          operation: "merge_audio",
          success: true,
      undoable: true,
          inputPath: videoFile,
          video_file: videoFile,
          audio_file: audioFile,
          output_file: result.metadata?.outputPath || safeOutputPath,
        },
        output:
          result.output ||
          `Successfully merged audio with video\nOutput saved to: ${result.metadata?.outputPath || safeOutputPath}`,
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

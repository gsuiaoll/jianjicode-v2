import { existsSync } from "fs"
import z from "zod"
import { extractFrameAtTime as pythonExtractFrame } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 视频帧提取工具 - 从视频中提取指定时间点的帧作为图片
 */
export const VideoExtractFrameTool = Tool.define("video_extract_frame", {
  description: "从视频中提取指定时间点的帧作为图片",
  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    time: z.number().min(0).describe("提取帧的时间点 (秒)"),
    output: z
      .string()
      .optional()
      .describe("输出图片文件路径 (默认: <input>_frame_at_<time>s.jpg)"),

    format: z
      .enum(["jpg", "jpeg", "png", "bmp"])
      .optional()
      .default("jpg")
      .describe("输出图片格式: jpg/jpeg, png, bmp"),
    quality: z
      .number()
      .min(1)
      .max(31)
      .optional()
      .default(2)
      .describe("输出质量 (1-31，越低质量越好，默认 2)"),

    width: z.number().optional().describe("输出图片宽度 (保持宽高比)"),
    height: z.number().optional().describe("输出图片高度 (保持宽高比)"),
    keep_aspect_ratio: z
      .boolean()
      .optional()
      .default(true)
      .describe("保持宽高比 (默认: true)"),
    fast_seek: z
      .boolean()
      .optional()
      .default(true)
      .describe("使用快速跳转 (默认: true，更快但不精确)"),

    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否允许覆盖已存在的输出文件 (默认: false)"),
    protect_originals: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保护原文件，强制输出到新文件 (默认: true)"),
    output_dir: z
      .string()
      .optional()
      .describe("限制输出目录，防止写入系统目录 (空表示不限制)"),
  }),

  execute: async (args: any, ctx: any) => {
    try {
      if (!existsSync(args.input)) {
        return {
          title: "视频帧提取失败",
          metadata: {
            operation: "video_extract_frame",
            error: true,
            success: false,
          },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      const path = await import("path")
      const fs = await import("fs")

      let outputPath = args.output
      if (!outputPath) {
        const inputStem = path.basename(args.input, path.extname(args.input))
        const outputFilename = `${inputStem}_frame_at_${args.time.toFixed(1)}s.${args.format}`
        const inputDir = path.dirname(args.input)
        outputPath = path.join(inputDir, outputFilename)
      }

      let finalOutputPath = outputPath

      if (protectOriginals) {
        const inputResolved = path.resolve(args.input)
        const outputResolved = path.resolve(outputPath)
        if (outputResolved === inputResolved) {
          const ext = path.extname(args.input)
          const base = path.basename(args.input, ext)
          const dir = path.dirname(args.input)
          finalOutputPath = path.join(
            dir,
            `${base}_frame_safe${args.time.toFixed(1)}s.${args.format}`,
          )
          console.log(
            `[安全增强] 原文件保护已启用，自动修改输出路径为: ${finalOutputPath}`,
          )
        }
      }

      if (outputDir && outputDir.trim()) {
        const outputDirResolved = path.resolve(outputDir)
        const outputPathResolved = path.resolve(finalOutputPath)
        const relative = path.relative(outputDirResolved, outputPathResolved)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return {
            title: "安全验证失败",
            metadata: {
              operation: "video_extract_frame",
              error: true,
              success: false,
            },
            output: `❌ 输出路径必须在指定目录内: ${outputDirResolved}`,
          }
        }
      }

      if (!allowOverwrite && fs.existsSync(finalOutputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "video_extract_frame",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      if (fs.existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      console.log(
        `[VideoExtractFrameTool] 从视频提取帧: ${args.input} 时间点: ${args.time}s`,
      )

      // Try Python first, fallback to local FFmpeg
      const result = await pythonExtractFrame(
        args.input,
        args.time,
        finalOutputPath,
        async () => {
          const ffmpegArgs = buildFfmpegArgs(args, finalOutputPath)
          const localResult = await runFfmpeg(ffmpegArgs)
          return {
            success: localResult.success,
            operation: "video_extract_frame",
            title: localResult.success ? "视频帧提取成功" : "视频帧提取失败",
            output: localResult.success
              ? `✅ 已成功从视频提取帧\n📁 输出文件: ${finalOutputPath}\n⏱️ 时间点: ${args.time}秒`
              : `❌ 帧提取失败: ${localResult.error || "未知错误"}`,
            metadata: {
              outputPath: localResult.success ? finalOutputPath : undefined,
              success: localResult.success,
              error: !localResult.success,
              error_message: localResult.error,
            },
          } as any
        },
      )

      if (result.success) {
        return {
          title: "视频帧提取成功",
          metadata: {
            operation: "video_extract_frame",
            success: true,
            error: false,
            outputPath: result.metadata?.outputPath || finalOutputPath,
            inputPath: args.input,
            time: args.time,
            format: args.format,
            quality: args.quality,
          },
          output: `✅ 已成功从视频提取帧\n📁 输出文件: ${result.metadata?.outputPath || finalOutputPath}\n⏱️ 时间点: ${args.time}秒\n📷 格式: ${args.format} (质量: ${args.quality})`,
        }
      } else {
        return {
          title: "视频帧提取失败",
          metadata: {
            operation: "video_extract_frame",
            error: true,
            success: false,
          },
          output: `❌ 帧提取失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "视频帧提取错误",
        metadata: {
          operation: "video_extract_frame",
          error: true,
          success: false,
        },
        output: `❌ 帧提取过程中发生错误: ${error.message}`,
      }
    }
  },
})

function buildFfmpegArgs(args: any, outputPath: string): string[] {
  const ffmpegArgs: string[] = []

  if (args.fast_seek) {
    ffmpegArgs.push("-ss", args.time.toString())
    ffmpegArgs.push("-i", args.input)
  } else {
    ffmpegArgs.push("-i", args.input)
    ffmpegArgs.push("-ss", args.time.toString())
  }

  ffmpegArgs.push("-frames:v", "1")

  if (args.format === "jpg" || args.format === "jpeg") {
    ffmpegArgs.push("-q:v", args.quality.toString())
  } else if (args.format === "png") {
    const pngQuality = Math.floor(((args.quality - 1) / 30) * 9)
    ffmpegArgs.push("-compression_level", pngQuality.toString())
  }

  if (args.width || args.height) {
    let scaleFilter = "scale="
    if (args.width && args.height) {
      if (args.keep_aspect_ratio) {
        scaleFilter += `'min(${args.width},iw*${args.height}/ih)':'min(${args.height},ih*${args.width}/iw)'`
      } else {
        scaleFilter += `${args.width}:${args.height}`
      }
    } else if (args.width) {
      scaleFilter += `${args.width}:-1`
    } else if (args.height) {
      scaleFilter += `-1:${args.height}`
    }
    ffmpegArgs.push("-vf", scaleFilter)
  }

  ffmpegArgs.push("-y", outputPath)
  return ffmpegArgs
}

export const ExtractFrameTool = VideoExtractFrameTool

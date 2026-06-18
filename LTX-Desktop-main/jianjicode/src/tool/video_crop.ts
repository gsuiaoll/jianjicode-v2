import { existsSync } from "fs"
import { basename, dirname, extname, join } from "path"
import z from "zod"
import { Tool } from "./tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 视频裁剪工具 — 快速裁剪视频画面，支持自定义区域和宽高比
 *
 * 与 video_intelligent_crop（AI 智能裁剪）互补：
 * - video_crop: 无需 AI，快速精确裁剪，手动指定区域或按宽高比自动裁剪
 * - video_intelligent_crop: AI 分析主体，动态追踪裁剪
 */
export const VideoCropTool: any = Tool.define("video_crop", {
  description: "裁剪视频画面，支持自定义区域和宽高比。无需 AI，快速精确",
  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_cropped.mp4)"),

    // 方式一：显式裁剪区域
    crop_x: z
      .number()
      .min(0)
      .optional()
      .describe("裁剪区域左上角 X 坐标 (像素)"),
    crop_y: z
      .number()
      .min(0)
      .optional()
      .describe("裁剪区域左上角 Y 坐标 (像素)"),
    crop_width: z
      .number()
      .min(1)
      .optional()
      .describe("裁剪区域宽度 (像素)"),
    crop_height: z
      .number()
      .min(1)
      .optional()
      .describe("裁剪区域高度 (像素)"),

    // 方式二：目标宽高比（从画面中心裁剪）
    aspect_ratio: z
      .string()
      .optional()
      .describe("目标宽高比，如 16:9, 4:3, 1:1, 9:16, 2.35:1, 21:9"),
    aspect_ratio_gravity: z
      .enum(["center", "top", "bottom", "left", "right"])
      .optional()
      .default("center")
      .describe("宽高比裁剪时对齐方向 (默认: center)"),

    // 方式三：快捷模式
    mode: z
      .enum(["manual", "center_half", "square", "vertical"])
      .optional()
      .default("manual")
      .describe(
        "快捷裁剪模式: manual(手动), center_half(中心50%), square(1:1方形), vertical(9:16竖版)",
      ),

    // 输出参数
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (CRF, 0-51，越低质量越好，默认: 23)"),
    preset: z
      .enum([
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
      ])
      .optional()
      .default("fast")
      .describe("编码预设 (默认: fast)"),
    preserve_audio: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保留原始音频 (默认: true)"),

    // 安全参数
    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否允许覆盖已存在的输出文件 (默认: false)"),
  }),

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入
      if (!existsSync(args.input)) {
        return {
          title: "视频裁剪失败",
          metadata: { operation: "video_crop", error: true, success: false },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      // 2. 确定输出路径
      const outputPath =
        args.output ||
        join(
          dirname(args.input),
          `${basename(args.input, extname(args.input))}_cropped.mp4`,
        )

      if (!args.allow_overwrite && existsSync(outputPath)) {
        return {
          title: "安全验证失败",
          metadata: { operation: "video_crop", error: true, success: false },
          output: `❌ 输出文件已存在且未允许覆盖: ${outputPath}`,
        }
      }

      // 3. 获取视频原始尺寸
      const videoInfo = await getVideoDimensions(args.input)
      if (!videoInfo) {
        return {
          title: "视频裁剪失败",
          metadata: { operation: "video_crop", error: true, success: false },
          output: "❌ 无法获取视频尺寸信息",
        }
      }

      // 4. 计算裁剪参数
      const crop = calculateCrop(videoInfo, args)

      // 5. 执行 FFmpeg 裁剪
      const ffmpegArgs = [
        "-i",
        args.input,
        "-vf",
        `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
        "-c:v",
        "libx264",
        "-preset",
        args.preset,
        "-crf",
        String(args.quality),
      ]

      if (args.preserve_audio) {
        ffmpegArgs.push("-c:a", "aac", "-b:a", "128k")
      } else {
        ffmpegArgs.push("-an")
      }

      ffmpegArgs.push("-y", outputPath)

      console.log(`[VideoCrop] 裁剪: ${videoInfo.width}x${videoInfo.height} → ${crop.width}x${crop.height} @ (${crop.x},${crop.y})`)

      const result = await runFfmpeg(ffmpegArgs)

      if (!result.success) {
        throw new Error(`FFmpeg 裁剪失败: ${result.output}`)
      }

      return {
        title: "视频裁剪成功",
        metadata: {
          operation: "video_crop",
          success: true,
          outputPath,
          originalSize: `${videoInfo.width}x${videoInfo.height}`,
          cropSize: `${crop.width}x${crop.height}`,
          cropOffset: `(${crop.x},${crop.y})`,
        },
        output: [
          `✅ 视频裁剪完成`,
          `📐 ${videoInfo.width}x${videoInfo.height} → ${crop.width}x${crop.height}`,
          `📍 偏移: (${crop.x}, ${crop.y})`,
          `📁 ${outputPath}`,
        ].join("\n"),
      }
    } catch (error: any) {
      return {
        title: "视频裁剪错误",
        metadata: { operation: "video_crop", error: true, success: false },
        output: `❌ 裁剪失败: ${error.message}`,
      }
    }
  },
} as any)

/** 获取视频原始尺寸 (FFprobe) */
async function getVideoDimensions(
  videoPath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const { spawnSync } = await import("child_process")
    const { findFfmpegPath } = await import("./ffmpeg-utils.js")
    const ffprobePath = findFfmpegPath()?.replace("ffmpeg", "ffprobe")
    if (!ffprobePath) return null

    const result = spawnSync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        videoPath,
      ],
      { encoding: "utf8" },
    )

    if (!result.stdout) return null
    const [w, h] = result.stdout.trim().split(",").map(Number)
    if (!w || !h) return null
    return { width: w, height: h }
  } catch {
    return null
  }
}

/** 计算裁剪区域 */
function calculateCrop(
  video: { width: number; height: number },
  args: any,
): { x: number; y: number; width: number; height: number } {
  const { width: vw, height: vh } = video

  // 快捷模式
  switch (args.mode) {
    case "center_half":
      return {
        x: Math.round(vw / 4),
        y: Math.round(vh / 4),
        width: Math.round(vw / 2),
        height: Math.round(vh / 2),
      }
    case "square": {
      const size = Math.min(vw, vh)
      return {
        x: Math.round((vw - size) / 2),
        y: Math.round((vh - size) / 2),
        width: size,
        height: size,
      }
    }
    case "vertical": {
      // 9:16 from center
      const targetH = vh
      const targetW = Math.round((vh * 9) / 16)
      if (targetW <= vw) {
        return {
          x: Math.round((vw - targetW) / 2),
          y: 0,
          width: targetW,
          height: targetH,
        }
      }
      // 视频太窄，改为宽度适配，钳制高度不超过 vh
      const fitH = Math.min(Math.round((vw * 16) / 9), vh)
      return {
        x: 0,
        y: Math.round((vh - fitH) / 2),
        width: vw,
        height: fitH,
      }
    }
  }

  // 显式裁剪区域 (优先)
  if (
    args.crop_width &&
    args.crop_height
  ) {
    return {
      x: Math.min(args.crop_x || 0, vw - args.crop_width),
      y: Math.min(args.crop_y || 0, vh - args.crop_height),
      width: Math.min(args.crop_width, vw),
      height: Math.min(args.crop_height, vh),
    }
  }

  // 宽高比裁剪
  if (args.aspect_ratio) {
    return cropToAspectRatio(vw, vh, args.aspect_ratio, args.aspect_ratio_gravity)
  }

  // 默认：不裁剪（返回全尺寸）
  return { x: 0, y: 0, width: vw, height: vh }
}

/** 按宽高比计算裁剪区域 */
function cropToAspectRatio(
  vw: number,
  vh: number,
  ratioStr: string,
  gravity: string = "center",
): { x: number; y: number; width: number; height: number } {
  const parts = ratioStr.split(":").map(Number)
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { x: 0, y: 0, width: vw, height: vh }
  }

  const targetRatio = parts[0] / parts[1]
  const videoRatio = vw / vh

  let cw: number, ch: number, cx: number, cy: number

  if (videoRatio > targetRatio) {
    // 视频更宽 → 裁剪左右
    ch = vh
    cw = Math.round(ch * targetRatio)
    switch (gravity) {
      case "left":
        cx = 0
        break
      case "right":
        cx = vw - cw
        break
      default:
        cx = Math.round((vw - cw) / 2)
    }
    cy = 0
  } else {
    // 视频更高 → 裁剪上下
    cw = vw
    ch = Math.round(cw / targetRatio)
    switch (gravity) {
      case "top":
        cy = 0
        break
      case "bottom":
        cy = vh - ch
        break
      default:
        cy = Math.round((vh - ch) / 2)
    }
    cx = 0
  }

  return { x: cx, y: cy, width: cw, height: ch }
}

export const CropTool = VideoCropTool


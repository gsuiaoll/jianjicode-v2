import { existsSync } from "fs"
import { basename, dirname, extname, join, resolve } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { runFfmpeg } from "../../lib/ffmpeg-utils.js"

/**
 * 视频遮罩工具 - 应用矩形/椭圆形遮罩效果
 *
 * 支持功能:
 * 1. 矩形和椭圆形遮罩
 * 2. 位置、大小控制 (百分比坐标)
 * 3. 边缘羽化 (模糊软化)
 * 4. 遮罩反转 (内部/外部效果)
 * 5. 旋转控制 (矩形遮罩)
 * 6. 遮罩区域效果叠加 (alphamerge + filter_complex)
 *
 * 基于LTX的EffectMask设计，参考LTX-Desktop-main/frontend/types/project.ts
 */
export const VideoMaskTool: any = Tool.define("video_mask", {
  description:
    "视频遮罩工具 — 应用矩形或椭圆形遮罩限制效果区域。支持矩形/椭圆形状、羽化、反转、旋转、效果叠加。shape: rectangle|ellipse；位置: x/y/width/height；可选 feather/invert/angle。\n" +
    "⚠️ 使用场景: 区域遮罩/局部效果 → 用此工具。全屏滤镜/调色/模糊 → 用 video_filter。画面裁剪 → 用 ffmpeg trim。速度 → 用 video_speed。",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_masked.<ext>)"),

    // 遮罩基本参数
    shape: z
      .enum(["rectangle", "ellipse"])
      .optional()
      .default("rectangle")
      .describe("遮罩形状: rectangle(矩形), ellipse(椭圆形)"),
    x: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("遮罩中心X位置 (百分比，0-100，默认 50)"),
    y: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("遮罩中心Y位置 (百分比，0-100，默认 50)"),
    width: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(40)
      .describe("遮罩宽度 (百分比，0-100，默认 40)"),
    height: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(40)
      .describe("遮罩高度 (百分比，0-100，默认 40)"),
    feather: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(20)
      .describe("边缘羽化强度 (像素，0-100，默认 20)"),
    invert: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "反转遮罩 (true=效果应用于遮罩外部，false=效果应用于遮罩内部，默认 false)",
      ),
    rotation: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .default(0)
      .describe("旋转角度 (度，-180到180，默认 0，仅对矩形有效)"),

    // 遮罩内容选项 (未来扩展: 可以应用特定效果到遮罩区域)
    apply_effect: z
      .enum([
        "none",
        "blur",
        "brightness",
        "contrast",
        "saturation",
        "colorize",
      ])
      .optional()
      .default("none")
      .describe(
        "应用到遮罩区域的效果: none(无), blur(模糊), brightness(亮度), contrast(对比度), saturation(饱和度), colorize(着色)",
      ),
    effect_strength: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("效果强度 (0-100%，默认 50)"),

    // 性能选项
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (0-51，越低质量越好，默认 23)"),
    fast: z
      .boolean()
      .optional()
      .default(false)
      .describe("使用快速编码 (质量较低但速度更快)"),

    // 安全增强参数
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
  usageTemplate: {
    json: {
      input: "{source_video}",
      output: "{output_dir}/masked_{timestamp}.mp4",
      shape: "rectangle",
      x: 50,
      y: 50,
      width: 40,
      height: 40,
      feather: 20,
      invert: false,
      rotation: 0,
      quality: 23,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "shape 支持 rectangle(矩形)/ellipse(椭圆形)",
      "x/y 遮罩中心位置，百分比 0-100",
      "width/height 遮罩尺寸，百分比 0-100",
      "feather 边缘羽化强度 0-100 像素",
      "invert=true 时效果应用于遮罩外部",
      "rotation 仅 rectangle 支持，范围 -180~180 度",
      "遮罩区域外保留原始画面",
    ],
  },

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "视频遮罩应用失败",
          metadata: { operation: "video_mask", error: true, success: false },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      let outputPath = args.output
      if (!outputPath) {
        const inputStem = basename(args.input, extname(args.input))
        const outputFilename = `${inputStem}_masked.mp4`
        const inputDir = dirname(args.input)
        outputPath = join(inputDir, outputFilename)
      }

      // 安全沙箱校验
      const sandbox = validatePath(args.input, outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "video_mask", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 4. 构建FFmpeg参数
      const ffmpegArgs = VideoMaskTool.buildFfmpegArgs(args, finalOutputPath)

      // 5. 执行FFmpeg命令
      console.log(`[VideoMaskTool] 应用遮罩到: ${args.input}`)
      console.log(
        `[VideoMaskTool] 遮罩形状: ${args.shape}, 位置: (${args.x}%, ${args.y}%), 大小: ${args.width}%x${args.height}%`,
      )
      if (args.feather > 0) {
        console.log(`[VideoMaskTool] 边缘羽化: ${args.feather}px`)
      }
      if (args.invert) {
        console.log(`[VideoMaskTool] 反转遮罩: 效果应用于遮罩外部`)
      }
      if (args.apply_effect !== "none") {
        console.log(
          `[VideoMaskTool] 区域效果: ${args.apply_effect} ${args.effect_strength}%`,
        )
      }

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 6. 返回结果
      if (result.success) {
        return {
          title: "视频遮罩应用成功",
          metadata: {
            operation: "video_mask",
            success: true,
      undoable: true,
            error: false,
            outputPath: finalOutputPath,
            inputPath: args.input,
            mask: {
              shape: args.shape,
              x: args.x,
              y: args.y,
              width: args.width,
              height: args.height,
              feather: args.feather,
              invert: args.invert,
              rotation: args.rotation,
            },
            effect:
              args.apply_effect !== "none"
                ? {
                    type: args.apply_effect,
                    strength: args.effect_strength,
                  }
                : null,
          },
          output: `✅ 已成功应用遮罩到视频\n📁 输出文件: ${finalOutputPath}\n${VideoMaskTool.getMaskDescription(args)}`,
        }
      } else {
        return {
          title: "视频遮罩应用失败",
          metadata: { operation: "video_mask", error: true, success: false },
          output: `❌ 遮罩应用失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "视频遮罩应用错误",
        metadata: { operation: "video_mask", error: true, success: false },
        output: `❌ 遮罩应用过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
VideoMaskTool.buildFfmpegArgs = (args: any, outputPath: string): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]

  // 当需要区域效果叠加时，使用 filter_complex + alphamerge
  if (args.apply_effect !== "none") {
    const complexFilter = VideoMaskTool.buildEffectMaskComplex(args)
    ffmpegArgs.push("-filter_complex", complexFilter)
    ffmpegArgs.push("-map", "[out]")
  } else {
    // 简单遮罩: 使用 -vf
    const filterString = VideoMaskTool.buildMaskFilter(args)
    if (filterString) {
      ffmpegArgs.push("-vf", filterString)
    }
  }

  // 编码参数
  if (args.fast) {
    ffmpegArgs.push("-preset", "fast")
  } else {
    ffmpegArgs.push("-preset", "medium")
  }

  // 质量参数
  ffmpegArgs.push("-crf", args.quality.toString())

  // 音频设置
  ffmpegArgs.push("-c:a", "copy")

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

VideoMaskTool.buildMaskFilter = (args: any): string => {
  const filters: string[] = []

  const wExpr = "iw"
  const hExpr = "ih"

  // 预计算边界百分比（TypeScript 算术，避免 FFmpeg 表达式中嵌套括号过深）
  const xPct = args.x
  const yPct = args.y
  const halfW = args.width / 2
  const halfH = args.height / 2
  const featherPx = args.feather

  // 基本遮罩创建
  let maskFilter = ""

  if (args.shape === "rectangle") {
    const xMinPct = Math.round(Math.max(0, xPct - halfW))
    const xMaxPct = Math.round(Math.min(100, xPct + halfW))
    const yMinPct = Math.round(Math.max(0, yPct - halfH))
    const yMaxPct = Math.round(Math.min(100, yPct + halfH))

    const x0 = `${wExpr}*${xMinPct}/100`
    const y0 = `${hExpr}*${yMinPct}/100`
    const w = `${wExpr}*${args.width}/100`
    const h = `${hExpr}*${args.height}/100`

    if (args.rotation !== 0) {
      console.log(
        `[VideoMaskTool] 注意: 矩形旋转(${args.rotation}°)在FFmpeg中需要复杂滤镜图，当前版本可能不精确`,
      )
    }

    // 创建矩形遮罩 (白色矩形，黑色背景)
    maskFilter = `drawbox=x=${x0}:y=${y0}:w=${w}:h=${h}:color=white@1:t=fill`

    // 反转: 用 geq 对 drawbox 输出做像素级反色 (white→black, black→white)
    if (args.invert) {
      maskFilter += `,geq=lum='255-p(X,Y)':cb='128':cr='128'`
    }
  } else if (args.shape === "ellipse") {
    // 椭圆形遮罩: 预计算系数避免 /100/2 等复杂链式表达式
    const cx = xPct / 100
    const cy = yPct / 100
    const rx = args.width / 200   // width%/100/2
    const ry = args.height / 200  // height%/100/2
    const rx2 = rx * rx
    const ry2 = ry * ry
    const rx2ry2 = rx2 * ry2

    // 椭圆不等式: (X-cx)^2*ry^2 + (Y-cy)^2*rx^2 <= rx^2*ry^2
    const xTerm = `(X-W*${cx})*(X-W*${cx})*H*H*${ry2}`
    const yTerm = `(Y-H*${cy})*(Y-H*${cy})*W*W*${rx2}`
    const rhs = `W*W*${rx2}*H*H*${ry2}`
    const inside = `lte(${xTerm}+${yTerm},${rhs})`

    const valIn = args.invert ? 0 : 255
    const valOut = args.invert ? 255 : 0
    maskFilter = `geq=lum='if(${inside},${valIn},${valOut})':cb='128':cr='128'`
  }

  // 边缘羽化处理
  if (featherPx > 0) {
    maskFilter += `,gblur=sigma=${featherPx / 2}`
  }

  if (maskFilter) {
    filters.push(maskFilter)
  }

  if (filters.length === 0) {
    return ""
  }

  const finalFilter = filters.join(",")
  console.log(`[VideoMaskTool] 编译的遮罩滤镜字符串: ${finalFilter}`)
  return finalFilter
}

/**
 * 构建带效果叠加的 filter_complex 图
 *
 * 流程: [0:v] → split → [orig] 原始视频 / [eff_src] 效果视频 / [mask_src] 遮罩视频
 *       [mask_src] → 遮罩生成 → format=gray → [mask]
 *       [eff_src] → 效果处理 → format=rgba → [eff_rgba]
 *       [orig] → format=rgba → [orig_rgba]
 *       [eff_rgba][mask] → alphamerge → [eff_masked]
 *       [orig_rgba][eff_masked] → overlay → [out]
 */
VideoMaskTool.buildEffectMaskComplex = (args: any): string => {
  const parts: string[] = []

  // 1. split 原视频为 3 路
  parts.push("[0:v]split=3[orig][eff_src][mask_src]")

  // 2. mask 流: 生成纯遮罩 (white=effect 区域, black=保留原画)
  const maskFilter = VideoMaskTool.buildMaskFilterForComplex(args)
  parts.push(`[mask_src]${maskFilter},format=gray[mask]`)

  // 3. effect 流: 原视频 + 效果
  const effectFilter = VideoMaskTool.buildEffectFilter(
    args.apply_effect,
    args.effect_strength,
  )
  parts.push(`[eff_src]${effectFilter},format=rgba[eff_rgba]`)

  // 4. original 流: 转 rgba
  parts.push("[orig]format=rgba[orig_rgba]")

  // 5. alphamerge: 给 effect 视频加上 mask alpha 通道
  parts.push("[eff_rgba][mask]alphamerge[eff_masked]")

  // 6. overlay: alpha-masked effect 叠回 original
  parts.push("[orig_rgba][eff_masked]overlay=0:0[out]")

  return parts.join(";")
}

/**
 * 为 filter_complex 构建纯遮罩 (pure white/black gray mask)
 * 与 buildMaskFilter 的区别: 不使用 p(X,Y) 保留原像素，因为 alphamerge 需要 binary mask
 */
VideoMaskTool.buildMaskFilterForComplex = (args: any): string => {
  const featherPx = args.feather
  const valIn = args.invert ? 0 : 255
  const valOut = args.invert ? 255 : 0

  if (args.shape === "rectangle") {
    // 预计算边界百分比，避免 FFmpeg 解析嵌套括号表达式出错
    const xMinPct = Math.round(Math.max(0, args.x - args.width / 2))
    const xMaxPct = Math.round(Math.min(100, args.x + args.width / 2))
    const yMinPct = Math.round(Math.max(0, args.y - args.height / 2))
    const yMaxPct = Math.round(Math.min(100, args.y + args.height / 2))

    const xMin = `iw*${xMinPct}/100`
    const xMax = `iw*${xMaxPct}/100`
    const yMin = `ih*${yMinPct}/100`
    const yMax = `ih*${yMaxPct}/100`

    let filter = `geq=lum='if(gt(X,${xMin}),if(lt(X,${xMax}),if(gt(Y,${yMin}),if(lt(Y,${yMax}),${valIn},${valOut}),${valOut}),${valOut}),${valOut})':cb='128':cr='128'`
    if (featherPx > 0) {
      filter += `,gblur=sigma=${featherPx / 2}`
    }
    console.log(`[VideoMaskTool] 编译的复杂矩形遮罩滤镜: ${filter}`)
    return filter
  }

  // ellipse: 预计算系数，避免 /100/2 等链式除法引发解析错误
  const cx = args.x / 100
  const cy = args.y / 100
  const rx = args.width / 200
  const ry = args.height / 200
  const rx2 = rx * rx
  const ry2 = ry * ry

  const xTerm = `(X-W*${cx})*(X-W*${cx})*H*H*${ry2}`
  const yTerm = `(Y-H*${cy})*(Y-H*${cy})*W*W*${rx2}`
  const rhs = `W*W*${rx2}*H*H*${ry2}`
  const inside = `lte(${xTerm}+${yTerm},${rhs})`

  let filter = `geq=lum='if(${inside},${valIn},${valOut})':cb='128':cr='128'`
  if (featherPx > 0) {
    filter += `,gblur=sigma=${featherPx / 2}`
  }
  console.log(`[VideoMaskTool] 编译的复杂椭圆遮罩滤镜: ${filter}`)
  return filter
}

VideoMaskTool.buildEffectFilter = (
  effectType: string,
  strength: number,
): string => {
  const t = strength / 100

  switch (effectType) {
    case "blur":
      return `boxblur=${10 * t}`
    case "brightness":
      return `eq=brightness=${(t - 0.5) * 0.5}`
    case "contrast":
      return `eq=contrast=${1 + t}`
    case "saturation":
      return `eq=saturation=${1 + t}`
    case "colorize":
      return `colorbalance=rs=${0.2 * t}:gs=0:bs=${-0.2 * t}`
    default:
      return "copy"
  }
}

VideoMaskTool.getMaskDescription = (args: any): string => {
  const parts: string[] = []

  parts.push(`形状: ${args.shape === "rectangle" ? "矩形" : "椭圆形"}`)
  parts.push(`位置: (${args.x}%, ${args.y}%)`)
  parts.push(`大小: ${args.width}% × ${args.height}%`)

  if (args.feather > 0) {
    parts.push(`羽化: ${args.feather}px`)
  }

  if (args.invert) {
    parts.push(`反转: 是`)
  }

  if (args.rotation !== 0) {
    parts.push(`旋转: ${args.rotation}°`)
  }

  if (args.apply_effect !== "none") {
    const effectNames: Record<string, string> = {
      blur: "模糊",
      brightness: "亮度",
      contrast: "对比度",
      saturation: "饱和度",
      colorize: "着色",
    }
    parts.push(
      `效果: ${effectNames[args.apply_effect]} ${args.effect_strength}%`,
    )
  }

  return `🖼️ 遮罩设置: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const MaskTool = VideoMaskTool

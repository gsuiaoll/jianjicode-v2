import { existsSync } from "fs"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 视频滤镜工具 - 应用视频滤镜效果
 *
 * 支持功能:
 * 1. 基础滤镜: 亮度、对比度、饱和度、色相、伽马值调整
 * 2. 预设滤镜: 复古、电影感、戏剧化、暖色、冷色
 * 3. 组合滤镜: 多个效果同时应用
 */
export const VideoFilterTool: any = Tool.define("video_filter", {
  description: "应用视频滤镜效果 (亮度、对比度、饱和度、色相、伽马值调整)",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_filtered.<ext>)"),

    // 基础滤镜参数 (全部可选，默认0/100/1)
    brightness: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("亮度调整 (-100 到 +100，默认 0)"),
    contrast: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("对比度调整 (-100 到 +100，默认 0)"),
    saturation: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe(
        "饱和度调整 (-100 到 +100，默认 0，负=降低饱和度，正=增加饱和度)",
      ),
    hue: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .default(0)
      .describe("色相调整 (-180 到 +180 度，默认 0)"),
    gamma: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(1)
      .describe("伽马值调整 (0.1-10，默认 1)"),

    // 高级滤镜参数
    exposure: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("曝光调整 (-100 到 +100，默认 0)"),
    sharpen: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .describe("锐化强度 (0-5，默认 0)"),
    blur: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .describe("模糊强度 (0-10，默认 0)"),
    glow: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("发光效果强度 (0-100，默认 0)"),
    vignette: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("暗角效果强度 (0-100，默认 0)"),
    grain: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("颗粒效果强度 (0-100，默认 0)"),
    // LTX兼容参数
    temperature: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("色温调整 (-100 到 +100，负=冷/蓝，正=暖/橙，默认 0)"),
    tint: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("色调调整 (-100 到 +100，负=绿，正=品红，默认 0)"),
    highlights: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("高光调整 (-100 到 +100，默认 0)"),
    shadows: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("阴影调整 (-100 到 +100，默认 0)"),

    // 预设滤镜 (与具体参数互斥)
    preset: z
      .enum([
        "vintage",
        "cinematic",
        "dramatic",
        "warm",
        "cool",
        "blackwhite",
        "muted",
        "vivid",
        "none",
      ])
      .optional()
      .default("none")
      .describe(
        "预设滤镜: vintage(复古), cinematic(电影感), dramatic(戏剧化), warm(暖色), cool(冷色), blackwhite(黑白), muted(柔和), vivid(鲜艳), none(无)",
      ),

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

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "视频滤镜应用失败",
          metadata: { operation: "video_filter", error: true },
          output: `输入文件不存在: ${args.input}`,
        }
      }

      // 安全增强：获取安全参数
      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      // 2. 构建输出路径
      const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_filtered.mp4`

      // 安全增强：验证输出路径
      const path = await import("path")
      const fs = await import("fs")
      let finalOutputPath = outputPath

      // 保护原文件检查
      if (protectOriginals) {
        const inputResolved = path.resolve(args.input)
        const outputResolved = path.resolve(outputPath)
        if (outputResolved === inputResolved) {
          // 自动修改输出文件名，添加 _safe 后缀
          const ext = path.extname(args.input)
          const base = path.basename(args.input, ext)
          const dir = path.dirname(args.input)
          finalOutputPath = path.join(dir, `${base}_filtered_safe${ext}`)
          console.log(
            `[安全增强] 原文件保护已启用，自动修改输出路径为: ${finalOutputPath}`,
          )
        }
      }

      // 输出目录限制检查
      if (outputDir && outputDir.trim()) {
        const outputDirResolved = path.resolve(outputDir)
        const outputPathResolved = path.resolve(finalOutputPath)
        const relative = path.relative(outputDirResolved, outputPathResolved)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return {
            title: "安全验证失败",
            metadata: {
              operation: "video_filter",
              error: true,
              success: false,
            },
            output: `❌ 输出路径必须在指定目录内: ${outputDirResolved}`,
          }
        }
      }

      // 覆盖确认检查
      if (!allowOverwrite && fs.existsSync(finalOutputPath)) {
        return {
          title: "安全验证失败",
          metadata: { operation: "video_filter", error: true, success: false },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      // 3. 检查输出文件是否已存在（仅警告）
      if (fs.existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      // 4. 构建FFmpeg滤镜字符串
      const filterString = VideoFilterTool.buildFilterString(args)

      // 5. 构建FFmpeg参数
      const ffmpegArgs = VideoFilterTool.buildFfmpegArgs(
        args,
        filterString,
        finalOutputPath,
      )

      // 6. 执行FFmpeg命令
      console.log(`[VideoFilterTool] 应用滤镜到: ${args.input}`)
      if (filterString) {
        console.log(`[VideoFilterTool] 滤镜参数: ${filterString}`)
      }

      const result = await runFfmpeg(ffmpegArgs)

      // 7. 返回结果
      if (result.success) {
        return {
          title: "视频滤镜应用成功",
          metadata: {
            operation: "video_filter",
            success: true,
            error: false,
            outputPath: finalOutputPath,
            parameters: args,
            filterUsed: filterString || "无 (使用预设)",
          },
          output: `✅ 已成功应用滤镜到视频\n📁 输出文件: ${finalOutputPath}\n${VideoFilterTool.getFilterDescription(args)}`,
        }
      } else {
        return {
          title: "视频滤镜应用失败",
          metadata: { operation: "video_filter", error: true, success: false },
          output: `❌ 滤镜应用失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "视频滤镜应用错误",
        metadata: { operation: "video_filter", error: true, success: false },
        output: `❌ 滤镜应用过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
VideoFilterTool.buildFilterString = (args: any): string => {
  const filters: string[] = []

  // 预设滤镜映射
  if (args.preset !== "none") {
    const presetFilters = {
      vintage: "curves=preset=vintage:psfile=''",
      cinematic:
        "colorbalance=rs=-0.1:gs=-0.1:bs=0.1, eq=contrast=1.1:brightness=-0.05",
      dramatic: "eq=contrast=1.3:brightness=-0.1:saturation=1.2",
      warm: "colorbalance=rs=0.15:gs=-0.05, eq=saturation=1.1",
      cool: "colorbalance=rs=-0.1:gs=0.05:bs=0.15, eq=contrast=1.05",
      blackwhite: "hue=s=0, eq=contrast=1.2",
    }
    filters.push(presetFilters[args.preset as keyof typeof presetFilters])
  }

  // 自定义基础滤镜参数
  // 使用默认值以防参数未定义
  const brightness = args.brightness !== undefined ? args.brightness : 0
  const contrast = args.contrast !== undefined ? args.contrast : 0
  const saturation = args.saturation !== undefined ? args.saturation : 0
  const hue = args.hue !== undefined ? args.hue : 0
  const gamma = args.gamma !== undefined ? args.gamma : 1

  if (brightness !== 0) {
    // FFmpeg的brightness参数范围是-1.0到1.0，我们映射-100到100
    const brightnessValue = brightness / 100
    filters.push(`eq=brightness=${brightnessValue.toFixed(2)}`)
  }

  if (contrast !== 0) {
    // FFmpeg的contrast范围是-2.0到2.0，我们映射-100到100
    const contrastValue = 1 + contrast / 100
    filters.push(`eq=contrast=${contrastValue.toFixed(2)}`)
  }

  if (saturation !== 0) {
    const saturationValue = 1.0 + saturation / 100 // -100→0, 0→1, 100→2
    filters.push(`eq=saturation=${saturationValue.toFixed(2)}`)
  }

  if (hue !== 0) {
    filters.push(`hue=h=${hue}:s=1`)
  }

  if (gamma !== 1) {
    filters.push(`eq=gamma=${gamma}`)
  }

  // 高级滤镜参数
  if (args.exposure !== undefined && args.exposure !== 0) {
    // 将-100到100映射到-3到3的伽马指数范围
    const exposureValue = (args.exposure / 100) * 3
    filters.push(
      `eq=gamma_r=${Math.exp(exposureValue)}:gamma_g=${Math.exp(exposureValue)}:gamma_b=${Math.exp(exposureValue)}`,
    )
  }

  if (args.sharpen !== undefined && args.sharpen > 0) {
    filters.push(`unsharp=lx=5:ly=5:la=${args.sharpen.toFixed(2)}`)
  }

  if (args.blur !== undefined && args.blur > 0) {
    filters.push(`boxblur=${args.blur.toFixed(1)}`)
  }

  // 新增特效滤镜
  if (args.glow !== undefined && args.glow > 0) {
    // 发光效果: 使用模糊和亮度调整模拟
    const glowAmount = args.glow / 100
    // 添加模糊层并调整亮度
    filters.push(`boxblur=10, eq=brightness=${(glowAmount * 0.3).toFixed(2)}`)
  }

  if (args.vignette !== undefined && args.vignette > 0) {
    // 暗角效果: 使用vignette滤镜
    const vignetteAmount = args.vignette / 100
    // angle: 角度, x0/y0: 中心点, mode: 类型
    filters.push(`vignette=PI/4*${vignetteAmount.toFixed(2)}`)
  }

  if (args.grain !== undefined && args.grain > 0) {
    // 颗粒效果: 使用noise滤镜
    const grainAmount = args.grain / 100
    // alls: 强度, allf: 频率类型
    filters.push(`noise=alls=${Math.floor(grainAmount * 30)}:allf=t`)
  }

  // LTX兼容参数处理
  if (args.temperature !== undefined && args.temperature !== 0) {
    // 色温: -100(冷/蓝) 到 +100(暖/橙)
    const tempValue = args.temperature / 100
    // 调整红色和蓝色通道: 冷色温增加蓝色减少红色，暖色温增加红色减少蓝色
    const rs = -tempValue * 0.2 // 红色调整
    const bs = tempValue * 0.2 // 蓝色调整
    filters.push(`colorbalance=rs=${rs.toFixed(2)}:gs=0:bs=${bs.toFixed(2)}`)
  }

  if (args.tint !== undefined && args.tint !== 0) {
    // 色调: -100(绿) 到 +100(品红)
    const tintValue = args.tint / 100
    // 调整绿色和红色通道: 绿色调整绿色，品红调整红色和蓝色
    const gs = -tintValue * 0.2 // 绿色调整
    const rs = tintValue * 0.1 // 红色调整
    const bs = tintValue * 0.1 // 蓝色调整
    filters.push(
      `colorbalance=rs=${rs.toFixed(2)}:gs=${gs.toFixed(2)}:bs=${bs.toFixed(2)}`,
    )
  }

  if (args.highlights !== undefined && args.highlights !== 0) {
    // 高光调整: -100 到 +100
    const highlightValue = args.highlights / 100
    // 使用colorlevels调整高光: romax/gomax/bomax参数
    const romax = 1.0 - highlightValue * 0.3
    const gomax = 1.0 - highlightValue * 0.3
    const bomax = 1.0 - highlightValue * 0.3
    filters.push(
      `colorlevels=romax=${romax.toFixed(2)}:gomax=${gomax.toFixed(2)}:bomax=${bomax.toFixed(2)}`,
    )
  }

  if (args.shadows !== undefined && args.shadows !== 0) {
    // 阴影调整: -100 到 +100
    const shadowValue = args.shadows / 100
    // 使用colorlevels调整阴影: rmin/gmin/bmin参数
    const rmin = shadowValue * 0.3
    const gmin = shadowValue * 0.3
    const bmin = shadowValue * 0.3
    filters.push(
      `colorlevels=rmin=${rmin.toFixed(2)}:gmin=${gmin.toFixed(2)}:bmin=${bmin.toFixed(2)}`,
    )
  }

  // 合并所有滤镜
  if (filters.length === 0) {
    return ""
  }

  // 如果有多个滤镜，用逗号连接
  const filterString = filters.join(",")
  // 确保不以逗号开头
  if (filterString.startsWith(",")) {
    return filterString.substring(1)
  }
  return filterString
}

VideoFilterTool.buildFfmpegArgs = (
  args: any,
  filterString: string,
  outputPath: string,
): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]

  // 添加滤镜
  if (filterString) {
    ffmpegArgs.push("-vf", filterString)
  }

  // 编码参数
  if (args.fast) {
    ffmpegArgs.push("-preset", "fast")
  } else {
    ffmpegArgs.push("-preset", "medium")
  }

  // H.264质量参数 (CRF)
  ffmpegArgs.push("-crf", args.quality.toString())

  // 音频设置
  ffmpegArgs.push("-c:a", "aac", "-b:a", "192k")

  // 输出文件
  ffmpegArgs.push("-y", outputPath) // -y 覆盖已存在文件

  return ffmpegArgs
}

VideoFilterTool.getFilterDescription = (args: any): string => {
  const parts: string[] = []

  if (args.preset !== "none") {
    const presetNames: Record<string, string> = {
      vintage: "复古滤镜",
      cinematic: "电影感滤镜",
      dramatic: "戏剧化滤镜",
      warm: "暖色调滤镜",
      cool: "冷色调滤镜",
      blackwhite: "黑白滤镜",
    }
    parts.push(`预设: ${presetNames[args.preset]}`)
  }

  if (args.brightness !== 0)
    parts.push(`亮度: ${args.brightness > 0 ? "+" : ""}${args.brightness}`)
  if (args.contrast !== 0)
    parts.push(`对比度: ${args.contrast > 0 ? "+" : ""}${args.contrast}`)
  if (args.saturation !== 0)
    parts.push(`饱和度: ${args.saturation > 0 ? "+" : ""}${args.saturation}`)
  if (args.hue !== 0) parts.push(`色相: ${args.hue}°`)
  if (args.gamma !== 1) parts.push(`伽马: ${args.gamma}`)
  if (args.exposure !== undefined && args.exposure !== 0)
    parts.push(`曝光: ${args.exposure > 0 ? "+" : ""}${args.exposure}`)
  if (args.sharpen !== undefined && args.sharpen > 0)
    parts.push(`锐化: ${args.sharpen}`)
  if (args.blur !== undefined && args.blur > 0) parts.push(`模糊: ${args.blur}`)
  if (args.glow !== undefined && args.glow > 0) parts.push(`发光: ${args.glow}`)
  if (args.vignette !== undefined && args.vignette > 0)
    parts.push(`暗角: ${args.vignette}`)
  if (args.grain !== undefined && args.grain > 0)
    parts.push(`颗粒: ${args.grain}`)
  if (args.temperature !== undefined && args.temperature !== 0)
    parts.push(`色温: ${args.temperature > 0 ? "+" : ""}${args.temperature}`)
  if (args.tint !== undefined && args.tint !== 0)
    parts.push(`色调: ${args.tint > 0 ? "+" : ""}${args.tint}`)
  if (args.highlights !== undefined && args.highlights !== 0)
    parts.push(`高光: ${args.highlights > 0 ? "+" : ""}${args.highlights}`)
  if (args.shadows !== undefined && args.shadows !== 0)
    parts.push(`阴影: ${args.shadows > 0 ? "+" : ""}${args.shadows}`)

  if (parts.length === 0) {
    return "🔧 使用默认设置 (无滤镜调整)"
  }

  return `🔧 应用滤镜: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const FilterTool = VideoFilterTool

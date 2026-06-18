import { existsSync } from "fs"
import { basename, dirname, extname, join, resolve } from "path"
import path from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { runFfmpeg } from "../../lib/ffmpeg-utils.js"

/**
 * LUT滤镜工具 - 应用查找表(LUT)颜色分级
 *
 * 支持功能:
 * 1. 内置LUT预设: cinematic(电影感), vintage(复古), bw(黑白), cool(冷色调), warm(暖色调), muted(柔和), vivid(鲜艳)
 * 2. 自定义LUT文件: 支持.cube格式
 * 3. 强度控制: 0-100% 的LUT应用强度
 * 4. 混合模式: 支持LUT与原始画面的混合
 *
 * 基于LTX的LUT预设实现，参考ltx-adapter.ts中的lutToFfmpegFilters方法
 */
export const LutFilterTool: any = Tool.define("lut_filter", {
  description: "应用LUT(查找表)颜色分级滤镜，支持内置预设和自定义.cube文件",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_lut.<ext>)"),

    // LUT来源: 预设或自定义文件 (二选一)
    preset: z
      .enum([
        "cinematic",
        "vintage",
        "bw",
        "cool",
        "warm",
        "muted",
        "vivid",
        "none",
      ])
      .optional()
      .default("none")
      .describe(
        "内置LUT预设: cinematic(电影感), vintage(复古), bw(黑白), cool(冷色调), warm(暖色调), muted(柔和), vivid(鲜艳), none(无预设)",
      ),
    lut_file: z
      .string()
      .optional()
      .describe("自定义LUT文件路径 (.cube格式，与preset二选一)"),

    // LUT应用参数
    intensity: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("LUT应用强度 (0-100%，默认 100)"),
    mix: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("LUT混合比例 (0-100%，100=完全使用LUT，0=原始画面，默认 100)"),
    preserve_luminance: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保持亮度 (默认: true)"),

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
      output: "{output_dir}/lut_{timestamp}.mp4",
      preset: "cinematic",
      intensity: 100,
      mix: 100,
      preserve_luminance: true,
      quality: 23,
      fast: false,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "preset 和 lut_file 二选一",
      "preset=none 且无 lut_file 时无效果",
      "preset=none 配合 lut_file 使用自定义 .cube 文件",
      "内置预设: cinematic(电影感)/vintage(复古)/bw(黑白)/cool(冷色调)/warm(暖色调)/muted(柔和)/vivid(鲜艳)",
      "intensity 0-100%，控制 LUT 应用强度",
      "mix 0-100%，100=完全 LUT，0=原始画面，中间值=混合",
      "preserve_luminance=true 保持原始亮度信息",
    ],
  },

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "LUT滤镜应用失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      // 2. 验证LUT来源
      const hasPreset = args.preset !== "none"
      const hasLutFile = args.lut_file && args.lut_file.trim().length > 0

      if (!hasPreset && !hasLutFile) {
        return {
          title: "LUT滤镜应用失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ 必须提供LUT预设(preset)或LUT文件(lut_file)`,
        }
      }

      if (hasPreset && hasLutFile) {
        return {
          title: "LUT滤镜应用失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ 不能同时提供LUT预设(preset)和LUT文件(lut_file)，请选择一种方式`,
        }
      }

      if (hasLutFile && !existsSync(args.lut_file)) {
        return {
          title: "LUT滤镜应用失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ LUT文件不存在: ${args.lut_file}`,
        }
      }

      if (hasLutFile) {
        const lutExt = args.lut_file.toLowerCase().split(".").pop()
        if (lutExt !== "cube") {
          return {
            title: "LUT滤镜应用失败",
            metadata: { operation: "lut_filter", error: true, success: false },
            output: `❌ 不支持的LUT文件格式: ${lutExt}，请使用 .cube 格式`,
          }
        }
      }

let outputPath = args.output
      if (!outputPath) {
        const inputStem = basename(args.input, extname(args.input))
        const lutName = hasPreset ? args.preset : "custom"
        const outputFilename = `${inputStem}_${lutName}_lut.mp4`
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
          metadata: { operation: "lut_filter", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 5. 构建FFmpeg参数
      const ffmpegArgs = LutFilterTool.buildFfmpegArgs(args, finalOutputPath)

      // 6. 执行FFmpeg命令
      console.log(`[LutFilterTool] 应用LUT滤镜到: ${args.input}`)
      if (hasPreset) {
        console.log(
          `[LutFilterTool] 使用内置预设: ${args.preset} (强度: ${args.intensity}%)`,
        )
      } else if (hasLutFile) {
        console.log(
          `[LutFilterTool] 使用LUT文件: ${args.lut_file} (强度: ${args.intensity}%)`,
        )
      }

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 7. 返回结果
      if (result.success) {
        const lutPreset = hasPreset ? args.preset : "custom"
        return {
          title: "LUT滤镜应用成功",
          metadata: {
            operation: "lut_filter",
            success: true,
      undoable: true,
            error: false,
            outputPath: finalOutputPath,
            inputPath: args.input,
            preset: hasPreset ? args.preset : null,
            lutFile: hasLutFile ? args.lut_file : null,
            intensity: args.intensity,
            mix: args.mix,
            preserveLuminance: args.preserve_luminance,
          },
          output: `✅ 已成功应用LUT滤镜到视频\n📁 输出文件: ${finalOutputPath}\n${LutFilterTool.getLutDescription(args)}`,
        }
      } else {
        return {
          title: "LUT滤镜应用失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ LUT滤镜应用失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "LUT滤镜应用错误",
        metadata: { operation: "lut_filter", error: true, success: false },
        output: `❌ LUT滤镜应用过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
LutFilterTool.buildFfmpegArgs = (args: any, outputPath: string): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]
  const hasPreset = args.preset !== "none"
  const hasLutFile = args.lut_file && args.lut_file.trim().length > 0
  const mix = args.mix !== undefined ? args.mix : 100
  const needsBlend = mix < 100 && mix > 0

  // 构建滤镜字符串
  let filterString = ""
  let useFilterComplex = false

  if (hasPreset) {
    const result = LutFilterTool.buildPresetFilter(
      args.preset,
      args.intensity,
      mix,
      args.preserve_luminance,
    )
    filterString = result.filter
    useFilterComplex = result.useFilterComplex
  } else if (hasLutFile) {
    const result = LutFilterTool.buildCubeFilter(
      args.lut_file,
      args.intensity,
      mix,
      args.preserve_luminance,
    )
    filterString = result.filter
    useFilterComplex = result.useFilterComplex
  }

  if (filterString) {
    if (useFilterComplex) {
      // 混合模式：使用 filter_complex 图，split→滤镜→blend
      ffmpegArgs.push(
        "-filter_complex",
        `${filterString};[out]format=yuv420p`,
      )
      ffmpegArgs.push("-map", "[out]")
    } else {
      ffmpegArgs.push("-vf", `${filterString},format=yuv420p`)
    }
  } else {
    ffmpegArgs.push("-vf", "format=yuv420p")
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

LutFilterTool.buildPresetFilter = (
  preset: string,
  intensity: number,
  mix: number,
  preserveLuminance: boolean,
): { filter: string; useFilterComplex: boolean } => {
  // 基于ltx-adapter.ts中的lutToFfmpegFilters方法
  const filters: string[] = []
  const t = intensity / 100 // 0.0 到 1.0
  const m = mix / 100 // 混合比例

  // 混合比例小于100%时使用 filter_complex 做 split→滤镜→blend
  const needsBlend = m < 1.0 && m > 0

  // 根据预设类型构建滤镜
  switch (preset) {
    case "cinematic":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=-${(0.1 * effectiveT).toFixed(2)}:gs=-${(0.1 * effectiveT).toFixed(2)}:bs=${(0.1 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 + 0.1 * effectiveT).toFixed(2)}:saturation=${(1 - 0.15 * effectiveT).toFixed(2)}:brightness=-${(0.05 * effectiveT).toFixed(2)}`,
        )
      }
      break

    case "vintage":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=${(0.15 * effectiveT).toFixed(2)}:gs=-${(0.05 * effectiveT).toFixed(2)}:bs=0`,
        )
        filters.push(
          `eq=contrast=${(1 - 0.1 * effectiveT).toFixed(2)}:saturation=${(1 - 0.2 * effectiveT).toFixed(2)}:brightness=${(0.05 * effectiveT).toFixed(2)}`,
        )
      }
      break

    case "bw":
      if (t > 0) {
        const effectiveT = t
        if (effectiveT >= 1.0) {
          filters.push(`hue=s=0`)
        } else {
          filters.push(`hue=s=${(1 - effectiveT).toFixed(2)}`)
        }
        filters.push(`eq=contrast=${(1 + 0.2 * effectiveT).toFixed(2)}`)
      }
      break

    case "cool":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=-${(0.15 * effectiveT).toFixed(2)}:gs=${(0.05 * effectiveT).toFixed(2)}:bs=${(0.2 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 + 0.05 * effectiveT).toFixed(2)}:saturation=${(1 - 0.1 * effectiveT).toFixed(2)}`,
        )
      }
      break

    case "warm":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=${(0.2 * effectiveT).toFixed(2)}:gs=${(0.1 * effectiveT).toFixed(2)}:bs=-${(0.1 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 + 0.05 * effectiveT).toFixed(2)}:saturation=${(1 + 0.1 * effectiveT).toFixed(2)}`,
        )
      }
      break

    case "muted":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=-${(0.05 * effectiveT).toFixed(2)}:gs=-${(0.05 * effectiveT).toFixed(2)}:bs=-${(0.05 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 - 0.1 * effectiveT).toFixed(2)}:saturation=${(1 - 0.3 * effectiveT).toFixed(2)}:brightness=${(0.05 * effectiveT).toFixed(2)}`,
        )
      }
      break

    case "vivid":
      if (t > 0) {
        const effectiveT = t
        filters.push(
          `colorbalance=rs=${(0.1 * effectiveT).toFixed(2)}:gs=${(0.1 * effectiveT).toFixed(2)}:bs=${(0.1 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 + 0.15 * effectiveT).toFixed(2)}:saturation=${(1 + 0.25 * effectiveT).toFixed(2)}`,
        )
      }
      break
  }

  if (filters.length === 0) {
    return { filter: "", useFilterComplex: false }
  }

  // 需要混合时，使用 filter_complex 做 split→滤镜→blend 实现真正的混合
  if (needsBlend) {
    const lutFilterChain = filters.join(",")
    return {
      filter: `[0:v]split[orig][lut];[lut]${lutFilterChain}[lut_out];[orig][lut_out]blend=all_mode=average:all_opacity=${m.toFixed(2)}`,
      useFilterComplex: true,
    }
  }

  return { filter: filters.join(","), useFilterComplex: false }
}

LutFilterTool.buildCubeFilter = (
  lutFilePath: string,
  intensity: number,
  mix: number,
  preserveLuminance: boolean,
): { filter: string; useFilterComplex: boolean } => {
  // 使用FFmpeg的lut3d滤镜应用.cube文件

  // 转义文件路径，处理Windows反斜杠
  let escapedPath = lutFilePath.replace(/\\/g, "/").replace(/'/g, "'\\''")

  // 如果路径包含空格，需要引号
  if (escapedPath.includes(" ")) {
    escapedPath = `'${escapedPath}'`
  }

  const t = intensity / 100
  const m = mix / 100

  if (t <= 0) {
    return { filter: "", useFilterComplex: false }
  }

  if (m >= 1.0) {
    // 完全应用LUT —— 简单滤镜链
    return {
      filter: `lut3d=file='${escapedPath}':interp=tetrahedral`,
      useFilterComplex: false,
    }
  }

  // 混合LUT和原始画面：filter_complex split→lut3d→blend
  return {
    filter: `[0:v]split[orig][lut];[lut]lut3d=file='${escapedPath}':interp=tetrahedral[lut_out];[orig][lut_out]blend=all_mode=average:all_opacity=${m.toFixed(2)}`,
    useFilterComplex: true,
  }
}

LutFilterTool.getLutDescription = (args: any): string => {
  const parts: string[] = []

  if (args.preset !== "none") {
    const presetNames: Record<string, string> = {
      cinematic: "电影感 LUT",
      vintage: "复古 LUT",
      bw: "黑白 LUT",
      cool: "冷色调 LUT",
      warm: "暖色调 LUT",
      muted: "柔和 LUT",
      vivid: "鲜艳 LUT",
    }
    parts.push(`预设: ${presetNames[args.preset]}`)
  } else if (args.lut_file) {
    const fileName =
      args.lut_file.split("/").pop()?.split("\\").pop() || "自定义LUT"
    parts.push(`文件: ${fileName}`)
  }

  if (args.intensity !== 100) {
    parts.push(`强度: ${args.intensity}%`)
  }

  if (args.mix !== 100) {
    parts.push(`混合: ${args.mix}%`)
  }

  if (args.preserve_luminance) {
    parts.push(`保持亮度`)
  }

  if (parts.length === 0) {
    return "🎨 使用默认LUT设置"
  }

  return `🎨 LUT设置: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const LutTool = LutFilterTool

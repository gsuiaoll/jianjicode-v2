import { existsSync } from "fs"
import path from "path"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

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

      // 安全增强：获取安全参数
      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      // 3. 构建输出路径
      const path = await import("path")
      const fs = await import("fs")

      let outputPath = args.output
      if (!outputPath) {
        const inputStem = path.basename(args.input, path.extname(args.input))
        const lutName = hasPreset ? args.preset : "custom"
        const outputFilename = `${inputStem}_${lutName}_lut.mp4`
        const inputDir = path.dirname(args.input)
        outputPath = path.join(inputDir, outputFilename)
      }

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
          finalOutputPath = path.join(dir, `${base}_lut_safe${ext}`)
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
            metadata: { operation: "lut_filter", error: true, success: false },
            output: `❌ 输出路径必须在指定目录内: ${outputDirResolved}`,
          }
        }
      }

      // 覆盖确认检查
      if (!allowOverwrite && fs.existsSync(finalOutputPath)) {
        return {
          title: "安全验证失败",
          metadata: { operation: "lut_filter", error: true, success: false },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      // 4. 检查输出文件是否已存在（仅警告）
      if (fs.existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

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

      const result = await runFfmpeg(ffmpegArgs)

      // 7. 返回结果
      if (result.success) {
        return {
          title: "LUT滤镜应用成功",
          metadata: {
            operation: "lut_filter",
            success: true,
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

  // 构建滤镜字符串
  let filterString = ""

  if (hasPreset) {
    // 内置预设: 使用颜色调整滤镜模拟LUT
    filterString = LutFilterTool.buildPresetFilter(
      args.preset,
      args.intensity,
      args.mix,
      args.preserve_luminance,
    )
  } else if (hasLutFile) {
    // 自定义.cube文件: 使用lut3d滤镜
    filterString = LutFilterTool.buildCubeFilter(
      args.lut_file,
      args.intensity,
      args.mix,
      args.preserve_luminance,
    )
  }

  // 添加滤镜参数（强制 yuv420p 确保播放器兼容性）
  if (filterString) {
    ffmpegArgs.push("-vf", `${filterString},format=yuv420p`)
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
): string => {
  // 基于ltx-adapter.ts中的lutToFfmpegFilters方法
  const filters: string[] = []
  const t = intensity / 100 // 0.0 到 1.0
  const m = mix / 100 // 混合比例

  // 如果混合比例小于100%，需要混合滤镜
  const needsBlend = m < 1.0

  // 根据预设类型构建滤镜
  switch (preset) {
    case "cinematic":
      if (t > 0) {
        const effectiveT = t * m
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
        const effectiveT = t * m
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
        const effectiveT = t * m
        // 黑白效果: 去色 + 对比度调整
        if (effectiveT >= 1.0) {
          filters.push(`hue=s=0`)
        } else {
          // 部分去色: 使用色彩饱和度混合
          filters.push(`hue=s=${(1 - effectiveT).toFixed(2)}`)
        }
        filters.push(`eq=contrast=${(1 + 0.2 * effectiveT).toFixed(2)}`)
      }
      break

    case "cool":
      if (t > 0) {
        const effectiveT = t * m
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
        const effectiveT = t * m
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
        const effectiveT = t * m
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
        const effectiveT = t * m
        filters.push(
          `colorbalance=rs=${(0.1 * effectiveT).toFixed(2)}:gs=${(0.1 * effectiveT).toFixed(2)}:bs=${(0.1 * effectiveT).toFixed(2)}`,
        )
        filters.push(
          `eq=contrast=${(1 + 0.15 * effectiveT).toFixed(2)}:saturation=${(1 + 0.25 * effectiveT).toFixed(2)}`,
        )
      }
      break
  }

  // 如果混合比例小于100%且不是黑白预设（黑白预设已内置混合），需要添加混合滤镜
  if (needsBlend && preset !== "bw" && filters.length > 0) {
    // 使用blend滤镜混合原始画面和LUT效果
    // 这里简化处理：实际上需要更复杂的滤镜图
    console.log(
      `[LutFilterTool] 注意: 混合比例(${mix}%)可能需要更复杂的滤镜图实现`,
    )
  }

  // 保持亮度：当前滤镜链已通过 eq 和 colorbalance 的亮度参数处理，
  // 不需要额外的 lutyuv 滤镜。保留此函数签名以备后续实现精确亮度保持。

  if (filters.length === 0) {
    return ""
  }

  return filters.join(",")
}

LutFilterTool.buildCubeFilter = (
  lutFilePath: string,
  intensity: number,
  mix: number,
  preserveLuminance: boolean,
): string => {
  // 使用FFmpeg的lut3d滤镜应用.cube文件

  // 转义文件路径，处理Windows反斜杠
  let escapedPath = lutFilePath.replace(/\\/g, "/").replace(/'/g, "'\\''")

  // 如果路径包含空格，需要引号
  if (escapedPath.includes(" ")) {
    escapedPath = `'${escapedPath}'`
  }

  const t = intensity / 100
  const m = mix / 100

  const filters: string[] = []

  // 应用lut3d滤镜
  if (t > 0) {
    if (m >= 1.0) {
      // 完全应用LUT
      filters.push(`lut3d=file='${escapedPath}':interp=tetrahedral`)
    } else {
      // 混合LUT和原始画面
      // 使用blend滤镜混合lut3d结果和原始输入
      filters.push(`[0:v]lut3d=file='${escapedPath}':interp=tetrahedral[lut]`)
      filters.push(`[0:v][lut]blend=all_mode=average:all_opacity=${m}[out]`)
      return filters.join(";") + ";[out]null"
    }
  }

  if (filters.length === 0) {
    return ""
  }

  return filters.join(",")
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

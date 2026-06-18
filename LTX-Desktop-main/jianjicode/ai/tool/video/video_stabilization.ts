import { existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 视频稳定工具 - 使用 FFmpeg deshake 滤镜减少视频抖动
 *
 * 使用块匹配算法检测并补偿相机抖动，单次处理无需临时文件。
 * 内部回退链：deshake → vidstab 双通道（备选，需要文件 I/O）
 */
export const VideoStabilizationTool: any = Tool.define("video_stabilization", {
  description: "应用视频稳定效果，减少相机抖动和晃动",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_stabilized.<ext>)"),

    // 稳定参数
    strength: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("稳定强度 (0-100，越高越稳定但可能损失更多画面，默认 50)"),
    smoothing: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(10)
      .describe("平滑帧数 (1-100，越高越平滑但可能有延迟，默认 10)"),
    zoom: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("自动缩放百分比 (0-100，0=无缩放，正数=放大填充空白，默认 0)"),
    optalgo: z
      .enum(["gauss", "avg"])
      .optional()
      .default("gauss")
      .describe("优化算法: gauss(高斯加权), avg(平均，更快但质量较低)"),
    maxshift: z
      .number()
      .min(-1)
      .max(1000)
      .optional()
      .default(-1)
      .describe("最大像素位移 (-1=自动，0-1000=限制最大位移，防止过度裁剪)"),
    maxangle: z
      .number()
      .min(-1)
      .max(360)
      .optional()
      .default(-1)
      .describe("最大旋转角度 (-1=自动，0-360=限制最大旋转)"),

    // 边界处理选项
    crop: z
      .enum(["keep", "black", "mirror", "stretch"])
      .optional()
      .default("keep")
      .describe(
        "边界处理方式: keep(保持原尺寸，可能显示黑边), black(填充黑色), mirror(镜像边缘), stretch(拉伸边缘)",
      ),
    invert: z
      .boolean()
      .optional()
      .default(false)
      .describe("反转稳定 (故意添加抖动，用于测试)"),
    relative: z
      .boolean()
      .optional()
      .default(true)
      .describe("使用相对变换 (true) 或绝对变换 (false)，默认 true"),
    virtualtripod: z
      .boolean()
      .optional()
      .default(false)
      .describe("虚拟三脚架模式，假设相机有固定点，默认 false"),

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
    analyze_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("仅分析视频生成稳定数据，不应用稳定 (用于调试)"),

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
          title: "视频稳定失败",
          metadata: {
            operation: "video_stabilization",
            error: true,
            success: false,
          },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      // 安全增强：获取安全参数
      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      // 2. 构建输出路径
      const path = await import("path")
      const fs = await import("fs")

      let outputPath = args.output
      if (!outputPath) {
        const inputStem = path.basename(args.input, path.extname(args.input))
        const outputFilename = `${inputStem}_stabilized.mp4`
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
          finalOutputPath = path.join(dir, `${base}_stabilized_safe${ext}`)
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
              operation: "video_stabilization",
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
          metadata: {
            operation: "video_stabilization",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      // 3. 检查输出文件是否已存在（仅警告）
      if (fs.existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      console.log(`[VideoStabilizationTool] 应用视频稳定到: ${args.input}`)
      console.log(
        `[VideoStabilizationTool] 强度: ${args.strength}%, 平滑: ${args.smoothing}帧`,
      )
      if (args.zoom > 0) {
        console.log(`[VideoStabilizationTool] 自动缩放: ${args.zoom}%`)
      }

      // 编码参数
      const preset = args.fast ? "fast" : "medium"
      const crf = args.quality.toString()

      // ── Pass 1: deshake（块匹配算法，无需临时文件） ──
      console.log(`[VideoStabilizationTool] 方法: deshake（块匹配稳定）`)
      const deshakeFilter = VideoStabilizationTool.buildDeshakeFilter(args)
      const deshakeArgs = [
        "-i", args.input,
        "-vf", deshakeFilter,
        "-preset", preset,
        "-crf", crf,
        "-c:a", "copy",
        "-y", finalOutputPath,
      ]
      const deshakeResult = await runFfmpeg(deshakeArgs)

      if (deshakeResult.success) {
        return {
          title: "视频稳定成功",
          metadata: {
            operation: "video_stabilization",
            success: true,
            error: false,
            outputPath: finalOutputPath,
            inputPath: args.input,
            method: "deshake",
            strength: args.strength,
            smoothing: args.smoothing,
          },
          output: `✅ 已成功应用视频稳定效果 (deshake)\n📁 输出文件: ${finalOutputPath}\n📹 强度: ${args.strength}%, 平滑: ${args.smoothing}帧, 边界: ${args.crop}`,
        }
      }

      // ── Pass 2: vidstab 双通道回退 ──
      console.log(`[VideoStabilizationTool] deshake 失败，回退 vidstab...`)
      const os = await import("os")
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vidstab-"))
      const transformsFile = path.join(tempDir, "transforms.trf")
      // Windows 路径转义：滤镜参数用 : 分隔，需转义路径中的 :
      const escapedTrf = transformsFile.replace(/\\/g, "/").replace(/:/g, "\\:")

      const detectFilter = VideoStabilizationTool.buildDetectFilter(args, escapedTrf)
      const detectArgs = ["-i", args.input, "-vf", detectFilter, "-f", "null", "-"]
      await runFfmpeg(detectArgs) // 忽略 detect 返回值，直接尝试 transform

      const transformFilter = VideoStabilizationTool.buildTransformFilter(args, escapedTrf)
      const transformArgs = [
        "-i", args.input,
        "-vf", transformFilter,
        "-preset", preset,
        "-crf", crf,
        "-c:a", "copy",
        "-y", finalOutputPath,
      ]
      const vidstabResult = await runFfmpeg(transformArgs)

      // 清理临时文件
      try { fs.existsSync(transformsFile) && fs.unlinkSync(transformsFile); fs.rmdirSync(tempDir) } catch {}

      if (vidstabResult.success) {
        return {
          title: "视频稳定成功",
          metadata: { operation: "video_stabilization", success: true, error: false, outputPath: finalOutputPath, inputPath: args.input, method: "vidstab" },
          output: `✅ 已成功应用视频稳定效果 (vidstab)\n📁 输出文件: ${finalOutputPath}`,
        }
      }

      // 全部失败
      return {
        title: "视频稳定失败",
        metadata: { operation: "video_stabilization", error: true, success: false },
        output: `❌ 视频稳定失败: deshake 和 vidstab 均无法完成`,
      }
	    } catch (error: any) {
	      return {
	        title: "视频稳定错误",
	        metadata: {
	          operation: "video_stabilization",
	          error: true,
	          success: false,
	        },
	        output: `❌ 视频稳定过程中发生错误: ${error.message}`,
	      }
	    }
	  },
	})

	// ── deshake 滤镜构建 ──

	VideoStabilizationTool.buildDeshakeFilter = (args: any): string => {
	  const params: string[] = []

	  // 强度 → rx/ry 最大位移（强度越高，允许的位移越小）
	  // deshake 要求 rx/ry 必须是 16 的倍数
	  // strength 0-100，映射到 rx/ry 64-16
	  const rawMotion = 64 - (args.strength / 100) * 48
	  const maxMotion = Math.max(16, Math.round(rawMotion / 16) * 16)
	  params.push(`rx=${maxMotion}`, `ry=${maxMotion}`)

	  // 平滑 → blocksize（块越大越平滑但精度越低）
	  // smoothing 1-100，映射到 blocksize 4-32（2的幂）
	  const blockSizes = [4, 8, 16, 32]
	  const rawBs = 4 + (args.smoothing / 100) * 28
	  const blockSize = blockSizes.reduce((a, b) =>
	    Math.abs(b - rawBs) < Math.abs(a - rawBs) ? b : a
	  )
	  params.push(`blocksize=${blockSize}`)

	  // 边界处理 → edge
	  const edgeMap: Record<string, string> = {
	    keep: "blank",   // 保持原尺寸，露出黑边
	    black: "blank",  // 黑边
	    mirror: "mirror", // 镜像边缘
	    stretch: "clamp", // 拉伸最接近的选项
	  }
	  params.push(`edge=${edgeMap[args.crop] || "blank"}`)

	  // 如果要求缩放，添加 zoom
	  if (args.zoom > 0) {
	    const zoomFactor = 1 + args.zoom / 100
	    params.push(`zoom=${zoomFactor.toFixed(2)}`)
	  }

	  return "deshake=" + params.join(":")
	}

	// ── vidstab 滤镜构建（备选方案） ──

// 扩展工具类的方法

VideoStabilizationTool.buildDetectFilter = (
  args: any,
  transformsFile: string,
): string => {
  const params: string[] = []

  // vidstabdetect参数
  // vidstabdetect filter name prepended in return
  params.push(`result=${transformsFile}`)

  // 强度参数 (0-1.0, 默认0.5)
  const strength = args.strength / 100 // 转换为0-1.0
  params.push(
    `shakiness=${Math.max(1, Math.min(10, Math.round(strength * 10)))}`,
  )

  // 精度 (1-15)
  params.push(`accuracy=15`)

  // 步长 (搜索半径)
  params.push(`stepsize=6`)

  // 最小对比度 (0-1)
  params.push(`mincontrast=0.3`)

  // 显示特征点 (调试用)
  if (args.analyze_only) {
    params.push(`show=2`) // 2=显示特征点和轨迹
  }

  // 三脚架模式
  if (args.virtualtripod) {
    params.push(`tripod=1`)
  }

  return "vidstabdetect=" + params.join(":")
}

VideoStabilizationTool.buildTransformFilter = (
  args: any,
  transformsFile: string,
): string => {
  const params: string[] = []

  // vidstabtransform参数
  // vidstabtransform filter name prepended in return
  params.push(`input=${transformsFile}`)

  // 平滑帧数 (必须为奇数)
  let smoothing = Math.max(1, args.smoothing)
  if (smoothing % 2 === 0) smoothing++ // 确保奇数
  params.push(`smoothing=${smoothing}`)

  // 优化算法
  params.push(`optalgo=${args.optalgo}`)

  // 最大位移限制
  if (args.maxshift !== -1) {
    params.push(`maxshift=${args.maxshift}`)
  }

  // 最大角度限制
  if (args.maxangle !== -1) {
    params.push(`maxangle=${args.maxangle}`)
  }

  // 缩放参数
  if (args.zoom > 0) {
    const zoom = args.zoom / 100 // 转换为0-1.0
    params.push(`zoom=${zoom}`)
    params.push(`optzoom=1`) // 1=保持缩放，2=禁用缩放
  } else {
    params.push(`optzoom=0`) // 0=不缩放
  }

  // 边界处理
  switch (args.crop) {
    case "black":
      params.push(`fillborders=black`)
      break
    case "mirror":
      params.push(`fillborders=mirror`)
      break
    case "stretch":
      params.push(`fillborders=stretch`)
      break
    // 'keep' 默认不添加额外处理
  }

  // 相对/绝对变换
  if (!args.relative) {
    params.push(`relative=0`)
  }

  // 反转稳定
  if (args.invert) {
    params.push(`invert=1`)
  }

  // 三脚架模式
  if (args.virtualtripod) {
    params.push(`tripod=1`)
  }

  // 调试模式
  if (args.analyze_only) {
    params.push(`show=1`) // 1=显示变换向量
  }

  return "vidstabtransform=" + params.join(":")
}

VideoStabilizationTool.getStabilizationDescription = (args: any): string => {
  const parts: string[] = []

  parts.push(`强度: ${args.strength}%`)
  parts.push(`平滑: ${args.smoothing}帧`)

  if (args.zoom > 0) {
    parts.push(`缩放: ${args.zoom}%`)
  }

  const cropNames: Record<string, string> = {
    keep: "保持原尺寸",
    black: "填充黑色",
    mirror: "镜像边缘",
    stretch: "拉伸边缘",
  }
  parts.push(`边界: ${cropNames[args.crop]}`)

  if (args.optalgo !== "gauss") {
    parts.push(`算法: ${args.optalgo}`)
  }

  if (args.virtualtripod) {
    parts.push(`三脚架模式`)
  }

  if (args.analyze_only) {
    parts.push(`仅分析`)
  }

  return `📹 稳定设置: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const StabilizationTool = VideoStabilizationTool

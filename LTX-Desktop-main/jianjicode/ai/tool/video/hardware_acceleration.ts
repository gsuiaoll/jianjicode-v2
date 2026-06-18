import { existsSync } from "fs"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 硬件加速编码工具 - 检测和配置硬件加速编码选项
 *
 * 支持功能:
 * 1. 检测可用的硬件加速编码器
 * 2. 提供硬件加速编码参数预设
 * 3. 测试硬件加速编码性能
 * 4. 生成硬件加速FFmpeg命令参数
 *
 * 支持的硬件加速平台:
 * - NVIDIA NVENC (Windows/Linux)
 * - AMD AMF (Windows/Linux)
 * - Intel QSV (Windows/Linux)
 * - VideoToolbox (macOS)
 * - VAAPI (Linux)
 * - DXVA2 (Windows)
 */
export const HardwareAccelerationTool: any = Tool.define(
  "hardware_acceleration",
  {
    description: "检测和配置硬件加速编码选项，提升视频处理性能",
    parameters: z.object({
      // 检测选项
      detect: z
        .boolean()
        .optional()
        .default(true)
        .describe("检测可用硬件加速编码器 (默认: true)"),
      test: z
        .boolean()
        .optional()
        .default(false)
        .describe("运行硬件加速编码测试 (默认: false)"),
      test_input: z
        .string()
        .optional()
        .describe("测试用输入文件路径 (可选，默认使用内置测试模式)"),

      // 硬件加速配置
      hwaccel: z
        .enum([
          "none",
          "auto",
          "cuda",
          "dxva2",
          "qsv",
          "vaapi",
          "videotoolbox",
          "amf",
        ])
        .optional()
        .default("auto")
        .describe(
          "硬件加速方法: none(禁用), auto(自动选择), cuda(NVIDIA CUDA), dxva2(Windows DXVA2), qsv(Intel Quick Sync), vaapi(Linux VAAPI), videotoolbox(macOS), amd(AMD AMF)",
        ),
      hwaccel_device: z
        .string()
        .optional()
        .describe("硬件加速设备路径或索引 (如 /dev/dri/renderD128)"),
      encoder: z
        .enum([
          "auto",
          "h264_nvenc",
          "hevc_nvenc",
          "h264_qsv",
          "hevc_qsv",
          "h264_amf",
          "hevc_amf",
          "h264_videotoolbox",
          "hevc_videotoolbox",
          "h264_vaapi",
          "hevc_vaapi",
        ])
        .optional()
        .default("auto")
        .describe(
          "硬件加速编码器: auto(自动选择), h264_nvenc(NVIDIA H.264), hevc_nvenc(NVIDIA HEVC), h264_qsv(Intel H.264), hevc_qsv(Intel HEVC), h264_amf(AMD H.264), hevc_amf(AMD HEVC), h264_videotoolbox(macOS H.264), hevc_videotoolbox(macOS HEVC), h264_vaapi(Linux H.264), hevc_vaapi(Linux HEVC)",
        ),
      preset: z
        .enum([
          "fastest",
          "fast",
          "medium",
          "slow",
          "slowest",
          "lossless",
          "p1",
          "p2",
          "p3",
          "p4",
          "p5",
          "p6",
          "p7",
        ])
        .optional()
        .default("medium")
        .describe(
          "硬件加速编码预设: fastest(最快), fast(快速), medium(中等), slow(慢速), slowest(最慢), lossless(无损), p1-p7(NVENC预设)",
        ),

      // 编码参数
      quality: z
        .number()
        .min(0)
        .max(51)
        .optional()
        .default(23)
        .describe("输出质量 (0-51 CRF值，越低质量越好，默认 23)"),
      bitrate: z
        .string()
        .optional()
        .describe("目标比特率 (如 5M, 10M, 默认自动)"),
      max_bitrate: z.string().optional().describe("最大比特率 (如 8M, 12M)"),
      buffer_size: z
        .string()
        .optional()
        .describe("编码缓冲区大小 (如 16M, 24M)"),

      // 性能选项
      threads: z
        .number()
        .min(0)
        .max(64)
        .optional()
        .default(0)
        .describe("编码线程数 (0=自动，默认 0)"),
      gpu_index: z
        .number()
        .min(0)
        .max(16)
        .optional()
        .default(0)
        .describe("GPU设备索引 (多GPU系统，默认 0)"),

      // 输出选项
      generate_command: z
        .boolean()
        .optional()
        .default(false)
        .describe("生成示例FFmpeg命令而不是执行编码 (默认: false)"),
      output: z
        .string()
        .optional()
        .describe("测试输出文件路径 (仅测试模式使用)"),

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
        // 如果启用了测试模式，验证输入文件
        if (args.test && args.test_input && !existsSync(args.test_input)) {
          return {
            title: "硬件加速测试失败",
            metadata: {
              operation: "hardware_acceleration",
              error: true,
              success: false,
            },
            output: `❌ 测试输入文件不存在: ${args.test_input}`,
          }
        }

        // 安全增强：获取安全参数
        const allowOverwrite =
          args.allow_overwrite !== undefined ? args.allow_overwrite : false
        const protectOriginals =
          args.protect_originals !== undefined ? args.protect_originals : true
        const outputDir = args.output_dir

        // 构建输出路径（如果需要）
        let finalOutputPath = args.output
        if (args.test && args.output) {
          const path = await import("path")
          const fs = await import("fs")

          let outputPath = args.output
          if (!outputPath) {
            const inputStem = args.test_input
              ? path.basename(args.test_input, path.extname(args.test_input))
              : "test"
            const outputFilename = `${inputStem}_hwaccel_test.mp4`
            outputPath = outputFilename
          }

          finalOutputPath = outputPath

          // 保护原文件检查
          if (protectOriginals && args.test_input) {
            const inputResolved = path.resolve(args.test_input)
            const outputResolved = path.resolve(outputPath)
            if (outputResolved === inputResolved) {
              // 自动修改输出文件名，添加 _safe 后缀
              const ext = path.extname(args.test_input)
              const base = path.basename(args.test_input, ext)
              const dir = path.dirname(args.test_input)
              finalOutputPath = path.join(dir, `${base}_hwaccel_safe${ext}`)
              console.log(
                `[安全增强] 原文件保护已启用，自动修改输出路径为: ${finalOutputPath}`,
              )
            }
          }

          // 输出目录限制检查
          if (outputDir && outputDir.trim()) {
            const outputDirResolved = path.resolve(outputDir)
            const outputPathResolved = path.resolve(finalOutputPath)
            const relative = path.relative(
              outputDirResolved,
              outputPathResolved,
            )
            if (relative.startsWith("..") || path.isAbsolute(relative)) {
              return {
                title: "安全验证失败",
                metadata: {
                  operation: "hardware_acceleration",
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
                operation: "hardware_acceleration",
                error: true,
                success: false,
              },
              output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
            }
          }

          // 检查输出文件是否已存在（仅警告）
          if (fs.existsSync(finalOutputPath)) {
            console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
          }
        }

        // 1. 检测可用硬件加速编码器
        let detectionResults = null
        if (args.detect) {
          console.log(`[HardwareAccelerationTool] 检测硬件加速编码器...`)
          detectionResults =
            await HardwareAccelerationTool.detectHardwareAcceleration()
        }

        // 2. 运行硬件加速测试（如果启用）
        let testResults = null
        if (args.test) {
          console.log(`[HardwareAccelerationTool] 运行硬件加速编码测试...`)
          testResults = await HardwareAccelerationTool.runAccelerationTest(
            args,
            finalOutputPath,
          )
        }

        // 3. 生成FFmpeg命令参数（如果启用）
        let commandExample = ""
        if (args.generate_command || args.test) {
          commandExample = HardwareAccelerationTool.generateFfmpegCommand(
            args,
            args.test_input || "input.mp4",
            finalOutputPath || "output.mp4",
          )
        }

        // 4. 返回结果
        const outputSections: string[] = []

        if (detectionResults) {
          outputSections.push(`🔍 硬件加速检测结果:\n${detectionResults}`)
        }

        if (testResults) {
          outputSections.push(`🧪 硬件加速测试结果:\n${testResults}`)
        }

        if (commandExample) {
          outputSections.push(
            `💻 示例FFmpeg命令:\n\`\`\`bash\n${commandExample}\n\`\`\``,
          )
        }

        const recommendations = HardwareAccelerationTool.getRecommendations(
          args,
          detectionResults,
        )

        if (recommendations) {
          outputSections.push(`💡 推荐配置:\n${recommendations}`)
        }

        return {
          title: "硬件加速配置完成",
          metadata: {
            operation: "hardware_acceleration",
            success: true,
            error: false,
            detected: detectionResults !== null,
            tested: testResults !== null,
            hwaccel: args.hwaccel,
            encoder: args.encoder,
            preset: args.preset,
          },
          output: `✅ 硬件加速配置完成\n${outputSections.join("\n\n")}`,
        }
      } catch (error: any) {
        return {
          title: "硬件加速配置错误",
          metadata: {
            operation: "hardware_acceleration",
            error: true,
            success: false,
          },
          output: `❌ 硬件加速配置过程中发生错误: ${error.message}`,
        }
      }
    },
  },
)

// 扩展工具类的方法
HardwareAccelerationTool.detectHardwareAcceleration =
  async (): Promise<string> => {
    const results: string[] = []
    const encodersToCheck = [
      "h264_nvenc",
      "hevc_nvenc",
      "h264_qsv",
      "hevc_qsv",
      "h264_amf",
      "hevc_amf",
      "h264_videotoolbox",
      "hevc_videotoolbox",
      "h264_vaapi",
      "hevc_vaapi",
    ]

    // 运行ffmpeg -encoders命令获取编码器列表
    try {
      const encoderArgs = ["-encoders"]
      const encoderResult = await runFfmpeg(encoderArgs)

      if (encoderResult.success && encoderResult.output) {
        const encoderOutput = encoderResult.output.toLowerCase()

        // 检查每个硬件编码器
        for (const encoder of encodersToCheck) {
          if (encoderOutput.includes(encoder)) {
            const friendlyName =
              HardwareAccelerationTool.getEncoderFriendlyName(encoder)
            results.push(`✅ ${friendlyName} (${encoder}) 可用`)
          }
        }

        // 检查硬件加速设备
        const hwaccelArgs = ["-hwaccels"]
        const hwaccelResult = await runFfmpeg(hwaccelArgs)

        if (hwaccelResult.success && hwaccelResult.output) {
          const hwaccelOutput = hwaccelResult.output.toLowerCase()
          const hwaccelTypes = [
            "cuda",
            "dxva2",
            "qsv",
            "vaapi",
            "videotoolbox",
            "amf",
            "opencl",
            "vulkan",
          ]

          for (const hwaccel of hwaccelTypes) {
            if (hwaccelOutput.includes(hwaccel)) {
              results.push(`✅ 硬件加速类型 ${hwaccel.toUpperCase()} 可用`)
            }
          }
        }
      }

      if (results.length === 0) {
        results.push(
          "⚠️ 未检测到硬件加速编码器，请确保FFmpeg已正确编译并包含硬件加速支持",
        )
        results.push(
          "ℹ️ 尝试运行: ffmpeg -hwaccels 和 ffmpeg -encoders 查看支持情况",
        )
      }
    } catch (error: any) {
      results.push(`❌ 检测失败: ${error.message}`)
    }

    return results.join("\n")
  }

HardwareAccelerationTool.runAccelerationTest = async (
  args: any,
  outputPath: string,
): Promise<string> => {
  const results: string[] = []

  // 如果没有测试输入，使用生成测试模式
  let testInput = args.test_input
  let usingGeneratedTest = false

  if (!testInput) {
    // 生成简单的测试视频
    console.log(`[HardwareAccelerationTool] 生成测试视频...`)
    testInput = await HardwareAccelerationTool.generateTestVideo()
    usingGeneratedTest = true
  }

  if (!testInput) {
    return "❌ 无法创建测试输入，跳过硬件加速测试"
  }

  // 构建硬件加速编码命令
  const ffmpegArgs = HardwareAccelerationTool.buildHwAccelArgs(
    args,
    testInput,
    outputPath,
  )

  console.log(`[HardwareAccelerationTool] 运行硬件加速编码测试...`)
  const startTime = Date.now()
  const result = await runFfmpeg(ffmpegArgs)
  const endTime = Date.now()
  const duration = (endTime - startTime) / 1000 // 秒

  if (result.success) {
    results.push(`✅ 硬件加速编码测试成功`)
    results.push(`⏱️ 编码时间: ${duration.toFixed(2)} 秒`)

    // 获取输出文件大小
    const fs = await import("fs")
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath)
      const fileSizeMB = stats.size / (1024 * 1024)
      results.push(`📁 输出文件大小: ${fileSizeMB.toFixed(2)} MB`)

      // 计算比特率（近似）
      // 需要获取视频时长，这里简化处理
      results.push(
        `⚡ 使用编码器: ${args.encoder === "auto" ? "自动选择" : args.encoder}`,
      )
      results.push(`⚙️ 使用预设: ${args.preset}`)
    }

    // 清理生成的测试文件
    if (usingGeneratedTest && testInput && fs.existsSync(testInput)) {
      fs.unlinkSync(testInput)
    }
  } else {
    results.push(`❌ 硬件加速编码测试失败`)
    results.push(`💡 错误信息: ${result.error || "未知错误"}`)
    results.push(`💡 尝试禁用硬件加速或使用不同的编码器`)
  }

  return results.join("\n")
}

HardwareAccelerationTool.generateTestVideo = async (): Promise<
  string | null
> => {
  // 生成简单的测试视频用于硬件加速测试
  const os = await import("os")
  const fs = await import("fs")
  const path = await import("path")

  const tempDir = os.tmpdir()
  const testVideoPath = path.join(tempDir, `hwaccel_test_${Date.now()}.mp4`)

  // 使用FFmpeg生成测试视频（10秒，1280x720，30fps）
  const testArgs = [
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=10:size=1280x720:rate=30",
    "-c:v",
    "libx264",
    "-crf",
    "23",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    "-y",
    testVideoPath,
  ]

  const result = await runFfmpeg(testArgs)
  if (result.success && fs.existsSync(testVideoPath)) {
    return testVideoPath
  }

  return null
}

HardwareAccelerationTool.buildHwAccelArgs = (
  args: any,
  inputPath: string,
  outputPath: string,
): string[] => {
  const ffmpegArgs: string[] = []

  // 添加硬件加速方法
  if (args.hwaccel !== "none" && args.hwaccel !== "auto") {
    ffmpegArgs.push("-hwaccel", args.hwaccel)
  }

  // 添加硬件加速设备（如果指定）
  if (args.hwaccel_device) {
    ffmpegArgs.push("-hwaccel_device", args.hwaccel_device)
  }

  // 输入文件
  ffmpegArgs.push("-i", inputPath)

  // 自动选择编码器（如果设置为auto）
  let encoder = args.encoder
  if (encoder === "auto") {
    encoder = HardwareAccelerationTool.autoSelectEncoder(args.hwaccel)
  }

  // 视频编码器参数
  ffmpegArgs.push("-c:v", encoder)

  // 编码器预设
  if (encoder.includes("nvenc")) {
    // NVENC预设
    ffmpegArgs.push("-preset", args.preset)
    ffmpegArgs.push("-cq", args.quality.toString())
  } else if (encoder.includes("qsv")) {
    // QSV预设
    ffmpegArgs.push("-preset", args.preset)
    ffmpegArgs.push("-q", args.quality.toString())
  } else if (encoder.includes("amf")) {
    // AMF预设
    ffmpegArgs.push("-quality", args.preset)
    ffmpegArgs.push("-qp_i", args.quality.toString())
    ffmpegArgs.push("-qp_p", args.quality.toString())
  } else {
    // 通用参数
    ffmpegArgs.push("-crf", args.quality.toString())
  }

  // 比特率控制（如果指定）
  if (args.bitrate) {
    ffmpegArgs.push("-b:v", args.bitrate)
  }
  if (args.max_bitrate) {
    ffmpegArgs.push("-maxrate", args.max_bitrate)
  }
  if (args.buffer_size) {
    ffmpegArgs.push("-bufsize", args.buffer_size)
  }

  // 线程数
  if (args.threads > 0) {
    ffmpegArgs.push("-threads", args.threads.toString())
  }

  // GPU索引（仅限某些编码器）
  if (args.gpu_index > 0) {
    if (encoder.includes("nvenc")) {
      ffmpegArgs.push("-gpu", args.gpu_index.toString())
    }
  }

  // 音频编码（复制）
  ffmpegArgs.push("-c:a", "copy")

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

HardwareAccelerationTool.generateFfmpegCommand = (
  args: any,
  inputPath: string,
  outputPath: string,
): string => {
  const argsArray = HardwareAccelerationTool.buildHwAccelArgs(
    args,
    inputPath,
    outputPath,
  )
  return `ffmpeg ${argsArray.join(" ")}`
}

HardwareAccelerationTool.autoSelectEncoder = (hwaccel: string): string => {
  // 根据硬件加速方法自动选择编码器
  switch (hwaccel) {
    case "cuda":
      return "h264_nvenc"
    case "qsv":
      return "h264_qsv"
    case "vaapi":
      return "h264_vaapi"
    case "videotoolbox":
      return "h264_videotoolbox"
    case "amf":
      return "h264_amf"
    case "dxva2":
    default:
      // 尝试检测最佳编码器
      return "h264_nvenc" // 默认回退到NVENC
  }
}

HardwareAccelerationTool.getEncoderFriendlyName = (encoder: string): string => {
  const encoderNames: Record<string, string> = {
    h264_nvenc: "NVIDIA H.264 NVENC",
    hevc_nvenc: "NVIDIA HEVC NVENC",
    h264_qsv: "Intel H.264 Quick Sync",
    hevc_qsv: "Intel HEVC Quick Sync",
    h264_amf: "AMD H.264 AMF",
    hevc_amf: "AMD HEVC AMF",
    h264_videotoolbox: "macOS H.264 VideoToolbox",
    hevc_videotoolbox: "macOS HEVC VideoToolbox",
    h264_vaapi: "Linux H.264 VAAPI",
    hevc_vaapi: "Linux HEVC VAAPI",
  }
  return encoderNames[encoder] || encoder
}

HardwareAccelerationTool.getRecommendations = (
  args: any,
  detectionResults: string | null,
): string => {
  const recommendations: string[] = []

  if (!detectionResults || detectionResults.includes("未检测到")) {
    recommendations.push("💡 建议安装支持硬件加速的FFmpeg版本")
    recommendations.push("💡 Windows用户可下载带有NVENC支持的FFmpeg构建")
    recommendations.push("💡 Linux用户需要安装相应驱动和VAAPI支持")
    return recommendations.join("\n")
  }

  // 根据检测结果提供建议
  if (detectionResults.includes("h264_nvenc") && args.hwaccel === "auto") {
    recommendations.push(
      "💡 检测到NVIDIA GPU，建议使用 hwaccel=cuda, encoder=h264_nvenc",
    )
    recommendations.push("💡 NVENC预设推荐: p4(平衡), p5(质量), p6(高质量)")
  }

  if (detectionResults.includes("h264_qsv") && args.hwaccel === "auto") {
    recommendations.push(
      "💡 检测到Intel集成显卡，建议使用 hwaccel=qsv, encoder=h264_qsv",
    )
    recommendations.push("💡 QSV预设推荐: fast, medium, slow")
  }

  if (detectionResults.includes("h264_amf") && args.hwaccel === "auto") {
    recommendations.push(
      "💡 检测到AMD GPU，建议使用 hwaccel=amf, encoder=h264_amf",
    )
    recommendations.push("💡 AMF质量预设推荐: speed, balanced, quality")
  }

  if (detectionResults.includes("videotoolbox") && args.hwaccel === "auto") {
    recommendations.push(
      "💡 检测到macOS VideoToolbox，建议使用 hwaccel=videotoolbox, encoder=h264_videotoolbox",
    )
  }

  // 通用建议
  recommendations.push(
    "💡 对于编辑中间文件，建议使用高质量预设(如slow)和高CRF值(如18-23)",
  )
  recommendations.push("💡 对于最终输出，根据目标平台调整比特率和预设")

  return recommendations.join("\n")
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const HwAccelTool = HardwareAccelerationTool

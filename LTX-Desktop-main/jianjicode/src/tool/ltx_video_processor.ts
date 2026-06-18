import { exec } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { promisify } from "util"
import z from "zod"
import {
  cannyEdgeDetection as httpCannyEdgeDetection,
  detectSceneChanges as httpDetectSceneChanges,
  extractVideoFrames as httpExtractVideoFrames,
  getVideoInfo as httpGetVideoInfo,
} from "../../server/python_client.js"
import { Tool } from "./tool.js"

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * LTX 视频处理器工具
 * 调用 LTX 的 VideoProcessor 功能进行高级视频分析
 */
export const LtxVideoProcessorTool = Tool.defineLtxTool("ltx_video_processor", {
  description:
    "【LTX 原生分析】视频信息获取、Canny 边缘检测、帧提取、场景变化检测。与 ai_video_analysis（AI 语义理解）和 cv_analysis（计算机视觉）互补。需要 LTX 管道原生能力时用此工具；边缘检测也可用 ltx_api_canny_edge（HTTP 路径）",
  parameters: z.object({
    // 操作类型
    operation: z
      .enum(["get_info", "canny", "extract_frames", "detect_scenes"])
      .describe(
        "操作类型: get_info=获取视频信息, canny=Canny边缘检测, extract_frames=提取帧, detect_scenes=检测场景变化",
      ),

    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件或目录路径（某些操作需要）"),

    // Canny 参数
    threshold1: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .default(100)
      .describe("Canny 阈值1（默认: 100）"),
    threshold2: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .default(200)
      .describe("Canny 阈值2（默认: 200）"),

    // 帧提取参数
    frame_rate: z
      .number()
      .min(0.1)
      .max(60)
      .optional()
      .default(1.0)
      .describe("帧提取率（帧/秒，默认: 1.0）"),
    max_frames: z
      .number()
      .min(1)
      .max(1000)
      .optional()
      .default(10)
      .describe("最大提取帧数（默认: 10）"),
    quality: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(85)
      .describe("JPEG 质量（1-100，默认: 85）"),

    // 场景检测参数
    scene_threshold: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .default(30.0)
      .describe("场景检测阈值（默认: 30.0）"),

    // Python 环境
    python_path: z
      .string()
      .optional()
      .default("python")
      .describe("Python 解释器路径（默认: python）"),
    script_path: z
      .string()
      .optional()
      .describe("Python 脚本路径（默认: 使用内置脚本）"),
  }),

  execute: async (args, ctx) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "LTX 视频处理器失败",
          metadata: { operation: args.operation, error: true },
          output: `输入文件不存在: ${args.input}`,
          attachments: [],
        }
      }

      // 2. 构建 Python 脚本路径
      const scriptPath =
        args.script_path ||
        path.join(__dirname, "../../scripts/ltx_video_processor.py")

      if (!existsSync(scriptPath)) {
        return {
          title: "LTX 视频处理器失败",
          metadata: { operation: args.operation, error: true },
          output: `Python 脚本不存在: ${scriptPath}\n请确保 scripts/ltx_video_processor.py 存在`,
          attachments: [],
        }
      }

      // 3. 执行操作（优先 HTTP，回退子进程）
      console.log(
        `[LTX Video Processor] 执行操作: ${args.operation} (input: ${args.input})`,
      )

      let result: any

      // 子进程回退：复现原有的命令构建 + exec + JSON 解析
      const subprocessFallback = async () => {
        const fbArgs = [
          args.python_path,
          `"${scriptPath}"`,
          `--operation ${args.operation}`,
          `--input "${args.input}"`,
        ]
        if (args.output) fbArgs.push(`--output "${args.output}"`)
        if (args.operation === "canny") {
          fbArgs.push(`--threshold1 ${args.threshold1}`)
          fbArgs.push(`--threshold2 ${args.threshold2}`)
        } else if (args.operation === "extract_frames") {
          fbArgs.push(`--frame_rate ${args.frame_rate}`)
          fbArgs.push(`--max_frames ${args.max_frames}`)
          fbArgs.push(`--quality ${args.quality}`)
        } else if (args.operation === "detect_scenes") {
          fbArgs.push(`--scene_threshold ${args.scene_threshold}`)
        }
        const command = fbArgs.join(" ")
        console.log(`[LTX Video Processor] 子进程回退: ${command}`)
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024,
        })
        if (stderr && stderr.trim()) {
          console.warn(`[LTX Video Processor] 标准错误输出: ${stderr}`)
        }
        return JSON.parse(stdout.trim())
      }

      try {
        switch (args.operation) {
          case "get_info":
            result = await httpGetVideoInfo(args.input, subprocessFallback)
            break
          case "canny":
            result = await httpCannyEdgeDetection(
              args.input,
              args.output!,
              args.threshold1!,
              args.threshold2!,
              subprocessFallback,
            )
            break
          case "extract_frames":
            result = await httpExtractVideoFrames(
              args.input,
              args.output!,
              args.frame_rate!,
              args.max_frames!,
              args.quality!,
              subprocessFallback,
            )
            break
          case "detect_scenes":
            result = await httpDetectSceneChanges(
              args.input,
              args.scene_threshold!,
              subprocessFallback,
            )
            break
          default:
            return {
              title: "LTX 视频处理器失败",
              metadata: { operation: args.operation, error: true },
              output: `未知操作: ${args.operation}`,
              attachments: [],
            }
        }
      } catch (httpOrFallbackError: any) {
        // HTTP 和子进程都失败
        return {
          title: "LTX 视频处理器失败",
          metadata: { operation: args.operation, error: true },
          output: `❌ 操作失败: ${httpOrFallbackError.message}`,
          attachments: [],
        }
      }

      // 6. 处理结果
      if (result.error) {
        return {
          title: `LTX ${getOperationName(args.operation)} 失败`,
          metadata: { operation: args.operation, error: true },
          output: `❌ ${result.error}`,
          attachments: [],
        }
      }

      // 7. 根据操作类型生成友好输出
      let outputText = `✅ LTX ${getOperationName(args.operation)} 成功\n\n`

      switch (args.operation) {
        case "get_info":
          outputText += generateVideoInfoOutput(result)
          break
        case "canny":
          outputText += generateCannyOutput(result)
          break
        case "extract_frames":
          outputText += generateExtractFramesOutput(result)
          break
        case "detect_scenes":
          outputText += generateSceneDetectionOutput(result)
          break
      }

      return {
        title: `LTX ${getOperationName(args.operation)} 完成`,
        metadata: {
          operation: args.operation,
          success: true,
          error: false,
          ...result,
        },
        output: outputText,
        attachments: [],
      }
    } catch (error: any) {
      return {
        title: "LTX 视频处理器错误",
        metadata: { operation: args.operation, error: true, success: false },
        output: `❌ LTX 视频处理器过程中发生错误: ${error.message}`,
        attachments: [],
      }
    }
  },
})

/**
 * 工具别名，便于通过不同名称调用
 */
export const LtxVideoTool = LtxVideoProcessorTool

// ===== 辅助函数 =====

function getOperationName(operation: string): string {
  const names: Record<string, string> = {
    get_info: "视频信息获取",
    canny: "Canny 边缘检测",
    extract_frames: "帧提取",
    detect_scenes: "场景检测",
  }
  return names[operation] || operation
}

function generateVideoInfoOutput(result: any): string {
  return `📊 视频信息分析结果：
  分辨率: ${result.resolution} (${result.aspect_ratio})
  帧率: ${result.fps.toFixed(2)} FPS
  总帧数: ${result.frame_count}
  时长: ${formatDuration(result.duration)}
  宽度: ${result.width} px
  高度: ${result.height} px`
}

function generateCannyOutput(result: any): string {
  return `🔍 Canny 边缘检测完成：
  输出文件: ${result.output_path}
  处理帧数: ${result.frame_count}
  阈值设置: ${result.threshold1}/${result.threshold2}
  效果: 已成功提取视频边缘特征`
}

function generateExtractFramesOutput(result: any): string {
  const frameCount = result.frame_count || 0
  const framePaths = result.frame_paths || []

  let framesText = ""
  if (framePaths.length > 0) {
    if (framePaths.length <= 5) {
      framesText = `\n  提取的帧: ${framePaths.join(", ")}`
    } else {
      framesText = `\n  提取了 ${framePaths.length} 帧，前5帧: ${framePaths.slice(0, 5).join(", ")}...`
    }
  }

  return `🖼️ 帧提取完成：
  输出目录: ${result.output_dir}
  提取帧数: ${frameCount}
  帧率: ${result.frame_rate} FPS
  质量: ${result.quality}/100${framesText}`
}

function generateSceneDetectionOutput(result: any): string {
  const changes = result.scene_changes || []
  const changeCount = result.change_count || 0

  let changesText = ""
  if (changes.length > 0) {
    if (changes.length <= 3) {
      changesText = "\n  检测到的场景变化点：\n"
      changes.forEach((change: any, index: number) => {
        changesText += `    ${index + 1}. 帧 ${change.frame} (${formatDuration(change.time)}) - 差异分数: ${change.diff_score.toFixed(2)}\n`
      })
    } else {
      changesText = `\n  检测到 ${changeCount} 个场景变化点，前3个：\n`
      changes.slice(0, 3).forEach((change: any, index: number) => {
        changesText += `    ${index + 1}. 帧 ${change.frame} (${formatDuration(change.time)}) - 差异分数: ${change.diff_score.toFixed(2)}\n`
      })
      changesText += `    ... 还有 ${changeCount - 3} 个变化点`
    }
  }

  return `🎬 场景检测完成：
  总帧数: ${result.total_frames}
  检测阈值: ${result.scene_threshold}
  场景变化数: ${changeCount}${changesText}`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(2)} 秒`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}分${remainingSeconds.toFixed(0)}秒`
  } else {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60
    return `${hours}小时${minutes}分${remainingSeconds.toFixed(0)}秒`
  }
}

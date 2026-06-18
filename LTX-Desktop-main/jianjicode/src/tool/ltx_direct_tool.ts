import { execSync, spawn } from "child_process"
import { existsSync } from "fs"
import path from "path"
import { promisify } from "util"
import z from "zod"
import { Tool } from "./tool.js"

const exec = promisify(execSync)

/**
 * LTX Direct Tool - Direct Python bridge calls to LTX native services
 * Uses Python subprocess to call LTXDirectBridge for direct service access
 */
export const LtxDirectTool = Tool.define("ltx_direct", {
  description:
    "[DEPRECATED] LTX 直接桥接工具 - 通过 Python 桥接层调用 LTX 原生视频编辑服务。\n请使用 HTTP 路径 (TS → FastAPI /api/edit/*) 替代。此工具仅作为 FastAPI 离线时的 fallback。",
  parameters: z.object({
    // 基本配置
    operation: z
      .enum([
        "trim",
        "concat",
        "extract_audio",
        "add_subtitle",
        "apply_color_grading",
        "apply_color_preset",
        "convert_format",
        "extract_frame",
        "merge_audio_video",
        "video_info",
        "list_color_presets",
        "list_subtitle_templates",
        "list_effect_templates",
        "get_color_preset",
      ])
      .describe("编辑操作类型"),

    // Python 桥接配置
    python_path: z
      .string()
      .optional()
      .describe("Python 解释器路径（可选，默认: python）"),
    bridge_mode: z
      .enum(["direct", "http", "auto"])
      .optional()
      .default("http")
      .describe(
        "桥接模式：http（HTTP API，推荐）、direct（直连导入，仅离线 fallback）、auto（自动选择）",
      ),
    base_url: z
      .string()
      .optional()
      .default("http://localhost:8000")
      .describe("HTTP 模式下的基础 URL（默认: http://localhost:8000）"),
    api_key: z.string().optional().describe("API 密钥（HTTP 模式需要）"),

    // 通用参数
    input_path: z
      .string()
      .optional()
      .describe("输入视频文件路径（某些操作需要）"),
    output_path: z.string().optional().describe("输出文件路径（可选）"),

    // Trim 参数
    start_time: z
      .number()
      .min(0)
      .optional()
      .describe("开始时间（秒，trim 操作需要）"),
    end_time: z
      .number()
      .min(0)
      .optional()
      .describe("结束时间（秒，trim 操作需要）"),

    // Concat 参数
    input_paths: z
      .array(z.string())
      .optional()
      .describe("输入视频文件路径列表（concat 操作需要）"),

    // Subtitle 参数
    subtitle_text: z
      .string()
      .optional()
      .describe("字幕文本（add_subtitle 操作需要）"),
    subtitle_start_time: z
      .number()
      .min(0)
      .optional()
      .describe("字幕开始时间（秒）"),
    subtitle_end_time: z
      .number()
      .min(0)
      .optional()
      .describe("字幕结束时间（秒）"),
    subtitle_style: z
      .record(z.any())
      .optional()
      .describe("字幕样式配置（可选）"),

    // Color grading 参数
    color_correction: z
      .record(z.number())
      .optional()
      .describe("颜色校正参数（apply_color_grading 操作需要）"),
    preset_id: z
      .string()
      .optional()
      .describe("颜色预设 ID（apply_color_preset 操作需要）"),
    strength: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("预设应用强度（0-100%，默认: 100）"),

    // Convert format 参数
    output_format: z
      .string()
      .optional()
      .default("mp4")
      .describe("输出格式（convert_format 操作需要，默认: mp4）"),

    // Extract frame 参数
    frame_time: z
      .number()
      .min(0)
      .optional()
      .describe("帧时间（秒，extract_frame 操作需要）"),

    // Merge audio video 参数
    video_path: z
      .string()
      .optional()
      .describe("视频文件路径（merge_audio_video 操作需要）"),
    audio_path: z
      .string()
      .optional()
      .describe("音频文件路径（merge_audio_video 操作需要）"),

    // 视频信息参数
    video_info_path: z
      .string()
      .optional()
      .describe("视频文件路径（video_info 操作需要）"),

    // 预设列表参数
    category: z.string().optional().describe("类别过滤（list_* 操作需要）"),

    // 超时设置
    timeout: z
      .number()
      .min(1000)
      .max(60000)
      .optional()
      .default(30000)
      .describe("子进程超时时间（毫秒，默认: 30000）"),
  }),

  execute: async (args, ctx) => {
    console.warn(
      "[DEPRECATED] LtxDirectTool 已弃用，请使用 HTTP 路径 (TS → FastAPI /api/edit/*) 替代。",
    )
    try {
      // 验证操作参数
      const validationError = validateOperationArgs(args)
      if (validationError) {
        return {
          title: "参数验证失败",
          metadata: { operation: args.operation, error: true },
          output: validationError,
          attachments: [],
        }
      }

      // 准备 Python 命令参数
      const pythonArgs = preparePythonArgs(args)
      console.log(`[LTX Direct] ${args.operation} Python 参数:`, pythonArgs)

      // 执行 Python 脚本
      const result = await executePythonBridge(pythonArgs, args.timeout)

      // 处理结果
      return processResult(args.operation, result)
    } catch (error: any) {
      return {
        title: "LTX 直接桥接工具错误",
        metadata: { operation: args.operation, error: true },
        output: `❌ LTX 直接桥接工具过程中发生错误: ${error.message}`,
        attachments: [],
      }
    }
  },
})

// ===== 辅助函数 =====

function validateOperationArgs(args: any): string | null {
  switch (args.operation) {
    case "trim":
      if (!args.input_path) return "trim 操作需要 input_path 参数"
      if (args.start_time === undefined) return "trim 操作需要 start_time 参数"
      if (args.end_time === undefined) return "trim 操作需要 end_time 参数"
      if (args.end_time <= args.start_time)
        return "end_time 必须大于 start_time"
      break

    case "concat":
      if (!args.input_paths || args.input_paths.length < 2)
        return "concat 操作需要至少两个 input_paths"
      break

    case "extract_audio":
      if (!args.input_path) return "extract_audio 操作需要 input_path 参数"
      break

    case "add_subtitle":
      if (!args.input_path) return "add_subtitle 操作需要 input_path 参数"
      if (!args.subtitle_text) return "add_subtitle 操作需要 subtitle_text 参数"
      if (args.subtitle_start_time === undefined)
        return "add_subtitle 操作需要 subtitle_start_time 参数"
      if (args.subtitle_end_time === undefined)
        return "add_subtitle 操作需要 subtitle_end_time 参数"
      break

    case "apply_color_grading":
      if (!args.input_path)
        return "apply_color_grading 操作需要 input_path 参数"
      if (!args.color_correction)
        return "apply_color_grading 操作需要 color_correction 参数"
      break

    case "apply_color_preset":
      if (!args.input_path) return "apply_color_preset 操作需要 input_path 参数"
      if (!args.preset_id) return "apply_color_preset 操作需要 preset_id 参数"
      break

    case "convert_format":
      if (!args.input_path) return "convert_format 操作需要 input_path 参数"
      break

    case "extract_frame":
      if (!args.input_path) return "extract_frame 操作需要 input_path 参数"
      if (args.frame_time === undefined)
        return "extract_frame 操作需要 frame_time 参数"
      break

    case "merge_audio_video":
      if (!args.video_path) return "merge_audio_video 操作需要 video_path 参数"
      if (!args.audio_path) return "merge_audio_video 操作需要 audio_path 参数"
      break

    case "video_info":
      if (!args.video_info_path && !args.input_path)
        return "video_info 操作需要 video_info_path 或 input_path 参数"
      break

    case "list_color_presets":
    case "list_subtitle_templates":
    case "list_effect_templates":
      // 这些操作没有必填参数
      break

    case "get_color_preset":
      if (!args.preset_id) return "get_color_preset 操作需要 preset_id 参数"
      break
  }

  return null
}

function preparePythonArgs(args: any): string[] {
  const pythonArgs = [args.operation]

  // 添加桥接模式
  pythonArgs.push("--mode", args.bridge_mode)

  // 添加 HTTP 相关参数
  if (args.bridge_mode === "http" || args.bridge_mode === "auto") {
    pythonArgs.push("--base-url", args.base_url)
    if (args.api_key) {
      pythonArgs.push("--api-key", args.api_key)
    }
  }

  // 添加操作特定参数
  switch (args.operation) {
    case "trim":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push("--start-time", args.start_time.toString())
      pythonArgs.push("--end-time", args.end_time.toString())
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "concat":
      args.input_paths.forEach((path: string) =>
        pythonArgs.push("--input-paths", path),
      )
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "extract_audio":
      pythonArgs.push("--input-path", args.input_path)
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "add_subtitle":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push("--text", args.subtitle_text)
      pythonArgs.push(
        "--subtitle-start-time",
        args.subtitle_start_time.toString(),
      )
      pythonArgs.push("--subtitle-end-time", args.subtitle_end_time.toString())
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      if (args.subtitle_style) {
        pythonArgs.push("--subtitle-style", JSON.stringify(args.subtitle_style))
      }
      break

    case "apply_color_grading":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push(
        "--color-correction",
        JSON.stringify(args.color_correction),
      )
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "apply_color_preset":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push("--preset-id", args.preset_id)
      pythonArgs.push("--strength", args.strength.toString())
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "convert_format":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push("--output-format", args.output_format)
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "extract_frame":
      pythonArgs.push("--input-path", args.input_path)
      pythonArgs.push("--frame-time", args.frame_time.toString())
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "merge_audio_video":
      pythonArgs.push("--video-path", args.video_path)
      pythonArgs.push("--audio-path", args.audio_path)
      if (args.output_path) pythonArgs.push("--output-path", args.output_path)
      break

    case "video_info": {
      const path = args.video_info_path || args.input_path
      pythonArgs.push("--video-info-path", path)
      break
    }

    case "list_color_presets":
    case "list_subtitle_templates":
    case "list_effect_templates":
      if (args.category) pythonArgs.push("--category", args.category)
      break

    case "get_color_preset":
      pythonArgs.push("--preset-id", args.preset_id)
      break
  }

  return pythonArgs
}

async function executePythonBridge(
  pythonArgs: string[],
  timeout: number,
): Promise<any> {
  // 确定 Python 解释器路径
  const pythonPath = process.env.PYTHON_PATH || "python"

  // 确定 ltx_bridge.py 路径
  const bridgePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "jianjicode-python",
    "jianjicode",
    "ltx_bridge.py",
  )

  if (!existsSync(bridgePath)) {
    throw new Error(`找不到 LTX bridge 脚本: ${bridgePath}`)
  }

  // 构建完整命令
  const fullArgs = [bridgePath, ...pythonArgs]
  console.log(`[LTX Direct] 执行命令: ${pythonPath} ${fullArgs.join(" ")}`)

  // 使用 spawn 执行命令，支持超时
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, fullArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeout,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data) => {
      stdout += data.toString()
    })

    child.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    child.on("close", (code) => {
      if (code === 0) {
        try {
          // 尝试解析 JSON 输出
          const result = JSON.parse(stdout)
          resolve(result)
        } catch (e) {
          // 如果不是 JSON，返回原始输出
          resolve({
            success: true,
            output: stdout.trim(),
            stderr: stderr.trim(),
          })
        }
      } else {
        // 命令执行失败
        let errorMessage = stderr.trim() || `Python 脚本返回错误代码: ${code}`

        // 尝试从 stdout 解析错误信息
        try {
          const errorResult = JSON.parse(stdout)
          if (errorResult.error) {
            errorMessage = errorResult.error
          }
        } catch (e) {
          // 忽略解析错误
        }

        reject(new Error(errorMessage))
      }
    })

    child.on("error", (err) => {
      reject(err)
    })
  })
}

function processResult(operation: string, result: any) {
  const operationName = getOperationName(operation)

  if (result.success === false) {
    return {
      title: `LTX ${operationName} 失败`,
      metadata: { operation, error: true, ...result },
      output: `❌ ${operationName} 失败: ${result.error || "未知错误"}`,
      attachments: [],
    }
  }

  let outputText = `✅ LTX ${operationName} 成功\n\n`

  switch (operation) {
    case "trim":
      outputText += `📹 裁剪完成
      输入: ${result.metadata?.input || "未知"}
      输出: ${result.output_path || "未知"}
      时长: ${result.metadata?.duration ? result.metadata.duration.toFixed(2) + "秒" : "未知"}
      时间范围: ${result.metadata?.start_time || 0} - ${result.metadata?.end_time || 0} 秒`
      break

    case "concat":
      outputText += `📽️ 合并完成
      输出: ${result.output_path || "未知"}
      合并文件数: ${result.metadata?.count || 0}`
      break

    case "extract_audio":
      outputText += `🎵 音频提取完成
      输出: ${result.output_path || "未知"}
      来源: ${result.metadata?.input || "未知"}`
      break

    case "add_subtitle":
      outputText += `📝 字幕添加完成
      输出: ${result.output_path || "未知"}
      字幕: "${result.metadata?.text || "未知"}"
      显示时间: ${result.metadata?.start_time || 0} - ${result.metadata?.end_time || 0} 秒`
      break

    case "apply_color_grading":
    case "apply_color_preset":
      outputText += `🎨 颜色分级完成
      输出: ${result.output_path || "未知"}
      预设: ${operation === "apply_color_preset" ? result.metadata?.preset_id || "未知" : "自定义"}
      强度: ${operation === "apply_color_preset" ? (result.metadata?.strength || 100) + "%" : "100%"}`
      break

    case "convert_format":
      outputText += `🔄 格式转换完成
      输出: ${result.output_path || "未知"}
      格式: ${result.metadata?.format || "mp4"}`
      break

    case "extract_frame":
      outputText += `🖼️ 帧提取完成
      输出: ${result.output_path || "未知"}
      时间点: ${result.metadata?.time || 0} 秒`
      break

    case "merge_audio_video":
      outputText += `🎬 音视频合并完成
      输出: ${result.output_path || "未知"}
      视频: ${result.metadata?.video_input || "未知"}
      音频: ${result.metadata?.audio_input || "未知"}`
      break

    case "video_info":
      outputText += `📊 视频信息
      分辨率: ${result.width || 0} x ${result.height || 0}
      帧率: ${result.fps ? result.fps.toFixed(2) : 0} FPS
      时长: ${result.duration ? formatDuration(result.duration) : "未知"}
      编码: ${result.video_codec || "未知"} (视频) / ${result.audio_codec || "无"} (音频)
      音频: ${result.has_audio ? "有" : "无"}`
      break

    case "list_color_presets":
      outputText += `🎨 颜色预设列表 (${result.length || 0} 个)\n`
      if (result.length > 0) {
        result.forEach((preset: any, index: number) => {
          outputText += `  ${index + 1}. ${preset.name || preset.id} - ${preset.category || "未分类"}`
          if (preset.description) outputText += `: ${preset.description}`
          outputText += "\n"
        })
      }
      break

    case "list_subtitle_templates":
      outputText += `📝 字幕模板列表 (${result.length || 0} 个)\n`
      if (result.length > 0) {
        result.forEach((template: any, index: number) => {
          outputText += `  ${index + 1}. ${template.name || template.id} - ${template.category || "未分类"}`
          if (template.description) outputText += `: ${template.description}`
          outputText += "\n"
        })
      }
      break

    case "list_effect_templates":
      outputText += `✨ 特效模板列表 (${result.length || 0} 个)\n`
      if (result.length > 0) {
        result.forEach((template: any, index: number) => {
          outputText += `  ${index + 1}. ${template.name || template.id} - ${template.category || "未分类"}`
          if (template.description) outputText += `: ${template.description}`
          outputText += "\n"
        })
      }
      break

    case "get_color_preset":
      if (result && Object.keys(result).length > 0) {
        outputText += `🎨 颜色预设详情: ${result.name || result.id}\n`
        outputText += `类别: ${result.category || "未分类"}\n`
        if (result.description) outputText += `描述: ${result.description}\n`
        if (result.color_correction) {
          outputText += `颜色校正参数:\n`
          for (const [key, value] of Object.entries(result.color_correction)) {
            outputText += `  ${key}: ${value}\n`
          }
        }
      } else {
        outputText += `未找到预设: ${result.preset_id || "未知"}`
      }
      break

    default:
      outputText += JSON.stringify(result, null, 2)
  }

  return {
    title: `LTX ${operationName} 完成`,
    metadata: {
      operation,
      success: true,
      error: false,
      ...result,
    },
    output: outputText,
    attachments: [],
  }
}

function getOperationName(operation: string): string {
  const names: Record<string, string> = {
    trim: "视频裁剪",
    concat: "视频合并",
    extract_audio: "音频提取",
    add_subtitle: "字幕添加",
    apply_color_grading: "颜色分级",
    apply_color_preset: "颜色预设应用",
    convert_format: "格式转换",
    extract_frame: "帧提取",
    merge_audio_video: "音视频合并",
    video_info: "视频信息获取",
    list_color_presets: "颜色预设列表",
    list_subtitle_templates: "字幕模板列表",
    list_effect_templates: "特效模板列表",
    get_color_preset: "颜色预设获取",
  }
  return names[operation] || operation
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

/**
 * 工具别名，便于通过不同名称调用
 */
export const LtxDirectBridgeTool = LtxDirectTool
export const LtxPythonBridgeTool = LtxDirectTool

// 默认导出
export default LtxDirectTool

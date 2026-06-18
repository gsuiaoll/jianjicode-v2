/**
 * LTX API 工具 — 通过 HTTP 调用 LTX FastAPI 后端
 *
 * 与本地 FFmpeg 实现（video_filter 等）不同，
 * 这里是直接调 LTX FastAPI /api/edit/* 端点，使用真正 LTX 后端的处理能力。
 *
 * AI 优先使用这些工具（真正的 LTX 后端能力），
 * 不可用时 AI 可选同类的本地 FFmpeg 工具降级。
 */
import z from "zod"
import {
  applyColorGrading as pythonApplyColorGrading,
  cannyEdgeDetection as pythonCannyEdgeDetection,
} from "../../../server/python_client.js"
import { Tool } from "../tool.js"

// ============================================================================
// LTX 调色工具（通过 FastAPI /api/edit/apply_color_grading）
// ============================================================================

export const LtxApiColorGradingTool = Tool.define("ltx_api_color_grading", {
  description:
    "通过 LTX 后端引擎对视频应用专业色彩校正（亮度、对比度、饱和度、色温、色调、曝光、高光、阴影）。参数范围 -100~100。如果 LTX 不可用，可改用 video_filter（本地 FFmpeg 版本）",
  parameters: z.object({
    input_file: z.string().describe("输入视频文件路径"),
    output_file: z.string().optional().describe("输出文件路径（可选）"),

    brightness: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("亮度调整 (-100~100)"),
    contrast: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("对比度调整 (-100~100)"),
    saturation: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("饱和度调整 (-100~100)"),
    temperature: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("色温调整 (-100~100)"),
    tint: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("色调调整 (-100~100)"),
    exposure: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("曝光调整 (-100~100)"),
    highlights: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("高光调整 (-100~100)"),
    shadows: z
      .number()
      .min(-100)
      .max(100)
      .optional()
      .default(0)
      .describe("阴影调整 (-100~100)"),
  }),

  execute: async (args) => {
    const outputPath =
      args.output_file ||
      `${args.input_file.replace(/\.[^/.]+$/, "")}_ltx_color.mp4`
    const correction: Record<string, number> = {
      brightness: args.brightness ?? 0,
      contrast: args.contrast ?? 0,
      saturation: args.saturation ?? 0,
      temperature: args.temperature ?? 0,
      tint: args.tint ?? 0,
      exposure: args.exposure ?? 0,
      highlights: args.highlights ?? 0,
      shadows: args.shadows ?? 0,
    }

    const result = await pythonApplyColorGrading(
      args.input_file,
      correction,
      outputPath,
      async () => ({
        success: false,
        title: "LTX 不可用",
        output:
          "LTX 后端不可用，请尝试使用 video_filter 工具进行本地色彩校正",
        operation: "ltx_api_color_grading",
        toolId: "ltx_api_color_grading",
        metadata: {
          error: true,
          note: "fallback to video_filter tool",
        },
      }),
    )

    return {
      title: result.success ? "已应用 LTX 色彩校正" : "色彩校正失败",
      metadata: {
        operation: "ltx_api_color_grading",
        success: result.success,
        ...(result.success
          ? { outputPath }
          : { error: true, error_message: result.error }),
        correction,
      },
      output: result.success
        ? `已通过 LTX 后端应用色彩校正\n  亮度: ${correction.brightness}, 对比度: ${correction.contrast}, 饱和度: ${correction.saturation}\n  输出: ${outputPath}`
        : `LTX 色彩校正失败: ${result.error || "未知错误"}`,
    }
  },
})

// ============================================================================
// LTX Canny 边缘检测工具（通过 FastAPI /api/edit/canny）
// ============================================================================

export const LtxApiCannyTool = Tool.define("ltx_api_canny_edge", {
  description:
    "【边缘检测】通过 LTX FastAPI 后端对视频帧应用 Canny 边缘检测。与 ltx_video_processor（通过 Python 子进程）功能重叠。优先用本工具（HTTP 路径），LTX 后端不可用时回退到 ltx_video_processor",
  parameters: z.object({
    input_file: z.string().describe("输入视频文件路径"),
    output_file: z.string().describe("输出视频文件路径"),
    threshold1: z
      .number()
      .min(0)
      .max(500)
      .optional()
      .default(100)
      .describe("Canny 低阈值（默认 100）"),
    threshold2: z
      .number()
      .min(0)
      .max(500)
      .optional()
      .default(200)
      .describe("Canny 高阈值（默认 200）"),
  }),

  execute: async (args) => {
    const result = await pythonCannyEdgeDetection(
      args.input_file,
      args.output_file,
      args.threshold1 ?? 100,
      args.threshold2 ?? 200,
    )

    return {
      title: result.success ? "Canny 边缘检测完成" : "Canny 边缘检测失败",
      metadata: {
        operation: "ltx_api_canny_edge",
        success: result.success,
        ...(result.success
          ? { outputPath: args.output_file }
          : { error: true, error_message: result.error }),
      },
      output: result.success
        ? `已应用 Canny 边缘检测\n  输入: ${args.input_file}\n  输出: ${args.output_file}`
        : `Canny 边缘检测失败: ${result.error || "未知错误"}`,
    }
  },
})

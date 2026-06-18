/**
 * edit_video — Seedance 语义视频编辑入口
 *
 * === 职责 ===
 * 对 AI 暴露单一工具，内部串联完整管线：
 *   probe → detectShots → locate → seedanceEdit → compose
 *
 * === Sprint 1（基础） ===
 * - probe + detectShots + compose（穿通模式：不编辑，只验证管线）
 * - 验证：输出视频 hash ≈ 输入视频 hash
 *
 * === Sprint 2 ===
 * - VideoLocator：Qwen 3.5-Omni-Flash 关键帧分析
 *
 * === Sprint 3（当前） ===
 * - SeedanceService + SeedancePlanner：AI 重生成
 * - compose 动态 crossfade
 * - 完整管线：probe → detectShots → locate → seedanceEdit → compose
 *
 * === 规范遵从 ===
 * - validatePath 安全沙箱
 * - ctx.abort 取消信号
 * - B 类工具（原地修改 — compose 产生输出文件）
 */

import z from "zod"
import { Tool } from "../../../lib/tool.js"
import { validatePath } from "../../../lib/ffmpeg-sandbox.js"
import { getVideoInfo } from "../../../lib/ffmpeg-utils.js"
import { compose } from "./composer.js"
import { planAndExecute } from "./seedance-planner.js"
import type { Shot } from "./shot-detector.js"
import { detectShots } from "./shot-detector.js"
import { locateTargetShots } from "./video-locator.js"

export type { LocateResult } from "./video-locator.js"
export { locateTargetShots } from "./video-locator.js"

const paramsSchema = z.object({
  instruction: z.string().min(1).describe("编辑指令，如'删除桌上的红色杯子'"),
  input: z.string().min(1).describe("输入视频文件路径"),
  output: z.string().optional().describe("输出视频文件路径（可选）"),
})

type EditVideoArgs = z.infer<typeof paramsSchema>

export const SemanticEditTool = Tool.define("edit_video", {
  description:
    "自然语言驱动的语义视频编辑：删除物体、替换背景、重生成片段。" +
    "支持「删掉红色杯子」类自然语言指令。内部自动定位镜头、AI 重生成、替换回原视频。",

  parameters: paramsSchema,

  usageTemplate: {
    json: {
      instruction: "删除桌上的红色杯子",
      input: "{input_video_path}",
    },
    constraints: [
      "instruction 必须是非空字符串，描述要编辑的内容",
      "input 必须是本地视频文件路径",
      "[MUST NOT] 对于文本/图片直接生成视频，应使用 seedance_v2 工具而非 edit_video",
      "Sprint 3：完整 AI 编辑管线 — 定位目标镜头 → Seedance 重生成 → 动态 crossfade 回拼",
    ],
    knownLimitations: [
      "Sprint 3：需要 SEEDANCE_API_KEY 环境变量",
      "Sprint 3：需要 DASHSCOPE_API_KEY 环境变量（视频定位）",
      "Sprint 3：需要 VOLC_ACCESS_KEY/VOLC_SECRET_KEY/TOS_BUCKET（参考视频上传）",
      "仅编辑 locate 置信度 ≥0.7 的镜头，其他镜头原样保留",
      "Seedance 失败时自动回退到原片段（不输出半成品）",
    ],
    outputContract: {
      format: "json",
      required: ["shots", "duration", "status"],
      optional: ["outputPath"],
      verify: ["shot 覆盖率 100%"],
    },
  },

  execute: async (args: EditVideoArgs, ctx) => {
    const outputPath =
      args.output || args.input.replace(/\.(\w+)$/, "_edited.$1")

    // 1. 安全沙箱
    const sandbox = validatePath(args.input, outputPath)
    if (!sandbox.ok) {
      return {
        title: sandbox.skipped ? "已跳过（输出已存在）" : "安全拦截",
        metadata: {
          operation: "edit_video",
          error: !sandbox.skipped,
          skipped: sandbox.skipped,
        },
        output: sandbox.error,
      }
    }
    const safeOutput = sandbox.outputPath

    // 2. Probe
    const info = await getVideoInfo(args.input)
    if (!info.success) {
      return {
        title: "探测失败",
        metadata: { operation: "edit_video", error: true },
        output: `无法读取视频信息: ${info.error}`,
      }
    }
    const duration = Number(info?.data?.format?.duration || 0)
    const fps = info?.data?.streams?.find(
      (s: any) => s.codec_type === "video",
    )?.r_frame_rate
    const fpsNum = fps ? eval(fps.replace("/", "/")) : 0
    const hasAudio = info?.data?.streams?.some(
      (s: any) => s.codec_type === "audio",
    )

    // 3. Shot detection
    const shots: Shot[] = await detectShots(args.input, {
      signal: ctx.abort,
    })

    // 4. Sprint 1 取消检查
    if (ctx.abort.aborted) {
      return {
        title: "已取消",
        metadata: { operation: "edit_video", error: true },
        output: "操作已被用户取消",
      }
    }

    // 5. Sprint 3：定位 → 重生成 → 回拼
    const locateResult = await locateTargetShots(
      shots,
      args.instruction,
      args.input,
      ctx.abort,
    )

    if (locateResult.status === "NOT_FOUND") {
      return {
        title: "未找到编辑目标",
        metadata: {
          operation: "edit_video",
          error: true,
          success: false,
          target: locateResult.target,
        },
        output: `视频中未找到需要编辑的目标: ${locateResult.target || "无法识别"}`,
      }
    }

    const segments = await Promise.all(
      shots.map(async (shot) => {
        const target = locateResult.targetShots.find((s) => s.id === shot.id)
        if (target && target.confidence >= 0.7) {
          return planAndExecute(
            shot,
            locateResult.target,
            args.instruction,
            args.input,
            ctx.abort,
          )
        }
        return {
          id: shot.id,
          start: shot.start,
          end: shot.end,
          duration: shot.duration,
          source: "original" as const,
        }
      }),
    )

    const composeResult = await compose(
      args.input,
      segments,
      safeOutput,
      ctx.abort,
    )

    if (!composeResult.success) {
      return {
        title: "回拼失败",
        metadata: { operation: "edit_video", error: true },
        output: composeResult.output,
      }
    }

    // 5. 验证回拼时长
    const outputInfo = await getVideoInfo(safeOutput)
    const outputDuration = Number(outputInfo?.data?.format?.duration || 0)
    const durationDiff = Math.abs(outputDuration - duration)

    const seedanceCount = segments.filter((s) => s.source === "seedance").length

    return {
      title: `语义编辑完成（${shots.length} 个镜头，${seedanceCount} 个 AI 重生成）`,
      metadata: {
        operation: "edit_video",
        success: true,
        undoable: true,
        undo: {
          kind: "replace_file" as const,
          originalPath: args.input,
          label: "撤销语义编辑",
        },
        duration,
        fps: fpsNum,
        hasAudio,
        shotCount: shots.length,
        seedanceCount,
        target: locateResult.target,
        outputPath: safeOutput,
        durationError: durationDiff,
        status: "ai_edit",
      },
      output: JSON.stringify({
        status: "语义编辑完成",
        duration,
        fps: fpsNum,
        hasAudio,
        shotCount: shots.length,
        shots: shots.map((s) => ({
          id: s.id,
          start: s.start.toFixed(1),
          end: s.end.toFixed(1),
          duration: s.duration.toFixed(1),
        })),
        outputPath: safeOutput,
      }),
    }
  },
})

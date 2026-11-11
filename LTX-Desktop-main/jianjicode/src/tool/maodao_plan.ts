/**
 * 猫导制作计划（分镜）工具
 *
 * 把「主题 + 产品」发给猫导的 `/api/production/plan`，拿回一份可直接编排的镜头表。
 * 猫导侧复用 `services/script.py` 的短剧提示词，这里不重写任何创作规则；
 * 工具只负责鉴权、超时、错误归一化和把结果排成人能读的镜头表。
 *
 * 与 `maodao_kb` 的分工：
 *   · maodao_kb    → 查方法论/知识，回答「怎么写、为什么」
 *   · maodao_plan  → 直接产出一份分镜，回答「这一条具体怎么拍」
 *
 * 配置（环境变量优先，其次 config.json 的 maodaoProduction 段）：
 *   MAODAO_PROD_URL       默认回退 MAODAO_KB_URL，再回退 https://wenan.onecat.xin
 *   MAODAO_PROD_TOKEN     猫导侧 PRODUCTION_API_TOKEN；**不复用 KB 令牌**
 *   MAODAO_PROD_TIMEOUT_MS 默认 170000（猫导服务端预算是 150s）
 *
 * @license MIT
 */

import { randomUUID } from "node:crypto"
import z from "zod"
import { Tool } from "./tool.js"
import { loadMaodaoProdConfig, postProdJson } from "./maodao_http.js"

interface PlanShot {
  no: number
  seconds: number
  shot_size: string
  visual: string
  voiceover: string
  caption: string
  material_query: string
  transition: string
}

interface PlanOk {
  ok: true
  version?: string
  trace_id?: string
  request_id?: string
  title?: string
  logline?: string
  analysis?: string
  hook?: string
  duration?: number
  platform?: string
  aspect?: string
  shots?: PlanShot[]
  plain_text?: string
  warnings?: string[]
}

interface PlanErr {
  ok?: false
  error?: { code?: string; message?: string } | string
  trace_id?: string
}

function formatPlan(data: PlanOk): string {
  const shots = data.shots || []
  const lines: string[] = []
  lines.push(`【猫导分镜】${data.title || "（未命名）"}`)
  if (data.logline) lines.push(`一句话：${data.logline}`)
  lines.push(`时长：${data.duration ?? 0}s · ${shots.length} 镜 · ${data.aspect || "9:16"}`)
  if (data.hook) lines.push(`开场钩子：${data.hook}`)
  lines.push("")

  for (const shot of shots) {
    lines.push(`${shot.no}. ${shot.seconds}s · ${shot.shot_size || "景别未标注"}`)
    if (shot.visual) lines.push(`   画面：${shot.visual}`)
    if (shot.voiceover) lines.push(`   旁白：${shot.voiceover}`)
    if (shot.caption && shot.caption !== shot.voiceover) lines.push(`   字幕：${shot.caption}`)
    if (shot.material_query) lines.push(`   素材：${shot.material_query}`)
    if (shot.transition && shot.transition !== "cut") lines.push(`   转场：${shot.transition}`)
  }

  if (data.warnings?.length) {
    lines.push("", `注意：${data.warnings.join("；")}`)
  }
  lines.push("", "```json", JSON.stringify(data, null, 2), "```")
  return lines.join("\n")
}

function errorResult(
  title: string,
  metadata: Record<string, any>,
  message: string,
) {
  return {
    title,
    metadata: { error: true, ...metadata },
    output: `${message} 这一轮不要自己编分镜；先修配置或重试。`,
    attachments: [] as any[],
  }
}

export const MaodaoPlanTool = Tool.defineLtxTool("maodao_plan", {
  description:
    "【猫导分镜】把主题 + 产品写成一份可直接开拍的短视频镜头表（标题、钩子、每镜景别/画面/旁白/秒数）。"
    + "当用户要「给个脚本/分镜」「这一条怎么拍」「新店开业拍什么」时使用。"
    + "只支持「剧情」形态；纯剪辑、查视频里有什么，不要用本工具。",
  parameters: z.object({
    topic: z.string().describe("这条视频想讲什么，尽量用用户原话"),
    product: z.string().describe("推广的产品/服务/门店"),
    platform: z.string().optional().describe("投放平台，默认抖音"),
    duration: z.number().int().min(15).max(120).optional().describe("总时长（秒），默认 40"),
    scenes: z.number().int().min(2).max(8).optional().describe("镜头数，默认 4"),
    style: z.enum(["剧情"]).optional().describe("v1 只支持「剧情」"),
    audience: z.string().optional().describe("目标受众"),
    must_include: z.array(z.string()).max(5).optional().describe("必须出现的信息（最多 5 条）"),
    avoid: z.array(z.string()).max(5).optional().describe("要避开的内容/红线（最多 5 条）"),
  }),

  execute: async (args, ctx) => {
    const cfg = loadMaodaoProdConfig()
    if (!cfg.token) {
      return errorResult(
        "猫导制作未配置",
        { reason: "no_token" },
        "猫导制作 API 没有配置令牌（MAODAO_PROD_TOKEN 或 config.json 的 maodaoProduction.token）。",
      )
    }

    const topic = (args.topic || "").trim()
    const product = (args.product || "").trim()
    if (!topic || !product) {
      return errorResult(
        "猫导分镜：信息不全",
        { reason: "empty_input" },
        "主题和推广产品都要有，缺一个猫导不会生成。",
      )
    }

    const requestId = randomUUID()
    const body: Record<string, any> = {
      request_id: requestId,
      topic,
      product,
    }
    if (args.platform?.trim()) body.platform = args.platform.trim()
    if (args.duration) body.duration = args.duration
    if (args.scenes) body.scenes = args.scenes
    if (args.style) body.style = args.style
    if (args.audience?.trim()) body.audience = args.audience.trim()
    if (args.must_include?.length) body.must_include = args.must_include
    if (args.avoid?.length) body.avoid = args.avoid

    const result = await postProdJson("/api/production/plan", body, cfg, ctx.abort)

    if (result.kind === "canceled") {
      return errorResult(
        "猫导分镜已取消",
        { reason: "canceled", requestId },
        "用户取消了这次生成。",
      )
    }
    if (result.kind === "timeout") {
      return errorResult(
        "猫导分镜超时",
        { reason: "timeout", requestId },
        `猫导分镜 ${Math.round(cfg.timeoutMs / 1000)} 秒内没有响应。`,
      )
    }
    if (result.kind === "network") {
      return errorResult(
        "猫导分镜连接失败",
        { reason: "network", requestId },
        `连不上猫导制作 API：${result.message}。`,
      )
    }

    const data = result.data as PlanOk | PlanErr
    const err = (data as PlanErr).error
    const errCode = typeof err === "string" ? err : err?.code
    const errMsg = typeof err === "string" ? err : err?.message

    if (result.kind === "http") {
      return errorResult(
        `猫导分镜不可用（HTTP ${result.status}）`,
        { status: result.status, code: errCode, traceId: (data as PlanErr).trace_id, requestId },
        `猫导分镜请求失败：HTTP ${result.status} ${errMsg || ""}`.trim() + "。",
      )
    }
    if (!(data as PlanOk).ok) {
      return errorResult(
        "猫导分镜生成失败",
        { code: errCode, traceId: (data as PlanErr).trace_id, requestId },
        `猫导分镜生成失败：${errMsg || "未知错误"}。`,
      )
    }

    const plan = data as PlanOk
    if (!plan.shots?.length) {
      return errorResult(
        "猫导分镜为空",
        { code: "empty_shots", traceId: plan.trace_id, requestId },
        "猫导返回了成功，但镜头表是空的。",
      )
    }

    return {
      title: `猫导分镜：${plan.title || topic}`,
      metadata: {
        success: true,
        traceId: plan.trace_id,
        requestId,
        duration: plan.duration,
        shotCount: plan.shots.length,
        warnings: plan.warnings || [],
      },
      output: formatPlan(plan),
      attachments: [],
    }
  },
})

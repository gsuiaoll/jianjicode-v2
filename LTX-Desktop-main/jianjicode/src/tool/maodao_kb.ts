/**
 * 猫导知识库检索工具
 *
 * 为什么是「远程 API」而不是把语料搬进客户端：
 * 猫导的知识层是 1.6 万块 × 1024 维向量 + 实测标定的语义闸门，搬过来要连
 * embedding 模型、RRF 融合、按域预算一起复制，必然和猫导侧漂移。
 * 这里只做一件事：把问题发给猫导 /api/kb/search，把返回的
 * 「方法论 + 知识块」原样交给模型。
 *
 * 与 video_rag_search 的区别（别让模型选错）：
 *   · video_rag_search → 查**当前视频里**有什么（画面/事件/时间点）
 *   · maodao_kb        → 查**领域方法论**（怎么写口播/标题/钩子、怎么起号/留人/转化）
 *
 * 配置（环境变量优先，其次 config.json 的 maodaoKb 段）：
 *   MAODAO_KB_URL   默认 https://wenan.onecat.xin
 *   MAODAO_KB_TOKEN 猫导侧 KB_API_TOKEN，未配置时工具直接返回「未配置」，不发请求
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import z from "zod"
import { Tool } from "./tool.js"

const DEFAULT_URL = "https://wenan.onecat.xin"
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_QUERY_CHARS = 400
const MAX_K = 8
const CACHE_TTL_MS = 5 * 60_000

interface KbConfig {
  url: string
  token: string
  timeoutMs: number
}

interface KbResponse {
  ok?: boolean
  error?: string
  version?: string
  enabled?: boolean
  index_ready?: boolean
  method_text?: string
  knowledge_text?: string
  method_chars?: number
  knowledge_chars?: number
  reason?: string
  trace_id?: string
}

const cache = new Map<string, { at: number; data: KbResponse }>()

function trimBase(url: string): string {
  return (url || DEFAULT_URL).trim().replace(/\/+$/, "")
}

/**
 * 读配置：环境变量优先；没有就找 config.json 的 maodaoKb 段。
 * 这里不 import chat-core 的 loadConfig —— 工具层被 registry 动态加载，
 * 反过来 import chat-core 容易把启动链绕成环，宁可多这十几行。
 */
function loadKbConfig(): KbConfig {
  const envUrl = (process.env.MAODAO_KB_URL || "").trim()
  const envToken = (process.env.MAODAO_KB_TOKEN || "").trim()
  const envTimeout = Number(process.env.MAODAO_KB_TIMEOUT_MS || 0)

  let cfg: Record<string, any> = {}
  if (!envUrl || !envToken) {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
      path.join(process.cwd(), "config.json"),
      path.join(here, "../../config.json"),
      path.join(here, "../../../config.json"),
    ]
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file)) continue
        const parsed = JSON.parse(fs.readFileSync(file, "utf-8"))
        if (parsed && typeof parsed.maodaoKb === "object") {
          cfg = parsed.maodaoKb
          break
        }
      } catch {
        // 配置坏了不阻断：下面会按「未配置令牌」处理，用户能看到明确原因。
      }
    }
  }

  return {
    url: trimBase(envUrl || cfg.url || DEFAULT_URL),
    token: envToken || String(cfg.token || "").trim(),
    timeoutMs: envTimeout > 0
      ? envTimeout
      : Number(cfg.timeoutMs) > 0
        ? Number(cfg.timeoutMs)
        : DEFAULT_TIMEOUT_MS,
  }
}

function formatKb(data: KbResponse): string {
  const parts: string[] = []
  if (data.method_text?.trim()) parts.push(data.method_text.trim())
  if (data.knowledge_text?.trim()) parts.push(data.knowledge_text.trim())

  if (parts.length === 0) {
    const why =
      data.reason === "disabled"
        ? "猫导知识库当前关闭"
        : data.reason === "knowledge_empty" || data.reason === "method_empty" || data.reason === "empty"
          ? "这一轮没有找到足够相关的知识"
          : "没有返回内容"
    return `猫导知识库：${why}。请按你自己的判断继续，不要编造引用或假装查到了。`
  }

  return [
    parts.join("\n\n"),
    "",
    "——",
    "以上是内部知识，只用来判断和给建议；不要照背原文，不要提「课程里说」或讲师名字。",
    "和用户的实际素材/需求对不上时直接丢掉，不要为了用知识而硬套。",
  ].join("\n")
}

export const MaodaoKbTool = Tool.defineLtxTool("maodao_kb", {
  description:
    "【猫导知识库】检索短视频文案/起号/留人/转化/直播/投放等领域的方法论与知识片段。"
    + "当用户要写口播脚本、标题、钩子、分镜文案，或问「怎么起号」「怎么留人」「怎么提高转化」"
    + "「这个开头怎么写」时使用。"
    + "注意：video_rag_search 查的是当前视频里有什么（画面/事件/时间点），本工具查的是领域方法论，两者不要混用。",
  parameters: z.object({
    query: z.string().describe("要检索的问题，尽量用用户的原话或一句具体的问题"),
    k: z.number().optional().default(4).describe("返回知识片段数，1-8，默认 4"),
    domains: z
      .array(z.string())
      .optional()
      .describe("可选：限定领域（如「短视频文案」「投流」）；不传则由猫导侧自动路由"),
  }),

  execute: async (args, ctx) => {
    const cfg = loadKbConfig()
    if (!cfg.token) {
      return {
        title: "猫导知识库未配置",
        metadata: { error: true, reason: "no_token" },
        output:
          "猫导知识库没有配置令牌（MAODAO_KB_TOKEN 或 config.json 的 maodaoKb.token）。"
          + "这一轮不要引用知识库，按你自己的判断继续。",
        attachments: [],
      }
    }

    const query = (args.query || "").trim().slice(0, MAX_QUERY_CHARS)
    if (!query) {
      return {
        title: "猫导知识库：空查询",
        metadata: { error: true, reason: "empty_query" },
        output: "检索问题为空，没有发起请求。",
        attachments: [],
      }
    }

    const k = Math.max(1, Math.min(Number(args.k) || 4, MAX_K))
    const domains = (args.domains || []).map((d) => d.trim()).filter(Boolean)
    const cacheKey = `${cfg.url}|${query}|${k}|${domains.join(",")}`
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return {
        title: "猫导知识库（缓存）",
        metadata: { success: true, cached: true, version: hit.data.version },
        output: formatKb(hit.data),
        attachments: [],
      }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    const onAbort = () => controller.abort()
    ctx.abort?.addEventListener?.("abort", onAbort)

    try {
      const res = await fetch(`${cfg.url}/api/kb/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KB-Token": cfg.token,
        },
        body: JSON.stringify({ q: query, k, domains }),
        signal: controller.signal,
      })

      const data = (await res.json().catch(() => ({}))) as KbResponse
      if (!res.ok) {
        return {
          title: `猫导知识库不可用（HTTP ${res.status}）`,
          metadata: { error: true, status: res.status, reason: data.reason || data.error },
          output:
            `猫导知识库请求失败：HTTP ${res.status} ${data.error || ""}`.trim()
            + "。这一轮不要引用知识库，按你自己的判断继续。",
          attachments: [],
        }
      }
      if (!data.ok) {
        return {
          title: "猫导知识库检索失败",
          metadata: { error: true, reason: data.error, trace_id: data.trace_id },
          output:
            `猫导知识库检索失败：${data.error || "未知错误"}。`
            + "这一轮不要引用知识库，按你自己的判断继续。",
          attachments: [],
        }
      }

      cache.set(cacheKey, { at: Date.now(), data })
      return {
        title: data.reason ? `猫导知识库（${data.reason}）` : "猫导知识库",
        metadata: {
          success: true,
          version: data.version,
          reason: data.reason,
          index_ready: data.index_ready,
          method_chars: data.method_chars,
          knowledge_chars: data.knowledge_chars,
          trace_id: data.trace_id,
        },
        output: formatKb(data),
        attachments: [],
      }
    } catch (error) {
      const aborted = controller.signal.aborted
      return {
        title: aborted ? "猫导知识库超时" : "猫导知识库连接失败",
        metadata: { error: true, reason: aborted ? "timeout" : "network" },
        output:
          (aborted
            ? `猫导知识库 ${Math.round(cfg.timeoutMs / 1000)} 秒内没有响应。`
            : `连不上猫导知识库：${error instanceof Error ? error.message : String(error)}。`)
          + "这一轮不要引用知识库，按你自己的判断继续。",
        attachments: [],
      }
    } finally {
      clearTimeout(timer)
      ctx.abort?.removeEventListener?.("abort", onAbort)
    }
  },
})

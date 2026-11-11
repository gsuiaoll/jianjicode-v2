/**
 * 猫导配音工具
 *
 * 把镜头旁白按段发给猫导的 `/api/production/tts`，再把音频落盘到
 * `.maodao/tts/<trace_id>/`。猫导侧已经做了音色校验、配额和「全有或全无」，
 * 这里只补三件客户端必须自己负责的事：
 *
 * 1. **路径安全**：segment id 先按白名单校验，再拼路径，防 `../x`；
 * 2. **原子落盘**：先写 `.part` 再改名，失败不留半截文件；
 * 3. **整单失败**：任一段下载/探测失败就清掉整个 trace 目录，不返回半套音频。
 *
 * 注意：当前猫导生产环境若 DashScope 欠费，TTS 会返回 `ok:false tts_failed`；
 * 此时应退回「无配音时间线」，而不是反复重试烧额度。
 *
 * @license MIT
 */

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import z from "zod"
import { Tool } from "./tool.js"
import { loadMaodaoProdConfig, postProdJson } from "./maodao_http.js"
import { findFfmpegPath, getVideoInfo } from "./ffmpeg-utils.js"

const SEG_ID = /^[A-Za-z0-9_-]{1,32}$/
const MAX_SEGMENTS = 20
const MAX_SEGMENT_CHARS = 600
const MAX_TOTAL_CHARS = 3000
const DOWNLOAD_TIMEOUT_MS = 120_000

interface TtsSegment {
  id: string
  text: string
}

interface TtsResponseSegment {
  id: string
  chars?: number
  urls?: string[]
}

interface TtsFile {
  id: string
  path: string
  seconds: number
}

function errorResult(
  title: string,
  metadata: Record<string, any>,
  message: string,
) {
  return {
    title,
    metadata: { error: true, ...metadata },
    output: `${message} 这一轮不要假装已经配好音；可以先用无配音时间线，或修好后再试。`,
    attachments: [] as any[],
  }
}

function validateSegments(raw: TtsSegment[]): string | null {
  if (!raw?.length) return "至少要给一段旁白。"
  if (raw.length > MAX_SEGMENTS) return `一次最多 ${MAX_SEGMENTS} 段旁白。`
  const seen = new Set<string>()
  let total = 0
  for (const seg of raw) {
    const id = (seg?.id || "").trim()
    if (!SEG_ID.test(id)) {
      return `segment id「${id}」不合法：只能用字母、数字、_、-，最多 32 位。`
    }
    if (seen.has(id)) return `segment id 不能重复：${id}。`
    seen.add(id)
    const text = (seg.text || "").trim()
    if (!text) return `第 ${id} 段没有文字。`
    if (text.length > MAX_SEGMENT_CHARS) {
      return `第 ${id} 段 ${text.length} 字，超过单段 ${MAX_SEGMENT_CHARS} 字上限。`
    }
    total += text.length
  }
  if (total > MAX_TOTAL_CHARS) {
    return `总字数 ${total}，超过 ${MAX_TOTAL_CHARS} 字上限，请拆成多次。`
  }
  return null
}

async function downloadTo(
  url: string,
  dest: string,
  signal: AbortSignal,
): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error("音频地址不合法")
  }
  if (parsed.protocol !== "https:") {
    throw new Error("音频地址不是 https，拒绝下载")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener("abort", onAbort)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`下载音频失败：HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) throw new Error("下载到空音频")
    const part = `${dest}.part`
    fs.writeFileSync(part, buf)
    fs.renameSync(part, dest)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", onAbort)
  }
}

function concatMp3(inputs: string[], out: string): void {
  const ffmpeg = findFfmpegPath()
  if (!ffmpeg) throw new Error("找不到 ffmpeg，无法拼接分段音频")

  const listFile = `${out}.concat.txt`
  const lines = inputs.map((file) => {
    const normalized = file.split(path.sep).join("/").replace(/'/g, "'\\''")
    return `file '${normalized}'`
  })
  fs.writeFileSync(listFile, lines.join("\n"), "utf-8")

  try {
    const res = spawnSync(
      ffmpeg,
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out],
      { encoding: "utf8", windowsHide: true },
    )
    if (res.status !== 0) {
      const detail = (res.stderr || "").trim().split("\n").slice(-2).join(" ")
      throw new Error(`拼接音频失败${detail ? `：${detail}` : ""}`)
    }
  } finally {
    fs.rmSync(listFile, { force: true })
  }
}

async function audioSeconds(file: string): Promise<number> {
  const info = await getVideoInfo(file)
  const seconds = Number(info?.data?.format?.duration)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

export const MaodaoTtsTool = Tool.defineLtxTool("maodao_tts", {
  description:
    "【猫导配音】把镜头旁白按段合成语音，落到项目 .maodao/tts/ 下并返回每段音频路径与时长。"
    + "要求猫导制作 API 可用且百炼未欠费；任一段失败会整单失败，不留半套音频。",
  parameters: z.object({
    segments: z.array(z.object({
      id: z.string().describe("段 id，只能用字母/数字/_/-，最多 32 位，例如 s1"),
      text: z.string().describe("要合成的旁白，单段最多 600 字"),
    })).min(1).max(MAX_SEGMENTS).describe("按镜头顺序给出的旁白段"),
    voice: z.string().optional().describe("音色名，先查 /api/production/tts/voices；不传用服务端默认"),
  }),

  execute: async (args, ctx) => {
    const cfg = loadMaodaoProdConfig(200_000)
    if (!cfg.token) {
      return errorResult(
        "猫导配音未配置",
        { reason: "no_token" },
        "猫导制作 API 没有配置令牌（MAODAO_PROD_TOKEN 或 config.json 的 maodaoProduction.token）。",
      )
    }

    const segments: TtsSegment[] = (args.segments || []).map((seg) => ({
      id: (seg.id || "").trim(),
      text: (seg.text || "").trim(),
    }))
    const invalid = validateSegments(segments)
    if (invalid) {
      return errorResult("猫导配音：参数不合法", { reason: "invalid_input" }, invalid)
    }

    const body: Record<string, any> = { segments }
    if (args.voice?.trim()) body.voice = args.voice.trim()

    const result = await postProdJson("/api/production/tts", body, cfg, ctx.abort)
    if (result.kind === "canceled") {
      return errorResult("猫导配音已取消", { reason: "canceled" }, "用户取消了这次配音。")
    }
    if (result.kind === "timeout") {
      return errorResult(
        "猫导配音超时",
        { reason: "timeout" },
        `猫导配音 ${Math.round(cfg.timeoutMs / 1000)} 秒内没有返回；段数多时会超时，可拆成两批。`,
      )
    }
    if (result.kind === "network") {
      return errorResult(
        "猫导配音连接失败",
        { reason: "network" },
        `连不上猫导制作 API：${result.message}。`,
      )
    }

    const data = result.data || {}
    const error = data.error
    const errCode = typeof error === "string" ? error : error?.code
    const errMsg = typeof error === "string" ? error : error?.message

    if (result.kind === "http") {
      return errorResult(
        `猫导配音不可用（HTTP ${result.status}）`,
        { status: result.status, code: errCode, traceId: data.trace_id },
        `猫导配音请求失败：HTTP ${result.status} ${errMsg || ""}`.trim() + "。",
      )
    }
    if (!data.ok) {
      const failedIds = Array.isArray(data.failed_ids) ? data.failed_ids : []
      return errorResult(
        "猫导配音失败",
        { code: errCode, traceId: data.trace_id, failedIds },
        `猫导配音失败：${errMsg || "未知错误"}${failedIds.length ? `（失败段：${failedIds.join(", ")}）` : ""}。`,
      )
    }

    const returned: TtsResponseSegment[] = Array.isArray(data.segments) ? data.segments : []
    const byId = new Map(returned.map((seg) => [seg.id, seg]))
    const missing = segments.filter((seg) => !byId.get(seg.id)?.urls?.length).map((seg) => seg.id)
    if (missing.length) {
      return errorResult(
        "猫导配音结果不完整",
        { code: "incomplete_result", traceId: data.trace_id, failedIds: missing },
        `猫导返回成功，但缺少这些段的音频：${missing.join(", ")}。`,
      )
    }

    const rawTrace = typeof data.trace_id === "string" ? data.trace_id : ""
    const traceId = rawTrace.replace(/[^A-Za-z0-9_-]/g, "")
    const dirName = traceId || randomUUID()
    const outDir = path.join(process.cwd(), ".maodao", "tts", dirName)
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(outDir, { recursive: true })

    try {
      const files: TtsFile[] = []
      for (const seg of segments) {
        if (ctx.abort?.aborted) throw new Error("__canceled__")
        const urls = byId.get(seg.id)!.urls!
        const target = path.join(outDir, `${seg.id}.mp3`)
        if (!target.startsWith(outDir + path.sep)) {
          throw new Error(`segment id 越界：${seg.id}`)
        }

        if (urls.length === 1) {
          await downloadTo(urls[0], target, ctx.abort)
        } else {
          const chunks: string[] = []
          try {
            for (let i = 0; i < urls.length; i += 1) {
              if (ctx.abort?.aborted) throw new Error("__canceled__")
              const chunk = path.join(outDir, `${seg.id}.part${i}.mp3`)
              await downloadTo(urls[i], chunk, ctx.abort)
              chunks.push(chunk)
            }
            concatMp3(chunks, target)
          } finally {
            for (const chunk of chunks) fs.rmSync(chunk, { force: true })
          }
        }

        const seconds = await audioSeconds(target)
        if (!seconds) throw new Error(`${seg.id} 的音频读不出时长`)
        files.push({ id: seg.id, path: target, seconds })
      }

      const totalSeconds = files.reduce((sum, f) => sum + f.seconds, 0)
      const lines = [
        `【猫导配音】${data.voice || args.voice || "默认音色"} · ${files.length} 段 · 共 ${totalSeconds.toFixed(1)}s`,
      ]
      for (const file of files) {
        lines.push(`${file.id} · ${file.seconds.toFixed(2)}s · ${file.path}`)
      }
      lines.push("", "```json", JSON.stringify({
        ok: true,
        trace_id: data.trace_id,
        voice: data.voice,
        files,
      }, null, 2), "```")

      return {
        title: `猫导配音：${files.length} 段`,
        metadata: {
          success: true,
          traceId: data.trace_id,
          voice: data.voice,
          dir: outDir,
          totalSeconds,
          files,
        },
        output: lines.join("\n"),
        attachments: [],
      }
    } catch (error) {
      fs.rmSync(outDir, { recursive: true, force: true })
      if ((error as Error)?.message === "__canceled__") {
        return errorResult("猫导配音已取消", { reason: "canceled" }, "用户取消了这次配音。")
      }
      return errorResult(
        "猫导配音落盘失败",
        { reason: "download_failed", traceId: data.trace_id },
        `音频已经合成，但下载/探测失败：${(error as Error)?.message || String(error)}。`,
      )
    }
  },
})

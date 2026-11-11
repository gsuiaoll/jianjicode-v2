/**
 * 猫导远程 API 的公共 HTTP 层。
 *
 * `maodao_kb` / `maodao_plan` / `maodao_tts` 都要做同样四件事：
 * 读配置（环境变量 > config.json）、带令牌请求、超时 + 取消、把网络异常归一化。
 * 放在这里，避免每个工具各抄一份、各漏一处。
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_URL = "https://wenan.onecat.xin"

export interface MaodaoProdConfig {
  url: string
  token: string
  timeoutMs: number
}

export type ProdFetchResult =
  | { kind: "ok"; status: number; data: any }
  | { kind: "http"; status: number; data: any }
  | { kind: "canceled" }
  | { kind: "timeout" }
  | { kind: "network"; message: string }

function trimBase(url: string): string {
  return (url || DEFAULT_URL).trim().replace(/\/+$/, "")
}

/**
 * 读制作 API 配置：环境变量优先；没有就找 config.json 的 maodaoProduction 段。
 * 不 import chat-core 的 loadConfig —— 工具层被 registry 动态加载，反向 import 容易成环。
 */
export function loadMaodaoProdConfig(defaultTimeoutMs = 170_000): MaodaoProdConfig {
  const envUrl = (process.env.MAODAO_PROD_URL || process.env.MAODAO_KB_URL || "").trim()
  const envToken = (process.env.MAODAO_PROD_TOKEN || "").trim()
  const envTimeout = Number(process.env.MAODAO_PROD_TIMEOUT_MS || 0)

  let cfg: Record<string, any> = {}
  if (!envUrl || !envToken || !(envTimeout > 0)) {
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
        if (parsed && typeof parsed.maodaoProduction === "object") {
          cfg = parsed.maodaoProduction
          break
        }
      } catch {
        // 配置坏了不阻断：下面按「未配置令牌」处理，用户能看到明确原因。
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
        : defaultTimeoutMs,
  }
}

/**
 * POST JSON 到猫导制作 API。
 *
 * 只有「拿到 HTTP 响应」才返回 `ok` / `http`；超时、用户取消、连不上都单独成态，
 * 让调用方能决定是提示重试、还是明确说「用户取消了」。
 */
export async function postProdJson(
  apiPath: string,
  payload: unknown,
  cfg: MaodaoProdConfig,
  externalSignal?: AbortSignal,
): Promise<ProdFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  const onAbort = () => controller.abort()
  if (externalSignal?.aborted) controller.abort()
  externalSignal?.addEventListener?.("abort", onAbort)

  try {
    const res = await fetch(`${cfg.url}${apiPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Prod-Token": cfg.token,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    return res.ok
      ? { kind: "ok", status: res.status, data }
      : { kind: "http", status: res.status, data }
  } catch (error) {
    if (externalSignal?.aborted) return { kind: "canceled" }
    if (controller.signal.aborted) return { kind: "timeout" }
    return {
      kind: "network",
      message: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener?.("abort", onAbort)
  }
}

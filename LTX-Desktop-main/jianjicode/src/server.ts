/**
 * jianjicode HTTP 服务
 *
 * 基于 Hono/Bun 的常驻 HTTP 服务，提供：
 *   GET  /health             健康检查
 *   POST /chat               聊天（JSON 响应）
 *   POST /chat/stream        聊天（SSE 流式响应）
 *
 * 所有业务逻辑委托给 src/core/chat-core.ts。
 */

import net from "node:net"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import type { StreamEvent } from "./core/agent-loop.js"
import { type ChatCallbacks, processChatRequest } from "./core/chat-core.js"
import { getLatestReport } from "./core/curator.js"
import { startReviewScheduler } from "./core/curator-scheduler.js"
import {
  clearNudges,
  drainPendingNudges,
  getRecentNudges,
  hasPendingNudges,
} from "./core/nudge-service.js"
import { getGlobalPermissionService } from "./permission/service.js"
import type { ReplyInput } from "./permission/types.js"
import { createAuthMiddleware } from "./auth/middleware.js"
import { constantTimeEqual, generateToken, hashToken } from "./auth/types.js"
import type { TokenStore } from "./auth/types.js"

// ============================================================================
// 端口工具
// ============================================================================

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, "127.0.0.1")
  })
}

async function findAvailablePort(
  startPort: number,
  maxAttempts = 10,
): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await checkPort(port)) return port
  }
  throw new Error(
    `No available port in range ${startPort}-${startPort + maxAttempts}`,
  )
}

// ============================================================================
// 配置
// ============================================================================

const USER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : null
const DEFAULT_PORT = 3001
const HOST = process.env.HOST || "0.0.0.0"

let PORT = DEFAULT_PORT

// ============================================================================
// 应用（导出以便测试直接调用 app.fetch）
// ============================================================================

export const app = new Hono()

// 全局错误处理
app.onError((err, c) => {
  console.error(`[server] Unhandled error:`, err)
  return c.json({ success: false, error: "Internal server error" }, 500)
})

// CORS — 允许 LTX 后端等客户端跨域调用
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
)

// ============================================================================
// 健康检查（必须在认证中间件之前定义，/health 豁免认证）
// ============================================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    version: "0.1.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    models_loaded: true,
    gpu_info: { name: "web-preview", vram: 0, vram_used: 0 },
  })
})

// ============================================================================
// 认证中间件
// 在 /health 之后、所有业务路由之前注册。getStore() 在 main() 中初始化。
// ============================================================================

let _tokenStore: TokenStore | null = null

app.use(
  "*",
  createAuthMiddleware(() => {
    if (!_tokenStore) throw new Error("TokenStore not initialized — call main() first")
    return _tokenStore
  }, ["/health"]),
)

// ============================================================================
// Token 轮换端点（需通过认证中间件验证旧 token）
// ============================================================================

app.post("/auth/refresh", async (c) => {
  const newToken = generateToken()
  const oldStore = _tokenStore
  _tokenStore = new MemoryTokenStore(newToken)

  // 三秒后撤销旧 token，给客户端缓冲时间
  if (oldStore) {
    setTimeout(() => oldStore.revoke(), 3000)
  }

  // stdout 输出新 token 给 Electron
  process.stdout.write(
    JSON.stringify({ type: "token_refresh", token: newToken }) + "\n",
  )

  console.error(`[auth] Token refreshed (requestId: ${c.res.headers.get("X-Request-ID")})`)
  return c.json({ success: true, token: newToken })
})

// ============================================================================
// Mock LTX API 端点（web 预览用）
// ============================================================================

app.get("/api/runtime-policy", (c) => {
  return c.json({ force_api_generations: false })
})

app.get("/api/settings", (c) => {
  return c.json({
    useTorchCompile: false,
    loadOnStartup: true,
    hasLtxApiKey: true,
    userPrefersLtxApiVideoGenerations: true,
    hasFalApiKey: false,
    hasGeminiApiKey: false,
    useLocalTextEncoder: false,
    fastModel: { useUpscaler: true },
    proModel: { steps: 20, useUpscaler: true },
    promptCacheSize: 1,
    promptEnhancerEnabledT2V: false,
    promptEnhancerEnabledI2V: false,
    seedLocked: false,
    lockedSeed: 42,
    modelsDir: "",
  })
})

app.post("/api/settings", (c) => {
  return c.json({ success: true })
})

app.get("/api/models/status", (c) => {
  return c.json({ all_downloaded: true })
})

app.get("/api/models", (c) => {
  return c.json({ models: [] })
})

// ============================================================================
// 聊天（JSON 响应）
// ============================================================================

app.post("/chat", async (c) => {
  const body = await c.req.json()
  const message = body.message
  if (!message || typeof message !== "string") {
    return c.json(
      { success: false, error: "Missing or invalid 'message' field" },
      400,
    )
  }

  const args = { ...(body.args || {}) }
  const result = await processChatRequest(message, args)

  return c.json(result)
})

// ============================================================================
// 聊天（SSE 流式响应）
// ============================================================================
//
// 客户端可通过 EventSource 或 fetch + ReadableStream 消费。
// 事件类型:
//   log      — 调试日志  { message: string }
//   progress — 进度通知  { step: string, detail?: string }
//   result   — 最终结果  { success, data, error }

app.post("/chat/stream", async (c) => {
  const body = await c.req.json()
  const message = body.message
  if (!message || typeof message !== "string") {
    return c.json(
      { success: false, error: "Missing or invalid 'message' field" },
      400,
    )
  }

  const args = { ...(body.args || {}) }

  return streamSSE(c, async (sseStream) => {
    const callbacks: ChatCallbacks = {
      onLog: (msg) => {
        sseStream.writeSSE({ event: "log", data: msg })
      },
      onProgress: (step, detail) => {
        sseStream.writeSSE({
          event: "progress",
          data: JSON.stringify({ step, detail }),
        })
      },
      onStream: (event: StreamEvent) => {
        sseStream.writeSSE({
          event: "stream",
          data: JSON.stringify(event),
        })
        // nudge 事件也作为独立事件发送，方便前端监听
        if (event.type === "nudge") {
          sseStream.writeSSE({
            event: "nudge",
            data: JSON.stringify(event.nudge),
          })
        }
      },
    }

    const result = await processChatRequest(message, args, callbacks)
    await sseStream.writeSSE({
      event: "result",
      data: JSON.stringify(result),
    })
  })
})

// ============================================================================
// LTX 前端兼容的聊天端点（含 path prefix /api/jianjicode）
// LTX-Desktop 的前端通过 backendFetch('/api/jianjicode/chat') 调用，
// 直连模式（绕过 Python 代理）时使用此端点。
// ============================================================================

app.post("/api/jianjicode/chat", async (c) => {
  const body = await c.req.json()
  const message = body.message || body.prompt
  if (!message || typeof message !== "string") {
    return c.json(
      { success: false, error: "Missing or invalid 'message' field" },
      400,
    )
  }

  const args = { ...(body.args || {}), editorContext: body.editorContext }
  const result = await processChatRequest(message, args)

  return c.json(result)
})

app.post("/api/jianjicode/chat/stream", async (c) => {
  const body = await c.req.json()
  const message = body.message || body.prompt
  if (!message || typeof message !== "string") {
    return c.json(
      { success: false, error: "Missing or invalid 'message' field" },
      400,
    )
  }

  const args = { ...(body.args || {}), editorContext: body.editorContext }

  return streamSSE(c, async (sseStream) => {
    const callbacks: ChatCallbacks = {
      onLog: (msg) => {
        sseStream.writeSSE({ event: "log", data: msg })
      },
      onProgress: (step, detail) => {
        sseStream.writeSSE({
          event: "progress",
          data: JSON.stringify({ step, detail }),
        })
      },
      onStream: (event: StreamEvent) => {
        sseStream.writeSSE({
          event: "stream",
          data: JSON.stringify(event),
        })
        // nudge 事件也作为独立事件发送，方便前端监听
        if (event.type === "nudge") {
          sseStream.writeSSE({
            event: "nudge",
            data: JSON.stringify(event.nudge),
          })
        }
      },
    }

    const result = await processChatRequest(message, args, callbacks)
    await sseStream.writeSSE({
      event: "result",
      data: JSON.stringify(result),
    })
  })
})

// ============================================================================
// 权限回复端点
// ============================================================================

app.post("/permission/reply", async (c) => {
  const body = await c.req.json()
  const { requestID: rid, action } = body

  if (!rid || !action) {
    return c.json(
      { success: false, error: "Missing 'requestID' or 'action'" },
      400,
    )
  }

  const validActions = ["allow_once", "allow_always", "deny", "reject"]
  if (!validActions.includes(action)) {
    return c.json(
      {
        success: false,
        error: `Invalid action '${action}'. Must be one of: ${validActions.join(", ")}`,
      },
      400,
    )
  }

  try {
    const svc = getGlobalPermissionService()
    const pending = svc.getPending(rid)
    if (!pending) {
      return c.json(
        {
          success: false,
          error: `No pending permission request: ${rid} (may have timed out)`,
        },
        410,
      )
    }
    svc.reply({ requestID: rid, action, feedback: body.feedback })
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================================
// 意图识别回复端点
// ============================================================================

app.post("/api/jianjicode/intent-response", async (c) => {
  const body = await c.req.json()
  const { formId, selectedIntent, additionalInfo, sessionId } = body

  if (!formId || !selectedIntent) {
    return c.json(
      { success: false, error: "Missing 'formId' or 'selectedIntent'" },
      400,
    )
  }

  try {
    const { appendUserMessage } = await import("./core/chat-session.js")
    let intentMessage = `[用户意图选择] 选择了: ${selectedIntent}`
    if (additionalInfo) {
      intentMessage += `\n补充信息: ${additionalInfo}`
    }
    if (sessionId) {
      appendUserMessage(sessionId, intentMessage)
    }
    return c.json({ success: true, formId, selectedIntent })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================================
// Nudge 端点 — 技能创建建议 / 优化报告
// ============================================================================

app.get("/nudges", (c) => {
  try {
    const nudges = getRecentNudges()
    return c.json({ success: true, data: nudges })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

app.post("/nudges/clear", (c) => {
  try {
    clearNudges()
    return c.json({ success: true })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================================
// Nudge 实时推送（SSE）
// ============================================================================
//
// 前端可通过 EventSource('/nudges/stream') 订阅实时 nudge 事件。
// 连接保持 5 分钟后自动断开。

app.get("/nudges/stream", async (c) => {
  return streamSSE(c, async (sseStream) => {
    // 发送初始连接确认
    await sseStream.writeSSE({
      event: "connected",
      data: JSON.stringify({ timestamp: new Date().toISOString() }),
    })

    // 每 5 秒检查一次是否有新 nudge
    const interval = setInterval(async () => {
      try {
        if (hasPendingNudges()) {
          const nudges = drainPendingNudges()
          for (const nudge of nudges) {
            await sseStream.writeSSE({
              event: "nudge",
              data: JSON.stringify(nudge),
            })
          }
        } else {
          // 发送心跳保持连接
          await sseStream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ ts: Date.now() }),
          })
        }
      } catch {
        clearInterval(interval)
      }
    }, 5000)

    // 5 分钟超时自动断开
    const timeout = setTimeout(() => {
      clearInterval(interval)
      sseStream.close()
    }, 300_000)

    // 客户端断开时清理
    sseStream.onAbort(() => {
      clearInterval(interval)
      clearTimeout(timeout)
    })
  })
})

// ============================================================================
// Session History 端点 — 前端历史记录回看功能
// ============================================================================

app.get("/api/jianjicode/sessions", async (c) => {
  try {
    const { getSessionStore } = await import("./core/chat-session.js")
    const store = getSessionStore()
    if (!store) {
      return c.json({ success: true, data: [] })
    }
    const ids = store.listActive()
    const sessions = ids.map((id) => {
      const meta = store.readMeta(id)
      const messages = store.read(id)
      return {
        id,
        createdAt: meta?.createdAt || new Date().toISOString(),
        lastActive: meta?.lastActive || new Date().toISOString(),
        messageCount: messages.length,
        preview: messages.slice(0, 2).map((m) => ({
          role: m.role,
          snippet:
            typeof m.content === "string"
              ? m.content.slice(0, 120)
              : "[multimodal content]",
        })),
        hasCompactedSummary: !!meta?.compactedSummary,
      }
    })
    sessions.sort(
      (a, b) =>
        new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime(),
    )
    return c.json({ success: true, data: sessions })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

app.get("/api/jianjicode/sessions/:id", async (c) => {
  try {
    const sessionId = c.req.param("id")
    const { getSessionStore } = await import("./core/chat-session.js")
    const store = getSessionStore()
    if (!store) {
      return c.json(
        { success: false, error: "Session store not available" },
        500,
      )
    }
    const messages = store.read(sessionId)
    const meta = store.readMeta(sessionId)
    if (messages.length === 0 && !meta) {
      return c.json({ success: false, error: "Session not found" }, 404)
    }
    return c.json({
      success: true,
      data: {
        id: sessionId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          toolName: m.toolName,
          toolCallId: m.toolCallId,
        })),
        createdAt: meta?.createdAt || new Date().toISOString(),
        lastActive: meta?.lastActive || new Date().toISOString(),
        compactedSummary: meta?.compactedSummary,
      },
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================================
// Curator 报告端点
// ============================================================================

app.get("/curator/report", (c) => {
  try {
    const report = getLatestReport()
    return c.json({ success: true, data: report })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================================================
// LTX 代理路由 — 桥接到 LTX 后端 (FastAPI, port 8000)
// ============================================================================

const LTX_BASE = process.env.LTX_API_BASE_URL || "http://localhost:8000"

/** 健康检查代理 — 揭示 LTX 可用性 */
app.get("/api/ltx/health", async (c) => {
  try {
    const response = await fetch(`${LTX_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return c.json(
        {
          status: "unhealthy",
          ltx_url: LTX_BASE,
          error: `LTX returned HTTP ${response.status}`,
        },
        502,
      )
    }
    const ltxHealth = await response.json()
    return c.json({
      status: "ok",
      ltx: ltxHealth,
      proxy: "jianjicode",
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return c.json(
      { status: "unreachable", ltx_url: LTX_BASE, error: error.message },
      503,
    )
  }
})

/** 编辑 API POST 代理 — 转发到 LTX /api/edit/* */
app.post("/api/edit/*", async (c) => {
  const path = c.req.path
  const url = `${LTX_BASE}${path}`
  try {
    const body = await c.req.json()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (process.env.LTX_API_KEY)
      headers["Authorization"] = `Bearer ${process.env.LTX_API_KEY}`
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    const data = await response.json()
    return c.json(data, response.status as any)
  } catch (error: any) {
    return c.json(
      { success: false, error: `LTX proxy error: ${error.message}` },
      502,
    )
  }
})

/** 编辑 API GET 代理（video_info 等查询端点） */
app.get("/api/edit/*", async (c) => {
  const path = c.req.path
  const queryString = new URLSearchParams(c.req.query()).toString()
  const url = `${LTX_BASE}${path}${queryString ? `?${queryString}` : ""}`
  try {
    const headers: Record<string, string> = {}
    if (process.env.LTX_API_KEY)
      headers["Authorization"] = `Bearer ${process.env.LTX_API_KEY}`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    return c.json(data, response.status as any)
  } catch (error: any) {
    return c.json(
      { success: false, error: `LTX proxy error: ${error.message}` },
      502,
    )
  }
})

// ============================================================================
// 启动
// ============================================================================

/** 内存 TokenStore — 存储哈希值用于比对，持有明文用于 stdout 输出 */
class MemoryTokenStore implements TokenStore {
  readonly createdAt: number
  private hashedToken: string
  private plainToken: string
  private revoked = false
  private readonly ttlMs: number

  constructor(plainToken: string, ttlMs: number = 24 * 60 * 60 * 1000) {
    this.createdAt = Date.now()
    this.plainToken = plainToken
    this.hashedToken = hashToken(plainToken)
    this.ttlMs = ttlMs
  }

  validate(rawToken: string): boolean {
    if (this.revoked || this.isExpired()) return false
    return constantTimeEqual(hashToken(rawToken), this.hashedToken)
  }

  getToken(): string {
    return this.plainToken
  }

  revoke(): void {
    this.revoked = true
  }

  isExpired(): boolean {
    return Date.now() > this.createdAt + this.ttlMs
  }
}

async function main() {
  // 解析端口（用户显式指定则固定，否则自动探测）
  if (USER_PORT) {
    if (!(await checkPort(USER_PORT))) {
      console.error(`[server] Port ${USER_PORT} is already in use. Exiting.`)
      process.exit(1)
    }
    PORT = USER_PORT
  } else {
    PORT = await findAvailablePort(DEFAULT_PORT)
    if (PORT !== DEFAULT_PORT) {
      console.error(`[server] Port ${DEFAULT_PORT} in use, using ${PORT}`)
    }
  }

  // 生成 token 并初始化认证中间件
  const token = generateToken()
  _tokenStore = new MemoryTokenStore(token)

  // stdout 握手（JSON → Electron 解析）
  // 日志全部走 stderr，stdout 专用于 IPC 握手数据
  const nonce = process.env.JIANJICODE_NONCE
  if (!nonce) {
    console.error(`[auth] No JIANJICODE_NONCE env var — dev mode`)
    console.error(`[auth] Token: ${token}`)
  }
  process.stdout.write(
    JSON.stringify({ type: "ready", nonce, token, port: PORT }) + "\n",
  )

  console.error(`[server] jianjicode HTTP Service on http://${HOST}:${PORT}`)

  Bun.serve({
    fetch: app.fetch,
    port: PORT,
    hostname: HOST,
  })

  // 启动 Curator 定期审查调度器（默认 7 天间隔，立即执行首次检查）
  try {
    startReviewScheduler()
    console.error("[server] Curator review scheduler started")
  } catch (error: any) {
    console.error(`[server] Failed to start curator scheduler: ${error.message}`)
  }

  // 优雅关闭
  process.on("SIGINT", () => {
    console.error("\n[server] Shutting down...")
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    process.exit(0)
  })
}

const isMainModule =
  process.argv[1]?.endsWith("server.ts") ||
  process.argv[1]?.endsWith("server.js")

if (isMainModule) {
  main()
}

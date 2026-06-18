/**
 * 测试 Hono app 工厂 — 对标 opencode-dev test/server/* 的 app() 辅助函数
 *
 * 构建与 server.ts 路由结构一致的 Hono 应用，但所有外部依赖均可注入。
 * 测试直接调用 app.request() 不发网络请求，快且隔离。
 *
 * @example
 *   const { app, token } = createTestApp()
 *   const res = await app.request("/health")
 *   expect(res.status).toBe(200)
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import type { TokenStore } from "../../auth/types.js"
import { createAuthMiddleware } from "../../auth/middleware.js"
import { AuthRateLimiter } from "../../auth/rate-limiter.js"
import { generateToken } from "../../auth/types.js"
import { TestTokenStore } from "./test-token-store.js"

// ============================================================================
// 选项类型
// ============================================================================

export interface TestChatCallbacks {
  onLog?: (msg: string) => void
  onProgress?: (step: string, detail?: string) => void
  onStream?: (event: any) => void
}

export interface TestServerOptions {
  /** 预生成的 token，不传则自动生成 */
  token?: string
  /** 模拟 token 已过期 */
  tokenExpired?: boolean
  /** 模拟 token 已撤销 */
  tokenRevoked?: boolean
  /** 模拟 processChatRequest 的返回值 */
  mockChatResult?: object | ((message: string, args: Record<string, unknown>) => object)
  /** 模拟 processChatRequest 流式调用，调用 callbacks 来模拟 SSE 事件 */
  mockChatStream?: (message: string, args: Record<string, unknown>, callbacks: TestChatCallbacks) => Promise<object>
  /** 模拟权限服务 */
  mockPermissionService?: {
    getPending: (requestID: string) => unknown
    reply: (input: { requestID: string; action: string; feedback?: string }) => void
  }
  /** 模拟 nudge 服务的值 */
  mockNudges?: unknown[]
  /** 模拟 curator 报告 */
  mockCuratorReport?: object | null
  /** LTX 基础 URL */
  ltxBaseUrl?: string
  /** 是否包含认证中间件，默认 true */
  authEnabled?: boolean
  /** CORS 豁免路径 */
  exemptPaths?: string[]
}

export interface TestAppResult {
  app: Hono
  token: string
  store: TestTokenStore
  options: TestServerOptions
}

// ============================================================================
// 工厂函数
// ============================================================================

export function createTestApp(options: TestServerOptions = {}): TestAppResult {
  const plainToken = options.token ?? generateToken()
  const initialStore = new TestTokenStore(plainToken)
  if (options.tokenExpired) initialStore.setExpired(true)
  if (options.tokenRevoked) initialStore.revoke()

  // 持有当前 + 宽限期内旧 store，中间件校验全部活跃 store
  const activeStores: TestTokenStore[] = [initialStore]
  const storeProxy: TokenStore = {
    get createdAt() { return activeStores[0].createdAt },
    validate(raw: string) {
      for (const s of activeStores) {
        if (s.validate(raw)) return true
      }
      return false
    },
    getToken() { return activeStores[0].getToken() },
    revoke() { activeStores.forEach((s) => s.revoke()) },
    isExpired() { return activeStores.every((s) => s.isExpired()) },
  }

  const exemptPaths = options.exemptPaths ?? ["/health"]

  const app = new Hono()

  // 全局错误处理
  app.onError((err, _c) => {
    console.error(`[test-server] Unhandled error:`, err)
    return Response.json({ success: false, error: "Internal server error" }, { status: 500 })
  })

  // CORS
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }))

  // ==========================================================================
  // Health（在认证中间件之前，豁免路径）
  // ==========================================================================

  app.get("/health", (c) =>
    c.json({ status: "ok", version: "0.1.0", uptime: process.uptime(), timestamp: new Date().toISOString() }))

  // ==========================================================================
  // 认证中间件
  // ==========================================================================

  if (options.authEnabled !== false) {
    app.use("*", createAuthMiddleware(() => storeProxy, exemptPaths, new AuthRateLimiter()))
  }

  // ==========================================================================
  // Token 轮换
  // ==========================================================================

  app.post("/auth/refresh", async (c) => {
    const newToken = generateToken()
    const newStore = new TestTokenStore(newToken)
    activeStores.unshift(newStore)
    // 3 秒后撤销并移除旧 store（保留最新的一个）
    const oldStore = activeStores[activeStores.length - 1]
    setTimeout(() => {
      oldStore.revoke()
      const idx = activeStores.indexOf(oldStore)
      if (idx >= 0) activeStores.splice(idx, 1)
    }, 3000)
    return c.json({ success: true, token: newToken })
  })

  // ==========================================================================
  // Mock LTX API 端点
  // ==========================================================================

  app.get("/api/runtime-policy", (c) => c.json({ force_api_generations: false }))
  app.get("/api/settings", (c) =>
    c.json({ useTorchCompile: false, loadOnStartup: true, hasLtxApiKey: true, fastModel: { useUpscaler: true }, proModel: { steps: 20, useUpscaler: true } }))
  app.post("/api/settings", (c) => c.json({ success: true }))
  app.get("/api/models/status", (c) => c.json({ all_downloaded: true }))
  app.get("/api/models", (c) => c.json({ models: [] }))

  // ==========================================================================
  // Chat 端点
  // ==========================================================================

  const resolveChatResult = async (body: any) => {
    const message = body.message
    if (!message || typeof message !== "string") {
      return { status: 400, body: { success: false, error: "Missing or invalid 'message' field" } }
    }
    if (options.mockChatResult) {
      const result = typeof options.mockChatResult === "function"
        ? (options.mockChatResult as Function)(message, body.args ?? {})
        : options.mockChatResult
      return { status: 200, body: result }
    }
    return { status: 200, body: { success: true, output: `Echo: ${message}`, sessionId: "test-session" } }
  }

  app.post("/chat", async (c) => {
    const body = await c.req.json()
    const resolved = await resolveChatResult(body)
    return c.json(resolved.body, resolved.status as any)
  })

  // SSE 流式
  app.post("/chat/stream", async (c) => {
    const body = await c.req.json()
    const message = body.message
    if (!message || typeof message !== "string") {
      return c.json({ success: false, error: "Missing or invalid 'message' field" }, 400)
    }

    return streamSSE(c, async (sseStream) => {
      if (options.mockChatStream) {
        const callbacks: TestChatCallbacks = {
          onLog: (msg) => sseStream.writeSSE({ event: "log", data: msg }),
          onProgress: (step, detail) => sseStream.writeSSE({ event: "progress", data: JSON.stringify({ step, detail }) }),
          onStream: (event) => sseStream.writeSSE({ event: "stream", data: JSON.stringify(event) }),
        }
        const result = await options.mockChatStream(message, body.args ?? {}, callbacks)
        await sseStream.writeSSE({ event: "result", data: JSON.stringify(result) })
      } else {
        await sseStream.writeSSE({ event: "log", data: `Processing: ${message}` })
        await sseStream.writeSSE({ event: "progress", data: JSON.stringify({ step: "init", detail: "Starting" }) })
        await sseStream.writeSSE({ event: "result", data: JSON.stringify({ success: true, output: `Echo: ${message}` }) })
      }
    })
  })

  // LTX 前缀聊天端点
  app.post("/api/jianjicode/chat", async (c) => {
    const body = await c.req.json()
    const message = body.message || body.prompt
    if (!message || typeof message !== "string") {
      return c.json({ success: false, error: "Missing or invalid 'message' field" }, 400)
    }
    const resolved = await resolveChatResult({ message, args: body.args ?? {} })
    return c.json(resolved.body, resolved.status as any)
  })

  app.post("/api/jianjicode/chat/stream", async (c) => {
    const body = await c.req.json()
    const message = body.message || body.prompt
    if (!message || typeof message !== "string") {
      return c.json({ success: false, error: "Missing or invalid 'message' field" }, 400)
    }
    return streamSSE(c, async (sseStream) => {
      if (options.mockChatStream) {
        const callbacks: TestChatCallbacks = {
          onLog: (msg) => sseStream.writeSSE({ event: "log", data: msg }),
          onProgress: (step, detail) => sseStream.writeSSE({ event: "progress", data: JSON.stringify({ step, detail }) }),
          onStream: (event) => sseStream.writeSSE({ event: "stream", data: JSON.stringify(event) }),
        }
        const result = await options.mockChatStream(message, body.args ?? {}, callbacks)
        await sseStream.writeSSE({ event: "result", data: JSON.stringify(result) })
      } else {
        await sseStream.writeSSE({ event: "log", data: `Processing: ${message}` })
        await sseStream.writeSSE({ event: "result", data: JSON.stringify({ success: true, output: `Echo: ${message}` }) })
      }
    })
  })

  // ==========================================================================
  // 权限回复
  // ==========================================================================

  app.post("/permission/reply", async (c) => {
    const body = await c.req.json()
    const { requestID: rid, action } = body

    if (!rid || !action) {
      return c.json({ success: false, error: "Missing 'requestID' or 'action'" }, 400)
    }

    const validActions = ["allow_once", "allow_always", "deny", "reject"]
    if (!validActions.includes(action)) {
      return c.json({ success: false, error: `Invalid action '${action}'. Must be one of: ${validActions.join(", ")}` }, 400)
    }

    if (options.mockPermissionService) {
      const pending = options.mockPermissionService.getPending(rid)
      if (!pending) {
        return c.json({ success: false, error: `No pending permission request: ${rid} (may have timed out)` }, 410)
      }
      options.mockPermissionService.reply({ requestID: rid, action, feedback: body.feedback })
      return c.json({ success: true })
    }

    return c.json({ success: false, error: `No pending permission request: ${rid} (may have timed out)` }, 410)
  })

  // ==========================================================================
  // Nudge 端点
  // ==========================================================================

  app.get("/nudges", (c) => {
    const nudges = options.mockNudges ?? []
    return c.json({ success: true, data: nudges })
  })

  app.post("/nudges/clear", (c) => {
    return c.json({ success: true })
  })

  // ==========================================================================
  // Nudge SSE 流
  // ==========================================================================

  app.get("/nudges/stream", async (c) => {
    return streamSSE(c, async (sseStream) => {
      await sseStream.writeSSE({ event: "connected", data: JSON.stringify({ timestamp: new Date().toISOString() }) })

      // 心跳 — 1 秒间隔（测试环境下使用更短间隔）
      const heartbeat = setInterval(async () => {
        try {
          await sseStream.writeSSE({ event: "heartbeat", data: JSON.stringify({ ts: Date.now() }) })
        } catch {
          clearInterval(heartbeat)
        }
      }, 1000)

      sseStream.onAbort(() => clearInterval(heartbeat))

      // 10 秒后自动断开（测试环境）
      const timeout = setTimeout(() => {
        clearInterval(heartbeat)
        sseStream.close()
      }, 10_000)

      sseStream.onAbort(() => clearTimeout(timeout))
    })
  })

  // ==========================================================================
  // Curator 报告
  // ==========================================================================

  app.get("/curator/report", (c) => {
    if (options.mockCuratorReport === null) {
      return c.json({ success: true, data: null })
    }
    const report = options.mockCuratorReport ?? { lastReview: new Date().toISOString(), suggestions: [] }
    return c.json({ success: true, data: report })
  })

  // ==========================================================================
  // LTX 代理
  // ==========================================================================

  const ltxBase = options.ltxBaseUrl ?? "http://localhost:8000"

  app.get("/api/ltx/health", async (c) => {
    try {
      const response = await fetch(`${ltxBase}/health`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) {
        return c.json({ status: "unhealthy", ltx_url: ltxBase, error: `LTX returned HTTP ${response.status}` }, 502)
      }
      const ltxHealth = await response.json()
      return c.json({ status: "ok", ltx: ltxHealth, proxy: "jianjicode", timestamp: new Date().toISOString() })
    } catch (error: any) {
      return c.json({ status: "unreachable", ltx_url: ltxBase, error: error.message }, 503)
    }
  })

  app.post("/api/edit/*", async (c) => {
    const editPath = c.req.path
    const url = `${ltxBase}${editPath}`
    try {
      const body = await c.req.json()
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const data = await response.json()
      return c.json(data, response.status as any)
    } catch (error: any) {
      return c.json({ success: false, error: `LTX proxy error: ${error.message}` }, 502)
    }
  })

  app.get("/api/edit/*", async (c) => {
    const editPath = c.req.path
    const queryString = new URLSearchParams(c.req.query() as any).toString()
    const url = `${ltxBase}${editPath}${queryString ? `?${queryString}` : ""}`
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      const data = await response.json()
      return c.json(data, response.status as any)
    } catch (error: any) {
      return c.json({ success: false, error: `LTX proxy error: ${error.message}` }, 502)
    }
  })

  return { app, token: plainToken, store: initialStore, options }
}

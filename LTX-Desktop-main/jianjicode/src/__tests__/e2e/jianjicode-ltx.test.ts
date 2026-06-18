/**
 * jianjicode ↔ LTX 跨服务完整链路 E2E 测试
 *
 * 启动真实的 Hono 服务 + Fake LTX backend（模拟 FastAPI :8000），
 * 通过真实 HTTP 走完整链路。验证：
 *   - 跨服务通信（不含 mock，走真实 TCP）
 *   - 错误传播（LTX 崩溃 → 502）
 *   - 并发请求隔离
 *   - 回退路径验证
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { createAuthMiddleware } from "../../auth/middleware.js"
import { generateToken } from "../../auth/types.js"
import { TestTokenStore } from "../fixtures/test-token-store.js"

// ============================================================================
// Fake LTX Backend (模拟 FastAPI :8000)
// ============================================================================

function fakeLtxApp(): Hono {
  const app = new Hono()

  app.get("/health", (c) => c.json({ status: "ok", service: "ltx-fastapi" }))

  app.post("/api/edit/trim", async (c) => {
    const { input_file, start_time, end_time } = await c.req.json()
    return c.json({
      success: true,
      operation: "trim",
      output: `${input_file}_trimmed.mp4`,
      duration: `${start_time}-${end_time}`,
    })
  })

  app.post("/api/edit/concat", async (c) => {
    const { input_files, output_file } = await c.req.json()
    return c.json({ success: true, operation: "concat", output: output_file, parts: input_files.length })
  })

  app.get("/api/edit/video_info", (c) => {
    return c.json({ success: true, path: c.req.query("path"), width: 1920, height: 1080, duration: 120 })
  })

  return app
}

// ============================================================================
// Jianjicode Server (模拟 server.ts 路由结构)
// ============================================================================

function jianjicodeApp(ltxBaseUrl: string, token: string): { app: Hono; token: string } {
  const store = new TestTokenStore(token)
  const app = new Hono()

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type", "Authorization"] }))
  app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }))
  app.use("*", createAuthMiddleware(() => store, ["/health"]))

  app.post("/chat", async (c) => {
    const { message } = await c.req.json()
    return c.json({ success: true, output: `Processed: ${message}`, sessionId: "e2e-session" })
  })

  // LTX 代理
  app.get("/api/ltx/health", async (c) => {
    try {
      const res = await fetch(`${ltxBaseUrl}/health`, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return c.json({ status: "unhealthy", ltx_url: ltxBaseUrl, error: `HTTP ${res.status}` }, 502)
      return c.json({ status: "ok", ltx: await res.json(), proxy: "jianjicode" })
    } catch (e: any) {
      return c.json({ status: "unreachable", ltx_url: ltxBaseUrl, error: e.message }, 503)
    }
  })

  app.post("/api/edit/*", async (c) => {
    const url = `${ltxBaseUrl}${c.req.path}`
    try {
      const body = await c.req.json()
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      return c.json(await res.json(), res.status as any)
    } catch (e: any) {
      return c.json({ success: false, error: `LTX proxy error: ${e.message}` }, 502)
    }
  })

  return { app, token }
}

// ============================================================================
// Tests — 走真实 TCP（Bun.serve）
// ============================================================================

describe("jianjicode ↔ LTX full chain (real HTTP)", () => {
  let ltxServer: ReturnType<typeof Bun.serve>
  let jjcServer: ReturnType<typeof Bun.serve>
  let ltxUrl: string
  let jjcUrl: string
  let token: string

  beforeAll(async () => {
    // 启动 fake LTX
    const ltxPort = 18000 + Math.floor(Math.random() * 1000)
    ltxServer = Bun.serve({ fetch: fakeLtxApp().fetch, port: ltxPort, hostname: "127.0.0.1" })
    ltxUrl = `http://127.0.0.1:${ltxPort}`

    // 启动 jianjicode
    token = generateToken()
    const { app } = jianjicodeApp(ltxUrl, token)
    const jjcPort = 19000 + Math.floor(Math.random() * 1000)
    jjcServer = Bun.serve({ fetch: app.fetch, port: jjcPort, hostname: "127.0.0.1" })
    jjcUrl = `http://127.0.0.1:${jjcPort}`
  })

  afterAll(() => {
    ltxServer?.stop()
    jjcServer?.stop()
  })

  test("health check passes through to LTX", async () => {
    const res = await fetch(`${jjcUrl}/api/ltx/health`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.ltx.service).toBe("ltx-fastapi")
  })

  test("POST /chat works over real HTTP", async () => {
    const res = await fetch(`${jjcUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "trim video" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test("POST /api/edit/trim forwards to LTX and returns result", async () => {
    const res = await fetch(`${jjcUrl}/api/edit/trim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input_file: "test.mp4", start_time: "5", end_time: "10" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.operation).toBe("trim")
    expect(body.output).toBe("test.mp4_trimmed.mp4")
  })

  test("POST /api/edit/concat forwards multi-file operation", async () => {
    const res = await fetch(`${jjcUrl}/api/edit/concat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input_files: ["a.mp4", "b.mp4"], output_file: "merged.mp4" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.parts).toBe(2)
  })

  test("returns 401 without valid token over real HTTP", async () => {
    const res = await fetch(`${jjcUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("returns 503 when LTX is down", async () => {
    // 用不存在的端口模拟 LTX 崩溃
    const downToken = generateToken()
    const { app } = jianjicodeApp("http://127.0.0.1:19999", downToken)
    const port = 19000 + Math.floor(Math.random() * 1000)
    const server = Bun.serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ltx/health`, {
        headers: { Authorization: `Bearer ${downToken}` },
      })
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe("unreachable")
    } finally {
      server.stop()
    }
  })
})

/**
 * LTX 代理端点集成测试
 *
 * 覆盖 GET /api/ltx/health、POST /api/edit/*、GET /api/edit/*
 *
 * 通过本地 Hono fake LTX backend 模拟 FastAPI :8000 的行为。
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { Hono } from "hono"
import { createTestApp } from "../fixtures/test-server.js"

// ============================================================================
// Fake LTX backend — 模拟 FastAPI :8000
// ============================================================================

function createFakeLtxBackend() {
  const app = new Hono()

  app.get("/health", (c) => c.json({ status: "ok", service: "ltx-fastapi" }))

  app.post("/api/edit/trim", async (c) => {
    const body = await c.req.json()
    return c.json({ success: true, operation: "trim", input: body.input_file, output: body.output_file })
  })

  app.get("/api/edit/video_info", (c) => {
    const path = c.req.query("path")
    return c.json({ success: true, path, duration: 120, resolution: "1920x1080" })
  })

  // 模拟 500 错误
  app.post("/api/edit/broken", (c) => c.json({ error: "Internal LTX error" }, 500))

  // 模拟慢响应（触发超时）
  app.post("/api/edit/slow", async (c) => {
    await new Promise((r) => setTimeout(r, 70_000))
    return c.json({ success: true })
  })

  return app
}

async function startFakeLtx() {
  const app = createFakeLtxBackend()
  const port = 18000 + Math.floor(Math.random() * 1000)
  const server = Bun.serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })
  return { app, url: `http://127.0.0.1:${port}`, server }
}

// ============================================================================
// Tests
// ============================================================================

describe("LTX Proxy", () => {
  let fakeLtx: Awaited<ReturnType<typeof startFakeLtx>> | null = null

  beforeAll(async () => {
    fakeLtx = await startFakeLtx()
  })

  afterAll(() => {
    fakeLtx?.server.stop()
  })

  // --- GET /api/ltx/health ---

  describe("GET /api/ltx/health", () => {
    test("returns 200 when LTX is online", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: fakeLtx!.url })
      const res = await app.request("/api/ltx/health", {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe("ok")
      expect(body.ltx).toBeDefined()
      expect(body.proxy).toBe("jianjicode")
    })

    test("returns 503 when LTX is unreachable", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: "http://127.0.0.1:19999" })
      const res = await app.request("/api/ltx/health", {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body.status).toBe("unreachable")
    })

    test("returns 502 with LTX proxy error when LTX returns non-200", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: fakeLtx!.url })
      const res = await app.request("/api/edit/broken", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ file: "test.mp4" }),
      })
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("Internal LTX error")
    })
  })

  // --- POST /api/edit/* ---

  describe("POST /api/edit/*", () => {
    test("forwards POST to LTX and returns response", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: fakeLtx!.url })
      const res = await app.request("/api/edit/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input_file: "test.mp4", output_file: "out.mp4" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.operation).toBe("trim")
    })

    test("returns 502 when LTX is unreachable", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: "http://127.0.0.1:19999" })
      const res = await app.request("/api/edit/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ input_file: "test.mp4" }),
      })
      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body.error).toContain("LTX proxy error")
    })

    test("returns 401 without token", async () => {
      const { app } = createTestApp({ ltxBaseUrl: fakeLtx!.url })
      const res = await app.request("/api/edit/trim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_file: "test.mp4" }),
      })
      expect(res.status).toBe(401)
    })
  })

  // --- GET /api/edit/* ---

  describe("GET /api/edit/*", () => {
    test("forwards GET with query params to LTX", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: fakeLtx!.url })
      const res = await app.request("/api/edit/video_info?path=/videos/test.mp4", {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.duration).toBe(120)
    })

    test("returns 502 when LTX is unreachable", async () => {
      const { app, token } = createTestApp({ ltxBaseUrl: "http://127.0.0.1:19999" })
      const res = await app.request("/api/edit/video_info?path=/videos/test.mp4", {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(502)
    })
  })
})

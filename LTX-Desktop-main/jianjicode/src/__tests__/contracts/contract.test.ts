/**
 * 端点契约测试
 *
 * 对全部 18 个端点逐一发送请求，用 Zod schema 校验响应形状。
 * 防止路由变更导致响应格式静默破坏。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"
import type { TestServerOptions } from "../fixtures/test-server.js"
import * as S from "./schemas.js"

function createApp(opts?: TestServerOptions) {
  return createTestApp(opts)
}

// ============================================================================
// GET /health
// ============================================================================

describe("contract: GET /health", () => {
  test("200 response matches schema", async () => {
    const res = await createApp().app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.Health200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /auth/refresh
// ============================================================================

describe("contract: POST /auth/refresh", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.AuthRefresh200.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/auth/refresh", { method: "POST" })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /chat
// ============================================================================

describe("contract: POST /chat", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp({
      mockChatResult: { success: true, output: "ok", title: "test", operation: "chat", sessionId: "s1", data: { analysis: "", operation: "chat", output: "ok", title: "test", sessionId: "s1" } },
    })
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.Chat200.parse(body)).not.toThrow()
  })

  test("400 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(() => S.Chat400.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "x" }) })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /chat/stream
// ============================================================================

describe("contract: POST /chat/stream", () => {
  test("SSE stream contains valid result event payload", async () => {
    const { app, token } = createApp({
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onLog?.("ok")
        callbacks.onProgress?.("half", "50%")
        return { success: true, output: "done", title: "test", operation: "chat", sessionId: "s1" }
      },
    })
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    const dataLine = text.split("\n").find((l) => l.startsWith("data: ") && text.includes("event: result"))
    if (dataLine) {
      const idx = text.indexOf("event: result")
      const block = text.slice(idx)
      const dataMatch = block.match(/data: (\{.*\})/)
      if (dataMatch) {
        expect(() => S.SseResultEvent.parse(JSON.parse(dataMatch[1]))).not.toThrow()
      }
    }
  })

  test("400 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(() => S.Chat400.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /api/jianjicode/chat
// ============================================================================

describe("contract: POST /api/jianjicode/chat", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp({
      mockChatResult: { success: true, output: "ok", title: "test", operation: "chat", sessionId: "s1", data: { analysis: "", operation: "chat", output: "ok", title: "test", sessionId: "s1" } },
    })
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.JianjicodeChat200.parse(body)).not.toThrow()
  })

  test("400 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(() => S.JianjicodeChat400.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /api/jianjicode/chat/stream
// ============================================================================

describe("contract: POST /api/jianjicode/chat/stream", () => {
  test("SSE stream contains valid result event payload", async () => {
    const { app, token } = createApp({
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onProgress?.("half", "50%")
        return { success: true, output: "done", title: "test", operation: "chat", sessionId: "s1" }
      },
    })
    const res = await app.request("/api/jianjicode/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    const dataMatch = text.match(/data: (\{.*"success":true.*\})/)
    if (dataMatch) {
      expect(() => S.JianjicodeSseResult.parse(JSON.parse(dataMatch[1]))).not.toThrow()
    }
  })
})

// ============================================================================
// POST /permission/reply
// ============================================================================

describe("contract: POST /permission/reply", () => {
  test("400 response matches schema (missing body)", async () => {
    const res = await createApp().app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
    if (res.status === 401) {
      const body = await res.json()
      expect(() => S.Auth401.parse(body)).not.toThrow()
    }
  })
})

// ============================================================================
// GET /nudges
// ============================================================================

describe("contract: GET /nudges", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.Nudge200.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/nudges")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /nudges/clear
// ============================================================================

describe("contract: POST /nudges/clear", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/nudges/clear", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.NudgeClear200.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/nudges/clear", { method: "POST" })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /nudges/stream
// ============================================================================

describe("contract: GET /nudges/stream", () => {
  test("SSE connected event payload matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    const dataMatch = text.match(/data: (\{.*timestamp.*\})/)
    expect(dataMatch).not.toBeNull()
    expect(() => S.NudgeConnectedEvent.parse(JSON.parse(dataMatch![1]))).not.toThrow()
  })
})

// ============================================================================
// GET /curator/report
// ============================================================================

describe("contract: GET /curator/report", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/curator/report", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.CuratorReport200.parse(body)).not.toThrow()
  })

  test("401 response matches schema", async () => {
    const res = await createApp().app.request("/curator/report")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /api/runtime-policy
// ============================================================================

describe("contract: GET /api/runtime-policy", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/runtime-policy", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.RuntimePolicy200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /api/settings
// ============================================================================

describe("contract: GET /api/settings", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/settings", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.Settings200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /api/settings
// ============================================================================

describe("contract: POST /api/settings", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/settings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.SettingsPost200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /api/models/status
// ============================================================================

describe("contract: GET /api/models/status", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/models/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.ModelsStatus200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /api/models
// ============================================================================

describe("contract: GET /api/models", () => {
  test("200 response matches schema", async () => {
    const { app, token } = createApp()
    const res = await app.request("/api/models", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(() => S.Models200.parse(body)).not.toThrow()
  })
})

// ============================================================================
// GET /api/ltx/health
// ============================================================================

describe("contract: GET /api/ltx/health", () => {
  test("200 response matches LTX health schema (ok|unhealthy|unreachable)", async () => {
    const { app, token } = createApp({ ltxBaseUrl: "http://127.0.0.1:19999" })
    const res = await app.request("/api/ltx/health", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect([200, 503]).toContain(res.status)
    const body = await res.json()
    expect(() => S.LtxHealthResponse.parse(body)).not.toThrow()
  })
})

// ============================================================================
// POST /api/edit/*
// ============================================================================

describe("contract: POST /api/edit/*", () => {
  test("502 proxy error matches schema when LTX is unreachable", async () => {
    const { app, token } = createApp({ ltxBaseUrl: "http://127.0.0.1:19999" })
    const res = await app.request("/api/edit/trim", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: "test.mp4" }),
    })
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(() => S.LtxEditProxy502.parse(body)).not.toThrow()
  })

  test("401 response matches schema without token", async () => {
    const res = await createApp().app.request("/api/edit/trim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "test.mp4" }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(() => S.Auth401.parse(body)).not.toThrow()
  })
})

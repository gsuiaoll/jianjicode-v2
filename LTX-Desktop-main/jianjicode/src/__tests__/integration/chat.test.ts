/**
 * Chat 端点集成测试 — JSON + SSE 流式
 *
 * 覆盖：POST /chat、POST /chat/stream、POST /api/jianjicode/chat、
 *       POST /api/jianjicode/chat/stream
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

// ============================================================================
// POST /chat (JSON)
// ============================================================================

describe("POST /chat", () => {
  test("returns 400 when message is missing", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toContain("Missing or invalid")
  })

  test("returns 400 when message is not a string", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: 123 }),
    })
    expect(res.status).toBe(400)
  })

  test("returns 200 with success response for valid request", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "trim video" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test("returns 401 without Bearer token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("returns 401 with wrong token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer jjc_wrong" },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("returns 401 with expired token", async () => {
    const { app, token } = createTestApp({ tokenExpired: true })
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("uses mock chat result when provided", async () => {
    const mockResult = { success: true, output: "Video trimmed to 10s", sessionId: "mock-001" }
    const { app, token } = createTestApp({ mockChatResult: mockResult })
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "trim video" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.output).toBe("Video trimmed to 10s")
    expect(body.sessionId).toBe("mock-001")
  })

  test("uses dynamic mock chat result when function provided", async () => {
    const { app, token } = createTestApp({
      mockChatResult: (msg: string) => ({ success: true, output: `Echo: ${msg}`, args: {} }),
    })
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "hello", args: { model: "test" } }),
    })
    const body = await res.json()
    expect(body.output).toBe("Echo: hello")
  })
})

// ============================================================================
// POST /chat/stream (SSE)
// ============================================================================

describe("POST /chat/stream", () => {
  test("returns text/event-stream content type", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("returns 400 when message is missing", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test("emits result event as final event", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })

    const text = await res.text()
    expect(text).toContain("event: result")
    expect(text).toContain("event: log")
    expect(text).toContain("event: progress")
  })

  test("events follow expected order: log → progress → result", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })

    const text = await res.text()
    const logIdx = text.indexOf("event: log")
    const progressIdx = text.indexOf("event: progress")
    const resultIdx = text.indexOf("event: result")

    expect(logIdx).toBeLessThan(progressIdx)
    expect(progressIdx).toBeLessThan(resultIdx)
  })

  test("uses mockChatStream when provided", async () => {
    const { app, token } = createTestApp({
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onLog?.("step 1")
        callbacks.onProgress?.("half", "50%")
        callbacks.onStream?.({ type: "tool_call", tool: "trim" })
        return { success: true, output: "done" }
      },
    })
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })

    const text = await res.text()
    expect(text).toContain("event: log")
    expect(text).toContain("step 1")
    expect(text).toContain("event: progress")
    expect(text).toContain("50%")
    expect(text).toContain("event: stream")
    expect(text).toContain("event: result")
    expect(text).toContain("done")
  })
})

// ============================================================================
// POST /api/jianjicode/chat (LTX prefix)
// ============================================================================

describe("POST /api/jianjicode/chat", () => {
  test("accepts message field", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)
  })

  test("accepts prompt field as fallback", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: "test prompt" }),
    })
    expect(res.status).toBe(200)
  })

  test("returns 400 when both message and prompt are missing", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  test("prefers message over prompt when both present", async () => {
    const { app, token } = createTestApp({
      mockChatResult: (msg: string) => ({ success: true, output: msg }),
    })
    const res = await app.request("/api/jianjicode/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "use message", prompt: "ignore prompt" }),
    })
    const body = await res.json()
    expect(body.output).toBe("use message")
  })
})

// ============================================================================
// POST /api/jianjicode/chat/stream (LTX prefix SSE)
// ============================================================================

describe("POST /api/jianjicode/chat/stream", () => {
  test("returns SSE stream", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("accepts prompt field as fallback", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: "test prompt" }),
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("returns 400 without message or prompt", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/jianjicode/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})

/**
 * SSE 流式弹性测试
 *
 * 验证 SSE 流式传输的健壮性。
 * 注意：app.request() 不维持长连接（非真实 TCP），
 * 心跳/超时等长连接行为需要真实 Bun.serve + fetch 测试。
 * 此处覆盖格式正确性、事件隔离、错误码。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("SSE connected event", () => {

  test("SSE stream emits connected event immediately", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain("event: connected")
    expect(text).toContain("timestamp")
  })

  test("connected event data is valid JSON with timestamp field", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const dataMatch = text.match(/data: (\{.*timestamp.*\})/)
    expect(dataMatch).not.toBeNull()
    expect(() => JSON.parse(dataMatch![1])).not.toThrow()
    const parsed = JSON.parse(dataMatch![1])
    expect(parsed.timestamp).toBeTruthy()
    // ISO 8601 格式
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

// ============================================================================
// 多 SSE 连接隔离
// ============================================================================

describe("SSE multi-connection isolation", () => {

  test("two SSE connections both receive connected event", async () => {
    const { app, token } = createTestApp()

    const [text1, text2] = await Promise.all([
      app.request("/nudges/stream", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.text()),
      app.request("/nudges/stream", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.text()),
    ])

    // 两个连接都收到了 connected 事件
    expect(text1).toContain("event: connected")
    expect(text2).toContain("event: connected")
  })

  test("SSE streams do not cross-contaminate events between endpoints", async () => {
    const { app, token } = createTestApp()

    const [nudgeText, chatText] = await Promise.all([
      app.request("/nudges/stream", {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.text()),
      app.request("/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: "test" }),
      }).then((r) => r.text()),
    ])

    // nudge stream 有自己的 connected 事件
    expect(nudgeText).toContain("event: connected")
    // chat stream 不会收到 nudge stream 的事件
    expect(chatText).not.toContain("event: connected")

    // chat stream 收到自己的 result 事件
    expect(chatText).toContain("event: result")
  })
})

// ============================================================================
// SSE 格式正确性
// ============================================================================

describe("SSE format compliance", () => {

  test("SSE response has correct Content-Type header", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/event-stream")
  })

  test("SSE events are properly formatted with event: and data: fields", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.split("\n")

    // 每个非空行应该以 event: 或 data: 开头
    for (const line of lines) {
      if (line.trim().length === 0) continue
      expect(
        line.startsWith("event: ") ||
        line.startsWith("data: ") ||
        line.startsWith("id: ") ||
        line.startsWith("retry: ") ||
        line.startsWith(":")
      ).toBe(true)
    }
  })

  test("Chat SSE stream emits result as final event", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()
    const lines = text.trim().split("\n")
    // 最后一个非空行应该是 data: 包含 result
    const lastDataLine = lines.filter((l) => l.startsWith("data: ")).pop()
    expect(lastDataLine).toBeDefined()
    expect(lastDataLine).toContain("success")
  })

  test("Chat SSE stream with mock emits log events before result", async () => {
    const { app, token } = createTestApp({
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onLog?.("step 1")
        callbacks.onProgress?.("half", "50%")
        return { success: true, output: "done", title: "OK", operation: "chat", sessionId: "s1" }
      },
    })
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(200)

    const text = await res.text()

    // log 在 result 之前
    const logIdx = text.indexOf("event: log")
    const progressIdx = text.indexOf("event: progress")
    const resultIdx = text.indexOf("event: result")

    expect(logIdx).not.toBe(-1)
    expect(progressIdx).not.toBe(-1)
    expect(resultIdx).not.toBe(-1)
    expect(logIdx).toBeLessThan(resultIdx)
    expect(progressIdx).toBeLessThan(resultIdx)
  })
})

// ============================================================================
// SSE 错误响应
// ============================================================================

describe("SSE error responses", () => {

  test("POST /chat/stream without body returns 400 (JSON, not SSE)", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })
    // 400 错误返回 JSON，不是 SSE 流
    expect(res.status).toBe(400)
    expect(res.headers.get("Content-Type")).toContain("application/json")
  })

  test("POST /chat/stream without token returns 401 (JSON, not SSE)", async () => {
    const res = await createTestApp().app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get("Content-Type")).toContain("application/json")
  })
})

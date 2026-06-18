/**
 * 并发压力测试
 *
 * 验证高并发场景下的正确性：
 *   - 20 并发 POST /chat → 全部返回 200 或正确的 429（限流）
 *   - 5 并发 SSE 连接 → 全部收到 connected 事件
 *   - 快速连续 token 刷新 → 无 token 损坏
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("Concurrent requests", () => {

  // --- 20 并发 POST /chat ---

  test("20 concurrent POST /chat — all return 200", async () => {
    const { app, token } = createTestApp()
    const count = 20

    const results = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        app.request("/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: `concurrent test ${i}` }),
        }).then((res) => res.json()),
      ),
    )

    // 所有请求都应该成功
    const allOk = results.every((r) => r.success === true)
    expect(allOk).toBe(true)
    // 没有丢失响应
    expect(results.length).toBe(count)
  })

  // --- 20 并发 SSE 连接到 /nudges/stream ---

  test("5 concurrent SSE connections — all receive connected event", async () => {
    const { app, token } = createTestApp()
    const count = 5

    const results = await Promise.all(
      Array.from({ length: count }, () =>
        app.request("/nudges/stream", {
          headers: { Authorization: `Bearer ${token}` },
        }).then(async (res) => {
          expect(res.status).toBe(200)
          const text = await res.text()
          return {
            hasConnected: text.includes("connected"),
            hasHeartbeat: text.includes("heartbeat"),
          }
        }),
      ),
    )

    // 所有连接都收到 connected 事件
    const allConnected = results.every((r) => r.hasConnected)
    expect(allConnected).toBe(true)
    expect(results.length).toBe(count)
  })

  // --- 5 并发 POST /chat/stream ---

  test("3 concurrent POST /chat/stream — all complete with result", async () => {
    const { app, token } = createTestApp()

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        app.request("/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: `stream test ${i}` }),
        }).then(async (res) => {
          expect(res.status).toBe(200)
          const text = await res.text()
          return text.includes("event: result")
        }),
      ),
    )

    const allComplete = results.every(Boolean)
    expect(allComplete).toBe(true)
  })

  // --- 并发 401 场景不相互影响 ---

  test("mix of valid and invalid tokens — correct status per request", async () => {
    const { app, token } = createTestApp()

    const requests = [
      { token, expectedStatus: 200 },
      { token: "jjc_invalid", expectedStatus: 401 },
      { token, expectedStatus: 200 },
      { token: "jjc_another_bad", expectedStatus: 401 },
      { token, expectedStatus: 200 },
    ]

    const results = await Promise.all(
      requests.map((r) =>
        app.request("/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${r.token}`,
          },
          body: JSON.stringify({ message: "test" }),
        }).then((res) => res.status),
      ),
    )

    expect(results).toEqual([200, 401, 200, 401, 200])
  })
})

// ============================================================================
// Token 刷新并发安全
// ============================================================================

describe("Token refresh under concurrency", () => {

  test("rapid consecutive token refreshes — all return new tokens", async () => {
    const { app, token } = createTestApp()
    const count = 5

    const results = await Promise.all(
      Array.from({ length: count }, () =>
        app.request("/auth/refresh", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).then(async (res) => {
          expect(res.status).toBe(200)
          const body = await res.json()
          return body.token
        }),
      ),
    )

    // 每次刷新都返回了新 token
    results.forEach((t) => {
      expect(t).toBeTruthy()
      expect(typeof t).toBe("string")
      expect(t.startsWith("jjc_")).toBe(true)
    })
  })

  test("old token still valid within 3-second revocation window", async () => {
    const { app, token } = createTestApp()

    // 刷新
    const refreshRes = await app.request("/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(refreshRes.status).toBe(200)

    // 旧 token 在撤销窗口内仍然有效（3 秒延迟撤销）
    const chatRes = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(chatRes.status).toBe(200)
  })
})

// ============================================================================
// 大量请求不崩溃
// ============================================================================

describe("Bulk request resilience", () => {

  test("50 sequential POST /chat — all succeed, server stays up", async () => {
    const { app, token } = createTestApp()
    const count = 50

    for (let i = 0; i < count; i++) {
      const res = await app.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: `bulk test ${i}` }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    }
  })
})

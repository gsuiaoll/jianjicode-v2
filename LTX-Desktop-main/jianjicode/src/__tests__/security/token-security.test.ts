/**
 * Token 安全测试
 *
 * 验证认证层的安全性：
 *   - 重放攻击（已撤销 token → 401）
 *   - 注入攻击（特殊字符在 Authorization 头 → 被平台拒绝）
 *   - 缺失 Bearer 前缀 → 401
 *   - 超长 token → 401（不崩溃）
 *   - X-Request-ID 注入 → 正确回显
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

// 每个安全测试使用独立的 IP 避免触发共享限流器
let ipCounter = 0
function nextIp() {
  return `10.99.${Math.floor(ipCounter++ / 256)}.${ipCounter % 256}`
}

describe("Token replay attack", () => {

  test("revoked token returns 401", async () => {
    const { app, token, store } = createTestApp()

    // 先验证 token 有效
    const good = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(good.status).toBe(200)

    // 撤销
    store.revoke()

    // 重放攻击 — 使用已撤销的 token
    const replay = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "replay" }),
    })
    expect(replay.status).toBe(401)
    const body = await replay.json()
    expect(body.success).toBe(false)
  })

  test("expired token returns 401 with clear message", async () => {
    const { app, token, store } = createTestApp()
    store.setExpired(true)

    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Token expired")
  })
})

// ============================================================================
// 注入攻击
// ============================================================================

describe("Token injection attacks", () => {

  test("newline in Authorization header — rejected by platform (no crash)", async () => {
    // Hono/Web API 的 new Request() 会拒绝含换行符的 header 值
    // 这些恶意请求在到达认证中间件之前就被平台层拦截
    const { app } = createTestApp()

    let platformRejected = false
    try {
      await app.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jjc_token\nX-Injected: true",
        },
        body: JSON.stringify({ message: "test" }),
      })
    } catch (err: any) {
      // 平台拒绝 header 注入 — 安全行为
      platformRejected = true
      expect(err.message).toContain("invalid value")
    }
    expect(platformRejected).toBe(true)
  })

  test("null byte in Authorization header — rejected by platform", async () => {
    const { app } = createTestApp()
    let platformRejected = false
    try {
      await app.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jjc_token\x00extra",
        },
        body: JSON.stringify({ message: "test" }),
      })
    } catch (err: any) {
      platformRejected = true
      expect(err.message).toContain("invalid value")
    }
    expect(platformRejected).toBe(true)
  })

  test("carriage return in Authorization header — rejected by platform", async () => {
    const { app } = createTestApp()
    let platformRejected = false
    try {
      await app.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jjc_token\r\nX-Injected: true",
        },
        body: JSON.stringify({ message: "test" }),
      })
    } catch (err: any) {
      platformRejected = true
      expect(err.message).toContain("invalid value")
    }
    expect(platformRejected).toBe(true)
  })

  test("missing Bearer prefix returns 401", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "jjc_validtoken_nobearer",
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("empty Authorization header returns 401", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "",
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("Bearer with empty token returns 401", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer ",
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.status).toBe(401)
  })

  test("no Authorization header returns 401", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges", {
      headers: { "X-Forwarded-For": nextIp() },
    })
    // 可能被限流（因为 preload 设置了低阈值），接受 401/429
    expect([401, 429]).toContain(res.status)
  })
})

// ============================================================================
// 超长 token
// ============================================================================

describe("Overlong token handling", () => {

  test("extremely long token is rejected gracefully (no crash)", async () => {
    const { app } = createTestApp()
    const longToken = "jjc_" + "A".repeat(10_000)

    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${longToken}`,
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    // 应该返回 401，不崩溃。可能被限流为 429
    expect([401, 429]).toContain(res.status)
    if (res.status === 401) {
      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBeTruthy()
    }
  })

  test("4096-char token is handled without performance degradation", async () => {
    const { app } = createTestApp()
    const token4k = "jjc_" + "B".repeat(4092)

    const start = performance.now()
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token4k}`,
        "X-Forwarded-For": nextIp(),
      },
      body: JSON.stringify({ message: "test" }),
    })
    const elapsed = performance.now() - start

    // 响应应为 401，不崩溃
    expect([401, 429]).toContain(res.status)
    // 不应超过 500ms
    expect(elapsed).toBeLessThan(500)
  })
})

// ============================================================================
// X-Request-ID
// ============================================================================

describe("X-Request-ID handling", () => {

  test("missing X-Request-ID is generated on success", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Forwarded-For": nextIp(),
      },
    })
    expect(res.status).toBe(200)
    const requestId = res.headers.get("X-Request-ID")
    expect(requestId).toBeTruthy()
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test("client-provided X-Request-ID is echoed back", async () => {
    const { app, token } = createTestApp()
    const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    const res = await app.request("/nudges", {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Request-ID": clientId,
        "X-Forwarded-For": nextIp(),
      },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("X-Request-ID")).toBe(clientId)
  })

  test("X-Request-ID with special chars — platform rejects", async () => {
    // 类似 Authorization header，Web API 会拒绝含换行符的 header
    const { app, token } = createTestApp()
    let platformRejected = false
    try {
      await app.request("/nudges", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Request-ID": "abc\nSet-Cookie: session=stolen",
          "X-Forwarded-For": nextIp(),
        },
      })
    } catch (err: any) {
      platformRejected = true
      expect(err.message).toContain("invalid value")
    }
    expect(platformRejected).toBe(true)
  })

  test("X-Request-ID is present on error responses too", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges", {
      headers: { "X-Forwarded-For": nextIp() },
    })
    // 可能是 401 或 429（限流）
    const requestId = res.headers.get("X-Request-ID")
    expect(requestId).toBeTruthy()
    // X-Request-ID 不含控制字符
    expect(requestId).not.toContain("\n")
    expect(requestId).not.toContain("\r")
  })
})

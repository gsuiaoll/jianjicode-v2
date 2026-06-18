/**
 * 认证中间件集成测试 — Bearer Token 完整验证链路
 *
 * 迁移自 src/auth/__tests__/auth.test.ts，从 node:test 转为 bun:test，
 * 并新增 token 轮换、并发安全等场景。
 */

import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { createAuthMiddleware } from "../../auth/middleware.js"
import { constantTimeEqual, generateToken, hashToken } from "../../auth/types.js"
import { createTestApp } from "../fixtures/test-server.js"

// ============================================================================
// 基础中间件测试 — 使用独立 Hono app（与 auth.test.ts 一致）
// ============================================================================

interface TestStore {
  validate(raw: string): boolean
  getToken(): string
  revoke(): void
  isExpired(): boolean
}

function createTestStore(token: string, overrides?: Partial<TestStore>): TestStore {
  const store = {
    hashed: hashToken(token),
    plain: token,
    revoked: false,
    validate(raw: string) {
      if (this.revoked || this.isExpired()) return false
      return constantTimeEqual(hashToken(raw), this.hashed)
    },
    getToken() { return this.plain },
    revoke() { this.revoked = true },
    isExpired() { return false },
  }
  if (overrides) Object.assign(store, overrides)
  return store
}

describe("createAuthMiddleware (standalone)", () => {
  const buildApp = (token: string, overrides?: Partial<TestStore>) => {
    const store = createTestStore(token, overrides)
    const app = new Hono()
    app.get("/health", (c) => c.json({ status: "ok" }))
    app.use("*", createAuthMiddleware(() => store, ["/health"]))
    app.get("/secret", (c) => c.json({ data: "protected" }))
    app.post("/chat", (c) => c.json({ success: true }))
    return { app, token, store }
  }

  test("/health returns 200 without token (exempt)", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/health")
    expect(res.status).toBe(200)
  })

  test("/health returns 200 with wrong token (still exempt)", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/health", {
      headers: { Authorization: "Bearer jjc_wrong" },
    })
    expect(res.status).toBe(200)
  })

  test("returns 401 when no Authorization header", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/secret")
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBeDefined()
  })

  test("returns 401 when Authorization is not Bearer", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Basic abc123" },
    })
    expect(res.status).toBe(401)
  })

  test("returns 401 when token is wrong", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Bearer jjc_wrongtoken" },
    })
    expect(res.status).toBe(401)
  })

  test("returns 401 when Bearer is empty", async () => {
    const { app } = buildApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Bearer " },
    })
    expect(res.status).toBe(401)
  })

  test("returns 200 for valid token on GET", async () => {
    const { app, token } = buildApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toBe("protected")
  })

  test("returns 200 for valid token on POST", async () => {
    const { app, token } = buildApp(generateToken())
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
  })

  test("returns 401 when token is expired", async () => {
    const { app, token } = buildApp(generateToken(), {
      isExpired: () => true,
      validate() { return false },
    })
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Token expired")
  })

  test("returns 401 after token is revoked", async () => {
    const token = generateToken()
    const { app, store } = buildApp(token)
    // 先验证有效
    const res1 = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res1.status).toBe(200)

    // 撤销后无效
    store.revoke()
    const res2 = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res2.status).toBe(401)
  })
})

// ============================================================================
// X-Request-ID 追踪
// ============================================================================

describe("X-Request-ID handling", () => {
  test("response includes generated X-Request-ID", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const requestId = res.headers.get("X-Request-ID")
    expect(requestId).toBeDefined()
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test("preserves client-provided X-Request-ID", async () => {
    const { app, token } = createTestApp()
    const clientId = crypto.randomUUID()
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}`, "X-Request-ID": clientId },
    })
    expect(res.headers.get("X-Request-ID")).toBe(clientId)
  })
})

// ============================================================================
// 并发请求（不共享限流状态时应该互相不影响）
// ============================================================================

describe("concurrent requests", () => {
  test("multiple valid requests all succeed", async () => {
    const { app, token } = createTestApp()
    const requests = Array.from({ length: 5 }, () =>
      app.request("/nudges", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    )
    const results = await Promise.all(requests)
    for (const res of results) {
      expect(res.status).toBe(200)
    }
  })

  test("multiple invalid requests are rate-limited together", async () => {
    const { app } = createTestApp()
    const ip = "10.0.0.99"
    // 5 次失败 → 触发限流
    for (let i = 0; i < 5; i++) {
      await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
      })
    }
    const res = await app.request("/nudges", {
      headers: { Authorization: "Bearer valid", "X-Forwarded-For": ip },
    })
    expect(res.status).toBe(429)
  })
})

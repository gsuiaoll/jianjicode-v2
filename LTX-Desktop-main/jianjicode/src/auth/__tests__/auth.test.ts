/**
 * Auth 模块测试 — token 生成 / 哈希 / 常量时间比较 / 限流 / 中间件 / TokenStore
 */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import { describe, it } from "node:test"
import { constantTimeEqual, generateToken, hashToken } from "../types.js"

// ---------------------------------------------------------------------------
// hashToken
// ---------------------------------------------------------------------------

describe("hashToken", () => {
  it("returns deterministic hash for same input", () => {
    const token = "jjc_test123"
    assert.equal(hashToken(token), hashToken(token))
  })

  it("returns different hash for different input", () => {
    assert.notEqual(hashToken("jjc_a"), hashToken("jjc_b"))
  })

  it("returns a 64-char hex string (SHA-256)", () => {
    const h = hashToken("jjc_test")
    assert.equal(h.length, 64)
    assert.match(h, /^[0-9a-f]+$/)
  })
})

// ---------------------------------------------------------------------------
// constantTimeEqual
// ---------------------------------------------------------------------------

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    assert.equal(constantTimeEqual("abc123", "abc123"), true)
  })

  it("returns false for different strings", () => {
    assert.equal(constantTimeEqual("abc123", "abc456"), false)
  })

  it("returns false for different length strings", () => {
    assert.equal(constantTimeEqual("abc", "abcdef"), false)
  })
})

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------

describe("generateToken", () => {
  it("returns a 52-char string (jjc_ + 48 chars)", () => {
    const token = generateToken()
    assert.equal(token.length, 52)
  })

  it("starts with jjc_ prefix", () => {
    const token = generateToken()
    assert.ok(token.startsWith("jjc_"))
  })

  it("only contains valid base62 characters after prefix", () => {
    const token = generateToken()
    const suffix = token.slice(4)
    assert.match(suffix, /^[A-Za-z0-9]+$/)
  })

  it("generates unique tokens on successive calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    assert.equal(tokens.size, 100)
  })
})

// ---------------------------------------------------------------------------
// MemoryTokenStore (full interface: TTL + revoke + expire)
// ---------------------------------------------------------------------------

describe("MemoryTokenStore", () => {
  class MemoryTokenStore {
    readonly createdAt: number
    private hashed = ""
    private plain = ""
    private revoked = false
    private ttlMs: number

    constructor(token: string, ttlMs: number = 60_000) {
      this.createdAt = Date.now()
      this.plain = token
      this.hashed = hashToken(token)
      this.ttlMs = ttlMs
    }
    validate(raw: string) {
      if (this.revoked || this.isExpired()) return false
      return constantTimeEqual(hashToken(raw), this.hashed)
    }
    getToken() { return this.plain }
    revoke() { this.revoked = true }
    isExpired() { return Date.now() > this.createdAt + this.ttlMs }
  }

  it("validate returns true for matching token", () => {
    const store = new MemoryTokenStore("jjc_mysecret")
    assert.equal(store.validate("jjc_mysecret"), true)
    assert.equal(store.getToken(), "jjc_mysecret")
  })

  it("validate returns false for wrong token", () => {
    const store = new MemoryTokenStore("jjc_real")
    assert.equal(store.validate("jjc_fake"), false)
  })

  it("validate returns false after revoke", () => {
    const store = new MemoryTokenStore("jjc_revoke_me")
    store.revoke()
    assert.equal(store.validate("jjc_revoke_me"), false)
  })

  it("isExpired returns false for fresh token", () => {
    const store = new MemoryTokenStore("jjc_fresh", 60_000)
    assert.equal(store.isExpired(), false)
  })

  it("isExpired returns true after TTL", () => {
    const store = new MemoryTokenStore("jjc_old", 1) // 1ms TTL
    // Need to wait past the TTL
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(store.isExpired(), true)
        assert.equal(store.validate("jjc_old"), false)
        resolve()
      }, 10)
    })
  })

  it("has createdAt timestamp close to construction time", () => {
    const before = Date.now()
    const store = new MemoryTokenStore("jjc_time")
    const after = Date.now()
    assert.ok(store.createdAt >= before)
    assert.ok(store.createdAt <= after)
  })
})

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

import { AuthRateLimiter } from "../rate-limiter.js"

describe("AuthRateLimiter", () => {
  it("isLimited returns false initially", () => {
    const rl = new AuthRateLimiter()
    assert.equal(rl.isLimited("10.0.0.1"), false)
  })

  it("isLimited returns false with fewer than max failures", () => {
    const rl = new AuthRateLimiter()
    // 记录 1 次失败 — 始终少于任何合理的最大失败次数
    rl.recordFailure("10.0.0.2")
    assert.equal(rl.isLimited("10.0.0.2"), false)
  })

  it("isLimited returns true at exactly max failures", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 10; i++) {
      rl.recordFailure("10.0.0.3")
    }
    assert.equal(rl.isLimited("10.0.0.3"), true)
  })

  it("isLimited returns true after exceeding max failures", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 20; i++) {
      rl.recordFailure("10.0.0.4")
    }
    assert.equal(rl.isLimited("10.0.0.4"), true)
  })

  it("clearFailures resets isLimited", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 15; i++) {
      rl.recordFailure("10.0.0.5")
    }
    rl.clearFailures("10.0.0.5")
    assert.equal(rl.isLimited("10.0.0.5"), false)
  })

  it("retryAfterSeconds returns positive value when rate limited", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 12; i++) {
      rl.recordFailure("10.0.0.6")
    }
    const retry = rl.retryAfterSeconds("10.0.0.6")
    assert.ok(retry > 0)
  })

  it("isLimited returns false when window has passed", () => {
    const rl = new AuthRateLimiter()
    // Simulate old failures by direct bucket manipulation
    const oldTime = Date.now() - 61_000
    ;(rl as any).buckets.set("10.0.0.7", { failures: [oldTime] })
    assert.equal(rl.isLimited("10.0.0.7"), false)
  })
})

// ---------------------------------------------------------------------------
// 集成测试：createAuthMiddleware 通过 Hono app.fetch() 验证
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { createAuthMiddleware } from "../middleware.js"

interface TestStore {
  validate(raw: string): boolean
  getToken(): string
  revoke(): void
  isExpired(): boolean
}

function createTestApp(token: string, storeOverrides?: Partial<TestStore>) {
  class Store {
    private hashed = hashToken(token)
    private plain = token
    private revoked = false
    validate(raw: string) {
      if (this.revoked) return false
      return constantTimeEqual(hashToken(raw), this.hashed)
    }
    getToken() { return this.plain }
    revoke() { this.revoked = true }
    isExpired() { return false }
  }
  const store = new Store()
  if (storeOverrides) {
    Object.assign(store, storeOverrides)
  }

  const app = new Hono()
  app.get("/health", (c) => c.json({ status: "ok" }, 200 as any))
  app.use("*", createAuthMiddleware(() => store, ["/health"]))
  app.get("/secret", (c) => c.json({ data: "protected" }, 200 as any))
  app.post("/chat", (c) => c.json({ success: true }, 200 as any))

  return { app, token, store }
}

describe("createAuthMiddleware integration", () => {
  it("/health returns 200 without token (exempt)", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/health")
    assert.equal(res.status, 200)
  })

  it("/health returns 200 even with wrong token", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/health", {
      headers: { Authorization: "Bearer wrong" },
    })
    assert.equal(res.status, 200)
  })

  it("returns 401 when no Authorization header", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/secret")
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.success, false)
    assert.ok(body.error)
  })

  it("returns 401 when Authorization header is not Bearer", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Basic abc123" },
    })
    assert.equal(res.status, 401)
  })

  it("returns 401 when token is wrong", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Bearer jjc_wrongtoken" },
    })
    assert.equal(res.status, 401)
  })

  it("returns 401 when token is empty string after Bearer", async () => {
    const { app } = createTestApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: "Bearer " },
    })
    assert.equal(res.status, 401)
  })

  it("returns 200 for valid token on GET", async () => {
    const { app, token } = createTestApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
  })

  it("returns 200 for valid token on POST", async () => {
    const { app, token } = createTestApp(generateToken())
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
  })

  // ---------------------------------------------------------------------------
  // 新测试：过期 token
  // ---------------------------------------------------------------------------

  it("returns 401 when token is expired", async () => {
    const { app, token } = createTestApp(generateToken(), {
      isExpired: () => true,
    })
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.error, "Token expired")
  })

  // ---------------------------------------------------------------------------
  // 新测试：撤销后旧 token 返回 401
  // ---------------------------------------------------------------------------

  it("returns 401 after token is revoked", async () => {
    const { app, token, store } = createTestApp(generateToken())
    // 先验证 token 有效
    const res1 = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res1.status, 200)

    // 撤销
    store.revoke()

    const res2 = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res2.status, 401)
  })

  // ---------------------------------------------------------------------------
  // 新测试：响应包含 X-Request-ID
  // ---------------------------------------------------------------------------

  it("response includes X-Request-ID header", async () => {
    const { app, token } = createTestApp(generateToken())
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const requestId = res.headers.get("X-Request-ID")
    assert.ok(requestId)
    // UUID 格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    assert.match(requestId!, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it("preserves existing X-Request-ID from client", async () => {
    const { app, token } = createTestApp(generateToken())
    const clientId = crypto.randomUUID()
    const res = await app.request("/secret", {
      headers: { Authorization: `Bearer ${token}`, "X-Request-ID": clientId },
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("X-Request-ID"), clientId)
  })

  it("returns 429 after too many auth failures", async () => {
    const { app } = createTestApp(generateToken())
    const ip = "10.0.0.99"
    // 触发 11 次失败
    for (let i = 0; i < 11; i++) {
      await app.request("/secret", {
        headers: { Authorization: "Bearer badtoken", "X-Forwarded-For": ip },
      })
    }
    const res = await app.request("/secret", {
      headers: { Authorization: "Bearer validtoken", "X-Forwarded-For": ip },
    })
    assert.equal(res.status, 429)
    assert.equal(res.headers.get("Retry-After") !== null, true)
  })

  // 注意：不测试窗口过期恢复，因为 60s 滑动窗口测试太慢。
  // AuthRateLimiter 内部逻辑已在单元测试中覆盖。
})

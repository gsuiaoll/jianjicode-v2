/**
 * 认证速率限制器单元测试 — 滑动窗口逻辑
 */

import { describe, expect, test } from "bun:test"
import { AuthRateLimiter } from "../../auth/rate-limiter.js"

describe("AuthRateLimiter", () => {
  test("isLimited returns false initially", () => {
    const rl = new AuthRateLimiter()
    expect(rl.isLimited("10.0.0.1")).toBe(false)
  })

  test("isLimited returns false with fewer than max failures", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 4; i++) rl.recordFailure("10.0.0.2")
    expect(rl.isLimited("10.0.0.2")).toBe(false)
  })

  test("isLimited returns true at exactly max failures", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 5; i++) rl.recordFailure("10.0.0.3")
    expect(rl.isLimited("10.0.0.3")).toBe(true)
  })

  test("isLimited returns true after exceeding max failures", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 20; i++) rl.recordFailure("10.0.0.4")
    expect(rl.isLimited("10.0.0.4")).toBe(true)
  })

  test("clearFailures resets isLimited", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 10; i++) rl.recordFailure("10.0.0.5")
    rl.clearFailures("10.0.0.5")
    expect(rl.isLimited("10.0.0.5")).toBe(false)
  })

  test("retryAfterSeconds returns positive value when rate limited", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 6; i++) rl.recordFailure("10.0.0.6")
    expect(rl.retryAfterSeconds("10.0.0.6")).toBeGreaterThan(0)
  })

  test("isLimited returns false when old failures outside window", () => {
    const rl = new AuthRateLimiter()
    // 通过 refection 注入过期失败记录
    const oldTime = Date.now() - 2000 // 2 秒前，window 是 1 秒
    ;(rl as any).buckets.set("10.0.0.7", { failures: [oldTime] })
    expect(rl.isLimited("10.0.0.7")).toBe(false)
  })

  test("different IPs have independent rate limits", () => {
    const rl = new AuthRateLimiter()
    for (let i = 0; i < 10; i++) rl.recordFailure("10.0.0.8")
    expect(rl.isLimited("10.0.0.9")).toBe(false)
  })
})

describe("AuthRateLimiter.clientIP", () => {
  test("extracts rightmost IP from X-Forwarded-For", () => {
    const mockC = { req: { header: () => "10.0.0.1, 10.0.0.2, 10.0.0.3" } }
    expect(AuthRateLimiter.clientIP(mockC as any)).toBe("10.0.0.3")
  })

  test("falls back to X-Real-IP", () => {
    const mockC = { req: { header: (name: string) => name === "X-Forwarded-For" ? undefined : "10.0.0.4" } }
    expect(AuthRateLimiter.clientIP(mockC as any)).toBe("10.0.0.4")
  })

  test("defaults to 127.0.0.1 when no headers", () => {
    const mockC = { req: { header: () => undefined } }
    expect(AuthRateLimiter.clientIP(mockC as any)).toBe("127.0.0.1")
  })
})

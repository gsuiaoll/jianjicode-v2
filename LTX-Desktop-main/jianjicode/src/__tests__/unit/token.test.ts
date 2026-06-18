/**
 * Token 认证单元测试 — hash / 常量时间比较 / generateToken
 */

import { describe, expect, test } from "bun:test"
import crypto from "node:crypto"
import { constantTimeEqual, generateToken, hashToken } from "../../auth/types.js"
import { TestTokenStore } from "../fixtures/test-token-store.js"

describe("hashToken", () => {
  test("returns deterministic hash for same input", () => {
    expect(hashToken("jjc_test123")).toBe(hashToken("jjc_test123"))
  })

  test("returns different hash for different input", () => {
    expect(hashToken("jjc_a")).not.toBe(hashToken("jjc_b"))
  })

  test("returns 64-char hex string (SHA-256)", () => {
    const h = hashToken("jjc_test")
    expect(h.length).toBe(64)
    expect(h).toMatch(/^[0-9a-f]+$/)
  })
})

describe("constantTimeEqual", () => {
  test("returns true for equal strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true)
  })

  test("returns false for different strings", () => {
    expect(constantTimeEqual("abc123", "abc456")).toBe(false)
  })

  test("returns false for different length strings", () => {
    expect(constantTimeEqual("abc", "abcdef")).toBe(false)
  })
})

describe("generateToken", () => {
  test("returns 52-char string (jjc_ + 48 chars)", () => {
    expect(generateToken().length).toBe(52)
  })

  test("starts with jjc_ prefix", () => {
    expect(generateToken().startsWith("jjc_")).toBe(true)
  })

  test("suffix only contains base62 characters", () => {
    const suffix = generateToken().slice(4)
    expect(suffix).toMatch(/^[A-Za-z0-9]+$/)
  })

  test("generates unique tokens on successive calls", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })
})

describe("TokenStore lifecycle via TestTokenStore", () => {
  test("validate returns true for matching token", () => {
    const store = new TestTokenStore("jjc_mysecret")
    expect(store.validate("jjc_mysecret")).toBe(true)
  })

  test("validate returns false for wrong token", () => {
    const store = new TestTokenStore("jjc_real")
    expect(store.validate("jjc_fake")).toBe(false)
  })

  test("validate returns false after revoke", () => {
    const store = new TestTokenStore("jjc_revoke_me")
    store.revoke()
    expect(store.validate("jjc_revoke_me")).toBe(false)
  })

  test("isExpired returns false for fresh token", () => {
    const store = new TestTokenStore("jjc_fresh", 60_000)
    expect(store.isExpired()).toBe(false)
  })

  test("isExpired returns true after TTL", async () => {
    const store = new TestTokenStore("jjc_old", 1)
    await new Promise((r) => setTimeout(r, 10))
    expect(store.isExpired()).toBe(true)
    expect(store.validate("jjc_old")).toBe(false)
  })
})

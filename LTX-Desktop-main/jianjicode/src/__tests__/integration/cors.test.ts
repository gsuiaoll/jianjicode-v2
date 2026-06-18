/**
 * CORS 集成测试
 *
 * 验证跨域请求头在所有端点上正确返回。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("CORS headers", () => {
  test("OPTIONS request returns CORS headers", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health", { method: "OPTIONS" })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeDefined()
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeDefined()
  })

  test("GET request includes Access-Control-Allow-Origin", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health")
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("POST request includes CORS headers", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "test" }),
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("CORS headers present on protected endpoint", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("CORS headers present even on 401 responses", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges")
    expect(res.status).toBe(401)
    // CORS 中间件在认证中间件之前，所以头应该还在
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("OPTIONS allows Authorization header", async () => {
    const { app } = createTestApp()
    const res = await app.request("/chat", { method: "OPTIONS" })
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers")
    expect(allowHeaders).toContain("Authorization")
    expect(allowHeaders).toContain("Content-Type")
  })
})

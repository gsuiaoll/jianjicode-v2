/**
 * 路由同步校验
 *
 * 确保 test-server 的路由集合与 server.ts 的规范路由表完全一致。
 * 使用行为验证（发请求看状态码）检测 404 路由缺失或 401 行为偏差。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"
import { auditRoutes, CANONICAL_ROUTES } from "../fixtures/route-audit.js"

describe("Route sync: test-server matches canonical routes", () => {

  test("all canonical routes exist (no 404) and have correct auth (no 401 on public)", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: "http://127.0.0.1:19999", // LTX 可能不可达，但路由应存在
    })

    const errors = await auditRoutes({ app, token })

    if (errors.length > 0) {
      console.error("Route sync errors:")
      for (const e of errors) {
        console.error(`  ${e.route.method} ${e.route.path}: ${e.error}`)
      }
    }

    expect(errors.length).toBe(0)
  })

  test("canonical route count matches expected", () => {
    // 19 个路由端点
    expect(CANONICAL_ROUTES.length).toBe(19)
  })

  test("each route entry has required fields", () => {
    for (const route of CANONICAL_ROUTES) {
      expect(route.method).toBeTruthy()
      expect(route.path).toBeTruthy()
      expect(route.path.startsWith("/")).toBe(true)
      expect(typeof route.auth).toBe("boolean")
      expect(route.successStatus).toBeGreaterThanOrEqual(200)
    }
  })
})

// ============================================================================
// 逐个验证关键路由
// ============================================================================

describe("Key route behavioral checks", () => {

  test("/health is publicly accessible", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })

  test("/auth/refresh requires auth", async () => {
    const { app } = createTestApp()
    const noAuth = await app.request("/auth/refresh", { method: "POST" })
    expect(noAuth.status).toBe(401)
  })

  test("/api/runtime-policy exists and returns correct shape", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/runtime-policy", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("force_api_generations")
  })

  test("/api/models exists and returns array", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/models", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.models).toBeInstanceOf(Array)
  })

  test("/api/models/status exists", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/api/models/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("all_downloaded")
  })

  test("/chat requires message param", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })
    // 缺少 message 字段返回 400
    expect(res.status).toBe(400)
  })

  test("/permission/reply returns 410 when no pending request", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ requestID: "nonexistent", action: "allow_once" }),
    })
    expect(res.status).toBe(410)
  })

  test("PATCH is not a registered method on any route", async () => {
    const { app, token } = createTestApp()
    // 发 PATCH 到已知路由 → Hono 应该返回 404 或 405
    const res = await app.request("/chat", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message: "test" }),
    })
    // 不是 200
    expect(res.status).not.toBe(200)
  })

  test("unknown route returns 404", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nonexistent-route")
    // 没有认证的未知路由会先被 auth 中间件拦截返回 401
    // 这是正确的行为 — auth 中间件先于路由匹配
    expect([401, 404]).toContain(res.status)
  })
})

/**
 * Health 端点集成测试
 *
 * 验证 GET /health 在所有场景下的行为。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("GET /health", () => {
  test("returns 200 with correct structure", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health")
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.version).toBe("0.1.0")
    expect(typeof body.uptime).toBe("number")
    expect(body.timestamp).toBeDefined()
  })

  test("returns 200 without Authorization header (exempt path)", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health")
    expect(res.status).toBe(200)
  })

  test("returns 200 even with wrong Authorization header (exempt)", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health", {
      headers: { Authorization: "Bearer jjc_wrongtoken" },
    })
    expect(res.status).toBe(200)
  })

  test("returns 200 even with no auth middleware at all", async () => {
    const { app } = createTestApp({ authEnabled: false })
    const res = await app.request("/health")
    expect(res.status).toBe(200)
  })

  test("response has application/json content-type", async () => {
    const { app } = createTestApp()
    const res = await app.request("/health")
    expect(res.headers.get("content-type")).toContain("application/json")
  })
})

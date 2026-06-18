/**
 * Curator 端点集成测试
 *
 * 覆盖 GET /curator/report
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("GET /curator/report", () => {
  test("returns 200 with report data", async () => {
    const mockReport = {
      lastReview: "2026-05-07T10:00:00Z",
      suggestions: [
        { skill: "basketball_analysis", action: "optimize" },
      ],
    }
    const { app, token } = createTestApp({ mockCuratorReport: mockReport })
    const res = await app.request("/curator/report", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.lastReview).toBe("2026-05-07T10:00:00Z")
    expect(body.data.suggestions.length).toBe(1)
  })

  test("returns 200 with null data when no report", async () => {
    const { app, token } = createTestApp({ mockCuratorReport: null })
    const res = await app.request("/curator/report", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toBeNull()
  })

  test("returns default report when no mock provided", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/curator/report", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toBeDefined()
  })

  test("returns 401 without token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/curator/report")
    expect(res.status).toBe(401)
  })
})

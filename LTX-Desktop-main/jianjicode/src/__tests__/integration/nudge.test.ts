/**
 * Nudge 端点集成测试
 *
 * 覆盖 GET /nudges、POST /nudges/clear、GET /nudges/stream (SSE)
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("GET /nudges", () => {
  test("returns 200 with empty data by default", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual([])
  })

  test("returns mock nudges when provided", async () => {
    const mockNudges = [
      { id: "1", type: "skill_suggestion", content: "Try creating a skill for batch processing" },
      { id: "2", type: "optimization", content: "Skill 'basketball_analysis' has low success rate" },
    ]
    const { app, token } = createTestApp({ mockNudges })
    const res = await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json()
    expect(body.data.length).toBe(2)
    expect(body.data[0].type).toBe("skill_suggestion")
  })

  test("returns 401 without token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges")
    expect(res.status).toBe(401)
  })
})

describe("POST /nudges/clear", () => {
  test("returns 200 success", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/clear", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  test("returns 401 without token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges/clear", { method: "POST" })
    expect(res.status).toBe(401)
  })
})

describe("GET /nudges/stream", () => {
  test("returns text/event-stream content type", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.headers.get("content-type")).toContain("text/event-stream")
  })

  test("first event is 'connected'", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    // 读取前几个 chunk 找 connected 事件
    const chunks: string[] = []
    const timeout = AbortSignal.timeout(3000)
    try {
      while (chunks.length < 5) {
        const { done, value } = await reader.read(timeout)
        if (done) break
        chunks.push(decoder.decode(value))
      }
    } catch {
      // timeout is ok
    } finally {
      reader.cancel()
    }

    const combined = chunks.join("")
    expect(combined).toContain("event: connected")
  })

  test("connected event has valid JSON data", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/nudges/stream", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    const { done, value } = await reader.read()
    expect(done).toBe(false)
    const text = decoder.decode(value)
    expect(text).toContain("event: connected")
    // data 字段包含有效的 JSON
    const dataMatch = text.match(/data: (\{.*\})/)
    expect(dataMatch).not.toBeNull()
    const data = JSON.parse(dataMatch![1])
    expect(data.timestamp).toBeDefined()
  })

  test("returns 401 without token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/nudges/stream")
    expect(res.status).toBe(401)
  })
})

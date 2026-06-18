/**
 * Permission 端点集成测试
 *
 * 覆盖 POST /permission/reply — 权限回复的全部场景。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("POST /permission/reply", () => {
  test("returns 400 when requestID is missing", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "allow_once" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Missing")
  })

  test("returns 400 when action is missing", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "123" }),
    })
    expect(res.status).toBe(400)
  })

  test("returns 400 for invalid action", async () => {
    const { app, token } = createTestApp()
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "123", action: "invalid_action" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Invalid action")
  })

  test("accepts allow_once action", async () => {
    let replied = false
    const mockSvc = {
      getPending: () => ({ id: "req-1", tool: "trim" }),
      reply: (input: any) => { replied = true },
    }
    const { app, token } = createTestApp({ mockPermissionService: mockSvc })
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "req-1", action: "allow_once" }),
    })
    expect(res.status).toBe(200)
    expect(replied).toBe(true)
  })

  test("accepts allow_always action", async () => {
    let actionReceived = ""
    const { app, token } = createTestApp({
      mockPermissionService: {
        getPending: () => ({ id: "req-2" }),
        reply: (input: any) => { actionReceived = input.action },
      },
    })
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "req-2", action: "allow_always" }),
    })
    expect(res.status).toBe(200)
    expect(actionReceived).toBe("allow_always")
  })

  test("accepts deny action", async () => {
    const { app, token } = createTestApp({
      mockPermissionService: {
        getPending: () => ({ id: "req-3" }),
        reply: () => {},
      },
    })
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "req-3", action: "deny" }),
    })
    expect(res.status).toBe(200)
  })

  test("accepts reject action", async () => {
    const { app, token } = createTestApp({
      mockPermissionService: {
        getPending: () => ({ id: "req-4" }),
        reply: () => {},
      },
    })
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "req-4", action: "reject" }),
    })
    expect(res.status).toBe(200)
  })

  test("returns 410 when requestID not found", async () => {
    const { app, token } = createTestApp({
      mockPermissionService: {
        getPending: () => null,
        reply: () => {},
      },
    })
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "unknown-id", action: "allow_once" }),
    })
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toContain("No pending permission request")
  })

  test("passes feedback field to reply", async () => {
    let feedbackReceived = ""
    const { app, token } = createTestApp({
      mockPermissionService: {
        getPending: () => ({ id: "req-5" }),
        reply: (input: any) => { feedbackReceived = input.feedback },
      },
    })
    await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestID: "req-5", action: "allow_once", feedback: "looks good" }),
    })
    expect(feedbackReceived).toBe("looks good")
  })

  test("returns 401 without token", async () => {
    const { app } = createTestApp()
    const res = await app.request("/permission/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestID: "123", action: "allow_once" }),
    })
    expect(res.status).toBe(401)
  })
})

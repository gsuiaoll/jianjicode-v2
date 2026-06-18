/**
 * 聊天全生命周期 E2E 测试
 *
 * 覆盖完整的用户对话流程：
 *   token 生成 → 连接建立 → 聊天请求 → SSE 流式响应 →
 *   token 轮换 → 旧 token 缓冲期 → 新 token 生效
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { createAuthMiddleware } from "../../auth/middleware.js"
import { generateToken } from "../../auth/types.js"
import { TestTokenStore } from "../fixtures/test-token-store.js"

// ============================================================================
// 构建带 token 轮换功能的服务（模拟 server.ts 的架构）
// ============================================================================

function createLifecycleApp() {
  const app = new Hono()
  let tokenStore: TokenStore

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST"], allowHeaders: ["Content-Type", "Authorization"] }))

  app.get("/health", (c) => c.json({ status: "ok" }))

  app.use("*", createAuthMiddleware(() => tokenStore, ["/health"]))

  app.post("/auth/refresh", (c) => {
    const newToken = generateToken()
    const oldStore = tokenStore!
    tokenStore = new TestTokenStore(newToken)
    // 3 秒后撤销旧 token
    setTimeout(() => oldStore.revoke(), 3000)
    return c.json({ success: true, token: newToken })
  })

  app.post("/chat", async (c) => {
    const body = await c.req.json()
    return c.json({ success: true, output: `Echo: ${body.message}`, sessionId: "s1" })
  })

  app.post("/chat/stream", async (c) => {
    const body = await c.req.json()
    return streamSSE(c, async (sseStream) => {
      await sseStream.writeSSE({ event: "progress", data: JSON.stringify({ step: "init" }) })
      await sseStream.writeSSE({ event: "result", data: JSON.stringify({ success: true, output: `Echo: ${body.message}` }) })
    })
  })

  // 初始化
  const initialToken = generateToken()
  tokenStore = new TestTokenStore(initialToken)

  return { app, getToken: () => tokenStore.getToken(), initialToken }
}

// ============================================================================
// Tests
// ============================================================================

describe("Chat lifecycle E2E", () => {
  test("full flow: health → chat → refresh → chat with new token", async () => {
    const { app, initialToken } = createLifecycleApp()

    // 1. 健康检查（无需认证）
    const healthRes = await app.request("/health")
    expect(healthRes.status).toBe(200)

    // 2. 用初始 token 聊天
    const chat1Res = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${initialToken}` },
      body: JSON.stringify({ message: "hello" }),
    })
    expect(chat1Res.status).toBe(200)
    expect((await chat1Res.json()).success).toBe(true)

    // 3. 轮换 token
    const refreshRes = await app.request("/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialToken}` },
    })
    expect(refreshRes.status).toBe(200)
    const { token: newToken } = await refreshRes.json()

    // 4. 旧 token 立即失效（_tokenStore 被整体替换，新 store 只认 newToken）
    const chatOldToken = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${initialToken}` },
      body: JSON.stringify({ message: "old token" }),
    })
    expect(chatOldToken.status).toBe(401)

    // 5. 新 token 立即可用
    const chatNewToken = await app.request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${newToken}` },
      body: JSON.stringify({ message: "new token" }),
    })
    expect(chatNewToken.status).toBe(200)
  })

  test("SSE stream survives token refresh", async () => {
    const { app, initialToken } = createLifecycleApp()

    // 用旧 token 启动 SSE 连接
    const sseRes = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${initialToken}` },
      body: JSON.stringify({ message: "streaming" }),
    })

    expect(sseRes.headers.get("content-type")).toContain("text/event-stream")

    // 中途轮换 token
    await app.request("/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${initialToken}` },
    })

    // SSE 流应该正常完成（已验证的连接不中断）
    const text = await sseRes.text()
    expect(text).toContain("event: result")
    expect(text).toContain("Echo: streaming")
  }, 10000)
})

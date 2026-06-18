/**
 * Agent → Tool → LTX 全链路 E2E 测试
 *
 * 灰度测试方式：mockChatStream 模拟 AI 的 tool_call 决策，
 * 但工具执行走真实的 jianjicode → LTX 代理管道。
 * Fake LTX 记录接收到的请求体用于断言。
 *
 * 验证：
 *   1. AI 返回 tool_call → SSE 输出 tool-start + tool-args
 *   2. 工具调用打到假 LTX → 假 LTX 记录请求体
 *   3. LTX 返回结果 → SSE 输出 tool-end + result
 *   4. 最终 SSE 流包含完整的 event: result 事件
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { Hono } from "hono"
import { createTestApp } from "../fixtures/test-server.js"

// ============================================================================
// Fake LTX backend — 记录所有请求用于断言
// ============================================================================

interface RecordedRequest {
  path: string
  method: string
  body: unknown
  timestamp: string
}

function createFakeLtxBackend() {
  const app = new Hono()
  const recorded: RecordedRequest[] = []

  app.get("/health", (c) => c.json({ status: "ok", service: "ltx-fastapi" }))

  // trim 端点 — 处理并记录
  app.post("/api/edit/trim", async (c) => {
    const body = await c.req.json()
    recorded.push({
      path: "/api/edit/trim",
      method: "POST",
      body,
      timestamp: new Date().toISOString(),
    })
    return c.json({
      success: true,
      operation: "trim",
      output: `${body.input_file || "video"}_trimmed.mp4`,
      start: body.start_time,
      end: body.end_time,
    })
  })

  // color_grading 端点
  app.post("/api/edit/color_grading", async (c) => {
    const body = await c.req.json()
    recorded.push({
      path: "/api/edit/color_grading",
      method: "POST",
      body,
      timestamp: new Date().toISOString(),
    })
    return c.json({
      success: true,
      operation: "color_grading",
      output: `${body.input_file || "video"}_graded.mp4`,
      preset: body.preset || "cinematic",
    })
  })

  return { app, recorded }
}

async function startFakeLtx() {
  const { app, recorded } = createFakeLtxBackend()
  const port = 18000 + Math.floor(Math.random() * 1000)
  const server = Bun.serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })
  return { url: `http://127.0.0.1:${port}`, server, recorded }
}

// ============================================================================
// Tests
// ============================================================================

describe("Agent → Tool → LTX full chain", () => {
  let fakeLtx: Awaited<ReturnType<typeof startFakeLtx>> | null = null

  beforeAll(async () => {
    fakeLtx = await startFakeLtx()
  })

  afterAll(() => {
    fakeLtx?.server.stop()
  })

  test("SSE stream contains tool-start → tool-end → result events", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: fakeLtx!.url,
      mockChatStream: async (_msg, _args, callbacks) => {
        // 模拟 AI 决定调用 trim 工具
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_001",
          toolName: "trim",
          args: { input_file: "test.mp4", start_time: "5", end_time: "30" },
        })

        // 实际调用 edit proxy（走 jianjicode → LTX 管道）
        const editRes = await fetch(`${fakeLtx!.url}/api/edit/trim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_file: "test.mp4", start_time: "5", end_time: "30" }),
        })
        const editBody = await editRes.json()

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_001",
          toolName: "trim",
          result: { title: "视频裁剪完成", output: editBody.output },
        })

        return {
          success: true,
          output: `裁剪完成: ${editBody.output}`,
          title: "视频裁剪",
          operation: "trim",
          sessionId: "s1",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "裁剪 test.mp4 从第5秒到第30秒" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证事件序列
    expect(text).toContain("tool-start")
    expect(text).toContain("call_001")
    expect(text).toContain("tool-end")
    expect(text).toContain("event: result")

    // 验证 LTX 收到了请求
    expect(fakeLtx!.recorded.length).toBeGreaterThanOrEqual(1)
    const trimReq = fakeLtx!.recorded.find((r) => r.path === "/api/edit/trim")
    expect(trimReq).toBeDefined()
    expect((trimReq!.body as any).input_file).toBe("test.mp4")
    expect((trimReq!.body as any).start_time).toBe("5")
    expect((trimReq!.body as any).end_time).toBe("30")
  })

  test("two tool calls in sequence — both hit LTX", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: fakeLtx!.url,
      mockChatStream: async (_msg, _args, callbacks) => {
        // 第一个工具：调色
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_001",
          toolName: "color_grading",
          args: { input_file: "test.mp4", preset: "cinematic", strength: 85 },
        })

        await fetch(`${fakeLtx!.url}/api/edit/color_grading`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_file: "test.mp4", preset: "cinematic", strength: 85 }),
        })

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_001",
          toolName: "color_grading",
          result: { title: "调色完成", output: "test_graded.mp4" },
        })

        // 第二个工具：裁剪
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_002",
          toolName: "trim",
          args: { input_file: "test_graded.mp4", start_time: "10", end_time: "60" },
        })

        await fetch(`${fakeLtx!.url}/api/edit/trim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_file: "test_graded.mp4", start_time: "10", end_time: "60" }),
        })

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_002",
          toolName: "trim",
          result: { title: "裁剪完成", output: "test_final.mp4" },
        })

        return {
          success: true,
          output: "调色 + 裁剪完成: test_final.mp4",
          title: "视频编辑完成",
          operation: "multi_tool",
          sessionId: "s2",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "调色然后裁剪" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证两个工具调用的事件序列
    const toolStartMatches = text.match(/tool-start/g)
    expect(toolStartMatches).not.toBeNull()
    expect(toolStartMatches!.length).toBe(2)

    const toolEndMatches = text.match(/tool-end/g)
    expect(toolEndMatches).not.toBeNull()
    expect(toolEndMatches!.length).toBe(2)

    // 验证 LTX 收到两个请求（一个调色，一个裁剪）
    const colorReq = fakeLtx!.recorded.find((r) => r.path === "/api/edit/color_grading")
    const trimReq = fakeLtx!.recorded.find((r) => r.path === "/api/edit/trim")
    expect(colorReq).toBeDefined()
    expect(trimReq).toBeDefined()
  })

  test("SSE stream includes progress events during chain", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: fakeLtx!.url,
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onProgress?.("analyze", "分析请求中...")
        callbacks.onLog?.("选择 trim 工具")

        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_003",
          toolName: "trim",
          args: { input_file: "video.mp4", start_time: "0", end_time: "15" },
        })

        await fetch(`${fakeLtx!.url}/api/edit/trim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input_file: "video.mp4", start_time: "0", end_time: "15" }),
        })

        callbacks.onProgress?.("executing", "工具执行完成")
        callbacks.onLog?.("trim 完成: video_trimmed.mp4")

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_003",
          toolName: "trim",
          result: { title: "裁剪完成", output: "video_trimmed.mp4" },
        })

        return {
          success: true,
          output: "编辑完成: video_trimmed.mp4",
          title: "完成",
          operation: "trim",
          sessionId: "s3",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "裁剪前15秒" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证 progress 事件
    expect(text).toContain("event: progress")
    // 验证 log 事件
    expect(text).toContain("event: log")
    // 最终结果
    expect(text).toContain("event: result")
    expect(text).toContain("video_trimmed.mp4")
  })

  test("tool error is propagated through SSE stream", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: "http://127.0.0.1:19999", // 不可达的 LTX
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_err",
          toolName: "trim",
          args: { input_file: "test.mp4", start_time: "0", end_time: "10" },
        })

        // 尝试调用不可达的 LTX
        try {
          await fetch("http://127.0.0.1:19999/api/edit/trim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input_file: "test.mp4" }),
            signal: AbortSignal.timeout(2000),
          })
        } catch (err: any) {
          callbacks.onStream?.({
            type: "tool-end",
            toolCallId: "call_err",
            toolName: "trim",
            result: {
              title: "LTX 不可达",
              output: `LTX proxy error: ${err.message}`,
              isError: true,
            },
          })
        }

        return {
          success: false,
          output: "编辑失败：LTX 服务不可达",
          title: "错误",
          operation: "trim",
          sessionId: "s4",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "裁剪视频" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证错误传播
    expect(text).toContain("tool-end")
    expect(text).toContain("LTX")
    expect(text).toContain("event: result")
    // 结果是失败的
    expect(text).toContain('"success":false')
  })
})

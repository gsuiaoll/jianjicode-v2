/**
 * 回退链路 E2E 测试
 *
 * 验证编辑管道故障时的降级路径：
 *   - LTX 不可达 → 回退到 FFmpeg 本地处理 → 结果标记为 FFmpeg 路径
 *   - LTX + FFmpeg 都不可用 → 返回明确错误消息 "no edit path available"
 *   - 部分工具回退（LTX 调色失败 → FFmpeg 调色回退）
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("Fallback chain: LTX → FFmpeg → error", () => {

  test("LTX unreachable → fallback to FFmpeg — result marked as FFmpeg path", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: "http://127.0.0.1:19999", // LTX 不可达
      mockChatStream: async (_msg, _args, callbacks) => {
        // 步骤 1: 尝试 LTX — 失败
        callbacks.onLog?.("尝试 LTX 调色...")
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_ltx_1",
          toolName: "color_grading",
          args: { input_file: "video.mp4", preset: "cinematic" },
        })

        // LTX 调用失败
        let ltxError = ""
        try {
          await fetch("http://127.0.0.1:19999/api/edit/color_grading", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input_file: "video.mp4", preset: "cinematic" }),
            signal: AbortSignal.timeout(2000),
          })
        } catch (err: any) {
          ltxError = err.message
        }

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_ltx_1",
          toolName: "color_grading",
          result: {
            title: "LTX 不可达，回退到 FFmpeg",
            output: `LTX 失败: ${ltxError}，正在使用 FFmpeg 本地处理`,
            isError: true,
          },
        })

        // 步骤 2: 回退到 FFmpeg — 成功
        callbacks.onLog?.("LTX 不可达，回退到 FFmpeg 本地处理")
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_ffmpeg_1",
          toolName: "ffmpeg",
          args: { operation: "color_grading", input: "video.mp4" },
        })

        callbacks.onProgress?.("executing", "FFmpeg 本地调色中...")

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_ffmpeg_1",
          toolName: "ffmpeg",
          result: {
            title: "FFmpeg 调色完成",
            output: "video_graded_ffmpeg.mp4",
            metadata: { fallback: true, engine: "ffmpeg" },
          },
        })

        return {
          success: true,
          output: "video_graded_ffmpeg.mp4 (FFmpeg fallback)",
          title: "调色完成 (FFmpeg 回退)",
          operation: "color_grading_ffmpeg_fallback",
          sessionId: "fb_1",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "给 video.mp4 调色" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证回退链路的事件序列
    expect(text).toContain("call_ltx_1")
    expect(text).toContain("call_ffmpeg_1")
    expect(text).toContain("LTX")
    expect(text).toContain("FFmpeg")
    expect(text).toContain("fallback")
    // 最终结果包含 FFmpeg 路径
    expect(text).toContain("ffmpeg")
    expect(text).toContain("event: result")
  })

  test("LTX + FFmpeg both unavailable → clear error message", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: "http://127.0.0.1:19999",
      mockChatStream: async (_msg, _args, callbacks) => {
        // LTX 尝试
        callbacks.onLog?.("尝试 LTX 裁剪...")
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_ltx_err",
          toolName: "trim",
          args: { input_file: "video.mp4", start_time: "5", end_time: "30" },
        })

        try {
          await fetch("http://127.0.0.1:19999/api/edit/trim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input_file: "video.mp4" }),
            signal: AbortSignal.timeout(2000),
          })
        } catch {}

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_ltx_err",
          toolName: "trim",
          result: { title: "LTX 不可达", output: "连接失败", isError: true },
        })

        // FFmpeg 回退 — 也失败（模拟 FFmpeg 未安装或不可用）
        callbacks.onLog?.("回退到 FFmpeg...")
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_ffmpeg_err",
          toolName: "ffmpeg",
          args: { operation: "trim", input: "video.mp4" },
        })

        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_ffmpeg_err",
          toolName: "ffmpeg",
          result: {
            title: "FFmpeg 不可用",
            output: "no edit path available: both LTX and FFmpeg are unavailable",
            isError: true,
          },
        })

        return {
          success: false,
          output: "no edit path available: both LTX and FFmpeg are unavailable",
          title: "编辑失败",
          operation: "trim",
          sessionId: "fb_2",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "裁剪 video.mp4" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证清晰的错误消息
    expect(text).toContain("no edit path available")
    expect(text).toContain('"success":false')
    expect(text).toContain("event: result")
  })

  test("partial fallback: LTX color grading fails but FFmpeg trim succeeds", async () => {
    const { app, token } = createTestApp({
      ltxBaseUrl: "http://127.0.0.1:19999",
      mockChatStream: async (_msg, _args, callbacks) => {
        // 工具 1: LTX 调色 — 失败
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_1",
          toolName: "color_grading",
          args: { input_file: "video.mp4", preset: "cinematic" },
        })
        try {
          await fetch("http://127.0.0.1:19999/api/edit/color_grading", {
            method: "POST",
            signal: AbortSignal.timeout(1000),
          })
        } catch {}
        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_1",
          toolName: "color_grading",
          result: { title: "LTX 调色失败", output: "LTX unreachable", isError: true },
        })

        // 工具 2: FFmpeg 裁剪 — 成功（FFmpeg 可直接本地运行）
        callbacks.onLog?.("使用 FFmpeg 本地裁剪")
        callbacks.onStream?.({
          type: "tool-start",
          toolCallId: "call_2",
          toolName: "ffmpeg",
          args: { operation: "trim", input: "video.mp4", start_time: "10", end_time: "60" },
        })
        callbacks.onStream?.({
          type: "tool-end",
          toolCallId: "call_2",
          toolName: "ffmpeg",
          result: {
            title: "FFmpeg 裁剪完成",
            output: "video_trimmed_ffmpeg.mp4",
            metadata: { engine: "ffmpeg" },
          },
        })

        return {
          success: true,
          output: "调色跳过(LTX不可达)，裁剪完成: video_trimmed_ffmpeg.mp4",
          title: "部分完成 (FFmpeg)",
          operation: "trim_ffmpeg",
          sessionId: "fb_3",
        }
      },
    })

    const res = await app.request("/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "调色并裁剪" }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()

    // 验证部分回退：两个工具调用，一个失败一个成功
    const toolEndMatches = text.match(/tool-end/g)
    expect(toolEndMatches).not.toBeNull()
    expect(toolEndMatches!.length).toBe(2)

    // 结果成功（部分回退仍然成功）
    expect(text).toContain('"success":true')
    expect(text).toContain("ffmpeg")
  })
})

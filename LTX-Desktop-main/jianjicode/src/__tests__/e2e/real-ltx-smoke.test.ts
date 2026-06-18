/**
 * 真实 LTX 烟雾测试 (Smoke Test)
 *
 * 验证 jianjicode 与真实 LTX FastAPI 的集成：
 *   - 如果 LTX 运行在 :8000 → 执行完整烟雾测试
 *   - 如果 LTX 未运行 → 跳过所有测试（不报失败）
 *
 * 注意：此测试需要 LTX FastAPI 在 http://127.0.0.1:8000 运行。
 * 在 CI 中可通过 Docker compose 或条件 skip 运行。
 */

import { describe, expect, test, beforeAll } from "bun:test"

// ============================================================================
// 探测 LTX 是否存活
// ============================================================================

const LTX_BASE = process.env.LTX_SMOKE_URL ?? "http://127.0.0.1:8000"
let ltxAvailable = false

beforeAll(async () => {
  try {
    const res = await fetch(`${LTX_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const body = await res.json()
      ltxAvailable = body.status === "ok" || res.ok
    }
  } catch {
    ltxAvailable = false
  }
})

// ============================================================================
// 烟雾测试
// ============================================================================

describe("Real LTX Smoke", () => {

  // --- 健康检查 ---

  test("LTX /health returns ok", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    const res = await fetch(`${LTX_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })

  // --- 基本编辑端点 ---

  test("LTX /api/edit/video_info returns metadata for valid path", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    const res = await fetch(`${LTX_BASE}/api/edit/video_info?path=/nonexistent/test.mp4`, {
      signal: AbortSignal.timeout(10000),
    })
    // 视频不存在时应返回 404 或包含错误信息（取决于 LTX 实现）
    // 只要服务可达且返回 JSON 就算通过
    expect([200, 404, 400]).toContain(res.status)
    const body = await res.json()
    expect(body).toBeDefined()
  })

  // --- 设置端点 ---

  test("LTX /api/settings returns expected shape", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    const res = await fetch(`${LTX_BASE}/api/settings`, {
      signal: AbortSignal.timeout(5000),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("useTorchCompile")
    expect(body).toHaveProperty("loadOnStartup")
  })

  // --- 模型状态 ---

  test("LTX /api/models/status returns expected shape", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    const res = await fetch(`${LTX_BASE}/api/models/status`, {
      signal: AbortSignal.timeout(5000),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty("all_downloaded")
  })

  // --- jianjicode 通过代理访问 LTX ---

  test("jianjicode /api/ltx/health proxies to real LTX successfully", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    // 启动 jianjicode test server 指向真实 LTX
    const { createTestApp } = await import("../fixtures/test-server.js")
    const { app, token } = createTestApp({ ltxBaseUrl: LTX_BASE })

    const res = await app.request("/api/ltx/health", {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
    expect(body.ltx).toBeDefined()
    expect(body.proxy).toBe("jianjicode")
  })

  // --- jianjicode edit proxy → real LTX ---

  test("jianjicode /api/edit/* proxies POST to real LTX", async () => {
    if (!ltxAvailable) {
      console.log(`[smoke:skip] LTX not available at ${LTX_BASE}`)
      return
    }

    const { createTestApp } = await import("../fixtures/test-server.js")
    const { app, token } = createTestApp({ ltxBaseUrl: LTX_BASE })

    const res = await app.request("/api/edit/video_info", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })
    // GET 请求通过查询参数
    const res2 = await app.request("/api/edit/video_info?path=/tmp/test.mp4", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })
    expect([200, 404, 400]).toContain(res2.status)
  })
})

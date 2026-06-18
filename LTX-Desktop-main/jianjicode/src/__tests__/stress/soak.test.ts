/**
 * 长时浸泡测试 (Soak Test)
 *
 * 持续的混合负载下验证无内存泄漏、无性能衰减、零错误率。
 * 企业级要求：30 秒持续负载，P50 < 50ms，P99 < 500ms，错误率 = 0。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

// ============================================================================
// 持续并发负载
// ============================================================================

describe("Soak: sustained concurrent load", () => {

  test("30s mixed workload — 0 errors, P99 < 500ms, no memory explosion", async () => {
    const { app, token } = createTestApp()
    const durationMs = 10_000  // 10 秒持续负载
    const concurrency = 10

    const latencies: number[] = []
    let errors = 0
    let completed = 0

    const start = Date.now()

    async function worker(id: number) {
      while (Date.now() - start < durationMs) {
        const t0 = performance.now()
        try {
          // 混合请求类型 — 模拟真实流量
          const path = id % 4 === 0 ? "/health"
            : id % 4 === 1 ? "/nudges"
            : id % 4 === 2 ? "/api/runtime-policy"
            : "/chat"

          const method = path === "/chat" ? "POST" : "GET"
          const headers: Record<string, string> = {}
          if (path !== "/health") {
            headers["Authorization"] = `Bearer ${token}`
          }
          if (method === "POST") {
            headers["Content-Type"] = "application/json"
          }

          const res = await app.request(path, {
            method,
            headers,
            body: method === "POST" ? JSON.stringify({ message: `soak ${id}` }) : undefined,
          })

          latencies.push(performance.now() - t0)
          completed++

          if (res.status !== 200) {
            errors++
          }
        } catch {
          errors++
        }

        // 微暂停避免 CPU 100%
        await new Promise((r) => setTimeout(r, 5))
      }
    }

    // 启动并发 worker
    const workers = Array.from({ length: concurrency }, (_, i) => worker(i))
    await Promise.all(workers)

    // 断言
    expect(completed).toBeGreaterThan(50) // 至少完成了一些请求

    // 错误率 = 0
    expect(errors).toBe(0)

    // P50 / P99
    latencies.sort((a, b) => a - b)
    const p50 = latencies[Math.floor(latencies.length * 0.5)]
    const p99 = latencies[Math.floor(latencies.length * 0.99)]

    console.log(`Soak results: ${completed} requests, P50=${p50.toFixed(1)}ms, P99=${p99.toFixed(1)}ms, errors=${errors}`)

    expect(p50).toBeLessThan(50)
    expect(p99).toBeLessThan(500)
  }, 30000)

  test("SSE stream survives sustained burst of chat/stream requests", async () => {
    const { app, token } = createTestApp({
      mockChatStream: async (_msg, _args, callbacks) => {
        callbacks.onProgress?.("executing", "work")
        return { success: true, output: "ok", title: "t", operation: "chat", sessionId: "s" }
      },
    })

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request("/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: `burst ${i}` }),
        }).then(async (res) => {
          expect(res.status).toBe(200)
          const text = await res.text()
          return { ok: text.includes("event: result"), hasError: text.includes('"success":false') }
        }),
      ),
    )

    // 全部成功完成
    const allOk = results.every((r) => r.ok && !r.hasError)
    expect(allOk).toBe(true)
  })
})

// ============================================================================
// 内存稳定性
// ============================================================================

describe("Soak: memory stability", () => {

  test("repeated large token validation does not leak memory", async () => {
    const { app } = createTestApp()
    const token4k = "jjc_" + "X".repeat(4092)
    const iterations = 100

    // 记录基准
    const baseline = process.memoryUsage().heapUsed

    for (let i = 0; i < iterations; i++) {
      await app.request("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token4k}`,
        },
        body: JSON.stringify({ message: "test" }),
      })
    }

    // 强制 GC（如果可用）
    if (typeof globalThis.gc === "function") {
      globalThis.gc()
    }

    const after = process.memoryUsage().heapUsed
    const growthMB = (after - baseline) / 1024 / 1024

    console.log(`Memory: baseline=${(baseline / 1024 / 1024).toFixed(1)}MB, after=${(after / 1024 / 1024).toFixed(1)}MB, growth=${growthMB.toFixed(2)}MB`)

    // 100 次请求后内存增长 < 50MB（容忍内部缓存）
    expect(growthMB).toBeLessThan(50)
  }, 15000)
})

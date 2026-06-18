/**
 * 速率限制端到端测试
 *
 * 验证限流触发 → 429 → Retry-After → 窗口过期恢复的完整流程。
 */

import { describe, expect, test } from "bun:test"
import { createTestApp } from "../fixtures/test-server.js"

describe("rate limiting end-to-end", () => {
  test("returns 429 after max auth failures", async () => {
    const { app } = createTestApp()
    const ip = "10.0.0.101"

    // 触发 5 次失败
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/nudges", {
        headers: { Authorization: "Bearer badtoken", "X-Forwarded-For": ip },
      })
      expect(res.status).toBe(401)
    }

    // 第 6 次应返回 429
    const res = await app.request("/nudges", {
      headers: { Authorization: "Bearer validtoken", "X-Forwarded-For": ip },
    })
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe("Too many requests")
  })

  test("includes Retry-After header on 429", async () => {
    const { app } = createTestApp()
    const ip = "10.0.0.102"

    for (let i = 0; i < 6; i++) {
      await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
      })
    }
    const res = await app.request("/nudges", {
      headers: { Authorization: "Bearer valid", "X-Forwarded-For": ip },
    })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).toBeDefined()
    expect(parseInt(res.headers.get("Retry-After")!)).toBeGreaterThan(0)
  })

  test("different IPs are not affected by rate limit", async () => {
    const { app } = createTestApp()

    // 耗尽 IP A
    for (let i = 0; i < 6; i++) {
      await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": "10.0.0.201" },
      })
    }

    // IP B 仍然可以访问
    const res = await app.request("/nudges", {
      headers: { Authorization: "Bearer bad", "X-Forwarded-For": "10.0.0.202" },
    })
    expect(res.status).toBe(401) // 401（token 无效），不是 429
  })

  test("rate limit recovers after window expires", async () => {
    const { app } = createTestApp()
    const ip = "10.0.0.103"

    // 通过 reflection 注入刚好超限的历史数据
    // 限流窗口是 1 秒，注入 2 秒前的数据
    // 实际上更简单：窗口只有 1 秒，等待即可
    for (let i = 0; i < 5; i++) {
      await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
      })
    }
    // 确认已限流
    const limitedRes = await app.request("/nudges", {
      headers: { Authorization: "Bearer valid", "X-Forwarded-For": ip },
    })
    expect(limitedRes.status).toBe(429)

    // 等待窗口过期（1 秒窗口 + buffer）
    await new Promise((r) => setTimeout(r, 1200))

    // 应恢复 — 仍 401（token 无效）但不再是 429
    const recoveredRes = await app.request("/nudges", {
      headers: { Authorization: "Bearer valid", "X-Forwarded-For": ip },
    })
    expect(recoveredRes.status).toBe(401)
  })

  test("successful auth clears rate limit for that IP", async () => {
    const { app, token } = createTestApp()
    const ip = "10.0.0.104"

    // 先触发一些失败
    for (let i = 0; i < 3; i++) {
      await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
      })
    }

    // 成功认证 → 清除计数
    await app.request("/nudges", {
      headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": ip },
    })

    // 再失败 5 次 → counter 到 5，isLimited 不拦截第 5 次（因为检查在记录之前）
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/nudges", {
        headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
      })
      expect(res.status).toBe(401)
    }
    // 第 6 次请求触发 429（counter ≥ 5）
    const res = await app.request("/nudges", {
      headers: { Authorization: "Bearer bad", "X-Forwarded-For": ip },
    })
    expect(res.status).toBe(429)
  })
})

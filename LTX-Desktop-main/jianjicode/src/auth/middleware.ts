/**
 * Bearer Token 认证中间件
 *
 * 从 Authorization: Bearer <token> 头提取 token，SHA-256 哈希后
 * 与 TokenStore 比对。豁免路径（/health）跳过认证。
 *
 * 特性：
 * - 常量时间 token 比较（防时序侧信道）
 * - IP 粒度滑动窗口速率限制（防暴力破解）
 * - 认证成功/失败的结构化审计日志
 * - 每个请求注入 X-Request-ID 用于全链路追踪
 */

import crypto from "node:crypto"
import { createMiddleware } from "hono/factory"
import type { TokenStore } from "./types.js"
import { AuthRateLimiter } from "./rate-limiter.js"

type FailureReason = "missing_header" | "bad_token" | "expired" | "revoked" | "rate_limited"

function logAuthEvent(
  event: "auth_success" | "auth_failure",
  detail: { reason?: FailureReason; path: string; requestId: string; clientIP: string },
): void {
  const entry = JSON.stringify({
    event,
    ...detail,
    timestamp: new Date().toISOString(),
  })
  process.stderr.write(`${entry}\n`)
}

/** getStore 是 getter 函数，允许模块在 main() 初始化 store 之前注册中间件 */
export function createAuthMiddleware(
  getStore: () => TokenStore,
  exemptPaths: string[] = ["/health"],
  rateLimiter: AuthRateLimiter = new AuthRateLimiter(),
) {
  return createMiddleware(async (c, next) => {
    if (exemptPaths.includes(c.req.path)) {
      return next()
    }

    // 请求追踪 ID
    const requestId = c.req.header("X-Request-ID") || crypto.randomUUID()
    c.res.headers.set("X-Request-ID", requestId)
    const ip = AuthRateLimiter.clientIP(c)

    // 速率限制检查（只读，不修改状态）
    if (rateLimiter.isLimited(ip)) {
      const retryAfter = rateLimiter.retryAfterSeconds(ip)
      logAuthEvent("auth_failure", { reason: "rate_limited", path: c.req.path, requestId, clientIP: ip })
      c.res.headers.set("Retry-After", String(retryAfter))
      return c.json({ success: false, error: "Too many requests" }, 429)
    }

    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      rateLimiter.recordFailure(ip)
      logAuthEvent("auth_failure", { reason: "missing_header", path: c.req.path, requestId, clientIP: ip })
      return c.json({ success: false, error: "Unauthorized" }, 401)
    }

    const token = authHeader.slice(7)
    const store = getStore()

    // Token 过期检查
    if (store.isExpired()) {
      rateLimiter.recordFailure(ip)
      logAuthEvent("auth_failure", { reason: "expired", path: c.req.path, requestId, clientIP: ip })
      return c.json({ success: false, error: "Token expired" }, 401)
    }

    // 常量时间比较
    if (!store.validate(token)) {
      rateLimiter.recordFailure(ip)
      logAuthEvent("auth_failure", { reason: "bad_token", path: c.req.path, requestId, clientIP: ip })
      return c.json({ success: false, error: "Unauthorized" }, 401)
    }

    // 认证成功 — 清除限流计数 + 审计日志
    rateLimiter.clearFailures(ip)
    logAuthEvent("auth_success", { path: c.req.path, requestId, clientIP: ip })

    return next()
  })
}

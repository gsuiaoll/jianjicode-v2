/**
 * 认证速率限制器 — 滑动窗口
 *
 * 按 IP 粒度限制认证失败次数，超限返回 429。
 * 纯内存实现，无外部依赖。
 */

interface WindowEntry {
  failures: number[]
}

const WINDOW_MS =
  parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "", 10) || 60_000
const MAX_FAILURES =
  parseInt(process.env.AUTH_RATE_LIMIT_MAX_FAILURES || "", 10) || 10

export class AuthRateLimiter {
  private buckets = new Map<string, WindowEntry>()

  /** 从请求中提取客户端 IP。X-Forwarded-For 取最右侧（最靠近服务器），X-Real-IP 作 fallback */
  static clientIP(c: { req: { header(name: string): string | undefined } }): string {
    const forwarded = c.req.header("X-Forwarded-For")
    if (forwarded) {
      const ips = forwarded.split(",")
      return ips[ips.length - 1].trim() || "127.0.0.1"
    }
    const realIP = c.req.header("X-Real-IP")
    if (realIP) return realIP.trim()
    return "127.0.0.1"
  }

  /** 只读检查是否已超限，不修改状态 */
  isLimited(ip: string): boolean {
    const now = Date.now()
    const cutoff = now - WINDOW_MS
    const entry = this.buckets.get(ip)
    if (!entry) return false
    const active = entry.failures.filter((t) => t > cutoff)
    return active.length >= MAX_FAILURES
  }

  /** 记录一次失败 */
  recordFailure(ip: string): void {
    const now = Date.now()
    const cutoff = now - WINDOW_MS
    let entry = this.buckets.get(ip)
    if (!entry) {
      entry = { failures: [] }
      this.buckets.set(ip, entry)
    }
    entry.failures = entry.failures.filter((t) => t > cutoff)
    entry.failures.push(now)
  }

  /** 超限后建议的等待秒数 */
  retryAfterSeconds(ip: string): number {
    const entry = this.buckets.get(ip)
    if (!entry || entry.failures.length === 0) return 0
    const oldest = entry.failures[0]
    return Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000)
  }

  /** 认证成功后清除该 IP 的失败记录（可选调用） */
  clearFailures(ip: string): void {
    this.buckets.delete(ip)
  }
}

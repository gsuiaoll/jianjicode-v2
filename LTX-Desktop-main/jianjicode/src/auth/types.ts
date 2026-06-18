/**
 * Token 认证 — 类型与接口
 *
 * TokenStore 接口抽象 token 存储，当前使用内存实现。
 * 将来如需 SQLite / Redis / 外部服务，实现此接口即可，中间件零改动。
 */

import { createHash, timingSafeEqual } from "node:crypto"

/** SHA-256 哈希 token，用于存储和比对 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** 常量时间字符串比较，防止时序侧信道攻击 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8")
  const bufB = Buffer.from(b, "utf-8")
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

/** 生成 jjc_ 前缀的 48 位随机 token（rejection sampling 消除取模偏差） */
export function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  // 256 不能被 62 整除，用 rejection sampling 保证均匀分布
  const maxValid = 256 - (256 % chars.length) // 248
  let result = "jjc_"
  while (result.length < 52) {
    const byte = new Uint8Array(1)
    crypto.getRandomValues(byte)
    if (byte[0] < maxValid) {
      result += chars[byte[0] % chars.length]
    }
  }
  return result
}

export interface TokenStore {
  /** 创建时间戳 (ms)，用于 TTL 判断 */
  readonly createdAt: number
  /** 验证 token 原始值是否匹配存储的哈希（过期或已撤销则返回 false） */
  validate(rawToken: string): boolean
  /** 返回当前有效的明文 token */
  getToken(): string
  /** 撤销 token，之后所有 validate() 返回 false */
  revoke(): void
  /** token 是否已过期 */
  isExpired(): boolean
}

/**
 * 统一测试 TokenStore
 *
 * 所有测试文件共享此实现，避免重复定义。
 * 继承 prod TokenStore 接口，额外提供 setExpired/setRevoked 测试控制方法。
 */

import { constantTimeEqual, hashToken } from "../../auth/types.js"
import type { TokenStore } from "../../auth/types.js"

export class TestTokenStore implements TokenStore {
  readonly createdAt: number
  private hashedToken: string
  private plainToken: string
  private _expired = false
  private _revoked = false
  private readonly ttlMs: number

  constructor(plainToken: string, ttlMs = 24 * 60 * 60 * 1000) {
    this.createdAt = Date.now()
    this.plainToken = plainToken
    this.hashedToken = hashToken(plainToken)
    this.ttlMs = ttlMs
  }

  validate(rawToken: string): boolean {
    if (this._revoked || this.isExpired()) return false
    return constantTimeEqual(hashToken(rawToken), this.hashedToken)
  }

  getToken(): string {
    return this.plainToken
  }

  revoke(): void {
    this._revoked = true
  }

  setExpired(expired: boolean): void {
    this._expired = expired
  }

  isExpired(): boolean {
    if (this._expired) return true
    return Date.now() > this.createdAt + this.ttlMs
  }
}

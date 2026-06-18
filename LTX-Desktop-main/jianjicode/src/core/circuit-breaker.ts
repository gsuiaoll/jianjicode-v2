/**
 * jianjicode 断路器
 *
 * 标准断路器模式（CLOSED → OPEN → HALF_OPEN），保护对外部资源（模型 API、
 * Python 桥接、工具初始化）的调用，防止级联故障。
 *
 * 状态机：
 *   CLOSED — 正常，计数失败次数。达到 failureThreshold → OPEN
 *   OPEN   — 请求直接拒绝（抛出 CircuitBreakerError）。timeout 后 → HALF_OPEN
 *   HALF_OPEN — 允许有限请求通过。成功达到 successThreshold → CLOSED，失败 → OPEN
 *
 * 使用：
 *   const breaker = new CircuitBreaker("model:gpt-4o", { failureThreshold: 5 })
 *   const result = await breaker.exec(() => callModel())
 */

import {
  CircuitBreakerError,
  classifyError,
  ErrorCode,
} from "../types/errors.js"

// ============================================================================
// 类型定义
// ============================================================================

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"

export interface CircuitBreakerConfig {
  /** 连续失败次数阈值 → 跳闸（默认 5） */
  failureThreshold: number
  /** HALF_OPEN 状态下连续成功次数阈值 → 关闭（默认 2） */
  successThreshold: number
  /** OPEN → HALF_OPEN 的冷却时间毫秒数（默认 30s） */
  timeout: number
  /** HALF_OPEN 状态允许的最大并发请求数（默认 1） */
  halfOpenMaxRequests: number
}

export interface CircuitBreakerStats {
  name: string
  state: CircuitState
  failureCount: number
  successCount: number
  totalRequests: number
  lastFailureTime: number | null
  lastSuccessTime: number | null
  openedAt: number | null
  halfOpenAttempts: number
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30_000,
  halfOpenMaxRequests: 1,
}

// ============================================================================
// 断路器实现
// ============================================================================

export class CircuitBreaker {
  private state: CircuitState = "CLOSED"
  private failureCount = 0
  private successCount = 0
  private totalRequests = 0
  private lastFailureTime: number | null = null
  private lastSuccessTime: number | null = null
  private openedAt: number | null = null
  private halfOpenAttempts = 0
  private readonly config: CircuitBreakerConfig
  readonly name: string

  /** 状态变化回调 */
  onOpen?: (stats: CircuitBreakerStats) => void
  onClose?: (stats: CircuitBreakerStats) => void
  onHalfOpen?: (stats: CircuitBreakerStats) => void

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ========================================================================
  // 公共 API
  // ========================================================================

  /** 获取当前状态 */
  getState(): CircuitState {
    this.maybeTransitionToHalfOpen()
    return this.state
  }

  /** 获取统计信息 */
  getStats(): CircuitBreakerStats {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      openedAt: this.openedAt,
      halfOpenAttempts: this.halfOpenAttempts,
    }
  }

  /** 手动重置为 CLOSED */
  reset(): void {
    this.state = "CLOSED"
    this.failureCount = 0
    this.successCount = 0
    this.lastFailureTime = null
    this.lastSuccessTime = null
    this.openedAt = null
    this.halfOpenAttempts = 0
  }

  /**
   * 在断路器保护下执行异步函数。
   * - 断路器 OPEN：抛出 CircuitBreakerError，不执行 fn
   * - 断路器 HALF_OPEN：允许有限请求通过
   * - 断路器 CLOSED：正常执行
   *
   * 注意：错误分类使用 classifyError — 只有 transient 错误计入
   * failureCount。permanent 错误同样抛出但**不计入**断路器计数（它们不会
   * 触发跳闸，因为重试也无意义）。
   */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++

    // 检查是否可从 OPEN → HALF_OPEN
    this.maybeTransitionToHalfOpen()

    if (this.state === "OPEN") {
      throw new CircuitBreakerError(
        this.name,
        `Circuit "${this.name}" is open (failed ${this.failureCount}/${this.config.failureThreshold})`,
        {
          details: {
            state: this.state,
            failureCount: this.failureCount,
            openedAt: this.openedAt,
          },
        },
      )
    }

    // HALF_OPEN — 限制并发
    if (this.state === "HALF_OPEN") {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxRequests) {
        throw new CircuitBreakerError(
          this.name,
          `Circuit "${this.name}" is half-open, all ${this.config.halfOpenMaxRequests} trial slots used`,
          {
            details: {
              state: this.state,
              halfOpenAttempts: this.halfOpenAttempts,
            },
          },
        )
      }
      this.halfOpenAttempts++
    }

    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (error) {
      this.recordFailure(error)
      throw error
    }
  }

  /** 手动记录一次成功 */
  recordSuccess(): void {
    this.lastSuccessTime = Date.now()

    if (this.state === "HALF_OPEN") {
      this.successCount++
      if (this.successCount >= this.config.successThreshold) {
        const prev = this.state
        this.state = "CLOSED"
        this.failureCount = 0
        this.successCount = 0
        this.halfOpenAttempts = 0
        this.openedAt = null
        this.onClose?.(this.getStats())
        console.log(
          `[circuit-breaker] "${this.name}" ${prev}→CLOSED (recovered)`,
        )
      }
    } else {
      // CLOSED: 成功后重置失败计数
      this.failureCount = 0
    }
  }

  /** 手动记录一次失败 */
  recordFailure(error?: unknown): void {
    // 只有 transient 类错误计入断路器计数
    if (error) {
      const classified = classifyError(error)
      if (classified.category !== "transient") {
        // permanent 错误 — 不计入断路器，直接透传
        return
      }
    }

    this.failureCount++
    this.lastFailureTime = Date.now()

    if (this.state === "HALF_OPEN") {
      // HALF_OPEN 下任何失败立即回到 OPEN
      const prev = this.state
      this.state = "OPEN"
      this.openedAt = Date.now()
      this.halfOpenAttempts = 0
      this.onOpen?.(this.getStats())
      console.log(
        `[circuit-breaker] "${this.name}" ${prev}→OPEN (half-open trial failed, ${this.failureCount} failures)`,
      )
    } else if (
      this.state === "CLOSED" &&
      this.failureCount >= this.config.failureThreshold
    ) {
      // CLOSED → OPEN
      this.state = "OPEN"
      this.openedAt = Date.now()
      this.onOpen?.(this.getStats())
      console.log(
        `[circuit-breaker] "${this.name}" CLOSED→OPEN (${this.failureCount}/${this.config.failureThreshold} failures)`,
      )
    }
  }

  // ========================================================================
  // 内部方法
  // ========================================================================

  /** 检查是否应从 OPEN → HALF_OPEN */
  private maybeTransitionToHalfOpen(): void {
    if (this.state !== "OPEN" || this.openedAt === null) return

    const elapsed = Date.now() - this.openedAt
    if (elapsed >= this.config.timeout) {
      this.state = "HALF_OPEN"
      this.successCount = 0
      this.halfOpenAttempts = 0
      this.onHalfOpen?.(this.getStats())
      console.log(
        `[circuit-breaker] "${this.name}" OPEN→HALF_OPEN (after ${elapsed}ms cooling)`,
      )
    }
  }
}

// ============================================================================
// 全局断路器注册表
// ============================================================================

const registry = new Map<string, CircuitBreaker>()

/**
 * 全局断路器注册表 — 按名称获取或创建断路器。
 *
 * 命名约定：
 *   "model:{modelId}"       — 模型 API 调用
 *   "python:{endpoint}"     — Python 桥接端点
 *   "tool:{toolName}"       — 工具初始化
 */
export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>,
): CircuitBreaker {
  let breaker = registry.get(name)
  if (!breaker) {
    breaker = new CircuitBreaker(name, config)
    registry.set(name, breaker)
  }
  return breaker
}

/** 重置所有断路器状态 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of registry.values()) {
    breaker.reset()
  }
}

/** 获取所有断路器统计 */
export function getAllCircuitBreakerStats(): Record<
  string,
  CircuitBreakerStats
> {
  const result: Record<string, CircuitBreakerStats> = {}
  for (const [name, breaker] of registry) {
    result[name] = breaker.getStats()
  }
  return result
}

/** 删除指定断路器 */
export function removeCircuitBreaker(name: string): boolean {
  return registry.delete(name)
}

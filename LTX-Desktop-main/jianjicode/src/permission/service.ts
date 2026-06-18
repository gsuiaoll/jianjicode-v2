/**
 * jianjicode 权限系统 — 核心服务
 *
 * PermissionService 工厂函数 + AsyncLocalStorage 上下文传播。
 *
 * 服务方法：
 *   evaluate() — 同步判定 allow/deny/ask，不阻塞
 *   ask()      — 需要用户确认时创建待决请求，await 直到 reply()
 *   reply()    — 外部调用（HTTP/CLI），兑现 ask() 的 Promise
 *
 * Deferred 模式（无 Effect-TS）：
 *   ask() 内部创建一个 Promise，将 resolve/reject 存入 pending 表，
 *   然后 await 该 Promise。reply() 从 pending 表取出兑现。
 *   超时用 setTimeout 自动 reject。
 */

import { AsyncLocalStorage } from "node:async_hooks"
import {
  PermissionDeniedError,
  PermissionRejectedError,
  PermissionTimeoutError,
} from "./errors.js"
import { evaluate as evaluateRules } from "./ruleset.js"
import type { AlwaysAllowStore } from "./store.js"
import type {
  PermissionAction,
  PermissionCheck,
  PermissionContext,
  PermissionReply,
  PermissionRequest,
  ReplyInput,
  Ruleset,
} from "./types.js"

// ============================================================================
// ID 生成
// ============================================================================

let requestCounter = 0

function generateRequestID(): string {
  requestCounter++
  return `perm-${Date.now().toString(36)}-${requestCounter.toString(36)}`
}

// ============================================================================
// AsyncLocalStorage 上下文
// ============================================================================

export const permissionStorage = new AsyncLocalStorage<PermissionContext>()

// ============================================================================
// Pending entry 类型
// ============================================================================

interface PendingEntry {
  request: PermissionRequest
  resolve: () => void
  reject: (error: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

// ============================================================================
// 审计日志
// ============================================================================

function auditLog(event: string, data: Record<string, unknown>): void {
  const timestamp = new Date().toISOString().slice(11, 23)
  const sessionID = (data.sessionID || data.sid || "") as string
  const shortSid =
    sessionID.length > 12 ? sessionID.slice(0, 12) + ".." : sessionID

  switch (event) {
    case "evaluate":
      console.log(
        `[permission] evaluate  | ${shortSid} | ${String(data.target)}="${String(data.pattern)}" → ${String(data.action)}` +
          (data.rule ? `  (rule: ${JSON.stringify(data.rule)})` : ""),
      )
      break
    case "ask":
      console.log(
        `[permission] ask       | ${shortSid} | ${String(data.permission)}=${String(data.pattern)} | waiting`,
      )
      break
    case "reply":
      console.log(
        `[permission] reply     | ${shortSid} | req=${String(data.requestID)} | ${String(data.action)}` +
          (data.feedback ? `  feedback="${String(data.feedback)}"` : ""),
      )
      break
    case "timeout":
      console.log(
        `[permission] timeout   | ${shortSid} | req=${String(data.requestID)} | expired`,
      )
      break
    case "always_allow":
      console.log(
        `[permission] allow     | ${shortSid} | ${String(data.target)}="${String(data.pattern)}" | persisted`,
      )
      break
  }
}

// ============================================================================
// Service 接口
// ============================================================================

export interface PermissionService {
  /**
   * 同步判定 — 不阻塞，不创建待决请求。
   * 调用方根据返回值决定后续行为。
   */
  evaluate(permission: string, pattern: string): Promise<PermissionAction>

  /**
   * 异步权限检查。
   * - "allow": 直接返回
   * - "deny":  抛出 PermissionDeniedError
   * - "ask":   创建待决请求，通过 AsyncLocalStorage 的 onRequest 发出，
   *            await 直到 reply() 兑现或超时
   */
  ask(check: PermissionCheck): Promise<void>

  /**
   * 外部调用 — 回复待决的权限请求。
   * 由 HTTP POST /permission/reply 或 CLI 调用。
   * 只有 ask() 创建了待决请求后，reply() 才有意义。
   */
  reply(input: ReplyInput): void

  /** 列出所有待决请求 */
  listPending(): PermissionRequest[]

  /** 获取指定待决请求 */
  getPending(id: string): PermissionRequest | undefined

  /** 设置会话级别覆盖规则 */
  setSessionRules(sessionID: string, rules: Ruleset): void

  /** 清除会话级别覆盖 */
  clearSessionRules(sessionID: string): void

  /** 获取当前配置的规则集 */
  getRules(): Ruleset

  /** 获取 AlwaysAllowStore 的内容 */
  getAlwaysAllowed(): Ruleset
}

// ============================================================================
// 工厂
// ============================================================================

export interface PermissionServiceOptions {
  /** 基础规则集（来自配置） */
  rules?: Ruleset
  /** 无规则匹配时的默认动作 */
  defaultAction?: PermissionAction
  /** 持久化存储实例 */
  store?: AlwaysAllowStore
}

// ============================================================================
// 全局单例（供 agent-loop / chat-session 等动态 import 使用）
// ============================================================================

let _globalService: PermissionService | null = null

/** 设置全局权限服务单例。由 chat-core 在初始化时调用。 */
export function setGlobalPermissionService(svc: PermissionService): void {
  _globalService = svc
}

/** 获取全局权限服务单例。如果未初始化则抛出错误。 */
export function getGlobalPermissionService(): PermissionService {
  if (!_globalService) {
    throw new Error(
      "Permission service not initialized. Call setGlobalPermissionService() first.",
    )
  }
  return _globalService
}

/**
 * 便捷访问：在需要延迟绑定（如模块级动态 import）的场景中使用。
 * 等价于 getGlobalPermissionService()。
 */
export const permissionService: PermissionService = new Proxy(
  {} as PermissionService,
  {
    get(_target, prop: keyof PermissionService) {
      const svc = getGlobalPermissionService()
      return svc[prop]
    },
  },
)

export function createPermissionService(
  opts: PermissionServiceOptions = {},
): PermissionService {
  const { defaultAction = "ask", store } = opts
  const baseRules: Ruleset = opts.rules ?? []

  // 会话级别覆盖规则
  const sessionRules = new Map<string, Ruleset>()

  // 待决请求表
  const pendingRequests = new Map<string, PendingEntry>()

  // ========================================================================
  // evaluate()
  // ========================================================================

  async function evaluate(
    permission: string,
    pattern: string,
  ): Promise<PermissionAction> {
    // 从 AsyncLocalStorage 获取 sessionID
    const ctx = permissionStorage.getStore()
    const sessionID = ctx?.sessionID ?? "unknown"

    // 收集所有规则集
    const rulesets: Ruleset[] = [baseRules]

    // always-allow 持久化规则
    if (store) {
      rulesets.push(store.getAll())
    }

    // 会话级别覆盖
    if (sessionID && sessionRules.has(sessionID)) {
      rulesets.push(sessionRules.get(sessionID)!)
    }

    // 执行匹配
    const result = evaluateRules(
      permission,
      pattern,
      defaultAction,
      ...rulesets,
    )

    // 审计日志
    auditLog("evaluate", {
      sessionID,
      target: permission,
      pattern,
      action: result.action,
      rule: result.rule
        ? {
            target: result.rule.target,
            pattern: result.rule.pattern,
            action: result.rule.action,
          }
        : undefined,
    })

    return result.action
  }

  // ========================================================================
  // ask()
  // ========================================================================

  async function ask(check: PermissionCheck): Promise<void> {
    const ctx = permissionStorage.getStore()
    const sessionID = ctx?.sessionID ?? "unknown"

    // 同步判定
    for (const pattern of check.patterns) {
      const action = await evaluate(check.permission, pattern)

      if (action === "allow") {
        continue
      }

      if (action === "deny") {
        throw new PermissionDeniedError(check.permission, pattern, undefined, {
          details: { sessionID },
        })
      }

      // action === "ask" — 创建待决请求
      const requestID = generateRequestID()
      const timeoutMs = check.timeoutMs ?? 300_000
      const alwaysPatterns = check.alwaysPatterns ?? check.patterns

      const request: PermissionRequest = {
        id: requestID,
        sessionID,
        permission: check.permission,
        patterns: [pattern],
        metadata: check.metadata ?? {},
        alwaysPatterns,
        timeoutMs,
        createdAt: Date.now(),
      }

      // Deferred Promise
      const promise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (pendingRequests.has(requestID)) {
            pendingRequests.delete(requestID)
            auditLog("timeout", { sessionID, requestID, timeoutMs })
            reject(
              new PermissionTimeoutError(requestID, timeoutMs, {
                details: { sessionID },
              }),
            )
          }
        }, timeoutMs)

        pendingRequests.set(requestID, { request, resolve, reject, timeout })
      })

      // 审计日志
      auditLog("ask", {
        sessionID,
        permission: check.permission,
        pattern,
        requestID,
      })

      // 通知 UI（通过 AsyncLocalStorage 的 onRequest 回调）
      ctx?.onRequest?.(request)

      // 阻塞直到 reply() 或超时
      await promise
    }
  }

  // ========================================================================
  // reply()
  // ========================================================================

  function reply(input: ReplyInput): void {
    const { requestID, action } = input
    const entry = pendingRequests.get(requestID)

    if (!entry) {
      throw new Error(
        `No pending permission request: ${requestID} (may have timed out)`,
      )
    }

    const { request, resolve, reject, timeout } = entry
    pendingRequests.delete(requestID)
    clearTimeout(timeout)

    // 审计日志
    auditLog("reply", {
      sessionID: request.sessionID,
      requestID,
      action,
      feedback: input.feedback,
    })

    switch (action) {
      case "allow_once":
        resolve()
        break

      case "allow_always":
        // 持久化到 store
        for (const pattern of request.alwaysPatterns) {
          const rule = {
            target: request.permission,
            pattern,
            action: "allow" as const,
          }
          store?.add(rule)
          auditLog("always_allow", {
            sessionID: request.sessionID,
            target: request.permission,
            pattern,
          })
        }
        resolve()
        break

      case "deny":
        reject(
          new PermissionRejectedError(
            requestID,
            `User denied: ${request.permission}`,
            undefined,
            {
              details: { sessionID: request.sessionID },
            },
          ),
        )
        break

      case "reject":
        reject(
          new PermissionRejectedError(
            requestID,
            input.feedback || "User rejected with feedback",
            input.feedback,
            {
              details: { sessionID: request.sessionID },
            },
          ),
        )
        break
    }
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  function listPending(): PermissionRequest[] {
    return Array.from(pendingRequests.values()).map((e) => e.request)
  }

  function getPending(id: string): PermissionRequest | undefined {
    return pendingRequests.get(id)?.request
  }

  function setSessionRules(sessionID: string, rules: Ruleset): void {
    sessionRules.set(sessionID, rules)
  }

  function clearSessionRules(sessionID: string): void {
    sessionRules.delete(sessionID)
  }

  function getRules(): Ruleset {
    return [...baseRules]
  }

  function getAlwaysAllowed(): Ruleset {
    return store?.getAll() ?? []
  }

  return {
    evaluate,
    ask,
    reply,
    listPending,
    getPending,
    setSessionRules,
    clearSessionRules,
    getRules,
    getAlwaysAllowed,
  }
}

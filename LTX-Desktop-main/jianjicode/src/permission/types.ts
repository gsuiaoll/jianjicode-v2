/**
 * jianjicode 权限系统 — 核心类型
 *
 * 三层动作模型：allow（放行） / deny（拒绝） / ask（询问用户）
 * 规则匹配：last-match-wins + priority 排序
 * 用户回复：allow_once / allow_always / deny / reject
 */

// ============================================================================
// 权限动作与规则
// ============================================================================

/**
 * 规则匹配后的执行动作。
 * - allow: 静默放行
 * - deny:  抛出 PermissionDeniedError
 * - ask:   提示用户确认
 */
export type PermissionAction = "allow" | "deny" | "ask"

/**
 * 用户的回复。
 * - allow_once:   单次放行（不持久化）
 * - allow_always: 放行并持久化到 AlwaysAllowStore
 * - deny:         拒绝本次请求
 * - reject:       拒绝并附带反馈信息
 */
export type PermissionReply = "allow_once" | "allow_always" | "deny" | "reject"

/**
 * 单条权限规则。
 * permission 和 pattern 均支持通配符匹配（* 匹配任意字符）。
 *
 * priority 控制规则优先级（数字越大优先匹配）。
 * 不传则默认 0，靠规则在 ruleset 中的顺序决定。
 */
export interface PermissionRule {
  /** 权限目标，如 "tool:call", "file:write", "network" */
  target: string
  /** 通配符模式，如 "trim_*", "**\/*.mp4" */
  pattern: string
  /** 匹配后执行的动作 */
  action: PermissionAction
  /** 优先级（数字越大越优先，默认 0） */
  priority?: number
  /** 可选描述（用于审计日志和 UI 展示） */
  description?: string
}

/** 有序的规则集合 */
export type Ruleset = PermissionRule[]

// ============================================================================
// 权限请求与回复
// ============================================================================

/**
 * 权限检查输入 — 由工具或 agent-loop 发起。
 * sessionID 和 tool 字段由底层自动填充，调用方无需传。
 */
export interface PermissionCheck {
  /** 权限目标，如 "tool:call" */
  permission: string
  /** 资源模式列表，如 ["trim_video"] 或 ["/path/to/file.mp4"] */
  patterns: string[]
  /** 如果本次请求超时未回复，自动 reject（默认 300000 = 5min） */
  timeoutMs?: number
  /** 权限检查相关的附加信息 */
  metadata?: Record<string, unknown>
  /** 用户选择 "allow_always" 时，需要持久化的模式列表（默认 = patterns） */
  alwaysPatterns?: string[]
}

/**
 * 正在等待用户回复的权限请求。
 */
export interface PermissionRequest {
  /** 请求 ID（全局唯一） */
  id: string
  /** 会话 ID */
  sessionID: string
  /** 权限目标 */
  permission: string
  /** 资源模式列表 */
  patterns: string[]
  /** 涉及的工具 ID（如有） */
  toolID?: string
  /** 附加信息 */
  metadata: Record<string, unknown>
  /** 用户选择 allow_always 时持久化的模式 */
  alwaysPatterns: string[]
  /** 超时时间 ms（默认 300000） */
  timeoutMs: number
  /** 创建时间戳 */
  createdAt: number
}

/**
 * 外部调用者（HTTP 端点 / CLI）的回复输入。
 */
export interface ReplyInput {
  /** 要回复的请求 ID */
  requestID: string
  /** 用户的决定 */
  action: PermissionReply
  /** reject 时可附带反馈信息 */
  feedback?: string
}

// ============================================================================
// 权限配置
// ============================================================================

/**
 * config.json 中的 permission 配置块结构。
 */
export interface PermissionConfig {
  /** 权限规则列表 */
  rules: PermissionRule[]
  /** 当没有规则匹配时的默认动作（默认 "ask"） */
  defaultAction?: PermissionAction
}

// ============================================================================
// Service 上下文（通过 AsyncLocalStorage 传播）
// ============================================================================

/**
 * 在 agent-loop 中通过 AsyncLocalStorage 传播的上下文。
 * 工具在 buildToolSet().execute 中可以读取到此上下文。
 */
export interface PermissionContext {
  sessionID: string
  /** 当权限请求创建时的回调（通常向 onStream 发送 permission-request 事件） */
  onRequest?: (request: PermissionRequest) => void
}

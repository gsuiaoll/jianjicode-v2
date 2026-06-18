/**
 * jianjicode 权限系统 — 配置解析
 *
 * 从 AppConfig 中提取 permissions 配置块，
 * 转换为标准的 Ruleset 格式。
 */

import type {
  PermissionAction,
  PermissionConfig,
  PermissionRule,
} from "./types.js"

// ============================================================================
// 内置默认规则
// ============================================================================

const DEFAULT_RULES: PermissionRule[] = [
  {
    target: "tool:call",
    pattern: "test_*",
    action: "allow",
    priority: 10,
    description: "测试工具自动放行",
  },
  {
    target: "tool:call",
    pattern: "fake_video",
    action: "allow",
    priority: 10,
    description: "模拟工具自动放行",
  },
  {
    target: "tool:call",
    pattern: "batch_*",
    action: "allow",
    priority: 10,
    description: "批处理工具自动放行",
  },
  {
    target: "tool:call",
    pattern: "*",
    action: "ask",
    priority: 0,
    description: "其他工具需确认",
  },
]

// ============================================================================
// 配置解析
// ============================================================================

/**
 * 从 AppConfig 中加载 permission 配置。
 * 返回合并后的 PermissionConfig（内置默认 + 用户配置）。
 *
 * config.json 格式：
 * ```json
 * {
 *   "permissions": {
 *     "defaultAction": "ask",
 *     "rules": [
 *       { "target": "tool:call", "pattern": "music_search", "action": "deny", "priority": 20 }
 *     ]
 *   }
 * }
 * ```
 *
 * 也支持简写格式：
 * ```json
 * {
 *   "permissions": {
 *     "tool:call": { "music_search": "deny", "trim_*": "allow" }
 *   }
 * }
 * ```
 */
export function loadPermissionConfig(
  config: Record<string, unknown>,
): PermissionConfig {
  const rawConfig = config?.permissions as Record<string, unknown> | undefined
  const defaultAction: PermissionAction =
    (rawConfig?.defaultAction as PermissionAction) ?? "ask"
  const userRules: PermissionRule[] = []

  if (rawConfig) {
    if (Array.isArray(rawConfig.rules)) {
      for (const r of rawConfig.rules as Record<string, unknown>[]) {
        if (r.target && r.pattern && r.action) {
          userRules.push({
            target: r.target as string,
            pattern: r.pattern as string,
            action: r.action as PermissionAction,
            priority: (r.priority as number) ?? 100,
            description: r.description as string | undefined,
          })
        }
      }
    } else {
      // 简写格式: { "tool:call": { "music_search": "deny" } }
      for (const [target, patterns] of Object.entries(rawConfig)) {
        if (target === "defaultAction" || target === "rules") continue
        if (
          patterns &&
          typeof patterns === "object" &&
          !Array.isArray(patterns)
        ) {
          for (const [pattern, action] of Object.entries(patterns)) {
            if (typeof action === "string" && isAction(action)) {
              userRules.push({ target, pattern, action, priority: 100 })
            }
          }
        }
      }
    }
  }

  return { defaultAction, rules: [...DEFAULT_RULES, ...userRules] }
}

function isAction(value: string): value is PermissionAction {
  return value === "allow" || value === "deny" || value === "ask"
}

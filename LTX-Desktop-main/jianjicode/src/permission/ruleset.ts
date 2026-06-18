/**
 * jianjicode 权限系统 — 规则评估引擎
 *
 * evaluate() 实现了 last-match-wins + priority 排序的规则匹配。
 * 多个 ruleset 合并后统一匹配，高优先级规则优先于低优先级，
 * 同优先级内后出现的规则覆盖前面的。
 *
 * 纯函数，无依赖。
 */

import type { PermissionAction, PermissionRule, Ruleset } from "./types.js"
import { matchWildcard } from "./wildcard.js"

// ============================================================================
// 评估结果
// ============================================================================

export interface EvaluateResult {
  /** 匹配到的动作 */
  action: PermissionAction
  /** 实际匹配的规则（如果没有匹配则为 undefined） */
  rule?: PermissionRule
}

// ============================================================================
// 规则排序
// ============================================================================

/**
 * 对 ruleset 按 priority 降序排序（高优先在前），
 * 同 priority 内保持原始顺序。
 * 注意：这不是 stable sort 所要求的严格语义，
 * 我们特意保留"后匹配优先"的行为。
 */
function sortRuleset(rules: Ruleset): Ruleset {
  return [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
}

// ============================================================================
// evaluate() — 核心匹配
// ============================================================================

/**
 * 评估指定的权限 + 模式在多个 ruleset 中的匹配结果。
 *
 * 匹配逻辑：
 *   1. 将所有 ruleset 展平为一维数组
 *   2. 按 priority 降序排列（高优先在前）
 *   3. 对每个规则，检查 target 和 pattern 是否通配符匹配
 *   4. 返回**最后一个**匹配规则的 action
 *   5. 如果没有任何规则匹配，返回 defaultAction（默认 "ask"）
 *
 * @param permission    要检查的权限目标（如 "tool:call"）
 * @param pattern       要检查的模式（如 "trim_video"）
 * @param defaultAction 无规则匹配时的默认动作
 * @param rulesets      参与匹配的规则集合（多个合并）
 * @returns             匹配结果 { action, rule? }
 */
export function evaluate(
  permission: string,
  pattern: string,
  defaultAction: PermissionAction = "ask",
  ...rulesets: Ruleset[]
): EvaluateResult {
  // 合并所有 ruleset
  const allRules: Ruleset = rulesets.flat()

  if (allRules.length === 0) {
    return { action: defaultAction }
  }

  // 按 priority 降序排列（高优先在前）
  const sorted = sortRuleset(allRules)

  // 找到最高 priority 的匹配规则，同 priority 内 last-match-wins
  let matched: EvaluateResult = { action: defaultAction }
  let highestPriority = -Infinity

  for (const rule of sorted) {
    if (
      matchWildcard(rule.target, permission) &&
      matchWildcard(rule.pattern, pattern)
    ) {
      const priority = rule.priority ?? 0
      if (priority > highestPriority) {
        // 更高优先级 — 覆盖
        matched = { action: rule.action, rule }
        highestPriority = priority
      } else if (priority === highestPriority) {
        // 同优先级 — last-match-wins
        matched = { action: rule.action, rule }
      }
      // 低优先级规则被忽略
    }
  }

  return matched
}

/**
 * 从规则集合中筛选出被完全禁止的工具 ID 集合。
 * 要求：匹配 pattern="*"（全局模式）且 action="deny"。
 */
export function findGloballyDenied(
  allToolIDs: string[],
  ...rulesets: Ruleset[]
): Set<string> {
  const denied = new Set<string>()

  for (const toolID of allToolIDs) {
    const result = evaluate("tool:call", toolID, "ask", ...rulesets)
    if (result.action === "deny" && result.rule?.pattern === "*") {
      denied.add(toolID)
    }
  }

  return denied
}

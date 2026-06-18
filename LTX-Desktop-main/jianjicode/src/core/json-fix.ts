/**
 * jianjicode JSON Fix Utility
 *
 * 修复 AI 模型吐出的常见 JSON 格式错误：
 * - 尾逗号（trailing commas）
 * - Python None → null
 * - Python True/False → true/false
 * - 单引号 → 双引号
 * - 未引号的 key（如 {key: "value"}）
 * - 行注释 // 和 #
 * - 多余的逗号
 *
 * @license MIT
 */

// ============================================================================
// 修复函数
// ============================================================================

/**
 * 修复常见的 JSON 格式错误。
 * 按顺序应用多个修复策略。
 */
export function fixJson(raw: string): string {
  if (!raw || raw.trim().length === 0) return raw

  let text = raw

  // 1. 移除 markdown 代码围栏
  text = text.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "")

  // 2. 移除行注释（// 和 #）
  text = text.replace(/\/\/.*$/gm, "")
  text = text.replace(/^\s*#.*$/gm, "")

  // 3. Python None → null
  text = text.replace(/\bNone\b/g, "null")

  // 4. Python True/False → true/false
  text = text.replace(/\bTrue\b/g, "true")
  text = text.replace(/\bFalse\b/g, "false")

  // 5. 单引号字符串 → 双引号（只在 JSON 上下文内）
  // 将单引号包围的字符串转为双引号
  text = text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, group) => {
    // 避免将已经正确的双引号内容破坏
    return `"${group}"`
  })

  // 6. 未引号的 key（如 {key: "value"}，但不是数字或布尔值）
  // 匹配 { 或 , 后面跟着的未引号 key:
  text = text.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":')

  // 7. 移除 object/array 中多余的逗号（尾逗号）
  text = text.replace(/,\s*}/g, "}")
  text = text.replace(/,\s*\]/g, "]")

  // 8. 修复连续的逗号
  text = text.replace(/,+/g, ",")

  // 9. 修复空内容（尝试兜底）
  text = text.trim()

  return text
}

/**
 * 修复并解析 JSON。
 * 先 fixJson()，再 JSON.parse()。
 * 如果解析失败，尝试提取最外层的 { } 或 [ ] 块重试。
 */
export function parseFixedJson<T = unknown>(raw: string): T | null {
  const fixed = fixJson(raw)
  if (!fixed) return null

  // 第一次尝试直接解析
  try {
    return JSON.parse(fixed) as T
  } catch {
    // 解析失败，尝试提取最外层对象
  }

  // 尝试提取最外层的 { } 对象
  try {
    const objMatch = fixed.match(/\{[\s\S]*\}/)
    if (objMatch) {
      const objFixed = fixJson(objMatch[0])
      return JSON.parse(objFixed) as T
    }
  } catch {
    // fall through
  }

  // 尝试提取最外层的 [ ] 数组
  try {
    const arrMatch = fixed.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      const arrFixed = fixJson(arrMatch[0])
      return JSON.parse(arrFixed) as T
    }
  } catch {
    // fall through
  }

  return null
}

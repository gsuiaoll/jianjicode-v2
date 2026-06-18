/**
 * jianjicode 权限系统 — 通配符匹配
 *
 * 支持 *（匹配任意字符序列）和 ?（匹配单个字符）。
 * 用于 PermissionRule 的 target 和 pattern 匹配。
 *
 * 纯函数，无依赖。
 */

/**
 * 通配符匹配 — 判断 value 是否匹配 pattern。
 *
 * 规则：
 *   - * 匹配任意字符序列（包括空串）
 *   - ? 匹配任意单个字符
 *   - 其他字符按字面匹配
 *
 * 示例：
 *   matchWildcard("trim_*", "trim_video")           → true
 *   matchWildcard("trim_*", "concat_video")          → false
 *   matchWildcard("*.mp4", "video.mp4")              → true
 *   matchWildcard("batch_*", "batch_queue")           → true
 *   matchWildcard("audio?.ts", "audio1.ts")           → true
 *   matchWildcard("audio?.ts", "audio12.ts")          → false
 */
export function matchWildcard(pattern: string, value: string): boolean {
  let pi = 0 // pattern index
  let vi = 0 // value index
  let starP = -1 // last * position in pattern
  let starV = -1 // last * position in value

  while (vi < value.length) {
    if (pi < pattern.length && pattern[pi] === value[vi]) {
      pi++
      vi++
    } else if (pi < pattern.length && pattern[pi] === "?") {
      pi++
      vi++
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starP = pi
      starV = vi
      pi++
    } else if (starP !== -1) {
      pi = starP + 1
      starV++
      vi = starV
    } else {
      return false
    }
  }

  // skip trailing *
  while (pi < pattern.length && pattern[pi] === "*") {
    pi++
  }

  return pi === pattern.length
}

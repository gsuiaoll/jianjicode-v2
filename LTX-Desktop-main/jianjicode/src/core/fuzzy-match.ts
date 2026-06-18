/**
 * jianjicode 模糊匹配引擎
 *
 * 双策略设计：
 * - 代码块匹配：8 级字符串匹配（exact → context-aware），用于 ffmpeg 命令、API 调用参数
 * - 文本描述匹配：string-similarity 语义相似度（阈值 0.7），用于步骤描述、参数说明
 *
 * 借鉴 Hermes Agent 的设计模式（MIT 许可证），仅借鉴思路，不复制代码。
 *
 * @license MIT
 */

// ============================================================================
// 8 级代码块匹配
// ============================================================================

export interface FuzzyMatchResult {
  matched: boolean
  level: number // 1-8, higher = more fuzzy
  levelName: string
  score: number // 0-1
}

/**
 * 8 级代码匹配（从严格到模糊）
 *
 * Level 1: exact match
 * Level 2: case-insensitive
 * Level 3: whitespace-normalized
 * Level 4: punctuation-stripped
 * Level 5: number-normalized
 * Level 6: common-variable-normalized
 * Level 7: semantic-token-match (subsequence match on tokens)
 * Level 8: context-aware (length ratio within tolerance)
 */
export function fuzzyMatchCodeBlocks(
  actual: string,
  expected: string,
): FuzzyMatchResult {
  if (!actual || !expected) {
    return { matched: false, level: 0, levelName: "empty", score: 0 }
  }

  const a = actual.trim()
  const b = expected.trim()

  // Level 1: exact match
  if (a === b) {
    return { matched: true, level: 1, levelName: "exact", score: 1.0 }
  }

  // Level 2: case-insensitive
  if (a.toLowerCase() === b.toLowerCase()) {
    return {
      matched: true,
      level: 2,
      levelName: "case-insensitive",
      score: 0.95,
    }
  }

  // Level 3: whitespace-normalized
  const normStr = (s: string) => s.replace(/\s+/g, " ").trim()
  if (normStr(a.toLowerCase()) === normStr(b.toLowerCase())) {
    return {
      matched: true,
      level: 3,
      levelName: "whitespace-normalized",
      score: 0.9,
    }
  }

  // Level 4: punctuation-stripped
  const stripPunct = (s: string) =>
    s
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  if (stripPunct(a) === stripPunct(b)) {
    return {
      matched: true,
      level: 4,
      levelName: "punctuation-stripped",
      score: 0.8,
    }
  }

  // Level 5: number-normalized (replace all numbers with a placeholder)
  const normNums = (s: string) =>
    s
      .replace(/\b\d+(\.\d+)?\b/g, "0")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  if (normNums(stripPunct(a)) === normNums(stripPunct(b))) {
    return {
      matched: true,
      level: 5,
      levelName: "number-normalized",
      score: 0.7,
    }
  }

  // Level 6: common-variable-normalized (replace common var names like `input.mp4`, `output.mp4`, etc.)
  // 在原始字符串上做变量归一化（stripPunct 会破坏 `input.mp4` 中的边界）
  const normVars = (s: string) =>
    s
      .replace(/\b(input|output|file|temp|result)\b\.?[a-z0-9]*/gi, "VAR")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  if (normVars(a) === normVars(b)) {
    return {
      matched: true,
      level: 6,
      levelName: "variable-normalized",
      score: 0.6,
    }
  }

  // Level 7: token-subsequence match (check if significant tokens appear in both)
  // 用非字母数字分割 token，适用于 "scale=1280:720" 这类无空白字符串
  const tokenize = (s: string): string[] => {
    // 兼容 Bun/Node: 用 ASCII 范围处理非单词字符，避免 CJK Unicode range 的 JIT 问题
    const tokens: string[] = []
    let current = ""
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (/[a-zA-Z0-9]/.test(ch) || ch.charCodeAt(0) > 127) {
        current += ch.toLowerCase()
      } else {
        if (current.length > 2) tokens.push(current)
        current = ""
      }
    }
    if (current.length > 2) tokens.push(current)
    return tokens
  }
  const tokensA = new Set(tokenize(a))
  const tokensB = new Set(tokenize(b))
  if (tokensA.size > 0 && tokensB.size > 0) {
    const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)))
    const jaccardA = intersection.size / tokensA.size
    const jaccardB = intersection.size / tokensB.size
    const avgJaccard = (jaccardA + jaccardB) / 2
    if (avgJaccard >= 0.6) {
      return {
        matched: true,
        level: 7,
        levelName: "token-subsequence",
        score: avgJaccard,
      }
    }
  }

  // Level 8: context-aware (length ratio within tolerance)
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length)
  if (lenRatio >= 0.8 && tokensA.size > 0 && tokensB.size > 0) {
    const commonTokens = [...tokensA].filter((t) => tokensB.has(t)).length
    if (commonTokens >= Math.min(tokensA.size, tokensB.size) * 0.3) {
      return {
        matched: true,
        level: 8,
        levelName: "context-aware",
        score: lenRatio * 0.5,
      }
    }
  }

  return { matched: false, level: 0, levelName: "no-match", score: 0 }
}

// ============================================================================
// 文本描述语义匹配
// ============================================================================

/**
 * 文本语义相似度匹配。
 * 使用 string-similarity 的 Dice 系数，阈值 0.7。
 * 用于步骤描述、参数说明、注意事项等自然语言文本。
 */
export async function fuzzyMatchText(
  actual: string,
  expected: string,
  threshold = 0.7,
): Promise<boolean> {
  if (!actual || !expected) return false

  try {
    const { compareTwoStrings } = await import("string-similarity")
    const score = compareTwoStrings(
      actual.toLowerCase(),
      expected.toLowerCase(),
    )
    return score >= threshold
  } catch {
    // 依赖加载失败时回退到 token 交集
    const tokenize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\w一-鿿]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
    const tokensA = new Set(tokenize(actual))
    const tokensB = new Set(tokenize(expected))
    if (tokensA.size === 0 || tokensB.size === 0) return false

    const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)))
    const avgSize = (tokensA.size + tokensB.size) / 2
    return intersection.size / avgSize >= threshold
  }
}

// ============================================================================
// Fuzzy Find-and-Replace（用于灰度 patch 的精确替换）
// ============================================================================

/**
 * 在 content 中定位 needle 的原始位置，使用指定的归一化函数。
 * 返回 needle 在原始 content 中的 start/end 索引。
 */
function findNormalizedPosition(
  content: string,
  needle: string,
  normFn: (s: string) => string,
): { start: number; end: number } | null {
  const normContent = normFn(content)
  const normNeedle = normFn(needle)
  const idx = normContent.indexOf(normNeedle)
  if (idx < 0) return null

  // 将归一化后的位置映射回原始 content
  // 逐字符遍历原始 content，对其应用 normFn，跟踪累计长度
  let normPos = 0
  let start = -1
  let end = -1

  for (let i = 0; i < content.length; i++) {
    const charNorm = normFn(content[i])
    const nextNormPos = normPos + charNorm.length

    if (normPos <= idx && idx < nextNormPos) {
      start = i
      // 找到 start 后，继续寻找 end
      let endNormPos = normPos
      for (let j = i; j < content.length; j++) {
        const jNorm = normFn(content[j])
        endNormPos += jNorm.length
        if (endNormPos >= idx + normNeedle.length) {
          end = j + 1
          break
        }
      }
      break
    }
    normPos = nextNormPos
  }

  if (start >= 0 && end > start) {
    return { start, end }
  }
  return null
}

/**
 * 字符级 whitespace 归一化：每个空白符 → 单个空格。
 * 用于 findNormalizedPosition 的逐字符映射 + 全串比较。
 * 使用 .replace(/\s/g, " ") 确保单字符和全串调用均正确。
 */
function _normWsChar(ch: string): string {
  return ch.replace(/\s/g, " ")
}

/**
 * 字符级 punctuation 归一化：每个非单词非空白符 → 空格。
 * 用于 findNormalizedPosition 的逐字符映射 + 全串比较。
 */
function _normPunctChar(ch: string): string {
  return ch.replace(/[^\w\s]/g, " ")
}

/**
 * Fuzzy Find-and-Replace — 在文本中用多级模糊匹配定位并替换内容。
 *
 * 策略链（1-6 级可替换，7-8 级太模糊不做替换）：
 *   Level 1: exact                   直接匹配
 *   Level 2: case-insensitive        忽略大小写
 *   Level 3: whitespace-normalized   空白符归一化
 *   Level 4: punctuation-stripped    去除标点
 *   Level 5: number-normalized       数字归一化
 *   Level 6: variable-normalized     变量归一化
 *
 * @param content   完整文档内容
 * @param findWhat  要查找的文本
 * @param replaceWith 替换为的文本
 * @returns 替换结果及匹配级别
 */
export function fuzzyFindAndReplace(
  content: string,
  findWhat: string,
  replaceWith: string,
): {
  replaced: boolean
  result: string
  matchLevel: number
  matchLevelName: string
} {
  if (!content || !findWhat) {
    return {
      replaced: false,
      result: content,
      matchLevel: 0,
      matchLevelName: "empty",
    }
  }

  const a = content
  const b = findWhat

  // Level 1: exact match
  const exactIdx = a.indexOf(b)
  if (exactIdx >= 0) {
    const result =
      a.slice(0, exactIdx) + replaceWith + a.slice(exactIdx + b.length)
    return { replaced: true, result, matchLevel: 1, matchLevelName: "exact" }
  }

  // Level 2: case-insensitive
  const lowerA = a.toLowerCase()
  const lowerB = b.toLowerCase()
  const ciIdx = lowerA.indexOf(lowerB)
  if (ciIdx >= 0) {
    const result = a.slice(0, ciIdx) + replaceWith + a.slice(ciIdx + b.length)
    return {
      replaced: true,
      result,
      matchLevel: 2,
      matchLevelName: "case-insensitive",
    }
  }

  // Level 3: whitespace-normalized
  const normWs = (s: string) => s.replace(/\s+/g, " ").trim()
  const wsPos = findNormalizedPosition(a, b, _normWsChar)
  if (wsPos && normWs(a.slice(wsPos.start, wsPos.end)) === normWs(b)) {
    const result = a.slice(0, wsPos.start) + replaceWith + a.slice(wsPos.end)
    return {
      replaced: true,
      result,
      matchLevel: 3,
      matchLevelName: "whitespace-normalized",
    }
  }

  // Level 4: punctuation-stripped
  const stripPunct = (s: string) =>
    s
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  const punctPos = findNormalizedPosition(a, b, _normPunctChar)
  if (
    punctPos &&
    stripPunct(a.slice(punctPos.start, punctPos.end)) === stripPunct(b)
  ) {
    const result =
      a.slice(0, punctPos.start) + replaceWith + a.slice(punctPos.end)
    return {
      replaced: true,
      result,
      matchLevel: 4,
      matchLevelName: "punctuation-stripped",
    }
  }

  // Level 5/6: 使用基于 token 的滑动窗口搜索
  const normNums = (s: string) =>
    s
      .replace(/\b\d+(\.\d+)?\b/g, "0")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  const normVars = (s: string) =>
    s
      .replace(/\b(input|output|file|temp|result)\b\.?[a-z0-9]*/gi, "VAR")
      .replace(/\b\d+(\.\d+)?\b/g, "0")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()

  // 滑动窗口搜索：在原始 content 上滑动窗口，归一化后比较
  const needleNorm5 = normNums(b)
  const needleNorm6 = normVars(b)
  if (needleNorm5.length > 0 || needleNorm6.length > 0) {
    // 确定合理的窗口大小范围
    const minWindow = Math.max(1, Math.floor(b.length * 0.5))
    const maxWindow = Math.ceil(b.length * 2)

    for (
      let windowSize = minWindow;
      windowSize <= maxWindow && windowSize <= a.length;
      windowSize++
    ) {
      for (let i = 0; i <= a.length - windowSize; i++) {
        const candidate = a.slice(i, i + windowSize)

        // Level 5: number-normalized
        if (needleNorm5.length > 0 && normNums(candidate) === needleNorm5) {
          const result = a.slice(0, i) + replaceWith + a.slice(i + windowSize)
          return {
            replaced: true,
            result,
            matchLevel: 5,
            matchLevelName: "number-normalized",
          }
        }

        // Level 6: variable-normalized
        if (needleNorm6.length > 0 && normVars(candidate) === needleNorm6) {
          const result = a.slice(0, i) + replaceWith + a.slice(i + windowSize)
          return {
            replaced: true,
            result,
            matchLevel: 6,
            matchLevelName: "variable-normalized",
          }
        }
      }
    }
  }

  return {
    replaced: false,
    result: a,
    matchLevel: 0,
    matchLevelName: "no-match",
  }
}

/**
 * 在技能列表中查找与描述文本相似的技能。
 */
export async function findSimilarSkillsByText(
  description: string,
  descriptions: string[],
  threshold = 0.7,
): Promise<Array<{ index: number; score: number }>> {
  if (descriptions.length === 0) return []

  try {
    const { compareTwoStrings } = await import("string-similarity")
    const results: Array<{ index: number; score: number }> = []

    for (let i = 0; i < descriptions.length; i++) {
      const score = compareTwoStrings(description, descriptions[i])
      if (score >= threshold) {
        results.push({ index: i, score })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results
  } catch {
    return []
  }
}

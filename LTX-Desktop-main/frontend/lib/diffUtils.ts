export type DiffType = 'added' | 'removed' | 'unchanged'

export interface DiffLine {
  type: DiffType
  content: string
  lineNumber?: number
  oldLineNumber?: number
  newLineNumber?: number
}

export interface DiffResult {
  lines: DiffLine[]
  addedCount: number
  removedCount: number
  unchangedCount: number
}

export function computeLineDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  
  const lines: DiffLine[] = []
  let addedCount = 0
  let removedCount = 0
  let unchangedCount = 0
  
  const lcs = longestCommonSubsequence(oldLines, newLines)
  
  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0
  let oldLineNum = 1
  let newLineNum = 1
  
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length &&
        oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
      lines.push({
        type: 'unchanged',
        content: oldLines[oldIdx],
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
      })
      unchangedCount++
      oldIdx++
      newIdx++
      lcsIdx++
    } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
      lines.push({
        type: 'removed',
        content: oldLines[oldIdx],
        oldLineNumber: oldLineNum++,
      })
      removedCount++
      oldIdx++
    } else if (newIdx < newLines.length) {
      lines.push({
        type: 'added',
        content: newLines[newIdx],
        newLineNumber: newLineNum++,
      })
      addedCount++
      newIdx++
    }
  }
  
  return { lines, addedCount, removedCount, unchangedCount }
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  const result: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  
  return result
}

export function computeInlineDiff(oldText: string, newText: string): Array<{ type: DiffType; value: string }> {
  const oldWords = tokenize(oldText)
  const newWords = tokenize(newText)
  
  const lcs = longestCommonSubsequence(oldWords, newWords)
  const result: Array<{ type: DiffType; value: string }> = []
  
  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0
  
  while (oldIdx < oldWords.length || newIdx < newWords.length) {
    if (lcsIdx < lcs.length && oldIdx < oldWords.length && newIdx < newWords.length &&
        oldWords[oldIdx] === lcs[lcsIdx] && newWords[newIdx] === lcs[lcsIdx]) {
      result.push({ type: 'unchanged', value: oldWords[oldIdx] })
      oldIdx++
      newIdx++
      lcsIdx++
    } else if (oldIdx < oldWords.length && (lcsIdx >= lcs.length || oldWords[oldIdx] !== lcs[lcsIdx])) {
      result.push({ type: 'removed', value: oldWords[oldIdx] })
      oldIdx++
    } else if (newIdx < newWords.length) {
      result.push({ type: 'added', value: newWords[newIdx] })
      newIdx++
    }
  }
  
  return mergeResult(result)
}

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) || []
}

function mergeResult(result: Array<{ type: DiffType; value: string }>): Array<{ type: DiffType; value: string }> {
  if (result.length === 0) return result
  
  const merged: Array<{ type: DiffType; value: string }> = []
  let current = result[0]
  
  for (let i = 1; i < result.length; i++) {
    if (result[i].type === current.type) {
      current.value += result[i].value
    } else {
      merged.push(current)
      current = result[i]
    }
  }
  merged.push(current)
  
  return merged
}

export function getDiffStats(result: DiffResult): { added: number; removed: number; total: number } {
  return {
    added: result.addedCount,
    removed: result.removedCount,
    total: result.addedCount + result.removedCount,
  }
}
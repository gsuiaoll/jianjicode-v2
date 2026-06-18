/**
 * 路径解析器 — 容错 LLM 对文件路径的无意修改
 *
 * LLM 有时会修改中文路径（如 "卡点-节奏" → "卡点 - 节奏"、空格增删等），
 * 导致文件找不到。resolveInputPath 尝试纠正这些错误。
 */
import { existsSync } from "fs"
import { basename, dirname, join, normalize, resolve } from "path"

export interface PathResolveResult {
  resolvedPath: string
  wasCorrected: boolean
  originalPath: string
}

/**
 * 容错解析输入路径。
 * 1. 如果路径存在 → 直接返回
 * 2. 如果不存在 → 尝试找同目录下相似文件
 */
export async function resolveInputPath(raw: string): Promise<PathResolveResult> {
  const normalized = normalize(raw)

  if (existsSync(normalized)) {
    return { resolvedPath: normalized, wasCorrected: false, originalPath: raw }
  }

  // 尝试在当前目录找同名文件（忽略空格差异）
  const dir = dirname(normalized)
  const base = basename(normalized)

  if (existsSync(dir)) {
    // 精确匹配：去掉 base 中的多余空格
    const trimmed = base.replace(/\s+/g, "")
    const originalTrimmed = base.trim()

    // 读取目录，找匹配文件
    try {
      const { readdirSync } = await import("fs")
      const entries = readdirSync(dir)
      for (const entry of entries) {
        // 路径分隔符容错：斜杠/反斜杠
        if (entry === base || entry === originalTrimmed) {
          const resolvedPath = join(dir, entry)
          return { resolvedPath, wasCorrected: true, originalPath: raw }
        }
        // 空格容错
        if (entry.replace(/\s+/g, "") === trimmed) {
          const resolvedPath = join(dir, entry)
          return { resolvedPath, wasCorrected: true, originalPath: raw }
        }
      }
    } catch {
      // 读目录失败，返回原路径
    }
  }

  // 无法纠正，返回原路径（后续文件不存在检查会报错）
  return { resolvedPath: normalized, wasCorrected: false, originalPath: raw }
}

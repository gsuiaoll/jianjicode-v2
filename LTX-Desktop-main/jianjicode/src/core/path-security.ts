/**
 * jianjicode Path Security — 目录遍历防护
 *
 * 防止恶意文件路径通过 `../` 等方式逃逸到目标目录之外。
 *
 * @license MIT
 */

import * as path from "node:path"

/**
 * 检查路径是否包含 `..` 目录遍历组件。
 */
export function hasTraversalComponent(inputPath: string): boolean {
  const normalized = path.normalize(inputPath)
  const parts = normalized.split(path.sep)
  // 在 POSIX 和 Windows 上检查是否有父目录引用
  for (const part of parts) {
    if (part === "..") return true
  }
  // 额外检查：路径中的原始 .. 字符串（如 "foo/../../bar"）
  const rawParts = inputPath.split(/[/\\]/)
  for (const part of rawParts) {
    if (part === "..") return true
  }
  return false
}

/**
 * 验证目标路径是否在指定的基目录之内。
 * 对目标路径和基目录都做 resolve 后再比较，防止符号链接绕行。
 *
 * @param targetPath 目标文件路径
 * @param baseDir    基目录
 * @returns 是否安全（在基目录内）
 */
export function validateWithinDir(
  targetPath: string,
  baseDir: string,
): boolean {
  try {
    const resolvedTarget = path.resolve(targetPath)
    const resolvedBase = path.resolve(baseDir)

    // Windows: 统一盘符大小写
    const normalizedTarget = resolvedTarget.toLowerCase()
    const normalizedBase = resolvedBase.toLowerCase()

    // 目标路径必须以基目录开头（且紧随目录分隔符或完全相等）
    return (
      normalizedTarget === normalizedBase ||
      normalizedTarget.startsWith(normalizedBase + path.sep)
    )
  } catch {
    return false
  }
}

/**
 * 安全地连接路径并验证在基目录内。
 * 相当于 path.join(baseDir, ...parts) + 安全性校验。
 *
 * @returns 安全路径（如果验证通过），或 null（如果存在遍历攻击）
 */
export function safeJoin(baseDir: string, ...parts: string[]): string | null {
  // 检查每个部分是否包含遍历
  for (const part of parts) {
    if (hasTraversalComponent(part)) {
      return null
    }
  }

  const joined = path.join(baseDir, ...parts)
  if (!validateWithinDir(joined, baseDir)) {
    return null
  }

  return joined
}

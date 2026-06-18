import * as fs from "fs"
import { basename, extname, join } from "path"
import z from "zod"
import { Tool } from "./tool.js"

/**
 * 批处理文件扫描器 - 扫描文件夹并过滤视频文件
 *
 * 支持功能:
 * 1. 递归扫描子目录
 * 2. 通配符文件匹配
 * 3. 文件类型过滤 (扩展名)
 * 4. 文件大小过滤
 * 5. 修改时间过滤
 */
export const BatchScannerTool = Tool.define("batch_scanner", {
  description: "扫描文件夹中的视频文件，支持通配符和过滤条件",
  parameters: z.object({
    // 扫描配置
    directory: z.string().describe("要扫描的目录路径"),
    recursive: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否递归扫描子目录 (默认: 是)"),
    pattern: z
      .string()
      .optional()
      .default("*.mp4,*.mov,*.avi,*.mkv,*.wmv,*.flv,*.webm")
      .describe(
        "文件模式匹配 (逗号分隔，如 '*.mp4,*.mov'，默认: 常见视频格式)",
      ),

    // 过滤条件
    min_size: z
      .number()
      .optional()
      .describe("最小文件大小 (字节，空表示无限制)"),
    max_size: z
      .number()
      .optional()
      .describe("最大文件大小 (字节，空表示无限制)"),
    modified_after: z
      .string()
      .optional()
      .describe("修改时间之后 (ISO 8601 格式，如 '2024-01-01T00:00:00')"),
    modified_before: z
      .string()
      .optional()
      .describe("修改时间之前 (ISO 8601 格式)"),

    // 输出控制
    limit: z
      .number()
      .min(1)
      .max(10000)
      .optional()
      .describe("最大文件数量限制 (1-10000，空表示无限制)"),
    sort_by: z
      .enum(["name", "size", "modified", "created"])
      .optional()
      .default("name")
      .describe(
        "排序方式: name(名称), size(大小), modified(修改时间), created(创建时间)",
      ),
    sort_order: z
      .enum(["asc", "desc"])
      .optional()
      .default("asc")
      .describe("排序顺序: asc(升序), desc(降序)"),

    // 高级选项
    exclude_pattern: z
      .string()
      .optional()
      .describe("排除文件模式 (逗号分隔，如 '*tmp*,*backup*')"),
    follow_symlinks: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否跟随符号链接 (默认: 否)"),
  }),

  execute: async (args: any, ctx: Tool.Context) => {
    try {
      const tool = BatchScannerTool as any
      // 1. 验证目录存在
      if (!fs.existsSync(args.directory)) {
        return {
          title: "文件夹扫描失败",
          metadata: { operation: "batch_scanner", error: true },
          output: `❌ 目录不存在: ${args.directory}`,
        }
      }

      // 2. 解析文件模式
      const patterns = args.pattern.split(",").map((p: string) => p.trim())
      const excludePatterns = args.exclude_pattern
        ? args.exclude_pattern.split(",").map((p: string) => p.trim())
        : []

      // 3. 扫描文件
      console.log(`[BatchScannerTool] 扫描目录: ${args.directory}`)
      console.log(`[BatchScannerTool] 文件模式: ${patterns.join(", ")}`)

      const files = (tool as any).scanDirectory(
        args.directory,
        patterns,
        excludePatterns,
        args.recursive,
        args.follow_symlinks,
        ctx.abort,
      )

      // 4. 应用过滤条件
      const filteredFiles = (tool as any).filterFiles(files, args)

      // 5. 排序
      const sortedFiles = (tool as any).sortFiles(
        filteredFiles,
        args.sort_by,
        args.sort_order,
      )

      // 6. 应用数量限制
      const limitedFiles = args.limit
        ? sortedFiles.slice(0, args.limit)
        : sortedFiles

      // 7. 统计信息
      const stats = {
        total_scanned: files.length,
        total_filtered: filteredFiles.length,
        total_output: limitedFiles.length,
        total_size: limitedFiles.reduce(
          (sum: number, file: any) => sum + file.size,
          0,
        ),
        extensions: (tool as any).countExtensions(limitedFiles),
        average_size:
          limitedFiles.length > 0
            ? Math.round(
                limitedFiles.reduce(
                  (sum: number, file: any) => sum + file.size,
                  0,
                ) / limitedFiles.length,
              )
            : 0,
      }

      // 8. 返回结果
      return {
        title: "文件夹扫描完成",
        metadata: {
          operation: "batch_scanner",
          success: true,
          files: limitedFiles,
          stats,
          parameters: args,
        },
        output: (tool as any).formatOutput(limitedFiles, stats, args),
      } as any
    } catch (error: any) {
      return {
        title: "文件夹扫描错误",
        metadata: { operation: "batch_scanner", error: true, success: false },
        output: `❌ 扫描过程中发生错误: ${error.message}`,
      } as any
    }
  },
} as any)

// 扩展工具类的方法
;(BatchScannerTool as any).scanDirectory = (
  directory: string,
  patterns: string[],
  excludePatterns: string[],
  recursive: boolean,
  followSymlinks: boolean,
  abortSignal?: AbortSignal,
): Array<{
  path: string
  name: string
  extension: string
  size: number
  modified: Date
  created: Date
  relativePath: string
}> => {
  const results: Array<{
    path: string
    name: string
    extension: string
    size: number
    modified: Date
    created: Date
    relativePath: string
  }> = []

  const scan = (
    dir: string,
    depth: number = 0,
    relativePrefix: string = "",
  ) => {
    if (abortSignal?.aborted) return

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (abortSignal?.aborted) break

        const fullPath = join(dir, entry.name)
        const relativePath = relativePrefix
          ? join(relativePrefix, entry.name)
          : entry.name

        if (entry.isSymbolicLink()) {
          if (followSymlinks) {
            try {
              const stats: any = fs.statSync(fullPath, {
                throwIfNoEntry: false,
              })
              if (stats?.isDirectory()) {
                if (recursive) {
                  scan(fullPath, depth + 1, relativePath)
                }
              } else if (stats?.isFile()) {
                ;(BatchScannerTool as any).processFile(
                  fullPath,
                  relativePath,
                  stats,
                  patterns,
                  excludePatterns,
                  results,
                )
              }
            } catch (err) {
              // 忽略无法访问的符号链接
            }
          }
        } else if (entry.isDirectory()) {
          if (recursive) {
            scan(fullPath, depth + 1, relativePath)
          }
        } else if (entry.isFile()) {
          try {
            const fileStats = fs.statSync(fullPath)
            ;(BatchScannerTool as any).processFile(
              fullPath,
              relativePath,
              fileStats,
              patterns,
              excludePatterns,
              results,
            )
          } catch (err) {
            // 忽略无法访问的文件
          }
        }
      }
    } catch (error) {
      console.warn(`[BatchScannerTool] 无法访问目录 ${dir}: ${error}`)
    }
  }

  scan(directory)
  return results
}

;(BatchScannerTool as any).processFile = (
  fullPath: string,
  relativePath: string,
  stats: any,
  patterns: string[],
  excludePatterns: string[],
  results: any[],
): void => {
  const name = basename(fullPath)
  const extension = extname(name).toLowerCase()

  // 检查排除模式
  if (
    excludePatterns.some((pattern) =>
      (BatchScannerTool as any).matchesPattern(name, pattern),
    )
  ) {
    return
  }

  // 检查包含模式
  const matchesPattern = patterns.some((pattern) =>
    (BatchScannerTool as any).matchesPattern(name, pattern),
  )
  if (!matchesPattern) {
    return
  }

  results.push({
    path: fullPath,
    name,
    extension,
    size: stats.size,
    modified: stats.mtime,
    created: stats.birthtime || stats.ctime,
    relativePath,
  })
}

;(BatchScannerTool as any).matchesPattern = (
  filename: string,
  pattern: string,
): boolean => {
  if (pattern === "*") return true

  // 简单通配符匹配
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  const regex = new RegExp(`^${regexPattern}$`, "i")
  return regex.test(filename)
}

;(BatchScannerTool as any).filterFiles = (files: any[], args: any): any[] =>
  files.filter((file) => {
    // 文件大小过滤
    if (args.min_size !== undefined && file.size < args.min_size) return false
    if (args.max_size !== undefined && file.size > args.max_size) return false

    // 修改时间过滤
    if (args.modified_after) {
      const modifiedAfter = new Date(args.modified_after)
      if (file.modified < modifiedAfter) return false
    }

    if (args.modified_before) {
      const modifiedBefore = new Date(args.modified_before)
      if (file.modified > modifiedBefore) return false
    }

    return true
  })

;(BatchScannerTool as any).sortFiles = (
  files: any[],
  sortBy: string,
  sortOrder: string,
): any[] => {
  const sorted = [...files]

  sorted.sort((a, b) => {
    let compareResult = 0

    switch (sortBy) {
      case "name":
        compareResult = a.name.localeCompare(b.name)
        break
      case "size":
        compareResult = a.size - b.size
        break
      case "modified":
        compareResult = a.modified.getTime() - b.modified.getTime()
        break
      case "created":
        compareResult = a.created.getTime() - b.created.getTime()
        break
      default:
        compareResult = a.name.localeCompare(b.name)
    }

    return sortOrder === "desc" ? -compareResult : compareResult
  })

  return sorted
}

;(BatchScannerTool as any).countExtensions = (
  files: any[],
): Record<string, number> => {
  const counts: Record<string, number> = {}

  for (const file of files) {
    const ext = file.extension.toLowerCase()
    counts[ext] = (counts[ext] || 0) + 1
  }

  return counts
}

;(BatchScannerTool as any).formatOutput = (
  files: any[],
  stats: any,
  args: any,
): string => {
  const lines: string[] = []

  lines.push(`📁 扫描目录: ${args.directory}`)
  lines.push(`📊 扫描统计:`)
  lines.push(`  ├── 扫描文件总数: ${stats.total_scanned}`)
  lines.push(`  ├── 过滤后文件数: ${stats.total_filtered}`)
  lines.push(`  ├── 输出文件数量: ${stats.total_output}`)
  lines.push(
    `  ├── 总文件大小: ${(BatchScannerTool as any).formatFileSize(stats.total_size)}`,
  )
  lines.push(
    `  └── 平均文件大小: ${(BatchScannerTool as any).formatFileSize(stats.average_size)}`,
  )

  if (Object.keys(stats.extensions).length > 0) {
    lines.push(`\n📄 文件类型分布:`)
    for (const [ext, count] of Object.entries(stats.extensions)) {
      lines.push(`  ${ext}: ${count} 个文件`)
    }
  }

  if (files.length > 0) {
    lines.push(`\n📋 文件列表 (前 ${Math.min(files.length, 10)} 个):`)
    for (let i = 0; i < Math.min(files.length, 10); i++) {
      const file = files[i]
      lines.push(
        `  ${i + 1}. ${file.relativePath} (${(BatchScannerTool as any).formatFileSize(file.size)}, ${file.modified.toLocaleDateString()})`,
      )
    }

    if (files.length > 10) {
      lines.push(`  ... 还有 ${files.length - 10} 个文件`)
    }
  } else {
    lines.push(`\n⚠️ 未找到匹配的文件`)
  }

  return lines.join("\n")
}

;(BatchScannerTool as any).formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))

  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`
}

/**
 * 工具别名
 */
export const ScannerTool = BatchScannerTool

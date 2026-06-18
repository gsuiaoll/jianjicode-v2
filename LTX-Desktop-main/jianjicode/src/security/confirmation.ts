import { existsSync, statSync } from "fs"
import { basename, isAbsolute, join, relative, resolve } from "path"
import z from "zod"
import { Tool } from "../tool/tool.js"

/**
 * 安全确认工具 - 验证危险操作并请求用户确认
 *
 * 支持功能:
 * 1. 文件覆盖确认
 * 2. 原文件保护
 * 3. 输出目录限制
 * 4. 危险操作警告
 */
export const ConfirmationTool = Tool.define("confirmation", {
  description: "验证危险操作并请求用户确认，保护数据安全",
  parameters: z.object({
    // 操作配置
    operation: z.string().describe("要执行的操作类型"),
    input_files: z.array(z.string()).optional().describe("输入文件列表"),
    output_file: z.string().optional().describe("输出文件路径"),
    output_dir: z.string().optional().describe("输出目录路径"),

    // 安全选项
    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否允许覆盖现有文件 (默认: 否)"),
    protect_originals: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保护原文件 (默认: 是)"),
    restrict_output_dir: z
      .string()
      .optional()
      .describe("限制输出目录 (空表示不限制)"),
    require_confirmation: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否需要用户确认 (默认: 是)"),

    // 用户确认
    confirmed: z
      .boolean()
      .optional()
      .default(false)
      .describe("用户已确认操作 (CLI模式下可跳过交互)"),
    skip_warnings: z
      .boolean()
      .optional()
      .default(false)
      .describe("跳过所有警告 (危险，仅限自动化脚本)"),

    // 操作详情
    operation_details: z
      .record(z.any())
      .optional()
      .describe("操作详细信息 (用于生成确认消息)"),
  }),

  execute: async (args: any, ctx: Tool.Context) => {
    try {
      const checks = performSafetyChecks(args)
      const warnings = checks.warnings
      const errors = checks.errors
      const requiresConfirmation = checks.requiresConfirmation

      // 如果有错误，立即返回
      if (errors.length > 0) {
        return {
          title: "安全检查失败",
          metadata: {
            operation: "confirmation",
            error: true,
            success: false,
            safetyChecks: checks,
          },
          output: formatErrors(errors, args),
        } as any
      }

      // 如果有警告且需要确认
      if (warnings.length > 0 && requiresConfirmation && !args.skip_warnings) {
        if (!args.confirmed) {
          // 在CLI模式下，我们无法进行交互式确认
          // 返回需要确认的消息
          return {
            title: "需要用户确认",
            metadata: {
              operation: "confirmation",
              requiresConfirmation: true,
              warnings,
              safetyChecks: checks,
            },
            output: formatWarnings(warnings, args, true),
          } as any
        }
      }

      // 安全检查通过
      return {
        title: "安全检查通过",
        metadata: {
          operation: "confirmation",
          error: false,
          success: true,
          safetyChecks: checks,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        output: formatSuccess(checks, args),
      } as any
    } catch (error: any) {
      return {
        title: "安全检查错误",
        metadata: { operation: "confirmation", error: true },
        output: `❌ 安全检查过程中发生错误: ${error.message}`,
      } as any
    }
  },
} as any)

// 安全检查辅助函数
function performSafetyChecks(args: any): any {
  const warnings: string[] = []
  const errors: string[] = []
  let requiresConfirmation = args?.require_confirmation ?? true

  // 1. 输出文件覆盖检查
  if (args.output_file && existsSync(args.output_file)) {
    if (!args.allow_overwrite) {
      errors.push(`输出文件已存在且不允许覆盖: ${args.output_file}`)
    } else {
      warnings.push(`⚠️  将覆盖现有文件: ${args.output_file}`)
      requiresConfirmation = true
    }
  }

  // 2. 原文件保护检查
  if (args.protect_originals && args.input_files) {
    for (const inputFile of args.input_files) {
      if (args.output_file && isSameFile(inputFile, args.output_file)) {
        errors.push(`原文件保护模式禁止覆盖输入文件: ${inputFile}`)
      }

      // 检查输出目录是否可能覆盖原文件
      if (args.output_dir) {
        const outputInSameDir = join(args.output_dir, basename(inputFile))
        if (outputInSameDir === inputFile) {
          warnings.push(`⚠️  输出文件与原文件同名同目录: ${inputFile}`)
          requiresConfirmation = true
        }
      }
    }
  }

  // 3. 输出目录限制检查
  if (args.restrict_output_dir) {
    const restrictedDir = resolve(args.restrict_output_dir)

    if (args.output_file) {
      const outputDir = resolve(args.output_file, "..")
      if (!isSubdirectory(outputDir, restrictedDir)) {
        errors.push(
          `输出目录超出限制范围: ${outputDir} (限制: ${restrictedDir})`,
        )
      }
    }

    if (args.output_dir) {
      const outputDir = resolve(args.output_dir)
      if (!isSubdirectory(outputDir, restrictedDir)) {
        errors.push(
          `输出目录超出限制范围: ${outputDir} (限制: ${restrictedDir})`,
        )
      }
    }
  }

  // 4. 危险操作检查
  const dangerousOperations = [
    "delete",
    "remove",
    "overwrite",
    "format",
    "reset",
  ]
  const operation = args.operation?.toLowerCase() || ""

  if (dangerousOperations.some((op) => operation.includes(op))) {
    warnings.push(`⚠️  检测到危险操作: ${args.operation}`)
    requiresConfirmation = true
  }

  // 5. 大文件操作警告
  if (args.input_files) {
    let totalSize = 0
    for (const file of args.input_files) {
      if (existsSync(file)) {
        try {
          const stats = statSync(file)
          totalSize += stats.size
        } catch (e) {
          // 忽略无法访问的文件
        }
      }
    }

    const sizeMB = totalSize / (1024 * 1024)
    if (sizeMB > 100) {
      // 超过100MB
      warnings.push(`⚠️  操作涉及大文件: ${sizeMB.toFixed(2)} MB`)
      requiresConfirmation = true
    }
  }

  return {
    warnings,
    errors,
    requiresConfirmation,
    passed: errors.length === 0,
    warningCount: warnings.length,
    errorCount: errors.length,
  }
}

function isSameFile(path1: string, path2: string): boolean {
  try {
    const stat1 = statSync(resolve(path1))
    const stat2 = statSync(resolve(path2))

    return stat1.ino === stat2.ino && stat1.dev === stat2.dev
  } catch (e) {
    // 如果无法获取文件信息，使用路径比较
    return resolve(path1) === resolve(path2)
  }
}

function isSubdirectory(child: string, parent: string): boolean {
  const childPath = resolve(child)
  const parentPath = resolve(parent)

  const rel = relative(parentPath, childPath)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

function formatErrors(errors: string[], args: any): string {
  const lines: string[] = []

  lines.push(`❌ 安全检查发现 ${errors.length} 个错误:`)
  lines.push("")

  for (let i = 0; i < errors.length; i++) {
    lines.push(`${i + 1}. ${errors[i]}`)
  }

  lines.push("")
  lines.push("🔒 安全建议:")
  if (!args.allow_overwrite && errors.some((e) => e.includes("覆盖"))) {
    lines.push("  - 使用 --allow-overwrite 参数允许覆盖文件")
  }
  if (args.protect_originals && errors.some((e) => e.includes("原文件保护"))) {
    lines.push("  - 使用 --no-protect-originals 参数禁用原文件保护")
  }
  if (
    args.restrict_output_dir &&
    errors.some((e) => e.includes("超出限制范围"))
  ) {
    lines.push("  - 调整输出目录或修改限制目录")
  }

  return lines.join("\n")
}

function formatWarnings(
  warnings: string[],
  args: any,
  requireConfirmation: boolean = false,
): string {
  const lines: string[] = []

  if (requireConfirmation) {
    lines.push("⚠️  需要确认以下警告:")
  } else {
    lines.push(`⚠️  安全检查发现 ${warnings.length} 个警告:`)
  }

  lines.push("")

  for (let i = 0; i < warnings.length; i++) {
    lines.push(`${i + 1}. ${warnings[i]}`)
  }

  lines.push("")

  if (requireConfirmation) {
    lines.push("📋 确认选项:")
    lines.push("  - 使用 --confirmed 参数确认操作")
    lines.push("  - 使用 --skip-warnings 参数跳过所有警告")
    lines.push("  - 使用 --no-require-confirmation 参数禁用确认要求")

    if (!args.allow_overwrite && warnings.some((w) => w.includes("覆盖"))) {
      lines.push("  - 使用 --allow-overwrite 参数允许覆盖文件")
    }
  } else {
    lines.push("✅ 警告已记录，操作将继续执行")
  }

  return lines.join("\n")
}

function formatSuccess(checks: any, args: any): string {
  const lines: string[] = []

  lines.push("✅ 安全检查通过")

  if (checks.warningCount > 0) {
    lines.push(`⚠️  已记录 ${checks.warningCount} 个警告`)
  }

  lines.push("")
  lines.push("📋 安全检查摘要:")
  lines.push(`  ├── 操作类型: ${args.operation || "未指定"}`)
  lines.push(`  ├── 输入文件: ${args.input_files?.length || 0} 个`)
  lines.push(`  ├── 输出文件: ${args.output_file || "未指定"}`)
  lines.push(`  ├── 允许覆盖: ${args.allow_overwrite ? "是" : "否"}`)
  lines.push(`  ├── 原文件保护: ${args.protect_originals ? "是" : "否"}`)
  lines.push(`  └── 输出限制: ${args.restrict_output_dir || "无"}`)

  if (checks.warningCount > 0) {
    lines.push("")
    lines.push("📝 已处理的警告:")
    for (let i = 0; i < Math.min(checks.warnings.length, 3); i++) {
      lines.push(`  ${i + 1}. ${checks.warnings[i]}`)
    }
    if (checks.warnings.length > 3) {
      lines.push(`  ... 还有 ${checks.warnings.length - 3} 个警告`)
    }
  }

  return lines.join("\n")
}

/**
 * 工具别名
 */
export const SafetyTool = ConfirmationTool

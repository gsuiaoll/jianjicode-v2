/**
 * jianjicode 工具权限管理 CLI
 *
 * 提供交互式命令行界面管理工具权限：
 *   - 查看当前规则集（内置默认 + always-allow 持久化规则）
 *   - 添加/移除工具允许/拒绝规则
 *   - 查看和回复待决权限请求
 *
 * 使用方式：
 *   import { runPermissionCLI } from "./permission/cli.js"
 *   await runPermissionCLI(["list"])
 *   await runPermissionCLI(["allow", "music_search"])
 *   await runPermissionCLI()  // 交互模式
 */

import { createInterface } from "node:readline"
import { UI } from "../cli/ui.js"
import { toolRegistry } from "../registry/tool_registry.js"
import { getGlobalPermissionService } from "./service.js"
import type {
  PermissionAction,
  PermissionRequest,
  PermissionRule,
} from "./types.js"

// ============================================================================
// 辅助函数
// ============================================================================

function actionLabel(action: PermissionAction): string {
  switch (action) {
    case "allow":
      return `${UI.Style.TEXT_SUCCESS}ALLOW${UI.Style.TEXT_NORMAL}`
    case "deny":
      return `${UI.Style.TEXT_DANGER}DENY${UI.Style.TEXT_NORMAL}`
    case "ask":
      return `${UI.Style.TEXT_WARNING}ASK${UI.Style.TEXT_NORMAL}`
  }
}

function actionEmoji(action: PermissionAction): string {
  switch (action) {
    case "allow":
      return "[ALLOW]"
    case "deny":
      return "[DENY] "
    case "ask":
      return "[ASK]  "
  }
}

// ============================================================================
// 命令实现
// ============================================================================

/** 列出所有权限规则 */
function cmdList(): void {
  const svc = getGlobalPermissionService()

  const baseRules = svc.getRules()
  const alwaysAllowed = svc.getAlwaysAllowed()

  UI.println(
    UI.Style.TEXT_INFO + "\n📋 Permission Rules" + UI.Style.TEXT_NORMAL,
  )
  UI.println("─".repeat(70))

  if (baseRules.length === 0 && alwaysAllowed.length === 0) {
    UI.println("  (no rules configured)")
    return
  }

  // 内置规则
  if (baseRules.length > 0) {
    UI.println(
      UI.Style.TEXT_DIM +
        "\n  Base Rules (from config):" +
        UI.Style.TEXT_NORMAL,
    )
    for (const rule of baseRules) {
      const desc = rule.description ? ` — ${rule.description}` : ""
      UI.println(
        `    ${actionEmoji(rule.action)} target="${rule.target}" pattern="${rule.pattern}" priority=${rule.priority ?? 0}${desc}`,
      )
    }
  }

  // Always-allow 持久化规则
  if (alwaysAllowed.length > 0) {
    UI.println(
      UI.Style.TEXT_DIM +
        "\n  Always-Allowed (persisted):" +
        UI.Style.TEXT_NORMAL,
    )
    for (const rule of alwaysAllowed) {
      const desc = rule.description ? ` — ${rule.description}` : ""
      UI.println(
        `    ${actionEmoji(rule.action)} target="${rule.target}" pattern="${rule.pattern}"${desc}`,
      )
    }
  }

  UI.println("")
}

/** 列出所有已注册的工具 */
function cmdTools(): void {
  const allTools = toolRegistry.getAllTools()
  const categories = toolRegistry.getAllCategories()

  UI.println(
    UI.Style.TEXT_INFO +
      `\n🔧 Registered Tools (${allTools.length})` +
      UI.Style.TEXT_NORMAL,
  )
  UI.println("─".repeat(70))

  for (const cat of categories) {
    const tools = toolRegistry.getToolsByCategory(cat)
    UI.println(
      UI.Style.TEXT_DIM +
        `\n  [${cat}] (${tools.length} tools)` +
        UI.Style.TEXT_NORMAL,
    )
    for (const t of tools) {
      UI.println(`    ${t.id} — ${t.description || "(no description)"}`)
    }
  }
  UI.println("")
}

/** 列出待决的权限请求 */
function cmdPending(): void {
  const svc = getGlobalPermissionService()
  const pending = svc.listPending()

  UI.println(
    UI.Style.TEXT_INFO +
      "\n⏳ Pending Permission Requests" +
      UI.Style.TEXT_NORMAL,
  )
  UI.println("─".repeat(70))

  if (pending.length === 0) {
    UI.println("  (no pending requests)")
    return
  }

  for (const req of pending) {
    const age = Date.now() - req.createdAt
    const ageStr =
      age < 60000
        ? `${Math.round(age / 1000)}s ago`
        : `${Math.round(age / 60000)}m ago`
    UI.println(
      `  Request ID: ${UI.Style.TEXT_HIGHLIGHT}${req.id}${UI.Style.TEXT_NORMAL}`,
    )
    UI.println(`    Session:    ${req.sessionID.slice(0, 16)}...`)
    UI.println(`    Permission: ${req.permission}`)
    UI.println(`    Patterns:   ${req.patterns.join(", ")}`)
    UI.println(`    Age:        ${ageStr}`)
    if (req.toolID) {
      UI.println(`    Tool:       ${req.toolID}`)
    }
    UI.println("")
  }
}

/** 添加一条允许规则 */
function cmdAllow(toolPattern: string): void {
  const svc = getGlobalPermissionService()
  svc.reply({
    requestID: "",
    action: "allow_always",
  })
  UI.warn("Use the interactive mode to add persistent allow rules.")
  UI.println(
    `  To allow "${toolPattern}", add it via the config or always-allow store.`,
  )
}

/** 添加一条拒绝规则 */
function cmdDeny(toolPattern: string): void {
  UI.println(
    `Deny rule for "${toolPattern}" — use config file to persist deny rules.`,
  )
}

/** 回复待决请求 */
function cmdReply(requestID: string, action: string): void {
  const svc = getGlobalPermissionService()
  const validActions = ["allow_once", "allow_always", "deny", "reject"]

  if (!validActions.includes(action)) {
    UI.error(
      `Invalid action: ${action}. Use one of: ${validActions.join(", ")}`,
    )
    return
  }

  try {
    svc.reply({
      requestID,
      action: action as "allow_once" | "allow_always" | "deny" | "reject",
    })
    UI.success(`Request ${requestID} → ${action}`)
  } catch (err: any) {
    UI.error(err.message || String(err))
  }
}

// ============================================================================
// 交互模式
// ============================================================================

function printHelp(): void {
  UI.println(
    UI.Style.TEXT_INFO +
      "\n📖 Permission Manager — Commands" +
      UI.Style.TEXT_NORMAL,
  )
  UI.println("─".repeat(50))
  UI.println("  list       — Show all permission rules")
  UI.println("  tools      — Show all registered tools")
  UI.println("  pending    — Show pending permission requests")
  UI.println(
    "  allow <id> — Add allow rule for tool (adds to always-allow store)",
  )
  UI.println("  deny  <id> — Add deny rule for tool (must use config)")
  UI.println("  reply <req> <action> — Reply to a pending request")
  UI.println("          actions: allow_once, allow_always, deny, reject")
  UI.println(
    "  rules <target> <pattern> — Test what action a rule would produce",
  )
  UI.println("  help       — Show this help")
  UI.println("  quit       — Exit")
  UI.println("─".repeat(50))
  UI.println("")
}

function cmdTest(target: string, pattern: string): void {
  const svc = getGlobalPermissionService()
  svc
    .evaluate(target, pattern)
    .then((action) => {
      UI.println(
        `  evaluate("${target}", "${pattern}") → ${actionLabel(action)}`,
      )
    })
    .catch((err) => {
      UI.error(`evaluate failed: ${err}`)
    })
}

/**
 * 交互式权限管理 REPL。
 */
export async function runInteractive(): Promise<void> {
  UI.println(UI.logo())
  UI.println(
    UI.Style.TEXT_INFO + "Tool Permission Manager" + UI.Style.TEXT_NORMAL,
  )
  UI.println("Type 'help' for commands, 'quit' to exit.\n")

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: UI.Style.TEXT_HIGHLIGHT + "perm> " + UI.Style.TEXT_NORMAL,
  })

  rl.prompt()

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) {
      rl.prompt()
      continue
    }

    const parts = trimmed.split(/\s+/)
    const cmd = parts[0]?.toLowerCase()

    try {
      switch (cmd) {
        case "list":
        case "ls":
          cmdList()
          break
        case "tools":
          cmdTools()
          break
        case "pending":
          cmdPending()
          break
        case "allow":
          if (parts[1]) {
            cmdAllow(parts[1])
          } else {
            UI.warn("Usage: allow <tool_id>")
          }
          break
        case "deny":
          if (parts[1]) {
            cmdDeny(parts[1])
          } else {
            UI.warn("Usage: deny <tool_id>")
          }
          break
        case "reply":
          if (parts[1] && parts[2]) {
            cmdReply(parts[1], parts[2])
          } else {
            UI.warn("Usage: reply <request_id> <action>")
          }
          break
        case "rules":
          if (parts[1] && parts[2]) {
            await cmdTest(parts[1], parts[2])
          } else {
            UI.warn("Usage: rules <target> <pattern>")
          }
          break
        case "help":
        case "?":
          printHelp()
          break
        case "quit":
        case "exit":
        case "q":
          rl.close()
          return
        default:
          UI.warn(
            `Unknown command: ${cmd}. Type 'help' for available commands.`,
          )
      }
    } catch (err: any) {
      UI.error(err.message || String(err))
    }

    rl.prompt()
  }
}

/**
 * 非交互式命令执行。
 * 用于 CLI 参数如 `jianjicode perm list`
 */
export async function runPermissionCLI(args: string[]): Promise<void> {
  if (args.length === 0) {
    await runInteractive()
    return
  }

  const cmd = args[0]?.toLowerCase()

  // 确保权限服务已初始化
  try {
    getGlobalPermissionService()
  } catch {
    UI.error("Permission service not initialized. Start jianjicode first.")
    return
  }

  switch (cmd) {
    case "list":
    case "ls":
      cmdList()
      break
    case "tools":
      cmdTools()
      break
    case "pending":
      cmdPending()
      break
    case "allow":
      if (args[1]) cmdAllow(args[1])
      else UI.warn("Usage: jianjicode perm allow <tool_id>")
      break
    case "deny":
      if (args[1]) cmdDeny(args[1])
      else UI.warn("Usage: jianjicode perm deny <tool_id>")
      break
    case "reply":
      if (args[1] && args[2]) cmdReply(args[1], args[2])
      else UI.warn("Usage: jianjicode perm reply <request_id> <action>")
      break
    case "help":
    case "--help":
    case "-h":
      printHelp()
      break
    default:
      UI.warn(`Unknown command: ${cmd}`)
      UI.println("Available: list, tools, pending, allow, deny, reply, help")
  }
}

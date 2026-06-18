/**
 * jianjicode chat 命令 — CLI 薄壳
 *
 * 只负责 CLI 胶水：yargs 定义、UI 展示、process.exit 控制。
 * 全部业务逻辑委托给 src/core/chat-core.ts。
 */
import type { Argv } from "yargs"
import type { ChatCallbacks } from "../../core/chat-core.js"
import {
  loadConfig,
  processChatRequest,
  resolveModelConfig,
} from "../../core/chat-core.js"
import { UI } from "../ui.js"
import { cmd } from "./cmd.js"

export const ChatCommand = cmd({
  command: "chat [message..]",
  describe: "Chat with jianjicode AI for natural language video editing",
  builder: (yargs: Argv) => {
    return yargs
      .positional("message", {
        describe: "Natural language video editing request",
        type: "string",
        array: true,
        default: [],
      })
      .option("provider", {
        type: "string",
        describe:
          "AI provider to use (openai, anthropic, google, openrouter, vercel, azure, etc.)",
        default: "openai",
      })
      .option("model", {
        type: "string",
        describe:
          "AI model to use (gpt-4o, claude-3.5-sonnet, gemini-2.0-flash, etc.)",
        default: "gpt-4o",
      })
      .option("api-key", {
        type: "string",
        describe:
          "API key for the AI model (or set provider-specific environment variable)",
      })
      .option("api-base-url", {
        type: "string",
        describe: "Custom API base URL (for OpenAI-compatible endpoints)",
      })
      .option("verbose", {
        type: "boolean",
        describe: "Show detailed AI reasoning",
        default: false,
      })
      .option("json", {
        type: "boolean",
        describe: "Output machine-readable JSON instead of formatted text",
        default: false,
      })
  },
  handler: async (args: any) => {
    const message = args.message.join(" ")
    if (!message) {
      if (args.json) {
        console.log(
          JSON.stringify({ success: false, error: "Missing message" }),
        )
      } else {
        UI.error("You must provide a message or video editing request")
      }
      process.exit(1)
    }

    const useJson = args.json === true

    // 构建回调 — JSON 模式下静默
    const callbacks: ChatCallbacks = {
      onLog: (msg: string) => {
        if (!useJson && args.verbose) {
          UI.println(`[debug] ${msg}`)
        }
      },
      onProgress: (step: string, detail?: string) => {
        if (!useJson && detail) UI.println(`> ${detail}`)
      },
    }

    // 显示模型信息（仅文本模式）
    const config = loadConfig()
    const modelCfg = resolveModelConfig(args, config)
    if (!useJson && modelCfg.apiKey) {
      UI.println(`🔑 Using ${modelCfg.providerID} / ${modelCfg.modelID}`)
    }

    const result = await processChatRequest(message, args, callbacks)

    // JSON 输出模式
    if (useJson) {
      console.log(JSON.stringify(result))
      process.exit(result.success ? 0 : 1)
    }

    // 文本输出模式
    if (!result.success) {
      if (result.error?.startsWith("CLARIFICATION:")) {
        UI.println("❓ Clarification needed:")
        UI.println(result.error.replace("CLARIFICATION:", "").trim())
        process.exit(0)
      }
      UI.error(result.error || "Unknown error")
      if (args.verbose && result.data) {
        UI.println("Full AI response:")
        UI.println(String(result.data.output || result.data.analysis || ""))
      }
      process.exit(1)
    }

    // 成功输出
    if (result.data) {
      if (result.data.title) UI.println(`\n${result.data.title}`)
      if (result.data.output) UI.println(result.data.output)

      if (args.verbose && result.data.analysis) {
        UI.empty()
        UI.println("AI Analysis:")
        UI.println(result.data.analysis)
      }
    }

    UI.empty()
    UI.println("✅ Done!")
  },
})

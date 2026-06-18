/**
 * SimpleProvider v2 — 精简版 AI 模型路由
 *
 * v1 导入了 9 个 @ai-sdk/* 包。v2 只用 @ai-sdk/openai（OpenAI 兼容协议），
 * DashScope / DeepSeek 等通过 baseURL 配置接入。
 */
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"

const PROVIDER_CONFIGS: Record<string, { baseURL: string; defaultModel: string }> = {
  dashscope: {
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: process.env.DASHSCOPE_MODEL || "qwen-plus",
  },
  deepseek: {
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    defaultModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
}

export namespace SimpleProvider {
  export async function getLanguage(
    model: { providerID: string; id?: string },
    options: { apiKey?: string },
  ): Promise<LanguageModel> {
    const cfg = PROVIDER_CONFIGS[model.providerID] || PROVIDER_CONFIGS.dashscope
    const apiKey = options.apiKey || process.env.DASHSCOPE_API_KEY || ""

    const provider = createOpenAI({
      apiKey,
      baseURL: cfg.baseURL,
    })

    return provider.languageModel(model.id || cfg.defaultModel) as unknown as LanguageModel
  }
}

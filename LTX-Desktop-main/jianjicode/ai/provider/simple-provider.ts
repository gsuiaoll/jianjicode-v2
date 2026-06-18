/// <reference types="node" />

import { createAnthropic } from "@ai-sdk/anthropic"
import { createAzure } from "@ai-sdk/azure"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { createVercel } from "@ai-sdk/vercel"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"

export interface Model {
  providerID: string
  id: string
  name?: string
  description?: string
}

export class SimpleProvider {
  /**
   * 提供者实例缓存 map — key = "providerID:modelID"
   * 常驻 HTTP 服务场景下，所有请求共享缓存，避免每请求重建 provider。
   */
  private static providerCache = new Map<string, LanguageModel>()

  static async getLanguage(
    model: Model,
    options?: { apiKey?: string; baseURL?: string },
  ) {
    const providerID = model.providerID.toLowerCase()
    const modelID = model.id

    // 缓存命中直接返回
    const cacheKey = `${providerID}:${modelID}`
    const cached = SimpleProvider.providerCache.get(cacheKey)
    if (cached) return cached

    // Get API key from options or environment variable
    const apiKey = options?.apiKey || SimpleProvider.getApiKey(providerID)
    if (!apiKey) {
      throw new Error(
        `No API key found for provider ${providerID}. Set environment variable ${SimpleProvider.getEnvVarName(providerID)} or pass --api-key`,
      )
    }

    // Get base URL from options or environment variable
    const baseURL =
      options?.baseURL ||
      process.env.OPENAI_BASE_URL ||
      (providerID === "azure" ? process.env.AZURE_OPENAI_ENDPOINT : undefined)

    let languageModel: LanguageModel

    switch (providerID) {
      case "openai":
        // DeepSeek via direct fetch (avoid Bun crash with @ai-sdk/openai-compatible)
        if (baseURL && baseURL.includes("deepseek.com")) {
          const { createOpenAICompatibleModel } = await import(
            "./dashscope-model.js"
          )
          languageModel = createOpenAICompatibleModel({
            apiKey,
            baseURL,
            modelId: modelID,
          }) as unknown as LanguageModel
          break
        }
        languageModel = createOpenAI({ apiKey, baseURL })(modelID)
        break
      case "anthropic":
        languageModel = createAnthropic({ apiKey })(modelID)
        break
      case "google":
      case "google-vertex":
        languageModel = createGoogleGenerativeAI({ apiKey })(modelID)
        break
      case "openrouter":
        languageModel = createOpenRouter({ apiKey })(modelID)
        break
      case "vercel":
        languageModel = createVercel({ apiKey })(modelID)
        break
      case "azure":
        if (!baseURL) {
          throw new Error(
            "Azure provider requires AZURE_OPENAI_ENDPOINT or OPENAI_BASE_URL environment variable or --api-base-url parameter",
          )
        }
        languageModel = createAzure({ apiKey, baseURL })(modelID)
        break
      case "alibaba-cn":
      case "dashscope": {
        // Custom DashScope model using direct fetch (avoids Bun crash with @ai-sdk/openai-compatible)
        const { createDashScopeModel } = await import("./dashscope-model.js")
        const customModel = createDashScopeModel({
          apiKey,
          baseURL:
            baseURL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
          modelId: modelID,
        })
        // LanguageModelV2 is assignable to LanguageModel via the union type
        languageModel = customModel as unknown as LanguageModel
        break
      }
      case "custom":
      case "openai-compatible":
        if (!baseURL) {
          throw new Error(
            "Custom/OpenAI-compatible provider requires OPENAI_BASE_URL environment variable or --api-base-url parameter",
          )
        }
        // Use direct fetch for ALL OpenAI-compatible providers (avoid Bun crash)
        {
          const { createOpenAICompatibleModel } = await import(
            "./dashscope-model.js"
          )
          languageModel = createOpenAICompatibleModel({
            apiKey,
            baseURL,
            modelId: modelID,
          }) as unknown as LanguageModel
        }
        break
      default:
        throw new Error(`Unsupported provider: ${providerID}`)
    }

    // 缓存 provider 实例，下次同 provider+model 直接复用
    SimpleProvider.providerCache.set(cacheKey, languageModel)
    return languageModel
  }

  private static getApiKey(providerID: string): string | undefined {
    const envVarName = SimpleProvider.getEnvVarName(providerID)
    return process.env[envVarName]
  }

  private static getEnvVarName(providerID: string): string {
    switch (providerID.toLowerCase()) {
      case "openai":
        return "OPENAI_API_KEY"
      case "anthropic":
        return "ANTHROPIC_API_KEY"
      case "google":
      case "google-vertex":
        return "GOOGLE_API_KEY"
      case "openrouter":
        return "OPENROUTER_API_KEY"
      case "vercel":
        return "VERCEL_API_KEY"
      case "azure":
        return "AZURE_OPENAI_API_KEY"
      default: {
        // Try common pattern: <PROVIDER>_API_KEY
        const upper = providerID.toUpperCase().replace(/-/g, "_")
        return `${upper}_API_KEY`
      }
    }
  }
}

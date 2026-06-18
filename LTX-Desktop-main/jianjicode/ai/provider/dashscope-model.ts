/**
 * Custom LanguageModelV2 for DashScope (通义千问).
 *
 * Uses direct fetch() calls to DashScope's OpenAI-compatible API,
 * bypassing @ai-sdk/openai-compatible which crashes Bun on Windows.
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Usage,
  LanguageModelV2StreamPart,
  LanguageModelV2Prompt,
  LanguageModelV2Message,
} from "@ai-sdk/provider"

// ============================================================================
// Prompt converter: LanguageModelV2Prompt → OpenAI chat format
// ============================================================================

function toOpenAIMessages(
  prompt: LanguageModelV2Prompt,
  systemOverride?: string,
): { role: string; content: string; tool_call_id?: string; tool_calls?: any[] }[] {
  const messages: any[] = []

  if (systemOverride) {
    messages.push({ role: "system", content: systemOverride })
  }

  for (const msg of prompt) {
    if (msg.role === "system") {
      messages.push({ role: "system", content: msg.content })
      continue
    }

    if (msg.role === "user") {
      const parts = msg.content as any[]
      const textParts = parts.filter((p: any) => p.type === "text")
      let text = textParts.map((p: any) => p.text).join("")

      // 检测 [DASHSCOPE_VIDEO:oss://...] 标记 — OSS 上传的视频 URL
      const dashscopeVideoRegex = /\[DASHSCOPE_VIDEO:(oss:\/\/[^\]]+)\]/g
      const ossVideoUrls: string[] = []
      let dvMatch
      while ((dvMatch = dashscopeVideoRegex.exec(text)) !== null) {
        ossVideoUrls.push(dvMatch[1])
      }
      if (ossVideoUrls.length > 0) {
        console.log(`[dashscope] Found ${ossVideoUrls.length} DASHSCOPE_VIDEO markers`)
      }
      text = text.replace(dashscopeVideoRegex, "").trim()

      // Check for file/image parts (multimodal content)
      const imageParts = parts.filter((p: any) => p.type === "image")
      const fileParts = parts.filter((p: any) => p.type === "file")

      if (imageParts.length > 0 || fileParts.length > 0 || ossVideoUrls.length > 0) {
        // Multimodal message: build content array
        const contentArray: any[] = []
        if (text) contentArray.push({ type: "text", text })
        for (const img of imageParts) {
          contentArray.push({
            type: "image_url",
            image_url: { url: typeof img.image === "string" ? img.image : img.image.toString() },
          })
        }
        for (const f of fileParts) {
          const mimeType: string = f.mediaType || "application/octet-stream"
          const rawData: string = f.data || ""
          // OSS URL 或 HTTP URL: 直接使用，不加 data: 前缀
          const isUrl = rawData.startsWith("oss://") || rawData.startsWith("http://") || rawData.startsWith("https://")
          const url = isUrl ? rawData : `data:${mimeType};base64,${rawData}`
          if (mimeType.startsWith("video/")) {
            contentArray.push({
              type: "video_url",
              video_url: { url },
            })
          } else if (mimeType.startsWith("image/")) {
            contentArray.push({
              type: "image_url",
              image_url: { url },
            })
          } else {
            contentArray.push({
              type: "image_url",
              image_url: { url },
            })
          }
        }
        // 注入 OSS 上传的视频 URL（[DASHSCOPE_VIDEO:...] 标记）
        for (const ossUrl of ossVideoUrls) {
          contentArray.push({
            type: "video_url",
            video_url: { url: ossUrl },
          })
        }
        messages.push({ role: "user", content: contentArray })
      } else {
        messages.push({ role: "user", content: text || "." })
      }
      continue
    }

    if (msg.role === "assistant") {
      const parts = msg.content as any[]
      const text = parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("")
      const toolCalls = parts
        .filter((p: any) => p.type === "tool-call")
        .map((p: any) => ({
          id: p.toolCallId,
          type: "function",
          function: {
            name: p.toolName,
            arguments:
              typeof p.input === "string" ? p.input : JSON.stringify(p.input),
          },
        }))

      const entry: any = { role: "assistant" }
      if (text) entry.content = text
      if (toolCalls.length > 0) entry.tool_calls = toolCalls
      messages.push(entry)
      continue
    }

    if (msg.role === "tool") {
      for (const part of msg.content as any[]) {
        if (part.type === "tool-result") {
          const value =
            part.output.type === "text"
              ? part.output.value
              : part.output.type === "json"
                ? JSON.stringify(part.output.value)
                : part.output.value ?? ""
          messages.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content: String(value),
          })
        }
      }
    }
  }

  return messages
}

// ============================================================================
// Tool converter: LanguageModelV2 tools → OpenAI tool format
// ============================================================================

function toOpenAITools(
  tools: LanguageModelV2CallOptions["tools"],
): any[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools
    .filter((t: any) => t.type === "function" || !t.type)
    .map((t: any) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema ?? {},
      },
    }))
}

// ============================================================================
// Response converter: OpenAI response → LanguageModelV2Content[]
// ============================================================================

function toV2Content(
  text: string | null,
  toolCalls: any[] | undefined,
): LanguageModelV2Content[] {
  const out: LanguageModelV2Content[] = []
  if (text) {
    out.push({ type: "text", text } as any)
  }
  if (toolCalls) {
    for (const tc of toolCalls) {
      out.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.function.name,
        input: tc.function.arguments,
      } as any)
    }
  }
  return out
}

// ============================================================================
// Finish reason mapper
// ============================================================================

function mapFinishReason(
  reason: string | undefined | null,
): LanguageModelV2FinishReason {
  switch (reason) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "tool_calls":
      return "tool-calls"
    case "content_filter":
      return "content-filter"
    default:
      return "other"
  }
}

// ============================================================================
// SSE parser for streaming
// ============================================================================

function parseSSELine(line: string): any | null {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

// ============================================================================
// DashScope LanguageModel factory
// ============================================================================

interface DashScopeModelConfig {
  modelId: string
  apiKey: string
  baseURL?: string
}

/**
 * Generic factory for any OpenAI-compatible API via direct fetch.
 * Works around the Bun crash with @ai-sdk/openai-compatible.
 */
export function createOpenAICompatibleModel(
  config: DashScopeModelConfig,
): LanguageModelV2 {
  return createDashScopeModel(config)
}

/**
 * DashScope-specific model factory.
 * Uses direct fetch() to DashScope's OpenAI-compatible API.
 */
export function createDashScopeModel(
  config: DashScopeModelConfig,
): LanguageModelV2 {
  const baseURL = (
    config.baseURL ||
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).replace(/\/+$/, "")
  const { modelId, apiKey } = config

  async function apiPost(
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    return fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-OssResourceResolve": "enable",
      },
      body: JSON.stringify(body),
      signal,
    })
  }

  // Shared body builder (minus stream flag)
  function buildBody(options: LanguageModelV2CallOptions, stream: boolean) {
    const { prompt, tools, toolChoice, temperature, maxOutputTokens, topP, stopSequences, seed, abortSignal: _ } = options

    // Extract system message from prompt
    let systemMessage = ""
    const rest: LanguageModelV2Message[] = []
    for (const msg of prompt) {
      if (msg.role === "system") {
        systemMessage += msg.content + "\n"
      } else {
        rest.push(msg)
      }
    }
    systemMessage = systemMessage.trim()

    const openAIMessages = toOpenAIMessages(rest, systemMessage || undefined)
    const hasMultimodal = openAIMessages.some(
      (m: any) => Array.isArray(m.content) && m.content.some((p: any) => p.type === "video_url" || p.type === "image_url")
    )
    if (hasMultimodal) {
      const modalMsg = openAIMessages.find((m: any) => Array.isArray(m.content))
      const types = modalMsg?.content?.map((p: any) => p.type).join(",") || "?"
      console.log(`[dashscope] MULTIMODAL call - content types: [${types}]`)
    } else {
      // DEBUG: show what's in the first message
      const firstContent = openAIMessages[0]?.content
      const firstType = Array.isArray(firstContent) ? firstContent.map((p: any) => p.type).join(",") : typeof firstContent
      console.log(`[dashscope] NON-multimodal - first msg content type: ${firstType}`)
    }
    const openAITools = toOpenAITools(tools)

    const body: Record<string, unknown> = {
      model: modelId,
      messages: openAIMessages,
      stream,
    }

    if (openAITools) body.tools = openAITools
    if (temperature !== undefined) body.temperature = temperature
    if (maxOutputTokens !== undefined) body.max_tokens = maxOutputTokens
    if (topP !== undefined) body.top_p = topP
    if (stopSequences !== undefined) body.stop = stopSequences
    if (seed !== undefined) body.seed = seed

    // Tool choice
    if (toolChoice) {
      if (toolChoice.type === "auto") body.tool_choice = "auto"
      else if (toolChoice.type === "none") body.tool_choice = "none"
      else if (toolChoice.type === "required") body.tool_choice = "required"
      else if (toolChoice.type === "tool") {
        body.tool_choice = {
          type: "function",
          function: { name: toolChoice.toolName },
        }
      }
    }

    return body
  }

  return {
    specificationVersion: "v2",
    provider: "dashscope",
    modelId,
    supportedUrls: {},

    // ── doGenerate (non-streaming) ──────────────────────────────
    async doGenerate(options: LanguageModelV2CallOptions) {
      const body = buildBody(options, false)
      const response = await apiPost(body, options.abortSignal)

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(
          `DashScope API error ${response.status}: ${text || response.statusText}`,
        )
      }

      const json: any = await response.json()
      const choice = json.choices?.[0]
      if (!choice) {
        throw new Error(
          `DashScope returned no choices: ${JSON.stringify(json)}`,
        )
      }

      const content = toV2Content(
        choice.message?.content || null,
        choice.message?.tool_calls,
      )
      const finishReason = mapFinishReason(choice.finish_reason)
      const usage: LanguageModelV2Usage = {
        inputTokens: json.usage?.prompt_tokens ?? undefined,
        outputTokens: json.usage?.completion_tokens ?? undefined,
        totalTokens: json.usage?.total_tokens ?? undefined,
      }

      return {
        content,
        finishReason,
        usage,
        warnings: [],
        request: { body },
        response: {
          id: json.id,
          modelId: json.model,
          headers: {},
          body: json,
        },
      }
    },

    // ── doStream (streaming) ────────────────────────────────────
    async doStream(options: LanguageModelV2CallOptions) {
      const body = buildBody(options, true)
      const response = await apiPost(body, options.abortSignal)

      if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(
          `DashScope API error ${response.status}: ${text || response.statusText}`,
        )
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("DashScope: empty response body")

      const textId = `t_${Date.now()}`
      let textStarted = false
      let accumulatedText = ""
      const toolAccumulators = new Map<
        number,
        { id: string; name: string; args: string }
      >()
      let finishReason: LanguageModelV2FinishReason = "unknown"
      let finalUsage: LanguageModelV2Usage = {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      }
      let buffer = ""
      const decoder = new TextDecoder()

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] } as any)

          try {
            /* eslint-disable no-constant-condition */
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""

              for (const line of lines) {
                const chunk = parseSSELine(line)
                if (!chunk) continue

                // Log every SSE chunk type for debugging
                const hasDelta = !!chunk.choices?.[0]?.delta
                const deltaKeys = hasDelta ? Object.keys(chunk.choices[0].delta) : []
                const hasFinish = !!chunk.choices?.[0]?.finish_reason
                if (chunk.usage) {
                  console.log(`[dashscope] SSE: usage chunk (tokens: ${chunk.usage.total_tokens})`)
                } else if (chunk.error) {
                  console.log(`[dashscope] SSE: ERROR chunk — ${JSON.stringify(chunk.error).slice(0, 500)}`)
                } else if (hasFinish) {
                  console.log(`[dashscope] SSE: finish chunk reason="${chunk.choices[0].finish_reason}"`)
                } else if (deltaKeys.length > 0) {
                  console.log(`[dashscope] SSE: delta keys=[${deltaKeys.join(",")}]`)
                } else {
                  console.log(`[dashscope] SSE: other chunk keys=[${Object.keys(chunk).join(",")}]`)
                }

                // Usage-only chunk (stream_options include_usage)
                if (chunk.usage) {
                  finalUsage = {
                    inputTokens: chunk.usage.prompt_tokens ?? undefined,
                    outputTokens: chunk.usage.completion_tokens ?? undefined,
                    totalTokens: chunk.usage.total_tokens ?? undefined,
                  }
                }

                const delta = chunk.choices?.[0]?.delta
                const finish = chunk.choices?.[0]?.finish_reason
                if (!delta) continue

                // Text delta
                if (delta.content) {
                  if (!textStarted) {
                    controller.enqueue({
                      type: "text-start",
                      id: textId,
                    } as any)
                    textStarted = true
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: delta.content,
                  } as any)
                  accumulatedText += delta.content
                }

                // Tool call streaming delta
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0
                    if (!toolAccumulators.has(idx)) {
                      toolAccumulators.set(idx, {
                        id: tc.id ?? "",
                        name: tc.function?.name ?? "",
                        args: "",
                      })
                    }
                    const acc = toolAccumulators.get(idx)!
                    if (tc.id) acc.id = tc.id
                    if (tc.function?.name) acc.name = tc.function.name
                    if (tc.function?.arguments)
                      acc.args += tc.function.arguments
                  }
                }

                // Finish reason
                if (finish) {
                  console.log(`[dashscope] RAW finish_reason: "${finish}" (full chunk keys: ${Object.keys(chunk).join(",")})`)
                  finishReason = mapFinishReason(finish)
                }
              }
            }

            // Close text part
            if (textStarted) {
              controller.enqueue({ type: "text-end", id: textId } as any)
            }

            // Emit accumulated tool calls
            for (const [, acc] of toolAccumulators) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: acc.id,
                toolName: acc.name,
                input: acc.args,
              } as any)
            }

            // Finish
            controller.enqueue({
              type: "finish",
              usage: finalUsage,
              finishReason,
            } as any)

            controller.close()
          } catch (err) {
            try {
              controller.enqueue({ type: "error", error: err } as any)
            } catch {}
            controller.close()
          }
        },
      })

      return { stream, request: { body } }
    },
  }
}

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { findFfmpegPath, probeDuration, normalizeAudio } from "./ffmpeg-utils.js"

// ================================================================
// TTSEngine 接口 — 所有 TTS 引擎统一实现此接口
// ================================================================

export interface TTSOptions {
  voice: string
  speed: number
  outputPath: string
}

export interface TTSResult {
  audioPath: string
  duration: number
  format: string
}

export interface TTSEngine {
  readonly name: string
  synthesize(text: string, options: TTSOptions): Promise<TTSResult>
}

// ================================================================
// 枚举类型
// ================================================================

export const TTSEngineType = {
  Edge: "edge-tts",
  Azure: "azure",
  OpenAI: "openai",
} as const

// ================================================================
// 引擎开关检查
// ================================================================

export function getAvailableEngines(): string[] {
  const engines: string[] = [TTSEngineType.Edge]
  if (process.env.AZURE_TTS_API_KEY && process.env.AZURE_TTS_REGION) {
    engines.push(TTSEngineType.Azure)
  }
  if (process.env.OPENAI_API_KEY) {
    engines.push(TTSEngineType.OpenAI)
  }
  return engines
}

// ================================================================
// Azure TTS Engine
// ================================================================

const AZURE_VOICES: Record<string, string> = {
  "zh-CN-XiaoxiaoNeural": "zh-CN-XiaoxiaoNeural",
  "zh-CN-YunxiNeural": "zh-CN-YunxiNeural",
  "zh-CN-XiaoyiNeural": "zh-CN-XiaoyiNeural",
  "zh-CN-YunyangNeural": "zh-CN-YunyangNeural",
  "zh-CN-YunjianNeural": "zh-CN-YunjianNeural",
  "zh-CN-XiaochenNeural": "zh-CN-XiaochenNeural",
  "en-US-JennyNeural": "en-US-JennyNeural",
  "en-US-GuyNeural": "en-US-GuyNeural",
  "en-US-AriaNeural": "en-US-AriaNeural",
}

export class AzureTTSEngine implements TTSEngine {
  name = "azure"

  async synthesize(text: string, options: TTSOptions): Promise<TTSResult> {
    const apiKey = process.env.AZURE_TTS_API_KEY
    const region = process.env.AZURE_TTS_REGION
    if (!apiKey || !region) {
      throw new Error("AZURE_TTS_API_KEY and AZURE_TTS_REGION must be configured")
    }

    const voiceName = AZURE_VOICES[options.voice] || options.voice
    const ratePct = (options.speed - 1) * 100
    const rate = `${ratePct >= 0 ? "+" : ""}${ratePct.toFixed(0)}%`

    const ssml = [
      `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">`,
      `  <voice name="${voiceName}">`,
      `    <prosody rate="${rate}">`,
      `      ${escapeXml(text)}`,
      `    </prosody>`,
      `  </voice>`,
      `</speak>`,
    ].join("\n")

    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
      },
      body: ssml,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      throw new Error(`Azure TTS returned ${res.status}: ${errText.slice(0, 200)}`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    const dir = options.outputPath.replace(/[/\\][^/\\]+$/, "")
    if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true })

    const rawPath = options.outputPath.replace(/\.mp3$/, "_raw.mp3")
    await writeFile(rawPath, buffer)
    await normalizeAudio(rawPath, options.outputPath)

    const duration = await probeDuration(options.outputPath)

    return {
      audioPath: options.outputPath,
      duration,
      format: "mp3",
    }
  }
}

// ================================================================
// OpenAI TTS Engine
// ================================================================

const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const

const OPENAI_VOICE_MAP: Record<string, string> = {
  "zh-CN-XiaoxiaoNeural": "nova",
  "zh-CN-YunxiNeural": "onyx",
  "zh-CN-XiaoyiNeural": "shimmer",
  "en-US-JennyNeural": "nova",
  "en-US-GuyNeural": "onyx",
}

export class OpenAITTSEngine implements TTSEngine {
  name = "openai"

  async synthesize(text: string, options: TTSOptions): Promise<TTSResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY must be configured")

    const voice = OPENAI_VOICE_MAP[options.voice] || "alloy"

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice,
        input: text,
        speed: options.speed,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown")
      throw new Error(`OpenAI TTS returned ${res.status}: ${errText.slice(0, 200)}`)
    }

    const buffer = Buffer.from(await res.arrayBuffer())
    const dir = options.outputPath.replace(/[/\\][^/\\]+$/, "")
    if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true })

    const rawPath = options.outputPath.replace(/\.mp3$/, "_raw.mp3")
    await writeFile(rawPath, buffer)
    await normalizeAudio(rawPath, options.outputPath)

    const duration = await probeDuration(options.outputPath)

    return {
      audioPath: options.outputPath,
      duration,
      format: "mp3",
    }
  }
}

// ================================================================
// Helpers
// ================================================================

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

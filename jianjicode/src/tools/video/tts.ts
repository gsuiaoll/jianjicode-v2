import { randomUUID } from "node:crypto"
import { join, dirname } from "node:path"
import { existsSync } from "node:fs"
import { mkdir, unlink } from "node:fs/promises"
import { spawn } from "node:child_process"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import type { TTSEngine, TTSOptions, TTSResult } from "../../lib/tts_engines.js"
import { AzureTTSEngine, OpenAITTSEngine } from "../../lib/tts_engines.js"
import { probeDuration, concatAudioFiles } from "../../lib/ffmpeg-utils.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// ================================================================
// EdgeTTS — Node.js 子进程调用 @travisvn/edge-tts
// 走系统代理，避免 Bun WebSocket 不走 HTTP 代理的问题
// ================================================================

const TTS_WORKER_PATH = join(
  dirname(new URL(import.meta.url).pathname),
  "tts-worker.py",
)

const MAX_CHUNK_CHARS = 300

export function splitText(text: string): string[] {
  const sentences = text.split(/(?<=[。！？\n])/)
  const chunks: string[] = []
  let current = ""
  for (const s of sentences) {
    if (current.length + s.length > MAX_CHUNK_CHARS) {
      if (current) chunks.push(current.trim())
      current = s
    } else {
      current += s
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.length > 0 ? chunks : [text]
}

function spawnTtsWorker(input: {
  text: string
  voice: string
  speed: number
  outputPath: string
}): Promise<{ success: boolean; audioPath: string; duration: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", [TTS_WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || "",
        ALL_PROXY: process.env.ALL_PROXY || process.env.all_proxy || "",
      },
    })

    const timer = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error("TTS worker timeout (30s)"))
    }, 30_000)

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()))

    proc.on("close", (code: number) => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(stdout)
        if (result.success) {
          resolve(result)
        } else {
          reject(new Error(result.error || "TTS worker failed"))
        }
      } catch {
        reject(new Error(`Worker JSON parse error (exit ${code}): ${stderr.slice(0, 200)}`))
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(new Error(`Worker spawn failed: ${err.message}`))
    })

    proc.stdin.write(JSON.stringify(input))
    proc.stdin.end()
  })
}

class EdgeTTSEngine implements TTSEngine {
  name = "edge-tts"

  async synthesize(text: string, options: TTSOptions): Promise<TTSResult> {
    const dir = options.outputPath.replace(/[/\\][^/\\]+$/, "")
    if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true })

    const result = await spawnTtsWorker({
      text,
      voice: options.voice,
      speed: options.speed,
      outputPath: options.outputPath,
    })

    return {
      audioPath: result.audioPath,
      duration: result.duration,
      format: "mp3",
    }
  }
}

// ================================================================
// TTS 工具
// ================================================================

// ================================================================
// 引擎路由 — voice 参数前缀分发
// ================================================================

export function stripPrefix(voice: string): string {
  const idx = voice.indexOf(":")
  return idx >= 0 ? voice.slice(idx + 1) : voice
}

export function resolveEngine(voice: string): TTSEngine {
  if (voice.startsWith("azure:")) {
    if (!process.env.AZURE_TTS_API_KEY || !process.env.AZURE_TTS_REGION) {
      throw new Error("Azure TTS requires AZURE_TTS_API_KEY and AZURE_TTS_REGION env vars")
    }
    return new AzureTTSEngine()
  }
  if (voice.startsWith("openai:")) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI TTS requires OPENAI_API_KEY env var")
    }
    return new OpenAITTSEngine()
  }
  if (voice.startsWith("edge:") || voice === "edge") {
    return new EdgeTTSEngine()
  }
  return new EdgeTTSEngine()
}

async function synthesizeWithFallback(
  text: string,
  voice: string,
  speed: number,
  outputPath: string,
): Promise<TTSResult> {
  const engine = resolveEngine(voice)
  const cleanVoice = stripPrefix(voice)
  try {
    return await engine.synthesize(text, { voice: cleanVoice, speed, outputPath })
  } catch (err) {
    if (engine.name === "edge-tts") throw err
    console.warn(
      `[TTS] ${engine.name} failed: ${(err as Error).message}. Falling back to edge-tts.`,
    )
    return new EdgeTTSEngine().synthesize(text, {
      voice: "zh-CN-XiaoxiaoNeural",
      speed,
      outputPath,
    })
  }
}

const paramsSchema = z.object({
  text: z.string().min(1).max(5000).describe("要合成的文本，最长5000字符"),
  voice: z.string().optional().default("zh-CN-XiaoxiaoNeural")
    .describe("发音人。默认edge-tts(免费免Key): zh-CN-XiaoxiaoNeural(女)/YunxiNeural(男)。Azure: 加前缀 azure:zh-CN-YunxiNeural。OpenAI: 加前缀 openai:alloy。付费引擎失败自动降级到edge-tts"),
  speed: z.number().min(0.5).max(2.0).optional().default(1.0)
    .describe("语速倍率，0.5=半速, 2.0=双倍速"),
  output: z.string().optional().describe("输出路径。默认: outputs/tts/<hash>.mp3"),
})

type TTSArgs = z.infer<typeof paramsSchema>

export const TtsTool = Tool.define("tts", {
  description:
    "文字转语音/配音/解说。默认Edge-TTS免费免Key(100+语音)，支持Azure/OpenAI付费引擎(需配置API Key)。付费引擎失败自动降级到Edge-TTS",
  parameters: paramsSchema,
  usageTemplate: {
    json: {
      text: "{narration_text}",
      voice: "zh-CN-XiaoxiaoNeural",
      speed: 1.0,
      output: "{output_dir}/tts/narration_0001.mp3",
    },
    constraints: [
      "语音时长决定画面时长 — tts返回的duration应作为帧的展示时长",
      "长文本会自动分句合成，避免单次请求失败",
    ],
  },
  execute: async (args: TTSArgs, ctx) => {
    const outputPath =
      args.output ||
      join(process.cwd(), "outputs", "tts", `${randomUUID().slice(0, 8)}.mp3`)

    const chunks = args.text.length > MAX_CHUNK_CHARS ? splitText(args.text) : [args.text]
    const isChunked = chunks.length > 1
    const resolvedEngine = resolveEngine(args.voice)

    console.log(
      `[TTS] Synthesizing ${args.text.length} chars, engine=${resolvedEngine.name}, voice=${args.voice}, ` +
        `speed=${args.speed}${isChunked ? `, chunks=${chunks.length}` : ""}`,
    )

    let finalPath = outputPath
    let totalDuration = 0
    const chunkResults: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      const chunkPath =
        chunks.length === 1
          ? outputPath
          : outputPath.replace(/\.mp3$/, `_chunk_${String(i).padStart(3, "0")}.mp3`)

      const result = await synthesizeWithFallback(chunks[i], args.voice, args.speed, chunkPath)

      totalDuration += result.duration
      chunkResults.push(result.audioPath)
      console.log(`[TTS] Chunk ${i + 1}/${chunks.length}: ${result.duration.toFixed(2)}s`)
    }

    // 多段拼接
    if (chunkResults.length > 1) {
      finalPath = outputPath
      await concatAudioFiles(chunkResults, finalPath)
      totalDuration = await probeDuration(finalPath)
      for (const p of chunkResults) {
        if (p !== finalPath) await unlink(p).catch(() => {})
      }
    }

    console.log(`[TTS] Generated: ${finalPath} (${totalDuration.toFixed(2)}s)`)

    const editOperations: EditOperation[] = [{
      operationId: generateOperationId(),
      undoable: true,
      type: "add_clip" as const,
      clipId: generateClipId(),
      asset: {
        url: finalPath,
        path: finalPath,
        type: "audio",
      },
      trackKind: "audio",
      trackName: "音频轨道",
      startTime: 0,
      duration: totalDuration,
      metadata: {
        toolName: "tts",
        description: `TTS: ${args.text.slice(0, 30)}... (${totalDuration.toFixed(1)}s)`,
        timestamp: Date.now(),
      },
    }]

    return {
      title: "TTS 语音合成完成",
      metadata: {
        operation: "tts",
        success: true,
      undoable: true,
        duration: totalDuration,
        voice: args.voice,
        speed: args.speed,
        format: "mp3",
        textLength: args.text.length,
        chunks: chunks.length,
      },
      output:
        `语音合成完成\n` +
        `文本: ${args.text.slice(0, 50)}${args.text.length > 50 ? "..." : ""}\n` +
        `发音人: ${args.voice}\n` +
        `时长: ${totalDuration.toFixed(2)} 秒\n` +
        `文件: ${finalPath}`,
      editOperations,
    }
  },
})

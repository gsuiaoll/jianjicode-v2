/**
 * VideoLocator — 关键帧视觉定位
 *
 * === 职责 ===
 * 对每个镜头提取关键帧，通过 Qwen 3.5-Omni-Flash 多模态模型
 * 判断目标物体是否出现在该镜头中。
 *
 * === 工作流 ===
 *   ┌─────────────────────┐
 *   │ 对每个 shot:         │
 *   │ 按规则抽帧            │
 *   │ ≤3s  → 1帧           │
 *   │ 3-8s → 3帧 (首/中/尾)│
 *   │ >8s  → 5帧           │
 *   └────────┬────────────┘
 *            ↓
 *   ┌─────────────────────┐
 *   │ 一批发送所有帧到模型  │
 *   │ + 指令               │
 *   └────────┬────────────┘
 *            ↓
 *   ┌─────────────────────┐
 *   │ 代码层过滤 ≥0.7     │
 *   │ 返回 LocateResult   │
 *   └─────────────────────┘
 */

import { generateText } from "ai"
import { spawnSync } from "child_process"
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { SimpleProvider } from "../../../lib/simple-provider.js"
import type { Shot } from "./shot-detector.js"

// ============================================================================
// 常量
// ============================================================================

/** 置信度阈值 — 代码层硬卡，不让模型自己判断 */
const CONFIDENCE_THRESHOLD = 0.7

/** 模型配置 */
const MODEL_ID = "qwen3.5-omni-flash"

// ============================================================================
// 类型定义
// ============================================================================

export interface LocateResult {
  status: "FOUND" | "NOT_FOUND"
  target: string
  targetShots: Array<{
    id: number
    confidence: number
    reason: string
    evidenceFrames: number[]
  }>
}

// ============================================================================
// 帧提取
// ============================================================================

/** 获取 ffmpeg 路径（复用 ffmpeg-utils 路径查找逻辑） */
function findFfmpegPath(): string {
  const fromEnv = process.env.JIANJICODE_FFMPEG_PATH || process.env.FFMPEG_PATH
  if (fromEnv) return fromEnv
  const candidates = [
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    join(process.cwd(), "..", "node_modules", "ffmpeg-static", "ffmpeg"),
    "ffmpeg",
    "/usr/bin/ffmpeg",
  ]
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["-version"], { timeout: 3000 })
      if (r.status === 0) return c
    } catch {
      /* continue */
    }
  }
  return "ffmpeg"
}

/**
 * 从视频中提取指定时间点的 JPEG 帧，返回 base64 编码
 */
function extractFrame(
  videoPath: string,
  timeSeconds: number,
  tmpDir: string,
): string | null {
  const outFile = join(
    tmpDir,
    `frame_${timeSeconds.toFixed(3).replace(".", "_")}.jpg`,
  )
  const ffmpeg = findFfmpegPath()
  const r = spawnSync(
    ffmpeg,
    [
      "-ss",
      String(timeSeconds),
      "-i",
      videoPath,
      "-vf",
      "scale=720:-2",
      "-vframes",
      "1",
      "-q:v",
      "5",
      "-y",
      outFile,
    ],
    { timeout: 15000 },
  )

  if (r.status !== 0 || !existsSync(outFile)) return null

  const data = readFileSync(outFile)
  const base64 = data.toString("base64")
  try {
    unlinkSync(outFile)
  } catch {
    /* ignore */
  }
  return base64
}

/**
 * 计算镜头内抽帧位置
 * 末帧位置 offset -0.1s 避免 ffmpeg 精确边界 seek 失败
 */
function computeFramePositions(shot: Shot): number[] {
  const dur = shot.duration
  if (dur <= 0.2) return [shot.start + dur / 2]

  let count: number
  if (dur <= 3) {
    count = 1
  } else if (dur <= 8) {
    count = 3
  } else {
    count = 5
  }

  if (count === 1) {
    return [parseFloat((shot.start + dur / 2).toFixed(3))]
  }

  const positions: number[] = []
  for (let i = 0; i < count; i++) {
    const ratio = i / (count - 1)
    const t = shot.start + dur * ratio
    // clamp: 不压 start，末帧提前 0.1s 避开边界
    const clamped = ratio >= 1 ? t - 0.1 : t
    positions.push(parseFloat(clamped.toFixed(3)))
  }
  return positions
}

/**
 * 提取镜头关键帧
 */
function extractKeyframes(
  videoPath: string,
  shots: Shot[],
  tmpDir: string,
): Array<{ shotId: number; frames: string[]; positions: number[] }> {
  const results: Array<{
    shotId: number
    frames: string[]
    positions: number[]
  }> = []

  for (const shot of shots) {
    const positions = computeFramePositions(shot)
    const frames: string[] = []
    const extractedPositions: number[] = []

    for (const t of positions) {
      const b64 = extractFrame(videoPath, t, tmpDir)
      if (b64) {
        frames.push(b64)
        extractedPositions.push(t)
      }
    }

    if (frames.length > 0) {
      results.push({ shotId: shot.id, frames, positions: extractedPositions })
    }
  }

  return results
}

// ============================================================================
// 模型调用
// ============================================================================

function getModelConfig(): { apiKey: string; modelId: string } {
  const fromEnv = process.env.DASHSCOPE_API_KEY
  const fromConfig = (() => {
    try {
      const config = JSON.parse(
        readFileSync(join(process.cwd(), "config.json"), "utf-8"),
      )
      return (config as any).dashscope?.apiKey || ""
    } catch {
      return ""
    }
  })()
  return {
    apiKey: fromEnv || fromConfig,
    modelId: process.env.DASHSCOPE_MODEL || MODEL_ID,
  }
}

function buildPrompt(instruction: string, shots: Shot[]): string {
  const prompt = `请分析以下视频帧，判断目标物体是否出现在这些帧中。

用户指令：${instruction}

要求：
1. 逐镜头判断是否包含用户在指令中提到的目标
2. 严格基于画面中的视觉证据判断
3. confidence: 完全看不到=0, 部分可见=0.3~0.6, 清晰可见=0.7以上

请只输出一行纯JSON，不要加任何markdown格式或说明文字，格式：
{"target":"目标名称","results":[{"shotId":0,"containsTarget":true,"confidence":0.95,"reason":"理由"}]}

本次共 ${shots.length} 个镜头，results 应为包含每个镜头判断结果的数组。`

  return prompt
}

/** 从模型响应文本中提取 JSON 对象 */
function extractJSON(text: string): any {
  // 移除 markdown code fence
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?```\s*$/gm, "")
    .trim()
  return JSON.parse(cleaned)
}

/**
 * 定位包含目标物体的镜头
 */
export async function locateTargetShots(
  shots: Shot[],
  instruction: string,
  videoPath: string,
  signal?: AbortSignal,
): Promise<LocateResult> {
  if (shots.length === 0) {
    return { status: "NOT_FOUND", target: "", targetShots: [] }
  }

  if (!existsSync(videoPath)) {
    return { status: "NOT_FOUND", target: "", targetShots: [] }
  }

  // 1. 提取关键帧
  const tmpDir = resolve(tmpdir(), "video_locator_" + Date.now())
  mkdirSync(tmpDir, { recursive: true })
  const keyframes = extractKeyframes(videoPath, shots, tmpDir)
  // 清理临时目录
  try {
    for (const f of readFileSync(tmpDir)) {
      unlinkSync(join(tmpDir, f as any))
    }
  } catch {
    /* ignore */
  }

  if (keyframes.length === 0) {
    return { status: "NOT_FOUND", target: "", targetShots: [] }
  }

  // 2. 构建模型调用
  const modelCfg = getModelConfig()
  if (!modelCfg.apiKey) {
    throw new Error(
      "DASHSCOPE_API_KEY not configured. Set environment variable or config.json dashscope.apiKey.",
    )
  }

  const model = await SimpleProvider.getLanguage(
    { providerID: "dashscope", id: modelCfg.modelId },
    { apiKey: modelCfg.apiKey },
  )

  // 3. 构建消息内容：指令 + 所有帧
  const contentParts: any[] = [
    { type: "text" as const, text: buildPrompt(instruction, shots) },
  ]

  for (const kf of keyframes) {
    contentParts.push({
      type: "text" as const,
      text: `\n--- 镜头 ${kf.shotId} 的关键帧（共 ${kf.frames.length} 帧）---`,
    })
    for (const frame of kf.frames) {
      contentParts.push({
        type: "file" as const,
        data: frame,
        mediaType: "image/jpeg" as const,
      })
    }
  }

  // 4. 调用模型（用 generateText + 手动 JSON 解析，
  //    因为 DashScope 的 generateObject schema 引导不可靠）
  let parsed: {
    target: string
    results: Array<{
      shotId: number
      containsTarget: boolean
      confidence: number
      reason: string
    }>
  }
  try {
    const resp = await generateText({
      model,
      system: "你是一个视频帧分析助手。分析用户提供的帧并按指定JSON格式输出。",
      messages: [{ role: "user", content: contentParts }],
      temperature: 0.1,
      maxOutputTokens: 4096,
      abortSignal: signal,
    })
    parsed = extractJSON(resp.text)
  } catch (e: any) {
    if (signal?.aborted) throw e
    return { status: "NOT_FOUND", target: "", targetShots: [] }
  }

  // 5. 代码层过滤 — 置信度 >= 0.7
  const targetName = parsed.target || ""
  const rawResults = Array.isArray(parsed.results) ? parsed.results : []

  const targetShots = rawResults
    .filter((s) => s.containsTarget && s.confidence >= CONFIDENCE_THRESHOLD)
    .map((s) => ({
      id: s.shotId,
      confidence: s.confidence,
      reason: s.reason || "",
      evidenceFrames:
        keyframes.find((k) => k.shotId === s.shotId)?.positions || [],
    }))
    .filter((s) => shots.some((sh) => sh.id === s.id))

  return {
    status: targetShots.length > 0 && targetName ? "FOUND" : "NOT_FOUND",
    target: targetName,
    targetShots,
  }
}

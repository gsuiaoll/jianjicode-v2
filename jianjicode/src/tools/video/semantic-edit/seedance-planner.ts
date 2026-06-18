/**
 * SeedancePlanner — Seedance 重生成保护层
 *
 * === 职责 ===
 * - 时长保护：单次送 seedance ≤12s（比 API 上限 15s 留余量）
 * - Prompt 模板：将用户指令翻译为 seedance 可执行的英文 prompt
 * - 并发控制：最大 2 个并发 seedance 任务
 * - 重试：最多 1 次
 * - 失败 fallback：返回 source="original"（不输出半成品）
 */

import { execSync } from "child_process"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { trimVideo, findFfmpegPath } from "../../../lib/ffmpeg-utils.js"
import type { Segment } from "./composer.js"
import { runSeedance, type SeedanceResult } from "./seedance-service.js"
import type { Shot } from "./shot-detector.js"

// ============================================================================
// 并发信号量（避免 p-limit 依赖）
// ============================================================================

class Semaphore {
  private current = 0
  private queue: Array<() => void> = []

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++
        resolve()
      })
    })
  }

  release(): void {
    this.current--
    const next = this.queue.shift()
    if (next) next()
  }
}

const seedanceConcurrency = new Semaphore(2)

// ============================================================================
// Prompt 工程
// ============================================================================

/**
 * 构建 Seedance 重生成 prompt
 * 将中文指令翻译为英文 prompt，告知 AI 保真编辑
 */
export function buildEditPrompt(target: string, instruction: string): string {
  return `Edit this video scene: ${instruction}

Only modify the "${target}" as instructed.
Preserve the original background, lighting, camera motion, timing, and composition.
Do not redesign, add new elements, or change anything beyond what is instructed.
Keep the video duration exactly the same.`
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 对单个镜头执行 Seedance 编辑
 *
 * 1. 从原视频裁剪镜头片段作为参考
 * 2. 构建英文 prompt
 * 3. 调用 seedance（带重试）
 * 4. 成功 → 返回 source="seedance" 的 Segment
 * 5. 失败 → 返回 source="original" 的 Segment（fallback）
 */
export async function planAndExecute(
  shot: Shot,
  target: string,
  instruction: string,
  originalVideo: string,
  signal?: AbortSignal,
): Promise<Segment> {
  const fallback: Segment = {
    id: shot.id,
    start: shot.start,
    end: shot.end,
    duration: shot.duration,
    source: "original",
  }

  // 时长保护：最长 12s（留余量）
  const effectiveDuration = Math.min(shot.duration, 12)

  // 裁剪镜头片段作为 seedance 参考视频
  const trimDir = resolve(tmpdir(), "seedance_trim")
  mkdirSync(trimDir, { recursive: true })
  let clipPath = join(trimDir, `shot_${shot.id}_${Date.now()}.mp4`)

  const trimResult = await trimVideo(
    originalVideo,
    clipPath,
    String(shot.start),
    String(shot.end),
    signal,
  )
  if (!trimResult.success) {
    return fallback
  }

  // Fast 模型像素预算归一化（≤2,086,876px）
  const modelPxLimit = 2_086_876
  const dims = getVideoDimensions(clipPath)
  if (dims && dims.width * dims.height > modelPxLimit) {
    const scale = Math.sqrt(modelPxLimit / (dims.width * dims.height))
    const newW = Math.floor(dims.width * scale) & ~1
    const newH = Math.floor(dims.height * scale) & ~1
    const normPath = join(trimDir, `norm_${shot.id}_${Date.now()}.mp4`)
    console.log(
      `   [Seedance] 参考视频 ${dims.width}x${dims.height} 超过预算，缩放至 ${newW}x${newH}`,
    )
    try {
      const ffmpegBin = findFfmpegPath() || "ffmpeg"
      execSync(
        `${JSON.stringify(ffmpegBin)} -y -i ${JSON.stringify(clipPath)} -vf "scale=${newW}:${newH}:flags=lanczos" -c:a copy ${JSON.stringify(normPath)}`,
        { timeout: 60_000 },
      )
      clipPath = normPath
    } catch {
      return fallback
    }
  }

  // 构建 prompt
  const prompt = buildEditPrompt(target, instruction)

  // 获取并发槽
  await seedanceConcurrency.acquire()

  if (signal?.aborted) {
    seedanceConcurrency.release()
    return fallback
  }

  try {
    // 最多重试 1 次
    let result: SeedanceResult | undefined
    for (let attempt = 0; attempt <= 1; attempt++) {
      if (signal?.aborted) break
      result = await runSeedance(
        {
          prompt,
          referenceVideoPath: clipPath,
          duration: Math.max(4, Math.round(effectiveDuration)),
          ratio: "16:9",
          resolution: "720p",
        },
        signal,
      )
      if (result.success) break
      if (attempt === 0) {
        console.log(`   [Seedance] Shot ${shot.id} 重试中... (${result.error})`)
        await sleep(2000)
      } else {
        console.log(`   [Seedance] Shot ${shot.id} 失败: ${result.error}`)
      }
    }

    if (result?.success && result.outputPath) {
      return {
        id: shot.id,
        start: shot.start,
        end: shot.end,
        duration: shot.duration,
        source: "seedance",
        path: result.outputPath,
      }
    }

    return fallback
  } finally {
    seedanceConcurrency.release()
    try {
      if (existsSync(clipPath)) unlinkSync(clipPath)
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 用 ffprobe 读取视频分辨率 */
function getVideoDimensions(
  path: string,
): { width: number; height: number } | null {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_streams ${JSON.stringify(path)}`,
      { timeout: 5_000, encoding: "utf8" },
    )
    const d = JSON.parse(out)
    const s = d.streams?.find((s: any) => s.codec_type === "video")
    return s?.width && s?.height ? { width: s.width, height: s.height } : null
  } catch {
    return null
  }
}

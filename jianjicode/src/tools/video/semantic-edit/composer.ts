/**
 * Composer — 片段裁剪 + 动态 crossfade + 拼接
 *
 * === 职责 ===
 * 将原始/生成的片段序列合成为一个完整的输出视频。
 * - 原始片段 → trimVideo 裁剪
 * - 生成片段 → 直接使用已有文件
 * - 边界动态 crossfade → acrossfade 滤镜
 * - 最终 concat 拼接
 *
 * === Crossfade 规则 ===
 *   fade = Math.min(0.5, clipDuration * 0.05)
 *   4s → 0.2s | 8s → 0.4s | 15s → 0.5s
 */

import { spawnSync } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { concatVideos, getVideoInfo, trimVideo } from "../../../lib/ffmpeg-utils.js"
import { validatePath } from "../../../lib/ffmpeg-sandbox.js"

export interface Segment {
  id: number
  start: number
  end: number
  duration: number
  source: "original" | "seedance"
  path?: string // seedance 生成后的文件路径
}

/**
 * 合成视频
 * @param originalVideo - 原视频路径（裁剪原始片段时需要）
 * @param segments - 片段序列（按时间序）
 * @param outputPath - 输出路径
 * @param signal - 取消信号
 */
export async function compose(
  originalVideo: string,
  segments: Segment[],
  outputPath: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; output: string }> {
  if (segments.length === 0) {
    return { success: false, output: "No segments to compose" }
  }

  // 路径安全校验
  const sandbox = validatePath(originalVideo, outputPath)
  if (!sandbox.ok) {
    return { success: false, output: sandbox.error }
  }
  outputPath = sandbox.outputPath

  // 1. 裁剪/准备所有片段
  const clipPaths: string[] = []
  for (const seg of segments) {
    if (seg.source === "original") {
      const clipPath = outputPath.replace(/\.\w+$/, `_seg_${seg.id}.mp4`)
      const trimResult = await trimVideo(
        originalVideo,
        clipPath,
        String(seg.start),
        String(seg.end),
        signal,
      )
      if (!trimResult.success) {
        return {
          success: false,
          output: `Trim failed for segment ${seg.id}: ${trimResult.error}`,
        }
      }
      clipPaths.push(clipPath)
    } else if (seg.source === "seedance" && seg.path) {
      clipPaths.push(seg.path)
    }
  }

  // 2. 检测 seedance 边界
  const transitions: Array<{ index: number; fade: number }> = []
  for (let i = 1; i < segments.length; i++) {
    if (segments[i - 1].source !== segments[i].source) {
      const fade = parseFloat(
        Math.min(
          0.5,
          Math.min(segments[i - 1].duration, segments[i].duration) * 0.05,
        ).toFixed(2),
      )
      transitions.push({ index: i, fade })
    }
  }

  // 3. 少量过渡 → crossfade；否则直拼
  if (transitions.length > 0 && transitions.length <= 2) {
    const xfadeResult = await composeWithCrossfade(
      clipPaths,
      transitions,
      outputPath,
      signal,
    )
    if (xfadeResult.success) return xfadeResult
    // fall through to plain concat
  }

  // 4. 直拼
  const concatResult = await concatVideos(clipPaths, outputPath)
  if (!concatResult.success) {
    return { success: false, output: `Concat failed: ${concatResult.error}` }
  }

  // 5. 验证输出
  const info = await getVideoInfo(outputPath)
  if (!info?.success) {
    return { success: false, output: "Output video verification failed" }
  }

  return { success: true, output: outputPath }
}

/**
 * 带 crossfade 的合成
 * 对每个 boundary 提取过渡段做 xfade + acrossfade，
 * 再拼接回完整序列。
 */
async function composeWithCrossfade(
  clipPaths: string[],
  transitions: Array<{ index: number; fade: number }>,
  outputPath: string,
  signal?: AbortSignal,
): Promise<{ success: boolean; output: string }> {
  const workDir = resolve(tmpdir(), "composer_xfade_" + Date.now())
  mkdirSync(workDir, { recursive: true })

  try {
    // 对每个 transition 生成 crossfade 片段，然后拼回
    const finalClips: string[] = []
    let lastIdx = 0

    for (const t of transitions) {
      if (signal?.aborted) return { success: false, output: "Cancelled" }

      // 前 clip 尾部 + 后 clip 头部做 crossfade
      const tailClip = join(workDir, `tail_${t.index}.mp4`)
      const headClip = join(workDir, `head_${t.index}.mp4`)
      const fadeClip = join(workDir, `fade_${t.index}.mp4`)

      // 提取前 clip 尾部
      const prevDur = getDuration(clipPaths[t.index - 1], signal)
      if (signal?.aborted) {
        return {
          success: false,
          output: "Cancelled",
        }
      }
      if (prevDur <= t.fade) {
        return {
          success: false,
          output: `clip ${t.index - 1} too short for crossfade`,
        }
      }
      if (signal?.aborted) return { success: false, output: "Cancelled" }
      const r1 = spawnSync(
        "ffmpeg",
        [
          "-ss",
          String(prevDur - t.fade),
          "-i",
          clipPaths[t.index - 1],
          "-t",
          String(t.fade),
          "-c",
          "copy",
          "-y",
          tailClip,
        ],
        { timeout: 15_000 },
      )
      if (signal?.aborted) return { success: false, output: "Cancelled" }
      if (r1.status !== 0)
        return { success: false, output: `extract tail failed at ${t.index}` }

      // 提取后 clip 头部
      if (signal?.aborted) return { success: false, output: "Cancelled" }
      const r2 = spawnSync(
        "ffmpeg",
        [
          "-i",
          clipPaths[t.index],
          "-t",
          String(t.fade),
          "-c",
          "copy",
          "-y",
          headClip,
        ],
        { timeout: 15_000 },
      )
      if (r2.status !== 0)
        return { success: false, output: `extract head failed at ${t.index}` }

      // crossfade
      if (signal?.aborted) return { success: false, output: "Cancelled" }
      const r3 = spawnSync(
        "ffmpeg",
        [
          "-i",
          tailClip,
          "-i",
          headClip,
          "-filter_complex",
          `[0:v]format=yuva420p,fade=d=${t.fade}:alpha=1[f0];` +
            `[1:v]format=yuva420p,fade=d=${t.fade}:alpha=1,reverse[f1];` +
            `[f0][f1]overlay[fv];` +
            `[0:a][1:a]acrossfade=d=${t.fade}[fa]`,
          "-map",
          "[fv]",
          "-map",
          "[fa]",
          "-y",
          fadeClip,
        ],
        { timeout: 30_000 },
      )
      if (r3.status !== 0) {
        return {
          success: false,
          output: `crossfade render failed at ${t.index}`,
        }
      }

      // 前 clip 去尾后加入
      if (lastIdx < t.index - 1) {
        finalClips.push(clipPaths[t.index - 1]) // no tail needed
      } else {
        // 需要裁掉尾部
        const trimmed = join(workDir, `trim_tail_${t.index}.mp4`)
        if (signal?.aborted) return { success: false, output: "Cancelled" }
        const rt = spawnSync(
          "ffmpeg",
          [
            "-i",
            clipPaths[t.index - 1],
            "-t",
            String(prevDur - t.fade),
            "-c",
            "copy",
            "-y",
            trimmed,
          ],
          { timeout: 15_000 },
        )
        if (rt.status !== 0)
          return { success: false, output: `trim tail failed at ${t.index}` }
        finalClips.push(trimmed)
      }

      // crossfade 片段
      finalClips.push(fadeClip)

      // 后 clip 去头后加入
      const afterDur = getDuration(clipPaths[t.index], signal)
      if (afterDur > t.fade) {
        const trimmed = join(workDir, `trim_head_${t.index}.mp4`)
        if (signal?.aborted) return { success: false, output: "Cancelled" }
        const rt = spawnSync(
          "ffmpeg",
          [
            "-ss",
            String(t.fade),
            "-i",
            clipPaths[t.index],
            "-c",
            "copy",
            "-y",
            trimmed,
          ],
          { timeout: 15_000 },
        )
        if (rt.status !== 0)
          return { success: false, output: `trim head failed at ${t.index}` }
        finalClips.push(trimmed)
      } else {
        finalClips.push(clipPaths[t.index])
      }

      lastIdx = t.index + 1
    }

    // 添加剩余的 clip
    for (let i = lastIdx; i < clipPaths.length; i++) {
      finalClips.push(clipPaths[i])
    }

    // 拼接
    const concatResult = await concatVideos(finalClips, outputPath)
    if (!concatResult.success) {
      return {
        success: false,
        output: `crossfade concat failed: ${concatResult.error}`,
      }
    }

    return { success: true, output: outputPath }
  } catch (err) {
    return {
      success: false,
      output: `crossfade error: ${(err as Error).message}`,
    }
  }
}

/** 用 ffprobe 获取视频时长 */
function getDuration(videoPath: string, signal?: AbortSignal): number {
  if (signal?.aborted) return 0
  const r = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", videoPath],
    { timeout: 5_000 },
  )
  if (r.status !== 0) return 0
  try {
    return parseFloat(JSON.parse(r.stdout.toString()).format?.duration || "0")
  } catch {
    return 0
  }
}

/**
 * ShotDetector — FFmpeg scene detect 镜头检测
 *
 * === 职责 ===
 * 调用 ffmpeg scene detect 滤镜检测场景切换点，按镜头切分视频。
 *
 * === 使用 ===
 *   const shots = await detectShots("input.mp4")
 *   // → [{ id: 0, start: 0, end: 4.2, duration: 4.2 }, ...]
 *
 * === 输出规则 ===
 * - 过滤 <0.7s 的短片段（误报过滤）
 * - 覆盖 0～视频尾，不遗漏
 * - 不判断 motion 类型（Sprint 1 无消费方）
 */

import { getVideoInfo, runFfmpeg } from "../../../lib/ffmpeg-utils.js"

export interface Shot {
  id: number
  start: number
  end: number
  duration: number
}

/**
 * 检测视频镜头切分
 * @param inputPath - 输入视频路径
 * @param options.threshold - scene detect 敏感度 (0~1, default 0.3，越低越敏感)
 * @param options.abort - 取消信号
 */
export async function detectShots(
  inputPath: string,
  options?: {
    threshold?: number
    signal?: AbortSignal
  },
): Promise<Shot[]> {
  const threshold = options?.threshold ?? 0.3
  const signal = options?.signal

  // 1. 获取视频时长
  const info = await getVideoInfo(inputPath)
  const duration = info?.data?.format?.duration
  if (!duration || duration <= 0) {
    return []
  }
  const totalDuration = Number(duration)

  // 2. ffmpeg scene detect
  const filter = `select='gt(scene,${threshold})',showinfo`
  const result = await runFfmpeg(
    ["-i", inputPath, "-vf", filter, "-f", "null", "-"],
    signal,
  )

  if (!result.success) {
    // ffmpeg scene detect 失败时回退：整个视频作为一个 shot
    return [{ id: 0, start: 0, end: totalDuration, duration: totalDuration }]
  }

  // 3. 解析 pts_time 时间戳
  const stderr = result.output || ""
  const ptsTimes: number[] = []
  const regex = /pts_time:([\d.]+)/g
  let match
  while ((match = regex.exec(stderr)) !== null) {
    const t = parseFloat(match[1])
    if (!isNaN(t)) ptsTimes.push(t)
  }

  // 4. 构造 shots：从 0 开始，每个切换点结束上一个
  const rawShots: Shot[] = []
  let prev = 0
  for (const t of ptsTimes) {
    const dur = t - prev
    if (dur >= 0.7) {
      rawShots.push({
        id: rawShots.length,
        start: prev,
        end: t,
        duration: parseFloat(dur.toFixed(3)),
      })
    }
    prev = t
  }

  // 5. 收尾片段
  const tailDuration = totalDuration - prev
  if (tailDuration >= 0.7) {
    rawShots.push({
      id: rawShots.length,
      start: prev,
      end: totalDuration,
      duration: parseFloat(tailDuration.toFixed(3)),
    })
  }

  return rawShots.length > 0
    ? rawShots
    : [
        {
          id: 0,
          start: 0,
          end: totalDuration,
          duration: totalDuration,
        },
      ]
}

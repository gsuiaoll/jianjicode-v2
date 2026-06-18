/**
 * 时间格式转换工具库
 *
 * 统一处理以下格式之间的互转，避免各处重复实现：
 *   - HH:MM:SS,mmm  (SRT 时间戳格式)
 *   - HH:MM:SS.ms   (FFmpeg 时间格式)
 *   - 毫秒 (number)
 *   - 秒   (number)
 *   - 采样点索引 (sample index, 默认 16000Hz)
 */

// ============================================================================
// 格式 → 毫秒
// ============================================================================

/** "01:32:45,500" → 5565500 */
export function srtTimeToMillis(srt: string): number {
  const match = srt.match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (!match) throw new Error(`Invalid SRT time format: "${srt}"`)
  const h = parseInt(match[1], 10)
  const m = parseInt(match[2], 10)
  const s = parseInt(match[3], 10)
  const ms = parseInt(match[4].padEnd(3, "0"), 10)
  return h * 3_600_000 + m * 60_000 + s * 1000 + ms
}

/** "01:32:45.5" 或纯秒数 → 毫秒 */
export function ffmpegTimeToMillis(time: string): number {
  const num = Number(time)
  if (!isNaN(num)) return Math.round(num * 1000)
  return srtTimeToMillis(time.replace(".", ","))
}

/** 秒 → 毫秒 */
export function secondsToMillis(sec: number): number {
  return Math.round(sec * 1000)
}

// ============================================================================
// 毫秒 → 格式
// ============================================================================

/** 5565500 → "01:32:45,500" */
export function millisToSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(r)}`
}

/** 5565500 → "01:32:45.500" (FFmpeg 用) */
export function millisToFfmpegTime(ms: number): string {
  return millisToSrtTime(ms).replace(",", ".")
}

/** 毫秒 → 秒 */
export function millisToSeconds(ms: number): number {
  return ms / 1000
}

// ============================================================================
// 采样点 (sample index) ↔ 时间
// ============================================================================

/** 采样点索引 → 毫秒 */
export function samplesToMillis(samples: number, sampleRate = 16_000): number {
  return Math.round((samples / sampleRate) * 1000)
}

/** 毫秒 → 采样点索引 */
export function millisToSamples(ms: number, sampleRate = 16_000): number {
  return Math.round((ms / 1000) * sampleRate)
}

/** 秒 → 采样点索引 */
export function secondsToSamples(sec: number, sampleRate = 16_000): number {
  return Math.round(sec * sampleRate)
}

// ============================================================================
// 工具
// ============================================================================

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0")
}

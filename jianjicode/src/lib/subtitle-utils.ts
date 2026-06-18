/**
 * 字幕工具集
 *
 * 借鉴 FunClip 的 subtitle_utils.py + trans_utils.py，TypeScript 重写。
 * 包含:
 *   1. SRT 字幕文本生成（完整 / 裁剪窗口）
 *   2. 文本→时间戳匹配（从 ASR 原文中定位目标文本的时间范围）
 */

import { millisToSrtTime } from "./time-utils.js"

// ============================================================================
// 类型定义
// ============================================================================

/** ASR 识别结果中的一句话 */
export interface SrtSentence {
  text: string
  start: number // 毫秒
  end: number // 毫秒
  speakerId?: string
}

/** 裁剪结果的 SRT 条目的段 */
export interface SubtitleSegment {
  text: string
  startMs: number
  endMs: number
  speakerId?: string
}

/** generateSrtClip 的完整结果 */
export interface SrtClipResult {
  srt: string
  segments: SubtitleSegment[]
}

/** ASR 逐词时间戳 */
export interface WordTimestamp {
  word: string
  startMs: number
  endMs: number
}

/** 文本匹配结果 */
export interface TimestampPair {
  startMs: number
  endMs: number
}

// ============================================================================
// SRT 文本格式
// ============================================================================

/** SRT 序号 + 时间段行 */
function srtEntry(index: number, startMs: number, endMs: number): string {
  return `${index}\n${millisToSrtTime(startMs)} --> ${millisToSrtTime(endMs)}`
}

// ============================================================================
// 1. 完整 SRT 生成
// ============================================================================

/**
 * 将 ASR 识别结果转为 SRT 字幕文本。
 */
export function generateSrt(sentences: SrtSentence[]): string {
  const lines: string[] = []

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    let text = s.text
    if (s.speakerId) text = `[${s.speakerId}] ${text}`

    lines.push(srtEntry(i + 1, s.start, s.end))
    lines.push(text)
    lines.push("") // SRT 条目间空行
  }

  return lines.join("\n")
}

// ============================================================================
// 2. 裁剪窗口 SRT 生成（含边界处理 CASE0–CASE4）
// ============================================================================

/**
 * 为裁剪窗口生成 SRT 字幕。
 *
 * 借鉴 FunClip `generate_srt_clip()` 的边界处理逻辑，处理
 * 句子与裁剪窗口部分重叠的 4 种情况：
 *
 *   CASE0: 句子在裁剪窗口之前 → 跳过
 *   CASE1: 句子被裁剪窗口完全包含 → 保留，时间重新对齐
 *   CASE2: 句子跨过裁剪开始边界 → 截断句首 + 字幕从 0 开始
 *   CASE3: 句子跨过裁剪结束边界 → 截断句尾
 *   CASE4: 句子跨越整个裁剪窗口 → 同时截断句首句尾
 *
 * @param sentences  ASR 识别的完整句子列表
 * @param clipStartMs 裁剪窗口开始（毫秒）
 * @param clipEndMs   裁剪窗口结束（毫秒）
 */
export function generateSrtClip(
  sentences: SrtSentence[],
  clipStartMs: number,
  clipEndMs: number,
): SrtClipResult {
  const segments: SubtitleSegment[] = []
  let index = 0

  for (const s of sentences) {
    // CASE0: 句子完全在裁剪窗口之前
    if (s.end <= clipStartMs) continue

    // CASE0: 句子完全在裁剪窗口之后
    if (s.start >= clipEndMs) break

    let start = s.start
    let end = s.end

    // CASE2/4: 句子开始早于裁剪窗口 → 从裁剪起点开始
    if (start < clipStartMs) {
      start = clipStartMs
    }

    // CASE3/4: 句子结束晚于裁剪窗口 → 在裁剪终点结束
    if (end > clipEndMs) {
      end = clipEndMs
    }

    // CASE1: 完全包含 → 保留原边界

    segments.push({
      text: s.text,
      startMs: start - clipStartMs, // 重新对齐到 0
      endMs: end - clipStartMs,
      speakerId: s.speakerId,
    })
  }

  // 按新时间轴生成 SRT 文本
  const lines: string[] = []
  for (const seg of segments) {
    let text = seg.text
    if (seg.speakerId) text = `[${seg.speakerId}] ${text}`

    lines.push(srtEntry(++index, seg.startMs, seg.endMs))
    lines.push(text)
    lines.push("")
  }

  return { srt: lines.join("\n"), segments }
}

// ============================================================================
// 3. 文本→时间戳匹配
// ============================================================================

/**
 * 从 ASR 识别的原文中定位目标文本对应的音频时间戳。
 *
 * 借鉴 FunClip `proc()` (trans_utils.py:28-41) 的算法：
 * 在原文中滑动查找目标文本，通过空格计数将字符位置映射到词时间戳索引。
 *
 * @param rawText    ASR 识别原文（词间空格分隔，中文单字间有空格）
 * @param destText   要查找的目标文本
 * @param timestamps 每个字/词的时间戳数组（按原文顺序，毫秒）
 * @returns 所有匹配位置的时间范围
 */
export function matchTextToTimestamps(
  rawText: string,
  destText: string,
  timestamps: WordTimestamp[],
): TimestampPair[] {
  const results: TimestampPair[] = []
  let offset = 0

  while (true) {
    const foundIndex = rawText.indexOf(destText, offset)
    if (foundIndex === -1) break
    offset = foundIndex + destText.length

    // 前缀中的空格数 = 目标文本前的词索引
    const prefix = rawText.slice(0, foundIndex)
    const wordIndex = prefix.length === 0 ? 0 : prefix.split(" ").length - 1

    // 目标文本内的词数
    const wordsInTarget = destText.split(" ").filter(Boolean).length || destText.length
    const endWordIndex = Math.min(wordIndex + wordsInTarget - 1, timestamps.length - 1)

    const startTs = timestamps[wordIndex]
    const endTs = timestamps[endWordIndex]

    if (startTs && endTs) {
      results.push({
        startMs: startTs.startMs,
        endMs: endTs.endMs,
      })
    }
  }

  return results
}

/**
 * 将非空格分隔的中文文本转换为空格分隔的格式，
 * 对齐 FunASR 的输出格式。
 *
 * 借鉴 FunClip `pre_proc()` (trans_utils.py:12-26)：
 * - 去除常见标点符号
 * - 在中文/英文/数字之间插入空格
 */
export function normalizeForMatching(text: string): string {
  return (
    text
      // 去除标点
      .replace(/[，。！？、；：""（）《》【】\.,!\?;:'"()\[\]{}<>]/g, " ")
      // 在中文字符前后插入空格（与英文/数字分隔）
      .replace(/([一-鿿])([a-zA-Z0-9])/g, "$1 $2")
      .replace(/([a-zA-Z0-9])([一-鿿])/g, "$1 $2")
      // 合并多个空格
      .replace(/\s+/g, " ")
      .trim()
  )
}

/**
 * Phase 2 测试 — fuzzy-match.ts
 *
 * 覆盖 8 级代码匹配 + 文本语义匹配。
 *
 * @license MIT
 */

import assert from "node:assert/strict"
import { before, describe, it } from "node:test"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fm: any

before(async () => {
  fm = await import("../fuzzy-match.js")
})

// ============================================================================
// 8 级代码块匹配
// ============================================================================

describe("fuzzyMatchCodeBlocks — 8 级代码匹配", () => {
  it("Level 1: exact match", () => {
    const r = fm.fuzzyMatchCodeBlocks(
      "-i input.mp4 -c:v libx264",
      "-i input.mp4 -c:v libx264",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 1)
    assert.equal(r.score, 1.0)
  })

  it("Level 2: case-insensitive", () => {
    const r = fm.fuzzyMatchCodeBlocks(
      "-I INPUT.MP4 -C:LIBX264",
      "-i input.mp4 -c:libx264",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 2)
  })

  it("Level 3: whitespace-normalized", () => {
    const r = fm.fuzzyMatchCodeBlocks(
      "  -i   input.mp4   -c:v   libx264  ",
      "-i input.mp4 -c:v libx264",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 3)
  })

  it("Level 4: only punctuation differs", () => {
    // 只有标点不同（逗号 vs 句点）
    const r = fm.fuzzyMatchCodeBlocks(
      "input.mp4 output.mp4",
      "input,mp4 output,mp4",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 4)
  })

  it("Level 5: number-normalized", () => {
    // 只有数字不同，且数字有清晰的 \b 边界
    const r = fm.fuzzyMatchCodeBlocks("-ss 30000 -t 100", "-ss 0 -t 0")
    assert.equal(r.matched, true)
    assert.equal(r.level, 5)
  })

  it("Level 6: variable-normalized", () => {
    // input.mp4 / output.mp4 都被归一化为 VAR
    const r = fm.fuzzyMatchCodeBlocks(
      "-i input.mp4 -c:v libx264 output.mp4",
      "-i output.mp4 -c:v libx264 input.mp4",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 6)
  })

  it("Level 7: token-subsequence (Jaccard >= 0.6)", () => {
    // 共享 5/7 的 token → Jaccard avg ≈ 0.71
    const r = fm.fuzzyMatchCodeBlocks(
      "ffmpeg scale width height filter lanczos",
      "ffmpeg scale width height filter bicubic",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 7)
    assert.ok(r.score >= 0.6)
  })

  it("Level 8: context-aware fallback (lower overlap)", () => {
    // 只共享 3/7 的 token，不足以触发 Level 7（< 0.6），但长度比和 token 数够 Level 8
    const r = fm.fuzzyMatchCodeBlocks(
      "video filter scale width mode flags lanczos",
      "audio filter volume rate mode flags mp3codec",
    )
    assert.equal(r.matched, true)
    assert.equal(r.level, 8)
  })

  it("not matched: completely different content", () => {
    const r = fm.fuzzyMatchCodeBlocks(
      "apple banana cherry",
      "ffmpeg -i input.mp4",
    )
    assert.equal(r.matched, false)
    assert.equal(r.level, 0)
  })

  it("not matched: empty input", () => {
    const r = fm.fuzzyMatchCodeBlocks("", "ffmpeg command")
    assert.equal(r.matched, false)
    assert.equal(r.level, 0)
    assert.equal(r.score, 0)
  })
})

// ============================================================================
// 文本语义匹配
// ============================================================================

describe("fuzzyMatchText — 文本语义匹配", () => {
  it("identical text matches", async () => {
    const r = await fm.fuzzyMatchText(
      "给视频添加复古胶片风格",
      "给视频添加复古胶片风格",
    )
    assert.equal(r, true)
  })

  it("high similarity at threshold 0.7", async () => {
    const r = await fm.fuzzyMatchText(
      "复古胶片风格调色效果",
      "复古胶片风格调色效果+颗粒",
    )
    assert.equal(r, true)
  })

  it("unrelated text does not match", async () => {
    const r = await fm.fuzzyMatchText(
      "给视频添加复古胶片风格",
      "视频裁剪和拼接操作",
    )
    assert.equal(r, false)
  })

  it("custom threshold works", async () => {
    const r1 = await fm.fuzzyMatchText("添加字幕", "添加水印", 0.1)
    assert.equal(r1, true)
    const r2 = await fm.fuzzyMatchText("添加字幕", "添加水印", 0.9)
    assert.equal(r2, false)
  })
})

// ============================================================================
// 文本列表相似度搜索
// ============================================================================

describe("findSimilarSkillsByText — 文本列表搜索", () => {
  it("empty list returns empty", async () => {
    const r = await fm.findSimilarSkillsByText("test", [])
    assert.deepEqual(r, [])
  })

  it("finds matching item by description similarity", async () => {
    const descs = [
      "裁剪视频到指定尺寸",
      "添加复古胶片风格色彩调整颗粒暗角效果",
      "视频拼接多个片段",
    ]
    const r = await fm.findSimilarSkillsByText(
      "添加复古胶片风格色彩调整噪点暗角效果",
      descs,
    )
    assert.ok(r.length > 0, "should find a match")
    assert.equal(r[0].index, 1)
  })

  it("unrelated text does not match any", async () => {
    const descs = ["裁剪视频", "拼接视频", "调整速度"]
    const r = await fm.findSimilarSkillsByText("给视频添加字幕", descs)
    assert.deepEqual(r, [])
  })
})

// ============================================================================
// fuzzyFindAndReplace — 模糊查找替换
// ============================================================================

describe("fuzzyFindAndReplace — 模糊查找替换", () => {
  it("Level 1: exact match — direct replace", () => {
    const r = fm.fuzzyFindAndReplace(
      "ffmpeg -i input.mp4 output.mp4",
      "input.mp4",
      "source.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 1)
    assert.equal(r.result, "ffmpeg -i source.mp4 output.mp4")
  })

  it("Level 2: case-insensitive match", () => {
    const r = fm.fuzzyFindAndReplace(
      "ffmpeg -i INPUT.MP4 output.mp4",
      "input.mp4",
      "source.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 2)
    assert.equal(r.result, "ffmpeg -i source.mp4 output.mp4")
  })

  it("Level 3: whitespace-normalized (tabs vs spaces)", () => {
    // Tab-to-space normalization via _normWsChar works char-by-char
    const r = fm.fuzzyFindAndReplace(
      "ffmpeg\t-i\tinput.mp4\toutput.mp4",
      "ffmpeg -i input.mp4 output.mp4",
      "ffmpeg -i source.mp4 dest.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 3)
  })

  it("Level 4: punctuation-stripped", () => {
    // = → space, : → space, - → space: _normPunctChar maps identically
    const r = fm.fuzzyFindAndReplace(
      "scale=1280:720",
      "scale=1280-720",
      "scale=1920:1080",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 4)
  })

  it("Level 5: number-normalized", () => {
    const r = fm.fuzzyFindAndReplace(
      "-ss 30000 -t 100",
      "-ss 0 -t 0",
      "-ss 10000 -t 30",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 5)
  })

  it("Level 6: variable-normalized", () => {
    const r = fm.fuzzyFindAndReplace(
      "-i input.mp4 -c:v libx264 output.mp4",
      "-i output.mp4 -c:v libx264 input.mp4",
      "-i source.mp4 -c:v libx265 dest.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.matchLevel, 6)
  })

  it("no match — empty needle", () => {
    const r = fm.fuzzyFindAndReplace("content", "", "replacement")
    assert.equal(r.replaced, false)
    assert.equal(r.matchLevel, 0)
  })

  it("no match — empty content", () => {
    const r = fm.fuzzyFindAndReplace("", "needle", "replacement")
    assert.equal(r.replaced, false)
    assert.equal(r.matchLevel, 0)
  })

  it("no match — completely different content", () => {
    const r = fm.fuzzyFindAndReplace(
      "apple banana cherry",
      "ffmpeg command",
      "replacement",
    )
    assert.equal(r.replaced, false)
    assert.equal(r.matchLevel, 0)
  })

  it("multiple occurrences — replaces first match only", () => {
    const r = fm.fuzzyFindAndReplace(
      "input.mp4 and input.mp4",
      "input.mp4",
      "source.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.result, "source.mp4 and input.mp4")
  })

  it("replace across lines", () => {
    const r = fm.fuzzyFindAndReplace(
      "line1\ninput.mp4\nline3",
      "input.mp4",
      "source.mp4",
    )
    assert.equal(r.replaced, true)
    assert.equal(r.result, "line1\nsource.mp4\nline3")
  })
})

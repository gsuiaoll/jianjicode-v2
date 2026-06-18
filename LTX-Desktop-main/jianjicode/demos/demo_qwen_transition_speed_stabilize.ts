#!/usr/bin/env tsx
/**
 * 千问调度 jianjicode — 转场 + 变速 + 防抖 综合测试
 *
 * 测试目标：验证 Qwen 能否流畅调用这三个精剪工具
 *   - video_transition (30+ 种转场)
 *   - video_speed       (变速)
 *   - video_stabilization (防抖)
 */

import { processChatRequest } from "../src/core/chat-core.js"

const VIDEO = "D:/code/jianjicode-5/tests/13421377767745425.mp4"
const OUTPUT = "D:/code/jianjicode-5/tests/outputs/transition_speed_stable.mp4"

const prompt = `我要你处理这个视频：${VIDEO}

请按以下步骤操作，每步完成后汇报结果：

## 第 1 步：先观看原片
用你的多模态视觉看完整段视频，告诉我你看到了什么场景、哪里适合切分。

## 第 2 步：粗剪 — 选取 3 段精彩片段
从视频中裁剪 3 段，每段 3-6 秒：
- 片段 1：选一个精彩的开场
- 片段 2：选中间最有趣的片段
- 片段 3：选一个有力的结尾

用 ffmpeg trim 操作分别裁剪，输出到 tests/outputs/clip_a.mp4, clip_b.mp4, clip_c.mp4。allow_overwrite=true

## 第 3 步：变速 — 给片段 2 做慢动作
对 clip_b.mp4 做慢动作处理 (0.5x 速度)，输出到 tests/outputs/clip_b_slow.mp4。用 video_speed 工具，adjust_audio=true, preserve_pitch=true。allow_overwrite=true

## 第 4 步：转场拼接
用 video_transition 工具依次拼接三个片段（clip_a + clip_b_slow + clip_c），每段之间用不同的转场效果：
- 第一到第二段：slide_left（向左滑动），duration=1.0
- 第二到第三段：fade_black（黑场过渡），duration=1.2
audio_transition=crossfade

用 ffmpeg concat_videos 最终拼接，输出到 tests/outputs/clips_merged.mp4。allow_overwrite=true

注意：video_transition 每次只能处理两个视频，你需要：先拼接 clip_a + clip_b_slow → 中间产物，再拼接 中间产物 + clip_c → 最终产物。

## 第 5 步：防抖
对拼接后的视频应用视频稳定，strength=60, smoothing=15，输出到 ${OUTPUT}。用 video_stabilization 工具。allow_overwrite=true

## 注意事项
- 请在粗剪完成后调用 set_edit_phase 切换到精剪阶段
- 每一步的输出必须作为下一步的输入
- 所有中间文件和最终输出都放到 tests/outputs/ 下
- allow_overwrite=true 用于覆盖已有文件`

console.log("=".repeat(60))
console.log("千问调度 jianjicode — 转场 + 变速 + 防抖")
console.log("=".repeat(60))
console.log(`视频: ${VIDEO}`)
console.log(`输出: ${OUTPUT}`)
console.log("")

const startTime = Date.now()

const result = await processChatRequest(
  prompt,
  {
    verbose: true,
    maxSteps: 16,
    maxTokens: 16000,
    model: "qwen-plus",
  },
  {
    onLog: (msg: string) => {
      if (msg.includes("[core]") || msg.includes("Step") || msg.includes("tool") || msg.includes("phase")) {
        console.log(`  📝 ${msg}`)
      }
    },
    onProgress: (stage: string, msg?: string) => {
      console.log(`  ⏳ ${stage}: ${msg || ""}`)
    },
    onStream: (event: any) => {
      switch (event.type) {
        case "step-start":
          console.log(`\n--- Step ${event.step} ---`)
          break
        case "text-delta":
          process.stdout.write(event.delta || "")
          break
        case "text-end":
          console.log("")
          break
        case "tool-start":
          console.log(`\n  🔧 调用工具: ${event.toolName}`)
          break
        case "tool-end":
          console.log(`  ✅ 工具完成: ${event.toolName}`)
          break
        case "tool-error":
          console.log(`  ❌ 工具错误: ${event.toolName} — ${event.error}`)
          break
        case "step-end":
          console.log(`  🏁 步骤结束: ${event.finishReason}`)
          break
      }
    },
    onStep: (step: any) => {
      console.log(`  📊 Step ${step.stepNumber}: finishReason=${step.finishReason}, toolCalls=${step.toolCalls?.length || 0}`)
      if (step.toolCalls?.length > 0) {
        for (const tc of step.toolCalls) {
          const argsStr = JSON.stringify(tc.args)?.slice(0, 200)
          console.log(`     🔨 ${tc.toolName}(${argsStr}...)`)
          if (tc.result) {
            const ok = !tc.result.metadata?.error
            console.log(`     ${ok ? "✅" : "❌"} 结果: ${tc.result.title || tc.result.output?.slice(0, 150)}`)
          }
        }
      }
    },
  },
)

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

console.log("\n" + "=".repeat(60))
console.log("结果")
console.log("=".repeat(60))
console.log(`耗时: ${elapsed}s`)
console.log(`成功: ${result.success}`)
const resAny = result as any
console.log(`总步数: ${resAny.totalSteps || "?"}`)
if (resAny.toolCalls?.length) {
  console.log(`总工具调用: ${resAny.toolCalls.length}`)
  for (const tc of resAny.toolCalls) {
    console.log(`  - ${tc.toolName}: ${tc.result?.title || "无结果"}`)
  }
}
console.log(`AI 回复:\n${resAny.content?.slice(0, 800) || "(无)"}`)
if (result.usage) {
  console.log(`Token: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion`)
}

#!/usr/bin/env tsx
/**
 * 千问多模态调度 jianjicode 工具 — 视频剪辑演示
 * 视频路径直接传给千问，不需要本地抽帧
 */

import { processChatRequest } from "../src/core/chat-core.js"

const VIDEO = "D:/code/jianjicode-5/tests/13421377767745425.mp4"
const MUSIC = "D:/code/jianjicode-5/music/1200可商用纯音乐/卡点-节奏/Powerful-Trap-.mp3"
const OUTPUT = "D:/code/jianjicode-5/tests/outputs/dynamic_30s.mp4"

const prompt = `帮我把这个视频处理一下：${VIDEO}

要求：
1. 给视频调色，让画面更有电影感
2. 把原来的背景音乐去掉，换成这个动感音乐：${MUSIC}
3. 检测视频中的场景变化，挑选最精彩的5-6个片段，拼接成一个30秒左右的动感短片，输出到 ${OUTPUT}
4. 剪辑的切换节奏要卡上背景音乐的重拍

请逐步执行，每步确认结果。allow_overwrite=true`

console.log("=".repeat(60))
console.log("千问多模态调度 jianjicode 工具 — 视频剪辑")
console.log("=".repeat(60))
console.log(`视频: ${VIDEO}`)
console.log(`音乐: ${MUSIC}`)
console.log(`输出: ${OUTPUT}`)
console.log("")

const startTime = Date.now()

const result = await processChatRequest(
  prompt,
  {
    verbose: true,
    maxSteps: 12,
    maxTokens: 12000,
  },
  {
    onLog: (msg: string) => {
      if (msg.includes("[core]") || msg.includes("Step") || msg.includes("tool")) {
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
          const argsStr = JSON.stringify(tc.args)?.slice(0, 150)
          console.log(`     🔨 ${tc.toolName}(${argsStr}...)`)
          if (tc.result) {
            const ok = !tc.result.metadata?.error
            console.log(`     ${ok ? "✅" : "❌"} 结果: ${tc.result.title || tc.result.output?.slice(0, 100)}`)
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
console.log(`成功: ${result.success}`)
const resAny = result as any
console.log(`总步数: ${resAny.totalSteps || "?"}`)
if (resAny.toolCalls?.length) {
  console.log(`总工具调用: ${resAny.toolCalls.length}`)
  for (const tc of resAny.toolCalls) {
    console.log(`  - ${tc.toolName}: ${tc.result?.title || "无结果"}`)
  }
}
console.log(`AI 回复:\n${resAny.content?.slice(0, 500) || "(无)"}`)
if (result.usage) {
  console.log(`Token: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion`)
}

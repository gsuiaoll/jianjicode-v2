#!/usr/bin/env tsx
/**
 * qwen-plus 接力 — 从 omni-flash 的视频分析继续剪完
 *
 * c1.mp4 (0-4s) 和 c2.mp4 (7-13s) 已裁好，继续：
 * 裁 c3 → 变速 → 转场 → 最终输出
 */

import { processChatRequest } from "../src/core/chat-core.js"

const VIDEO = "D:/code/jianjicode-5/tests/13421377767745425.mp4"
const OUTPUT = "D:/code/jianjicode-5/tests/outputs/fast_cut_final.mp4"

const prompt = `你是短视频剪辑师。之前的同事已经帮你分析好了这个视频的内容：

视频: ${VIDEO}

## 视频场景时间轴（已分析好）
- 0-4s：青蛙老师在解剖课上讲解青蛙结构，表情严肃
- 4-7s：镜头切换到学生，蓝衣卫衣青蛙（Pepe）做实验，表情忧郁
- 7-13s：特写蓝衣卫衣青蛙的脸，眼泪汪汪，非常伤感
- 13-16s：老师继续讲课，表情冷漠
- 16-21s：蓝衣卫衣青蛙突然站起来，脱下衣服，露出惊讶表情
- 21-24s：场景转换到户外，两个青蛙在树林里对话
- 24-30s：发光的蓝色幽灵青蛙从鸟巢中拿出小鸟
- 30-35s：蓝色幽灵展示受伤小鸟，表情悲伤
- 35-44s：绿色青蛙与蓝色幽灵拥抱，情感交流
- 44-51s：结尾，蓝衣卫衣青蛙坐在地上哭泣，粉色蝴蝶飞来安慰

## 已完成的片段
- c1.mp4 = 0-4s（开场冲击力）✅ 已在 D:/code/jianjicode-5/jianjicode/tests/outputs/c1.mp4
- c2.mp4 = 7-13s（中间高潮）✅ 已在 D:/code/jianjicode-5/jianjicode/tests/outputs/c2.mp4

## 第 1 步：裁最后一段

裁剪 c3 = 44-51s（蝴蝶安慰哭泣青蛙结尾），输出 D:/code/jianjicode-5/jianjicode/tests/outputs/c3.mp4。用 ffmpeg trim，allow_overwrite=true。

## 第 2 步：变速

用 video_speed 工具：
- D:/code/jianjicode-5/jianjicode/tests/outputs/c1.mp4 加速 1.5x → D:/code/jianjicode-5/jianjicode/tests/outputs/s1.mp4
- D:/code/jianjicode-5/jianjicode/tests/outputs/c2.mp4 慢放 0.6x → D:/code/jianjicode-5/jianjicode/tests/outputs/s2.mp4
- D:/code/jianjicode-5/jianjicode/tests/outputs/c3.mp4 加速 1.3x → D:/code/jianjicode-5/jianjicode/tests/outputs/s3.mp4

全部 allow_overwrite=true, adjust_audio=true, preserve_pitch=true。

## 第 3 步：转场拼接

用 video_transition 链式拼接（每次两个视频），audio_transition=crossfade，allow_overwrite=true：
- 先拼 s1.mp4 + s2.mp4，slide_left，duration=0.6 → D:/code/jianjicode-5/jianjicode/tests/outputs/m1.mp4
- 再拼 m1.mp4 + s3.mp4，fade_black，duration=0.5 → 最终 ${OUTPUT}

## 重要
- video_transition 每次只能处理两个视频，必须分两次链式调用
- 所有 allow_overwrite=true`

console.log("=".repeat(60))
console.log("qwen-plus 接力快剪")
console.log("=".repeat(60))

const startTime = Date.now()

const result = await processChatRequest(
  prompt,
  {
    verbose: true,
    maxSteps: 12,
    maxTokens: 12000,
    model: "qwen-plus",
  },
  {
    onLog: (msg: string) => {
      if (msg.includes("[core]") || msg.includes("Step") || msg.includes("tool") || msg.includes("dashscope")) {
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
if (resAny.toolCalls?.length) {
  console.log(`总工具调用: ${resAny.toolCalls.length}`)
  for (const tc of resAny.toolCalls) {
    console.log(`  - ${tc.toolName}: ${tc.result?.title || "无结果"}`)
  }
}
console.log(`AI 回复片段:\n${resAny.content?.slice(0, 500) || "(无)"}`)

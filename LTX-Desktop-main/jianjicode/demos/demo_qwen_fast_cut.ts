#!/usr/bin/env tsx
/**
 * 千问调度 jianjicode — 短视频快剪（变速 + 转场）
 *
 * v2: 结构化场景输出 + 工具调用模板 + 强约束话术
 * 让 qwen3.5-omni-flash 端到端完成：看视频 → 决策 → 调工具 → 输出
 */

import { processChatRequest } from "../src/core/chat-core.js"

const VIDEO = "D:/code/jianjicode-5/tests/13421377767745425.mp4"
const OUT_DIR = "D:/code/jianjicode-5/jianjicode/tests/outputs"
const OUTPUT = `${OUT_DIR}/fast_cut_final.mp4`

const prompt = `视频文件: ${VIDEO}

你是短视频剪辑师。你将收到一个视频文件，用多模态视觉完整观察它，然后按以下流程完成快节奏短视频剪辑。

---
## 阶段 1：观察视频 + 输出场景时间轴

仔细观看整个视频，识别出所有场景切换和精彩片段。

⚠️ 强制规则：必须严格按以下格式输出场景时间轴，每条一行，禁止使用 markdown 表格、代码块、JSON 等其他格式。start_sec 和 end_sec 是秒数（数字），不是帧序号。

格式示例（3 个场景的示范）：
|0|5|开场镜头，教室场景，人物出场
|5|12|核心片段，对话或动作高潮
|12|20|收尾镜头，转场或结尾画面

你必须输出完整的场景时间轴（至少 5 条），这是后续剪辑的唯一依据。

---
## 阶段 2：粗剪 — 挑 3 段最精彩片段

基于阶段 1 的分析，选出 3 段最精彩的 3-7 秒片段：开场冲击力强的、中间最精彩的、收尾有力的。

⚠️ 强制规则：必须严格按下方 JSON 模板调用 ffmpeg 工具。start_time/end_time 单位是秒，禁止使用帧序号或 inline filter 语法（如 trim=start=X:end=Y）。command 字段必填，禁止遗漏。

ffmpeg trim 调用模板（裁 c1，开场冲击）：
{"command":"裁剪开场片段","operation":"trim","input":"${VIDEO}","output":"${OUT_DIR}/c1.mp4","start_time":"0","end_time":"5","allow_overwrite":true}

ffmpeg trim 调用模板（裁 c2，中间高潮）：
{"command":"裁剪中间片段","operation":"trim","input":"${VIDEO}","output":"${OUT_DIR}/c2.mp4","start_time":"5","end_time":"12","allow_overwrite":true}

ffmpeg trim 调用模板（裁 c3，收尾）：
{"command":"裁剪结尾片段","operation":"trim","input":"${VIDEO}","output":"${OUT_DIR}/c3.mp4","start_time":"12","end_time":"20","allow_overwrite":true}

把 start_time/end_time 替换成你从阶段 1 场景时间轴中选取的实际秒数。

---
## 阶段 3：变速处理

对三个片段分别变速，制造快慢节奏对比。

⚠️ 强制规则：必须严格按下方 JSON 模板调用 video_speed 工具。禁止修改参数名。speed 是数字（不是字符串），allow_overwrite 必须是 true。

video_speed 调用模板（c1 加速 1.5x）：
{"input":"${OUT_DIR}/c1.mp4","output":"${OUT_DIR}/s1.mp4","speed":1.5,"adjust_audio":true,"preserve_pitch":true,"allow_overwrite":true}

video_speed 调用模板（c2 慢放 0.6x）：
{"input":"${OUT_DIR}/c2.mp4","output":"${OUT_DIR}/s2.mp4","speed":0.6,"adjust_audio":true,"preserve_pitch":true,"allow_overwrite":true}

video_speed 调用模板（c3 加速 1.3x）：
{"input":"${OUT_DIR}/c3.mp4","output":"${OUT_DIR}/s3.mp4","speed":1.3,"adjust_audio":true,"preserve_pitch":true,"allow_overwrite":true}

---
## 阶段 4：转场拼接（链式，每次两个视频）

⚠️ 强制规则：video_transition 每次只能处理两个视频，必须分两次链式调用。必须严格按下方 JSON 模板调用，禁止修改参数名。transition_type 从枚举值中选择，duration 是数字。

第一次转场（s1 + s2，用 slide_left）：
{"input1":"${OUT_DIR}/s1.mp4","input2":"${OUT_DIR}/s2.mp4","output":"${OUT_DIR}/m1.mp4","transition_type":"slide_left","duration":0.6,"audio_transition":"crossfade","allow_overwrite":true}

第二次转场（m1 + s3，用 fade_black，输出最终视频）：
{"input1":"${OUT_DIR}/m1.mp4","input2":"${OUT_DIR}/s3.mp4","output":"${OUTPUT}","transition_type":"fade_black","duration":0.5,"audio_transition":"crossfade","allow_overwrite":true}

---
## 全局强制规则

⚠️ 以下规则违反任何一条都会导致输出不可用：

1. 阶段 1 的场景时间轴必须用 |start_sec|end_sec|描述| 格式，禁止 markdown 表格/代码块/JSON
2. 所有工具的 command 字段（ffmpeg）为必填项，禁止遗漏
3. start_time/end_time 单位是秒，不是帧序号。44 秒就是 "44"，不要写成帧数
4. 所有 JSON 参数名必须与模板完全一致，禁止自行发明拼写或缩写
5. 每个工具调用都必须带 allow_overwrite: true
6. video_transition 每次只能传两个视频，禁止一次性传 3 个
7. 严格按 阶段1→2→3→4 顺序执行，不要在步骤间插入无意义的"确认"步骤`

console.log("=".repeat(60))
console.log("千问快剪 v2 — 结构化场景输出 + 工具模板")
console.log("=".repeat(60))
console.log(`视频: ${VIDEO}`)
console.log(`模型: qwen3.5-omni-flash`)
console.log("")

const startTime = Date.now()

const result = await processChatRequest(
  prompt,
  {
    verbose: true,
    maxSteps: 15,
    maxTokens: 16000,
    model: "qwen3.5-omni-flash",
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
console.log(`总步数: ${resAny.totalSteps || "?"}`)
if (resAny.toolCalls?.length) {
  console.log(`总工具调用: ${resAny.toolCalls.length}`)
  for (const tc of resAny.toolCalls) {
    console.log(`  - ${tc.toolName}: ${tc.result?.title || "无结果"}`)
  }
}
console.log(`AI 回复前 500 字符:\n${resAny.content?.slice(0, 500) || "(无)"}`)
if (result.usage) {
  console.log(`Token: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion`)
}

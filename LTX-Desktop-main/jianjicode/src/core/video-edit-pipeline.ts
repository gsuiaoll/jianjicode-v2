import { createToolContext } from "./chat-session.js"
import { getToolState } from "./tool-state.js"
import { toolRegistry } from "../registry/tool_registry.js"

// ============================================================================
// video-edit-pipeline — 代码层 5 步视频剪辑管道
//
// 对应 OpenCode 的 "Tool Chain" 模式：
// 管道在代码层串联工具调用，中间数据通过文件系统 + ToolState 传递，
// 不需要模型在对话步骤间手动传递文件路径和参数。
//
// 5 步管道：调色 → BGM → 场景时间戳注入 → trim × N → concat
// ============================================================================

interface PipelineStep {
  name: string
  tool: string
  params: Record<string, any>
}

interface PipelineResult {
  success: boolean
  outputs: string[]
  finalOutput?: string
  error?: string
}

interface SceneTimestamp {
  start: string
  end: string
  desc: string
}

/**
 * 执行完整的 5 步视频剪辑管道。
 *
 * 从 ToolState 读取 Step 1 分析出的场景时间戳，
 * 依次执行调色、BGM、trim、concat，中间结果写入 ToolState 供后续调试。
 */
export async function runVideoEditPipeline(
  sessionId: string,
  inputVideo: string,
  bgmAudio: string,
  outputVideo: string,
  steps?: PipelineStep[],
): Promise<PipelineResult> {
  const toolState = getToolState(sessionId)
  const outputs: string[] = []

  // 如果没有显式传入 steps，使用默认 5 步管道
  const pipeline: PipelineStep[] = steps || [
    {
      name: "调色",
      tool: "lut_filter",
      params: {
        input: inputVideo,
        preset: "cinematic",
        intensity: 85,
      },
    },
    {
      name: "BGM",
      tool: "ffmpeg",
      params: {
        operation: "merge_audio",
        input: "${colored_output}",
        audio_file: bgmAudio,
        bgm_volume: 3.0,
        output: "${with_bgm_output}",
      },
    },
    {
      name: "trim",
      tool: "ffmpeg",
      // params 在运行时从 ToolState 动态填充
      params: {},
    },
    {
      name: "concat",
      tool: "ffmpeg",
      // params 在运行时从 trim 结果动态填充
      params: {},
    },
  ]

  // 为 output 路径生成时间戳后缀避免冲突
  const ts = Date.now()
  const baseDir = inputVideo.split("/").slice(0, -1).join("/") || "."

  let currentInput = inputVideo

  for (let i = 0; i < pipeline.length; i++) {
    const step = pipeline[i]
    console.log(`[pipeline] Step ${i + 1}/${pipeline.length}: ${step.name} (${step.tool})`)

    const tool = await toolRegistry.getInitializedTool(step.tool)
    if (!tool) {
      return {
        success: false,
        outputs,
        error: `Tool "${step.tool}" not found in registry. Ensure it is registered before running the pipeline.`,
      }
    }

    const ctx = createToolContext(sessionId, `pipeline-step-${i + 1}`)

    try {
      let params = { ...step.params }

      // Step 1: 调色 — 输入原始视频，输出 colored.mp4
      if (step.name === "调色") {
        const coloredOutput = `${baseDir}/colored_${ts}.mp4`
        params = {
          ...params,
          input: currentInput,
          output: coloredOutput,
        }
        const result = await tool.execute(params, ctx)
        if (result.metadata?.error) {
          return { success: false, outputs, error: `调色失败: ${result.output}` }
        }
        outputs.push(coloredOutput)
        currentInput = coloredOutput
        toolState.set("pipeline", "coloredOutput", coloredOutput)
        console.log(`[pipeline] 调色完成 → ${coloredOutput}`)
        continue
      }

      // Step 2: BGM — 输入调色后视频 + 音频，输出 with_bgm.mp4
      if (step.name === "BGM") {
        const withBgmOutput = `${baseDir}/with_bgm_${ts}.mp4`
        params = {
          operation: "merge_audio",
          input: currentInput,
          audio_file: bgmAudio,
          bgm_volume: 3.0,
          output: withBgmOutput,
        }
        const result = await tool.execute(params, ctx)
        if (result.metadata?.error) {
          return { success: false, outputs, error: `BGM合并失败: ${result.output}` }
        }
        outputs.push(withBgmOutput)
        currentInput = withBgmOutput
        toolState.set("pipeline", "bgmOutput", withBgmOutput)
        console.log(`[pipeline] BGM合并完成 → ${withBgmOutput}`)
        continue
      }

      // Step 3: Trim × N — 从 ToolState 读取场景时间戳，逐一裁剪
      if (step.name === "trim") {
        const timestamps = toolState.get<SceneTimestamp[]>("vision", "timestamps")
        if (!timestamps || timestamps.length === 0) {
          return {
            success: false,
            outputs,
            error: "No scene timestamps in ToolState.vision.timestamps. Ensure extractVideoAnalysis was called first.",
          }
        }

        // 只使用有时间戳的场景
        const validScenes = timestamps.filter((s) => s.start && s.end)
        if (validScenes.length === 0) {
          return { success: false, outputs, error: "No valid timestamps (with start/end) found in ToolState." }
        }

        const clipFiles: string[] = []
        for (let j = 0; j < validScenes.length; j++) {
          const scene = validScenes[j]
          const clipPath = `${baseDir}/clip_${j + 1}_${ts}.mp4`
          const trimResult = await tool.execute(
            {
              operation: "trim",
              command: `trim from ${scene.start} to ${scene.end}`,
              input: currentInput,
              output: clipPath,
              start_time: scene.start,
              end_time: scene.end,
            },
            ctx,
          )
          if (trimResult.metadata?.error) {
            return {
              success: false,
              outputs,
              error: `Trim 场景${j + 1} (${scene.start}-${scene.end}) 失败: ${trimResult.output}`,
            }
          }
          clipFiles.push(clipPath)
          console.log(`[pipeline] Trim 场景${j + 1}: ${scene.start}-${scene.end} → ${clipPath}`)
        }
        outputs.push(...clipFiles)
        toolState.set("pipeline", "clipFiles", clipFiles)
        toolState.set("pipeline", "trimCount", clipFiles.length)
        continue
      }

      // Step 4: Concat — 拼接所有 clip 文件
      if (step.name === "concat") {
        const clipFiles = toolState.get<string[]>("pipeline", "clipFiles")
        if (!clipFiles || clipFiles.length < 2) {
          return {
            success: false,
            outputs,
            error: `Concat requires at least 2 clip files, got ${clipFiles?.length || 0}.`,
          }
        }
        const concatResult = await tool.execute(
          {
            operation: "concat",
            command: `concat videos`,
            input: clipFiles.join(","),
            output: outputVideo,
          },
          ctx,
        )
        if (concatResult.metadata?.error) {
          return {
            success: false,
            outputs,
            error: `Concat 失败: ${concatResult.output}`,
          }
        }
        outputs.push(outputVideo)
        toolState.set("pipeline", "finalOutput", outputVideo)
        console.log(`[pipeline] Concat 完成 → ${outputVideo}`)
        continue
      }

      // 默认执行
      const result = await tool.execute(params, ctx)
      if (result.metadata?.error) {
        return { success: false, outputs, error: `${step.name} 失败: ${result.output}` }
      }
      // 尝试从 result 中提取输出路径
      const outPath = result.metadata?.outputPath || result.metadata?.output_path
      if (outPath) {
        outputs.push(outPath as string)
        currentInput = outPath as string
      }
    } catch (error: any) {
      return {
        success: false,
        outputs,
        error: `${step.name} 异常: ${error.message}`,
      }
    }
  }

  return {
    success: true,
    outputs,
    finalOutput:
      outputs[outputs.length - 1] || (toolState.get("pipeline", "finalOutput") as string),
  }
}

/**
 * 从 ToolState 读取管道进度信息。
 */
export function getPipelineProgress(sessionId: string): {
  coloredOutput?: string
  bgmOutput?: string
  clipFiles?: string[]
  trimCount?: number
  finalOutput?: string
  currentStep?: string
} {
  const toolState = getToolState(sessionId)
  return {
    coloredOutput: toolState.get("pipeline", "coloredOutput"),
    bgmOutput: toolState.get("pipeline", "bgmOutput"),
    clipFiles: toolState.get("pipeline", "clipFiles"),
    trimCount: toolState.get("pipeline", "trimCount"),
    finalOutput: toolState.get("pipeline", "finalOutput"),
    currentStep: toolState.get("pipeline", "currentStep"),
  }
}

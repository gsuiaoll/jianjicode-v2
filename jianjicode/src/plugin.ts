/**
 * jianjicode OpenCode 插件入口
 *
 * 将所有视频编辑工具注册为 OpenCode plugin tools。
 * 工具定义在 src/tools/ 下，适配层在 src/lib/。
 */
import type { Plugin, PluginInput, ToolDefinition } from "@opencode-ai/plugin"

// ============================================================================
// 工具适配：jianjicode Tool.Info → OpenCode ToolDefinition
// ============================================================================

import type { Tool } from "./lib/tool.js"

async function adaptTool(info: Tool.Info): Promise<[string, ToolDefinition]> {
  const impl = await info.init()
  return [
    info.id,
    {
      description: impl.description,
      args: (impl.parameters as any)._def?.shape?.() ?? (impl.parameters as any).shape ?? {},
      async execute(args: Record<string, unknown>, ctx: any) {
        try {
          const result = await impl.execute(args, {
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            agent: ctx.agent,
            abort: ctx.abort,
            messages: [],
            metadata: ctx.metadata?.bind?.(ctx) ?? (() => {}),
            ask: ctx.ask?.bind?.(ctx) ?? (() => Promise.resolve()),
          })
          return {
            title: result.title,
            output: result.output,
            metadata: result.metadata,
            attachments: result.attachments,
          }
        } catch (err) {
          return {
            output: `Tool ${info.id} failed: ${(err as Error).message}`,
            metadata: { error: true },
          }
        }
      },
    } as ToolDefinition,
  ]
}

// ============================================================================
// 插件工厂
// ============================================================================

const jianjicodePlugin: Plugin = async (_input: PluginInput) => {
  const tools: Record<string, ToolDefinition> = {}

  // ── 视频工具 ──
  const videoToolImports = [
    { mod: () => import("./tools/video/trim.js"), name: "TrimVideoTool" },
    { mod: () => import("./tools/video/concat.js"), name: "ConcatVideosTool" },
    { mod: () => import("./tools/video/convert.js"), name: "ConvertVideoTool" },
    { mod: () => import("./tools/video/extract-audio.js"), name: "ExtractAudioTool" },
    { mod: () => import("./tools/video/merge-audio.js"), name: "MergeAudioTool" },
    { mod: () => import("./tools/video/get-video-info.js"), name: "GetVideoInfoTool" },
    { mod: () => import("./tools/video/video_filter.js"), name: "VideoFilterTool" },
    { mod: () => import("./tools/video/video_subtitle.js"), name: "VideoSubtitleTool" },
    { mod: () => import("./tools/video/video_watermark.js"), name: "VideoWatermarkTool" },
    { mod: () => import("./tools/video/video_transition.js"), name: "VideoTransitionTool" },
    { mod: () => import("./tools/video/video_pip.js"), name: "VideoPipTool" },
    { mod: () => import("./tools/video/video_speed.js"), name: "VideoSpeedTool" },
    { mod: () => import("./tools/video/video_stabilization.js"), name: "VideoStabilizationTool" },
    { mod: () => import("./tools/video/video_mask.js"), name: "VideoMaskTool" },
    { mod: () => import("./tools/video/lut_filter.js"), name: "LutFilterTool" },
    { mod: () => import("./tools/video/keyframe_animation.js"), name: "KeyframeAnimationTool" },
    { mod: () => import("./tools/video/audio_effects.js"), name: "AudioEffectsTool" },
    { mod: () => import("./tools/video/html_frame_render.js"), name: "HtmlFrameRenderTool" },
    { mod: () => import("./tools/video/hardware_acceleration.js"), name: "HardwareAccelerationTool" },
    { mod: () => import("./tools/video/tts.js"), name: "TtsTool" },
    { mod: () => import("./tools/video/search_material.js"), name: "SearchMaterialTool" },
    { mod: () => import("./tools/video/seedance.js"), name: "SeedanceTool" },
    { mod: () => import("./tools/video/smart_clip.js"), name: "SmartClipTool" },
    { mod: () => import("./tools/video/auto_fit_duration.js"), name: "AutoFitDurationTool" },
    { mod: () => import("./tools/video/set-edit-phase.js"), name: "SetEditPhaseTool" },
    // Semantic edit
    { mod: () => import("./tools/video/semantic-edit/index.js"), name: "SemanticEditTool" },
    // Manim
    { mod: () => import("./tools/manim/manim_code_agent.js"), name: "ManimCodeAgentTool" },
    // Media
    { mod: () => import("./tools/media/fetch_media.js"), name: "FetchMediaTool" },
  ]

  for (const { mod, name } of videoToolImports) {
    try {
      const m = await mod()
      const info = (m as Record<string, Tool.Info>)[name]
      if (info) {
        const [id, def] = await adaptTool(info)
        tools[id] = def
        console.log(`[jianjicode] Registered: ${id}`)
      }
    } catch (err) {
      console.warn(`[jianjicode] Failed to load ${name}:`, (err as Error).message)
    }
  }

  return { tool: tools }
}

export default jianjicodePlugin

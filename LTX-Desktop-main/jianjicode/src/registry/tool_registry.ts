import { getCircuitBreaker } from "../core/circuit-breaker.js"
import type { Tool } from "../tool/tool.js"

/**
 * 工具注册中心 - 集中管理所有视频编辑工具
 */
export class ToolRegistry {
  private tools = new Map<string, Tool.Info>()
  private initializedTools = new Map<
    string,
    Awaited<ReturnType<Tool.Info["init"]>>
  >()
  private categories = new Map<string, Set<string>>()

  /**
   * 注册工具
   * @param tool 工具定义
   * @param categories 工具分类 (可选)
   */
  register(tool: Tool.Info, categories?: string[]): void {
    const toolId = tool.id
    this.tools.set(toolId, tool)

    // 记录分类
    if (categories && categories.length > 0) {
      for (const category of categories) {
        if (!this.categories.has(category)) {
          this.categories.set(category, new Set())
        }
        this.categories.get(category)!.add(toolId)
      }
    } else {
      // 默认分类
      const defaultCategory = "video_editing"
      if (!this.categories.has(defaultCategory)) {
        this.categories.set(defaultCategory, new Set())
      }
      this.categories.get(defaultCategory)!.add(toolId)
    }

    console.log(`[ToolRegistry] 已注册工具: ${toolId}`)
  }

  /**
   * 获取工具定义
   * @param id 工具ID
   */
  getTool(id: string): Tool.Info | undefined {
    return this.tools.get(id)
  }

  /**
   * 获取已初始化的工具
   * @param id 工具ID
   * @param initContext 初始化上下文（可选）
   */
  async getInitializedTool(
    id: string,
    initContext?: Tool.InitContext,
  ): Promise<Awaited<ReturnType<Tool.Info["init"]>> | undefined> {
    // 检查缓存
    if (this.initializedTools.has(id)) {
      return this.initializedTools.get(id)
    }

    const tool = this.tools.get(id)
    if (!tool) {
      return undefined
    }

    // 断路器保护 — 如果工具连续初始化失败，停止重试
    const breaker = getCircuitBreaker(`tool:${id}`, {
      failureThreshold: 3,
      timeout: 60_000,
      halfOpenMaxRequests: 1,
    })
    if (breaker.getState() === "OPEN") {
      console.warn(
        `[ToolRegistry] Circuit "${breaker.name}" open, skipping init`,
      )
      return undefined
    }

    // 初始化工具
    try {
      const initializedTool = await tool.init(initContext)
      this.initializedTools.set(id, initializedTool)
      breaker.recordSuccess()
      return initializedTool
    } catch (error) {
      console.error(`[ToolRegistry] 工具初始化失败 ${id}:`, error)
      breaker.recordFailure(error)
      return undefined
    }
  }

  /**
   * 获取所有工具
   */
  getAllTools(): Tool.Info[] {
    return Array.from(this.tools.values())
  }

  /**
   * 获取分类中的工具
   * @param category 分类名称
   */
  getToolsByCategory(category: string): Tool.Info[] {
    const toolIds = this.categories.get(category)
    if (!toolIds) return []

    return Array.from(toolIds)
      .map((id) => this.tools.get(id))
      .filter((tool): tool is Tool.Info => tool !== undefined)
  }

  /**
   * 获取所有分类
   */
  getAllCategories(): string[] {
    return Array.from(this.categories.keys())
  }

  /**
   * 检查工具是否存在
   * @param id 工具ID
   */
  hasTool(id: string): boolean {
    return this.tools.has(id)
  }

  /**
   * 根据工具 ID 查找（直接委托给 getTool）
   */
  getToolById(id: string): Tool.Info | undefined {
    return this.getTool(id)
  }
}

/**
 * 全局工具注册中心实例
 */
export const toolRegistry = new ToolRegistry()

/**
 * 初始化并注册所有工具
 */
export async function initializeTools(): Promise<void> {
  console.log("[ToolRegistry] 开始初始化工具...")

  try {
    // ================================================================
    // A: 视频处理（FFmpeg / LTX 原生工具）
    // ================================================================

    const { FfmpegTool } = await import("../../ai/tool/video/ffmpeg-tool.js")
    toolRegistry.register(FfmpegTool, ["basic", "video_editing"])
    console.log(`[ToolRegistry] 已注册: ${FfmpegTool.id}`)

    // [REMOVED] LTX bridge tools (ltx_color_correction, ltx_effect, ltx_subtitle, ltx_transition)
    // — native tools (video_filter, video_subtitle, video_transition) fully cover all functionality

    // ================================================================
    // B: 视频分析（3 种互补路径，按分析类型选择）
    //
    //   ltx_video_processor — LTX 原生分析（信息/边缘/场景/帧）
    //   ai_video_analysis  — AI 多模态语义理解（场景风格/摘要/描述）
    //   cv_analysis         — 计算机视觉（深度估计/姿态估计）
    // ================================================================

    const { LtxVideoProcessorTool, LtxVideoTool } = await import(
      "../tool/ltx_video_processor.js"
    )
    toolRegistry.register(LtxVideoProcessorTool, [
      "ltx",
      "professional",
      "video_editing",
      "analysis",
      "ai",
    ])
    console.log(`[ToolRegistry] 已注册: ${LtxVideoProcessorTool.id}`)

    // [DEPRECATED] ltx_direct_tool — HTTP 桥接已覆盖全部功能，不再注册
    // const { LtxDirectTool } = await import("../tool/ltx_direct_tool.js")

    const { AIVideoAnalysisTool } = await import("../tool/ai_video_analysis.js")
    toolRegistry.register(AIVideoAnalysisTool, [
      "ai",
      "professional",
      "video_editing",
      "analysis",
      "multimodal",
      "ltx",
    ])
    console.log(`[ToolRegistry] 已注册: ${AIVideoAnalysisTool.id}`)

    const { CVAnalysisTool } = await import("../tool/cv_analysis.js")
    toolRegistry.register(CVAnalysisTool, [
      "cv",
      "computer_vision",
      "ai",
      "professional",
      "video_editing",
      "analysis",
      "ltx",
    ])
    console.log(`[ToolRegistry] 已注册: ${CVAnalysisTool.id}`)

    // ================================================================
    // C: 标准视频编辑（从 ai/tool/video/ re-export）
    // ================================================================
    const reExportTools = [
      {
        path: "../../ai/tool/video/video_filter.js",
        names: ["VideoFilterTool"],
        cats: ["professional", "video_editing", "effects"],
      },
      {
        path: "../../ai/tool/video/video_subtitle.js",
        names: ["VideoSubtitleTool"],
        cats: ["professional", "video_editing", "text"],
      },
      {
        path: "../../ai/tool/video/video_watermark.js",
        names: ["VideoWatermarkTool"],
        cats: ["professional", "video_editing", "overlay"],
      },
      {
        path: "../../ai/tool/video/video_transition.js",
        names: ["VideoTransitionTool"],
        cats: ["professional", "video_editing", "transition"],
      },
      {
        path: "../../ai/tool/video/video_pip.js",
        names: ["VideoPipTool"],
        cats: ["professional", "video_editing", "overlay"],
      },
      {
        path: "../../ai/tool/video/hardware_acceleration.js",
        names: ["HardwareAccelerationTool"],
        cats: ["system", "hardware", "performance", "diagnostics"],
      },
      {
        path: "../../ai/tool/video/video_speed.js",
        names: ["VideoSpeedTool"],
        cats: ["video_editing", "speed", "professional"],
      },
      {
        path: "../../ai/tool/video/video_stabilization.js",
        names: ["VideoStabilizationTool"],
        cats: ["video_editing", "stabilization", "professional"],
      },
      {
        path: "../../ai/tool/video/lut_filter.js",
        names: ["LutFilterTool"],
        cats: ["video_editing", "color", "lut", "professional"],
      },
      {
        path: "../../ai/tool/video/video_mask.js",
        names: ["VideoMaskTool"],
        cats: ["video_editing", "mask", "professional"],
      },
      {
        path: "../../ai/tool/video/video_extract_frame.js",
        names: ["VideoExtractFrameTool"],
        cats: ["video_editing", "frame", "professional"],
      },
      {
        path: "../../ai/tool/video/keyframe_animation.js",
        names: ["KeyframeAnimationTool"],
        cats: ["video_editing", "animation", "keyframe", "professional"],
      },
      {
        path: "../../ai/tool/video/audio_effects.js",
        names: ["AudioEffectsTool"],
        cats: ["video_editing", "audio", "effects", "professional"],
      },
    ]
    for (const { path, names, cats } of reExportTools) {
      const mod = await import(path)
      for (const name of names) {
        toolRegistry.register(mod[name], cats)
        console.log(`[ToolRegistry] 已注册: ${mod[name].id}`)
      }
    }

    // ================================================================
    // D: 批量 + 实用工具
    // ================================================================
    const { BatchScannerTool } = await import("../tool/batch_scanner.js")
    toolRegistry.register(BatchScannerTool, [
      "batch",
      "utility",
      "file_management",
    ])
    console.log(`[ToolRegistry] 已注册: ${BatchScannerTool.id}`)

    const { BatchQueueTool } = await import("../tool/batch_queue.js")
    toolRegistry.register(BatchQueueTool, [
      "batch",
      "utility",
      "task_management",
    ])
    console.log(`[ToolRegistry] 已注册: ${BatchQueueTool.id}`)

    const { BatchReportTool } = await import("../tool/batch_report.js")
    toolRegistry.register(BatchReportTool, ["batch", "utility", "reporting"])
    console.log(`[ToolRegistry] 已注册: ${BatchReportTool.id}`)

    // 测试工具
    const { FakeVideoTool } = await import("../tool/fake_video_tool.js")
    toolRegistry.register(FakeVideoTool, ["test", "utility"])
    console.log(`[ToolRegistry] 已注册: ${FakeVideoTool.id}`)

    // 音乐搜索
    const { MusicSearchTool } = await import("../tool/music_search.js")
    toolRegistry.register(MusicSearchTool, [
      "audio",
      "music",
      "utility",
      "search",
    ])
    console.log(`[ToolRegistry] 已注册: ${MusicSearchTool.id}`)

    // ================================================================
    // E: 专业扩展工具
    // ================================================================

    // 场景检测（另有 ltx_video_processor 也提供 scene detection）
    const { VideoSceneDetectionTool } = await import(
      "../tool/video_scene_detection.js"
    )
    toolRegistry.register(VideoSceneDetectionTool, [
      "ai",
      "video_editing",
      "analysis",
    ])

    // LTX API 工具（通过 HTTP 调用 LTX FastAPI 后端）
    const { LtxApiColorGradingTool, LtxApiCannyTool } = await import(
      "../../ai/tool/video/ltx_api_tools.js"
    )
    toolRegistry.register(LtxApiColorGradingTool, [
      "ltx",
      "professional",
      "video_editing",
      "color",
    ])
    console.log(`[ToolRegistry] 已注册: ${LtxApiColorGradingTool.id}`)
    toolRegistry.register(LtxApiCannyTool, [
      "ltx",
      "professional",
      "video_editing",
      "effects",
    ])
    console.log(`[ToolRegistry] 已注册: ${LtxApiCannyTool.id}`)
    console.log(`[ToolRegistry] 已注册: ${VideoSceneDetectionTool.id}`)

    // 篮球投篮检测
    const { BasketballShotDetectionTool } = await import(
      "../tool/basketball_shot_detection.js"
    )
    toolRegistry.register(BasketballShotDetectionTool, [
      "ai",
      "video_editing",
      "analysis",
      "sports",
      "basketball",
    ])
    console.log(`[ToolRegistry] 已注册: ${BasketballShotDetectionTool.id}`)

    const { BasketballShotEditorTool } = await import(
      "../tool/basketball_shot_editor.js"
    )
    toolRegistry.register(BasketballShotEditorTool, [
      "video_editing",
      "sports",
      "basketball",
      "trimming",
    ])
    console.log(`[ToolRegistry] 已注册: ${BasketballShotEditorTool.id}`)

    // 动作识别
    const { ActionRecognitionTool } = await import(
      "../tool/action_recognition.js"
    )
    toolRegistry.register(ActionRecognitionTool, [
      "ai",
      "video_editing",
      "analysis",
      "action_recognition",
      "motion_detection",
      "object_tracking",
    ])
    console.log(`[ToolRegistry] 已注册: ${ActionRecognitionTool.id}`)

    // 通用视频分析器
    const { UniversalVideoAnalyzerTool } = await import(
      "../tool/universal_video_analyzer.js"
    )
    toolRegistry.register(UniversalVideoAnalyzerTool, [
      "ai",
      "video_editing",
      "analysis",
      "universal",
      "multimodal",
      "ltx",
      "cv",
      "cross_domain",
    ])
    console.log(`[ToolRegistry] 已注册: ${UniversalVideoAnalyzerTool.id}`)

    // 智能裁剪
    const { VideoIntelligentCropTool } = await import(
      "../tool/video_intelligent_crop.js"
    )
    toolRegistry.register(VideoIntelligentCropTool, [
      "ai",
      "video_editing",
      "crop",
    ])
    console.log(`[ToolRegistry] 已注册: ${VideoIntelligentCropTool.id}`)

    // 简单快速裁剪（互补，无需 AI）
    const { VideoCropTool } = await import("../tool/video_crop.js")
    toolRegistry.register(VideoCropTool, [
      "video_editing",
      "crop",
      "utility",
    ])
    console.log(`[ToolRegistry] 已注册: ${VideoCropTool.id}`)

    // 批处理进度查询
    const { BatchProgressTool } = await import("../tool/batch_progress.js")
    toolRegistry.register(BatchProgressTool, [
      "batch",
      "utility",
      "progress",
      "monitoring",
    ])
    console.log(`[ToolRegistry] 已注册: ${BatchProgressTool.id}`)

    // 风格迁移
    const { VideoStyleTransferTool } = await import(
      "../tool/video_style_transfer.js"
    )
    toolRegistry.register(VideoStyleTransferTool, [
      "ai",
      "video_editing",
      "style",
    ])
    console.log(`[ToolRegistry] 已注册: ${VideoStyleTransferTool.id}`)

    // 剪辑阶段管理工具（RoughCut / FineCut 门禁）
    const { SetEditPhaseTool } = await import(
      "../../ai/tool/video/set-edit-phase.js"
    )
    toolRegistry.register(SetEditPhaseTool, ["system", "video_editing"])
    console.log(`[ToolRegistry] 已注册: ${SetEditPhaseTool.id}`)

    // Skill 管理工具（自进化系统 Phase 1 — Hermes 架构）
    const { SkillManageTool } = await import("../tool/skill-manager-tool.js")
    toolRegistry.register(SkillManageTool, ["skill", "system"])
    console.log(`[ToolRegistry] 已注册: ${SkillManageTool.id}`)

    // ================================================================
    // F: Video-RAG 视频检索工具
    // ================================================================
    const { VideoRagSearchTool } = await import("../tool/video_rag_search.js")
    toolRegistry.register(VideoRagSearchTool, [
      "ai",
      "video_editing",
      "analysis",
      "rag",
      "retrieval",
      "search",
    ])
    console.log(`[ToolRegistry] 已注册: ${VideoRagSearchTool.id}`)

    console.log(
      `[ToolRegistry] 工具初始化完成，共注册 ${toolRegistry.getAllTools().length} 个工具`,
    )
  } catch (error) {
    console.error(`[ToolRegistry] 工具初始化失败:`, error)
    throw error
  }
}

/**
 * 时间线渲染器工具 - 将时间线项目转换为实际视频
 * TypeScript原生实现，调用LTX直接桥接工具进行渲染
 */

import z from "zod"
import { toolRegistry } from "../registry/tool_registry.js"
import {
  AudioClip,
  AudioFilter,
  Clip,
  Effect,
  findClipInTimeline,
  findTrackForClip,
  getTimelineDuration,
  ImageClip,
  type MediaAsset,
  SubtitleClip,
  SubtitleStyle,
  Timeline,
  type TimelineProject,
  type Track,
  Transition,
  type VideoClip,
  type VideoFilter,
} from "../types/timeline-types.js"
import { Tool } from "./tool.js"

/**
 * 时间线渲染器工具
 */
export const TimelineRendererTool = Tool.defineLtxTool("timeline_renderer", {
  description: "时间线渲染器 - 将时间线项目转换为实际视频，调用LTX后端进行渲染",
  parameters: z.object({
    // 渲染输入
    project_data: z.any().optional().describe("时间线项目数据 (JSON格式)"),
    project_file: z.string().optional().describe("时间线项目文件路径 (.json)"),

    // 渲染配置
    output_path: z.string().optional().describe("输出视频文件路径"),
    resolution: z
      .string()
      .optional()
      .describe("输出分辨率 (格式: WxH, 如 1920x1080)"),
    frame_rate: z.number().optional().describe("输出帧率 (默认: 30)"),
    quality: z
      .enum(["low", "medium", "high", "very_high"])
      .optional()
      .default("high")
      .describe("渲染质量"),

    // 渲染模式
    render_mode: z
      .enum(["full", "preview", "draft"])
      .optional()
      .default("full")
      .describe("渲染模式: full(完整), preview(预览), draft(草稿)"),
    preview_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("仅生成渲染计划，不实际执行"),

    // 高级选项
    max_concurrent: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(3)
      .describe("最大并发任务数 (批处理模式)"),
    use_batch_queue: z
      .boolean()
      .optional()
      .default(true)
      .describe("使用批处理队列执行渲染任务"),
    keep_intermediate_files: z
      .boolean()
      .optional()
      .default(false)
      .describe("保留中间文件 (用于调试)"),
  }),

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 加载时间线项目
      const project = await loadTimelineProject(args)
      if (!project) {
        return {
          title: "渲染失败",
          metadata: { operation: "timeline_renderer", error: true },
          output: "❌ 无法加载时间线项目",
        }
      }

      // 2. 生成渲染计划
      const renderPlan = await generateRenderPlan(project, args)

      // 3. 如果只是预览，返回计划
      if (args.preview_only) {
        return {
          title: "渲染计划生成完成",
          metadata: {
            operation: "timeline_renderer",
            error: false,
            success: true,
            preview: true,
            plan: renderPlan,
          },
          output: formatRenderPlan(renderPlan, project, args),
        }
      }

      // 4. 执行渲染
      const renderResult = await executeRenderPlan(renderPlan, args, ctx)

      // 5. 返回结果
      return {
        title: "时间线渲染完成",
        metadata: {
          operation: "timeline_renderer",
          error: false,
          success: true,
          result: renderResult,
        },
        output: formatRenderResult(renderResult, project, args),
      }
    } catch (error: any) {
      console.error("[TimelineRendererTool] 渲染失败:", error)
      return {
        title: "渲染失败",
        metadata: { operation: "timeline_renderer", error: true },
        output: `❌ 渲染过程中发生错误: ${error.message}`,
      }
    }
  },
} as any)

// ============================================================================
// 渲染计划类型
// ============================================================================

interface RenderTask {
  id: string
  operation: string
  description: string
  parameters: Record<string, any>
  dependencies?: string[]
  output_file?: string
  intermediate?: boolean
}

interface RenderPlan {
  tasks: RenderTask[]
  total_tasks: number
  intermediate_files: string[]
  final_output: string
  estimated_duration: number
}

// ============================================================================
// 项目加载
// ============================================================================

async function loadTimelineProject(args: any): Promise<TimelineProject | null> {
  try {
    // 从文件加载
    if (args.project_file) {
      const fs = await import("fs")
      if (!fs.existsSync(args.project_file)) {
        console.error(`项目文件不存在: ${args.project_file}`)
        return null
      }
      const content = fs.readFileSync(args.project_file, "utf-8")
      return JSON.parse(content)
    }

    // 从数据加载
    if (args.project_data) {
      return typeof args.project_data === "string"
        ? JSON.parse(args.project_data)
        : args.project_data
    }

    return null
  } catch (error) {
    console.error("加载时间线项目失败:", error)
    return null
  }
}

// ============================================================================
// 渲染计划生成
// ============================================================================

async function generateRenderPlan(
  project: TimelineProject,
  args: any,
): Promise<RenderPlan> {
  const tasks: RenderTask[] = []
  const intermediateFiles: string[] = []

  const timeline = project.timeline
  const outputPath =
    args.output_path || `rendered_${project.name}_${Date.now()}.mp4`

  console.log(`[TimelineRendererTool] 开始生成渲染计划: ${project.name}`)
  console.log(`[TimelineRendererTool] 输出路径: ${outputPath}`)
  console.log(`[TimelineRendererTool] 时间线轨道数: ${timeline.tracks.length}`)

  // 1. 处理视频轨道
  const videoTracks = timeline.tracks.filter((track) => track.type === "video")
  for (let i = 0; i < videoTracks.length; i++) {
    const track = videoTracks[i]
    const trackTasks = await generateVideoTrackTasks(track, project, i, args)
    tasks.push(...trackTasks)
  }

  // 2. 处理音频轨道
  const audioTracks = timeline.tracks.filter((track) => track.type === "audio")
  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i]
    const trackTasks = await generateAudioTrackTasks(track, project, i, args)
    tasks.push(...trackTasks)
  }

  // 3. 处理字幕轨道
  const subtitleTracks = timeline.tracks.filter(
    (track) => track.type === "subtitle",
  )
  for (let i = 0; i < subtitleTracks.length; i++) {
    const track = subtitleTracks[i]
    const trackTasks = await generateSubtitleTrackTasks(track, project, i, args)
    tasks.push(...trackTasks)
  }

  // 4. 添加合并任务
  const mergeTask = createMergeTask(tasks, intermediateFiles, outputPath, args)
  tasks.push(mergeTask)

  // 5. 添加清理任务（可选）
  if (!args.keep_intermediate_files) {
    const cleanupTask = createCleanupTask(intermediateFiles, outputPath)
    tasks.push(cleanupTask)
  }

  // 计算估计时长
  const estimatedDuration = calculateEstimatedDuration(tasks, project)

  return {
    tasks,
    total_tasks: tasks.length,
    intermediate_files: intermediateFiles,
    final_output: outputPath,
    estimated_duration: estimatedDuration,
  }
}

// ============================================================================
// 视频轨道任务生成
// ============================================================================

async function generateVideoTrackTasks(
  track: Track,
  project: TimelineProject,
  trackIndex: number,
  args: any,
): Promise<RenderTask[]> {
  const tasks: RenderTask[] = []
  const trackId = track.id || `track_${trackIndex}`

  console.log(`[TimelineRendererTool] 处理视频轨道: ${trackId}`)

  // 按开始时间排序剪辑
  const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime)

  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i]

    // 只处理视频剪辑
    if (clip.type !== "video") {
      console.warn(
        `[TimelineRendererTool] 跳过非视频剪辑: ${clip.id} (类型: ${clip.type})`,
      )
      continue
    }

    const asset = project.assets.find((a) => a.id === clip.assetId)
    if (!asset || asset.type !== "video") {
      console.warn(`[TimelineRendererTool] 跳过无效视频剪辑: ${clip.id}`)
      continue
    }

    // 为每个剪辑生成任务
    const clipTasks = await generateVideoClipTasks(
      clip as VideoClip,
      asset,
      trackIndex,
      i,
      args,
    )
    tasks.push(...clipTasks)
  }

  return tasks
}

async function generateVideoClipTasks(
  clip: VideoClip,
  asset: MediaAsset,
  trackIndex: number,
  clipIndex: number,
  args: any,
): Promise<RenderTask[]> {
  const tasks: RenderTask[] = []
  const clipId = clip.id || `clip_${trackIndex}_${clipIndex}`

  // 1. 基础剪辑任务
  const baseTask: RenderTask = {
    id: `${clipId}_base`,
    operation: "trim",
    description: `裁剪视频剪辑: ${asset.path}`,
    parameters: {
      input_path: asset.path,
      start_time: clip.offset || 0,
      end_time: (clip.offset || 0) + clip.duration,
      output_path: `temp_${clipId}_base.mp4`,
    },
  }
  tasks.push(baseTask)

  // 2. 颜色校正任务（如果有）
  if (clip.colorCorrection) {
    const colorTask: RenderTask = {
      id: `${clipId}_color`,
      operation: "apply_color_grading",
      description: `应用颜色校正: ${clip.id}`,
      parameters: {
        input_path: `temp_${clipId}_base.mp4`,
        color_correction: clip.colorCorrection,
        output_path: `temp_${clipId}_color.mp4`,
      },
      dependencies: [`${clipId}_base`],
    }
    tasks.push(colorTask)
  }

  // 3. 滤镜任务（如果有）
  if (clip.filters && clip.filters.length > 0) {
    for (let j = 0; j < clip.filters.length; j++) {
      const filter = clip.filters[j]
      if (!filter.enabled) continue

      const filterTask: RenderTask = {
        id: `${clipId}_filter_${j}`,
        operation: getFilterOperation(filter.type),
        description: `应用滤镜: ${filter.type}`,
        parameters: {
          input_path:
            j === 0
              ? clip.colorCorrection
                ? `temp_${clipId}_color.mp4`
                : `temp_${clipId}_base.mp4`
              : `temp_${clipId}_filter_${j - 1}.mp4`,
          ...getFilterParameters(filter),
          output_path: `temp_${clipId}_filter_${j}.mp4`,
        },
        dependencies: [
          j === 0
            ? clip.colorCorrection
              ? `${clipId}_color`
              : `${clipId}_base`
            : `${clipId}_filter_${j - 1}`,
        ],
      }
      tasks.push(filterTask)
    }
  }

  // 4. 最终输出任务
  const finalOutputTask: RenderTask = {
    id: `${clipId}_final`,
    operation: "convert_format",
    description: `最终处理剪辑: ${clip.id}`,
    parameters: {
      input_path: getFinalInputPath(clip, clipId),
      output_path: `temp_${clipId}_final.mp4`,
      output_format: "mp4",
    },
    dependencies: getFinalDependencies(clip, clipId),
  }
  tasks.push(finalOutputTask)

  return tasks
}

function getFilterOperation(filterType: string): string {
  const filterMap: Record<string, string> = {
    blur: "apply_effect",
    sharpen: "apply_effect",
    glow: "apply_effect",
    vignette: "apply_effect",
    grain: "apply_effect",
    lut: "apply_color_preset",
    "color-adjust": "apply_color_grading",
    "hue-rotate": "apply_color_grading",
    brightness: "apply_color_grading",
    contrast: "apply_color_grading",
    saturation: "apply_color_grading",
    temperature: "apply_color_grading",
    tint: "apply_color_grading",
  }
  return filterMap[filterType] || "apply_effect"
}

function getFilterParameters(filter: VideoFilter): Record<string, any> {
  const baseParams = { ...filter.parameters }

  // 特殊处理某些滤镜类型
  if (filter.type === "lut") {
    return {
      preset_id: baseParams.lutName || "standard",
      strength: baseParams.strength || 100,
    }
  }

  return baseParams
}

function getFinalInputPath(clip: VideoClip, clipId: string): string {
  if (clip.filters && clip.filters.length > 0) {
    const enabledFilters = clip.filters.filter((f: any) => f.enabled)
    if (enabledFilters.length > 0) {
      return `temp_${clipId}_filter_${enabledFilters.length - 1}.mp4`
    }
  }
  if (clip.colorCorrection) {
    return `temp_${clipId}_color.mp4`
  }
  return `temp_${clipId}_base.mp4`
}

function getFinalDependencies(clip: VideoClip, clipId: string): string[] {
  const dependencies: string[] = []

  if (clip.colorCorrection) {
    dependencies.push(`${clipId}_color`)
  } else {
    dependencies.push(`${clipId}_base`)
  }

  if (clip.filters && clip.filters.length > 0) {
    const enabledFilters = clip.filters.filter((f: any) => f.enabled)
    if (enabledFilters.length > 0) {
      dependencies.push(`${clipId}_filter_${enabledFilters.length - 1}`)
    }
  }

  return dependencies
}

// ============================================================================
// 音频轨道任务生成
// ============================================================================

async function generateAudioTrackTasks(
  track: Track,
  project: TimelineProject,
  trackIndex: number,
  args: any,
): Promise<RenderTask[]> {
  const tasks: RenderTask[] = []
  const trackId = track.id || `audio_track_${trackIndex}`

  console.log(`[TimelineRendererTool] 处理音频轨道: ${trackId}`)

  // 按开始时间排序剪辑
  const sortedClips = [...track.clips].sort((a, b) => a.startTime - b.startTime)

  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i]
    const asset = project.assets.find((a) => a.id === clip.assetId)

    if (!asset || asset.type !== "audio") {
      console.warn(`[TimelineRendererTool] 跳过无效音频剪辑: ${clip.id}`)
      continue
    }

    const clipTask: RenderTask = {
      id: `audio_${trackIndex}_${i}`,
      operation: "extract_audio",
      description: `提取音频剪辑: ${asset.path}`,
      parameters: {
        input_path: asset.path,
        start_time: clip.offset || 0,
        end_time: (clip.offset || 0) + clip.duration,
        output_path: `temp_audio_${trackIndex}_${i}.mp3`,
      },
    }
    tasks.push(clipTask)
  }

  return tasks
}

// ============================================================================
// 字幕轨道任务生成
// ============================================================================

async function generateSubtitleTrackTasks(
  track: Track,
  project: TimelineProject,
  trackIndex: number,
  args: any,
): Promise<RenderTask[]> {
  const tasks: RenderTask[] = []
  const trackId = track.id || `subtitle_track_${trackIndex}`

  console.log(`[TimelineRendererTool] 处理字幕轨道: ${trackId}`)

  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i]
    if (clip.type !== "subtitle") continue

    const subtitleTask: RenderTask = {
      id: `subtitle_${trackIndex}_${i}`,
      operation: "add_subtitle",
      description: `添加字幕: ${clip.text}`,
      parameters: {
        input_path: "", // 将在合并时指定
        subtitle_text: clip.text,
        subtitle_start_time: clip.startTime,
        subtitle_end_time: clip.startTime + clip.duration,
        subtitle_style: clip.style,
        output_path: "", // 将在合并时指定
      },
    }
    tasks.push(subtitleTask)
  }

  return tasks
}

// ============================================================================
// 合并和清理任务
// ============================================================================

function createMergeTask(
  allTasks: RenderTask[],
  intermediateFiles: string[],
  outputPath: string,
  args: any,
): RenderTask {
  // 收集所有最终剪辑
  const finalVideoClips = allTasks.filter(
    (task) => task.id.includes("_final") && !task.id.includes("audio_"),
  )

  const finalAudioClips = allTasks.filter(
    (task) => task.id.includes("audio_") && task.operation === "extract_audio",
  )

  const subtitleTasks = allTasks.filter((task) => task.id.includes("subtitle_"))

  return {
    id: "merge_final",
    operation: "concat",
    description: "合并所有视频剪辑",
    parameters: {
      input_paths: finalVideoClips.map(
        (task) =>
          task.parameters.output_path ||
          `temp_${task.id.replace("_final", "")}_final.mp4`,
      ),
      output_path: outputPath,
    },
    dependencies: finalVideoClips.map((task) => task.id),
  }
}

function createCleanupTask(
  intermediateFiles: string[],
  outputPath: string,
): RenderTask {
  return {
    id: "cleanup",
    operation: "cleanup_intermediate",
    description: "清理中间文件",
    parameters: {
      files_to_delete: intermediateFiles,
      keep_final: true,
    },
    dependencies: ["merge_final"],
  }
}

// ============================================================================
// 渲染执行
// ============================================================================

async function executeRenderPlan(
  plan: RenderPlan,
  args: any,
  ctx: any,
): Promise<any> {
  console.log(
    `[TimelineRendererTool] 开始执行渲染计划，共 ${plan.tasks.length} 个任务`,
  )

  if (args.use_batch_queue) {
    // 使用批处理队列
    return await executeWithBatchQueue(plan, args, ctx)
  } else {
    // 顺序执行
    return await executeSequentially(plan, args, ctx)
  }
}

async function executeWithBatchQueue(
  plan: RenderPlan,
  args: any,
  ctx: any,
): Promise<any> {
  try {
    // 获取批处理队列工具
    const batchQueueTool = await toolRegistry.getInitializedTool(
      "batch_queue",
      { agent: ctx.agent },
    )
    if (!batchQueueTool) {
      throw new Error("批处理队列工具不可用")
    }

    // 准备任务列表
    const batchTasks = plan.tasks.map((task) => ({
      id: task.id,
      operation: task.operation,
      parameters: task.parameters,
      input_file: task.parameters.input_path || "",
      output_file: task.parameters.output_path || "",
      priority: task.intermediate ? 50 : 70,
    }))

    // 执行批处理
    const batchArgs = {
      tasks: batchTasks,
      max_concurrent: args.max_concurrent || 3,
      max_retries: 2,
      retry_delay: 5,
      timeout_per_task: 300,
      stop_on_error: true,
      detailed_progress: true,
    }

    const result = await batchQueueTool.execute(batchArgs, ctx)
    return {
      success: !result.metadata.error,
      batch_result: result,
      output_file: plan.final_output,
      task_count: plan.total_tasks,
    }
  } catch (error: any) {
    console.error("[TimelineRendererTool] 批处理执行失败:", error)
    throw error
  }
}

async function executeSequentially(
  plan: RenderPlan,
  args: any,
  ctx: any,
): Promise<any> {
  const results: any[] = []

  for (const task of plan.tasks) {
    try {
      console.log(
        `[TimelineRendererTool] 执行任务: ${task.id} (${task.operation})`,
      )

      // 获取对应的工具
      const toolId = getToolIdForOperation(task.operation)
      const tool = await toolRegistry.getInitializedTool(toolId, {
        agent: ctx.agent,
      })
      if (!tool) {
        throw new Error(`找不到工具: ${toolId}`)
      }

      // 执行任务
      const result = await tool.execute(task.parameters, ctx)
      results.push({
        task_id: task.id,
        success: !result.metadata.error,
        result,
      })
    } catch (error: any) {
      console.error(`[TimelineRendererTool] 任务 ${task.id} 失败:`, error)
      throw new Error(`任务 ${task.id} 失败: ${error.message}`)
    }
  }

  return {
    success: true,
    results,
    output_file: plan.final_output,
    task_count: plan.tasks.length,
  }
}

function getToolIdForOperation(operation: string): string {
  const ltxOperations = new Set([
    "trim",
    "concat",
    "extract_audio",
    "add_subtitle",
    "apply_color_grading",
    "apply_color_preset",
    "convert_format",
    "extract_frame",
    "merge_audio_video",
    "video_info",
  ])

  if (ltxOperations.has(operation)) {
    return "ltx_direct"
  }

  // 默认使用ltx_direct，支持大部分操作
  return "ltx_direct"
}

// ============================================================================
// 辅助函数
// ============================================================================

function calculateEstimatedDuration(
  tasks: RenderTask[],
  project: TimelineProject,
): number {
  // 简单估算：每个任务10秒 + 视频时长
  const timelineDuration = getTimelineDuration(project.timeline) || 60
  return tasks.length * 10 + timelineDuration
}

function formatRenderPlan(
  plan: RenderPlan,
  project: TimelineProject,
  args: any,
): string {
  const lines: string[] = []

  lines.push(`📊 渲染计划生成完成: ${project.name}`)
  lines.push(`📈 计划摘要:`)
  lines.push(`  ├── 总任务数: ${plan.total_tasks}`)
  lines.push(`  ├── 中间文件: ${plan.intermediate_files.length} 个`)
  lines.push(`  ├── 最终输出: ${plan.final_output}`)
  lines.push(`  └── 预计耗时: ${Math.round(plan.estimated_duration / 60)} 分钟`)

  lines.push(`\n📋 任务列表:`)
  plan.tasks.forEach((task, index) => {
    lines.push(`  ${index + 1}. ${task.id}: ${task.description}`)
    lines.push(
      `     └── 操作: ${task.operation}, 依赖: ${task.dependencies?.join(", ") || "无"}`,
    )
  })

  lines.push(`\n⚙️ 渲染配置:`)
  lines.push(`  ├── 渲染模式: ${args.render_mode}`)
  lines.push(`  ├── 输出分辨率: ${args.resolution || "项目默认"}`)
  lines.push(`  ├── 质量: ${args.quality}`)
  lines.push(`  └── 批处理: ${args.use_batch_queue ? "是" : "否"}`)

  return lines.join("\n")
}

function formatRenderResult(
  result: any,
  project: TimelineProject,
  args: any,
): string {
  const lines: string[] = []

  lines.push(`🎬 时间线渲染完成: ${project.name}`)
  lines.push(`📊 渲染结果:`)
  lines.push(`  ├── 状态: ${result.success ? "✅ 成功" : "❌ 失败"}`)
  lines.push(`  ├── 输出文件: ${result.output_file}`)
  lines.push(`  └── 执行任务: ${result.task_count || 0} 个`)

  if (result.batch_result) {
    const stats = result.batch_result.metadata?.stats
    if (stats) {
      lines.push(`\n📈 批处理统计:`)
      lines.push(`  ├── 总任务: ${stats.total_tasks}`)
      lines.push(`  ├── 成功: ${stats.completed_tasks}`)
      lines.push(`  ├── 失败: ${stats.failed_tasks}`)
      lines.push(`  └── 成功率: ${stats.success_rate}%`)
    }
  }

  lines.push(`\n💾 文件位置: ${result.output_file}`)
  lines.push(`🕒 渲染时间: ${new Date().toLocaleString()}`)

  return lines.join("\n")
}

// ============================================================================
// 工具别名
// ============================================================================

export const TimelineRenderTool = TimelineRendererTool

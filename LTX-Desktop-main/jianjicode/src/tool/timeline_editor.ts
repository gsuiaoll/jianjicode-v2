/**
 * 时间线编辑器工具
 * 提供对多轨道时间线的编辑操作，支持剪辑、过渡、特效层管理
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { basename, dirname, extname, isAbsolute, join, relative } from "path"
import z from "zod"
import { toolRegistry } from "../registry/tool_registry.js"
import {
  AudioClip,
  type AudioTrack,
  type Clip,
  createDefaultAudioClip,
  createDefaultAudioTrack,
  createDefaultVideoClip,
  createDefaultVideoTrack,
  createEmptyTimelineProject,
  DEFAULT_PROJECT_SETTINGS,
  Effect,
  findClipInTimeline,
  findTrackForClip,
  getTimelineDuration,
  ImageClip,
  MediaAsset,
  SubtitleClip,
  secondsToTimecode,
  Timeline,
  type TimelineProject,
  type Track,
  Transition,
  timecodeToSeconds,
  VideoClip,
  type VideoTrack,
  validateTimeline,
} from "../types/timeline-types.js"
import { Tool } from "./tool.js"

/**
 * 时间线编辑器工具
 */
export const TimelineEditorTool = Tool.defineLtxTool("timeline_editor", {
  description: "时间线编辑器 - 管理多轨道时间线，支持剪辑、过渡、特效层操作",
  parameters: z.object({
    operation: z
      .enum([
        // 项目管理
        "create_project",
        "load_project",
        "save_project",
        "export_project",
        // 轨道操作
        "add_track",
        "remove_track",
        "move_track",
        "update_track",
        "list_tracks",
        // 剪辑操作
        "add_clip",
        "remove_clip",
        "move_clip",
        "trim_clip",
        "split_clip",
        "list_clips",
        // 过渡操作
        "add_transition",
        "remove_transition",
        "list_transitions",
        // 特效操作
        "add_effect",
        "remove_effect",
        "list_effects",
        // 滤镜操作
        "add_filter",
        "remove_filter",
        "list_filters",
        // 时间线状态
        "get_timeline_info",
        "set_current_time",
        "get_timeline_zoom",
        "set_timeline_zoom",
        "validate_timeline",
        "render_preview",
      ])
      .describe("操作类型"),

    // 项目管理参数
    project_name: z
      .string()
      .optional()
      .describe("项目名称 (create_project 操作必需)"),
    project_file: z
      .string()
      .optional()
      .describe("项目文件路径 (load_project/save_project 操作必需)"),
    export_format: z
      .enum(["json", "xml", "edl"])
      .optional()
      .default("json")
      .describe("导出格式 (export_project 操作可选)"),

    // 轨道操作参数
    track_id: z
      .string()
      .optional()
      .describe("轨道ID (add_track/remove_track/move_track 操作必需)"),
    track_type: z
      .enum(["video", "audio", "subtitle", "effect"])
      .optional()
      .describe("轨道类型 (add_track 操作必需)"),
    track_name: z.string().optional().describe("轨道名称 (add_track 操作可选)"),
    track_position: z
      .number()
      .optional()
      .describe("轨道位置索引 (move_track 操作必需)"),
    track_locked: z
      .boolean()
      .optional()
      .describe("轨道锁定状态 (update_track 操作可选)"),
    track_visible: z
      .boolean()
      .optional()
      .describe("轨道可见性 (update_track 操作可选，仅视频/字幕轨道)"),
    track_muted: z
      .boolean()
      .optional()
      .describe("轨道静音状态 (update_track 操作可选)"),
    track_volume: z
      .number()
      .optional()
      .describe("轨道音量 (0-1) (update_track 操作可选，仅音频轨道)"),
    track_pan: z
      .number()
      .optional()
      .describe(
        "轨道声像平衡 (-1=左, 0=中, 1=右) (update_track 操作可选，仅音频轨道)",
      ),
    track_opacity: z
      .number()
      .optional()
      .describe("轨道不透明度 (0-1) (update_track 操作可选，仅视频轨道)"),

    // 剪辑操作参数
    clip_id: z.string().optional().describe("剪辑ID (clip操作必需)"),
    asset_id: z.string().optional().describe("媒体资源ID (add_clip 操作必需)"),
    clip_type: z
      .enum(["video", "audio", "subtitle", "image"])
      .optional()
      .describe("剪辑类型 (add_clip 操作必需)"),
    start_time: z.number().optional().describe("开始时间 (秒)"),
    duration: z.number().optional().describe("持续时间 (秒)"),
    offset: z.number().optional().describe("在源媒体中的偏移量 (秒)"),
    track_id_for_clip: z
      .string()
      .optional()
      .describe("目标轨道ID (add_clip/move_clip 操作必需)"),
    trim_start: z
      .number()
      .optional()
      .describe("从开始修剪的时长 (秒) (trim_clip 操作可选)"),
    trim_end: z
      .number()
      .optional()
      .describe("从结束修剪的时长 (秒) (trim_clip 操作可选)"),
    new_start_time: z
      .number()
      .optional()
      .describe("新的开始时间 (秒) (trim_clip 操作可选)"),
    new_end_time: z
      .number()
      .optional()
      .describe("新的结束时间 (秒) (trim_clip 操作可选)"),

    // 过渡操作参数
    transition_id: z
      .string()
      .optional()
      .describe("过渡ID (transition操作必需)"),
    transition_type: z
      .enum([
        "dissolve",
        "fade-to-black",
        "fade-to-white",
        "wipe-left",
        "wipe-right",
        "wipe-up",
        "wipe-down",
        "slide-left",
        "slide-right",
        "slide-up",
        "slide-down",
        "zoom-in",
        "zoom-out",
      ])
      .optional()
      .describe("过渡类型 (add_transition 操作必需)"),
    transition_duration: z.number().optional().describe("过渡时长 (秒)"),
    start_clip_id: z
      .string()
      .optional()
      .describe("起始剪辑ID (add_transition 操作必需)"),
    end_clip_id: z
      .string()
      .optional()
      .describe("结束剪辑ID (add_transition 操作必需)"),

    // 特效操作参数
    effect_id: z.string().optional().describe("特效ID (effect操作必需)"),
    effect_type: z
      .enum([
        "chroma-key",
        "picture-in-picture",
        "split-screen",
        "mask",
        "keying",
        "stabilize",
        "slow-motion",
        "time-remap",
      ])
      .optional()
      .describe("特效类型 (add_effect 操作必需)"),
    target_clip_id: z
      .string()
      .optional()
      .describe("目标剪辑ID (add_effect 操作必需)"),

    // 滤镜操作参数
    filter_id: z.string().optional().describe("滤镜ID (filter操作必需)"),
    filter_type: z
      .enum([
        "blur",
        "sharpen",
        "glow",
        "vignette",
        "grain",
        "lut",
        "color-adjust",
        "hue-rotate",
      ])
      .optional()
      .describe("滤镜类型 (add_filter 操作必需)"),
    filter_clip_id: z
      .string()
      .optional()
      .describe("目标剪辑ID (add_filter 操作必需)"),

    // 通用参数
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("操作参数 (JSON对象)"),
    current_time: z
      .number()
      .optional()
      .describe("当前时间 (秒) (set_current_time 操作必需)"),
    zoom_level: z
      .number()
      .optional()
      .describe(
        "缩放级别 (1=100%, 0.5=50%, 2=200%) (set_timeline_zoom 操作必需)",
      ),
    output_file: z.string().optional().describe("输出文件路径"),
  }),

  execute: async (args, ctx) => {
    try {
      // 加载或创建项目上下文
      let project: TimelineProject | null = null

      // 这里应该是从会话状态或文件中加载项目
      // 为简化，我们创建新项目或使用模拟数据
      if (
        args.operation.startsWith("create_") ||
        args.operation === "add_track"
      ) {
        project = createEmptyTimelineProject(args.project_name || "新项目")
      } else {
        // 模拟加载现有项目
        project = createEmptyTimelineProject("默认项目")
      }

      if (!project) {
        return {
          title: "时间线编辑器错误",
          metadata: { operation: "timeline_editor", error: true },
          output: "❌ 无法加载或创建项目",
        }
      }

      switch (args.operation) {
        case "create_project":
          return await handleCreateProject(args, project)
        case "load_project":
          return await handleLoadProject(args)
        case "save_project":
          return await handleSaveProject(args, project)
        case "export_project":
          return await handleExportProject(args, project)
        case "add_track":
          return await handleAddTrack(args, project)
        case "remove_track":
          return await handleRemoveTrack(args, project)
        case "move_track":
          return await handleMoveTrack(args, project)
        case "list_tracks":
          return await handleListTracks(args, project)
        case "update_track":
          return await handleUpdateTrack(args, project)
        case "add_clip":
          return await handleAddClip(args, project)
        case "remove_clip":
          return await handleRemoveClip(args, project)
        case "move_clip":
          return await handleMoveClip(args, project)
        case "trim_clip":
          return await handleTrimClip(args, project)
        case "split_clip":
          return await handleSplitClip(args, project)
        case "list_clips":
          return await handleListClips(args, project)
        case "add_transition":
          return await handleAddTransition(args, project)
        case "remove_transition":
          return await handleRemoveTransition(args, project)
        case "list_transitions":
          return await handleListTransitions(args, project)
        case "add_effect":
          return await handleAddEffect(args, project)
        case "remove_effect":
          return await handleRemoveEffect(args, project)
        case "list_effects":
          return await handleListEffects(args, project)
        case "add_filter":
          return await handleAddFilter(args, project)
        case "remove_filter":
          return await handleRemoveFilter(args, project)
        case "list_filters":
          return await handleListFilters(args, project)
        case "get_timeline_info":
          return await handleGetTimelineInfo(args, project)
        case "set_current_time":
          return await handleSetCurrentTime(args, project)
        case "get_timeline_zoom":
          return await handleGetTimelineZoom(args, project)
        case "set_timeline_zoom":
          return await handleSetTimelineZoom(args, project)
        case "validate_timeline":
          return await handleValidateTimeline(args, project)
        case "render_preview":
          return await handleRenderPreview(args, project, ctx)
        default:
          return {
            title: "未知操作",
            metadata: { operation: "timeline_editor", error: true },
            output: `未知操作: ${args.operation}`,
          }
      }
    } catch (error: any) {
      return {
        title: "时间线编辑器操作失败",
        metadata: { operation: "timeline_editor", error: true },
        output: `操作失败: ${error.message}`,
      }
    }
  },
})

// ============================================================================
// 项目管理处理器
// ============================================================================

async function handleCreateProject(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.project_name) {
    return {
      title: "创建项目失败",
      metadata: { operation: "create_project", error: true },
      output: "❌ 请指定项目名称 (project_name 参数)",
    }
  }

  const newProject = createEmptyTimelineProject(args.project_name)

  return {
    title: "项目创建成功",
    metadata: {
      operation: "create_project",
      error: false,
      success: true,
      project_id: newProject.id,
      project_name: newProject.name,
    },
    output:
      `✅ 项目 **${newProject.name}** 创建成功\n` +
      `📁 项目ID: ${newProject.id}\n` +
      `📏 分辨率: ${newProject.settings.resolution.width}x${newProject.settings.resolution.height}\n` +
      `🎞️ 帧率: ${newProject.settings.frameRate} fps\n` +
      `⏱️ 初始时长: ${newProject.settings.duration} 秒\n` +
      `🎵 音频采样率: ${newProject.settings.sampleRate} Hz\n` +
      `🎨 背景色: ${newProject.settings.backgroundColor}\n\n` +
      `💡 使用 save_project 操作保存项目到文件`,
  }
}

/**
 * 将项目中的绝对路径转换为相对于项目文件的相对路径
 */
function convertToRelativePaths(
  project: TimelineProject,
  projectFilePath: string,
): TimelineProject {
  const projectDir = dirname(projectFilePath)

  // 创建项目副本以避免修改原对象
  const converted = { ...project }

  // 转换资产路径
  if (converted.assets && Array.isArray(converted.assets)) {
    converted.assets = converted.assets.map((asset) => {
      // 只转换本地文件路径（不是URL或特殊协议）
      if (
        asset.path &&
        !asset.path.startsWith("http://") &&
        !asset.path.startsWith("https://") &&
        !asset.path.startsWith("file://")
      ) {
        try {
          const relativePath = relative(projectDir, asset.path)
          // 如果路径已经是相对路径，保持不变
          if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
            return { ...asset, path: relativePath }
          }
        } catch (error) {
          // 转换失败，保持原路径
          console.warn(`无法转换路径 ${asset.path} 为相对路径:`, error)
        }
      }
      return asset
    })
  }

  return converted
}

/**
 * 将项目中的相对路径转换回绝对路径（基于项目文件位置）
 */
function convertToAbsolutePaths(
  project: TimelineProject,
  projectFilePath: string,
): TimelineProject {
  const projectDir = dirname(projectFilePath)

  // 创建项目副本以避免修改原对象
  const converted = { ...project }

  // 转换资产路径
  if (converted.assets && Array.isArray(converted.assets)) {
    converted.assets = converted.assets.map((asset) => {
      // 如果路径是相对路径，转换为绝对路径
      if (
        asset.path &&
        !asset.path.startsWith("http://") &&
        !asset.path.startsWith("https://") &&
        !asset.path.startsWith("file://")
      ) {
        try {
          // 检查是否是相对路径
          if (!isAbsolute(asset.path)) {
            const absolutePath = join(projectDir, asset.path)
            return { ...asset, path: absolutePath }
          }
        } catch (error) {
          // 转换失败，保持原路径
          console.warn(`无法转换路径 ${asset.path} 为绝对路径:`, error)
        }
      }
      return asset
    })
  }

  return converted
}

async function handleLoadProject(args: any): Promise<any> {
  if (!args.project_file) {
    return {
      title: "加载项目失败",
      metadata: { operation: "load_project", error: true },
      output: "❌ 请指定项目文件路径 (project_file 参数)",
    }
  }

  if (!existsSync(args.project_file)) {
    return {
      title: "加载项目失败",
      metadata: { operation: "load_project", error: true },
      output: `❌ 项目文件不存在: ${args.project_file}`,
    }
  }

  try {
    const content = readFileSync(args.project_file, "utf-8")
    const project = JSON.parse(content) as TimelineProject

    return {
      title: "项目加载成功",
      metadata: {
        operation: "load_project",
        error: false,
        success: true,
        project_id: project.id,
        project_name: project.name,
        project_file: args.project_file,
      },
      output:
        `✅ 项目 **${project.name}** 加载成功\n` +
        `📁 文件: ${args.project_file}\n` +
        `📅 创建时间: ${new Date(project.created).toLocaleString()}\n` +
        `📅 修改时间: ${new Date(project.modified).toLocaleString()}\n` +
        `🎬 时间线: ${project.timeline.name}\n` +
        `📊 轨道数量: ${project.timeline.tracks.length}\n` +
        `🎞️ 媒体资源: ${project.assets.length} 个`,
    }
  } catch (error: any) {
    return {
      title: "加载项目失败",
      metadata: { operation: "load_project", error: true },
      output: `❌ 加载失败: ${error.message}`,
    }
  }
}

async function handleSaveProject(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.project_file) {
    return {
      title: "保存项目失败",
      metadata: { operation: "save_project", error: true },
      output: "❌ 请指定项目文件路径 (project_file 参数)",
    }
  }

  // 更新修改时间
  project.modified = new Date().toISOString()

  try {
    writeFileSync(args.project_file, JSON.stringify(project, null, 2))

    return {
      title: "项目保存成功",
      metadata: {
        operation: "save_project",
        error: false,
        success: true,
        project_id: project.id,
        project_file: args.project_file,
      },
      output:
        `✅ 项目 **${project.name}** 保存成功\n` +
        `📁 文件: ${args.project_file}\n` +
        `📅 修改时间: ${new Date(project.modified).toLocaleString()}`,
    }
  } catch (error: any) {
    return {
      title: "保存项目失败",
      metadata: { operation: "save_project", error: true },
      output: `❌ 保存失败: ${error.message}`,
    }
  }
}

async function handleExportProject(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const exportPath =
    args.output_file || `${project.name}_export.${args.export_format || "json"}`

  try {
    let exportContent: string

    switch (args.export_format) {
      case "json":
        exportContent = JSON.stringify(project, null, 2)
        break
      case "xml":
        exportContent = generateXMLExport(project)
        break
      case "edl":
        exportContent = generateEDLExport(project)
        break
      default:
        exportContent = JSON.stringify(project, null, 2)
    }

    writeFileSync(exportPath, exportContent)

    return {
      title: "项目导出成功",
      metadata: {
        operation: "export_project",
        error: false,
        success: true,
        project_id: project.id,
        export_format: args.export_format || "json",
        export_path: exportPath,
      },
      output:
        `✅ 项目 **${project.name}** 导出成功\n` +
        `📁 文件: ${exportPath}\n` +
        `📊 格式: ${args.export_format || "json"}\n` +
        `🎬 包含: ${project.timeline.tracks.length} 个轨道, ${project.assets.length} 个媒体资源`,
    }
  } catch (error: any) {
    return {
      title: "项目导出失败",
      metadata: { operation: "export_project", error: true },
      output: `❌ 导出失败: ${error.message}`,
    }
  }
}

// ============================================================================
// 轨道操作处理器
// ============================================================================

async function handleAddTrack(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.track_type) {
    return {
      title: "添加轨道失败",
      metadata: { operation: "add_track", error: true },
      output: "❌ 请指定轨道类型 (track_type 参数)",
    }
  }

  const trackId = args.track_id || `track_${Date.now()}`
  const trackName =
    args.track_name ||
    `${args.track_type}轨道 ${project.timeline.tracks.length + 1}`

  let newTrack: Track

  switch (args.track_type) {
    case "video":
      newTrack = createDefaultVideoTrack(trackId, trackName)
      break
    case "audio":
      newTrack = createDefaultAudioTrack(trackId, trackName)
      break
    case "subtitle":
      newTrack = {
        id: trackId,
        type: "subtitle",
        name: trackName,
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
        clips: [],
        order: project.timeline.tracks.length,
      }
      break
    case "effect":
      newTrack = {
        id: trackId,
        type: "effect",
        name: trackName,
        locked: false,
        muted: false,
        visible: true,
        volume: 1,
        clips: [],
        order: project.timeline.tracks.length,
        effects: [],
      }
      break
    default:
      return {
        title: "添加轨道失败",
        metadata: { operation: "add_track", error: true },
        output: `❌ 不支持的轨道类型: ${args.track_type}`,
      }
  }

  project.timeline.tracks.push(newTrack)

  return {
    title: "轨道添加成功",
    metadata: {
      operation: "add_track",
      error: false,
      success: true,
      track_id: trackId,
      track_type: args.track_type,
      track_name: trackName,
    },
    output:
      `✅ 轨道 **${trackName}** 添加成功\n` +
      `📁 轨道ID: ${trackId}\n` +
      `🎬 类型: ${args.track_type}\n` +
      `📊 当前轨道总数: ${project.timeline.tracks.length}`,
  }
}

async function handleRemoveTrack(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.track_id) {
    return {
      title: "删除轨道失败",
      metadata: { operation: "remove_track", error: true },
      output: "❌ 请指定轨道ID (track_id 参数)",
    }
  }

  const trackIndex = project.timeline.tracks.findIndex(
    (t) => t.id === args.track_id,
  )

  if (trackIndex === -1) {
    return {
      title: "删除轨道失败",
      metadata: { operation: "remove_track", error: true },
      output: `❌ 找不到轨道: ${args.track_id}`,
    }
  }

  const track = project.timeline.tracks[trackIndex]

  // 检查轨道是否为空
  if (track.clips.length > 0) {
    return {
      title: "删除轨道失败",
      metadata: { operation: "remove_track", error: true },
      output:
        `❌ 轨道 **${track.name}** 包含 ${track.clips.length} 个剪辑，无法删除\n` +
        `请先移除所有剪辑或使用 force 参数`,
    }
  }

  project.timeline.tracks.splice(trackIndex, 1)

  return {
    title: "轨道删除成功",
    metadata: {
      operation: "remove_track",
      error: false,
      success: true,
      track_id: args.track_id,
      track_name: track.name,
    },
    output:
      `✅ 轨道 **${track.name}** 删除成功\n` +
      `📊 剩余轨道数量: ${project.timeline.tracks.length}`,
  }
}

async function handleMoveTrack(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.track_id) {
    return {
      title: "移动轨道失败",
      metadata: { operation: "move_track", error: true },
      output: "❌ 请指定轨道ID (track_id 参数)",
    }
  }

  if (args.track_position === undefined) {
    return {
      title: "移动轨道失败",
      metadata: { operation: "move_track", error: true },
      output: "❌ 请指定目标位置 (track_position 参数)",
    }
  }

  const trackIndex = project.timeline.tracks.findIndex(
    (t) => t.id === args.track_id,
  )

  if (trackIndex === -1) {
    return {
      title: "移动轨道失败",
      metadata: { operation: "move_track", error: true },
      output: `❌ 找不到轨道: ${args.track_id}`,
    }
  }

  const track = project.timeline.tracks[trackIndex]
  const newPosition = Math.max(
    0,
    Math.min(args.track_position, project.timeline.tracks.length - 1),
  )

  // 移除并重新插入
  project.timeline.tracks.splice(trackIndex, 1)
  project.timeline.tracks.splice(newPosition, 0, track)

  // 更新所有轨道的order
  project.timeline.tracks.forEach((t, index) => {
    t.order = index
  })

  return {
    title: "轨道移动成功",
    metadata: {
      operation: "move_track",
      error: false,
      success: true,
      track_id: args.track_id,
      track_name: track.name,
      old_position: trackIndex,
      new_position: newPosition,
    },
    output:
      `✅ 轨道 **${track.name}** 移动成功\n` +
      `📊 从位置 ${trackIndex} 移动到 ${newPosition}`,
  }
}

async function handleUpdateTrack(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.track_id) {
    return {
      title: "更新轨道失败",
      metadata: { operation: "update_track", error: true },
      output: "❌ 请指定轨道ID (track_id 参数)",
    }
  }

  const trackIndex = project.timeline.tracks.findIndex(
    (t) => t.id === args.track_id,
  )
  if (trackIndex === -1) {
    return {
      title: "更新轨道失败",
      metadata: { operation: "update_track", error: true },
      output: `❌ 找不到轨道: ${args.track_id}`,
    }
  }

  const track = project.timeline.tracks[trackIndex]
  const originalTrack = { ...track }
  const updates: string[] = []

  // 更新锁定状态
  if (args.track_locked !== undefined) {
    track.locked = args.track_locked
    updates.push(`锁定: ${args.track_locked ? "是" : "否"}`)
  }

  // 更新可见性（仅视频/字幕轨道）
  if (args.track_visible !== undefined) {
    if (track.type === "video" || track.type === "subtitle") {
      track.visible = args.track_visible
      updates.push(`可见: ${args.track_visible ? "是" : "否"}`)
    } else {
      return {
        title: "更新轨道失败",
        metadata: { operation: "update_track", error: true },
        output: `❌ 轨道类型 ${track.type} 不支持可见性设置`,
      }
    }
  }

  // 更新静音状态
  if (args.track_muted !== undefined) {
    track.muted = args.track_muted
    updates.push(`静音: ${args.track_muted ? "是" : "否"}`)
  }

  // 更新音量（仅音频轨道）
  if (args.track_volume !== undefined) {
    if (track.type === "audio") {
      const volume = Math.max(0, Math.min(1, args.track_volume))
      track.volume = volume
      updates.push(`音量: ${(volume * 100).toFixed(0)}%`)
    } else {
      return {
        title: "更新轨道失败",
        metadata: { operation: "update_track", error: true },
        output: `❌ 轨道类型 ${track.type} 不支持音量设置`,
      }
    }
  }

  // 更新声像平衡（仅音频轨道）
  if (args.track_pan !== undefined) {
    if (track.type === "audio") {
      const pan = Math.max(-1, Math.min(1, args.track_pan))
      track.pan = pan
      updates.push(`声像: ${pan.toFixed(2)}`)
    } else {
      return {
        title: "更新轨道失败",
        metadata: { operation: "update_track", error: true },
        output: `❌ 轨道类型 ${track.type} 不支持声像平衡设置`,
      }
    }
  }

  // 更新不透明度（仅视频轨道）
  if (args.track_opacity !== undefined) {
    if (track.type === "video") {
      const opacity = Math.max(0, Math.min(1, args.track_opacity))
      track.opacity = opacity
      updates.push(`不透明度: ${(opacity * 100).toFixed(0)}%`)
    } else {
      return {
        title: "更新轨道失败",
        metadata: { operation: "update_track", error: true },
        output: `❌ 轨道类型 ${track.type} 不支持不透明度设置`,
      }
    }
  }

  // 检查是否至少更新了一个属性
  if (updates.length === 0) {
    return {
      title: "更新轨道失败",
      metadata: { operation: "update_track", error: true },
      output: "❌ 未指定任何更新参数",
    }
  }

  // 更新轨道
  project.timeline.tracks[trackIndex] = track

  return {
    title: "轨道更新成功",
    metadata: {
      operation: "update_track",
      error: false,
      success: true,
      track_id: args.track_id,
      track_name: track.name,
      updates: updates,
      original_state: {
        locked: originalTrack.locked,
        muted: originalTrack.muted,
        visible: originalTrack.visible,
        volume: originalTrack.volume,
        ...(originalTrack.type === "audio"
          ? { pan: (originalTrack as AudioTrack).pan }
          : {}),
        ...(originalTrack.type === "video"
          ? { opacity: (originalTrack as VideoTrack).opacity }
          : {}),
      },
      new_state: {
        locked: track.locked,
        muted: track.muted,
        visible: track.visible,
        volume: track.volume,
        ...(track.type === "audio" ? { pan: (track as AudioTrack).pan } : {}),
        ...(track.type === "video"
          ? { opacity: (track as VideoTrack).opacity }
          : {}),
      },
    },
    output:
      `✅ 轨道 **${track.name}** 更新成功\n` +
      `📊 更新内容:\n` +
      updates.map((update) => `  • ${update}`).join("\n"),
  }
}

async function handleListTracks(
  args: any,
  project: TimelineProject,
): Promise<any> {
  let output = "📊 **时间线轨道列表**\n\n"

  project.timeline.tracks.forEach((track, index) => {
    output += `### ${index + 1}. ${track.name} (\`${track.id}\`)\n`
    output += `🎬 类型: ${track.type}\n`
    output += `📊 剪辑数量: ${track.clips.length}\n`
    output += `🔒 锁定: ${track.locked ? "是" : "否"} | 🔊 静音: ${track.muted ? "是" : "否"}\n`
    if (track.type === "video") {
      output += `🎨 不透明度: ${(track.opacity * 100).toFixed(0)}%\n`
    }
    if (track.type === "audio") {
      output += `🎵 音量: ${(track.volume * 100).toFixed(0)}% | 🔊 声像: ${track.pan}\n`
    }
    output += `\n`
  })

  output += `📈 总计: ${project.timeline.tracks.length} 个轨道`

  return {
    title: "轨道列表",
    metadata: {
      operation: "list_tracks",
      error: false,
      success: true,
      track_count: project.timeline.tracks.length,
    },
    output,
  }
}

// ============================================================================
// 剪辑操作处理器
// ============================================================================

async function handleAddClip(
  args: any,
  project: TimelineProject,
): Promise<any> {
  // 验证必要参数
  const missingParams: string[] = []
  if (!args.track_id_for_clip) missingParams.push("track_id_for_clip")
  if (!args.asset_id) missingParams.push("asset_id")
  if (!args.clip_type) missingParams.push("clip_type")
  if (args.start_time === undefined) missingParams.push("start_time")
  if (args.duration === undefined) missingParams.push("duration")

  if (missingParams.length > 0) {
    return {
      title: "添加剪辑失败",
      metadata: { operation: "add_clip", error: true },
      output: `❌ 缺少必要参数: ${missingParams.join(", ")}`,
    }
  }

  // 查找目标轨道
  const track = project.timeline.tracks.find(
    (t) => t.id === args.track_id_for_clip,
  )
  if (!track) {
    return {
      title: "添加剪辑失败",
      metadata: { operation: "add_clip", error: true },
      output: `❌ 找不到目标轨道: ${args.track_id_for_clip}`,
    }
  }

  // 检查轨道类型是否匹配
  if (
    track.type !== args.clip_type &&
    !(track.type === "video" && args.clip_type === "image")
  ) {
    return {
      title: "添加剪辑失败",
      metadata: { operation: "add_clip", error: true },
      output: `❌ 轨道类型不匹配: 轨道是 ${track.type}，剪辑是 ${args.clip_type}`,
    }
  }

  // 创建剪辑ID
  const clipId = args.clip_id || `clip_${Date.now()}`
  const offset = args.offset || 0

  // 创建剪辑对象
  let newClip: Clip

  switch (args.clip_type) {
    case "video":
      newClip = createDefaultVideoClip(clipId, args.asset_id)
      break
    case "audio":
      newClip = createDefaultAudioClip(clipId, args.asset_id)
      break
    case "image":
      newClip = {
        id: clipId,
        type: "image",
        assetId: args.asset_id,
        startTime: args.start_time,
        duration: args.duration,
        offset,
        muted: false,
        locked: false,
        volume: 1,
        position: { x: 0.5, y: 0.5 },
        size: { width: 1, height: 1 },
        rotation: 0,
        opacity: 1,
      }
      break
    case "subtitle":
      newClip = {
        id: clipId,
        type: "subtitle",
        assetId: args.asset_id,
        startTime: args.start_time,
        duration: args.duration,
        offset,
        muted: false,
        locked: false,
        volume: 1,
        text: "字幕文本",
        style: {
          fontFamily: "Arial",
          fontSize: 48,
          fontWeight: "bold",
          fontStyle: "normal",
          color: "#FFFFFF",
          backgroundColor: "transparent",
          borderColor: "#000000",
          borderWidth: 2,
          shadowColor: "rgba(0,0,0,0.5)",
          shadowBlur: 4,
          shadowOffsetX: 2,
          shadowOffsetY: 2,
          alignment: "center",
          verticalAlignment: "bottom",
        },
        position: { x: 0.5, y: 0.8 },
      }
      break
    default:
      return {
        title: "添加剪辑失败",
        metadata: { operation: "add_clip", error: true },
        output: `❌ 不支持的剪辑类型: ${args.clip_type}`,
      }
  }

  // 设置剪辑时间
  newClip.startTime = args.start_time
  newClip.duration = args.duration
  newClip.offset = offset

  // 检查时间重叠
  const overlappingClip = track.clips.find((c) => {
    const cStart = c.startTime
    const cEnd = c.startTime + c.duration
    const nStart = newClip.startTime
    const nEnd = newClip.startTime + newClip.duration
    return nStart < cEnd && nEnd > cStart
  })

  if (overlappingClip && !args.parameters?.allow_overlap) {
    return {
      title: "添加剪辑失败",
      metadata: { operation: "add_clip", error: true },
      output:
        `❌ 剪辑时间与现有剪辑重叠\n` +
        `现有剪辑: ${overlappingClip.id} (${secondsToTimecode(overlappingClip.startTime)} - ${secondsToTimecode(overlappingClip.startTime + overlappingClip.duration)})\n` +
        `新剪辑: ${secondsToTimecode(newClip.startTime)} - ${secondsToTimecode(newClip.startTime + newClip.duration)}`,
    }
  }

  // 添加剪辑到轨道
  track.clips.push(newClip)
  track.clips.sort((a, b) => a.startTime - b.startTime)

  return {
    title: "剪辑添加成功",
    metadata: {
      operation: "add_clip",
      error: false,
      success: true,
      clip_id: clipId,
      clip_type: args.clip_type,
      track_id: args.track_id_for_clip,
      start_time: args.start_time,
      duration: args.duration,
    },
    output:
      `✅ 剪辑 **${clipId}** 添加成功\n` +
      `🎬 类型: ${args.clip_type}\n` +
      `📁 轨道: ${track.name}\n` +
      `⏱️ 时间: ${secondsToTimecode(args.start_time)} - ${secondsToTimecode(args.start_time + args.duration)}\n` +
      `📊 轨道剪辑数量: ${track.clips.length}`,
  }
}

async function handleRemoveClip(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (!args.clip_id) {
    return {
      title: "删除剪辑失败",
      metadata: { operation: "remove_clip", error: true },
      output: "❌ 请指定剪辑ID (clip_id 参数)",
    }
  }

  // 查找剪辑所在轨道
  let found = false
  let trackName = ""
  let clipType = ""

  for (const track of project.timeline.tracks) {
    const clipIndex = track.clips.findIndex((c) => c.id === args.clip_id)
    if (clipIndex !== -1) {
      const clip = track.clips[clipIndex]
      track.clips.splice(clipIndex, 1)
      found = true
      trackName = track.name
      clipType = clip.type
      break
    }
  }

  if (!found) {
    return {
      title: "删除剪辑失败",
      metadata: { operation: "remove_clip", error: true },
      output: `❌ 找不到剪辑: ${args.clip_id}`,
    }
  }

  return {
    title: "剪辑删除成功",
    metadata: {
      operation: "remove_clip",
      error: false,
      success: true,
      clip_id: args.clip_id,
    },
    output:
      `✅ 剪辑 **${args.clip_id}** 删除成功\n` +
      `🎬 类型: ${clipType}\n` +
      `📁 从轨道: ${trackName}`,
  }
}

async function handleMoveClip(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const missingParams: string[] = []
  if (!args.clip_id) missingParams.push("clip_id")
  if (!args.track_id_for_clip) missingParams.push("track_id_for_clip")
  if (args.start_time === undefined) missingParams.push("start_time")

  if (missingParams.length > 0) {
    return {
      title: "移动剪辑失败",
      metadata: { operation: "move_clip", error: true },
      output: `❌ 缺少必要参数: ${missingParams.join(", ")}`,
    }
  }

  // 查找剪辑所在轨道
  let sourceTrack: Track | null = null
  let clipIndex = -1
  let clip: Clip | null = null

  for (const track of project.timeline.tracks) {
    const idx = track.clips.findIndex((c) => c.id === args.clip_id)
    if (idx !== -1) {
      sourceTrack = track
      clipIndex = idx
      clip = track.clips[idx]
      break
    }
  }

  if (!sourceTrack || !clip) {
    return {
      title: "移动剪辑失败",
      metadata: { operation: "move_clip", error: true },
      output: `❌ 找不到剪辑: ${args.clip_id}`,
    }
  }

  // 查找目标轨道
  const targetTrack = project.timeline.tracks.find(
    (t) => t.id === args.track_id_for_clip,
  )
  if (!targetTrack) {
    return {
      title: "移动剪辑失败",
      metadata: { operation: "move_clip", error: true },
      output: `❌ 找不到目标轨道: ${args.track_id_for_clip}`,
    }
  }

  // 检查轨道类型是否匹配
  if (
    targetTrack.type !== clip.type &&
    !(targetTrack.type === "video" && clip.type === "image")
  ) {
    return {
      title: "移动剪辑失败",
      metadata: { operation: "move_clip", error: true },
      output: `❌ 轨道类型不匹配: 轨道是 ${targetTrack.type}，剪辑是 ${clip.type}`,
    }
  }

  // 检查时间重叠（在目标轨道中）
  const newStartTime = args.start_time
  const newEndTime = newStartTime + clip.duration

  const overlappingClip = targetTrack.clips.find((c) => {
    if (c.id === clip!.id) return false // 排除自身
    const cStart = c.startTime
    const cEnd = c.startTime + c.duration
    return newStartTime < cEnd && newEndTime > cStart
  })

  if (overlappingClip && !args.parameters?.allow_overlap) {
    return {
      title: "移动剪辑失败",
      metadata: { operation: "move_clip", error: true },
      output:
        `❌ 目标位置与现有剪辑重叠\n` +
        `现有剪辑: ${overlappingClip.id} (${secondsToTimecode(overlappingClip.startTime)} - ${secondsToTimecode(overlappingClip.startTime + overlappingClip.duration)})\n` +
        `新位置: ${secondsToTimecode(newStartTime)} - ${secondsToTimecode(newEndTime)}`,
    }
  }

  // 移动剪辑
  sourceTrack.clips.splice(clipIndex, 1)
  clip.startTime = newStartTime
  targetTrack.clips.push(clip)
  targetTrack.clips.sort((a, b) => a.startTime - b.startTime)

  return {
    title: "剪辑移动成功",
    metadata: {
      operation: "move_clip",
      error: false,
      success: true,
      clip_id: args.clip_id,
      old_track_id: sourceTrack.id,
      new_track_id: targetTrack.id,
      new_start_time: newStartTime,
    },
    output:
      `✅ 剪辑 **${args.clip_id}** 移动成功\n` +
      `📁 从轨道: ${sourceTrack.name} → 到轨道: ${targetTrack.name}\n` +
      `⏱️ 新时间: ${secondsToTimecode(newStartTime)} - ${secondsToTimecode(newEndTime)}`,
  }
}

async function handleTrimClip(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const missingParams: string[] = []
  if (!args.clip_id) missingParams.push("clip_id")

  if (missingParams.length > 0) {
    return {
      title: "剪辑修剪失败",
      metadata: { operation: "trim_clip", error: true },
      output: `❌ 缺少必要参数: ${missingParams.join(", ")}`,
    }
  }

  // 查找剪辑所在轨道
  let targetTrack: Track | null = null
  let clipIndex = -1
  let originalClip: Clip | null = null

  for (const track of project.timeline.tracks) {
    const idx = track.clips.findIndex((c) => c.id === args.clip_id)
    if (idx !== -1) {
      targetTrack = track
      clipIndex = idx
      originalClip = track.clips[idx]
      break
    }
  }

  if (!targetTrack || !originalClip) {
    return {
      title: "剪辑修剪失败",
      metadata: { operation: "trim_clip", error: true },
      output: `❌ 找不到剪辑: ${args.clip_id}`,
    }
  }

  const clipStart = originalClip.startTime
  const clipEnd = originalClip.startTime + originalClip.duration
  let newStartTime = clipStart
  let newEndTime = clipEnd
  let newOffset = originalClip.offset

  // 检查修剪参数
  const hasTrimStart = args.trim_start !== undefined
  const hasTrimEnd = args.trim_end !== undefined
  const hasNewStart = args.new_start_time !== undefined
  const hasNewEnd = args.new_end_time !== undefined

  // 验证参数组合
  if ((hasTrimStart || hasTrimEnd) && (hasNewStart || hasNewEnd)) {
    return {
      title: "剪辑修剪失败",
      metadata: { operation: "trim_clip", error: true },
      output:
        "❌ 参数冲突: 不能同时使用 trim_start/trim_end 和 new_start_time/new_end_time",
    }
  }

  if (!hasTrimStart && !hasTrimEnd && !hasNewStart && !hasNewEnd) {
    return {
      title: "剪辑修剪失败",
      metadata: { operation: "trim_clip", error: true },
      output:
        "❌ 需要指定修剪参数: trim_start/trim_end 或 new_start_time/new_end_time",
    }
  }

  if (hasTrimStart || hasTrimEnd) {
    // 使用 trim_start/trim_end 方式
    const trimStart = args.trim_start || 0
    const trimEnd = args.trim_end || 0

    if (trimStart < 0 || trimEnd < 0) {
      return {
        title: "剪辑修剪失败",
        metadata: { operation: "trim_clip", error: true },
        output: "❌ 修剪时长不能为负数",
      }
    }

    if (trimStart + trimEnd >= originalClip.duration) {
      return {
        title: "剪辑修剪失败",
        metadata: { operation: "trim_clip", error: true },
        output:
          `❌ 修剪总时长超过剪辑时长\n` +
          `剪辑时长: ${secondsToTimecode(originalClip.duration)}\n` +
          `修剪开始: ${secondsToTimecode(trimStart)}\n` +
          `修剪结束: ${secondsToTimecode(trimEnd)}`,
      }
    }

    newStartTime = clipStart + trimStart
    newEndTime = clipEnd - trimEnd
    newOffset = originalClip.offset + trimStart
  } else {
    // 使用 new_start_time/new_end_time 方式
    if (hasNewStart) {
      newStartTime = args.new_start_time
      if (newStartTime < clipStart) {
        return {
          title: "剪辑修剪失败",
          metadata: { operation: "trim_clip", error: true },
          output:
            `❌ 新的开始时间不能早于原始开始时间\n` +
            `原始开始: ${secondsToTimecode(clipStart)}\n` +
            `新开始: ${secondsToTimecode(newStartTime)}`,
        }
      }
      newOffset = originalClip.offset + (newStartTime - clipStart)
    }

    if (hasNewEnd) {
      newEndTime = args.new_end_time
      if (newEndTime > clipEnd) {
        return {
          title: "剪辑修剪失败",
          metadata: { operation: "trim_clip", error: true },
          output:
            `❌ 新的结束时间不能晚于原始结束时间\n` +
            `原始结束: ${secondsToTimecode(clipEnd)}\n` +
            `新结束: ${secondsToTimecode(newEndTime)}`,
        }
      }
    }

    if (newStartTime >= newEndTime) {
      return {
        title: "剪辑修剪失败",
        metadata: { operation: "trim_clip", error: true },
        output:
          `❌ 开始时间必须早于结束时间\n` +
          `开始时间: ${secondsToTimecode(newStartTime)}\n` +
          `结束时间: ${secondsToTimecode(newEndTime)}`,
      }
    }
  }

  // 更新剪辑
  const newDuration = newEndTime - newStartTime
  const updatedClip: Clip = {
    ...originalClip,
    startTime: newStartTime,
    duration: newDuration,
    offset: newOffset,
  }

  targetTrack.clips[clipIndex] = updatedClip

  return {
    title: "剪辑修剪成功",
    metadata: {
      operation: "trim_clip",
      error: false,
      success: true,
      clip_id: args.clip_id,
      original_start: clipStart,
      original_end: clipEnd,
      original_duration: originalClip.duration,
      new_start: newStartTime,
      new_end: newEndTime,
      new_duration: newDuration,
      new_offset: newOffset,
    },
    output:
      `✅ 剪辑 **${args.clip_id}** 修剪成功\n` +
      `📏 原始时长: ${secondsToTimecode(originalClip.duration)}\n` +
      `📏 新时长: ${secondsToTimecode(newDuration)}\n` +
      `⏱️ 原始时间: ${secondsToTimecode(clipStart)} - ${secondsToTimecode(clipEnd)}\n` +
      `⏱️ 新时间: ${secondsToTimecode(newStartTime)} - ${secondsToTimecode(newEndTime)}\n` +
      `📍 新偏移: ${secondsToTimecode(newOffset)}\n` +
      `📁 轨道: ${targetTrack.name}`,
  }
}

async function handleSplitClip(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const missingParams: string[] = []
  if (!args.clip_id) missingParams.push("clip_id")
  if (args.split_time === undefined) missingParams.push("split_time")

  if (missingParams.length > 0) {
    return {
      title: "剪辑分割失败",
      metadata: { operation: "split_clip", error: true },
      output: `❌ 缺少必要参数: ${missingParams.join(", ")}`,
    }
  }

  const splitTime = args.split_time

  // 查找剪辑所在轨道
  let targetTrack: Track | null = null
  let clipIndex = -1
  let originalClip: Clip | null = null

  for (const track of project.timeline.tracks) {
    const idx = track.clips.findIndex((c) => c.id === args.clip_id)
    if (idx !== -1) {
      targetTrack = track
      clipIndex = idx
      originalClip = track.clips[idx]
      break
    }
  }

  if (!targetTrack || !originalClip) {
    return {
      title: "剪辑分割失败",
      metadata: { operation: "split_clip", error: true },
      output: `❌ 找不到剪辑: ${args.clip_id}`,
    }
  }

  // 验证分割时间点
  const clipStart = originalClip.startTime
  const clipEnd = originalClip.startTime + originalClip.duration

  if (splitTime <= clipStart || splitTime >= clipEnd) {
    return {
      title: "剪辑分割失败",
      metadata: { operation: "split_clip", error: true },
      output:
        `❌ 分割时间点必须在剪辑时间范围内\n` +
        `剪辑时间: ${secondsToTimecode(clipStart)} - ${secondsToTimecode(clipEnd)}\n` +
        `分割时间: ${secondsToTimecode(splitTime)}`,
    }
  }

  // 计算两个新剪辑的参数
  const firstDuration = splitTime - clipStart
  const secondDuration = clipEnd - splitTime

  // 创建第一个剪辑（原始剪辑的前半部分）
  const firstClip: Clip = {
    ...originalClip,
    id: `${originalClip.id}_part1`,
    duration: firstDuration,
    // offset 保持不变
  }

  // 创建第二个剪辑（原始剪辑的后半部分）
  const secondClip: Clip = {
    ...originalClip,
    id: `${originalClip.id}_part2`,
    startTime: splitTime,
    duration: secondDuration,
    offset: originalClip.offset + firstDuration,
  }

  // 替换原始剪辑为两个新剪辑
  targetTrack.clips.splice(clipIndex, 1, firstClip, secondClip)
  // 按开始时间排序
  targetTrack.clips.sort((a, b) => a.startTime - b.startTime)

  return {
    title: "剪辑分割成功",
    metadata: {
      operation: "split_clip",
      error: false,
      success: true,
      original_clip_id: args.clip_id,
      split_time: splitTime,
      new_clip_ids: [firstClip.id, secondClip.id],
      first_clip_duration: firstDuration,
      second_clip_duration: secondDuration,
    },
    output:
      `✅ 剪辑 **${args.clip_id}** 分割成功\n` +
      `✂️ 分割时间点: ${secondsToTimecode(splitTime)}\n` +
      `📏 第一部分: ${secondsToTimecode(firstDuration)} (ID: ${firstClip.id})\n` +
      `📏 第二部分: ${secondsToTimecode(secondDuration)} (ID: ${secondClip.id})\n` +
      `📁 轨道: ${targetTrack.name}`,
  }
}

async function handleListClips(
  args: any,
  project: TimelineProject,
): Promise<any> {
  let output = "🎬 **时间线剪辑列表**\n\n"

  project.timeline.tracks.forEach((track) => {
    if (track.clips.length > 0) {
      output += `### 📁 ${track.name} (${track.type})\n`

      track.clips.forEach((clip) => {
        output += `- **${clip.id}** (${clip.type})\n`
        output += `  ⏱️ 时间: ${secondsToTimecode(clip.startTime)} - ${secondsToTimecode(clip.startTime + clip.duration)}\n`
        output += `  📏 时长: ${clip.duration.toFixed(2)} 秒\n`
        output += `  📍 偏移: ${clip.offset.toFixed(2)} 秒\n`
        output += `  🔊 音量: ${(clip.volume * 100).toFixed(0)}%\n`
      })

      output += `\n`
    }
  })

  // 计算统计数据
  const totalClips = project.timeline.tracks.reduce(
    (sum, track) => sum + track.clips.length,
    0,
  )
  const totalDuration = getTimelineDuration(project.timeline)

  output += `📊 **统计**\n`
  output += `• 总剪辑数: ${totalClips}\n`
  output += `• 时间线总时长: ${secondsToTimecode(totalDuration)}\n`
  output += `• 轨道数量: ${project.timeline.tracks.length}`

  return {
    title: "剪辑列表",
    metadata: {
      operation: "list_clips",
      error: false,
      success: true,
      total_clips: totalClips,
      timeline_duration: totalDuration,
    },
    output,
  }
}

// ============================================================================
// 过渡操作处理器 (简化实现)
// ============================================================================

async function handleAddTransition(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "添加过渡功能",
    metadata: { operation: "add_transition", error: false, success: true },
    output:
      "🎞️ 添加过渡功能需要完整实现\n" +
      "请指定: transition_type, start_clip_id, end_clip_id, transition_duration\n" +
      "支持的类型: dissolve, fade-to-black, wipe-left, 等",
  }
}

async function handleRemoveTransition(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "删除过渡功能",
    metadata: { operation: "remove_transition", error: false, success: true },
    output: "🗑️ 删除过渡功能需要完整实现\n" + "请指定: transition_id",
  }
}

async function handleListTransitions(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "过渡列表",
    metadata: { operation: "list_transitions", error: false, success: true },
    output:
      "🎞️ 时间线过渡列表\n" +
      "当前项目暂无过渡效果\n" +
      "使用 add_transition 操作添加过渡",
  }
}

// ============================================================================
// 特效操作处理器 (简化实现)
// ============================================================================

async function handleAddEffect(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "添加特效功能",
    metadata: { operation: "add_effect", error: false, success: true },
    output:
      "🎭 添加特效功能需要完整实现\n" +
      "请指定: effect_type, target_clip_id, parameters\n" +
      "支持的类型: chroma-key, picture-in-picture, split-screen, 等",
  }
}

async function handleRemoveEffect(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "删除特效功能",
    metadata: { operation: "remove_effect", error: false, success: true },
    output: "🗑️ 删除特效功能需要完整实现\n" + "请指定: effect_id",
  }
}

async function handleListEffects(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "特效列表",
    metadata: { operation: "list_effects", error: false, success: true },
    output:
      "🎭 时间线特效列表\n" +
      "当前项目暂无特效\n" +
      "使用 add_effect 操作添加特效",
  }
}

// ============================================================================
// 滤镜操作处理器 (简化实现)
// ============================================================================

async function handleAddFilter(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "添加滤镜功能",
    metadata: { operation: "add_filter", error: false, success: true },
    output:
      "🎨 添加滤镜功能需要完整实现\n" +
      "请指定: filter_type, filter_clip_id, parameters\n" +
      "支持的类型: blur, sharpen, glow, vignette, grain, lut, 等",
  }
}

async function handleRemoveFilter(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "删除滤镜功能",
    metadata: { operation: "remove_filter", error: false, success: true },
    output: "🗑️ 删除滤镜功能需要完整实现\n" + "请指定: filter_id",
  }
}

async function handleListFilters(
  args: any,
  project: TimelineProject,
): Promise<any> {
  return {
    title: "滤镜列表",
    metadata: { operation: "list_filters", error: false, success: true },
    output:
      "🎨 时间线滤镜列表\n" +
      "当前项目暂无滤镜\n" +
      "使用 add_filter 操作添加滤镜",
  }
}

// ============================================================================
// 时间线信息处理器
// ============================================================================

async function handleSetCurrentTime(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (args.current_time === undefined) {
    return {
      title: "设置当前时间失败",
      metadata: { operation: "set_current_time", error: true },
      output: "❌ 请指定当前时间 (current_time 参数)",
    }
  }

  const newTime = args.current_time
  const timelineDuration = getTimelineDuration(project.timeline)

  if (newTime < 0 || newTime > timelineDuration) {
    return {
      title: "设置当前时间失败",
      metadata: { operation: "set_current_time", error: true },
      output:
        `❌ 当前时间必须在时间线范围内\n` +
        `时间线范围: 0 - ${secondsToTimecode(timelineDuration)}\n` +
        `指定时间: ${secondsToTimecode(newTime)}`,
    }
  }

  const oldTime = project.timeline.currentTime
  project.timeline.currentTime = newTime

  return {
    title: "当前时间设置成功",
    metadata: {
      operation: "set_current_time",
      error: false,
      success: true,
      old_time: oldTime,
      new_time: newTime,
      timeline_duration: timelineDuration,
    },
    output:
      `✅ 当前时间设置成功\n` +
      `⏱️ 从: ${secondsToTimecode(oldTime)}\n` +
      `⏱️ 到: ${secondsToTimecode(newTime)}\n` +
      `📏 时间线总时长: ${secondsToTimecode(timelineDuration)}`,
  }
}

async function handleGetTimelineZoom(
  args: any,
  project: TimelineProject,
): Promise<any> {
  // 从项目设置中获取缩放级别，如果不存在则使用默认值
  const zoomLevel = project.settings.zoomLevel || 1.0

  return {
    title: "时间线缩放级别",
    metadata: {
      operation: "get_timeline_zoom",
      error: false,
      success: true,
      zoom_level: zoomLevel,
    },
    output:
      `🔍 时间线缩放级别: ${(zoomLevel * 100).toFixed(0)}%\n` +
      `📏 显示比例: 1 像素 ≈ ${(1 / zoomLevel).toFixed(2)} 秒`,
  }
}

async function handleSetTimelineZoom(
  args: any,
  project: TimelineProject,
): Promise<any> {
  if (args.zoom_level === undefined) {
    return {
      title: "设置缩放级别失败",
      metadata: { operation: "set_timeline_zoom", error: true },
      output: "❌ 请指定缩放级别 (zoom_level 参数)",
    }
  }

  const newZoom = args.zoom_level
  const minZoom = 0.1 // 10%
  const maxZoom = 10.0 // 1000%

  if (newZoom < minZoom || newZoom > maxZoom) {
    return {
      title: "设置缩放级别失败",
      metadata: { operation: "set_timeline_zoom", error: true },
      output:
        `❌ 缩放级别必须在 ${minZoom} (${minZoom * 100}%) 到 ${maxZoom} (${maxZoom * 100}%) 之间\n` +
        `指定级别: ${newZoom} (${(newZoom * 100).toFixed(0)}%)`,
    }
  }

  const oldZoom = project.settings.zoomLevel || 1.0
  // 将缩放级别存储到项目设置中
  project.settings.zoomLevel = newZoom

  return {
    title: "缩放级别设置成功",
    metadata: {
      operation: "set_timeline_zoom",
      error: false,
      success: true,
      old_zoom: oldZoom,
      new_zoom: newZoom,
    },
    output:
      `✅ 时间线缩放级别设置成功\n` +
      `🔍 从: ${(oldZoom * 100).toFixed(0)}%\n` +
      `🔍 到: ${(newZoom * 100).toFixed(0)}%\n` +
      `📏 显示比例: 1 像素 ≈ ${(1 / newZoom).toFixed(2)} 秒`,
  }
}

async function handleGetTimelineInfo(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const timeline = project.timeline
  const totalDuration = getTimelineDuration(timeline)
  const totalClips = timeline.tracks.reduce(
    (sum, track) => sum + track.clips.length,
    0,
  )

  const validation = validateTimeline(timeline)

  let output = "📊 **时间线信息**\n\n"
  output += `### 项目信息\n`
  output += `• 项目: ${project.name}\n`
  output += `• 时间线: ${timeline.name}\n`
  output += `• 创建: ${new Date(project.created).toLocaleString()}\n`
  output += `• 修改: ${new Date(project.modified).toLocaleString()}\n\n`

  output += `### 时间线状态\n`
  output += `• 当前时间: ${secondsToTimecode(timeline.currentTime)}\n`
  output += `• 总时长: ${secondsToTimecode(totalDuration)}\n`
  output += `• 轨道数量: ${timeline.tracks.length}\n`
  output += `• 剪辑总数: ${totalClips}\n`
  output += `• 过渡数量: ${timeline.transitions.length}\n`
  output += `• 标记数量: ${timeline.markers.length}\n\n`

  output += `### 轨道统计\n`
  timeline.tracks.forEach((track) => {
    output += `• ${track.name}: ${track.clips.length} 个剪辑 (${track.type})\n`
  })

  output += `\n### 验证状态\n`
  output += validation.valid
    ? `✅ 时间线结构有效\n`
    : `❌ 时间线结构有 ${validation.errors.length} 个问题\n`
  if (!validation.valid && validation.errors.length > 0) {
    output += `问题列表:\n`
    validation.errors.forEach((error) => {
      output += `• ${error}\n`
    })
  }

  return {
    title: "时间线信息",
    metadata: {
      operation: "get_timeline_info",
      error: false,
      success: true,
      project_id: project.id,
      timeline_name: timeline.name,
      timeline_duration: totalDuration,
      track_count: timeline.tracks.length,
      clip_count: totalClips,
      valid: validation.valid,
    },
    output,
  }
}

async function handleValidateTimeline(
  args: any,
  project: TimelineProject,
): Promise<any> {
  const validation = validateTimeline(project.timeline)

  let output = "🔍 **时间线验证结果**\n\n"
  output += validation.valid
    ? `✅ 时间线结构有效\n`
    : `❌ 时间线结构有 ${validation.errors.length} 个问题\n\n`

  if (!validation.valid && validation.errors.length > 0) {
    output += `### 发现的问题\n`
    validation.errors.forEach((error, index) => {
      output += `${index + 1}. ${error}\n`
    })
  }

  output += `\n### 验证详情\n`
  output += `• 时间线: ${project.timeline.name}\n`
  output += `• 轨道数量: ${project.timeline.tracks.length}\n`
  output += `• 剪辑总数: ${project.timeline.tracks.reduce((sum, track) => sum + track.clips.length, 0)}\n`
  output += `• 过渡数量: ${project.timeline.transitions.length}`

  return {
    title: "时间线验证",
    metadata: {
      operation: "validate_timeline",
      error: false,
      success: true,
      valid: validation.valid,
      error_count: validation.errors.length,
    },
    output,
  }
}

async function handleRenderPreview(
  args: any,
  project: TimelineProject,
  ctx: any,
): Promise<any> {
  try {
    console.log("[TimelineEditorTool] 开始渲染时间线预览")

    // 获取时间线渲染器工具
    const rendererTool = await toolRegistry.getInitializedTool(
      "timeline_renderer",
      { agent: ctx.agent },
    )
    if (!rendererTool) {
      return {
        title: "渲染预览失败",
        metadata: { operation: "render_preview", error: true, success: false },
        output: "❌ 无法加载时间线渲染器工具",
      }
    }

    // 准备渲染参数
    const renderArgs = {
      project_data: project,
      render_mode: "preview",
      preview_only: true, // 只生成计划，不实际执行
      output_path:
        args.output_file || `timeline_preview_${project.id}_${Date.now()}.mp4`,
      use_batch_queue: false, // 预览模式下不使用批处理
    }

    // 调用渲染器工具
    const result = await rendererTool.execute(renderArgs, ctx)

    // 检查结果
    if (result.metadata.error) {
      return {
        title: "渲染预览失败",
        metadata: { operation: "render_preview", error: true, success: false },
        output: `❌ 渲染预览失败: ${result.output}`,
      }
    }

    // 返回渲染计划
    return {
      title: "渲染预览生成完成",
      metadata: { operation: "render_preview", error: false, success: true },
      output:
        result.output +
        "\n\n" +
        "📋 这是渲染计划预览，要实际执行渲染，请使用 timeline_renderer 工具。\n" +
        "💡 完整渲染命令示例:\n" +
        "```\n" +
        "timeline_renderer operation=render " +
        `project_data='${JSON.stringify(project)}' ` +
        `output_path=${renderArgs.output_path}\n` +
        "```",
    }
  } catch (error: any) {
    console.error("[TimelineEditorTool] 渲染预览失败:", error)
    return {
      title: "渲染预览失败",
      metadata: { operation: "render_preview", error: true, success: false },
      output: `❌ 渲染预览过程中发生错误: ${error.message}`,
    }
  }
}

// ============================================================================
// 导出格式生成器
// ============================================================================

function generateXMLExport(project: TimelineProject): string {
  // 简化XML导出
  return `<?xml version="1.0" encoding="UTF-8"?>
<timelineProject>
  <name>${project.name}</name>
  <id>${project.id}</id>
  <version>${project.version}</version>
  <created>${project.created}</created>
  <modified>${project.modified}</modified>
  <settings>
    <resolution>
      <width>${project.settings.resolution.width}</width>
      <height>${project.settings.resolution.height}</height>
    </resolution>
    <frameRate>${project.settings.frameRate}</frameRate>
    <sampleRate>${project.settings.sampleRate}</sampleRate>
    <duration>${project.settings.duration}</duration>
    <backgroundColor>${project.settings.backgroundColor}</backgroundColor>
  </settings>
  <timeline>
    <name>${project.timeline.name}</name>
    <duration>${project.timeline.duration}</duration>
    <tracks count="${project.timeline.tracks.length}">
      <!-- 轨道数据 -->
    </tracks>
  </timeline>
</timelineProject>`
}

function generateEDLExport(project: TimelineProject): string {
  // 简化EDL(编辑决策列表)导出
  let edl = `TITLE: ${project.name}\n`
  edl += `FCM: NON-DROP FRAME\n`
  edl += `\n`

  let eventNumber = 1
  project.timeline.tracks.forEach((track) => {
    track.clips.forEach((clip) => {
      const startTimecode = secondsToTimecode(clip.startTime)
      const endTimecode = secondsToTimecode(clip.startTime + clip.duration)

      edl += `${eventNumber.toString().padStart(3, " ")}  ${track.name.padEnd(8, " ")}  ${startTimecode} ${endTimecode} ${startTimecode} ${endTimecode}\n`
      eventNumber++
    })
  })

  return edl
}

/**
 * 工具别名
 */
export const TimelineTool = TimelineEditorTool

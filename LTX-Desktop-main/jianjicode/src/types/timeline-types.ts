/**
 * 多轨道时间线数据结构
 * 支持视频编辑项目的时间线表示，包含多个轨道和剪辑
 */

import type { ColorCorrection } from "./ltx-types.js"

// ============================================================================
// 基础类型
// ============================================================================

/**
 * 时间单位 (秒)
 */
export type TimeInSeconds = number

/**
 * 时间码格式 (HH:MM:SS.mmm)
 */
export type Timecode = string

/**
 * 唯一标识符
 */
export type ID = string

/**
 * 位置和尺寸 (相对坐标，0-1)
 */
export interface Position {
  x: number // 0-1
  y: number // 0-1
}

export interface Size {
  width: number // 0-1
  height: number // 0-1
}

// ============================================================================
// 媒体资源
// ============================================================================

/**
 * 媒体资源类型
 */
export interface MediaAsset {
  id: ID
  type: "video" | "audio" | "image" | "subtitle"
  path: string
  duration: TimeInSeconds
  metadata: {
    resolution?: { width: number; height: number }
    frameRate?: number
    sampleRate?: number
    channels?: number
    codec?: string
    [key: string]: any
  }
}

// ============================================================================
// 剪辑 (Clip)
// ============================================================================

/**
 * 基础剪辑接口
 */
export interface BaseClip {
  id: ID
  type: "video" | "audio" | "subtitle" | "image"
  assetId: ID // 引用的媒体资源ID
  startTime: TimeInSeconds // 在时间线上的开始时间
  duration: TimeInSeconds // 剪辑持续时间
  offset: TimeInSeconds // 在源媒体中的偏移量
  muted: boolean
  locked: boolean
  volume: number // 0-1 (仅音频/视频)
}

/**
 * 视频剪辑
 */
export interface VideoClip extends BaseClip {
  type: "video"
  position: Position // 画面位置
  size: Size // 画面尺寸
  rotation: number // 旋转角度 (度)
  opacity: number // 不透明度 (0-1)
  colorCorrection?: ColorCorrection
  filters: VideoFilter[]
}

/**
 * 音频剪辑
 */
export interface AudioClip extends BaseClip {
  type: "audio"
  fadeIn: TimeInSeconds // 淡入时长
  fadeOut: TimeInSeconds // 淡出时长
  pan: number // 声道平衡 (-1=左, 0=中, 1=右)
  audioFilters: AudioFilter[]
}

/**
 * 字幕剪辑
 */
export interface SubtitleClip extends BaseClip {
  type: "subtitle"
  text: string
  style: SubtitleStyle
  position: Position
}

/**
 * 图片剪辑
 */
export interface ImageClip extends BaseClip {
  type: "image"
  position: Position
  size: Size
  rotation: number
  opacity: number
  kenBurnsEffect?: KenBurnsEffect
}

/**
 * 剪辑类型联合
 */
export type Clip = VideoClip | AudioClip | SubtitleClip | ImageClip

// ============================================================================
// 视频滤镜
// ============================================================================

/**
 * 视频滤镜类型
 */
export type VideoFilterType =
  | "blur"
  | "sharpen"
  | "glow"
  | "vignette"
  | "grain"
  | "lut"
  | "color-adjust"
  | "hue-rotate"
  | "brightness"
  | "contrast"
  | "saturation"
  | "temperature"
  | "tint"

/**
 * 视频滤镜
 */
export interface VideoFilter {
  id: ID
  type: VideoFilterType
  enabled: boolean
  parameters: Record<string, number | string>
  order: number // 应用顺序
}

// ============================================================================
// 音频滤镜
// ============================================================================

/**
 * 音频滤镜类型
 */
export type AudioFilterType =
  | "eq"
  | "compressor"
  | "limiter"
  | "reverb"
  | "delay"
  | "chorus"
  | "flanger"
  | "noise-reduction"

/**
 * 音频滤镜
 */
export interface AudioFilter {
  id: ID
  type: AudioFilterType
  enabled: boolean
  parameters: Record<string, number | string>
}

// ============================================================================
// 字幕样式
// ============================================================================

/**
 * 字幕样式
 */
export interface SubtitleStyle {
  fontFamily: string
  fontSize: number
  fontWeight:
    | "normal"
    | "bold"
    | "100"
    | "200"
    | "300"
    | "400"
    | "500"
    | "600"
    | "700"
    | "800"
    | "900"
  fontStyle: "normal" | "italic"
  color: string // hex
  backgroundColor: string // hex + alpha
  borderColor: string // hex
  borderWidth: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  alignment: "left" | "center" | "right"
  verticalAlignment: "top" | "middle" | "bottom"
}

// ============================================================================
// 转场 (Transition)
// ============================================================================

/**
 * 转场类型
 */
export type TransitionType =
  | "none"
  | "dissolve"
  | "fade-to-black"
  | "fade-to-white"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "zoom-out"
  | "rotate"
  | "cube"
  | "page-curl"

/**
 * 转场
 */
export interface Transition {
  id: ID
  type: TransitionType
  duration: TimeInSeconds
  startClipId: ID // 起始剪辑ID
  endClipId: ID // 结束剪辑ID
  parameters: Record<string, number | string>
}

// ============================================================================
// 特效 (Effect)
// ============================================================================

/**
 * 特效类型
 */
export type EffectType =
  | "chroma-key"
  | "picture-in-picture"
  | "split-screen"
  | "mask"
  | "keying"
  | "stabilize"
  | "slow-motion"
  | "time-remap"

/**
 * 特效
 */
export interface Effect {
  id: ID
  type: EffectType
  enabled: boolean
  clipId: ID // 应用到的剪辑ID
  parameters: Record<string, number | string>
}

// ============================================================================
// 轨道 (Track)
// ============================================================================

/**
 * 轨道类型
 */
export type TrackType = "video" | "audio" | "subtitle" | "effect"

/**
 * 基础轨道接口
 */
export interface BaseTrack {
  id: ID
  type: TrackType
  name: string
  locked: boolean
  muted: boolean
  visible: boolean // 仅视频/字幕轨道
  volume: number // 仅音频轨道 (0-1)
  clips: Clip[]
  order: number // 轨道在时间线中的顺序
}

/**
 * 视频轨道
 */
export interface VideoTrack extends BaseTrack {
  type: "video"
  opacity: number // 轨道整体不透明度 (0-1)
  blends: TrackBlendMode
}

/**
 * 音频轨道
 */
export interface AudioTrack extends BaseTrack {
  type: "audio"
  pan: number // 声道平衡 (-1=左, 0=中, 1=右)
}

/**
 * 字幕轨道
 */
export interface SubtitleTrack extends BaseTrack {
  type: "subtitle"
}

/**
 * 特效轨道 (用于轨道级特效)
 */
export interface EffectTrack extends BaseTrack {
  type: "effect"
  effects: Effect[]
}

/**
 * 轨道类型联合
 */
export type Track = VideoTrack | AudioTrack | SubtitleTrack | EffectTrack

// ============================================================================
// 轨道混合模式
// ============================================================================

/**
 * 轨道混合模式
 */
export type TrackBlendMode =
  | "normal"
  | "add"
  | "subtract"
  | "multiply"
  | "screen"
  | "overlay"
  | "hard-light"
  | "soft-light"
  | "color-dodge"
  | "color-burn"
  | "difference"
  | "exclusion"

// ============================================================================
// 关键帧动画
// ============================================================================

/**
 * 关键帧插值类型
 */
export type InterpolationType =
  | "linear"
  | "bezier"
  | "hold"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"

/**
 * 关键帧
 */
export interface Keyframe<T> {
  time: TimeInSeconds
  value: T
  interpolation: InterpolationType
  handles?: {
    // 贝塞尔曲线控制点
    in: { x: number; y: number }
    out: { x: number; y: number }
  }
}

/**
 * 关键帧动画
 */
export interface Animation<T> {
  property: string // 动画属性名，如 'position.x', 'opacity'
  keyframes: Keyframe<T>[]
}

// ============================================================================
// 肯·伯恩斯效应 (Ken Burns Effect)
// ============================================================================

/**
 * 肯·伯恩斯效应 (图片平移缩放效果)
 */
export interface KenBurnsEffect {
  startPosition: Position
  endPosition: Position
  startScale: number
  endScale: number
  duration: TimeInSeconds
}

// ============================================================================
// 时间线 (Timeline)
// ============================================================================

/**
 * 时间线项目
 */
export interface TimelineProject {
  id: ID
  name: string
  version: string
  created: string
  modified: string

  // 项目设置
  settings: ProjectSettings

  // 媒体资源库
  assets: MediaAsset[]

  // 时间线
  timeline: Timeline
}

/**
 * 项目设置
 */
export interface ProjectSettings {
  resolution: { width: number; height: number }
  frameRate: number
  sampleRate: number
  duration: TimeInSeconds
  backgroundColor: string // hex
  zoomLevel?: number // 时间线缩放级别 (1.0 = 100%)
}

/**
 * 时间线
 */
export interface Timeline {
  id: ID
  name: string
  duration: TimeInSeconds
  currentTime: TimeInSeconds
  tracks: Track[]
  transitions: Transition[]
  markers: TimelineMarker[]
}

/**
 * 时间线标记
 */
export interface TimelineMarker {
  id: ID
  time: TimeInSeconds
  name: string
  color: string
  description?: string
}

// ============================================================================
// 时间线操作
// ============================================================================

/**
 * 时间线操作类型
 */
export type TimelineOperation =
  | "add_clip"
  | "remove_clip"
  | "move_clip"
  | "trim_clip"
  | "split_clip"
  | "merge_clips"
  | "add_transition"
  | "remove_transition"
  | "add_effect"
  | "remove_effect"
  | "add_filter"
  | "remove_filter"
  | "add_track"
  | "remove_track"
  | "move_track"

/**
 * 时间线操作结果
 */
export interface TimelineOperationResult {
  success: boolean
  operation: TimelineOperation
  timestamp: string
  details?: any
  error?: string
}

// ============================================================================
// 默认值
// ============================================================================

/**
 * 默认项目设置
 */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  resolution: { width: 1920, height: 1080 },
  frameRate: 30,
  sampleRate: 44100,
  duration: 60,
  backgroundColor: "#000000",
  zoomLevel: 1.0,
}

/**
 * 默认字幕样式
 */
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: "Arial, sans-serif",
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
}

/**
 * 默认视频剪辑
 */
export function createDefaultVideoClip(id: ID, assetId: ID): VideoClip {
  return {
    id,
    type: "video",
    assetId,
    startTime: 0,
    duration: 5,
    offset: 0,
    muted: false,
    locked: false,
    volume: 1,
    position: { x: 0.5, y: 0.5 },
    size: { width: 1, height: 1 },
    rotation: 0,
    opacity: 1,
    filters: [],
  }
}

/**
 * 默认音频剪辑
 */
export function createDefaultAudioClip(id: ID, assetId: ID): AudioClip {
  return {
    id,
    type: "audio",
    assetId,
    startTime: 0,
    duration: 5,
    offset: 0,
    muted: false,
    locked: false,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    pan: 0,
    audioFilters: [],
  }
}

/**
 * 默认视频轨道
 */
export function createDefaultVideoTrack(id: ID, name: string): VideoTrack {
  return {
    id,
    type: "video",
    name,
    locked: false,
    muted: false,
    visible: true,
    volume: 1,
    clips: [],
    order: 0,
    opacity: 1,
    blends: "normal",
  }
}

/**
 * 默认音频轨道
 */
export function createDefaultAudioTrack(id: ID, name: string): AudioTrack {
  return {
    id,
    type: "audio",
    name,
    locked: false,
    muted: false,
    visible: true,
    volume: 1,
    clips: [],
    order: 0,
    pan: 0,
  }
}

/**
 * 创建空时间线项目
 */
export function createEmptyTimelineProject(name: string): TimelineProject {
  const now = new Date().toISOString()

  return {
    id: `project_${Date.now()}`,
    name,
    version: "1.0",
    created: now,
    modified: now,
    settings: DEFAULT_PROJECT_SETTINGS,
    assets: [],
    timeline: {
      id: `timeline_${Date.now()}`,
      name: "主时间线",
      duration: 60,
      currentTime: 0,
      tracks: [
        createDefaultVideoTrack("track_video_1", "视频轨道 1"),
        createDefaultAudioTrack("track_audio_1", "音频轨道 1"),
      ],
      transitions: [],
      markers: [],
    },
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 时间转换：秒 → 时间码
 */
export function secondsToTimecode(seconds: TimeInSeconds): Timecode {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000)

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`
}

/**
 * 时间转换：时间码 → 秒
 */
export function timecodeToSeconds(timecode: Timecode): TimeInSeconds {
  const [time, ms] = timecode.split(".")
  const [hours, minutes, seconds] = time.split(":").map(Number)

  return hours * 3600 + minutes * 60 + seconds + (ms ? Number(`0.${ms}`) : 0)
}

/**
 * 检查时间线是否有效
 */
export function validateTimeline(timeline: Timeline): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // 检查轨道
  timeline.tracks.forEach((track, index) => {
    // 检查剪辑时间重叠
    const clips = track.clips
    for (let i = 0; i < clips.length; i++) {
      const clipA = clips[i]
      for (let j = i + 1; j < clips.length; j++) {
        const clipB = clips[j]
        const aStart = clipA.startTime
        const aEnd = clipA.startTime + clipA.duration
        const bStart = clipB.startTime
        const bEnd = clipB.startTime + clipB.duration

        if (aStart < bEnd && aEnd > bStart) {
          errors.push(
            `轨道 "${track.name}" 中剪辑 "${clipA.id}" 和 "${clipB.id}" 时间重叠`,
          )
        }
      }
    }
  })

  // 检查转场
  timeline.transitions.forEach((transition) => {
    const startClip = findClipInTimeline(timeline, transition.startClipId)
    const endClip = findClipInTimeline(timeline, transition.endClipId)

    if (!startClip || !endClip) {
      errors.push(`转场 "${transition.id}" 引用了不存在的剪辑`)
    } else if (
      transition.duration > startClip.duration ||
      transition.duration > endClip.duration
    ) {
      errors.push(`转场 "${transition.id}" 时长超过剪辑时长`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 在时间线中查找剪辑
 */
export function findClipInTimeline(
  timeline: Timeline,
  clipId: ID,
): Clip | null {
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return clip
  }
  return null
}

/**
 * 获取剪辑所在轨道
 */
export function findTrackForClip(timeline: Timeline, clipId: ID): Track | null {
  for (const track of timeline.tracks) {
    if (track.clips.some((c) => c.id === clipId)) {
      return track
    }
  }
  return null
}

/**
 * 获取时间线总时长
 */
export function getTimelineDuration(timeline: Timeline): TimeInSeconds {
  let maxDuration = 0

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration
      if (clipEnd > maxDuration) {
        maxDuration = clipEnd
      }
    }
  }

  return Math.max(maxDuration, timeline.duration)
}

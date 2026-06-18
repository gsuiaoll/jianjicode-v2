/**
 * LTX Desktop 类型定义
 * 直接从 LTX-Desktop-main/frontend/types/project.ts 复制以确保兼容性
 */

// ============================================================================
// 色彩校正系统 (Color Correction)
// ============================================================================

export interface ColorCorrection {
  brightness: number // -100 to 100, default 0
  contrast: number // -100 to 100, default 0
  saturation: number // -100 to 100, default 0
  temperature: number // -100 to 100, default 0 (negative = cooler/blue, positive = warmer/orange)
  tint: number // -100 to 100, default 0 (negative = green, positive = magenta)
  exposure: number // -100 to 100, default 0
  highlights: number // -100 to 100, default 0
  shadows: number // -100 to 100, default 0
}

export const DEFAULT_COLOR_CORRECTION: ColorCorrection = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
}

// ============================================================================
// 转场系统 (Transitions)
// ============================================================================

export type TransitionType =
  | "none"
  | "dissolve"
  | "fade-to-black"
  | "fade-to-white"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"

export interface ClipTransition {
  type: TransitionType
  duration: number // in seconds
}

// ============================================================================
// 文本叠加系统 (Text Overlay)
// ============================================================================

export interface TextOverlayStyle {
  text: string
  fontFamily: string // e.g. 'Inter', 'Arial', 'Georgia'
  fontSize: number // in px, relative to 1080p canvas
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
  color: string // hex color
  backgroundColor: string // hex + alpha, 'transparent' for none
  textAlign: "left" | "center" | "right"
  // Position as percentage of frame (0-100)
  positionX: number // 50 = centered horizontally
  positionY: number // 50 = centered vertically
  // Optional styling
  strokeColor: string // outline color, 'transparent' for none
  strokeWidth: number // outline width in px
  shadowColor: string // text shadow
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  letterSpacing: number // in px
  lineHeight: number // multiplier, e.g. 1.2
  maxWidth: number // max width as percentage of frame (0-100), 0 = no limit
  padding: number // padding inside background in px
  borderRadius: number // for background box
  opacity: number // 0-100
}

export const DEFAULT_TEXT_STYLE: TextOverlayStyle = {
  text: "Title Text",
  fontFamily: "Inter, Arial, sans-serif",
  fontSize: 64,
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#FFFFFF",
  backgroundColor: "transparent",
  textAlign: "center",
  positionX: 50,
  positionY: 50,
  strokeColor: "transparent",
  strokeWidth: 0,
  shadowColor: "rgba(0,0,0,0.5)",
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  letterSpacing: 0,
  lineHeight: 1.2,
  maxWidth: 80,
  padding: 0,
  borderRadius: 0,
  opacity: 100,
}

// ============================================================================
// 特效系统 (Effects System)
// ============================================================================

export type EffectType =
  | "blur"
  | "sharpen"
  | "glow"
  | "vignette"
  | "grain"
  | "lut-cinematic"
  | "lut-vintage"
  | "lut-bw"
  | "lut-cool"
  | "lut-warm"
  | "lut-muted"
  | "lut-vivid"

export type EffectMaskShape = "rectangle" | "ellipse"

export interface EffectMask {
  enabled: boolean
  shape: EffectMaskShape
  x: number // center X as % of frame (0-100)
  y: number // center Y as % of frame (0-100)
  width: number // width as % of frame (0-100)
  height: number // height as % of frame (0-100)
  feather: number // edge softness in px (0-100)
  invert: boolean // if true, effect applies OUTSIDE the mask
  rotation: number // rotation in degrees
}

export const DEFAULT_EFFECT_MASK: EffectMask = {
  enabled: false,
  shape: "ellipse",
  x: 50,
  y: 50,
  width: 40,
  height: 40,
  feather: 20,
  invert: false,
  rotation: 0,
}

export interface ClipEffect {
  id: string
  type: EffectType
  enabled: boolean
  params: Record<string, number>
  mask?: EffectMask
}

export interface EffectParamDef {
  min: number
  max: number
  step: number
  label: string
}

export interface EffectDefinition {
  name: string
  category: "filter" | "stylize" | "color-preset"
  icon: string // Lucide icon name
  defaultParams: Record<string, number>
  paramRanges: Record<string, EffectParamDef>
}

export const EFFECT_DEFINITIONS: Record<EffectType, EffectDefinition> = {
  blur: {
    name: "Gaussian Blur",
    category: "filter",
    icon: "Droplets",
    defaultParams: { amount: 5 },
    paramRanges: { amount: { min: 0, max: 50, step: 0.5, label: "Radius" } },
  },
  sharpen: {
    name: "Sharpen",
    category: "filter",
    icon: "Diamond",
    defaultParams: { amount: 50 },
    paramRanges: { amount: { min: 0, max: 100, step: 1, label: "Amount" } },
  },
  glow: {
    name: "Glow",
    category: "stylize",
    icon: "Sun",
    defaultParams: { amount: 30, radius: 10 },
    paramRanges: {
      amount: { min: 0, max: 100, step: 1, label: "Intensity" },
      radius: { min: 0, max: 50, step: 1, label: "Radius" },
    },
  },
  vignette: {
    name: "Vignette",
    category: "stylize",
    icon: "Circle",
    defaultParams: { amount: 50 },
    paramRanges: { amount: { min: 0, max: 100, step: 1, label: "Amount" } },
  },
  grain: {
    name: "Film Grain",
    category: "stylize",
    icon: "Scan",
    defaultParams: { amount: 30 },
    paramRanges: { amount: { min: 0, max: 100, step: 1, label: "Amount" } },
  },
  "lut-cinematic": {
    name: "Cinematic",
    category: "color-preset",
    icon: "Film",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-vintage": {
    name: "Vintage",
    category: "color-preset",
    icon: "Clock",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-bw": {
    name: "Black & White",
    category: "color-preset",
    icon: "Contrast",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-cool": {
    name: "Cool Tone",
    category: "color-preset",
    icon: "Snowflake",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-warm": {
    name: "Warm Tone",
    category: "color-preset",
    icon: "Flame",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-muted": {
    name: "Muted",
    category: "color-preset",
    icon: "CloudFog",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
  "lut-vivid": {
    name: "Vivid",
    category: "color-preset",
    icon: "Palette",
    defaultParams: { intensity: 100 },
    paramRanges: {
      intensity: { min: 0, max: 100, step: 1, label: "Intensity" },
    },
  },
}

// ============================================================================
// 字幕样式 (Subtitle Style)
// ============================================================================

export interface SubtitleStyle {
  fontSize: number // in px, default 32
  fontFamily: string // default 'sans-serif'
  fontWeight: "normal" | "bold"
  color: string // hex color, default '#FFFFFF'
  backgroundColor: string // hex color with alpha, default '#00000099'
  position: "bottom" | "top" | "center" // vertical position, default 'bottom'
  italic: boolean
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 32,
  fontFamily: "sans-serif",
  fontWeight: "normal",
  color: "#FFFFFF",
  backgroundColor: "transparent",
  position: "bottom",
  italic: false,
}

// ============================================================================
// 通用工具类型
// ============================================================================

/** 时间线片段基础接口（简化版） */
export interface TimelineClipBase {
  id: string
  startTime: number
  duration: number
  trimStart: number
  trimEnd: number
  speed: number
  reversed: boolean
  flipH: boolean
  flipV: boolean
  transitionIn: ClipTransition
  transitionOut: ClipTransition
  colorCorrection: ColorCorrection
  opacity: number
  effects?: ClipEffect[]
  textStyle?: TextOverlayStyle
}

// Re-export unified edit result type
export type {
  EditAttachment,
  EditMetadata,
  LTXEditResult,
} from "./edit-result.js"

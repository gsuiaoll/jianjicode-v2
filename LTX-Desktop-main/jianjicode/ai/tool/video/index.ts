// Export all video editing tools

export { AudioEffectsTool, AudioTool } from "./audio_effects.js"
export { ConcatVideosTool } from "./concat.js"
export { ConvertVideoTool } from "./convert.js"
export { ExtractAudioTool } from "./extract-audio.js"
export { GetVideoInfoTool } from "./get-video-info.js"
export {
  HardwareAccelerationTool,
  HwAccelTool,
} from "./hardware_acceleration.js"
export { AnimationTool, KeyframeAnimationTool } from "./keyframe_animation.js"
// LTX bridge tools removed — native tools (video_filter, video_subtitle, video_transition) cover all functionality
export { LutFilterTool, LutTool } from "./lut_filter.js"
export { MergeAudioTool } from "./merge-audio.js"
// Base FFmpeg tools
export { TrimVideoTool } from "./trim.js"
export {
  ExtractFrameTool,
  VideoExtractFrameTool,
} from "./video_extract_frame.js"
// jianjicode native tools (migrated from src/tool/)
export { FilterTool, VideoFilterTool } from "./video_filter.js"
export { MaskTool, VideoMaskTool } from "./video_mask.js"
export { PipTool, VideoPipTool } from "./video_pip.js"
export { SpeedTool, VideoSpeedTool } from "./video_speed.js"
export {
  StabilizationTool,
  VideoStabilizationTool,
} from "./video_stabilization.js"
export { SubtitleTool, VideoSubtitleTool } from "./video_subtitle.js"
export { TransitionTool, VideoTransitionTool } from "./video_transition.js"
export { VideoWatermarkTool, WatermarkTool } from "./video_watermark.js"

// Collection of all video tools for easy registration
export const VideoTools = [
  // Base FFmpeg tools
  TrimVideoTool,
  ConcatVideosTool,
  ConvertVideoTool,
  ExtractAudioTool,
  MergeAudioTool,
  GetVideoInfoTool,
  // jianjicode native tools
  VideoFilterTool,
  VideoSubtitleTool,
  VideoExtractFrameTool,
  LutFilterTool,
  VideoMaskTool,
  KeyframeAnimationTool,
  VideoSpeedTool,
  VideoStabilizationTool,
  AudioEffectsTool,
  HardwareAccelerationTool,
  VideoPipTool,
  VideoWatermarkTool,
  VideoTransitionTool,
  // LTX bridge tools removed
]

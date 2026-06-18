/**
 * 深度解读风格模板
 *
 *   慢节奏 → 关键帧动画（文字叠加） → 过渡效果 → 专业字幕
 */
import type { VideoTemplate } from "../template-schema.js"

export const deepAnalysisTemplate: VideoTemplate = {
  id: "deep_analysis_style",
  name: "深度解读风格",
  description:
    "适用于深度分析、知识讲解类视频。慢节奏、文字叠加动画、优雅过渡效果，帮助观众深入理解内容。",
  category: "deep_analysis",
  tags: ["深度解读", "知识", "分析", "讲解", "慢节奏", "文字动画"],
  parameters: [
    {
      name: "input_file",
      type: "file",
      label: "输入视频",
      description: "要处理的视频文件",
      required: true,
      placeholder: "/path/to/video.mp4",
    },
    {
      name: "playback_speed",
      type: "number",
      label: "播放速度",
      description: "视频播放速度（小于1为慢放）",
      required: false,
      defaultValue: 0.85,
      min: 0.5,
      max: 1.5,
    },
    {
      name: "overlay_title",
      type: "string",
      label: "叠加标题",
      description: "视频上叠加的大标题文字",
      required: false,
      defaultValue: "",
    },
    {
      name: "caption_style",
      type: "select",
      label: "字幕风格",
      description: "字幕的显示风格",
      required: false,
      defaultValue: "minimal_clean",
      options: [
        "minimal_clean",
        "film_classic",
        "corporate_clean",
        "minimal_transparent",
      ],
    },
    {
      name: "highlight_keywords",
      type: "boolean",
      label: "关键词高亮",
      description: "是否高亮关键词",
      required: false,
      defaultValue: true,
    },
  ],
  toolCalls: [
    {
      toolName: "video_speed",
      argsTemplate: {
        input: "{{input_file}}",
        speed_factor: "{{playback_speed}}",
        preserve_pitch: "true",
      },
      description: "调整视频播放速度（稍慢）",
      order: 1,
    },
    {
      toolName: "keyframe_animation",
      argsTemplate: {
        input: "{{input_file}}",
        text: "{{overlay_title}}",
        animation_type: "fade_in",
        duration: "1.5",
        position: "center",
      },
      description: "添加标题文字叠加动画",
      order: 2,
      condition: "overlay_title !== ''",
    },
    {
      toolName: "video_transition",
      argsTemplate: {
        input: "{{input_file}}",
        transition_type: "fade",
        duration: "1.0",
      },
      description: "添加慢速淡入淡出过渡",
      order: 3,
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{input_file}}",
        auto_generate: "true",
        style: "{{caption_style}}",
        highlight_keywords: "{{highlight_keywords}}",
      },
      description: "生成清晰优雅的字幕",
      order: 4,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        preset_id: "modern_minimal",
        strength: "50",
      },
      description: "应用柔和色调",
      order: 5,
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

/**
 * 快节奏剪辑模板
 *
 * 适用于短视频/社交媒体场景：
 *   自动场景检测 → 分割片段 → 加速 ×1.5 → 添加转场 → 添加字幕 → 合并
 */
import type { VideoTemplate } from "../template-schema.js"

export const fastCutTemplate: VideoTemplate = {
  id: "fast_cut_social",
  name: "快节奏剪辑",
  description:
    "适用于短视频和社交媒体的快节奏剪辑模板。自动检测场景并分割，加速片段，添加流行转场和醒目字幕。",
  category: "fast_cut",
  tags: ["短视频", "社交媒体", "快节奏", "自动剪辑", "抖音", "快手"],
  parameters: [
    {
      name: "input_file",
      type: "file",
      label: "输入视频",
      description: "要剪辑的视频文件路径",
      required: true,
      placeholder: "/path/to/video.mp4",
    },
    {
      name: "speed_factor",
      type: "number",
      label: "加速倍率",
      description: "视频加速倍率",
      required: false,
      defaultValue: 1.5,
      min: 1.0,
      max: 4.0,
    },
    {
      name: "output_format",
      type: "select",
      label: "输出格式",
      description: "输出视频的宽高比",
      required: false,
      defaultValue: "9:16",
      options: ["9:16", "16:9", "1:1"],
    },
    {
      name: "add_subtitles",
      type: "boolean",
      label: "添加字幕",
      description: "是否自动添加字幕",
      required: false,
      defaultValue: true,
    },
    {
      name: "transition_type",
      type: "select",
      label: "转场类型",
      description: "片段之间的转场效果",
      required: false,
      defaultValue: "dissolve",
      options: ["dissolve", "fade", "slide", "zoom", "wipe"],
    },
    {
      name: "bgm_style",
      type: "select",
      label: "背景音乐风格",
      description: "自动搜索匹配的背景音乐",
      required: false,
      defaultValue: "upbeat",
      options: ["upbeat", "electronic", "pop", "rock", "none"],
    },
  ],
  toolCalls: [
    {
      toolName: "video_scene_detection",
      argsTemplate: { input: "{{input_file}}", min_duration: "1.0" },
      description: "检测视频场景切换点",
      order: 1,
    },
    {
      toolName: "video_speed",
      argsTemplate: {
        input: "{{input_file}}",
        speed_factor: "{{speed_factor}}",
      },
      description: "加速视频片段",
      order: 2,
    },
    {
      toolName: "video_transition",
      argsTemplate: {
        input: "{{input_file}}",
        transition_type: "{{transition_type}}",
        duration: "0.3",
      },
      description: "在场景之间添加转场效果",
      order: 3,
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{input_file}}",
        auto_generate: "true",
        style: "social_bold",
      },
      description: "自动生成醒目字幕",
      order: 4,
      condition: "add_subtitles === true",
    },
    {
      toolName: "video_intelligent_crop",
      argsTemplate: {
        input: "{{input_file}}",
        target_ratio: "{{output_format}}",
      },
      description: "裁剪为目标宽高比",
      order: 5,
    },
    {
      toolName: "music_search",
      argsTemplate: { style: "{{bgm_style}}", mood: "energetic" },
      description: "搜索匹配的背景音乐",
      order: 6,
      condition: "bgm_style !== 'none'",
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

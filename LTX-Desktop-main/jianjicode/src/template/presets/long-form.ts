/**
 * 长视频剪辑模板
 *
 * 适用于纪录片/教程等长视频：
 *   场景检测 → 章节标记 → 智能裁剪 → 色彩校正 → 字幕添加
 */
import type { VideoTemplate } from "../template-schema.js"

export const longFormTemplate: VideoTemplate = {
  id: "long_form_documentary",
  name: "长视频剪辑",
  description:
    "适用于纪录片、教程和长视频的专业剪辑模板。自动检测场景、生成章节标记，并应用稳定优雅的色彩风格。",
  category: "long_form",
  tags: ["纪录片", "教程", "长视频", "章节", "专业", "教育"],
  parameters: [
    {
      name: "input_file",
      type: "file",
      label: "输入视频",
      description: "要剪辑的长视频文件路径",
      required: true,
      placeholder: "/path/to/video.mp4",
    },
    {
      name: "scene_threshold",
      type: "number",
      label: "场景检测灵敏度",
      description: "越低检测越敏感（0-100）",
      required: false,
      defaultValue: 30,
      min: 10,
      max: 80,
    },
    {
      name: "color_preset",
      type: "select",
      label: "色彩预设",
      description: "应用的色彩分级预设",
      required: false,
      defaultValue: "film_cinematic",
      options: [
        "film_cinematic",
        "modern_clean",
        "warm_sunset",
        "cool_icy",
        "none",
      ],
    },
    {
      name: "stabilize",
      type: "boolean",
      label: "视频稳定",
      description: "是否对画面进行防抖处理",
      required: false,
      defaultValue: false,
    },
    {
      name: "add_chapters",
      type: "boolean",
      label: "章节标记",
      description: "是否生成章节标记",
      required: false,
      defaultValue: true,
    },
  ],
  toolCalls: [
    {
      toolName: "video_scene_detection",
      argsTemplate: {
        input: "{{input_file}}",
        threshold: "{{scene_threshold}}",
        min_scene_duration: "3.0",
      },
      description: "检测长视频场景切换",
      order: 1,
    },
    {
      toolName: "video_stabilization",
      argsTemplate: { input: "{{input_file}}" },
      description: "视频稳定/防抖处理",
      order: 2,
      condition: "stabilize === true",
    },
    {
      toolName: "video_intelligent_crop",
      argsTemplate: {
        input: "{{input_file}}",
        target_ratio: "16:9",
        smart_mode: "content_aware",
      },
      description: "智能裁剪关键区域",
      order: 3,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        preset_id: "{{color_preset}}",
        strength: "80",
      },
      description: "应用色彩分级预设",
      order: 4,
      condition: "color_preset !== 'none'",
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{input_file}}",
        auto_generate: "true",
        style: "film_classic",
      },
      description: "添加专业字幕",
      order: 5,
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

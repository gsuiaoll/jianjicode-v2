/**
 * 电影感风格模板
 *
 *   色彩分级 → 宽银幕裁剪 → 胶片颗粒 → 转场 → 电影字幕
 */
import type { VideoTemplate } from "../template-schema.js"

export const cinematicTemplate: VideoTemplate = {
  id: "cinematic_style",
  name: "电影感风格",
  description:
    "打造专业电影感的视频效果。包括青橙色调、宽银幕裁剪（2.35:1）、胶片颗粒、专业转场和电影字幕。",
  category: "cinematic",
  tags: ["电影感", "宽银幕", "青橙色调", "胶片", "专业调色", "好莱坞"],
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
      name: "color_style",
      type: "select",
      label: "电影色调",
      description: "选择电影色彩风格",
      required: false,
      defaultValue: "film_teal_orange",
      options: [
        "film_teal_orange",
        "film_cinematic",
        "dramatic_high_contrast",
        "dramatic_silhouette",
      ],
    },
    {
      name: "aspect_ratio",
      type: "select",
      label: "宽高比",
      description: "电影画面宽高比",
      required: false,
      defaultValue: "2.35:1",
      options: ["2.35:1", "1.85:1", "16:9", "2.76:1"],
    },
    {
      name: "grain_amount",
      type: "number",
      label: "胶片颗粒度",
      description: "胶片颗粒效果强度（0-100，0为无颗粒）",
      required: false,
      defaultValue: 20,
      min: 0,
      max: 80,
    },
    {
      name: "add_letterbox",
      type: "boolean",
      label: "添加黑边",
      description: "是否添加电影黑边（letterbox）",
      required: false,
      defaultValue: true,
    },
  ],
  toolCalls: [
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        preset_id: "{{color_style}}",
        strength: "90",
      },
      description: "应用电影级色彩分级",
      order: 1,
    },
    {
      toolName: "lut_filter",
      argsTemplate: {
        input: "{{input_file}}",
        lut_file: "cinematic_teal_orange",
        strength: "85",
      },
      description: "套用电影 LUT",
      order: 2,
    },
    {
      toolName: "video_intelligent_crop",
      argsTemplate: {
        input: "{{input_file}}",
        target_ratio: "{{aspect_ratio}}",
        add_letterbox: "{{add_letterbox}}",
      },
      description: "裁剪为宽银幕比例",
      order: 3,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        effect_type: "film_grain",
        amount: "{{grain_amount}}",
      },
      description: "添加胶片颗粒效果",
      order: 4,
      condition: "grain_amount > 0",
    },
    {
      toolName: "video_transition",
      argsTemplate: {
        input: "{{input_file}}",
        transition_type: "fade",
        duration: "0.5",
      },
      description: "添加电影感淡入淡出",
      order: 5,
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{input_file}}",
        auto_generate: "true",
        style: "film_classic",
      },
      description: "添加经典电影字幕",
      order: 6,
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

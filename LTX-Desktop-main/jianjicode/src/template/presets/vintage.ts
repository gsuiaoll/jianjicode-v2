/**
 * 复古风格模板
 *
 *   复古滤镜 → 噪点 → 色彩偏移 → 棕褐色调 → 复古字幕
 */
import type { VideoTemplate } from "../template-schema.js"

export const vintageTemplate: VideoTemplate = {
  id: "vintage_style",
  name: "复古风格",
  description:
    "模拟老电影和复古视频效果。包含褪色滤镜、噪点、色彩偏移、棕褐色调和复古字幕风格。",
  category: "vintage",
  tags: ["复古", "老电影", "胶片", "噪点", "棕褐色", "怀旧"],
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
      name: "vintage_era",
      type: "select",
      label: "复古年代",
      description: "模拟的年代风格",
      required: false,
      defaultValue: "70s",
      options: ["70s", "80s", "90s", "silent_film", "super8"],
    },
    {
      name: "noise_amount",
      type: "number",
      label: "噪点强度",
      description: "画面噪点强度（0-100）",
      required: false,
      defaultValue: 35,
      min: 0,
      max: 80,
    },
    {
      name: "color_shift",
      type: "number",
      label: "色彩偏移",
      description: "色彩通道偏移量（模拟旧胶片色偏，0-100）",
      required: false,
      defaultValue: 15,
      min: 0,
      max: 50,
    },
    {
      name: "add_scratches",
      type: "boolean",
      label: "胶片划痕",
      description: "是否添加模拟胶片划痕效果",
      required: false,
      defaultValue: true,
    },
  ],
  toolCalls: [
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        preset_id: "vintage_70s",
        strength: "80",
      },
      description: "应用复古色彩分级",
      order: 1,
    },
    {
      toolName: "lut_filter",
      argsTemplate: {
        input: "{{input_file}}",
        lut_file: "vintage_{{vintage_era}}",
        strength: "90",
      },
      description: "套用年代 LUT 滤镜",
      order: 2,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        grain: "{{noise_amount}}",
        saturation: "-20",
        contrast: "-5",
      },
      description: "添加噪点和褪色效果",
      order: 3,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        effect_type: "chromatic_aberration",
        amount: "{{color_shift}}",
      },
      description: "添加色彩偏移（色差）效果",
      order: 4,
      condition: "color_shift > 0",
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{input_file}}",
        effect_type: "film_scratches",
        amount: "40",
      },
      description: "添加胶片划痕效果",
      order: 5,
      condition: "add_scratches === true",
    },
    {
      toolName: "video_speed",
      argsTemplate: { input: "{{input_file}}", speed_factor: "0.95" },
      description: "略微降速增强复古感",
      order: 6,
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{input_file}}",
        auto_generate: "true",
        style: "vintage_sepia",
      },
      description: "添加复古风格字幕",
      order: 7,
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

/**
 * 新闻解说风格模板
 *
 *   画中画 → 字幕模板 → 背景音乐 → 色彩校正（新闻蓝）
 */
import type { VideoTemplate } from "../template-schema.js"

export const newsStyleTemplate: VideoTemplate = {
  id: "news_broadcast_style",
  name: "新闻解说风格",
  description:
    "新闻播报风格模板，包含画中画、新闻类字幕、专业蓝色调色彩和背景音乐。适合新闻解说、时事评论类视频。",
  category: "news_style",
  tags: ["新闻", "播报", "解说", "画中画", "专业", "时事"],
  parameters: [
    {
      name: "main_video",
      type: "file",
      label: "主视频",
      description: "新闻主要内容视频",
      required: true,
      placeholder: "/path/to/main.mp4",
    },
    {
      name: "pip_video",
      type: "file",
      label: "画中画视频",
      description: "画中画小窗口的视频（可选）",
      required: false,
      placeholder: "/path/to/pip.mp4",
    },
    {
      name: "pip_position",
      type: "select",
      label: "画中画位置",
      description: "小窗口在画面中的位置",
      required: false,
      defaultValue: "top_right",
      options: ["top_right", "top_left", "bottom_right", "bottom_left"],
    },
    {
      name: "headline_text",
      type: "string",
      label: "新闻标题",
      description: "底部显示的新闻标题文字",
      required: false,
      defaultValue: "新闻标题",
    },
    {
      name: "subtitle_file",
      type: "file",
      label: "字幕文件",
      description: "SRT/ASS 字幕文件路径（可选，自动生成时留空）",
      required: false,
      placeholder: "/path/to/subtitles.srt",
    },
  ],
  toolCalls: [
    {
      toolName: "video_pip",
      argsTemplate: {
        main_video: "{{main_video}}",
        pip_video: "{{pip_video}}",
        position: "{{pip_position}}",
        scale: "0.3",
      },
      description: "添加画中画小窗口",
      order: 1,
      condition: "pip_video !== ''",
    },
    {
      toolName: "video_subtitle",
      argsTemplate: {
        input: "{{main_video}}",
        subtitle_file: "{{subtitle_file}}",
        style: "news_broadcast",
        auto_generate: "true",
      },
      description: "应用新闻风格字幕",
      order: 2,
    },
    {
      toolName: "video_filter",
      argsTemplate: {
        input: "{{main_video}}",
        preset_id: "cool_icy",
        strength: "60",
      },
      description: "应用新闻专业蓝调",
      order: 3,
    },
    {
      toolName: "music_search",
      argsTemplate: {
        style: "corporate",
        mood: "professional",
        purpose: "news_background",
      },
      description: "搜索新闻背景音乐",
      order: 4,
    },
    {
      toolName: "video_watermark",
      argsTemplate: {
        input: "{{main_video}}",
        text: "{{headline_text}}",
        position: "bottom",
        font_size: "28",
      },
      description: "添加底部新闻标题",
      order: 5,
    },
  ],
  author: "jianjicode",
  version: "1.0.0",
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

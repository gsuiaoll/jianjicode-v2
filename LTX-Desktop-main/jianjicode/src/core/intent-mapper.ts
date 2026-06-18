/**
 * 指令-意图映射表
 *
 * 收集中文视频编辑指令样本，建立自然语言表达到工具类别的映射关系。
 * 该映射表用于：
 *   1. 注入 system prompt 帮助 AI 理解中文术语
 *   2. 在工具调用失败时提供更好的错误建议
 *   3. 检测无法映射的指令以便触发澄清
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface IntentMapping {
  /** 匹配模式（关键词或正则） */
  patterns: string[]
  /** 意图类别 */
  category: IntentCategory
  /** 优先使用的工具 */
  primaryTool: string
  /** 备选工具 */
  fallbackTools: string[]
  /** 中文描述 */
  description: string
  /** 典型示例 */
  examples: string[]
}

export type IntentCategory =
  | "trim" // 裁剪
  | "concat" // 合并
  | "filter" // 滤镜/调色
  | "subtitle" // 字幕
  | "transition" // 转场
  | "effect" // 特效
  | "speed" // 变速
  | "stabilization" // 稳定
  | "pip" // 画中画
  | "watermark" // 水印
  | "mask" // 遮罩
  | "audio" // 音频处理
  | "music" // 背景音乐
  | "analysis" // 视频分析
  | "frame" // 帧提取
  | "animation" // 关键帧动画
  | "crop" // 裁剪画面
  | "style" // 风格迁移
  | "format" // 格式转换
  | "scene" // 场景检测
  | "batch" // 批量处理
  | "unknown" // 无法识别

export interface IntentResult {
  /** 识别到的意图类别 */
  category: IntentCategory
  /** 置信度 (0-1) */
  confidence: number
  /** 匹配到的关键词 */
  matchedKeywords: string[]
  /** 推荐的优先工具 */
  primaryTool: string
  /** 备选工具 */
  fallbackTools: string[]
  /** 提取的参数 */
  extractedParams: Record<string, string>
}

// ============================================================================
// 指令-意图映射表
// ============================================================================

export const INTENT_MAPPINGS: IntentMapping[] = [
  // ---- 裁剪 ----
  {
    patterns: [
      "剪",
      "裁",
      "删",
      "去掉",
      "去除",
      "切除",
      "截取",
      "保留",
      "截一段",
      "剪辑",
    ],
    category: "trim",
    primaryTool: "ffmpeg",
    fallbackTools: ["ltx_video_processor"],
    description: "裁剪视频片段",
    examples: ["剪掉前10秒", "删除第30秒到第60秒", "截取5分钟到10分钟的部分"],
  },
  // ---- 合并 ----
  {
    patterns: [
      "合并",
      "拼接",
      "接起来",
      "接上",
      "合在一起",
      "串连",
      "连起来",
      "组合",
    ],
    category: "concat",
    primaryTool: "ffmpeg",
    fallbackTools: [],
    description: "合并多个视频",
    examples: ["把两个视频合并", "将这三段拼接起来", "A和B接在一起"],
  },
  // ---- 滤镜/调色 ----
  {
    patterns: [
      "滤镜",
      "调色",
      "颜色",
      "色调",
      "色彩",
      "亮度",
      "对比度",
      "饱和度",
      "色温",
      "暖色",
      "冷色",
      "黑白",
      "复古色",
      "褪色",
      "鲜艳",
      "电影感",
      "大片感",
      "胶片感",
      "日系",
      "小清新",
    ],
    category: "filter",
    primaryTool: "video_filter",
    fallbackTools: ["lut_filter", "ltx_api_color_grading"],
    description: "色彩调整和滤镜",
    examples: [
      "加个暖色滤镜",
      "调成电影感色调",
      "提高亮度和对比度",
      "做成黑白效果",
    ],
  },
  // ---- 字幕 ----
  {
    patterns: [
      "字幕",
      "文字",
      "标题",
      "说明文字",
      "台词",
      "对白",
      "旁白",
      "自动字幕",
      "语音转文字",
      "加字",
    ],
    category: "subtitle",
    primaryTool: "video_subtitle",
    fallbackTools: [],
    description: "字幕添加和编辑",
    examples: ["添加字幕", "自动生成字幕", "字幕样式改为白色"],
  },
  // ---- 转场 ----
  {
    patterns: [
      "转场",
      "过渡",
      "切换效果",
      "淡入淡出",
      "黑场",
      "白场",
      "翻页",
      "溶解",
      "滑动",
      "过场",
    ],
    category: "transition",
    primaryTool: "video_transition",
    fallbackTools: [],
    description: "转场效果",
    examples: ["加一个淡入淡出", "片段之间加转场", "黑场过渡"],
  },
  // ---- 特效 ----
  {
    patterns: [
      "特效",
      "效果",
      "马赛克",
      "模糊",
      "镜像",
      "翻转",
      "旋转",
      "绿幕",
      "抠图",
      "粒子",
      "光效",
      "发光",
      "阴影",
    ],
    category: "effect",
    primaryTool: "video_filter",
    fallbackTools: ["video_mask"],
    description: "视频特效",
    examples: ["加马赛克", "背景模糊", "镜像画面", "加粒子特效"],
  },
  // ---- 变速 ----
  {
    patterns: [
      "加速",
      "减速",
      "慢放",
      "慢动作",
      "快放",
      "快动作",
      "倍速",
      "变速",
      "快慢",
      "抽帧",
      "补帧",
    ],
    category: "speed",
    primaryTool: "video_speed",
    fallbackTools: ["ffmpeg"],
    description: "视频速度调整",
    examples: ["加速2倍", "做成慢动作", "第5秒到第10秒慢放"],
  },
  // ---- 稳定 ----
  {
    patterns: ["稳定", "防抖", "抖动", "晃", "颠簸", "震动", "平稳", "画面抖"],
    category: "stabilization",
    primaryTool: "video_stabilization",
    fallbackTools: [],
    description: "视频稳定处理",
    examples: ["画面太抖了", "稳定一下", "防抖处理"],
  },
  // ---- 画中画 ----
  {
    patterns: [
      "画中画",
      "小窗",
      "分屏",
      "同屏",
      "叠加画面",
      "画面上加",
      "右上角",
      "左下角",
      "角落",
      "PIP",
      "小窗口",
    ],
    category: "pip",
    primaryTool: "video_pip",
    fallbackTools: ["ffmpeg"],
    description: "画中画效果",
    examples: ["右上角加一个小窗口", "画中画效果", "分屏显示两个视频"],
  },
  // ---- 水印 ----
  {
    patterns: ["水印", "logo", "标记", "版权", "标签", "台标"],
    category: "watermark",
    primaryTool: "video_watermark",
    fallbackTools: ["ffmpeg"],
    description: "添加水印",
    examples: ["加文字水印", "右下角加 logo", "添加版权标记"],
  },
  // ---- 遮罩 ----
  {
    patterns: [
      "遮罩",
      "蒙版",
      "遮挡",
      "遮盖",
      "挡住",
      "盖住",
      "局部",
      "某区域",
    ],
    category: "mask",
    primaryTool: "video_mask",
    fallbackTools: ["video_filter"],
    description: "遮罩和局部处理",
    examples: ["人脸打码", "遮挡车牌", "局部模糊处理"],
  },
  // ---- 音频 ----
  {
    patterns: [
      "音频",
      "声音",
      "音质",
      "降噪",
      "去噪",
      "消音",
      "静音",
      "音量",
      "人声",
      "增强人声",
      "回声",
      "混响",
    ],
    category: "audio",
    primaryTool: "audio_effects",
    fallbackTools: ["ffmpeg"],
    description: "音频处理",
    examples: ["降噪处理", "增强人声", "背景音太吵了"],
  },
  // ---- 音乐 ----
  {
    patterns: [
      "音乐",
      "背景音乐",
      "BGM",
      "配乐",
      "音效",
      "歌曲",
      "曲子",
      "旋律",
    ],
    category: "music",
    primaryTool: "music_search",
    fallbackTools: ["ffmpeg"],
    description: "搜索和添加背景音乐",
    examples: ["找一首欢快的背景音乐", "配一段钢琴曲", "加上音效"],
  },
  // ---- 分析 ----
  {
    patterns: [
      "分析",
      "理解",
      "识别",
      "内容",
      "讲的什么",
      "什么内容",
      "有什么",
      "检测",
      "判断",
    ],
    category: "analysis",
    primaryTool: "ai_video_analysis",
    fallbackTools: ["universal_video_analyzer", "cv_analysis"],
    description: "AI 视频分析",
    examples: ["分析视频内容", "这个视频讲的是什么", "识别视频中的物体"],
  },
  // ---- 帧提取 ----
  {
    patterns: [
      "截图",
      "取帧",
      "提取帧",
      "抽帧",
      "画面提取",
      "抓图",
      "缩略图",
      "封面",
      "逐帧",
    ],
    category: "frame",
    primaryTool: "video_extract_frame",
    fallbackTools: ["ffmpeg"],
    description: "视频帧提取",
    examples: ["提取第10秒的画面", "每秒截图一张", "生成视频缩略图"],
  },
  // ---- 动画 ----
  {
    patterns: [
      "动画",
      "关键帧",
      "移动",
      "位移",
      "缩放动画",
      "旋转动画",
      "淡入",
      "淡出",
      "弹入",
      "弹出",
      "滑动进入",
    ],
    category: "animation",
    primaryTool: "keyframe_animation",
    fallbackTools: [],
    description: "关键帧动画",
    examples: ["文字从左到右移动", "画面逐渐放大", "关键帧缩放动画"],
  },
  // ---- 裁剪画面 ----
  {
    patterns: [
      "裁剪画面",
      "切画面",
      "裁切",
      "比例",
      "16:9",
      "4:3",
      "1:1",
      "9:16",
      "竖屏",
      "横屏",
      "方形",
    ],
    category: "crop",
    primaryTool: "video_intelligent_crop",
    fallbackTools: ["video_filter"],
    description: "画面裁剪和比例调整",
    examples: ["裁剪成16:9", "竖屏裁成横屏", "智能裁剪画面"],
  },
  // ---- 风格 ----
  {
    patterns: [
      "风格",
      "风格化",
      "艺术",
      "油画",
      "梵高",
      "卡通",
      "动漫",
      "素描",
      "水墨",
      "像素",
      "赛博朋克",
    ],
    category: "style",
    primaryTool: "video_style_transfer",
    fallbackTools: ["video_filter"],
    description: "风格迁移",
    examples: ["变成梵高风格", "卡通化处理", "水墨画风格"],
  },
  // ---- 格式转换 ----
  {
    patterns: [
      "格式",
      "转换格式",
      "转成",
      "导出",
      "输出为",
      "mp4",
      "avi",
      "mov",
      "mkv",
      "gif",
      "转码",
    ],
    category: "format",
    primaryTool: "ffmpeg",
    fallbackTools: [],
    description: "格式转换",
    examples: ["转成mp4格式", "导出为mov", "转成gif动图"],
  },
  // ---- 场景检测 ----
  {
    patterns: [
      "场景",
      "镜头切换",
      "分镜",
      "分段",
      "章节",
      "自动分割",
      "按场景",
    ],
    category: "scene",
    primaryTool: "video_scene_detection",
    fallbackTools: ["ai_video_analysis"],
    description: "场景检测和分割",
    examples: ["自动检测场景切换", "按场景分割视频", "自动分段"],
  },
  // ---- 批量处理 ----
  {
    patterns: [
      "批量",
      "所有视频",
      "文件夹",
      "多个文件",
      "全部",
      "一起",
      "这些视频",
      "整个目录",
    ],
    category: "batch",
    primaryTool: "batch_scanner",
    fallbackTools: ["batch_queue", "batch_report"],
    description: "批量处理",
    examples: ["批量处理这几个视频", "文件夹里所有视频加滤镜", "全部转成mp4"],
  },
]

// ============================================================================
// 意图识别
// ============================================================================

/**
 * 根据用户消息识别编辑意图。
 * 返回匹配度最高的 intent，如果无法识别则返回 "unknown"。
 */
export function detectIntent(message: string): IntentResult {
  const lower = message.toLowerCase()
  let bestMatch: IntentMapping | null = null
  let bestScore = 0
  const allMatched: string[] = []

  for (const mapping of INTENT_MAPPINGS) {
    let score = 0
    const matched: string[] = []
    for (const pattern of mapping.patterns) {
      if (lower.includes(pattern)) {
        // 较长的模式匹配权重更高
        score += pattern.length
        matched.push(pattern)
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestMatch = mapping
      allMatched.length = 0
      allMatched.push(...matched)
    }
  }

  if (!bestMatch || bestScore === 0) {
    return {
      category: "unknown",
      confidence: 0,
      matchedKeywords: [],
      primaryTool: "ffmpeg",
      fallbackTools: [],
      extractedParams: extractParams(message),
    }
  }

  // 置信度基于匹配模式长度之和与消息长度的比值
  const confidence = Math.min(1, (bestScore / Math.max(lower.length, 1)) * 2)

  return {
    category: bestMatch.category,
    confidence,
    matchedKeywords: allMatched,
    primaryTool: bestMatch.primaryTool,
    fallbackTools: bestMatch.fallbackTools,
    extractedParams: extractParams(message),
  }
}

// ============================================================================
// 参数提取
// ============================================================================

const TIME_PATTERN = /(\d+)\s*(秒|分钟|分|min|s|分钟|小时|时|h)/g
const SPEED_PATTERN = /(\d+\.?\d*)\s*(倍|倍速|x)/i
const FILE_PATTERN =
  /([\w\-./\\]+\.(mp4|avi|mov|mkv|webm|flv|gif|mp3|wav|aac|srt|ass|vtt))/gi
const PERCENT_PATTERN = /(\d+)%/g

function extractParams(message: string): Record<string, string> {
  const params: Record<string, string> = {}

  // 时间参数
  const timeMatches = [...message.matchAll(TIME_PATTERN)]
  if (timeMatches.length > 0) {
    params.times = timeMatches.map((m) => m[0]).join(", ")
  }

  // 速度参数
  const speedMatch = SPEED_PATTERN.exec(message)
  if (speedMatch) {
    params.speed = speedMatch[1]
  }

  // 文件路径
  const fileMatches = [...message.matchAll(FILE_PATTERN)]
  if (fileMatches.length > 0) {
    params.files = fileMatches.map((m) => m[0]).join(", ")
  }

  // 百分比
  const percentMatch = PERCENT_PATTERN.exec(message)
  if (percentMatch) {
    params.percent = percentMatch[1]
  }

  return params
}

// ============================================================================
// 混淆矩阵 — 易混淆的指令对
// ============================================================================

/**
 * 易混淆指令对照表。
 * 当 AI 在两个意图之间犹豫时，这些提示帮助做出正确选择。
 */
export const CONFUSION_PAIRS: Array<{
  keywords: string[]
  categoryA: IntentCategory
  categoryB: IntentCategory
  clarification: string
}> = [
  {
    keywords: ["剪", "裁"],
    categoryA: "trim",
    categoryB: "crop",
    clarification:
      "用户说的'剪'可能指裁剪视频片段（修剪时长），也可能指裁剪画面（改变比例）。请确认。",
  },
  {
    keywords: ["滤镜", "效果"],
    categoryA: "filter",
    categoryB: "effect",
    clarification:
      "用户可能想调色（滤镜），也可能想加视觉特效。请确认具体想要什么效果。",
  },
  {
    keywords: ["字幕", "文字"],
    categoryA: "subtitle",
    categoryB: "watermark",
    clarification: "用户可能想加对白字幕，也可能想加文字水印。请确认文字用途。",
  },
  {
    keywords: ["模糊"],
    categoryA: "effect",
    categoryB: "mask",
    clarification:
      "用户可能想整体模糊（特效），也可能想局部模糊/打码（遮罩）。请确认模糊范围。",
  },
]

/**
 * 检测可能混淆的意图。
 */
export function detectConfusion(message: string): Array<{
  categoryA: IntentCategory
  categoryB: IntentCategory
  clarification: string
}> {
  const lower = message.toLowerCase()
  const results: Array<{
    categoryA: IntentCategory
    categoryB: IntentCategory
    clarification: string
  }> = []

  for (const pair of CONFUSION_PAIRS) {
    const matchCount = pair.keywords.filter((k) => lower.includes(k)).length
    if (matchCount >= 1) {
      results.push({
        categoryA: pair.categoryA,
        categoryB: pair.categoryB,
        clarification: pair.clarification,
      })
    }
  }

  return results
}

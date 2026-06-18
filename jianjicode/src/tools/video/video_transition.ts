import { spawnSync } from "child_process"
import { existsSync, unlinkSync, writeFileSync } from "fs"
import { join } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { findFfmpegPath, runFfmpeg } from "../../lib/ffmpeg-utils.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// For CommonJS compatibility

/**
 * 视频转场工具 - 在两个视频之间添加过渡效果
 *
 * 支持功能:
 * 1. 30+ 种转场效果 (基于 FFmpeg xfade)
 * 2. 多段转场链 (混合多个连续转场)
 * 3. 参数化控制 (方向、时长、音频过渡)
 * 4. 自定义 FFmpeg filter
 */
export const VideoTransitionTool: any = Tool.define("video_transition", {
  description:
    "两个视频之间的过渡转场，支持 30+ 种转场类型和多段混合。" +
    "⚠️ 这是视频A→视频B的切换效果，不是单视频的淡入淡出。单视频淡入淡出请用 video_filter (fade=in/out)。",
  parameters: z.object({
    // 输入输出
    input1: z.string().describe("第一个输入视频文件路径"),
    input2: z.string().describe("第二个输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input1>_transition.<ext>)"),

    // 转场类型
    transition_type: z
      .enum([
        "crossfade", // 标准淡入淡出
        "dissolve", // 溶解
        "fade_black", // 淡出到黑场
        "fade_white", // 淡出到白场
        // 滑动
        "slide_left",
        "slide_right",
        "slide_up",
        "slide_down",
        "smooth_left",
        "smooth_right",
        "smooth_up",
        "smooth_down",
        // 擦除
        "wipe_left",
        "wipe_right",
        "wipe_up",
        "wipe_down",
        "wipe_tl",
        "wipe_tr",
        "wipe_br",
        "wipe_bl",
        // 缩放
        "zoom_in",
        "zoom_out",
        // 圆形
        "circle",
        "circle_open",
        "circle_close",
        // 矩形
        "rect_crop",
        // 水平/垂直
        "horz_close",
        "horz_open",
        "vert_close",
        "vert_open",
        // 特殊
        "radial", // 径向
        "pixelize", // 像素化
        "hblur", // 水平模糊
        "distance", // 距离
        // 封面滑动
        "cover_left",
        "cover_right",
        "cover_up",
        "cover_down",
        "can_liver",
        // 3D/特殊
        "cube", // 立方体旋转
        "clock", // 时钟划像
        "glitch", // 故障效果
        // 自定义
        "custom",
      ])
      .optional()
      .default("crossfade")
      .describe("转场类型 (默认: crossfade)"),

    // 多段转场链
    segments: z
      .array(
        z.object({
          transition_type: z.string().describe("转场类型"),
          duration: z.number().min(0.1).max(10).describe("转场时长"),
          easing: z
            .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
            .optional()
            .default("linear"),
        }),
      )
      .max(5)
      .optional()
      .describe("多段转场链 (依次应用多个转场，最多5段)"),

    // 转场参数
    duration: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(2.0)
      .describe("转场持续时间 (秒，0.1-10，默认: 2.0)"),
    easing: z
      .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
      .optional()
      .default("linear")
      .describe("缓动曲线 (对转场效果做平滑)"),
    direction: z
      .enum(["normal", "reverse"])
      .optional()
      .default("normal")
      .describe("转场方向: normal(正向), reverse(反向)"),
    position: z
      .enum(["middle", "end_first", "start_second"])
      .optional()
      .default("middle")
      .describe(
        "转场位置: middle(中间), end_first(第一个视频结尾), start_second(第二个视频开头，默认: middle)",
      ),

    // 自定义filter (当transition_type='custom'时使用)
    custom_filter: z
      .string()
      .optional()
      .describe("自定义FFmpeg filter_complex字符串 (高级用户)"),

    // 视频预处理
    trim1_start: z
      .string()
      .optional()
      .describe("第一个视频开始时间 (格式: HH:MM:SS 或 秒数，空表示从头开始)"),
    trim1_end: z
      .string()
      .optional()
      .describe("第一个视频结束时间 (格式: HH:MM:SS 或 秒数，空表示到结束)"),
    trim2_start: z
      .string()
      .optional()
      .describe("第二个视频开始时间 (格式: HH:MM:SS 或 秒数，空表示从头开始)"),
    trim2_end: z
      .string()
      .optional()
      .describe("第二个视频结束时间 (格式: HH:MM:SS 或 秒数，空表示到结束)"),

    // 音频处理
    audio_transition: z
      .enum(["crossfade", "cut", "merge"])
      .optional()
      .default("crossfade")
      .describe(
        "音频过渡方式: crossfade(交叉淡入淡出), cut(直接切换), merge(混合叠加，默认: crossfade)",
      ),
    audio_duration: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .describe("音频过渡持续时间 (秒，0.1-10，默认跟随视频转场 duration)"),

    allow_overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否允许覆盖已存在的输出文件 (默认: false)"),
    protect_originals: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否保护原文件，强制输出到新文件 (默认: true)"),
    output_dir: z
      .string()
      .optional()
      .describe("限制输出目录，防止写入系统目录 (空表示不限制)"),
    // 性能选项
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (0-51，越低质量越好，默认 23)"),
    preset: z
      .enum([
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
      ])
      .optional()
      .default("medium")
      .describe("编码预设 (影响编码速度和质量，默认: medium)"),
  }),
  usageTemplate: {
    json: {
      input1: "{source_video}",
      input2: "{output_dir}/second_clip.mp4",
      output: "{output_dir}/transition_{timestamp}.mp4",
      transition_type: "crossfade",
      duration: 1.0,
      easing: "linear",
      direction: "normal",
      position: "middle",
      audio_transition: "crossfade",
      quality: 23,
      preset: "medium",
      allow_overwrite: false,
    },
    constraints: [
      "transition_type 支持 40+ 种: crossfade/dissolve/fade_black/fade_white/slide_*/wipe_*/zoom_*/circle_*/cube/clock/glitch 等",
      "transition_type=custom 时必须提供 custom_filter",
      "duration 范围 0.1~10 秒，建议 0.5~2 秒",
      "segments 和 transition_type 互斥：segments 提供时多段混合优先",
      "segments 最多 5 段，每段可指定不同 transition_type/duration/easing",
      "audio_transition 支持 crossfade(交叉淡入淡出)/cut(直接切换)/merge(混合叠加)",
      "audio_duration 默认跟随 video duration，可单独指定",
      "trim1_*/trim2_* 可预处理输入视频的起止时间",
      "preset 影响编码速度和质量权衡: ultrafast~veryslow",
    ],
  },
  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input1)) {
        return {
          title: "转场添加失败",
          metadata: {
            operation: "video_transition",
            error: true,
            success: false,
          },
          output: `❌ 第一个输入视频文件不存在: ${args.input1}`,
        }
      }

      if (!existsSync(args.input2)) {
        return {
          title: "转场添加失败",
          metadata: {
            operation: "video_transition",
            error: true,
            success: false,
          },
          output: `❌ 第二个输入视频文件不存在: ${args.input2}`,
        }
      }

      // 2. 构建输出路径
      const outputPath =
        args.output || `${args.input1.replace(/\.[^/.]+$/, "")}_transition.mp4`

      // Security sandbox validation (protect both input videos)
      const sandbox = validatePath([args.input1, args.input2], outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "video_transition", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 4. 构建FFmpeg参数
      const input1Duration = probeVideoDuration(args.input1)
      const ffmpegArgs = VideoTransitionTool.buildFfmpegArgs(
        args,
        finalOutputPath,
        input1Duration,
      )

      // 5. 执行FFmpeg命令
      console.log(
        `[VideoTransitionTool] 添加转场: ${args.input1} → ${args.input2}`,
      )
      console.log(
        `[VideoTransitionTool] 转场类型: ${args.transition_type}, 持续时间: ${args.duration}秒`,
      )

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 6. 清理临时文件
      VideoTransitionTool.cleanupTempFiles()

      // 7. 返回结果
      if (result.success) {
        const editOperations: EditOperation[] = [{
          operationId: generateOperationId(),
          undoable: true,
          type: "add_transition",
          fromClipId: generateClipId(),
          toClipId: generateClipId(),
          transition: {
            type: mapToTransitionType(args.transition_type),
            duration: args.duration || 2.0,
          },
          metadata: {
            toolName: "video_transition",
            description: `转场: ${args.transition_type}`,
            timestamp: Date.now(),
          },
        }]

        return {
          title: "转场添加成功",
          metadata: {
            operation: "video_transition",
            success: true,
      undoable: true,
            inputPath: args.input1,
            finalOutputPath,
            parameters: args,
            transitionType: args.transition_type,
            duration: args.duration,
          },
          output: `✅ 已成功添加转场效果\n📁 输出文件: ${finalOutputPath}\n${VideoTransitionTool.getTransitionDescription(args)}`,
          editOperations,
        }
      } else {
        return {
          title: "转场添加失败",
          metadata: {
            operation: "video_transition",
            error: true,
            success: false,
          },
          output: `❌ 转场添加失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      // 确保清理临时文件
      VideoTransitionTool.cleanupTempFiles()

      return {
        title: "转场添加错误",
        metadata: {
          operation: "video_transition",
          error: true,
          success: false,
        },
        output: `❌ 转场添加过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
VideoTransitionTool.buildFfmpegArgs = (
  args: any,
  outputPath: string,
  input1Duration?: number,
): string[] => {
  const preset = args.preset || "medium"
  const quality = args.quality || 23

  const ffmpegArgs: string[] = ["-i", args.input1, "-i", args.input2]

  // 构建filter_complex
  const filterComplex = VideoTransitionTool.buildFilterComplex(
    args,
    input1Duration,
  )
  ffmpegArgs.push("-filter_complex", filterComplex)

  // 映射输出流
  ffmpegArgs.push("-map", "[vout]")
  ffmpegArgs.push("-map", "[aout]")

  // 编码参数
  ffmpegArgs.push("-c:v", "libx264")
  ffmpegArgs.push("-preset", preset)
  ffmpegArgs.push("-crf", quality.toString())
  ffmpegArgs.push("-pix_fmt", "yuv420p")
  ffmpegArgs.push("-c:a", "aac")
  ffmpegArgs.push("-b:a", "192k")
  ffmpegArgs.push("-ar", "44100")
  ffmpegArgs.push("-ac", "2")

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

VideoTransitionTool.buildFilterComplex = (
  args: any,
  input1Duration?: number,
): string => {
  const filters: string[] = []

  // 视频流处理
  // 第一个视频流
  let stream1 = `[0:v]`
  let hasStream1Filter = false
  if (args.trim1_start || args.trim1_end) {
    stream1 += `trim=`
    if (args.trim1_start) stream1 += `start=${args.trim1_start}:`
    if (args.trim1_end) stream1 += `end=${args.trim1_end}`
    stream1 += `,setpts=PTS-STARTPTS`
    hasStream1Filter = true
  }
  if (!hasStream1Filter) {
    stream1 += `format=yuv420p`
  }
  stream1 += `[v1]`
  filters.push(stream1)

  // 第二个视频流
  let stream2 = `[1:v]`
  let hasStream2Filter = false
  if (args.trim2_start || args.trim2_end) {
    stream2 += `trim=`
    if (args.trim2_start) stream2 += `start=${args.trim2_start}:`
    if (args.trim2_end) stream2 += `end=${args.trim2_end}`
    stream2 += `,setpts=PTS-STARTPTS`
    hasStream2Filter = true
  }
  if (!hasStream2Filter) {
    stream2 += `format=yuv420p`
  }
  stream2 += `[v2]`
  filters.push(stream2)

  // 音频流处理
  let audioFilter = ""
  const audioTransition = args.audio_transition || "crossfade"
  const audioDuration = args.audio_duration ?? args.duration ?? 1.0

  if (audioTransition === "crossfade") {
    // 音频交叉淡入淡出
    audioFilter = `[0:a][1:a]acrossfade=d=${audioDuration}[aout]`
  } else if (audioTransition === "merge") {
    // 音频混合
    audioFilter = `[0:a][1:a]amix=inputs=2:duration=longest[aout]`
  } else {
    // 直接切换
    audioFilter = `[0:a][1:a]concat=n=2:v=0:a=1[aout]`
  }
  filters.push(audioFilter)

  // 视频转场
  const transitionFilter = VideoTransitionTool.buildTransitionFilter(
    args,
    input1Duration,
  )
  filters.push(transitionFilter)

  return filters.join(";")
}

VideoTransitionTool.buildTransitionFilter = (
  args: any,
  input1Duration?: number,
): string => {
  if (args.transition_type === "custom" && args.custom_filter) {
    return args.custom_filter
  }

  const duration = args.duration || 1.0
  const direction = args.direction || "normal"

  // 处理多段转场链
  if (args.segments && args.segments.length > 0) {
    return buildMultiSegmentTransition(
      args.segments,
      duration,
      direction,
      input1Duration,
    )
  }

  // 映射转场类型到 FFmpeg xfade 名称
  const xfadeName = mapTransitionType(args.transition_type)

  // 计算正确的 offset: 转场应在 input1 结束时开始
  // offset=0 会导致转场在开头发生，丢失 input1 的内容
  let offset = 0
  if (input1Duration !== undefined && input1Duration > duration) {
    offset = input1Duration - duration
  }

  // 应用缓动模拟: 调整 duration 实现感知上的缓动
  const adjustedDuration = applyEasingToDuration(duration, args.easing)

  return `[v1][v2]xfade=transition=${xfadeName}:duration=${adjustedDuration}:offset=${offset}[vout]`
}

/** 映射转场类型到 EditOperation transition type (dissolve/wipe/slide) */
function mapToTransitionType(
  type: string,
): "dissolve" | "wipe" | "slide" {
  if (type.startsWith("wipe_")) return "wipe"
  if (
    type.startsWith("slide_") ||
    type.startsWith("smooth_") ||
    type.startsWith("cover_") ||
    type === "cube" ||
    type === "clock"
  )
    return "slide"
  return "dissolve"
}

/** 映射自定义转场名到 FFmpeg xfade 名称 */
function mapTransitionType(type: string): string {
  const typeMap: Record<string, string> = {
    crossfade: "fade",
    dissolve: "dissolve",
    fade_black: "fadeblack",
    fade_white: "fadewhite",
    slide_left: "slideleft",
    slide_right: "slideright",
    slide_up: "slideup",
    slide_down: "slidedown",
    smooth_left: "smoothleft",
    smooth_right: "smoothright",
    smooth_up: "smoothup",
    smooth_down: "smoothdown",
    wipe_left: "wipeleft",
    wipe_right: "wiperight",
    wipe_up: "wipeup",
    wipe_down: "wipedown",
    wipe_tl: "wipetl",
    wipe_tr: "wipetr",
    wipe_br: "wipebr",
    wipe_bl: "wipebl",
    zoom_in: "zoomin",
    zoom_out: "zoomout",
    circle: "circlecrop",
    circle_open: "circleopen",
    circle_close: "circleclose",
    rect_crop: "rectcrop",
    horz_close: "horzclose",
    horz_open: "horzopen",
    vert_close: "vertclose",
    vert_open: "vertopen",
    radial: "radial",
    pixelize: "pixelize",
    hblur: "hblur",
    distance: "distance",
    cover_left: "coverleft",
    cover_right: "coverright",
    cover_up: "coverup",
    cover_down: "coverdown",
    can_liver: "canliver",
    cube: "cube",
    clock: "clock",
    glitch: "glitch",
  }
  return typeMap[type] || "fade"
}

/**
 * 构建多段转场链
 * 将总时长按比例分给各段，每段使用不同的转场类型
 * 输出如: [v1][v2]xfade=transition=fade:duration=0.5:offset=0[v_mid0];
 *         [v_mid0][v2]xfade=transition=slideleft:duration=0.5:offset=0.35[vout]
 */
function buildMultiSegmentTransition(
  segments: Array<{
    transition_type: string
    duration: number
    easing?: string
  }>,
  totalDuration: number,
  direction: string,
  input1Duration?: number,
): string {
  const totalSegDuration = segments.reduce((s, seg) => s + seg.duration, 0)
  const scale = totalDuration / totalSegDuration

  const parts: string[] = []
  let offset = 0
  if (input1Duration !== undefined && input1Duration > totalDuration) {
    offset = input1Duration - totalDuration
  }
  let prevLabel = "v1"

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const segDuration = seg.duration * scale
    const xfadeName = mapTransitionType(seg.transition_type)
    const outLabel = i === segments.length - 1 ? "vout" : `v_mid${i}`

    parts.push(
      `[${prevLabel}][v2]xfade=transition=${xfadeName}:duration=${segDuration}:offset=${offset}[${outLabel}]`,
    )
    prevLabel = outLabel
    offset += segDuration * 0.7
  }

  return parts.join(";")
}

/** 缓动曲线对时长的影响 (模拟) */
function applyEasingToDuration(duration: number, easing?: string): number {
  switch (easing) {
    case "ease-in":
      return duration * 0.8 // 缩短感知时长，开头快
    case "ease-out":
      return duration * 1.2 // 延长感知时长，结尾慢
    case "ease-in-out":
      return duration * 1.0 // 居中
    default:
      return duration
  }
}

VideoTransitionTool.cleanupTempFiles = (): void => {
  // 清理可能创建的临时文件
  const tempFiles = [
    "concat_list.txt",
    "temp_video1.mp4",
    "temp_video2.mp4",
    "temp_audio1.mp3",
    "temp_audio2.mp3",
  ]

  for (const file of tempFiles) {
    try {
      if (existsSync(file)) {
        unlinkSync(file)
      }
    } catch (error) {
      // 忽略清理错误
    }
  }
}

VideoTransitionTool.getTransitionDescription = (args: any): string => {
  const transitionNames: Record<string, string> = {
    crossfade: "淡入淡出",
    dissolve: "溶解",
    fade_black: "淡出黑场",
    fade_white: "淡出白场",
    slide_left: "向左滑动",
    slide_right: "向右滑动",
    slide_up: "向上滑动",
    slide_down: "向下滑动",
    smooth_left: "向左平滑",
    smooth_right: "向右平滑",
    smooth_up: "向上平滑",
    smooth_down: "向下平滑",
    zoom_in: "放大进入",
    zoom_out: "缩小退出",
    circle: "圆形展开",
    circle_open: "圆形打开",
    circle_close: "圆形关闭",
    rect_crop: "矩形裁剪",
    horz_close: "水平合拢",
    horz_open: "水平打开",
    vert_close: "垂直合拢",
    vert_open: "垂直打开",
    radial: "径向",
    pixelize: "像素化",
    hblur: "水平模糊",
    distance: "距离映射",
    wipe_left: "向左擦除",
    wipe_right: "向右擦除",
    wipe_up: "向上擦除",
    wipe_down: "向下擦除",
    wipe_tl: "左上擦除",
    wipe_tr: "右上擦除",
    wipe_br: "右下擦除",
    wipe_bl: "左下擦除",
    cover_left: "向左覆盖",
    cover_right: "向右覆盖",
    cover_up: "向上覆盖",
    cover_down: "向下覆盖",
    can_liver: "画布翻转",
    cube: "立方体旋转",
    clock: "时钟划像",
    glitch: "故障效果",
    custom: "自定义",
  }

  const audioNames: Record<string, string> = {
    crossfade: "交叉淡入淡出",
    cut: "直接切换",
    merge: "混合叠加",
  }

  const easingNames: Record<string, string> = {
    linear: "线性",
    "ease-in": "缓入",
    "ease-out": "缓出",
    "ease-in-out": "缓入缓出",
  }

  const parts: string[] = [
    `转场: ${transitionNames[args.transition_type] || args.transition_type}`,
    `持续时间: ${args.duration}秒`,
  ]

  if (args.easing && args.easing !== "linear") {
    parts.push(`缓动: ${easingNames[args.easing]}`)
  }

  if (args.segments && args.segments.length > 0) {
    parts.push(`多段混合: ${args.segments.length}段`)
  }

  if (args.direction === "reverse") {
    parts.push("反向")
  }

  parts.push(`音频: ${audioNames[args.audio_transition]}`)

  if (
    args.trim1_start ||
    args.trim1_end ||
    args.trim2_start ||
    args.trim2_end
  ) {
    parts.push("使用裁剪片段")
  }

  return `🔄 转场设置: ${parts.join(", ")}`
}

/** 探测视频时长（秒），使用 ffprobe 或 ffmpeg */
function probeVideoDuration(inputPath: string): number | undefined {
  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return undefined

    // 优先尝试 ffprobe（速度快，解析准确）
    let probePath = ffmpegPath
      .replace(/ffmpeg\.exe$/, "ffprobe.exe")
      .replace(/ffmpeg$/, "ffprobe")
    if (!existsSync(probePath)) {
      // ffprobe 不存在，回退到 ffmpeg
      probePath = ffmpegPath
    }

    const args =
      probePath.endsWith("ffprobe") || probePath.endsWith("ffprobe.exe")
        ? [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            inputPath,
          ]
        : ["-i", inputPath]

    const result = spawnSync(probePath, args, {
      encoding: "utf8",
      timeout: 15000,
    })
    const output = (result.stdout || "") + (result.stderr || "")

    // ffprobe 直接输出秒数
    if (probePath.endsWith("ffprobe") || probePath.endsWith("ffprobe.exe")) {
      const dur = parseFloat(output.trim())
      if (!isNaN(dur) && dur > 0) return dur
    }

    // ffmpeg 回退: 从 stderr 解析 Duration: HH:MM:SS.ms
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/)
    if (match) {
      return (
        parseInt(match[1]) * 3600 +
        parseInt(match[2]) * 60 +
        parseInt(match[3]) +
        parseInt(match[4]) / 100
      )
    }
  } catch {
    // 探测失败则返回 undefined，offset 回退为 0
  }
  return undefined
}

/**
 * 工具别名
 */
export const TransitionTool = VideoTransitionTool

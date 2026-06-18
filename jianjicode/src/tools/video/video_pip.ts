import { existsSync } from "fs"
import { basename, dirname, extname, join, resolve } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { runFfmpeg } from "../../lib/ffmpeg-utils.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// For CommonJS compatibility

/**
 * 画中画工具 - 将小视频叠加到大视频上
 *
 * 支持功能:
 * 1. 位置控制: 9个预设位置 + 自定义坐标
 * 2. 大小控制: 固定大小、百分比、自适应
 * 3. 边框和圆角: 自定义外观
 * 4. 时间控制: 指定时间段显示
 * 5. 动画效果: 进入退出动画
 */
export const VideoPipTool: any = Tool.define("video_pip", {
  description: "将小视频作为画中画叠加到大视频上",
  parameters: z.object({
    // 输入输出
    main_video: z.string().describe("主视频文件路径 (大视频)"),
    pip_video: z.string().describe("画中画视频文件路径 (小视频)"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <main_video>_pip.<ext>)"),

    // 位置控制
    position: z
      .enum([
        "top-left",
        "top-center",
        "top-right",
        "center-left",
        "center",
        "center-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
        "custom",
      ])
      .optional()
      .default("bottom-right")
      .describe("画中画位置 (默认: bottom-right-右下角)"),

    // 自定义位置 (当position='custom'时使用)
    position_x: z
      .union([z.string(), z.number()])
      .optional()
      .default("10")
      .describe("X轴位置 (像素或百分比，如 '10' 或 '10%'，默认: 10)"),
    position_y: z
      .union([z.string(), z.number()])
      .optional()
      .default("10")
      .describe("Y轴位置 (像素或百分比，如 '10' 或 '10%'，默认: 10)"),

    // 大小控制
    size_type: z
      .enum(["percentage", "pixel", "auto", "width", "height"])
      .optional()
      .default("percentage")
      .describe(
        "大小类型: percentage(百分比), pixel(像素), auto(自动适应), width(指定宽度), height(指定高度)",
      ),
    size_value: z
      .union([z.string(), z.number()])
      .optional()
      .default("20")
      .describe("大小值 (百分比如 '20%'，像素如 200，默认: 20)"),

    // 外观控制
    border_width: z
      .number()
      .min(0)
      .max(20)
      .optional()
      .default(3)
      .describe("边框宽度 (0-20，默认: 3)"),
    border_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("FFFFFF")
      .describe("边框颜色 (十六进制，默认: FFFFFF-白色)"),
    border_radius: z
      .number()
      .min(0)
      .max(50)
      .optional()
      .default(10)
      .describe("圆角半径 (0-50，默认: 10)"),
    shadow: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否显示阴影 (默认: 是)"),
    shadow_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("000000")
      .describe("阴影颜色 (十六进制，默认: 000000-黑色)"),
    shadow_opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.5)
      .describe("阴影透明度 (0-1，默认: 0.5)"),

    // 时间控制
    start_time: z
      .string()
      .optional()
      .describe("开始显示时间 (格式: HH:MM:SS 或 秒数，空表示从头开始)"),
    end_time: z
      .string()
      .optional()
      .describe("结束显示时间 (格式: HH:MM:SS 或 秒数，空表示到结束)"),
    fade_in: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .default(0)
      .describe("淡入时间 (秒，0-5，默认: 0)"),
    fade_out: z
      .number()
      .min(0)
      .max(5)
      .optional()
      .default(0)
      .describe("淡出时间 (秒，0-5，默认: 0)"),
    loop: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否循环播放画中画视频 (默认: 否)"),

    // 音频处理
    audio_source: z
      .enum(["main", "pip", "mix", "none"])
      .optional()
      .default("main")
      .describe(
        "音频来源: main(主视频), pip(画中画视频), mix(混合), none(无音频，默认: main)",
      ),
    pip_audio_volume: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .default(50)
      .describe("画中画音频音量百分比 (0-200，默认: 50)"),

    // 安全增强参数
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
      main_video: "{source_video}",
      pip_video: "{output_dir}/overlay.mp4",
      output: "{output_dir}/pip_{timestamp}.mp4",
      position: "bottom-right",
      size_type: "percentage",
      size_value: "20",
      border_width: 3,
      border_color: "FFFFFF",
      border_radius: 10,
      shadow: true,
      audio_source: "main",
      quality: 23,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "主视频和画中画视频均需存在",
      "position 预设 9 个 + custom (同 watermark 位置系统)",
      "size_type=percentage 时 size_value 为百分比(如 '20%')",
      "size_type=pixel 时 size_value 为像素值",
      "border_width 0-20，0=无边框",
      "border_radius 0-50 像素，0=直角",
      "start_time/end_time 控制 PiP 出现时间段",
      "audio_source: main(主视频)/pip(画中画)/mix(混合)/none(无音频)",
    ],
  },

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.main_video)) {
        return {
          title: "画中画添加失败",
          metadata: { operation: "video_pip", error: true, success: false },
          output: `❌ 主视频文件不存在: ${args.main_video}`,
        }
      }

      if (!existsSync(args.pip_video)) {
        return {
          title: "画中画添加失败",
          metadata: { operation: "video_pip", error: true, success: false },
          output: `❌ 画中画视频文件不存在: ${args.pip_video}`,
        }
      }

      const outputPath =
        args.output || `${args.main_video.replace(/\.[^/.]+$/, "")}_pip.mp4`

      // 安全沙箱校验
      const sandbox = validatePath([args.main_video, args.pip_video], outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "video_pip", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 4. 构建FFmpeg参数
      const ffmpegArgs = VideoPipTool.buildFfmpegArgs(args, finalOutputPath)

      // 5. 执行FFmpeg命令
      console.log(`[VideoPipTool] 添加画中画到: ${args.main_video}`)
      console.log(`[VideoPipTool] 画中画视频: ${args.pip_video}`)
      console.log(
        `[VideoPipTool] 位置: ${args.position}, 大小: ${args.size_type}=${args.size_value}`,
      )

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 6. 返回结果
      if (result.success) {
        const editOperations: EditOperation[] = [{
          operationId: generateOperationId(),
          undoable: true,
          type: "add_effect",
          targetClipId: generateClipId(),
          effect: {
            type: "picture_in_picture",
            params: {
              pip_video: args.pip_video,
              position: args.position || "bottom-right",
              position_x: args.position_x,
              position_y: args.position_y,
              size_type: args.size_type,
              size_value: args.size_value,
              border_width: args.border_width,
              border_color: args.border_color,
              border_radius: args.border_radius,
              shadow: args.shadow,
              start_time: args.start_time,
              end_time: args.end_time,
              fade_in: args.fade_in,
              fade_out: args.fade_out,
              audio_source: args.audio_source,
            },
          },
          metadata: {
            toolName: "video_pip",
            description: `画中画: ${args.position}`,
            timestamp: Date.now(),
          },
        }]

        return {
          title: "画中画添加成功",
          metadata: {
            operation: "video_pip",
            success: true,
      undoable: true,
            error: false,
            inputPath: args.main_video,
            outputPath: finalOutputPath,
            parameters: args,
            position: args.position,
            sizeType: args.size_type,
          },
          output: `✅ 已成功添加画中画\n📁 输出文件: ${finalOutputPath}\n${VideoPipTool.getPipDescription(args)}`,
          editOperations,
        }
      } else {
        return {
          title: "画中画添加失败",
          metadata: { operation: "video_pip", error: true, success: false },
          output: `❌ 画中画添加失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "画中画添加错误",
        metadata: { operation: "video_pip", error: true, success: false },
        output: `❌ 画中画添加过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
VideoPipTool.buildFfmpegArgs = function (
  args: any,
  outputPath: string,
): string[] {
  // 【关键修复】强制所有参数有默认值，彻底避免 undefined 或空值
  const audioSource = args.audio_source || "main"
  const quality = args.quality || 23
  const preset = args.preset || "medium"

  const ffmpegArgs: string[] = ["-i", args.main_video, "-i", args.pip_video]

  // 构建filter_complex
  const filterComplex = this.buildFilterComplex(args)
  ffmpegArgs.push("-filter_complex", filterComplex)

  // 映射输出流
  ffmpegArgs.push("-map", "[vout]")

  // 音频处理
  if (audioSource === "none") {
    ffmpegArgs.push("-an") // 无音频
  } else {
    ffmpegArgs.push("-map", "[aout]")
  }

  // 编码参数
  ffmpegArgs.push("-c:v", "libx264")
  ffmpegArgs.push("-preset", preset)
  ffmpegArgs.push("-crf", quality.toString())
  ffmpegArgs.push("-pix_fmt", "yuv420p")

  if (audioSource !== "none") {
    // 对所有音频源使用AAC编码（因为都经过了过滤处理）
    ffmpegArgs.push("-c:a", "aac")
    ffmpegArgs.push("-b:a", "192k")
    ffmpegArgs.push("-ar", "44100")
    ffmpegArgs.push("-ac", "2")
  }

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

VideoPipTool.buildFilterComplex = function (args: any): string {
  const filters: string[] = []

  // 主视频流 - 确保至少有一个滤镜
  let mainStream = `[0:v]`
  let hasMainFilter = false

  // 时间裁剪
  if (args.start_time || args.end_time) {
    mainStream += `trim=`
    if (args.start_time) mainStream += `start=${args.start_time}:`
    if (args.end_time) mainStream += `end=${args.end_time}`
    mainStream += `,setpts=PTS-STARTPTS`
    hasMainFilter = true
  }

  // 如果没有滤镜，添加format滤镜确保兼容性
  if (!hasMainFilter) {
    mainStream += `format=yuv420p`
  }

  mainStream += `[main]`
  filters.push(mainStream)

  // 画中画视频流 - 收集滤镜部分
  const pipFilters: string[] = []

  // 调整大小
  const scaleFilter = this.getScaleFilter(args)
  if (scaleFilter) {
    pipFilters.push(scaleFilter.replace(/^,/, ""))
  }

  // 边框和圆角
  if (args.border_width > 0 || args.border_radius > 0) {
    const borderFilter = this.getBorderFilter(args)
    if (borderFilter) {
      pipFilters.push(borderFilter.replace(/^,/, ""))
    }
  }

  // 阴影
  if (args.shadow) {
    const shadowFilter = this.getShadowFilter(args)
    if (shadowFilter) {
      // 阴影滤镜可能包含多个部分，用逗号分隔
      pipFilters.push(shadowFilter.replace(/^,/, ""))
    }
  }

  // 时间控制 (淡入淡出)
  if (args.fade_in > 0 || args.fade_out > 0) {
    const fadeFilter = this.getFadeFilter(args)
    if (fadeFilter) {
      pipFilters.push(fadeFilter.replace(/^,/, ""))
    }
  }

  // 循环
  if (args.loop) {
    pipFilters.push(`loop=loop=-1:size=1:start=0`)
  }

  // 构建画中画滤镜链
  let pipStream = `[1:v]`
  if (pipFilters.length > 0) {
    pipStream += pipFilters.join(",")
  } else {
    pipStream += `format=yuv420p`
  }
  pipStream += `[pip]`
  filters.push(pipStream)

  // overlay叠加
  const position = this.getPositionString(args)
  filters.push(`[main][pip]overlay=${position}[vout]`)

  // 音频处理
  const audioFilter = this.getAudioFilter(args)
  if (audioFilter && audioFilter.trim()) {
    filters.push(audioFilter)
  }

  return filters.join(";")
}

VideoPipTool.getScaleFilter = (args: any): string => {
  const size = args.size_value

  switch (args.size_type) {
    case "percentage": {
      const percentage =
        typeof size === "string" ? parseFloat(size.replace("%", "")) : size
      // 使用整数运算避免小数像素值
      return `,scale='iw*${percentage}/100':-2`
    }

    case "pixel": {
      const pixel = typeof size === "string" ? parseInt(size) : size
      // 确保偶数尺寸
      return `,scale='${pixel}:-2'`
    }

    case "width": {
      const width = typeof size === "string" ? parseInt(size) : size
      return `,scale='${width}:-2'`
    }

    case "height": {
      const height = typeof size === "string" ? parseInt(size) : size
      return `,scale='-2:${height}'`
    }

    case "auto":
    default:
      // 自动调整为宽高的25%
      return `,scale='min(iw*0.25,ih*0.25)*sar':-2'`
  }
}

VideoPipTool.getBorderFilter = (args: any): string => {
  let filter = ""
  const borderRadius = args.border_radius !== undefined ? args.border_radius : 0
  const borderWidth = args.border_width !== undefined ? args.border_width : 0
  const borderColor = args.border_color || "FFFFFF"

  // 圆角 — 用圆弧方程替换矩形裁剪伪圆角
  // 像素保留条件：mid(直边区) OR 四角中任一圆弧内
  // 四角圆心: TL(R,R), TR(W-R,R), BL(R,H-R), BR(W-R,H-R)
  if (borderRadius > 0) {
    const R = borderRadius
    filter += `,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(` +
      `gt(gte(X,${R})*lt(X,W-${R})+gte(Y,${R})*lt(Y,H-${R}),0)` +
      `+` +
      `lt(X,${R})*lt(Y,${R})*lte((X-${R})*(X-${R})+(Y-${R})*(Y-${R}),${R}*${R})` +
      `+` +
      `gte(X,W-${R})*lt(Y,${R})*lte((X-(W-${R}))*(X-(W-${R}))+(Y-${R})*(Y-${R}),${R}*${R})` +
      `+` +
      `lt(X,${R})*gte(Y,H-${R})*lte((X-${R})*(X-${R})+(Y-(H-${R}))*(Y-(H-${R})),${R}*${R})` +
      `+` +
      `gte(X,W-${R})*gte(Y,H-${R})*lte((X-(W-${R}))*(X-(W-${R}))+(Y-(H-${R}))*(Y-(H-${R})),${R}*${R})` +
      `,alpha(X,Y),0)'`
  }

  // 边框
  if (borderWidth > 0) {
    filter += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x${borderColor}:t=${borderWidth}`
  }

  return filter
}

VideoPipTool.getShadowFilter = (args: any): string => {
  // 创建阴影效果
  return `,split[orig][shadow];[shadow]format=rgba,colorchannelmixer=aa=${args.shadow_opacity},boxblur=10[shadow];[shadow][orig]overlay=format=auto`
}

VideoPipTool.getFadeFilter = (args: any): string => {
  let filter = ""

  if (args.fade_in > 0) {
    filter += `,fade=in:st=0:d=${args.fade_in}:alpha=1`
  }

  if (args.fade_out > 0) {
    const startTime = args.end_time
      ? `(${args.end_time}-${args.fade_out})`
      : `(N-${args.fade_out}/TB)`
    filter += `,fade=out:st=${startTime}:d=${args.fade_out}:alpha=1`
  }

  return filter
}

VideoPipTool.getPositionString = (args: any): string => {
  // 预设位置映射 - 使用 FFmpeg 正确的变量名: main_w, main_h, overlay_w, overlay_h
  const borderWidth = args.border_width !== undefined ? args.border_width : 3
  const margin = borderWidth + 10
  const positionMap: Record<string, { x: string; y: string }> = {
    "top-left": { x: `${margin}`, y: `${margin}` },
    "top-center": { x: `(main_w-overlay_w)/2`, y: `${margin}` },
    "top-right": { x: `main_w-overlay_w-${margin}`, y: `${margin}` },
    "center-left": { x: `${margin}`, y: `(main_h-overlay_h)/2` },
    center: { x: `(main_w-overlay_w)/2`, y: `(main_h-overlay_h)/2` },
    "center-right": {
      x: `main_w-overlay_w-${margin}`,
      y: `(main_h-overlay_h)/2`,
    },
    "bottom-left": { x: `${margin}`, y: `main_h-overlay_h-${margin}` },
    "bottom-center": {
      x: `(main_w-overlay_w)/2`,
      y: `main_h-overlay_h-${margin}`,
    },
    "bottom-right": {
      x: `main_w-overlay_w-${margin}`,
      y: `main_h-overlay_h-${margin}`,
    },
  }

  if (args.position !== "custom" && positionMap[args.position]) {
    const pos = positionMap[args.position]
    return `${pos.x}:${pos.y}`
  }

  // 自定义位置
  let x = args.position_x || "10"
  let y = args.position_y || "10"

  // 处理百分比
  if (typeof x === "string" && x.includes("%")) {
    x = `(main_w*${parseFloat(x.replace("%", "")) / 100})`
  }
  if (typeof y === "string" && y.includes("%")) {
    y = `(main_h*${parseFloat(y.replace("%", "")) / 100})`
  }

  return `${x}:${y}`
}

VideoPipTool.getAudioFilter = (args: any): string => {
  const audioSource = args.audio_source || "main"
  switch (audioSource) {
    case "main":
      // 转换音频格式以确保AAC编码器兼容性
      return `[0:a?]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1[aout]`

    case "pip": {
      const pipVolume = args.pip_audio_volume || 50
      return `[1:a?]aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${pipVolume / 100}[aout]`
    }

    case "mix":
      return `[0:a?][1:a?]amix=inputs=2:duration=longest,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1.5[aout]`

    case "none":
    default:
      return `` // 无音频 - 返回空字符串
  }
}

VideoPipTool.getPipDescription = (args: any): string => {
  const positionNames: Record<string, string> = {
    "top-left": "左上角",
    "top-center": "顶部居中",
    "top-right": "右上角",
    "center-left": "左侧居中",
    center: "中心",
    "center-right": "右侧居中",
    "bottom-left": "左下角",
    "bottom-center": "底部居中",
    "bottom-right": "右下角",
    custom: "自定义位置",
  }

  const sizeNames: Record<string, string> = {
    percentage: "百分比",
    pixel: "固定像素",
    auto: "自动适应",
    width: "指定宽度",
    height: "指定高度",
  }

  const audioNames: Record<string, string> = {
    main: "主视频音频",
    pip: "画中画音频",
    mix: "混合音频",
    none: "无音频",
  }

  const parts: string[] = [
    `位置: ${positionNames[args.position] || args.position}`,
    `大小: ${sizeNames[args.size_type]}${args.size_type === "percentage" ? ` ${args.size_value}%` : args.size_type === "pixel" ? ` ${args.size_value}px` : ""}`,
    `音频: ${audioNames[args.audio_source]}`,
  ]

  if (args.border_width > 0) {
    parts.push(`边框: ${args.border_width}px #${args.border_color}`)
  }

  if (args.border_radius > 0) {
    parts.push(`圆角: ${args.border_radius}px`)
  }

  if (args.start_time || args.end_time) {
    const timeRange = `${args.start_time || "开始"} - ${args.end_time || "结束"}`
    parts.push(`显示时间: ${timeRange}`)
  }

  if (args.fade_in > 0 || args.fade_out > 0) {
    parts.push(`淡入: ${args.fade_in}s, 淡出: ${args.fade_out}s`)
  }

  if (args.loop) {
    parts.push("循环播放")
  }

  return `📺 画中画设置: ${parts.join(", ")}`
}

/**
 * 工具别名
 */
export const PipTool = VideoPipTool

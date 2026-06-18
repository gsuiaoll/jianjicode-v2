import { existsSync } from "fs"
import { basename, dirname, extname, join, resolve } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { runFfmpeg } from "../../lib/ffmpeg-utils.js"

// For CommonJS compatibility

/**
 * 视频水印工具 - 添加图片或文字水印
 *
 * 支持功能:
 * 1. 图片水印: PNG, JPG, GIF等格式
 * 2. 位置控制: 9个预设位置 + 自定义坐标
 * 3. 大小控制: 固定大小、百分比、自适应
 * 4. 透明度控制: 半透明水印
 * 5. 动画水印: 支持GIF动画水印
 */
export const VideoWatermarkTool: any = Tool.define("video_watermark", {
  description:
    "为视频添加文字或图片水印。支持 9 个预设位置 + 自定义坐标、透明度控制、字体/颜色/大小定制。watermark_type=text 时需 watermark_text；watermark_type=image 时需 watermark_image。\n" +
    "⚠️ 使用场景: 水印/Logo叠加 → 用此工具。滤镜调色 → 用 video_filter。裁剪/拼接 → 用 ffmpeg。速度 → 用 video_speed。",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_watermarked.<ext>)"),

    // 水印类型
    watermark_type: z
      .enum(["image", "text"])
      .optional()
      .default("image")
      .describe("水印类型: image(图片), text(文字)"),

    // 图片水印参数
    watermark_image: z
      .string()
      .optional()
      .describe("水印图片路径 (PNG/JPG/GIF，watermark_type=image时必填)"),

    // 文字水印参数
    watermark_text: z
      .string()
      .optional()
      .describe("水印文字内容 (watermark_type=text时必填)"),
    text_font: z
      .string()
      .optional()
      .default("Arial")
      .describe("文字字体 (默认: Arial)"),
    text_size: z
      .number()
      .min(10)
      .max(200)
      .optional()
      .default(48)
      .describe("文字大小 (10-200，默认: 48)"),
    text_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("FFFFFF")
      .describe("文字颜色 (十六进制，默认: FFFFFF-白色)"),
    text_background: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
      .optional()
      .default("00000080")
      .describe("文字背景颜色 (十六进制，可含透明度，默认: 00000080-半透明黑)"),
    text_border: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .default(2)
      .describe("文字边框宽度 (0-10，默认: 2)"),
    text_border_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("000000")
      .describe("文字边框颜色 (十六进制，默认: 000000-黑色)"),

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
      .describe("水印位置 (默认: bottom-right-右下角)"),

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
      .enum(["percentage", "pixel", "auto"])
      .optional()
      .default("percentage")
      .describe("大小类型: percentage(百分比), pixel(像素), auto(自动适应)"),
    size_value: z
      .union([z.string(), z.number()])
      .optional()
      .default("10")
      .describe("大小值 (百分比如 '10%'，像素如 100，默认: 10)"),

    // 外观控制
    opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.7)
      .describe("透明度 (0-1，0完全透明，1不透明，默认: 0.7)"),
    padding: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(10)
      .describe("内边距 (像素，默认: 10)"),
    animation: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否启用动画水印 (仅GIF图片有效)"),

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
      .max(10)
      .optional()
      .default(0)
      .describe("淡入时间 (秒，默认: 0)"),
    fade_out: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .default(0)
      .describe("淡出时间 (秒，默认: 0)"),

    // 性能选项
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (0-51，越低质量越好，默认 23)"),

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
  }),
  usageTemplate: {
    json: {
      input: "{source_video}",
      output: "{output_dir}/watermarked_{timestamp}.mp4",
      watermark_type: "image",
      watermark_image: "{output_dir}/logo.png",
      position: "bottom-right",
      size_type: "percentage",
      size_value: "15",
      opacity: 0.7,
      quality: 23,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "watermark_type=image 时 watermark_image 必填(PNG/JPG/GIF)",
      "watermark_type=text 时 watermark_text 必填",
      "position 预设 9 个: top-left/top-center/top-right/center-left/center/center-right/bottom-left/bottom-center/bottom-right",
      "position=custom 时使用 position_x/position_y",
      "size_type: percentage(百分比)/pixel(像素)/auto(自适应)/width(指定宽)/height(指定高)",
      "opacity 0-1，0=完全透明，1=完全不透明",
      "start_time/end_time 控制水印出现时间段，不填=全程",
      "GIF 水印支持动画效果",
    ],
  },

  init: async (ctx: any) => {
    console.log("[VideoWatermarkTool] 初始化视频水印工具")
    return {
      description: "为视频添加图片或文字水印，支持位置、大小、透明度控制",
      parameters: VideoWatermarkTool.parameters,
      execute: VideoWatermarkTool.execute,
    }
  },

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "水印添加失败",
          metadata: {
            operation: "video_watermark",
            error: true,
            success: false,
          },
          output: `❌ 输入视频文件不存在: ${args.input}`,
        }
      }

      // 2. 验证水印文件或文字
      if (args.watermark_type === "image") {
        if (!args.watermark_image || !existsSync(args.watermark_image)) {
          return {
            title: "水印添加失败",
            metadata: {
              operation: "video_watermark",
              error: true,
              success: false,
            },
            output: `❌ 水印图片文件不存在: ${args.watermark_image || "未指定"}`,
          }
        }
      } else if (args.watermark_type === "text") {
        if (!args.watermark_text || args.watermark_text.trim() === "") {
          return {
            title: "水印添加失败",
            metadata: {
              operation: "video_watermark",
              error: true,
              success: false,
            },
            output: `❌ 水印文字内容不能为空`,
          }
        }
      }

const outputPath =
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_watermarked.mp4`

      // 安全增强：验证输出路径

      // 安全沙箱校验
      const sandbox = validatePath(args.input, outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "video_watermark", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalOutputPath = sandbox.outputPath

      // 5. 构建FFmpeg参数
      const ffmpegArgs = VideoWatermarkTool.buildFfmpegArgs(
        args,
        finalOutputPath,
      )

      // 6. 执行FFmpeg命令
      console.log(`[VideoWatermarkTool] 添加水印到: ${args.input}`)
      if (args.watermark_type === "image") {
        console.log(
          `[VideoWatermarkTool] 使用水印图片: ${args.watermark_image}`,
        )
      } else {
        console.log(`[VideoWatermarkTool] 使用水印文字: ${args.watermark_text}`)
      }

      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      // 7. 返回结果
      if (result.success) {
        return {
          title: "水印添加成功",
          metadata: {
            operation: "video_watermark",
            success: true,
      undoable: true,
            error: false,
            inputPath: args.input,
            outputPath: finalOutputPath,
            parameters: args,
            watermarkType: args.watermark_type,
          },
          output: `✅ 已成功添加水印到视频\n📁 输出文件: ${finalOutputPath}\n${VideoWatermarkTool.getWatermarkDescription(args)}`,
        }
      } else {
        return {
          title: "水印添加失败",
          metadata: {
            operation: "video_watermark",
            error: true,
            success: false,
          },
          output: `❌ 水印添加失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "水印添加错误",
        metadata: { operation: "video_watermark", error: true, success: false },
        output: `❌ 水印添加过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
VideoWatermarkTool.buildFfmpegArgs = (
  args: any,
  outputPath: string,
): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]

  // 构建filter_complex
  let filterComplex = ""

  if (args.watermark_type === "image") {
    // 图片水印
    ffmpegArgs.push("-i", args.watermark_image!)
    filterComplex = VideoWatermarkTool.buildImageWatermarkFilter(args)
  } else {
    // 文字水印 - 使用drawtext滤镜
    filterComplex = VideoWatermarkTool.buildTextWatermarkFilter(args)
  }

  // 添加filter_complex
  if (filterComplex) {
    if (args.watermark_type === "image") {
      ffmpegArgs.push("-filter_complex", filterComplex)
      ffmpegArgs.push("-map", "[outv]")
      ffmpegArgs.push("-map", "0:a")
    } else {
      ffmpegArgs.push("-vf", filterComplex)
    }
  }

  // 编码参数
  ffmpegArgs.push("-c:v", "libx264")
  ffmpegArgs.push("-c:a", "copy")
  ffmpegArgs.push("-crf", args.quality.toString())

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

VideoWatermarkTool.buildImageWatermarkFilter = (args: any): string => {
  const filters: string[] = []

  // 基本overlay滤镜
  let overlayFilter = `[1:v]`

  // 调整大小
  if (args.size_type === "percentage") {
    const percentage =
      typeof args.size_value === "string"
        ? parseFloat(args.size_value.replace("%", ""))
        : args.size_value
    overlayFilter += `scale=iw*${percentage / 100}:-1`
  } else if (args.size_type === "pixel") {
    const width =
      typeof args.size_value === "string"
        ? parseInt(args.size_value)
        : args.size_value
    overlayFilter += `scale=${width}:-1`
  } else if (args.size_type === "auto") {
    // 自动适应，保持原大小或根据视频大小调整
    overlayFilter += `scale='if(gt(iw,ih),min(200,iw),min(200,ih))':-1`
  }

  // 透明度
  if (args.opacity < 1) {
    overlayFilter += `,format=rgba,colorchannelmixer=aa=${args.opacity}`
  }

  // 动画处理
  if (args.animation) {
    overlayFilter += `,setpts=PTS-STARTPTS`
  }

  filters.push(overlayFilter)

  // 主视频处理
  filters.push(`[0:v]`)

  // 时间范围控制
  let timeFilter = ""
  if (args.start_time || args.end_time) {
    timeFilter = `trim=`
    if (args.start_time) timeFilter += `start=${args.start_time}:`
    if (args.end_time) timeFilter += `end=${args.end_time}`
    timeFilter += ",setpts=PTS-STARTPTS"
  }

  if (timeFilter) {
    filters[filters.length - 1] += `,${timeFilter}`
  }

  // 淡入淡出
  let fadeFilter = ""
  if (args.fade_in > 0 || args.fade_out > 0) {
    fadeFilter = `fade=`
    if (args.fade_in > 0)
      fadeFilter += `in:st=${args.start_time || 0}:d=${args.fade_in}:`
    if (args.fade_out > 0)
      fadeFilter += `out:st=${args.end_time || "N/A"}:d=${args.fade_out}`
  }

  if (fadeFilter) {
    filters[filters.length - 1] += `,${fadeFilter}`
  }

  // overlay位置
  const position = VideoWatermarkTool.getPositionString(args)
  filters.push(`overlay=${position}:format=auto[outv]`)

  return filters.join(";")
}

VideoWatermarkTool.buildTextWatermarkFilter = (args: any): string => {
  const filters: string[] = []

  // 基础drawtext滤镜
  let textFilter = `drawtext=`

  // 文字内容 (需要转义特殊字符)
  const text = (args.watermark_text || "Watermark")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
  textFilter += `text='${text}':`

  // 字体设置
  const textFont = args.text_font || "Arial"
  textFilter += `fontfile='${VideoWatermarkTool.getSystemFontPath(textFont)}':`
  const textSize = args.text_size || 48
  textFilter += `fontsize=${textSize}:`

  // 颜色
  const textColor = args.text_color || "FFFFFF"
  textFilter += `fontcolor=0x${textColor}:`

  // 边框
  const textBorder = args.text_border || 2
  const textBorderColor = args.text_border_color || "000000"
  if (textBorder > 0) {
    textFilter += `bordercolor=0x${textBorderColor}:`
    textFilter += `borderw=${textBorder}:`
  }

  // 位置
  const position = VideoWatermarkTool.getPositionString(args)
  textFilter += `x=${position.split(":")[0]}:y=${position.split(":")[1]}:`

  // 背景框
  const textBackground = args.text_background || "00000080"
  const padding = args.padding || 10
  if (textBackground !== "00000000") {
    textFilter += `box=1:boxcolor=0x${textBackground}:boxborderw=${padding}:`
  }

  // 透明度
  const opacity = args.opacity || 1
  if (opacity < 1) {
    textFilter += `alpha=${opacity.toFixed(2)}:`
  }

  // 时间控制
  if (args.start_time || args.end_time) {
    if (args.start_time) textFilter += `enable='between(t,${args.start_time},`
    if (args.end_time) textFilter += `${args.end_time})':`
    else textFilter += `1000)':` // 默认很大的结束时间
  }

  // 移除末尾的冒号
  textFilter = textFilter.replace(/:$/, "")

  filters.push(textFilter)

  return filters.join(",")
}

VideoWatermarkTool.getPositionString = (args: any): string => {
  // 预设位置映射
  const padding = args.padding || 10
  const positionMap: Record<string, { x: string; y: string }> = {
    "top-left": { x: `${padding}`, y: `${padding}` },
    "top-center": { x: "(w-tw)/2", y: `${padding}` },
    "top-right": { x: `w-tw-${padding}`, y: `${padding}` },
    "center-left": { x: `${padding}`, y: "(h-th)/2" },
    center: { x: "(w-tw)/2", y: "(h-th)/2" },
    "center-right": { x: `w-tw-${padding}`, y: "(h-th)/2" },
    "bottom-left": { x: `${padding}`, y: `h-th-${padding}` },
    "bottom-center": { x: "(w-tw)/2", y: `h-th-${padding}` },
    "bottom-right": { x: `w-tw-${padding}`, y: `h-th-${padding}` },
  }

  if (args.position !== "custom" && positionMap[args.position]) {
    const pos = positionMap[args.position]
    return `${pos.x}:${pos.y}`
  }

  // 自定义位置
  let x = args.position_x
  let y = args.position_y

  // 处理百分比
  if (typeof x === "string" && x.includes("%")) {
    x = `(w*${parseFloat(x.replace("%", "")) / 100})`
  }
  if (typeof y === "string" && y.includes("%")) {
    y = `(h*${parseFloat(y.replace("%", "")) / 100})`
  }

  return `${x}:${y}`
}

VideoWatermarkTool.getSystemFontPath = (fontName: string): string => {
  const platform = process.platform as "win32" | "darwin" | "linux"

  const fontFileMap: Record<string, string | Record<string, string>> = {
    win32: {
      Arial: "arial.ttf",
      Helvetica: "arial.ttf",
      "Times New Roman": "times.ttf",
      "Courier New": "cour.ttf",
      Verdana: "verdana.ttf",
      Tahoma: "tahoma.ttf",
      Consolas: "consola.ttf",
      "Segoe UI": "segoeui.ttf",
      SimSun: "simsun.ttc",
      "Microsoft YaHei": "msyh.ttc",
    },
    darwin: {
      Arial: "/System/Library/Fonts/Supplemental/Arial.ttf",
      Helvetica: "/System/Library/Fonts/Helvetica.ttc",
      "Times New Roman":
        "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
      "Courier New": "/System/Library/Fonts/Supplemental/Courier New.ttf",
      Verdana: "/Library/Fonts/Verdana.ttf",
    },
    linux: {
      Arial: "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
      Helvetica: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "Times New Roman":
        "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf",
      "Courier New": "/usr/share/fonts/truetype/msttcorefonts/Courier_New.ttf",
    },
  }

  const osMap = fontFileMap[platform] as Record<string, string> | undefined

  if (osMap) {
    if (platform === "win32" && osMap[fontName]) {
      return `C\\:/Windows/Fonts/${osMap[fontName]}`
    }
    if (osMap[fontName]) return osMap[fontName]
  }

  // 用户指定了完整路径
  if (fontName.includes("/") || fontName.includes("\\")) return fontName

  // fallback: 传字体名给 FFmpeg，依赖 fontconfig
  if (platform === "win32") return `C\\:/Windows/Fonts/arial.ttf`
  return fontName
}

VideoWatermarkTool.getWatermarkDescription = (args: any): string => {
  const parts: string[] = []

  if (args.watermark_type === "image") {
    parts.push(`类型: 图片水印`)
    parts.push(
      `图片: ${args.watermark_image?.split("/").pop()?.split("\\").pop()}`,
    )
  } else {
    parts.push(`类型: 文字水印`)
    parts.push(
      `文字: ${args.watermark_text?.substring(0, 20)}${args.watermark_text!.length > 20 ? "..." : ""}`,
    )
    parts.push(`字体: ${args.text_font} ${args.text_size}px`)
  }

  parts.push(`位置: ${args.position}`)
  parts.push(
    `大小: ${args.size_type === "percentage" ? args.size_value + "%" : args.size_type === "pixel" ? args.size_value + "px" : "自动"}`,
  )
  parts.push(`透明度: ${Math.round(args.opacity * 100)}%`)

  if (args.start_time || args.end_time) {
    const timeRange = `${args.start_time || "开始"} - ${args.end_time || "结束"}`
    parts.push(`显示时间: ${timeRange}`)
  }

  if (args.fade_in > 0 || args.fade_out > 0) {
    parts.push(`淡入: ${args.fade_in}s, 淡出: ${args.fade_out}s`)
  }

  return `💧 水印设置: ${parts.join(", ")}`
}

/**
 * 工具别名
 */
export const WatermarkTool = VideoWatermarkTool

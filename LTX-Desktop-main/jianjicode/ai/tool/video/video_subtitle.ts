import { existsSync } from "fs"
import { isAbsolute, join, relative } from "path"
import z from "zod"
import { addSubtitle as pythonAddSubtitle } from "../../../server/python_client.js"
import { Tool } from "../tool.js"
import { getVideoInfo, runFfmpeg } from "./ffmpeg-utils.js"

export const VideoSubtitleTool = Tool.define("video_subtitle", {
  description: "为视频添加字幕 (支持SRT/ASS格式)，支持多段定时字幕实现逐句显示",
  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    subtitle_file: z
      .string()
      .optional()
      .describe("字幕文件路径 (支持 .srt 或 .ass 格式，与text/timed_lines三选一)"),
    text: z
      .string()
      .optional()
      .describe("单段字幕文本 (与subtitle_file/timed_lines三选一)"),
    timed_lines: z
      .array(z.object({
        text: z.string().describe("字幕文本"),
        start_time: z.number().min(0).describe("开始时间(秒)"),
        end_time: z.number().min(0).describe("结束时间(秒)"),
      }))
      .min(1)
      .max(50)
      .optional()
      .describe("多段定时字幕列表，用于逐句显示 (与text/subtitle_file三选一)。每条字幕在各自的时段独立显示，AI应根据视频场景变化分配时间轴"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_subtitled.<ext>)"),

    encoding: z
      .enum(["hard", "soft"])
      .optional()
      .default("hard")
      .describe("字幕编码方式: hard(硬字幕-嵌入视频), soft(软字幕-可开关)"),

    font_name: z
      .string()
      .optional()
      .default("Arial")
      .describe("字体名称 (默认: Arial)"),
    font_size: z
      .number()
      .min(10)
      .max(100)
      .optional()
      .default(24)
      .describe("字体大小 (10-100，默认: 24)"),
    font_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("FFFFFF")
      .describe("字体颜色 (十六进制，默认: FFFFFF-白色)"),
    border_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}$/)
      .optional()
      .default("000000")
      .describe("边框颜色 (十六进制，默认: 000000-黑色)"),
    border_width: z
      .number()
      .min(0)
      .max(10)
      .optional()
      .default(1)
      .describe("边框宽度 (0-10，默认: 1)"),
    background_color: z
      .string()
      .regex(/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/)
      .optional()
      .default("00000080")
      .describe("背景颜色 (十六进制，可含透明度，默认: 00000080-半透明黑)"),

    position: z
      .enum(["bottom", "top", "middle"])
      .optional()
      .default("bottom")
      .describe("字幕位置: bottom(底部), top(顶部), middle(中间)"),
    alignment: z
      .enum(["center", "left", "right"])
      .optional()
      .default("center")
      .describe("对齐方式: center(居中), left(左对齐), right(右对齐)"),
    margin_v: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .default(30)
      .describe("垂直边距 (像素，默认: 30)"),
    margin_h: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .default(30)
      .describe("水平边距 (像素，默认: 30)"),

    offset_seconds: z
      .number()
      .optional()
      .default(0)
      .describe("时间偏移 (秒，正数延后，负数提前)"),
    speed_factor: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(1)
      .describe("播放速度因子 (0.1-10，默认: 1)"),
    start_time: z
      .number()
      .min(0)
      .optional()
      .describe("字幕开始时间 (秒，仅当使用text参数时有效)"),
    end_time: z
      .number()
      .min(0)
      .optional()
      .describe("字幕结束时间 (秒，仅当使用text参数时有效)"),

    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (0-51，越低质量越好，默认 23)"),

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

  execute: async (args: any, ctx: any) => {
    try {
      if (!existsSync(args.input)) {
        return {
          title: "字幕添加失败",
          metadata: { operation: "video_subtitle", error: true },
          output: `❌ 输入视频文件不存在: ${args.input}`,
        }
      }

      const hasSubtitleFile =
        args.subtitle_file && existsSync(args.subtitle_file)
      const hasText = args.text && args.text.trim().length > 0
      const hasTimedLines = args.timed_lines && args.timed_lines.length > 0

      const modeCount = [hasSubtitleFile, hasText, hasTimedLines].filter(Boolean).length
      if (modeCount === 0) {
        return {
          title: "字幕添加失败",
          metadata: { operation: "video_subtitle", error: true, success: false },
          output: `❌ 必须提供字幕文件(subtitle_file)、直接文本(text)或多段定时字幕(timed_lines)`,
        }
      }
      if (modeCount > 1) {
        return {
          title: "字幕添加失败",
          metadata: { operation: "video_subtitle", error: true, success: false },
          output: `❌ subtitle_file、text、timed_lines 只能选择一种`,
        }
      }

      if (hasSubtitleFile) {
        const subtitleExt = args.subtitle_file.toLowerCase().split(".").pop()
        if (!["srt", "ass"].includes(subtitleExt || "")) {
          return {
            title: "字幕添加失败",
            metadata: { operation: "video_subtitle", error: true, success: false },
            output: `❌ 不支持的字幕格式: ${subtitleExt}，请使用 .srt 或 .ass 格式`,
          }
        }
      } else if (hasText) {
        if (args.start_time === undefined || args.end_time === undefined) {
          return {
            title: "字幕添加失败",
            metadata: { operation: "video_subtitle", error: true, success: false },
            output: `❌ 使用直接文本字幕时，必须提供start_time和end_time参数`,
          }
        }
        if (args.start_time >= args.end_time) {
          return {
            title: "字幕添加失败",
            metadata: { operation: "video_subtitle", error: true, success: false },
            output: `❌ start_time必须小于end_time`,
          }
        }
      } else if (hasTimedLines) {
        for (let i = 0; i < args.timed_lines.length; i++) {
          const line = args.timed_lines[i]
          if (!line.text || line.text.trim().length === 0) {
            return {
              title: "字幕添加失败",
              metadata: { operation: "video_subtitle", error: true, success: false },
              output: `❌ timed_lines[${i}].text 不能为空`,
            }
          }
          if (line.start_time >= line.end_time) {
            return {
              title: "字幕添加失败",
              metadata: { operation: "video_subtitle", error: true, success: false },
              output: `❌ timed_lines[${i}] start_time必须小于end_time`,
            }
          }
        }
      }

      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      const { resolve: pathResolve, dirname: pathDirname, relative: pathRelative, basename: pathBasename, extname: pathExtname, isAbsolute: pathIsAbsolute, join: pathJoin } = await import("path")
      const { existsSync: fsExists, mkdirSync: fsMkdir, unlinkSync: fsUnlink, writeFileSync: fsWriteFile } = await import("fs")

      const outputPath = pathResolve(
        args.output || `${args.input.replace(/\.[^/.]+$/, "")}_subtitled.mp4`,
      )

      // Ensure output directory exists
      const outDir = pathDirname(outputPath)
      if (!fsExists(outDir)) {
        fsMkdir(outDir, { recursive: true })
      }
      let finalOutputPath = outputPath

      if (protectOriginals) {
        const inputResolved = pathResolve(args.input)
        const outputResolved = pathResolve(outputPath)
        if (outputResolved === inputResolved) {
          const ext = pathExtname(args.input)
          const base = pathBasename(args.input, ext)
          const dir = pathDirname(args.input)
          finalOutputPath = pathJoin(dir, `${base}_subtitled_safe${ext}`)
          console.log(
            `[安全增强] 原文件保护已启用，自动修改输出路径为: ${finalOutputPath}`,
          )
        }
      }

      if (outputDir && outputDir.trim()) {
        const outputDirResolved = pathResolve(outputDir)
        const outputPathResolved = pathResolve(finalOutputPath)
        const relative = pathRelative(outputDirResolved, outputPathResolved)
        if (relative.startsWith("..") || pathIsAbsolute(relative)) {
          return {
            title: "安全验证失败",
            metadata: {
              operation: "video_subtitle",
              error: true,
              success: false,
            },
            output: `❌ 输出路径必须在指定目录内: ${outputDirResolved}`,
          }
        }
      }

      if (!allowOverwrite && fsExists(finalOutputPath)) {
        return {
          title: "安全验证失败",
          metadata: {
            operation: "video_subtitle",
            error: true,
            success: false,
          },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      if (fsExists(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      console.log(`[VideoSubtitleTool] 添加字幕到: ${args.input}`)

      // 获取视频实际分辨率，用于精确计算每行最大字符数
      let videoWidth = 584
      try {
        const info = await getVideoInfo(args.input)
        if (info?.data?.streams) {
          const videoStream = info.data.streams.find((s: any) => s.codec_type === "video")
          if (videoStream?.width) {
            videoWidth = videoStream.width
            console.log(`[VideoSubtitleTool] 检测到视频分辨率: ${videoStream.width}x${videoStream.height}`)
          }
        }
      } catch {
        // ffprobe 失败不阻塞主流程，使用默认宽度
      }

      if (hasTimedLines) {
        console.log(`[VideoSubtitleTool] 使用多段定时字幕: ${args.timed_lines.length} 条`)
        for (const line of args.timed_lines) {
          const preview = line.text.length > 30 ? line.text.substring(0, 30) + "..." : line.text
          console.log(`  ${line.start_time}s-${line.end_time}s: "${preview}"`)
        }
      } else if (args.text) {
        const textPreview =
          args.text.length > 30 ? args.text.substring(0, 30) + "..." : args.text
        console.log(
          `[VideoSubtitleTool] 使用直接文本: "${textPreview}" (${args.start_time}s-${args.end_time}s)`,
        )
      } else if (args.subtitle_file) {
        console.log(`[VideoSubtitleTool] 使用字幕文件: ${args.subtitle_file}`)
      }

      // timed_lines always uses local FFmpeg (Python bridge doesn't support multi-drawtext)
      const usePython = hasText

      // Prepare text files for drawtext textfile= (avoids Windows CLI UTF-8 corruption)
      const { writeFileSync, unlinkSync } = await import("fs")
      const { tmpdir } = await import("os")
      let textFilePath: string | undefined
      let timedTextFiles: string[] = []
      if (hasText) {
        const hasCJK = /[一-鿿㐀-䶿]/.test(args.text)
        const maxChars = estimateMaxChars(args.font_size || 24, videoWidth, hasCJK)
        const wrappedLines = wrapText(args.text, maxChars)
        const textContent = wrappedLines.join("\n")
        textFilePath = join(tmpdir(), `jianjicode_subtitle_${Date.now()}.txt`)
        writeFileSync(textFilePath, textContent, "utf-8")
        console.log(`[VideoSubtitleTool] Wrote subtitle text file: ${textFilePath} (${wrappedLines.length} lines, maxChars=${maxChars})`)
      } else if (hasTimedLines) {
        for (let i = 0; i < args.timed_lines.length; i++) {
          const line = args.timed_lines[i]
          const hasCJK = /[一-鿿㐀-䶿]/.test(line.text)
          const maxChars = estimateMaxChars(args.font_size || 24, videoWidth, hasCJK)
          const wrappedLines = wrapText(line.text, maxChars)
          const textContent = wrappedLines.join("\n")
          const tf = join(tmpdir(), `jianjicode_timed_sub_${i}_${Date.now()}.txt`)
          writeFileSync(tf, textContent, "utf-8")
          timedTextFiles.push(tf)
        }
      }

      let result: any
      try {
      if (usePython) {
        const style: Record<string, unknown> = {
          font_name: args.font_name,
          font_size: args.font_size,
          font_color: args.font_color,
          border_color: args.border_color,
          border_width: args.border_width,
          background_color: args.background_color,
          position: args.position,
          alignment: args.alignment,
          margin_v: args.margin_v,
          margin_h: args.margin_h,
        }

        result = await pythonAddSubtitle(
          args.input,
          args.text,
          args.start_time,
          args.end_time,
          finalOutputPath,
          style,
          async () => {
            const ffmpegArgs = buildFfmpegArgs(args, finalOutputPath, textFilePath)
            const localResult = await runFfmpeg(ffmpegArgs)
            return {
              success: localResult.success,
              operation: "video_subtitle",
              title: localResult.success ? "字幕添加成功" : "字幕添加失败",
              output: localResult.success
                ? `✅ 已成功添加字幕到视频\n📁 输出文件: ${finalOutputPath}\n${getSubtitleDescription(args)}`
                : `❌ 字幕添加失败: ${localResult.error || "未知错误"}`,
              metadata: {
                outputPath: localResult.success ? finalOutputPath : undefined,
                success: localResult.success,
                error: !localResult.success,
                error_message: localResult.error,
              },
            } as any
          },
        )
      } else {
        const ffmpegArgs = buildFfmpegArgs(args, finalOutputPath, textFilePath, timedTextFiles)
        result = await runFfmpeg(ffmpegArgs)
      }
      } finally {
        if (textFilePath) {
          try { unlinkSync(textFilePath) } catch { /* ignore */ }
        }
        for (const tf of timedTextFiles) {
          try { unlinkSync(tf) } catch { /* ignore */ }
        }
      }

      if (result.success) {
        const metadata: any = {
          operation: "video_subtitle",
          success: true,
          error: false,
          outputPath: result.metadata?.outputPath || finalOutputPath,
          parameters: args,
          encoding: args.encoding,
        }

        if (args.timed_lines) {
          metadata.subtitleType = "timed_lines"
          metadata.lineCount = args.timed_lines.length
          metadata.lines = args.timed_lines
        } else if (args.text) {
          metadata.subtitleType = "text"
          metadata.text = args.text
          metadata.startTime = args.start_time
          metadata.endTime = args.end_time
        } else if (args.subtitle_file) {
          metadata.subtitleType = "file"
          metadata.subtitleFile = args.subtitle_file
        }

        let outputMessage = `✅ 已成功添加字幕到视频\n📁 输出文件: ${result.metadata?.outputPath || finalOutputPath}\n`
        if (args.timed_lines) {
          outputMessage += `📝 多段定时字幕: ${args.timed_lines.length} 条\n`
          outputMessage += `⏱️ 时间范围: ${args.timed_lines[0].start_time}s - ${args.timed_lines[args.timed_lines.length - 1].end_time}s\n`
          for (const line of args.timed_lines) {
            const preview = line.text.length > 25 ? line.text.substring(0, 25) + "..." : line.text
            outputMessage += `   ${line.start_time}s-${line.end_time}s: ${preview}\n`
          }
        } else if (args.text) {
          const textPreview =
            args.text.length > 40
              ? args.text.substring(0, 40) + "..."
              : args.text
          outputMessage += `📝 字幕文本: "${textPreview}"\n`
          outputMessage += `⏱️ 时间范围: ${args.start_time}s - ${args.end_time}s\n`
        } else if (args.subtitle_file) {
          outputMessage += `📝 字幕文件: ${args.subtitle_file}\n`
        }
        outputMessage += `${getSubtitleDescription(args)}`

        return { title: "字幕添加成功", metadata, output: outputMessage }
      } else {
        const errDetail = result.error || result.metadata?.error_message || result.output || "未知错误"
        console.error(`[VideoSubtitleTool] FAILED: ${errDetail}`)
        return {
          title: "字幕添加失败",
          metadata: {
            operation: "video_subtitle",
            error: true,
            success: false,
            error_message: errDetail,
          },
          output: `❌ 字幕添加失败: ${errDetail}`,
        }
      }
    } catch (error: any) {
      return {
        title: "字幕添加错误",
        metadata: { operation: "video_subtitle", error: true, success: false },
        output: `❌ 字幕添加过程中发生错误: ${error.message}`,
      }
    }
  },
})

function buildFfmpegArgs(args: any, outputPath: string, textFilePath?: string, timedTextFiles?: string[]): string[] {
  const ffmpegArgs: string[] = ["-i", args.input]
  const hasSubtitleFile =
    args.subtitle_file && args.subtitle_file.trim().length > 0
  const hasText = args.text && args.text.trim().length > 0
  const hasTimedLines = args.timed_lines && args.timed_lines.length > 0

  if (args.encoding === "soft") {
    if (!hasSubtitleFile) {
      throw new Error("软字幕编码仅支持字幕文件，不支持直接文本")
    }
    ffmpegArgs.push("-i", args.subtitle_file)
    ffmpegArgs.push("-c:v", "copy")
    ffmpegArgs.push("-c:a", "copy")
    ffmpegArgs.push("-c:s", "mov_text")
    ffmpegArgs.push("-map", "0:v")
    ffmpegArgs.push("-map", "0:a")
    ffmpegArgs.push("-map", "1:s")
    ffmpegArgs.push("-metadata:s:s:0", `language=chi`)
  } else {
    let filterComplex: string
    if (hasTimedLines) {
      filterComplex = buildTimedDrawtextFilter(args, timedTextFiles || [])
    } else if (hasText) {
      filterComplex = buildDrawtextFilterWithTextFile(args, textFilePath)
    } else if (hasSubtitleFile) {
      filterComplex = buildHardSubtitleFilter(args)
    } else {
      throw new Error("必须提供字幕文件或直接文本")
    }
    ffmpegArgs.push("-vf", filterComplex)
    ffmpegArgs.push("-c:a", "copy")
  }

  if (hasSubtitleFile && args.offset_seconds !== 0) {
    console.log(
      `[提示] 时间偏移 ${args.offset_seconds} 秒可能需要预处理字幕文件`,
    )
  }

  const quality = args.quality !== undefined ? args.quality : 23
  ffmpegArgs.push("-crf", quality.toString())
  ffmpegArgs.push("-y", outputPath)
  return ffmpegArgs
}

function buildHardSubtitleFilter(args: any): string {
  let subtitleFile = args.subtitle_file

  if (isAbsolute(subtitleFile)) {
    try {
      const relativePath = relative(process.cwd(), subtitleFile)
      if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) {
        subtitleFile = relativePath
      }
    } catch (error: any) {
      console.log(
        `[VideoSubtitleTool] 无法转换路径为相对路径: ${error.message}`,
      )
    }
  }

  subtitleFile = subtitleFile.replace(/\\/g, "/").replace(/'/g, "'\\''")

  const styleParts: string[] = []
  styleParts.push(`FontName=${args.font_name || "Arial"}`)
  styleParts.push(`FontSize=${args.font_size || 24}`)

  const fontColor = hexToAssColor(args.font_color || "FFFFFF", "FF")
  const borderColor = hexToAssColor(args.border_color || "000000", "FF")
  const bgColor = args.background_color || "00000080"
  const backgroundColor = hexToAssColor(
    bgColor.substring(0, 6),
    bgColor.length === 8 ? bgColor.substring(6, 8) : "80",
  )

  styleParts.push(`PrimaryColour=${fontColor}`)
  styleParts.push(`OutlineColour=${borderColor}`)
  styleParts.push(`BackColour=${backgroundColor}`)

  const borderWidth = args.border_width || 1
  styleParts.push(`BorderStyle=${borderWidth > 0 ? 1 : 0}`)
  styleParts.push(`Outline=${borderWidth}`)
  styleParts.push(`Shadow=0`)

  const position = args.position || "bottom"
  const alignmentArg = args.alignment || "center"
  let alignment = 2

  if (position === "bottom") {
    if (alignmentArg === "center") alignment = 2
    else if (alignmentArg === "left") alignment = 1
    else if (alignmentArg === "right") alignment = 3
  } else if (position === "top") {
    if (alignmentArg === "center") alignment = 8
    else if (alignmentArg === "left") alignment = 7
    else if (alignmentArg === "right") alignment = 9
  } else if (position === "middle") {
    if (alignmentArg === "center") alignment = 5
    else if (alignmentArg === "left") alignment = 4
    else if (alignmentArg === "right") alignment = 6
  }

  styleParts.push(`Alignment=${alignment}`)
  styleParts.push(`MarginV=${args.margin_v || 30}`)
  styleParts.push(`MarginH=${args.margin_h || 30}`)

  const styleString = styleParts.join(",")
  let filter = `subtitles='${subtitleFile}'`

  const hasCustomStyle =
    (args.font_name && args.font_name !== "Arial") ||
    (args.font_size && args.font_size !== 24) ||
    (args.font_color && args.font_color !== "FFFFFF") ||
    (args.border_color && args.border_color !== "000000") ||
    (args.background_color && args.background_color !== "00000080") ||
    (args.border_width && args.border_width !== 1) ||
    (args.position && args.position !== "bottom") ||
    (args.alignment && args.alignment !== "center") ||
    (args.margin_v && args.margin_v !== 30) ||
    (args.margin_h && args.margin_h !== 30)

  if (hasCustomStyle) {
    filter += `:force_style='${styleString}'`
  }

  if (args.offset_seconds !== 0 || args.speed_factor !== 1) {
    console.log(`[提示] 时间偏移和速度调整需要字幕预处理，当前版本可能不准确`)
  }

  return filter
}

// ---- CJK font detection ----

function findCJKFont(): string | null {
  if (process.platform === "win32") {
    const candidates = [
      "C:/Windows/Fonts/simhei.ttf",
      "C:/Windows/Fonts/msyh.ttc",
      "C:/Windows/Fonts/simsun.ttc",
      "C:/Windows/Fonts/msgothic.ttc",
    ]
    for (const f of candidates) {
      if (existsSync(f)) return f
    }
  } else if (process.platform === "darwin") {
    const candidates = [
      "/System/Library/Fonts/Hiragino Sans GB.ttc",
      "/System/Library/Fonts/PingFang.ttc",
      "/System/Library/Fonts/STHeiti Light.ttc",
    ]
    for (const f of candidates) {
      if (existsSync(f)) return f
    }
  } else {
    const candidates = [
      "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
    ]
    for (const f of candidates) {
      if (existsSync(f)) return f
    }
  }
  return null
}

// ---- text wrapping ----

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = []
  // Split on existing newlines first (preserve paragraph breaks)
  const paragraphs = text.split(/\n/)
  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("") // preserve blank lines between paragraphs
      continue
    }
    let remaining = para
    while (remaining.length > 0) {
      if (remaining.length <= maxCharsPerLine) {
        lines.push(remaining)
        break
      }
      // Try to break at punctuation
      let cut = maxCharsPerLine
      const punctIdx = remaining.slice(0, maxCharsPerLine).search(/[，。！？、；：》\)】」』"',.!?;:)\]}>-](?!\w)/)
      if (punctIdx > 0 && punctIdx < maxCharsPerLine - 2) {
        cut = punctIdx + 1
      }
      lines.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut)
    }
  }
  return lines
}

function escapeTextForFfmpeg(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
}

/**
 * Estimate max chars per line based on font size and video width.
 * CJK characters are roughly square: width ≈ fontSize (1.0 multiplier).
 * Latin characters average ~0.6 × fontSize.
 */
function estimateMaxChars(fontSize: number, videoWidth?: number, hasCJK?: boolean): number {
  const w = videoWidth || 584
  const charW = fontSize * (hasCJK ? 1.0 : 0.6)
  const margin = fontSize * 2 // proportional margin (~2 chars)
  return Math.max(6, Math.floor((w - margin) / charW))
}

function buildDrawtextFilter(args: any): string {
  return buildDrawtextFilterWithTextFile(args, undefined)
}

/**
 * Build drawtext filter(s). When textFilePath is provided, uses textfile=
 * (avoids Windows command-line UTF-8 corruption). Otherwise uses inline text=.
 */
function buildDrawtextFilterWithTextFile(args: any, textFilePath?: string): string {
  const fontSize = args.font_size || 24
  const fontColor = args.font_color ? `0x${args.font_color}` : "white"
  const box =
    args.background_color && args.background_color !== "transparent" ? 1 : 0
  const boxColor =
    args.background_color && args.background_color !== "transparent"
      ? `0x${args.background_color.substring(0, 6)}@${args.background_color.length === 8 ? parseInt(args.background_color.substring(6, 8), 16) / 255 : 0.6}`
      : "black@0.6"
  const boxBorderWidth = args.border_width || 8

  // Detect CJK font for Chinese text
  const hasCJK = /[一-鿿㐀-䶿]/.test(args.text || "")
  const fontFile = hasCJK ? findCJKFont() : null
  if (hasCJK && !fontFile) {
    console.warn("[video_subtitle] Chinese text detected but no CJK font found — text may not render")
  }

  const text = args.text || ""

  // If textFilePath is provided, use a single drawtext with textfile=
  // (FFmpeg reads the file with proper encoding, avoiding command-line issues)
  if (textFilePath) {
    const parts = [
      `textfile='${textFilePath.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:")}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}`,
      `box=${box}`,
      `boxcolor=${boxColor}`,
      `boxborderw=${boxBorderWidth}`,
      `x=(w-text_w)/2`,
      `y=h-text_h-${args.margin_v || 30}`,
      `enable='between(t\\,${args.start_time}\\,${args.end_time})'`,
    ]

    if (args.position === "top") {
      parts[parts.findIndex((p) => p.startsWith("y="))] = "y=30"
    } else if (args.position === "middle") {
      parts[parts.findIndex((p) => p.startsWith("y="))] = "y=(h-text_h)/2"
    }

    if (args.alignment === "left") {
      parts[parts.findIndex((p) => p.startsWith("x="))] = `x=${args.margin_h || 30}`
    } else if (args.alignment === "right") {
      parts[parts.findIndex((p) => p.startsWith("x="))] = `x=w-text_w-${args.margin_h || 30}`
    }

    if (fontFile) {
      parts.push(`fontfile='${fontFile.replace(/\\/g, "/")}'`)
    }

    return `drawtext=${parts.join(":")}`
  }

  // Fallback: inline text approach (may have encoding issues on Windows)
  const hasCJKText = /[一-鿿㐀-䶿]/.test(text)
  const maxChars = estimateMaxChars(fontSize, undefined, hasCJKText)
  const lines = wrapText(text, maxChars)
  const filters: string[] = []
  const lineHeight = Math.round(fontSize * 1.4)

  for (let i = 0; i < lines.length; i++) {
    const escapedText = escapeTextForFfmpeg(lines[i])

    let y: string
    if (args.position === "top") {
      y = `${30 + i * lineHeight}`
    } else if (args.position === "middle") {
      const totalH = lines.length * lineHeight
      y = `(h-${totalH})/2+${i * lineHeight}`
    } else {
      const baseY = args.margin_v || 30
      y = `h-${baseY + (lines.length - 1 - i) * lineHeight}-text_h`
    }

    let x: string
    if (args.alignment === "left") {
      x = args.margin_h ? `${args.margin_h}` : "30"
    } else if (args.alignment === "right") {
      x = `w-text_w-${args.margin_h || 30}`
    } else {
      x = "(w-text_w)/2"
    }

    const parts = [
      `text='${escapedText}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}`,
      `box=${box}`,
      `boxcolor=${boxColor}`,
      `boxborderw=${boxBorderWidth}`,
      `x=${x}`,
      `y=${y}`,
      `enable='between(t\\,${args.start_time}\\,${args.end_time})'`,
    ]
    if (fontFile) {
      parts.push(`fontfile='${fontFile.replace(/\\/g, "/")}'`)
    }

    filters.push(`drawtext=${parts.join(":")}`)
  }

  return filters.join(",")
}

/**
 * Build a chain of drawtext filters for multiple timed subtitle lines.
 * Each line gets its own textfile, font config, and enable timerange.
 * Single FFmpeg pass — no re-encoding per line.
 */
function buildTimedDrawtextFilter(args: any, textFiles: string[]): string {
  const fontSize = args.font_size || 24
  const fontColor = args.font_color ? `0x${args.font_color}` : "white"
  const box =
    args.background_color && args.background_color !== "transparent" ? 1 : 0
  const boxColor =
    args.background_color && args.background_color !== "transparent"
      ? `0x${args.background_color.substring(0, 6)}@${args.background_color.length === 8 ? parseInt(args.background_color.substring(6, 8), 16) / 255 : 0.6}`
      : "black@0.6"
  const boxBorderWidth = args.border_width || 8
  const marginV = args.margin_v || 30
  const marginH = args.margin_h || 30

  const hasAnyCJK = args.timed_lines.some(
    (l: any) => /[一-鿿㐀-䶿]/.test(l.text || ""),
  )
  const fontFile = hasAnyCJK ? findCJKFont() : null

  const lines = args.timed_lines as Array<{ text: string; start_time: number; end_time: number }>
  const filters: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const tf = textFiles[i]
    if (!tf) continue

    const tfEscaped = tf.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:")

    let yExpr = `h-text_h-${marginV}`
    if (args.position === "top") yExpr = `${marginV}`
    else if (args.position === "middle") yExpr = "(h-text_h)/2"

    let xExpr = "(w-text_w)/2"
    if (args.alignment === "left") xExpr = `${marginH}`
    else if (args.alignment === "right") xExpr = `w-text_w-${marginH}`

    const parts = [
      `textfile='${tfEscaped}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}`,
      `box=${box}`,
      `boxcolor=${boxColor}`,
      `boxborderw=${boxBorderWidth}`,
      `x=${xExpr}`,
      `y=${yExpr}`,
      `enable='between(t\\,${line.start_time}\\,${line.end_time})'`,
    ]

    if (fontFile) {
      parts.push(`fontfile='${fontFile.replace(/\\/g, "/").replace(/:/g, "\\:")}'`)
    }

    filters.push(`drawtext=${parts.join(":")}`)
  }

  return filters.join(",")
}

function hexToAssColor(hexColor: string, alphaHex: string = "FF"): string {
  if (!hexColor || typeof hexColor !== "string" || hexColor.length !== 6) {
    return "&H00FFFFFF"
  }
  const rr = hexColor.substring(0, 2)
  const gg = hexColor.substring(2, 4)
  const bb = hexColor.substring(4, 6)
  return `&H${alphaHex}${bb}${gg}${rr}`
}

function getSubtitleDescription(args: any): string {
  const parts: string[] = []
  parts.push(`编码: ${args.encoding === "hard" ? "硬字幕" : "软字幕"}`)

  if (args.text) {
    const textPreview =
      args.text.length > 20 ? args.text.substring(0, 20) + "..." : args.text
    parts.push(`文本: "${textPreview}"`)
    if (args.start_time !== undefined && args.end_time !== undefined) {
      parts.push(`时间: ${args.start_time}s-${args.end_time}s`)
    }
  } else if (args.subtitle_file) {
    parts.push(
      `文件: ${args.subtitle_file.split("/").pop()?.split("\\").pop()}`,
    )
  }

  if (args.encoding === "hard") {
    parts.push(`字体: ${args.font_name} ${args.font_size}px`)
    parts.push(`颜色: #${args.font_color}`)
    parts.push(
      `位置: ${args.position}${args.alignment !== "center" ? `-${args.alignment}` : ""}`,
    )
  }

  if (args.offset_seconds !== 0) {
    parts.push(
      `时间偏移: ${args.offset_seconds > 0 ? "+" : ""}${args.offset_seconds}秒`,
    )
  }
  if (args.speed_factor !== 1) {
    parts.push(`速度: ${args.speed_factor}x`)
  }
  return `🔤 字幕设置: ${parts.join(", ")}`
}

export const SubtitleTool = VideoSubtitleTool

import { existsSync } from "fs"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg } from "./ffmpeg-utils.js"

/**
 * 音频效果工具 - 应用各种音频效果到视频或音频文件
 *
 * 支持功能:
 * 1. 均衡器 (EQ): 低音、中音、高音调整
 * 2. 压缩器: 动态范围压缩
 * 3. 混响: 房间混响效果
 * 4. 延迟/回声: 回声效果
 * 5. 音高变换: 改变音调
 * 6. 音量调整: 增益/衰减
 * 7. 淡入淡出: 音频渐变
 * 8. 噪声消除: 减少背景噪声
 * 9. 立体声增强: 立体声场扩展
 *
 * 基于FFmpeg的音频滤镜实现
 */
export const AudioEffectsTool: any = Tool.define("audio_effects", {
  description: "应用音频效果到视频或音频文件，支持EQ、压缩、混响、回声等效果",
  parameters: z.object({
    // 输入输出
    input: z.string().describe("输入视频或音频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_audio_effects.<ext>)"),

    // 均衡器参数
    bass: z
      .number()
      .min(-20)
      .max(20)
      .optional()
      .default(0)
      .describe("低音增益/衰减 (dB，-20到20，默认 0)"),
    mid: z
      .number()
      .min(-20)
      .max(20)
      .optional()
      .default(0)
      .describe("中音增益/衰减 (dB，-20到20，默认 0)"),
    treble: z
      .number()
      .min(-20)
      .max(20)
      .optional()
      .default(0)
      .describe("高音增益/衰减 (dB，-20到20，默认 0)"),
    eq_preset: z
      .enum([
        "flat",
        "bass_boost",
        "treble_boost",
        "voice",
        "music",
        "podcast",
        "custom",
      ])
      .optional()
      .default("flat")
      .describe(
        "EQ预设: flat(平坦), bass_boost(低音增强), treble_boost(高音增强), voice(人声), music(音乐), podcast(播客), custom(自定义)",
      ),

    // 压缩器参数
    compression: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("压缩强度 (0-100，0=禁用，默认 0)"),
    compression_threshold: z
      .number()
      .min(-60)
      .max(0)
      .optional()
      .default(-20)
      .describe("压缩阈值 (dB，-60到0，默认 -20)"),
    compression_ratio: z
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(4)
      .describe("压缩比 (1:1 到 20:1，默认 4)"),
    attack: z
      .number()
      .min(0.1)
      .max(100)
      .optional()
      .default(20)
      .describe("启动时间 (毫秒，0.1-100，默认 20)"),
    release: z
      .number()
      .min(10)
      .max(1000)
      .optional()
      .default(100)
      .describe("释放时间 (毫秒，10-1000，默认 100)"),

    // 混响参数
    reverb: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("混响强度 (0-100，0=禁用，默认 0)"),
    reverb_size: z
      .enum(["small", "medium", "large", "hall"])
      .optional()
      .default("medium")
      .describe("混响空间大小: small(小), medium(中), large(大), hall(大厅)"),
    reverb_damping: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("混响阻尼 (0-100，越高高频衰减越快，默认 50)"),
    reverb_wet: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(50)
      .describe("混响湿声比例 (0-100，默认 50)"),

    // 延迟/回声参数
    delay: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("延迟/回声强度 (0-100，0=禁用，默认 0)"),
    delay_time: z
      .number()
      .min(10)
      .max(2000)
      .optional()
      .default(300)
      .describe("延迟时间 (毫秒，10-2000，默认 300)"),
    delay_feedback: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(30)
      .describe("延迟反馈百分比 (0-100，默认 30)"),

    // 音高变换参数
    pitch: z
      .number()
      .min(-12)
      .max(12)
      .optional()
      .default(0)
      .describe("音高变换 (半音，-12到12，0=不变，默认 0)"),
    pitch_preserve_tempo: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "保持原速 (true=改变音高但保持速度，false=同时改变速度，默认 true)",
      ),

    // 音量调整
    volume: z
      .number()
      .min(0)
      .max(300)
      .optional()
      .default(100)
      .describe("音量调整百分比 (0-300，100=原始音量，默认 100)"),
    normalize: z
      .boolean()
      .optional()
      .default(false)
      .describe("音量标准化 (自动调整到最大不失真音量，默认 false)"),

    // 淡入淡出
    fade_in: z
      .number()
      .min(0)
      .max(60)
      .optional()
      .default(0)
      .describe("淡入时长 (秒，0-60，0=禁用，默认 0)"),
    fade_out: z
      .number()
      .min(0)
      .max(60)
      .optional()
      .default(0)
      .describe("淡出时长 (秒，0-60，0=禁用，默认 0)"),

    // 噪声消除
    noise_reduction: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("噪声消除强度 (0-100，0=禁用，默认 0)"),
    noise_profile: z
      .string()
      .optional()
      .describe("自定义噪声特征文件路径 (可选)"),

    // 立体声增强
    stereo_enhance: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("立体声增强强度 (0-100，0=禁用，默认 0)"),
    stereo_width: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .default(100)
      .describe("立体声场宽度百分比 (0-200，100=原始，默认 100)"),

    // 性能选项
    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("视频输出质量 (0-51，越低质量越好，默认 23，仅对视频有效)"),
    audio_bitrate: z
      .string()
      .optional()
      .default("128k")
      .describe("音频比特率 (如 128k, 192k, 256k, 默认 128k)"),
    audio_codec: z
      .enum(["aac", "mp3", "opus", "flac", "copy"])
      .optional()
      .default("aac")
      .describe("音频编码器: aac, mp3, opus, flac, copy(复制不重新编码)"),
    fast: z
      .boolean()
      .optional()
      .default(false)
      .describe("使用快速编码 (质量较低但速度更快)"),

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

  execute: async (args: any, ctx: any) => {
    try {
      // 1. 验证输入文件
      if (!existsSync(args.input)) {
        return {
          title: "音频效果应用失败",
          metadata: { operation: "audio_effects", error: true, success: false },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      // 安全增强：获取安全参数
      const allowOverwrite =
        args.allow_overwrite !== undefined ? args.allow_overwrite : false
      const protectOriginals =
        args.protect_originals !== undefined ? args.protect_originals : true
      const outputDir = args.output_dir

      // 2. 构建输出路径
      const path = await import("path")
      const fs = await import("fs")

      let outputPath = args.output
      if (!outputPath) {
        const inputStem = path.basename(args.input, path.extname(args.input))
        const outputFilename = `${inputStem}_audio_effects.mp4`
        const inputDir = path.dirname(args.input)
        outputPath = path.join(inputDir, outputFilename)
      }

      let finalOutputPath = outputPath

      // 保护原文件检查
      if (protectOriginals) {
        const inputResolved = path.resolve(args.input)
        const outputResolved = path.resolve(outputPath)
        if (outputResolved === inputResolved) {
          // 自动修改输出文件名，添加 _safe 后缀
          const ext = path.extname(args.input)
          const base = path.basename(args.input, ext)
          const dir = path.dirname(args.input)
          finalOutputPath = path.join(dir, `${base}_audio_effects_safe${ext}`)
          console.log(
            `[安全增强] 原文件保护已启用，自动修改输出路径为: ${finalOutputPath}`,
          )
        }
      }

      // 输出目录限制检查
      if (outputDir && outputDir.trim()) {
        const outputDirResolved = path.resolve(outputDir)
        const outputPathResolved = path.resolve(finalOutputPath)
        const relative = path.relative(outputDirResolved, outputPathResolved)
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          return {
            title: "安全验证失败",
            metadata: {
              operation: "audio_effects",
              error: true,
              success: false,
            },
            output: `❌ 输出路径必须在指定目录内: ${outputDirResolved}`,
          }
        }
      }

      // 覆盖确认检查
      if (!allowOverwrite && fs.existsSync(finalOutputPath)) {
        return {
          title: "安全验证失败",
          metadata: { operation: "audio_effects", error: true, success: false },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalOutputPath}`,
        }
      }

      // 3. 检查输出文件是否已存在（仅警告）
      if (fs.existsSync(finalOutputPath)) {
        console.log(`[警告] 输出文件已存在: ${finalOutputPath}`)
      }

      // 4. 构建FFmpeg参数
      const ffmpegArgs = AudioEffectsTool.buildFfmpegArgs(args, finalOutputPath)

      // 5. 执行FFmpeg命令
      console.log(`[AudioEffectsTool] 应用音频效果到: ${args.input}`)
      const enabledEffects = AudioEffectsTool.getEnabledEffects(args)
      if (enabledEffects.length > 0) {
        console.log(
          `[AudioEffectsTool] 启用的效果: ${enabledEffects.join(", ")}`,
        )
      } else {
        console.log(
          `[AudioEffectsTool] 警告: 未启用任何音频效果，仅进行音频转码`,
        )
      }

      const result = await runFfmpeg(ffmpegArgs)

      // 6. 返回结果
      if (result.success) {
        return {
          title: "音频效果应用成功",
          metadata: {
            operation: "audio_effects",
            success: true,
            error: false,
            outputPath: finalOutputPath,
            inputPath: args.input,
            enabledEffects: enabledEffects,
            volume: args.volume,
            pitch: args.pitch,
            compression: args.compression,
            reverb: args.reverb,
            delay: args.delay,
            noiseReduction: args.noise_reduction,
          },
          output: `✅ 已成功应用音频效果\n📁 输出文件: ${finalOutputPath}\n${AudioEffectsTool.getAudioDescription(args, enabledEffects)}`,
        }
      } else {
        return {
          title: "音频效果应用失败",
          metadata: { operation: "audio_effects", error: true, success: false },
          output: `❌ 音频效果应用失败: ${result.error || "未知错误"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "音频效果应用错误",
        metadata: { operation: "audio_effects", error: true, success: false },
        output: `❌ 音频效果应用过程中发生错误: ${error.message}`,
      }
    }
  },
})

// 扩展工具类的方法
AudioEffectsTool.buildFfmpegArgs = (
  args: any,
  outputPath: string,
): string[] => {
  const ffmpegArgs: string[] = ["-i", args.input]

  // 构建音频滤镜字符串
  const filterString = AudioEffectsTool.buildAudioFilter(args)
  if (filterString) {
    ffmpegArgs.push("-af", filterString)
  }

  // 视频编码参数 (如果输入是视频)
  const inputExt = args.input.toLowerCase().split(".").pop()
  const isVideo = ["mp4", "mov", "avi", "mkv", "webm", "flv", "wmv"].includes(
    inputExt || "",
  )

  if (isVideo) {
    // 视频编码参数
    if (args.fast) {
      ffmpegArgs.push("-preset", "fast")
    } else {
      ffmpegArgs.push("-preset", "medium")
    }

    // 视频质量参数
    ffmpegArgs.push("-crf", args.quality.toString())

    // 视频编码器 (保持原视频编码)
    ffmpegArgs.push("-c:v", "copy")
  }

  // 音频编码参数
  if (args.audio_codec !== "copy") {
    ffmpegArgs.push("-c:a", args.audio_codec)
    ffmpegArgs.push("-b:a", args.audio_bitrate)
  } else {
    ffmpegArgs.push("-c:a", "copy")
  }

  // 输出文件
  ffmpegArgs.push("-y", outputPath)

  return ffmpegArgs
}

AudioEffectsTool.buildAudioFilter = (args: any): string => {
  const filters: string[] = []

  // 1. 音量调整
  if (args.volume !== 100) {
    const volumeFactor = args.volume / 100
    filters.push(`volume=${volumeFactor}`)
  }

  // 2. 音量标准化 (如果启用)
  if (args.normalize) {
    // 使用loudnorm滤镜进行标准化
    filters.push(`loudnorm=I=-16:TP=-1.5:LRA=11`)
  }

  // 3. 均衡器 (EQ)
  const eqFilters = AudioEffectsTool.buildEQFilter(args)
  if (eqFilters) {
    filters.push(eqFilters)
  }

  // 4. 压缩器
  if (args.compression > 0) {
    const threshold = args.compression_threshold
    const ratio = args.compression_ratio
    const attackMs = args.attack
    const releaseMs = args.release
    const strength = args.compression / 100

    // 使用acompressor滤镜
    filters.push(
      `acompressor=threshold=${threshold}dB:ratio=${ratio}:attack=${attackMs}:release=${releaseMs}:makeup=${strength}`,
    )
  }

  // 5. 混响效果
  if (args.reverb > 0) {
    const reverbParams = AudioEffectsTool.getReverbParams(args)
    filters.push(reverbParams)
  }

  // 6. 延迟/回声效果
  if (args.delay > 0) {
    const delayTimeMs = args.delay_time
    const feedback = args.delay_feedback / 100
    const mix = args.delay / 100

    // 使用adelay和amix滤镜创建回声
    filters.push(`adelay=${delayTimeMs}|${delayTimeMs}`)
    filters.push(`aecho=0.8:0.9:${delayTimeMs}:0.3`)
  }

  // 7. 音高变换
  if (args.pitch !== 0) {
    if (args.pitch_preserve_tempo) {
      // 使用rubberband滤镜保持速度改变音高
      const semitones = args.pitch
      filters.push(`rubberband=pitch=${semitones}`)
    } else {
      // 使用asetrate改变采样率从而改变音高和速度
      const pitchFactor = 2 ** (args.pitch / 12)
      filters.push(`asetrate=44100*${pitchFactor},aresample=44100`)
    }
  }

  // 8. 淡入淡出
  if (args.fade_in > 0) {
    filters.push(`afade=t=in:ss=0:d=${args.fade_in}`)
  }

  if (args.fade_out > 0) {
    // 需要知道音频时长，这里使用动态表达式
    filters.push(`afade=t=out:st=0:d=${args.fade_out}`)
  }

  // 9. 噪声消除
  if (args.noise_reduction > 0) {
    const strength = args.noise_reduction / 100
    // 使用afftdn滤镜进行噪声消除
    filters.push(`afftdn=nf=${strength}:tn=1`)
  }

  // 10. 立体声增强
  if (args.stereo_enhance > 0 || args.stereo_width !== 100) {
    const enhance = args.stereo_enhance / 100
    const width = args.stereo_width / 100

    // 使用stereotools滤镜
    filters.push(
      `stereotools=mlev=${0.5 + enhance * 0.5}:slev=${0.5 - enhance * 0.5}:balance=0:width=${width}`,
    )
  }

  if (filters.length === 0) {
    return ""
  }

  return filters.join(",")
}

AudioEffectsTool.buildEQFilter = (args: any): string => {
  // 根据EQ预设构建滤波器链
  let bass = args.bass
  let mid = args.mid
  let treble = args.treble

  // 如果使用预设，覆盖自定义值
  switch (args.eq_preset) {
    case "bass_boost":
      bass = 6
      mid = 0
      treble = -2
      break
    case "treble_boost":
      bass = -2
      mid = 0
      treble = 6
      break
    case "voice":
      bass = -3
      mid = 3
      treble = 1
      break
    case "music":
      bass = 4
      mid = 2
      treble = 3
      break
    case "podcast":
      bass = -1
      mid = 3
      treble = 0
      break
    case "flat":
      bass = 0
      mid = 0
      treble = 0
      break
    // 'custom' 使用用户提供的值
  }

  const filters: string[] = []

  // 低音增强 (低频)
  if (bass !== 0) {
    // 使用低架滤波器
    const gain = Math.abs(bass)
    const mode = bass > 0 ? "g" : "a" // g=增益, a=衰减
    filters.push(`bass=g=${gain}:f=100:width_type=h:width=100:mode=${mode}`)
  }

  // 中音增强 (中频)
  if (mid !== 0) {
    // 使用钟形滤波器
    const gain = mid
    filters.push(`equalizer=f=1000:width_type=q:width=2:gain=${gain}`)
  }

  // 高音增强 (高频)
  if (treble !== 0) {
    // 使用高架滤波器
    const gain = Math.abs(treble)
    const mode = treble > 0 ? "g" : "a"
    filters.push(`treble=g=${gain}:f=3000:width_type=h:width=1000:mode=${mode}`)
  }

  if (filters.length === 0) {
    return ""
  }

  return filters.join(",")
}

AudioEffectsTool.getReverbParams = (args: any): string => {
  // 获取混响参数
  const wet = args.reverb_wet / 100
  const dry = 1 - wet
  const damping = args.reverb_damping / 100

  let size = 0.5
  switch (args.reverb_size) {
    case "small":
      size = 0.3
      break
    case "medium":
      size = 0.5
      break
    case "large":
      size = 0.7
      break
    case "hall":
      size = 0.9
      break
  }

  // 使用aecho滤镜模拟混响
  const delay = 50
  const decay = 0.3 + size * 0.5
  const echoes = 10

  return `aecho=${wet}:${dry}:${delay}:${decay}`
}

AudioEffectsTool.getEnabledEffects = (args: any): string[] => {
  const effects: string[] = []

  if (args.volume !== 100 || args.normalize) effects.push("音量")
  if (
    args.bass !== 0 ||
    args.mid !== 0 ||
    args.treble !== 0 ||
    args.eq_preset !== "flat"
  )
    effects.push("均衡器")
  if (args.compression > 0) effects.push("压缩器")
  if (args.reverb > 0) effects.push("混响")
  if (args.delay > 0) effects.push("延迟/回声")
  if (args.pitch !== 0) effects.push("音高变换")
  if (args.fade_in > 0) effects.push("淡入")
  if (args.fade_out > 0) effects.push("淡出")
  if (args.noise_reduction > 0) effects.push("噪声消除")
  if (args.stereo_enhance > 0 || args.stereo_width !== 100)
    effects.push("立体声增强")

  return effects
}

AudioEffectsTool.getAudioDescription = (
  args: any,
  enabledEffects: string[],
): string => {
  const parts: string[] = []

  if (enabledEffects.length > 0) {
    parts.push(`效果: ${enabledEffects.join(", ")}`)
  } else {
    parts.push(`效果: 无`)
  }

  if (args.volume !== 100) {
    parts.push(`音量: ${args.volume}%`)
  }

  if (args.pitch !== 0) {
    parts.push(`音高: ${args.pitch > 0 ? "+" : ""}${args.pitch}半音`)
  }

  if (args.compression > 0) {
    parts.push(`压缩: ${args.compression}%`)
  }

  if (args.reverb > 0) {
    parts.push(`混响: ${args.reverb}%`)
  }

  if (args.delay > 0) {
    parts.push(`延迟: ${args.delay}%`)
  }

  if (args.noise_reduction > 0) {
    parts.push(`降噪: ${args.noise_reduction}%`)
  }

  if (args.audio_codec !== "copy") {
    parts.push(`编码: ${args.audio_codec}@${args.audio_bitrate}`)
  }

  return `🎵 音频设置: ${parts.join(", ")}`
}

/**
 * 工具别名，便于通过不同名称调用
 */
export const AudioTool = AudioEffectsTool

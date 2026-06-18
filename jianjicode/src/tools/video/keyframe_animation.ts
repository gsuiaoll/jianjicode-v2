import { existsSync } from "fs"
import { basename, dirname, extname, join, resolve, relative } from "path"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { runFfmpeg, getVideoInfo } from "../../lib/ffmpeg-utils.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"

/**
 * 关键帧动画工具 — 应用多属性关键帧动画到视频
 *
 * 支持功能:
 * 1. 多关键帧线性/缓动插值
 * 2. 多属性同步动画 (位置 + 缩放 + 旋转 + 透明度)
 * 3. 4 种缓动曲线 (linear / ease-in / ease-out / ease-in-out)
 * 4. 简单动画快捷模式
 */
export const KeyframeAnimationTool: any = Tool.define("keyframe_animation", {
  description:
    "应用关键帧动画到视频，支持位置、缩放、旋转、透明度及多属性组合动画",
  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (默认: <input>_animated.mp4)"),

    // 动画类型
    animation_type: z
      .enum(["position", "scale", "rotation", "opacity", "custom"])
      .optional()
      .default("position")
      .describe(
        "动画类型: position(位置), scale(缩放), rotation(旋转), opacity(透明度), custom(多属性组合)",
      ),

    // 关键帧数据 (JSON 字符串数组)
    keyframes: z
      .string()
      .optional()
      .describe(`关键帧 JSON 数组，支持多属性同步:
[{"time":0, "x":0, "y":0, "scale":1, "rotation":0, "opacity":1},
 {"time":5, "x":100, "y":100, "scale":1.5, "rotation":360, "opacity":0.5}]
x/y: 0-100(百分比), scale: 0.1-10, rotation: 角度, opacity: 0-1`),

    // 简单动画参数 (当 keyframes 为空时使用)
    start_x: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("起始X位置 (%)"),
    start_y: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(0)
      .describe("起始Y位置 (%)"),
    end_x: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("结束X位置 (%)"),
    end_y: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("结束Y位置 (%)"),
    duration: z
      .number()
      .min(0)
      .optional()
      .describe("动画持续秒数 (简单动画用)"),

    start_scale: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(1)
      .describe("起始缩放"),
    end_scale: z
      .number()
      .min(0.1)
      .max(10)
      .optional()
      .default(1.5)
      .describe("结束缩放"),
    start_rotation: z
      .number()
      .min(-360)
      .max(360)
      .optional()
      .default(0)
      .describe("起始旋转(°)"),
    end_rotation: z
      .number()
      .min(-360)
      .max(360)
      .optional()
      .default(360)
      .describe("结束旋转(°)"),
    start_opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(1)
      .describe("起始透明度"),
    end_opacity: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.5)
      .describe("结束透明度"),

    // 动画选项
    easing: z
      .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
      .optional()
      .default("linear")
      .describe("缓动曲线: linear/ease-in/ease-out/ease-in-out"),

    quality: z
      .number()
      .min(0)
      .max(51)
      .optional()
      .default(23)
      .describe("输出质量 (CRF)"),
    fast: z.boolean().optional().default(false).describe("快速编码"),
    allow_overwrite: z.boolean().optional().default(false),
    protect_originals: z.boolean().optional().default(true),
    output_dir: z.string().optional(),
  }),
  usageTemplate: {
    json: {
      input: "{source_video}",
      output: "{output_dir}/animated_{timestamp}.mp4",
      animation_type: "position",
      keyframes:
        '[{"time":0,"x":0,"y":0,"scale":1,"rotation":0,"opacity":1},{"time":3,"x":50,"y":50,"scale":1.2,"rotation":0,"opacity":1}]',
      easing: "linear",
      quality: 23,
      allow_overwrite: false,
      protect_originals: true,
    },
    constraints: [
      "keyframes 和简单动画参数(start_*/end_*) 互斥",
      "keyframes 提供时 animation_type 决定插值属性优先级",
      "keyframes 为 JSON 字符串数组，每个关键帧包含 time/x/y/scale/rotation/opacity",
      "x/y 为百分比 0-100，scale 0.1-10，rotation 角度，opacity 0-1",
      "animation_type=custom 时 keyframes 中所有属性同时插值",
      "简单动画参数适用于两关键帧场景",
      "easing 支持 linear/ease-in/ease-out/ease-in-out",
      "duration 为简单动画持续秒数",
    ],
  },

  execute: async (args: any, ctx: any) => {
    try {
      if (!existsSync(args.input)) {
        return {
          title: "关键帧动画失败",
          metadata: {
            operation: "keyframe_animation",
            error: true,
            success: false,
          },
          output: `❌ 输入文件不存在: ${args.input}`,
        }
      }

      let keyframes: any[] = []
      if (args.keyframes && args.keyframes.trim()) {
        try {
          keyframes = JSON.parse(args.keyframes)
          if (!Array.isArray(keyframes)) throw new Error("非数组")
        } catch (e: any) {
          return {
            title: "关键帧解析失败",
            metadata: { operation: "keyframe_animation", error: true },
            output: `❌ 关键帧 JSON 解析失败: ${e.message}`,
          }
        }
      }

      // Security sandbox validation
      const outputPath =
        args.output ||
        join(dirname(args.input), `${basename(args.input, extname(args.input))}_animated.mp4`)

      const sandbox = validatePath(args.input, outputPath, {
        protectOriginals: args.protect_originals ?? true,
        allowOverwrite: args.allow_overwrite ?? false,
        outputDir: args.output_dir,
      })
      if (!sandbox.ok) {
        return {
          title: sandbox.skipped ? "Skipped (output exists)" : "Security blocked",
          metadata: { operation: "keyframe_animation", error: !sandbox.skipped, skipped: sandbox.skipped },
          output: sandbox.error,
        }
      }
      const finalPath = sandbox.outputPath

            console.log(
        `[KeyframeAnimation] 动画类型: ${args.animation_type}, 关键帧: ${keyframes.length}, 缓动: ${args.easing}`,
      )

      const resolution = await getVideoResolution(args.input)
      const ffmpegArgs = buildFfmpegArgs(args, keyframes, finalPath, resolution)
      const result = await runFfmpeg(ffmpegArgs, ctx.abort)

      if (result.success) {
        return {
          title: "关键帧动画成功",
          metadata: {
            operation: "keyframe_animation",
            success: true,
      undoable: true,
            inputPath: args.input,
            outputPath: finalPath,
            animationType: args.animation_type,
            keyframeCount: keyframes.length || 0,
            easing: args.easing,
          },
          output: `✅ 关键帧动画完成\n📁 ${finalPath}\n${getAnimationDescription(args, keyframes)}`,
        }
      } else {
        return {
          title: "关键帧动画失败",
          metadata: { operation: "keyframe_animation", error: true },
          output: `❌ ${result.error || "FFmpeg 执行失败"}`,
        }
      }
    } catch (error: any) {
      return {
        title: "关键帧动画错误",
        metadata: { operation: "keyframe_animation", error: true },
        output: `❌ ${error.message}`,
      }
    }
  },
})

// ─── 视频分辨率预检 ───────────────────────────────────────

interface VideoResolution {
  width: number
  height: number
}

async function getVideoResolution(inputPath: string): Promise<VideoResolution> {
  try {
    const info = await getVideoInfo(inputPath)
    if (info.success && info.data?.streams) {
      const videoStream = info.data.streams.find(
        (s: any) => s.codec_type === "video",
      )
      if (videoStream && videoStream.width && videoStream.height) {
        console.log(
          `[KeyframeAnimation] 检测到视频分辨率: ${videoStream.width}x${videoStream.height}`,
        )
        return { width: videoStream.width, height: videoStream.height }
      }
    }
  } catch (e: any) {
    console.warn(
      `[KeyframeAnimation] ffprobe 分辨率检测失败: ${e.message}，使用默认值`,
    )
  }
  // 兜底: 常见的 1080p 分辨率，避免崩溃
  console.warn(
    "[KeyframeAnimation] 无法检测视频分辨率，使用默认 1920x1080",
  )
  return { width: 1920, height: 1080 }
}

// ─── FFmpeg 参数构建 ───────────────────────────────────────

function buildFfmpegArgs(
  args: any,
  keyframes: any[],
  outputPath: string,
  resolution: VideoResolution,
): string[] {
  const filters = buildAnimationFilters(args, keyframes, resolution)
  const ffmpegArgs = ["-i", args.input]

  if (filters) {
    ffmpegArgs.push("-vf", filters)
  }

  ffmpegArgs.push("-preset", args.fast ? "fast" : "medium")
  ffmpegArgs.push("-crf", String(args.quality || 23))
  ffmpegArgs.push("-c:a", "copy")
  ffmpegArgs.push("-y", outputPath)
  return ffmpegArgs
}

// ─── 动画滤镜构建入口 ─────────────────────────────────────

function buildAnimationFilters(args: any, keyframes: any[], resolution: VideoResolution): string {
  // 排序关键帧
  if (keyframes.length > 0) {
    keyframes.sort((a: any, b: any) => a.time - b.time)
  }

  if (keyframes.length < 2) {
    return buildSimpleAnimation(args, resolution)
  }

  return buildMultiKeyframeAnimation(args, keyframes, resolution)
}

// ─── 简单动画 (无关键帧或只有一个) ────────────────────────

function buildSimpleAnimation(args: any, resolution: VideoResolution): string {
  const duration = args.duration || 5
  const fps = 30
  const totalFrames = Math.ceil(duration * fps)
  const sizeParam = `${resolution.width}x${resolution.height}`

  switch (args.animation_type) {
    case "position": {
      const dx = ((args.end_x || 100) - (args.start_x || 0)) / 100
      const dy = ((args.end_y || 100) - (args.start_y || 0)) / 100
      const sx = (args.start_x || 0) / 100
      const sy = (args.start_y || 0) / 100
      // d=1: 保留原视频每一帧，不做冻结; min() 在动画结束后保持最终位置
      const normT = `min(on,${totalFrames - 1})/${totalFrames - 1}`
      const eased = buildEaseExpr(args.easing || "linear", normT, true)
      return `zoompan=z='1':x='iw*(${sx}+${dx}*${eased})':y='ih*(${sy}+${dy}*${eased})':d=1:fps=${fps}:s=${sizeParam}`
    }

    case "scale": {
      const ss = args.start_scale || 1
      const es = args.end_scale || 1.5
      const normT = `min(on,${totalFrames - 1})/${totalFrames - 1}`
      const eased = buildEaseExpr(args.easing || "linear", normT, true)
      return `zoompan=z='${ss}+(${es - ss})*${eased}':d=1:fps=${fps}:s=${sizeParam}`
    }

    case "rotation": {
      const sr = ((args.start_rotation || 0) * Math.PI) / 180
      const er = ((args.end_rotation || 360) * Math.PI) / 180
      const normT = `t/${duration}`
      const eased = buildEaseExpr(args.easing || "linear", normT, true)
      return `rotate='${sr}+(${er - sr})*min(${eased},1)'`
    }

    case "opacity": {
      const so = args.start_opacity ?? 1
      const eo = args.end_opacity ?? 0.5
      // 用 Y 通道 (luma) 乘以透明度，实现 fade-to-black，兼容 H.264/yuv420p
      const normT = `min(T,${duration})/${duration}`
      const eased = buildEaseExpr(args.easing || "linear", normT, true)
      const opacityExpr = `${so}+(${eo}-${so})*${eased}`
      return `geq=lum='lum(X,Y)*${opacityExpr}':cb='cb(X,Y)':cr='cr(X,Y)'`
    }

    case "custom": {
      return buildMultiPropertyAnimation(
        args,
        [
          {
            time: 0,
            x: args.start_x || 0,
            y: args.start_y || 0,
            scale: args.start_scale || 1,
            rotation: args.start_rotation || 0,
            opacity: args.start_opacity ?? 1,
          },
          {
            time: duration,
            x: args.end_x || 100,
            y: args.end_y || 100,
            scale: args.end_scale || 1.5,
            rotation: args.end_rotation || 360,
            opacity: args.end_opacity ?? 0.5,
          },
        ],
        duration,
        args.easing,
        resolution,
      )
    }

    default:
      return ""
  }
}

/** 构建缓动表达式 (输入归一化时间 0→1, 输出缓动值 0→1) */
function buildEaseExpr(
  easing: string,
  normT: string,
  ifFree?: boolean,
): string {
  switch (easing) {
    case "ease-in":
      return `(${normT})*(${normT})`
    case "ease-out":
      return `2*(${normT})-(${normT})*(${normT})`
    case "ease-in-out": {
      const partThen = `2*(${normT})*(${normT})`
      const partElse = `1-(2-2*(${normT}))*(2-2*(${normT}))/2`
      if (ifFree) {
        // zoompan 不支持 if() — 算术互斥: lt(x,0.5)*then + gte(x,0.5)*else
        return `lt((${normT}),0.5)*${partThen}+gte((${normT}),0.5)*${partElse}`
      }
      return `if((${normT})<0.5,${partThen},${partElse})`
    }
    default:
      return normT
  }
}

// ─── 多关键帧插值动画 ──────────────────────────────────────

function buildMultiKeyframeAnimation(args: any, keyframes: any[], resolution: VideoResolution): string {
  const duration = keyframes[keyframes.length - 1].time - keyframes[0].time
  const easing = args.easing || "linear"

  // 检测哪些属性有动画
  const hasProp = (prop: string) =>
    keyframes.some((kf: any) => kf[prop] !== undefined)
  const hasPos = hasProp("x") || hasProp("y")
  const hasScale = hasProp("scale")
  const hasRotation = hasProp("rotation")
  const hasOpacity = hasProp("opacity")

  // 确定使用的属性
  const usePos =
    args.animation_type === "position" ||
    args.animation_type === "custom" ||
    hasPos
  const useScale =
    args.animation_type === "scale" ||
    args.animation_type === "custom" ||
    hasScale
  const useRot =
    args.animation_type === "rotation" ||
    args.animation_type === "custom" ||
    hasRotation
  const useOpacity =
    args.animation_type === "opacity" ||
    args.animation_type === "custom" ||
    hasOpacity

  if (useScale || usePos) {
    return buildMultiPropertyAnimation(args, keyframes, duration, easing, resolution)
  }

  // 纯旋转
  if (useRot && !usePos && !useScale) {
    return buildRotationOnlyAnimation(keyframes, duration, easing)
  }

  // 纯透明度
  if (useOpacity && !usePos && !useScale && !useRot) {
    return buildOpacityOnlyAnimation(keyframes, duration, easing)
  }

  return ""
}

/** 构建多属性组合动画 (zoompan + rotate + opacity) */
function buildMultiPropertyAnimation(
  args: any,
  keyframes: any[],
  duration: number,
  easing: string,
  resolution: VideoResolution,
): string {
  const filters: string[] = []
  const first = keyframes[0]
  const last = keyframes[keyframes.length - 1]
  const sizeParam = `${resolution.width}x${resolution.height}`

  // 1. 构建 zoompan 表达式 (位置 + 缩放)
  const hasPosition = keyframes.some(
    (k) => k.x !== undefined || k.y !== undefined,
  )
  const hasScale = keyframes.some((k) => k.scale !== undefined)

  if (hasPosition || hasScale) {
    // zoompan 使用 on (输出帧号), 转为秒: on/fps
    // select='eq(n,0)' 避免多帧输入导致输出帧数 = 输入帧数 × d
    const fps = 30
    const timeInSecs = `on/${fps}`
    const xExpr = buildInterpExpr(keyframes, "x", 50, easing, "iw", timeInSecs)
    const yExpr = buildInterpExpr(keyframes, "y", 50, easing, "ih", timeInSecs)
    const zExpr = buildInterpExpr(
      keyframes,
      "scale",
      1,
      easing,
      null,
      timeInSecs,
    )
    filters.push(
      `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=1:fps=${fps}:s=${sizeParam}`,
    )
  }

  // 2. 旋转 (rotate 使用 t 秒)
  const hasRotation = keyframes.some((k) => k.rotation !== undefined)
  if (hasRotation) {
    const rExpr = buildInterpExpr(keyframes, "rotation", 0, easing, null)
    filters.push(`rotate='${rExpr}*PI/180'`)
  }

  // 3. 透明度
  const hasOpacity = keyframes.some((k) => k.opacity !== undefined)
  if (hasOpacity) {
    // geq 使用 T (大写) 表示时间
    const oExpr = buildInterpExpr(keyframes, "opacity", 1, easing, null, "T")
    filters.push(`geq=lum='lum(X,Y)*${oExpr}':cb='cb(X,Y)':cr='cr(X,Y)'`)
  }

  if (filters.length === 0) {
    // 兜底: 至少应用位置动画
    const totalFrames = Math.ceil((last.time || 5) * 30)
    filters.push(
      `select='eq(n,0)',zoompan=z='1':x='iw/2':y='ih/2':d=${totalFrames}:fps=30:s=${sizeParam}`,
    )
  }

  return filters.join(",")
}

/** 纯旋转动画 */
function buildRotationOnlyAnimation(
  keyframes: any[],
  duration: number,
  easing: string,
): string {
  const rExpr = buildInterpExpr(keyframes, "rotation", 0, easing, null)
  return `rotate='${rExpr}*PI/180'`
}

/** 纯透明度动画 */
function buildOpacityOnlyAnimation(
  keyframes: any[],
  duration: number,
  easing: string,
): string {
  const oExpr = buildInterpExpr(keyframes, "opacity", 1, easing, null, "T")
  return `geq=lum='lum(X,Y)*${oExpr}':cb='cb(X,Y)':cr='cr(X,Y)'`
}

// ─── 关键帧插值表达式生成 ────────────────────────────────

/**
 * 构建关键帧插值 FFmpeg 表达式 (算术多路复用, 兼容所有滤镜)
 *
 * 模式: lt(t,t0)*v0 + gte(t,t0)*lt(t,t1)*interp0 + ... + gte(t,tn)*vn
 * 不依赖 if() 或 between(), 适用于 zoompan/rotate/geq 等所有 FFmpeg 滤镜
 *
 * 缓动函数 (ifFree):
 *   linear:       x
 *   ease-in:      x*x
 *   ease-out:     2x-x*x
 *   ease-in-out:  partElse + lt(x,0.5)*(partThen-partElse)
 */
function buildInterpExpr(
  keyframes: any[],
  prop: string,
  defaultVal: number,
  easing: string,
  scale: string | null,
  timeExpr: string = "t",
): string {
  const hasProp = keyframes.some((k: any) => k[prop] !== undefined)
  if (!hasProp) {
    return scale ? `iw*${defaultVal / 100}` : String(defaultVal)
  }

  const extended = keyframes.map((kf: any) => ({ ...kf }))
  for (let i = 0; i < extended.length; i++) {
    if (extended[i][prop] === undefined) {
      extended[i][prop] = interpolateMissing(extended, i, prop, defaultVal)
    }
  }

  const isPosProp = scale !== null

  const formatVal = (v: number): string => {
    if (isPosProp) {
      const clamped = Math.min(Math.max(v, 0), 100)
      const mult = scale === "iw" ? "iw" : "ih"
      return `${mult}*${clamped}/100`
    }
    return String(v)
  }

  // 算术多路复用: 无逗号, 无 if, 适用于所有滤镜 (zoompan/rotate/geq)
  const firstVal = extended[0][prop]
  let expr = `lt(${timeExpr},${extended[0].time})*${formatVal(firstVal)}`

  for (let i = 0; i < extended.length - 1; i++) {
    const k0 = extended[i]
    const k1 = extended[i + 1]
    const v0 = k0[prop]
    const v1 = k1[prop]
    const t0 = k0.time
    const t1 = k1.time
    const dt = t1 - t0

    if (dt <= 0) continue

    const tNorm = `(${timeExpr}-${t0})/${dt}`
    const easedT = buildEaseExpr(easing, tNorm, true)
    const interp = `${v0}+(${v1 - v0})*(${easedT})`

    let finalVal: string
    if (isPosProp) {
      const clamped = `min(max(${interp},0),100)`
      const mult = scale === "iw" ? "iw" : "ih"
      finalVal = `${mult}*${clamped}/100`
    } else {
      finalVal = interp
    }

    expr += `+gte(${timeExpr},${t0})*lt(${timeExpr},${t1})*(${finalVal})`
  }

  const lastVal = extended[extended.length - 1][prop]
  expr += `+gte(${timeExpr},${extended[extended.length - 1].time})*${formatVal(lastVal)}`

  return expr
}

/** 插值缺失的属性值 */
function interpolateMissing(
  keyframes: any[],
  idx: number,
  prop: string,
  defaultVal: number,
): number {
  // 找前面的非缺失值
  let prevVal = defaultVal
  let prevIdx = -1
  for (let i = idx - 1; i >= 0; i--) {
    if (keyframes[i][prop] !== undefined) {
      prevVal = keyframes[i][prop]
      prevIdx = i
      break
    }
  }

  // 找后面的非缺失值
  let nextVal = defaultVal
  let nextIdx = -1
  for (let i = idx + 1; i < keyframes.length; i++) {
    if (keyframes[i][prop] !== undefined) {
      nextVal = keyframes[i][prop]
      nextIdx = i
      break
    }
  }

  if (prevIdx === -1 && nextIdx === -1) return defaultVal
  if (prevIdx === -1) return nextVal
  if (nextIdx === -1) return prevVal

  // 线性插值
  const t = (idx - prevIdx) / (nextIdx - prevIdx)
  return prevVal + (nextVal - prevVal) * t
}

// ─── 描述生成 ────────────────────────────────────────────

function getAnimationDescription(args: any, keyframes: any[]): string {
  const typeNames: Record<string, string> = {
    position: "位置",
    scale: "缩放",
    rotation: "旋转",
    opacity: "透明度",
    custom: "多属性组合",
  }
  const easingNames: Record<string, string> = {
    linear: "线性",
    "ease-in": "缓入",
    "ease-out": "缓出",
    "ease-in-out": "缓入缓出",
  }

  const parts = [
    `类型: ${typeNames[args.animation_type] || args.animation_type}`,
  ]

  if (keyframes.length > 0) {
    parts.push(`关键帧: ${keyframes.length}个`)
    const dur = keyframes[keyframes.length - 1].time - keyframes[0].time
    parts.push(`时长: ${dur.toFixed(1)}秒`)
    const props = Object.keys(keyframes[0])
      .filter((k) => k !== "time")
      .join(",")
    if (props) parts.push(`属性: ${props}`)
  } else {
    if (args.duration) parts.push(`时长: ${args.duration}秒`)
  }

  if (args.easing && args.easing !== "linear") {
    parts.push(`缓动: ${easingNames[args.easing]}`)
  }

  return `🎬 ${parts.join(", ")}`
}

// ─── 别名导出 ───────────────────────────────────────────

KeyframeAnimationTool.buildFfmpegArgs = buildFfmpegArgs
KeyframeAnimationTool.buildAnimationFilter = buildAnimationFilters
KeyframeAnimationTool.getAnimationDescription = getAnimationDescription

export const AnimationTool = KeyframeAnimationTool

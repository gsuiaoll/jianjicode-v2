import { existsSync } from "fs"
import z from "zod"
import { Tool } from "../tool.js"
import { runFfmpeg, getVideoInfo } from "./ffmpeg-utils.js"

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
  description: "应用关键帧动画到视频，支持位置、缩放、旋转、透明度及多属性组合动画",
  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    output: z.string().optional().describe("输出文件路径 (默认: <input>_animated.mp4)"),

    // 动画类型
    animation_type: z
      .enum(["position", "scale", "rotation", "opacity", "custom"])
      .optional()
      .default("position")
      .describe("动画类型: position(位置), scale(缩放), rotation(旋转), opacity(透明度), custom(多属性组合)"),

    // 关键帧数据 (JSON 字符串数组)
    keyframes: z
      .string()
      .optional()
      .describe(`关键帧 JSON 数组，支持多属性同步:
[{"time":0, "x":0, "y":0, "scale":1, "rotation":0, "opacity":1},
 {"time":5, "x":100, "y":100, "scale":1.5, "rotation":360, "opacity":0.5}]
x/y: 0-100(百分比), scale: 0.1-10, rotation: 角度, opacity: 0-1`),

    // 简单动画参数 (当 keyframes 为空时使用)
    start_x: z.number().min(0).max(100).optional().default(0).describe("起始X位置 (%)"),
    start_y: z.number().min(0).max(100).optional().default(0).describe("起始Y位置 (%)"),
    end_x: z.number().min(0).max(100).optional().default(100).describe("结束X位置 (%)"),
    end_y: z.number().min(0).max(100).optional().default(100).describe("结束Y位置 (%)"),
    duration: z.number().min(0).optional().describe("动画持续秒数 (简单动画用)"),

    start_scale: z.number().min(0.1).max(10).optional().default(1).describe("起始缩放"),
    end_scale: z.number().min(0.1).max(10).optional().default(1.5).describe("结束缩放"),
    start_rotation: z.number().min(-360).max(360).optional().default(0).describe("起始旋转(°)"),
    end_rotation: z.number().min(-360).max(360).optional().default(360).describe("结束旋转(°)"),
    start_opacity: z.number().min(0).max(1).optional().default(1).describe("起始透明度"),
    end_opacity: z.number().min(0).max(1).optional().default(0.5).describe("结束透明度"),

    // 动画选项
    easing: z
      .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
      .optional()
      .default("linear")
      .describe("缓动曲线: linear/ease-in/ease-out/ease-in-out"),

    quality: z.number().min(0).max(51).optional().default(23).describe("输出质量 (CRF)"),
    fast: z.boolean().optional().default(false).describe("快速编码"),
    allow_overwrite: z.boolean().optional().default(false),
    protect_originals: z.boolean().optional().default(true),
    output_dir: z.string().optional(),
  }),

  execute: async (args: any, ctx: any) => {
    try {
      if (!existsSync(args.input)) {
        return {
          title: "关键帧动画失败",
          metadata: { operation: "keyframe_animation", error: true, success: false },
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

      // 安全检查
      const { join: joinPath, dirname, basename, extname, resolve, relative } = await import("path")
      const fs = await import("fs")

      let outputPath = args.output || joinPath(dirname(args.input),
        `${basename(args.input, extname(args.input))}_animated.mp4`)
      let finalPath = outputPath

      if (args.protect_originals) {
        const inR = resolve(args.input), outR = resolve(outputPath)
        if (outR === inR) {
          const dir = dirname(args.input)
          const base = basename(args.input, extname(args.input))
          finalPath = joinPath(dir, `${base}_animated_safe${extname(args.input)}`)
        }
      }

      if (args.output_dir) {
        const outDir = resolve(args.output_dir)
        const outPath = resolve(finalPath)
        if (relative(outDir, outPath).startsWith("..")) {
          return {
            title: "安全验证失败",
            metadata: { operation: "keyframe_animation", error: true },
            output: `❌ 输出路径必须在指定目录内: ${outDir}`,
          }
        }
      }

      if (!args.allow_overwrite && fs.existsSync(finalPath)) {
        return {
          title: "安全验证失败",
          metadata: { operation: "keyframe_animation", error: true },
          output: `❌ 输出文件已存在且未允许覆盖: ${finalPath}`,
        }
      }

      console.log(`[KeyframeAnimation] 动画类型: ${args.animation_type}, 关键帧: ${keyframes.length}, 缓动: ${args.easing}`)

      const resolution = await getVideoResolution(args.input)
      const ffmpegArgs = buildFfmpegArgs(args, keyframes, finalPath, resolution)
      const result = await runFfmpeg(ffmpegArgs)

      if (result.success) {
        return {
          title: "关键帧动画成功",
          metadata: {
            operation: "keyframe_animation", success: true,
            outputPath: finalPath, animationType: args.animation_type,
            keyframeCount: keyframes.length || 0, easing: args.easing,
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
  console.warn(
    "[KeyframeAnimation] 无法检测视频分辨率，使用默认 1920x1080",
  )
  return { width: 1920, height: 1080 }
}

// ─── FFmpeg 参数构建 ───────────────────────────────────────

function buildFfmpegArgs(args: any, keyframes: any[], outputPath: string, resolution: VideoResolution): string[] {
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
  const easing = args.easing || "linear"
  const sizeParam = `${resolution.width}x${resolution.height}`
  const easeFn = easing === "linear" ? "t" : getEaseFFmpeg(easing, "t/${dur}")
    .replace(/\$\{dur\}/g, String(duration))

  switch (args.animation_type) {
    case "position": {
      const dx = ((args.end_x || 100) - (args.start_x || 0)) / 100
      const dy = ((args.end_y || 100) - (args.start_y || 0)) / 100
      const sx = (args.start_x || 0) / 100
      const sy = (args.start_y || 0) / 100
      const totalFrames = Math.ceil(duration * 30)
      const easeT = easeFn.replace(/\$t/g, "t")
      return `zoompan=z='1':x='iw*(${sx}+${dx}*${easeT}/${duration})':y='ih*(${sy}+${dy}*${easeT}/${duration})':d=${totalFrames}:fps=30:s=${sizeParam}`
    }

    case "scale": {
      const ss = args.start_scale || 1
      const es = args.end_scale || 1.5
      const frames = Math.ceil(duration * 30)
      const easeT = easeFn.replace(/\$t/g, "t")
      return `zoompan=z='${ss}+(${es - ss})*${easeT}/${duration}':d=${frames}:fps=30:s=${sizeParam}`
    }

    case "rotation": {
      const sr = ((args.start_rotation || 0) * Math.PI) / 180
      const er = ((args.end_rotation || 360) * Math.PI) / 180
      const easeT = easeFn.replace(/\$t/g, "t")
      return `rotate=${sr}+(${er - sr})*${easeT}/${duration}:ow=hypot(iw,ih):oh=ow`
    }

    case "opacity": {
      const so = args.start_opacity ?? 1
      const eo = args.end_opacity ?? 0.5
      const easeT = easeFn.replace(/\$t/g, "t")
      return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='(${so}+(${eo}-${so})*min(${easeT}/${duration},1))*255'`
    }

    case "custom": {
      // 简单自定义 — 合并所有属性，生成起止两个关键帧
      return buildMultiPropertyAnimation(
        args,
        [
          { time: 0, x: args.start_x || 0, y: args.start_y || 0, scale: args.start_scale || 1, rotation: args.start_rotation || 0, opacity: args.start_opacity ?? 1 },
          { time: duration, x: args.end_x || 100, y: args.end_y || 100, scale: args.end_scale || 1.5, rotation: args.end_rotation || 360, opacity: args.end_opacity ?? 0.5 },
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

// ─── 多关键帧插值动画 ──────────────────────────────────────

function buildMultiKeyframeAnimation(args: any, keyframes: any[], resolution: VideoResolution): string {
  const duration = keyframes[keyframes.length - 1].time - keyframes[0].time
  const easing = args.easing || "linear"

  // 检测哪些属性有动画
  const hasProp = (prop: string) => keyframes.some((kf: any) => kf[prop] !== undefined)
  const hasPos = hasProp("x") || hasProp("y")
  const hasScale = hasProp("scale")
  const hasRotation = hasProp("rotation")
  const hasOpacity = hasProp("opacity")

  // 确定使用的属性
  const usePos = args.animation_type === "position" || args.animation_type === "custom" || hasPos
  const useScale = args.animation_type === "scale" || args.animation_type === "custom" || hasScale
  const useRot = args.animation_type === "rotation" || args.animation_type === "custom" || hasRotation
  const useOpacity = args.animation_type === "opacity" || args.animation_type === "custom" || hasOpacity

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
  const hasPosition = keyframes.some(k => k.x !== undefined || k.y !== undefined)
  const hasScale = keyframes.some(k => k.scale !== undefined)

  if (hasPosition || hasScale) {
    const xExpr = buildInterpExpr(keyframes, "x", 50, easing, "iw")
    const yExpr = buildInterpExpr(keyframes, "y", 50, easing, "ih")
    const zExpr = buildInterpExpr(keyframes, "scale", 1, easing, null)
    const totalFrames = Math.ceil((last.time || duration || 5) * 30)
    const fps = 30

    filters.push(
      `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:fps=${fps}:s=${sizeParam}`,
    )
  }

  // 2. 旋转
  const hasRotation = keyframes.some(k => k.rotation !== undefined)
  if (hasRotation) {
    const rExpr = buildInterpExpr(keyframes, "rotation", 0, easing, null)
    filters.push(
      `rotate='${rExpr}*PI/180':ow=hypot(iw,ih):oh=ow`,
    )
  }

  // 3. 透明度
  const hasOpacity = keyframes.some(k => k.opacity !== undefined)
  if (hasOpacity) {
    const oExpr = buildInterpExpr(keyframes, "opacity", 1, easing, null)
    filters.push(
      `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${oExpr}*255'`,
    )
  }

  if (filters.length === 0) {
    // 兜底: 至少应用位置动画
    const totalFrames = Math.ceil((last.time || 5) * 30)
    filters.push(`zoompan=z='1':x='iw/2':y='ih/2':d=${totalFrames}:fps=30:s=${sizeParam}`)
  }

  return filters.join(",")
}

/** 纯旋转动画 */
function buildRotationOnlyAnimation(keyframes: any[], duration: number, easing: string): string {
  const rExpr = buildInterpExpr(keyframes, "rotation", 0, easing, null)
  return `rotate='${rExpr}*PI/180':ow=hypot(iw,ih):oh=ow`
}

/** 纯透明度动画 */
function buildOpacityOnlyAnimation(keyframes: any[], duration: number, easing: string): string {
  const oExpr = buildInterpExpr(keyframes, "opacity", 1, easing, null)
  return `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${oExpr}*255'`
}

// ─── 关键帧插值表达式生成 ────────────────────────────────

/**
 * 构建关键帧插值 FFmpeg 表达式
 *
 * 输出如: if(between(t,0,2), 0+(100-0)*ease((t-0)/2), if(between(t,2,5), 100+(200-100)*ease((t-2)/3), 200))
 *
 * 其中 ease() 根据缓动类型替换为:
 *   linear:    x
 *   ease-in:   x*x
 *   ease-out:  1-(1-x)*(1-x)
 *   ease-in-out: x<0.5 ? 2*x*x : 1-(2-2*x)^2/2
 */
function buildInterpExpr(
  keyframes: any[],
  prop: string,
  defaultVal: number,
  easing: string,
  scale: string | null, // "iw" | "ih" | null
): string {
  // 检查属性是否存在
  const hasProp = keyframes.some((k: any) => k[prop] !== undefined)
  if (!hasProp) {
    return scale ? `iw*${defaultVal / 100}` : String(defaultVal)
  }

  // 深拷贝，避免修改原对象
  const extended = keyframes.map((kf: any) => ({ ...kf }))
  for (let i = 0; i < extended.length; i++) {
    if (extended[i][prop] === undefined) {
      // 线性插值找值
      extended[i][prop] = interpolateMissing(extended, i, prop, defaultVal)
    }
  }

  // 如果是位置属性 (x/y)，值在 0-100 范围表示百分比，需要缩放到像素
  const isPosProp = scale !== null

  // 构建嵌套 if 表达式
  let expr = ""
  for (let i = 0; i < extended.length - 1; i++) {
    const k0 = extended[i]
    const k1 = extended[i + 1]
    const v0 = k0[prop]
    const v1 = k1[prop]
    const t0 = k0.time
    const t1 = k1.time
    const dt = t1 - t0

    if (dt <= 0) continue

    // 归一化时间: (t - t0) / dt
    const tNorm = `(t-${t0})/${dt}`

    // 缓动函数应用到归一化时间
    const easedT = getEaseFFmpeg(easing, tNorm)

    // 插值: v0 + (v1-v0) * easedT
    const vDiff = v1 - v0
    const interp = `${v0}+(${vDiff})*${easedT}`

    // 如果是位置属性，包裹 min(max()) 确保在范围内，并乘以缩放因子
    let finalVal: string
    if (isPosProp) {
      // x/y 在 0-100 范围，需要 clamp 然后乘以 iw/100
      const clamped = `min(max(${interp},0),100)`
      const mult = scale === "iw" ? "iw" : "ih"
      finalVal = `${mult}*${clamped}/100`
    } else {
      finalVal = interp
    }

    // 添加条件: between(t, t0, t1)
    if (i === 0) {
      expr = `if(between(t,${t0},${t1}),${finalVal}`
    } else {
      expr = `${expr},if(between(t,${t0},${t1}),${finalVal}`
    }
  }

  // 最后一个关键帧的值 (兜底)
  const lastVal = extended[extended.length - 1][prop]
  const lastFinal = isPosProp ? `${scale}*${Math.min(Math.max(lastVal, 0), 100)}/100` : String(lastVal)

  // 闭合所有 if
  expr = `${expr},${lastFinal}${")".repeat(extended.length - 1)}`

  return expr
}

/** 插值缺失的属性值 */
function interpolateMissing(keyframes: any[], idx: number, prop: string, defaultVal: number): number {
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

/** 获取缓动曲线的 FFmpeg 表达式 */
function getEaseFFmpeg(easing: string, tExpr: string): string {
  switch (easing) {
    case "ease-in":
      // ease-in: t^2
      return `(${tExpr})*(${tExpr})`
    case "ease-out":
      // ease-out: 1-(1-t)^2 = 2t-t^2
      return `2*${tExpr}-(${tExpr})*(${tExpr})`
    case "ease-in-out": {
      // ease-in-out: if(t<0.5, 2*t^2, 1-(-2*t+2)^2/2)
      return `if((${tExpr})<0.5,2*(${tExpr})*(${tExpr}),1-(2-2*(${tExpr}))*(2-2*(${tExpr}))/2)`
    }
    default:
      return tExpr
  }
}

// ─── 描述生成 ────────────────────────────────────────────

function getAnimationDescription(args: any, keyframes: any[]): string {
  const typeNames: Record<string, string> = {
    position: "位置", scale: "缩放", rotation: "旋转", opacity: "透明度", custom: "多属性组合",
  }
  const easingNames: Record<string, string> = {
    linear: "线性", "ease-in": "缓入", "ease-out": "缓出", "ease-in-out": "缓入缓出",
  }

  const parts = [`类型: ${typeNames[args.animation_type] || args.animation_type}`]

  if (keyframes.length > 0) {
    parts.push(`关键帧: ${keyframes.length}个`)
    const dur = keyframes[keyframes.length - 1].time - keyframes[0].time
    parts.push(`时长: ${dur.toFixed(1)}秒`)
    const props = Object.keys(keyframes[0]).filter(k => k !== "time").join(",")
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

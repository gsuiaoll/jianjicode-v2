/**
 * LTX 工具适配器
 * 直接复用 LTX Desktop 的类型定义和滤镜生成逻辑
 */

import type {
  ClipEffect,
  ColorCorrection,
  EffectMask,
  EffectType,
  TextOverlayStyle,
} from "../types/ltx-types.js"
import {
  DEFAULT_COLOR_CORRECTION,
  DEFAULT_TEXT_STYLE,
} from "../types/ltx-types.js"

/**
 * LTX 颜色校正适配器
 * 将 LTX 的 ColorCorrection 参数转换为 FFmpeg 滤镜字符串
 */
export class LtxColorCorrectionAdapter {
  /**
   * 将 LTX 颜色校正参数转换为 FFmpeg 滤镜字符串
   * 基于 LTX 的 video-editor-utils.ts 中的 getClipEffectStyles 逻辑，
   * 但转换为 FFmpeg 滤镜而非 CSS 滤镜
   */
  static toFfmpegFilters(correction: ColorCorrection): string[] {
    const filters: string[] = []
    const cc = correction

    // 亮度调整 (brightness)
    // LTX: -100 到 +100，FFmpeg eq 滤镜的 brightness 参数范围是 -1.0 到 1.0
    if (cc.brightness !== 0) {
      const brightnessValue = cc.brightness / 100 // 映射到 -1.0 到 1.0
      filters.push(`eq=brightness=${brightnessValue.toFixed(2)}`)
    }

    // 对比度调整 (contrast)
    // LTX: -100 到 +100，FFmpeg eq 滤镜的 contrast 参数范围是 -2.0 到 2.0
    if (cc.contrast !== 0) {
      const contrastValue = 1.0 + cc.contrast / 100 // 映射到 0.0 到 2.0
      filters.push(`eq=contrast=${contrastValue.toFixed(2)}`)
    }

    // 饱和度调整 (saturation)
    // LTX: -100 到 +100，FFmpeg eq 滤镜的 saturation 参数范围是 0.0 到 3.0
    if (cc.saturation !== 0) {
      const saturationValue = 1.0 + cc.saturation / 100 // 映射到 0.0 到 2.0
      filters.push(`eq=saturation=${saturationValue.toFixed(2)}`)
    }

    // 色温调整 (temperature)
    // LTX: -100 (冷/蓝) 到 +100 (暖/橙)
    // 使用 colorbalance 滤镜调整红色和蓝色通道
    if (cc.temperature !== 0) {
      const tempValue = cc.temperature / 100 // -1.0 到 1.0
      // 冷色温: 增加蓝色，减少红色；暖色温: 增加红色，减少蓝色
      const rs = -tempValue * 0.2 // 红色调整
      const bs = tempValue * 0.2 // 蓝色调整
      filters.push(`colorbalance=rs=${rs.toFixed(2)}:gs=0:bs=${bs.toFixed(2)}`)
    }

    // 色调调整 (tint)
    // LTX: -100 (绿) 到 +100 (品红)
    if (cc.tint !== 0) {
      const tintValue = cc.tint / 100 // -1.0 到 1.0
      // 绿色调整绿色通道，品红调整红色和蓝色通道
      const gs = -tintValue * 0.2 // 绿色调整
      const rs = tintValue * 0.1 // 红色调整
      const bs = tintValue * 0.1 // 蓝色调整
      filters.push(
        `colorbalance=rs=${rs.toFixed(2)}:gs=${gs.toFixed(2)}:bs=${bs.toFixed(2)}`,
      )
    }

    // 曝光调整 (exposure)
    // LTX: -100 到 +100，使用伽马调整模拟曝光
    if (cc.exposure !== 0) {
      const exposureValue = (cc.exposure / 100) * 3 // 映射到 -3 到 3 的伽马指数范围
      const gammaValue = Math.exp(exposureValue)
      filters.push(
        `eq=gamma_r=${gammaValue.toFixed(2)}:gamma_g=${gammaValue.toFixed(2)}:gamma_b=${gammaValue.toFixed(2)}`,
      )
    }

    // 高光调整 (highlights)
    // LTX: -100 到 +100，使用 colorlevels 调整高光
    if (cc.highlights !== 0) {
      const highlightValue = cc.highlights / 100 // -1.0 到 1.0
      const romax = 1.0 - highlightValue * 0.3
      const gomax = 1.0 - highlightValue * 0.3
      const bomax = 1.0 - highlightValue * 0.3
      filters.push(
        `colorlevels=romax=${romax.toFixed(2)}:gomax=${gomax.toFixed(2)}:bomax=${bomax.toFixed(2)}`,
      )
    }

    // 阴影调整 (shadows)
    // LTX: -100 到 +100，使用 colorlevels 调整阴影
    if (cc.shadows !== 0) {
      const shadowValue = cc.shadows / 100 // -1.0 到 1.0
      const rmin = shadowValue * 0.3
      const gmin = shadowValue * 0.3
      const bmin = shadowValue * 0.3
      filters.push(
        `colorlevels=rmin=${rmin.toFixed(2)}:gmin=${gmin.toFixed(2)}:bmin=${bmin.toFixed(2)}`,
      )
    }

    return filters
  }

  /**
   * 生成完整的颜色校正滤镜字符串
   */
  static getFilterString(correction: ColorCorrection): string {
    const filters = LtxColorCorrectionAdapter.toFfmpegFilters(correction)
    if (filters.length === 0) {
      return ""
    }
    return filters.join(",")
  }
}

/**
 * LTX 字幕适配器
 * 将 LTX 的 TextOverlayStyle 转换为 FFmpeg drawtext 滤镜
 * 基于 LTX 的 video-filter.ts 中的字幕生成逻辑
 */
export class LtxSubtitleAdapter {
  /**
   * 将文本样式转换为 FFmpeg drawtext 滤镜字符串
   * @param text 文本内容
   * @param style 文本样式
   * @param startTime 开始时间（秒）
   * @param endTime 结束时间（秒）
   * @param width 视频宽度（用于计算字体大小）
   * @param height 视频高度（用于计算字体大小）
   */
  static toDrawtextFilter(
    text: string,
    style: TextOverlayStyle,
    startTime: number,
    endTime: number,
    width: number = 1920,
    height: number = 1080,
  ): string {
    // 转义文本中的特殊字符
    const escapedText = text
      .replace(/\\/g, "\\\\\\\\")
      .replace(/'/g, "'\\\\\\''")
      .replace(/:/g, "\\:")
      .replace(/%/g, "%%")
      .replace(/\n/g, "\\n")

    // 计算缩放后的字体大小（基于 1080p 参考分辨率）
    const fontSize = Math.round(style.fontSize * (height / 1080))

    // 字体颜色（FFmpeg 格式：0xRRGGBB）
    const fontColor = style.color.replace("#", "0x")

    // 位置计算
    let xExpr: string
    let yExpr: string

    // 水平位置（positionX 是百分比）
    if (style.textAlign === "left") {
      xExpr = `(w*${style.positionX / 100})`
    } else if (style.textAlign === "right") {
      xExpr = `(w*${style.positionX / 100}-text_w)`
    } else {
      // center 或默认
      xExpr = `(w*${style.positionX / 100}-text_w/2)`
    }

    // 垂直位置（positionY 是百分比）
    yExpr = `(h*${style.positionY / 100}-text_h/2)`

    // 构建基础滤镜
    let filter = `drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}:x=${xExpr}:y=${yExpr}`

    // 字体设置
    if (style.fontFamily) {
      filter += `:fontfile='${style.fontFamily.replace(/'/g, "\\'")}'`
    }

    // 字体粗细和样式（简化处理）
    if (style.fontWeight !== "normal") {
      // FFmpeg 支持 bold 参数
      if (style.fontWeight === "bold" || parseInt(style.fontWeight) >= 600) {
        filter += ":bold=1"
      }
    }

    if (style.fontStyle === "italic") {
      filter += ":italic=1"
    }

    // 背景框
    if (style.backgroundColor && style.backgroundColor !== "transparent") {
      const bgHex = style.backgroundColor.replace("#", "")
      // 处理带透明度的颜色
      const bgColor = bgHex.length > 6 ? `0x${bgHex.slice(0, 6)}` : `0x${bgHex}`
      const bgAlpha =
        bgHex.length > 6
          ? (parseInt(bgHex.slice(6), 16) / 255).toFixed(2)
          : "0.6"
      filter += `:box=1:boxcolor=${bgColor}@${bgAlpha}:boxborderw=${style.padding || 8}`
    }

    // 描边（轮廓）
    if (
      style.strokeColor &&
      style.strokeColor !== "transparent" &&
      style.strokeWidth > 0
    ) {
      const strokeColor = style.strokeColor.replace("#", "0x")
      filter += `:bordercolor=${strokeColor}:borderw=${style.strokeWidth}`
    }

    // 阴影（FFmpeg 的 shadow 参数）
    if (style.shadowColor && style.shadowColor !== "transparent") {
      const shadowColor = style.shadowColor.replace("#", "0x")
      filter += `:shadowcolor=${shadowColor}:shadowx=${style.shadowOffsetX || 2}:shadowy=${style.shadowOffsetY || 2}`
    }

    // 时间控制
    if (startTime >= 0 && endTime > startTime) {
      filter += `:enable='between(t\\,${startTime.toFixed(3)}\\,${endTime.toFixed(3)})'`
    }

    // 字母间距和行高（FFmpeg 支持有限，这里忽略）

    return filter
  }
}

/**
 * LTX 特效适配器
 * 将 LTX 的特效转换为 FFmpeg 滤镜
 */
export class LtxEffectAdapter {
  /**
   * 将特效转换为 FFmpeg 滤镜字符串
   */
  static toFfmpegFilter(effect: ClipEffect): string[] {
    const filters: string[] = []
    const p = effect.params

    switch (effect.type) {
      case "blur":
        if (p.amount > 0) {
          filters.push(`boxblur=${p.amount.toFixed(1)}`)
        }
        break

      case "sharpen":
        if (p.amount > 0) {
          const sharpenValue = (p.amount / 100) * 5 // 映射到 0-5 的范围
          filters.push(`unsharp=lx=5:ly=5:la=${sharpenValue.toFixed(2)}`)
        }
        break

      case "glow":
        // 发光效果：先模糊再叠加
        if (p.amount > 0) {
          const intensity = p.amount / 100
          const radius = p.radius || 10
          // 简化实现：使用 glow 滤镜或 convolution
          filters.push(`glow=strength=${intensity.toFixed(2)}:radius=${radius}`)
        }
        break

      case "vignette":
        if (p.amount > 0) {
          const amount = p.amount / 100
          filters.push(`vignette=angle=PI/4:aspect=1:ev=${amount.toFixed(2)}`)
        }
        break

      case "grain":
        if (p.amount > 0) {
          const amount = p.amount / 100
          filters.push(`noise=alls=${amount.toFixed(2)}:allf=t`)
        }
        break

      // LUT 预设效果 - 使用颜色调整模拟
      case "lut-cinematic":
      case "lut-vintage":
      case "lut-bw":
      case "lut-cool":
      case "lut-warm":
      case "lut-muted":
      case "lut-vivid":
        filters.push(
          ...LtxEffectAdapter.lutToFfmpegFilters(
            effect.type,
            p.intensity || 100,
          ),
        )
        break
    }

    return filters
  }

  /**
   * LUT 预设转换为 FFmpeg 滤镜
   */
  private static lutToFfmpegFilters(
    lutType: EffectType,
    intensity: number,
  ): string[] {
    const filters: string[] = []
    const t = intensity / 100 // 0.0 到 1.0

    switch (lutType) {
      case "lut-cinematic":
        if (t > 0) {
          filters.push(
            `colorbalance=rs=-${(0.1 * t).toFixed(2)}:gs=-${(0.1 * t).toFixed(2)}:bs=${(0.1 * t).toFixed(2)}`,
          )
          filters.push(
            `eq=contrast=${(1 + 0.1 * t).toFixed(2)}:saturation=${(1 - 0.15 * t).toFixed(2)}:brightness=-${(0.05 * t).toFixed(2)}`,
          )
        }
        break

      case "lut-vintage":
        if (t > 0) {
          filters.push(
            `colorbalance=rs=${(0.15 * t).toFixed(2)}:gs=-${(0.05 * t).toFixed(2)}:bs=0`,
          )
          filters.push(
            `eq=contrast=${(1 - 0.1 * t).toFixed(2)}:saturation=${(1 - 0.2 * t).toFixed(2)}:brightness=${(0.05 * t).toFixed(2)}`,
          )
        }
        break

      case "lut-bw":
        if (t > 0) {
          filters.push(`hue=s=0`)
          filters.push(`eq=contrast=${(1 + 0.2 * t).toFixed(2)}`)
        }
        break

      case "lut-cool":
        if (t > 0) {
          filters.push(
            `colorbalance=rs=-${(0.1 * t).toFixed(2)}:gs=${(0.05 * t).toFixed(2)}:bs=${(0.15 * t).toFixed(2)}`,
          )
          filters.push(
            `eq=contrast=${(1 + 0.05 * t).toFixed(2)}:saturation=${(1 - 0.1 * t).toFixed(2)}`,
          )
        }
        break

      case "lut-warm":
        if (t > 0) {
          filters.push(
            `colorbalance=rs=${(0.15 * t).toFixed(2)}:gs=-${(0.05 * t).toFixed(2)}:bs=0`,
          )
          filters.push(`eq=saturation=${(1 + 0.1 * t).toFixed(2)}`)
        }
        break

      case "lut-muted":
        if (t > 0) {
          filters.push(
            `eq=saturation=${(1 - 0.5 * t).toFixed(2)}:contrast=${(1 - 0.05 * t).toFixed(2)}`,
          )
        }
        break

      case "lut-vivid":
        if (t > 0) {
          filters.push(
            `eq=saturation=${(1 + 0.6 * t).toFixed(2)}:contrast=${(1 + 0.1 * t).toFixed(2)}`,
          )
        }
        break
    }

    return filters
  }
}

/**
 * LTX 转场适配器
 * 处理 LTX 转场类型和扩展类型 (cube, clock, glitch)
 */
export type ExtendedTransitionType =
  (typeof LtxTransitionAdapter.ExtendedTransitionTypes)[number]

export class LtxTransitionAdapter {
  // 扩展的转场类型，包含 LTX 原有类型和新增类型
  static readonly ExtendedTransitionTypes = [
    // LTX 原有类型
    "none",
    "dissolve",
    "fade-to-black",
    "fade-to-white",
    "wipe-left",
    "wipe-right",
    "wipe-up",
    "wipe-down",
    // 扩展类型
    "cube",
    "clock",
    "glitch",
  ] as const

  /**
   * 将转场类型转换为 FFmpeg xfade 滤镜名称
   */
  private static toXfadeName(transitionType: ExtendedTransitionType): string {
    switch (transitionType) {
      case "dissolve":
        return "fade"
      case "fade-to-black":
        return "fadeblack"
      case "fade-to-white":
        return "fadewhite"
      case "wipe-left":
        return "wipeleft"
      case "wipe-right":
        return "wiperight"
      case "wipe-up":
        return "wipeup"
      case "wipe-down":
        return "wipedown"
      case "cube":
        return "cube"
      case "clock":
        return "clock"
      case "glitch":
        return "glitch"
      case "none":
        return "fade" // 默认使用 fade
      default:
        return "fade"
    }
  }

  /**
   * 生成转场滤镜字符串
   * @param transitionType 转场类型
   * @param duration 持续时间（秒）
   * @param offset 偏移量（秒，默认0）
   */
  static toXfadeFilter(
    transitionType: ExtendedTransitionType,
    duration: number,
    offset: number = 0,
  ): string {
    if (transitionType === "none" || duration <= 0) {
      return ""
    }

    const xfadeName = LtxTransitionAdapter.toXfadeName(transitionType)

    // 构建 xfade 滤镜参数
    let filter = `xfade=transition=${xfadeName}:duration=${duration.toFixed(3)}`

    // 添加偏移参数
    if (offset > 0) {
      filter += `:offset=${offset.toFixed(3)}`
    }

    return filter
  }

  /**
   * 为两个视频流生成转场滤镜图
   * @param input1 第一个输入流标签（如 [0:v]）
   * @param input2 第二个输入流标签（如 [1:v]）
   * @param transitionType 转场类型
   * @param duration 持续时间
   * @param output 输出流标签（如 [outv]）
   */
  static buildTransitionFilterGraph(
    input1: string,
    input2: string,
    transitionType: ExtendedTransitionType,
    duration: number,
    output: string = "outv",
  ): string {
    if (transitionType === "none" || duration <= 0) {
      return `${input1}${input2}concat=n=2:v=1:a=0[${output}]`
    }

    const xfadeFilter = LtxTransitionAdapter.toXfadeFilter(
      transitionType,
      duration,
    )
    return `${input1}${input2}${xfadeFilter}[${output}]`
  }

  /**
   * 获取转场描述
   */
  static getTransitionDescription(
    transitionType: ExtendedTransitionType,
    duration: number,
  ): string {
    if (transitionType === "none" || duration <= 0) {
      return "无转场"
    }

    const names: Record<ExtendedTransitionType, string> = {
      none: "无",
      dissolve: "淡入淡出",
      "fade-to-black": "淡出到黑场",
      "fade-to-white": "淡出到白场",
      "wipe-left": "向左划像",
      "wipe-right": "向右划像",
      "wipe-up": "向上划像",
      "wipe-down": "向下划像",
      cube: "立方体旋转",
      clock: "时钟划像",
      glitch: "故障效果",
    }

    return `${names[transitionType]} (${duration.toFixed(1)}秒)`
  }
}

/**
 * 主适配器类 - 整合所有 LTX 功能
 */
export class LtxToolAdapter {
  /**
   * 应用颜色校正
   */
  static applyColorCorrection(
    input: string,
    correction: ColorCorrection,
  ): string[] {
    const filterString = LtxColorCorrectionAdapter.getFilterString(correction)
    if (!filterString) {
      return ["-i", input]
    }
    return ["-i", input, "-vf", filterString]
  }

  /**
   * 添加字幕
   */
  static addSubtitle(
    input: string,
    text: string,
    style: TextOverlayStyle,
    startTime: number,
    endTime: number,
  ): string[] {
    const filterString = LtxSubtitleAdapter.toDrawtextFilter(
      text,
      style,
      startTime,
      endTime,
    )
    return ["-i", input, "-vf", filterString]
  }

  /**
   * 应用特效
   */
  static applyEffect(input: string, effect: ClipEffect): string[] {
    const filters = LtxEffectAdapter.toFfmpegFilter(effect)
    if (filters.length === 0) {
      return ["-i", input]
    }
    const filterString = filters.join(",")
    return ["-i", input, "-vf", filterString]
  }

  /**
   * 应用转场效果（连接两个视频）
   * @param input1 第一个输入视频文件
   * @param input2 第二个输入视频文件
   * @param transitionType 转场类型（使用扩展类型）
   * @param duration 转场持续时间（秒）
   * @param output 输出文件路径
   */
  static applyTransition(
    input1: string,
    input2: string,
    transitionType: ExtendedTransitionType,
    duration: number,
    output: string,
  ): string[] {
    // 生成转场滤镜
    const xfadeFilter = LtxTransitionAdapter.toXfadeFilter(
      transitionType,
      duration,
    )

    if (!xfadeFilter) {
      // 无转场，直接连接两个视频
      return [
        "-i",
        input1,
        "-i",
        input2,
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[outv]",
        "-map",
        "[outv]",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-y",
        output,
      ]
    }

    // 使用转场效果
    return [
      "-i",
      input1,
      "-i",
      input2,
      "-filter_complex",
      `[0:v][1:v]${xfadeFilter}[outv]`,
      "-map",
      "[outv]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-y",
      output,
    ]
  }

  /**
   * 获取转场描述
   */
  static getTransitionDescription(
    transitionType: ExtendedTransitionType,
    duration: number,
  ): string {
    return LtxTransitionAdapter.getTransitionDescription(
      transitionType,
      duration,
    )
  }
}

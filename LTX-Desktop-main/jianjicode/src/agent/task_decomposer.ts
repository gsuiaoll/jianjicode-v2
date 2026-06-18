import path from "path"
import type { ExecutionStep, VideoTask } from "./types.js"

/**
 * 复杂任务分解器
 * 将复杂的自然语言视频编辑指令分解为多个执行步骤
 */
export class TaskDecomposer {
  /**
   * 将复杂任务分解为执行步骤
   * @param task 复杂视频任务
   * @returns 执行步骤数组
   */
  decomposeComplexTask(task: VideoTask): ExecutionStep[] {
    const steps: ExecutionStep[] = []
    const description = task.description.toLowerCase()

    // 提取操作序列
    const operations = this.extractOperations(description)

    // 为每个操作创建步骤
    let sequence = 1
    const intermediateFiles: string[] = []

    for (const operation of operations) {
      const step = this.createStepForOperation(
        operation,
        task,
        sequence,
        intermediateFiles,
      )
      steps.push(step)
      sequence++

      // 如果步骤产生输出文件，添加到中间文件列表
      if (step.outputFile && step.isIntermediate) {
        intermediateFiles.push(step.outputFile)
      }
    }

    // 设置步骤依赖关系
    this.setStepDependencies(steps)

    return steps
  }

  /**
   * 从描述中提取操作序列
   */
  private extractOperations(
    description: string,
  ): Array<{ type: string; params: Record<string, any> }> {
    const operations: Array<{ type: string; params: Record<string, any> }> = []

    // 分割描述中的操作关键词
    // 支持的分隔符: "and then", "then", "after that", "and"
    const segments = this.splitDescription(description)

    for (const segment of segments) {
      const operation = this.analyzeSegment(segment)
      if (operation) {
        operations.push(operation)
      }
    }

    return operations
  }

  /**
   * 分割描述为多个操作段
   */
  private splitDescription(description: string): string[] {
    const segments: string[] = []
    let current = description

    // 常见连接词
    const connectors = ["and then", "then", "after that", "and", ";"]

    for (const connector of connectors) {
      const parts = current.split(connector)
      if (parts.length > 1) {
        // 第一个部分添加到段中
        segments.push(parts[0].trim())
        // 剩余部分继续处理
        current = parts.slice(1).join(connector).trim()
      }
    }

    // 添加最后一部分
    if (current.trim()) {
      segments.push(current.trim())
    }

    // 如果没有分割，则整个描述作为一个段
    if (segments.length === 0) {
      segments.push(description.trim())
    }

    return segments
  }

  /**
   * 分析单个段，提取操作类型和参数
   */
  private analyzeSegment(
    segment: string,
  ): { type: string; params: Record<string, any> } | null {
    // 转换为小写以便匹配
    const lowerSegment = segment.toLowerCase()

    // 检查操作类型关键词
    if (lowerSegment.includes("trim") || lowerSegment.includes("cut")) {
      return this.extractTrimParams(segment)
    } else if (
      lowerSegment.includes("convert") ||
      lowerSegment.includes("transcode")
    ) {
      return this.extractConvertParams(segment)
    } else if (
      lowerSegment.includes("add subtitle") ||
      lowerSegment.includes("add caption")
    ) {
      return this.extractSubtitleParams(segment)
    } else if (
      lowerSegment.includes("add watermark") ||
      lowerSegment.includes("add logo")
    ) {
      return this.extractWatermarkParams(segment)
    } else if (
      lowerSegment.includes("extract audio") ||
      lowerSegment.includes("get audio")
    ) {
      return { type: "extract_audio", params: {} }
    } else if (
      lowerSegment.includes("merge audio") ||
      lowerSegment.includes("add audio")
    ) {
      return this.extractMergeAudioParams(segment)
    } else if (
      lowerSegment.includes("filter") ||
      lowerSegment.includes("brightness") ||
      lowerSegment.includes("contrast") ||
      lowerSegment.includes("color")
    ) {
      return this.extractFilterParams(segment)
    } else if (
      lowerSegment.includes("picture in picture") ||
      lowerSegment.includes("pip")
    ) {
      return this.extractPipParams(segment)
    } else if (
      lowerSegment.includes("transition") ||
      lowerSegment.includes("fade")
    ) {
      return this.extractTransitionParams(segment)
    }

    // 未知操作类型
    return null
  }

  /**
   * 提取裁剪参数
   */
  private extractTrimParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 提取时间信息
    const timeRegex = /(\d+)\s*(seconds?|minutes?|hours?|s|m|h)/gi
    const times = []
    let match

    while ((match = timeRegex.exec(segment)) !== null) {
      const value = parseInt(match[1])
      const unit = match[2].toLowerCase()

      let seconds = value
      if (unit.startsWith("minute") || unit === "m") {
        seconds = value * 60
      } else if (unit.startsWith("hour") || unit === "h") {
        seconds = value * 3600
      }

      times.push(seconds)
    }

    if (times.length >= 1) {
      if (segment.includes("from") && segment.includes("to")) {
        // "from X to Y" 格式
        params.start_time = times[0]
        params.end_time = times[1] || times[0] + 10 // 默认10秒
      } else if (segment.includes("first")) {
        // "first X seconds" 格式
        params.start_time = 0
        params.duration = times[0]
      } else {
        // 默认: 从开始裁剪指定时长
        params.start_time = 0
        params.duration = times[0]
      }
    } else {
      // 默认值
      params.start_time = 0
      params.duration = 10
    }

    return { type: "trim", params }
  }

  /**
   * 提取转换参数
   */
  private extractConvertParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 检查目标格式
    const formats = ["mp4", "webm", "avi", "mov", "mkv", "flv", "wmv"]
    for (const format of formats) {
      if (segment.includes(format)) {
        params.format = format
        break
      }
    }

    if (!params.format) {
      params.format = "mp4" // 默认格式
    }

    return { type: "convert", params }
  }

  /**
   * 提取字幕参数
   */
  private extractSubtitleParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 提取字幕文件路径
    const fileRegex = /["']([^"']+\.(srt|vtt|ass))["']/i
    const fileMatch = fileRegex.exec(segment)
    if (fileMatch) {
      params.subtitle_file = fileMatch[1]
    }

    return { type: "subtitle", params }
  }

  /**
   * 提取水印参数
   */
  private extractWatermarkParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 提取水印图片路径
    const imageRegex = /["']([^"']+\.(png|jpg|jpeg|gif|bmp))["']/i
    const imageMatch = imageRegex.exec(segment)
    if (imageMatch) {
      params.watermark_image = imageMatch[1]
    }

    // 检查位置
    const positions = [
      "top left",
      "top right",
      "bottom left",
      "bottom right",
      "center",
    ]
    for (const position of positions) {
      if (segment.includes(position)) {
        params.position = position
        break
      }
    }

    if (!params.position) {
      params.position = "bottom right"
    }

    return { type: "watermark", params }
  }

  /**
   * 提取合并音频参数
   */
  private extractMergeAudioParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 提取音频文件路径
    const audioRegex = /["']([^"']+\.(mp3|wav|aac|ogg|flac))["']/i
    const audioMatch = audioRegex.exec(segment)
    if (audioMatch) {
      params.audio_file = audioMatch[1]
    }

    return { type: "merge_audio", params }
  }

  /**
   * 提取滤镜参数
   */
  private extractFilterParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 检查滤镜类型
    if (segment.includes("brightness")) {
      const brightnessMatch = segment.match(/brightness\s+(\d+(\.\d+)?)/i)
      params.brightness = brightnessMatch ? parseFloat(brightnessMatch[1]) : 1.0
    }

    if (segment.includes("contrast")) {
      const contrastMatch = segment.match(/contrast\s+(\d+(\.\d+)?)/i)
      params.contrast = contrastMatch ? parseFloat(contrastMatch[1]) : 1.0
    }

    if (segment.includes("saturation")) {
      const saturationMatch = segment.match(/saturation\s+(\d+(\.\d+)?)/i)
      params.saturation = saturationMatch ? parseFloat(saturationMatch[1]) : 1.0
    }

    return { type: "filter", params }
  }

  /**
   * 提取画中画参数
   */
  private extractPipParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 提取第二个视频文件
    const videoRegex = /["']([^"']+\.(mp4|mov|avi|mkv|webm))["']/i
    const videoMatches = []
    let match
    while ((match = videoRegex.exec(segment)) !== null) {
      videoMatches.push(match[1])
    }

    if (videoMatches.length >= 2) {
      params.pip_video = videoMatches[1]
    }

    // 检查位置
    const positions = [
      "top left",
      "top right",
      "bottom left",
      "bottom right",
      "center",
    ]
    for (const position of positions) {
      if (segment.includes(position)) {
        params.position = position
        break
      }
    }

    if (!params.position) {
      params.position = "bottom right"
    }

    // 检查大小
    const sizeRegex = /size\s+(\d+)%/i
    const sizeMatch = sizeRegex.exec(segment)
    if (sizeMatch) {
      params.size = parseInt(sizeMatch[1])
    } else {
      params.size = 30 // 默认30%
    }

    return { type: "pip", params }
  }

  /**
   * 提取转场参数
   */
  private extractTransitionParams(segment: string): {
    type: string
    params: Record<string, any>
  } {
    const params: Record<string, any> = {}

    // 检查转场类型
    const transitions = ["fade", "crossfade", "slide", "wipe", "zoom"]
    for (const transition of transitions) {
      if (segment.includes(transition)) {
        params.transition_type = transition
        break
      }
    }

    if (!params.transition_type) {
      params.transition_type = "fade"
    }

    // 检查持续时间
    const durationRegex = /(\d+)\s*(seconds?|s)/i
    const durationMatch = durationRegex.exec(segment)
    if (durationMatch) {
      params.duration = parseInt(durationMatch[1])
    } else {
      params.duration = 1 // 默认1秒
    }

    return { type: "transition", params }
  }

  /**
   * 为操作创建执行步骤
   */
  private createStepForOperation(
    operation: { type: string; params: Record<string, any> },
    task: VideoTask,
    sequence: number,
    intermediateFiles: string[],
  ): ExecutionStep {
    const stepId = `step_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    // 确定输入文件
    let inputFiles: string[] = []
    if (intermediateFiles.length > 0) {
      // 使用上一个步骤的输出作为输入
      inputFiles = [intermediateFiles[intermediateFiles.length - 1]]
    } else {
      // 使用任务的输入文件
      inputFiles = [...task.inputFiles]
    }

    // 确定输出文件
    let outputFile = ""
    const isIntermediate = sequence < task.parameters.operation_count || true // 暂时假设所有都是中间步骤

    if (isIntermediate) {
      // 生成中间文件路径
      const inputPath = inputFiles[0] || task.inputFiles[0]
      const basename = path.basename(inputPath, path.extname(inputPath))
      const dirname = path.dirname(inputPath)
      outputFile = path.join(
        dirname,
        `${basename}_step${sequence}_${operation.type}.mp4`,
      )
    } else {
      // 最终输出文件
      outputFile =
        task.outputFile || this.generateFinalOutputPath(task.inputFiles[0])
    }

    // 确定工具ID
    const toolId = this.getToolIdForOperation(operation.type)

    // 合并参数
    const parameters = {
      ...operation.params,
      // 确保必要的参数存在
      input_file: inputFiles[0],
      output_file: outputFile,
    }

    return {
      id: stepId,
      sequence,
      toolId,
      parameters,
      inputFiles,
      outputFile,
      description: `${operation.type} operation`,
      isIntermediate,
      dependencies: sequence > 1 ? [`step_${sequence - 1}`] : undefined,
    }
  }

  /**
   * 设置步骤依赖关系
   */
  private setStepDependencies(steps: ExecutionStep[]): void {
    for (let i = 1; i < steps.length; i++) {
      const currentStep = steps[i]
      const prevStep = steps[i - 1]

      currentStep.dependencies = [prevStep.id]
    }
  }

  /**
   * 根据操作类型获取工具ID
   */
  private getToolIdForOperation(operationType: string): string {
    const toolMap: Record<string, string> = {
      trim: "ffmpeg",
      convert: "ffmpeg",
      subtitle: "video_subtitle",
      watermark: "video_watermark",
      extract_audio: "ffmpeg",
      merge_audio: "ffmpeg",
      filter: "video_filter",
      pip: "video_pip",
      transition: "video_transition",
    }

    return toolMap[operationType] || "ffmpeg"
  }

  /**
   * 生成最终输出文件路径
   */
  private generateFinalOutputPath(inputPath: string): string {
    const basename = path.basename(inputPath, path.extname(inputPath))
    const dirname = path.dirname(inputPath)
    return path.join(dirname, `${basename}_final_edited.mp4`)
  }
}

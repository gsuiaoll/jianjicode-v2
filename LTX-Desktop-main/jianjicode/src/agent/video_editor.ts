import path from "path"
import { toolRegistry } from "../registry/tool_registry.js"
import { BaseVideoAgent } from "./base_agent.js"
import { TaskDecomposer } from "./task_decomposer.js"
import type { AgentConfig, ExecutionStep, VideoTask } from "./types.js"

/**
 * 视频编辑代理 - 全功能视频编辑代理
 *
 * 能力: 支持所有视频编辑操作，包括复杂多步骤任务
 * 工具: 可以使用所有视频编辑工具
 * 适用: 复杂编辑任务、多步骤处理、专业级编辑
 */
export class VideoEditorAgent extends BaseVideoAgent {
  public readonly id = "video_editor"
  public readonly name = "视频编辑代理"
  public readonly description =
    "全功能视频编辑代理，支持所有视频编辑操作和复杂多步骤任务"
  public readonly capabilities = [
    "trim",
    "concat",
    "convert",
    "filter",
    "subtitle",
    "watermark",
    "transition",
    "pip",
    "batch",
    "complex",
    "extract_audio",
    "merge_audio",
    "get_info",
  ]
  public readonly tools = ["*"] // 可以使用所有工具
  public readonly maxConcurrentTasks = 2 // 复杂任务，并发数较低
  public readonly isDefault = true // 默认代理

  /**
   * 创建执行步骤
   * @param task 视频编辑任务
   * @returns 执行步骤列表
   */
  protected createExecutionSteps(task: VideoTask): ExecutionStep[] {
    const steps: ExecutionStep[] = []
    const stepIdBase = `step_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    // 根据任务类型创建步骤
    switch (task.type) {
      case "trim":
        steps.push(this.createTrimStep(task, `${stepIdBase}_1`))
        break
      case "concat":
        steps.push(this.createConcatStep(task, `${stepIdBase}_1`))
        break
      case "convert":
        steps.push(this.createConvertStep(task, `${stepIdBase}_1`))
        break
      case "filter":
        steps.push(this.createFilterStep(task, `${stepIdBase}_1`))
        break
      case "subtitle":
        steps.push(this.createSubtitleStep(task, `${stepIdBase}_1`))
        break
      case "watermark":
        steps.push(this.createWatermarkStep(task, `${stepIdBase}_1`))
        break
      case "transition":
        steps.push(this.createTransitionStep(task, `${stepIdBase}_1`))
        break
      case "pip":
        steps.push(this.createPipStep(task, `${stepIdBase}_1`))
        break
      case "batch":
        steps.push(...this.createBatchSteps(task, stepIdBase))
        break
      case "complex":
        steps.push(...this.createComplexSteps(task, stepIdBase))
        break
      case "extract_audio":
      case "merge_audio":
      case "get_info":
        // 使用FFmpeg工具处理音频提取、音频合并和信息获取
        steps.push(this.createFfmpegStep(task, `${stepIdBase}_1`))
        break
      case "basketball_shot_edit":
        // 使用篮球投篮编辑器工具
        steps.push(this.createBasketballShotEditStep(task, `${stepIdBase}_1`))
        break
      default:
        // 默认使用FFmpeg工具
        steps.push(this.createFfmpegStep(task, `${stepIdBase}_1`))
    }

    return steps
  }

  /**
   * 创建裁剪步骤
   */
  private createTrimStep(task: VideoTask, stepId: string): ExecutionStep {
    // 调试日志
    console.log(
      `[video_editor:createTrimStep] task.description="${task.description}", task.parameters.command="${task.parameters.command}"`,
    )

    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "trim",
        input: task.inputFiles[0],
        start_time: task.parameters.start_time,
        end_time: task.parameters.end_time,
        duration: task.parameters.duration,
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "trimmed"),
        command: task.parameters.command || task.description, // 传递自然语言命令供FFmpeg工具解析
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "trimmed"),
      description: `裁剪视频: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建合并步骤
   */
  private createConcatStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "concat",
        input_files: task.inputFiles.join(","),
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "concatenated"),
        command: task.parameters.command || task.description, // 传递自然语言命令供FFmpeg工具解析
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "concatenated"),
      description: `合并视频: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建转换步骤
   */
  private createConvertStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "convert",
        input: task.inputFiles[0],
        format: task.parameters.format,
        codec: task.parameters.codec,
        output:
          task.outputFile ||
          this.generateOutputPath(
            task.inputFiles[0],
            "converted",
            task.parameters.format,
          ),
        command: task.parameters.command || task.description, // 传递自然语言命令供FFmpeg工具解析
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(
          task.inputFiles[0],
          "converted",
          task.parameters.format,
        ),
      description: `转换视频格式: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建滤镜步骤
   */
  private createFilterStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "video_filter",
      parameters: {
        input: task.inputFiles[0],
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "filtered"),
        brightness: task.parameters.brightness,
        contrast: task.parameters.contrast,
        saturation: task.parameters.saturation,
        hue: task.parameters.hue,
        gamma: task.parameters.gamma,
        exposure: task.parameters.exposure,
        sharpen: task.parameters.sharpen,
        blur: task.parameters.blur,
        preset: task.parameters.preset,
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "filtered"),
      description: `应用视频滤镜: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建字幕步骤
   */
  private createSubtitleStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "video_subtitle",
      parameters: {
        input: task.inputFiles[0],
        subtitle_file: task.parameters.subtitle_file,
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "subtitled"),
        encoding: task.parameters.encoding,
        font_name: task.parameters.font_name,
        font_size: task.parameters.font_size,
        font_color: task.parameters.font_color,
        position: task.parameters.position,
        alignment: task.parameters.alignment,
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "subtitled"),
      description: `添加字幕: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建水印步骤
   */
  private createWatermarkStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "video_watermark",
      parameters: {
        input: task.inputFiles[0],
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "watermarked"),
        watermark_type: task.parameters.watermark_type,
        watermark_image: task.parameters.watermark_image,
        watermark_text: task.parameters.watermark_text,
        position: task.parameters.position,
        size_type: task.parameters.size_type,
        size_value: task.parameters.size_value,
        opacity: task.parameters.opacity,
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "watermarked"),
      description: `添加水印: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建转场步骤
   */
  private createTransitionStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "video_transition",
      parameters: {
        input1: task.inputFiles[0],
        input2: task.inputFiles[1],
        output:
          task.outputFile ||
          this.generateOutputPath(task.inputFiles[0], "transition"),
        transition_type: task.parameters.transition_type,
        duration: task.parameters.duration,
        position: task.parameters.position,
        audio_transition: task.parameters.audio_transition,
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "transition"),
      description: `添加转场效果: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建画中画步骤
   */
  private createPipStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "video_pip",
      parameters: {
        main_video: task.inputFiles[0],
        pip_video: task.inputFiles[1],
        output:
          task.outputFile || this.generateOutputPath(task.inputFiles[0], "pip"),
        position: task.parameters.position,
        size_type: task.parameters.size_type,
        size_value: task.parameters.size_value,
        border_width: task.parameters.border_width,
        start_time: task.parameters.start_time,
        end_time: task.parameters.end_time,
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile || this.generateOutputPath(task.inputFiles[0], "pip"),
      description: `添加画中画效果: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建批处理步骤
   */
  private createBatchSteps(
    task: VideoTask,
    stepIdBase: string,
  ): ExecutionStep[] {
    const steps: ExecutionStep[] = []

    // 步骤1: 扫描文件
    steps.push({
      id: `${stepIdBase}_1`,
      sequence: 1,
      toolId: "batch_scanner",
      parameters: {
        directory: task.parameters.directory,
        pattern: task.parameters.pattern,
        recursive: task.parameters.recursive,
        limit: task.parameters.limit,
      },
      inputFiles: [],
      outputFile: "", // 扫描工具不产生输出文件
      description: `扫描目录中的视频文件: ${task.parameters.directory}`,
      isIntermediate: true,
    })

    // 步骤2: 批处理队列
    steps.push({
      id: `${stepIdBase}_2`,
      sequence: 2,
      toolId: "batch_queue",
      parameters: {
        tasks: task.parameters.tasks,
        max_concurrent: task.parameters.max_concurrent,
        output_dir: task.parameters.output_dir,
      },
      inputFiles: [],
      outputFile:
        task.outputFile || this.generateOutputPath("batch", "processed"),
      description: `批量处理视频文件`,
      isIntermediate: false,
      dependencies: [`${stepIdBase}_1`],
    })

    // 步骤3: 生成报告（可选）
    if (task.parameters.generate_report) {
      steps.push({
        id: `${stepIdBase}_3`,
        sequence: 3,
        toolId: "batch_report",
        parameters: {
          report_format: task.parameters.report_format,
          output_file: task.parameters.report_file,
        },
        inputFiles: [],
        outputFile: task.parameters.report_file,
        description: `生成批处理报告`,
        isIntermediate: false,
        dependencies: [`${stepIdBase}_2`],
      })
    }

    return steps
  }

  /**
   * 创建复杂任务步骤
   */
  private createComplexSteps(
    task: VideoTask,
    stepIdBase: string,
  ): ExecutionStep[] {
    // 使用任务分解器处理复杂任务
    const decomposer = new TaskDecomposer()
    const steps = decomposer.decomposeComplexTask(task)

    // 调整步骤ID以匹配基类期望的格式
    let stepCounter = 1
    for (const step of steps) {
      step.id = `${stepIdBase}_${stepCounter++}`
    }

    // 确保最后一个步骤不是中间步骤
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1]
      lastStep.isIntermediate = false

      // 如果任务有指定的输出文件，使用它
      if (task.outputFile) {
        lastStep.outputFile = task.outputFile
        lastStep.parameters.output = task.outputFile
      }
    }

    return steps
  }

  /**
   * 创建篮球投篮编辑步骤
   */
  private createBasketballShotEditStep(
    task: VideoTask,
    stepId: string,
  ): ExecutionStep {
    // 调试日志
    console.log(
      `[video_editor:createBasketballShotEditStep] task.description="${task.description}"`,
    )

    // 提取JSON文件路径
    let shotsJson = task.parameters.shots_json
    if (!shotsJson) {
      // 尝试从输入文件中找到JSON文件
      const jsonFiles = task.inputFiles.filter((file) => file.endsWith(".json"))
      if (jsonFiles.length > 0) {
        shotsJson = jsonFiles[0]
      } else {
        // 尝试从描述中提取
        const jsonMatch = task.description.match(/([^\s]+\.json)/)
        if (jsonMatch) {
          shotsJson = jsonMatch[0]
        }
      }
    }

    // 确定视频文件路径 - 优先使用参数中的input，然后从输入文件中查找视频文件
    let videoPath = task.parameters.input
    if (!videoPath) {
      const videoFiles = task.inputFiles.filter(
        (file) =>
          file.endsWith(".mp4") ||
          file.endsWith(".avi") ||
          file.endsWith(".mov") ||
          file.endsWith(".mkv") ||
          file.endsWith(".webm"),
      )
      if (videoFiles.length > 0) {
        videoPath = videoFiles[0]
      }
    }

    // 如果还没有视频路径，使用第一个输入文件（可能是JSON，工具会从中读取视频路径）
    if (!videoPath && task.inputFiles.length > 0) {
      videoPath = task.inputFiles[0]
    }

    // 构建参数
    const parameters: Record<string, any> = {
      ...task.parameters,
      shots_json: shotsJson,
      input: videoPath,
      output:
        task.outputFile ||
        this.generateOutputPath(videoPath || "video", "trimmed"),
      remove_misses:
        task.parameters.remove_misses !== undefined
          ? task.parameters.remove_misses
          : true,
      keep_makes:
        task.parameters.keep_makes !== undefined
          ? task.parameters.keep_makes
          : true,
      keep_attempts:
        task.parameters.keep_attempts !== undefined
          ? task.parameters.keep_attempts
          : false,
      allow_overwrite:
        task.parameters.allow_overwrite !== undefined
          ? task.parameters.allow_overwrite
          : false,
      protect_originals:
        task.parameters.protect_originals !== undefined
          ? task.parameters.protect_originals
          : true,
    }

    return {
      id: stepId,
      sequence: 1,
      toolId: "basketball_shot_editor",
      parameters,
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(videoPath || "video", "trimmed"),
      description: `篮球投篮剪辑: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建通用FFmpeg步骤
   */
  private createFfmpegStep(task: VideoTask, stepId: string): ExecutionStep {
    // 调试日志
    console.log(
      `[video_editor:createFfmpegStep] task.description="${task.description}", task.parameters.command="${task.parameters.command}", task.parameters=${JSON.stringify(task.parameters)}`,
    )

    // 根据任务类型设置特定参数
    const parameters: Record<string, any> = {
      ...task.parameters,
      input: task.inputFiles[0],
      output:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "processed"),
      command: task.parameters.command || task.description, // 传递自然语言命令供FFmpeg工具解析
    }

    // 根据任务类型设置operation和其他必要参数
    switch (task.type) {
      case "merge_audio":
        parameters.operation = "merge_audio"
        parameters.video_file = task.inputFiles[0]
        parameters.audio_file = task.inputFiles[1]
        break
      case "extract_audio":
        parameters.operation = "extract_audio"
        break
      case "get_info":
        parameters.operation = "get_info"
        break
      default:
        // 对于其他类型，保留原有的operation参数（如果提供）
        if (!parameters.operation && task.parameters.operation) {
          parameters.operation = task.parameters.operation
        }
    }

    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters,
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateOutputPath(task.inputFiles[0], "processed"),
      description: `处理视频: ${task.description}`,
      isIntermediate: false,
    }
  }

  /**
   * 生成输出文件路径
   */
  private generateOutputPath(
    inputPath: string,
    operation: string,
    format?: string,
    stepIndex?: number,
  ): string {
    const ext = format || path.extname(inputPath).substring(1) || "mp4"
    const basename = path.basename(inputPath, path.extname(inputPath))
    const dirname = path.dirname(inputPath)

    let suffix = `_${operation}`
    if (stepIndex !== undefined) {
      suffix += `_step${stepIndex}`
    }

    return path.join(dirname, `${basename}${suffix}.${ext}`)
  }

  /**
   * 重写分析任务需要的工具方法（优化版本）
   */
  protected analyzeRequiredTools(task: VideoTask): string[] {
    // 视频编辑代理可以使用所有工具
    return ["*"]
  }
}

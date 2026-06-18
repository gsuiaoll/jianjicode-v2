import path from "path"
import { toolRegistry } from "../registry/tool_registry.js"
import { BaseVideoAgent } from "./base_agent.js"
import type { AgentConfig, ExecutionStep, VideoTask } from "./types.js"

/**
 * 快速操作代理 - 专为简单快速视频操作设计
 *
 * 能力: 仅支持简单操作，响应速度快
 * 工具: 仅限基础FFmpeg工具，避免复杂处理
 * 适用: 裁剪、格式转换、音频提取等简单任务
 */
export class VideoQuickAgent extends BaseVideoAgent {
  public readonly id = "video_quick"
  public readonly name = "快速操作代理"
  public readonly description =
    "专为简单快速视频操作设计，响应速度快，仅处理基础编辑任务"
  public readonly capabilities = [
    "trim",
    "convert",
    "extract_audio",
    "merge_audio",
    "get_info",
  ]
  public readonly tools = ["ffmpeg"] // 仅使用基础FFmpeg工具
  public readonly maxConcurrentTasks = 5 // 简单任务，可以高并发
  public readonly isDefault = false // 不是默认代理

  /**
   * 创建执行步骤
   * @param task 视频编辑任务
   * @returns 执行步骤列表
   */
  protected createExecutionSteps(task: VideoTask): ExecutionStep[] {
    const steps: ExecutionStep[] = []
    const stepId = `quick_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    // 快速代理只支持单步操作
    switch (task.type) {
      case "trim":
        steps.push(this.createTrimStep(task, stepId))
        break
      case "convert":
        steps.push(this.createConvertStep(task, stepId))
        break
      case "extract_audio":
        steps.push(this.createExtractAudioStep(task, stepId))
        break
      case "merge_audio":
        steps.push(this.createMergeAudioStep(task, stepId))
        break
      case "get_info":
        steps.push(this.createGetInfoStep(task, stepId))
        break
      default:
        // 快速代理不支持复杂操作
        throw new Error(`快速代理不支持 ${task.type} 类型的任务`)
    }

    return steps
  }

  /**
   * 创建裁剪步骤（优化版，使用快速参数）
   */
  private createTrimStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "trim",
        input_file: task.inputFiles[0],
        start_time: task.parameters.start_time,
        end_time: task.parameters.end_time,
        duration: task.parameters.duration,
        output_file:
          task.outputFile ||
          this.generateQuickOutputPath(task.inputFiles[0], "trimmed"),
        // 快速代理使用优化参数
        fast: true,
        quality: 28, // 稍低的质量以获得更快的速度
        preset: "fast",
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateQuickOutputPath(task.inputFiles[0], "trimmed"),
      description: `快速裁剪视频: ${task.description.substring(0, 50)}...`,
      isIntermediate: false,
    }
  }

  /**
   * 创建转换步骤（优化版）
   */
  private createConvertStep(task: VideoTask, stepId: string): ExecutionStep {
    const format = task.parameters.format || "mp4"

    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "convert",
        input_file: task.inputFiles[0],
        format: format,
        codec: this.getFastCodec(format),
        output_file:
          task.outputFile ||
          this.generateQuickOutputPath(task.inputFiles[0], "converted", format),
        // 快速代理使用优化参数
        fast: true,
        quality: 28,
        preset: "fast",
        // 根据格式优化参数
        ...this.getFormatSpecificParams(format),
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateQuickOutputPath(task.inputFiles[0], "converted", format),
      description: `快速转换视频格式为 ${format}`,
      isIntermediate: false,
    }
  }

  /**
   * 创建音频提取步骤
   */
  private createExtractAudioStep(
    task: VideoTask,
    stepId: string,
  ): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "extract_audio",
        input_file: task.inputFiles[0],
        output_file:
          task.outputFile ||
          this.generateQuickOutputPath(task.inputFiles[0], "audio", "mp3"),
        // 音频提取使用快速参数
        audio_bitrate: "128k", // 较低比特率以获得更小的文件
        audio_codec: "libmp3lame",
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateQuickOutputPath(task.inputFiles[0], "audio", "mp3"),
      description: `快速提取音频`,
      isIntermediate: false,
    }
  }

  /**
   * 创建音频合并步骤
   */
  private createMergeAudioStep(task: VideoTask, stepId: string): ExecutionStep {
    if (task.inputFiles.length < 2) {
      throw new Error("音频合并需要至少两个输入文件（视频和音频）")
    }

    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "merge_audio",
        input: task.inputFiles[0],
        audio_file: task.inputFiles[1],
        output:
          task.outputFile ||
          this.generateQuickOutputPath(task.inputFiles[0], "with_audio"),
        // 快速合并参数
        fast: true,
        quality: 28,
        audio_bitrate: "128k",
      },
      inputFiles: task.inputFiles,
      outputFile:
        task.outputFile ||
        this.generateQuickOutputPath(task.inputFiles[0], "with_audio"),
      description: `快速合并音频到视频`,
      isIntermediate: false,
    }
  }

  /**
   * 创建获取信息步骤
   */
  private createGetInfoStep(task: VideoTask, stepId: string): ExecutionStep {
    return {
      id: stepId,
      sequence: 1,
      toolId: "ffmpeg",
      parameters: {
        operation: "get_info",
        input_file: task.inputFiles[0],
        // 获取信息不需要输出文件
      },
      inputFiles: task.inputFiles,
      outputFile: "", // 信息获取不产生输出文件
      description: `快速获取视频信息`,
      isIntermediate: false,
    }
  }

  /**
   * 获取快速编码器
   */
  private getFastCodec(format: string): string {
    const fastCodecs: Record<string, string> = {
      mp4: "libx264",
      webm: "libvpx-vp9",
      avi: "mpeg4",
      mov: "libx264",
      mkv: "libx264",
      flv: "flv",
      wmv: "wmv2",
    }
    return fastCodecs[format] || "libx264"
  }

  /**
   * 获取格式特定参数
   */
  private getFormatSpecificParams(format: string): Record<string, any> {
    const params: Record<string, Record<string, any>> = {
      mp4: {
        crf: 28,
        preset: "fast",
        tune: "fastdecode",
      },
      webm: {
        deadline: "realtime",
        cpu_used: 5,
      },
      avi: {
        qscale: 4,
      },
    }
    return params[format] || {}
  }

  /**
   * 生成快速输出文件路径
   */
  private generateQuickOutputPath(
    inputPath: string,
    operation: string,
    format?: string,
  ): string {
    const ext = format || path.extname(inputPath).substring(1) || "mp4"
    const basename = path.basename(inputPath, path.extname(inputPath))
    const dirname = path.dirname(inputPath)

    // 快速代理使用_q后缀表示快速处理
    return path.join(dirname, `${basename}_q_${operation}.${ext}`)
  }

  /**
   * 重写分析任务需要的工具方法
   */
  protected analyzeRequiredTools(task: VideoTask): string[] {
    // 快速代理只使用ffmpeg工具
    return ["ffmpeg"]
  }

  /**
   * 重写预估任务执行时间（快速代理更乐观）
   */
  protected estimateDuration(task: VideoTask, steps: ExecutionStep[]): number {
    // 快速代理预估时间更短
    const baseTimePerStep = 10 // 每个步骤基础10秒（而不是30秒）
    return steps.length * baseTimePerStep
  }

  /**
   * 重写检查文件访问权限方法
   */
  protected checkFileAccess(filePaths: string[]): boolean {
    // 首先检查权限管理器配置
    if (!super.checkFileAccess(filePaths)) {
      return false
    }

    // 快速代理只处理用户目录下的文件（额外安全检查）
    const userHome = process.env.HOME || process.env.USERPROFILE || ""
    for (const filePath of filePaths) {
      if (
        filePath.includes("..") ||
        filePath.startsWith("/etc") ||
        filePath.startsWith("/var")
      ) {
        return false
      }
      // 确保文件在用户目录下
      if (userHome && !filePath.startsWith(userHome)) {
        this.log("warn", `快速代理限制访问非用户目录文件: ${filePath}`)
        return false
      }
    }
    return true
  }

  /**
   * 重写判断代理是否能处理指定任务方法
   */
  canHandle(task: VideoTask): boolean {
    // 首先调用父类检查
    if (!super.canHandle(task)) {
      return false
    }

    // 额外检查：快速代理不处理大文件
    const maxFileSize = 500 * 1024 * 1024 // 500MB
    // 这里简化处理，实际需要检查文件大小
    // 快速代理不处理复杂任务
    if (task.type === "complex" || task.type === "batch") {
      return false
    }

    // 快速代理不处理需要专业工具的任务
    if (
      ["filter", "subtitle", "watermark", "transition", "pip"].includes(
        task.type,
      )
    ) {
      return false
    }

    return true
  }

  /**
   * 重写执行单个步骤方法（优化错误处理）
   */
  protected async executeStep(
    step: ExecutionStep,
  ): Promise<{ success: boolean; outputFile?: string; error?: string }> {
    try {
      this.log("info", `快速执行步骤: ${step.description}`)

      // 快速代理有超时限制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("执行超时（快速代理限制）")), 300000) // 5分钟超时
      })

      // 执行工具（带超时）
      const tool = await toolRegistry.getInitializedTool(step.toolId)
      if (!tool) {
        throw new Error(`工具未找到: ${step.toolId}`)
      }

      const executionPromise = tool.execute(
        step.parameters,
        this.createToolContext(step),
      )
      const result = (await Promise.race([
        executionPromise,
        timeoutPromise,
      ])) as any

      if (result.metadata?.error) {
        this.log("error", `快速执行失败: ${result.output?.substring(0, 100)}`)
        return {
          success: false,
          error: `快速执行失败: ${result.output || "未知错误"}`,
        }
      }

      this.log("info", `快速执行成功`)
      return {
        success: true,
        outputFile: step.outputFile,
      }
    } catch (error: any) {
      this.log("error", `快速执行异常: ${error.message}`)
      return {
        success: false,
        error: `快速执行异常: ${error.message}`,
      }
    }
  }
}

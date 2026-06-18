import path from "path"
import { BaseVideoAgent } from "./base_agent.js"
import type {
  AgentConfig,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  VideoTask,
} from "./types.js"

/**
 * 批量处理代理 - 专为批量视频处理设计
 *
 * 能力: 批量处理、文件夹扫描、队列管理、进度报告
 * 工具: 批处理工具 + 基础编辑工具
 * 适用: 批量转换、批量加水印、批量重编码等
 */
export class VideoBatchAgent extends BaseVideoAgent {
  public readonly id = "video_batch"
  public readonly name = "批量处理代理"
  public readonly description =
    "专为批量视频处理设计，支持文件夹扫描、任务队列管理和进度报告"
  public readonly capabilities = [
    "batch",
    "trim",
    "convert",
    "filter",
    "subtitle",
    "watermark",
  ]
  public readonly tools = [
    "batch_scanner",
    "batch_queue",
    "batch_report",
    "ffmpeg",
    "video_filter",
    "video_subtitle",
    "video_watermark",
  ]
  public readonly maxConcurrentTasks = 1 // 批量处理通常一次一个任务（但每个任务内多文件）
  public readonly isDefault = false // 不是默认代理

  /**
   * 创建执行步骤
   * @param task 视频编辑任务
   * @returns 执行步骤列表
   */
  protected createExecutionSteps(task: VideoTask): ExecutionStep[] {
    const steps: ExecutionStep[] = []
    const stepIdBase = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    // 批量代理总是使用标准的三步流程
    steps.push(...this.createStandardBatchSteps(task, stepIdBase))

    return steps
  }

  /**
   * 创建标准批处理步骤（扫描 → 处理 → 报告）
   */
  private createStandardBatchSteps(
    task: VideoTask,
    stepIdBase: string,
  ): ExecutionStep[] {
    const steps: ExecutionStep[] = []

    // 步骤1: 扫描文件
    steps.push({
      id: `${stepIdBase}_1`,
      sequence: 1,
      toolId: "batch_scanner",
      parameters: this.createScannerParams(task),
      inputFiles: [],
      outputFile: "", // 扫描工具不产生输出文件
      description: `扫描目录中的视频文件`,
      isIntermediate: true,
    })

    // 步骤2: 批处理队列
    steps.push({
      id: `${stepIdBase}_2`,
      sequence: 2,
      toolId: "batch_queue",
      parameters: this.createQueueParams(task),
      inputFiles: [],
      outputFile: task.outputFile || this.generateBatchOutputPath(task),
      description: `批量处理视频文件`,
      isIntermediate: false,
      dependencies: [`${stepIdBase}_1`],
    })

    // 步骤3: 生成报告（如果请求）
    if (this.shouldGenerateReport(task)) {
      steps.push({
        id: `${stepIdBase}_3`,
        sequence: 3,
        toolId: "batch_report",
        parameters: this.createReportParams(task),
        inputFiles: [],
        outputFile: this.getReportOutputPath(task),
        description: `生成批处理报告`,
        isIntermediate: false,
        dependencies: [`${stepIdBase}_2`],
      })
    }

    return steps
  }

  /**
   * 创建扫描器参数
   */
  private createScannerParams(task: VideoTask): Record<string, any> {
    const defaultParams = {
      recursive: true,
      pattern: "*.mp4,*.mov,*.avi,*.mkv,*.webm",
      min_size: 1024, // 1KB
      max_size: 10 * 1024 * 1024 * 1024, // 10GB
      sort_by: "name",
      sort_order: "asc",
      limit: 1000, // 最多1000个文件
    }

    return {
      ...defaultParams,
      directory: task.parameters.directory || ".",
      ...task.parameters.scanner_params,
    }
  }

  /**
   * 创建队列参数
   */
  private createQueueParams(task: VideoTask): Record<string, any> {
    // 从任务参数中提取处理配置
    const operation = task.parameters.operation || "convert"
    const operationParams = this.extractOperationParams(task, operation)

    // 构建任务模板
    const taskTemplate = {
      operation: operation,
      parameters: operationParams,
      output_pattern:
        task.parameters.output_pattern || "{basename}_processed.{ext}",
    }

    const defaultParams = {
      max_concurrent: 3,
      max_retries: 2,
      retry_delay: 5,
      timeout_per_task: 300, // 5分钟
      stop_on_error: false,
      output_dir: task.parameters.output_dir || "./output",
      detailed_progress: true,
    }

    return {
      ...defaultParams,
      tasks: task.parameters.tasks || [taskTemplate], // 支持自定义任务列表
      ...task.parameters.queue_params,
    }
  }

  /**
   * 提取操作特定参数
   */
  private extractOperationParams(
    task: VideoTask,
    operation: string,
  ): Record<string, any> {
    const baseParams: Record<string, any> = {}

    switch (operation) {
      case "convert":
        baseParams.format = task.parameters.format || "mp4"
        baseParams.quality = task.parameters.quality || 23
        baseParams.preset = task.parameters.preset || "medium"
        break
      case "trim":
        baseParams.start_time = task.parameters.start_time
        baseParams.end_time = task.parameters.end_time
        baseParams.duration = task.parameters.duration
        break
      case "filter":
        baseParams.preset = task.parameters.preset
        baseParams.brightness = task.parameters.brightness
        baseParams.contrast = task.parameters.contrast
        baseParams.saturation = task.parameters.saturation
        break
      case "subtitle":
        baseParams.subtitle_file = task.parameters.subtitle_file
        baseParams.font_size = task.parameters.font_size || 24
        baseParams.position = task.parameters.position || "bottom"
        break
      case "watermark":
        baseParams.watermark_image = task.parameters.watermark_image
        baseParams.position = task.parameters.position || "bottom-right"
        baseParams.size_value = task.parameters.size_value || "10%"
        break
    }

    return {
      ...baseParams,
      ...task.parameters.operation_params,
    }
  }

  /**
   * 判断是否需要生成报告
   */
  private shouldGenerateReport(task: VideoTask): boolean {
    return (
      task.parameters.generate_report !== false &&
      (task.parameters.report_format !== undefined ||
        task.parameters.report_file !== undefined)
    )
  }

  /**
   * 创建报告参数
   */
  private createReportParams(task: VideoTask): Record<string, any> {
    const defaultParams = {
      report_format: "text",
      include_details: true,
      include_statistics: true,
      include_errors: true,
      include_performance: true,
      generate_charts: false,
    }

    return {
      ...defaultParams,
      output_file: this.getReportOutputPath(task),
      ...task.parameters.report_params,
    }
  }

  /**
   * 获取报告输出路径
   */
  private getReportOutputPath(task: VideoTask): string {
    if (task.parameters.report_file) {
      return task.parameters.report_file
    }

    const outputDir = task.parameters.output_dir || "./output"
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const format = task.parameters.report_format || "txt"

    return path.join(outputDir, `batch_report_${timestamp}.${format}`)
  }

  /**
   * 生成批量输出路径
   */
  private generateBatchOutputPath(task: VideoTask): string {
    const outputDir = task.parameters.output_dir || "./output"
    const operation = task.parameters.operation || "processed"
    const timestamp = new Date().toISOString().split("T")[0]

    return path.join(outputDir, `batch_${operation}_${timestamp}`)
  }

  /**
   * 重写分析任务需要的工具方法
   */
  protected analyzeRequiredTools(task: VideoTask): string[] {
    const requiredTools = ["batch_scanner", "batch_queue"]

    // 根据操作类型添加工具
    const operation = task.parameters.operation || "convert"
    const operationToolMap: Record<string, string> = {
      convert: "ffmpeg",
      trim: "ffmpeg",
      filter: "video_filter",
      subtitle: "video_subtitle",
      watermark: "video_watermark",
    }

    const operationTool = operationToolMap[operation]
    if (operationTool) {
      requiredTools.push(operationTool)
    }

    // 如果需要报告，添加报告工具
    if (this.shouldGenerateReport(task)) {
      requiredTools.push("batch_report")
    }

    return [...new Set(requiredTools)]
  }

  /**
   * 重写预估任务执行时间
   */
  protected estimateDuration(task: VideoTask, steps: ExecutionStep[]): number {
    // 批量处理时间较长，基础时间更长
    const baseTimePerStep = 60 // 每个步骤基础60秒
    let totalTime = steps.length * baseTimePerStep

    // 根据预计文件数量增加时间
    const estimatedFiles = task.parameters.estimated_files || 10
    const timePerFile = 30 // 每个文件30秒
    totalTime += estimatedFiles * timePerFile

    return totalTime
  }

  /**
   * 重写预估输出文件大小
   */
  protected estimateOutputSize(task: VideoTask): number {
    // 批量处理输出大小取决于输入文件数量和大小
    const estimatedFiles = task.parameters.estimated_files || 10
    const avgFileSize = 100 * 1024 * 1024 // 平均100MB
    return estimatedFiles * avgFileSize
  }

  /**
   * 重写检查是否有危险操作
   */
  protected checkDangerousOperations(task: VideoTask): boolean {
    // 批量处理总是有风险（可能影响多个文件）
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

    // 批量代理只处理批量任务或明确标记为批量的任务
    if (
      task.type !== "batch" &&
      !task.description.toLowerCase().includes("batch")
    ) {
      return false
    }

    // 检查是否有目录参数
    if (!task.parameters.directory && !task.parameters.tasks) {
      return false
    }

    return true
  }

  /**
   * 重写执行计划方法（添加批处理特定逻辑）
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.log("info", `开始批量处理，预估处理 ${plan.estimatedDuration} 秒`)

    // 批量处理前确认
    if (plan.hasDangerousOperations) {
      this.log("warn", "⚠️ 批量处理涉及危险操作，请确保已备份重要文件")
    }

    // 调用父类执行
    return super.execute(plan)
  }

  /**
   * 重写执行单个步骤方法（添加批处理监控）
   */
  protected async executeStep(
    step: ExecutionStep,
  ): Promise<{ success: boolean; outputFile?: string; error?: string }> {
    const stepStartTime = Date.now()
    this.log("info", `开始批处理步骤 ${step.sequence}: ${step.description}`)

    try {
      // 批处理步骤可能有较长的执行时间
      const result = await super.executeStep(step)

      const stepDuration = Date.now() - stepStartTime
      if (result.success) {
        this.log(
          "info",
          `批处理步骤 ${step.sequence} 完成，耗时 ${stepDuration}ms`,
        )
      } else {
        this.log(
          "error",
          `批处理步骤 ${step.sequence} 失败，耗时 ${stepDuration}ms`,
        )
      }

      return result
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime
      this.log(
        "error",
        `批处理步骤 ${step.sequence} 异常，耗时 ${stepDuration}ms: ${error.message}`,
      )

      return {
        success: false,
        error: `批处理步骤异常: ${error.message}`,
      }
    }
  }

  /**
   * 获取代理状态（扩展版本）
   */
  getStatus(): any {
    const baseStatus = super.getStatus()

    // 添加批处理特定状态
    return {
      ...baseStatus,
      batchSpecific: {
        supportsBatchOperations: true,
        maxBatchSize: 1000,
        estimatedBatchTimePerFile: 30, // 秒
        recommendedBatchSize: 100,
      },
    }
  }
}

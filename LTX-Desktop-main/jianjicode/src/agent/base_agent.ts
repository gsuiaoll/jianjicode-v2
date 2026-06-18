import { toolRegistry } from "../registry/tool_registry.js"
import { permissionManager } from "./permission_manager.js"
import type {
  AgentConfig,
  AgentStatus,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  VideoAgent,
  VideoTask,
} from "./types.js"

/**
 * 基础视频代理抽象类
 */
export abstract class BaseVideoAgent implements VideoAgent {
  public abstract readonly id: string
  public abstract readonly name: string
  public abstract readonly description: string
  public abstract readonly capabilities: string[]
  public abstract readonly tools: string[]
  public abstract readonly maxConcurrentTasks: number
  public abstract readonly isDefault: boolean

  protected taskQueue: VideoTask[] = []
  protected activeTasks: Map<string, VideoTask> = new Map()
  protected completedTasks: VideoTask[] = []
  protected executionLogs: Array<{
    timestamp: Date
    level: string
    message: string
  }> = []

  /**
   * 构造函数
   */
  constructor(protected config?: Partial<AgentConfig>) {
    this.log("info", `代理 ${this.constructor.name} 已初始化`)
  }

  /**
   * 判断代理是否能处理指定任务
   * @param task 视频编辑任务
   * @returns 是否能处理
   */
  canHandle(task: VideoTask): boolean {
    // 检查任务类型是否在代理能力范围内
    if (!this.capabilities.includes(task.type)) {
      return false
    }

    // 检查代理是否有处理任务所需的工具
    const requiredTools = this.analyzeRequiredTools(task)
    for (const toolId of requiredTools) {
      if (!this.tools.includes(toolId) && !this.tools.includes("*")) {
        return false
      }
      // 检查工具使用权限
      if (!permissionManager.canUseTool(this.id, toolId)) {
        this.log("warn", `代理 ${this.id} 没有使用工具 ${toolId} 的权限`)
        return false
      }
    }

    // 检查文件访问权限
    if (!this.checkFileAccess(task.inputFiles)) {
      return false
    }

    // 检查并发任务限制
    if (this.activeTasks.size >= this.maxConcurrentTasks) {
      return false
    }

    return true
  }

  /**
   * 分析任务需要的工具
   * @param task 视频编辑任务
   * @returns 需要的工具ID列表
   */
  protected analyzeRequiredTools(task: VideoTask): string[] {
    const requiredTools: string[] = []

    // 根据任务类型映射到工具
    const typeToToolMap: Record<string, string[]> = {
      trim: ["ffmpeg"],
      concat: ["ffmpeg"],
      convert: ["ffmpeg"],
      filter: ["video_filter"],
      subtitle: ["video_subtitle"],
      watermark: ["video_watermark"],
      transition: ["video_transition"],
      pip: ["video_pip"],
      batch: ["batch_scanner", "batch_queue", "batch_report"],
      complex: ["*"], // 复杂任务可能需要多个工具
    }

    const toolIds = typeToToolMap[task.type] || ["ffmpeg"]
    requiredTools.push(...toolIds)

    // 如果是复杂任务，需要进一步分析
    if (task.type === "complex") {
      const complexTools = this.analyzeComplexTaskTools(task)
      requiredTools.push(...complexTools)
    }

    return [...new Set(requiredTools)] // 去重
  }

  /**
   * 分析复杂任务需要的工具
   * @param task 复杂任务
   * @returns 工具ID列表
   */
  protected analyzeComplexTaskTools(task: VideoTask): string[] {
    // 这里实现复杂任务分析逻辑
    // 可以根据任务描述中的关键词推断需要的工具
    const description = task.description.toLowerCase()
    const tools: string[] = []

    if (
      description.includes("filter") ||
      description.includes("brightness") ||
      description.includes("contrast")
    ) {
      tools.push("video_filter")
    }
    if (description.includes("subtitle") || description.includes("caption")) {
      tools.push("video_subtitle")
    }
    if (description.includes("watermark") || description.includes("logo")) {
      tools.push("video_watermark")
    }
    if (description.includes("transition") || description.includes("fade")) {
      tools.push("video_transition")
    }
    if (
      description.includes("pip") ||
      description.includes("picture in picture")
    ) {
      tools.push("video_pip")
    }
    if (description.includes("batch") || description.includes("multiple")) {
      tools.push("batch_scanner", "batch_queue")
    }

    // 默认总是需要基础FFmpeg工具
    tools.push("ffmpeg")

    return [...new Set(tools)]
  }

  /**
   * 检查文件访问权限
   * @param filePaths 文件路径列表
   * @returns 是否有访问权限
   */
  protected checkFileAccess(filePaths: string[]): boolean {
    for (const filePath of filePaths) {
      if (!permissionManager.canAccessFile(this.id, filePath)) {
        this.log("warn", `代理 ${this.id} 没有访问文件 ${filePath} 的权限`)
        return false
      }
    }
    return true
  }

  /**
   * 为任务制定执行计划
   * @param task 视频编辑任务
   * @returns 执行计划
   */
  planExecution(task: VideoTask): ExecutionPlan {
    this.log("info", `开始为任务 "${task.description}" 制定执行计划`)

    const steps = this.createExecutionSteps(task)
    const requiredTools = this.analyzeRequiredTools(task)
    const hasDangerousOperations = this.checkDangerousOperations(task)

    const plan: ExecutionPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      taskId: task.id,
      steps,
      estimatedDuration: this.estimateDuration(task, steps),
      estimatedOutputSize: this.estimateOutputSize(task),
      requiredTools,
      hasDangerousOperations,
    }

    this.log("info", `执行计划制定完成，共 ${steps.length} 个步骤`)
    return plan
  }

  /**
   * 创建执行步骤
   * @param task 视频编辑任务
   * @returns 执行步骤列表
   */
  protected abstract createExecutionSteps(task: VideoTask): ExecutionStep[]

  /**
   * 预估任务执行时间
   * @param task 视频编辑任务
   * @param steps 执行步骤
   * @returns 预估时间（秒）
   */
  protected estimateDuration(task: VideoTask, steps: ExecutionStep[]): number {
    // 简化实现：根据步骤数量预估
    // 实际实现应考虑文件大小、操作复杂度等因素
    const baseTimePerStep = 30 // 每个步骤基础30秒
    return steps.length * baseTimePerStep
  }

  /**
   * 预估输出文件大小
   * @param task 视频编辑任务
   * @returns 预估大小（字节）
   */
  protected estimateOutputSize(task: VideoTask): number {
    // 简化实现：假设输出文件与输入文件大小相同
    // 实际实现应根据操作类型估算
    return 100 * 1024 * 1024 // 默认100MB
  }

  /**
   * 检查是否有危险操作
   * @param task 视频编辑任务
   * @returns 是否有危险操作
   */
  protected checkDangerousOperations(task: VideoTask): boolean {
    // 检查是否可能覆盖原文件
    if (
      task.outputFile &&
      task.inputFiles.some((input) => input === task.outputFile)
    ) {
      return true
    }

    // 检查是否涉及删除操作
    if (
      task.description.toLowerCase().includes("delete") ||
      task.description.toLowerCase().includes("remove")
    ) {
      return true
    }

    return false
  }

  /**
   * 执行计划
   * @param plan 执行计划
   * @returns 执行结果
   */
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const startTime = new Date()
    const logs: Array<{
      timestamp: Date
      level: string
      message: string
      stepId?: string
    }> = []
    const outputFiles: string[] = []
    let success = true
    let error: any

    this.log("info", `开始执行计划 ${plan.id}`)

    try {
      // 按顺序执行步骤
      for (const step of plan.steps) {
        const stepStartTime = new Date()

        this.log(
          "info",
          `开始执行步骤 ${step.sequence}: ${step.description}`,
          step.id,
        )

        // 检查步骤依赖是否满足
        if (step.dependencies && step.dependencies.length > 0) {
          const unmetDeps = step.dependencies.filter(
            (depId) => !outputFiles.some((file) => file.includes(depId)),
          )
          if (unmetDeps.length > 0) {
            throw new Error(`步骤依赖未满足: ${unmetDeps.join(", ")}`)
          }
        }

        // 执行步骤
        const stepResult = await this.executeStep(step)

        if (stepResult.success) {
          this.log("info", `步骤 ${step.sequence} 执行成功`, step.id)
          if (stepResult.outputFile) {
            outputFiles.push(stepResult.outputFile)
          }
        } else {
          this.log(
            "error",
            `步骤 ${step.sequence} 执行失败: ${stepResult.error}`,
            step.id,
          )
          success = false
          error = stepResult.error
          break
        }
      }

      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      const result: ExecutionResult = {
        id: `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        taskId: plan.taskId,
        success,
        outputFiles,
        logs: logs.map((log) => ({
          timestamp: log.timestamp,
          level: log.level as any,
          message: log.message,
          stepId: log.stepId,
        })),
        startedAt: startTime,
        finishedAt: endTime,
        duration,
        error: error
          ? {
              message: error.message || "未知错误",
              code: error.code || "UNKNOWN",
              details: error,
            }
          : undefined,
      }

      if (success) {
        this.log("info", `计划执行成功，输出 ${outputFiles.length} 个文件`)
      } else {
        this.log("error", `计划执行失败: ${error?.message}`)
      }

      return result
    } catch (err: any) {
      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()

      this.log("error", `执行过程中发生未捕获错误: ${err.message}`)

      return {
        id: `result_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        taskId: plan.taskId,
        success: false,
        outputFiles: [],
        logs: logs.map((log) => ({
          timestamp: log.timestamp,
          level: log.level as any,
          message: log.message,
          stepId: log.stepId,
        })),
        startedAt: startTime,
        finishedAt: endTime,
        duration,
        error: {
          message: err.message || "未捕获的错误",
          code: err.code || "UNCAUGHT",
          details: err,
        },
      }
    }
  }

  /**
   * 执行单个步骤
   * @param step 执行步骤
   * @returns 步骤执行结果
   */
  protected async executeStep(
    step: ExecutionStep,
  ): Promise<{ success: boolean; outputFile?: string; error?: string }> {
    try {
      // 获取工具
      const tool = await toolRegistry.getInitializedTool(step.toolId)
      if (!tool) {
        throw new Error(`工具未找到: ${step.toolId}`)
      }

      // 执行工具
      const result = await tool.execute(
        step.parameters,
        this.createToolContext(step),
      )

      if (result.metadata?.error) {
        return {
          success: false,
          error: result.output || "工具执行失败",
        }
      }

      return {
        success: true,
        outputFile: step.outputFile,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "步骤执行失败",
      }
    }
  }

  /**
   * 创建工具执行上下文
   * @param step 执行步骤
   * @returns 工具上下文
   */
  protected createToolContext(step: ExecutionStep): any {
    return {
      sessionID: `agent_${this.id}_${step.id}`,
      messageID: `step_${step.id}`,
      agent: this.id,
      abort: new AbortController().signal,
      // 可以添加更多上下文信息
    }
  }

  /**
   * 获取代理状态
   * @returns 代理状态
   */
  getStatus(): AgentStatus {
    const now = new Date()
    const lastActivity =
      this.executionLogs.length > 0
        ? this.executionLogs[this.executionLogs.length - 1].timestamp
        : now

    return {
      agentId: this.id,
      isReady: this.activeTasks.size < this.maxConcurrentTasks,
      currentTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      totalCompletedTasks: this.completedTasks.length,
      averageExecutionTime: 0, // 实际需要计算
      successRate: 1.0, // 实际需要计算
      lastActivity,
    }
  }

  /**
   * 记录日志
   * @param level 日志级别
   * @param message 日志消息
   * @param stepId 步骤ID（可选）
   */
  protected log(
    level: "info" | "warn" | "error" | "debug",
    message: string,
    stepId?: string,
  ): void {
    const timestamp = new Date()
    const logEntry = { timestamp, level, message, stepId }
    this.executionLogs.push(logEntry)

    // 控制台输出
    const prefix = stepId ? `[${this.name}:${stepId}]` : `[${this.name}]`
    console.log(
      `${timestamp.toISOString()} ${prefix} ${level.toUpperCase()}: ${message}`,
    )
  }
}

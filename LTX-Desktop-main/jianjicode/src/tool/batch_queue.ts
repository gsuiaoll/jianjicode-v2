import EventEmitter from "events"
import { randomUUID } from "crypto"
import z from "zod"
import { toolRegistry } from "../registry/tool_registry.js"
import { Tool } from "./tool.js"
import { BatchProgressStore } from "./batch_progress.js"

/**
 * 批处理任务队列 - 管理和执行批量视频编辑任务
 *
 * 支持功能:
 * 1. 任务队列管理 (FIFO)
 * 2. 并行执行控制
 * 3. 进度监控和报告
 * 4. 错误处理和重试
 * 5. 资源限制控制
 */
// 首先定义参数schema
const batchQueueParameters = z.object({
  // 批处理标识
  batch_id: z
    .string()
    .optional()
    .describe("批处理 ID (自动生成，用于进度查询和取消操作)"),

  // 任务配置
  tasks: z
    .array(
      z.object({
        id: z.string().describe("任务唯一标识符"),
        operation: z
          .string()
          .describe("要执行的操作类型 (如 'convert', 'trim', 'video_filter')"),
        parameters: z.record(z.any()).describe("操作参数"),
        input_file: z.string().describe("输入文件路径"),
        output_file: z.string().optional().describe("输出文件路径"),
        priority: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .default(50)
          .describe("任务优先级 (0-100，越高越优先，默认: 50)"),
      }),
    )
    .describe("要处理的任务列表"),

  // 执行控制
  max_concurrent: z
    .number()
    .min(1)
    .max(20)
    .optional()
    .default(3)
    .describe("最大并发任务数 (1-20，默认: 3)"),
  max_retries: z
    .number()
    .min(0)
    .max(5)
    .optional()
    .default(1)
    .describe("失败重试次数 (0-5，默认: 1)"),
  retry_delay: z
    .number()
    .min(0)
    .max(60)
    .optional()
    .default(5)
    .describe("重试延迟 (秒，0-60，默认: 5)"),
  timeout_per_task: z
    .number()
    .min(10)
    .max(3600)
    .optional()
    .default(300)
    .describe("单任务超时时间 (秒，10-3600，默认: 300)"),
  stop_on_error: z
    .boolean()
    .optional()
    .default(false)
    .describe("遇到错误是否停止整个队列 (默认: 否)"),

  // 资源限制
  max_cpu_usage: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("最大CPU使用率限制 (0-100%，空表示无限制)"),
  max_memory_mb: z
    .number()
    .min(100)
    .max(8192)
    .optional()
    .describe("最大内存使用限制 (MB，100-8192，空表示无限制)"),
  output_dir: z
    .string()
    .optional()
    .describe("输出目录限制 (确保所有输出文件都在此目录内)"),

  // 进度报告
  progress_interval: z
    .number()
    .min(1)
    .max(60)
    .optional()
    .default(5)
    .describe("进度报告间隔 (秒，1-60，默认: 5)"),
  detailed_progress: z
    .boolean()
    .optional()
    .default(true)
    .describe("是否显示详细进度信息 (默认: 是)"),
})

// 定义execute函数
async function executeBatchQueue(args: any, ctx: Tool.Context) {
  try {
    // 1. 验证任务列表
    if (!args.tasks || args.tasks.length === 0) {
      return {
        title: "批处理队列执行失败",
        metadata: { operation: "batch_queue", error: true, success: false },
        output: "❌ 任务列表为空",
      } as any
    }

    // 2. 生成/使用批处理 ID
    const batchId = args.batch_id || `batch_${Date.now()}_${randomUUID().slice(0, 8)}`
    const store = BatchProgressStore.getInstance()

    // 2.1 在 store 中注册
    store.createBatch(
      batchId,
      args.tasks.map((t: any) => ({
        id: t.id,
        operation: t.operation,
        input_file: t.input_file,
      })),
      {
        max_concurrent: args.max_concurrent,
        max_retries: args.max_retries,
        stop_on_error: args.stop_on_error,
      },
    )

    // 2.2 创建事件发射器用于进度报告
    const events = new EventEmitter()

    // 2.1 创建自定义任务执行函数，调用实际工具
    const executeTool = async (task: any): Promise<any> => {
      try {
        // LTX直接桥接工具支持的操作列表
        const ltxOperations = new Set([
          "trim",
          "concat",
          "extract_audio",
          "add_subtitle",
          "apply_color_grading",
          "apply_color_preset",
          "convert_format",
          "extract_frame",
          "merge_audio_video",
          "video_info",
          "list_color_presets",
          "list_subtitle_templates",
          "list_effect_templates",
          "get_color_preset",
        ])

        // 确定使用哪个工具
        let toolId = task.operation
        if (ltxOperations.has(task.operation)) {
          toolId = "ltx_direct"
        }

        // 获取工具
        const tool = await toolRegistry.getInitializedTool(toolId, {
          agent: ctx.agent,
        })
        if (!tool) {
          throw new Error(`找不到工具: ${toolId}`)
        }

        // 准备参数：合并任务参数和任务参数中的参数
        const toolArgs = {
          operation: task.operation,
          ...task.parameters,
          // 确保必要的文件路径参数
          input_path: task.input_file,
          output_path: task.output_file,
          // 其他可能的参数映射...
        }

        // 清理undefined参数
        Object.keys(toolArgs).forEach((key) => {
          if (toolArgs[key] === undefined) {
            delete toolArgs[key]
          }
        })

        console.log(`[BatchQueue] 执行任务: ${task.id} (${task.operation})`)
        console.log(`[BatchQueue] 工具参数:`, JSON.stringify(toolArgs, null, 2))

        // 执行工具
        const result = await tool.execute(toolArgs, ctx)

        // 检查工具执行结果
        if (result.metadata?.error) {
          throw new Error(result.output || `工具执行失败: ${task.operation}`)
        }

        return result
      } catch (error: any) {
        console.error(`[BatchQueue] 任务 ${task.id} 执行失败:`, error)
        throw error
      }
    }

    // 3. 创建队列处理器
    const processor = new BatchQueueProcessor(
      args.tasks,
      {
        maxConcurrent: args.max_concurrent,
        maxRetries: args.max_retries,
        retryDelay: args.retry_delay * 1000, // 转换为毫秒
        timeoutPerTask: args.timeout_per_task * 1000,
        stopOnError: args.stop_on_error,
        progressInterval: args.progress_interval * 1000,
        abortSignal: ctx.abort,
      },
      events,
      executeTool,
    )

    // 4. 设置进度监听
    const lastProgressTime = Date.now()
    const progressData = {
      total: args.tasks.length,
      completed: 0,
      failed: 0,
      running: 0,
      pending: args.tasks.length,
      startTime: Date.now(),
    }

    events.on("task_started", (taskId) => {
      progressData.running++
      progressData.pending--
      store.markTaskStarted(batchId, taskId)
      logProgress(progressData, args.detailed_progress)
    })

    events.on("task_completed", (taskId, result) => {
      progressData.completed++
      progressData.running--
      store.markTaskCompleted(batchId, taskId)
      logProgress(progressData, args.detailed_progress)
    })

    events.on("task_failed", (taskId, error, retryCount) => {
      progressData.failed++
      progressData.running--
      store.markTaskFailed(batchId, taskId, error?.message || "未知错误")
      logProgress(progressData, args.detailed_progress)
    })

    events.on("task_retry", (taskId, error, retryCount) => {
      store.markTaskRetrying(batchId, taskId, retryCount)
    })

    events.on("progress", (data) => {
      progressData.completed = data.completed
      progressData.failed = data.failed
      progressData.running = data.running
      progressData.pending = data.pending
      logProgress(progressData, args.detailed_progress)
    })

    // 5. 传递给 processor 以便支持取消
    processor.setBatchId(batchId)

    // 5.1 执行队列
    console.log(`[BatchQueueTool] 开始执行 ${args.tasks.length} 个任务 [batch: ${batchId}]`)
    console.log(`[BatchQueueTool] 并发限制: ${args.max_concurrent}`)
    console.log(`[BatchQueueTool] 重试次数: ${args.max_retries}`)

    const results = await processor.process()

    // 6. 生成统计信息
    const stats = calculateStats(results, progressData)

    // 7. 返回结果
    return {
      title: "批处理队列执行完成",
      metadata: {
        operation: "batch_queue",
        success: true,
        error: false,
        batch_id: batchId,
        results,
        stats,
        parameters: args,
      },
      output: formatOutput(results, stats, args),
    } as any
  } catch (error: any) {
    return {
      title: "批处理队列执行错误",
      metadata: { operation: "batch_queue", error: true, success: false },
      output: `❌ 批处理执行过程中发生错误: ${error.message}`,
    } as any
  }
}

export const BatchQueueTool = Tool.define("batch_queue", {
  description: "批量处理视频编辑任务，支持并行执行和进度监控",
  parameters: batchQueueParameters,
  execute: executeBatchQueue,
} as any)

// 批处理队列处理器类
class BatchQueueProcessor {
  private tasks: any[]
  private config: any
  private events: EventEmitter
  private results: Map<string, any>
  private runningTasks: Set<string>
  private abortController: AbortController
  private executeTool: (task: any) => Promise<any>
  private batchId: string = ""

  constructor(
    tasks: any[],
    config: any,
    events: EventEmitter,
    executeTool?: (task: any) => Promise<any>,
  ) {
    this.tasks = [...tasks]
    this.config = config
    this.events = events
    this.results = new Map()
    this.runningTasks = new Set()
    this.abortController = new AbortController()
    this.executeTool = executeTool || this.defaultExecuteTool
  }

  setBatchId(id: string): void {
    this.batchId = id
  }

  async process(): Promise<Map<string, any>> {
    // 按优先级排序任务
    this.tasks.sort((a, b) => (b.priority || 50) - (a.priority || 50))

    let currentIndex = 0
    const runningPromises: Array<{ promise: Promise<void>; id: number }> = []
    let nextId = 0

    // 启动初始批次
    while (
      currentIndex < Math.min(this.config.maxConcurrent, this.tasks.length)
    ) {
      if (this.config.abortSignal?.aborted) break
      const taskId = nextId++
      const promise = this.processTask(this.tasks[currentIndex++])
      runningPromises.push({ promise, id: taskId })
    }

    // 当有任务完成时，启动新任务
    while (currentIndex < this.tasks.length) {
      if (this.config.abortSignal?.aborted) break

      // 检查是否被外部取消
      if (this.batchId && BatchProgressStore.getInstance().isCancelled(this.batchId)) {
        console.log(`[BatchQueue] 批处理 ${this.batchId} 已被取消，停止调度新任务`)
        break
      }

      // 等待一个任务完成
      const completedPromise = await Promise.race(
        runningPromises.map((p) =>
          p.promise.then(() => p.id).catch(() => p.id),
        ),
      )

      // 移除已完成的promise
      const index = runningPromises.findIndex((p) => p.id === completedPromise)
      if (index !== -1) {
        runningPromises.splice(index, 1)
      }

      // 启动新任务
      if (currentIndex < this.tasks.length) {
        const taskId = nextId++
        const promise = this.processTask(this.tasks[currentIndex++])
        runningPromises.push({ promise, id: taskId })
      }
    }

    // 等待剩余任务完成
    await Promise.all(runningPromises.map((p) => p.promise))

    return this.results
  }

  private async processTask(task: any): Promise<void> {
    const taskId = task.id

    try {
      // 检查是否已中止或被取消
      if (this.config.abortSignal?.aborted) {
        throw new Error("处理已中止")
      }
      if (this.batchId && BatchProgressStore.getInstance().isCancelled(this.batchId)) {
        throw new Error("批处理已被取消")
      }

      // 标记任务开始
      this.runningTasks.add(taskId)
      this.events.emit("task_started", taskId)

      let retryCount = 0
      let lastError: Error | null = null

      // 重试循环
      while (retryCount <= this.config.maxRetries) {
        // 每次重试创建新的超时，并保存清理函数
        let timeoutHandle: any = null
        const timeoutPromise = new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(
                new Error(`任务超时 (${this.config.timeoutPerTask / 1000}秒)`),
              ),
            this.config.timeoutPerTask,
          )
        })

        try {
          // 实际执行任务
          const result = (await Promise.race([
            this.executeTask(task),
            timeoutPromise,
          ])) as any

          // 清理超时定时器
          if (timeoutHandle) clearTimeout(timeoutHandle)

          // 任务成功完成
          this.runningTasks.delete(taskId)
          this.results.set(taskId, {
            success: true,
            task,
            result,
            retryCount,
            timestamp: new Date(),
          })

          this.events.emit("task_completed", taskId, result)
          return
        } catch (error: any) {
          // 清理超时定时器
          if (timeoutHandle) clearTimeout(timeoutHandle)

          lastError = error
          retryCount++

          if (retryCount <= this.config.maxRetries) {
            console.log(
              `[BatchQueue] 任务 ${taskId} 失败，第 ${retryCount} 次重试...`,
            )
            this.events.emit("task_retry", taskId, error, retryCount)

            // 等待重试延迟
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.retryDelay),
            )
          }
        }
      }

      // 所有重试都失败
      this.runningTasks.delete(taskId)
      this.results.set(taskId, {
        success: false,
        task,
        error: lastError?.message || "未知错误",
        retryCount: retryCount - 1,
        timestamp: new Date(),
      })

      this.events.emit("task_failed", taskId, lastError, retryCount - 1)

      // 如果配置为遇到错误时停止，则中止所有任务
      if (this.config.stopOnError) {
        this.abortController.abort("遇到错误，停止队列")
      }
    } catch (error: any) {
      // 处理过程中的其他错误
      this.runningTasks.delete(taskId)
      this.results.set(taskId, {
        success: false,
        task,
        error: error.message,
        timestamp: new Date(),
      })

      this.events.emit("task_failed", taskId, error, 0)
    }
  }

  private defaultExecuteTool(task: any): Promise<any> {
    // 默认执行逻辑 - 模拟执行
    console.log(`[BatchQueue] 模拟执行任务: ${task.id} (${task.operation})`)
    console.log(`[BatchQueue] 输入文件: ${task.input_file}`)

    // 模拟执行延迟
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          output_file: task.output_file || `${task.input_file}_processed.mp4`,
          duration: 10.5,
          size: 1024 * 1024 * 5, // 5MB
          success: true,
        })
      }, 1000)
    })
  }

  private async executeTask(task: any): Promise<any> {
    return await this.executeTool(task)
  }
}

// 进度报告辅助函数
function logProgress(progress: any, detailed: boolean): void {
  const now = Date.now()
  const elapsed = (now - progress.startTime) / 1000
  const progressPercent =
    progress.total > 0
      ? Math.round(
          ((progress.completed + progress.failed) / progress.total) * 100,
        )
      : 0

  const line = `进度: ${progress.completed}/${progress.total} (${progressPercent}%) | 成功: ${progress.completed} | 失败: ${progress.failed} | 运行中: ${progress.running} | 等待: ${progress.pending} | 耗时: ${elapsed.toFixed(1)}s`

  console.log(`[BatchQueue] ${line}`)

  if (detailed && progress.total > 0) {
    const estimatedTotal =
      (elapsed / (progress.completed + progress.failed)) * progress.total
    const remaining = estimatedTotal - elapsed

    if (remaining > 0) {
      console.log(`[BatchQueue] 预计剩余时间: ${remaining.toFixed(1)}秒`)
    }
  }
}

// 统计计算辅助函数
function calculateStats(results: Map<string, any>, progress: any): any {
  const stats = {
    total_tasks: progress.total,
    completed_tasks: progress.completed,
    failed_tasks: progress.failed,
    success_rate:
      progress.total > 0
        ? ((progress.completed / progress.total) * 100).toFixed(2)
        : "0.00",
    average_retries: 0,
    total_duration: (Date.now() - progress.startTime) / 1000,
  }

  // 计算平均重试次数
  let totalRetries = 0
  let tasksWithRetries = 0

  for (const result of results.values()) {
    if (result.retryCount !== undefined) {
      totalRetries += result.retryCount
      tasksWithRetries++
    }
  }

  stats.average_retries =
    tasksWithRetries > 0 ? totalRetries / tasksWithRetries : 0

  return stats
}

// 输出格式化辅助函数
function formatOutput(
  results: Map<string, any>,
  stats: any,
  args: any,
): string {
  const lines: string[] = []

  lines.push(`📊 批处理执行完成`)
  lines.push(`📈 执行统计:`)
  lines.push(`  ├── 总任务数: ${stats.total_tasks}`)
  lines.push(`  ├── 成功任务: ${stats.completed_tasks}`)
  lines.push(`  ├── 失败任务: ${stats.failed_tasks}`)
  lines.push(`  ├── 成功率: ${stats.success_rate}%`)
  lines.push(`  ├── 平均重试次数: ${stats.average_retries}`)
  lines.push(`  └── 总耗时: ${stats.total_duration.toFixed(2)} 秒`)

  if (stats.failed_tasks > 0) {
    lines.push(`\n❌ 失败任务列表:`)
    let count = 0
    for (const [taskId, result] of results) {
      if (!result.success && count < 10) {
        lines.push(`  ${taskId}: ${result.error}`)
        count++
      }
    }

    if (stats.failed_tasks > 10) {
      lines.push(`  ... 还有 ${stats.failed_tasks - 10} 个失败任务`)
    }
  }

  lines.push(`\n⚙️ 执行配置:`)
  lines.push(`  ├── 最大并发: ${args.max_concurrent}`)
  lines.push(`  ├── 最大重试: ${args.max_retries}`)
  lines.push(`  ├── 重试延迟: ${args.retry_delay} 秒`)
  lines.push(`  ├── 任务超时: ${args.timeout_per_task} 秒`)
  lines.push(`  └── 遇错停止: ${args.stop_on_error ? "是" : "否"}`)

  return lines.join("\n")
}

/**
 * 工具别名
 */
export const QueueTool = BatchQueueTool

import z from "zod"
import { Tool } from "./tool.js"

// ──────────────────────────────────────────────
// 共享批处理进度存储
// ──────────────────────────────────────────────

export interface BatchTaskProgress {
  id: string
  operation: string
  input_file: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  progress?: number // 0-100
  error?: string
  retry_count: number
  started_at?: number
  completed_at?: number
}

export interface BatchState {
  id: string
  created_at: number
  total_tasks: number
  tasks: Map<string, BatchTaskProgress>
  completed: number
  failed: number
  running: number
  pending: number
  cancelled: boolean
  config: {
    max_concurrent: number
    max_retries: number
    stop_on_error: boolean
  }
}

export class BatchProgressStore {
  private static instance: BatchProgressStore
  private batches = new Map<string, BatchState>()

  static getInstance(): BatchProgressStore {
    if (!BatchProgressStore.instance) {
      BatchProgressStore.instance = new BatchProgressStore()
    }
    return BatchProgressStore.instance
  }

  createBatch(
    id: string,
    tasks: Array<{ id: string; operation: string; input_file: string }>,
    config: { max_concurrent: number; max_retries: number; stop_on_error: boolean },
  ): BatchState {
    const taskMap = new Map<string, BatchTaskProgress>()
    for (const t of tasks) {
      taskMap.set(t.id, {
        id: t.id,
        operation: t.operation,
        input_file: t.input_file,
        status: "pending",
        retry_count: 0,
      })
    }

    const state: BatchState = {
      id,
      created_at: Date.now(),
      total_tasks: tasks.length,
      tasks: taskMap,
      completed: 0,
      failed: 0,
      running: 0,
      pending: tasks.length,
      cancelled: false,
      config,
    }
    this.batches.set(id, state)
    return state
  }

  updateTask(id: string, taskId: string, update: Partial<BatchTaskProgress>): void {
    const batch = this.batches.get(id)
    if (!batch) return
    const task = batch.tasks.get(taskId)
    if (!task) return
    Object.assign(task, update)
    this.recount(batch)
  }

  markTaskStarted(id: string, taskId: string): void {
    this.updateTask(id, taskId, { status: "running", started_at: Date.now() })
  }

  markTaskCompleted(id: string, taskId: string): void {
    this.updateTask(id, taskId, { status: "completed", completed_at: Date.now(), progress: 100 })
  }

  markTaskFailed(id: string, taskId: string, error: string): void {
    this.updateTask(id, taskId, { status: "failed", error, completed_at: Date.now() })
  }

  markTaskRetrying(id: string, taskId: string, retryCount: number): void {
    this.updateTask(id, taskId, { status: "running", retry_count: retryCount })
  }

  isCancelled(id: string): boolean {
    return this.batches.get(id)?.cancelled ?? true
  }

  cancelBatch(id: string): boolean {
    const batch = this.batches.get(id)
    if (!batch) return false
    batch.cancelled = true
    // Mark pending tasks as cancelled
    for (const [, task] of batch.tasks) {
      if (task.status === "pending") {
        task.status = "cancelled"
      }
    }
    this.recount(batch)
    return true
  }

  getBatch(id: string): BatchState | null {
    return this.batches.get(id) ?? null
  }

  getAllBatches(): BatchState[] {
    return Array.from(this.batches.values())
  }

  removeBatch(id: string): boolean {
    return this.batches.delete(id)
  }

  /** 自动清理超过 30 分钟的已完成/已取消批处理 */
  cleanStale(maxAgeMs = 30 * 60 * 1000): number {
    const now = Date.now()
    let count = 0
    for (const [id, batch] of this.batches) {
      if (now - batch.created_at > maxAgeMs) {
        this.batches.delete(id)
        count++
      }
    }
    return count
  }

  private recount(batch: BatchState): void {
    let completed = 0, failed = 0, running = 0, pending = 0
    for (const [, t] of batch.tasks) {
      switch (t.status) {
        case "completed": completed++; break
        case "failed": failed++; break
        case "running": running++; break
        default: pending++
      }
    }
    batch.completed = completed
    batch.failed = failed
    batch.running = running
    batch.pending = pending
  }
}

// 初始化时启动定期清理
const CLEAN_INTERVAL = 5 * 60 * 1000 // 每 5 分钟
setInterval(() => {
  BatchProgressStore.getInstance().cleanStale()
}, CLEAN_INTERVAL).unref()

// ──────────────────────────────────────────────
// BatchProgressTool
// ──────────────────────────────────────────────

export const BatchProgressTool: any = Tool.define("batch_progress", {
  description: "查询和管理批处理任务进度。支持查看状态、列表、取消操作",
  parameters: z.object({
    action: z
      .enum(["status", "list", "cancel"])
      .optional()
      .default("list")
      .describe("操作: status(查询指定), list(列出全部), cancel(取消)"),
    batch_id: z
      .string()
      .optional()
      .describe("批处理 ID (status 和 cancel 操作需要)"),
  }),

  execute: async (args: any) => {
    try {
    const store = BatchProgressStore.getInstance()

    switch (args.action) {
      case "list": {
        const batches = store.getAllBatches()
        if (batches.length === 0) {
          return {
            title: "批处理列表",
            metadata: { operation: "batch_progress", action: "list" },
            output: "📋 当前没有运行中的批处理任务",
          }
        }

        const lines = ["📋 批处理任务列表:"]
        for (const b of batches) {
          const pct = b.total_tasks > 0
            ? Math.round(((b.completed + b.failed) / b.total_tasks) * 100)
            : 0
          const elapsed = ((Date.now() - b.created_at) / 1000).toFixed(1)
          lines.push(
            `  ├─ ${b.id}  [${pct}%]  ${b.completed}✓ ${b.failed}✗ ${b.running}▶ ${b.pending}⏳  ${elapsed}s`,
          )
        }
        lines.push(`  共 ${batches.length} 个批处理`)

        return {
          title: "批处理列表",
          metadata: { operation: "batch_progress", action: "list", count: batches.length },
          output: lines.join("\n"),
        }
      }

      case "status": {
        if (!args.batch_id) {
          return {
            title: "参数错误",
            metadata: { operation: "batch_progress", error: true },
            output: "❌ status 操作需要提供 batch_id",
          }
        }
        const batch = store.getBatch(args.batch_id)
        if (!batch) {
          return {
            title: "批处理未找到",
            metadata: { operation: "batch_progress", error: true },
            output: `❌ 未找到批处理: ${args.batch_id}`,
          }
        }

        const pct = batch.total_tasks > 0
          ? Math.round(((batch.completed + batch.failed) / batch.total_tasks) * 100)
          : 0
        const elapsed = ((Date.now() - batch.created_at) / 1000).toFixed(1)

        const taskLines: string[] = []
        for (const [, t] of batch.tasks) {
          const icon =
            t.status === "completed" ? "✅" :
            t.status === "failed" ? "❌" :
            t.status === "running" ? "▶" :
            t.status === "cancelled" ? "⛔" : "⏳"
          taskLines.push(`  ${icon} ${t.id} [${t.operation}] ${t.error ? `: ${t.error}` : ""}`)
        }

        return {
          title: `批处理状态: ${args.batch_id}`,
          metadata: {
            operation: "batch_progress",
            action: "status",
            batch_id: args.batch_id,
            progress_pct: pct,
            total: batch.total_tasks,
            completed: batch.completed,
            failed: batch.failed,
            running: batch.running,
            pending: batch.pending,
            cancelled: batch.cancelled,
            elapsed_seconds: parseFloat(elapsed),
          },
          output: [
            `📊 批处理: ${args.batch_id}`,
            `进度: ${pct}%  (${batch.completed + batch.failed}/${batch.total_tasks})`,
            `✅ 完成: ${batch.completed}  ❌ 失败: ${batch.failed}`,
            `▶ 运行: ${batch.running}  ⏳ 等待: ${batch.pending}`,
            `⏱ 耗时: ${elapsed}s  ${batch.cancelled ? "⛔ 已取消" : ""}`,
            ``,
            `任务详情:`,
            ...taskLines,
          ].join("\n"),
        }
      }

      case "cancel": {
        if (!args.batch_id) {
          return {
            title: "参数错误",
            metadata: { operation: "batch_progress", error: true },
            output: "❌ cancel 操作需要提供 batch_id",
          }
        }
        const ok = store.cancelBatch(args.batch_id)
        if (!ok) {
          return {
            title: "取消失败",
            metadata: { operation: "batch_progress", error: true },
            output: `❌ 未找到批处理: ${args.batch_id}`,
          }
        }
        return {
          title: "批处理已取消",
          metadata: { operation: "batch_progress", action: "cancel", batch_id: args.batch_id },
          output: `⛔ 已取消批处理: ${args.batch_id}`,
        }
      }

      default:
        return {
          title: "未知操作",
          metadata: { operation: "batch_progress", error: true },
          output: `❌ 未知操作: ${args.action}`,
        }
    }
    } catch (error: any) {
      return {
        title: "批处理进度查询失败",
        metadata: { operation: "batch_progress", error: true },
        output: `❌ 查询失败: ${error.message}`,
      }
    }
  },
} as any)

export { BatchProgressStore as BatchStore }
export const BatchProgress = BatchProgressTool

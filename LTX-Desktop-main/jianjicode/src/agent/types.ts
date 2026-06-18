import type { Tool } from "../tool/tool.js"

/**
 * 视频编辑任务接口
 */
export interface VideoTask {
  /** 任务ID */
  id: string
  /** 任务描述/用户指令 */
  description: string
  /** 输入文件路径列表 */
  inputFiles: string[]
  /** 输出文件路径（可选） */
  outputFile?: string
  /** 任务参数 */
  parameters: Record<string, any>
  /** 任务类型 */
  type:
    | "trim"
    | "concat"
    | "convert"
    | "filter"
    | "subtitle"
    | "watermark"
    | "transition"
    | "pip"
    | "batch"
    | "complex"
    | "extract_audio"
    | "merge_audio"
    | "get_info"
    | "basketball_shot_edit"
  /** 任务优先级 (1-10, 越高越优先) */
  priority: number
  /** 任务创建时间 */
  createdAt: Date
  /** 任务依赖的其他任务ID */
  dependencies?: string[]
}

/**
 * 执行计划接口
 */
export interface ExecutionPlan {
  /** 计划ID */
  id: string
  /** 关联的任务ID */
  taskId: string
  /** 计划步骤列表 */
  steps: ExecutionStep[]
  /** 预估执行时间（秒） */
  estimatedDuration: number
  /** 预估输出文件大小（字节） */
  estimatedOutputSize: number
  /** 需要的工具列表 */
  requiredTools: string[]
  /** 是否有危险操作 */
  hasDangerousOperations: boolean
}

/**
 * 执行步骤接口
 */
export interface ExecutionStep {
  /** 步骤ID */
  id: string
  /** 步骤序号 */
  sequence: number
  /** 工具ID */
  toolId: string
  /** 工具参数 */
  parameters: Record<string, any>
  /** 输入文件路径 */
  inputFiles: string[]
  /** 输出文件路径 */
  outputFile: string
  /** 步骤描述 */
  description: string
  /** 是否为中间步骤 */
  isIntermediate: boolean
  /** 依赖的步骤ID列表 */
  dependencies?: string[]
}

/**
 * 执行结果接口
 */
export interface ExecutionResult {
  /** 结果ID */
  id: string
  /** 关联的任务ID */
  taskId: string
  /** 执行是否成功 */
  success: boolean
  /** 输出文件路径列表 */
  outputFiles: string[]
  /** 执行日志 */
  logs: ExecutionLog[]
  /** 执行开始时间 */
  startedAt: Date
  /** 执行结束时间 */
  finishedAt: Date
  /** 总耗时（毫秒） */
  duration: number
  /** 错误信息（如果有） */
  error?: {
    message: string
    code: string
    details?: any
  }
  /** 性能指标 */
  performance?: {
    cpuUsage: number
    memoryUsage: number
    diskUsage: number
  }
}

/**
 * 执行日志接口
 */
export interface ExecutionLog {
  /** 时间戳 */
  timestamp: Date
  /** 日志级别 */
  level: "info" | "warn" | "error" | "debug"
  /** 日志消息 */
  message: string
  /** 相关步骤ID */
  stepId?: string
  /** 相关工具ID */
  toolId?: string
  /** 额外数据 */
  data?: any
}

/**
 * 视频代理接口
 */
export interface VideoAgent {
  /** 代理ID */
  id: string
  /** 代理名称 */
  name: string
  /** 代理描述 */
  description: string
  /** 支持的操作类型列表 */
  capabilities: string[]
  /** 可访问的工具ID列表 */
  tools: string[]
  /** 最大并发任务数 */
  maxConcurrentTasks: number
  /** 是否为默认代理 */
  isDefault: boolean

  /**
   * 判断代理是否能处理指定任务
   * @param task 视频编辑任务
   * @returns 是否能处理
   */
  canHandle(task: VideoTask): boolean

  /**
   * 为任务制定执行计划
   * @param task 视频编辑任务
   * @returns 执行计划
   */
  planExecution(task: VideoTask): ExecutionPlan

  /**
   * 执行计划
   * @param plan 执行计划
   * @returns 执行结果
   */
  execute(plan: ExecutionPlan): Promise<ExecutionResult>

  /**
   * 获取代理状态
   */
  getStatus(): AgentStatus
}

/**
 * 代理状态接口
 */
export interface AgentStatus {
  /** 代理ID */
  agentId: string
  /** 是否就绪 */
  isReady: boolean
  /** 当前任务数 */
  currentTasks: number
  /** 排队任务数 */
  queuedTasks: number
  /** 总完成任务数 */
  totalCompletedTasks: number
  /** 平均执行时间（毫秒） */
  averageExecutionTime: number
  /** 成功率 */
  successRate: number
  /** 上次活动时间 */
  lastActivity: Date
}

/**
 * 代理配置接口
 */
export interface AgentConfig {
  /** 代理ID */
  id: string
  /** 是否启用 */
  enabled: boolean
  /** 优先级 (1-10, 越高越优先) */
  priority: number
  /** 工具权限映射 */
  toolPermissions: Record<
    string,
    {
      /** 是否允许使用 */
      allowed: boolean
      /** 是否需要确认 */
      confirmRequired?: boolean
      /** 使用限制条件 */
      constraints?: {
        maxFileSize?: number
        allowedFormats?: string[]
        disallowedOperations?: string[]
      }
    }
  >
  /** 文件系统访问控制 */
  fileAccessControl: {
    allowedDirectories: string[]
    disallowedDirectories: string[]
    allowNetworkAccess: boolean
  }
}

/**
 * 代理工厂函数类型
 */
export type AgentFactory = (config?: Partial<AgentConfig>) => VideoAgent

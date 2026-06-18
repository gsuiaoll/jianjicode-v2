// 导入类型

// 导入基类和具体代理
import { BaseVideoAgent } from "./base_agent.js"
import { permissionManager } from "./permission_manager.js"
// 导入注册中心和权限管理器
import { AgentRegistry, agentRegistry } from "./registry.js"
import type {
  AgentConfig,
  AgentFactory,
  AgentStatus,
  ExecutionLog,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  VideoAgent,
  VideoTask,
} from "./types.js"
import { VideoBatchAgent } from "./video_batch.js"
import { VideoEditorAgent } from "./video_editor.js"
import { VideoQuickAgent } from "./video_quick.js"

// 重新导出类型
export type {
  AgentConfig,
  AgentFactory,
  AgentStatus,
  ExecutionLog,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  VideoAgent,
  VideoTask,
}
// 重新导出基类
// 重新导出具体代理
// 重新导出注册中心
export {
  AgentRegistry,
  agentRegistry,
  BaseVideoAgent,
  VideoBatchAgent,
  VideoEditorAgent,
  VideoQuickAgent,
}

/**
 * 初始化所有代理并注册到全局注册中心
 */
export async function initializeAgents(): Promise<void> {
  console.log("[AgentSystem] 开始初始化视频编辑代理系统...")

  try {
    // 创建代理实例
    const videoEditorAgent = new VideoEditorAgent()
    const videoQuickAgent = new VideoQuickAgent()
    const videoBatchAgent = new VideoBatchAgent()

    // 配置代理
    const editorConfig: Partial<AgentConfig> = {
      id: videoEditorAgent.id,
      enabled: true,
      priority: 10, // 最高优先级
      toolPermissions: {
        "*": { allowed: true, confirmRequired: true },
      },
      fileAccessControl: {
        allowedDirectories: ["*"],
        disallowedDirectories: ["/etc", "/var", "/system"],
        allowNetworkAccess: false,
      },
    }

    const quickConfig: Partial<AgentConfig> = {
      id: videoQuickAgent.id,
      enabled: true,
      priority: 5,
      toolPermissions: {
        ffmpeg: { allowed: true, confirmRequired: false },
        "*": { allowed: false },
      },
      fileAccessControl: {
        allowedDirectories: ["~/Videos", "~/Downloads", "./"],
        disallowedDirectories: [],
        allowNetworkAccess: false,
      },
    }

    const batchConfig: Partial<AgentConfig> = {
      id: videoBatchAgent.id,
      enabled: true,
      priority: 8,
      toolPermissions: {
        batch_scanner: { allowed: true },
        batch_queue: { allowed: true },
        batch_report: { allowed: true },
        ffmpeg: { allowed: true },
        video_filter: { allowed: true },
        video_subtitle: { allowed: true },
        video_watermark: { allowed: true },
      },
      fileAccessControl: {
        allowedDirectories: ["*"],
        disallowedDirectories: ["/etc", "/var", "/system"],
        allowNetworkAccess: false,
      },
    }

    // 注册代理
    agentRegistry.register(videoEditorAgent, editorConfig)
    agentRegistry.register(videoQuickAgent, quickConfig)
    agentRegistry.register(videoBatchAgent, batchConfig)

    // 设置默认代理
    agentRegistry.setDefaultAgent(videoEditorAgent.id)

    console.log(
      `[AgentSystem] 代理初始化完成，共注册 ${agentRegistry.getAllAgents().length} 个代理`,
    )
    console.log(
      `[AgentSystem] 默认代理: ${agentRegistry.getDefaultAgent()?.name}`,
    )

    // 打印代理状态
    const agents = agentRegistry.getAllAgents()
    for (const agent of agents) {
      const config = agentRegistry.getAgentConfig(agent.id)
      console.log(`  - ${agent.name} (${agent.id}): ${agent.description}`)
      console.log(`    能力: ${agent.capabilities.join(", ")}`)
      console.log(`    工具: ${agent.tools.join(", ")}`)
      console.log(
        `    状态: ${config?.enabled ? "已启用" : "已禁用"}, 优先级: ${config?.priority}`,
      )
    }
  } catch (error: any) {
    console.error(`[AgentSystem] 代理初始化失败:`, error)
    throw error
  }
}

/**
 * 根据用户指令创建视频任务
 * @param userInstruction 用户指令
 * @param parameters 任务参数
 * @returns 视频任务
 */
export function createVideoTask(
  userInstruction: string,
  parameters: Record<string, any>,
): VideoTask {
  // 分析指令，确定任务类型
  const taskType = analyzeTaskType(userInstruction, parameters)

  // 生成任务ID
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // 提取输入文件
  let inputFiles = extractInputFiles(parameters)
  // 如果从参数中没有提取到文件，尝试从指令中提取
  if (inputFiles.length === 0) {
    inputFiles = extractFilesFromInstruction(userInstruction)
  }

  // 确定优先级
  const priority = determineTaskPriority(taskType, parameters)

  const task: VideoTask = {
    id: taskId,
    description: userInstruction,
    inputFiles,
    outputFile: parameters.output_file || parameters.output,
    parameters,
    type: taskType,
    priority,
    createdAt: new Date(),
  }

  return task
}

/**
 * 分析任务类型
 */
function analyzeTaskType(
  userInstruction: string,
  parameters: Record<string, any>,
): VideoTask["type"] {
  const instruction = userInstruction.toLowerCase()

  // 检查批量处理关键词
  if (
    instruction.includes("batch") ||
    instruction.includes("multiple") ||
    instruction.includes("folder") ||
    instruction.includes("directory") ||
    parameters.directory
  ) {
    return "batch"
  }

  // 检查复杂任务关键词
  if (
    instruction.includes("and then") ||
    instruction.includes("then") ||
    instruction.includes("after that") ||
    (instruction.includes("first") && instruction.includes("then"))
  ) {
    return "complex"
  }

  // 检查音频相关操作 (必须在concat之前检查)
  if (
    instruction.includes("extract audio") ||
    instruction.includes("get audio")
  ) {
    return "extract_audio"
  }
  if (
    instruction.includes("merge audio") ||
    instruction.includes("add audio") ||
    instruction.includes("combine audio")
  ) {
    return "merge_audio"
  }
  if (instruction.includes("info") || instruction.includes("metadata")) {
    return "get_info"
  }

  // 检查篮球投篮编辑关键词
  if (
    instruction.includes("basketball") ||
    instruction.includes("shot") ||
    instruction.includes("missed") ||
    instruction.includes("makes")
  ) {
    return "basketball_shot_edit"
  }

  // 检查具体操作类型
  if (instruction.includes("trim") || instruction.includes("cut")) {
    return "trim"
  }
  if (
    instruction.includes("concat") ||
    (instruction.includes("merge") && !instruction.includes("audio")) ||
    instruction.includes("join")
  ) {
    return "concat"
  }
  if (instruction.includes("convert") || instruction.includes("transcode")) {
    return "convert"
  }
  if (
    instruction.includes("filter") ||
    instruction.includes("brightness") ||
    instruction.includes("contrast") ||
    instruction.includes("color")
  ) {
    return "filter"
  }
  if (instruction.includes("subtitle") || instruction.includes("caption")) {
    return "subtitle"
  }
  if (instruction.includes("watermark") || instruction.includes("logo")) {
    return "watermark"
  }
  if (instruction.includes("transition") || instruction.includes("fade")) {
    return "transition"
  }
  if (
    instruction.includes("pip") ||
    instruction.includes("picture in picture")
  ) {
    return "pip"
  }

  // 默认返回基础类型，让代理进一步分析
  return "trim"
}

/**
 * 提取输入文件
 */
function extractInputFiles(parameters: Record<string, any>): string[] {
  const inputFiles: string[] = []

  // 检查常见参数名
  const inputKeys = [
    "input_file",
    "input_files",
    "input",
    "video_file",
    "main_video",
    "pip_video",
    "input1",
    "input2",
  ]

  for (const key of inputKeys) {
    if (parameters[key]) {
      if (Array.isArray(parameters[key])) {
        inputFiles.push(...parameters[key])
      } else if (typeof parameters[key] === "string") {
        // 处理逗号分隔的文件列表
        const files = parameters[key].split(",").map((f: string) => f.trim())
        inputFiles.push(...files)
      }
    }
  }

  // 如果没有找到，尝试从其他参数推断
  if (inputFiles.length === 0) {
    for (const [key, value] of Object.entries(parameters)) {
      if (
        typeof value === "string" &&
        (value.endsWith(".mp4") ||
          value.endsWith(".mov") ||
          value.endsWith(".avi") ||
          value.endsWith(".mkv") ||
          value.endsWith(".webm"))
      ) {
        inputFiles.push(value)
      }
    }
  }

  return [...new Set(inputFiles)] // 去重
}

/**
 * 确定任务优先级
 */
function determineTaskPriority(
  taskType: VideoTask["type"],
  parameters: Record<string, any>,
): number {
  // 默认优先级
  let priority = 5

  // 根据任务类型调整
  const typePriority: Record<VideoTask["type"], number> = {
    trim: 3,
    convert: 4,
    concat: 5,
    filter: 6,
    subtitle: 6,
    watermark: 6,
    transition: 7,
    pip: 7,
    batch: 8,
    complex: 9,
    extract_audio: 3,
    merge_audio: 4,
    get_info: 1,
    basketball_shot_edit: 5,
  }

  priority = typePriority[taskType] || priority

  // 根据紧急程度调整
  if (parameters.priority) {
    priority = Math.max(1, Math.min(10, parameters.priority))
  }

  // 根据文件大小调整（大文件优先级较低）
  if (parameters.estimated_size) {
    const sizeInMB = parameters.estimated_size / (1024 * 1024)
    if (sizeInMB > 1000) {
      // 大于1GB
      priority = Math.max(1, priority - 2)
    }
  }

  return priority
}

function extractFilesFromInstruction(instruction: string): string[] {
  const files: string[] = []
  // 匹配视频文件
  const videoMatches = instruction.matchAll(
    /([^\s]+\.(mp4|avi|mov|mkv|flv|wmv|webm))/gi,
  )
  for (const match of videoMatches) {
    files.push(match[0])
  }
  // 匹配音频文件
  const audioMatches = instruction.matchAll(
    /([^\s]+\.(mp3|wav|aac|flac|ogg|m4a))/gi,
  )
  for (const match of audioMatches) {
    files.push(match[0])
  }
  // 匹配JSON文件 (用于篮球投篮检测结果)
  const jsonMatches = instruction.matchAll(/([^\s]+\.json)/gi)
  for (const match of jsonMatches) {
    files.push(match[0])
  }
  return [...new Set(files)]
}

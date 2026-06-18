import { permissionManager } from "./permission_manager.js"
import type { AgentConfig, VideoAgent, VideoTask } from "./types.js"

/**
 * 代理注册中心 - 管理所有视频编辑代理
 */
export class AgentRegistry {
  private agents = new Map<string, VideoAgent>()
  private agentConfigs = new Map<string, AgentConfig>()
  private defaultAgentId: string | null = null

  /**
   * 注册代理
   * @param agent 视频代理
   * @param config 代理配置（可选）
   */
  register(agent: VideoAgent, config?: Partial<AgentConfig>): void {
    const agentId = agent.id

    // 合并配置
    const defaultConfig: AgentConfig = {
      id: agentId,
      enabled: true,
      priority: 5,
      toolPermissions: {},
      fileAccessControl: {
        allowedDirectories: [],
        disallowedDirectories: [],
        allowNetworkAccess: false,
      },
    }

    const finalConfig: AgentConfig = { ...defaultConfig, ...config }

    // 验证配置
    const validationErrors = permissionManager.validateAgentConfig(finalConfig)
    if (validationErrors.length > 0) {
      console.warn(
        `[AgentRegistry] 代理配置验证警告: ${validationErrors.join("; ")}`,
      )
    }

    this.agents.set(agentId, agent)
    this.agentConfigs.set(agentId, finalConfig)

    // 注册到权限管理器
    permissionManager.registerAgentConfig(agentId, finalConfig)

    // 如果这是第一个代理或代理设置为默认，则设置为默认代理
    if (this.defaultAgentId === null || agent.isDefault) {
      this.defaultAgentId = agentId
    }

    console.log(`[AgentRegistry] 已注册代理: ${agent.name} (${agentId})`)
  }

  /**
   * 根据任务选择最合适的代理
   * @param task 视频编辑任务
   * @returns 最合适的代理，如果没有则返回null
   */
  selectAgent(task: VideoTask): VideoAgent | null {
    const availableAgents: Array<{ agent: VideoAgent; score: number }> = []

    // 遍历所有已启用代理
    for (const [agentId, agent] of this.agents.entries()) {
      const config = this.agentConfigs.get(agentId)
      if (!config || !config.enabled) continue

      // 检查代理是否能处理该任务
      if (agent.canHandle(task)) {
        // 计算匹配分数
        const score = this.calculateAgentScore(agent, config, task)
        availableAgents.push({ agent, score })
      }
    }

    if (availableAgents.length === 0) {
      return null
    }

    // 按分数降序排序
    availableAgents.sort((a, b) => b.score - a.score)
    return availableAgents[0].agent
  }

  /**
   * 计算代理匹配分数
   * @param agent 视频代理
   * @param config 代理配置
   * @param task 视频编辑任务
   * @returns 匹配分数 (0-100)
   */
  private calculateAgentScore(
    agent: VideoAgent,
    config: AgentConfig,
    task: VideoTask,
  ): number {
    let score = 0

    // 基础分数: 代理优先级
    score += config.priority * 2

    // 能力匹配度: 代理支持的任务类型
    const capabilityMatch = agent.capabilities.includes(task.type) ? 20 : 0
    score += capabilityMatch

    // 工具覆盖度: 任务需要的工具代理是否都有
    // 这里简化处理，实际需要分析任务需要的工具
    const toolCoverage = 10 // 默认值，实际需要计算
    score += toolCoverage

    // 复杂度匹配: 简单任务给快速代理更高分，复杂任务给全功能代理更高分
    if (task.type === "complex" && agent.id.includes("editor")) {
      score += 15
    } else if (task.type !== "complex" && agent.id.includes("quick")) {
      score += 10
    }

    // 批量任务匹配
    if (task.type === "batch" && agent.id.includes("batch")) {
      score += 20
    }

    // 历史成功率加成 (如果有历史数据)
    // 这里简化，实际可以从代理状态获取

    return Math.min(100, Math.max(0, score))
  }

  /**
   * 获取指定代理
   * @param agentId 代理ID
   * @returns 代理实例，如果不存在则返回undefined
   */
  getAgent(agentId: string): VideoAgent | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 获取默认代理
   * @returns 默认代理，如果未设置则返回第一个代理
   */
  getDefaultAgent(): VideoAgent | undefined {
    if (this.defaultAgentId) {
      return this.agents.get(this.defaultAgentId)
    }

    // 返回第一个代理
    const firstAgent = this.agents.values().next()
    return firstAgent.value
  }

  /**
   * 获取所有代理
   * @returns 代理列表
   */
  getAllAgents(): VideoAgent[] {
    return Array.from(this.agents.values())
  }

  /**
   * 获取所有已启用代理
   * @returns 已启用代理列表
   */
  getEnabledAgents(): VideoAgent[] {
    return this.getAllAgents().filter((agent) => {
      const config = this.agentConfigs.get(agent.id)
      return config && config.enabled
    })
  }

  /**
   * 获取代理配置
   * @param agentId 代理ID
   * @returns 代理配置，如果不存在则返回undefined
   */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId)
  }

  /**
   * 更新代理配置
   * @param agentId 代理ID
   * @param config 新的配置（部分更新）
   */
  updateAgentConfig(agentId: string, config: Partial<AgentConfig>): void {
    const existingConfig = this.agentConfigs.get(agentId)
    if (!existingConfig) {
      throw new Error(`Agent ${agentId} not found`)
    }

    const newConfig: AgentConfig = { ...existingConfig, ...config, id: agentId }

    // 验证配置
    const validationErrors = permissionManager.validateAgentConfig(newConfig)
    if (validationErrors.length > 0) {
      console.warn(
        `[AgentRegistry] 代理配置更新验证警告: ${validationErrors.join("; ")}`,
      )
    }

    this.agentConfigs.set(agentId, newConfig)

    // 更新权限管理器中的配置
    permissionManager.registerAgentConfig(agentId, newConfig)

    console.log(`[AgentRegistry] 已更新代理配置: ${agentId}`)
  }

  /**
   * 启用/禁用代理
   * @param agentId 代理ID
   * @param enabled 是否启用
   */
  setAgentEnabled(agentId: string, enabled: boolean): void {
    this.updateAgentConfig(agentId, { enabled })
  }

  /**
   * 设置默认代理
   * @param agentId 代理ID
   */
  setDefaultAgent(agentId: string): void {
    if (!this.agents.has(agentId)) {
      throw new Error(`Agent ${agentId} not found`)
    }
    this.defaultAgentId = agentId
    console.log(`[AgentRegistry] 已设置默认代理: ${agentId}`)
  }

  /**
   * 检查代理是否存在
   * @param agentId 代理ID
   * @returns 是否存在
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId)
  }

  /**
   * 获取所有代理状态
   * @returns 代理状态映射
   */
  getAllAgentStatuses(): Record<string, any> {
    const statuses: Record<string, any> = {}

    for (const [agentId, agent] of this.agents.entries()) {
      const config = this.agentConfigs.get(agentId)
      const status = agent.getStatus()
      statuses[agentId] = {
        ...status,
        config: {
          enabled: config?.enabled,
          priority: config?.priority,
        },
      }
    }

    return statuses
  }

  /**
   * 清空所有代理
   */
  clear(): void {
    this.agents.clear()
    this.agentConfigs.clear()
    this.defaultAgentId = null
    console.log(`[AgentRegistry] 已清空所有代理`)
  }
}

/**
 * 全局代理注册中心实例
 */
export const agentRegistry = new AgentRegistry()

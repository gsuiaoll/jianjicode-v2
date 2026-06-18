import type { AgentConfig } from "./types.js"

/**
 * 权限管理器
 * 管理代理对工具和文件系统的访问权限
 */
export class PermissionManager {
  private agentConfigs: Map<string, AgentConfig> = new Map()

  /**
   * 注册代理配置
   */
  registerAgentConfig(agentId: string, config: AgentConfig): void {
    this.agentConfigs.set(agentId, config)
  }

  /**
   * 获取代理配置
   */
  getAgentConfig(agentId: string): AgentConfig | undefined {
    return this.agentConfigs.get(agentId)
  }

  /**
   * 检查代理是否有权限使用工具
   * @param agentId 代理ID
   * @param toolId 工具ID
   * @param operation 操作类型（可选）
   * @returns 是否允许使用工具
   */
  canUseTool(agentId: string, toolId: string, operation?: string): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      console.warn(`权限检查: 代理 ${agentId} 的配置未找到`)
      return false
    }

    // 检查工具权限
    const toolPermission =
      config.toolPermissions[toolId] || config.toolPermissions["*"]
    if (!toolPermission) {
      console.warn(`权限检查: 代理 ${agentId} 没有工具 ${toolId} 的权限配置`)
      return false
    }

    if (!toolPermission.allowed) {
      console.warn(`权限检查: 代理 ${agentId} 不允许使用工具 ${toolId}`)
      return false
    }

    // 检查操作约束
    if (toolPermission.constraints && operation) {
      const constraints = toolPermission.constraints

      // 检查不允许的操作
      if (
        constraints.disallowedOperations &&
        constraints.disallowedOperations.includes(operation)
      ) {
        console.warn(
          `权限检查: 代理 ${agentId} 不允许在工具 ${toolId} 上执行操作 ${operation}`,
        )
        return false
      }
    }

    return true
  }

  /**
   * 检查工具使用是否需要确认
   */
  requiresToolConfirmation(agentId: string, toolId: string): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      return true // 安全默认值
    }

    const toolPermission =
      config.toolPermissions[toolId] || config.toolPermissions["*"]
    return toolPermission?.confirmRequired ?? true
  }

  /**
   * 检查代理是否有权限访问文件/目录
   * @param agentId 代理ID
   * @param filePath 文件路径
   * @returns 是否允许访问
   */
  canAccessFile(agentId: string, filePath: string): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      console.warn(`文件访问检查: 代理 ${agentId} 的配置未找到`)
      return false
    }

    const accessControl = config.fileAccessControl

    // 检查不允许的目录
    for (const disallowedDir of accessControl.disallowedDirectories) {
      if (this.pathMatchesPattern(filePath, disallowedDir)) {
        console.warn(
          `文件访问检查: 代理 ${agentId} 不允许访问目录 ${disallowedDir} (路径: ${filePath})`,
        )
        return false
      }
    }

    // 检查允许的目录
    if (
      accessControl.allowedDirectories.length > 0 &&
      accessControl.allowedDirectories[0] !== "*"
    ) {
      let allowed = false
      for (const allowedDir of accessControl.allowedDirectories) {
        if (this.pathMatchesPattern(filePath, allowedDir)) {
          allowed = true
          break
        }
      }

      if (!allowed) {
        console.warn(`文件访问检查: 代理 ${agentId} 不允许访问路径 ${filePath}`)
        return false
      }
    }

    return true
  }

  /**
   * 检查代理是否允许网络访问
   */
  canAccessNetwork(agentId: string): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      return false // 安全默认值
    }

    return config.fileAccessControl.allowNetworkAccess
  }

  /**
   * 检查文件大小是否在限制范围内
   */
  isFileSizeAllowed(
    agentId: string,
    toolId: string,
    fileSize: number,
  ): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      return false
    }

    const toolPermission =
      config.toolPermissions[toolId] || config.toolPermissions["*"]
    if (!toolPermission?.constraints?.maxFileSize) {
      return true // 没有大小限制
    }

    return fileSize <= toolPermission.constraints.maxFileSize
  }

  /**
   * 检查文件格式是否允许
   */
  isFileFormatAllowed(
    agentId: string,
    toolId: string,
    fileFormat: string,
  ): boolean {
    const config = this.agentConfigs.get(agentId)
    if (!config) {
      return false
    }

    const toolPermission =
      config.toolPermissions[toolId] || config.toolPermissions["*"]
    if (!toolPermission?.constraints?.allowedFormats) {
      return true // 没有格式限制
    }

    return toolPermission.constraints.allowedFormats.includes(
      fileFormat.toLowerCase(),
    )
  }

  /**
   * 路径是否匹配模式
   * @private
   */
  private pathMatchesPattern(path: string, pattern: string): boolean {
    // 简单的模式匹配
    if (pattern === "*") {
      return true
    }

    // 处理 ~/ 开头的路径
    if (pattern.startsWith("~/")) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || ""
      if (homeDir) {
        const fullPattern = pattern.replace("~", homeDir)
        return path.startsWith(fullPattern)
      }
    }

    // 处理相对路径
    if (!pattern.startsWith("/") && !pattern.includes(":")) {
      // 不是绝对路径
      const currentDir = process.cwd()
      const fullPattern = `${currentDir}/${pattern}`
      return path.startsWith(fullPattern)
    }

    // 简单的开头匹配
    return path.startsWith(pattern)
  }

  /**
   * 记录权限检查日志
   */
  logPermissionCheck(
    agentId: string,
    resourceType: "tool" | "file" | "network",
    resourceId: string,
    allowed: boolean,
    reason?: string,
  ): void {
    const timestamp = new Date().toISOString()
    const status = allowed ? "ALLOWED" : "DENIED"
    const reasonText = reason ? ` (${reason})` : ""

    console.log(
      `[${timestamp}] PERMISSION ${status}: agent=${agentId}, ${resourceType}=${resourceId}${reasonText}`,
    )
  }

  /**
   * 验证代理配置
   */
  validateAgentConfig(config: AgentConfig): string[] {
    const errors: string[] = []

    // 检查优先级范围
    if (config.priority < 1 || config.priority > 10) {
      errors.push(`优先级必须在1-10之间，当前值: ${config.priority}`)
    }

    // 检查工具权限配置
    for (const [toolId, permission] of Object.entries(config.toolPermissions)) {
      if (!permission.allowed && permission.confirmRequired) {
        errors.push(`工具 ${toolId}: 不允许使用的工具不应要求确认`)
      }
    }

    // 检查文件访问控制
    const accessControl = config.fileAccessControl
    if (
      accessControl.allowedDirectories.length === 0 &&
      accessControl.disallowedDirectories.length === 0
    ) {
      errors.push("文件访问控制必须至少配置允许或不允许的目录")
    }

    return errors
  }
}

// 创建全局权限管理器实例
export const permissionManager = new PermissionManager()

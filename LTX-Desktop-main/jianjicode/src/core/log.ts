/**
 * 结构化日志模块
 *
 * 提供 Log.create() 工厂方法创建带 service 标签的日志实例。
 * 当前实现输出到 stderr（JSON 行），便于 Electron 解析。
 */

interface LogEntry {
  service: string
  level: "info" | "warn" | "error"
  message: string
  data?: Record<string, unknown>
  timestamp: string
}

class Log {
  private service: string

  private constructor(service: string) {
    this.service = service
  }

  static create(opts: { service: string }): Log {
    return new Log(opts.service)
  }

  private write(
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      service: this.service,
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    }
    process.stderr.write(JSON.stringify(entry) + "\n")
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write("info", message, data)
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write("warn", message, data)
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write("error", message, data)
  }
}

export { Log }

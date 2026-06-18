/**
 * 简化的日志器，适配LTX的日志接口
 * 将LTX的日志重定向到jianjicode的控制台输出
 */

export const logger = {
  info: (message: string) => {
    console.log(`[ltx-export] ${message}`)
  },

  warn: (message: string) => {
    console.warn(`[ltx-export] ⚠️ ${message}`)
  },

  error: (message: string) => {
    console.error(`[ltx-export] ❌ ${message}`)
  },

  debug: (message: string) => {
    if (process.env.DEBUG) {
      console.debug(`[ltx-export] 🔍 ${message}`)
    }
  },
}

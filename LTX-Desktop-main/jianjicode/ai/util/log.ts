// Simplified logging for jianjicode
export function log(...args: any[]): void {
  console.log(...args)
}

export function error(...args: any[]): void {
  console.error(...args)
}

export function warn(...args: any[]): void {
  console.warn(...args)
}

export function info(...args: any[]): void {
  console.info(...args)
}

export function debug(...args: any[]): void {
  if (process.env.DEBUG) {
    console.debug(...args)
  }
}

export const logger = { log, error, warn, info, debug }

export namespace Log {
  export function create(options: { service: string }) {
    const prefix = `[${options.service}]`
    return {
      info: (...args: any[]) => console.info(prefix, ...args),
      warn: (...args: any[]) => console.warn(prefix, ...args),
      error: (...args: any[]) => console.error(prefix, ...args),
      debug: (...args: any[]) => {
        if (process.env.DEBUG) console.debug(prefix, ...args)
      },
    }
  }
}

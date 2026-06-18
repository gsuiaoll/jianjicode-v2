type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function log(level: LogLevel, message: string) {
  const prefix = `[${level.toUpperCase()}]`
  switch (level) {
    case 'debug': console.debug(prefix, message); break
    case 'info':  console.info(prefix, message); break
    case 'warn':  console.warn(prefix, message); break
    case 'error': console.error(prefix, message); break
  }
}

export const logger = {
  debug: (msg: string) => log('debug', msg),
  info:  (msg: string) => log('info', msg),
  warn:  (msg: string) => log('warn', msg),
  error: (msg: string) => log('error', msg),
}

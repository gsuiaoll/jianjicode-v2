import { ChildProcess, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getCurrentDir, isDev } from './config'
import { getBackendUrl } from './python-backend'
import { getPythonDir } from './python-setup'
import { logger, writeLog } from './logger'

let jianjicodeProcess: ChildProcess | null = null
let jianjicodeUrl = 'http://localhost:3001'
let jianjicodeToken: string | null = null
let startPromise: Promise<void> | null = null

export function getJianjicodeUrl(): string {
  return jianjicodeUrl
}

export function getJianjicodeToken(): string | null {
  return jianjicodeToken
}

function findBun(): string | null {
  // Common bun locations
  const candidates = [
    // Standard user-level install (most common)
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.bun', 'bin', 'bun.exe'),
    // npm global install
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'bun', 'bin', 'bun.exe'),
    // Direct download
    path.join('D:', 'bun', 'bun-windows-x64', 'bun.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'bun', 'bun.exe'),
    'bun',
    'bun.exe',
  ]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // continue
    }
  }
  return null
}

function findJianjicodeDir(): string {
  if (isDev) {
    // In dev mode, jianjicode is a sibling directory of LTX-Desktop-main
    const cwd = getCurrentDir()
    const sibling = path.join(cwd, '..', 'jianjicode')
    if (fs.existsSync(path.join(sibling, 'src', 'server.ts'))) {
      return sibling
    }
    // Fallback: look relative to CWD
    if (fs.existsSync(path.join(cwd, 'jianjicode', 'src', 'server.ts'))) {
      return path.join(cwd, 'jianjicode')
    }
  }
  // In production, jianjicode would be bundled as a resource
  const resourcePath = process.resourcesPath
  if (resourcePath) {
    const bundled = path.join(resourcePath, 'jianjicode')
    if (fs.existsSync(bundled)) return bundled
  }
  return ''
}

export async function startJianjicodeService(): Promise<void> {
  if (jianjicodeProcess) {
    // Already running
    return
  }

  if (startPromise) {
    return startPromise
  }

  startPromise = new Promise((resolve, reject) => {
    const jianjicodeDir = findJianjicodeDir()
    if (!jianjicodeDir) {
      logger.warn('jianjicode directory not found, skipping AI chat service')
      resolve()
      return
    }

    const bunExe = findBun()
    const serverScript = path.join(jianjicodeDir, 'src', 'server.ts')

    if (!bunExe) {
      logger.warn('bun not found, skipping AI chat service (install: npm install -g bun)')
      resolve()
      return
    }

    if (!fs.existsSync(serverScript)) {
      logger.warn(`jianjicode server script not found: ${serverScript}`)
      resolve()
      return
    }

    logger.info(`Starting jianjicode: ${bunExe} run ${serverScript}`)

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOST: '127.0.0.1',
    }

    // 传入打包的 Python 路径（生产环境）；dev 模式由 manim_config.ts 自动发现
    const pythonDir = getPythonDir()
    const pythonExe = path.join(pythonDir,
      process.platform === 'win32' ? 'python.exe' : 'bin/python3')
    if (fs.existsSync(pythonExe)) {
      env.MANIM_PYTHON = pythonExe
    }

    // Pass LTX backend URL if available
    const ltxUrl = getBackendUrl()
    if (ltxUrl) {
      env.LTX_API_BASE_URL = ltxUrl
    }

    jianjicodeProcess = spawn(bunExe, ['run', serverScript], {
      cwd: jianjicodeDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let started = false
    let startupSettled = false

    const settleResolve = () => {
      if (startupSettled) return
      startupSettled = true
      resolve()
    }

    const settleReject = (error: Error) => {
      if (startupSettled) return
      startupSettled = true
      reject(error)
    }

    const checkStarted = (output: string) => {
      // JSON ready message can arrive on stdout AFTER stderr text patterns —
      // always try to parse it so the auth token is captured regardless of order.
      try {
        const parsed = JSON.parse(output.trim())
        if (parsed.type === 'ready' && parsed.port) {
          jianjicodeUrl = `http://127.0.0.1:${parsed.port}`
          if (parsed.token) jianjicodeToken = parsed.token
          if (!started) {
            started = true
            logger.info(`jianjicode server ready at ${jianjicodeUrl}`)
            settleResolve()
          }
          return
        }
      } catch {
        // Not JSON, try regex patterns
      }
      if (!started) {
        const match = output.match(/(?:Server|HTTP Service) (?:running )?on (http:\/\/\S+)/)
        if (match) {
          jianjicodeUrl = match[1]
          started = true
          logger.info(`jianjicode server ready at ${jianjicodeUrl}`)
          settleResolve()
        }
      }
    }

    jianjicodeProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.log(`[jianjicode] ${output}`)
      for (const line of output.split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed) writeLog('INFO', 'jianjicode', trimmed)
      }
      checkStarted(output)
    })

    jianjicodeProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString()
      console.error(`[jianjicode Error] ${output}`)
      for (const line of output.split('\n')) {
        const trimmed = line.trimEnd()
        if (trimmed) writeLog('ERROR', 'jianjicode', trimmed)
      }
      checkStarted(output)
    })

    jianjicodeProcess.on('error', (error) => {
      logger.error(`Failed to start jianjicode: ${error}`)
      settleReject(error)
    })

    jianjicodeProcess.on('exit', (code) => {
      logger.info(`jianjicode exited with code ${code}`)
      jianjicodeProcess = null
      if (!started) {
        settleReject(new Error(`jianjicode exited during startup with code ${code}`))
      }
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      if (startupSettled || started) return
      try { jianjicodeProcess?.kill() } catch { /* ignore */ }
      settleReject(new Error('jianjicode failed to start within 30s'))
    }, 30000)
  })

  try {
    await startPromise
  } finally {
    startPromise = null
  }
}

export function stopJianjicodeService(): void {
  if (jianjicodeProcess) {
    logger.info('Stopping jianjicode service...')
    jianjicodeProcess.kill('SIGTERM')
    jianjicodeProcess = null
  }
}

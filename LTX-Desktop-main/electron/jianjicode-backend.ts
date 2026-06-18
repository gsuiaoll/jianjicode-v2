import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { getCurrentDir, isDev } from './config'
import { logger } from './logger'
import { getMainWindow } from './window'
import { getPythonDir } from './python-setup'

let jianjicodeProcess: ChildProcess | null = null
let isIntentionalShutdown = false
let lastCrashTime = 0
const CRASH_DEBOUNCE_MS = 10_000
let startPromise: Promise<void> | null = null

let jianjicodeUrl: string | null = null
let jianjicodeToken: string | null = null

export function getJianjicodeUrl(): string | null { return jianjicodeUrl }
export function getJianjicodeToken(): string | null { return jianjicodeToken }

function getServerPath(): string {
  if (isDev) {
    return path.join(getCurrentDir(), '..', 'jianjicode', 'out', 'server.cjs')
  }
  return path.join(process.resourcesPath, 'jianjicode', 'server.cjs')
}

async function probeHealth(timeoutMs = 1500, probeUrl?: string): Promise<boolean> {
  const url = probeUrl || jianjicodeUrl
  if (!url) return false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function findAvailablePort(startPort: number, maxAttempts = 10): Promise<number> {
  const net = await import('node:net')
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
    if (available) return port
  }
  return startPort
}

export async function startJianjicodeBackend(): Promise<void> {
  if (startPromise) return startPromise
  if (jianjicodeProcess) return

  isIntentionalShutdown = false

  startPromise = (async () => {
    const serverPath = getServerPath()
    if (!fs.existsSync(serverPath)) {
      logger.error(`jianjicode server not found at: ${serverPath}`)
      return
    }

    const port = await findAvailablePort(3001)
    jianjicodeUrl = `http://127.0.0.1:${port}`

    logger.info(`Starting jianjicode on port ${port}`)

    // 传入打包的 Python 路径，让 jianjicode 用同一个环境运行 ManimGL 渲染
    // 仅在 Python 文件存在时传入（生产环境）；dev 模式由 manim_config.ts 自动发现
    const envOverrides: Record<string, string> = {
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
    }
    const pythonDir = getPythonDir()
    const pythonExe = path.join(pythonDir,
      process.platform === 'win32' ? 'python.exe' : 'bin/python3')
    if (fs.existsSync(pythonExe)) {
      envOverrides.MANIM_PYTHON = pythonExe
    }

    jianjicodeProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    jianjicodeProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString().trim()
      if (!output) return
      logger.info(`[jianjicode] ${output}`)
      // Parse the JSON ready handshake to capture the auth token (same as jianjicode-service.ts)
      try {
        const parsed = JSON.parse(output)
        if (parsed.type === 'ready' && parsed.port) {
          jianjicodeUrl = `http://127.0.0.1:${parsed.port}`
          if (parsed.token) jianjicodeToken = parsed.token
        }
      } catch {
        // Not JSON, ignore
      }
    })

    jianjicodeProcess.stderr?.on('data', (data: Buffer) => {
      const output = data.toString().trim()
      if (output) logger.error(`[jianjicode] ${output}`)
    })

    jianjicodeProcess.on('error', (error) => {
      logger.error(`Failed to start jianjicode: ${error.message}`)
      jianjicodeProcess = null
      jianjicodeUrl = null
    })

    jianjicodeProcess.on('exit', async (code) => {
      logger.info(`jianjicode exited with code ${code}`)
      jianjicodeProcess = null
      jianjicodeUrl = null

      if (isIntentionalShutdown) {
        isIntentionalShutdown = false
        return
      }

      const now = Date.now()
      if (now - lastCrashTime < CRASH_DEBOUNCE_MS) return

      lastCrashTime = now
      logger.info('Restarting jianjicode after crash...')
      try {
        await startJianjicodeBackend()
        getMainWindow()?.webContents.send('jianjicode-url', jianjicodeUrl)
      } catch {
        logger.error('Failed to restart jianjicode')
      }
    })

    // Wait for health check
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await probeHealth(1500)) {
        logger.info('jianjicode is healthy')
        break
      }
    }
  })()

  try {
    await startPromise
  } finally {
    startPromise = null
  }
}

export function stopJianjicodeBackend(): void {
  if (jianjicodeProcess) {
    isIntentionalShutdown = true
    logger.info('Stopping jianjicode...')
    jianjicodeProcess.kill('SIGTERM')
    jianjicodeProcess = null
    jianjicodeUrl = null
  }
}

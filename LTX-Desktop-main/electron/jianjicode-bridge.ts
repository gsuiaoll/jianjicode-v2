import { app } from 'electron'
import { execSync } from 'child_process'
import { logger } from './logger'

// Bun-dependent service (dev mode with Bun installed)
import {
  startJianjicodeService as startBunService,
  stopJianjicodeService as stopBunService,
  getJianjicodeUrl as getBunUrl,
  getJianjicodeToken as getBunToken,
} from './jianjicode-service'

// Node.js native fallback (production or no Bun)
import {
  startJianjicodeBackend,
  stopJianjicodeBackend,
  getJianjicodeUrl as getNodeUrl,
  getJianjicodeToken as getNodeToken,
} from './jianjicode-backend'

type EngineType = 'bun' | 'node' | null

let activeEngine: EngineType = null
let detectionDone = false
let bunAvailable = false

function detectBun(): boolean {
  if (detectionDone) return bunAvailable

  // Production (packaged) → no Bun runtime available
  if (app.isPackaged) {
    console.log('[JianJiCode] Packaged app detected. Bun runtime not bundled.')
    bunAvailable = false
    detectionDone = true
    return false
  }

  // Dev mode: probe for bun executable
  try {
    execSync('bun --version', { timeout: 5000, stdio: 'ignore' })
    bunAvailable = true
  } catch {
    bunAvailable = false
  }

  detectionDone = true
  return bunAvailable
}

export function getJianjicodeUrl(): string {
  if (activeEngine === 'node') {
    return getNodeUrl() ?? 'http://localhost:3001'
  }
  return getBunUrl()
}

export function getJianjicodeToken(): string | null {
  if (activeEngine === 'node') {
    return getNodeToken()
  }
  return getBunToken()
}

export async function startJianjicodeService(): Promise<void> {
  if (activeEngine !== null) {
    logger.info(`[JianJiCode] Service already running via ${activeEngine} engine, skipping restart`)
    return
  }

  const hasBun = detectBun()

  if (hasBun) {
    console.log('[JianJiCode] Bun runtime detected. Starting via Bun service...')
    activeEngine = 'bun'
    try {
      await startBunService()
    } catch (err) {
      activeEngine = null
      console.error('[JianJiCode] Bun service failed to start:', err)
      throw err
    }
  } else {
    console.log('[JianJiCode] Bun runtime not found or in production. Falling back to native Node.js backend...')
    activeEngine = 'node'
    try {
      await startJianjicodeBackend()
    } catch (err) {
      activeEngine = null
      console.error('[JianJiCode] Node.js fallback backend failed to start:', err)
      throw err
    }
  }
}

export function stopJianjicodeService(): void {
  if (activeEngine === null) return

  logger.info(`[JianJiCode] Stopping service (engine: ${activeEngine})`)

  if (activeEngine === 'bun') {
    stopBunService()
  } else if (activeEngine === 'node') {
    stopJianjicodeBackend()
  }

  activeEngine = null
}

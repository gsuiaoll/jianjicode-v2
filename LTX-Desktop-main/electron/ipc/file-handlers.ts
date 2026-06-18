import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { getAllowedRoots, getCurrentDir } from '../config'
import { stopJianjicodeService, startJianjicodeService } from '../jianjicode-bridge'
import { logger } from '../logger'
import { getMainWindow } from '../window'
import { validatePath, approvePath } from '../path-validation'
import { getProjectAssetsPath, setProjectAssetsPath } from '../app-state'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
}

function readLocalFileAsBase64(filePath: string): { data: string; mimeType: string } {
  const data = fs.readFileSync(filePath)
  const base64 = data.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
  return { data: base64, mimeType }
}

function searchDirectoryForFiles(dir: string, filenames: string[]): Record<string, string> {
  const results: Record<string, string> = {}
  const remaining = new Set(filenames.map(f => f.toLowerCase()))

  const walk = (currentDir: string, depth: number) => {
    if (remaining.size === 0 || depth > 10) return // max depth to avoid infinite loops
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (remaining.size === 0) break
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase()
          if (remaining.has(lower)) {
            results[lower] = fullPath
            remaining.delete(lower)
          }
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1)
        }
      }
    } catch {
      // Skip directories we can't read (permissions, etc.)
    }
  }

  walk(dir, 0)
  return results
}


export function registerFileHandlers(): void {
  ipcMain.handle('open-ltx-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://console.ltx.video/api-keys/')
    return true
  })

  ipcMain.handle('open-fal-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://fal.ai/dashboard/keys')
    return true
  })

  ipcMain.handle('open-dashscope-api-key-page', async () => {
    const { shell } = await import('electron')
    await shell.openExternal('https://bailian.console.aliyun.com/#/api-key')
    return true
  })

  ipcMain.handle('save-jianjicode-env', async (_event, data: { apiKey: string; model: string }) => {
    const jianjicodeDir = path.join(getCurrentDir(), '..', 'jianjicode')
    const envPath = path.join(jianjicodeDir, '.env')
    const lines = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, 'utf-8').split('\n')
      : []
    const out: string[] = []
    let foundKey = false
    let foundModel = false
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('DASHSCOPE_API_KEY=')) {
        out.push(`DASHSCOPE_API_KEY=${data.apiKey}`)
        foundKey = true
      } else if (t.startsWith('DASHSCOPE_MODEL=')) {
        out.push(`DASHSCOPE_MODEL=${data.model}`)
        foundModel = true
      } else {
        out.push(line)
      }
    }
    if (!foundKey) out.push(`DASHSCOPE_API_KEY=${data.apiKey}`)
    if (!foundModel) out.push(`DASHSCOPE_MODEL=${data.model}`)
    fs.writeFileSync(envPath, out.join('\n'))
    logger.info('jianjicode .env updated, restarting...')
    stopJianjicodeService()
    setTimeout(() => startJianjicodeService(), 1500)
    return true
  })

  // CC (Claude Code) 配置 — 用于 Manim 代码生成 Agent
  ipcMain.handle('save-cc-env', async (_event, data: { apiKey?: string; baseUrl?: string }) => {
    const jianjicodeDir = path.join(getCurrentDir(), '..', 'jianjicode')
    const envPath = path.join(jianjicodeDir, '.env')
    const lines = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, 'utf-8').split('\n')
      : []
    const out: string[] = []
    let foundKey = false
    let foundUrl = false
    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('ANTHROPIC_API_KEY=')) {
        if (data.apiKey) out.push(`ANTHROPIC_API_KEY=${data.apiKey}`)
        foundKey = true
      } else if (t.startsWith('ANTHROPIC_BASE_URL=')) {
        if (data.baseUrl) out.push(`ANTHROPIC_BASE_URL=${data.baseUrl}`)
        foundUrl = true
      } else {
        out.push(line)
      }
    }
    if (!foundKey && data.apiKey) out.push(`ANTHROPIC_API_KEY=${data.apiKey}`)
    if (!foundUrl && data.baseUrl) out.push(`ANTHROPIC_BASE_URL=${data.baseUrl}`)
    fs.writeFileSync(envPath, out.join('\n'))
    logger.info('CC env saved to jianjicode .env')
    // 重启 jianjicode 使环境变量生效
    stopJianjicodeService()
    setTimeout(() => startJianjicodeService(), 1500)
    return true
  })

  // 检测 CC 就绪状态 — 运行 claude.exe -p "hello" 快速验证
  ipcMain.handle('check-cc-status', async () => {
    const { execSync } = await import('child_process')
    const isWin = process.platform === 'win32'
    const binName = isWin ? 'claude.exe' : 'claude'

    // 查找 CC 二进制文件
    const resourcesPath = (process as Record<string, unknown>).resourcesPath as string | undefined
    const candidates: string[] = []
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, 'claude', binName))
    }
    const cwd = getCurrentDir()
    for (const base of [cwd, path.join(cwd, '..'), path.join(cwd, '..', '..')]) {
      candidates.push(path.join(base, 'resources', 'claude', binName))
      candidates.push(path.join(base, 'LTX-Desktop-main', 'resources', 'claude', binName))
      candidates.push(path.join(base, 'open', 'claude', binName))
    }

    let ccBin: string | null = null
    for (const c of candidates) {
      if (fs.existsSync(c)) { ccBin = c; break }
    }

    if (!ccBin) {
      return {
        status: 'not_installed' as const,
        message: 'Claude Code 未找到。请确保 claude.exe 已正确打包。',
      }
    }

    try {
      // 用 execSync 做快速冒烟测试（10s 超时，--max-budget-usd 0.01 避免浪费）
      const result = execSync(`"${ccBin}" -p "Say hi in one word" --output-format json --max-turns 1`, {
        timeout: 15_000,
        env: { ...process.env },
      })
      const parsed = JSON.parse(result.stdout.toString().trim())
      if (parsed.is_error === false || parsed.result) {
        return {
          status: 'ready' as const,
          message: 'Claude Code 已就绪',
          provider: process.env.ANTHROPIC_BASE_URL
            ? new URL(process.env.ANTHROPIC_BASE_URL).hostname
            : 'anthropic',
        }
      }
      return { status: 'error' as const, message: parsed.result || '未知错误' }
    } catch (e: any) {
      const stderr = e.stderr?.toString() || e.message || ''
      // OAuth 未登录的典型错误
      if (stderr.includes('not logged in') || stderr.includes('No API key')) {
        return {
          status: 'not_authenticated' as const,
          message: '未登录。请在设置中登录 Anthropic 账号或填写 API Key。',
        }
      }
      return { status: 'error' as const, message: stderr.slice(0, 200) }
    }
  })

  ipcMain.handle('open-parent-folder-of-file', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    const normalizedPath = validatePath(filePath, getAllowedRoots())
    const parentDir = path.dirname(normalizedPath)
    if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
      throw new Error(`Parent directory not found: ${parentDir}`)
    }
    shell.openPath(parentDir)
  })

  ipcMain.handle('show-item-in-folder', async (_event, filePath: string) => {
    const { shell } = await import('electron')
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('read-local-file', async (_event, filePath: string) => {
    try {
      const normalizedPath = validatePath(filePath, getAllowedRoots())

      if (!fs.existsSync(normalizedPath)) {
        throw new Error(`File not found: ${normalizedPath}`)
      }

      return readLocalFileAsBase64(normalizedPath)
    } catch (error) {
      logger.error( `Error reading local file: ${error}`)
      throw error
    }
  })

  ipcMain.handle('show-save-dialog', async (_event, options: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: options.title || 'Save File',
      defaultPath: options.defaultPath,
      filters: options.filters || [],
    })
    if (result.canceled || !result.filePath) return null
    approvePath(result.filePath)
    return result.filePath
  })

  ipcMain.handle('save-file', async (_event, filePath: string, data: string, encoding?: string) => {
    try {
      validatePath(filePath, getAllowedRoots())
      if (encoding === 'base64') {
        fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
      } else {
        fs.writeFileSync(filePath, data, 'utf-8')
      }
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('save-binary-file', async (_event, filePath: string, data: ArrayBuffer) => {
    try {
      validatePath(filePath, getAllowedRoots())
      fs.writeFileSync(filePath, Buffer.from(data))
      return { success: true, path: filePath }
    } catch (error) {
      logger.error( `Error saving binary file: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('show-open-directory-dialog', async (_event, options: { title?: string }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    approvePath(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('search-directory-for-files', async (_event, dir: string, filenames: string[]) => {
    return searchDirectoryForFiles(dir, filenames)
  })

  ipcMain.handle('copy-to-project-assets', async (_event, srcPath: string, projectId: string, projectName?: string) => {
    try {
      approvePath(srcPath)
      const resolvedSrc = validatePath(srcPath, getAllowedRoots())
      const assetsRoot = getProjectAssetsPath()
      // Sanitize project name for use as a directory name:
      // - Strip characters invalid on Windows: < > : " / \ | ? *
      // - Trim whitespace; fall back to projectId if result is empty
      const safeName = (projectName || '').trim().replace(/[<>:"/\\|?*]/g, '')
      const dirName = safeName || projectId
      const destDir = path.join(assetsRoot, dirName)
      fs.mkdirSync(destDir, { recursive: true })
      const fileName = path.basename(resolvedSrc)
      const destPath = path.join(destDir, fileName)
      fs.copyFileSync(resolvedSrc, destPath)
      const normalized = destPath.replace(/\\/g, '/')
      const fileUrl = `file:///${encodeURI(normalized)}`
      return { success: true, path: destPath, url: fileUrl }
    } catch (error) {
      logger.error(`Error copying to project assets: ${error}`)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-project-assets-path', async () => {
    return getProjectAssetsPath()
  })

  ipcMain.handle('open-project-assets-path-change-dialog', async () => {
    try {
      const mainWindow = getMainWindow()
      if (!mainWindow) return { success: false, error: 'No window' }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Project Assets Path',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false, error: 'cancelled' }
      const selectedPath = path.resolve(result.filePaths[0])
      setProjectAssetsPath(selectedPath)
      approvePath(selectedPath)
      return { success: true, path: selectedPath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('check-files-exist', async (_event, filePaths: string[]) => {
    const results: Record<string, boolean> = {}
    for (const p of filePaths) {
      try {
        results[p] = fs.existsSync(p)
      } catch {
        results[p] = false
      }
    }
    return results
  })

  ipcMain.handle('show-open-file-dialog', async (_event, options: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: string[]
  }) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const props: any[] = ['openFile']
    if (options.properties?.includes('multiSelections')) props.push('multiSelections')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options.title || 'Select File',
      filters: options.filters || [],
      properties: props,
    })
    if (result.canceled || result.filePaths.length === 0) return null
    for (const fp of result.filePaths) {
      approvePath(fp)
    }
    return result.filePaths
  })

}

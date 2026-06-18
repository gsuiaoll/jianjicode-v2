import { app, BrowserWindow, nativeImage, Menu, clipboard } from 'electron'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from './config'
import { logger } from './logger'

let mainWindow: BrowserWindow | null = null

export function createWindow(): BrowserWindow {
  // Get the path to preload script
  const preloadPath = isDev
    ? path.join(getCurrentDir(), 'dist-electron', 'preload.js')
    : path.join(app.getAppPath(), 'dist-electron', 'preload.js')

  // App icon — use .ico on Windows, .png elsewhere
  const iconExt = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = path.join(getCurrentDir(), 'resources', iconExt)
  logger.info(`[icon] Loading app icon from: ${iconPath} | exists: ${fs.existsSync(iconPath)}`)
  const appIcon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    icon: appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: isDev ? false : true,
    },
    backgroundColor: '#1a1a1a',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
  })

  // Load the app
  if (isDev) {
    // Retry loading dev server until it's ready
    let attempts = 0
    const loadDevURL = () => {
      mainWindow?.loadURL('http://localhost:5173')
        .catch(() => {
          attempts++
          if (attempts < 30) {  // Try for ~30 seconds
            setTimeout(loadDevURL, 1000)
          } else {
            logger.error('Failed to load dev server after multiple attempts')
          }
        })
    }
    loadDevURL()
    // DevTools can be opened manually with Ctrl+Shift+I or F12
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }

  // Enable right-click context menu with Copy
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (params.selectionText) {
      Menu.buildFromTemplate([
        { label: '复制', role: 'copy' },
      ]).popup()
    }
  })

  // Register Ctrl+C globally — required in frameless windows
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.key === 'c') {
      mainWindow?.webContents.copy()
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

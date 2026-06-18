import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } from "electron"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let jianjicodeServer: ChildProcess | null = null

function getResourcePath(...paths: string[]): string {
  if (isDev) {
    return path.join(__dirname, "..", ...paths)
  }
  return path.join(process.resourcesPath, "app", ...paths)
}

function startJianjicodeServer(): void {
  if (jianjicodeServer) return

  const serverScript = path.join(
    isDev ? path.join(__dirname, "..") : process.resourcesPath,
    isDev ? "src" : "jianjicode",
    "server.js"
  )

  console.log("[Main] Starting jianjicode server...")

  try {
    const bunPath = isDev ? "bun" : path.join(process.resourcesPath, "bun.exe")
    jianjicodeServer = spawn(bunPath, [serverScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PORT: "3001" }
    })

    jianjicodeServer.stdout?.on("data", (data) => {
      console.log(`[jianjicode] ${data.toString().trim()}`)
    })

    jianjicodeServer.stderr?.on("data", (data) => {
      console.error(`[jianjicode] ${data.toString().trim()}`)
    })

    jianjicodeServer.on("error", (err) => {
      console.error("[Main] Failed to start jianjicode server:", err)
    })

    console.log("[Main] jianjicode server started")
  } catch (error) {
    console.error("[Main] Error starting server:", error)
  }
}

function stopJianjicodeServer(): void {
  if (jianjicodeServer) {
    console.log("[Main] Stopping jianjicode server...")
    jianjicodeServer.kill("SIGTERM")
    jianjicodeServer = null
  }
}

function createTray(): void {
  let icon: ReturnType<typeof nativeImage.createEmpty>
  try {
    const iconPath = path.join(__dirname, "..", "resources", "icon.svg")
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: "打开窗口", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ])

  tray.setToolTip("jianjicode")
  tray.setContextMenu(contextMenu)

  tray.on("double-click", () => {
    mainWindow?.show()
  })
}

function createWindow(): void {
  console.log("[Main] Creating main window...")

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "jianjicode",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    console.log("[Main] Window shown")
  })

  if (isDev) {
    const url = "http://localhost:5173"
    console.log("[Main] Loading:", url)
    mainWindow.loadURL(url)
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "index.html")
    console.log("[Main] Loading:", indexPath)
    mainWindow.loadFile(indexPath)
  }

  mainWindow.on("close", (event) => {
    if (tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  createMenu()
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开视频...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ["openFile"],
              filters: [
                { name: "视频文件", extensions: ["mp4", "avi", "mov", "mkv", "webm"] },
                { name: "所有文件", extensions: ["*"] }
              ]
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send("file-opened", result.filePaths[0])
            }
          }
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            tray?.destroy()
            tray = null
            app.quit()
          }
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "重做", accelerator: "CmdOrCtrl+Shift+Z", role: "redo" },
        { type: "separator" },
        { label: "剪切", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "复制", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "粘贴", accelerator: "CmdOrCtrl+V", role: "paste" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", accelerator: "CmdOrCtrl+R", role: "reload" },
        { label: "强制重新加载", accelerator: "CmdOrCtrl+Shift+R", role: "forceReload" },
        { type: "separator" },
        { label: "放大", accelerator: "CmdOrCtrl+Plus", role: "zoomIn" },
        { label: "缩小", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { label: "重置缩放", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { type: "separator" },
        { label: "全屏", accelerator: "F11", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "关闭", accelerator: "CmdOrCtrl+W", role: "close" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于",
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: "info",
              title: "关于 jianjicode",
              message: "jianjicode",
              detail: "版本: 0.1.0\nAI 驱动的视频编辑工具"
            })
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

ipcMain.handle("select-video-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openFile"],
    filters: [
      { name: "视频文件", extensions: ["mp4", "avi", "mov", "mkv", "webm"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  })

  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"]
  })

  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle("show-item-in-folder", (_event, filePath: string) => {
  shell.showItemInFolder(filePath)
})

ipcMain.handle("get-server-url", () => {
  return "http://localhost:3001"
})

ipcMain.handle("minimize-window", () => {
  mainWindow?.minimize()
})

ipcMain.handle("maximize-window", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle("close-window", () => {
  mainWindow?.close()
})

app.whenReady().then(() => {
  console.log("[Main] App ready")
  createWindow()

  if (!isDev) {
    startJianjicodeServer()
    createTray()
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopJianjicodeServer()
    app.quit()
  }
})

app.on("before-quit", () => {
  stopJianjicodeServer()
  tray?.destroy()
  tray = null
})

process.on("exit", () => {
  stopJianjicodeServer()
})

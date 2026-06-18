import { contextBridge, ipcRenderer } from "electron"

export interface ElectronAPI {
  selectVideoFile: () => Promise<string | null>
  selectDirectory: () => Promise<string | null>
  showItemInFolder: (filePath: string) => Promise<void>
  getServerUrl: () => Promise<string>
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  onFileOpened: (callback: (filePath: string) => void) => () => void
}

const electronAPI: ElectronAPI = {
  selectVideoFile: () => ipcRenderer.invoke("select-video-file"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  showItemInFolder: (filePath: string) => ipcRenderer.invoke("show-item-in-folder", filePath),
  getServerUrl: () => ipcRenderer.invoke("get-server-url"),
  minimizeWindow: () => ipcRenderer.invoke("minimize-window"),
  maximizeWindow: () => ipcRenderer.invoke("maximize-window"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  onFileOpened: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath)
    ipcRenderer.on("file-opened", handler)
    return () => ipcRenderer.removeListener("file-opened", handler)
  }
}

contextBridge.exposeInMainWorld("electronAPI", electronAPI)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

import { ipcMain } from 'electron'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { findFfmpegPath, urlToFilePath } from '../export/ffmpeg-utils'
import { getProjectAssetsPath } from '../app-state'
import { logger } from '../logger'

export function registerThumbnailHandlers(): void {
  ipcMain.handle(
    'generate-thumbnail',
    async (
      _event,
      videoUrl: string,
      projectDir: string,
    ): Promise<{ path: string; url: string }> => {
      const ffmpeg = findFfmpegPath()
      if (!ffmpeg) throw new Error('ffmpeg not found')

      const inputPath = urlToFilePath(videoUrl)
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Video file not found: ${inputPath}`)
      }

      // Save to project assets .thumbnails/ — permanent, survives restart
      const assetsRoot = getProjectAssetsPath()
      const thumbDir = path.join(assetsRoot, projectDir, '.thumbnails')
      fs.mkdirSync(thumbDir, { recursive: true })

      const thumbName = `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`
      const outputPath = path.join(thumbDir, thumbName)

      const cmd = `"${ffmpeg}" -ss 1 -i "${inputPath}" -vf scale=1280:-2 -frames:v 1 -q:v 2 -y -update 1 "${outputPath}"`
      logger.info(`[generate-thumbnail] ${cmd.slice(0, 300)}`)

      try {
        execSync(cmd, { timeout: 15000 })
      } catch (e: any) {
        const stderr = e.stderr?.toString().slice(-300) || ''
        throw new Error(`FFmpeg failed: ${stderr}`)
      }

      if (!fs.existsSync(outputPath)) {
        throw new Error('FFmpeg produced no output file')
      }

      const normalized = outputPath.replace(/\\/g, '/')
      const fileUrl = `file:///${encodeURI(normalized)}`
      return { path: outputPath, url: fileUrl }
    },
  )
}

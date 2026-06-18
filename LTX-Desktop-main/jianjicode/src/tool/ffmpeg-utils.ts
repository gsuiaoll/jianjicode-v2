// Re-export from canonical FFmpeg utils location (consolidated from 3 files)

export type { FfmpegOptions } from "../../ai/tool/video/ffmpeg-utils.js"
export {
  concatVideos,
  convertVideo,
  detectBestHardwareAcceleration,
  detectHardwareAcceleration,
  extractAudio,
  findFfmpegPath,
  getHardwareEncoders,
  getVideoInfo,
  mergeAudio,
  runFfmpeg,
  runFfmpegEx,
  trimVideo,
} from "../../ai/tool/video/ffmpeg-utils.js"

export const FORCED_API_VIDEO_FPS = [24, 25, 30, 60]
export const FORCED_API_VIDEO_RESOLUTIONS = ['720p', '1080p', '1440p', '4k']

export function getAllowedForcedApiDurations(): number[] {
  return [2, 3, 4, 5, 6, 7, 8, 9, 10]
}

export function sanitizeForcedApiVideoSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return settings
}

/**
 * Generate a permanent thumbnail for a video asset.
 *
 * Uses FFmpeg to extract a 1280px frame into the project's .thumbnails/
 * directory. Returns a stable file:// URL that survives restarts.
 */
export async function generateThumbnail(
  url: string,
  projectDir: string,
): Promise<string> {
  const api = (window as any).electronAPI
  if (!api?.generateThumbnail) return ''
  try {
    const result = await api.generateThumbnail(url, projectDir)
    return result?.url || ''
  } catch {
    return ''
  }
}

export function fileUrlToPath(url: string): string | null {
  if (!url) return null
  // Handle file:// URLs (may contain unencoded Chinese chars)
  if (url.startsWith('file://')) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'file:') return decodeURIComponent(parsed.pathname)
    } catch {
      // URL parsing failed (e.g. unencoded Chinese) — manually extract path
      const pathPart = url.slice('file://'.length)
      // On Windows: file:///C:/...  (3 slashes)
      // On Unix: file:///home/...  (3 slashes)
      const cleaned = pathPart.replace(/^\/+/, '')
      try { return decodeURIComponent(cleaned) } catch { return cleaned }
    }
  }
  // Fallback for bare paths
  if (url.match(/^[A-Za-z]:[/\\]/) || url.startsWith('/')) {
    return url
  }
  return null
}

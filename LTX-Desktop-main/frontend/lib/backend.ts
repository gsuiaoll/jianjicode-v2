const DEFAULT_BACKEND_URL = 'http://localhost:8000'
const FETCH_TIMEOUT_MS = 3000

let backendUrl = DEFAULT_BACKEND_URL
let backendToken = ''
let credentials: { username?: string; password?: string } = {}

export function resetBackendCredentials() {
  credentials = {}
  backendUrl = DEFAULT_BACKEND_URL
  backendToken = ''
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  if (credentials.username && credentials.password) {
    const encoded = btoa(`${credentials.username}:${credentials.password}`)
    headers['Authorization'] = `Basic ${encoded}`
  } else if (backendToken) {
    headers['Authorization'] = `Bearer ${backendToken}`
  }
  return headers
}

function isBrowserPreview(): boolean {
  return (window as any).__BROWSER_PREVIEW__ === true
}

async function resolveBackendUrl(): Promise<void> {
  if (isBrowserPreview()) return
  if (backendUrl !== DEFAULT_BACKEND_URL) return // already resolved

  try {
    const api = (window as any).electronAPI as { getBackend?: () => Promise<{ url: string; token: string }> } | undefined
    const result = await api?.getBackend?.()
    if (result?.url) {
      backendUrl = result.url
      backendToken = result.token || ''
    }
  } catch {
    // Keep default URL
  }
}

function mockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tryMock(path: string, options?: RequestInit): Response | null {
  if (!isBrowserPreview()) return null
  if (path === '/health') {
    return mockResponse({ models_loaded: false, gpu_info: null })
  }
  if (path === '/api/runtime-policy') {
    return mockResponse({ force_api_generations: true })
  }
  if (path === '/api/settings') {
    if (options?.method === 'POST') return mockResponse({ ok: true })
    return mockResponse({
      useTorchCompile: false,
      loadOnStartup: false,
      hasLtxApiKey: true,
      userPrefersLtxApiVideoGenerations: false,
      hasFalApiKey: false,
      hasGeminiApiKey: false,
      useLocalTextEncoder: false,
      fastModel: { useUpscaler: true },
      proModel: { steps: 20, useUpscaler: true },
      promptCacheSize: 1,
      promptEnhancerEnabledT2V: false,
      promptEnhancerEnabledI2V: false,
      seedLocked: false,
      lockedSeed: 42,
      modelsDir: '',
    })
  }
  if (path === '/api/models') {
    return mockResponse({ models: [] })
  }
  if (path === '/api/models/status') {
    return mockResponse({ all_downloaded: true })
  }
  return null
}

export async function backendFetch(path: string, options?: RequestInit): Promise<Response> {
  const mock = tryMock(path, options)
  if (mock) return mock

  await resolveBackendUrl()

  const url = path.startsWith('http') ? path : `${backendUrl}${path}`
  const authHeaders = getAuthHeaders()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options?.headers,
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

export async function backendWsUrl(path: string): Promise<string> {
  await resolveBackendUrl()
  const wsBaseUrl = backendUrl.replace(/^http/, 'ws')
  return `${wsBaseUrl}${path}`
}

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Wrench, Bot, User, Film, Eye, ShieldAlert } from 'lucide-react'
import { backendFetch } from '../lib/backend'
import { logger } from '../lib/logger'
import { useI18n } from '../contexts/I18nContext'
import { ThinkingIndicator } from '../components/chat/ThinkingIndicator'
import { EmotionIcons } from '../components/chat/EmotionIcons'
import { EmotionFeedback } from '../components/chat/EmotionFeedback'
import { StreamTyping } from '../components/chat/StreamTyping'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: string[]
  timestamp: number
}

interface ToolExecution {
  tool: string
  status: 'running' | 'done' | 'error'
  message?: string
}

/** jianjicode SSE stream event (wrapped in "stream" SSE event) */
interface StreamEvent {
  type: 'text-delta' | 'text-start' | 'text-end' | 'tool-start' | 'tool-end' | 'tool-error'
    | 'step-start' | 'step-end' | 'reasoning-delta' | 'error' | 'permission-request'
  toolName?: string
  error?: string
  delta?: string
  text?: string
  args?: unknown
  result?: unknown
  step?: number
  finishReason?: string
  request?: PermissionRequestData
}

interface PermissionRequestData {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  toolID?: string
  metadata: Record<string, unknown>
  alwaysPatterns: string[]
}

interface NudgeData {
  id: string
  type: string
  message: string
  skillName?: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let cachedJianjicodeUrl: string | null = null

async function getJianjicodeUrl(): Promise<string> {
  if (cachedJianjicodeUrl) return cachedJianjicodeUrl
  if (typeof window !== 'undefined' && window.electronAPI) {
    try {
      const url = await window.electronAPI.getJianjicodeUrl()
      if (url) {
        cachedJianjicodeUrl = url
        return url
      }
    } catch { /* fall through */ }
  }
  cachedJianjicodeUrl = 'http://localhost:3001'
  return cachedJianjicodeUrl
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JianjiCodeChat() {
  const { t } = useI18n()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestData | null>(null)
  const [nudges, setNudges] = useState<NudgeData[]>([])
  const [showNudge, setShowNudge] = useState(false)
  const [emotionType, setEmotionType] = useState<'success' | 'error' | 'loading' | 'welcome' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hasEdited = useRef(false)

  const assistantMsgId = useRef<string | null>(null)
  const accumulatedText = useRef('')

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, toolExecutions])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Fetch jianjicode credentials from Electron IPC
  useEffect(() => {
    window.electronAPI.getJianjicode().then(({ url, token }) => {
      jianjicodeUrl = url
      jianjicodeToken = token
    }).catch(() => {
      logger.warn('Failed to get jianjicode credentials from IPC, will use Python fallback')
    })
  }, [])

  // Auto-hide nudge after 12s
  useEffect(() => {
    if (showNudge) {
      const timer = setTimeout(() => setShowNudge(false), 12000)
      return () => clearTimeout(timer)
    }
  }, [showNudge])

  // -----------------------------------------------------------------------
  // SSE stream parsing
  // -----------------------------------------------------------------------

  const parseSSE = useCallback((text: string): { event: string; data: string } | null => {
    const lines = text.split('\n')
    let event = ''
    let data = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) event = line.slice(7).trim()
      else if (line.startsWith('data: ')) data = line.slice(6).trim()
    }
    if (!data) return null
    return { event, data }
  }, [])

  // -----------------------------------------------------------------------
  // Nudge check
  // -----------------------------------------------------------------------

  const checkNudges = useCallback(async () => {
    try {
      const res = await fetch(`${await getJianjicodeUrl()}/nudges`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        const body = await res.json()
        if (body.success && Array.isArray(body.data) && body.data.length > 0) {
          setNudges(body.data)
          setShowNudge(true)
        }
      }
    } catch {
      // Nudge check is best-effort
    }
  }, [])

  const dismissNudge = useCallback(async () => {
    setShowNudge(false)
    try {
      await fetch(`${await getJianjicodeUrl()}/nudges/clear`, { method: 'POST', signal: AbortSignal.timeout(2000) })
    } catch { /* ignore */ }
  }, [])

  // -----------------------------------------------------------------------
  // Send message (SSE streaming via direct connection)
  // -----------------------------------------------------------------------

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    abortRef.current?.abort()
    hasEdited.current = false

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    const aId = `msg-${Date.now()}-ai`
    assistantMsgId.current = aId
    accumulatedText.current = ''

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setToolExecutions([])
    setShowNudge(false)

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const response = await fetch(`${await getJianjicodeUrl()}/api/jianjicode/chat/stream`, {
        method: 'POST',
        headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error('SSE connection failed')
      }

      // 添加占位 assistant 消息
      setMessages(prev => [...prev, {
        id: aId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }])

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          const parsed = parseSSE(part)
          if (!parsed) continue

          switch (parsed.event) {
            case 'stream':
              try {
                const ev: StreamEvent = JSON.parse(parsed.data)
                handleStreamEvent(ev, aId)
              } catch { /* ignore */ }
              break
            case 'result':
              try {
                const result = JSON.parse(parsed.data)
                handleResult(result, aId)
              } catch { /* ignore */ }
              break
            case 'log':
              logger.debug(`[jianjicode] ${parsed.data}`)
              break
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return
      logger.warn(`[JianjiCodeChat] SSE failed, falling back to JSON endpoint: ${err}`)
      await fallbackSend(text, aId)
    } finally {
      setLoading(false)
      abortRef.current = null
      // 完成后再检查 nudge
      if (hasEdited.current) checkNudges()
    }
  }

  // -----------------------------------------------------------------------
  // Fallback: 通过 Python 代理的 JSON 端点
  // -----------------------------------------------------------------------

  const fallbackSend = async (text: string, assistantId: string) => {
    try {
      const response = await backendFetch('/api/jianjicode/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })

      const result = await response.json()

      if (!result.success) {
        setMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: t('chat.errorUnknown', { error: result.error || 'Unknown' }),
          timestamp: Date.now(),
        }])
        return
      }

      const data = result.data ?? {}
      let content = result.output || data.response || data.text || data.output || data.analysis || t('chat.taskComplete')
      const hasTools = Array.isArray(data.tool_results) && data.tool_results.length > 0

      const toolCalls: string[] = []
      if (Array.isArray(data.tool_results)) {
        for (const tr of data.tool_results) {
          if (tr.tool) toolCalls.push(tr.tool)
        }
      }

      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content,
        toolCalls,
        timestamp: Date.now(),
      }])

      if (hasTools) {
        hasEdited.current = true
        setToolExecutions(prev => [
          ...prev,
          ...toolCalls.map(tc => ({ tool: tc, status: 'done' as const, message: t('chat.toolDone') })),
        ])
        setTimeout(() => setToolExecutions([]), 8000)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Not connected'
      logger.error(`JianjiCode chat error: ${message}`)
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: t('chat.errorConnection', { message }),
        timestamp: Date.now(),
      }])
    }
  }

  // -----------------------------------------------------------------------
  // Permission reply
  // -----------------------------------------------------------------------

  const sendPermissionReply = async (action: 'allow_once' | 'allow_always' | 'deny') => {
    const req = pendingPermission
    if (!req) return

    try {
      await fetch(`${await getJianjicodeUrl()}/permission/reply`, {
        method: 'POST',
        headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ requestID: req.id, action }),
      })
    } catch (err) {
      logger.error(`[JianjiCodeChat] Permission reply failed: ${err}`)
    }
    setPendingPermission(null)
  }

  // -----------------------------------------------------------------------
  // SSE event handlers
  // -----------------------------------------------------------------------

  const handleStreamEvent = (ev: StreamEvent, aId: string) => {
    switch (ev.type) {
      case 'text-start':
        accumulatedText.current = ''
        break

      case 'text-delta':
        accumulatedText.current += ev.delta || ''
        updateAssistantMessage(aId, accumulatedText.current)
        break

      case 'text-end':
        accumulatedText.current = ev.text || accumulatedText.current
        updateAssistantMessage(aId, accumulatedText.current)
        break

      case 'tool-start':
        hasEdited.current = true
        setToolExecutions(prev => [...prev, {
          tool: ev.toolName || 'unknown',
          status: 'running',
          message: t('chat.toolRunning'),
        }])
        break

      case 'tool-end':
        setToolExecutions(prev =>
          prev.map(te =>
            te.tool === ev.toolName
              ? { ...te, status: 'done', message: t('chat.toolDone') }
              : te,
          ),
        )
        break

      case 'tool-error':
        setToolExecutions(prev =>
          prev.map(te =>
            te.tool === ev.toolName
              ? { ...te, status: 'error', message: ev.error || t('chat.toolError') }
              : te,
          ),
        )
        break

      case 'permission-request':
        if (ev.request) {
          setPendingPermission(ev.request)
        }
        break

      case 'error':
        updateAssistantMessage(aId, `${accumulatedText.current}\n\n[Error: ${ev.error}]`)
        break
    }
  }

  const handleResult = (result: any, aId: string) => {
    const data = result.data ?? {}
    // Extract text from server response: try multiple field names (server sends ChatResult format)
    const fromServer = result.output || data.response || data.text || data.output || data.analysis || ""
    const hasError = result.success === false && !!result.error
    const finalText = hasError
      ? `❌ ${result.error}`
      : fromServer || accumulatedText.current || t('chat.taskComplete')

    const toolCalls: string[] = []
    if (Array.isArray(data.tool_results)) {
      for (const tr of data.tool_results) {
        if (tr.tool) toolCalls.push(tr.tool)
      }
    }

    setMessages(prev =>
      prev.map(m =>
        m.id === aId
          ? { ...m, content: finalText, toolCalls: toolCalls.length > 0 ? toolCalls : m.toolCalls }
          : m,
      ),
    )
  }

  const updateAssistantMessage = (id: string, content: string) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, content } : m)))
  }

  // -----------------------------------------------------------------------
  // Keyboard handler
  // -----------------------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-background relative">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
            <Bot className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{t('chat.title')}</h2>
            <p className="text-xs text-zinc-500">{t('chat.subtitle')}</p>
          </div>
        </div>

        {/* Nudge indicator */}
        {showNudge && nudges.length > 0 && (
          <button
            onClick={dismissNudge}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-600/20 text-amber-400 text-xs hover:bg-amber-600/30 transition-colors"
          >
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            {t('nudge.createSkill')}
          </button>
        )}
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="h-16 w-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4">
              <Film className="h-8 w-8 text-zinc-600" />
            </div>
            <h3 className="text-lg font-medium text-zinc-400 mb-2">{t('chat.emptyTitle')}</h3>
            <p className="text-sm text-zinc-600 max-w-md">{t('chat.emptyDescription')}</p>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="h-8 w-8 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="h-4 w-4 text-blue-400" />
              </div>
            )}

            <div
              className={`max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-zinc-800 text-zinc-200 rounded-bl-md'
              }`}
            >
              <StreamTyping
                text={msg.content}
                isStreaming={loading && msg.id === assistantMsgId.current}
                showThinking={false}
                className="whitespace-pre-wrap break-words"
              />

              {/* Tool call badges */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-zinc-700 flex flex-wrap gap-1.5 items-center">
                  {msg.toolCalls.map(t => (
                    <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-700 text-xs text-zinc-300">
                      <Wrench className="h-3 w-3" />
                      {t}
                    </span>
                  ))}
                  {/* View in Editor button */}
                  <button
                    onClick={() => {
                      const event = new CustomEvent('switch-tab', { detail: 'video-editor' })
                      window.dispatchEvent(event)
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 text-xs hover:bg-blue-600/30 transition-colors ml-auto"
                  >
                    <Eye className="h-3 w-3" />
                    {t('chat.viewInEditor')}
                  </button>
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="h-8 w-8 rounded-lg bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="h-4 w-4 text-zinc-300" />
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && !messages.find(m => m.id === assistantMsgId.current) && (
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-blue-600/20 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-blue-400" />
            </div>
            <div className="bg-zinc-800 rounded-xl rounded-bl-md px-4 py-3">
              <ThinkingIndicator phase="thinking" message={t('chat.feedback.loading')} />
            </div>
          </div>
        )}
      </div>

      {/* Tool execution status bar */}
      {toolExecutions.length > 0 && (
        <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/50 flex-shrink-0">
          <div className="flex flex-wrap gap-2">
            {toolExecutions.map((te, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                  te.status === 'running'
                    ? 'bg-yellow-600/20 text-yellow-400'
                    : te.status === 'error'
                      ? 'bg-red-600/20 text-red-400'
                      : 'bg-green-600/20 text-green-400'
                }`}
              >
                {te.status === 'running' ? (
                  <EmotionIcons state="tool" size={14} />
                ) : te.status === 'error' ? (
                  <EmotionIcons state="error" size={14} />
                ) : (
                  <EmotionIcons state="success" size={14} />
                )}
                {te.tool}
                {te.message && <span className="opacity-70">— {te.message}</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 border-t border-zinc-800 flex-shrink-0">
        <div className="flex gap-3 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={2}
            className="flex-1 resize-none rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="h-10 w-10 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white flex items-center justify-center flex-shrink-0 transition-colors"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-2 text-center">
          {t('chat.hint')}
        </p>
      </div>

      {/* ================================================================ */}
      {/* Permission dialog overlay */}
      {/* ================================================================ */}
      {pendingPermission && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 px-8">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-amber-600/20 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">{t('permission.title')}</h3>
                <p className="text-xs text-zinc-400">
                  {pendingPermission.toolID
                    ? t('permission.tool', { tool: pendingPermission.toolID })
                    : ''}
                </p>
              </div>
            </div>

            {/* Details */}
            <div className="bg-zinc-800/50 rounded-xl p-4 mb-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">{t('permission.operation')}</span>
                <span className="text-zinc-200 font-medium">{pendingPermission.permission}</span>
              </div>
              {pendingPermission.patterns.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">{t('permission.target')}</span>
                  <span className="text-zinc-200 font-medium text-right max-w-[60%] truncate">
                    {pendingPermission.patterns.join(', ')}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => sendPermissionReply('allow_once')}
                className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
              >
                {t('permission.allowOnce')}
              </button>
              <button
                onClick={() => sendPermissionReply('allow_always')}
                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-medium transition-colors"
              >
                {t('permission.allowAlways')}
              </button>
              <button
                onClick={() => sendPermissionReply('deny')}
                className="px-4 py-2.5 rounded-xl bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium transition-colors"
              >
                {t('permission.deny')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emotion Feedback Overlay */}
      {emotionType && (
        <EmotionFeedback
          type={emotionType}
          message={emotionType === 'success' ? t('chat.feedback.success') : emotionType === 'error' ? t('chat.feedback.error') : emotionType === 'loading' ? t('chat.feedback.loading') : t('chat.feedback.welcome')}
          duration={2000}
          onComplete={() => setEmotionType(null)}
        />
      )}
    </div>
  )
}

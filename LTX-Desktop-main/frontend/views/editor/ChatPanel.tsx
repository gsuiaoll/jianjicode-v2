import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { Loader2, Wrench, Bot, ShieldAlert, ArrowUp, ChevronDown, ChevronUp, Lightbulb, X as XIcon, Copy } from 'lucide-react'
import { logger } from '../../lib/logger'
import { useI18n } from '../../contexts/I18nContext'
import { getAssetBlob } from '../../lib/file-store'
import { ThinkingIndicator } from '../../components/chat/ThinkingIndicator'
import { EmotionIcons } from '../../components/chat/EmotionIcons'
import { IntentForm } from '../../components/chat/IntentForm'
import { ToolCallChain, type ToolCallItem } from '../../components/chat/ToolCallChain'
import { MarkdownMessage } from '../../components/chat/MarkdownMessage'
import { usePacedMarkdown } from '../../hooks/usePacedMarkdown'
import { CodeDiffViewer } from '../../components/chat/CodeDiffViewer'
import { RiskConfirmation } from '../../components/chat/RiskConfirmation'
import { ErrorBoundary } from '../../components/chat/ErrorBoundary'
import { HistoryPanel } from '../../components/chat/HistoryPanel'
import { VideoEditResultCard } from '../../components/chat/VideoEditResultCard'
import { generateSessionId, saveSession, saveSessionNow, getSessionMessages } from '../../lib/chat-store'
import type { StoredMessage } from '../../lib/chat-store'
import type { EditPreview, TimelineAction } from '../../components/chat/VideoEditResultCard'
import type { EditOperation } from '../../../../jianjicode/src/types/edit-operations'
import type { QuestionData } from '../../components/chat/QuestionForm'
import { DotGrid } from '../../components/chat/DotGrid'
import { InkCloud } from '../../components/chat/InkCloud'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorMediaFile {
  name: string
  path: string
  type: 'video' | 'audio' | 'image'
  duration?: number
  assetId: string
}

interface EditorClipInfo {
  id: string
  type: string
  trackIndex: number
  startTime: number
  duration: number
  trimStart?: number
  trimEnd?: number
  speed?: number
  assetName: string
  assetPath: string
  assetType?: 'video' | 'audio' | 'image'
  assetId: string
}

interface EditorContext {
  projectName?: string
  mediaFiles?: EditorMediaFile[]
  selectedClips?: EditorClipInfo[]
  timelineClips?: EditorClipInfo[]
  currentTime?: number
  totalDuration?: number
}

type MsgType = 'text' | 'tool-start' | 'tool-end' | 'tool-error' | 'thinking' | 'pipeline'
type Phase = 'thinking' | 'calling-tool' | 'writing' | null
type ToolStatus = 'pending' | 'running' | 'done' | 'error'

interface RiskItem {
  id: string
  description: string
  level: 'low' | 'medium' | 'high' | 'critical'
  affectedScope?: string[]
  recoverable?: boolean
  estimatedImpact?: string
}

interface DiffData {
  oldCode: string
  newCode: string
  oldLabel?: string
  newLabel?: string
  language?: string
}

interface ResultData {
  sessionId?: string
  success?: boolean
  error?: string
  output?: string
  response?: string
  text?: string
  aiOutput?: string
  data?: {
    analysis?: string
    output?: string
    operation?: string
    toolId?: string
    parameters?: Record<string, unknown>
    title?: string
    sessionId?: string
  }
  tool_results?: Array<{ tool: string; result?: unknown; error?: string }>
  risks?: RiskItem[]
  diff?: DiffData
  finishReason?: string
  preview?: EditPreview
  timelineAction?: TimelineAction
  editOperations?: EditOperation[]
  transactionId?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  msgType: MsgType
  toolCalls?: string[]
  timestamp: number
  reasoning?: string
  toolName?: string
  toolStatus?: ToolStatus
  toolMessage?: string
  phase?: Phase
  toolPhaseName?: string
  finished: boolean
  stepNumber?: number
  statusText?: string
  toolInputParams?: Record<string, unknown>
  toolOutputResult?: unknown
  toolErrorMessage?: string
  diffData?: DiffData
  risks?: RiskItem[]
  previewData?: EditPreview
  timelineActionData?: TimelineAction
  editOperationsData?: EditOperation[]
  transactionId?: string
  questionData?: QuestionData
}

interface IntentFormOption {
  id: string
  label: string
  description: string
}

interface IntentFormData {
  formId: string
  message: string
  options: IntentFormOption[]
  allowCustomInput?: boolean
  customInputPlaceholder?: string
}

interface StreamEvent {
  type: 'text-delta' | 'text-start' | 'text-end' | 'tool-start' | 'tool-end' | 'tool-error'
  | 'step-start' | 'step-end' | 'reasoning-delta' | 'error' | 'permission-request' | 'intent-form-required'
  | 'question-request'
  | 'nudge'
  toolName?: string
  error?: string
  delta?: string
  text?: string
  args?: unknown
  result?: unknown
  step?: number
  finishReason?: string
  request?: PermissionRequestData
  nudge?: { type: string; message: string }
  formId?: string
  message?: string
  options?: IntentFormOption[]
  allowCustomInput?: boolean
  customInputPlaceholder?: string
  questions?: Array<{
    question: string
    header?: string
    options: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

type MessageGroup =
  | { type: 'message'; message: ChatMessage; contextUserContent: string }
  | { type: 'tool-chain'; items: ToolCallItem[]; contextUserContent: string }

interface PermissionRequestData {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  toolID?: string
  metadata: Record<string, unknown>
  alwaysPatterns: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SCROLL_THRESHOLD = 60
const SESSION_STORAGE_PREFIX = 'jianjicode_session_'

let _jianjicodeUrl = ''
let _jianjicodeToken = ''
async function getJianjiCodeUrl(): Promise<string> {
  try {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getJianjicode) {
      const jianjicode = await (window as any).electronAPI.getJianjicode()
      _jianjicodeUrl = jianjicode?.url || 'http://localhost:3001'
      _jianjicodeToken = jianjicode?.token || ''
    } else {
      _jianjicodeUrl = 'http://localhost:3001'
    }
  } catch {
    _jianjicodeUrl = _jianjicodeUrl || 'http://localhost:3001'
  }
  return _jianjicodeUrl
}
function jianjicodeHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  if (_jianjicodeToken) h['Authorization'] = `Bearer ${_jianjicodeToken}`
  return h
}

let msgSeq = 0
function nextMsgId(prefix: string): string {
  return `${prefix}-${++msgSeq}-${Date.now()}`
}

function getEmotionState(phase: Phase, finished: boolean): 'thinking' | 'tool' | 'writing' | 'success' | 'error' {
  if (finished) return 'success'
  if (phase === 'thinking') return 'thinking'
  if (phase === 'calling-tool') return 'tool'
  if (phase === 'writing') return 'writing'
  return 'thinking'
}

function groupMessages(msgs: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  let i = 0
  let lastUserContent = ''
  while (i < msgs.length) {
    const msg = msgs[i]
    if (msg.role === 'user') lastUserContent = msg.content
    // Pipeline messages stand alone
    if (msg.msgType === 'pipeline') {
      groups.push({ type: 'message', message: msg, contextUserContent: lastUserContent })
      i++
    } else if (msg.msgType === 'tool-start' || msg.msgType === 'tool-end' || msg.msgType === 'tool-error') {
      const toolItems: ToolCallItem[] = []
      while (i < msgs.length && (msgs[i].msgType === 'tool-start' || msgs[i].msgType === 'tool-end' || msgs[i].msgType === 'tool-error')) {
        const tm = msgs[i]
        toolItems.push({
          id: tm.id,
          toolName: tm.toolName || tm.content,
          status: (tm.toolStatus as ToolCallItem['status']) || 'pending',
          inputParams: tm.toolInputParams,
          outputResult: tm.toolOutputResult,
          errorMessage: tm.toolErrorMessage,
          timestamp: tm.timestamp,
        })
        i++
      }
      groups.push({ type: 'tool-chain', items: toolItems, contextUserContent: lastUserContent })
    } else {
      groups.push({ type: 'message', message: msg, contextUserContent: lastUserContent })
      i++
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// 上传编辑器素材文件到 jianjicode，替换路径为服务端可用路径
// ---------------------------------------------------------------------------

async function uploadEditorAssets(ctx: EditorContext, sessionId: string): Promise<EditorContext> {
  // 收集 assetId → 原始文件名的映射（保留扩展名）
  const nameMap = new Map<string, string>()
  if (ctx.mediaFiles) ctx.mediaFiles.forEach(m => { if (m.assetId) nameMap.set(m.assetId, m.name) })
  if (ctx.selectedClips) ctx.selectedClips.forEach(c => { if (c.assetId) nameMap.set(c.assetId, c.assetName) })
  if (ctx.timelineClips) ctx.timelineClips.forEach(c => { if (c.assetId) nameMap.set(c.assetId, c.assetName) })
  nameMap.delete('')

  if (nameMap.size === 0) return ctx

  const formData = new FormData()
  for (const [assetId, origName] of nameMap) {
    const blob = await getAssetBlob(assetId)
    if (blob) formData.append(assetId, blob, origName)
  }

  try {
    const url = `${await getJianjiCodeUrl()}/api/jianjicode/upload?sessionId=${encodeURIComponent(sessionId)}`
    const res = await fetch(url, { method: 'POST', headers: jianjicodeHeaders(), body: formData })
    if (!res.ok) return ctx
    const { files: serverPaths } = await res.json() as { files: Record<string, string> }

    const mapPath = (assetId: string, origPath: string) => serverPaths[assetId] || origPath

    return {
      ...ctx,
      mediaFiles: ctx.mediaFiles?.map(m => ({ ...m, path: mapPath(m.assetId, m.path) })),
      selectedClips: ctx.selectedClips?.map(c => ({ ...c, assetPath: mapPath(c.assetId, c.assetPath) })),
      timelineClips: ctx.timelineClips?.map(c => ({ ...c, assetPath: mapPath(c.assetId, c.assetPath) })),
    }
  } catch {
    return ctx // 上传失败不阻塞聊天，用原始路径
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  editorContext?: EditorContext
  onApplyResult?: (action: TimelineAction) => Promise<void>
  onDiscardResult?: () => void
  onReplayEditOperations?: (transactionId: string, ops: EditOperation[]) => Promise<void>
  activeSessionId?: string | null
  onSessionChange?: (id: string) => void
  onSelectSession?: (id: string) => void
  onNewChat?: () => void
  onNewSession?: () => void
  onUpdateSummary?: (summary: string) => void
  tabId?: string
  projectId?: string
  isActive?: boolean
  showHistoryPanel?: boolean
  onToggleHistoryPanel?: () => void
}

export function ChatPanel({ editorContext, onApplyResult, onDiscardResult, onReplayEditOperations, activeSessionId, onSessionChange, onSelectSession, onNewChat, onNewSession, onUpdateSummary, tabId, projectId, isActive, showHistoryPanel, onToggleHistoryPanel }: ChatPanelProps) {
  const { t } = useI18n()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pendingPermission, setPendingPermission] = useState<PermissionRequestData | null>(null)
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string[][]>>({})
  const [showIntentForm, setShowIntentForm] = useState(false)
  const [pendingIntent, setPendingIntent] = useState<IntentFormData | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const assistantMsgId = useRef<string | null>(null)
  const thinkingMsgId = useRef<string | null>(null)
  const streamText = useRef('')
  const streamReasoning = useRef('')
  const streamPhase = useRef<Phase>(null)
  const streamToolName = useRef<string | undefined>(undefined)
  const streamStepNumber = useRef(0)
  const textRafPending = useRef(false)
  const thinkRafPending = useRef(false)
  const userScrolledUp = useRef(false)

  const [collapsedReasoning, setCollapsedReasoning] = useState<Set<string>>(new Set())
  const [currentStep, setCurrentStep] = useState(0)
  const [nudgeMessages, setNudgeMessages] = useState<Array<{ id: string; type: string; message: string; data?: any }>>([])
  const [showHistoryInternal, setShowHistoryInternal] = useState(false)
  const showHistory = showHistoryPanel ?? showHistoryInternal
  useEffect(() => {
    if (showHistoryPanel !== undefined) setShowHistoryInternal(showHistoryPanel)
  }, [showHistoryPanel])
  const [hoveredGroupIndex, setHoveredGroupIndex] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0, active: false })
  const [headerExpanded, setHeaderExpanded] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [dotGridEnabled, setDotGridEnabled] = useState(() => {
    try { return localStorage.getItem('dotGridVisible') !== 'false' } catch { return true }
  })

  const toggleHeaderCollapsed = () => {
    setHeaderCollapsed(v => {
      localStorage.setItem('chatHeaderCollapsed', String(!v))
      return !v
    })
  }
  const toggleDotGrid = () => {
    setDotGridEnabled(v => {
      localStorage.setItem('dotGridVisible', String(!v))
      return !v
    })
  }

  const [contextStats, setContextStats] = useState<{
    estimatedTokens: number
    messageCount: number
    usagePercent: number
    compacting: boolean
  } | null>(null)
  const contextPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [inputAreaHeight, setInputAreaHeight] = useState<number | null>(null)
  const inputResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const chatPanelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Connect to nudge SSE stream for real-time skill/script creation prompts
  useEffect(() => {
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    async function connect() {
      try {
        const baseUrl = await getJianjiCodeUrl()
        es = new EventSource(`${baseUrl}/nudges/stream`)

        es.addEventListener('nudge', (event) => {
          try {
            const nudge = JSON.parse(event.data)
            setNudgeMessages(prev => [...prev, {
              id: nextMsgId('nudge'),
              type: nudge.type || 'info',
              message: nudge.message || '',
              data: nudge,
            }])
          } catch { /* ignore parse errors */ }
        })

        es.onerror = () => {
          es?.close()
          reconnectTimer = setTimeout(connect, 15000)
        }
      } catch {
        reconnectTimer = setTimeout(connect, 15000)
      }
    }

    connect()

    return () => {
      es?.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [])

  // Scroll to bottom when tab becomes visible (was display:none, scrollHeight was 0).
  // Uses ResizeObserver — event-driven, reliable regardless of layout timing.
  const scrolledVisibleRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !isActive) {
      scrolledVisibleRef.current = false
      return
    }
    // Already scrolled into view for this activation cycle
    if (scrolledVisibleRef.current) return

    const ro = new ResizeObserver(() => {
      if (el.scrollHeight > 0) {
        el.scrollTop = el.scrollHeight
        userScrolledUp.current = false
        scrolledVisibleRef.current = true
        ro.disconnect()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isActive])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Auto-save messages to localStorage when they change
  const persistInitializedRef = useRef(false)
  const sessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!persistInitializedRef.current) {
      persistInitializedRef.current = true
      return
    }
    if (messages.length === 0) return
    // Use ref for sessionId — synchronous, so StrictMode won't create two IDs
    if (!sessionIdRef.current) {
      sessionIdRef.current = generateSessionId()
      setSessionId(sessionIdRef.current)
      onSessionChange?.(sessionIdRef.current)
    }
    saveSession(sessionIdRef.current, messages as StoredMessage[], projectId)
  }, [messages, projectId])

  // Load session messages when activeSessionId changes
  useEffect(() => {
    if (activeSessionId !== undefined) {
      // Selected from history panel
      const msgs = getSessionMessages(activeSessionId)
      if (msgs.length > 0) {
        setMessages(msgs as ChatMessage[])
        setSessionId(activeSessionId)
        sessionIdRef.current = activeSessionId
        streamText.current = ''
        streamReasoning.current = ''
        assistantMsgId.current = null
        thinkingMsgId.current = null
      }
      return
    }
    // activeSessionId is undefined → initial mount, try restore from tabId mapping
    if (!tabId) return
    const storageKey = SESSION_STORAGE_PREFIX + tabId
    try {
      const saved = localStorage.getItem(storageKey)
      if (!saved) return
      const { sessionId: savedId } = JSON.parse(saved)
      if (!savedId) return
      const msgs = getSessionMessages(savedId)
      if (msgs.length > 0) {
        setMessages(msgs as ChatMessage[])
        setSessionId(savedId)
        sessionIdRef.current = savedId
        onSessionChange?.(savedId)
        streamText.current = ''
        streamReasoning.current = ''
        assistantMsgId.current = null
        thinkingMsgId.current = null
      }
    } catch { /* corrupted data */ }
  }, [activeSessionId, tabId])

  // Persist tabId → sessionId mapping for multi-tab restore
  useEffect(() => {
    if (!tabId || !sessionId) return
    const storageKey = SESSION_STORAGE_PREFIX + tabId
    localStorage.setItem(storageKey, JSON.stringify({ sessionId }))
  }, [sessionId, tabId])

  // Reset textarea height when input becomes empty
  useEffect(() => {
    if (!input && inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [input])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    userScrolledUp.current = (scrollHeight - scrollTop - clientHeight) > AUTO_SCROLL_THRESHOLD
  }, [])

  // -----------------------------------------------------------------------
  // Streaming: flush via rAF, prevent overlapping frames
  // -----------------------------------------------------------------------

  const flushStreamState = useCallback(() => {
    const id = assistantMsgId.current
    if (!id || textRafPending.current) return
    textRafPending.current = true
    requestAnimationFrame(() => {
      textRafPending.current = false
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === id)
        // Lazy-create the assistant text message on first text-delta
        if (idx === -1) {
          // Only create if this is still the active assistant message ID.
          // Stale IDs (replaced by a later step-start) must not create orphan
          // messages that never get finalized and show a perpetual loading chip.
          if (id !== assistantMsgId.current) return prev
          if (!streamText.current) return prev
          const newMsg: ChatMessage = {
            id,
            role: 'assistant',
            content: streamText.current,
            msgType: 'text',
            timestamp: Date.now(),
            finished: false,
            phase: streamPhase.current,
            toolPhaseName: streamToolName.current,
            stepNumber: streamStepNumber.current,
          }
          return [...prev, newMsg]
        }
        const m = prev[idx]
        // Don't revert a message already finalized by handleResult
        if (m.finished) return prev
        const updated = {
          ...m,
          content: streamText.current,
          phase: streamPhase.current,
          toolPhaseName: streamToolName.current,
          finished: false,
          stepNumber: streamStepNumber.current || m.stepNumber,
        }
        if (updated.content === m.content && updated.phase === m.phase) {
          return prev
        }
        const next = [...prev]
        next[idx] = updated
        return next
      })
    })
  }, [])

  const flushThinkingBlock = useCallback(() => {
    const id = thinkingMsgId.current
    if (!id) return
    if (thinkRafPending.current) return
    thinkRafPending.current = true
    requestAnimationFrame(() => {
      thinkRafPending.current = false
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === id)
        if (idx === -1) {
          // Create new thinking block
          const newMsg: ChatMessage = {
            id,
            role: 'assistant',
            content: streamReasoning.current,
            msgType: 'thinking',
            timestamp: Date.now(),
            finished: false,
            phase: 'thinking',
            stepNumber: streamStepNumber.current,
          }
          return [...prev, newMsg]
        }
        const m = prev[idx]
        if (m.content === streamReasoning.current) return prev
        if (!streamReasoning.current && m.finished) return prev
        const next = [...prev]
        next[idx] = { ...m, content: streamReasoning.current, stepNumber: streamStepNumber.current || m.stepNumber }
        return next
      })
    })
  }, [])

  // -----------------------------------------------------------------------
  // SSE parsing
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
  // Send message
  // -----------------------------------------------------------------------

  const sendMessageWithIntent = async (text: string, intent?: string, _additionalInfo?: string) => {
    abortRef.current?.abort()

    const userMsg: ChatMessage = {
      id: nextMsgId('msg'),
      role: 'user',
      content: intent ? `[${intent}] ${text}` : text,
      msgType: 'text',
      timestamp: Date.now(),
      finished: true,
    }
    const aId = nextMsgId('ai')
    const tId = nextMsgId('think')
    assistantMsgId.current = aId
    thinkingMsgId.current = tId
    streamText.current = ''
    streamReasoning.current = ''
    streamPhase.current = 'thinking'
    streamToolName.current = undefined
    streamStepNumber.current = 0
    userScrolledUp.current = false

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    if (messages.length === 0 && text.length > 0) {
      const short = text.length > 60 ? text.slice(0, 60) + '...' : text
      onUpdateSummary?.(short)
    }

    try {
      const controller = new AbortController()
      abortRef.current = controller

      // 上传编辑器素材文件到 jianjicode，替换为服务端路径
      const tempSessionId = `upload-${Date.now().toString(36)}`
      const ctx = editorContext
        ? await uploadEditorAssets(editorContext, tempSessionId)
        : undefined

      const response = await fetch(`${await getJianjiCodeUrl()}/api/jianjicode/chat/stream`, {
        method: 'POST',
        headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: text, editorContext: ctx ?? undefined, sessionId, projectId }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error('SSE connection failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let boundaryIdx: number
        while ((boundaryIdx = buffer.indexOf('\n\n')) !== -1) {
          const part = buffer.slice(0, boundaryIdx)
          buffer = buffer.slice(boundaryIdx + 2)

          const parsed = parseSSE(part)
          if (!parsed) continue

          if (parsed.event === 'stream') {
            try {
              const ev: StreamEvent = JSON.parse(parsed.data)
              handleStreamEvent(ev, aId)
            } catch (e) {
              logger.warn(`[ChatPanel] Failed to parse SSE stream event: ${(e as Error).message}`)
            }
          } else if (parsed.event === 'result') {
            try {
              await handleResult(JSON.parse(parsed.data) as ResultData, assistantMsgId.current || aId)
            } catch (e) {
              logger.warn(`[ChatPanel] Failed to parse SSE result event: ${(e as Error).message}`)
            }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return
      logger.warn(`[ChatPanel] SSE failed: ${err}`)
      const errorMessage = err instanceof Error ? err.message : String(err)
      streamText.current = t('chat.errorConnection', { message: errorMessage })
      streamPhase.current = null
      flushStreamState()
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    sendMessageWithIntent(text)
  }

  const handleStop = () => {
    abortRef.current?.abort()
    if (assistantMsgId.current) {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId.current ? { ...m, finished: true } : m,
      ))
    }
    if (thinkingMsgId.current) {
      setMessages(prev => prev.map(m =>
        m.id === thinkingMsgId.current ? { ...m, finished: true } : m,
      ))
    }
  }

  const handleNewSession = () => {
    // Save current session before switching to new tab
    if (sessionIdRef.current && messages.length > 0) {
      saveSessionNow(sessionIdRef.current, messages as StoredMessage[])
    }
  }

  // -----------------------------------------------------------------------
  // Context ring — 上下文用量显示与压缩
  // -----------------------------------------------------------------------

  const fetchContextStats = useCallback(async () => {
    if (!sessionId) return
    try {
      const res = await fetch(
        `${await getJianjiCodeUrl()}/api/jianjicode/sessions/${encodeURIComponent(sessionId)}/stats`,
        { headers: jianjicodeHeaders() },
      )
      if (!res.ok) return
      const json = await res.json()
      if (json.success) {
        setContextStats(prev => ({
          ...json.data,
          compacting: prev?.compacting ?? false,
        }))
      }
    } catch {
      // 静默失败 — context ring 是辅助功能
    }
  }, [sessionId])

  const handleCompactContext = useCallback(async () => {
    if (!sessionId) return
    setContextStats(prev => prev ? { ...prev, compacting: true } : null)
    try {
      const res = await fetch(
        `${await getJianjiCodeUrl()}/api/jianjicode/sessions/${encodeURIComponent(sessionId)}/compact`,
        { method: 'POST', headers: jianjicodeHeaders() },
      )
      if (res.ok) {
        // 压缩后立即刷新统计
        await fetchContextStats()
      }
    } catch {
      // 静默失败
    } finally {
      setContextStats(prev => prev ? { ...prev, compacting: false } : null)
    }
  }, [sessionId, fetchContextStats])

  // 定时轮询 + sessionId 变化时立即拉取
  useEffect(() => {
    fetchContextStats()
    contextPollRef.current = setInterval(fetchContextStats, 15_000)
    return () => {
      if (contextPollRef.current) clearInterval(contextPollRef.current)
    }
  }, [fetchContextStats])

  // -----------------------------------------------------------------------
  // Permission reply
  // -----------------------------------------------------------------------

  const sendPermissionReply = async (action: 'allow_once' | 'allow_always' | 'deny') => {
    const req = pendingPermission
    if (!req) return
    try {
      await fetch(`${await getJianjiCodeUrl()}/permission/reply`, {
        method: 'POST',
        headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ requestID: req.id, action }),
      })
    } catch (err) {
      logger.error(`[ChatPanel] Permission reply failed: ${err}`)
    }
    setPendingPermission(null)
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  const handleStreamEvent = (ev: StreamEvent, _aId: string) => {
    switch (ev.type) {
      case 'text-start':
        // Flush any open thinking block before text begins for this step
        if (thinkingMsgId.current && streamReasoning.current) {
          setMessages(prev =>
            prev.map(m => m.id === thinkingMsgId.current ? { ...m, finished: true } : m),
          )
        }
        streamReasoning.current = ''
        thinkingMsgId.current = null
        break

      case 'text-delta': {
        streamText.current += ev.delta || ''
        if (streamPhase.current !== 'calling-tool') {
          streamPhase.current = 'writing'
        }
        flushStreamState()
        break
      }

      case 'text-end': {
        if (ev.text) streamText.current = ev.text
        flushStreamState()
        break
      }

      case 'reasoning-delta': {
        streamReasoning.current += ev.delta || ''
        streamPhase.current = 'thinking'
        // Ensure a thinking block exists
        if (!thinkingMsgId.current) {
          thinkingMsgId.current = nextMsgId('think')
        }
        flushThinkingBlock()
        break
      }

      case 'tool-start': {
        // Flush thinking block before tool call
        if (thinkingMsgId.current && streamReasoning.current) {
          setMessages(prev =>
            prev.map(m => m.id === thinkingMsgId.current ? { ...m, finished: true } : m),
          )
          streamReasoning.current = ''
          thinkingMsgId.current = null
        }
        streamPhase.current = 'calling-tool'
        streamToolName.current = ev.toolName
        flushStreamState()
        // Pipeline status: tool start
        setMessages(prev => [...prev, {
          id: nextMsgId('pipe'),
          role: 'assistant',
          content: `${t('chat.pipeline.callingTool', { tool: ev.toolName || 'unknown' })}`,
          msgType: 'pipeline',
          timestamp: Date.now(),
          finished: true,
          statusText: 'tool-start',
          toolName: ev.toolName,
          stepNumber: streamStepNumber.current,
        }])
        const toolMsg: ChatMessage = {
          id: nextMsgId('tool'),
          role: 'assistant',
          content: ev.toolName || 'unknown',
          msgType: 'tool-start',
          toolName: ev.toolName,
          toolStatus: 'running',
          toolMessage: t('chat.toolRunning'),
          toolInputParams: ev.args as Record<string, unknown> | undefined,
          timestamp: Date.now(),
          finished: false,
        }
        setMessages(prev => [...prev, toolMsg])
        break
      }

      case 'tool-end': {
        streamPhase.current = 'writing'
        streamToolName.current = undefined
        flushStreamState()
        setMessages(prev =>
          prev.map(m =>
            m.msgType === 'tool-start' && m.toolName === ev.toolName && m.toolStatus === 'running'
              ? { ...m, msgType: 'tool-end', toolStatus: 'done', toolMessage: t('chat.toolDone'), content: ev.toolName || m.content, finished: true, statusText: t('chat.toolDone'), toolOutputResult: ev.result }
              : m,
          ),
        )
        break
      }

      case 'tool-error': {
        streamPhase.current = 'writing'
        streamToolName.current = undefined
        flushStreamState()
        setMessages(prev =>
          prev.map(m =>
            m.msgType === 'tool-start' && m.toolName === ev.toolName && m.toolStatus === 'running'
              ? { ...m, msgType: 'tool-error', toolStatus: 'error', toolMessage: ev.error || t('chat.toolError'), content: ev.toolName || m.content, finished: true, statusText: t('chat.toolError'), toolErrorMessage: ev.error }
              : m,
          ),
        )
        break
      }

      case 'permission-request':
        if (ev.request) setPendingPermission(ev.request)
        break

      case 'question-request':
        if (ev.requestId && ev.questions) {
          setMessages(prev => [...prev, {
            id: nextMsgId('question'),
            role: 'assistant',
            content: '',
            msgType: 'text',
            timestamp: Date.now(),
            finished: true,
            questionData: { requestId: ev.requestId!, questions: ev.questions! },
          }])
        }
        break

      case 'intent-form-required': {
        setPendingIntent({
          formId: ev.formId || '',
          message: ev.message || '',
          options: ev.options || [],
          allowCustomInput: ev.allowCustomInput,
          customInputPlaceholder: ev.customInputPlaceholder,
        })
        setShowIntentForm(true)
        break
      }

      case 'step-start':
    streamStepNumber.current = ev.step || 1
    setCurrentStep(ev.step || 1)
    // Finalize previous thinking block if any
    if (thinkingMsgId.current && streamReasoning.current) {
      setMessages(prev =>
        prev.map(m => m.id === thinkingMsgId.current ? { ...m, finished: true } : m),
      )
    }
    // Finalize the previous step's text message and start a fresh one
    // so each agent step gets its own chat bubble.
    if (streamText.current && assistantMsgId.current) {
      setMessages(prev =>
        prev.map(m => m.id === assistantMsgId.current ? { ...m, finished: true } : m),
      )
    }
    streamText.current = ''
    assistantMsgId.current = nextMsgId('ai')
    // Reset reasoning for new step, create fresh thinking block ID
    streamReasoning.current = ''
    thinkingMsgId.current = nextMsgId('think')
    // Pipeline status: step start
    setMessages(prev => [...prev, {
      id: nextMsgId('pipe'),
      role: 'assistant',
      content: `${t('chat.pipeline.stepStart', { step: String(ev.step || 1) })}`,
      msgType: 'pipeline',
      timestamp: Date.now(),
      finished: true,
      stepNumber: ev.step || 1,
      statusText: 'step-start',
    }])
    break

      case 'step-end':
        // Flush any remaining thinking block for this step
        if (thinkingMsgId.current && streamReasoning.current) {
          setMessages(prev =>
            prev.map(m => m.id === thinkingMsgId.current ? { ...m, finished: true } : m),
          )
          thinkingMsgId.current = null
          streamReasoning.current = ''
        }
        break

      case 'nudge':
        if (ev.nudge) {
          setNudgeMessages(prev => [...prev, {
            id: nextMsgId('nudge'),
            type: ev.nudge!.type,
            message: ev.nudge!.message,
          }])
        }
        break

      case 'error':
        streamText.current += `\n\n[Error: ${ev.error}]`
        flushStreamState()
        break
    }
  }

  const handleResult = async (result: ResultData, aId: string) => {
    const data = result ?? {}

    // 保存 sessionId 以支持多轮对话上下文
    if (data.sessionId) {
      setSessionId(data.sessionId)
    }

    // Extract text from server response: try multiple field names (server sends ChatResult format)
    const fromServer = data.response || data.text || data.output || data.aiOutput || data.data?.output || data.data?.analysis || ""
    const hasError = data.success === false && !!data.error
    const finalText = hasError
      ? `❌ ${data.error}`
      : (fromServer && fromServer.length > (streamText.current?.length || 0))
        ? fromServer
        : streamText.current || t('chat.taskComplete')

    const toolCalls: string[] = []
    if (Array.isArray(data.tool_results)) {
      for (const tr of data.tool_results) {
        if (tr.tool) toolCalls.push(tr.tool)
      }
    }

    // Finalize any open thinking block
    if (thinkingMsgId.current) {
      setMessages(prev =>
        prev.map(m => m.id === thinkingMsgId.current ? { ...m, finished: true } : m),
      )
      thinkingMsgId.current = null
    }

    streamPhase.current = null
    streamToolName.current = undefined
    streamStepNumber.current = 0
    setCurrentStep(0)

    // Collapse all thinking blocks after completion
    const allThinkingIds = new Set<string>()
    setMessages(prev => {
      for (const m of prev) {
        if (m.msgType === 'thinking' && m.content) {
          allThinkingIds.add(m.id)
        }
      }
      return prev
    })
    if (allThinkingIds.size > 0) {
      setCollapsedReasoning(prev => new Set([...prev, ...allThinkingIds]))
    }

    const toolResults = data.tool_results || []

    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === aId)
      if (idx === -1) {
        // Last step had no text — create the message now so result card is shown
        const newMsg: ChatMessage = {
          id: aId,
          role: 'assistant',
          content: finalText,
          msgType: 'text',
          timestamp: Date.now(),
          finished: true,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          diffData: data.diff,
          risks: data.risks,
          previewData: data.preview,
          timelineActionData: data.timelineAction,
          editOperationsData: data.editOperations,
          transactionId: data.transactionId || `txn_${Date.now()}`,
        }
        return [...prev, newMsg]
      }
      return prev.map(m => m.id === aId
        ? {
            ...m,
            content: finalText,
            phase: null,
            toolPhaseName: undefined,
            finished: true,
            toolCalls: toolCalls.length > 0 ? toolCalls : m.toolCalls,
            diffData: data.diff,
            risks: data.risks,
            previewData: data.preview,
            timelineActionData: data.timelineAction,
            editOperationsData: data.editOperations || m.editOperationsData,
            transactionId: data.transactionId || m.transactionId,
          }
        : m,
      )
    })

    // Inline session summary — no toast/popup
    const summaryParts: string[] = []
    summaryParts.push(t('chat.sessionSummary'))
    if (toolResults.length > 0) {
      const doneTools = toolResults.filter(tr => !tr.error).map(tr => tr.tool)
      const errorTools = toolResults.filter(tr => tr.error).map(tr => tr.tool)
      if (doneTools.length > 0) {
        summaryParts.push(`${t('chat.toolsExecuted')}: ${doneTools.join(', ')}`)
      }
      if (errorTools.length > 0) {
        summaryParts.push(`${t('chat.toolsFailed')}: ${errorTools.join(', ')}`)
      }
    }
    if (finalText && finalText !== t('chat.taskComplete')) {
      summaryParts.push(t('chat.responseGenerated'))
    }
    const summaryContent = summaryParts.join(' · ')

    const summaryMsg: ChatMessage = {
      id: nextMsgId('summary'),
      role: 'assistant',
      content: summaryContent,
      msgType: 'text',
      timestamp: Date.now(),
      finished: true,
      phase: null,
    }
    setMessages(prev => [...prev, summaryMsg])
  }

  // -----------------------------------------------------------------------
  // Keyboard
  // -----------------------------------------------------------------------

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = chatPanelRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const currentHeight = inputAreaHeight ?? container.clientHeight * 0.3
    inputResizeRef.current = { startY: e.clientY, startHeight: currentHeight }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [inputAreaHeight])

  useEffect(() => {
    const ref = inputResizeRef
    const handleMove = (e: MouseEvent) => {
      if (!ref.current) return
      const container = chatPanelRef.current
      if (!container) return
      const deltaY = ref.current.startY - e.clientY
      const maxH = container.clientHeight - 120
      const newHeight = Math.min(maxH, Math.max(80, ref.current.startHeight + deltaY))
      setInputAreaHeight(newHeight)
    }
    const handleUp = () => {
      ref.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  const handleResetInputHeight = useCallback(() => {
    setInputAreaHeight(null)
  }, [])

  const toggleReasoning = (id: string) => {
    setCollapsedReasoning(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const isWaitingForInput = pendingPermission !== null
  const msgGroups = groupMessages(messages)
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()
  const headerText = (hoveredGroupIndex != null && hoveredGroupIndex < msgGroups.length
    ? msgGroups[hoveredGroupIndex].contextUserContent
    : lastUserMsg?.content) || ''
  const hasUserContent = headerText.length > 0

  if (showHistory) {
    return (
      <HistoryPanel
        projectId={projectId}
        onBack={() => { setShowHistoryInternal(false); onToggleHistoryPanel?.() }}
        onSelectSession={(id) => {
          onSelectSession?.(id)
          setShowHistoryInternal(false); onToggleHistoryPanel?.()
        }}
        onNewChat={() => {
          onNewChat?.()
          setShowHistoryInternal(false); onToggleHistoryPanel?.()
        }}
      />
    )
  }

  return (
    <div
      ref={chatPanelRef}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#12121a', position: 'relative', overflow: 'hidden', userSelect: 'text', WebkitAppRegion: 'no-drag' as any }}
      onMouseMove={e => {
        const rect = chatPanelRef.current?.getBoundingClientRect()
        if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top, active: true })
      }}
      onMouseEnter={e => {
        const rect = chatPanelRef.current?.getBoundingClientRect()
        if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top, active: true })
      }}
      onMouseLeave={() => setMousePos(prev => ({ ...prev, active: false }))}
    >
      {dotGridEnabled && <DotGrid mx={mousePos.x} my={mousePos.y} active={mousePos.active} />}
      {/* Claude Code-style task header — collapsible */}
      <div style={{
        overflow: 'hidden',
        flexShrink: 0,
        position: 'relative',
        zIndex: 2,
        borderBottom: headerCollapsed ? 'none' : '1px solid #2a2a3e',
        transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease',
        maxHeight: headerCollapsed ? '0px' : (headerExpanded ? '200px' : '42px'),
      }}>
        <div
          className="chat-header-area"
          style={{
            display: 'flex',
            alignItems: headerExpanded ? 'flex-start' : 'center',
            gap: '10px',
            padding: '10px 16px',
            background: '#16161e',
          minHeight: '42px',
          position: 'relative',
        }}>
          <button
            onClick={toggleHeaderCollapsed}
            title="Collapse header"
            style={{
              color: '#5ec4d0',
              fontFamily: 'monospace',
              fontSize: '13px',
              fontWeight: 700,
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0 4px 0 0',
              lineHeight: 1,
            }}
          >&gt;</button>
          <span style={{
            flex: 1,
            fontSize: '12px',
            color: '#9ca3af',
            whiteSpace: headerExpanded ? 'normal' : 'nowrap',
            overflow: headerExpanded ? 'visible' : 'hidden',
            textOverflow: headerExpanded ? 'unset' : 'ellipsis',
          }}>
            {headerText || t('chat.title')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {/* DotGrid toggle */}
            <button
              onClick={toggleDotGrid}
              title={dotGridEnabled ? 'Hide background' : 'Show background'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '2px', borderRadius: '3px', display: 'flex',
                color: dotGridEnabled ? '#5ec4d0' : '#6b7280',
                transition: 'color 0.2s ease',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="6" cy="6" r="2.5" />
              </svg>
            </button>
            <button
              onClick={() => {
                const text = messages.filter(m => m.role === 'assistant' && m.msgType !== 'tool-start' && m.msgType !== 'tool-end' && m.msgType !== 'pipeline').map(m => m.content).filter(Boolean).join('\n\n')
                if (text) navigator.clipboard.writeText(text).then(() => document.dispatchEvent(new Event('copy')))
              }}
              title="复制 AI 回复"
              disabled={!messages.some(m => m.role === 'assistant')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', borderRadius: '3px', display: 'flex', color: '#6b7280', opacity: messages.some(m => m.role === 'assistant') ? 1 : 0.3 }}
            ><Copy style={{ width: '13px', height: '13px' }} /></button>
            {/* Dev: test QuestionForm */}
            <button
              onClick={() => setMessages(prev => [...prev, {
                id: nextMsgId('question'),
                role: 'assistant', content: '',
                msgType: 'text', timestamp: Date.now(), finished: true,
                questionData: { requestId: `test-${Date.now()}`,
                  questions: [
                    { header: '编辑操作', question: '您希望对视频进行什么处理？', options: [{ label: '调色', description: '应用 LUT 色彩分级' }, { label: '裁剪 (推荐)', description: '按时间范围裁剪视频' }, { label: '变速', description: '调整视频播放速度' }] },
                    { header: '输出设置', question: '选择输出格式？', options: [{ label: 'MP4', description: 'H.264 编码' }, { label: 'MOV', description: 'ProRes 编码' }] },
                  ],
                },
              }])}
              title="测试 AskUserQuestion"
              style={{ background: 'none', border: '1px dashed rgba(139,92,246,0.3)', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '3px', color: '#a78bfa', fontSize: '10px' }}
            >Ask</button>
            {loading && <Loader2 style={{ width: '14px', height: '14px', color: '#3b82f6', animation: 'spin 1s linear infinite' }} />}
            {currentStep > 0 && (
              <span style={{
                fontSize: '10px',
                color: '#38b2c8',
                background: 'rgba(56, 178, 200, 0.1)',
                border: '1px solid rgba(56, 178, 200, 0.2)',
                borderRadius: '4px',
                padding: '2px 6px',
              }}>
                Step {currentStep}
              </span>
            )}
            {hasUserContent && (
              <button
                onClick={() => setHeaderExpanded(v => !v)}
                style={{
                  background: 'rgba(42, 42, 62, 0.4)',
                  border: '1px solid rgba(42, 42, 62, 0.6)',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}>
                {headerExpanded ? t('chat.collapse') : t('chat.more')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Floating handle — visible when header collapsed */}
      {headerCollapsed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '6px 0',
          flexShrink: 0,
          position: 'relative', zIndex: 2,
        }}>
          <button
            onClick={toggleHeaderCollapsed}
            title="Expand header"
            style={{
              width: '28px', height: '18px',
              borderRadius: '4px',
              background: 'rgba(94,196,208,0.08)',
              border: '1px solid rgba(94,196,208,0.15)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(94,196,208,0.15)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(94,196,208,0.35)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(94,196,208,0.08)'
              ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(94,196,208,0.15)'
            }}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="#5ec4d0" strokeWidth="1.5">
              <path d="M2 1.5l3 3 3-3" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        <ErrorBoundary>
          {messages.length === 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '20px',
              color: '#6b7280',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Decorative backdrop glow */}
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '200px',
                height: '200px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(59,130,246,0.04) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />
              <div style={{
                position: 'absolute',
                top: '30%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(56,178,200,0.03) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, rgba(30,30,46,0.9) 0%, rgba(24,24,37,0.9) 100%)',
                border: '1px solid rgba(42,42,62,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px rgba(59,130,246,0.06)',
                position: 'relative',
                zIndex: 1,
              }}>
                <Bot style={{ width: '24px', height: '24px', color: '#3b82f6' }} />
              </div>
              <p style={{
                fontSize: '13px',
                color: '#9ca3af',
                margin: 0,
                lineHeight: '1.6',
                maxWidth: '260px',
                position: 'relative',
                zIndex: 1,
              }}>{t('chat.emptyDescription')}</p>
            </div>
          )}

          {msgGroups.map((group, gi) => {
            return group.type === 'tool-chain' ? (
              <div
                key={`chain-${gi}`}
                style={{ paddingLeft: '24px', paddingRight: '4px', position: 'relative' }}
                onMouseEnter={() => setHoveredGroupIndex(gi)}
                >
                <ToolCallChain items={group.items} />
              </div>
            ) : group.message.msgType === 'pipeline' ? (
              <div
                key={group.message.id}
                onMouseEnter={() => setHoveredGroupIndex(gi)}
                >
                <PipelineStatusItem msg={group.message} />
              </div>
            ) : group.message.msgType === 'thinking' ? (
              <div
                key={group.message.id}
                onMouseEnter={() => setHoveredGroupIndex(gi)}
                >
                <ThinkingBlockItem
                  msg={group.message}
                  isStreaming={loading && group.message.id === thinkingMsgId.current && !group.message.finished}
                  collapsed={collapsedReasoning.has(group.message.id)}
                  onToggle={() => toggleReasoning(group.message.id)}
                />
              </div>
            ) : (
              <div
                key={group.message.id}
                onMouseEnter={() => setHoveredGroupIndex(gi)}
                >
                <MessageItem
                  msg={group.message}
                  isStreaming={loading && group.message.id === assistantMsgId.current && !group.message.finished}
                  reasoningCollapsed={collapsedReasoning.has(group.message.id)}
                  onToggleReasoning={() => toggleReasoning(group.message.id)}
                  onApplyResult={onApplyResult}
                  onDiscardResult={onDiscardResult}
                  onReplayEditOperations={onReplayEditOperations}
                  showTimeline={true}
                  questionAnswers={questionAnswers}
                  onQuestionReply={async (requestId, answers) => {
                    setQuestionAnswers(prev => ({ ...prev, [requestId]: answers }))
                    // Show answer as user message in chat
                    setMessages(prev => [...prev, {
                      id: nextMsgId('answer'),
                      role: 'user', content: answers.flat().join(', ') || '(已选择)',
                      msgType: 'text', timestamp: Date.now(), finished: true,
                    }])
                    try {
                      await fetch(`${await getJianjiCodeUrl()}/question/reply`, {
                        method: 'POST',
                        headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({ requestId, answers }),
                      })
                    } catch (err) {
                      logger.error(`[ChatPanel] Question reply failed: ${err}`)
                    }
                  }}
                />
              </div>
            )
          })}

          {loading && !messages.find(m => m.id === assistantMsgId.current) && (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', paddingLeft: '4px' }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#5ec4d0',
                flexShrink: 0,
                marginTop: '10px',
                boxShadow: '0 0 6px rgba(94,196,208,0.25)',
              }} />
              <div style={{
                background: '#181825',
                border: '1px solid #2a2a3e',
                borderRadius: '8px',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Loader2 style={{ width: '14px', height: '14px', color: '#6b7280', animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          )}
        </ErrorBoundary>
      </div>

      {/* Nudge messages */}
      {nudgeMessages.length > 0 && (
        <div style={{
          padding: '6px 14px',
          borderTop: '1px solid rgba(56, 178, 200, 0.15)',
          background: 'linear-gradient(135deg, rgba(56, 178, 200, 0.04) 0%, rgba(56, 178, 200, 0.02) 100%)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '120px',
          overflowY: 'auto'
        }}>
          {nudgeMessages.map(n => (
            <div key={n.id} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
              fontSize: '11px',
              color: '#5ec4d0'
            }}>
              <Lightbulb style={{ width: '12px', height: '12px', flexShrink: 0, marginTop: '1px', color: '#38b2c8' }} />
              <span style={{ flex: 1, lineHeight: '1.4' }}>{n.message}</span>
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                {n.type === 'create-confirm' ? (
                  <>
                    <button
                      onClick={async () => {
                        try {
                          const baseUrl = await getJianjiCodeUrl()
                          await fetch(`${baseUrl}/nudges/accept`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: n.data?.name || '' }),
                          })
                        } catch { /* best effort */ }
                        setNudgeMessages(prev => prev.filter(x => x.id !== n.id))
                      }}
                      style={{
                        background: 'rgba(139, 92, 246, 0.2)',
                        border: '1px solid rgba(139, 92, 246, 0.3)',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        padding: '1px 6px',
                        color: '#c4b5fd',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      保存
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const baseUrl = await getJianjiCodeUrl()
                          await fetch(`${baseUrl}/nudges/dismiss`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: n.data?.name || '' }),
                          })
                        } catch { /* best effort */ }
                        setNudgeMessages(prev => prev.filter(x => x.id !== n.id))
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '1px 4px',
                        color: '#6b7280',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      忽略
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setNudgeMessages(prev => prev.filter(x => x.id !== n.id))}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '1px',
                      color: '#6b7280',
                      flexShrink: 0
                    }}
                  >
                    <XIcon style={{ width: '10px', height: '10px' }} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Waiting indicator */}
      {isWaitingForInput && (
        <div style={{
          padding: '8px 14px',
          borderTop: '1px solid #f59e0b33',
          background: 'linear-gradient(135deg, #f59e0b08 0%, #f59e0b05 100%)',
          flexShrink: 0
        }}>
          <span style={{ fontSize: '11px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldAlert style={{ width: '14px', height: '14px' }} />
            {t('permission.title')}
          </span>
        </div>
      )}

      {/* Input resize handle */}
      <div
        onMouseDown={handleInputResizeStart}
        onDoubleClick={handleResetInputHeight}
        style={{
          height: '6px',
          flexShrink: 0,
          cursor: 'row-resize',
          background: 'transparent',
          borderTop: '1px solid transparent',
          transition: 'border-color 0.15s, background 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderTopColor = 'rgba(59,130,246,0.4)'
          e.currentTarget.style.background = 'rgba(59,130,246,0.06)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderTopColor = 'transparent'
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <div style={{
          width: '32px',
          height: '3px',
          borderRadius: '2px',
          background: 'rgba(100,100,120,0.3)',
          transition: 'background 0.15s',
        }} />
      </div>

      {/* Input area — anchored at bottom, expands upward */}
      <div style={{
        position: 'relative', zIndex: 1,
        padding: (inputFocused || input.trim()) ? '14px 8%' : '14px 20%',
        borderTop: '1px solid transparent',
        transition: 'padding 0.3s ease',
        flexShrink: 0,
        ...(inputAreaHeight !== null ? { height: inputAreaHeight, overflowY: 'auto' } : {}),
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: '8px',
        }}>
          <div style={{
            flex: 1, position: 'relative',
            background: 'linear-gradient(180deg, rgba(20,26,38,0.85) 0%, rgba(14,20,30,0.9) 100%)',
            borderRadius: '12px', overflow: 'hidden',
            border: '1px solid rgba(100,140,180,0.18)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.4), 0 0 20px rgba(60,130,220,0.12), inset 0 1px 0 rgba(255,255,255,0.03)',
          }}>
            {(inputFocused || input.trim()) && <InkCloud />}
            {/* Bottom glow — shifts left on focus */}
            <div style={{
              position: 'absolute', bottom: 0, height: '1px',
              left: inputFocused ? '2%' : '20%',
              right: inputFocused ? '55%' : '20%',
              background: 'linear-gradient(90deg, transparent, rgba(100,180,255,0.5), rgba(120,200,255,0.7), rgba(100,180,255,0.5), transparent)',
              transition: 'left 0.4s ease, right 0.4s ease',
              pointerEvents: 'none',
            }} />
            <textarea
              className="chat-input"
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isWaitingForInput ? t('permission.title') + '...' : t('chat.placeholder')}
              rows={1}
              style={{
                position: 'relative', zIndex: 2,
                width: '100%', display: 'block',
                resize: 'none', background: 'transparent',
                fontSize: '13px', color: '#e5e5e5',
                padding: '12px 40px 12px 14px', border: 'none', outline: 'none',
                minHeight: '24px', maxHeight: '120px', overflowY: 'auto',
                lineHeight: '1.45', fontFamily: 'inherit',
              }}
              disabled={loading || isWaitingForInput}
              onFocus={() => setInputFocused(true)}
              onBlur={(e) => {
                const rt = e.relatedTarget as HTMLElement | null
                if (rt && (rt.tagName === 'BUTTON')) return
                setInputFocused(false)
              }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
          </div>
          <button
            onClick={loading ? handleStop : handleSend}
            disabled={!loading && (isWaitingForInput || !input.trim())}
            title={loading ? t('chat.stop') : t('chat.send')}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '4px',
              background: loading
                ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                : isWaitingForInput || !input.trim()
                  ? 'rgba(42,42,62,0.5)'
                  : 'linear-gradient(180deg, rgba(40,110,200,0.3) 0%, rgba(30,80,170,0.2) 100%)',
              border: 'none',
              backdropFilter: loading || isWaitingForInput || !input.trim() ? undefined : 'blur(4px)',
              WebkitBackdropFilter: loading || isWaitingForInput || !input.trim() ? undefined : 'blur(4px)',
              color: loading
                ? 'white'
                : isWaitingForInput || !input.trim()
                  ? '#6b7280'
                  : '#e2eaf4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: '6px',
              marginBottom: '6px',
              cursor: loading || (!isWaitingForInput && input.trim()) ? 'pointer' : 'default',
              boxShadow: loading
                ? '0 4px 16px rgba(239,68,68,0.4)'
                : isWaitingForInput || !input.trim()
                  ? 'none'
                  : '0 0 12px rgba(100,180,255,0.25), 0 0 30px rgba(80,160,240,0.08)',
            }}
          >
            {loading ? (
              <div style={{ width: '14px', height: '14px', background: 'white', borderRadius: '3px' }} />
            ) : (
              <ArrowUp style={{ width: '16px', height: '16px' }} />
            )}
          </button>
        </div>
      </div>

      {/* Permission dialog overlay */}
      {pendingPermission && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '16px'
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1e1e2e 0%, #181825 100%)',
            border: '1px solid #2a2a3e',
            borderRadius: '14px',
            width: '100%',
            maxWidth: '340px',
            padding: '16px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <ShieldAlert style={{ width: '18px', height: '18px', color: '#f59e0b' }} />
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#e5e5e5' }}>{t('permission.title')}</span>
            </div>
            <div style={{
              background: 'rgba(42,42,62,0.5)',
              borderRadius: '10px',
              padding: '12px',
              marginBottom: '12px',
              fontSize: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>{t('permission.operation')}</span>
                <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{pendingPermission.permission}</span>
              </div>
              {pendingPermission.patterns.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#9ca3af' }}>{t('permission.target')}</span>
                  <span style={{
                    color: '#e5e5e5',
                    fontWeight: 500,
                    textAlign: 'right',
                    maxWidth: '60%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {pendingPermission.patterns.join(', ')}
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => sendPermissionReply('allow_once')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {t('permission.allowOnce')}
              </button>
              <button
                onClick={() => sendPermissionReply('allow_always')}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {t('permission.allowAlways')}
              </button>
            </div>
            <div style={{ marginTop: '8px' }}>
              <button
                onClick={() => sendPermissionReply('deny')}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#ef4444',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                {t('permission.deny')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Intent Form Overlay */}
      {showIntentForm && pendingIntent && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 50,
          padding: '16px'
        }}>
          <IntentForm
            suggestions={pendingIntent.options.map(opt => ({
              id: opt.id,
              label: opt.label,
              description: opt.description,
              icon: <span style={{ fontSize: '18px' }}>{opt.id === 'quick-cut' ? '⚡' : opt.id === 'detail-edit' ? '🕐' : '💬'}</span>,
              color: opt.id === 'quick-cut' ? '#3b82f6' : opt.id === 'detail-edit' ? '#38b2c8' : '#6b7280',
            }))}
            formMessage={pendingIntent.message}
            onSubmit={async (selectedIntent, additionalInfo) => {
              setShowIntentForm(false)
              try {
                await fetch(`${await getJianjiCodeUrl()}/api/jianjicode/intent-response`, {
                  method: 'POST',
                  headers: jianjicodeHeaders({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({
                    formId: pendingIntent.formId,
                    selectedIntent,
                    additionalInfo,
                  }),
                })
              } catch (err) {
                logger.warn(`[ChatPanel] Intent response failed: ${err}`)
              }
              const intentMsg: ChatMessage = {
                id: nextMsgId('msg'),
                role: 'user',
                content: additionalInfo ? `[${selectedIntent}] ${additionalInfo}` : `[${selectedIntent}]`,
                msgType: 'text',
                timestamp: Date.now(),
                finished: true,
              }
              setMessages(prev => [...prev, intentMsg])
              setPendingIntent(null)
            }}
            onCancel={() => {
              setShowIntentForm(false)
              setPendingIntent(null)
            }}
          />
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// PipelineStatusItem — compact pipeline status line
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// InlineQuestion — Claude Code style AskUserQuestion embedded in chat flow
// ---------------------------------------------------------------------------

function InlineQuestion({ data, onSubmit }: { data: QuestionData; onSubmit: (answers: string[][]) => Promise<void> }) {
  const [qIdx, setQIdx] = useState(0)
  const [answers, setAnswers] = useState<string[][]>(() => data.questions.map(() => []))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [customInput, setCustomInput] = useState('')
  const [customMode, setCustomMode] = useState(false)

  const q = data.questions[qIdx]
  const total = data.questions.length

  const selectOption = (oIdx: number) => {
    if (q.multiSelect) {
      setSelected(prev => { const s = new Set(prev); s.has(oIdx) ? s.delete(oIdx) : s.add(oIdx); return s })
    } else {
      // Auto-submit for single-select
      const labels = [q.options[oIdx].label]
      const next = [...answers]; next[qIdx] = labels
      advance(next)
    }
  }

  const submitCurrent = () => {
    if (customMode) {
      if (!customInput.trim()) return
      const next = [...answers]; next[qIdx] = [customInput.trim()]
      advance(next)
    } else {
      if (selected.size === 0) return
      const labels = [...selected].map(oi => q.options[oi].label)
      const next = [...answers]; next[qIdx] = labels
      advance(next)
    }
  }

  const advance = (nextAnswers: string[][]) => {
    setAnswers(nextAnswers)
    if (qIdx + 1 < total) {
      setQIdx(qIdx + 1)
      setSelected(new Set())
      setCustomInput('')
      setCustomMode(false)
    } else {
      onSubmit(nextAnswers)
    }
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSubmit(data.questions.map(() => [])) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const btnStyle = (isSel: boolean): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '11px 16px', borderRadius: '8px',
    background: isSel ? 'rgba(59,130,246,0.1)' : '#0f172a',
    border: `1px solid ${isSel ? '#3b82f6' : '#2a2a3e'}`,
    color: isSel ? '#60a5fa' : '#d4d4d4',
    fontSize: '13px', fontWeight: 400,
    cursor: 'pointer',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  })

  const hoverIn = (e: React.MouseEvent<HTMLButtonElement>, isSel: boolean) => {
    if (!isSel) { e.currentTarget.style.background = '#0ea5e9'; e.currentTarget.style.borderColor = '#0ea5e9'; e.currentTarget.style.color = '#fff' }
  }
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>, isSel: boolean) => {
    if (!isSel) { e.currentTarget.style.background = '#0f172a'; e.currentTarget.style.borderColor = '#2a2a3e'; e.currentTarget.style.color = '#d4d4d4' }
  }

  return (
    <div style={{
      marginTop: '14px',
      border: '1px solid #2a2a3e',
      borderRadius: '10px',
      overflow: 'hidden',
      background: '#000',
    }}>
      {q.header && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px',
          borderBottom: '1px solid #2a2a3e',
          background: '#000',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5ec4d0" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span style={{ fontSize: '12px', color: '#9ca3af', fontFamily: 'ui-monospace' }}>{q.header}</span>
          {total > 1 && (
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#4b5563' }}>{qIdx + 1}/{total}</span>
          )}
        </div>
      )}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {q.options.map((opt, oIdx) => {
            const isSel = selected.has(oIdx)
            return (
              <button key={oIdx} onClick={() => { setCustomMode(false); selectOption(oIdx) }}
                title={opt.description}
                style={btnStyle(isSel)}
                onMouseEnter={e => hoverIn(e, isSel)}
                onMouseLeave={e => hoverOut(e, isSel)}
              >{oIdx + 1}  {opt.label}</button>
            )
          })}
          {/* Custom input option */}
          {customMode ? (
            <input
              autoFocus
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitCurrent(); if (e.key === 'Escape') setCustomMode(false) }}
              placeholder="请输入"
              style={{
                width: '100%', padding: '11px 16px', borderRadius: '8px',
                background: '#0f172a', border: '1px solid #3b82f6',
                color: '#e5e5e5', fontSize: '13px', outline: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}
            />
          ) : (
            <button onClick={() => { setCustomMode(true); setSelected(new Set()) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '11px 16px', borderRadius: '8px',
                background: '#0f172a', border: '1px solid #2a2a3e',
                color: '#6b7280', fontSize: '13px', cursor: 'pointer',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          }}
              onMouseEnter={e => { e.currentTarget.style.background = '#0ea5e9'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#0ea5e9' }}
              onMouseLeave={e => { e.currentTarget.style.background = '#0f172a'; e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#2a2a3e' }}
            >告诉 AI 怎么做</button>
          )}
        </div>
      </div>
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid #2a2a3e',
        fontSize: '11px', color: '#4b5563',
        display: 'flex', alignItems: 'center', gap: '8px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}>
        <kbd style={{ background: '#1e1e2e', border: '1px solid #2a2a3e', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', color: '#6b7280' }}>Esc</kbd>
        取消
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PipelineStatusItem — compact pipeline status line
// ---------------------------------------------------------------------------

function PipelineStatusItem({ msg }: { msg: ChatMessage }) {
  const statusType = msg.statusText
  const isStep = statusType === 'step-start'
  const isTool = statusType === 'tool-start'

  let icon = '○'
  let color = '#6b7280'
  if (isStep) { icon = '▸'; color = '#38b2c8' }
  else if (isTool) { icon = '◇'; color = '#3b82f6' }

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      paddingLeft: '6px',
      alignItems: 'center',
      fontSize: '11px',
      color: '#9ca3af',
      paddingTop: '3px',
      paddingBottom: '3px',
      position: 'relative',
    }}>
      <div style={{
        width: '18px', height: '18px',
        borderRadius: '50%',
        background: isStep ? 'rgba(56,178,200,0.12)' : 'rgba(59,130,246,0.08)',
        border: `1px solid ${color}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ color, fontWeight: 700, fontSize: '9px', lineHeight: 1, fontFamily: 'monospace' }}>{icon}</span>
      </div>
      <span style={{ color: '#9ca3af', lineHeight: '1.4', fontWeight: 500 }}>{msg.content}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ThinkingBlockItem — Claude Code style collapsible thinking block
// ---------------------------------------------------------------------------

function ThinkingBlockItem({
  msg,
  isStreaming,
  collapsed,
  onToggle,
}: {
  msg: ChatMessage
  isStreaming: boolean
  collapsed: boolean
  onToggle: () => void
}) {
  const thinkingText = msg.content || ''
  const stepLabel = msg.stepNumber ? `Step ${msg.stepNumber}` : 'Thinking'
  const isEmpty = !thinkingText

  return (
    <div style={{ display: 'flex', gap: '8px', paddingLeft: '0' }}>
      {/* Vertical timeline connector */}
      <div style={{
        width: '20px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '2px',
      }}>
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isEmpty && isStreaming ? '#3b82f6' : '#4b5563',
          boxShadow: isEmpty && isStreaming ? '0 0 6px rgba(59,130,246,0.4)' : 'none',
          transition: 'all 0.2s ease',
        }} />
        <div style={{
          width: '1px',
          flex: 1,
          minHeight: '8px',
          background: 'linear-gradient(180deg, #2a2a3e 0%, transparent 100%)',
        }} />
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        borderRadius: '10px',
        border: '1px solid rgba(42,42,62,0.4)',
        background: 'rgba(24,24,37,0.4)',
        overflow: 'hidden',
        minWidth: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <button
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            width: '100%',
            padding: '6px 10px',
            fontSize: '11px',
            color: '#9ca3af',
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          {collapsed ? <ChevronDown style={{ width: '12px', height: '12px', flexShrink: 0 }} /> : <ChevronUp style={{ width: '12px', height: '12px', flexShrink: 0 }} />}
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '10px', fontWeight: 500 }}>
            {stepLabel}
          </span>
          {isEmpty && isStreaming && (
            <>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#3b82f6',
                animation: 'pulse 1.5s ease-in-out infinite',
                marginLeft: 'auto',
              }} />
              <span style={{ fontSize: '10px', color: '#6b7280' }}>thinking...</span>
            </>
          )}
          {!isEmpty && isStreaming && (
            <Loader2 style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: '#38b2c8', marginLeft: 'auto' }} />
          )}
        </button>
        {!collapsed && thinkingText && (
          <div style={{
            padding: '6px 10px 10px 10px',
            fontSize: '11px',
            color: '#6b7280',
            fontStyle: 'italic',
            lineHeight: '1.55',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '160px',
            overflowY: 'auto',
            borderTop: '1px solid #1e1e2e',
          }}>
            <ReasoningBlock text={thinkingText} isStreaming={isStreaming} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// MessageItem — memoized, CC-style with timeline dots, no avatars
// ---------------------------------------------------------------------------

function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const paced = usePacedMarkdown(text, isStreaming)
  return (
    <div style={{
      padding: '0 10px 8px 10px',
      fontSize: '11px',
      color: '#6b7280',
      fontStyle: 'italic',
      lineHeight: '1.5',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      maxHeight: '120px',
      overflowY: 'auto'
    }}>
      {paced}
    </div>
  )
}

const MessageItem = memo(function MessageItem({
  msg,
  isStreaming,
  reasoningCollapsed,
  onToggleReasoning,
  onApplyResult,
  onDiscardResult,
  onReplayEditOperations,
  showTimeline,
  questionAnswers,
  onQuestionReply,
}: {
  msg: ChatMessage
  isStreaming: boolean
  reasoningCollapsed: boolean
  onToggleReasoning: () => void
  onApplyResult?: (action: TimelineAction) => Promise<void>
  onDiscardResult?: () => void
  onReplayEditOperations?: (transactionId: string, ops: EditOperation[]) => Promise<void>
  showTimeline?: boolean
  questionAnswers: Record<string, string[][]>
  onQuestionReply: (requestId: string, answers: string[][]) => void
}) {
  const { t } = useI18n()
  const isUser = msg.role === 'user'
  const hasReasoning = !!msg.reasoning
  const showPhaseChip = !isUser && !msg.finished && msg.phase

  // Question messages render full-width, bypassing timeline dot and 88% limit
  if (msg.questionData && !questionAnswers[msg.questionData.requestId]) {
    return <InlineQuestion data={msg.questionData} onSubmit={(answers) => onQuestionReply(msg.questionData!.requestId, answers)} />
  }
  if (msg.questionData && questionAnswers[msg.questionData.requestId]) {
    return null
  }

  const dotColor = isUser ? '#3b82f6' : '#5ec4d0'
  const dotSize = isUser ? 8 : 6

  return (
    <div style={{ display: 'flex', gap: '10px', paddingLeft: '4px', position: 'relative' }}>
      {/* Timeline */}
      {showTimeline && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
          width: '12px',
          position: 'relative',
        }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute',
            top: '14px',
            bottom: '-100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '1px',
            background: '#2a2a3e',
          }} />
          {/* Dot */}
          <div style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '50%',
            backgroundColor: dotColor,
            flexShrink: 0,
            marginTop: isUser ? '5px' : '7px',
            boxShadow: `0 0 6px ${dotColor}40`,
          }} />
        </div>
      )}

      <div style={{ maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {showPhaseChip && (
          <ThinkingIndicator
            phase={msg.phase === 'thinking' ? 'thinking' : msg.phase === 'calling-tool' ? 'calling-tool' : 'writing'}
            message={msg.phase === 'thinking' ? t('chat.enhancement.thinkingMessage') : msg.phase === 'calling-tool' ? t('chat.enhancement.callingTool', { tool: msg.toolPhaseName || '' }) : t('chat.enhancement.writing')}
          />
        )}

        {hasReasoning && (
          <div style={{
            background: 'rgba(30,30,46,0.7)',
            borderRadius: '8px',
            border: '1px solid #2a2a3e',
            overflow: 'hidden'
          }}>
            <button
              onClick={onToggleReasoning}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                width: '100%',
                padding: '8px 10px',
                fontSize: '11px',
                color: '#6b7280',
                cursor: 'pointer',
                border: 'none',
                background: 'transparent',
                transition: 'all 0.15s ease'
              }}
            >
              {reasoningCollapsed ? <ChevronDown style={{ width: '12px', height: '12px' }} /> : <ChevronUp style={{ width: '12px', height: '12px' }} />}
              <EmotionIcons state="thinking" size={11} />
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '10px' }}>
                {reasoningCollapsed ? t('chat.enhancement.thinkingCollapsed') : t('chat.enhancement.thinking')}
              </span>
              {!msg.finished && msg.phase === 'thinking' && (
                <Loader2 style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: '#38b2c8', marginLeft: 'auto' }} />
              )}
            </button>
            {!reasoningCollapsed && (
              <ReasoningBlock text={msg.reasoning || ''} isStreaming={isStreaming} />
            )}
          </div>
        )}

        <div style={{
          borderRadius: isUser ? '6px' : '0',
          padding: isUser ? '10px 14px' : '0',
          fontSize: isUser ? '13px' : '13px',
          lineHeight: '1.6',
          background: isUser ? 'linear-gradient(180deg, rgba(40,110,200,0.22) 0%, rgba(30,80,170,0.16) 100%)' : undefined,
          backdropFilter: isUser ? 'blur(8px)' : undefined,
          WebkitBackdropFilter: isUser ? 'blur(8px)' : undefined,
          color: isUser ? '#e2eaf4' : '#d4d4d4',
          boxShadow: isUser ? '0 0 8px rgba(100,180,255,0.2), 0 0 16px rgba(80,160,240,0.06)' : undefined,
          outline: isUser ? '1px solid rgba(255,255,255,0.15)' : undefined,
          outlineOffset: isUser ? '-1px' : undefined,
        }}>
          {isUser ? (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.content}
            </div>
          ) : (
            <div style={isStreaming ? {
              background: 'linear-gradient(135deg, #1e1e2e 0%, #181825 100%)',
              borderRadius: '10px',
              padding: '10px 12px',
              border: '1px solid #2a2a3e',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            } : undefined}>
              <MarkdownMessage content={msg.content} isStreaming={isStreaming} />
            </div>
          )}

          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div style={{
              marginTop: '10px',
              paddingTop: '10px',
              borderTop: '1px solid #2a2a3e',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px'
            }}>
              {msg.toolCalls.map(tc => (
                <span key={tc} style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(42,42,62,0.5)',
                  fontSize: '11px',
                  color: '#9ca3af'
                }}>
                  <Wrench style={{ width: '12px', height: '12px' }} />{tc}
                </span>
              ))}
            </div>
          )}
        </div>

        {msg.diffData && msg.finished && (
          <div style={{ marginTop: '2px' }}>
            <CodeDiffViewer
              oldCode={msg.diffData.oldCode}
              newCode={msg.diffData.newCode}
              oldLabel={msg.diffData.oldLabel || t('chat.diff.original')}
              newLabel={msg.diffData.newLabel || t('chat.diff.new')}
              language={msg.diffData.language}
            />
          </div>
        )}

        {msg.previewData && msg.finished && (
          <div style={{ marginTop: '2px' }}>
            <VideoEditResultCard
              preview={msg.previewData}
              timelineAction={msg.timelineActionData}
              onApply={onApplyResult}
              onDiscard={onDiscardResult}
            />
          </div>
        )}

        {msg.editOperationsData && msg.editOperationsData.length > 0 && msg.finished && onReplayEditOperations && (
          <div style={{ marginTop: '8px' }}>
            <button
              onClick={() => onReplayEditOperations(msg.transactionId || `txn_${Date.now()}`, msg.editOperationsData!)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                border: 'none',
                color: 'white',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59,130,246,0.4)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = ''
                e.currentTarget.style.boxShadow = ''
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              展开到时间轴
              <span style={{
                fontSize: '10px',
                opacity: 0.7,
                background: 'rgba(255,255,255,0.15)',
                padding: '1px 6px',
                borderRadius: '4px',
              }}>
                {msg.editOperationsData.length} 步
              </span>
            </button>
          </div>
        )}

        {msg.risks && msg.risks.length > 0 && msg.finished && (
          <div style={{ marginTop: '2px' }}>
            <RiskConfirmation
              risks={msg.risks}
              title={t('chat.risk.title')}
              description={t('chat.risk.description')}
              confirmText={t('chat.risk.confirmExecute')}
              cancelText={t('chat.risk.cancel')}
            />
          </div>
        )}

        {msg.statusText && !isUser && msg.finished && (
          <span style={{ fontSize: '11px', color: '#4b5563', paddingLeft: '4px' }}>{msg.statusText}</span>
        )}
      </div>
    </div>
  )
})

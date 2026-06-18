import { useState, useEffect, useRef, memo } from 'react'
import { Bot, User, Loader2, CheckCircle2, AlertCircle, ArrowUp, Brain, Cpu, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import {
  StreamTyping,
  ThinkingIndicator,
  ThinkingDots,
  PulseDot,
  AnimatedProgress,
  EmotionIcons,
  ToolCallChain,
  CompactToolCallChain,
  type ToolCallItem,
  EmotionFeedback,
  SuccessFeedback,
  ErrorFeedback,
  LoadingFeedback,
  WelcomeFeedback,
  CodeDiffViewer,
  ModificationPreview,
  RiskConfirmation,
  IntentForm
} from '../../components/chat';

type MsgType = 'text' | 'tool-start' | 'tool-end' | 'tool-error'
type Phase = 'thinking' | 'calling-tool' | 'writing' | null

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  msgType: MsgType
  toolCalls?: string[]
  timestamp: number
  reasoning?: string
  toolName?: string
  toolStatus?: 'running' | 'done' | 'error'
  toolMessage?: string
  phase?: Phase
  toolPhaseName?: string
  finished: boolean
}

const MOCK_RESPONSES = [
  {
    text: "好的，我来帮你分析这个视频。我正在思考需要使用哪些工具来处理这个任务。",
    phase: 'thinking' as Phase,
    delay: 1500,
  },
  {
    text: "让我先读取项目文件，了解一下当前的视频编辑状态。",
    phase: 'calling-tool' as Phase,
    toolName: 'Read',
    delay: 2000,
  },
  {
    text: "好的，我已经读取了项目文件。现在我来分析视频的关键帧，看看有哪些精彩的瞬间可以突出展示。",
    phase: 'writing' as Phase,
    delay: 3000,
  },
  {
    text: "根据分析结果，我建议采用以下编辑策略：\n\n1. **开篇亮点**：将第5秒的精彩瞬间提前\n2. **节奏调整**：在30秒处添加一个戏剧性的停顿\n3. **转场优化**：使用淡入淡出替代硬切\n\n这样的处理可以让整个视频更加流畅和有冲击力。",
    phase: null,
    delay: 0,
  }
];

const MOCK_TOOL_CALLS: ToolCallItem[] = [
  {
    id: 'tool-1',
    toolName: 'detect_scene',
    status: 'done',
    inputParams: { videoPath: '/project/video.mp4', threshold: 0.3 },
    outputResult: { scenes: [{ start: 0.0, end: 5.2 }, { start: 5.2, end: 12.8 }, { start: 12.8, end: 18.5 }] },
    executionTime: 1.2,
  },
  {
    id: 'tool-2',
    toolName: 'analyze_audio',
    status: 'done',
    inputParams: { audioPath: '/project/audio.mp3', sampleRate: 44100 },
    outputResult: { detectedBeats: [1.2, 2.4, 3.6, 4.8], silenceRegions: [{ start: 10.0, end: 12.5 }] },
    executionTime: 0.8,
  },
  {
    id: 'tool-3',
    toolName: 'generate_transition',
    status: 'running',
    inputParams: { type: 'fade', duration: 0.5 },
  },
];

export function TestChatEffects() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showFeedback, setShowFeedback] = useState<'success' | 'error' | 'welcome' | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const assistantMsgId = useRef<string | null>(null)

  const [collapsedReasoning, setCollapsedReasoning] = useState<Set<string>>(new Set())
  const [showDiff, setShowDiff] = useState(false)
  const [showModification, setShowModification] = useState(false)
  const [showRisk, setShowRisk] = useState(false)
  const [showIntent, setShowIntent] = useState(false)

  const OLD_TIMELINE = `时间轴（原）:
  [00:00 - 00:05] 开场
  [00:10 - 00:25] 主内容
  [00:25 - 00:30] 片尾`

  const NEW_TIMELINE = `时间轴（新）:
  [00:00 - 00:08] 开场（延长）
  [00:10 - 00:20] 主内容
  [00:20 - 00:20] 🎬 转场
  [00:22 - 00:30] 新增：精彩片段
  [00:30 - 00:35] 片尾`

  const MOCK_ORIGINAL_SEGMENTS = [
    { id: '1', start: 0, end: 5, label: '开场', type: 'intro' as const },
    { id: '2', start: 10, end: 25, label: '主内容', type: 'main' as const },
    { id: '3', start: 25, end: 30, label: '片尾', type: 'outro' as const },
  ]

  const MOCK_MODIFIED_SEGMENTS = [
    { id: '1', start: 0, end: 8, label: '开场（延长）', type: 'intro' as const },
    { id: '2', start: 10, end: 20, label: '主内容（精简）', type: 'main' as const },
    { id: '4', start: 20, end: 22, label: '转场', type: 'transition' as const },
    { id: '5', start: 22, end: 30, label: '精彩片段', type: 'main' as const },
    { id: '3', start: 30, end: 35, label: '片尾', type: 'outro' as const },
  ]

  const MOCK_RISKS = [
    {
      id: 'risk-1',
      description: '删除 3 个原始片段',
      level: 'medium' as const,
      affectedScope: ['开场', '主内容-后半段', '片尾'],
      recoverable: true,
      estimatedImpact: '片段可在回收站恢复',
    },
    {
      id: 'risk-2',
      description: '修改视频编码格式',
      level: 'low' as const,
      affectedScope: ['整个项目'],
      recoverable: false,
      estimatedImpact: '画质可能略有下降',
    },
  ]

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const addUserMessage = (text: string) => {
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      msgType: 'text',
      timestamp: Date.now(),
      finished: true,
    }
    setMessages(prev => [...prev, userMsg])
  };

  const startMockResponse = () => {
    if (loading) return
    
    const text = input.trim() || '帮我分析一下这个视频，生成一个剪辑方案'
    addUserMessage(text)

    setLoading(true)
    const aId = `msg-${Date.now()}-ai`
    assistantMsgId.current = aId

    setMessages(prev => [...prev, {
      id: aId,
      role: 'assistant',
      content: '',
      msgType: 'text',
      timestamp: Date.now(),
      finished: false,
    }])
    setInput('')

    const processResponse = (index: number) => {
      if (index >= MOCK_RESPONSES.length) {
        setLoading(false)
        setMessages(prev => prev.map(m => m.id === aId ? { ...m, finished: true, phase: null } : m))
        setShowFeedback('success')
        setTimeout(() => setShowFeedback(null), 2000)
        return
      }

      const response = MOCK_RESPONSES[index]

      if (response.phase === 'thinking') {
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === aId ? { ...m, phase: 'thinking', reasoning: '正在分析视频内容...' } : m))
        }, 500)
      }

      if (response.phase === 'calling-tool' && response.toolName) {
        const toolMsg: ChatMessage = {
          id: `tool-${Date.now()}`,
          role: 'assistant',
          content: response.toolName,
          msgType: 'tool-start',
          toolName: response.toolName,
          toolStatus: 'running',
          toolMessage: '执行中...',
          timestamp: Date.now(),
          finished: false,
        }
        setMessages(prev => [...prev, toolMsg])
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === toolMsg.id ? { ...m, msgType: 'tool-end', toolStatus: 'done', toolMessage: '完成', finished: true } : m))
        }, 1500)
      }

      setTimeout(() => {
        if (response.phase === 'writing' || !response.phase) {
          setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: response.text, phase: 'writing' } : m))
        }

        processResponse(index + 1)
      }, response.delay)
    }

    processResponse(0)
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      startMockResponse()
    }
  }

  const toggleReasoning = (id: string) => {
    setCollapsedReasoning(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleQuickTest = (type: 'thinking' | 'success' | 'error' | 'tool') => {
    switch (type) {
      case 'thinking':
        const thinkingId = `msg-${Date.now()}-thinking`
        setMessages(prev => [...prev, {
          id: thinkingId,
          role: 'assistant',
          content: '',
          msgType: 'text',
          timestamp: Date.now(),
          phase: 'thinking',
          reasoning: '正在分析视频内容...这是一个测试思考过程的展示。',
          finished: false,
        }])
        break
      case 'success':
        setShowFeedback('success')
        setTimeout(() => setShowFeedback(null), 2000)
        break
      case 'error':
        setShowFeedback('error')
        setTimeout(() => setShowFeedback(null), 2000)
        break
      case 'tool':
        const toolId = `tool-${Date.now()}`
        setMessages(prev => [...prev, {
          id: toolId,
          role: 'assistant',
          content: 'FFmpeg',
          msgType: 'tool-start',
          toolName: 'FFmpeg',
          toolStatus: 'running',
          toolMessage: '执行中...',
          timestamp: Date.now(),
          finished: false,
        }])
        setTimeout(() => {
          setMessages(prev => prev.map(m => m.id === toolId ? { ...m, msgType: 'tool-end', toolStatus: 'done', toolMessage: '完成', finished: true } : m))
        }, 2000)
        break
    }
  };

  const clearMessages = () => {
    setMessages([])
    setLoading(false)
  };

  return (
    <div style={{ backgroundColor: '#000', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #27272a', flexShrink: 0 }}>
        <Bot style={{ width: '16px', height: '16px', color: '#60a5fa' }} />
        <span style={{ fontSize: '12px', fontWeight: 500, color: '#d4d4d8' }}>聊天效果测试</span>
        {loading && <Loader2 style={{ width: '12px', height: '12px', color: '#60a5fa', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <PulseDot variant="success" size="sm" />
          <span style={{ fontSize: '10px', color: '#71717a' }}>测试模式</span>
        </div>
      </div>

      {/* Test Controls - compact bar */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #27272a', backgroundColor: '#0a0a0a', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleQuickTest('thinking')}
            style={{ padding: '4px 8px', backgroundColor: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.3)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(168, 85, 247, 0.2)'}
          >
            思考
          </button>
          <button
            onClick={() => handleQuickTest('tool')}
            style={{ padding: '4px 8px', backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#facc15', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(234, 179, 8, 0.3)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(234, 179, 8, 0.2)'}
          >
            工具
          </button>
          <button
            onClick={() => handleQuickTest('success')}
            style={{ padding: '4px 8px', backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.3)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.2)'}
          >
            成功
          </button>
          <button
            onClick={() => handleQuickTest('error')}
            style={{ padding: '4px 8px', backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.3)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'}
          >
            失败
          </button>
          <button
            onClick={clearMessages}
            style={{ padding: '4px 8px', backgroundColor: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', transition: 'background-color 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#3f3f46'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#27272a'}
          >
            清空
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#000' }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center' }}>
            <Bot style={{ width: '32px', height: '32px', color: '#3f3f46', marginBottom: '8px' }} />
            <p style={{ fontSize: '12px', color: '#52525b' }}>点击下方按钮开始测试聊天效果</p>
            <p style={{ fontSize: '10px', color: '#3f3f46', marginTop: '4px' }}>使用输入框发送消息或点击上方测试按钮</p>
          </div>
        )}

        {messages.map(msg => (
          <MessageItem
            key={msg.id}
            msg={msg}
            isStreaming={loading && msg.id === assistantMsgId.current && !msg.finished}
            reasoningCollapsed={collapsedReasoning.has(msg.id)}
            onToggleReasoning={() => toggleReasoning(msg.id)}
          />
        ))}

        {loading && !messages.find(m => m.id === assistantMsgId.current) && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '6px', backgroundColor: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Bot style={{ width: '14px', height: '14px', color: '#60a5fa' }} />
            </div>
            <div style={{ backgroundColor: '#18181b', borderRadius: '8px', padding: '8px 12px' }}>
              <Loader2 style={{ width: '14px', height: '14px', color: '#71717a', animation: 'spin 1s linear infinite' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #27272a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', backgroundColor: '#18181b', borderRadius: '12px', border: '1px solid #3f3f46', padding: '6px 12px', transition: 'border-color 0.2s' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息测试..."
            rows={1}
            style={{ flex: 1, resize: 'none', backgroundColor: 'transparent', fontSize: '12px', color: '#fff', outline: 'none', padding: '4px 0', maxHeight: '96px', minHeight: '20px', border: 'none' }}
            disabled={loading}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 96) + 'px'
            }}
          />
          <button
            onClick={startMockResponse}
            disabled={loading || !input.trim()}
            style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: loading || !input.trim() ? '#27272a' : '#2563eb', color: loading || !input.trim() ? '#71717a' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background-color 0.2s', border: 'none', cursor: 'pointer' }}
          >
            {loading ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} /> : <ArrowUp style={{ width: '14px', height: '14px' }} />}
          </button>
        </div>
      </div>

      {/* Component Showcase */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #27272a', backgroundColor: '#0a0a0a', flexShrink: 0, maxHeight: '300px', overflowY: 'auto' }}>
        <div style={{ fontSize: '10px', color: '#71717a', marginBottom: '8px' }}>组件展示</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>思考状态</div>
            <ThinkingIndicator phase="thinking" />
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>工具调用</div>
            <ThinkingIndicator phase="calling-tool" />
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>状态点</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <PulseDot variant="success" />
              <PulseDot variant="error" />
              <PulseDot variant="warning" />
            </div>
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>进度条</div>
            <AnimatedProgress value={65} variant="gradient" />
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>工具链</div>
            <CompactToolCallChain items={MOCK_TOOL_CALLS} />
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>情感图标</div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <EmotionIcons state="thinking" size={14} />
              <EmotionIcons state="tool" size={14} />
              <EmotionIcons state="success" size={14} />
            </div>
          </div>
          <div style={{ backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>时间轴差异</div>
            <button
              onClick={() => setShowDiff(!showDiff)}
              style={{ padding: '4px 8px', backgroundColor: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: '4px', fontSize: '9px', cursor: 'pointer' }}
            >
              {showDiff ? '隐藏' : '显示'}
            </button>
          </div>
        </div>

        {showDiff && (
            <div style={{ marginTop: '8px' }}>
              <CodeDiffViewer
                oldCode={OLD_TIMELINE}
                newCode={NEW_TIMELINE}
                oldLabel="原时间轴"
                newLabel="新时间轴"
                showLineNumbers={true}
                onAccept={() => setShowDiff(false)}
                onReject={() => setShowDiff(false)}
              />
            </div>
          )}

          <div style={{ marginTop: '8px', backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>修改预览</div>
            <button
              onClick={() => setShowModification(!showModification)}
              style={{ padding: '4px 8px', backgroundColor: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: '4px', fontSize: '9px', cursor: 'pointer' }}
            >
              {showModification ? '隐藏' : '显示'}
            </button>
          </div>

          {showModification && (
            <div style={{ marginTop: '8px' }}>
              <ModificationPreview
                originalSegments={MOCK_ORIGINAL_SEGMENTS}
                modifiedSegments={MOCK_MODIFIED_SEGMENTS}
                onConfirm={() => setShowModification(false)}
                onCancel={() => setShowModification(false)}
              />
            </div>
          )}

          <div style={{ marginTop: '8px', backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>风险确认</div>
            <button
              onClick={() => setShowRisk(!showRisk)}
              style={{ padding: '4px 8px', backgroundColor: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: '4px', fontSize: '9px', cursor: 'pointer' }}
            >
              {showRisk ? '隐藏' : '显示'}
            </button>
          </div>

          {showRisk && (
            <div style={{ marginTop: '8px' }}>
              <RiskConfirmation
                risks={MOCK_RISKS}
                title="剪辑操作风险确认"
                description="以下操作将修改您的视频项目，请确认风险："
                onConfirm={() => setShowRisk(false)}
                onCancel={() => setShowRisk(false)}
                confirmText="确认剪辑"
                cancelText="取消"
                requireSecondConfirm={true}
              />
            </div>
          )}

          <div style={{ marginTop: '8px', backgroundColor: '#18181b', borderRadius: '6px', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#52525b', marginBottom: '4px' }}>意图识别</div>
            <button
              onClick={() => setShowIntent(!showIntent)}
              style={{ padding: '4px 8px', backgroundColor: '#27272a', color: '#a1a1aa', border: 'none', borderRadius: '4px', fontSize: '9px', cursor: 'pointer' }}
            >
              {showIntent ? '隐藏' : '显示'}
            </button>
          </div>

          {showIntent && (
            <div style={{ marginTop: '8px' }}>
              <IntentForm
                onSubmit={(intents) => {
                  console.log('Selected intents:', intents)
                  setShowIntent(false)
                }}
                onCancel={() => setShowIntent(false)}
              />
            </div>
          )}

          <details style={{ marginTop: '8px' }}>
            <summary style={{ fontSize: '10px', color: '#71717a', cursor: 'pointer' }}>展开工具链详情</summary>
            <div style={{ marginTop: '8px' }}>
              <ToolCallChain items={MOCK_TOOL_CALLS} />
            </div>
          </details>
        </div>

      {/* Feedback Overlay */}
      {showFeedback && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ backgroundColor: '#18181b', borderRadius: '16px', padding: '32px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
            {showFeedback === 'success' && <SuccessFeedback />}
            {showFeedback === 'error' && <ErrorFeedback />}
            {showFeedback === 'welcome' && <WelcomeFeedback />}
          </div>
        </div>
      )}
    </div>
  )
}

const MessageItem = memo(function MessageItem({
  msg,
  isStreaming,
  reasoningCollapsed,
  onToggleReasoning,
}: {
  msg: ChatMessage
  isStreaming: boolean
  reasoningCollapsed: boolean
  onToggleReasoning: () => void
}) {
  const isUser = msg.role === 'user'
  const hasReasoning = !!msg.reasoning
  const showPhaseChip = !isUser && !msg.finished && msg.phase

  switch (msg.msgType) {
    case 'tool-start':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
          <div style={{ width: '20px', height: '20px', borderRadius: '4px', backgroundColor: 'rgba(234, 179, 8, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Loader2 style={{ width: '12px', height: '12px', color: '#facc15', animation: 'spin 1s linear infinite' }} />
          </div>
          <Cpu style={{ width: '12px', height: '12px', color: 'rgba(234, 179, 8, 0.7)' }} />
          <span style={{ fontSize: '10px', color: '#facc15', fontFamily: 'monospace' }}>{msg.content}</span>
        </div>
      )

    case 'tool-end':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
          <div style={{ width: '20px', height: '20px', borderRadius: '4px', backgroundColor: 'rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CheckCircle2 style={{ width: '12px', height: '12px', color: '#4ade80' }} />
          </div>
          <Cpu style={{ width: '12px', height: '12px', color: 'rgba(34, 197, 94, 0.7)' }} />
          <span style={{ fontSize: '10px', color: '#4ade80', fontFamily: 'monospace' }}>{msg.content}</span>
        </div>
      )

    case 'tool-error':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 8px' }}>
          <div style={{ width: '20px', height: '20px', borderRadius: '4px', backgroundColor: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertCircle style={{ width: '12px', height: '12px', color: '#f87171' }} />
          </div>
          <Cpu style={{ width: '12px', height: '12px', color: 'rgba(239, 68, 68, 0.7)' }} />
          <span style={{ fontSize: '10px', color: '#f87171', fontFamily: 'monospace' }}>{msg.content}</span>
        </div>
      )

    case 'text':
    default:
      return (
        <div style={{ display: 'flex', gap: '8px', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          {!isUser && (
            <div style={{ width: '24px', height: '24px', borderRadius: '6px', backgroundColor: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
              <Bot style={{ width: '14px', height: '14px', color: '#60a5fa' }} />
            </div>
          )}

          <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {showPhaseChip && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px', borderRadius: '4px', fontSize: '10px', width: 'fit-content',
                backgroundColor: msg.phase === 'thinking' ? 'rgba(168, 85, 247, 0.1)' : msg.phase === 'calling-tool' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                color: msg.phase === 'thinking' ? '#c084fc' : msg.phase === 'calling-tool' ? '#facc15' : '#60a5fa',
                border: msg.phase === 'thinking' ? '1px solid rgba(168, 85, 247, 0.2)' : msg.phase === 'calling-tool' ? '1px solid rgba(234, 179, 8, 0.2)' : '1px solid rgba(59, 130, 246, 0.2)',
              }}>
                {msg.phase === 'thinking' && <><Brain style={{ width: '12px', height: '12px' }} /><span>Thinking...</span></>}
                {msg.phase === 'calling-tool' && <><Loader2 style={{ width: '12px', height: '12px', animation: 'spin 1s linear infinite' }} /><span>Calling {msg.toolPhaseName || 'tool'}...</span></>}
                {msg.phase === 'writing' && <><span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#60a5fa', animation: 'pulse 1s ease-in-out infinite' }} /><span>Writing...</span></>}
              </div>
            )}

            {hasReasoning && (
              <div style={{ backgroundColor: 'rgba(24, 24, 27, 0.6)', borderRadius: '8px', border: '1px solid rgba(63, 63, 70, 0.5)', overflow: 'hidden' }}>
                <button
                  onClick={onToggleReasoning}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', padding: '6px 10px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', color: '#71717a', transition: 'color 0.2s' }}
                >
                  {reasoningCollapsed ? <ChevronDown style={{ width: '12px', height: '12px' }} /> : <ChevronUp style={{ width: '12px', height: '12px' }} />}
                  <Brain style={{ width: '12px', height: '12px' }} />
                  <span style={{ fontFamily: 'monospace', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.05em' }}>
                    {reasoningCollapsed ? 'Thought for a moment' : 'Thinking'}
                  </span>
                  {!msg.finished && msg.phase === 'thinking' && <Loader2 style={{ width: '10px', height: '10px', animation: 'spin 1s linear infinite', color: '#c084fc' }} />}
                </button>
                {!reasoningCollapsed && (
                  <div style={{ padding: '0 10px 8px', fontSize: '10px', color: '#71717a', fontStyle: 'italic', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '128px', overflowY: 'auto' }}>
                    {msg.reasoning}
                  </div>
                )}
              </div>
            )}

            <div style={{
              borderRadius: '8px', padding: '8px 12px', fontSize: '12px', lineHeight: 1.5,
              backgroundColor: isUser ? '#2563eb' : '#18181b',
              color: isUser ? '#fff' : '#e4e4e7',
            }}>
              {isUser ? (
                <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.content}</p>
              ) : (
                <StreamTyping
                  text={msg.content}
                  isStreaming={isStreaming && !msg.finished}
                  showThinking={!!(showPhaseChip && msg.phase === 'thinking')}
                  thinkingPhase={msg.phase as any}
                  thinkingMessage={msg.phase === 'thinking' ? '正在思考' : msg.phase === 'calling-tool' ? '正在调用工具' : '正在组织回答'}
                  showCursor={isStreaming && !msg.finished}
                />
              )}

              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #3f3f46', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {msg.toolCalls.map(tc => (
                    <span key={tc} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(63, 63, 70, 0.5)', fontSize: '10px', color: '#a1a1aa' }}>
                      <Wrench style={{ width: '12px', height: '12px' }} />{tc}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isUser && (
            <div style={{ width: '24px', height: '24px', borderRadius: '6px', backgroundColor: '#27272a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px' }}>
              <User style={{ width: '14px', height: '14px', color: '#d4d4d8' }} />
            </div>
          )}
        </div>
      )
  }
})

export default TestChatEffects
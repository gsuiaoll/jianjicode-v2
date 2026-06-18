import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { useState, useRef, memo } from 'react'
import { Loader2, Wrench, Bot, User, ShieldAlert, ArrowUp, ChevronDown, ChevronUp, Sparkles, X, HelpCircle } from 'lucide-react'

// ---------------------------------------------------------------------------
// Mock I18n
// ---------------------------------------------------------------------------
const t = (key: string) => {
  const translations: Record<string, string> = {
    'chat.placeholder': '输入你的剪辑需求...',
    'chat.enhancement.thinkingMessage': '正在思考中...',
    'chat.enhancement.callingTool': '正在调用工具',
    'chat.enhancement.writing': '正在组织回答',
  }
  return translations[key] || key
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
  statusText?: string
}

// ---------------------------------------------------------------------------
// StreamTyping Component
// ---------------------------------------------------------------------------
const StreamTyping = memo(({
  text,
  isStreaming,
  showThinking,
}: {
  text: string
  isStreaming?: boolean
  showThinking?: boolean
}) => {
  return (
    <p style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text || ''}
      {isStreaming && (
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '16px',
          backgroundColor: '#3b82f6',
          verticalAlign: 'text-bottom',
          marginLeft: '2px',
          animation: 'blink 1s step-end infinite',
        }} />
      )}
      <style>{`
        @keyframes blink { 50% { opacity: 0; } }
      `}</style>
    </p>
  )
})

// ---------------------------------------------------------------------------
// ThinkingIndicator Component
// ---------------------------------------------------------------------------
const ThinkingIndicator = memo(({
  phase,
  message,
  className = '',
}: {
  phase: 'thinking' | 'calling-tool' | 'writing'
  message?: string
  className?: string
}) => {
  const phaseConfig = {
    thinking: { color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)', borderColor: 'rgba(139, 92, 246, 0.2)' },
    'calling-tool': { color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.2)' },
    writing: { color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)' },
  }
  const currentPhase = phaseConfig[phase]

  const displayMessage = message || (
    phase === 'thinking' ? 'Thinking...' :
    phase === 'calling-tool' ? 'Calling tool...' :
    'Writing...'
  )

  const ThinkingIconSvg = ({ color }: { color: string }) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )

  return (
    <div 
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        padding: '7px 11px',
        borderRadius: '9px',
        backgroundColor: currentPhase.bgColor,
        border: `1px solid ${currentPhase.borderColor}`,
        width: 'fit-content',
        boxShadow: `0 2px 6px ${currentPhase.color}10`,
      }}
      className={className}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.1s ease-in-out infinite' }}>
        <ThinkingIconSvg color={currentPhase.color} />
      </div>
      <span style={{ fontSize: '11px', color: currentPhase.color, fontWeight: 500, letterSpacing: '-0.01em' }}>
        {displayMessage}
        <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '1px' }}>
          <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite' }}>·</span>
          <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.22s' }}>·</span>
          <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.44s' }}>·</span>
        </span>
      </span>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes typingDot { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }
      `}</style>
    </div>
  )
})

// ---------------------------------------------------------------------------
// IntentForm Component
// ---------------------------------------------------------------------------
const IntentForm = memo(({
  onSubmit,
  onCancel,
}: {
  onSubmit: (intent: { option: string; customText?: string }) => void
  onCancel: () => void
}) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [customText, setCustomText] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  const options = [
    { id: 'quick-cut', label: '快速粗剪', description: '自动识别精彩片段，快速生成初步剪辑' },
    { id: 'fine-edit', label: '长时间精剪', description: '细致调整转场、时长和整体节奏' },
  ]

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: '16px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '360px',
        backgroundColor: '#12121a',
        borderRadius: '14px',
        overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 14px',
          borderBottom: '1px solid #2a2a3e',
          background: 'linear-gradient(135deg, #1e1e2e 0%, #12121a 100%)',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
          }}>
            <Sparkles style={{ width: '16px', height: '16px', color: 'white' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5' }}>
              AI 剪辑助手
            </div>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              请选择你的剪辑需求
            </div>
          </div>
          <button
            onClick={onCancel}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              backgroundColor: 'rgba(42, 42, 62, 0.6)',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 1)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 0.6)'}
          >
            <X style={{ width: '14px', height: '14px', color: '#9ca3af' }} />
          </button>
        </div>

        <div style={{ padding: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {options.map(option => (
              <button
                key={option.id}
                onClick={() => setSelectedOption(option.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  backgroundColor: selectedOption === option.id ? 'rgba(59, 130, 246, 0.1)' : 'rgba(26, 26, 38, 0.8)',
                  border: `1px solid ${selectedOption === option.id ? '#3b82f6' : '#2a2a3e'}`,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (selectedOption !== option.id) {
                    e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 0.6)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedOption !== option.id) {
                    e.currentTarget.style.backgroundColor = 'rgba(26, 26, 38, 0.8)'
                  }
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 500, color: selectedOption === option.id ? '#3b82f6' : '#e5e5e5', marginBottom: '2px' }}>
                  {option.label}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', lineHeight: 1.4 }}>
                  {option.description}
                </div>
              </button>
            ))}

            <button
              onClick={() => setShowCustomInput(!showCustomInput)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 12px',
                borderRadius: '10px',
                backgroundColor: showCustomInput ? 'rgba(59, 130, 246, 0.1)' : 'rgba(26, 26, 38, 0.8)',
                border: `1px solid ${showCustomInput ? '#3b82f6' : '#2a2a3e'}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!showCustomInput) {
                  e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 0.6)'
                }
              }}
              onMouseLeave={(e) => {
                if (!showCustomInput) {
                  e.currentTarget.style.backgroundColor = 'rgba(26, 26, 38, 0.8)'
                }
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 500, color: showCustomInput ? '#3b82f6' : '#e5e5e5', marginBottom: showCustomInput ? '6px' : '2px' }}>
                其他需求
              </div>
              {showCustomInput && (
                <textarea
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="请描述你的具体剪辑需求..."
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    minHeight: '70px',
                    padding: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid #2a2a3e',
                    borderRadius: '8px',
                    color: '#e5e5e5',
                    fontSize: '12px',
                    resize: 'vertical',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              )}
              {!showCustomInput && (
                <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                  描述你的特殊剪辑需求
                </div>
              )}
            </button>
          </div>

          <div style={{ marginTop: '14px', display: 'flex', gap: '8px' }}>
            <button
              onClick={onCancel}
              style={{
                flex: 1,
                padding: '10px',
                borderRadius: '10px',
                backgroundColor: 'rgba(42, 42, 62, 0.6)',
                border: 'none',
                color: '#9ca3af',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 1)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 0.6)'}
            >
              取消
            </button>
            <button
              onClick={() => onSubmit({ option: selectedOption || 'custom', customText })}
              disabled={!selectedOption && !customText}
              style={{
                flex: 1.5,
                padding: '10px',
                borderRadius: '10px',
                background: !selectedOption && !customText ? '#2a2a3e' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                border: 'none',
                color: !selectedOption && !customText ? '#6b7280' : 'white',
                fontSize: '13px',
                fontWeight: 500,
                cursor: !selectedOption && !customText ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: !selectedOption && !customText ? 'none' : '0 4px 12px rgba(59, 130, 246, 0.3)',
              }}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// MessageItem Component
// ---------------------------------------------------------------------------
const MessageItem = memo(function MessageItem({
  msg,
  isStreaming,
}: {
  msg: ChatMessage
  isStreaming: boolean
}) {
  const isUser = msg.role === 'user'
  const hasReasoning = !!msg.reasoning
  const showPhaseChip = !isUser && !msg.finished && msg.phase

  return (
    <div style={{ display: 'flex', gap: '10px', justifyContent: isUser ? 'flex-end' : 'flex-start', alignItems: 'flex-start' }}>
      {!isUser && (
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #1e1e2e 0%, #12121a 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: '2px',
          border: '1px solid #2a2a3e',
        }}>
          <Bot style={{ width: '16px', height: '16px', color: '#3b82f6' }} />
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
            backgroundColor: 'rgba(26, 26, 38, 0.6)',
            borderRadius: '10px',
            border: '1px solid #2a2a3e',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 10px', fontSize: '10px', color: '#9ca3af', fontStyle: 'italic', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.reasoning}
            </div>
          </div>
        )}

        <div style={{
          borderRadius: '10px',
          padding: '10px 12px',
          fontSize: '13px',
          lineHeight: 1.5,
          background: isUser ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' : 'linear-gradient(135deg, #1e1e2e 0%, #12121a 100%)',
          color: isUser ? 'white' : '#e5e5e5',
          boxShadow: isUser ? '0 4px 12px rgba(59, 130, 246, 0.25)' : '0 2px 8px rgba(0,0,0,0.2)',
          border: isUser ? 'none' : '1px solid #2a2a3e',
        }}>
          <StreamTyping
            text={msg.content}
            isStreaming={isStreaming}
            showThinking={false}
          />
        </div>

        {msg.statusText && !isUser && msg.finished && (
          <span style={{ fontSize: '11px', color: '#4b5563', paddingLeft: '4px' }}>{msg.statusText}</span>
        )}
      </div>

      {isUser && (
        <div style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #2a2a3e 0%, #1e1e2e 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: '2px',
          border: '1px solid #2a2a3e',
        }}>
          <User style={{ width: '16px', height: '16px', color: '#d1d5db' }} />
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main Chat Component
// ---------------------------------------------------------------------------
function ChatDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '你好！我是 AI 剪辑助手。请告诉我你想要做什么样的视频剪辑。',
      msgType: 'text',
      timestamp: Date.now(),
      finished: true,
      statusText: '准备就绪，等待您的指令',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showIntentForm, setShowIntentForm] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const startMockResponse = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      msgType: 'text',
      timestamp: Date.now(),
      finished: true,
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    await new Promise(r => setTimeout(r, 500))

    const thinkingId = `ai-${Date.now()}`
    setMessages(prev => [...prev, {
      id: thinkingId,
      role: 'assistant',
      content: '',
      msgType: 'text',
      timestamp: Date.now(),
      phase: 'thinking',
      reasoning: '正在分析用户的剪辑需求...',
      finished: false,
    }])

    await new Promise(r => setTimeout(r, 1500))

    setMessages(prev => prev.map(m => m.id === thinkingId ? { ...m, phase: 'calling-tool', toolPhaseName: 'VideoAnalyzer' } : m))

    await new Promise(r => setTimeout(r, 1000))

    const longText = `好的，我理解您的剪辑需求了。

根据您的描述，我会进行以下处理：
1. 首先分析视频的关键帧
2. 识别并提取精彩片段
3. 调整整体节奏和转场
4. 添加合适的背景音乐

您希望我现在开始处理吗？`

    let currentIndex = 0
    setMessages(prev => prev.map(m => m.id === thinkingId ? { ...m, phase: 'writing' } : m))

    const typeInterval = setInterval(() => {
      currentIndex += 3
      if (currentIndex >= longText.length) {
        clearInterval(typeInterval)
        setMessages(prev => prev.map(m => m.id === thinkingId ? {
          ...m,
          content: longText,
          phase: null,
          finished: true,
          statusText: '剪辑方案已生成完成'
        } : m))
        setLoading(false)
      } else {
        setMessages(prev => prev.map(m => m.id === thinkingId ? {
          ...m,
          content: longText.slice(0, currentIndex),
        } : m))
      }
    }, 30)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (input.trim()) {
        setShowIntentForm(true)
      }
    }
  }

  const handleIntentSubmit = (intent: { option: string; customText?: string }) => {
    setShowIntentForm(false)
    startMockResponse(input || (intent.customText || '进行视频剪辑'))
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#0a0a0a',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid #1e1e2e',
        background: 'linear-gradient(135deg, #12121a 0%, #0a0a0a 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
          }}>
            <Sparkles style={{ width: '18px', height: '18px', color: 'white' }} />
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e5e5' }}>
              AI 剪辑助手
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              智能视频剪辑
            </div>
          </div>
        </div>
        <button
          onClick={() => setMessages([
            {
              id: 'welcome',
              role: 'assistant',
              content: '你好！我是 AI 剪辑助手。请告诉我你想要做什么样的视频剪辑。',
              msgType: 'text',
              timestamp: Date.now(),
              finished: true,
              statusText: '准备就绪，等待您的指令',
            },
          ])}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: 'rgba(42, 42, 62, 0.6)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 1)'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(42, 42, 62, 0.6)'}
        >
          <HelpCircle style={{ width: '16px', height: '16px', color: '#6b7280' }} />
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {messages.map(msg => (
          <MessageItem
            key={msg.id}
            msg={msg}
            isStreaming={loading && !msg.finished}
          />
        ))}
      </div>

      <div style={{ padding: '12px 16px', borderTop: '1px solid #1e1e2e', background: 'linear-gradient(0deg, #0a0a0a 0%, #12121a 100%)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '10px',
          background: 'rgba(26, 26, 38, 0.8)',
          borderRadius: '14px',
          border: '1px solid #2a2a3e',
          padding: '10px 14px',
          transition: 'all 0.2s ease',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的剪辑需求..."
            rows={1}
            disabled={loading}
            style={{
              flex: 1,
              resize: 'none',
              backgroundColor: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '14px',
              color: '#e5e5e5',
              lineHeight: 1.4,
              maxHeight: '120px',
              minHeight: '20px',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => setShowIntentForm(true)}
            disabled={loading || !input.trim()}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: loading || !input.trim() ? '#2a2a3e' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              border: 'none',
              color: loading || !input.trim() ? '#6b7280' : 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: loading || !input.trim() ? 'none' : '0 4px 12px rgba(59, 130, 246, 0.3)',
            }}
          >
            {loading ? (
              <Loader2 style={{ width: '18px', height: '18px', animation: 'spin 1s linear infinite' }} />
            ) : (
              <ArrowUp style={{ width: '18px', height: '18px' }} />
            )}
          </button>
        </div>
      </div>

      {showIntentForm && (
        <IntentForm
          onSubmit={handleIntentSubmit}
          onCancel={() => setShowIntentForm(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Render App
// ---------------------------------------------------------------------------
document.getElementById('root')!.style.height = '100vh'
document.getElementById('root')!.style.width = '100vw'
document.body.style.margin = '0'
document.body.style.padding = '0'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#020617',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '480px',
        height: '100%',
        maxHeight: '850px',
        borderRadius: '20px',
        overflow: 'hidden',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(42, 42, 62, 0.5)',
      }}>
        <ChatDemo />
      </div>
    </div>
  </StrictMode>,
)

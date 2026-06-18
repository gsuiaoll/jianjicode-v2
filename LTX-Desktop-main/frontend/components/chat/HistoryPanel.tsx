import { useState, useEffect, useCallback, memo } from 'react'
import { Search, ArrowLeft, MessageSquare, Clock, ChevronRight, Loader2, History, Pencil, Download, Trash2, Plus } from 'lucide-react'
import { useI18n } from '../../contexts/I18nContext'
import { getSessions, getSessionMessages, renameSession, deleteSession, exportAllSessions } from '../../lib/chat-store'
import type { StoredMessage } from '../../lib/chat-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionPreview {
  id: string
  title: string
  createdAt: number
  lastActive: number
  messageCount: number
  searchText: string
}

interface SessionDetail {
  id: string
  messages: StoredMessage[]
  createdAt: number
  lastActive: number
  title: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return t('history.dateFormat', {
    month: String(month),
    day: String(day),
    hour,
    minute,
  })
}

function extractText(content: string | any[]): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text || '')
      .join(' ')
  }
  return ''
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HistoryPanelProps {
  onBack: () => void
  onSelectSession: (sessionId: string) => void
  onNewChat: () => void
  projectId?: string
}

export function HistoryPanel({ onBack, onSelectSession, onNewChat, projectId }: HistoryPanelProps) {
  const { t } = useI18n()
  const [sessions, setSessions] = useState<SessionPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    try {
      const stored = getSessions(projectId)
      setSessions(stored.map(s => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        lastActive: s.lastActive,
        messageCount: s.messageCount,
        searchText: s.searchText || '',
      })))
    } catch { /* ignore */ }
    setLoading(false)
  }, [projectId])

  const loadDetail = useCallback((id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    try {
      const msgs = getSessionMessages(id)
      const meta = getSessions(projectId).find(s => s.id === id)
      setDetail({
        id,
        messages: msgs,
        createdAt: meta?.createdAt ?? msgs[0]?.timestamp ?? Date.now(),
        lastActive: meta?.lastActive ?? Date.now(),
        title: meta?.title ?? id.slice(0, 8),
      })
    } catch { /* ignore */ }
    setDetailLoading(false)
  }, [])

  const handleExport = useCallback(() => {
    try {
      const json = exportAllSessions()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `jianjicode-sessions-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }, [])

  const filtered = sessions.filter((s) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return s.title.toLowerCase().includes(q) || s.searchText.includes(q)
  })

  // ── Detail view ──
  if (selectedId) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#12121a' }}>
	        <div style={{
	          display: 'flex', alignItems: 'center', gap: '8px',
	          padding: '12px 16px', borderBottom: '1px solid rgba(30,30,46,0.8)', flexShrink: 0,
	          background: 'linear-gradient(180deg, rgba(18,18,26,0.95) 0%, rgba(20,20,30,0.9) 100%)',
	          backdropFilter: 'blur(8px)',
	        }}>
	          <button
	            onClick={() => { setSelectedId(null); setDetail(null) }}
	            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#9ca3af', padding: '4px', borderRadius: '4px',
              display: 'flex', alignItems: 'center',
            }}
          >
            <ArrowLeft style={{ width: '16px', height: '16px' }} />
          </button>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5' }}>
            {detail ? detail.title : t('history.loading')}
          </span>
          <span style={{ fontSize: '11px', color: '#6b7280' }}>
            {detail ? `${detail.messages.length} ${t('history.messagesCount', { count: String(detail.messages.length) })}` : ''}
          </span>
          <button
            onClick={() => onSelectSession(selectedId!)}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              border: 'none',
              color: 'white',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('history.resumeChat')}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Loader2 style={{ width: '20px', height: '20px', color: '#6b7280', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {detail.messages.map((msg, i) => {
                const isUser = msg.role === 'user'
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', gap: '8px',
                      justifyContent: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {!isUser && (
                      <div style={{
                        width: '26px', height: '26px', borderRadius: '8px',
                        background: 'rgba(30,30,46,0.7)', border: '1px solid rgba(42,42,62,0.4)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: '2px',
                      }}>
                        <MessageSquare style={{ width: '12px', height: '12px', color: 'rgba(59,130,246,0.4)' }} />
                      </div>
                    )}
                    <div style={{
                      maxWidth: '85%', borderRadius: '12px',
                      padding: '10px 14px', fontSize: '12px', lineHeight: '1.55',
                      background: isUser
                        ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
                        : 'linear-gradient(135deg, rgba(30,30,46,0.6) 0%, rgba(24,24,37,0.6) 100%)',
                      color: isUser ? 'white' : '#e5e5e5',
                      border: isUser ? 'none' : '1px solid rgba(42,42,62,0.4)',
                      boxShadow: isUser
                        ? '0 4px 12px rgba(59,130,246,0.2)'
                        : '0 2px 8px rgba(0,0,0,0.15)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {msg.toolName && (
                        <span style={{
                          fontSize: '10px', color: '#8b5cf6',
                          background: 'rgba(139,92,246,0.1)',
                          padding: '1px 6px', borderRadius: '4px',
                          marginRight: '6px',
                        }}>
                          {msg.toolName}
                        </span>
                      )}
                      {extractText(msg.content)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 20px' }}>
              {t('history.noSessions')}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── List view ──
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#12121a' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', borderBottom: '1px solid #1e1e2e', flexShrink: 0,
        background: 'linear-gradient(135deg, #12121a 0%, #181825 100%)',
      }}>
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9ca3af', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center',
          }}
        >
          <ArrowLeft style={{ width: '16px', height: '16px' }} />
        </button>
        <History style={{ width: '16px', height: '16px', color: '#8b5cf6' }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5', flex: 1 }}>{t('history.title')}</span>
        <button
          onClick={onNewChat}
          style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
            border: 'none', cursor: 'pointer', color: 'white',
            padding: '4px 10px', borderRadius: '6px',
            fontSize: '11px', fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          <Plus style={{ width: '12px', height: '12px' }} />
          {t('history.newChat')}
        </button>
        <button
          onClick={handleExport}
          title={t('history.export')}
          style={{
            background: 'rgba(42,42,62,0.5)', border: '1px solid rgba(42,42,62,0.6)',
            cursor: 'pointer', color: '#9ca3af', padding: '4px 8px',
            borderRadius: '6px', display: 'flex', alignItems: 'center',
          }}
        >
          <Download style={{ width: '12px', height: '12px' }} />
        </button>
      </div>

      <div style={{ padding: '12px 16px', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'rgba(24,24,37,0.6)', borderRadius: '12px',
          border: '1px solid rgba(42,42,62,0.5)',
          padding: '8px 14px',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
        }}>
          <Search style={{ width: '14px', height: '14px', color: '#6b7280' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: '12px', color: '#e5e5e5', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
            <Loader2 style={{ width: '20px', height: '20px', color: '#6b7280', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            textAlign: 'center', color: '#6b7280', padding: '40px 20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '160px', height: '160px', borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />
            <div style={{
              width: '48px', height: '48px', borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(30,30,46,0.7) 0%, rgba(24,24,37,0.7) 100%)',
              border: '1px solid rgba(42,42,62,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              position: 'relative', zIndex: 1,
            }}>
              <History style={{ width: '22px', height: '22px', color: '#4b5563' }} />
            </div>
            <p style={{ fontSize: '13px', margin: 0, color: '#9ca3af', position: 'relative', zIndex: 1 }}>{t('history.noSessions')}</p>
            <p style={{ fontSize: '11px', margin: 0, opacity: 0.5, position: 'relative', zIndex: 1 }}>{t('history.noSessionsHint')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {filtered.map((session) => (
              <SessionListItem
                key={session.id}
                session={session}
                onClick={() => loadDetail(session.id)}
                onRename={(newTitle) => {
                  renameSession(session.id, newTitle)
                  setSessions(prev => prev.map(s => s.id === session.id ? { ...s, title: newTitle } : s))
                }}
                onDelete={() => {
                  deleteSession(session.id)
                  setSessions(prev => prev.filter(s => s.id !== session.id))
                }}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SessionListItem
// ---------------------------------------------------------------------------

const SessionListItem = memo(function SessionListItem({
  session,
  onClick,
  onRename,
  onDelete,
  t,
}: {
  session: SessionPreview
  onClick: () => void
  onRename: (newTitle: string) => void
  onDelete: () => void
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(session.title)

  const submitRename = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed)
    }
    setEditing(false)
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        borderRadius: '12px', border: '1px solid rgba(42,42,62,0.5)',
        background: 'rgba(24,24,37,0.5)',
        transition: 'all 0.2s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(59,130,246,0.4)'
        ;(e.currentTarget as HTMLElement).style.background = 'rgba(30,30,46,0.7)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)'
        ;(e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'rgba(42,42,62,0.5)'
        ;(e.currentTarget as HTMLElement).style.background = 'rgba(24,24,37,0.5)'
        ;(e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'
        ;(e.currentTarget as HTMLElement).style.transform = 'translateY(0)'
      }}
    >
      <button
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          flex: 1, minWidth: 0,
          padding: '10px 6px 10px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <div style={{
          width: '32px', height: '32px', borderRadius: '8px',
          background: 'linear-gradient(135deg, #1e1e2e 0%, #181825 100%)',
          border: '1px solid #2a2a3e', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <MessageSquare style={{ width: '14px', height: '14px', color: '#6b7280' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={submitRename}
              placeholder={t('history.renamePlaceholder')}
              autoFocus
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%',
                background: 'rgba(42,42,62,0.6)',
                border: '1px solid rgba(59,130,246,0.4)',
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '12px',
                color: '#e5e5e5',
                outline: 'none',
                fontFamily: 'inherit',
                marginBottom: '2px',
              }}
            />
          ) : (
            <div style={{
              fontSize: '12px', color: '#e5e5e5', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginBottom: '2px',
            }}>
              {session.title || session.id.slice(0, 8)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '10px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Clock style={{ width: '10px', height: '10px' }} />
              {formatDate(session.lastActive, t)}
            </span>
            <span style={{ fontSize: '10px', color: '#4b5563' }}>
              {t('history.messagesCount', { count: String(session.messageCount) })}
            </span>
          </div>
        </div>

        <ChevronRight style={{ width: '14px', height: '14px', color: '#4b5563', flexShrink: 0 }} />
      </button>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '2px', paddingRight: '8px', flexShrink: 0 }}>
        <button
          onClick={e => {
            e.stopPropagation()
            setEditTitle(session.title)
            setEditing(true)
          }}
          title={t('history.rename')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6b7280', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center',
          }}
        >
          <Pencil style={{ width: '12px', height: '12px' }} />
        </button>
        <button
          onClick={e => {
            e.stopPropagation()
            onDelete()
          }}
          title={t('history.delete')}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6b7280', padding: '4px', borderRadius: '4px',
            display: 'flex', alignItems: 'center',
          }}
        >
          <Trash2 style={{ width: '12px', height: '12px' }} />
        </button>
      </div>
    </div>
  )
})

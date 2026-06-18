import { useState, useMemo } from 'react'
import { Plus, Minus, Equal, ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { computeLineDiff, computeInlineDiff, getDiffStats, type DiffResult } from '../../lib/diffUtils'

interface CodeDiffViewerProps {
  oldCode: string
  newCode: string
  oldLabel?: string
  newLabel?: string
  language?: string
  showLineNumbers?: boolean
  inline?: boolean
  collapsible?: boolean
  defaultExpanded?: boolean
  onAccept?: () => void
  onReject?: () => void
  className?: string
}

export function CodeDiffViewer({
  oldCode,
  newCode,
  oldLabel = '原时间轴',
  newLabel = '新时间轴',
  language = 'plaintext',
  showLineNumbers = true,
  inline = false,
  collapsible = true,
  defaultExpanded = true,
  onAccept,
  onReject,
  className = '',
}: CodeDiffViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [activeTab, setActiveTab] = useState<'split' | 'inline'>('split')

  const lineDiff = useMemo(() => computeLineDiff(oldCode, newCode), [oldCode, newCode])
  const inlineDiff = useMemo(() => computeInlineDiff(oldCode, newCode), [oldCode, newCode])
  const stats = useMemo(() => getDiffStats(lineDiff), [lineDiff])

  const renderLineView = (diff: DiffResult) => {
    return (
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '11px', lineHeight: '20px', overflow: 'auto', maxHeight: '320px', borderRadius: '8px', border: '1px solid #3f3f46' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#18181b', borderBottom: '1px solid #3f3f46', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ color: '#a1a1aa' }}>{oldLabel}</span>
            <span style={{ color: '#52525b' }}>→</span>
            <span style={{ color: '#a1a1aa' }}>{newLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4ade80' }}>
              <Plus style={{ width: '12px', height: '12px' }} />{diff.addedCount}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f87171' }}>
              <Minus style={{ width: '12px', height: '12px' }} />{diff.removedCount}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#71717a' }}>
              <Equal style={{ width: '12px', height: '12px' }} />{diff.unchangedCount}
            </span>
          </div>
        </div>

        <div>
          {diff.lines.map((line, idx) => (
            <DiffLineRow key={idx} line={line} showLineNumbers={showLineNumbers} />
          ))}
        </div>
      </div>
    )
  }

  const renderInlineView = (diff: Array<{ type: 'added' | 'removed' | 'unchanged'; value: string }>) => {
    return (
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '11px', lineHeight: '20px', overflow: 'auto', maxHeight: '320px', borderRadius: '8px', border: '1px solid #3f3f46' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#18181b', borderBottom: '1px solid #3f3f46', padding: '6px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#a1a1aa' }}>内联差异</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#4ade80' }}>
              <Plus style={{ width: '12px', height: '12px' }} />{stats.added}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#f87171' }}>
              <Minus style={{ width: '12px', height: '12px' }} />{stats.removed}
            </span>
          </div>
        </div>

        <div style={{ padding: '8px 12px' }}>
          {diff.map((item, idx) => (
            <span
              key={idx}
              style={{
                backgroundColor: item.type === 'added' ? 'rgba(74, 222, 128, 0.15)' : item.type === 'removed' ? 'rgba(248, 113, 113, 0.15)' : 'transparent',
                color: item.type === 'added' ? '#86efac' : item.type === 'removed' ? '#fca5a5' : '#d4d4d8',
                textDecoration: item.type === 'removed' ? 'line-through' : 'none',
                padding: '1px 2px',
                borderRadius: '2px',
              }}
            >
              {item.value}
            </span>
          ))}
        </div>
      </div>
    )
  }

  if (!oldCode && !newCode) {
    return null
  }

  return (
    <div style={{ backgroundColor: 'rgba(24, 24, 27, 0.8)', borderRadius: '8px', border: '1px solid #3f3f46', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #3f3f46' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 500, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>时间轴差异预览</span>
          {collapsible && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{ padding: '2px', backgroundColor: 'transparent', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {isExpanded ? (
                <ChevronDown style={{ width: '14px', height: '14px', color: '#71717a' }} />
              ) : (
                <ChevronRight style={{ width: '14px', height: '14px', color: '#71717a' }} />
              )}
            </button>
          )}
        </div>

        {onAccept && onReject && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              onClick={onReject}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '10px', transition: 'background-color 0.2s' }}
            >
              <X style={{ width: '12px', height: '12px' }} />
              拒绝
            </button>
            <button
              onClick={onAccept}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderRadius: '6px', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: 'none', cursor: 'pointer', color: '#4ade80', fontSize: '10px', transition: 'background-color 0.2s' }}
            >
              <Check style={{ width: '12px', height: '12px' }} />
              接受
            </button>
          </div>
        )}
      </div>

      {isExpanded && (
        <>
          {!inline && stats.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', backgroundColor: 'rgba(24, 24, 27, 0.5)', borderBottom: '1px solid rgba(63, 63, 70, 0.5)' }}>
              <button
                onClick={() => setActiveTab('split')}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: activeTab === 'split' ? '#3f3f46' : 'transparent',
                  color: activeTab === 'split' ? '#fff' : '#71717a',
                }}
              >
                分隔视图
              </button>
              <button
                onClick={() => setActiveTab('inline')}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: activeTab === 'inline' ? '#3f3f46' : 'transparent',
                  color: activeTab === 'inline' ? '#fff' : '#71717a',
                }}
              >
                内联视图
              </button>
            </div>
          )}

          <div style={{ padding: '12px' }}>
            {!inline && stats.total > 0 ? (
              activeTab === 'split' ? renderLineView(lineDiff) : renderInlineView(inlineDiff)
            ) : (
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: '11px', lineHeight: '20px', padding: '12px', backgroundColor: '#18181b', borderRadius: '8px', border: '1px solid #3f3f46' }}>
                <pre style={{ color: '#d4d4d8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{newCode || oldCode}</pre>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DiffLineRow({ line, showLineNumbers }: { line: { type: 'added' | 'removed' | 'unchanged'; content: string; oldLineNumber?: number; newLineNumber?: number }; showLineNumbers: boolean }) {
  const getBgColor = () => {
    switch (line.type) {
      case 'added':
        return 'rgba(74, 222, 128, 0.1)'
      case 'removed':
        return 'rgba(248, 113, 113, 0.1)'
      default:
        return 'transparent'
    }
  }

  const getTextColor = () => {
    switch (line.type) {
      case 'added':
        return '#86efac'
      case 'removed':
        return '#fca5a5'
      default:
        return '#71717a'
    }
  }

  const getPrefix = () => {
    switch (line.type) {
      case 'added':
        return '+'
      case 'removed':
        return '-'
      default:
        return ' '
    }
  }

  return (
    <div style={{ display: 'flex', backgroundColor: getBgColor() }}>
      {showLineNumbers && (
        <>
          <div style={{ width: '40px', flexShrink: 0, padding: '0 8px', textAlign: 'right', color: '#52525b', borderRight: '1px solid rgba(63, 63, 70, 0.5)', userSelect: 'none' }}>
            {line.oldLineNumber || ''}
          </div>
          <div style={{ width: '40px', flexShrink: 0, padding: '0 8px', textAlign: 'right', color: '#52525b', borderRight: '1px solid rgba(63, 63, 70, 0.5)', userSelect: 'none' }}>
            {line.newLineNumber || ''}
          </div>
        </>
      )}
      <div style={{ width: '20px', flexShrink: 0, textAlign: 'center', color: getTextColor(), padding: '0 4px' }}>
        {getPrefix()}
      </div>
      <pre style={{ flex: 1, padding: '0 8px', color: getTextColor(), whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
        {line.content || ' '}
      </pre>
    </div>
  )
}

export default CodeDiffViewer
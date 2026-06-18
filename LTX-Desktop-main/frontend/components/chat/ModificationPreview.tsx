import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Eye, Clock, Scissors, Film, Volume2, Music } from 'lucide-react';

interface TimelineSegment {
  id: string;
  start: number;
  end: number;
  label: string;
  type?: 'intro' | 'main' | 'outro' | 'transition' | 'silence' | 'music';
  color?: string;
}

interface ModificationPreviewProps {
  originalSegments: TimelineSegment[];
  modifiedSegments: TimelineSegment[];
  onConfirm?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function ModificationPreview({
  originalSegments,
  modifiedSegments,
  onConfirm,
  onCancel,
  className = '',
}: ModificationPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeView, setActiveView] = useState<'side-by-side' | 'overlay'>('side-by-side');

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = (segments: TimelineSegment[]): number => {
    return segments.reduce((max, seg) => Math.max(max, seg.end), 0);
  };

  const getSegmentColor = (type?: string, color?: string) => {
    if (color) return color;
    switch (type) {
      case 'intro': return '#3b82f6';
      case 'main': return '#22c55e';
      case 'outro': return '#a855f7';
      case 'transition': return '#f59e0b';
      case 'silence': return '#6b7280';
      case 'music': return '#ec4899';
      default: return '#71717a';
    }
  };

  const getSegmentIcon = (type?: string) => {
    switch (type) {
      case 'intro':
      case 'outro':
        return <Film style={{ width: '10px', height: '10px' }} />;
      case 'main':
        return <Scissors style={{ width: '10px', height: '10px' }} />;
      case 'silence':
        return <Volume2 style={{ width: '10px', height: '10px' }} />;
      case 'music':
        return <Music style={{ width: '10px', height: '10px' }} />;
      default:
        return <Clock style={{ width: '10px', height: '10px' }} />;
    }
  };

  const renderTimelineBar = (segments: TimelineSegment[], label: string, highlightChanges = false) => {
    const totalDuration = Math.max(getTotalDuration(segments), 1);
    const height = 48;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: '10px', color: '#52525b' }}>时长: {formatTime(getTotalDuration(segments))}</span>
        </div>
        <div style={{ 
          backgroundColor: '#18181b', 
          borderRadius: '6px', 
          border: '1px solid #3f3f46',
          overflow: 'hidden',
          height: `${height}px`,
          position: 'relative',
        }}>
          <div style={{ display: 'flex', height: '100%', alignItems: 'stretch' }}>
            {segments.map((segment) => {
              const width = ((segment.end - segment.start) / totalDuration) * 100;
              return (
                <div
                  key={segment.id}
                  style={{
                    width: `${width}%`,
                    backgroundColor: getSegmentColor(segment.type, segment.color),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '4px 2px',
                    borderRight: '1px solid rgba(0,0,0,0.3)',
                    position: 'relative',
                  }}
                  title={`${segment.label} (${formatTime(segment.start)} - ${formatTime(segment.end)})`}
                >
                  <span style={{ fontSize: '8px', color: '#fff', fontWeight: 500, textAlign: 'center', lineHeight: 1.2 }}>
                    {segment.label.length > 8 ? segment.label.substring(0, 6) + '...' : segment.label}
                  </span>
                  <span style={{ fontSize: '7px', color: 'rgba(255,255,255,0.7)' }}>
                    {formatTime(segment.start)}-{formatTime(segment.end)}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ 
            position: 'absolute', 
            bottom: 0, 
            left: 0, 
            right: 0, 
            height: '3px', 
            backgroundColor: 'rgba(255,255,255,0.1)' 
          }} />
        </div>
      </div>
    );
  };

  const renderComparison = () => {
    if (activeView === 'side-by-side') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {renderTimelineBar(originalSegments, '原时间轴')}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ 
              width: '1px', 
              height: '20px', 
              backgroundColor: '#3f3f46',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '10px', color: '#52525b', backgroundColor: '#18181b', padding: '2px 8px' }}>→</span>
            </div>
          </div>
          {renderTimelineBar(modifiedSegments, '修改后', true)}
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '10px', color: '#71717a', fontWeight: 500 }}>对比视图</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <span style={{ fontSize: '9px', color: '#52525b' }}>原</span>
            <div style={{ width: '12px', height: '12px', backgroundColor: '#71717a', borderRadius: '2px' }} />
            <span style={{ fontSize: '9px', color: '#52525b' }}>新</span>
            <div style={{ width: '12px', height: '12px', backgroundColor: '#22c55e', borderRadius: '2px' }} />
          </div>
        </div>
        <div style={{ 
          backgroundColor: '#18181b', 
          borderRadius: '6px', 
          border: '1px solid #3f3f46',
          height: '64px',
          display: 'flex',
          alignItems: 'stretch',
          overflow: 'hidden',
        }}>
          {modifiedSegments.map((segment, idx) => {
            const origSeg = originalSegments.find(s => s.id === segment.id);
            const totalDuration = Math.max(getTotalDuration(modifiedSegments), 1);
            const width = ((segment.end - segment.start) / totalDuration) * 100;
            const isModified = !origSeg || origSeg.start !== segment.start || origSeg.end !== segment.end;
            
            return (
              <div
                key={segment.id}
                style={{
                  width: `${width}%`,
                  backgroundColor: isModified ? '#22c55e' : '#71717a',
                  opacity: isModified ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRight: '1px solid rgba(0,0,0,0.3)',
                }}
              >
                {isModified && (
                  <span style={{ fontSize: '8px', color: '#fff' }}>✦</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const originalDuration = getTotalDuration(originalSegments);
  const modifiedDuration = getTotalDuration(modifiedSegments);
  const durationDiff = modifiedDuration - originalDuration;

  return (
    <div style={{ 
      backgroundColor: 'rgba(24, 24, 27, 0.8)', 
      borderRadius: '8px', 
      border: '1px solid #3f3f46', 
      overflow: 'hidden' 
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '12px', 
        borderBottom: '1px solid #3f3f46' 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', fontWeight: 500, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            时间轴修改预览
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{ 
              padding: '2px', 
              backgroundColor: 'transparent', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {isExpanded ? (
              <ChevronDown style={{ width: '14px', height: '14px', color: '#71717a' }} />
            ) : (
              <ChevronUp style={{ width: '14px', height: '14px', color: '#71717a' }} />
            )}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', fontSize: '10px' }}>
            <span style={{ color: '#71717a' }}>
              原: <span style={{ color: '#a1a1aa' }}>{formatTime(originalDuration)}</span>
            </span>
            <span style={{ color: '#52525b' }}>→</span>
            <span style={{ color: '#71717a' }}>
              新: <span style={{ color: durationDiff > 0 ? '#4ade80' : durationDiff < 0 ? '#f87171' : '#a1a1aa' }}>{formatTime(modifiedDuration)}</span>
            </span>
            {durationDiff !== 0 && (
              <span style={{ color: durationDiff > 0 ? '#4ade80' : '#f87171' }}>
                ({durationDiff > 0 ? '+' : ''}{formatTime(Math.abs(durationDiff))})
              </span>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <>
          <div style={{ 
            display: 'flex', 
            gap: '4px', 
            padding: '8px 12px', 
            backgroundColor: 'rgba(24, 24, 27, 0.5)', 
            borderBottom: '1px solid rgba(63, 63, 70, 0.5)' 
          }}>
            <button
              onClick={() => setActiveView('side-by-side')}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === 'side-by-side' ? '#3f3f46' : 'transparent',
                color: activeView === 'side-by-side' ? '#fff' : '#71717a',
              }}
            >
              并排对比
            </button>
            <button
              onClick={() => setActiveView('overlay')}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: activeView === 'overlay' ? '#3f3f46' : 'transparent',
                color: activeView === 'overlay' ? '#fff' : '#71717a',
              }}
            >
              叠加视图
            </button>
          </div>

          <div style={{ padding: '16px' }}>
            {renderComparison()}

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>修改说明</span>
              {modifiedSegments.map((segment, idx) => {
                const origSeg = originalSegments.find(s => s.id === segment.id);
                if (origSeg && origSeg.start === segment.start && origSeg.end === segment.end) {
                  return null;
                }
                return (
                  <div key={segment.id} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px', 
                    fontSize: '10px',
                    color: '#a1a1aa',
                    padding: '4px 8px',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '4px',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                  }}>
                    <span style={{ color: '#4ade80' }}>✦</span>
                    <span>{segment.label}</span>
                    <span style={{ color: '#52525b' }}>
                      {origSeg ? `${formatTime(origSeg.start)}-${formatTime(origSeg.end)} → ` : ''}
                      {formatTime(segment.start)}-{formatTime(segment.end)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'flex-end', 
            gap: '8px', 
            padding: '12px', 
            borderTop: '1px solid #3f3f46',
            backgroundColor: 'rgba(24, 24, 27, 0.5)',
          }}>
            <button
              onClick={onCancel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: 'none',
                cursor: 'pointer',
                color: '#f87171',
                fontSize: '11px',
                transition: 'background-color 0.2s',
              }}
            >
              <X style={{ width: '12px', height: '12px' }} />
              取消修改
            </button>
            <button
              onClick={onConfirm}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: '#22c55e',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
                fontSize: '11px',
                transition: 'background-color 0.2s',
              }}
            >
              <Check style={{ width: '12px', height: '12px' }} />
              确认应用
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ModificationPreview;
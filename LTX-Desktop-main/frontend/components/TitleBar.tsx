import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <div className="drag-region" style={{
      position: 'fixed', top: 0, left: '256px', right: 0, height: '38px', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px', padding: '0 8px',
      background: 'transparent',
    }}>
      {/* Window controls */}
      <button className="no-drag" onClick={() => window.electronAPI.minimizeWindow()}
        style={{ position: 'relative', zIndex: 1, width: '28px', height: '28px', borderRadius: '4px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Minus style={{ width: '14px', height: '14px' }} />
      </button>
      <button className="no-drag" onClick={() => window.electronAPI.maximizeWindow()}
        style={{ position: 'relative', zIndex: 1, width: '28px', height: '28px', borderRadius: '4px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Square style={{ width: '12px', height: '12px' }} />
      </button>
      <button className="no-drag" onClick={() => window.electronAPI.closeWindow()}
        style={{ position: 'relative', zIndex: 1, width: '28px', height: '28px', borderRadius: '4px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = 'white' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#666' }}>
        <X style={{ width: '14px', height: '14px' }} />
      </button>
    </div>
  )
}

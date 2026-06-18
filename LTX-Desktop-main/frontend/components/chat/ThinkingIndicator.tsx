import React, { useState, useEffect } from 'react';

interface ThinkingIndicatorProps {
  phase?: 'thinking' | 'calling-tool' | 'writing';
  message?: string;
  showIcon?: boolean;
  className?: string;
  thinkingMessages?: string[];
}

const DEFAULT_THINKING_MESSAGES = [
  'Let me think...',
  'Analyzing...',
  'Processing...',
  'Pondering...',
  'Please wait...',
  'Let me see...',
];

const PHASES = [
  { key: 'thinking', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.12)', borderColor: 'rgba(139, 92, 246, 0.25)' },
  { key: 'calling-tool', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.25)' },
  { key: 'writing', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.12)', borderColor: 'rgba(59, 130, 246, 0.25)' },
];

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  phase = 'thinking',
  message,
  showIcon = true,
  className = '',
  thinkingMessages = DEFAULT_THINKING_MESSAGES,
}) => {
  const [showDots, setShowDots] = useState(true);
  const [randomMessage, setRandomMessage] = useState('');

  const currentPhase = PHASES.find(p => p.key === phase) || PHASES[0];

  useEffect(() => {
    if (!message) {
      const randomMsg = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];
      setRandomMessage(randomMsg);
    }
  }, [message, phase, thinkingMessages]);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowDots(prev => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const displayMessage = message || randomMessage;

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
      {showIcon && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse 1.1s ease-in-out infinite' }}>
          <ThinkingIconSvg color={currentPhase.color} />
        </div>
      )}
      <span style={{ fontSize: '11px', color: currentPhase.color, fontWeight: 500, letterSpacing: '-0.01em' }}>
        {displayMessage}
        {showDots && (
          <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '1px' }}>
            <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite' }}>·</span>
            <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.22s' }}>·</span>
            <span style={{ margin: '0 1px', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.44s' }}>·</span>
          </span>
        )}
      </span>
    </div>
  );
};

const ThinkingIconSvg = ({ color = '#8b5cf6', size = 14 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M18 8h1a3 3 0 0 1 0 6h-1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 8h15v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 1v3M10 1v3M14 1v3" stroke={color} strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

export const ThinkingDots: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }} className={className}>
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#a1a1aa', animation: 'typingDot 1.3s ease-in-out infinite' }} />
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#a1a1aa', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.22s' }} />
      <span style={{ width: '5px', height: '5px', borderRadius: '50%', backgroundColor: '#a1a1aa', animation: 'typingDot 1.3s ease-in-out infinite', animationDelay: '0.44s' }} />
    </div>
  );
};

export const ThinkingOverlay: React.FC<{
  isVisible?: boolean;
  className?: string;
}> = ({ isVisible = true, className = '' }) => {
  if (!isVisible) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }} className={className}>
      <div style={{ position: 'relative', marginBottom: '14px' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '14px', backgroundColor: 'rgba(139, 92, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
          <ThinkingIconSvg color="#8b5cf6" size={28} />
        </div>
        <div style={{ position: 'absolute', top: '-3px', right: '-3px', animation: 'spin 1.1s linear infinite' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      <ThinkingIndicator phase="thinking" showIcon={false} />
    </div>
  );
};

export default ThinkingIndicator;

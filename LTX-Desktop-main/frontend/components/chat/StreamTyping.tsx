import React from 'react';
import { ThinkingIndicator, ThinkingDots } from './ThinkingIndicator';

interface StreamTypingProps {
  text: string;
  isStreaming?: boolean;
  showThinking?: boolean;
  thinkingPhase?: 'thinking' | 'calling-tool' | 'writing';
  thinkingMessage?: string;
  showCursor?: boolean;
  className?: string;
  wrapperClassName?: string;
}

export const StreamTyping: React.FC<StreamTypingProps> = ({
  text,
  isStreaming = false,
  showThinking = false,
  thinkingPhase = 'writing',
  thinkingMessage,
  showCursor = true,
  className = '',
  wrapperClassName = '',
}) => {
  const renderContent = () => {
    if (showThinking && !text) {
      return (
        <ThinkingIndicator
          phase={thinkingPhase}
          message={thinkingMessage}
        />
      );
    }

    return (
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} className={className}>
        {text}
        {isStreaming && showCursor && (
          <span 
            className="typing-cursor" 
            style={{ 
              display: 'inline-block', 
              width: '2px', 
              height: '16px', 
              backgroundColor: '#60a5fa', 
              verticalAlign: 'middle',
              marginLeft: '2px',
              animation: 'blink 1s step-end infinite',
            }} 
          />
        )}
      </div>
    );
  };

  return (
    <div style={{ animation: 'fadeInUp 0.3s ease-out' }} className={wrapperClassName}>
      {renderContent()}
    </div>
  );
};

export const TypingMessage: React.FC<{
  text: string;
  className?: string;
  showDots?: boolean;
}> = ({
  text,
  className = '',
  showDots = true,
}) => {
  return (
    <div className={className}>
      <span style={{ whiteSpace: 'pre-wrap' }}>{text}</span>
      {showDots && <ThinkingDots />}
    </div>
  );
};

export default StreamTyping;
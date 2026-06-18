import React, { useState, useEffect } from 'react';

type FeedbackType = 'success' | 'error' | 'loading' | 'welcome';

interface EmotionFeedbackProps {
  type: FeedbackType;
  message?: string;
  duration?: number;
  showIcon?: boolean;
  className?: string;
  onComplete?: () => void;
}

const SuccessIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" fill="#22c55e" />
    <path d="M16 24l6 6 12-12" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="24" cy="24" r="20" stroke="#4ade80" strokeWidth="2" strokeDasharray="4 4" className="animate-spin-slow" />
  </svg>
);

const ErrorIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="20" fill="#ef4444" />
    <path d="M18 18l12 12M30 18l-12 12" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="M24 14v-4M24 38v-4M14 24h-4M38 24h-4" stroke="#fca5a5" strokeWidth="2" strokeLinecap="round" className="animate-pulse" />
  </svg>
);

const WelcomeIcon: React.FC<{ size?: number }> = ({ size = 48 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="20" r="12" fill="#fbbf24" />
    <path d="M12 44c0-8 5-14 12-14s12 6 12 14" fill="#fbbf24" />
    <circle cx="20" cy="18" r="2" fill="#fff" />
    <circle cx="28" cy="18" r="2" fill="#fff" />
    <path d="M20 24c2 2 6 2 8 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const LoadingCarousel: React.FC = () => {
  const icons = [
    { icon: '☕', color: '#a855f7', label: '思考' },
    { icon: '🔧', color: '#eab308', label: '工具' },
    { icon: '✂️', color: '#3b82f6', label: '剪辑' },
    { icon: '🔍', color: '#06b6d4', label: '分析' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '12px' }}>
        {icons.map((item, idx) => (
          <div
            key={idx}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: item.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '16px',
              animation: `carouselBounce 1.2s ease-in-out infinite`,
              animationDelay: `${idx * 0.15}s`,
            }}
          >
            {item.icon}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '4px' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#71717a',
              animation: `typingDot 1.4s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};

const SparkleOverlay: React.FC = () => {
  const sparkles = Array.from({ length: 6 }).map((_, i) => ({
    id: i,
    angle: i * 60,
    delay: i * 0.1,
  }));

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {sparkles.map((sparkle) => (
        <div
          key={sparkle.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(-50%, -50%) rotate(${sparkle.angle}deg) translateY(-35px)`,
            animation: `sparkleBurst 0.8s ease-out forwards`,
            animationDelay: `${sparkle.delay}s`,
            opacity: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24">
            <polygon points="12,2 15,9 22,9 16,14 18,22 12,17 6,22 8,14 2,9 9,9" />
          </svg>
        </div>
      ))}
    </div>
  );
};

export const EmotionFeedback: React.FC<EmotionFeedbackProps> = ({
  type,
  message,
  duration = 2000,
  showIcon = true,
  className = '',
  onComplete,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (type !== 'loading' && type !== 'welcome') {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [type, duration, onComplete]);

  if (!isVisible && type !== 'loading' && type !== 'welcome') {
    return null;
  }

  const getMessage = () => {
    switch (type) {
      case 'success':
        return message || '执行成功！';
      case 'error':
        return message || '抱歉，出现了点问题';
      case 'loading':
        return message || 'AI 正在思考...';
      case 'welcome':
        return message || '欢迎使用 AI 助手';
      default:
        return message;
    }
  };

  const getTextColor = () => {
    switch (type) {
      case 'success': return '#4ade80';
      case 'error': return '#f87171';
      case 'loading': return '#71717a';
      case 'welcome': return '#e4e4e7';
      default: return '#a1a1aa';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
      {showIcon && (
        <div style={{ position: 'relative' }}>
          {type === 'success' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <SuccessIcon size={56} />
              <div style={{ position: 'absolute', inset: 0 }}>
                <SparkleOverlay />
              </div>
            </div>
          )}
          {type === 'error' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'shake 0.5s ease-in-out' }}>
              <ErrorIcon size={56} />
            </div>
          )}
          {type === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <LoadingCarousel />
            </div>
          )}
          {type === 'welcome' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'bounceIn 0.6s ease-out' }}>
              <WelcomeIcon size={56} />
            </div>
          )}
        </div>
      )}

      <p style={{
        fontSize: '14px',
        fontWeight: 500,
        color: getTextColor(),
        margin: 0,
      }}>
        {getMessage()}
      </p>
    </div>
  );
};

export const SuccessFeedback: React.FC<{
  message?: string;
  duration?: number;
  className?: string;
}> = ({ message, duration, className }) => (
  <EmotionFeedback
    type="success"
    message={message}
    duration={duration}
    className={className}
  />
);

export const ErrorFeedback: React.FC<{
  message?: string;
  duration?: number;
  className?: string;
}> = ({ message, duration, className }) => (
  <EmotionFeedback
    type="error"
    message={message}
    duration={duration}
    className={className}
  />
);

export const LoadingFeedback: React.FC<{
  message?: string;
  className?: string;
}> = ({ message, className }) => (
  <EmotionFeedback
    type="loading"
    message={message}
    showIcon={false}
    className={className}
  />
);

export const WelcomeFeedback: React.FC<{
  message?: string;
  className?: string;
}> = ({ message, className }) => (
  <EmotionFeedback
    type="welcome"
    message={message}
    className={className}
  />
);

export default EmotionFeedback;
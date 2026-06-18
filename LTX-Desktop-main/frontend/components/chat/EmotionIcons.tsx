import React from 'react';

type EmotionState = 'thinking' | 'tool' | 'cutting' | 'analyzing' | 'writing' | 'reading' | 'success' | 'error';

interface EmotionIconsProps {
  state: EmotionState;
  size?: number;
  showLabel?: boolean;
  className?: string;
  labels?: Record<EmotionState, string>;
}

const DEFAULT_LABELS: Record<EmotionState, string> = {
  thinking: 'Thinking',
  tool: 'Running tool',
  cutting: 'Cutting',
  analyzing: 'Analyzing',
  writing: 'Writing file',
  reading: 'Reading file',
  success: 'Done',
  error: 'Failed',
};

const ThinkingIconSvg = ({ size = 20, color = '#8b5cf6' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M18 8h1a3 3 0 0 1 0 6h-1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3 8h15v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M6 1v3M10 1v3M14 1v3" stroke={color} strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const ToolIconSvg = ({ size = 20, color = '#f59e0b' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CuttingIconSvg = ({ size = 20, color = '#3b82f6' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="6" cy="6" r="3" stroke={color} strokeWidth="2"/>
    <circle cx="6" cy="18" r="3" stroke={color} strokeWidth="2"/>
    <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const AnalyzingIconSvg = ({ size = 20, color = '#06b6d4' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="11" cy="11" r="8" stroke={color} strokeWidth="2"/>
    <path d="m21 21-4.35-4.35" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M11 8v6M8 11h6" stroke={color} strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const SuccessFaceSvg = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#22c55e"/>
    <circle cx="8" cy="10" r="1.5" fill="#1a1a1a"/>
    <circle cx="16" cy="10" r="1.5" fill="#1a1a1a"/>
    <path d="M8 14c1 2 3 3 4 3s3-1 4-3" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ErrorFaceSvg = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" fill="#ef4444"/>
    <circle cx="8" cy="10" r="1.5" fill="#1a1a1a"/>
    <circle cx="16" cy="10" r="1.5" fill="#1a1a1a"/>
    <path d="M9 15c0 0 1-1 3-1s3 1 3 1" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const EMOTION_CONFIG = {
  thinking: { icon: <ThinkingIconSvg />, color: '#8b5cf6', animation: 'float 2s ease-in-out infinite' },
  tool: { icon: <ToolIconSvg />, color: '#f59e0b', animation: 'bounce 1s ease-in-out infinite' },
  cutting: { icon: <CuttingIconSvg />, color: '#3b82f6', animation: 'pulse 1.5s ease-in-out infinite' },
  analyzing: { icon: <AnalyzingIconSvg />, color: '#06b6d4', animation: 'spin 2s linear infinite' },
  writing: { icon: <ToolIconSvg />, color: '#22c55e', animation: 'pulse 1s ease-in-out infinite' },
  reading: { icon: <ToolIconSvg />, color: '#22c55e', animation: 'bounce 1s ease-in-out infinite' },
  success: { icon: <SuccessFaceSvg />, color: '#22c55e', animation: 'sparkle 1.5s ease-in-out infinite' },
  error: { icon: <ErrorFaceSvg />, color: '#ef4444', animation: 'shake 0.5s ease-in-out infinite' },
};

export const EmotionIcons: React.FC<EmotionIconsProps> = ({
  state,
  size = 16,
  showLabel = false,
  className = '',
  labels = DEFAULT_LABELS,
}) => {
  const config = EMOTION_CONFIG[state];

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }} className={className}>
      <div
        style={{
          width: size,
          height: size,
          animation: config.animation,
        }}
      >
        {React.cloneElement(config.icon as React.ReactElement<{size?: number; color?: string}>, { size, color: config.color })}
      </div>
      {showLabel && (
        <span style={{ fontSize: '11px', color: config.color }}>
          {labels[state]}
        </span>
      )}
    </div>
  );
};

export const ThinkingIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <div style={{ animation: 'float 2s ease-in-out infinite' }} className={className}>
    <ThinkingIconSvg size={size} />
  </div>
);

export const ToolIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <div style={{ animation: 'bounce 1s ease-in-out infinite' }} className={className}>
    <ToolIconSvg size={size} />
  </div>
);

export const CuttingIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <div style={{ animation: 'pulse 1.5s ease-in-out infinite' }} className={className}>
    <CuttingIconSvg size={size} />
  </div>
);

export const AnalyzingIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 20,
  className = '',
}) => (
  <div style={{ animation: 'spin 2s linear infinite' }} className={className}>
    <AnalyzingIconSvg size={size} />
  </div>
);

export const SuccessIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 24,
  className = '',
}) => (
  <div style={{ animation: 'sparkle 1.5s ease-in-out infinite' }} className={className}>
    <SuccessFaceSvg size={size} />
  </div>
);

export const ErrorIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 24,
  className = '',
}) => (
  <div style={{ animation: 'shake 0.5s ease-in-out infinite' }} className={className}>
    <ErrorFaceSvg size={size} />
  </div>
);

export const LoadingCarousel: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const icons = [
    { Icon: ThinkingIconSvg, color: '#8b5cf6' },
    { Icon: ToolIconSvg, color: '#f59e0b' },
    { Icon: AnalyzingIconSvg, color: '#06b6d4' },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} className={className}>
      {icons.map(({ Icon, color }, index) => (
        <div
          key={index}
          style={{
            width: 14,
            height: 14,
            animation: `carouselBounce 1.2s ease-in-out infinite`,
            animationDelay: `${index * 0.15}s`,
          }}
        >
          <Icon size={14} color={color} />
        </div>
      ))}
    </div>
  );
};

export default EmotionIcons;

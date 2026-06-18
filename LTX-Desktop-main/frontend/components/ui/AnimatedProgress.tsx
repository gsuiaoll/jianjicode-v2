import React from 'react';

interface AnimatedProgressProps {
  value?: number;
  max?: number;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  indeterminate?: boolean;
  striped?: boolean;
  animatedStripes?: boolean;
  className?: string;
}

export const AnimatedProgress: React.FC<AnimatedProgressProps> = ({
  value = 0,
  max = 100,
  variant = 'default',
  size = 'md',
  showLabel = false,
  indeterminate = false,
  striped = false,
  animatedStripes = false,
  className = '',
}) => {
  const percentage = Math.min(Math.max(0, (value / max) * 100), 100);

  const sizeStyles = {
    sm: { height: '6px' },
    md: { height: '10px' },
    lg: { height: '16px' },
  };

  const getVariantStyle = () => {
    switch (variant) {
      case 'success':
        return { backgroundColor: '#22c55e' };
      case 'warning':
        return { backgroundColor: '#eab308' };
      case 'error':
        return { backgroundColor: '#ef4444' };
      case 'gradient':
        return { 
          background: 'linear-gradient(to right, #2563eb, #9333ea, #ec4899)',
        };
      default:
        return { backgroundColor: '#2563eb' };
    }
  };

  const getStripedStyle = () => {
    if (striped) {
      return {
        backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.1) 10px, rgba(255,255,255,0.1) 20px)',
      };
    }
    return {};
  };

  return (
    <div style={{ width: '100%' }}>
      <div 
        style={{ 
          width: '100%', 
          overflow: 'hidden', 
          backgroundColor: '#27272a', 
          borderRadius: '9999px',
          ...sizeStyles[size],
        }}
      >
        {indeterminate ? (
          <div
            style={{
              height: '100%',
              width: '33%',
              ...getVariantStyle(),
              animation: 'progressIndeterminate 1.5s ease-in-out infinite',
            }}
          />
        ) : (
          <div
            style={{
              height: '100%',
              width: `${percentage}%`,
              transition: 'width 500ms ease-out',
              ...getVariantStyle(),
              ...getStripedStyle(),
              ...(animatedStripes ? { animation: 'progressStripes 1s linear infinite' } : {}),
            }}
          />
        )}
      </div>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '12px', color: '#a1a1aa' }}>
          <span>{Math.round(percentage)}%</span>
          <span>{Math.round(value)} / {max}</span>
        </div>
      )}
    </div>
  );
};

export default AnimatedProgress;
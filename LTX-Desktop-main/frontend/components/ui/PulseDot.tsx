import React from 'react';

interface PulseDotProps {
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  size?: 'sm' | 'md' | 'lg';
  pulsing?: boolean;
  showLabel?: boolean;
  label?: string;
  className?: string;
}

export const PulseDot: React.FC<PulseDotProps> = ({
  variant = 'default',
  size = 'md',
  pulsing = true,
  showLabel = false,
  label,
  className = '',
}) => {
  const baseClasses = 'rounded-full inline-flex items-center justify-center';
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const variantClasses = {
    default: 'bg-blue-600',
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-cyan-500',
  };

  const pulseClasses = {
    default: 'animate-pulse-dot',
    success: 'animate-pulse-dot-success',
    error: 'animate-pulse-dot-error',
    warning: 'animate-pulse-dot-warning',
    info: 'animate-pulse-dot',
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <div
        className={`
          ${baseClasses}
          ${sizeClasses[size]}
          ${variantClasses[variant]}
          ${pulsing ? pulseClasses[variant] : ''}
        `}
      />
      {showLabel && label && (
        <span className="text-sm text-zinc-300">{label}</span>
      )}
    </div>
  );
};

export default PulseDot;

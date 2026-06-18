import React from 'react';

interface SkeletonLoaderProps {
  variant?: 'text' | 'circular' | 'rectangular' | 'card' | 'avatar' | 'message';
  width?: string | number;
  height?: string | number;
  animation?: 'shimmer' | 'pulse' | 'none';
  count?: number;
  className?: string;
}

const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'text',
  width,
  height,
  animation = 'shimmer',
  count = 1,
  className = '',
}) => {
  const getVariantClasses = () => {
    switch (variant) {
      case 'text':
        return 'h-4 rounded';
      case 'circular':
        return 'rounded-full';
      case 'rectangular':
        return 'rounded-lg';
      case 'card':
        return 'rounded-xl';
      case 'avatar':
        return 'rounded-full';
      case 'message':
        return 'rounded-xl';
      default:
        return 'h-4 rounded';
    }
  };

  const animationClasses = {
    shimmer: 'shimmer',
    pulse: 'skeleton-pulse',
    none: 'bg-zinc-800',
  };

  const getDimensions = () => {
    if (variant === 'text') {
      return {
        width: width || '100%',
        height: height || '16px',
      };
    }
    if (variant === 'avatar') {
      return {
        width: width || '40px',
        height: height || '40px',
      };
    }
    if (variant === 'message') {
      return {
        width: width || '80%',
        height: height || '80px',
      };
    }
    return {
      width: width || '100%',
      height: height || '100px',
    };
  };

  const dimensions = getDimensions();

  const renderMessageSkeleton = () => (
    <div className="flex gap-3 w-full">
      <div
        className={`w-10 h-10 rounded-full ${animationClasses[animation]}`}
      />
      <div className="flex-1 space-y-2">
        <div
          className={`h-4 w-3/4 rounded ${animationClasses[animation]}`}
        />
        <div
          className={`h-4 w-full rounded ${animationClasses[animation]}`}
        />
        <div
          className={`h-4 w-1/2 rounded ${animationClasses[animation]}`}
        />
      </div>
    </div>
  );

  const renderCardSkeleton = () => (
    <div className="space-y-3">
      <div
        className={`h-32 rounded-xl ${animationClasses[animation]}`}
      />
      <div
        className={`h-4 w-3/4 rounded ${animationClasses[animation]}`}
      />
      <div
        className={`h-4 w-1/2 rounded ${animationClasses[animation]}`}
      />
    </div>
  );

  const renderBasicSkeleton = () => {
    if (variant === 'message') {
      return renderMessageSkeleton();
    }
    if (variant === 'card') {
      return renderCardSkeleton();
    }
    return (
      <div
        className={`${getVariantClasses()} ${animationClasses[animation]} ${className}`}
        style={{
          width: dimensions.width,
          height: dimensions.height,
        }}
      />
    );
  };

  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, index) => (
        <div
        key={index}
        className="animate-stagger-1"
        style={{ animationDelay: `${index * 0.1}s` as React.CSSProperties['animationDelay'] }}
      >
          {renderBasicSkeleton()}
        </div>
      ))}
    </div>
  );
};

export const TextSkeleton: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, index) => (
      <div
      key={index}
      className="shimmer h-4 rounded"
      style={{
        width: index === lines - 1 ? '60%' : '100%',
        animationDelay: `${index * 0.1}s`,
      }}
    />
    ))}
  </div>
);

export const AvatarSkeleton: React.FC<{ size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }> = ({
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16',
  };

  return (
    <div className={`shimmer rounded-full ${sizeClasses[size]} ${className}`} />
  );
};

export const MessageSkeleton: React.FC<{ count?: number; className?: string }> = ({
  count = 1,
  className = '',
}) => (
  <div className={`space-y-4 ${className}`}>
    {Array.from({ length: count }).map((_, index) => (
      <div
      key={index}
      className="animate-stagger-1"
      style={{ animationDelay: `${index * 0.15}s` }}
    >
        <SkeletonLoader variant="message" />
      </div>
    ))}
  </div>
);

export default SkeletonLoader;

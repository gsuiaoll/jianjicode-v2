import React, { useState, useEffect } from 'react';
import { CheckCircle2, Star, Zap } from 'lucide-react';

interface SparkleEffectsProps {
  type?: 'success' | 'celebration' | 'loading' | 'magic';
  count?: number;
  duration?: number;
  color?: string;
  className?: string;
}

interface SparkleProps {
  x: number;
  y: number;
  delay: number;
  color: string;
  size: number;
}

const Sparkle: React.FC<SparkleProps> = ({ x, y, delay, color, size }) => (
  <div
  className="absolute pointer-events-none"
  style={{
    left: `${x}%`,
    top: `${y}%`,
    animationDelay: `${delay}s`,
  }}
>
    <Star
      size={size}
      color={color}
      fill={color}
      className="animate-[sparkle_1.5s_ease-out_forwards]"
    />
  </div>
);

interface ConfettiProps {
  x: number;
  delay: number;
  color: string;
}

const Confetti: React.FC<ConfettiProps> = ({ x, delay, color }) => {
  const shapes = ['▲', '●', '■', '◆', '★'];
  const randomShape = shapes[Math.floor(Math.random() * shapes.length)];

  return (
    <div
    className="absolute pointer-events-none text-2xl"
    style={{
      left: `${x}%`,
      bottom: '0%',
      animationDelay: `${delay}s`,
    }}
  >
      <span
        style={{ color }}
        className="animate-[confetti_2s_ease-out_forwards]"
      >
        {randomShape}
      </span>
    </div>
  );
};

export const SparkleEffects: React.FC<SparkleEffectsProps> = ({
  type = 'success',
  count = 8,
  duration = 2000,
  color,
  className = '',
}) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(true);
    const timer = setTimeout(() => setShow(false), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  const getColor = (): string | string[] => {
    if (color) return color;
    switch (type) {
      case 'success':
        return '#22c55e';
      case 'celebration':
        return ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e'];
      case 'magic':
        return '#a855f7';
      default:
        return '#3b82f6';
    }
  };

  const colorResult = getColor();
  const colors: string[] = Array.isArray(colorResult) ? colorResult : [colorResult];

  const sparkles = Array.from({ length: count }).map((_, index) => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    delay: index * 0.15,
    color: colors[Math.floor(Math.random() * colors.length)],
    size: 12 + Math.random() * 12,
  }));

  const confettiPieces = Array.from({ length: count * 2 }).map((_, index) => ({
    x: Math.random() * 100,
    delay: index * 0.1,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  if (!show) return null;

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {sparkles.map((sparkle, index) => (
        <Sparkle
          key={`sparkle-${index}`}
          x={sparkle.x}
          y={sparkle.y}
          delay={sparkle.delay}
          color={sparkle.color}
          size={sparkle.size}
        />
      ))}
      {type === 'celebration' &&
        confettiPieces.map((confetti, index) => (
          <Confetti
            key={`confetti-${index}`}
            x={confetti.x}
            delay={confetti.delay}
            color={confetti.color}
          />
        ))}
    </div>
  );
};

export const SuccessBurst: React.FC<{
  text?: string;
  showIcon?: boolean;
  className?: string;
}> = ({ text, showIcon = true, className = '' }) => {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-6 ${className}`}>
      <div className="relative">
        {showIcon && (
          <CheckCircle2
            size={48}
            className="text-green-500 animate-bounce-in"
          />
        )}
        <SparkleEffects type="success" count={6} duration={2500} />
      </div>
      {text && (
        <p className="text-lg font-medium text-zinc-200 animate-fade-in-up">
          {text}
        </p>
      )}
    </div>
  );
};

export const MagicLoader: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <div className="animate-bounce-in" style={{ animationDelay: '0s' }}>
        <Zap size={20} className="text-yellow-500" />
      </div>
      <div className="animate-bounce-in" style={{ animationDelay: '0.1s' }}>
        <Zap size={20} className="text-yellow-400" />
      </div>
      <div className="animate-bounce-in" style={{ animationDelay: '0.2s' }}>
        <Zap size={20} className="text-yellow-500" />
      </div>
    </div>
  );
};

export const Celebration: React.FC<{
  title?: string;
  subtitle?: string;
  className?: string;
}> = ({ title, subtitle, className = '' }) => {
  return (
    <div className={`relative flex flex-col items-center justify-center gap-4 p-8 ${className}`}>
      <SparkleEffects type="celebration" count={12} duration={3000} />
      {title && (
        <h3 className="text-xl font-bold text-white animate-fade-in-up">
          {title}
        </h3>
      )}
      {subtitle && (
        <p className="text-sm text-zinc-400 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default SparkleEffects;

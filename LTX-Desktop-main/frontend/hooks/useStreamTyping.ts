import { useState, useEffect, useRef, useCallback } from 'react';

export interface UseStreamTypingOptions {
  speed?: 'slow' | 'normal' | 'fast' | 'instant';
  startDelay?: number;
  cursor?: boolean;
  enabled?: boolean;
}

export type StreamTypingState = 'idle' | 'typing' | 'thinking' | 'complete' | 'error';

export interface UseStreamTypingReturn {
  displayText: string;
  state: StreamTypingState;
  isTyping: boolean;
  isThinking: boolean;
  isComplete: boolean;
  startTyping: (text: string) => void;
  setThinking: () => void;
  setComplete: () => void;
  reset: () => void;
}

const SPEEDS = {
  slow: 80,
  normal: 40,
  fast: 15,
  instant: 0,
};

export function useStreamTyping(options: UseStreamTypingOptions = {}): UseStreamTypingReturn {
  const {
    speed = 'normal',
    startDelay = 0,
    enabled = true,
  } = options;

  const [displayText, setDisplayText] = useState('');
  const [state, setState] = useState<StreamTypingState>('idle');
  const currentIndexRef = useRef(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fullTextRef = useRef('');

  const isTyping = state === 'typing';
  const isThinking = state === 'thinking';
  const isComplete = state === 'complete';

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const getTypingDelay = useCallback((char: string, _index: number): number => {
    let baseDelay = SPEEDS[speed];
    if (speed === 'instant') return 0;

    if (['.', '!', '?', '。', '！', '？'].includes(char)) {
      baseDelay *= 3;
    } else if ([',', '，', ';', '；', ':'].includes(char)) {
      baseDelay *= 2;
    } else if (['\n', '\r'].includes(char)) {
      baseDelay *= 4;
    }

    return baseDelay;
  }, [speed]);

  const typeNextChar = useCallback(() => {
    if (!enabled || !fullTextRef.current) return;

    const currentIndex = currentIndexRef.current;
    const targetText = fullTextRef.current;

    if (currentIndex >= targetText.length) {
      setState('complete');
      return;
    }

    const nextChar = targetText[currentIndex];
    const delay = getTypingDelay(nextChar, currentIndex);

    setDisplayText(targetText.slice(0, currentIndex + 1));
    currentIndexRef.current += 1;

    timeoutRef.current = setTimeout(() => {
      typeNextChar();
    }, delay);
  }, [enabled, getTypingDelay]);

  const startTyping = useCallback((text: string) => {
    clearTimers();
    fullTextRef.current = text;
    currentIndexRef.current = 0;
    setDisplayText('');
    setState('typing');

    if (startDelay > 0) {
      timeoutRef.current = setTimeout(() => {
        typeNextChar();
      }, startDelay);
    } else {
      typeNextChar();
    }
  }, [clearTimers, startDelay, typeNextChar]);

  const setThinking = useCallback(() => {
    clearTimers();
    setState('thinking');
    setDisplayText('');
  }, [clearTimers]);

  const setComplete = useCallback(() => {
    clearTimers();
    if (fullTextRef.current) {
      setDisplayText(fullTextRef.current);
    }
    setState('complete');
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    currentIndexRef.current = 0;
    fullTextRef.current = '';
    setDisplayText('');
    setState('idle');
  }, [clearTimers]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  return {
    displayText,
    state,
    isTyping,
    isThinking,
    isComplete,
    startTyping,
    setThinking,
    setComplete,
    reset,
  };
}

export default useStreamTyping;

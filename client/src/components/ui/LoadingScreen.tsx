import React, { useState, useEffect } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';

export interface LoadingScreenProps {
  fullscreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  statusMessage?: string;
  errorState?: {
    message: string;
    onRetry?: () => void;
    onContinueOffline?: () => void;
  } | null;
  isFadingOut?: boolean;
}

const DecryptText: React.FC<{ text: string }> = ({ text }) => {
  const [displayText, setDisplayText] = useState(text);
  const [isDecrypted, setIsDecrypted] = useState(false);

  useEffect(() => {
    setIsDecrypted(false);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*<>[]{}';
    let iteration = 0;
    const interval = setInterval(() => {
      setDisplayText(
        text
          .split('')
          .map((char, index) => {
            if (char === ' ' || index < iteration) return text[index];
            return chars[Math.floor(Math.random() * chars.length)];
          })
          .join('')
      );

      if (iteration >= text.length) {
        clearInterval(interval);
        setIsDecrypted(true);
      }
      iteration += 1 / 2;
    }, 30);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <span
      className={`font-mono text-xs tracking-wider transition-all duration-300 ${
        isDecrypted
          ? 'text-indigo-200 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)] animate-pulse'
          : 'text-indigo-400 font-bold drop-shadow-[0_0_12px_rgba(99,102,241,0.8)]'
      }`}
    >
      {displayText}
    </span>
  );
};

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  fullscreen = true,
  size = 'md',
  className = '',
  statusMessage,
  errorState,
  isFadingOut = false,
}) => {
  const sizeMap = {
    sm: {
      container: 'w-16 h-16',
      card: 'w-8 h-8 rounded-lg',
      emblem: 'text-sm',
      ringOuter: 'border',
      ringInner: 'border',
    },
    md: {
      container: 'w-24 h-24',
      card: 'w-12 h-12 rounded-xl',
      emblem: 'text-xl',
      ringOuter: 'border-2',
      ringInner: 'border-2',
    },
    lg: {
      container: 'w-32 h-32',
      card: 'w-16 h-16 rounded-2xl',
      emblem: 'text-2xl',
      ringOuter: 'border-[3px]',
      ringInner: 'border-[3px]',
    },
  };

  const currentSize = sizeMap[size];

  const content = (
    <div className={`relative flex items-center justify-center ${currentSize.container} ${className}`}>
      {/* Anel Externo - Órbita Horária Neon Índigo */}
      <div
        className={`absolute inset-0 rounded-full ${currentSize.ringOuter} border-transparent border-t-indigo-500 border-r-indigo-400/40 animate-xolas-orbit-cw`}
      />

      {/* Anel Interno - Órbita Anti-Horária Neon Púrpura */}
      <div
        className={`absolute inset-2 rounded-full ${currentSize.ringInner} border-transparent border-b-purple-500 border-l-purple-400/30 animate-xolas-orbit-ccw`}
      />

      {/* Card Central com Glow e Emblema de Comando ⌘ */}
      <div
        className={`${currentSize.card} bg-gradient-to-b from-[#161926] to-[#0a0b10] border border-white/15 flex items-center justify-center animate-xolas-pulse-glow z-10 shadow-2xl`}
      >
        <span className={`text-white font-bold font-mono select-none ${currentSize.emblem}`}>
          ⌘
        </span>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div
        className={`fixed inset-0 z-50 bg-obsidian-bg flex flex-col items-center justify-center select-none overflow-hidden transition-opacity duration-300 ease-out ${
          isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        {content}

        {/* Feedback visual dinâmico ou estado de timeout/erro */}
        {errorState ? (
          <div className="mt-8 flex flex-col items-center gap-3 max-w-sm px-6 text-center">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>{errorState.message}</span>
            </div>
            <div className="flex items-center gap-2.5 mt-1">
              {errorState.onRetry && (
                <button
                  type="button"
                  onClick={errorState.onRetry}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-md shadow-indigo-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tentar Novamente</span>
                </button>
              )}
              {errorState.onContinueOffline && (
                <button
                  type="button"
                  onClick={errorState.onContinueOffline}
                  className="px-3.5 py-1.5 rounded-lg bg-obsidian-card hover:bg-obsidian-hover border border-obsidian-border text-obsidian-text-secondary hover:text-white text-xs font-medium transition-colors"
                >
                  Continuar Offline
                </button>
              )}
            </div>
          </div>
        ) : statusMessage ? (
          <div className="mt-8 flex items-center gap-2.5 text-obsidian-text-secondary text-xs tracking-wide font-medium">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse shadow-sm shadow-indigo-500/50" />
            <DecryptText text={statusMessage} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {content}
      {statusMessage && (
        <div className="mt-3 flex items-center gap-2 text-obsidian-text-secondary text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          <DecryptText text={statusMessage} />
        </div>
      )}
    </div>
  );
};

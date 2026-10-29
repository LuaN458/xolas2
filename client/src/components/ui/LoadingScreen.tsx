import React from 'react';

interface LoadingScreenProps {
  fullscreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  fullscreen = true,
  size = 'md',
  className = '',
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
      <div className="h-screen w-screen bg-obsidian-bg flex items-center justify-center select-none overflow-hidden">
        {content}
      </div>
    );
  }

  return content;
};

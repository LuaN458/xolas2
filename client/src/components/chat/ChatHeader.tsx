import React from 'react';
import { Hash, Volume2, Users, Search } from 'lucide-react';
import { Channel } from '../../types';

interface ChatHeaderProps {
  channel: Channel;
  onToggleMembersDrawer?: () => void;
  membersCount?: number;
  isMembersDrawerOpen?: boolean;
  onOpenSearch?: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  channel,
  onToggleMembersDrawer,
  membersCount = 0,
  isMembersDrawerOpen = false,
  onOpenSearch,
}) => {
  return (
    <header className="h-12 border-b border-zinc-800 px-4 flex items-center justify-between bg-zinc-950 shrink-0 select-none">
      <div className="flex items-center gap-2 min-w-0">
        {channel.type === 'VOICE' ? (
          <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <Hash className="w-4 h-4 text-indigo-400 shrink-0" />
        )}
        <h1 className="text-xs font-semibold text-zinc-100 truncate">{channel.name}</h1>
        <span className="text-zinc-600 text-xs">/</span>
        <span className="text-[11px] text-zinc-400 truncate hidden sm:inline">
          {channel.type === 'TEXT'
            ? 'Canal de discussões em tempo real'
            : 'Estúdio de áudio e streaming de tela'}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-md transition-colors"
            title="Buscar ou comandos (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <kbd className="text-[10px] font-mono text-zinc-500 hidden md:inline">Ctrl + K</kbd>
          </button>
        )}

        {onToggleMembersDrawer && (
          <button
            onClick={onToggleMembersDrawer}
            className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-colors ${
              isMembersDrawerOpen
                ? 'bg-zinc-800 text-white border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border-zinc-800'
            }`}
            title="Alternar painel de participantes"
          >
            <Users className="w-3.5 h-3.5" />
            <span>{membersCount} membros</span>
          </button>
        )}
      </div>
    </header>
  );
};

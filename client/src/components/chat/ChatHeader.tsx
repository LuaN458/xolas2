import React from 'react';
import { MessageSquareText, Radio, Search } from 'lucide-react';
import { Channel } from '../../types';

interface ChatHeaderProps {
  channel: Channel;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({ channel }) => {
  return (
    <header className="h-13 border-b border-obsidian-border px-5 flex items-center justify-between bg-obsidian-bg/80 backdrop-blur-md shrink-0 select-none">
      <div className="flex items-center space-x-2.5">
        <div className="p-1 rounded-md bg-obsidian-card border border-obsidian-border text-obsidian-text-muted">
          {channel.type === 'TEXT' ? (
            <MessageSquareText className="w-4 h-4 text-obsidian-accent" />
          ) : (
            <Radio className="w-4 h-4 text-obsidian-emerald" />
          )}
        </div>
        <h1 className="font-semibold text-obsidian-text-primary text-sm tracking-tight">
          {channel.name}
        </h1>
        <div className="w-[1px] h-3.5 bg-obsidian-border mx-2" />
        <span className="text-obsidian-text-muted text-xs hidden sm:inline font-normal">
          {channel.type === 'TEXT'
            ? 'Espaço de discussão em tempo real'
            : 'Canal de voz e streaming de tela'}
        </span>
      </div>

      <div className="flex items-center space-x-2">
        <div className="flex items-center space-x-1.5 px-2 py-1 rounded-lg bg-obsidian-card border border-obsidian-border text-obsidian-text-muted text-[11px] font-mono">
          <Search className="w-3 h-3 text-obsidian-text-muted" />
          <span>Ctrl + K</span>
        </div>
      </div>
    </header>
  );
};

import React from 'react';
import { Message } from '../../types';
import { Trash2 } from 'lucide-react';

interface MessageItemProps {
  message: Message;
  isAdmin?: boolean;
  onDelete?: (messageId: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isAdmin, onDelete }) => {
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const safeAvatarUrl =
    message.user.avatarUrl &&
    (message.user.avatarUrl.startsWith('https://') ||
     message.user.avatarUrl.startsWith('http://') ||
     message.user.avatarUrl.startsWith('data:image/'))
      ? message.user.avatarUrl
      : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(message.user.username)}`;

  return (
    <div className="relative flex space-x-3 px-4 py-2 hover:bg-obsidian-card/40 transition-colors group rounded-xl">
      <img
        src={safeAvatarUrl}
        alt={message.user.username}
        className="w-8 h-8 rounded-lg bg-obsidian-card border border-obsidian-border shrink-0 cursor-pointer mt-0.5"
      />
      <div className="flex-1 min-w-0 pr-8">
        <div className="flex items-baseline space-x-2 mb-0.5">
          <span className="font-semibold text-obsidian-text-primary text-xs hover:underline cursor-pointer">
            {message.user.username}
          </span>
          <span className="text-[10px] text-obsidian-text-muted font-mono">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <p className="text-obsidian-text-secondary text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
          {message.content}
        </p>
      </div>

      {/* Ações de Moderação (Exclusivo Administrador) */}
      {isAdmin && onDelete && (
        <div className="absolute right-3 top-2 hidden group-hover:flex items-center space-x-1 bg-obsidian-surface/95 backdrop-blur border border-obsidian-border px-1.5 py-1 rounded-lg shadow-md animate-in fade-in duration-100">
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            title="Excluir mensagem (Admin)"
            className="p-1 rounded text-obsidian-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

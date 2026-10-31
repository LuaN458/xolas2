import React, { useState } from 'react';
import { Message } from '../../types';
import { Trash2 } from 'lucide-react';
import { API_BASE } from '../../lib/api';
import { ImageLightboxModal } from './ImageLightboxModal';

interface MessageItemProps {
  message: Message;
  isAdmin?: boolean;
  onDelete?: (messageId: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message, isAdmin, onDelete }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const getFullAttachmentUrl = (url?: string | null): string => {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) return url;
    return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const safeAvatarUrl =
    message.user.avatarUrl &&
    (message.user.avatarUrl.startsWith('https://') ||
     message.user.avatarUrl.startsWith('http://') ||
     message.user.avatarUrl.startsWith('data:image/'))
      ? message.user.avatarUrl
      : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(message.user.username)}`;

  const attachmentUrl = getFullAttachmentUrl(message.attachmentUrl);

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

        {message.content && (
          <p className="text-obsidian-text-secondary text-xs leading-relaxed break-words whitespace-pre-wrap select-text">
            {message.content}
          </p>
        )}

        {/* Imagem / Print anexado */}
        {attachmentUrl && (
          <div className="mt-2 inline-block max-w-sm sm:max-w-md">
            {imageError ? (
              <div className="p-3 rounded-xl bg-obsidian-card border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
                <span>Falha ao carregar anexo de imagem.</span>
              </div>
            ) : (
              <div
                onClick={() => setLightboxOpen(true)}
                className="relative group/img cursor-pointer overflow-hidden rounded-xl border border-obsidian-border bg-obsidian-card/60 transition-all hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10"
              >
                {!imageLoaded && (
                  <div className="w-56 h-40 bg-obsidian-card animate-pulse flex items-center justify-center">
                    <span className="text-[11px] text-obsidian-text-muted">Carregando imagem...</span>
                  </div>
                )}
                <img
                  src={attachmentUrl}
                  alt="Anexo enviado no chat"
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                  className={`max-h-72 max-w-full rounded-xl object-contain transition-all duration-200 group-hover/img:scale-[1.01] ${
                    imageLoaded ? 'block' : 'hidden'
                  }`}
                />
                <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-end justify-end p-2 opacity-0 group-hover/img:opacity-100">
                  <span className="text-[10px] bg-black/75 text-white px-2 py-0.5 rounded-md backdrop-blur-sm border border-white/10">
                    Clique para ampliar
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
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

      {/* Modal Lightbox ao clicar na imagem */}
      {lightboxOpen && attachmentUrl && (
        <ImageLightboxModal
          imageUrl={attachmentUrl}
          senderName={message.user.username}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};

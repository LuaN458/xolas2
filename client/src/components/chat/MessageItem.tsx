import React, { useState, useEffect, useRef } from 'react';
import { Message } from '../../types';
import { Trash2, Loader2, ImageOff } from 'lucide-react';
import { API_BASE } from '../../lib/api';
import { ImageLightboxModal } from './ImageLightboxModal';
import {
  getCachedImageObjectUrl,
  getMemoryCachedObjectUrl,
  saveImageToCache,
} from '../../lib/imageCache';

interface MessageItemProps {
  message: Message;
  isAdmin?: boolean;
  onDelete?: (messageId: string) => void;
  layoutMode?: 'linear' | 'campsite' | 'compact';
}

interface ContentPart {
  type: 'text' | 'link';
  value: string;
  href?: string;
}

function parseMessageContent(text: string): ContentPart[] {
  if (!text) return [];
  const parts: ContentPart[] = [];
  const regex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|(?:www\.[^\s<]+[^<.,:;"')\]\s]))/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const url = match[0];
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      parts.push({ type: 'text', value: text.substring(lastIndex, matchStart) });
    }
    const href = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    parts.push({ type: 'link', value: url, href });
    lastIndex = matchStart + url.length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.substring(lastIndex) });
  }

  return parts;
}

const handleOpenExternal = (e: React.MouseEvent, href: string) => {
  e.preventDefault();
  e.stopPropagation();
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(href);
  } else {
    window.open(href, '_blank', 'noopener,noreferrer');
  }
};

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  isAdmin,
  onDelete,
  layoutMode = 'linear',
}) => {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

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
    if (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('data:image/') ||
      url.startsWith('blob:')
    ) {
      return url;
    }
    return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const safeAvatarUrl =
    message.user.avatarUrl &&
    (message.user.avatarUrl.startsWith('https://') ||
      message.user.avatarUrl.startsWith('http://') ||
      message.user.avatarUrl.startsWith('data:image/'))
      ? message.user.avatarUrl
      : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(
          message.user.username
        )}`;

  const attachmentUrl = getFullAttachmentUrl(message.attachmentUrl);

  const initialMemoryUrl = attachmentUrl ? getMemoryCachedObjectUrl(attachmentUrl) : null;
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string>(
    initialMemoryUrl || attachmentUrl
  );
  const [imageLoaded, setImageLoaded] = useState<boolean>(Boolean(initialMemoryUrl));
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!attachmentUrl) return;

    let isMounted = true;

    if (initialMemoryUrl) {
      setImageLoaded(true);
      return;
    }

    if (imgRef.current?.complete && imgRef.current?.naturalWidth > 0) {
      setImageLoaded(true);
      return;
    }

    const timer = setTimeout(() => {
      if (isMounted && !imageLoaded) {
        setImageLoaded(true);
      }
    }, 4000);

    getCachedImageObjectUrl(attachmentUrl)
      .then((cachedBlobUrl) => {
        if (!isMounted) return;
        if (cachedBlobUrl) {
          setResolvedImageUrl(cachedBlobUrl);
          setImageLoaded(true);
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [attachmentUrl, initialMemoryUrl, imageLoaded]);

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);

    if (
      attachmentUrl &&
      attachmentUrl.startsWith('http') &&
      !resolvedImageUrl.startsWith('blob:')
    ) {
      fetch(attachmentUrl)
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (blob) {
            saveImageToCache(attachmentUrl, blob).then((newBlobUrl) => {
              if (newBlobUrl) {
                setResolvedImageUrl(newBlobUrl);
              }
            });
          }
        })
        .catch(() => {});
    }
  };

  // Renderizador de Anexos
  const renderAttachment = () => {
    if (!attachmentUrl) return null;
    return (
      <div className="mt-2 inline-block max-w-sm sm:max-w-md">
        {imageError ? (
          <div className="p-3 rounded-xl bg-zinc-900 border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
            <ImageOff className="w-4 h-4 shrink-0 text-rose-400" />
            <span>Falha ao carregar imagem.</span>
          </div>
        ) : (
          <div
            onClick={() => setLightboxOpen(true)}
            className="relative group/img cursor-pointer overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 transition-all hover:border-zinc-700 hover:shadow-lg min-w-[14rem]"
          >
            {!imageLoaded && (
              <div className="w-56 h-40 bg-zinc-900 animate-pulse flex flex-col items-center justify-center space-y-2 border border-zinc-800 rounded-xl">
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                <span className="text-[10px] text-zinc-500 font-mono">Processando imagem...</span>
              </div>
            )}

            <img
              ref={imgRef}
              src={resolvedImageUrl}
              alt="Anexo"
              onLoad={handleImageLoad}
              onError={() => setImageError(true)}
              className={`max-h-72 max-w-full rounded-xl object-contain transition-all duration-200 group-hover/img:scale-[1.01] ${
                imageLoaded
                  ? 'block opacity-100'
                  : 'absolute inset-0 w-0 h-0 opacity-0 pointer-events-none'
              }`}
            />

            {imageLoaded && (
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-end justify-end p-2 opacity-0 group-hover/img:opacity-100">
                <span className="text-[10px] bg-black/75 text-white px-2 py-0.5 rounded-md backdrop-blur-sm border border-white/10 font-mono">
                  Ampliar
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const userRole =
    (message.user as any)?.customRole?.name ||
    ((message.user as any)?.role === 'ADMIN' ? 'Admin' : null);

  // 1. MODO COMPACT (Dual-Pane / Alta Densidade)
  if (layoutMode === 'compact') {
    return (
      <div className="py-1 px-2 rounded hover:bg-zinc-900/60 flex items-baseline gap-3 text-xs leading-5 relative group transition-colors">
        <span className="text-[10px] font-mono text-zinc-500 shrink-0 tabular-nums">
          {formatTime(message.createdAt)}
        </span>
        <span className="font-semibold text-zinc-200 shrink-0 hover:underline cursor-pointer">
          {message.user.username}:
        </span>
        <div className="text-zinc-300 flex-1 min-w-0 break-words">
          {parseMessageContent(message.content).map((part, index) =>
            part.type === 'link' && part.href ? (
              <a
                key={index}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleOpenExternal(e, part.href!)}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 break-all"
              >
                {part.value}
              </a>
            ) : (
              <span key={index}>{part.value}</span>
            )
          )}
          {renderAttachment()}
        </div>

        {isAdmin && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            title="Excluir mensagem"
            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-opacity shrink-0"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}

        {lightboxOpen && (
          <ImageLightboxModal
            imageUrl={resolvedImageUrl}
            senderName={message.user.username}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </div>
    );
  }

  // 2. MODO CAMPSITE (Cards de Tópicos)
  if (layoutMode === 'campsite') {
    return (
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-2 relative group hover:bg-zinc-900/50 transition-colors shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {userRole && (
              <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                {userRole}
              </span>
            )}
            <span className="text-xs font-semibold text-zinc-200">{message.user.username}</span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
            {formatTime(message.createdAt)}
          </span>
        </div>

        <p className="text-xs text-zinc-300 leading-relaxed break-words whitespace-pre-wrap select-text">
          {parseMessageContent(message.content).map((part, index) =>
            part.type === 'link' && part.href ? (
              <a
                key={index}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => handleOpenExternal(e, part.href!)}
                className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 break-all"
              >
                {part.value}
              </a>
            ) : (
              <span key={index}>{part.value}</span>
            )
          )}
        </p>

        {renderAttachment()}

        {isAdmin && onDelete && (
          <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              title="Excluir mensagem (Admin)"
              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {lightboxOpen && (
          <ImageLightboxModal
            imageUrl={resolvedImageUrl}
            senderName={message.user.username}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </div>
    );
  }

  // 3. MODO LINEAR / MONOLITH (Padrão)
  return (
    <article className="p-4 hover:bg-zinc-900/40 transition-colors relative group">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src={safeAvatarUrl}
            alt={message.user.username}
            className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 object-cover shrink-0"
          />
          <span className="text-xs font-semibold text-zinc-200 hover:underline cursor-pointer">
            {message.user.username}
          </span>
          {userRole && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              {userRole}
            </span>
          )}
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
            {formatTime(message.createdAt)}
          </span>
        </div>

        {isAdmin && onDelete && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1">
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              title="Excluir mensagem (Admin)"
              className="p-1 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 text-xs leading-relaxed text-zinc-300 pl-8 break-words whitespace-pre-wrap select-text">
        {parseMessageContent(message.content).map((part, index) =>
          part.type === 'link' && part.href ? (
            <a
              key={index}
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => handleOpenExternal(e, part.href!)}
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 break-all font-medium transition-colors"
            >
              {part.value}
            </a>
          ) : (
            <span key={index}>{part.value}</span>
          )
        )}
        {renderAttachment()}
      </div>

      {lightboxOpen && (
        <ImageLightboxModal
          imageUrl={resolvedImageUrl}
          senderName={message.user.username}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </article>
  );
};

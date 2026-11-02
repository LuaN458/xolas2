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

export const MessageItem: React.FC<MessageItemProps> = ({ message, isAdmin, onDelete }) => {
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
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/') || url.startsWith('blob:')) {
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
      : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(message.user.username)}`;

  const attachmentUrl = getFullAttachmentUrl(message.attachmentUrl);

  // Inicialização inteligente a partir do cache em memória (síncrono)
  const initialMemoryUrl = attachmentUrl ? getMemoryCachedObjectUrl(attachmentUrl) : null;
  const [resolvedImageUrl, setResolvedImageUrl] = useState<string>(initialMemoryUrl || attachmentUrl);
  const [imageLoaded, setImageLoaded] = useState<boolean>(Boolean(initialMemoryUrl));
  const [imageError, setImageError] = useState(false);

  // Recuperação do cache persistente IndexedDB e prevenção de travamento infinito
  useEffect(() => {
    if (!attachmentUrl) return;

    let isMounted = true;

    // Se já estiver em memória, já está pronto
    if (initialMemoryUrl) {
      setImageLoaded(true);
      return;
    }

    // Verificar se o elemento de imagem do navegador já completou de imediato (cache nativo)
    if (imgRef.current?.complete && imgRef.current?.naturalWidth > 0) {
      setImageLoaded(true);
    }

    // Tentar obter do IndexedDB persistente
    getCachedImageObjectUrl(attachmentUrl).then((cachedObjectUrl) => {
      if (!isMounted) return;
      if (cachedObjectUrl) {
        setResolvedImageUrl(cachedObjectUrl);
        setImageLoaded(true);
      }
    });

    // Timeout de segurança: se a imagem não carregar após 12 segundos, exibe estado de falha/reconexão
    const timeoutTimer = setTimeout(() => {
      if (isMounted && !imageLoaded) {
        if (!imgRef.current?.complete) {
          setImageError(true);
        }
      }
    }, 12000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutTimer);
    };
  }, [attachmentUrl, initialMemoryUrl, imageLoaded]);

  // Callback executado ao carregar a imagem com sucesso
  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError(false);

    // Se ainda não estava em cache de blob local, salvar para persistência imediata
    if (attachmentUrl && !attachmentUrl.startsWith('blob:') && !resolvedImageUrl.startsWith('blob:')) {
      fetch(attachmentUrl)
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (blob) {
            saveImageToCache(attachmentUrl, blob).then((cachedUrl) => {
              if (cachedUrl) setResolvedImageUrl(cachedUrl);
            });
          }
        })
        .catch(() => {});
    }
  };

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
            {parseMessageContent(message.content).map((part, index) => {
              if (part.type === 'link' && part.href) {
                return (
                  <a
                    key={index}
                    href={part.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => handleOpenExternal(e, part.href!)}
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 break-all transition-colors cursor-pointer font-medium"
                    title={`Abrir ${part.href} no navegador`}
                  >
                    {part.value}
                  </a>
                );
              }
              return <span key={index}>{part.value}</span>;
            })}
          </p>
        )}

        {/* Imagem / Print anexado com Cache Inteligente */}
        {attachmentUrl && (
          <div className="mt-2 inline-block max-w-sm sm:max-w-md">
            {imageError ? (
              <div className="p-3 rounded-xl bg-obsidian-card border border-rose-500/20 text-rose-300 text-xs flex items-center space-x-2">
                <ImageOff className="w-4 h-4 shrink-0 text-rose-400" />
                <span>Falha ao carregar anexo de imagem.</span>
              </div>
            ) : (
              <div
                onClick={() => setLightboxOpen(true)}
                className="relative group/img cursor-pointer overflow-hidden rounded-xl border border-obsidian-border bg-obsidian-card/60 transition-all hover:border-indigo-500/50 hover:shadow-lg hover:shadow-indigo-500/10 min-w-[14rem]"
              >
                {/* Placeholder animado enquanto processa / baixa */}
                {!imageLoaded && (
                  <div className="w-56 h-40 bg-obsidian-card animate-pulse flex flex-col items-center justify-center space-y-2 border border-obsidian-border rounded-xl">
                    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    <span className="text-[10px] text-obsidian-text-muted font-mono">Processando imagem...</span>
                  </div>
                )}

                {/* Imagem sempre renderizada no DOM para evitar deadlocks de display:none */}
                <img
                  ref={imgRef}
                  src={resolvedImageUrl}
                  alt="Anexo enviado no chat"
                  onLoad={handleImageLoad}
                  onError={() => setImageError(true)}
                  className={`max-h-72 max-w-full rounded-xl object-contain transition-all duration-200 group-hover/img:scale-[1.01] ${
                    imageLoaded ? 'block opacity-100' : 'absolute inset-0 w-0 h-0 opacity-0 pointer-events-none'
                  }`}
                />

                {imageLoaded && (
                  <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 transition-colors flex items-end justify-end p-2 opacity-0 group-hover/img:opacity-100">
                    <span className="text-[10px] bg-black/75 text-white px-2 py-0.5 rounded-md backdrop-blur-sm border border-white/10">
                      Clique para ampliar
                    </span>
                  </div>
                )}
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
      {lightboxOpen && (
        <ImageLightboxModal
          imageUrl={resolvedImageUrl}
          senderName={message.user.username}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
};

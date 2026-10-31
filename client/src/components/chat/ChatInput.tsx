import React, { useState, useRef, useEffect, KeyboardEvent, ChangeEvent, ClipboardEvent, DragEvent } from 'react';
import { ArrowUp, Paperclip, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

interface ChatInputProps {
  channelName: string;
  onSendMessage: (content: string, attachmentUrl?: string) => void;
}

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

export const ChatInput: React.FC<ChatInputProps> = ({ channelName, onSendMessage }) => {
  const [content, setContent] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // Limpeza de URL de pré-visualização da memória quando o arquivo muda ou descarrega
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleSetPendingFile = (file: File) => {
    setUploadError(null);

    // Validação de tipo MIME
    if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
      setUploadError('Formato inválido. Envie apenas imagens PNG, JPG, WebP ou GIF.');
      return;
    }

    // Validação de tamanho (máximo 8 MB)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError('A imagem excede o tamanho máximo permitido de 8 MB.');
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const newPreviewUrl = URL.createObjectURL(file);
    setPendingFile(file);
    setPreviewUrl(newPreviewUrl);
  };

  const handleCancelAttachment = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPendingFile(null);
    setPreviewUrl(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleSetPendingFile(files[0]);
    }
  };

  // Suporte a colar print da área de transferência (Ctrl+V)
  const handlePaste = (e: ClipboardEvent<HTMLInputElement | HTMLDivElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Verificar se há arquivo nos itens da área de transferência
    const items = clipboardData.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            // Para capturas de tela/prints, atribuir um nome representativo se vier vazio
            const namedFile = file.name
              ? file
              : new File([file], `print-${Date.now()}.png`, { type: file.type || 'image/png' });
            handleSetPendingFile(namedFile);
            return;
          }
        }
      }
    }

    // Fallback: verificar se há arquivos na lista direta
    if (clipboardData.files && clipboardData.files.length > 0) {
      const file = clipboardData.files[0];
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        handleSetPendingFile(file);
      }
    }
  };

  // Suporte a Drag & Drop de imagens na área de envio
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setIsDragging(false);
      dragCounterRef.current = 0;
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        handleSetPendingFile(file);
      } else {
        setUploadError('Apenas arquivos de imagem são suportados.');
      }
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const trimmedContent = content.trim();

    // Precisa ter pelo menos texto ou anexo
    if (!trimmedContent && !pendingFile) return;
    if (isUploading) return;

    let uploadedAttachmentUrl: string | undefined = undefined;

    // Se houver anexo pendente, fazer upload com proteções antes de emitir a mensagem
    if (pendingFile) {
      try {
        setIsUploading(true);
        setUploadError(null);

        const formData = new FormData();
        formData.append('image', pendingFile);

        const response = await api.post('/api/upload/chat-image', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        if (response.data && response.data.url) {
          uploadedAttachmentUrl = response.data.url;
        } else {
          throw new Error('Falha ao receber a URL do anexo.');
        }
      } catch (err: any) {
        console.error('Erro no upload de imagem:', err);
        const errorMsg =
          err.response?.data?.error ||
          err.message ||
          'Não foi possível enviar a imagem. Tente novamente.';
        setUploadError(errorMsg);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    onSendMessage(trimmedContent, uploadedAttachmentUrl);

    // Limpar estados após envio com sucesso
    setContent('');
    handleCancelAttachment();
  };

  const canSubmit = (Boolean(content.trim()) || Boolean(pendingFile)) && !isUploading;

  return (
    <div
      className="p-4 bg-obsidian-bg shrink-0 select-none relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Alerta de erro de upload */}
      {uploadError && (
        <div className="mb-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between animate-in fade-in duration-150">
          <span className="truncate pr-2">{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-rose-400 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Miniatura de Pré-visualização da Imagem Anexada */}
      {pendingFile && previewUrl && (
        <div className="mb-2.5 p-2 bg-obsidian-surface border border-indigo-500/40 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-1 duration-150 shadow-lg shadow-indigo-500/5">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-obsidian-border bg-obsidian-card shrink-0">
              <img
                src={previewUrl}
                alt="Preview do anexo"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-semibold text-obsidian-text-primary truncate">
                {pendingFile.name || 'Captura de tela (Print)'}
              </span>
              <span className="text-[10px] text-obsidian-text-muted">
                {(pendingFile.size / 1024).toFixed(0)} KB • Imagem pronta para envio
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelAttachment}
            disabled={isUploading}
            title="Remover anexo"
            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input escondido para seleção de arquivos via botão do clipe */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Caixa de Entrada Principal */}
      <div
        className={`bg-obsidian-card border rounded-xl flex items-center px-3.5 py-2 transition-all relative ${
          isDragging
            ? 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.25)]'
            : 'border-obsidian-border focus-within:border-obsidian-accent/60 focus-within:shadow-[0_0_15px_rgba(99,102,241,0.15)]'
        }`}
      >
        {/* Overlay de Drag & Drop */}
        {isDragging && (
          <div className="absolute inset-0 bg-indigo-950/70 backdrop-blur-sm rounded-xl flex items-center justify-center space-x-2 text-indigo-200 text-xs font-semibold pointer-events-none z-10 border-2 border-dashed border-indigo-400">
            <ImageIcon className="w-4 h-4 animate-bounce" />
            <span>Solte a imagem ou print aqui</span>
          </div>
        )}

        {/* Botão de Anexo (Paperclip) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="text-obsidian-text-secondary hover:text-white transition-colors mr-2.5 p-1.5 rounded-lg hover:bg-obsidian-surface border border-transparent hover:border-obsidian-border disabled:opacity-50"
          title="Anexar imagem ou print (ou cole com Ctrl+V)"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {/* Campo de Texto */}
        <input
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={isUploading}
          placeholder={
            pendingFile
              ? 'Adicionar legenda à imagem (opcional)...'
              : `Enviar mensagem ou colar print em #${channelName}...`
          }
          className="bg-transparent flex-1 text-obsidian-text-primary placeholder-obsidian-text-muted text-xs outline-none disabled:opacity-60"
        />

        {/* Botão de Envio ou Indicador de Enter */}
        <div className="flex items-center space-x-2 ml-2">
          {isUploading ? (
            <div className="w-7 h-7 rounded-xl bg-indigo-600/80 flex items-center justify-center text-white">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : canSubmit ? (
            <button
              type="button"
              onClick={handleSubmit}
              className="w-7 h-7 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-all shadow-md shadow-indigo-600/30 border border-indigo-400/40"
              title="Enviar mensagem"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          ) : (
            <span className="text-[10px] text-obsidian-text-muted font-mono px-2 py-0.5 rounded-lg bg-obsidian-surface border border-obsidian-border">
              ↵ Enter
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

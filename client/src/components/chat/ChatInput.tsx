import React, { useState, useRef, useEffect, KeyboardEvent, ChangeEvent, ClipboardEvent, DragEvent } from 'react';
import { ArrowUp, Paperclip, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api, API_BASE } from '../../lib/api';
import { saveImageToCache } from '../../lib/imageCache';

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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
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

    // Validação de arquivo vazio (comum em descritores virtuais do Windows Snipping Tool)
    if (!file || file.size <= 0) {
      setUploadError('A imagem colada está vazia (0 KB) ou ainda não foi processada pela área de transferência. Tente colar novamente.');
      return;
    }

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
    setUploadProgress(null);
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
    // Resetar o input para permitir selecionar o mesmo arquivo novamente
    e.target.value = '';
  };

  const generateCleanPrintName = (originalName?: string) => {
    const isGuid = /^\{?[0-9a-fA-F-]{36}\}?\.png$/i.test(originalName || '');
    if (!originalName || isGuid || originalName === 'image.png') {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      return `print-${timestamp}.png`;
    }
    return originalName;
  };

  // Suporte a colar print da área de transferência (Ctrl+V)
  const handlePaste = async (e: ClipboardEvent<HTMLInputElement | HTMLDivElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Verificar se há arquivo nos itens da área de transferência com bytes reais (> 0)
    const items = clipboardData.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file && file.size > 0) {
            e.preventDefault();
            const cleanName = generateCleanPrintName(file.name);
            const namedFile = new File([file], cleanName, { type: file.type || 'image/png' });
            handleSetPendingFile(namedFile);
            return;
          }
        }
      }
    }

    // 2. Fallback: verificar se há arquivos na lista direta de files com conteúdo (> 0)
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        const file = clipboardData.files[i];
        if (file.type.startsWith('image/') && file.size > 0) {
          e.preventDefault();
          const cleanName = generateCleanPrintName(file.name);
          const namedFile = new File([file], cleanName, { type: file.type || 'image/png' });
          handleSetPendingFile(namedFile);
          return;
        }
      }
    }

    // 3. Fallback assíncrono para navigator.clipboard se os itens vierem com delayed rendering
    if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
      try {
        const clipItems = await navigator.clipboard.read();
        for (const clipItem of clipItems) {
          const imageType = clipItem.types.find((t) => t.startsWith('image/'));
          if (imageType) {
            const blob = await clipItem.getType(imageType);
            if (blob && blob.size > 0) {
              e.preventDefault();
              const cleanName = generateCleanPrintName();
              const namedFile = new File([blob], cleanName, { type: imageType });
              handleSetPendingFile(namedFile);
              return;
            }
          }
        }
      } catch {}
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

    // Se houver anexo pendente, fazer upload com proteções e barra de progresso antes de emitir a mensagem
    if (pendingFile) {
      try {
        setIsUploading(true);
        setUploadProgress(0);
        setUploadError(null);

        const formData = new FormData();
        formData.append('image', pendingFile);

        const response = await api.post('/api/upload/chat-image', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && progressEvent.total > 0) {
              const percent = Math.min(
                100,
                Math.round((progressEvent.loaded * 100) / progressEvent.total)
              );
              setUploadProgress(percent);
            }
          },
        });

        if (response.data && typeof response.data.url === 'string') {
          const finalUrl: string = response.data.url;
          uploadedAttachmentUrl = finalUrl;
          setUploadProgress(100);

          // Salvar imediatamente no cache local em memória e IndexedDB para renderização instantânea
          saveImageToCache(finalUrl, pendingFile).catch(() => {});
          const fullUrl = `${API_BASE}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`;
          saveImageToCache(fullUrl, pendingFile).catch(() => {});
        } else {
          throw new Error('Falha ao receber a URL do anexo.');
        }
      } catch (err: any) {
        console.error('Erro no upload de imagem:', err);
        let errorMsg = err.response?.data?.error;
        if (!errorMsg) {
          if (err.response?.status === 404) {
            errorMsg = 'O serviço de upload está reiniciando ou atualizando na nuvem. Aguarde alguns instantes e tente novamente.';
          } else if (err.response?.status === 413) {
            errorMsg = 'A imagem enviada excede o limite máximo permitido de 8 MB.';
          } else if (err.response?.status === 401 || err.response?.status === 403) {
            errorMsg = 'Você não possui permissão para enviar imagens. Verifique se sua conta foi aprovada.';
          } else if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
            errorMsg = 'O envio da imagem demorou muito. Verifique sua conexão e tente novamente.';
          } else {
            errorMsg = err.message || 'Não foi possível enviar a imagem. Tente novamente.';
          }
        }
        setUploadError(errorMsg);
        setUploadProgress(null);
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    onSendMessage(trimmedContent, uploadedAttachmentUrl);

    // Limpar estados após envio com sucesso
    setContent('');
    setUploadProgress(null);
    handleCancelAttachment();
  };

  const canSubmit = (Boolean(content.trim()) || Boolean(pendingFile)) && !isUploading;

  return (
    <div
      className="p-4 sm:px-8 bg-zinc-950 shrink-0 select-none relative w-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="max-w-4xl mx-auto w-full">
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
          <div className="mb-2.5 p-2 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-1 duration-150 shadow-lg">
            <div className="flex items-center space-x-3 overflow-hidden flex-1 mr-2">
              <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 shrink-0">
                <img
                  src={previewUrl}
                  alt="Preview do anexo"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-zinc-200 truncate">
                  {pendingFile.name || 'Captura de tela (Print)'}
                </span>
                {isUploading ? (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-indigo-300 font-mono">
                      <span className="flex items-center">
                        <Loader2 className="w-3 h-3 animate-spin mr-1 inline" />
                        Enviando imagem...
                      </span>
                      <span className="font-bold">{uploadProgress ?? 0}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all duration-150 ease-out"
                        style={{ width: `${Math.max(5, uploadProgress ?? 0)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-[10px] text-zinc-400 font-mono">
                    {pendingFile.size < 1024 * 1024
                      ? `${Math.max(1, Math.round(pendingFile.size / 1024))} KB`
                      : `${(pendingFile.size / (1024 * 1024)).toFixed(1)} MB`}{' '}
                    • Imagem pronta para envio
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelAttachment}
              disabled={isUploading}
              title="Remover anexo"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
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

        {/* Caixa de Entrada Principal (Composer Flutuante) */}
        <div
          className={`bg-zinc-900 border rounded-2xl flex items-center p-1.5 pl-3 transition-all relative ${
            isDragging
              ? 'border-indigo-500 bg-indigo-950/20 shadow-[0_0_20px_rgba(99,102,241,0.25)]'
              : 'border-zinc-800 focus-within:border-zinc-700 shadow-sm'
          }`}
        >
          {/* Overlay de Drag & Drop */}
          {isDragging && (
            <div className="absolute inset-0 bg-zinc-900/90 backdrop-blur-sm rounded-2xl flex items-center justify-center space-x-2 text-indigo-300 text-xs font-semibold pointer-events-none z-10 border-2 border-dashed border-indigo-400">
              <ImageIcon className="w-4 h-4 animate-bounce" />
              <span>Solte a imagem ou print aqui</span>
            </div>
          )}

          {/* Botão de Anexo (Paperclip) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-zinc-400 hover:text-zinc-200 transition-colors p-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-50 shrink-0"
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
                : `Mensagem para #${channelName}...`
            }
            className="w-full bg-transparent border-0 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none px-3 py-1.5 disabled:opacity-60"
          />

          {/* Botão de Envio */}
          <div className="flex items-center shrink-0 ml-1">
            {isUploading ? (
              <div className="p-2 rounded-xl bg-zinc-800 text-zinc-400 flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`p-2 rounded-xl transition-all flex items-center justify-center ${
                  canSubmit
                    ? 'bg-zinc-100 hover:bg-white text-zinc-950 font-medium shadow-sm'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
                title={canSubmit ? 'Enviar mensagem (Enter)' : 'Digite uma mensagem'}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

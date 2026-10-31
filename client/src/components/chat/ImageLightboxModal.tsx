import React, { useEffect, useState, useCallback } from 'react';
import { X, Download, ExternalLink, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string;
  senderName?: string;
  onClose: () => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  senderName,
  onClose,
}) => {
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);

  // Fechar com a tecla ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScale(1);
  };

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        const filename = imageUrl.split('/').pop() || 'imagem.jpg';
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      } catch {
        // Fallback para abertura direta
        window.open(imageUrl, '_blank');
      }
    },
    [imageUrl]
  );

  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(imageUrl, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-between p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      {/* Barra Superior de Controles */}
      <div
        className="w-full max-w-5xl flex items-center justify-between py-2 px-4 bg-obsidian-surface/80 border border-obsidian-border/80 rounded-2xl backdrop-blur-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-white">Visualização de Imagem</span>
          {senderName && (
            <span className="text-xs text-obsidian-text-muted">
              • enviada por <strong className="text-indigo-300">{senderName}</strong>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5">
          {/* Zoom */}
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            title="Reduzir zoom"
            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-obsidian-card disabled:opacity-40 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-obsidian-text-secondary px-1 min-w-[42px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= 3}
            title="Aumentar zoom"
            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-obsidian-card disabled:opacity-40 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          {scale !== 1 && (
            <button
              type="button"
              onClick={handleResetZoom}
              title="Resetar zoom"
              className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-obsidian-card transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="w-px h-4 bg-obsidian-border mx-1" />

          {/* Download */}
          <button
            type="button"
            onClick={handleDownload}
            title="Baixar imagem"
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-obsidian-text-secondary hover:text-white hover:bg-obsidian-card transition-colors border border-transparent hover:border-obsidian-border"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Baixar</span>
          </button>

          {/* Abrir original */}
          <button
            type="button"
            onClick={handleOpenOriginal}
            title="Abrir imagem original em nova aba"
            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-obsidian-card transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </button>

          {/* Fechar */}
          <button
            type="button"
            onClick={onClose}
            title="Fechar (Esc)"
            className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-rose-400 hover:bg-rose-500/10 transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Área Central da Imagem */}
      <div
        className="flex-1 w-full flex items-center justify-center overflow-auto p-4"
        onClick={onClose}
      >
        <div
          className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-100 ease-out"
          style={{ transform: `scale(${scale})` }}
          onClick={(e) => e.stopPropagation()}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center min-w-[200px] min-h-[200px]">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <img
            src={imageUrl}
            alt="Anexo de chat ampliado"
            onLoad={() => setLoading(false)}
            className={`max-w-[85vw] max-h-[80vh] object-contain rounded-xl shadow-2xl border border-obsidian-border/50 select-none ${
              loading ? 'opacity-0' : 'opacity-100'
            } transition-opacity duration-200`}
            draggable={false}
          />
        </div>
      </div>

      {/* Dica no Rodapé */}
      <div className="text-[11px] text-obsidian-text-muted pb-1 select-none">
        Clique fora ou pressione <kbd className="font-mono bg-obsidian-surface border border-obsidian-border px-1.5 py-0.5 rounded text-[10px]">ESC</kbd> para fechar
      </div>
    </div>
  );
};

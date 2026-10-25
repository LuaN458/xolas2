import React, { useState, useEffect } from 'react';
import { Sparkles, Download, RefreshCw, X, ArrowUpCircle } from 'lucide-react';
import { UpdateInfo, UpdateProgress } from '../../types';

export const UpdateNotificationBanner: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;

    const unregAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setIsDownloading(true);
      setIsDismissed(false);
    });

    const unregProgress = window.electronAPI.onUpdateProgress?.((progress: UpdateProgress) => {
      setIsDownloading(true);
      setDownloadProgress(Math.round(progress.percent || 0));
    });

    const unregDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateInfo(info);
      setIsDownloading(false);
      setIsReady(true);
      setIsDismissed(false);
    });

    return () => {
      unregAvailable?.();
      unregProgress?.();
      unregDownloaded?.();
    };
  }, []);

  if (isDismissed || (!isDownloading && !isReady)) {
    return null;
  }

  const handleRestart = () => {
    window.electronAPI?.restartAndInstall?.();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full bg-obsidian-surface border border-indigo-500/40 rounded-2xl shadow-2xl shadow-indigo-500/20 p-4 animate-in fade-in slide-in-from-bottom-3 duration-300 backdrop-blur-md">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            {isReady ? (
              <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
            ) : (
              <Download className="w-4 h-4 text-indigo-400 animate-bounce" />
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-white tracking-wide flex items-center space-x-1.5">
              <span>{isReady ? 'Nova Versão Pronta!' : 'Baixando Atualização...'}</span>
              {updateInfo?.version && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  v{updateInfo.version}
                </span>
              )}
            </h4>
            <p className="text-[11px] text-obsidian-text-muted mt-0.5">
              {isReady
                ? 'O Xolas foi atualizado. Reinicie para aplicar as novidades.'
                : `Progresso: ${downloadProgress}% em segundo plano`}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsDismissed(true)}
          className="text-obsidian-text-muted hover:text-white transition-colors p-1"
          title="Ocultar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Barra de progresso durante o download */}
      {isDownloading && !isReady && (
        <div className="mt-3 w-full h-1.5 bg-obsidian-card rounded-full overflow-hidden border border-obsidian-border">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 rounded-full transition-all duration-300"
            style={{ width: `${Math.max(5, downloadProgress)}%` }}
          />
        </div>
      )}

      {/* Botões de Ação */}
      {isReady && (
        <div className="mt-3 flex items-center space-x-2">
          <button
            onClick={handleRestart}
            className="flex-1 py-1.5 px-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-500/30 flex items-center justify-center space-x-1.5 transition-all"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            <span>Reiniciar e Atualizar</span>
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="py-1.5 px-3 bg-obsidian-card hover:bg-obsidian-card-hover text-obsidian-text-secondary hover:text-white rounded-xl text-xs font-medium border border-obsidian-border transition-colors"
          >
            Depois
          </button>
        </div>
      )}
    </div>
  );
};

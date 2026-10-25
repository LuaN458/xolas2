import React, { useState, useEffect } from 'react';
import { ArrowUpCircle, Sparkles, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { UpdateInfo, UpdateProgress } from '../../types';

interface ForceUpdateModalProps {
  isLoggedIn: boolean;
}

export const ForceUpdateModal: React.FC<ForceUpdateModalProps> = ({ isLoggedIn }) => {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!window.electronAPI) return;

    // Checar atualizações ativamente na montagem
    window.electronAPI.checkForUpdates?.().catch(() => {});

    const unregAvailable = window.electronAPI.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setIsDownloading(true);
    });

    const unregProgress = window.electronAPI.onUpdateProgress?.((progress: UpdateProgress) => {
      setIsDownloading(true);
      setDownloadProgress(Math.round(progress.percent || 0));
    });

    const unregDownloaded = window.electronAPI.onUpdateDownloaded?.((info) => {
      setUpdateInfo(info);
      setIsDownloading(false);
      setIsReady(true);
      // Se o usuário não estiver logado, inicia contagem regressiva para reiniciar automaticamente
      if (!isLoggedIn) {
        setCountdown(5);
      }
    });

    return () => {
      unregAvailable?.();
      unregProgress?.();
      unregDownloaded?.();
    };
  }, [isLoggedIn]);

  // Contagem regressiva para reinicialização automática quando a atualização estiver pronta
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      window.electronAPI?.restartAndInstall?.();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown]);

  // Se não houver atualização em andamento, não renderiza nada
  if (!isDownloading && !isReady) {
    return null;
  }

  // Se o usuário já estiver logado, deixamos o UpdateNotificationBanner lidar de forma não intrusiva.
  // Se o usuário NÃO estiver logado, forçamos o modal em tela cheia porque a versão antiga não consegue conectar.
  if (isLoggedIn) {
    return null;
  }

  const handleRestartNow = () => {
    window.electronAPI?.restartAndInstall?.();
  };

  const handleOpenGitHub = () => {
    const url = 'https://github.com/LuaN458/xolas2/releases/latest';
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-obsidian-bg/90 backdrop-blur-xl flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
      <div className="bg-obsidian-surface border border-indigo-500/40 rounded-3xl w-full max-w-md p-8 shadow-2xl shadow-indigo-600/30 text-center relative overflow-hidden">
        {/* Glow de fundo */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-lg shadow-indigo-500/20">
            {isReady ? (
              <Sparkles className="w-7 h-7 text-emerald-400 animate-pulse" />
            ) : (
              <Download className="w-7 h-7 text-indigo-400 animate-bounce" />
            )}
          </div>

          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 mb-3">
            <span>Atualização Obrigatória</span>
            {updateInfo?.version && <span>• v{updateInfo.version}</span>}
          </span>

          <h2 className="text-xl font-bold text-white tracking-tight mb-2">
            {isReady ? 'Nova Versão Pronta!' : 'Atualizando o Xolas...'}
          </h2>

          <p className="text-xs text-obsidian-text-muted leading-relaxed mb-6">
            {isReady
              ? `A atualização foi baixada com sucesso. ${
                  countdown !== null && countdown > 0
                    ? `Reiniciando automaticamente em ${countdown}s para aplicar...`
                    : 'Reinicie para acessar seus espaços na nuvem.'
                }`
              : 'Uma versão mais recente é necessária para se conectar aos servidores da nuvem. O download já começou em segundo plano.'}
          </p>

          {/* Barra de Progresso */}
          {isDownloading && !isReady && (
            <div className="mb-6 space-y-2">
              <div className="w-full h-2.5 bg-obsidian-card rounded-full overflow-hidden border border-obsidian-border p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.max(6, downloadProgress)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-obsidian-text-muted font-mono">
                <span>Baixando arquivos...</span>
                <span className="text-indigo-400 font-bold">{downloadProgress}%</span>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="space-y-2.5">
            {isReady ? (
              <button
                onClick={handleRestartNow}
                className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all"
              >
                <ArrowUpCircle className="w-4 h-4" />
                <span>Reiniciar e Aplicar Agora {countdown !== null && `(${countdown}s)`}</span>
              </button>
            ) : (
              <div className="py-2.5 px-4 bg-obsidian-card/60 rounded-xl border border-obsidian-border text-xs text-obsidian-text-muted flex items-center justify-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>Aguarde o download finalizar...</span>
              </div>
            )}

            <button
              onClick={handleOpenGitHub}
              className="w-full py-2 px-4 text-[11px] text-obsidian-text-muted hover:text-indigo-300 transition-colors flex items-center justify-center space-x-1.5"
            >
              <span>Baixar instalador manualmente pelo GitHub</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

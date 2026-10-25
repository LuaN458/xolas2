import React, { useEffect, useState, useCallback } from 'react';
import { ScreenSource } from '../../types';
import { useVoice, ScreenQualityOptions } from '../../contexts/VoiceContext';
import { Monitor, X, AppWindow, Check, Sparkles, RefreshCw, Volume2, VolumeX } from 'lucide-react';

interface ScreenShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (sourceId?: string, quality?: ScreenQualityOptions) => void;
}

export const ScreenShareModal: React.FC<ScreenShareModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
}) => {
  const { screenQuality, updateScreenQualityPreset } = useVoice();
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'screens' | 'windows'>('screens');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);

  // Opções de Qualidade e Áudio (inicializadas a partir das preferências salvas localmente)
  const [resolution, setResolution] = useState<'720p' | '1080p'>(screenQuality.resolution);
  const [fps, setFps] = useState<30 | 60>(screenQuality.fps);
  const [includeAudio, setIncludeAudio] = useState(screenQuality.includeAudio ?? true);

  // Sincronizar com as preferências ao abrir
  useEffect(() => {
    if (isOpen) {
      setResolution(screenQuality.resolution);
      setFps(screenQuality.fps);
      setIncludeAudio(screenQuality.includeAudio ?? true);
    }
  }, [isOpen, screenQuality]);

  const handleResolutionChange = useCallback(
    (newRes: '720p' | '1080p') => {
      setResolution(newRes);
      updateScreenQualityPreset({ resolution: newRes, fps, includeAudio });
    },
    [fps, includeAudio, updateScreenQualityPreset]
  );

  const handleFpsChange = useCallback(
    (newFps: 30 | 60) => {
      setFps(newFps);
      updateScreenQualityPreset({ resolution, fps: newFps, includeAudio });
    },
    [resolution, includeAudio, updateScreenQualityPreset]
  );

  const handleToggleAudio = useCallback(() => {
    setIncludeAudio((prev) => {
      const next = !prev;
      updateScreenQualityPreset({ resolution, fps, includeAudio: next });
      return next;
    });
  }, [resolution, fps, updateScreenQualityPreset]);

  const fetchSources = async () => {
    setLoading(true);
    if (window.electronAPI?.getScreenSources) {
      try {
        const res = await window.electronAPI.getScreenSources();
        setSources(res);
        if (res.length > 0) {
          const screensList = res.filter((s) => s.id.startsWith('screen:'));
          if (screensList.length > 0) {
            setSelectedSourceId(screensList[0].id);
            setActiveTab('screens');
          } else {
            setSelectedSourceId(res[0].id);
            setActiveTab('windows');
          }
        }
      } catch (err) {
        console.error('Falha ao obter fontes do Electron:', err);
      } finally {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSources();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  const handleStartShare = () => {
    updateScreenQualityPreset({ resolution, fps, includeAudio });
    onSelectSource(selectedSourceId || undefined, { resolution, fps, includeAudio });
    onClose();
  };

  const handleTabChange = (tab: 'screens' | 'windows') => {
    setActiveTab(tab);
    const target = tab === 'screens' ? screens : windows;
    if (target.length > 0) {
      setSelectedSourceId(target[0].id);
    }
  };

  const currentTabItems = activeTab === 'screens' ? screens : windows;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-in fade-in select-none">
      <div className="bg-obsidian-surface rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl border border-obsidian-border flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="p-4 px-6 border-b border-obsidian-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-white">
            <div className="p-1.5 rounded-lg bg-obsidian-accent/20 border border-obsidian-accent/40 text-indigo-400">
              <Monitor className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm tracking-tight text-white">Transmitir Tela ou Janela</h2>
              <p className="text-[11px] text-obsidian-text-muted">Selecione o monitor ou janela de aplicativo que deseja compartilhar</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={fetchSources}
              className="p-1.5 rounded-lg text-obsidian-text-muted hover:text-white hover:bg-obsidian-card transition-colors"
              title="Recarregar Janelas"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="text-obsidian-text-muted hover:text-white transition-colors p-1.5 rounded-lg hover:bg-obsidian-card"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Abas e Controles de Qualidade */}
        <div className="px-6 py-3 bg-obsidian-bg border-b border-obsidian-border flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Abas com Pílulas e Contadores */}
          <div className="flex space-x-2 font-semibold">
            <button
              onClick={() => handleTabChange('screens')}
              className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-2 text-xs font-medium border ${
                activeTab === 'screens'
                  ? 'bg-obsidian-card text-white border-obsidian-accent shadow-sm shadow-indigo-500/25 ring-1 ring-obsidian-accent/30'
                  : 'text-obsidian-text-secondary border-obsidian-border/50 hover:text-white hover:bg-obsidian-card/60'
              }`}
            >
              <Monitor className="w-4 h-4 text-indigo-400" />
              <span>Telas Inteiras</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold ${
                  activeTab === 'screens' ? 'bg-indigo-600 text-white' : 'bg-obsidian-surface text-obsidian-text-muted'
                }`}
              >
                {screens.length}
              </span>
            </button>

            <button
              onClick={() => handleTabChange('windows')}
              className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center space-x-2 text-xs font-medium border ${
                activeTab === 'windows'
                  ? 'bg-obsidian-card text-white border-obsidian-accent shadow-sm shadow-indigo-500/25 ring-1 ring-obsidian-accent/30'
                  : 'text-obsidian-text-secondary border-obsidian-border/50 hover:text-white hover:bg-obsidian-card/60'
              }`}
            >
              <AppWindow className="w-4 h-4 text-indigo-400" />
              <span>Janelas de Apps</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold ${
                  activeTab === 'windows' ? 'bg-indigo-600 text-white' : 'bg-obsidian-surface text-obsidian-text-muted'
                }`}
              >
                {windows.length}
              </span>
            </button>
          </div>

          {/* Seletores de Resolução e FPS de Alto Contraste */}
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center bg-obsidian-card p-1 rounded-xl border border-obsidian-border shadow-sm">
              <button
                onClick={() => handleResolutionChange('720p')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all ${
                  resolution === '720p'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-obsidian-text-secondary hover:text-white'
                }`}
              >
                720p
              </button>
              <button
                onClick={() => handleResolutionChange('1080p')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all ${
                  resolution === '1080p'
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-obsidian-text-secondary hover:text-white'
                }`}
              >
                1080p
              </button>
            </div>

            <div className="flex items-center bg-obsidian-card p-1 rounded-xl border border-obsidian-border shadow-sm">
              <button
                onClick={() => handleFpsChange(30)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all ${
                  fps === 30
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-obsidian-text-secondary hover:text-white'
                }`}
              >
                30 FPS
              </button>
              <button
                onClick={() => handleFpsChange(60)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all ${
                  fps === 60
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-500/30'
                    : 'text-obsidian-text-secondary hover:text-white'
                }`}
              >
                60 FPS
              </button>
            </div>

            {/* Toggle de Isolamento de Áudio da Tela */}
            <button
              onClick={handleToggleAudio}
              className={`px-3 py-1.5 rounded-xl border flex items-center space-x-1.5 text-[11px] font-semibold transition-all shadow-sm ${
                includeAudio
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-emerald-500/10'
                  : 'bg-obsidian-card text-obsidian-text-muted border-obsidian-border hover:text-white'
              }`}
              title={
                includeAudio
                  ? 'Transmitir áudio desta tela (ignora outros aplicativos e telas não selecionadas)'
                  : 'Sem transmissão de áudio da tela'
              }
            >
              {includeAudio ? (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-obsidian-text-muted" />
              )}
              <span>{includeAudio ? 'Áudio da Tela Ativo' : 'Sem Áudio'}</span>
            </button>
          </div>
        </div>

        {/* Grade de Miniaturas das Telas e Janelas */}
        <div className="p-6 flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center py-16 text-obsidian-text-muted text-xs font-mono space-y-2">
              <div className="w-6 h-6 border-2 border-obsidian-accent border-t-transparent rounded-full animate-spin mx-auto" />
              <p>Capturando telas e janelas disponíveis...</p>
            </div>
          ) : sources.length === 0 ? (
            <div className="text-center py-12 px-6 flex flex-col items-center justify-center space-y-4 max-w-md mx-auto">
              <div className="p-3 bg-obsidian-accent/10 border border-obsidian-accent/30 rounded-2xl text-indigo-400">
                <Monitor className="w-8 h-8 stroke-[1.5]" />
              </div>
              <div>
                <h3 className="text-white text-sm font-semibold mb-1">Compartilhar Tela do Sistema</h3>
                <p className="text-obsidian-text-muted text-xs leading-relaxed">
                  Você pode selecionar qualquer tela inteira, janela de aplicativo ou guia com transmissão de áudio de alta fidelidade.
                </p>
              </div>
              <button
                onClick={handleStartShare}
                className="px-6 py-2.5 bg-obsidian-accent hover:bg-obsidian-accent-hover text-white rounded-xl text-xs font-semibold transition-all shadow-lg shadow-indigo-500/25 flex items-center space-x-2"
              >
                <span>Selecionar Tela Agora</span>
              </button>
            </div>
          ) : currentTabItems.length === 0 ? (
            <div className="text-center py-12 px-6 flex flex-col items-center justify-center space-y-3">
              <p className="text-obsidian-text-muted text-xs">
                {activeTab === 'windows'
                  ? 'Nenhuma janela de app individual encontrada. Você pode compartilhar seu monitor inteiro na aba Telas Inteiras.'
                  : 'Nenhum monitor secundário detectado. Verifique suas conexões de vídeo.'}
              </p>
              {activeTab === 'windows' && screens.length > 0 && (
                <button
                  onClick={() => handleTabChange('screens')}
                  className="px-4 py-1.5 bg-obsidian-card hover:bg-obsidian-card-hover border border-obsidian-border text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Ir para Telas Inteiras ({screens.length})
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5">
              {currentTabItems.map((source) => {
                const isSelected = selectedSourceId === source.id;
                return (
                  <div
                    key={source.id}
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={handleStartShare}
                    className={`relative rounded-xl p-2 cursor-pointer transition-all border flex flex-col group ${
                      isSelected
                        ? 'bg-obsidian-card border-obsidian-accent shadow-lg shadow-indigo-500/20 ring-1 ring-obsidian-accent'
                        : 'bg-obsidian-card/40 hover:bg-obsidian-card border-obsidian-border hover:border-obsidian-border-light'
                    }`}
                  >
                    {/* Badge de Selecionado */}
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-obsidian-accent text-white flex items-center justify-center shadow-md shadow-indigo-500/40 z-10">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}

                    {/* Miniatura em Alta Resolução */}
                    <div className="aspect-video bg-black/60 rounded-lg overflow-hidden mb-2 flex items-center justify-center border border-obsidian-border relative group-hover:opacity-95">
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt={source.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-obsidian-text-muted space-y-1">
                          <Monitor className="w-6 h-6 opacity-40" />
                          <span className="text-[10px]">Sem prévia</span>
                        </div>
                      )}
                    </div>

                    {/* Título e Ícone */}
                    <div className="flex items-center space-x-1.5 px-0.5">
                      {source.appIcon ? (
                        <img src={source.appIcon} alt="" className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Monitor className="w-3.5 h-3.5 text-obsidian-text-muted shrink-0" />
                      )}
                      <span className="text-obsidian-text-primary text-[11px] font-medium truncate flex-1">
                        {source.name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Rodapé com Botão de Ação */}
        <div className="p-4 px-6 bg-obsidian-bg border-t border-obsidian-border flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-obsidian-text-muted">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>
              Transmitindo em <strong>{resolution}</strong> a <strong>{fps} FPS</strong>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-obsidian-text-secondary hover:text-white hover:bg-obsidian-card text-xs font-semibold transition-all rounded-xl border border-obsidian-border/50 hover:border-obsidian-border"
            >
              Cancelar
            </button>
            <button
              onClick={handleStartShare}
              disabled={sources.length > 0 && !selectedSourceId}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/35 border border-indigo-400/40 flex items-center space-x-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span>{sources.length === 0 ? 'Abrir Seletor de Tela' : 'Iniciar Transmissão'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

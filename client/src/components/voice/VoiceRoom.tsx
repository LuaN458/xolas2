import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Channel } from '../../types';
import { useVoice, ScreenQualityOptions } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { ParticipantTile } from './ParticipantTile';
import { ScreenShareModal } from './ScreenShareModal';
import { UserAudioContextMenu } from './UserAudioContextMenu';
import { VoiceParticipantInfo } from '../layout/ChannelSidebar';
import {
  getUserSettings,
  saveUserSetting,
  subscribeToSettingsChange,
  formatAcceleratorForDisplay,
} from '../../lib/userSettings';
import {
  Mic,
  MicOff,
  PhoneOff,
  Monitor,
  MonitorOff,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Info,
  Volume2,
  Volume1,
  VolumeX,
  Users,
  LayoutGrid,
} from 'lucide-react';

interface VoiceRoomProps {
  channel: Channel;
  onDisconnect?: () => void;
  socketParticipants?: VoiceParticipantInfo[];
}

export const VoiceRoom: React.FC<VoiceRoomProps> = ({ channel, onDisconnect, socketParticipants = [] }) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const isAdmin = user?.role === 'ADMIN';
  const {
    isMuted,
    toggleMute,
    leaveVoiceChannel,
    isScreenSharing,
    screenStream,
    screenQuality,
    startScreenShare,
    stopScreenShare,
    livekitUrl,
    masterVolume,
    voiceParticipants,
    activeScreenShares,
    selectedScreenShareId,
    setSelectedScreenShareId,
    watchScreenShare,
    setUserVolume,
    toggleMuteUser,
    getUserVolume,
    isUserMuted,
    isDeafened,
    toggleDeafen,
    isMuted: selfIsMuted,
    toggleMute: selfToggleMute,
  } = useVoice();

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamVolume, setStreamVolume] = useState<number>(() => getUserSettings().streamVolume);
  const [isStreamMuted, setIsStreamMuted] = useState<boolean>(() => getUserSettings().isStreamMuted);
  const screenContainerRef = useRef<HTMLDivElement>(null);

  const stopShareShortcutText = useMemo(() => {
    const acc = getUserSettings().keybindings?.stopScreenShare || 'CommandOrControl+Shift+S';
    return formatAcceleratorForDisplay(acc).join('+');
  }, [isScreenSharing]);

  // Estado do menu de contexto de áudio do usuário (clique com botão direito)
  interface ContextMenuState {
    x: number;
    y: number;
    userId: string;
    username: string;
    avatarUrl?: string;
    hasScreenShare?: boolean;
    shareId?: string;
  }
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleParticipantContextMenu = useCallback(
    (
      e: React.MouseEvent,
      p: { id: string; username: string; avatarUrl?: string; isLocal?: boolean; hasScreenShare?: boolean }
    ) => {
      if (p.isLocal) return; // Não abre para o próprio usuário local
      e.preventDefault();
      e.stopPropagation();
      const share = activeScreenShares.find((s) => !s.isLocal && s.id.includes(p.id));
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        userId: p.id,
        username: p.username,
        avatarUrl: p.avatarUrl,
        hasScreenShare: Boolean(p.hasScreenShare || share),
        shareId: share?.id,
      });
    },
    [activeScreenShares]
  );

  // Manter volume e mute sincronizados
  useEffect(() => {
    const unsubscribe = subscribeToSettingsChange((settings) => {
      setStreamVolume(settings.streamVolume);
      setIsStreamMuted(settings.isStreamMuted);
    });
    return unsubscribe;
  }, []);

  const handleStreamVolumeChange = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setStreamVolume(clamped);
    saveUserSetting('streamVolume', clamped);
    if (clamped > 0 && isStreamMuted) {
      setIsStreamMuted(false);
      saveUserSetting('isStreamMuted', false);
    }
  }, [isStreamMuted]);

  const handleToggleStreamMute = useCallback(() => {
    setIsStreamMuted((prev) => {
      const next = !prev;
      saveUserSetting('isStreamMuted', next);
      return next;
    });
  }, []);

  const handleSelectScreenSource = (sourceId?: string, quality?: ScreenQualityOptions) => {
    startScreenShare(sourceId, quality);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      screenContainerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Mesclar participantes do WebRTC com participantes do Socket para renderização instantânea
  const displayedParticipants = useMemo(() => {
    const map = new Map<string, {
      id: string;
      username: string;
      avatarUrl?: string;
      isSpeaking: boolean;
      isMuted: boolean;
      isLocal: boolean;
      hasScreenShare: boolean;
    }>();

    // 1. Participante Local
    const localVp = voiceParticipants.find((vp) => vp.isLocal);
    const localHasScreenShare = isScreenSharing || Boolean(screenStream);
    map.set(user?.id || 'local-user', {
      id: user?.id || 'local-user',
      username: user?.username || 'Você',
      avatarUrl: user?.avatarUrl,
      isSpeaking: localVp ? localVp.isSpeaking : false,
      isMuted,
      isLocal: true,
      hasScreenShare: localHasScreenShare,
    });

    // 2. Participantes recebidos pelo Socket.io (presença rápida)
    socketParticipants.forEach((sp) => {
      const isLocal = sp.id === user?.id;
      if (!map.has(sp.id)) {
        map.set(sp.id, {
          id: sp.id,
          username: sp.username,
          avatarUrl: sp.avatarUrl,
          isSpeaking: false,
          isMuted: Boolean(sp.isMuted),
          isLocal,
          hasScreenShare: Boolean(sp.isScreenSharing),
        });
      }
    });

    // 3. Participantes reais da sala WebRTC
    voiceParticipants.forEach((vp) => {
      const hasScreen = Boolean(
        vp.screenTrack ||
        activeScreenShares.some((s) => !s.isLocal && s.id.includes(vp.id))
      );
      map.set(vp.id, {
        id: vp.id,
        username: vp.username,
        avatarUrl: vp.avatarUrl,
        isSpeaking: vp.isSpeaking,
        isMuted: vp.isMuted,
        isLocal: vp.isLocal,
        hasScreenShare: vp.isLocal ? localHasScreenShare : hasScreen,
      });
    });

    return Array.from(map.values());
  }, [user, isMuted, socketParticipants, voiceParticipants, isScreenSharing, screenStream, activeScreenShares]);

  // Transmissão de tela atualmente em foco
  const activeShare = useMemo(() => {
    if (!selectedScreenShareId || activeScreenShares.length === 0) return null;
    return activeScreenShares.find((s) => s.id === selectedScreenShareId) || null;
  }, [activeScreenShares, selectedScreenShareId]);

  const [resolvedVideoDimensions, setResolvedVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setResolvedVideoDimensions(null);
  }, [activeShare?.id]);

  const activeStreamQualityLabel = useMemo(() => {
    if (!activeShare) return '';
    if (activeShare.isLocal) {
      return `${screenQuality.resolution} ${screenQuality.fps}FPS`;
    }
    if (resolvedVideoDimensions && resolvedVideoDimensions.height > 0) {
      const h = resolvedVideoDimensions.height;
      const res = h >= 1000 ? '1080p' : h >= 700 ? '720p' : `${h}p`;
      return `${res} 60FPS`;
    }
    const track = activeShare.track || activeShare.stream?.getVideoTracks()[0];
    if (track) {
      const settings = track.getSettings?.();
      const h = settings?.height;
      const f = Math.round(settings?.frameRate || 0);
      if (h) {
        const res = h >= 1000 ? '1080p' : h >= 700 ? '720p' : `${h}p`;
        return f ? `${res} ${f}FPS` : res;
      }
    }
    return `${screenQuality.resolution} ${screenQuality.fps}FPS`;
  }, [activeShare, screenQuality, resolvedVideoDimensions]);

  return (
    <div className="flex-1 bg-obsidian-bg flex flex-col justify-between overflow-hidden relative">
      {activeShare ? (
        /* Modo Destaque: Tela Compartilhada Ativa (Live Expandida + Dock Inferior de Participantes e Opções) */
        <div className="w-full h-full flex-1 flex flex-col p-3 gap-3 overflow-hidden">
          {/* Barra superior de alternância caso haja múltiplas transmissões */}
          {activeScreenShares.length > 1 && (
            <div className="flex items-center space-x-2 px-1 shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-obsidian-text-muted mr-1 flex items-center space-x-1">
                <Monitor className="w-3.5 h-3.5 text-indigo-400" />
                <span>Transmissões Ativas:</span>
              </span>
              {activeScreenShares.map((share) => (
                <button
                  key={share.id}
                  onClick={() => setSelectedScreenShareId(share.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                    activeShare.id === share.id
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border border-indigo-400/40'
                      : 'bg-obsidian-card hover:bg-obsidian-card-hover text-obsidian-text-secondary border border-obsidian-border'
                  }`}
                >
                  <span>{share.participantName}</span>
                  {share.isLocal && <span className="text-[10px] text-indigo-200">(Você)</span>}
                </button>
              ))}
            </div>
          )}

          {/* Visualizador da Tela em Destaque (Spotlight) - Ocupa 100% da área útil */}
          <div
            ref={screenContainerRef}
            className={`bg-black rounded-2xl overflow-hidden border border-obsidian-border shadow-2xl relative flex items-center justify-center group w-full ${
              isFullscreen ? 'fixed inset-0 z-50 rounded-none w-screen h-screen' : 'flex-1 min-h-0'
            }`}
          >
            <ParticipantTile
              name={`${activeShare.participantName} (Transmitindo)`}
              isScreenShare={true}
              stream={activeShare.stream}
              videoTrack={activeShare.track}
              volume={
                isStreamMuted
                  ? 0
                  : Math.round((streamVolume * masterVolume) / 100)
              }
              isLocal={activeShare.isLocal}
              onVideoResolutionResolved={(w, h) => setResolvedVideoDimensions({ width: w, height: h })}
            />

            {/* Barra Superior de Controles de Transmissão */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
              {/* Badge de Qualidade */}
              <div className="bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 flex items-center space-x-2 text-xs text-white pointer-events-auto shadow-lg">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-mono font-semibold">{activeStreamQualityLabel}</span>
              </div>

              {/* Ações: Volume com Porcentagem, Trocar Janela (se local) e Tela Cheia */}
              <div className="flex items-center space-x-2 pointer-events-auto">
                {/* Seletor de Volume com Slider e Porcentagem */}
                <div className="bg-black/75 backdrop-blur-md px-3 py-1 rounded-xl border border-white/10 flex items-center space-x-2 text-xs shadow-lg group/vol">
                  <button
                    onClick={handleToggleStreamMute}
                    className="text-white hover:text-indigo-400 transition-colors p-0.5 focus:outline-none"
                    title={isStreamMuted ? 'Desmutar Som da Tela' : 'Mutar Som da Tela'}
                  >
                    {isStreamMuted || streamVolume === 0 ? (
                      <VolumeX className="w-4 h-4 text-rose-400" />
                    ) : streamVolume <= 50 ? (
                      <Volume1 className="w-4 h-4 text-indigo-400" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-indigo-400" />
                    )}
                  </button>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isStreamMuted ? 0 : streamVolume}
                    onChange={(e) => handleStreamVolumeChange(Number(e.target.value))}
                    className="w-20 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
                    title={`Volume da Transmissão: ${isStreamMuted ? 0 : streamVolume}%`}
                  />

                  <span className="font-mono text-[11px] font-bold text-white w-9 text-right tabular-nums">
                    {isStreamMuted ? '0%' : `${streamVolume}%`}
                  </span>
                </div>

                {activeShare.isLocal && (
                  <button
                    onClick={() => setIsScreenModalOpen(true)}
                    className="p-1.5 px-3 rounded-xl bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/10 text-white text-xs flex items-center space-x-1.5 transition-all shadow-lg hover:border-indigo-500/40 font-medium"
                    title="Trocar Janela ou Tela"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Trocar</span>
                  </button>
                )}

                <button
                  onClick={() => setSelectedScreenShareId(null)}
                  className="p-1.5 px-3 rounded-xl bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/10 text-white text-xs flex items-center space-x-1.5 transition-all shadow-lg hover:border-indigo-500/40 font-medium"
                  title="Voltar para a grade de membros"
                >
                  <LayoutGrid className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Grade</span>
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="p-1.5 px-2 rounded-xl bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/10 text-white transition-all shadow-lg hover:border-indigo-500/40"
                  title={isFullscreen ? 'Sair da Tela Cheia (ESC)' : 'Tela Cheia'}
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Seção Inferior Integrada: Usuários do Canal + Opções e Ações */}
          <div className="w-full bg-obsidian-surface/95 backdrop-blur-xl border border-obsidian-border rounded-2xl p-2.5 flex flex-col md:flex-row items-center justify-between gap-3 shadow-2xl shrink-0">
            {/* Lado Esquerdo/Centro: Cartões de Usuários Conectados no Canal */}
            <div className="flex items-center gap-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0 custom-scrollbar">
              {displayedParticipants.map((p) => {
                const isLocal = p.isLocal;
                const isSpeaking = p.isSpeaking;
                return (
                  <div
                    key={p.id}
                    onContextMenu={(e) => handleParticipantContextMenu(e, p)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all shrink-0 cursor-pointer ${
                      isSpeaking
                        ? 'bg-obsidian-card border-emerald-500/60 shadow-md shadow-emerald-500/10'
                        : 'bg-obsidian-card/70 border-obsidian-border hover:border-obsidian-border-light hover:bg-obsidian-card'
                    }`}
                    title={isLocal ? 'Seu usuário (Clique com botão direito para opções)' : `${p.username} (Clique com botão direito para volume/cargos)`}
                  >
                    <div className="relative shrink-0">
                      <img
                        src={
                          p.avatarUrl ||
                          `https://api.dicebear.com/7.x/bottts/svg?seed=${p.username}`
                        }
                        alt={p.username}
                        className="w-8 h-8 rounded-lg bg-obsidian-surface border border-obsidian-border object-cover"
                      />
                      <div
                        className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-obsidian-surface ${
                          isSpeaking ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : p.isMuted ? 'bg-rose-500' : 'bg-slate-500'
                        }`}
                      />
                    </div>

                    <div className="flex flex-col min-w-0 pr-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-semibold text-white truncate max-w-[110px]">
                          {p.username}
                        </span>
                        {isLocal && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-obsidian-text-muted font-normal">
                            Você
                          </span>
                        )}
                      </div>

                      <div className="text-[10px] text-obsidian-text-muted flex items-center space-x-1 mt-0.5">
                        {p.hasScreenShare ? (
                          <span className="text-indigo-400 font-semibold flex items-center space-x-0.5">
                            <Monitor className="w-3 h-3" />
                            <span>Ao Vivo</span>
                          </span>
                        ) : p.isMuted ? (
                          <span className="text-rose-400 flex items-center space-x-0.5">
                            <MicOff className="w-3 h-3" />
                            <span>Mudo</span>
                          </span>
                        ) : isSpeaking ? (
                          <span className="text-emerald-400 font-semibold">Falando...</span>
                        ) : (
                          <span>Ouvindo</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Lado Direito: Barra de Opções e Ações do Canal */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Microfone */}
              <button
                onClick={toggleMute}
                className={`h-10 px-3.5 rounded-xl flex items-center space-x-2 transition-all font-semibold text-xs ${
                  isMuted
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-md shadow-rose-500/20'
                    : 'bg-obsidian-card border border-obsidian-border text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
                }`}
                title={isMuted ? 'Ativar Microfone' : 'Silenciar'}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                <span>{isMuted ? 'Mutado' : 'Microfone'}</span>
              </button>

              {/* Botão Parar Transmissão (Streamer) ou Sair da Live (Espectador) com Atalho */}
              {isScreenSharing ? (
                <button
                  onClick={stopScreenShare}
                  className="h-10 px-3.5 rounded-xl flex items-center space-x-2 transition-all font-bold text-xs bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400/50 shadow-lg shadow-indigo-600/30 ring-1 ring-indigo-400/40"
                  title={`Parar Transmissão (${stopShareShortcutText})`}
                >
                  <MonitorOff className="w-4 h-4 text-white" />
                  <span>Parar Transmissão</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/30 border border-white/15 text-indigo-200 ml-1">
                    {stopShareShortcutText}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => setSelectedScreenShareId(null)}
                  className="h-10 px-3.5 rounded-xl flex items-center space-x-2 transition-all font-bold text-xs bg-indigo-600/80 hover:bg-indigo-600 text-white border border-indigo-400/50 shadow-lg shadow-indigo-600/30 ring-1 ring-indigo-400/40"
                  title={`Sair da Live (${stopShareShortcutText})`}
                >
                  <LayoutGrid className="w-4 h-4 text-indigo-200" />
                  <span>Sair da Live</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/30 border border-white/15 text-indigo-200 ml-1">
                    {stopShareShortcutText}
                  </span>
                </button>
              )}

              <div className="w-[1px] h-6 bg-obsidian-border mx-0.5" />

              {/* Desconectar */}
              <button
                onClick={() => {
                  leaveVoiceChannel();
                  onDisconnect?.();
                }}
                className="h-10 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all shadow-lg shadow-rose-600/30 flex items-center space-x-2 font-bold text-xs tracking-wide"
                title="Sair da Chamada"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Desconectar</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Modo Grade Multiusuário: Sem Transmissão Ativa */
        <>
          <div className="flex-1 p-5 overflow-y-auto flex flex-col items-center justify-center">
            <div
              className={`w-full max-w-5xl grid gap-4 transition-all duration-300 ${
                displayedParticipants.length <= 1
                  ? 'grid-cols-1 max-w-sm'
                  : displayedParticipants.length === 2
                  ? 'grid-cols-1 sm:grid-cols-2 max-w-2xl'
                  : displayedParticipants.length <= 4
                  ? 'grid-cols-1 sm:grid-cols-2 max-w-3xl'
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 max-w-5xl'
              }`}
            >
              {displayedParticipants.map((p) => {
                const remoteShare = activeScreenShares.find(
                  (s) => !s.isLocal && s.id.includes(p.id)
                );
                return (
                  <ParticipantTile
                    key={p.id}
                    name={p.isLocal ? `${p.username} (Você)` : p.username}
                    avatarUrl={p.avatarUrl}
                    isSpeaking={p.isSpeaking}
                    isMuted={p.isMuted}
                    isLocallyMuted={isUserMuted(p.id)}
                    hasScreenShare={p.hasScreenShare}
                    onWatchScreenShare={
                      remoteShare
                        ? () => setSelectedScreenShareId(remoteShare.id)
                        : p.isLocal && screenStream
                        ? () => setSelectedScreenShareId('local-screen')
                        : undefined
                    }
                    isLocal={p.isLocal}
                    onContextMenu={(e) => handleParticipantContextMenu(e, p)}
                  />
                );
              })}
            </div>
          </div>

          {/* Floating Capsule Toolbar (Modo Grade) */}
          <div className="p-4 flex justify-center shrink-0">
            <div className="bg-obsidian-surface/95 backdrop-blur-2xl border border-obsidian-border px-3.5 py-2.5 rounded-2xl flex items-center space-x-2.5 shadow-2xl shadow-black/80 ring-1 ring-white/5">
              {/* Microfone */}
              <button
                onClick={toggleMute}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                  isMuted
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 shadow-md shadow-rose-500/20'
                    : 'bg-obsidian-card border border-obsidian-border text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
                }`}
                title={isMuted ? 'Ativar Microfone' : 'Silenciar'}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Compartilhar / Trocar Tela com Texto e Ícone */}
              <button
                onClick={() => {
                  if (isScreenSharing) {
                    stopScreenShare();
                  } else {
                    setIsScreenModalOpen(true);
                  }
                }}
                className={`h-11 px-3.5 rounded-xl flex items-center space-x-2 transition-all font-medium text-xs ${
                  isScreenSharing
                    ? 'bg-indigo-600 text-white border border-indigo-400/50 shadow-lg shadow-indigo-500/35 ring-1 ring-indigo-400/40'
                    : 'bg-obsidian-card border border-obsidian-border text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
                }`}
                title={isScreenSharing ? `Parar Transmissão (${stopShareShortcutText})` : 'Transmitir Tela ou Janela'}
              >
                {isScreenSharing ? (
                  <MonitorOff className="w-5 h-5 text-white" />
                ) : (
                  <Monitor className="w-5 h-5 text-indigo-400" />
                )}
                <span>{isScreenSharing ? 'Parar Transmissão' : 'Transmitir'}</span>
              </button>

              <div className="w-[1px] h-6 bg-obsidian-border mx-1" />

              {/* Desconectar */}
              <button
                onClick={() => {
                  leaveVoiceChannel();
                  onDisconnect?.();
                }}
                className="h-11 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all shadow-lg shadow-rose-600/30 flex items-center space-x-2 font-semibold text-xs tracking-wide"
                title="Sair da Chamada"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Desconectar</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal de Transmissão */}
      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onSelectSource={handleSelectScreenSource}
      />

      {/* Menu de Contexto de Áudio Individual do Participante (Clique com Botão Direito) */}
      {contextMenu && (
        <UserAudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={contextMenu.userId}
          username={contextMenu.username}
          avatarUrl={contextMenu.avatarUrl}
          volume={contextMenu.userId === user?.id ? 100 : getUserVolume(contextMenu.userId)}
          isMuted={contextMenu.userId === user?.id ? selfIsMuted : isUserMuted(contextMenu.userId)}
          isDeafened={isDeafened}
          hasScreenShare={contextMenu.hasScreenShare}
          isAdmin={Boolean(isAdmin || user?.customRole?.permissions?.some((p) => ['disconnect_voice', 'server_mute'].includes(p)))}
          isSelf={contextMenu.userId === user?.id}
          inVoiceChannelName={channel.name}
          isServerMuted={
            Boolean(
              socketParticipants.find((p) => p.id === contextMenu.userId)?.isMuted ||
              voiceParticipants.find((p) => p.id === contextMenu.userId)?.isMuted
            )
          }
          onDisconnectVoice={
            isAdmin || user?.customRole?.permissions?.includes('disconnect_voice')
              ? () => {
                  socket?.emit('admin:disconnect-voice', {
                    targetUserId: contextMenu.userId,
                    channelId: channel.id,
                    serverId: channel.serverId,
                  });
                }
              : undefined
          }
          onToggleServerMute={
            isAdmin || user?.customRole?.permissions?.includes('server_mute')
              ? () => {
                  const currentMuted = Boolean(
                    socketParticipants.find((p) => p.id === contextMenu.userId)?.isMuted ||
                    voiceParticipants.find((p) => p.id === contextMenu.userId)?.isMuted
                  );
                  socket?.emit('admin:server-mute-voice', {
                    targetUserId: contextMenu.userId,
                    channelId: channel.id,
                    serverId: channel.serverId,
                    isMuted: !currentMuted,
                  });
                }
              : undefined
          }
          onWatchScreenShare={
            contextMenu.hasScreenShare
              ? () => watchScreenShare(contextMenu.shareId || `screen-${contextMenu.userId}`)
              : undefined
          }
          onVolumeChange={(newVol) => setUserVolume(contextMenu.userId, newVol)}
          onToggleMute={contextMenu.userId === user?.id ? selfToggleMute : () => toggleMuteUser(contextMenu.userId)}
          onToggleDeafen={contextMenu.userId === user?.id ? toggleDeafen : undefined}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

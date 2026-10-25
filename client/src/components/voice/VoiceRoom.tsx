import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Channel } from '../../types';
import { useVoice, ScreenQualityOptions } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { ParticipantTile } from './ParticipantTile';
import { ScreenShareModal } from './ScreenShareModal';
import {
  getUserSettings,
  saveUserSetting,
  subscribeToSettingsChange,
} from '../../lib/userSettings';
import {
  Mic,
  MicOff,
  PhoneOff,
  Monitor,
  MonitorOff,
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Info,
  Volume2,
  Volume1,
  VolumeX,
} from 'lucide-react';

interface VoiceRoomProps {
  channel: Channel;
  onDisconnect?: () => void;
}

export const VoiceRoom: React.FC<VoiceRoomProps> = ({ channel, onDisconnect }) => {
  const { user } = useAuth();
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
  } = useVoice();

  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamVolume, setStreamVolume] = useState<number>(() => getUserSettings().streamVolume);
  const [isStreamMuted, setIsStreamMuted] = useState<boolean>(() => getUserSettings().isStreamMuted);
  const screenContainerRef = useRef<HTMLDivElement>(null);

  // Manter volume e mute sincronizados caso alterados por outros componentes
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

  const toggleCamera = async () => {
    if (isCameraOn && cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
      setIsCameraOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        setCameraStream(stream);
        setIsCameraOn(true);
      } catch (err) {
        console.error('Falha ao acessar câmera:', err);
      }
    }
  };

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

  const isConfigured = livekitUrl && !livekitUrl.includes('your-livekit-url');

  return (
    <div className="flex-1 bg-obsidian-bg flex flex-col justify-between overflow-hidden relative">
      {/* Banner de status minimalista */}
      {!isConfigured && (
        <div className="bg-obsidian-card border-b border-obsidian-border px-4 py-2 flex items-center justify-between text-xs text-obsidian-text-secondary">
          <div className="flex items-center space-x-2">
            <Info className="w-3.5 h-3.5 text-obsidian-accent shrink-0" />
            <span>
              <strong>Transmissão Local em Alta Fidelidade:</strong> Seleção e captura de telas e janenas ativas.
            </span>
          </div>
        </div>
      )}

      {/* Área Central Studio */}
      <div className="flex-1 p-5 overflow-y-auto flex flex-col items-center justify-center">
        {isScreenSharing && screenStream ? (
          <div className="w-full flex-1 flex flex-col space-y-3 max-w-5xl">
            {/* Visualizador da Tela em Destaque (Spotlight) */}
            <div
              ref={screenContainerRef}
              className={`bg-black rounded-2xl overflow-hidden border border-obsidian-border shadow-2xl relative flex items-center justify-center group ${
                isFullscreen ? 'fixed inset-0 z-50 rounded-none w-screen h-screen' : 'flex-1 max-h-[68vh]'
              }`}
            >
              <ParticipantTile
                name={`${user?.username || 'Você'} (Transmitindo)`}
                isScreenShare={true}
                stream={screenStream}
                videoTrack={screenStream.getVideoTracks()[0]}
                volume={isStreamMuted ? 0 : Math.round((streamVolume * masterVolume) / 100)}
                isLocal={true}
              />

              {/* Barra Superior de Controles de Transmissão */}
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Badge de Qualidade */}
                <div className="bg-black/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 flex items-center space-x-2 text-xs text-white pointer-events-auto shadow-lg">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="font-mono font-semibold">{screenQuality.resolution} {screenQuality.fps}FPS</span>
                </div>

                {/* Ações: Volume com Porcentagem, Trocar Janela e Tela Cheia */}
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

                  <button
                    onClick={() => setIsScreenModalOpen(true)}
                    className="p-1.5 px-3 rounded-xl bg-black/75 hover:bg-black/90 backdrop-blur-md border border-white/10 text-white text-xs flex items-center space-x-1.5 transition-all shadow-lg hover:border-indigo-500/40 font-medium"
                    title="Trocar Janela ou Tela"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Trocar</span>
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

            {/* Faixa Inferior de Participantes */}
            <div className="flex space-x-3 overflow-x-auto py-1">
              <div className="w-44 shrink-0">
                <ParticipantTile
                  name={user?.username || 'Você'}
                  avatarUrl={user?.avatarUrl}
                  isSpeaking={!isMuted}
                  isMuted={isMuted}
                  videoTrack={cameraStream ? cameraStream.getVideoTracks()[0] : undefined}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-4xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <ParticipantTile
              name={`${user?.username || 'Você'} (Você)`}
              avatarUrl={user?.avatarUrl}
              isSpeaking={!isMuted}
              isMuted={isMuted}
              videoTrack={cameraStream ? cameraStream.getVideoTracks()[0] : undefined}
            />
          </div>
        )}
      </div>

      {/* Floating Capsule Toolbar (Alto Contraste & Ergonomia) */}
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

          {/* Câmera */}
          <button
            onClick={toggleCamera}
            className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
              isCameraOn
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 shadow-md shadow-emerald-500/20'
                : 'bg-obsidian-card border border-obsidian-border text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
            }`}
            title={isCameraOn ? 'Desligar Câmera' : 'Ligar Câmera'}
          >
            {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 text-obsidian-text-secondary" />}
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
            title={isScreenSharing ? 'Parar Transmissão' : 'Transmitir Tela ou Janela'}
          >
            {isScreenSharing ? (
              <MonitorOff className="w-5 h-5 text-white" />
            ) : (
              <Monitor className="w-5 h-5 text-indigo-400" />
            )}
            <span>{isScreenSharing ? 'Parar Transmissão' : 'Transmitir'}</span>
          </button>

          <div className="w-[1px] h-6 bg-obsidian-border mx-1" />

          {/* Desconectar com Alto Contraste e Legenda */}
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

      {/* Modal de Transmissão */}
      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
        onSelectSource={handleSelectScreenSource}
      />
    </div>
  );
};

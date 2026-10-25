import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../lib/api';
import { Channel } from '../types';
import { useSocket } from './SocketContext';
import {
  getUserSettings,
  saveUserSetting,
  subscribeToSettingsChange,
  UserAudioSettings,
} from '../lib/userSettings';

export interface ScreenQualityOptions {
  resolution: '720p' | '1080p';
  fps: 30 | 60;
  includeAudio?: boolean;
}

interface VoiceContextType {
  currentVoiceChannel: Channel | null;
  livekitToken: string | null;
  livekitUrl: string | null;
  isConnecting: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  screenStream: MediaStream | null;
  screenQuality: ScreenQualityOptions;
  selectedAudioDeviceId: string;
  setSelectedAudioDeviceId: (id: string) => void;
  audioDevices: MediaDeviceInfo[];
  refreshAudioDevices: () => Promise<void>;
  joinVoiceChannel: (channel: Channel) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  startScreenShare: (sourceId?: string, quality?: ScreenQualityOptions) => Promise<void>;
  stopScreenShare: () => void;
  masterVolume: number;
  setMasterVolume: (volume: number) => void;
  micInputGain: number;
  setMicInputGain: (gain: number) => void;
  updateScreenQualityPreset: (options: ScreenQualityOptions) => void;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();
  const initialSettings = getUserSettings();

  const [currentVoiceChannel, setCurrentVoiceChannel] = useState<Channel | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenQuality, setScreenQuality] = useState<ScreenQualityOptions>({
    resolution: initialSettings.screenResolution,
    fps: initialSettings.screenFps,
    includeAudio: initialSettings.screenIncludeAudio,
  });
  const [selectedAudioDeviceId, setSelectedAudioDeviceIdState] = useState<string>(
    initialSettings.selectedAudioDeviceId
  );
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [masterVolume, setMasterVolumeState] = useState<number>(initialSettings.masterOutputVolume);
  const [micInputGain, setMicInputGainState] = useState<number>(initialSettings.micInputGain);

  const refreshAudioDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioDevices(inputs);
      }
    } catch (err) {
      console.error('Falha ao listar microfones:', err);
    }
  }, []);

  const setSelectedAudioDeviceId = useCallback((id: string) => {
    setSelectedAudioDeviceIdState(id);
    saveUserSetting('selectedAudioDeviceId', id);
  }, []);

  const setMasterVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setMasterVolumeState(clamped);
    saveUserSetting('masterOutputVolume', clamped);
  }, []);

  const setMicInputGain = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setMicInputGainState(clamped);
    saveUserSetting('micInputGain', clamped);
  }, []);

  const updateScreenQualityPreset = useCallback((opts: ScreenQualityOptions) => {
    setScreenQuality(opts);
    saveUserSetting('screenResolution', opts.resolution);
    saveUserSetting('screenFps', opts.fps);
    if (opts.includeAudio !== undefined) {
      saveUserSetting('screenIncludeAudio', opts.includeAudio);
    }
  }, []);

  // Sincronização em tempo real das preferências caso alteradas em outras abas ou componentes
  useEffect(() => {
    const unsubscribe = subscribeToSettingsChange((settings: UserAudioSettings) => {
      setSelectedAudioDeviceIdState(settings.selectedAudioDeviceId);
      setMasterVolumeState(settings.masterOutputVolume);
      setMicInputGainState(settings.micInputGain);
      setScreenQuality({
        resolution: settings.screenResolution,
        fps: settings.screenFps,
        includeAudio: settings.screenIncludeAudio,
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    refreshAudioDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshAudioDevices);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshAudioDevices);
      };
    }
  }, [refreshAudioDevices]);

  const joinVoiceChannel = useCallback(
    async (channel: Channel) => {
      if (currentVoiceChannel?.id === channel.id) return;

      setIsConnecting(true);
      try {
        const response = await api.post('/api/livekit/token', {
          channelId: channel.id,
        });

        const { token, url } = response.data;
        setLivekitToken(token);
        setLivekitUrl(url);
        setCurrentVoiceChannel(channel);

        // Notificar servidor via WebSocket para presença
        if (socket) {
          socket.emit('join-voice', {
            serverId: channel.serverId,
            channelId: channel.id,
          });
        }
      } catch (error) {
        console.error('Falha ao obter token LiveKit:', error);
      } finally {
        setIsConnecting(false);
      }
    },
    [currentVoiceChannel?.id, socket]
  );

  const leaveVoiceChannel = useCallback(() => {
    if (currentVoiceChannel && socket) {
      socket.emit('leave-voice', {
        serverId: currentVoiceChannel.serverId,
        channelId: currentVoiceChannel.id,
      });
    }

    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }

    setCurrentVoiceChannel(null);
    setLivekitToken(null);
    setLivekitUrl(null);
  }, [currentVoiceChannel, socket, screenStream]);

  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  const toggleDeafen = () => {
    setIsDeafened((prev) => {
      const next = !prev;
      if (next) setIsMuted(true);
      return next;
    });
  };

  const startScreenShare = useCallback(async (sourceId?: string, quality?: ScreenQualityOptions) => {
    try {
      const activeQuality = quality || { resolution: '1080p', fps: 60, includeAudio: true };
      setScreenQuality(activeQuality);

      const is1080 = activeQuality.resolution === '1080p';
      const width = is1080 ? 1920 : 1280;
      const height = is1080 ? 1080 : 720;
      const fps = activeQuality.fps;
      const includeAudio = activeQuality.includeAudio !== false;

      let stream: MediaStream;

      if (sourceId && window.electronAPI) {
        const isWindow = sourceId.startsWith('window:');
        // Áudio via chromeMediaSource só é suportado para telas cheias no Electron no Windows; janelas não suportam captura direta de áudio
        const canCaptureAudio = includeAudio && !isWindow;

        const videoMandatory: any = {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxFrameRate: fps,
        };

        // Para telas cheias podemos fixar limite; para janelas evitamos OverconstrainedError deixando flexível
        if (!isWindow) {
          videoMandatory.maxWidth = width;
          videoMandatory.maxHeight = height;
        }

        try {
          stream = await (navigator.mediaDevices as any).getUserMedia({
            audio: canCaptureAudio
              ? {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                  },
                }
              : false,
            video: {
              mandatory: videoMandatory,
              optional: isWindow ? [{ maxWidth: width }, { maxHeight: height }] : [],
            },
          });
        } catch (errWindow) {
          console.warn('Falha na captura com restrições avançadas, tentando fallback seguro:', errWindow);
          try {
            // Fallback seguro 1: sem áudio e restrições mínimas
            stream = await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                },
              },
            });
          } catch (errFallback) {
            console.warn('Fallback do Electron falhou, usando seletor do sistema:', errFallback);
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: {
                width: { ideal: width },
                height: { ideal: height },
                frameRate: { ideal: fps, max: fps },
              },
              audio: (includeAudio
                ? {
                    systemAudio: 'exclude',
                    selfBrowserSurface: 'exclude',
                  }
                : false) as any,
            });
          }
        }
      } else {
        // Web API padrão com isolamento de áudio (ignora outras telas e sons externos)
        const audioConstraints: any = includeAudio
          ? {
              systemAudio: 'exclude', // Ignora áudio de outros monitores/sistema geral
              selfBrowserSurface: 'exclude', // Ignora o áudio da própria aplicação
              suppressLocalAudioPlayback: false,
            }
          : false;

        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: width },
            height: { ideal: height },
            frameRate: { ideal: fps, max: fps },
          },
          audio: audioConstraints,
        });
      }

      // Ao encerrar o compartilhamento pelo próprio sistema operacional
      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        setIsScreenSharing(false);
      };

      setScreenStream(stream);
      setIsScreenSharing(true);
    } catch (error) {
      console.error('Falha ao iniciar compartilhamento de tela:', error);
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }
  }, [screenStream]);

  return (
    <VoiceContext.Provider
      value={{
        currentVoiceChannel,
        livekitToken,
        livekitUrl,
        isConnecting,
        isMuted,
        isDeafened,
        isScreenSharing,
        screenStream,
        screenQuality,
        selectedAudioDeviceId,
        setSelectedAudioDeviceId,
        audioDevices,
        refreshAudioDevices,
        joinVoiceChannel,
        leaveVoiceChannel,
        toggleMute,
        toggleDeafen,
        startScreenShare,
        stopScreenShare,
        masterVolume,
        setMasterVolume,
        micInputGain,
        setMicInputGain,
        updateScreenQualityPreset,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = () => {
  const context = useContext(VoiceContext);
  if (!context) {
    throw new Error('useVoice deve ser usado dentro de um VoiceProvider');
  }
  return context;
};

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteParticipant,
  LocalParticipant,
  RemoteTrackPublication,
  LocalTrackPublication,
} from 'livekit-client';
import { api } from '../lib/api';
import { Channel } from '../types';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import {
  getUserSettings,
  saveUserSetting,
  subscribeToSettingsChange,
  resolveAudioDevice,
  UserAudioSettings,
} from '../lib/userSettings';

export interface ScreenQualityOptions {
  resolution: '720p' | '1080p';
  fps: 30 | 60;
  includeAudio?: boolean;
}

export interface ActiveParticipant {
  id: string;
  username: string;
  avatarUrl?: string;
  isSpeaking: boolean;
  isMuted: boolean;
  isLocal: boolean;
  cameraTrack?: MediaStreamTrack;
  screenTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
}

export interface ActiveScreenShareInfo {
  id: string;
  participantName: string;
  isLocal: boolean;
  track?: MediaStreamTrack;
  stream?: MediaStream;
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
  setSelectedAudioDeviceId: (id: string, label?: string) => Promise<void>;
  localAudioTrack: MediaStreamTrack | null;
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
  // Multiusuário e compartilhamento de tela WebRTC
  voiceParticipants: ActiveParticipant[];
  activeScreenShares: ActiveScreenShareInfo[];
  selectedScreenShareId: string | null;
  setSelectedScreenShareId: (id: string | null) => void;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useAuth();
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
  const [localAudioTrack, setLocalAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [masterVolume, setMasterVolumeState] = useState<number>(initialSettings.masterOutputVolume);
  const [micInputGain, setMicInputGainState] = useState<number>(initialSettings.micInputGain);

  // Estados de participantes multiusuário e telas compartilhadas via WebRTC
  const [voiceParticipants, setVoiceParticipants] = useState<ActiveParticipant[]>([]);
  const [activeScreenShares, setActiveScreenShares] = useState<ActiveScreenShareInfo[]>([]);
  const [selectedScreenShareId, setSelectedScreenShareId] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const localScreenPubRef = useRef<LocalTrackPublication | null>(null);

  const updateLocalAudioTrackRef = useCallback(() => {
    if (roomRef.current?.localParticipant) {
      const pub = roomRef.current.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = pub?.audioTrack?.mediaStreamTrack || null;
      setLocalAudioTrack(track);
    } else {
      setLocalAudioTrack(null);
    }
  }, []);

  const refreshAudioDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        // Filtrar aliases virtuais do Windows ('default' e 'communications')
        // para que a lista contenha apenas microfones físicos/virtuais reais
        const inputs = devices.filter(
          (d) =>
            d.kind === 'audioinput' &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications'
        );

        // Deduplicar caso algum driver registre múltiplos com o mesmo deviceId
        const uniqueInputs: MediaDeviceInfo[] = [];
        const seenIds = new Set<string>();
        inputs.forEach((d) => {
          if (d.deviceId && !seenIds.has(d.deviceId)) {
            seenIds.add(d.deviceId);
            uniqueInputs.push(d);
          }
        });

        setAudioDevices(uniqueInputs);

        // Resolver dispositivo ativo se o ID atual não existir mais na lista
        const settings = getUserSettings();
        const resolved = resolveAudioDevice(
          uniqueInputs,
          settings.selectedAudioDeviceId,
          settings.selectedAudioDeviceLabel
        );

        if (resolved.deviceId !== settings.selectedAudioDeviceId) {
          setSelectedAudioDeviceIdState(resolved.deviceId);
          saveUserSetting('selectedAudioDeviceId', resolved.deviceId);
          if (resolved.label) {
            saveUserSetting('selectedAudioDeviceLabel', resolved.label);
          }
        }
      }
    } catch (err) {
      console.error('Falha ao listar microfones:', err);
    }
  }, []);

  const setSelectedAudioDeviceId = useCallback(
    async (id: string, label?: string) => {
      setSelectedAudioDeviceIdState(id);
      saveUserSetting('selectedAudioDeviceId', id);
      if (label) {
        saveUserSetting('selectedAudioDeviceLabel', label);
      }

      // Se houver uma sala LiveKit conectada, trocar o microfone em tempo real
      if (roomRef.current) {
        try {
          const targetDeviceId = id === 'default' ? '' : id;
          await roomRef.current.switchActiveDevice('audioinput', targetDeviceId);
          updateLocalAudioTrackRef();
        } catch (switchErr) {
          console.warn('Falha no switchActiveDevice do LiveKit, tentando reativar microfone:', switchErr);
          try {
            if (!isMuted) {
              await roomRef.current.localParticipant.setMicrophoneEnabled(false);
              await roomRef.current.localParticipant.setMicrophoneEnabled(true, {
                deviceId: id !== 'default' ? id : undefined,
              });
              updateLocalAudioTrackRef();
            }
          } catch (reErr) {
            console.error('Erro ao reconfigurar microfone:', reErr);
          }
        }
      }
    },
    [isMuted, updateLocalAudioTrackRef]
  );

  const setMasterVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    setMasterVolumeState(clamped);
    saveUserSetting('masterOutputVolume', clamped);
    // Atualizar volume de todos os elementos de áudio remotos conectados
    audioElementsRef.current.forEach((el) => {
      el.volume = clamped / 100;
    });
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

  // Sincronização em tempo real das preferências
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

  // Função para sincronizar participantes e telas ativas da sala WebRTC
  const syncRoomState = useCallback((currentRoom: Room, currentScreenStream: MediaStream | null, muted: boolean) => {
    const list: ActiveParticipant[] = [];

    // Participante Local
    list.push({
      id: user?.id || 'local-user',
      username: user?.username || 'Você',
      avatarUrl: user?.avatarUrl,
      isSpeaking: currentRoom.localParticipant ? currentRoom.localParticipant.isSpeaking : false,
      isMuted: muted,
      isLocal: true,
      screenTrack: currentScreenStream ? currentScreenStream.getVideoTracks()[0] : undefined,
    });

    // Participantes Remotos
    currentRoom.remoteParticipants.forEach((p) => {
      let cameraTrack: MediaStreamTrack | undefined;
      let screenTrack: MediaStreamTrack | undefined;
      let audioTrack: MediaStreamTrack | undefined;

      p.trackPublications.forEach((pub) => {
        if (pub.track?.mediaStreamTrack) {
          if (pub.source === Track.Source.Camera) cameraTrack = pub.track.mediaStreamTrack;
          if (pub.source === Track.Source.ScreenShare) screenTrack = pub.track.mediaStreamTrack;
          if (pub.source === Track.Source.Microphone) audioTrack = pub.track.mediaStreamTrack;
        }
      });

      list.push({
        id: p.identity,
        username: p.name || p.identity,
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.name || p.identity)}`,
        isSpeaking: p.isSpeaking,
        isMuted: !p.isMicrophoneEnabled,
        isLocal: false,
        cameraTrack,
        screenTrack,
        audioTrack,
      });
    });

    setVoiceParticipants(list);

    // Sincronizar Telas Compartilhadas Ativas
    const shares: ActiveScreenShareInfo[] = [];

    // Tela local
    if (currentScreenStream && currentScreenStream.getVideoTracks().length > 0) {
      shares.push({
        id: 'local-screen',
        participantName: `${user?.username || 'Você'} (Você)`,
        isLocal: true,
        stream: currentScreenStream,
        track: currentScreenStream.getVideoTracks()[0],
      });
    }

    // Telas remotas
    currentRoom.remoteParticipants.forEach((p) => {
      p.trackPublications.forEach((pub) => {
        if (pub.source === Track.Source.ScreenShare && pub.track?.mediaStreamTrack) {
          shares.push({
            id: `remote-${p.identity}-${pub.trackSid}`,
            participantName: p.name || p.identity,
            isLocal: false,
            track: pub.track.mediaStreamTrack,
          });
        }
      });
    });

    setActiveScreenShares(shares);
    setSelectedScreenShareId((prev) => {
      if (prev && shares.some((s) => s.id === prev)) return prev;
      return shares.length > 0 ? shares[0].id : null;
    });
  }, [user]);

  // Conectar a um canal de voz com LiveKit WebRTC completo
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

        // Desconectar sala anterior se houver
        if (roomRef.current) {
          roomRef.current.disconnect();
          roomRef.current = null;
        }

        // Criar e conectar instância real do LiveKit Room
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            deviceId: selectedAudioDeviceId && selectedAudioDeviceId !== 'default' ? selectedAudioDeviceId : undefined,
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        roomRef.current = room;

        // Ouvir eventos do WebRTC
        room.on(RoomEvent.Connected, () => {
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.ParticipantConnected, () => {
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.TrackSubscribed, (track, publication) => {
          if (track.kind === Track.Kind.Audio) {
            let container = document.getElementById('xolas-remote-audio-container');
            if (!container) {
              container = document.createElement('div');
              container.id = 'xolas-remote-audio-container';
              container.style.display = 'none';
              document.body.appendChild(container);
            }

            const audioEl = track.attach();
            audioEl.volume = isDeafened ? 0 : Math.max(0, Math.min(1, masterVolume / 100));
            container.appendChild(audioEl);
            audioElementsRef.current.set(publication.trackSid, audioEl);
          }
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
          if (track.kind === Track.Kind.Audio) {
            const audioEl = audioElementsRef.current.get(publication.trackSid);
            if (audioEl) {
              track.detach(audioEl);
              audioEl.srcObject = null;
              audioEl.remove();
              audioElementsRef.current.delete(publication.trackSid);
            }
          }
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.ActiveSpeakersChanged, () => {
          syncRoomState(room, screenStream, isMuted);
        });

        room.on(RoomEvent.TrackMuted, () => syncRoomState(room, screenStream, isMuted));
        room.on(RoomEvent.TrackUnmuted, () => syncRoomState(room, screenStream, isMuted));

        // Conectar ao cluster LiveKit
        await room.connect(url, token);

        // Habilitar microfone local respeitando estado de mute e deviceId configurado
        try {
          await room.localParticipant.setMicrophoneEnabled(!isMuted, {
            deviceId: selectedAudioDeviceId && selectedAudioDeviceId !== 'default' ? selectedAudioDeviceId : undefined,
          });
          updateLocalAudioTrackRef();
        } catch (micErr) {
          console.warn('Aviso: falha ao ativar microfone com deviceId específico, usando padrão:', micErr);
          try {
            await room.localParticipant.setMicrophoneEnabled(!isMuted);
            updateLocalAudioTrackRef();
          } catch (fallbackErr) {
            console.error('Falha ao ativar microfone inicial no LiveKit:', fallbackErr);
          }
        }

        syncRoomState(room, screenStream, isMuted);

        // Notificar servidor via WebSocket para presença de sidebar
        if (socket) {
          socket.emit('join-voice', {
            serverId: channel.serverId,
            channelId: channel.id,
          });
        }
      } catch (error) {
        console.error('Falha ao conectar no LiveKit:', error);
      } finally {
        setIsConnecting(false);
      }
    },
    [currentVoiceChannel?.id, socket, selectedAudioDeviceId, isMuted, isDeafened, masterVolume, screenStream, syncRoomState, updateLocalAudioTrackRef]
  );

  const leaveVoiceChannel = useCallback(() => {
    if (currentVoiceChannel && socket) {
      socket.emit('leave-voice', {
        serverId: currentVoiceChannel.serverId,
        channelId: currentVoiceChannel.id,
      });
    }

    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    setLocalAudioTrack(null);

    audioElementsRef.current.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();

    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }

    setCurrentVoiceChannel(null);
    setLivekitToken(null);
    setLivekitUrl(null);
    setVoiceParticipants([]);
    setActiveScreenShares([]);
    setSelectedScreenShareId(null);
  }, [currentVoiceChannel, socket, screenStream]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (roomRef.current) {
        roomRef.current.localParticipant.setMicrophoneEnabled(!next).catch(() => {});
        syncRoomState(roomRef.current, screenStream, next);
        setTimeout(updateLocalAudioTrackRef, 100);
      }
      return next;
    });
  }, [screenStream, syncRoomState, updateLocalAudioTrackRef]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      if (next) {
        setIsMuted(true);
        if (roomRef.current) {
          roomRef.current.localParticipant.setMicrophoneEnabled(false).catch(() => {});
        }
      }
      // Mutar ou restaurar todos os áudios remotos
      audioElementsRef.current.forEach((el) => {
        el.volume = next ? 0 : Math.max(0, Math.min(1, masterVolume / 100));
      });
      return next;
    });
  }, [masterVolume]);

  const startScreenShare = useCallback(
    async (sourceId?: string, quality?: ScreenQualityOptions) => {
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
          const canCaptureAudio = includeAudio && !isWindow;

          const videoMandatory: any = {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: fps,
          };

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
          const audioConstraints: any = includeAudio
            ? {
                systemAudio: 'exclude',
                selfBrowserSurface: 'exclude',
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

        // Publicar faixa de vídeo no LiveKit se houver sala conectada
        if (roomRef.current) {
          const videoTrack = stream.getVideoTracks()[0];
          try {
            const pub = await roomRef.current.localParticipant.publishTrack(videoTrack, {
              name: 'screen-share',
              source: Track.Source.ScreenShare,
            });
            localScreenPubRef.current = pub;

            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
              await roomRef.current.localParticipant.publishTrack(audioTrack, {
                name: 'screen-audio',
                source: Track.Source.ScreenShareAudio,
              });
            }
          } catch (pubErr) {
            console.warn('Erro ao publicar track de tela no LiveKit:', pubErr);
          }
        }

        stream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };

        setScreenStream(stream);
        setIsScreenSharing(true);

        if (roomRef.current) {
          syncRoomState(roomRef.current, stream, isMuted);
        }
      } catch (error) {
        console.error('Falha ao iniciar compartilhamento de tela:', error);
      }
    },
    [isMuted, syncRoomState]
  );

  const stopScreenShare = useCallback(() => {
    if (localScreenPubRef.current && roomRef.current) {
      roomRef.current.localParticipant.unpublishTrack(localScreenPubRef.current.track as any).catch(() => {});
      localScreenPubRef.current = null;
    }

    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      setIsScreenSharing(false);
    }

    if (roomRef.current) {
      syncRoomState(roomRef.current, null, isMuted);
    }
  }, [screenStream, isMuted, syncRoomState]);

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
        localAudioTrack,
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
        voiceParticipants,
        activeScreenShares,
        selectedScreenShareId,
        setSelectedScreenShareId,
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

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
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

interface RemotePeerData {
  id: string;
  username: string;
  avatarUrl?: string;
  isMuted: boolean;
  isSpeaking: boolean;
  isScreenSharing: boolean;
  screenStreamId?: string | null;
  audioTrack?: MediaStreamTrack;
  screenTrack?: MediaStreamTrack;
  screenAudioTrack?: MediaStreamTrack;
  screenStream?: MediaStream;
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
  watchScreenShare: (shareId: string) => void;
  stopWatchingScreenShare: () => void;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export const VoiceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useAuth();
  const initialSettings = getUserSettings();

  const [currentVoiceChannel, setCurrentVoiceChannel] = useState<Channel | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>('webrtc://native-mesh');
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

  const [voiceParticipants, setVoiceParticipants] = useState<ActiveParticipant[]>([]);
  const [activeScreenShares, setActiveScreenShares] = useState<ActiveScreenShareInfo[]>([]);
  const [selectedScreenShareId, setSelectedScreenShareId] = useState<string | null>(null);

  // Refs mutáveis para acesso imediato em callbacks WebRTC / Socket.io
  const currentChannelRef = useRef<Channel | null>(null);
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isMutedRef = useRef<boolean>(false);
  const isDeafenedRef = useRef<boolean>(false);
  const isScreenSharingRef = useRef<boolean>(false);
  const isLocalSpeakingRef = useRef<boolean>(false);
  const masterVolumeRef = useRef<number>(initialSettings.masterOutputVolume);

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteParticipantsRef = useRef<Map<string, RemotePeerData>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const screenSendersRef = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const vadCleanupRef = useRef<(() => void) | null>(null);

  // Emite o estado atual do usuário local para os demais membros do canal
  const emitLocalVoiceState = useCallback(() => {
    const ch = currentChannelRef.current;
    if (!socket || !ch) return;
    socket.emit('voice-user-state', {
      channelId: ch.id,
      serverId: ch.serverId,
      isMuted: isMutedRef.current,
      isSpeaking: !isMutedRef.current && isLocalSpeakingRef.current,
      isScreenSharing: isScreenSharingRef.current,
      screenStreamId: screenStreamRef.current?.id || null,
    });
  }, [socket]);

  // Sincroniza estados React (voiceParticipants e activeScreenShares) a partir das refs
  const syncVoiceState = useCallback(() => {
    const ch = currentChannelRef.current;
    if (!ch) {
      setVoiceParticipants([]);
      setActiveScreenShares([]);
      setSelectedScreenShareId(null);
      return;
    }

    const list: ActiveParticipant[] = [];
    const currentScreen = screenStreamRef.current;

    // 1. Participante Local
    list.push({
      id: user?.id || 'local-user',
      username: user?.username || 'Você',
      avatarUrl: user?.avatarUrl,
      isSpeaking: !isMutedRef.current && isLocalSpeakingRef.current,
      isMuted: isMutedRef.current,
      isLocal: true,
      screenTrack: currentScreen ? currentScreen.getVideoTracks()[0] : undefined,
      audioTrack: localMicStreamRef.current?.getAudioTracks()[0],
    });

    // 2. Participantes Remotos
    remoteParticipantsRef.current.forEach((p) => {
      if (p.id === user?.id) return;
      list.push({
        id: p.id,
        username: p.username || 'Usuário',
        avatarUrl:
          p.avatarUrl ||
          `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(p.username || p.id)}`,
        isSpeaking: !p.isMuted && p.isSpeaking,
        isMuted: p.isMuted,
        isLocal: false,
        screenTrack: p.screenTrack,
        audioTrack: p.audioTrack,
      });
    });

    setVoiceParticipants(list);

    // 3. Telas Compartilhadas Ativas (Local + Remotas)
    const shares: ActiveScreenShareInfo[] = [];

    if (currentScreen && currentScreen.getVideoTracks().length > 0) {
      shares.push({
        id: 'local-screen',
        participantName: user?.username || 'Você',
        isLocal: true,
        stream: currentScreen,
        track: currentScreen.getVideoTracks()[0],
      });
    }

    remoteParticipantsRef.current.forEach((p) => {
      if (p.id === user?.id) return;
      const hasLiveTrack =
        p.screenTrack && p.screenTrack.readyState === 'live';
      const hasLiveStream =
        p.screenStream &&
        p.screenStream.getVideoTracks().some((t) => t.readyState === 'live');

      if (hasLiveTrack || hasLiveStream) {
        shares.push({
          id: `remote-screen-${p.id}`,
          participantName: p.username || 'Usuário',
          isLocal: false,
          stream: p.screenStream,
          track: p.screenTrack || p.screenStream?.getVideoTracks()[0],
        });
      }
    });

    setActiveScreenShares(shares);
    setSelectedScreenShareId((prev) => {
      // Se a tela assistida anteriormente ainda existir na lista de transmissões ativas, mantém
      if (prev && shares.some((s) => s.id === prev)) return prev;
      // Se o próprio usuário estiver transmitindo a tela dele, mantém selecionada a tela local
      if (currentScreen && currentScreen.getVideoTracks().length > 0) return 'local-screen';
      // Para espectadores remotos: não auto-seleciona, permitindo que cliquem em "Assistir Transmissão"
      return null;
    });
  }, [user]);

  // Anexa stream de áudio remoto ao container DOM oculto
  const attachRemoteAudio = useCallback((peerId: string, track: MediaStreamTrack, stream?: MediaStream) => {
    let container = document.getElementById('xolas-remote-audio-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'xolas-remote-audio-container';
      container.style.display = 'none';
      document.body.appendChild(container);
    }

    const key = `${peerId}-${track.id}`;
    let audioEl = audioElementsRef.current.get(key);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      container.appendChild(audioEl);
      audioElementsRef.current.set(key, audioEl);
    }

    const mediaStream = stream || new MediaStream([track]);
    if (audioEl.srcObject !== mediaStream) {
      audioEl.srcObject = mediaStream;
    }
    audioEl.volume = isDeafenedRef.current
      ? 0
      : Math.max(0, Math.min(1, masterVolumeRef.current / 100));
    audioEl.play().catch(() => {});
  }, []);

  // Remove conexões e elementos de mídia de um participante específico
  const cleanupPeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    makingOfferRef.current.delete(peerId);
    screenSendersRef.current.delete(peerId);
    remoteParticipantsRef.current.delete(peerId);

    // Remover elementos de áudio associados ao peer
    Array.from(audioElementsRef.current.entries()).forEach(([key, el]) => {
      if (key.startsWith(`${peerId}-`)) {
        el.pause();
        el.srcObject = null;
        el.remove();
        audioElementsRef.current.delete(key);
      }
    });
  }, []);

  // Envia oferta SDP para um peer específico
  const sendOffer = useCallback(
    async (remoteUserId: string, channelId: string) => {
      const pc = peersRef.current.get(remoteUserId);
      if (!pc || !socket) return;

      try {
        makingOfferRef.current.set(remoteUserId, true);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', {
          channelId,
          toUserId: remoteUserId,
          targetUserId: remoteUserId,
          sdp: pc.localDescription,
          screenStreamId: screenStreamRef.current?.id || null,
        });
      } catch (err) {
        console.warn(`Erro ao enviar oferta WebRTC para ${remoteUserId}:`, err);
      } finally {
        makingOfferRef.current.set(remoteUserId, false);
      }
    },
    [socket]
  );

  // Cria ou retorna a RTCPeerConnection para um participante remoto
  const getOrCreatePeerConnection = useCallback(
    (remoteUserId: string, channelId: string): { pc: RTCPeerConnection; isNew: boolean } => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing && existing.connectionState !== 'closed') {
        return { pc: existing, isNew: false };
      }

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(remoteUserId, pc);

      // Adicionar faixa de microfone local se disponível
      if (localMicStreamRef.current) {
        localMicStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localMicStreamRef.current!);
        });
      }

      // Adicionar faixas de compartilhamento de tela local se já estiver transmitindo
      if (screenStreamRef.current) {
        const senders: RTCRtpSender[] = [];
        screenStreamRef.current.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, screenStreamRef.current!);
          senders.push(sender);
        });
        screenSendersRef.current.set(remoteUserId, senders);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('webrtc-ice-candidate', {
            channelId,
            toUserId: remoteUserId,
            targetUserId: remoteUserId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const track = event.track;
        const incomingStream = event.streams?.[0];

        let peerData = remoteParticipantsRef.current.get(remoteUserId);
        if (!peerData) {
          peerData = {
            id: remoteUserId,
            username: 'Usuário',
            isMuted: false,
            isSpeaking: false,
            isScreenSharing: false,
          };
          remoteParticipantsRef.current.set(remoteUserId, peerData);
        }

        if (track.kind === 'audio') {
          const isScreenAudio =
            (incomingStream &&
              peerData.screenStreamId &&
              incomingStream.id === peerData.screenStreamId) ||
            (incomingStream && incomingStream.getVideoTracks().length > 0) ||
            (peerData.audioTrack &&
              peerData.audioTrack.readyState === 'live' &&
              peerData.audioTrack.id !== track.id);

          if (isScreenAudio) {
            peerData.screenAudioTrack = track;
            const tracks: MediaStreamTrack[] = [];
            if (peerData.screenTrack && peerData.screenTrack.readyState === 'live') {
              tracks.push(peerData.screenTrack);
            } else if (incomingStream && incomingStream.getVideoTracks().length > 0) {
              tracks.push(...incomingStream.getVideoTracks());
            }
            tracks.push(track);
            peerData.screenStream = new MediaStream(tracks);
          } else {
            peerData.audioTrack = track;
            attachRemoteAudio(remoteUserId, track, incomingStream || new MediaStream([track]));
          }
        } else if (track.kind === 'video') {
          peerData.screenTrack = track;
          peerData.isScreenSharing = true;

          // Verificar se o stream recebido já traz a faixa de áudio da tela junto
          const streamAudio = incomingStream?.getAudioTracks()[0];
          if (streamAudio) {
            peerData.screenAudioTrack = streamAudio;
          }

          const tracks: MediaStreamTrack[] = [track];
          if (peerData.screenAudioTrack && peerData.screenAudioTrack.readyState === 'live') {
            tracks.push(peerData.screenAudioTrack);
          }
          peerData.screenStream = new MediaStream(tracks);

          track.onended = () => {
            const currentPeer = remoteParticipantsRef.current.get(remoteUserId);
            if (currentPeer && currentPeer.screenTrack?.id === track.id) {
              currentPeer.screenTrack = undefined;
              currentPeer.screenAudioTrack = undefined;
              currentPeer.screenStream = undefined;
              currentPeer.isScreenSharing = false;
              syncVoiceState();
            }
          };
        }

        syncVoiceState();
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          // Tentar reconexão ICE automática
          sendOffer(remoteUserId, channelId);
        }
      };

      return { pc, isNew: true };
    },
    [socket, attachRemoteAudio, syncVoiceState, sendOffer]
  );

  // Configura detector de atividade de voz (VAD) para o microfone local
  const setupLocalVAD = useCallback(
    (stream: MediaStream) => {
      if (vadCleanupRef.current) {
        vadCleanupRef.current();
        vadCleanupRef.current = null;
      }

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx: AudioContext = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const interval = window.setInterval(() => {
          if (isMutedRef.current || !currentChannelRef.current) {
            if (isLocalSpeakingRef.current) {
              isLocalSpeakingRef.current = false;
              syncVoiceState();
              emitLocalVoiceState();
            }
            return;
          }

          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const speaking = avg > 12;

          if (speaking !== isLocalSpeakingRef.current) {
            isLocalSpeakingRef.current = speaking;
            syncVoiceState();
            emitLocalVoiceState();
          }
        }, 180);

        vadCleanupRef.current = () => {
          clearInterval(interval);
          source.disconnect();
          audioCtx.close().catch(() => {});
        };
      } catch (err) {
        console.warn('Falha ao iniciar detector de voz local:', err);
      }
    },
    [syncVoiceState, emitLocalVoiceState]
  );

  // Captura microfone local respeitando deviceId selecionado
  const captureLocalMicrophone = useCallback(
    async (deviceId?: string): Promise<MediaStream | null> => {
      const targetId = deviceId ?? selectedAudioDeviceId;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio:
            targetId && targetId !== 'default'
              ? {
                  deviceId: { ideal: targetId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
          video: false,
        });

        const track = stream.getAudioTracks()[0] || null;
        if (track) {
          track.enabled = !isMutedRef.current;
        }

        // Parar microfone anterior se existir
        if (localMicStreamRef.current && localMicStreamRef.current.id !== stream.id) {
          localMicStreamRef.current.getTracks().forEach((t) => t.stop());
        }

        localMicStreamRef.current = stream;
        setLocalAudioTrack(track);
        setupLocalVAD(stream);
        return stream;
      } catch (err) {
        console.warn('Falha ao capturar microfone específico, tentando padrão:', err);
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          const track = fallbackStream.getAudioTracks()[0] || null;
          if (track) {
            track.enabled = !isMutedRef.current;
          }
          localMicStreamRef.current = fallbackStream;
          setLocalAudioTrack(track);
          setupLocalVAD(fallbackStream);
          return fallbackStream;
        } catch (fallbackErr) {
          console.error('Não foi possível acessar nenhum microfone:', fallbackErr);
          return null;
        }
      }
    },
    [selectedAudioDeviceId, setupLocalVAD]
  );

  const refreshAudioDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter(
          (d) =>
            d.kind === 'audioinput' &&
            d.deviceId !== 'default' &&
            d.deviceId !== 'communications'
        );

        const uniqueInputs: MediaDeviceInfo[] = [];
        const seenIds = new Set<string>();
        inputs.forEach((d) => {
          if (d.deviceId && !seenIds.has(d.deviceId)) {
            seenIds.add(d.deviceId);
            uniqueInputs.push(d);
          }
        });

        setAudioDevices(uniqueInputs);

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

      // Se estiver em uma chamada de voz ativa, substituir a track de áudio em todas as conexões P2P
      if (currentChannelRef.current) {
        const newStream = await captureLocalMicrophone(id);
        const newTrack = newStream?.getAudioTracks()[0];
        if (newTrack) {
          peersRef.current.forEach((pc, peerId) => {
            const audioSender = pc
              .getSenders()
              .find((s) => s.track && s.track.kind === 'audio');
            if (audioSender) {
              audioSender.replaceTrack(newTrack).catch(() => {});
            } else if (newStream) {
              pc.addTrack(newTrack, newStream);
              if (currentChannelRef.current) {
                sendOffer(peerId, currentChannelRef.current.id);
              }
            }
          });
        }
      }
    },
    [captureLocalMicrophone, sendOffer]
  );

  const setMasterVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    masterVolumeRef.current = clamped;
    setMasterVolumeState(clamped);
    saveUserSetting('masterOutputVolume', clamped);
    audioElementsRef.current.forEach((el) => {
      el.volume = isDeafenedRef.current ? 0 : clamped / 100;
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

  useEffect(() => {
    const unsubscribe = subscribeToSettingsChange((settings: UserAudioSettings) => {
      setSelectedAudioDeviceIdState(settings.selectedAudioDeviceId);
      masterVolumeRef.current = settings.masterOutputVolume;
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

  // Listeners Socket.io para sinalização WebRTC Mesh e estado de voz
  useEffect(() => {
    if (!socket) return;

    const handleVoiceChannelUpdated = (data: {
      channelId: string;
      participants?: Array<{
        id: string;
        username: string;
        avatarUrl?: string;
        isMuted?: boolean;
        isSpeaking?: boolean;
        isScreenSharing?: boolean;
        screenStreamId?: string | null;
      }>;
      users?: Array<{
        id: string;
        username: string;
        avatarUrl?: string;
        isMuted?: boolean;
        isSpeaking?: boolean;
        isScreenSharing?: boolean;
        screenStreamId?: string | null;
      }>;
    }) => {
      const channelId = data?.channelId;
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;

      const participantsList = data.participants || data.users || [];
      const activeIds = new Set(participantsList.map((p) => p.id));

      // Remover peers que saíram do canal
      Array.from(remoteParticipantsRef.current.keys()).forEach((peerId) => {
        if (!activeIds.has(peerId)) {
          cleanupPeer(peerId);
        }
      });

      // Atualizar ou criar conexões para os participantes presentes
      participantsList.forEach((p) => {
        if (p.id === user?.id) return;

        const existing = remoteParticipantsRef.current.get(p.id);
        remoteParticipantsRef.current.set(p.id, {
          id: p.id,
          username: p.username,
          avatarUrl: p.avatarUrl,
          isMuted: p.isMuted ?? existing?.isMuted ?? false,
          isSpeaking: p.isSpeaking ?? existing?.isSpeaking ?? false,
          isScreenSharing: p.isScreenSharing ?? existing?.isScreenSharing ?? false,
          screenStreamId: p.screenStreamId ?? existing?.screenStreamId ?? null,
          audioTrack: existing?.audioTrack,
          screenTrack: p.isScreenSharing === false ? undefined : existing?.screenTrack,
          screenStream: p.isScreenSharing === false ? undefined : existing?.screenStream,
        });

        const { isNew } = getOrCreatePeerConnection(p.id, channelId);
        if (isNew && String(user?.id || '') < String(p.id)) {
          sendOffer(p.id, channelId);
        }
      });

      syncVoiceState();
    };

    const handleVoicePeerJoined = (data: {
      channelId: string;
      peer?: {
        id: string;
        username: string;
        avatarUrl?: string;
        isMuted?: boolean;
        isSpeaking?: boolean;
        isScreenSharing?: boolean;
        screenStreamId?: string | null;
      };
      participant?: {
        id: string;
        username: string;
        avatarUrl?: string;
        isMuted?: boolean;
        isSpeaking?: boolean;
        isScreenSharing?: boolean;
        screenStreamId?: string | null;
      };
    }) => {
      const channelId = data?.channelId;
      const peer = data?.peer || data?.participant;
      if (!peer || !peer.id) return;
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      if (peer.id === user?.id) return;

      const existing = remoteParticipantsRef.current.get(peer.id);
      remoteParticipantsRef.current.set(peer.id, {
        id: peer.id,
        username: peer.username,
        avatarUrl: peer.avatarUrl,
        isMuted: peer.isMuted ?? existing?.isMuted ?? false,
        isSpeaking: peer.isSpeaking ?? existing?.isSpeaking ?? false,
        isScreenSharing: peer.isScreenSharing ?? existing?.isScreenSharing ?? false,
        screenStreamId: peer.screenStreamId ?? existing?.screenStreamId ?? null,
        audioTrack: existing?.audioTrack,
        screenTrack: existing?.screenTrack,
        screenStream: existing?.screenStream,
      });

      // Criar conexão e enviar oferta imediatamente (garante que quem já estava transmitindo envie a tela ao novo membro)
      getOrCreatePeerConnection(peer.id, channelId);
      sendOffer(peer.id, channelId);
      syncVoiceState();
    };

    const handleVoicePeerLeft = ({
      channelId,
      userId,
    }: {
      channelId: string;
      userId: string;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      cleanupPeer(userId);
      syncVoiceState();
    };

    const handleVoiceUserStateUpdated = ({
      channelId,
      userId,
      isMuted: peerMuted,
      isSpeaking: peerSpeaking,
      isScreenSharing: peerSharing,
      screenStreamId,
    }: {
      channelId: string;
      userId: string;
      isMuted?: boolean;
      isSpeaking?: boolean;
      isScreenSharing?: boolean;
      screenStreamId?: string | null;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      if (userId === user?.id) return;

      let peer = remoteParticipantsRef.current.get(userId);
      if (!peer) {
        peer = {
          id: userId,
          username: 'Usuário',
          isMuted: false,
          isSpeaking: false,
          isScreenSharing: false,
        };
        remoteParticipantsRef.current.set(userId, peer);
      }

      if (typeof peerMuted === 'boolean') peer.isMuted = peerMuted;
      if (typeof peerSpeaking === 'boolean') peer.isSpeaking = peerSpeaking;
      if (typeof peerSharing === 'boolean') {
        peer.isScreenSharing = peerSharing;
        if (!peerSharing) {
          peer.screenTrack = undefined;
          peer.screenStream = undefined;
        }
      }
      if (screenStreamId !== undefined) peer.screenStreamId = screenStreamId;
      syncVoiceState();
    };

    const handleWebRTCOffer = async ({
      channelId,
      fromUserId,
      fromUsername,
      sdp,
      screenStreamId,
    }: {
      channelId: string;
      fromUserId: string;
      fromUsername?: string;
      sdp: RTCSessionDescriptionInit;
      screenStreamId?: string | null;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      if (fromUserId === user?.id) return;

      let peerEntry = remoteParticipantsRef.current.get(fromUserId);
      if (!peerEntry) {
        peerEntry = {
          id: fromUserId,
          username: fromUsername || 'Usuário',
          isMuted: false,
          isSpeaking: false,
          isScreenSharing: Boolean(screenStreamId),
          screenStreamId: screenStreamId || null,
        };
        remoteParticipantsRef.current.set(fromUserId, peerEntry);
      } else if (screenStreamId !== undefined) {
        peerEntry.screenStreamId = screenStreamId;
        if (screenStreamId) {
          peerEntry.isScreenSharing = true;
        }
      }

      const { pc } = getOrCreatePeerConnection(fromUserId, channelId);

      try {
        const isMakingOffer = makingOfferRef.current.get(fromUserId) || false;
        const offerCollision = isMakingOffer || pc.signalingState !== 'stable';
        const isPolite = String(user?.id || '') > String(fromUserId);

        if (offerCollision) {
          if (!isPolite) {
            return;
          }
          if (pc.signalingState === 'have-local-offer') {
            try {
              await pc.setLocalDescription({ type: 'rollback' });
            } catch {}
          }
        }

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        // Processar candidatos ICE pendentes
        const queued = pendingCandidatesRef.current.get(fromUserId) || [];
        for (const cand of queued) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingCandidatesRef.current.delete(fromUserId);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('webrtc-answer', {
          channelId,
          toUserId: fromUserId,
          targetUserId: fromUserId,
          sdp: pc.localDescription,
          screenStreamId: screenStreamRef.current?.id || null,
        });
      } catch (err) {
        console.warn(`Erro ao processar oferta WebRTC de ${fromUserId}:`, err);
      }
    };

    const handleWebRTCAnswer = async ({
      channelId,
      fromUserId,
      sdp,
    }: {
      channelId: string;
      fromUserId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      const pc = peersRef.current.get(fromUserId);
      if (!pc) return;

      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const queued = pendingCandidatesRef.current.get(fromUserId) || [];
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingCandidatesRef.current.delete(fromUserId);
        }
      } catch (err) {
        console.warn(`Erro ao aplicar resposta WebRTC de ${fromUserId}:`, err);
      }
    };

    const handleWebRTCIceCandidate = async ({
      channelId,
      fromUserId,
      candidate,
    }: {
      channelId: string;
      fromUserId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      const pc = peersRef.current.get(fromUserId);
      if (!pc) return;

      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          const list = pendingCandidatesRef.current.get(fromUserId) || [];
          list.push(candidate);
          pendingCandidatesRef.current.set(fromUserId, list);
        }
      } catch (err) {
        console.warn(`Erro ao adicionar ICE candidate de ${fromUserId}:`, err);
      }
    };

    socket.on('voice-channel-updated', handleVoiceChannelUpdated);
    socket.on('voice-peer-joined', handleVoicePeerJoined);
    socket.on('voice-peer-left', handleVoicePeerLeft);
    socket.on('voice-user-state-updated', handleVoiceUserStateUpdated);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleWebRTCIceCandidate);

    return () => {
      socket.off('voice-channel-updated', handleVoiceChannelUpdated);
      socket.off('voice-peer-joined', handleVoicePeerJoined);
      socket.off('voice-peer-left', handleVoicePeerLeft);
      socket.off('voice-user-state-updated', handleVoiceUserStateUpdated);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleWebRTCIceCandidate);
    };
  }, [socket, user?.id, cleanupPeer, getOrCreatePeerConnection, sendOffer, syncVoiceState]);

  // Conectar a um canal de voz com WebRTC Mesh nativo
  const joinVoiceChannel = useCallback(
    async (channel: Channel) => {
      if (currentChannelRef.current?.id === channel.id) return;

      setIsConnecting(true);
      try {
        // Limpar conexões de canal anterior se houver
        Array.from(peersRef.current.keys()).forEach((peerId) => cleanupPeer(peerId));

        currentChannelRef.current = channel;
        setCurrentVoiceChannel(channel);
        setLivekitToken('native-webrtc-token');
        setLivekitUrl('webrtc://native-mesh');

        // Capturar microfone local
        await captureLocalMicrophone(selectedAudioDeviceId);

        syncVoiceState();

        // Notificar servidor via Socket.io para presença e iniciar malha WebRTC
        if (socket) {
          socket.emit('join-voice', {
            serverId: channel.serverId,
            channelId: channel.id,
            isMuted: isMutedRef.current,
            isScreenSharing: isScreenSharingRef.current,
            screenStreamId: screenStreamRef.current?.id || null,
          });
        }
      } catch (error) {
        console.error('Falha ao entrar no canal de voz:', error);
      } finally {
        setIsConnecting(false);
      }
    },
    [selectedAudioDeviceId, socket, cleanupPeer, captureLocalMicrophone, syncVoiceState]
  );

  const leaveVoiceChannel = useCallback(() => {
    const ch = currentChannelRef.current;
    if (ch && socket) {
      socket.emit('leave-voice', {
        serverId: ch.serverId,
        channelId: ch.id,
      });
    }

    currentChannelRef.current = null;

    if (vadCleanupRef.current) {
      vadCleanupRef.current();
      vadCleanupRef.current = null;
    }

    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach((t) => t.stop());
      localMicStreamRef.current = null;
    }
    setLocalAudioTrack(null);

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);

    Array.from(peersRef.current.keys()).forEach((peerId) => cleanupPeer(peerId));
    remoteParticipantsRef.current.clear();

    audioElementsRef.current.forEach((el) => {
      el.pause();
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();

    setCurrentVoiceChannel(null);
    setLivekitToken(null);
    setVoiceParticipants([]);
    setActiveScreenShares([]);
    setSelectedScreenShareId(null);
  }, [socket, cleanupPeer]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (localMicStreamRef.current) {
        localMicStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = !next;
        });
      }
      if (next) {
        isLocalSpeakingRef.current = false;
      }
      syncVoiceState();
      emitLocalVoiceState();
      return next;
    });
  }, [syncVoiceState, emitLocalVoiceState]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const next = !prev;
      isDeafenedRef.current = next;
      if (next) {
        isMutedRef.current = true;
        setIsMuted(true);
        if (localMicStreamRef.current) {
          localMicStreamRef.current.getAudioTracks().forEach((t) => {
            t.enabled = false;
          });
        }
      }
      audioElementsRef.current.forEach((el) => {
        el.volume = next ? 0 : Math.max(0, Math.min(1, masterVolumeRef.current / 100));
      });
      syncVoiceState();
      emitLocalVoiceState();
      return next;
    });
  }, [syncVoiceState, emitLocalVoiceState]);

  const stopScreenShare = useCallback(() => {
    const ch = currentChannelRef.current;

    // Remover senders de tela de todas as conexões WebRTC ativas e renegociar
    peersRef.current.forEach((pc, peerId) => {
      const senders = screenSendersRef.current.get(peerId) || [];
      senders.forEach((sender) => {
        try {
          pc.removeTrack(sender);
        } catch {}
      });
      screenSendersRef.current.delete(peerId);
      if (ch) {
        sendOffer(peerId, ch.id);
      }
    });

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
    }

    isScreenSharingRef.current = false;
    setScreenStream(null);
    setIsScreenSharing(false);

    syncVoiceState();
    emitLocalVoiceState();
  }, [sendOffer, syncVoiceState, emitLocalVoiceState]);

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
            // Tentar capturar vídeo (tela ou janela) + áudio desktop loopback com filtro inteligente de vozes do Xolas
            stream = await (navigator.mediaDevices as any).getUserMedia({
              audio: includeAudio
                ? {
                    mandatory: {
                      chromeMediaSource: 'desktop',
                    },
                    optional: [
                      { echoCancellation: true },
                      { googEchoCancellation: true },
                      { googExperimentalEchoCancellation: true },
                      { googAutoGainControl: false },
                      { googNoiseSuppression: false },
                    ],
                  }
                : false,
              video: {
                mandatory: videoMandatory,
                optional: isWindow ? [{ maxWidth: width }, { maxHeight: height }] : [],
              },
            });
          } catch (errWindow) {
            console.warn('Captura combinada falhou na janela, capturando vídeo e anexando áudio do sistema separadamente:', errWindow);
            try {
              stream = await (navigator.mediaDevices as any).getUserMedia({
                audio: false,
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: sourceId,
                  },
                  optional: [{ maxWidth: width }, { maxHeight: height }],
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
                audio: includeAudio,
              });
            }
          }

          // Se o usuário pediu áudio (ex: selecionou a janela do Google/Opera) e o stream ainda não tem faixa de áudio,
          // capturamos o loopback de áudio do desktop e injetamos no mesmo MediaStream da janela!
          if (includeAudio && stream.getAudioTracks().length === 0) {
            try {
              const desktopAudioStream: MediaStream = await (navigator.mediaDevices as any).getUserMedia({
                audio: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                  },
                  optional: [
                    { echoCancellation: true },
                    { googEchoCancellation: true },
                    { googExperimentalEchoCancellation: true },
                    { googAutoGainControl: false },
                    { googNoiseSuppression: false },
                  ],
                },
                video: {
                  mandatory: {
                    chromeMediaSource: 'desktop',
                    maxWidth: 16,
                    maxHeight: 16,
                    maxFrameRate: 1,
                  },
                },
              });
              // Descartar imediatamente o vídeo auxiliar 16x16 e manter apenas a faixa de áudio do sistema
              desktopAudioStream.getVideoTracks().forEach((vt) => vt.stop());
              const sysAudioTrack = desktopAudioStream.getAudioTracks()[0];
              if (sysAudioTrack) {
                stream.addTrack(sysAudioTrack);
              }
            } catch (audioLoopbackErr) {
              console.warn('Não foi possível capturar áudio loopback adicional para a janela:', audioLoopbackErr);
            }
          }
        } else {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: width },
              height: { ideal: height },
              frameRate: { ideal: fps, max: fps },
            },
            audio: includeAudio,
          });
        }

        // Garantir fidelidade máxima de som para vídeos/jogos e isolamento das vozes da chamada do Xolas
        stream.getAudioTracks().forEach((at) => {
          at.enabled = true;
          at.applyConstraints({
            echoCancellation: true,
            noiseSuppression: false,
            autoGainControl: false,
          }).catch(() => {});
        });

        // Parar stream anterior se estiver trocando de janela/tela
        if (screenStreamRef.current && screenStreamRef.current.id !== stream.id) {
          screenStreamRef.current.getTracks().forEach((t) => {
            t.onended = null;
            t.stop();
          });
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            stopScreenShare();
          };
        }

        // 1. Ativar preview local IMEDIATAMENTE (0ms)
        screenStreamRef.current = stream;
        isScreenSharingRef.current = true;
        setScreenStream(stream);
        setIsScreenSharing(true);
        setSelectedScreenShareId('local-screen');

        syncVoiceState();
        emitLocalVoiceState();

        // 2. Publicar as faixas de tela em todas as conexões WebRTC P2P ativas
        const ch = currentChannelRef.current;
        if (ch) {
          peersRef.current.forEach((pc, peerId) => {
            // Remover senders de tela antigos se existirem
            const prevSenders = screenSendersRef.current.get(peerId) || [];
            prevSenders.forEach((s) => {
              try {
                pc.removeTrack(s);
              } catch {}
            });

            const newSenders: RTCRtpSender[] = [];
            stream.getTracks().forEach((track) => {
              const sender = pc.addTrack(track, stream);
              newSenders.push(sender);
            });
            screenSendersRef.current.set(peerId, newSenders);

            sendOffer(peerId, ch.id);
          });
        }
      } catch (error) {
        console.error('Falha ao iniciar compartilhamento de tela:', error);
      }
    },
    [stopScreenShare, syncVoiceState, emitLocalVoiceState, sendOffer]
  );

  const watchScreenShare = useCallback((shareId: string) => {
    setSelectedScreenShareId(shareId);
  }, []);

  const stopWatchingScreenShare = useCallback(() => {
    setSelectedScreenShareId(null);
  }, []);

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
        watchScreenShare,
        stopWatchingScreenShare,
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

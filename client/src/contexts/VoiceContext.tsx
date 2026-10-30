import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Channel } from '../types';
import { useSocket } from './SocketContext';
import { useAuth } from './AuthContext';
import {
  getUserSettings,
  saveUserSetting,
  subscribeToSettingsChange,
  resolveAudioDevice,
  keyboardEventToAccelerator,
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
  rawAudioTrack: MediaStreamTrack | null;
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
  voiceActivationThreshold: number;
  setVoiceActivationThreshold: (threshold: number) => void;
  updateScreenQualityPreset: (options: ScreenQualityOptions) => void;
  // Multiusuário e compartilhamento de tela WebRTC
  voiceParticipants: ActiveParticipant[];
  activeScreenShares: ActiveScreenShareInfo[];
  selectedScreenShareId: string | null;
  setSelectedScreenShareId: (id: string | null) => void;
  watchScreenShare: (shareId: string) => void;
  stopWatchingScreenShare: () => void;
  // Volumes individuais e silenciamento local por usuário (0% a 200%)
  userVolumes: Record<string, number>;
  userMuted: Record<string, boolean>;
  setUserVolume: (userId: string, volume: number) => void;
  toggleMuteUser: (userId: string) => void;
  getUserVolume: (userId: string) => number;
  isUserMuted: (userId: string) => boolean;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Feedback sonoro suave estilo Discord para alternância de mudo e ensordecer
function playAudioCue(type: 'mute' | 'unmute' | 'deafen' | 'undeafen') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.12, now);

    if (type === 'mute') {
      // Tom duplo descendente suave (550Hz -> 420Hz)
      osc.frequency.setValueAtTime(550, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'unmute') {
      // Tom duplo ascendente alegre (420Hz -> 580Hz)
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'deafen') {
      // Tom grave de ensordecer
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'undeafen') {
      // Tom ascendente de desensordecer
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {}
}

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
  const [rawAudioTrack, setRawAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [masterVolume, setMasterVolumeState] = useState<number>(initialSettings.masterOutputVolume);
  const [micInputGain, setMicInputGainState] = useState<number>(initialSettings.micInputGain);
  const [voiceActivationThreshold, setVoiceActivationThresholdState] = useState<number>(
    initialSettings.voiceActivationThreshold
  );

  const [voiceParticipants, setVoiceParticipants] = useState<ActiveParticipant[]>([]);
  const [activeScreenShares, setActiveScreenShares] = useState<ActiveScreenShareInfo[]>([]);
  const [selectedScreenShareId, setSelectedScreenShareId] = useState<string | null>(null);

  // Refs mutáveis para acesso imediato em callbacks WebRTC / Socket.io
  const currentChannelRef = useRef<Channel | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const localMicStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const vadGateGainNodeRef = useRef<GainNode | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isMutedRef = useRef<boolean>(false);
  const isDeafenedRef = useRef<boolean>(false);
  const isScreenSharingRef = useRef<boolean>(false);
  const selectedScreenShareIdRef = useRef<string | null>(null);
  const isLocalSpeakingRef = useRef<boolean>(false);
  const masterVolumeRef = useRef<number>(initialSettings.masterOutputVolume);
  const micInputGainRef = useRef<number>(initialSettings.micInputGain);
  const voiceActivationThresholdRef = useRef<number>(initialSettings.voiceActivationThreshold);
  const screenQualityRef = useRef<ScreenQualityOptions>({
    resolution: initialSettings.screenResolution,
    fps: initialSettings.screenFps,
    includeAudio: initialSettings.screenIncludeAudio,
  });

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteParticipantsRef = useRef<Map<string, RemotePeerData>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const screenSendersRef = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const vadCleanupRef = useRef<(() => void) | null>(null);
  const screenAudioCleanupRef = useRef<(() => void) | null>(null);

  // Volumes individuais e silenciamento local por usuário (0% a 200%, persistidos no LocalStorage)
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem('xolas_user_volumes');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const [userMuted, setUserMuted] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('xolas_user_muted');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  const userVolumesRef = useRef<Record<string, number>>(userVolumes);
  const userMutedRef = useRef<Record<string, boolean>>(userMuted);
  userVolumesRef.current = userVolumes;
  userMutedRef.current = userMuted;
  selectedScreenShareIdRef.current = selectedScreenShareId;

  interface RemoteAudioPipeline {
    source: MediaStreamAudioSourceNode;
    gainNode: GainNode;
    audioEl: HTMLAudioElement;
  }
  const remoteAudioCtxRef = useRef<AudioContext | null>(null);
  const remotePipelinesRef = useRef<Map<string, RemoteAudioPipeline>>(new Map());

  const calculateGain = useCallback((peerId: string) => {
    if (isDeafenedRef.current) return 0;
    if (userMutedRef.current[peerId]) return 0;
    const userVol = userVolumesRef.current[peerId] ?? 100; // 0 a 200
    const masterVol = masterVolumeRef.current; // 0 a 100
    return (userVol / 100) * (masterVol / 100);
  }, []);

  const applyGainToPeer = useCallback((peerId: string) => {
    const gain = calculateGain(peerId);
    const ctx = remoteAudioCtxRef.current;

    audioElementsRef.current.forEach((el, key) => {
      if (key.startsWith(`${peerId}:::`)) {
        const pipeline = remotePipelinesRef.current.get(key);
        if (gain > 1.0 && ctx && ctx.state !== 'closed' && pipeline) {
          try {
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            pipeline.gainNode.gain.setValueAtTime(gain, ctx.currentTime);
            el.muted = true; // Web Audio entrega a reprodução amplificada
            el.volume = 1.0;
          } catch {
            el.muted = false;
            el.volume = 1.0;
          }
        } else {
          // Volume normal 0% a 100% nativo no elemento de áudio
          if (pipeline && ctx && ctx.state !== 'closed') {
            try {
              pipeline.gainNode.gain.setValueAtTime(0, ctx.currentTime);
            } catch {}
          }
          el.muted = (gain === 0);
          el.volume = Math.max(0, Math.min(1, gain));
        }
      }
    });
  }, [calculateGain]);

  const updateAllGainNodes = useCallback(() => {
    const seenPeers = new Set<string>();
    audioElementsRef.current.forEach((_, key) => {
      const [peerId] = key.split(':::');
      if (peerId && !seenPeers.has(peerId)) {
        seenPeers.add(peerId);
        applyGainToPeer(peerId);
      }
    });
  }, [applyGainToPeer]);

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
      // Importante: O preview local NUNCA deve incluir a faixa de áudio para evitar auto-reprodução/loop
      const videoOnlyLocalStream = new MediaStream(currentScreen.getVideoTracks());
      shares.push({
        id: 'local-screen',
        participantName: user?.username || 'Você',
        isLocal: true,
        stream: videoOnlyLocalStream,
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

  // Anexa stream de áudio remoto ao container DOM oculto com suporte a GainNode (0% a 200%)
  const attachRemoteAudio = useCallback((peerId: string, track: MediaStreamTrack, stream?: MediaStream) => {
    let container = document.getElementById('xolas-remote-audio-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'xolas-remote-audio-container';
      container.style.display = 'none';
      document.body.appendChild(container);
    }

    const key = `${peerId}:::${track.id}`;
    let audioEl = audioElementsRef.current.get(key);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      (audioEl as any).playsInline = true;
      container.appendChild(audioEl);
      audioElementsRef.current.set(key, audioEl);
    }

    const mediaStream = stream || new MediaStream([track]);

    // O elemento de áudio DEVE receber mediaStream diretamente para que o Chromium
    // continue decodificando ativamente os pacotes WebRTC sem suspender por inatividade!
    if (audioEl.srcObject !== mediaStream) {
      audioEl.srcObject = mediaStream;
    }

    // Configurar pipeline Web Audio para suporte a volumes amplificados (> 100%)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!remoteAudioCtxRef.current || remoteAudioCtxRef.current.state === 'closed') {
          remoteAudioCtxRef.current = new AudioCtx();
        }
        const ctx = remoteAudioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        let pipeline = remotePipelinesRef.current.get(key);
        if (!pipeline) {
          const source = ctx.createMediaStreamSource(mediaStream);
          const gainNode = ctx.createGain();
          source.connect(gainNode);
          gainNode.connect(ctx.destination);

          pipeline = { source, gainNode, audioEl };
          remotePipelinesRef.current.set(key, pipeline);
        }
      }
    } catch (err) {
      console.warn('[VoiceContext] Erro ao preparar pipeline Web Audio:', err);
    }

    applyGainToPeer(peerId);
    audioEl.play().catch(() => {});
  }, [applyGainToPeer]);

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

    // Remover pipelines Web Audio associados ao peer
    Array.from(remotePipelinesRef.current.entries()).forEach(([key, pipeline]) => {
      if (key.startsWith(`${peerId}:::`)) {
        try {
          pipeline.source.disconnect();
          pipeline.gainNode.disconnect();
        } catch {}
        remotePipelinesRef.current.delete(key);
      }
    });

    // Remover elementos de áudio associados ao peer
    Array.from(audioElementsRef.current.entries()).forEach(([key, el]) => {
      if (key.startsWith(`${peerId}:::`)) {
        el.pause();
        el.srcObject = null;
        el.remove();
        audioElementsRef.current.delete(key);
      }
    });
  }, []);

  // Otimiza o SDP para vídeo adaptativo de alta fidelidade e áudio Opus com FEC (sem perdas e sem travadas)
  const optimizeWebRtcSdp = useCallback(
    (sdp?: string, quality?: ScreenQualityOptions): string | undefined => {
      if (!sdp) return sdp;
      const currentQuality = quality || screenQualityRef.current;
      const is1080 = currentQuality.resolution === '1080p';

      // Parâmetros adaptativos de vídeo:
      // min-bitrate suficiente para evitar congelamento durante quedas temporárias de rede
      const minVideoBitrate = is1080 ? 800 : 500;
      const startVideoBitrate = is1080 ? 3000 : 1800;
      const maxVideoBitrate = is1080 ? 7000 : 4000;
      const bAsBandwidth = is1080 ? 7000 : 4000;

      const lines = sdp.split('\r\n');
      let currentSection: 'none' | 'audio' | 'video' = 'none';
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('m=audio ')) {
          currentSection = 'audio';
          result.push(line);
          continue;
        } else if (line.startsWith('m=video ')) {
          currentSection = 'video';
          result.push(line);
          // Injetar b=AS e b=TIAS para sinalizar largura de banda ao WebRTC
          result.push(`b=AS:${bAsBandwidth}`);
          result.push(`b=TIAS:${bAsBandwidth * 1000}`);
          continue;
        } else if (line.startsWith('m=')) {
          currentSection = 'none';
        }

        if (currentSection === 'video') {
          // Injetar limites adaptativos nos codecs de vídeo (sem travar em 2500 kbps mínimo)
          if (
            line.startsWith('a=fmtp:') &&
            !line.includes('apt=') &&
            !line.includes('x-google-max-bitrate')
          ) {
            result.push(
              `${line};x-google-min-bitrate=${minVideoBitrate};x-google-start-bitrate=${startVideoBitrate};x-google-max-bitrate=${maxVideoBitrate}`
            );
          } else {
            result.push(line);
          }
        } else if (currentSection === 'audio') {
          // Otimizar codec Opus: Estéreo de estúdio (256 kbps), CBR sem DTX (elimina pipocadas em passagens silenciosas) e FEC
          if (line.startsWith('a=fmtp:') && line.toLowerCase().includes('minptime=')) {
            let opusLine = line;
            if (!opusLine.includes('stereo=')) {
              opusLine += ';stereo=1;sprop-stereo=1';
            }
            if (!opusLine.includes('useinbandfec=')) {
              opusLine += ';useinbandfec=1';
            }
            if (!opusLine.includes('usedtx=')) {
              opusLine += ';usedtx=0';
            }
            if (!opusLine.includes('maxaveragebitrate=')) {
              opusLine += ';maxaveragebitrate=256000';
            }
            if (!opusLine.includes('cbr=')) {
              opusLine += ';cbr=1';
            }
            result.push(opusLine);
          } else {
            result.push(line);
          }
        } else {
          result.push(line);
        }
      }

      return result.join('\r\n');
    },
    []
  );

  // Configura o RTCRtpSender de áudio da tela para alta fidelidade contínua sem micro-cortes
  const configureScreenAudioSender = useCallback(async (sender: RTCRtpSender) => {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 256_000;
      (params.encodings[0] as any).priority = 'high';
      (params.encodings[0] as any).networkPriority = 'high';
      (params.encodings[0] as any).dtx = 'disabled';
      await sender.setParameters(params);
    } catch {}
  }, []);

  // Configura o RTCRtpSender de vídeo para priorizar codificação por GPU (H.264) e manter reprodução suave
  const configureScreenVideoSender = useCallback(
    async (pc: RTCPeerConnection, sender: RTCRtpSender, quality: ScreenQualityOptions) => {
      try {
        if (
          typeof RTCRtpSender !== 'undefined' &&
          typeof RTCRtpSender.getCapabilities === 'function'
        ) {
          const capabilities = RTCRtpSender.getCapabilities('video');
          const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
          if (
            capabilities?.codecs &&
            transceiver &&
            typeof transceiver.setCodecPreferences === 'function'
          ) {
            const h264Codecs = capabilities.codecs.filter(
              (c) => c.mimeType.toLowerCase() === 'video/h264'
            );
            const otherCodecs = capabilities.codecs.filter(
              (c) => c.mimeType.toLowerCase() !== 'video/h264'
            );
            if (h264Codecs.length > 0) {
              transceiver.setCodecPreferences([...h264Codecs, ...otherCodecs]);
            }
          }
        }
      } catch (err) {
        console.warn('Não foi possível priorizar codec H264 no transceiver:', err);
      }

      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        const targetBitrate = quality.resolution === '1080p' ? 7_000_000 : 4_000_000;
        const targetFps = quality.fps || 60;

        // 'balanced' permite ao WebRTC equilibrar dinamicamente resolução e framerate,
        // evitando travadas quando houver picos de CPU ou oscilação de rede
        (params as any).degradationPreference = 'balanced';
        params.encodings[0].maxBitrate = targetBitrate;
        params.encodings[0].maxFramerate = targetFps;
        (params.encodings[0] as any).priority = 'high';
        (params.encodings[0] as any).networkPriority = 'high';

        await sender.setParameters(params);
      } catch (err) {
        console.warn('Não foi possível aplicar parâmetros de alto bitrate no RTCRtpSender:', err);
      }
    },
    []
  );

  // Envia oferta SDP para um peer específico
  const sendOffer = useCallback(
    async (remoteUserId: string, channelId: string) => {
      const pc = peersRef.current.get(remoteUserId);
      if (!pc || !socket) return;

      try {
        makingOfferRef.current.set(remoteUserId, true);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        try {
          const boostedSdp = optimizeWebRtcSdp(offer.sdp, screenQualityRef.current);
          await pc.setLocalDescription({ type: offer.type, sdp: boostedSdp });
        } catch {
          await pc.setLocalDescription(offer);
        }

        // Reaplicar parâmetros de bitrate/framerate após negociação local
        const senders = screenSendersRef.current.get(remoteUserId) || [];
        senders.forEach((s) => {
          if (s.track?.kind === 'video') {
            configureScreenVideoSender(pc, s, screenQualityRef.current);
          } else if (s.track?.kind === 'audio') {
            configureScreenAudioSender(s);
          }
        });

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
    [socket, optimizeWebRtcSdp, configureScreenVideoSender, configureScreenAudioSender]
  );

  // Garante que as faixas da transmissão de tela local estejam anexadas aos senders do peer
  const ensureScreenTracksForPeer = useCallback(
    (remoteUserId: string, pc: RTCPeerConnection) => {
      if (!screenStreamRef.current) return false;
      const existingSenders = screenSendersRef.current.get(remoteUserId) || [];
      const hasLiveVideoSender = existingSenders.some(
        (s) => s.track && s.track.kind === 'video' && s.track.readyState === 'live'
      );
      if (!hasLiveVideoSender) {
        existingSenders.forEach((s) => {
          try {
            pc.removeTrack(s);
          } catch {}
        });
        const newSenders: RTCRtpSender[] = [];
        screenStreamRef.current.getTracks().forEach((track) => {
          const sender = pc.addTrack(track, screenStreamRef.current!);
          if (track.kind === 'video') {
            configureScreenVideoSender(pc, sender, screenQualityRef.current);
          } else if (track.kind === 'audio') {
            configureScreenAudioSender(sender);
          }
          newSenders.push(sender);
        });
        screenSendersRef.current.set(remoteUserId, newSenders);
        return true;
      }
      return false;
    },
    [configureScreenVideoSender, configureScreenAudioSender]
  );

  // Cria ou retorna a RTCPeerConnection para um participante remoto
  const getOrCreatePeerConnection = useCallback(
    (remoteUserId: string, channelId: string): { pc: RTCPeerConnection; isNew: boolean } => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing && existing.connectionState !== 'closed') {
        if (screenStreamRef.current) {
          ensureScreenTracksForPeer(remoteUserId, existing);
        }
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
          if (track.kind === 'video') {
            configureScreenVideoSender(pc, sender, screenQualityRef.current);
          }
          senders.push(sender);
        });
        screenSendersRef.current.set(remoteUserId, senders);
      } else {
        // Se este cliente local NÃO estiver transmitindo tela, registra transceiver recvonly de vídeo.
        // Isso garante que ofertas/respostas WebRTC sempre declarem m=video para receber transmissões!
        // O áudio de voz já é gerenciado pelo microfone via pc.addTrack!
        try {
          pc.addTransceiver('video', { direction: 'recvonly' });
        } catch {}
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
    [socket, attachRemoteAudio, syncVoiceState, sendOffer, configureScreenVideoSender, ensureScreenTracksForPeer]
  );

  // Configura detector de atividade de voz com Voice Activation Gate real (DSP / Web Audio estilo Discord)
  const setupLocalVAD = useCallback(
    (
      analyser: AnalyserNode,
      audioCtx: AudioContext,
      vadGateGainNode: GainNode,
      processedTrack: MediaStreamTrack
    ) => {
      if (vadCleanupRef.current) {
        vadCleanupRef.current();
        vadCleanupRef.current = null;
      }

      const samples = new Float32Array(analyser.fftSize);
      let hangoverTimeout: number | null = null;

      const interval = window.setInterval(() => {
        if (isMutedRef.current || !currentChannelRef.current) {
          if (hangoverTimeout !== null) {
            window.clearTimeout(hangoverTimeout);
            hangoverTimeout = null;
          }
          if (audioCtx.state !== 'closed') {
            try {
              vadGateGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            } catch {}
          }
          if (processedTrack && processedTrack.enabled) {
            processedTrack.enabled = false;
          }
          if (isLocalSpeakingRef.current) {
            isLocalSpeakingRef.current = false;
            syncVoiceState();
            emitLocalVoiceState();
          }
          return;
        }

        // Se o usuário estiver ativo na chamada e não mutado, a faixa de áudio processada deve permanecer aberta
        if (processedTrack && !processedTrack.enabled) {
          processedTrack.enabled = true;
        }

        const threshold = voiceActivationThresholdRef.current;
        const currentGain = micInputGainRef.current;

        // Se o ganho do microfone estiver zerado, não transmite som
        if (currentGain === 0) {
          if (audioCtx.state !== 'closed') {
            try {
              vadGateGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
            } catch {}
          }
          if (isLocalSpeakingRef.current) {
            isLocalSpeakingRef.current = false;
            syncVoiceState();
            emitLocalVoiceState();
          }
          return;
        }

        // Se o limiar for 0% ("Sempre Ativo"), modo de transmissão contínua sem corte
        if (threshold === 0) {
          if (hangoverTimeout !== null) {
            window.clearTimeout(hangoverTimeout);
            hangoverTimeout = null;
          }
          if (audioCtx.state !== 'closed') {
            try {
              vadGateGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.008);
            } catch {}
          }
          if (!isLocalSpeakingRef.current) {
            isLocalSpeakingRef.current = true;
            syncVoiceState();
            emitLocalVoiceState();
          }
          return;
        }

        if (analyser.getFloatTimeDomainData) {
          analyser.getFloatTimeDomainData(samples);
        } else {
          const byteData = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(byteData);
          for (let i = 0; i < byteData.length; i++) {
            samples[i] = (byteData[i] - 128) / 128;
          }
        }

        let sumSquares = 0;
        for (let i = 0; i < samples.length; i++) {
          sumSquares += samples[i] * samples[i];
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        // Decibéis relativos ao fundo de escala: -60 dB (silêncio) a 0 dB (pico máximo)
        const db = 20 * Math.log10(rms || 0.00001);
        // Normaliza de 0 a 100 com base na escala perceptiva de decibéis
        const normalized = Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
        const currentLevel = Math.max(
          0,
          Math.min(100, Math.round(normalized * (currentGain / 100)))
        );

        const isAboveThreshold = currentLevel >= threshold;

        if (isAboveThreshold) {
          // O som ultrapassou a barra seletora: abre o portão suavemente (rampa de 8ms)
          if (hangoverTimeout !== null) {
            window.clearTimeout(hangoverTimeout);
            hangoverTimeout = null;
          }
          if (audioCtx.state !== 'closed') {
            try {
              vadGateGainNode.gain.setTargetAtTime(1.0, audioCtx.currentTime, 0.008);
            } catch {}
          }
          if (!isLocalSpeakingRef.current) {
            isLocalSpeakingRef.current = true;
            syncVoiceState();
            emitLocalVoiceState();
          }
        } else {
          // Som abaixo da barra seletora (ruído de fundo, respiração ou silêncio)
          if (isLocalSpeakingRef.current && hangoverTimeout === null) {
            // Sustentação de fala suave de 380ms (padrão Discord) para pausas naturais entre palavras
            hangoverTimeout = window.setTimeout(() => {
              hangoverTimeout = null;
              if (audioCtx.state !== 'closed') {
                try {
                  // Rampa de fechamento suave de 25ms (silêncio absoluto sem cliques na onda sonora)
                  vadGateGainNode.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.025);
                } catch {}
              }
              isLocalSpeakingRef.current = false;
              syncVoiceState();
              emitLocalVoiceState();
            }, 380);
          }
        }
      }, 30);

      vadCleanupRef.current = () => {
        clearInterval(interval);
        if (hangoverTimeout !== null) {
          window.clearTimeout(hangoverTimeout);
        }
        if (audioCtx.state !== 'closed') {
          try {
            vadGateGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
          } catch {}
        }
      };
    },
    [syncVoiceState, emitLocalVoiceState]
  );

  // Captura microfone local com pipeline Web Audio (Ganho manual + Voice Activation Gate)
  const captureLocalMicrophone = useCallback(
    async (deviceId?: string): Promise<MediaStream | null> => {
      const targetId = deviceId ?? selectedAudioDeviceId;

      // Limpar pipeline anterior se existir
      if (vadCleanupRef.current) {
        vadCleanupRef.current();
        vadCleanupRef.current = null;
      }
      if (rawMicStreamRef.current) {
        rawMicStreamRef.current.getTracks().forEach((t) => t.stop());
        rawMicStreamRef.current = null;
      }
      if (localMicStreamRef.current) {
        localMicStreamRef.current.getTracks().forEach((t) => t.stop());
        localMicStreamRef.current = null;
      }
      if (micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
        try {
          micAudioCtxRef.current.close().catch(() => {});
        } catch {}
        micAudioCtxRef.current = null;
      }
      micGainNodeRef.current = null;
      vadGateGainNodeRef.current = null;

      let rawStream: MediaStream;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia({
          audio:
            targetId && targetId !== 'default'
              ? {
                  deviceId: { ideal: targetId },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: false,
                }
              : {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: false,
                },
          video: false,
        });
      } catch (err) {
        console.warn('Falha ao capturar microfone específico, tentando padrão:', err);
        try {
          rawStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: false,
            },
            video: false,
          });
        } catch (fallbackErr) {
          console.error('Não foi possível acessar nenhum microfone:', fallbackErr);
          return null;
        }
      }

      const rawTrack = rawStream.getAudioTracks()[0] || null;
      if (!rawTrack) return null;

      rawMicStreamRef.current = rawStream;
      setRawAudioTrack(rawTrack);

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const micAudioCtx: AudioContext = new AudioCtx({ sampleRate: 48000 });
        if (micAudioCtx.state === 'suspended') {
          micAudioCtx.resume().catch(() => {});
        }
        micAudioCtxRef.current = micAudioCtx;

        const source = micAudioCtx.createMediaStreamSource(rawStream);

        // Analisador para medição de nível e VAD
        const analyser = micAudioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        // GainNode para Sensibilidade do Microfone (0% a 100%)
        const micGainNode = micAudioCtx.createGain();
        const initialGain = Math.max(0, Math.min(100, micInputGainRef.current)) / 100;
        micGainNode.gain.setValueAtTime(initialGain, micAudioCtx.currentTime);
        source.connect(micGainNode);
        micGainNodeRef.current = micGainNode;

        // GainNode para o Voice Activation Gate (abertura e corte suave da transmissão)
        const vadGateGainNode = micAudioCtx.createGain();
        const startOpen = !isMutedRef.current && voiceActivationThresholdRef.current === 0;
        vadGateGainNode.gain.setValueAtTime(startOpen ? 1.0 : 0.0, micAudioCtx.currentTime);
        micGainNode.connect(vadGateGainNode);
        vadGateGainNodeRef.current = vadGateGainNode;

        // Destination node onde a trilha de saída processada é gerada para o WebRTC
        const dest = micAudioCtx.createMediaStreamDestination();
        vadGateGainNode.connect(dest);

        const processedTrack = dest.stream.getAudioTracks()[0];
        if (processedTrack) {
          processedTrack.enabled = !isMutedRef.current;
        }

        localMicStreamRef.current = dest.stream;
        setLocalAudioTrack(processedTrack);

        // Iniciar loop de VAD e controle do Noise Gate
        setupLocalVAD(analyser, micAudioCtx, vadGateGainNode, processedTrack);

        return dest.stream;
      } catch (pipelineErr) {
        console.warn('Falha ao inicializar pipeline Web Audio do microfone, usando stream direto:', pipelineErr);
        rawTrack.enabled = !isMutedRef.current;
        localMicStreamRef.current = rawStream;
        setLocalAudioTrack(rawTrack);
        return rawStream;
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
        const hasLabels = uniqueInputs.some((d) => d.label && d.label.trim().length > 0);

        // Se ainda não temos dispositivos ou os rótulos ainda não foram desbloqueados pelo navegador,
        // NÃO sobrescrever as preferências salvas do usuário!
        if (uniqueInputs.length > 0 && hasLabels) {
          const resolved = resolveAudioDevice(
            uniqueInputs,
            settings.selectedAudioDeviceId,
            settings.selectedAudioDeviceLabel
          );

          // Se encontrou uma correspondência exata ou por rótulo (ex: GUID re-hasheado pelo Windows)
          if (!resolved.isFallback && resolved.deviceId !== settings.selectedAudioDeviceId) {
            setSelectedAudioDeviceIdState(resolved.deviceId);
            saveUserSetting('selectedAudioDeviceId', resolved.deviceId);
            if (resolved.label) {
              saveUserSetting('selectedAudioDeviceLabel', resolved.label);
            }
          } else if (resolved.isFallback) {
            // Se o microfone salvo não estiver plugado no momento, utiliza 'default' apenas em tempo
            // de execução na chamada, SEM apagar a configuração salva pelo usuário do disco!
            setSelectedAudioDeviceIdState('default');
          } else {
            setSelectedAudioDeviceIdState(resolved.deviceId);
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
    updateAllGainNodes();
  }, [updateAllGainNodes]);

  const setMicInputGain = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    micInputGainRef.current = clamped;
    setMicInputGainState(clamped);
    saveUserSetting('micInputGain', clamped);
    if (micGainNodeRef.current && micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
      try {
        micGainNodeRef.current.gain.setTargetAtTime(clamped / 100, micAudioCtxRef.current.currentTime, 0.01);
      } catch {}
    }
  }, []);

  const setVoiceActivationThreshold = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    voiceActivationThresholdRef.current = clamped;
    setVoiceActivationThresholdState(clamped);
    saveUserSetting('voiceActivationThreshold', clamped);
    if (clamped === 0 && !isMutedRef.current && vadGateGainNodeRef.current && micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
      try {
        vadGateGainNodeRef.current.gain.setTargetAtTime(1.0, micAudioCtxRef.current.currentTime, 0.008);
      } catch {}
    }
  }, []);

  const updateScreenQualityPreset = useCallback(
    (opts: ScreenQualityOptions) => {
      screenQualityRef.current = opts;
      setScreenQuality(opts);
      saveUserSetting('screenResolution', opts.resolution);
      saveUserSetting('screenFps', opts.fps);
      if (opts.includeAudio !== undefined) {
        saveUserSetting('screenIncludeAudio', opts.includeAudio);
      }

      // Atualizar em tempo real se já houver uma transmissão ativa
      if (screenStreamRef.current) {
        const is1080 = opts.resolution === '1080p';
        const width = is1080 ? 1920 : 1280;
        const height = is1080 ? 1080 : 720;
        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack
            .applyConstraints({
              width: { max: width },
              height: { max: height },
              frameRate: { ideal: opts.fps, max: opts.fps },
            })
            .catch(() => {});
        }
        peersRef.current.forEach((pc, peerId) => {
          const senders = screenSendersRef.current.get(peerId) || [];
          senders.forEach((s) => {
            if (s.track?.kind === 'video') {
              configureScreenVideoSender(pc, s, opts);
            }
          });
        });
      }
    },
    [configureScreenVideoSender]
  );

  useEffect(() => {
    const unsubscribe = subscribeToSettingsChange((settings: UserAudioSettings) => {
      setSelectedAudioDeviceIdState(settings.selectedAudioDeviceId);
      masterVolumeRef.current = settings.masterOutputVolume;
      setMasterVolumeState(settings.masterOutputVolume);
      micInputGainRef.current = settings.micInputGain;
      setMicInputGainState(settings.micInputGain);
      voiceActivationThresholdRef.current = settings.voiceActivationThreshold;
      setVoiceActivationThresholdState(settings.voiceActivationThreshold);
      const updatedQuality: ScreenQualityOptions = {
        resolution: settings.screenResolution,
        fps: settings.screenFps,
        includeAudio: settings.screenIncludeAudio,
      };
      screenQualityRef.current = updatedQuality;
      setScreenQuality(updatedQuality);
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
          screenAudioTrack: p.isScreenSharing === false ? undefined : existing?.screenAudioTrack,
          screenStream: p.isScreenSharing === false ? undefined : existing?.screenStream,
        });

        const { pc, isNew } = getOrCreatePeerConnection(p.id, channelId);
        if (screenStreamRef.current) {
          const tracksAdded = ensureScreenTracksForPeer(p.id, pc);
          if (tracksAdded || isNew) {
            sendOffer(p.id, channelId);
          }
        } else if (isNew && String(user?.id || '') < String(p.id)) {
          sendOffer(p.id, channelId);
        }

        // Se o participante remoto estiver compartilhando tela e ainda não tivermos a faixa de vídeo dele,
        // solicita imediatamente o envio da transmissão ao transmissor
        if (p.isScreenSharing && (!existing?.screenTrack || existing.screenTrack.readyState !== 'live')) {
          socket.emit('request-screen-stream', {
            channelId,
            targetUserId: p.id,
            toUserId: p.id,
          });
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
      const { pc } = getOrCreatePeerConnection(peer.id, channelId);
      if (screenStreamRef.current) {
        ensureScreenTracksForPeer(peer.id, pc);
      }
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
        try {
          const boostedSdp = optimizeWebRtcSdp(answer.sdp, screenQualityRef.current);
          await pc.setLocalDescription({ type: answer.type, sdp: boostedSdp });
        } catch {
          await pc.setLocalDescription(answer);
        }

        const senders = screenSendersRef.current.get(fromUserId) || [];
        senders.forEach((s) => {
          if (s.track?.kind === 'video') {
            configureScreenVideoSender(pc, s, screenQualityRef.current);
          }
        });

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
      screenStreamId,
    }: {
      channelId: string;
      fromUserId: string;
      sdp: RTCSessionDescriptionInit;
      screenStreamId?: string | null;
    }) => {
      if (!currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      const pc = peersRef.current.get(fromUserId);
      if (!pc) return;

      const peerEntry = remoteParticipantsRef.current.get(fromUserId);
      if (peerEntry && screenStreamId !== undefined) {
        peerEntry.screenStreamId = screenStreamId;
        if (screenStreamId) {
          peerEntry.isScreenSharing = true;
        }
      }

      try {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const queued = pendingCandidatesRef.current.get(fromUserId) || [];
          for (const cand of queued) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingCandidatesRef.current.delete(fromUserId);

          const senders = screenSendersRef.current.get(fromUserId) || [];
          senders.forEach((s) => {
            if (s.track?.kind === 'video') {
              configureScreenVideoSender(pc, s, screenQualityRef.current);
            }
          });
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

    const handleRequestScreenStream = async (data: { channelId: string; fromUserId: string }) => {
      const channelId = data?.channelId;
      const fromUserId = data?.fromUserId;
      if (!fromUserId || !currentChannelRef.current || currentChannelRef.current.id !== channelId) return;
      if (!screenStreamRef.current) return;

      const { pc } = getOrCreatePeerConnection(fromUserId, channelId);
      ensureScreenTracksForPeer(fromUserId, pc);
      await sendOffer(fromUserId, channelId);
    };

    socket.on('voice-channel-updated', handleVoiceChannelUpdated);
    socket.on('voice-peer-joined', handleVoicePeerJoined);
    socket.on('voice-peer-left', handleVoicePeerLeft);
    socket.on('voice-user-state-updated', handleVoiceUserStateUpdated);
    socket.on('webrtc-offer', handleWebRTCOffer);
    socket.on('webrtc-answer', handleWebRTCAnswer);
    socket.on('webrtc-ice-candidate', handleWebRTCIceCandidate);
    socket.on('request-screen-stream', handleRequestScreenStream);

    return () => {
      socket.off('voice-channel-updated', handleVoiceChannelUpdated);
      socket.off('voice-peer-joined', handleVoicePeerJoined);
      socket.off('voice-peer-left', handleVoicePeerLeft);
      socket.off('voice-user-state-updated', handleVoiceUserStateUpdated);
      socket.off('webrtc-offer', handleWebRTCOffer);
      socket.off('webrtc-answer', handleWebRTCAnswer);
      socket.off('webrtc-ice-candidate', handleWebRTCIceCandidate);
      socket.off('request-screen-stream', handleRequestScreenStream);
    };
  }, [socket, user?.id, cleanupPeer, getOrCreatePeerConnection, sendOffer, syncVoiceState, ensureScreenTracksForPeer]);

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

    if (screenAudioCleanupRef.current) {
      screenAudioCleanupRef.current();
      screenAudioCleanupRef.current = null;
    }

    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach((t) => t.stop());
      rawMicStreamRef.current = null;
    }
    setRawAudioTrack(null);

    if (localMicStreamRef.current) {
      localMicStreamRef.current.getTracks().forEach((t) => t.stop());
      localMicStreamRef.current = null;
    }
    setLocalAudioTrack(null);

    if (micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
      try {
        micAudioCtxRef.current.close().catch(() => {});
      } catch {}
      micAudioCtxRef.current = null;
    }
    micGainNodeRef.current = null;
    vadGateGainNodeRef.current = null;

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);

    Array.from(peersRef.current.keys()).forEach((peerId) => cleanupPeer(peerId));
    remoteParticipantsRef.current.clear();

    remotePipelinesRef.current.forEach((pipeline) => {
      try {
        pipeline.source.disconnect();
        pipeline.gainNode.disconnect();
      } catch {}
    });
    remotePipelinesRef.current.clear();

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

  const lastMuteToggleRef = useRef<number>(0);
  const lastDeafenToggleRef = useRef<number>(0);

  const toggleMute = useCallback(() => {
    const now = Date.now();
    if (now - lastMuteToggleRef.current < 300) {
      return;
    }
    lastMuteToggleRef.current = now;

    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      if (localMicStreamRef.current) {
        localMicStreamRef.current.getAudioTracks().forEach((t) => {
          t.enabled = !next;
        });
      }
      if (vadGateGainNodeRef.current && micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
        try {
          if (next) {
            vadGateGainNodeRef.current.gain.setValueAtTime(0, micAudioCtxRef.current.currentTime);
          } else if (voiceActivationThresholdRef.current === 0) {
            vadGateGainNodeRef.current.gain.setTargetAtTime(1.0, micAudioCtxRef.current.currentTime, 0.008);
          }
        } catch {}
      }
      if (next) {
        isLocalSpeakingRef.current = false;
      }
      playAudioCue(next ? 'mute' : 'unmute');
      syncVoiceState();
      emitLocalVoiceState();
      return next;
    });
  }, [syncVoiceState, emitLocalVoiceState]);

  const toggleDeafen = useCallback(() => {
    const now = Date.now();
    if (now - lastDeafenToggleRef.current < 300) {
      return;
    }
    lastDeafenToggleRef.current = now;

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
      updateAllGainNodes();
      playAudioCue(next ? 'deafen' : 'undeafen');
      syncVoiceState();
      emitLocalVoiceState();
      return next;
    });
  }, [syncVoiceState, emitLocalVoiceState, updateAllGainNodes]);

  // Ouvintes de Moderação de Administrador (Desconexão forçada da chamada e Silenciamento no servidor)
  useEffect(() => {
    if (!socket) return;

    const handleForceDisconnectVoice = (data: { channelId?: string; reason?: string }) => {
      if (!currentChannelRef.current) return;
      if (!data?.channelId || data.channelId === currentChannelRef.current.id) {
        console.warn('[VoiceContext] Desconectado por administrador:', data?.reason);
        playAudioCue('mute');
        leaveVoiceChannel();
      }
    };

    const handleForceMuteMic = (data: { isMuted?: boolean }) => {
      const shouldMute = Boolean(data?.isMuted);
      if (shouldMute !== isMutedRef.current) {
        toggleMute();
      }
    };

    socket.on('force-disconnect-voice', handleForceDisconnectVoice);
    socket.on('force-mute-mic', handleForceMuteMic);

    return () => {
      socket.off('force-disconnect-voice', handleForceDisconnectVoice);
      socket.off('force-mute-mic', handleForceMuteMic);
    };
  }, [socket, leaveVoiceChannel, toggleMute]);

  const stopScreenShare = useCallback(() => {
    const ch = currentChannelRef.current;

    if (screenAudioCleanupRef.current) {
      screenAudioCleanupRef.current();
      screenAudioCleanupRef.current = null;
    }

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
    setSelectedScreenShareId((prev) => (prev === 'local-screen' ? null : prev));

    syncVoiceState();
    emitLocalVoiceState();
  }, [sendOffer, syncVoiceState, emitLocalVoiceState]);

  // Função unificada acionada pela hotkey (espectador ou streamer):
  // - Se for o streamer compartilhando sua própria tela, encerra a transmissão
  // - Se estiver assistindo a uma live em foco (espectador), sai da visualização e retorna à grade
  const handleStopOrExitStream = useCallback(() => {
    if (isScreenSharingRef.current) {
      stopScreenShare();
      setSelectedScreenShareId(null);
      return;
    }

    if (selectedScreenShareIdRef.current) {
      setSelectedScreenShareId(null);
    }
  }, [stopScreenShare]);

  // Sincronizar atalhos de teclado globais no Electron
  useEffect(() => {
    const registerHotkeys = (settings: UserAudioSettings) => {
      if (window.electronAPI?.registerGlobalHotkeys && settings.keybindings) {
        window.electronAPI.registerGlobalHotkeys({
          toggleMute: settings.keybindings.toggleMute,
          toggleDeafen: settings.keybindings.toggleDeafen,
          stopScreenShare: settings.keybindings.stopScreenShare,
        }).catch(() => {});
      }
    };

    registerHotkeys(getUserSettings());

    const unsubscribe = subscribeToSettingsChange((newSettings) => {
      registerHotkeys(newSettings);
    });

    return unsubscribe;
  }, []);

  // Ouvinte de disparo de atalhos globais via IPC do Electron
  useEffect(() => {
    if (!window.electronAPI?.onHotkeyTrigger) return;

    const unreg = window.electronAPI.onHotkeyTrigger((action: string) => {
      if (action === 'toggleMute') {
        toggleMute();
      } else if (action === 'toggleDeafen') {
        toggleDeafen();
      } else if (action === 'stopScreenShare') {
        handleStopOrExitStream();
      }
    });

    return unreg;
  }, [toggleMute, toggleDeafen, handleStopOrExitStream]);

  // Ouvinte de atalhos in-app via teclado (ativo em foco tanto na web quanto no Electron para resposta instantânea)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      const settings = getUserSettings();
      const muteKey = settings.keybindings?.toggleMute;
      const deafenKey = settings.keybindings?.toggleDeafen;
      const stopScreenKey = settings.keybindings?.stopScreenShare;

      const currentAcc = keyboardEventToAccelerator(e);
      if (!currentAcc) return;

      const hasModifiers = e.ctrlKey || e.metaKey || e.altKey;
      if (isInput && !hasModifiers) return;

      const matchesKey = (targetShortcut?: string): boolean => {
        if (!targetShortcut) return false;
        const normTarget = targetShortcut.trim().toLowerCase();
        const normAcc = (currentAcc || '').toLowerCase();
        const normCode = (e.code || '').toLowerCase();
        const normKey = (e.key || '').toLowerCase();
        if (normAcc === normTarget || normCode === normTarget || normKey === normTarget) return true;
        if (normTarget === 'shift' && (normCode === 'shiftleft' || normCode === 'shiftright')) return true;
        if (normTarget === 'shiftright' && normCode === 'shiftright') return true;
        if (normTarget === 'shiftleft' && normCode === 'shiftleft') return true;
        if ((normTarget === 'ctrl' || normTarget === 'control') && (normCode === 'controlleft' || normCode === 'controlright')) return true;
        if (normTarget === 'controlright' && normCode === 'controlright') return true;
        if (normTarget === 'controlleft' && normCode === 'controlleft') return true;
        if (normTarget === 'alt' && (normCode === 'altleft' || normCode === 'altright')) return true;
        if (normTarget === 'altright' && normCode === 'altright') return true;
        if (normTarget === 'altleft' && normCode === 'altleft') return true;
        return false;
      };

      if (matchesKey(muteKey)) {
        e.preventDefault();
        toggleMute();
      } else if (matchesKey(deafenKey)) {
        e.preventDefault();
        toggleDeafen();
      } else if (matchesKey(stopScreenKey)) {
        e.preventDefault();
        handleStopOrExitStream();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleMute, toggleDeafen, handleStopOrExitStream]);

  // Cria uma MediaStreamTrack de áudio 100% isolada via WASAPI Process Loopback:
  // - Ao compartilhar uma janela (window:HWND:0): captura APENAS o som daquele aplicativo (ex: Chrome/Opera/Jogo)
  // - Ao compartilhar a tela inteira (screen:0:0): captura o som do PC EXCLUINDO a árvore de processos do Xolas
  const createIsolatedProcessAudioTrack = useCallback(
    async (sourceId?: string): Promise<MediaStreamTrack | null> => {
      if (screenAudioCleanupRef.current) {
        screenAudioCleanupRef.current();
        screenAudioCleanupRef.current = null;
      }

      if (!window.electronAPI?.startProcessAudioCapture || !window.electronAPI?.onProcessAudioChunk) {
        return null;
      }

      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx: AudioContext = new AudioCtx({
          sampleRate: 48000,
          latencyHint: 'playback',
        });
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }

        const dest = audioCtx.createMediaStreamDestination();
        const silentOutGain = audioCtx.createGain();
        silentOutGain.gain.value = 0;
        silentOutGain.connect(audioCtx.destination);

        let leftover = new Uint8Array(0);
        let workletNode: AudioWorkletNode | null = null;
        let workletUrl: string | null = null;

        // Tentar inicializar AudioWorkletNode em thread de áudio dedicada (tempo real, zero interferência da UI/60fps)
        if (audioCtx.audioWorklet) {
          try {
            const workletCode = `
              class XolasLoopbackProcessor extends AudioWorkletProcessor {
                constructor() {
                  super();
                  this.RING_SIZE = 96000;
                  this.PREROLL_FRAMES = 3840;      // 80ms de pré-roll seguro contra jitter de IPC
                  this.MAX_BUFFERED_FRAMES = 14400; // 300ms teto máximo
                  this.TARGET_RESET_FRAMES = 5760;  // 120ms alvo de estabilização
                  this.CROSSFADE_LEN = 128;         // 2.66ms crossfade suave sem estalos
                  this.FADE_IN_LEN = 64;            // 1.33ms rampa de entrada suave

                  this.ringLeft = new Float32Array(this.RING_SIZE);
                  this.ringRight = new Float32Array(this.RING_SIZE);
                  this.writeIdx = 0;
                  this.readIdx = 0;
                  this.availableFrames = 0;
                  this.isPreRollDone = false;
                  this.lastL = 0;
                  this.lastR = 0;
                  this.fadeInRemaining = this.FADE_IN_LEN;
                  this.emptyTicks = 0;

                  this.port.onmessage = (e) => {
                    const data = e.data;
                    if (!data || !data.left || !data.right) return;
                    const left = data.left;
                    const right = data.right;
                    const len = left.length;

                    for (let i = 0; i < len; i++) {
                      this.ringLeft[this.writeIdx] = left[i];
                      this.ringRight[this.writeIdx] = right[i];
                      this.writeIdx = (this.writeIdx + 1) % this.RING_SIZE;
                    }

                    this.availableFrames += len;

                    if (this.availableFrames > this.MAX_BUFFERED_FRAMES) {
                      const excess = this.availableFrames - this.TARGET_RESET_FRAMES;
                      const newReadIdx = (this.readIdx + excess) % this.RING_SIZE;
                      // Aplicar crossfade linear de 128 amostras entre a posição antiga e a nova para zero pipocadas
                      for (let k = 0; k < this.CROSSFADE_LEN; k++) {
                        const alpha = k / this.CROSSFADE_LEN;
                        const oldIdx = (this.readIdx + k) % this.RING_SIZE;
                        const dstIdx = (newReadIdx + k) % this.RING_SIZE;
                        this.ringLeft[dstIdx] = this.ringLeft[oldIdx] * (1 - alpha) + this.ringLeft[dstIdx] * alpha;
                        this.ringRight[dstIdx] = this.ringRight[oldIdx] * (1 - alpha) + this.ringRight[dstIdx] * alpha;
                      }
                      this.readIdx = newReadIdx;
                      this.availableFrames = this.TARGET_RESET_FRAMES;
                    }

                    if (!this.isPreRollDone && this.availableFrames >= this.PREROLL_FRAMES) {
                      this.isPreRollDone = true;
                      this.fadeInRemaining = this.FADE_IN_LEN;
                    }
                  };
                }

                process(inputs, outputs) {
                  const output = outputs[0];
                  if (!output || output.length < 2) return true;
                  const outL = output[0];
                  const outR = output[1];
                  const framesNeeded = outL.length;

                  if (!this.isPreRollDone) {
                    for (let i = 0; i < framesNeeded; i++) {
                      outL[i] = 0;
                      outR[i] = 0;
                    }
                    return true;
                  }

                  for (let i = 0; i < framesNeeded; i++) {
                    if (this.availableFrames > 0) {
                      let sL = this.ringLeft[this.readIdx];
                      let sR = this.ringRight[this.readIdx];
                      this.readIdx = (this.readIdx + 1) % this.RING_SIZE;
                      this.availableFrames--;
                      this.emptyTicks = 0;

                      if (this.fadeInRemaining > 0) {
                        const gain = (this.FADE_IN_LEN - this.fadeInRemaining) / this.FADE_IN_LEN;
                        sL *= gain;
                        sR *= gain;
                        this.fadeInRemaining--;
                      }

                      outL[i] = sL;
                      outR[i] = sR;
                      this.lastL = sL;
                      this.lastR = sR;
                    } else {
                      // Underrun momentâneo: decaimento suave exponencial em vez de degrau abrupto para 0.0
                      this.lastL *= 0.95;
                      this.lastR *= 0.95;
                      if (Math.abs(this.lastL) < 1e-5) this.lastL = 0;
                      if (Math.abs(this.lastR) < 1e-5) this.lastR = 0;
                      outL[i] = this.lastL;
                      outR[i] = this.lastR;
                      this.fadeInRemaining = this.FADE_IN_LEN;
                      this.emptyTicks++;
                      // Se ficar mais de 80ms sem receber pacotes (silêncio real do app), rearmar pré-roll
                      if (this.emptyTicks > 3840) {
                        this.isPreRollDone = false;
                        this.emptyTicks = 0;
                      }
                    }
                  }
                  return true;
                }
              }
              registerProcessor('xolas-loopback-worklet', XolasLoopbackProcessor);
            `;
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            workletUrl = URL.createObjectURL(blob);
            await audioCtx.audioWorklet.addModule(workletUrl);
            workletNode = new AudioWorkletNode(audioCtx, 'xolas-loopback-worklet', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [2],
            });
            workletNode.connect(dest);
            workletNode.connect(silentOutGain);
          } catch (workletErr) {
            console.warn('[WASAPI] AudioWorklet indisponível, usando fallback suavizado:', workletErr);
            workletNode = null;
          }
        }

        // Fallback suavizado caso AudioWorklet não esteja disponível
        const RING_SIZE = 96000;
        const PREROLL_FRAMES = 3840;
        const MAX_BUFFERED_FRAMES = 14400;
        const TARGET_RESET_FRAMES = 5760;
        const CROSSFADE_LEN = 128;
        const FADE_IN_LEN = 64;
        const ringLeft = new Float32Array(RING_SIZE);
        const ringRight = new Float32Array(RING_SIZE);
        let writeIdx = 0;
        let readIdx = 0;
        let availableFrames = 0;
        let isPreRollDone = false;
        let lastL = 0;
        let lastR = 0;
        let fadeInRemaining = FADE_IN_LEN;

        const removeChunkListener = window.electronAPI.onProcessAudioChunk((rawChunk: Uint8Array) => {
          const chunk =
            rawChunk instanceof Uint8Array
              ? rawChunk
              : new Uint8Array((rawChunk as any).buffer || rawChunk);

          let combined: Uint8Array;
          if (leftover.byteLength > 0) {
            combined = new Uint8Array(leftover.byteLength + chunk.byteLength);
            combined.set(leftover, 0);
            combined.set(chunk, leftover.byteLength);
          } else {
            combined = chunk;
          }

          const totalBytes = combined.byteLength;
          const usableFrames = Math.floor(totalBytes / 4);
          const remBytes = totalBytes % 4;

          if (remBytes > 0) {
            leftover = combined.slice(totalBytes - remBytes);
          } else if (leftover.byteLength > 0) {
            leftover = new Uint8Array(0);
          }

          if (usableFrames <= 0) return;

          const view = new DataView(
            combined.buffer,
            combined.byteOffset,
            usableFrames * 4
          );

          if (workletNode) {
            const leftArr = new Float32Array(usableFrames);
            const rightArr = new Float32Array(usableFrames);
            for (let i = 0; i < usableFrames; i++) {
              leftArr[i] = view.getInt16(i * 4, true) / 32768.0;
              rightArr[i] = view.getInt16(i * 4 + 2, true) / 32768.0;
            }
            workletNode.port.postMessage(
              { left: leftArr, right: rightArr },
              [leftArr.buffer, rightArr.buffer]
            );
            return;
          }

          for (let i = 0; i < usableFrames; i++) {
            ringLeft[writeIdx] = view.getInt16(i * 4, true) / 32768.0;
            ringRight[writeIdx] = view.getInt16(i * 4 + 2, true) / 32768.0;
            writeIdx = (writeIdx + 1) % RING_SIZE;
          }

          availableFrames += usableFrames;
          if (availableFrames > MAX_BUFFERED_FRAMES) {
            const excess = availableFrames - TARGET_RESET_FRAMES;
            const newReadIdx = (readIdx + excess) % RING_SIZE;
            for (let k = 0; k < CROSSFADE_LEN; k++) {
              const alpha = k / CROSSFADE_LEN;
              const oldIdx = (readIdx + k) % RING_SIZE;
              const dstIdx = (newReadIdx + k) % RING_SIZE;
              ringLeft[dstIdx] = ringLeft[oldIdx] * (1 - alpha) + ringLeft[dstIdx] * alpha;
              ringRight[dstIdx] = ringRight[oldIdx] * (1 - alpha) + ringRight[dstIdx] * alpha;
            }
            readIdx = newReadIdx;
            availableFrames = TARGET_RESET_FRAMES;
          }

          if (!isPreRollDone && availableFrames >= PREROLL_FRAMES) {
            isPreRollDone = true;
            fadeInRemaining = FADE_IN_LEN;
          }
        });

        const res = await window.electronAPI.startProcessAudioCapture(sourceId);
        if (!res?.started) {
          removeChunkListener();
          if (workletUrl) URL.revokeObjectURL(workletUrl);
          audioCtx.close().catch(() => {});
          return null;
        }

        let osc: OscillatorNode | null = null;
        let silentInGain: GainNode | null = null;
        let scriptNode: ScriptProcessorNode | null = null;

        if (!workletNode) {
          osc = audioCtx.createOscillator();
          silentInGain = audioCtx.createGain();
          silentInGain.gain.value = 0;
          osc.connect(silentInGain);
          osc.start();

          scriptNode = audioCtx.createScriptProcessor(1024, 2, 2);
          scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
            const outL = e.outputBuffer.getChannelData(0);
            const outR = e.outputBuffer.getChannelData(1);
            const framesNeeded = outL.length;

            if (!isPreRollDone) {
              for (let i = 0; i < framesNeeded; i++) {
                outL[i] = 0;
                outR[i] = 0;
              }
              return;
            }

            for (let i = 0; i < framesNeeded; i++) {
              if (availableFrames > 0) {
                let sL = ringLeft[readIdx];
                let sR = ringRight[readIdx];
                readIdx = (readIdx + 1) % RING_SIZE;
                availableFrames--;

                if (fadeInRemaining > 0) {
                  const gain = (FADE_IN_LEN - fadeInRemaining) / FADE_IN_LEN;
                  sL *= gain;
                  sR *= gain;
                  fadeInRemaining--;
                }

                outL[i] = sL;
                outR[i] = sR;
                lastL = sL;
                lastR = sR;
              } else {
                lastL *= 0.95;
                lastR *= 0.95;
                outL[i] = lastL;
                outR[i] = lastR;
                fadeInRemaining = FADE_IN_LEN;
              }
            }
          };

          silentInGain.connect(scriptNode);
          scriptNode.connect(dest);
          scriptNode.connect(silentOutGain);
        }

        const track = dest.stream.getAudioTracks()[0] || null;
        if (track) {
          try {
            (track as any).contentHint = 'music';
          } catch {}
        }

        screenAudioCleanupRef.current = () => {
          try {
            removeChunkListener();
          } catch {}
          try {
            window.electronAPI?.stopProcessAudioCapture?.();
          } catch {}
          try {
            if (workletNode) {
              workletNode.port.onmessage = null;
              workletNode.disconnect();
            }
            if (workletUrl) {
              URL.revokeObjectURL(workletUrl);
            }
            if (scriptNode) {
              scriptNode.onaudioprocess = null;
              scriptNode.disconnect();
            }
            if (silentInGain) silentInGain.disconnect();
            if (osc) osc.stop();
            silentOutGain.disconnect();
          } catch {}
          try {
            audioCtx.close().catch(() => {});
          } catch {}
        };

        return track;
      } catch (err) {
        console.warn('[WASAPI] Erro ao criar faixa de áudio isolada por processo:', err);
        return null;
      }
    },
    []
  );

  const startScreenShare = useCallback(
    async (sourceId?: string, quality?: ScreenQualityOptions) => {
      try {
        const activeQuality = quality || { resolution: '1080p', fps: 60, includeAudio: true };
        screenQualityRef.current = activeQuality;
        setScreenQuality(activeQuality);

        const is1080 = activeQuality.resolution === '1080p';
        const width = is1080 ? 1920 : 1280;
        const height = is1080 ? 1080 : 720;
        const fps = activeQuality.fps;
        const includeAudio = activeQuality.includeAudio !== false;

        // Encerrar captura de áudio de tela anterior antes de iniciar nova
        if (screenAudioCleanupRef.current) {
          screenAudioCleanupRef.current();
          screenAudioCleanupRef.current = null;
        }

        let stream: MediaStream;

        if (sourceId && window.electronAPI) {
          const isWindow = sourceId.startsWith('window:');

          const videoMandatory: any = {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxFrameRate: fps,
            minFrameRate: Math.min(30, fps),
          };

          if (!isWindow) {
            videoMandatory.maxWidth = width;
            videoMandatory.maxHeight = height;
          }

          try {
            // IMPORTANTE: Capturar SOMENTE o vídeo via desktopCapturer (audio: false),
            // pois o loopback padrão do Chromium captura o endpoint global do Windows e vaza as vozes do Xolas.
            // O áudio isolado por processo (WASAPI Process Loopback) é anexado logo abaixo!
            stream = await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: {
                mandatory: videoMandatory,
                optional: isWindow
                  ? [{ maxWidth: width }, { maxHeight: height }, { googCpuOveruseDetection: false }]
                  : [{ googCpuOveruseDetection: false }],
              },
            });
          } catch (errWindow) {
            console.warn('Captura de vídeo com maxFrameRate falhou, tentando constraints simplificados:', errWindow);
            stream = await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: sourceId,
                },
                optional: [
                  { maxWidth: width },
                  { maxHeight: height },
                  { googCpuOveruseDetection: false },
                ],
              },
            });
          }

          if (includeAudio) {
            const isolatedAudioTrack = await createIsolatedProcessAudioTrack(sourceId);
            if (isolatedAudioTrack) {
              try {
                (isolatedAudioTrack as any).contentHint = 'music';
              } catch {}
              stream.addTrack(isolatedAudioTrack);
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

        // Parar stream anterior se estiver trocando de janela/tela
        if (screenStreamRef.current && screenStreamRef.current.id !== stream.id) {
          screenStreamRef.current.getTracks().forEach((t) => {
            t.onended = null;
            t.stop();
          });
        }

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            // Priorizar fluidez de movimento (60 FPS constantes em jogos 3D) em vez de travar frames
            (videoTrack as any).contentHint = 'motion';
          } catch {}
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
              if (track.kind === 'video') {
                configureScreenVideoSender(pc, sender, activeQuality);
              } else if (track.kind === 'audio') {
                configureScreenAudioSender(sender);
              }
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
    [
      stopScreenShare,
      createIsolatedProcessAudioTrack,
      syncVoiceState,
      emitLocalVoiceState,
      sendOffer,
      configureScreenVideoSender,
      configureScreenAudioSender,
    ]
  );

  const watchScreenShare = useCallback(
    (shareId: string) => {
      setSelectedScreenShareId(shareId);
      const targetUserId = shareId.replace(/^screen-/, '');
      const ch = currentChannelRef.current;
      if (socket && ch && targetUserId && targetUserId !== user?.id && targetUserId !== 'local-screen') {
        const peerData = remoteParticipantsRef.current.get(targetUserId);
        if (!peerData?.screenTrack || peerData.screenTrack.readyState !== 'live') {
          socket.emit('request-screen-stream', {
            channelId: ch.id,
            targetUserId,
            toUserId: targetUserId,
          });
        }
      }
    },
    [socket, user?.id]
  );

  const stopWatchingScreenShare = useCallback(() => {
    setSelectedScreenShareId(null);
  }, []);

  const setUserVolume = useCallback((userId: string, volume: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    setUserVolumes((prev) => {
      const updated = { ...prev, [userId]: clamped };
      userVolumesRef.current = updated;
      try {
        localStorage.setItem('xolas_user_volumes', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    applyGainToPeer(userId);
  }, [applyGainToPeer]);

  const toggleMuteUser = useCallback((userId: string) => {
    setUserMuted((prev) => {
      const next = !prev[userId];
      const updated = { ...prev, [userId]: next };
      userMutedRef.current = updated;
      try {
        localStorage.setItem('xolas_user_muted', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    applyGainToPeer(userId);
  }, [applyGainToPeer]);

  const getUserVolume = useCallback((userId: string): number => {
    return userVolumesRef.current[userId] ?? 100;
  }, []);

  const isUserMuted = useCallback((userId: string): boolean => {
    return Boolean(userMutedRef.current[userId]);
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
        rawAudioTrack,
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
        voiceActivationThreshold,
        setVoiceActivationThreshold,
        updateScreenQualityPreset,
        voiceParticipants,
        activeScreenShares,
        selectedScreenShareId,
        setSelectedScreenShareId,
        watchScreenShare,
        stopWatchingScreenShare,
        userVolumes,
        userMuted,
        setUserVolume,
        toggleMuteUser,
        getUserVolume,
        isUserMuted,
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

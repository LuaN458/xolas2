import React from 'react';
import { MicOff, Monitor } from 'lucide-react';

interface ParticipantTileProps {
  name: string;
  avatarUrl?: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isScreenShare?: boolean;
  hasScreenShare?: boolean;
  onWatchScreenShare?: () => void;
  videoTrack?: MediaStreamTrack;
  stream?: MediaStream | null;
  volume?: number; // 0 a 100
  isLocal?: boolean;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  name,
  avatarUrl,
  isSpeaking = false,
  isMuted = false,
  isScreenShare = false,
  hasScreenShare = false,
  onWatchScreenShare,
  videoTrack,
  stream,
  volume = 100,
  isLocal = false,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  const audioTrackCount = stream ? stream.getAudioTracks().length : 0;

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (isLocal) {
      el.muted = true;
    } else {
      el.muted = volume === 0;
      el.volume = Math.max(0, Math.min(1, volume / 100));
    }

    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch(() => {});
    } else if (videoTrack) {
      const currentObj = el.srcObject as MediaStream | null;
      const existingTrack = currentObj?.getVideoTracks()[0];
      if (existingTrack !== videoTrack) {
        el.srcObject = new MediaStream([videoTrack]);
      }
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, videoTrack, audioTrackCount, isLocal, volume]);

  const hasVideo = stream ? stream.getVideoTracks().length > 0 : Boolean(videoTrack);

  return (
    <div
      className={`relative bg-obsidian-card rounded-xl overflow-hidden flex flex-col items-center justify-center min-h-[160px] w-full ${
        isScreenShare ? 'h-full' : 'aspect-video'
      } border ${
        hasScreenShare ? 'border-indigo-500/60 shadow-lg shadow-indigo-500/10' : 'border-obsidian-border'
      } shadow-lg group`}
    >
      {/* Badge AO VIVO no canto superior direito para transmissões ativas */}
      {hasScreenShare && !isScreenShare && (
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center space-x-1 px-2 py-0.5 rounded-md bg-indigo-600/90 text-white text-[10px] font-bold tracking-wider uppercase shadow-md shadow-indigo-600/40 border border-indigo-400/40 animate-pulse">
          <Monitor className="w-3 h-3 text-indigo-200 shrink-0" />
          <span>Ao Vivo</span>
        </div>
      )}

      {/* Botão de Assistir Transmissão no hover para espectadores */}
      {hasScreenShare && onWatchScreenShare && !isLocal && !isScreenShare && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20 p-4">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onWatchScreenShare();
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xl shadow-indigo-600/40 flex items-center space-x-2 transition-all transform hover:scale-105 active:scale-95 border border-indigo-400/50"
          >
            <Monitor className="w-3.5 h-3.5" />
            <span>Assistir Transmissão</span>
          </button>
        </div>
      )}
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal || volume === 0}
          onLoadedMetadata={(e) => {
            e.currentTarget.play().catch(() => {});
          }}
          className="w-full h-full object-contain bg-black"
        />
      ) : (
        <div className="flex flex-col items-center justify-center p-4">
          <div
            className={`relative rounded-xl transition-all duration-200 ${
              isSpeaking
                ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-obsidian-card shadow-lg shadow-emerald-500/20 scale-105'
                : ''
            }`}
          >
            <img
              src={avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`}
              alt={name}
              className="w-16 h-16 rounded-xl bg-obsidian-surface border border-obsidian-border"
            />
          </div>
        </div>
      )}

      {/* Identificação inferior sutil */}
      <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-md flex items-center space-x-1.5 text-[11px] text-white border border-white/10 max-w-[85%]">
        {isScreenShare && <Monitor className="w-3 h-3 text-emerald-400 shrink-0" />}
        <span className="truncate font-medium">{name}</span>
        {isMuted && <MicOff className="w-3 h-3 text-obsidian-rose shrink-0" />}
      </div>
    </div>
  );
};

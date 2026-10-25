import React from 'react';
import { MicOff, Monitor } from 'lucide-react';

interface ParticipantTileProps {
  name: string;
  avatarUrl?: string;
  isSpeaking?: boolean;
  isMuted?: boolean;
  isScreenShare?: boolean;
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
  videoTrack,
  stream,
  volume = 100,
  isLocal = false,
}) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

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
  }, [stream, videoTrack]);

  React.useEffect(() => {
    if (videoRef.current) {
      if (isLocal) {
        // Se for transmissão local, mutar a reprodução do próprio elemento para evitar eco acústico
        videoRef.current.muted = true;
      } else {
        videoRef.current.muted = volume === 0;
        videoRef.current.volume = Math.max(0, Math.min(1, volume / 100));
      }
    }
  }, [volume, isLocal]);

  const hasVideo = stream ? stream.getVideoTracks().length > 0 : Boolean(videoTrack);

  return (
    <div
      className={`relative bg-obsidian-card rounded-xl overflow-hidden flex flex-col items-center justify-center min-h-[160px] w-full ${
        isScreenShare ? 'h-full' : 'aspect-video'
      } border border-obsidian-border shadow-lg group`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
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

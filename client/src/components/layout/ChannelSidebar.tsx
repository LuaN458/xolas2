import React, { useState } from 'react';
import { MessageSquareText, Radio, Plus, PhoneOff, Monitor, ChevronDown, Volume2, MicOff } from 'lucide-react';
import { Server, Channel } from '../../types';
import { useVoice } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { UserAudioContextMenu } from '../voice/UserAudioContextMenu';

export interface VoiceParticipantInfo {
  id: string;
  username: string;
  avatarUrl?: string;
  isScreenSharing?: boolean;
  isMuted?: boolean;
  isSpeaking?: boolean;
  screenStreamId?: string | null;
}

interface ChannelSidebarProps {
  server: Server | null;
  activeChannelId: string | null;
  voiceParticipants?: Record<string, VoiceParticipantInfo[]>;
  onSelectChannel: (channel: Channel) => void;
  onDisconnectVoice?: () => void;
  onOpenCreateChannelModal: (type: 'TEXT' | 'VOICE') => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  server,
  activeChannelId,
  voiceParticipants = {},
  onSelectChannel,
  onDisconnectVoice,
  onOpenCreateChannelModal,
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const {
    currentVoiceChannel,
    leaveVoiceChannel,
    isScreenSharing,
    isMuted,
    voiceParticipants: livekitParticipants,
    activeScreenShares,
    getUserVolume,
    isUserMuted,
    setUserVolume,
    toggleMuteUser,
    watchScreenShare,
  } = useVoice();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    userId: string;
    username: string;
    avatarUrl?: string;
    hasScreenShare?: boolean;
    shareId?: string;
    channel: Channel;
  } | null>(null);

  const handleParticipantContextMenu = (
    e: React.MouseEvent,
    p: VoiceParticipantInfo,
    channel: Channel,
    hasScreenShare: boolean,
    shareId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Não abre menu de ajuste para si mesmo
    if (p.id === user?.id) return;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      userId: p.id,
      username: p.username,
      avatarUrl: p.avatarUrl,
      hasScreenShare,
      shareId,
      channel,
    });
  };

  if (!server) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-obsidian-text-muted select-none w-full">
        <p className="text-xs">Selecione ou crie um espaço na barra lateral.</p>
      </div>
    );
  }

  const textChannels = server.channels.filter((c) => c.type === 'TEXT');
  const voiceChannels = server.channels.filter((c) => c.type === 'VOICE');

  return (
    <div className="flex-1 min-h-0 flex flex-col select-none w-full overflow-hidden">
      {/* Cabeçalho do Espaço de Trabalho */}
      <header className="h-13 border-b border-obsidian-border px-4 py-3 flex items-center justify-between font-semibold text-obsidian-text-primary hover:bg-obsidian-hover/40 cursor-pointer transition-colors">
        <div className="flex items-center space-x-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-obsidian-accent shadow-sm shadow-obsidian-accent" />
          <span className="truncate text-sm font-semibold tracking-tight">{server.name}</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 text-obsidian-text-muted" />
      </header>

      {/* Lista de Canais */}
      <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5">
        {/* Canais de Texto */}
        <div>
          <div className="flex items-center justify-between px-2 text-[10px] font-bold text-obsidian-text-muted tracking-wider uppercase mb-2">
            <span>Discussões</span>
            <button
              onClick={() => onOpenCreateChannelModal('TEXT')}
              className="p-1 rounded-lg bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary hover:text-white hover:border-obsidian-border-light transition-all shadow-sm"
              title="Nova discussão"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            {textChannels.map((channel) => {
              const isActive = activeChannelId === channel.id;
              return (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel)}
                  className={`w-full flex items-center px-2.5 py-1.5 rounded-xl text-xs transition-all group ${
                    isActive
                      ? 'bg-obsidian-card text-white font-semibold border border-obsidian-border shadow-sm border-l-2 border-l-indigo-500'
                      : 'text-obsidian-text-secondary hover:bg-obsidian-card/60 hover:text-white'
                  }`}
                >
                  <MessageSquareText
                    className={`w-3.5 h-3.5 mr-2 shrink-0 ${
                      isActive ? 'text-indigo-400' : 'text-obsidian-text-muted group-hover:text-obsidian-text-secondary'
                    }`}
                  />
                  <span className="truncate">{channel.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Canais de Voz & Transmissão com Contagem e Usuários */}
        <div>
          <div className="flex items-center justify-between px-2 text-[10px] font-bold text-obsidian-text-muted tracking-wider uppercase mb-2">
            <span>Salas de Áudio & Vídeo</span>
            <button
              onClick={() => onOpenCreateChannelModal('VOICE')}
              className="p-1 rounded-lg bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary hover:text-white hover:border-obsidian-border-light transition-all shadow-sm"
              title="Nova sala de voz"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5">
            {voiceChannels.map((channel) => {
              const isConnected = currentVoiceChannel?.id === channel.id;

              // Unificar lista de participantes combinando Socket.io + LiveKit WebRTC + Usuário Local
              const participantMap = new Map<string, VoiceParticipantInfo>();
              (voiceParticipants[channel.id] || []).forEach((p) => {
                participantMap.set(p.id, p);
              });

              if (isConnected) {
                if (user) {
                  participantMap.set(user.id, {
                    id: user.id,
                    username: user.username,
                    avatarUrl: user.avatarUrl,
                  });
                }
                livekitParticipants.forEach((lp) => {
                  participantMap.set(lp.id, {
                    id: lp.id,
                    username: lp.username,
                    avatarUrl: lp.avatarUrl,
                  });
                });
              }

              const participants = Array.from(participantMap.values());
              const count = participants.length;

              return (
                <div key={channel.id} className="flex flex-col">
                  {/* Botão do Canal com Contagem e Indicador Luminoso */}
                  <button
                    onClick={() => onSelectChannel(channel)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
                      isConnected
                        ? 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)] ring-1 ring-emerald-500/20'
                        : 'text-obsidian-text-secondary hover:bg-obsidian-card/60 hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center min-w-0 space-x-2">
                      {isConnected ? (
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse shrink-0" />
                      ) : (
                        <Radio className="w-3.5 h-3.5 text-obsidian-text-muted group-hover:text-obsidian-text-secondary shrink-0" />
                      )}
                      <span className="truncate tracking-tight font-bold text-white">{channel.name}</span>
                    </div>

                    {/* Badge com a contagem de usuários */}
                    {count > 0 && (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold leading-none ${
                          isConnected
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                            : 'bg-obsidian-card text-obsidian-text-muted border border-obsidian-border'
                        }`}
                        title={`${count} conectado(s)`}
                      >
                        {count}
                      </span>
                    )}
                  </button>

                  {/* Árvore de Conexão Lateral (Tree Line) e Lista de Usuários Conectados */}
                  {count > 0 && (
                    <div className="relative ml-4 pl-3 my-1 space-y-1 border-l-2 border-emerald-500/25">
                      {participants.map((p) => {
                        const isMe = p.id === user?.id;
                        const isStreaming = Boolean(
                          (isMe && isScreenSharing) ||
                          activeScreenShares.some((s) => !s.isLocal && s.id.includes(p.id)) ||
                          livekitParticipants.some((lp) => lp.id === p.id && lp.screenTrack) ||
                          p.isScreenSharing
                        );
                        const matchedShare = activeScreenShares.find((s) => !s.isLocal && s.id.includes(p.id));
                        const shareId = matchedShare ? matchedShare.id : (p.screenStreamId || `screen-${p.id}`);

                        return (
                          <div
                            key={p.id}
                            onContextMenu={(e) => handleParticipantContextMenu(e, p, channel, isStreaming, shareId)}
                            onClick={() => {
                              if (!isMe && isStreaming) {
                                onSelectChannel(channel);
                                watchScreenShare(shareId);
                              } else {
                                onSelectChannel(channel);
                              }
                            }}
                            className="group flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-white/[0.06] text-xs transition-all cursor-pointer space-x-2"
                            title={isMe ? p.username : `${p.username} - Botão direito para opções`}
                          >
                            <div className="flex items-center min-w-0 flex-1 space-x-2">
                              <div className="relative shrink-0">
                                <img
                                  src={
                                    p.avatarUrl ||
                                    `https://api.dicebear.com/7.x/bottts/svg?seed=${p.username}`
                                  }
                                  alt={p.username}
                                  className="w-6 h-6 rounded-lg bg-obsidian-card border border-emerald-500/40 shadow-sm shrink-0"
                                />
                                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-obsidian-bg shadow-[0_0_6px_#10b981]" />
                              </div>

                              <div className="flex items-center min-w-0 flex-1 overflow-hidden">
                                <span className="truncate font-semibold text-white text-xs">
                                  {p.username}
                                </span>
                                {isMe && (
                                  <span className="ml-1 text-[10px] text-emerald-400/80 font-mono font-bold shrink-0">
                                    (você)
                                  </span>
                                )}
                              </div>

                              {isStreaming && (
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[9px] font-bold tracking-wider flex items-center space-x-1 animate-pulse hover:bg-indigo-500/30 transition-colors"
                                  title="Clique para assistir"
                                >
                                  <Monitor className="w-2.5 h-2.5 shrink-0" />
                                  <span>AO VIVO</span>
                                </span>
                              )}
                            </div>

                            {/* Indicador de Áudio Dinâmico */}
                            <div className="shrink-0 flex items-center pl-1">
                              {isMe && isMuted ? (
                                <span title="Microfone mutado">
                                  <MicOff className="w-3.5 h-3.5 text-obsidian-rose" />
                                </span>
                              ) : (
                                <div className="flex items-end space-x-0.5 h-3 px-0.5" title="Áudio ativo">
                                  <span className="w-0.5 bg-emerald-400 rounded-full h-2.5 animate-pulse" />
                                  <span className="w-0.5 bg-emerald-400 rounded-full h-1.5 animate-pulse [animation-delay:150ms]" />
                                  <span className="w-0.5 bg-emerald-400 rounded-full h-3 animate-pulse [animation-delay:300ms]" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card Flutuante de Conexão de Áudio (Linear Style) */}
      {currentVoiceChannel && (
        <div className="m-2.5 p-2.5 rounded-xl bg-obsidian-card border border-emerald-500/30 shadow-lg shadow-black/40 flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981] animate-pulse" />
            <div className="min-w-0 flex flex-col">
              <span className="text-[11px] font-semibold text-emerald-400 truncate leading-tight">
                Voz Conectada
              </span>
              <span className="text-[10px] text-obsidian-text-muted truncate leading-tight">
                {currentVoiceChannel.name}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            {isScreenSharing && (
              <span className="text-emerald-400 p-1" title="Transmitindo Tela">
                <Monitor className="w-3.5 h-3.5" />
              </span>
            )}
            <button
              onClick={() => {
                leaveVoiceChannel();
                onDisconnectVoice?.();
              }}
              className="p-1.5 text-obsidian-text-muted hover:text-obsidian-rose hover:bg-obsidian-rose/10 rounded-lg transition-colors"
              title="Desconectar"
            >
              <PhoneOff className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Menu de Contexto do Usuário na Barra Lateral */}
      {contextMenu && (
        <UserAudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={contextMenu.userId}
          username={contextMenu.username}
          avatarUrl={contextMenu.avatarUrl}
          volume={getUserVolume(contextMenu.userId)}
          isMuted={isUserMuted(contextMenu.userId)}
          hasScreenShare={contextMenu.hasScreenShare}
          isAdmin={Boolean(user?.role === 'ADMIN' || user?.customRole?.permissions?.some((p) => ['disconnect_voice', 'server_mute'].includes(p)))}
          isServerMuted={
            voiceParticipants[contextMenu.channel.id]?.find((p) => p.id === contextMenu.userId)?.isMuted ?? false
          }
          onDisconnectVoice={
            user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('disconnect_voice')
              ? () => {
                  socket?.emit('admin:disconnect-voice', {
                    targetUserId: contextMenu.userId,
                    channelId: contextMenu.channel.id,
                    serverId: server.id,
                  });
                }
              : undefined
          }
          onToggleServerMute={
            user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('server_mute')
              ? () => {
                  const currentMuted =
                    voiceParticipants[contextMenu.channel.id]?.find((p) => p.id === contextMenu.userId)?.isMuted ?? false;
                  socket?.emit('admin:server-mute-voice', {
                    targetUserId: contextMenu.userId,
                    channelId: contextMenu.channel.id,
                    serverId: server.id,
                    isMuted: !currentMuted,
                  });
                }
              : undefined
          }
          onWatchScreenShare={
            contextMenu.hasScreenShare
              ? () => {
                  onSelectChannel(contextMenu.channel);
                  watchScreenShare(contextMenu.shareId || `screen-${contextMenu.userId}`);
                  setContextMenu(null);
                }
              : undefined
          }
          onVolumeChange={(newVol) => setUserVolume(contextMenu.userId, newVol)}
          onToggleMute={() => toggleMuteUser(contextMenu.userId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

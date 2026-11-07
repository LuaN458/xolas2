import React, { useState, useRef, useEffect } from 'react';
import {
  Hash,
  Volume2,
  Plus,
  ChevronDown,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Settings,
  LogOut,
  Monitor,
  Check,
} from 'lucide-react';
import { Server, Channel, CustomRole } from '../../types';
import { useVoice } from '../../contexts/VoiceContext';
import { useAuth } from '../../contexts/AuthContext';
import { UserAudioContextMenu } from '../voice/UserAudioContextMenu';

export interface VoiceParticipantInfo {
  id: string;
  username: string;
  avatarUrl?: string;
  isScreenSharing?: boolean;
  isMuted?: boolean;
  isDeafened?: boolean;
  isSpeaking?: boolean;
  screenStreamId?: string | null;
}

interface ChannelSidebarProps {
  server: Server | null;
  servers?: Server[];
  activeChannelId: string | null;
  voiceParticipants?: Record<string, VoiceParticipantInfo[]>;
  onSelectChannel: (channel: Channel) => void;
  onDisconnectVoice?: () => void;
  onOpenCreateChannelModal: (type: 'TEXT' | 'VOICE') => void;
  roles?: CustomRole[];
  onAssignCustomRole?: (userId: string, customRoleId: string | null) => Promise<void>;
  onSelectServer?: (serverId: string) => void;
  onOpenCreateServerModal?: () => void;
  onOpenSettings?: () => void;
  onOpenCommandPalette?: () => void;
}

export const ChannelSidebar: React.FC<ChannelSidebarProps> = ({
  server,
  servers = [],
  activeChannelId,
  voiceParticipants = {},
  onSelectChannel,
  onDisconnectVoice,
  onOpenCreateChannelModal,
  roles = [],
  onAssignCustomRole,
  onSelectServer,
  onOpenCreateServerModal,
  onOpenSettings,
  onOpenCommandPalette,
}) => {
  const { user, logout } = useAuth();
  const {
    currentVoiceChannel,
    leaveVoiceChannel,
    isScreenSharing,
    isMuted,
    isDeafened,
    toggleDeafen,
    toggleMute,
    voiceParticipants: livekitParticipants,
    activeScreenShares,
    getUserVolume,
    isUserMuted,
    setUserVolume,
    toggleMuteUser,
    watchScreenShare,
  } = useVoice();

  const [isServerDropdownOpen, setIsServerDropdownOpen] = useState(false);
  const serverDropdownRef = useRef<HTMLDivElement>(null);

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

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (serverDropdownRef.current && !serverDropdownRef.current.contains(e.target as Node)) {
        setIsServerDropdownOpen(false);
      }
    };
    if (isServerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isServerDropdownOpen]);

  const handleParticipantContextMenu = (
    e: React.MouseEvent,
    p: VoiceParticipantInfo,
    channel: Channel,
    hasScreenShare: boolean,
    shareId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();

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

  const textChannels = server?.channels.filter((c) => c.type === 'TEXT') || [];
  const voiceChannels = server?.channels.filter((c) => c.type === 'VOICE') || [];

  const serverInitials = server
    ? server.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase()
    : 'X';

  return (
    <aside className="w-64 border-r border-zinc-800 bg-zinc-950 flex flex-col shrink-0 z-10 select-none h-full relative">
      {/* 1. SELETOR DE WORKSPACE COMPACTO (Estilo Linear / Monolith) */}
      <div className="relative" ref={serverDropdownRef}>
        <div
          onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
          className="h-12 px-3 border-b border-zinc-800 flex items-center justify-between hover:bg-zinc-900 cursor-pointer transition-colors"
          title="Clique para alternar espaços de trabalho ou criar novo"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {server?.iconUrl ? (
              <img
                src={server.iconUrl}
                alt={server.name}
                className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 object-cover shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center font-bold text-xs text-zinc-100 shrink-0">
                {serverInitials}
              </div>
            )}
            <div className="flex flex-col text-left min-w-0">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1 truncate">
                <span className="truncate">{server ? server.name : 'Selecionar Espaço'}</span>
                <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
              </span>
              <span className="text-[10px] text-zinc-400 font-mono truncate">xolas.workspace</span>
            </div>
          </div>
          {onOpenCommandPalette && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenCommandPalette();
              }}
              className="text-[10px] text-zinc-400 font-mono bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 hover:text-zinc-200 shrink-0"
              title="Abrir Command Palette (Ctrl+K)"
            >
              ⌘K
            </button>
          )}
        </div>

        {/* Dropdown Popover de Espaços */}
        {isServerDropdownOpen && (
          <div className="absolute top-13 left-2 right-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 space-y-1">
            <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider font-mono">
              Seus Espaços de Trabalho
            </div>
            <div className="max-h-48 overflow-y-auto custom-scroll space-y-0.5">
              {servers.map((s) => {
                const isCurrent = s.id === server?.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (onSelectServer) onSelectServer(s.id);
                      setIsServerDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      isCurrent
                        ? 'bg-zinc-800 text-white font-semibold border border-zinc-700'
                        : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className="w-5 h-5 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-200">
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="truncate">{s.name}</span>
                    </div>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {onOpenCreateServerModal && (
              <div className="pt-1 border-t border-zinc-800">
                <button
                  onClick={() => {
                    setIsServerDropdownOpen(false);
                    onOpenCreateServerModal();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-indigo-400 hover:bg-indigo-600/15 hover:text-indigo-300 transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Criar Novo Espaço</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. LISTA DE CANAIS ORGANIZADA POR SEÇÕES */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scroll">
        {!server ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            Nenhum espaço selecionado.
          </div>
        ) : (
          <>
            {/* Seção 1: Discussões / Geral */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">
                <span>Discussões</span>
                <button
                  onClick={() => onOpenCreateChannelModal('TEXT')}
                  className="text-zinc-400 hover:text-white p-0.5 rounded hover:bg-zinc-800 transition-colors"
                  title="Criar canal de texto"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-0.5">
                {textChannels.map((c) => {
                  const isActive = activeChannelId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelectChannel(c)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-zinc-800 text-white border border-zinc-700'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Hash className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                        <span className="truncate">{c.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Seção 2: Áudio & Estúdios de Transmissão */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-2 text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">
                <span>Áudio & Estúdios</span>
                <button
                  onClick={() => onOpenCreateChannelModal('VOICE')}
                  className="text-zinc-400 hover:text-white p-0.5 rounded hover:bg-zinc-800 transition-colors"
                  title="Criar canal de voz"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-0.5">
                {voiceChannels.map((c) => {
                  const isConnected = currentVoiceChannel?.id === c.id;
                  const isActive = activeChannelId === c.id;

                  // Participantes conectados
                  const participantMap = new Map<string, VoiceParticipantInfo>();
                  (voiceParticipants[c.id] || []).forEach((p) => {
                    participantMap.set(p.id, p);
                  });

                  if (isConnected) {
                    if (user) {
                      participantMap.set(user.id, {
                        id: user.id,
                        username: user.username,
                        avatarUrl: user.avatarUrl,
                        isMuted,
                        isDeafened,
                      });
                    }
                    livekitParticipants.forEach((lp) => {
                      const existing = participantMap.get(lp.id);
                      participantMap.set(lp.id, {
                        ...existing,
                        id: lp.id,
                        username: lp.username,
                        avatarUrl: lp.avatarUrl,
                        isMuted: lp.isMuted ?? existing?.isMuted,
                        isDeafened: lp.isDeafened ?? existing?.isDeafened,
                      });
                    });
                  }

                  const participants = Array.from(participantMap.values());
                  const count = participants.length;

                  return (
                    <div key={c.id} className="space-y-1">
                      <button
                        onClick={() => onSelectChannel(c)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          isConnected
                            ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                            : isActive
                            ? 'bg-zinc-800 text-white border border-zinc-700'
                            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {isConnected ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                          ) : (
                            <Volume2 className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                          )}
                          <span className="truncate">{c.name}</span>
                        </div>

                        {count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                            {count}
                          </span>
                        )}
                      </button>

                      {/* Lista sutil de participantes no canal conectado */}
                      {count > 0 && isConnected && (
                        <div className="ml-4 pl-2 space-y-1 border-l border-emerald-800/40 my-1">
                          {participants.map((p) => {
                            const isMe = p.id === user?.id;
                            const isStreaming = Boolean(
                              (isMe && isScreenSharing) ||
                                activeScreenShares.some((s) => !s.isLocal && s.id.includes(p.id)) ||
                                livekitParticipants.some((lp) => lp.id === p.id && lp.screenTrack)
                            );
                            const activeShare = activeScreenShares.find(
                              (s) => !s.isLocal && s.id.includes(p.id)
                            );
                            const shareId = activeShare?.id || p.screenStreamId || p.id;

                            return (
                              <div
                                key={p.id}
                                onContextMenu={(e) =>
                                  handleParticipantContextMenu(e, p, c, isStreaming, shareId)
                                }
                                className="flex items-center justify-between py-1 px-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-900/60 cursor-pointer group"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <img
                                    src={
                                      p.avatarUrl ||
                                      `https://api.dicebear.com/7.x/bottts/svg?seed=${p.username}`
                                    }
                                    className="w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 object-cover"
                                    alt={p.username}
                                  />
                                  <span className="truncate text-[11px] text-zinc-300">
                                    {p.username} {isMe && '(Você)'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isStreaming && (
                                    <Monitor className="w-3 h-3 text-indigo-400 animate-pulse" />
                                  )}
                                  {p.isMuted && <MicOff className="w-3 h-3 text-rose-400" />}
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
          </>
        )}
      </nav>

      {/* 3. DOCK DE VOZ & USUÁRIO MINIMALISTA NA BASE */}
      <div className="border-t border-zinc-800 bg-zinc-950 p-2.5 shrink-0 space-y-2">
        {/* Card de Conexão de Áudio Ativa */}
        {currentVoiceChannel && (
          <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-800/40 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-emerald-300 truncate">
                  Áudio: {currentVoiceChannel.name}
                </p>
                <p className="text-[9px] text-zinc-400 font-mono">WASAPI • 22ms</p>
              </div>
            </div>
            <button
              onClick={() => {
                if (onDisconnectVoice) {
                  onDisconnectVoice();
                } else {
                  leaveVoiceChannel();
                }
              }}
              className="text-[10px] font-medium text-zinc-400 hover:text-rose-400 transition-colors px-1 py-0.5 rounded hover:bg-rose-500/10 shrink-0"
              title="Desconectar do áudio"
            >
              Sair
            </button>
          </div>
        )}

        {/* Linha de Perfil e Controles */}
        {user && (
          <div className="flex items-center justify-between px-1">
            <div
              onClick={onOpenSettings}
              className="flex items-center gap-2 cursor-pointer group min-w-0 flex-1 mr-1"
              title="Configurações de Perfil"
            >
              <img
                src={
                  user.avatarUrl ||
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`
                }
                alt={user.username}
                className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 object-cover shrink-0"
              />
              <div className="flex flex-col text-left min-w-0 truncate">
                <span className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">
                  {user.username}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Online</span>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={toggleMute}
                className={`p-1.5 rounded transition-colors ${
                  isMuted
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
                title={isMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={toggleDeafen}
                className={`p-1.5 rounded transition-colors ${
                  isDeafened
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
                title={isDeafened ? 'Reativar Áudio' : 'Desativar Áudio'}
              >
                {isDeafened ? (
                  <HeadphoneOff className="w-3.5 h-3.5" />
                ) : (
                  <Headphones className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                title="Configurações"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={logout}
                className="p-1.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                title="Encerrar Sessão"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Menu de Contexto para Ajuste de Áudio Individual */}
      {contextMenu && (
        <UserAudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={contextMenu.userId}
          username={contextMenu.username}
          avatarUrl={contextMenu.avatarUrl}
          volume={getUserVolume(contextMenu.userId)}
          isMuted={isUserMuted(contextMenu.userId)}
          onVolumeChange={(val) => setUserVolume(contextMenu.userId, val)}
          onToggleMute={() => toggleMuteUser(contextMenu.userId)}
          onClose={() => setContextMenu(null)}
          hasScreenShare={contextMenu.hasScreenShare}
          onWatchScreenShare={() => {
            if (contextMenu.shareId) {
              watchScreenShare(contextMenu.shareId);
            }
          }}
          roles={roles}
          currentRoleId={
            server?.members?.find((m) => m.userId === contextMenu.userId)?.user?.customRoleId ||
            server?.members?.find((m) => m.userId === contextMenu.userId)?.user?.customRole?.id ||
            null
          }
          canManageRoles={Boolean(user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('manage_users'))}
          onAssignRole={
            onAssignCustomRole
              ? (roleId) => onAssignCustomRole(contextMenu.userId, roleId)
              : undefined
          }
        />
      )}
    </aside>
  );
};

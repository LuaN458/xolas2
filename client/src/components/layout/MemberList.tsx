import React, { useState } from 'react';
import { Member, Server, CustomRole } from '../../types';
import { Shield, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useVoice } from '../../contexts/VoiceContext';
import { useSocket } from '../../contexts/SocketContext';
import { UserAudioContextMenu } from '../voice/UserAudioContextMenu';
import { VoiceParticipantInfo } from './ChannelSidebar';

interface MemberListProps {
  members: Member[];
  onlineUserIds?: Set<string>;
  server?: Server | null;
  voiceParticipants?: Record<string, VoiceParticipantInfo[]>;
  roles?: CustomRole[];
  onAssignCustomRole?: (userId: string, customRoleId: string | null) => Promise<void>;
  onWatchScreenShare?: (participant: VoiceParticipantInfo) => void;
  onClose?: () => void;
}

export const MemberList: React.FC<MemberListProps> = ({
  members,
  onlineUserIds = new Set(),
  server = null,
  voiceParticipants = {},
  roles = [],
  onAssignCustomRole,
  onWatchScreenShare,
  onClose,
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const {
    getUserVolume,
    isUserMuted,
    setUserVolume,
    toggleMuteUser,
    isDeafened,
    toggleDeafen,
    isMuted: selfIsMuted,
    toggleMute: selfToggleMute,
  } = useVoice();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    member: Member;
  } | null>(null);

  // Separar membros em Online e Offline
  const onlineMembers: Member[] = [];
  const offlineMembers: Member[] = [];

  // Ordenar: ADMIN primeiro, depois alfabético
  const sorted = [...members].sort((a, b) => {
    if (a.role === 'ADMIN' && b.role !== 'ADMIN') return -1;
    if (b.role === 'ADMIN' && a.role !== 'ADMIN') return 1;
    return a.user.username.localeCompare(b.user.username);
  });

  sorted.forEach((member) => {
    const isOnline = onlineUserIds.has(member.userId) || onlineUserIds.has(member.user.id);
    if (isOnline) {
      onlineMembers.push(member);
    } else {
      offlineMembers.push(member);
    }
  });

  const handleMemberContextMenu = (e: React.MouseEvent, member: Member) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      member,
    });
  };

  const renderMemberItem = (member: Member, isOnline: boolean) => (
    <div
      key={member.id}
      onContextMenu={(e) => handleMemberContextMenu(e, member)}
      className={`flex items-center space-x-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-900 cursor-pointer transition-colors group ${
        isOnline ? 'opacity-100' : 'opacity-50 hover:opacity-100'
      }`}
    >
      <div className="relative shrink-0">
        <img
          src={
            member.user.avatarUrl ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${member.user.username}`
          }
          alt={member.user.username}
          className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 object-cover"
        />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-zinc-950 ${
            isOnline ? 'bg-emerald-400' : 'bg-zinc-600'
          }`}
          title={isOnline ? 'Disponível' : 'Offline'}
        />
      </div>

      <div className="min-w-0 flex items-center space-x-1.5 flex-1 truncate">
        <span
          className={`text-xs font-medium truncate ${
            isOnline ? 'text-zinc-200 group-hover:text-white' : 'text-zinc-400 group-hover:text-zinc-200'
          }`}
        >
          {member.user.username}
        </span>
        {member.role === 'ADMIN' ? (
          <span title="Administrador">
            <Shield className="w-3 h-3 text-indigo-400 shrink-0" />
          </span>
        ) : member.user.customRole ? (
          <span
            style={{
              backgroundColor: `${member.user.customRole.color}25`,
              color: member.user.customRole.color,
              borderColor: `${member.user.customRole.color}50`,
            }}
            className="px-1.5 py-0.2 rounded text-[9px] font-bold border truncate max-w-[75px]"
            title={`Cargo: ${member.user.customRole.name}`}
          >
            {member.user.customRole.name}
          </span>
        ) : null}
      </div>
    </div>
  );

  // Informações de voz do membro selecionado no menu de contexto
  const targetMember = contextMenu
    ? members.find(
        (m) =>
          m.userId === contextMenu.member.userId ||
          m.user.id === contextMenu.member.user.id
      ) || contextMenu.member
    : null;
  const targetUserId = targetMember?.user?.id;
  const isSelf = targetUserId === user?.id;

  let targetVoiceInfo: {
    channelId: string;
    channelName: string;
    isMuted: boolean;
    isScreenSharing: boolean;
    participant: VoiceParticipantInfo;
  } | null = null;

  if (targetUserId && voiceParticipants) {
    for (const [channelId, participants] of Object.entries(voiceParticipants)) {
      const p = participants.find((item) => item.id === targetUserId);
      if (p) {
        const ch = server?.channels?.find((c) => c.id === channelId);
        targetVoiceInfo = {
          channelId,
          channelName: ch?.name || 'Canal de Voz',
          isMuted: Boolean(p.isMuted),
          isScreenSharing: Boolean(p.isScreenSharing),
          participant: p,
        };
        break;
      }
    }
  }

  const canManageRoles = Boolean(
    user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('manage_users')
  );
  const canDisconnectVoice = Boolean(
    user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('disconnect_voice')
  );
  const canServerMute = Boolean(
    user?.role === 'ADMIN' || user?.customRole?.permissions?.includes('server_mute')
  );

  return (
    <>
      <aside className="w-64 border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0 z-20 select-none h-full animate-in slide-in-from-right-4 duration-150">
        {/* Header da Gaveta */}
        <div className="h-12 px-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <span className="text-xs font-semibold text-zinc-200">
            Participantes ({members.length})
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Fechar painel de participantes"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Conteúdo com scroll */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scroll">
          {/* Seção Disponível (Online) */}
          <div>
            <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1 flex items-center justify-between font-mono">
              <span>Disponível</span>
              <span className="text-[9px] text-emerald-400 bg-emerald-950 px-1.5 py-0.2 rounded border border-emerald-800">
                {onlineMembers.length}
              </span>
            </div>

            <div className="space-y-0.5">
              {onlineMembers.map((member) => renderMemberItem(member, true))}
              {onlineMembers.length === 0 && (
                <div className="text-xs text-zinc-500 px-2 py-1 italic">
                  Nenhum membro ativo
                </div>
              )}
            </div>
          </div>

          {/* Seção Offline */}
          {offlineMembers.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 px-1 flex items-center justify-between font-mono">
                <span>Offline</span>
                <span className="text-[9px] text-zinc-400 bg-zinc-900 px-1.5 py-0.2 rounded border border-zinc-800">
                  {offlineMembers.length}
                </span>
              </div>

              <div className="space-y-0.5">
                {offlineMembers.map((member) => renderMemberItem(member, false))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Menu de Contexto do Membro com Botão Direito */}
      {contextMenu && targetMember && targetUserId && (
        <UserAudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={targetUserId}
          username={targetMember.user.username}
          avatarUrl={targetMember.user.avatarUrl}
          volume={isSelf ? 100 : getUserVolume(targetUserId)}
          isMuted={isSelf ? selfIsMuted : isUserMuted(targetUserId)}
          isDeafened={isDeafened}
          onVolumeChange={(newVolume) => setUserVolume(targetUserId, newVolume)}
          onToggleMute={isSelf ? selfToggleMute : () => toggleMuteUser(targetUserId)}
          onToggleDeafen={isSelf ? toggleDeafen : undefined}
          onClose={() => setContextMenu(null)}
          isAdmin={canManageRoles || canDisconnectVoice || canServerMute}
          isSelf={isSelf}
          roles={roles}
          currentRoleId={targetMember.user.customRole?.id || targetMember.user.customRoleId}
          canManageRoles={canManageRoles}
          onAssignRole={
            canManageRoles && onAssignCustomRole
              ? (roleId) => onAssignCustomRole(targetUserId, roleId)
              : undefined
          }
          inVoiceChannelName={targetVoiceInfo?.channelName}
          hasScreenShare={targetVoiceInfo?.isScreenSharing}
          onWatchScreenShare={
            targetVoiceInfo?.isScreenSharing && onWatchScreenShare
              ? () => onWatchScreenShare(targetVoiceInfo!.participant)
              : undefined
          }
          isServerMuted={targetVoiceInfo?.isMuted}
          onDisconnectVoice={
            canDisconnectVoice && targetVoiceInfo && server?.id
              ? () => {
                  socket?.emit('admin:disconnect-voice', {
                    targetUserId,
                    channelId: targetVoiceInfo!.channelId,
                    serverId: server.id,
                  });
                }
              : undefined
          }
          onToggleServerMute={
            canServerMute && targetVoiceInfo && server?.id
              ? () => {
                  socket?.emit('admin:server-mute-voice', {
                    targetUserId,
                    channelId: targetVoiceInfo!.channelId,
                    serverId: server.id,
                    isMuted: !targetVoiceInfo!.isMuted,
                  });
                }
              : undefined
          }
        />
      )}
    </>
  );
};

import React, { useState } from 'react';
import { Member, Server, CustomRole } from '../../types';
import { Shield } from 'lucide-react';
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
}

export const MemberList: React.FC<MemberListProps> = ({
  members,
  onlineUserIds = new Set(),
  server = null,
  voiceParticipants = {},
  roles = [],
  onAssignCustomRole,
  onWatchScreenShare,
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { getUserVolume, isUserMuted, setUserVolume, toggleMuteUser } = useVoice();

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
      className={`flex items-center space-x-2.5 px-2 py-1.5 rounded-lg hover:bg-obsidian-card cursor-pointer transition-all group ${
        isOnline ? 'opacity-100' : 'opacity-60 hover:opacity-100'
      }`}
    >
      <div className="relative shrink-0">
        <img
          src={
            member.user.avatarUrl ||
            `https://api.dicebear.com/7.x/bottts/svg?seed=${member.user.username}`
          }
          alt={member.user.username}
          className="w-7 h-7 rounded-lg bg-obsidian-card border border-obsidian-border"
        />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-obsidian-surface ${
            isOnline ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50' : 'bg-slate-500'
          }`}
          title={isOnline ? 'Disponível' : 'Offline'}
        />
      </div>

      <div className="min-w-0 flex items-center space-x-1.5 flex-1">
        <span
          className={`text-xs font-medium truncate ${
            isOnline ? 'text-obsidian-text-primary group-hover:text-white' : 'text-obsidian-text-muted group-hover:text-obsidian-text-secondary'
          }`}
        >
          {member.user.username}
        </span>
        {member.role === 'ADMIN' ? (
          <span title="Administrador">
            <Shield className="w-3 h-3 text-obsidian-accent shrink-0" />
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
  const targetMember = contextMenu?.member;
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
      <aside className="w-56 bg-obsidian-surface flex flex-col shrink-0 select-none border-l border-obsidian-border p-3.5 overflow-y-auto">
        {/* 1. Seção Disponível (Online) */}
        <div className="text-[10px] font-bold text-obsidian-text-muted tracking-wider uppercase mb-2 px-1 flex items-center justify-between">
          <span>Disponível</span>
          <span className="font-mono text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded">
            {onlineMembers.length}
          </span>
        </div>

        <div className="space-y-0.5 mb-5">
          {onlineMembers.map((member) => renderMemberItem(member, true))}
          {onlineMembers.length === 0 && (
            <div className="text-[11px] text-obsidian-text-muted px-2 py-1 italic">
              Nenhum membro ativo
            </div>
          )}
        </div>

        {/* 2. Seção Offline */}
        {offlineMembers.length > 0 && (
          <>
            <div className="text-[10px] font-bold text-obsidian-text-muted tracking-wider uppercase mb-2 px-1 flex items-center justify-between">
              <span>Offline</span>
              <span className="font-mono text-[9px] text-slate-400 bg-slate-500/10 px-1.5 py-0.2 rounded">
                {offlineMembers.length}
              </span>
            </div>

            <div className="space-y-0.5">
              {offlineMembers.map((member) => renderMemberItem(member, false))}
            </div>
          </>
        )}
      </aside>

      {/* Menu de Contexto do Membro com Botão Direito */}
      {contextMenu && targetMember && targetUserId && (
        <UserAudioContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          userId={targetUserId}
          username={targetMember.user.username}
          avatarUrl={targetMember.user.avatarUrl}
          volume={getUserVolume(targetUserId)}
          isMuted={isUserMuted(targetUserId)}
          onVolumeChange={(newVolume) => setUserVolume(targetUserId, newVolume)}
          onToggleMute={() => toggleMuteUser(targetUserId)}
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

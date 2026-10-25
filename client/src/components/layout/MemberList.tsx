import React from 'react';
import { Member } from '../../types';
import { Shield } from 'lucide-react';

interface MemberListProps {
  members: Member[];
  onlineUserIds?: Set<string>;
}

export const MemberList: React.FC<MemberListProps> = ({ members, onlineUserIds = new Set() }) => {
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

  const renderMemberItem = (member: Member, isOnline: boolean) => (
    <div
      key={member.id}
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
        {member.role === 'ADMIN' && (
          <span title="Administrador">
            <Shield className="w-3 h-3 text-obsidian-accent shrink-0" />
          </span>
        )}
      </div>
    </div>
  );

  return (
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
  );
};

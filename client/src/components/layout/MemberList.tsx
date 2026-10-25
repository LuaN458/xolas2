import React from 'react';
import { Member } from '../../types';
import { Shield } from 'lucide-react';

interface MemberListProps {
  members: Member[];
}

export const MemberList: React.FC<MemberListProps> = ({ members }) => {
  return (
    <aside className="w-56 bg-obsidian-surface flex flex-col shrink-0 select-none border-l border-obsidian-border p-3.5 overflow-y-auto">
      <div className="text-[10px] font-bold text-obsidian-text-muted tracking-wider uppercase mb-3 px-1">
        Participantes — {members.length}
      </div>

      <div className="space-y-0.5">
        {members.map((member) => {
          return (
            <div
              key={member.id}
              className="flex items-center space-x-2.5 px-2 py-1.5 rounded-lg hover:bg-obsidian-card cursor-pointer transition-colors group"
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
                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-obsidian-surface bg-obsidian-emerald" />
              </div>

              <div className="min-w-0 flex items-center space-x-1.5 flex-1">
                <span className="text-obsidian-text-secondary text-xs font-medium truncate group-hover:text-white">
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
        })}
      </div>
    </aside>
  );
};

import React from 'react';
import { Plus, LayoutGrid, Shield } from 'lucide-react';
import { Server } from '../../types';

interface ServerSidebarProps {
  servers: Server[];
  activeServerId: string | null;
  onSelectServer: (serverId: string | null) => void;
  onOpenCreateModal: () => void;
  isAdmin?: boolean;
  pendingApprovalsCount?: number;
  onOpenAdminModal?: () => void;
}

export const ServerSidebar: React.FC<ServerSidebarProps> = ({
  servers,
  activeServerId,
  onSelectServer,
  onOpenCreateModal,
  isAdmin = false,
  pendingApprovalsCount = 0,
  onOpenAdminModal,
}) => {
  return (
    <aside className="w-16 bg-obsidian-bg flex flex-col items-center py-4 space-y-3 select-none z-20 shrink-0 border-r border-obsidian-border">
      {/* Botão de Início / Hub */}
      <div className="relative group flex items-center justify-center w-full">
        <button
          onClick={() => onSelectServer(null)}
          className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${
            activeServerId === null
              ? 'bg-obsidian-accent text-white shadow-lg shadow-obsidian-accent/30 border border-indigo-400/30'
              : 'bg-obsidian-card text-obsidian-text-muted hover:text-white hover:bg-obsidian-hover border border-obsidian-border'
          }`}
          title="Visão Geral"
        >
          <LayoutGrid className="w-5 h-5" />
        </button>
      </div>

      {/* Botão do Painel de Administração (visível apenas para ADMIN) */}
      {isAdmin && (
        <div className="relative group flex items-center justify-center w-full">
          <button
            onClick={onOpenAdminModal}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-400 hover:text-indigo-300 border border-indigo-500/40 hover:border-indigo-400 transition-all shadow-md shadow-indigo-600/10 relative"
            title="Painel de Administração"
          >
            <Shield className="w-5 h-5" />
            {pendingApprovalsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center shadow-md shadow-rose-600/50 border border-white/20 animate-pulse">
                {pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Divisor minimalista */}
      <div className="w-6 h-[1px] bg-obsidian-border" />

      {/* Lista de Espaços de Trabalho */}
      <div className="flex-1 w-full space-y-2.5 overflow-y-auto no-scrollbar flex flex-col items-center">
        {servers.map((server) => {
          const isActive = activeServerId === server.id;
          const initials = server.name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

          return (
            <div key={server.id} className="relative group flex items-center justify-center w-full">
              {/* Indicador lateral sutil */}
              {isActive && (
                <div className="absolute left-0 w-0.5 h-5 bg-obsidian-accent rounded-r" />
              )}
              <button
                onClick={() => onSelectServer(server.id)}
                className={`w-10 h-10 flex items-center justify-center font-semibold text-xs rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-obsidian-card text-white border border-indigo-500 shadow-md shadow-indigo-500/20'
                    : 'bg-obsidian-surface text-obsidian-text-muted hover:text-white hover:bg-obsidian-card border border-obsidian-border'
                }`}
                title={server.name}
              >
                {server.iconUrl ? (
                  <img
                    src={server.iconUrl}
                    alt={server.name}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>
            </div>
          );
        })}

        {/* Adicionar Novo Espaço */}
        <div className="relative group flex items-center justify-center w-full pt-1">
          <button
            onClick={onOpenCreateModal}
            className="w-10 h-10 rounded-xl bg-obsidian-card hover:bg-indigo-600/15 text-obsidian-text-secondary hover:text-indigo-400 border border-obsidian-border hover:border-indigo-500/50 flex items-center justify-center transition-all duration-200 shadow-sm group"
            title="Criar Novo Servidor"
          >
            <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
          </button>
        </div>
      </div>
    </aside>
  );
};

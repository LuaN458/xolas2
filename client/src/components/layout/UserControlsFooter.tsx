import React from 'react';
import { Mic, MicOff, Headphones, Settings, LogOut, Camera } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useVoice } from '../../contexts/VoiceContext';

interface UserControlsFooterProps {
  onOpenSettings?: () => void;
}

export const UserControlsFooter: React.FC<UserControlsFooterProps> = ({ onOpenSettings }) => {
  const { user, logout } = useAuth();
  const { isMuted, isDeafened, toggleMute, toggleDeafen } = useVoice();

  if (!user) return null;

  return (
    <footer className="h-16 bg-obsidian-surface px-2 flex items-center justify-between border-t border-obsidian-border select-none shrink-0 w-full gap-1.5">
      {/* Informações do Usuário & Atalho para Editar Foto/Perfil */}
      <div
        onClick={onOpenSettings}
        className="flex items-center space-x-2 min-w-0 flex-1 p-1 rounded-xl cursor-pointer transition-all border border-transparent hover:bg-obsidian-card/60 hover:border-obsidian-border overflow-hidden group"
        title="Clique para editar foto de perfil e configurações"
      >
        <div className="relative shrink-0 group/avatar">
          <img
            src={user.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
            alt={user.username}
            className="w-8 h-8 rounded-xl bg-obsidian-card border border-obsidian-border shadow-sm object-cover"
          />
          {/* Overlay de edição com ícone de câmera */}
          <div
            className="absolute inset-0 bg-black/60 rounded-xl flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity backdrop-blur-[0.5px]"
            title="Editar foto de perfil"
          >
            <Camera className="w-3.5 h-3.5 text-white drop-shadow" />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-obsidian-emerald rounded-full border-2 border-obsidian-surface shadow-sm" />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden flex flex-col justify-center">
          <span
            className="text-white text-xs font-semibold truncate block leading-tight tracking-tight"
            title={user.username}
          >
            {user.username}
          </span>
          <span className="text-emerald-400 text-[10px] leading-tight font-mono flex items-center space-x-1 mt-0.5">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block animate-pulse shrink-0" />
            <span className="truncate">Online</span>
          </span>
        </div>
      </div>

      {/* Controles de Áudio, Engrenagem e Logout (Tamanho Otimizado sem Sobreposição) */}
      <div className="flex items-center space-x-0.5 shrink-0">
        <button
          onClick={toggleMute}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all shadow-sm shrink-0 ${
            isMuted
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-rose-500/10'
              : 'bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary hover:text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
          }`}
          title={isMuted ? 'Ativar Microfone' : 'Silenciar Microfone'}
        >
          {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={toggleDeafen}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all shadow-sm shrink-0 ${
            isDeafened
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-rose-500/10'
              : 'bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary hover:text-white hover:border-obsidian-border-light hover:bg-obsidian-card-hover'
          }`}
          title={isDeafened ? 'Reativar Áudio' : 'Desativar Áudio'}
        >
          <Headphones className="w-3.5 h-3.5" />
        </button>

        {/* Botão da Engrenagem com Destaque Visual */}
        <button
          onClick={onOpenSettings}
          className="w-7 h-7 rounded-lg bg-obsidian-card border border-obsidian-border text-obsidian-text-secondary hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/10 flex items-center justify-center transition-all shadow-sm shrink-0 group"
          title="Configurações (Mudar Nick & Microfone)"
        >
          <Settings className="w-3.5 h-3.5 group-hover:rotate-45 transition-transform duration-300" />
        </button>

        <button
          onClick={logout}
          className="w-7 h-7 rounded-lg bg-obsidian-card border border-obsidian-border text-obsidian-text-muted hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10 flex items-center justify-center transition-all shadow-sm shrink-0"
          title="Encerrar Sessão"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, Volume1, VolumeX, MicOff, RotateCcw, Monitor, Shield, PhoneOff, Check, UserCheck } from 'lucide-react';
import { CustomRole } from '../../types';

interface UserAudioContextMenuProps {
  x: number;
  y: number;
  userId: string;
  username: string;
  avatarUrl?: string;
  volume: number; // 0 a 200
  isMuted: boolean;
  hasScreenShare?: boolean;
  onWatchScreenShare?: () => void;
  onVolumeChange: (newVolume: number) => void;
  onToggleMute: () => void;
  onClose: () => void;
  isAdmin?: boolean;
  isServerMuted?: boolean;
  onDisconnectVoice?: () => void;
  onToggleServerMute?: () => void;
  // Campos para gerenciamento de cargos
  roles?: CustomRole[];
  currentRoleId?: string | null;
  canManageRoles?: boolean;
  onAssignRole?: (roleId: string | null) => Promise<void> | void;
  isSelf?: boolean;
  inVoiceChannelName?: string;
}

export const UserAudioContextMenu: React.FC<UserAudioContextMenuProps> = ({
  x,
  y,
  userId: _userId,
  username,
  avatarUrl,
  volume,
  isMuted,
  hasScreenShare = false,
  onWatchScreenShare,
  onVolumeChange,
  onToggleMute,
  onClose,
  isAdmin = false,
  isServerMuted = false,
  onDisconnectVoice,
  onToggleServerMute,
  roles = [],
  currentRoleId = null,
  canManageRoles = false,
  onAssignRole,
  isSelf = false,
  inVoiceChannelName,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isAssigning, setIsAssigning] = useState(false);

  // Fechar ao clicar fora ou pressionar ESC
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Posicionamento inteligente para evitar corte nas bordas da janela
  const MENU_WIDTH = 268;
  const MENU_APPROX_HEIGHT = 440;
  const safeX = Math.max(12, Math.min(x, window.innerWidth - MENU_WIDTH - 16));
  const safeY = Math.max(12, Math.min(y, window.innerHeight - MENU_APPROX_HEIGHT - 16));

  const effectiveVolume = isMuted ? 0 : volume;
  const hasVoiceModeration = Boolean(onDisconnectVoice || onToggleServerMute);
  const activeRole = roles.find((r) => r.id === currentRoleId);

  const handleRoleSelect = async (roleId: string | null) => {
    if (!onAssignRole || isAssigning) return;
    try {
      setIsAssigning(true);
      await onAssignRole(roleId);
    } catch (err) {
      console.error('Erro ao atribuir cargo via menu de contexto:', err);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ top: `${safeY}px`, left: `${safeX}px` }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 w-64 max-h-[88vh] overflow-y-auto bg-obsidian-card/95 backdrop-blur-xl border border-obsidian-border rounded-2xl shadow-2xl p-3.5 text-white select-none animate-in fade-in zoom-in-95 duration-100 custom-scrollbar"
    >
      {/* Cabeçalho do Usuário */}
      <div className="flex items-center space-x-2.5 pb-2.5 border-b border-obsidian-border/60">
        <img
          src={avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`}
          alt={username}
          className="w-9 h-9 rounded-xl bg-obsidian-surface border border-obsidian-border shrink-0 object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-bold text-white truncate tracking-tight">
              {username}
            </span>
            {isSelf && (
              <span className="text-[9px] px-1 py-0.2 rounded font-semibold bg-white/10 text-obsidian-text-muted">
                Você
              </span>
            )}
          </div>

          <div className="text-[10px] text-obsidian-text-muted font-medium flex items-center space-x-1 mt-0.5 truncate">
            {inVoiceChannelName ? (
              <span className="text-emerald-400 font-semibold truncate flex items-center gap-1">
                <span>🔊</span>
                <span>#{inVoiceChannelName}</span>
              </span>
            ) : activeRole ? (
              <span
                style={{
                  color: activeRole.color,
                  backgroundColor: `${activeRole.color}20`,
                  borderColor: `${activeRole.color}40`,
                }}
                className="px-1.5 py-0.2 rounded border font-semibold truncate max-w-[140px]"
              >
                {activeRole.name}
              </span>
            ) : (
              <span>Menu do Usuário</span>
            )}

            {isMuted && !isSelf && (
              <span className="text-rose-400 font-semibold shrink-0">• Mudo</span>
            )}
          </div>
        </div>
      </div>

      {/* Ação de Assistir Transmissão (se o usuário estiver transmitindo tela) */}
      {hasScreenShare && onWatchScreenShare && (
        <div className="pt-2.5 pb-1 border-b border-obsidian-border/60">
          <button
            type="button"
            onClick={() => {
              onWatchScreenShare();
              onClose();
            }}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/35 text-indigo-200 border border-indigo-500/40 shadow-lg shadow-indigo-600/15 transition-all group"
          >
            <div className="flex items-center space-x-2">
              <Monitor className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
              <span>Assistir Transmissão</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 animate-pulse">
              AO VIVO
            </span>
          </button>
        </div>
      )}

      {/* Seção 1: Ajuste de Volume e Silenciamento Local (apenas se não for o próprio usuário) */}
      {!isSelf && (
        <div className="pt-3 pb-2 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-1.5 text-obsidian-text-secondary font-semibold">
              {effectiveVolume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : effectiveVolume <= 75 ? (
                <Volume1 className="w-4 h-4 text-emerald-400" />
              ) : (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              )}
              <span>Volume da Voz</span>
            </div>

            <div className="flex items-center space-x-1.5">
              {volume !== 100 && (
                <button
                  type="button"
                  onClick={() => onVolumeChange(100)}
                  title="Redefinir para 100% padrão"
                  className="p-1 rounded-md text-obsidian-text-muted hover:text-white hover:bg-white/10 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
              <span
                className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded ${
                  effectiveVolume > 100
                    ? 'text-amber-300 bg-amber-500/10'
                    : effectiveVolume === 0
                    ? 'text-rose-400 bg-rose-500/10'
                    : 'text-emerald-300 bg-emerald-500/10'
                }`}
              >
                {effectiveVolume}%
              </span>
            </div>
          </div>

          {/* Slider 0% a 200% */}
          <div className="relative pt-1">
            <input
              type="range"
              min="0"
              max="200"
              step="1"
              value={isMuted ? 0 : volume}
              disabled={isMuted}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer transition-all ${
                isMuted
                  ? 'bg-white/10 opacity-50 cursor-not-allowed'
                  : 'bg-white/20 accent-emerald-500 hover:accent-emerald-400'
              }`}
            />
            {/* Indicador de 100% (ponto central) */}
            <div
              className="absolute top-1 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-white/40 pointer-events-none rounded"
              title="100% Padrão"
            />
          </div>

          <div className="flex justify-between text-[10px] text-obsidian-text-muted font-mono px-0.5">
            <span>0%</span>
            <span className="text-obsidian-text-secondary font-semibold">100%</span>
            <span className="text-amber-400/80">200%</span>
          </div>

          {/* Botão de Silenciamento Local (Mudo) */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`w-full mt-1.5 flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all group ${
              isMuted
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                : 'bg-obsidian-surface hover:bg-white/10 text-obsidian-text-primary hover:text-white border border-obsidian-border'
            }`}
          >
            <div className="flex items-center space-x-2">
              <MicOff
                className={`w-4 h-4 ${
                  isMuted ? 'text-rose-400' : 'text-obsidian-text-muted group-hover:text-white'
                }`}
              />
              <span>Silenciar Usuário</span>
            </div>

            <div
              className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                isMuted
                  ? 'bg-rose-500 border-rose-400'
                  : 'border-white/30 group-hover:border-white/50 bg-transparent'
              }`}
            >
              {isMuted && (
                <svg
                  className="w-3 h-3 text-white fill-current"
                  viewBox="0 0 20 20"
                >
                  <path d="M0 11l2-2 5 5L18 3l2 2L7 18z" />
                </svg>
              )}
            </div>
          </button>
        </div>
      )}

      {/* Seção 2: Atribuição de Cargos Customizados */}
      {canManageRoles && (
        <>
          <div className="border-t border-obsidian-border/60 my-2" />
          <div className="text-[10px] font-bold text-obsidian-accent uppercase tracking-wider px-1 mb-1.5 flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <Shield className="w-3.5 h-3.5 text-obsidian-accent" />
              <span>Atribuir Cargo</span>
            </div>
            {isAssigning && (
              <span className="text-[9px] text-obsidian-text-muted animate-pulse font-normal lowercase">
                salvando...
              </span>
            )}
          </div>

          <div className="space-y-1 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
            {/* Opção: Sem Cargo */}
            <button
              type="button"
              disabled={isAssigning}
              onClick={() => handleRoleSelect(null)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                !currentRoleId
                  ? 'bg-white/10 text-white font-semibold'
                  : 'text-obsidian-text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 rounded-full border border-white/20 bg-slate-500/40" />
                <span>Sem cargo</span>
              </div>
              {!currentRoleId && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
            </button>

            {/* Lista de Cargos */}
            {roles.map((r) => {
              const isSelected = currentRoleId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={isAssigning}
                  onClick={() => handleRoleSelect(r.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected
                      ? 'bg-white/10 text-white font-semibold'
                      : 'text-obsidian-text-secondary hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate">{r.name}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                </button>
              );
            })}

            {roles.length === 0 && (
              <div className="text-[11px] text-obsidian-text-muted px-2 py-1.5 italic">
                Nenhum cargo customizado cadastrado
              </div>
            )}
          </div>
        </>
      )}

      {/* Seção 3: Moderação de Voz (se o usuário estiver em um canal de voz) */}
      {hasVoiceModeration && (
        <>
          <div className="border-t border-obsidian-border/60 my-2" />
          <div className="text-[10px] font-bold text-obsidian-accent uppercase tracking-wider px-1 mb-1.5 flex items-center space-x-1">
            <UserCheck className="w-3 h-3" />
            <span>Moderação de Voz</span>
          </div>

          <div className="space-y-1.5">
            {onToggleServerMute && (
              <button
                type="button"
                onClick={() => {
                  onToggleServerMute();
                  onClose();
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                  isServerMuted
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                    : 'bg-obsidian-surface hover:bg-white/10 text-obsidian-text-secondary hover:text-white border border-obsidian-border'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <MicOff className="w-4 h-4 text-amber-400" />
                  <span>{isServerMuted ? 'Desmutar no Servidor' : 'Silenciar no Servidor'}</span>
                </div>
                <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  Para Todos
                </span>
              </button>
            )}

            {onDisconnectVoice && (
              <button
                type="button"
                onClick={() => {
                  onDisconnectVoice();
                  onClose();
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/30 transition-all group"
              >
                <PhoneOff className="w-4 h-4 text-rose-400 group-hover:scale-105 transition-transform" />
                <span>Desconectar da Sala</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

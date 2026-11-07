import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Hash, Volume2, Settings, Shield, Plus } from 'lucide-react';
import { Channel, Server } from '../../types';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  channels: Channel[];
  onSelectChannel: (channel: Channel) => void;
  servers: Server[];
  activeServerId: string | null;
  onSelectServer: (serverId: string) => void;
  onOpenSettings: () => void;
  onOpenAdmin?: () => void;
  isAdmin?: boolean;
  onOpenCreateChannel?: () => void;
}

interface PaletteItem {
  id: string;
  category: 'Canais do Espaço' | 'Alternar Espaço de Trabalho' | 'Comandos do Sistema';
  label: string;
  badge?: string;
  isCurrent?: boolean;
  icon: React.ReactNode;
  onExecute: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  channels,
  onSelectChannel,
  servers,
  activeServerId,
  onSelectServer,
  onOpenSettings,
  onOpenAdmin,
  isAdmin,
  onOpenCreateChannel,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const normalizedQuery = query.toLowerCase().trim();

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // 1. Canais do Espaço
    const filteredChannels = channels.filter((c) =>
      c.name.toLowerCase().includes(normalizedQuery)
    );
    filteredChannels.forEach((c) => {
      list.push({
        id: `channel-${c.id}`,
        category: 'Canais do Espaço',
        label: `#${c.name}`,
        badge: c.type === 'VOICE' ? 'Voz' : 'Texto',
        icon:
          c.type === 'VOICE' ? (
            <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Hash className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          ),
        onExecute: () => {
          onSelectChannel(c);
          onClose();
        },
      });
    });

    // 2. Servidores / Espaços (apenas se houver mais de um cadastrado)
    if (servers.length > 1) {
      const filteredServers = servers.filter((s) =>
        s.name.toLowerCase().includes(normalizedQuery)
      );
      filteredServers.forEach((s) => {
        list.push({
          id: `server-${s.id}`,
          category: 'Alternar Espaço de Trabalho',
          label: s.name,
          badge: activeServerId === s.id ? 'Atual' : undefined,
          isCurrent: activeServerId === s.id,
          icon: (
            <div className="w-5 h-5 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-200 shrink-0">
              {s.name.charAt(0).toUpperCase()}
            </div>
          ),
          onExecute: () => {
            onSelectServer(s.id);
            onClose();
          },
        });
      });
    }

    // 3. Comandos do Sistema
    const actions: Array<{
      id: string;
      label: string;
      icon: React.ReactNode;
      action: () => void;
    }> = [
      {
        id: 'settings',
        label: 'Abrir Configurações do Xolas (Áudio, Nick e Atualizações)',
        icon: <Settings className="w-3.5 h-3.5 text-zinc-400" />,
        action: onOpenSettings,
      },
      ...(isAdmin && onOpenAdmin
        ? [
            {
              id: 'admin',
              label: 'Abrir Painel de Administração',
              icon: <Shield className="w-3.5 h-3.5 text-indigo-400" />,
              action: onOpenAdmin,
            },
          ]
        : []),
      ...(onOpenCreateChannel
        ? [
            {
              id: 'create-channel',
              label: 'Criar Novo Canal neste Espaço',
              icon: <Plus className="w-3.5 h-3.5 text-zinc-400" />,
              action: onOpenCreateChannel,
            },
          ]
        : []),
    ];

    actions
      .filter((a) => a.label.toLowerCase().includes(normalizedQuery))
      .forEach((a) => {
        list.push({
          id: a.id,
          category: 'Comandos do Sistema',
          label: a.label,
          icon: a.icon,
          onExecute: () => {
            a.action();
            onClose();
          },
        });
      });

    return list;
  }, [
    channels,
    servers,
    activeServerId,
    normalizedQuery,
    isAdmin,
    onOpenAdmin,
    onOpenCreateChannel,
    onOpenSettings,
    onSelectChannel,
    onSelectServer,
    onClose,
  ]);

  // Manter refs para o listener de teclado sem re-atachar listener a cada tecla
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  // Resetar índice ao alterar busca
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Auto-scroll suave para o item selecionado na navegação por teclado
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          itemsRef.current.length > 0 ? (prev + 1) % itemsRef.current.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          itemsRef.current.length > 0
            ? (prev - 1 + itemsRef.current.length) % itemsRef.current.length
            : 0
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        itemsRef.current[selectedIndexRef.current]?.onExecute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Categorias distintas presentes na lista atual
  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-start justify-center pt-20 p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Campo de Busca */}
        <div className="p-3 border-b border-zinc-800 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Navegue rapidamente para canais, espaços ou ações..."
            className="w-full bg-transparent border-0 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            onClick={onClose}
            className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 transition-colors"
          >
            ESC
          </button>
        </div>

        {/* Lista de Ações / Resultados */}
        <div className="p-2 space-y-3 max-h-96 overflow-y-auto custom-scroll">
          {categories.map((category) => {
            const categoryItems = items.filter((it) => it.category === category);
            if (categoryItems.length === 0) return null;

            return (
              <div key={category}>
                <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider font-mono">
                  {category}
                </div>
                <div className="space-y-0.5">
                  {categoryItems.map((item) => {
                    const idx = items.indexOf(item);
                    const isSelected = selectedIndex === idx;
                    return (
                      <button
                        key={item.id}
                        ref={isSelected ? selectedItemRef : undefined}
                        onClick={item.onExecute}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                          isSelected
                            ? 'bg-zinc-800 text-white font-medium border border-zinc-700'
                            : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-white border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          {item.icon}
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span
                            className={`text-[10px] font-mono uppercase ${
                              item.isCurrent ? 'text-indigo-400 font-semibold' : 'text-zinc-500'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-500">
              Nenhum resultado encontrado para &quot;{query}&quot;.
            </div>
          )}
        </div>

        {/* Footer com Dicas de Atalhos (Linear Pro Studio) */}
        <div className="px-3 py-2 border-t border-zinc-800/80 bg-zinc-950/60 text-[10px] font-mono text-zinc-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↑↓</kbd> navegar
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↵</kbd> selecionar
            </span>
          </div>
          <span>
            <kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
};

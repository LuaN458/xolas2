import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Sparkles, Layers, Sliders, Hash, Volume2, Settings, Shield, Plus } from 'lucide-react';
import { Channel, Server } from '../../types';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  layoutMode: 'linear' | 'campsite' | 'compact';
  onSelectLayoutMode: (mode: 'linear' | 'campsite' | 'compact') => void;
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
  category: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  badgeActive?: boolean;
  onExecute: () => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  layoutMode,
  onSelectLayoutMode,
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const normalizedQuery = query.toLowerCase().trim();

  // Construir lista de itens filtrados
  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];

    // 1. Modos de Layout
    const layoutItems: { id: 'linear' | 'campsite' | 'compact'; label: string; icon: React.ReactNode; keywords: string }[] = [
      {
        id: 'linear',
        label: 'Layout: Linear / Monolith (1px Borders)',
        icon: <Sparkles className="w-3.5 h-3.5 text-indigo-400" />,
        keywords: 'linear monolith 1px monocromatico bordas layout modo',
      },
      {
        id: 'campsite',
        label: 'Layout: Campsite Topics (Cards de Tópicos)',
        icon: <Layers className="w-3.5 h-3.5 text-amber-400" />,
        keywords: 'campsite topics topicos cards layout modo',
      },
      {
        id: 'compact',
        label: 'Layout: Compact Dual-Pane (Alta Densidade)',
        icon: <Sliders className="w-3.5 h-3.5 text-blue-400" />,
        keywords: 'compact dual pane densidade alta layout modo',
      },
    ];

    layoutItems.forEach((l) => {
      if (!normalizedQuery || l.label.toLowerCase().includes(normalizedQuery) || l.keywords.includes(normalizedQuery)) {
        list.push({
          id: `layout-${l.id}`,
          category: 'Modos de Visualização',
          label: l.label,
          icon: l.icon,
          badge: layoutMode === l.id ? 'Ativo' : undefined,
          badgeActive: layoutMode === l.id,
          onExecute: () => {
            onSelectLayoutMode(l.id);
            onClose();
          },
        });
      }
    });

    // 2. Canais do Espaço
    channels.forEach((c) => {
      const typeText = c.type === 'VOICE' ? 'voz audio studio transmissao call' : 'texto chat discussao';
      if (!normalizedQuery || c.name.toLowerCase().includes(normalizedQuery) || typeText.includes(normalizedQuery)) {
        list.push({
          id: `channel-${c.id}`,
          category: 'Canais do Espaço',
          label: `#${c.name}`,
          icon:
            c.type === 'VOICE' ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Hash className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            ),
          badge: c.type === 'VOICE' ? 'Voz' : 'Texto',
          badgeActive: false,
          onExecute: () => {
            onSelectChannel(c);
            onClose();
          },
        });
      }
    });

    // 3. Alternar Espaços (se houver mais de um)
    if (servers.length > 1) {
      servers.forEach((s) => {
        if (!normalizedQuery || s.name.toLowerCase().includes(normalizedQuery) || 'espaco servidor workspace'.includes(normalizedQuery)) {
          const isCurrent = activeServerId === s.id;
          list.push({
            id: `server-${s.id}`,
            category: 'Alternar Espaço de Trabalho',
            label: s.name,
            icon: (
              <div className="w-5 h-5 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-bold text-zinc-200 shrink-0">
                {s.name.charAt(0).toUpperCase()}
              </div>
            ),
            badge: isCurrent ? 'Atual' : undefined,
            badgeActive: isCurrent,
            onExecute: () => {
              onSelectServer(s.id);
              onClose();
            },
          });
        }
      });
    }

    // 4. Comandos do Sistema
    const settingsKeywords = 'configuracoes settings audio mic nick apelido perfil atualizacoes updates microfone';
    if (!normalizedQuery || 'configuracoes'.includes(normalizedQuery) || settingsKeywords.includes(normalizedQuery)) {
      list.push({
        id: 'cmd-settings',
        category: 'Comandos do Sistema',
        label: 'Abrir Configurações do Xolas (Áudio, Nick e Atualizações)',
        icon: <Settings className="w-3.5 h-3.5 text-zinc-400" />,
        onExecute: () => {
          onClose();
          onOpenSettings();
        },
      });
    }

    if (isAdmin && onOpenAdmin) {
      const adminKeywords = 'admin administrador painel usuarios cargos permissoes';
      if (!normalizedQuery || 'administracao'.includes(normalizedQuery) || adminKeywords.includes(normalizedQuery)) {
        list.push({
          id: 'cmd-admin',
          category: 'Comandos do Sistema',
          label: 'Abrir Painel de Administração',
          icon: <Shield className="w-3.5 h-3.5 text-indigo-400" />,
          onExecute: () => {
            onClose();
            onOpenAdmin();
          },
        });
      }
    }

    if (onOpenCreateChannel) {
      const createKeywords = 'criar canal novo text voice audio discussao';
      if (!normalizedQuery || 'criar canal'.includes(normalizedQuery) || createKeywords.includes(normalizedQuery)) {
        list.push({
          id: 'cmd-create-channel',
          category: 'Comandos do Sistema',
          label: 'Criar Novo Canal neste Espaço',
          icon: <Plus className="w-3.5 h-3.5 text-zinc-400" />,
          onExecute: () => {
            onClose();
            onOpenCreateChannel();
          },
        });
      }
    }

    return list;
  }, [
    normalizedQuery,
    channels,
    servers,
    activeServerId,
    layoutMode,
    isAdmin,
    onOpenAdmin,
    onOpenCreateChannel,
    onSelectLayoutMode,
    onSelectChannel,
    onSelectServer,
    onOpenSettings,
    onClose,
  ]);

  // Resetar índice selecionado ao mudar busca
  useEffect(() => {
    setSelectedIndex(0);
  }, [normalizedQuery]);

  // Navegação por teclado (Cima, Baixo, Enter, ESC)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          items[selectedIndex].onExecute();
        }
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, items, selectedIndex, onClose]);

  // Rolar suavemente para o item ativo ao navegar por setas
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('[data-selected="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  // Agrupar itens por categoria para exibição limpa
  const categories = Array.from(new Set(items.map((it) => it.category)));

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
            placeholder="Navegue rapidamente para canais, ações ou layouts..."
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
        <div ref={listRef} className="p-2 space-y-3 max-h-96 overflow-y-auto custom-scroll">
          {items.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500 font-mono">
              Nenhum resultado encontrado para &quot;{query}&quot;
            </div>
          ) : (
            categories.map((category) => {
              const categoryItems = items.filter((it) => it.category === category);
              return (
                <div key={category}>
                  <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider font-mono">
                    {category}
                  </div>
                  <div className="space-y-0.5">
                    {categoryItems.map((item) => {
                      const itemOverallIndex = items.findIndex((it) => it.id === item.id);
                      const isHighlighted = itemOverallIndex === selectedIndex;

                      return (
                        <button
                          key={item.id}
                          data-selected={isHighlighted}
                          onClick={item.onExecute}
                          onMouseEnter={() => setSelectedIndex(itemOverallIndex)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                            isHighlighted
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
                                item.badgeActive ? 'text-indigo-400 font-semibold' : 'text-zinc-500'
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
            })
          )}
        </div>

        {/* Footer com Dicas de Atalhos */}
        <div className="px-3 py-2 border-t border-zinc-800/80 bg-zinc-950/60 text-[10px] font-mono text-zinc-500 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↑↓</kbd> navegar</span>
            <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↵</kbd> selecionar</span>
          </div>
          <span><kbd className="px-1 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">esc</kbd> fechar</span>
        </div>
      </div>
    </div>
  );
};

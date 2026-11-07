import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSocket } from './contexts/SocketContext';
import { useVoice } from './contexts/VoiceContext';
import { api } from './lib/api';
import {
  getCachedServerDetails,
  getCachedServers,
  persistCachedServerDetails,
  persistCachedServers,
  persistAuthSession,
  getAuthToken,
} from './lib/authStorage';
import { Server, Channel, CustomRole, User } from './types';

import { ChannelSidebar, VoiceParticipantInfo } from './components/layout/ChannelSidebar';
import { MemberList } from './components/layout/MemberList';
import { ChatHeader } from './components/chat/ChatHeader';
import { MessageArea } from './components/chat/MessageArea';
import { ChatInput } from './components/chat/ChatInput';
import { VoiceRoom } from './components/voice/VoiceRoom';
import { CreateServerModal } from './components/modals/CreateServerModal';
import { CreateChannelModal } from './components/modals/CreateChannelModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { AuthModal } from './components/modals/AuthModal';
import { AdminModal } from './components/modals/AdminModal';
import { ForceUpdateModal } from './components/modals/ForceUpdateModal';
import { CommandPaletteModal } from './components/modals/CommandPaletteModal';
import { UpdateNotificationBanner } from './components/layout/UpdateNotificationBanner';
import { LoadingScreen } from './components/ui/LoadingScreen';
import {
  MessageSquareText,
  Search,
  PanelLeft,
  Users,
  Shield,
} from 'lucide-react';

export const App: React.FC = () => {
  const { user, loading, setUser, token } = useAuth();
  const { socket, isConnected, isReconnecting, connectionError } = useSocket();
  const { joinVoiceChannel, currentVoiceChannel } = useVoice();

  const userRef = useRef(user);
  userRef.current = user;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const prevServerIdRef = useRef<string | null>(null);

  const [servers, setServers] = useState<Server[]>(() => getCachedServers());
  const [activeServerId, setActiveServerId] = useState<string | null>(() => {
    const cached = getCachedServers();
    return cached.length > 0 ? cached[0].id : null;
  });
  const [activeChannel, setActiveChannel] = useState<Channel | null>(() => {
    const cached = getCachedServers();
    if (cached.length === 0) return null;
    const details = getCachedServerDetails(cached[0].id) || cached[0];
    if (details?.channels && details.channels.length > 0) {
      return details.channels.find((c: Channel) => c.type === 'TEXT') || details.channels[0];
    }
    return null;
  });
  const [activeServerDetails, setActiveServerDetails] = useState<Server | null>(() => {
    const cached = getCachedServers();
    return cached.length > 0 ? getCachedServerDetails(cached[0].id) || cached[0] : null;
  });
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipantInfo[]>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<CustomRole[]>([]);

  // Modais
  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [createChannelType, setCreateChannelType] = useState<'TEXT' | 'VOICE'>('TEXT');

  // Estados do layout Linear Pro Studio
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Atalhos de teclado globais (Ctrl+K para Command Palette, Ctrl+B para Sidebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement | null;
        const isInput =
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable);
        if (isInput) return;

        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Estados de inicialização e prontidão do software
  const [isAppReady, setIsAppReady] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [startupTimedOut, setStartupTimedOut] = useState(false);
  const [startupRetryCount, setStartupRetryCount] = useState(0);
  const [initialServersLoaded, setInitialServersLoaded] = useState(() => getCachedServers().length > 0);
  const appMountTimeRef = useRef<number>(Date.now());

  const canAccessAdmin =
    user?.role === 'ADMIN' || Boolean(user?.customRole?.permissions?.includes('manage_users'));

  // Escutar atualizações de pendências do painel de administração via WebSocket
  useEffect(() => {
    if (!socket || !canAccessAdmin) return;

    socket.emit('admin:get-pending-count');

    const handlePendingCount = (data: { pendingCount?: number }) => {
      if (typeof data?.pendingCount === 'number') {
        setPendingApprovalsCount(data.pendingCount);
      }
    };

    socket.on('admin-pending-count', handlePendingCount);
    return () => {
      socket.off('admin-pending-count', handlePendingCount);
    };
  }, [socket, canAccessAdmin]);

  // Carregar servidores do usuário (com suporte a cache offline e retentativa automática na inicialização)
  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchServers() {
      try {
        const response = await api.get('/api/servers');
        if (!isMounted) return;
        const list: Server[] = response.data.servers || [];
        setServers(list);
        persistCachedServers(list);

        if (list.length > 0) {
          setActiveServerId((prev) => (prev && list.some((s) => s.id === prev) ? prev : list[0].id));
        }
      } catch (err) {
        console.warn('Falha ao carregar servidores (tentando novamente em 5s):', err);
        if (isMounted) {
          retryTimer = setTimeout(fetchServers, 5000);
        }
      } finally {
        if (isMounted) {
          setInitialServersLoaded(true);
        }
      }
    }

    fetchServers();

    if (socket) {
      socket.on('connect', fetchServers);
    }

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) {
        socket.off('connect', fetchServers);
      }
    };
  }, [user?.id, socket]);

  // Carregar detalhes do servidor ativo (membros e canais) com cache instantâneo e retentativa
  useEffect(() => {
    if (!activeServerId) {
      setActiveServerDetails(null);
      setActiveChannel(null);
      return;
    }

    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Exibir imediatamente os detalhes em cache enquanto busca do servidor
    const cachedDetails = getCachedServerDetails(activeServerId);
    if (cachedDetails) {
      setActiveServerDetails(cachedDetails);
      if (cachedDetails.channels && cachedDetails.channels.length > 0) {
        setActiveChannel((prev) => {
          if (prev && cachedDetails.channels.some((c: Channel) => c.id === prev.id)) {
            return prev;
          }
          return cachedDetails.channels.find((c: Channel) => c.type === 'TEXT') || cachedDetails.channels[0];
        });
      }
    }

    async function fetchServerDetails() {
      try {
        const response = await api.get(`/api/servers/${activeServerId}`);
        if (!isMounted) return;
        const server: Server = response.data.server;
        setActiveServerDetails(server);
        persistCachedServerDetails(server);

        // Selecionar o primeiro canal de texto por padrão se não houver um selecionado válido neste servidor
        if (server.channels && server.channels.length > 0) {
          setActiveChannel((prev) => {
            if (prev && server.channels.some((c: Channel) => c.id === prev.id)) {
              return prev;
            }
            return server.channels.find((c: Channel) => c.type === 'TEXT') || server.channels[0];
          });
        }

        // Carregar estado inicial de voz
        try {
          const voiceRes = await api.get(`/api/servers/${activeServerId}/voice-state`);
          if (isMounted && voiceRes.data.voiceState) {
            setVoiceParticipants(voiceRes.data.voiceState);
          }
        } catch {
          // Ignorar se endpoint de voz falhar
        }
      } catch (err) {
        console.warn('Falha ao carregar detalhes do servidor (tentando novamente em 5s):', err);
        if (isMounted) {
          retryTimer = setTimeout(fetchServerDetails, 5000);
        }
      }
    }

    fetchServerDetails();

    if (socket) {
      socket.on('connect', fetchServerDetails);
    }

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket) {
        socket.off('connect', fetchServerDetails);
      }
    };
  }, [activeServerId, socket]);

  // Sincronizar participantes de voz em tempo real e gerenciar entrada/saída de servidores
  useEffect(() => {
    if (!socket) return;

    if (!activeServerId) {
      if (prevServerIdRef.current) {
        socket.emit('leave-server', prevServerIdRef.current);
        prevServerIdRef.current = null;
      }
      return;
    }

    if (prevServerIdRef.current && prevServerIdRef.current !== activeServerId) {
      socket.emit('leave-server', prevServerIdRef.current);
    }
    prevServerIdRef.current = activeServerId;

    const joinCurrentServer = () => {
      socket.emit('join-server', activeServerId);
      if (currentVoiceChannel) {
        socket.emit('join-voice', {
          serverId: activeServerId,
          channelId: currentVoiceChannel.id,
        });
      }
    };

    joinCurrentServer();
    socket.on('connect', joinCurrentServer);

    const handleVoiceSync = (state: Record<string, VoiceParticipantInfo[]>) => {
      setVoiceParticipants(state);
    };

    const handleVoiceChannelUpdated = (data: { channelId: string; users: VoiceParticipantInfo[] }) => {
      setVoiceParticipants((prev) => ({
        ...prev,
        [data.channelId]: data.users,
      }));
    };

    const handleVoiceUserStateUpdated = (data: { channelId: string; userId: string; isMuted?: boolean; isDeafened?: boolean }) => {
      if (!data?.channelId || !data?.userId) return;
      setVoiceParticipants((prev) => {
        const channelList = prev[data.channelId];
        if (!channelList) return prev;
        return {
          ...prev,
          [data.channelId]: channelList.map((p) =>
            p.id === data.userId
              ? {
                  ...p,
                  isMuted: data.isMuted !== undefined ? Boolean(data.isMuted) : p.isMuted,
                  isDeafened: data.isDeafened !== undefined ? Boolean(data.isDeafened) : p.isDeafened,
                }
              : p
          ),
        };
      });
    };

    socket.on('voice-state-sync', handleVoiceSync);
    socket.on('voice-channel-updated', handleVoiceChannelUpdated);
    socket.on('voice-user-state-updated', handleVoiceUserStateUpdated);

    return () => {
      socket.off('connect', joinCurrentServer);
      socket.off('voice-state-sync', handleVoiceSync);
      socket.off('voice-channel-updated', handleVoiceChannelUpdated);
      socket.off('voice-user-state-updated', handleVoiceUserStateUpdated);
    };
  }, [socket, activeServerId, currentVoiceChannel]);

  // Sincronizar atualizações de perfil de usuários em tempo real via WebSocket
  useEffect(() => {
    if (!socket) return;
    const handleProfileUpdated = (data: { userId: string; username: string; avatarUrl?: string }) => {
      setActiveServerDetails((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.userId === data.userId
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    username: data.username,
                    avatarUrl: data.avatarUrl || m.user.avatarUrl,
                  },
                }
              : m
          ),
        };
      });
    };

    socket.on('user-profile-updated', handleProfileUpdated);
    return () => {
      socket.off('user-profile-updated', handleProfileUpdated);
    };
  }, [socket]);

  // Sincronizar usuários online em tempo real via WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleOnlineList = (ids: string[]) => {
      setOnlineUserIds(new Set(ids));
    };

    const handleStatusChanged = (data: { userId: string; status: 'online' | 'offline' }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.status === 'online') {
          next.add(data.userId);
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    };

    socket.on('online-users-list', handleOnlineList);
    socket.on('user-status-changed', handleStatusChanged);

    return () => {
      socket.off('online-users-list', handleOnlineList);
      socket.off('user-status-changed', handleStatusChanged);
    };
  }, [socket]);

  // Buscar cargos customizados do sistema
  const fetchRoles = useCallback(async () => {
    try {
      const res = await api.get('/api/roles');
      if (res.data?.success && Array.isArray(res.data.roles)) {
        setRoles(res.data.roles);
      }
    } catch (err) {
      console.warn('Não foi possível sincronizar lista de cargos:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchRoles();
    }
  }, [user, fetchRoles]);

  // Sincronizar atualizações de cargos e papéis em tempo real via WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleUserRoleUpdated = (data: {
      userId: string;
      role?: string;
      customRoleId: string | null;
      customRole: CustomRole | null;
    }) => {
      setActiveServerDetails((prev) => {
        if (!prev || !prev.members) return prev;
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.userId === data.userId || m.user.id === data.userId
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    role: (data.role as any) || m.user.role,
                    customRoleId: data.customRoleId,
                    customRole: data.customRole,
                  },
                }
              : m
          ),
        };
      });

      // Se for o próprio usuário logado, atualizar AuthContext e persistência local imediatamente sem stale closures
      setUser((currentUser) => {
        if (!currentUser || currentUser.id !== data.userId) return currentUser;
        const updatedUser: User = {
          ...currentUser,
          role: (data.role as any) || currentUser.role,
          customRoleId: data.customRoleId,
          customRole: data.customRole,
        };
        const activeToken = getAuthToken() || tokenRef.current;
        if (activeToken) {
          persistAuthSession(activeToken, updatedUser);
        }
        return updatedUser;
      });
    };

    const handleRoleCreated = (data: { role: CustomRole }) => {
      if (!data?.role) return;
      setRoles((prev) => {
        if (prev.some((r) => r.id === data.role.id)) return prev;
        return [...prev, data.role];
      });
    };

    const handleRoleUpdated = (data: { role: CustomRole }) => {
      if (!data?.role) return;
      setRoles((prev) =>
        prev.map((r) => (r.id === data.role.id ? data.role : r))
      );

      // Atualizar todos os membros em activeServerDetails que possuem esse cargo em tempo real!
      setActiveServerDetails((prev) => {
        if (!prev || !prev.members) return prev;
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.user.customRoleId === data.role.id || m.user.customRole?.id === data.role.id
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    customRole: data.role,
                  },
                }
              : m
          ),
        };
      });

      // Se o usuário logado possuir este cargo, atualizar suas permissões em tempo real sem stale closures!
      setUser((currentUser) => {
        if (!currentUser || (currentUser.customRoleId !== data.role.id && currentUser.customRole?.id !== data.role.id)) return currentUser;
        const updatedUser: User = {
          ...currentUser,
          customRole: data.role,
        };
        const activeToken = getAuthToken() || tokenRef.current;
        if (activeToken) {
          persistAuthSession(activeToken, updatedUser);
        }
        return updatedUser;
      });
    };

    const handleRoleDeleted = (data: { roleId: string }) => {
      if (!data?.roleId) return;
      setRoles((prev) => prev.filter((r) => r.id !== data.roleId));

      // Limpar cargo dos membros em activeServerDetails
      setActiveServerDetails((prev) => {
        if (!prev || !prev.members) return prev;
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.user.customRoleId === data.roleId || m.user.customRole?.id === data.roleId
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    customRoleId: null,
                    customRole: undefined,
                  },
                }
              : m
          ),
        };
      });

      setUser((currentUser) => {
        if (!currentUser || (currentUser.customRoleId !== data.roleId && currentUser.customRole?.id !== data.roleId)) return currentUser;
        const updatedUser: User = {
          ...currentUser,
          customRoleId: null,
          customRole: undefined,
        };
        const activeToken = getAuthToken() || tokenRef.current;
        if (activeToken) {
          persistAuthSession(activeToken, updatedUser);
        }
        return updatedUser;
      });
    };

    socket.on('user:role-updated', handleUserRoleUpdated);
    socket.on('role:created', handleRoleCreated);
    socket.on('role:updated', handleRoleUpdated);
    socket.on('role:deleted', handleRoleDeleted);

    return () => {
      socket.off('user:role-updated', handleUserRoleUpdated);
      socket.off('role:created', handleRoleCreated);
      socket.off('role:updated', handleRoleUpdated);
      socket.off('role:deleted', handleRoleDeleted);
    };
  }, [socket]);

  // Atribuir cargo customizado a um usuário
  const handleAssignCustomRole = async (userId: string, customRoleId: string | null) => {
    try {
      await api.patch(`/api/admin/users/${userId}/custom-role`, { customRoleId });
      const assignedRole = roles.find((r) => r.id === customRoleId) || null;
      setActiveServerDetails((prev) => {
        if (!prev || !prev.members) return prev;
        return {
          ...prev,
          members: prev.members.map((m) =>
            m.userId === userId || m.user.id === userId
              ? {
                  ...m,
                  user: {
                    ...m.user,
                    customRoleId,
                    customRole: assignedRole,
                  },
                }
              : m
          ),
        };
      });
    } catch (err: any) {
      console.error('Falha ao atribuir cargo ao usuário:', err);
    }
  };

  // Redirecionar para o chat geral (ou primeiro canal de texto disponível)
  const redirectToGeneralChat = useCallback(() => {
    if (!activeServerDetails?.channels || activeServerDetails.channels.length === 0) return;

    // Priorizar canal de texto com o nome 'geral' ou 'general'
    const generalChat =
      activeServerDetails.channels.find(
        (c: Channel) =>
          c.type === 'TEXT' &&
          (c.name.toLowerCase() === 'geral' ||
            c.name.toLowerCase() === 'general' ||
            c.name.toLowerCase().includes('geral'))
      ) ||
      activeServerDetails.channels.find((c: Channel) => c.type === 'TEXT') ||
      activeServerDetails.channels[0];

    if (generalChat) {
      setActiveChannel(generalChat);
    }
  }, [activeServerDetails]);

  // Efeito 1: Transição de conectado -> desconectado da chamada de voz
  const prevVoiceChannelRef = useRef<Channel | null>(null);
  useEffect(() => {
    if (prevVoiceChannelRef.current && !currentVoiceChannel) {
      redirectToGeneralChat();
    }
    prevVoiceChannelRef.current = currentVoiceChannel;
  }, [currentVoiceChannel, redirectToGeneralChat]);

  // Efeito 2: Quando não estiver em nenhum canal (activeChannel é null), redirecionar automaticamente para o chat geral
  useEffect(() => {
    if (!activeChannel && activeServerDetails?.channels && activeServerDetails.channels.length > 0) {
      redirectToGeneralChat();
    }
  }, [activeChannel, activeServerDetails, redirectToGeneralChat]);

  // Efeito 3: Auto-reconexão no canal de voz após reload limpo da janela (Ctrl+R / F5)
  const autoReconnectedVoiceRef = useRef(false);
  useEffect(() => {
    if (
      autoReconnectedVoiceRef.current ||
      !activeServerDetails?.channels ||
      activeServerDetails.channels.length === 0
    ) {
      return;
    }

    try {
      const raw = sessionStorage.getItem('xolas_auto_reconnect_voice');
      if (raw) {
        sessionStorage.removeItem('xolas_auto_reconnect_voice');
        const parsed = JSON.parse(raw);
        if (parsed?.channel?.id && Date.now() - (parsed.timestamp || 0) < 30000) {
          const target = activeServerDetails.channels.find(
            (c: Channel) => c.id === parsed.channel.id && c.type === 'VOICE'
          );
          if (target) {
            autoReconnectedVoiceRef.current = true;
            setActiveChannel(target);
            joinVoiceChannel(target);
          }
        }
      }
    } catch (err) {
      console.warn('[App] Falha na auto-reconexão após reload:', err);
    }
  }, [activeServerDetails, joinVoiceChannel]);

  // Enviar mensagem de chat via WebSocket
  const handleSendMessage = (content: string, attachmentUrl?: string) => {
    if (!activeChannel || !socket) return;
    socket.emit('send-message', {
      channelId: activeChannel.id,
      content,
      attachmentUrl,
    });
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannel(channel);
    if (channel.type === 'VOICE') {
      joinVoiceChannel(channel);
    }
  };

  // Transição de prontidão: WebSocket conectado e dados iniciais prontos
  useEffect(() => {
    if (!user || isAppReady) return;

    if (isConnected && initialServersLoaded) {
      setStartupTimedOut(false);
      // Garantir pelo menos 800ms de exibição da animação para um feedback visual polido sem flicker
      const elapsed = Date.now() - appMountTimeRef.current;
      const minDisplayTime = 800;
      const delay = Math.max(0, minDisplayTime - elapsed);

      let readyTimer: ReturnType<typeof setTimeout> | null = null;
      const fadeTimer = setTimeout(() => {
        setIsFadingOut(true);
        readyTimer = setTimeout(() => {
          setIsAppReady(true);
        }, 300);
      }, delay);

      return () => {
        clearTimeout(fadeTimer);
        if (readyTimer) clearTimeout(readyTimer);
      };
    }
  }, [user, isConnected, initialServersLoaded, isAppReady]);

  // Timeout de 10 segundos na inicialização para evitar travamento em caso de offline
  useEffect(() => {
    if (!user || isAppReady) return;

    const timer = setTimeout(() => {
      setStartupTimedOut(true);
    }, 10000);

    return () => clearTimeout(timer);
  }, [user, isAppReady, startupRetryCount]);

  // Resetar estados de prontidão quando o usuário deslogar
  useEffect(() => {
    if (!user) {
      setIsAppReady(false);
      setIsFadingOut(false);
      setStartupTimedOut(false);
      appMountTimeRef.current = Date.now();
    }
  }, [user]);

  // Retentativa manual de conexão pelo botão do erro de timeout
  const handleRetryStartup = useCallback(() => {
    setStartupTimedOut(false);
    appMountTimeRef.current = Date.now();
    setStartupRetryCount((c) => c + 1);
    if (socket && !socket.connected) {
      socket.connect();
    }
    api.get('/api/servers')
      .then((res) => {
        const list: Server[] = res.data?.servers || [];
        setServers(list);
        persistCachedServers(list);
        setInitialServersLoaded(true);
      })
      .catch((err) => {
        console.warn('[Startup] Falha na retentativa de carregar servidores:', err);
      });
  }, [socket]);

  // Continuar em modo offline se o usuário desejar entrar sem esperar conexão
  const handleContinueOffline = useCallback(() => {
    setIsFadingOut(true);
    setTimeout(() => {
      setIsAppReady(true);
    }, 300);
  }, []);

  // Obter texto dinâmico de status na inicialização
  const getStartupStatusMessage = () => {
    if (loading) return 'Validando credenciais...';
    if (!isConnected) return 'Conectando ao servidor...';
    if (!initialServersLoaded) return 'Sincronizando espaços e canais...';
    return 'Iniciando o Xolas...';
  };

  if (loading) {
    return <LoadingScreen fullscreen size="md" statusMessage="Validando credenciais..." />;
  }

  return (
    <>
      {!user ? (
        <AuthModal />
      ) : (
        <>
          <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 font-sans antialiased overflow-hidden select-none">
            {/* 1. Header Superior Linear Pro Studio (h-12) */}
            <header className="h-12 border-b border-zinc-800 bg-zinc-900/90 px-4 flex items-center justify-between shrink-0 z-20">
              {/* Esquerda: Logo Xolas & Nome do Workspace */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-zinc-700 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span>Xolas Desktop</span>
                </div>
                {activeServerDetails && (
                  <span className="text-xs font-semibold text-zinc-300 hidden md:inline truncate max-w-[180px]">
                    {activeServerDetails.name}
                  </span>
                )}
              </div>

              {/* Centro: Barra de Busca Global / Command Palette Trigger */}
              <div
                onClick={() => setCommandPaletteOpen(true)}
                className="w-72 md:w-96 flex items-center justify-between px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800/80 border border-zinc-800 text-zinc-400 text-xs cursor-pointer transition-all hover:border-zinc-700 shadow-sm"
                title="Buscar discussões, canais ou comandos (Ctrl+K)"
              >
                <div className="flex items-center gap-2 truncate">
                  <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="truncate text-zinc-500 text-[11px]">
                    Buscar discussões, canais ou comandos...
                  </span>
                </div>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-400 shrink-0">
                  Ctrl + K
                </kbd>
              </div>

              {/* Direita: Ações de Utilidade (Admin, Toggle Sidebar, Membros) */}
              <div className="flex items-center gap-2 shrink-0">
                {canAccessAdmin && (
                  <button
                    onClick={() => setIsAdminModalOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 transition-colors"
                    title="Painel de Administração"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Admin</span>
                    {pendingApprovalsCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                        {pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}
                      </span>
                    )}
                  </button>
                )}

                <button
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  className={`p-1.5 rounded-md transition-colors ${
                    sidebarOpen ? 'bg-zinc-800 text-white' : 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Alternar Barra Lateral (Ctrl+B)"
                >
                  <PanelLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setMembersDrawerOpen(!membersDrawerOpen)}
                  className={`p-1.5 rounded-md transition-colors ${
                    membersDrawerOpen ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                  title="Participantes"
                >
                  <Users className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* 2. Área Principal: Sidebar Unificada + Palco Central + Drawer de Membros */}
            <div className="flex flex-1 overflow-hidden relative">
              {/* Backdrops responsivos para mobile (< md / 768px) */}
              {sidebarOpen && (
                <div
                  className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs animate-in fade-in duration-150"
                  onClick={() => setSidebarOpen(false)}
                />
              )}
              {membersDrawerOpen && (
                <div
                  className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-xs animate-in fade-in duration-150"
                  onClick={() => setMembersDrawerOpen(false)}
                />
              )}

              {sidebarOpen && (
                <ChannelSidebar
                  server={activeServerDetails}
                  servers={servers}
                  activeChannelId={activeChannel?.id || null}
                  voiceParticipants={voiceParticipants}
                  onSelectChannel={handleSelectChannel}
                  onDisconnectVoice={redirectToGeneralChat}
                  onOpenCreateChannelModal={(type) => {
                    setCreateChannelType(type);
                    setIsCreateChannelOpen(true);
                  }}
                  roles={roles}
                  onAssignCustomRole={handleAssignCustomRole}
                  onSelectServer={(id) => setActiveServerId(id)}
                  onOpenCreateServerModal={() => setIsCreateServerOpen(true)}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  onOpenCommandPalette={() => setCommandPaletteOpen(true)}
                  onClose={() => setSidebarOpen(false)}
                />
              )}

              {/* Palco Central: Chat ou Estúdio de Voz */}
              <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 relative overflow-hidden">
                {activeChannel ? (
                  <>
                    <ChatHeader
                      channel={activeChannel}
                      onToggleMembersDrawer={() => setMembersDrawerOpen(!membersDrawerOpen)}
                      membersCount={activeServerDetails?.members?.length || 0}
                      isMembersDrawerOpen={membersDrawerOpen}
                      onOpenSearch={() => setCommandPaletteOpen(true)}
                    />
                    {activeChannel.type === 'VOICE' ? (
                      <VoiceRoom
                        channel={activeChannel}
                        onDisconnect={redirectToGeneralChat}
                        socketParticipants={voiceParticipants[activeChannel.id] || []}
                      />
                    ) : (
                      <>
                        <MessageArea channel={activeChannel} />
                        <ChatInput
                          channelName={activeChannel.name}
                          onSendMessage={handleSendMessage}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-zinc-500">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-indigo-400 mb-3 shadow-sm">
                      <MessageSquareText className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-bold text-zinc-200 mb-1">Nenhum canal ativo</h3>
                    <p className="text-xs max-w-xs text-zinc-400">
                      Selecione um canal na barra lateral para iniciar a transmissão ou conversa.
                    </p>
                  </div>
                )}
              </main>

              {/* Gaveta de Membros Retrátil */}
              {membersDrawerOpen && activeServerDetails && (
                <MemberList
                  members={activeServerDetails.members || []}
                  onlineUserIds={onlineUserIds}
                  server={activeServerDetails}
                  voiceParticipants={voiceParticipants}
                  roles={roles}
                  onAssignCustomRole={handleAssignCustomRole}
                  onClose={() => setMembersDrawerOpen(false)}
                />
              )}
            </div>

            {/* Modais do Sistema */}
            <CommandPaletteModal
              isOpen={commandPaletteOpen}
              onClose={() => setCommandPaletteOpen(false)}
              channels={activeServerDetails?.channels || []}
              onSelectChannel={handleSelectChannel}
              servers={servers}
              activeServerId={activeServerId}
              onSelectServer={(id) => setActiveServerId(id)}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onOpenAdmin={() => setIsAdminModalOpen(true)}
              isAdmin={canAccessAdmin}
              onOpenCreateChannel={() => {
                setCreateChannelType('TEXT');
                setIsCreateChannelOpen(true);
              }}
            />

            <CreateServerModal
              isOpen={isCreateServerOpen}
              onClose={() => setIsCreateServerOpen(false)}
              onServerCreated={(newServer) => {
                setServers((prev) => {
                  const next = [...prev, newServer];
                  persistCachedServers(next);
                  return next;
                });
                setActiveServerId(newServer.id);
              }}
            />

            {activeServerDetails && (
              <CreateChannelModal
                isOpen={isCreateChannelOpen}
                serverId={activeServerDetails.id}
                initialType={createChannelType}
                onClose={() => setIsCreateChannelOpen(false)}
                onChannelCreated={(newChannel) => {
                  setActiveServerDetails((prev) => {
                    if (!prev) return null;
                    const updated = {
                      ...prev,
                      channels: [...prev.channels, newChannel],
                    };
                    persistCachedServerDetails(updated);
                    return updated;
                  });
                  setActiveChannel(newChannel);
                  if (newChannel.type === 'VOICE') {
                    joinVoiceChannel(newChannel);
                  }
                }}
              />
            )}

            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={() => setIsSettingsOpen(false)}
            />

            <AdminModal
              isOpen={isAdminModalOpen}
              onClose={() => setIsAdminModalOpen(false)}
              onPendingCountChange={setPendingApprovalsCount}
            />
          </div>

        {/* Animação de entrada e carregamento no startup (overlay fluido até estar pronto) */}
        {!isAppReady && (
          <LoadingScreen
            fullscreen
            size="md"
            statusMessage={getStartupStatusMessage()}
            errorState={
              startupTimedOut
                ? {
                    message: 'Não foi possível conectar ao servidor no momento.',
                    onRetry: handleRetryStartup,
                    onContinueOffline: handleContinueOffline,
                  }
                : null
            }
            isFadingOut={isFadingOut}
          />
        )}
      </>
    )}

      {/* Modal de Atualização Obrigatória para usuários deslogados */}
      <ForceUpdateModal isLoggedIn={Boolean(user)} />

      {/* Banner Flutuante de Atualização Automática para usuários logados */}
      <UpdateNotificationBanner />
    </>
  );
};

export default App;

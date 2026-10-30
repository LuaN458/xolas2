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
} from './lib/authStorage';
import { Server, Channel, CustomRole } from './types';

import { ServerSidebar } from './components/layout/ServerSidebar';
import { ChannelSidebar, VoiceParticipantInfo } from './components/layout/ChannelSidebar';
import { UserControlsFooter } from './components/layout/UserControlsFooter';
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
import { UpdateNotificationBanner } from './components/layout/UpdateNotificationBanner';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { MessageSquareText } from 'lucide-react';

export const App: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket } = useSocket();
  const { joinVoiceChannel, currentVoiceChannel } = useVoice();

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

  // Sincronizar participantes de voz em tempo real
  useEffect(() => {
    if (!socket || !activeServerId) return;

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

    socket.on('voice-state-sync', handleVoiceSync);
    socket.on('voice-channel-updated', handleVoiceChannelUpdated);

    return () => {
      socket.off('connect', joinCurrentServer);
      socket.off('voice-state-sync', handleVoiceSync);
      socket.off('voice-channel-updated', handleVoiceChannelUpdated);
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

  // Sincronizar usuários online e novos membros em tempo real via WebSocket
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

    const handleMemberJoined = (data: { serverId: string; member: any }) => {
      setActiveServerDetails((prev) => {
        if (!prev || prev.id !== data.serverId) return prev;
        if (prev.members.some((m) => m.userId === data.member.userId)) return prev;
        return {
          ...prev,
          members: [...prev.members, data.member],
        };
      });
    };

    socket.on('online-users-list', handleOnlineList);
    socket.on('user-status-changed', handleStatusChanged);
    socket.on('member-joined', handleMemberJoined);

    return () => {
      socket.off('online-users-list', handleOnlineList);
      socket.off('user-status-changed', handleStatusChanged);
      socket.off('member-joined', handleMemberJoined);
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
                    customRoleId: data.customRoleId,
                    customRole: data.customRole,
                  },
                }
              : m
          ),
        };
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
    };

    const handleRoleDeleted = (data: { roleId: string }) => {
      if (!data?.roleId) return;
      setRoles((prev) => prev.filter((r) => r.id !== data.roleId));
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

  // Enviar mensagem de chat via WebSocket
  const handleSendMessage = (content: string) => {
    if (!activeChannel || !socket) return;
    socket.emit('send-message', {
      channelId: activeChannel.id,
      content,
    });
  };

  const handleSelectChannel = (channel: Channel) => {
    setActiveChannel(channel);
    if (channel.type === 'VOICE') {
      joinVoiceChannel(channel);
    }
  };

  if (loading) {
    return <LoadingScreen fullscreen size="md" />;
  }

  return (
    <>
      {!user ? (
        <AuthModal />
      ) : (
        <div className="h-screen w-screen flex bg-obsidian-bg overflow-hidden font-sans text-obsidian-text-primary antialiased">
          {/* 1. Dock Lateral de Espaços (Linear Style) */}
          <ServerSidebar
            servers={servers}
            activeServerId={activeServerId}
            onSelectServer={(id) => setActiveServerId(id)}
            onOpenCreateModal={() => setIsCreateServerOpen(true)}
            isAdmin={canAccessAdmin}
            pendingApprovalsCount={pendingApprovalsCount}
            onOpenAdminModal={() => setIsAdminModalOpen(true)}
          />

          {/* 2. Barra Lateral de Canais + Perfil de Usuário Ancorado na Base */}
          <div className="w-72 bg-obsidian-surface flex flex-col h-full shrink-0 border-r border-obsidian-border justify-between">
            <ChannelSidebar
              server={activeServerDetails}
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
            />
            <UserControlsFooter onOpenSettings={() => setIsSettingsOpen(true)} />
          </div>

          {/* 3. Área Central (Discussão ou Estúdio de Voz) */}
          <main className="flex-1 flex flex-col min-w-0 bg-obsidian-bg relative">
            {activeChannel ? (
              <>
                <ChatHeader channel={activeChannel} />
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
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-obsidian-text-muted">
                <div className="w-12 h-12 rounded-2xl bg-obsidian-card border border-obsidian-border flex items-center justify-center text-obsidian-accent mb-3">
                  <MessageSquareText className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-obsidian-text-primary mb-1">Nenhum canal ativo</h3>
                <p className="text-xs max-w-xs text-obsidian-text-muted">
                  Selecione um canal na barra lateral para iniciar a transmissão ou conversa.
                </p>
              </div>
            )}
          </main>

          {/* 4. Barra Lateral de Participantes (apenas em canais de texto) */}
          {activeServerDetails && activeChannel?.type === 'TEXT' && (
            <MemberList
              members={activeServerDetails.members || []}
              onlineUserIds={onlineUserIds}
              server={activeServerDetails}
              voiceParticipants={voiceParticipants}
              roles={roles}
              onAssignCustomRole={handleAssignCustomRole}
            />
          )}

          {/* Modais */}
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

          {/* Modal de Configurações (Apelido & Microfone) */}
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />

          {/* Modal de Administração (Aprovação / Recusa / Moderação) */}
          <AdminModal
            isOpen={isAdminModalOpen}
            onClose={() => setIsAdminModalOpen(false)}
            onPendingCountChange={setPendingApprovalsCount}
          />
        </div>
      )}

      {/* Modal de Atualização Obrigatória para usuários deslogados */}
      <ForceUpdateModal isLoggedIn={Boolean(user)} />

      {/* Banner Flutuante de Atualização Automática para usuários logados */}
      <UpdateNotificationBanner />
    </>
  );
};

export default App;

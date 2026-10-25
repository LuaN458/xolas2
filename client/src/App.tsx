import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSocket } from './contexts/SocketContext';
import { useVoice } from './contexts/VoiceContext';
import { api } from './lib/api';
import { Server, Channel } from './types';

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
import { MessageSquareText } from 'lucide-react';

export const App: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket } = useSocket();
  const { joinVoiceChannel, currentVoiceChannel } = useVoice();

  const [servers, setServers] = useState<Server[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [activeServerDetails, setActiveServerDetails] = useState<Server | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Record<string, VoiceParticipantInfo[]>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  // Modais
  const [isCreateServerOpen, setIsCreateServerOpen] = useState(false);
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [createChannelType, setCreateChannelType] = useState<'TEXT' | 'VOICE'>('TEXT');

  // Escutar atualizações de pendências do painel de administração via WebSocket
  useEffect(() => {
    if (!socket || user?.role !== 'ADMIN') return;

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
  }, [socket, user?.role]);

  // Carregar servidores do usuário
  useEffect(() => {
    if (!user) return;

    async function fetchServers() {
      try {
        const response = await api.get('/api/servers');
        const list = response.data.servers;
        setServers(list);

        if (list.length > 0 && !activeServerId) {
          setActiveServerId(list[0].id);
        }
      } catch (err) {
        console.error('Falha ao carregar servidores:', err);
      }
    }

    fetchServers();
  }, [user]);

  // Carregar detalhes do servidor ativo (membros e canais)
  useEffect(() => {
    if (!activeServerId) {
      setActiveServerDetails(null);
      setActiveChannel(null);
      return;
    }

    async function fetchServerDetails() {
      try {
        const response = await api.get(`/api/servers/${activeServerId}`);
        const server = response.data.server;
        setActiveServerDetails(server);

        // Selecionar o primeiro canal de texto por padrão se não houver um selecionado
        if (server.channels && server.channels.length > 0) {
          const defaultChannel =
            server.channels.find((c: Channel) => c.type === 'TEXT') || server.channels[0];
          setActiveChannel(defaultChannel);
        }

        // Carregar estado inicial de voz
        try {
          const voiceRes = await api.get(`/api/servers/${activeServerId}/voice-state`);
          if (voiceRes.data.voiceState) {
            setVoiceParticipants(voiceRes.data.voiceState);
          }
        } catch {
          // Ignorar se endpoint de voz falhar
        }
      } catch (err) {
        console.error('Falha ao carregar detalhes do servidor:', err);
      }
    }

    fetchServerDetails();
  }, [activeServerId]);

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
    return (
      <div className="h-screen w-screen bg-obsidian-bg flex items-center justify-center text-obsidian-text-muted">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-2 border-obsidian-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Conectando ao Xolas...</span>
        </div>
      </div>
    );
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
            isAdmin={user?.role === 'ADMIN'}
            pendingApprovalsCount={pendingApprovalsCount}
            onOpenAdminModal={() => setIsAdminModalOpen(true)}
          />

          {/* 2. Barra Lateral de Canais + Perfil de Usuário Ancorado na Base */}
          <div className="w-64 bg-obsidian-surface flex flex-col h-full shrink-0 border-r border-obsidian-border justify-between">
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
            />
          )}

          {/* Modais */}
          <CreateServerModal
            isOpen={isCreateServerOpen}
            onClose={() => setIsCreateServerOpen(false)}
            onServerCreated={(newServer) => {
              setServers((prev) => [...prev, newServer]);
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
                  return {
                    ...prev,
                    channels: [...prev.channels, newChannel],
                  };
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

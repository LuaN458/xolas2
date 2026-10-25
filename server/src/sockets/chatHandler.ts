import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface VoiceParticipant {
  id: string;
  username: string;
  avatarUrl?: string;
  isMuted?: boolean;
  isSpeaking?: boolean;
  isScreenSharing?: boolean;
  screenStreamId?: string | null;
}

// Map<channelId, Map<userId, VoiceParticipant>>
export const voiceRooms = new Map<string, Map<string, VoiceParticipant>>();

// Rastreamento de usuários online conectados: Map<userId, Set<socketId>>
export const userSockets = new Map<string, Set<string>>();

export function isUserOnline(userId: string): boolean {
  return (userSockets.get(userId)?.size || 0) > 0;
}

export function getOnlineUserIds(): string[] {
  return Array.from(userSockets.keys()).filter((id) => (userSockets.get(id)?.size || 0) > 0);
}

export function getChannelVoiceParticipants(channelId: string): VoiceParticipant[] {
  const room = voiceRooms.get(channelId);
  return room ? Array.from(room.values()) : [];
}

export function getAllVoiceState(): Record<string, VoiceParticipant[]> {
  const result: Record<string, VoiceParticipant[]> = {};
  for (const [channelId, userMap] of voiceRooms.entries()) {
    result[channelId] = Array.from(userMap.values());
  }
  return result;
}

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    username: string;
    email: string;
  };
  currentVoice?: {
    serverId: string;
    channelId: string;
  };
}

export function setupSocketHandlers(io: Server): void {
  // Middleware de autenticação Socket.io
  io.use((socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('Autenticação necessária para WebSocket'));
    }

    try {
      const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
      const decoded = jwt.verify(token, secret) as {
        userId: string;
        username: string;
        email: string;
      };
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) return;

    const userId = user.userId;
    const isFirstConnection = !userSockets.has(userId) || userSockets.get(userId)!.size === 0;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    if (isFirstConnection) {
      io.emit('user-status-changed', { userId, status: 'online' });
    }

    // Enviar lista de usuários online imediatamente para quem acabou de conectar
    socket.emit('online-users-list', getOnlineUserIds());

    // Entrar em uma sala de canal de texto
    socket.on('join-channel', (channelId: string) => {
      socket.join(`channel:${channelId}`);
    });

    socket.on('leave-channel', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    // Enviar mensagem em tempo real
    socket.on('send-message', async (data: { channelId: string; content: string }) => {
      try {
        const { channelId, content } = data;
        if (!content || !content.trim()) return;

        const message = await prisma.message.create({
          data: {
            content: content.trim(),
            channelId,
            userId: user.userId,
          },
          include: {
            user: {
              select: { id: true, username: true, avatarUrl: true },
            },
          },
        });

        // Difundir para todos os membros na sala do canal
        io.to(`channel:${channelId}`).emit('new-message', message);
      } catch (err) {
        console.error('Erro ao enviar mensagem via socket:', err);
      }
    });

    // Notificação de digitação
    socket.on('typing', (data: { channelId: string; isTyping: boolean }) => {
      socket.to(`channel:${data.channelId}`).emit('user-typing', {
        userId: user.userId,
        username: user.username,
        isTyping: data.isTyping,
      });
    });

    // Auxiliar para enviar evento diretamente a todos os sockets de um usuário específico
    const sendToUser = (targetUserId: string, event: string, payload: any) => {
      const targetSocketIds = userSockets.get(targetUserId);
      if (targetSocketIds) {
        targetSocketIds.forEach((sid) => {
          io.to(sid).emit(event, payload);
        });
      }
    };

    // Função auxiliar para remover usuário de canal de voz
    const removeUserFromVoice = (channelId: string, serverId: string) => {
      socket.leave(`voice:${channelId}`);
      const room = voiceRooms.get(channelId);
      if (room) {
        room.delete(user.userId);
        if (room.size === 0) {
          voiceRooms.delete(channelId);
        }
      }
      io.to(`voice:${channelId}`).emit('voice-peer-left', {
        channelId,
        userId: user.userId,
      });
      const updatedUsers = getChannelVoiceParticipants(channelId);
      io.to(`server:${serverId}`).emit('voice-channel-updated', {
        channelId,
        users: updatedUsers,
        participants: updatedUsers,
      });
    };

    // Conectar em canal de voz
    socket.on('join-voice', async (data: { serverId: string; channelId: string }) => {
      const { serverId, channelId } = data;

      // Se já estava em outro canal de voz, sai dele antes
      if (socket.currentVoice && socket.currentVoice.channelId !== channelId) {
        removeUserFromVoice(socket.currentVoice.channelId, socket.currentVoice.serverId);
      }

      // Buscar avatar atualizado do usuário
      const dbUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, username: true, avatarUrl: true },
      });

      const existingRoom = voiceRooms.get(channelId);
      const existingEntry = existingRoom?.get(user.userId);

      const participant: VoiceParticipant = {
        id: user.userId,
        username: dbUser?.username || user.username,
        avatarUrl: dbUser?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`,
        isMuted: existingEntry?.isMuted ?? false,
        isSpeaking: existingEntry?.isSpeaking ?? false,
        isScreenSharing: existingEntry?.isScreenSharing ?? false,
        screenStreamId: existingEntry?.screenStreamId ?? null,
      };

      if (!voiceRooms.has(channelId)) {
        voiceRooms.set(channelId, new Map());
      }
      voiceRooms.get(channelId)!.set(user.userId, participant);

      socket.currentVoice = { serverId, channelId };
      socket.join(`voice:${channelId}`);

      const updatedUsers = getChannelVoiceParticipants(channelId);

      // Notificar demais participantes da sala de voz para iniciar negociação WebRTC
      socket.to(`voice:${channelId}`).emit('voice-peer-joined', {
        channelId,
        peer: participant,
        participant,
      });

      // Notifica todos no servidor (inclusive o próprio usuário)
      io.to(`server:${serverId}`).emit('voice-channel-updated', {
        channelId,
        users: updatedUsers,
        participants: updatedUsers,
      });
    });

    // Sair de canal de voz
    socket.on('leave-voice', (data: { serverId: string; channelId: string }) => {
      const { serverId, channelId } = data;
      removeUserFromVoice(channelId, serverId);
      socket.currentVoice = undefined;
    });

    // Sinalização WebRTC Ponto-a-Ponto (Voz + Transmissão de Tela)
    socket.on(
      'webrtc-offer',
      (data: { toUserId?: string; targetUserId?: string; channelId: string; sdp: any; screenStreamId?: string | null }) => {
        const targetId = data?.toUserId || data?.targetUserId;
        if (!targetId || !data?.sdp) return;
        sendToUser(targetId, 'webrtc-offer', {
          fromUserId: user.userId,
          fromUsername: user.username,
          channelId: data.channelId,
          sdp: data.sdp,
          screenStreamId: data.screenStreamId || null,
        });
      }
    );

    socket.on(
      'webrtc-answer',
      (data: { toUserId?: string; targetUserId?: string; channelId: string; sdp: any; screenStreamId?: string | null }) => {
        const targetId = data?.toUserId || data?.targetUserId;
        if (!targetId || !data?.sdp) return;
        sendToUser(targetId, 'webrtc-answer', {
          fromUserId: user.userId,
          fromUsername: user.username,
          channelId: data.channelId,
          sdp: data.sdp,
          screenStreamId: data.screenStreamId || null,
        });
      }
    );

    socket.on(
      'webrtc-ice-candidate',
      (data: { toUserId?: string; targetUserId?: string; channelId: string; candidate: any }) => {
        const targetId = data?.toUserId || data?.targetUserId;
        if (!targetId || !data?.candidate) return;
        sendToUser(targetId, 'webrtc-ice-candidate', {
          fromUserId: user.userId,
          channelId: data.channelId,
          candidate: data.candidate,
        });
      }
    );

    socket.on(
      'voice-user-state',
      (data: {
        channelId: string;
        serverId?: string;
        isMuted?: boolean;
        isSpeaking?: boolean;
        isScreenSharing?: boolean;
        screenStreamId?: string | null;
      }) => {
        if (!data?.channelId) return;
        const room = voiceRooms.get(data.channelId);
        if (room && room.has(user.userId)) {
          const p = room.get(user.userId)!;
          if (data.isMuted !== undefined) p.isMuted = data.isMuted;
          if (data.isSpeaking !== undefined) p.isSpeaking = data.isSpeaking;
          if (data.isScreenSharing !== undefined) p.isScreenSharing = data.isScreenSharing;
          if (data.screenStreamId !== undefined) p.screenStreamId = data.screenStreamId;
        }

        const statePayload = {
          channelId: data.channelId,
          userId: user.userId,
          username: user.username,
          isMuted: data.isMuted,
          isSpeaking: data.isSpeaking,
          isScreenSharing: data.isScreenSharing,
          screenStreamId: data.screenStreamId,
        };

        // Notificar tanto os membros no canal de voz quanto no servidor
        socket.to(`voice:${data.channelId}`).emit('voice-user-state-updated', statePayload);

        const targetServerId = data.serverId || socket.currentVoice?.serverId;
        if (targetServerId) {
          io.to(`server:${targetServerId}`).emit('voice-user-state-updated', statePayload);
        }
      }
    );

    // Atualização de perfil em tempo real
    socket.on('update-profile', (data: { username: string; avatarUrl?: string }) => {
      // Se o usuário estiver conectado em algum canal de voz, atualiza o nome lá também
      if (socket.currentVoice) {
        const room = voiceRooms.get(socket.currentVoice.channelId);
        if (room && room.has(user.userId)) {
          const participant = room.get(user.userId)!;
          participant.username = data.username;
          if (data.avatarUrl) participant.avatarUrl = data.avatarUrl;
          io.to(`server:${socket.currentVoice.serverId}`).emit('voice-channel-updated', {
            channelId: socket.currentVoice.channelId,
            users: getChannelVoiceParticipants(socket.currentVoice.channelId),
          });
        }
      }

      io.emit('user-profile-updated', {
        userId: user.userId,
        username: data.username,
        avatarUrl: data.avatarUrl,
      });
    });

    // Entrar na sala do servidor para receber eventos globais (canais, presenças)
    socket.on('join-server', (serverId: string) => {
      socket.join(`server:${serverId}`);
      // Enviar lista atual de usuários online e estado de voz
      socket.emit('online-users-list', getOnlineUserIds());
      socket.emit('voice-state-sync', getAllVoiceState());
    });

    socket.on('disconnect', () => {
      // Limpar presença de voz ao fechar a janela ou desconectar
      if (socket.currentVoice) {
        removeUserFromVoice(socket.currentVoice.channelId, socket.currentVoice.serverId);
        socket.currentVoice = undefined;
      }

      // Atualizar lista de sockets do usuário e notificar offline se desconectou todos
      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
          io.emit('user-status-changed', { userId, status: 'offline' });
        }
      }
    });
  });
}

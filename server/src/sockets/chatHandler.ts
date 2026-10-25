import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';

export interface VoiceParticipant {
  id: string;
  username: string;
  avatarUrl?: string;
}

// Map<channelId, Map<userId, VoiceParticipant>>
export const voiceRooms = new Map<string, Map<string, VoiceParticipant>>();

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

    // Função auxiliar para remover usuário de canal de voz
    const removeUserFromVoice = (channelId: string, serverId: string) => {
      const room = voiceRooms.get(channelId);
      if (room) {
        room.delete(user.userId);
        if (room.size === 0) {
          voiceRooms.delete(channelId);
        }
      }
      const updatedUsers = getChannelVoiceParticipants(channelId);
      io.to(`server:${serverId}`).emit('voice-channel-updated', {
        channelId,
        users: updatedUsers,
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

      const participant: VoiceParticipant = {
        id: user.userId,
        username: dbUser?.username || user.username,
        avatarUrl: dbUser?.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`,
      };

      if (!voiceRooms.has(channelId)) {
        voiceRooms.set(channelId, new Map());
      }
      voiceRooms.get(channelId)!.set(user.userId, participant);

      socket.currentVoice = { serverId, channelId };

      const updatedUsers = getChannelVoiceParticipants(channelId);
      // Notifica todos no servidor (inclusive o próprio usuário)
      io.to(`server:${serverId}`).emit('voice-channel-updated', {
        channelId,
        users: updatedUsers,
      });
    });

    // Sair de canal de voz
    socket.on('leave-voice', (data: { serverId: string; channelId: string }) => {
      const { serverId, channelId } = data;
      removeUserFromVoice(channelId, serverId);
      socket.currentVoice = undefined;
    });

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
      // Enviar estado de voz atual para o usuário que acabou de carregar o servidor
      socket.emit('voice-state-sync', getAllVoiceState());
    });

    socket.on('disconnect', () => {
      // Limpar presença de voz ao fechar a janela ou desconectar
      if (socket.currentVoice) {
        removeUserFromVoice(socket.currentVoice.channelId, socket.currentVoice.serverId);
        socket.currentVoice = undefined;
      }
    });
  });
}

import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import {
  ensureScalarString,
  isValidIdentifier,
  sanitizeSafeUrl,
  sanitizeText,
} from '../middlewares/security';

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

let globalIO: Server | null = null;

export function getGlobalIO(): Server | null {
  return globalIO;
}

export async function notifyAdminsPendingUpdate(): Promise<void> {
  if (!globalIO) return;
  try {
    const pendingCount = await prisma.user.count({
      where: { approvalStatus: 'PENDING' },
    });
    globalIO.to('admin-room').emit('admin-pending-count', { pendingCount });
  } catch (err) {
    console.warn('Erro ao notificar administradores sobre pendências:', err);
  }
}

export function notifyUserApprovalStatus(userId: string, payload: { status: string; user?: any }): void {
  if (!globalIO) return;
  const targetSocketIds = userSockets.get(userId);
  if (targetSocketIds) {
    targetSocketIds.forEach((sid) => {
      globalIO!.to(sid).emit('user-approval-status', payload);
    });
  }
}

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    username: string;
    email: string;
    role?: string;
  };
  currentVoice?: {
    serverId: string;
    channelId: string;
  };
}

export function setupSocketHandlers(io: Server): void {
  globalIO = io;

  // Middleware de autenticação Socket.io com validação estrita de algoritmo JWT (HS256)
  io.use(async (socket: AuthenticatedSocket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token || typeof token !== 'string' || token.length > 2048) {
      return next(new Error('Autenticação necessária para WebSocket'));
    }

    try {
      const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as {
        userId: string;
        username: string;
        email: string;
        role?: string;
      };

      if (!decoded || !isValidIdentifier(decoded.userId) || typeof decoded.username !== 'string') {
        return next(new Error('Token de sessão inválido'));
      }

      // Buscar papel atualizado no banco
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { role: true, isApproved: true },
      });

      socket.user = {
        userId: decoded.userId,
        username: sanitizeText(decoded.username, 32) || 'Usuário',
        email: typeof decoded.email === 'string' ? decoded.email : '',
        role: dbUser?.role || decoded.role || 'USER',
      };
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    const user = socket.user;
    if (!user) return;

    const userId = user.userId;

    // Rate Limiter por conexão WebSocket para evitar flood de eventos / DoS
    const rateBuckets = new Map<string, { count: number; resetAt: number }>();
    const allowSocketEvent = (key: string, maxEvents: number, windowMs: number): boolean => {
      const now = Date.now();
      const bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= maxEvents;
    };

    const isFirstConnection = !userSockets.has(userId) || userSockets.get(userId)!.size === 0;

    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId)!.add(socket.id);

    if (isFirstConnection) {
      io.emit('user-status-changed', { userId, status: 'online' });
    }

    // Se o usuário for administrador, insere na sala de administradores e envia contador de pendências
    if (user.role === 'ADMIN') {
      socket.join('admin-room');
      prisma.user
        .count({ where: { approvalStatus: 'PENDING' } })
        .then((pendingCount) => {
          socket.emit('admin-pending-count', { pendingCount });
        })
        .catch(() => {});

      socket.on('admin:get-pending-count', async () => {
        try {
          const pendingCount = await prisma.user.count({ where: { approvalStatus: 'PENDING' } });
          socket.emit('admin-pending-count', { pendingCount });
        } catch {}
      });
    }

    // Enviar lista de usuários online imediatamente para quem acabou de conectar
    socket.emit('online-users-list', getOnlineUserIds());

    // Entrar em uma sala de canal de texto
    socket.on('join-channel', (channelId: unknown) => {
      if (!isValidIdentifier(channelId)) return;
      socket.join(`channel:${channelId}`);
    });

    socket.on('leave-channel', (channelId: unknown) => {
      if (!isValidIdentifier(channelId)) return;
      socket.leave(`channel:${channelId}`);
    });

    // Enviar mensagem em tempo real com sanitização e rate limit
    socket.on('send-message', async (data: { channelId?: unknown; content?: unknown }) => {
      try {
        if (!allowSocketEvent('send-message', 30, 10_000)) return;
        const channelId = data?.channelId;
        if (!isValidIdentifier(channelId)) return;

        const rawContent = ensureScalarString(data?.content, 4000);
        const cleanContent = sanitizeText(rawContent || '', 4000);
        if (!cleanContent) return;

        const message = await prisma.message.create({
          data: {
            content: cleanContent,
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
    socket.on('typing', (data: { channelId?: unknown; isTyping?: unknown }) => {
      if (!allowSocketEvent('typing', 30, 10_000)) return;
      if (!isValidIdentifier(data?.channelId)) return;
      socket.to(`channel:${data.channelId}`).emit('user-typing', {
        userId: user.userId,
        username: user.username,
        isTyping: Boolean(data.isTyping),
      });
    });

    // Auxiliar para enviar evento diretamente a todos os sockets de um usuário específico
    const sendToUser = (targetUserId: string, event: string, payload: any) => {
      if (!isValidIdentifier(targetUserId)) return;
      const targetSocketIds = userSockets.get(targetUserId);
      if (targetSocketIds) {
        targetSocketIds.forEach((sid) => {
          io.to(sid).emit(event, payload);
        });
      }
    };

    // Função auxiliar para remover usuário de canal de voz
    const removeUserFromVoice = (channelId: string, serverId: string) => {
      if (!isValidIdentifier(channelId) || !isValidIdentifier(serverId)) return;
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
    socket.on('join-voice', async (data: { serverId?: unknown; channelId?: unknown }) => {
      const serverId = data?.serverId;
      const channelId = data?.channelId;
      if (!isValidIdentifier(serverId) || !isValidIdentifier(channelId)) return;

      // Se já estava em outro canal de voz, sai dele antes
      if (socket.currentVoice && socket.currentVoice.channelId !== channelId) {
        removeUserFromVoice(socket.currentVoice.channelId, socket.currentVoice.serverId);
      }

      // Buscar avatar atualizado do usuário no banco de dados
      const dbUser = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { id: true, username: true, avatarUrl: true },
      });

      const existingRoom = voiceRooms.get(channelId);
      const existingEntry = existingRoom?.get(user.userId);

      const safeUsername = dbUser?.username || user.username;
      const participant: VoiceParticipant = {
        id: user.userId,
        username: safeUsername,
        avatarUrl:
          dbUser?.avatarUrl ||
          `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(safeUsername)}`,
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
    socket.on('leave-voice', (data: { serverId?: unknown; channelId?: unknown }) => {
      if (!isValidIdentifier(data?.serverId) || !isValidIdentifier(data?.channelId)) return;
      removeUserFromVoice(data.channelId, data.serverId);
      socket.currentVoice = undefined;
    });

    // Sinalização WebRTC Ponto-a-Ponto (Voz + Transmissão de Tela)
    socket.on(
      'webrtc-offer',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        sdp?: any;
        screenStreamId?: unknown;
      }) => {
        if (!allowSocketEvent('webrtc-sig', 120, 10_000)) return;
        const targetId = data?.toUserId || data?.targetUserId;
        if (!isValidIdentifier(targetId) || !isValidIdentifier(data?.channelId)) return;
        if (!data?.sdp || typeof data.sdp.sdp !== 'string' || data.sdp.sdp.length > 65536) return;

        sendToUser(targetId, 'webrtc-offer', {
          fromUserId: user.userId,
          fromUsername: user.username,
          channelId: data.channelId,
          sdp: { type: data.sdp.type === 'offer' ? 'offer' : 'offer', sdp: data.sdp.sdp },
          screenStreamId: ensureScalarString(data.screenStreamId, 128) || null,
        });
      }
    );

    socket.on(
      'webrtc-answer',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        sdp?: any;
        screenStreamId?: unknown;
      }) => {
        if (!allowSocketEvent('webrtc-sig', 120, 10_000)) return;
        const targetId = data?.toUserId || data?.targetUserId;
        if (!isValidIdentifier(targetId) || !isValidIdentifier(data?.channelId)) return;
        if (!data?.sdp || typeof data.sdp.sdp !== 'string' || data.sdp.sdp.length > 65536) return;

        sendToUser(targetId, 'webrtc-answer', {
          fromUserId: user.userId,
          fromUsername: user.username,
          channelId: data.channelId,
          sdp: { type: 'answer', sdp: data.sdp.sdp },
          screenStreamId: ensureScalarString(data.screenStreamId, 128) || null,
        });
      }
    );

    socket.on(
      'webrtc-ice-candidate',
      (data: { toUserId?: unknown; targetUserId?: unknown; channelId?: unknown; candidate?: any }) => {
        if (!allowSocketEvent('webrtc-ice', 300, 10_000)) return;
        const targetId = data?.toUserId || data?.targetUserId;
        if (!isValidIdentifier(targetId) || !isValidIdentifier(data?.channelId)) return;
        if (!data?.candidate || typeof data.candidate !== 'object') return;

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
        channelId?: unknown;
        serverId?: unknown;
        isMuted?: unknown;
        isSpeaking?: unknown;
        isScreenSharing?: unknown;
        screenStreamId?: unknown;
      }) => {
        if (!allowSocketEvent('voice-state', 120, 10_000)) return;
        if (!isValidIdentifier(data?.channelId)) return;
        const channelId = data.channelId;

        const room = voiceRooms.get(channelId);
        const safeScreenStreamId =
          data.screenStreamId === null
            ? null
            : ensureScalarString(data.screenStreamId, 128) ?? undefined;

        if (room && room.has(user.userId)) {
          const p = room.get(user.userId)!;
          if (typeof data.isMuted === 'boolean') p.isMuted = data.isMuted;
          if (typeof data.isSpeaking === 'boolean') p.isSpeaking = data.isSpeaking;
          if (typeof data.isScreenSharing === 'boolean') p.isScreenSharing = data.isScreenSharing;
          if (safeScreenStreamId !== undefined) p.screenStreamId = safeScreenStreamId;
        }

        const statePayload = {
          channelId,
          userId: user.userId,
          username: user.username,
          isMuted: typeof data.isMuted === 'boolean' ? data.isMuted : undefined,
          isSpeaking: typeof data.isSpeaking === 'boolean' ? data.isSpeaking : undefined,
          isScreenSharing:
            typeof data.isScreenSharing === 'boolean' ? data.isScreenSharing : undefined,
          screenStreamId: safeScreenStreamId,
        };

        // Notificar tanto os membros no canal de voz quanto no servidor
        socket.to(`voice:${channelId}`).emit('voice-user-state-updated', statePayload);

        const targetServerId = isValidIdentifier(data.serverId)
          ? data.serverId
          : socket.currentVoice?.serverId;
        if (targetServerId) {
          io.to(`server:${targetServerId}`).emit('voice-user-state-updated', statePayload);
        }
      }
    );

    // Atualização de perfil em tempo real validada contra o banco de dados
    socket.on('update-profile', async (data: { username?: unknown; avatarUrl?: unknown }) => {
      if (!allowSocketEvent('update-profile', 10, 60_000)) return;
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { id: true, username: true, avatarUrl: true },
        });

        const verifiedUsername =
          dbUser?.username || sanitizeText(data?.username, 32) || user.username;
        const verifiedAvatarUrl =
          dbUser?.avatarUrl ||
          sanitizeSafeUrl(data?.avatarUrl) ||
          `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(verifiedUsername)}`;

        user.username = verifiedUsername;

        if (socket.currentVoice) {
          const room = voiceRooms.get(socket.currentVoice.channelId);
          if (room && room.has(user.userId)) {
            const participant = room.get(user.userId)!;
            participant.username = verifiedUsername;
            participant.avatarUrl = verifiedAvatarUrl;
            io.to(`server:${socket.currentVoice.serverId}`).emit('voice-channel-updated', {
              channelId: socket.currentVoice.channelId,
              users: getChannelVoiceParticipants(socket.currentVoice.channelId),
            });
          }
        }

        io.emit('user-profile-updated', {
          userId: user.userId,
          username: verifiedUsername,
          avatarUrl: verifiedAvatarUrl,
        });
      } catch (err) {
        console.warn('Erro ao propagar atualização de perfil via socket:', err);
      }
    });

    // Entrar na sala do servidor para receber eventos globais (canais, presenças)
    socket.on('join-server', (serverId: unknown) => {
      if (!isValidIdentifier(serverId)) return;
      socket.join(`server:${serverId}`);
      socket.emit('online-users-list', getOnlineUserIds());
      socket.emit('voice-state-sync', getAllVoiceState());
    });

    socket.on('disconnect', () => {
      if (socket.currentVoice) {
        removeUserFromVoice(socket.currentVoice.channelId, socket.currentVoice.serverId);
        socket.currentVoice = undefined;
      }

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

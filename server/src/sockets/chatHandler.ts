import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import {
  ensureScalarString,
  isValidIdentifier,
  sanitizeSafeUrl,
  sanitizeText,
} from '../middlewares/security';
import {
  sanitizeAttachmentUrl,
  deleteUploadedFileSafe,
} from '../middlewares/uploadSecurity';

export interface VoiceParticipant {
  id: string;
  username: string;
  avatarUrl?: string;
  isMuted?: boolean;
  isDeafened?: boolean;
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

export function updateUserSocketPermissions(userId: string, role: string, permissions: string[]): void {
  if (!globalIO) return;
  const targetSocketIds = userSockets.get(userId);
  if (targetSocketIds) {
    targetSocketIds.forEach((sid) => {
      const s = globalIO!.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
      if (s && s.user) {
        s.user.role = role;
        s.user.permissions = permissions;
        if (role === 'ADMIN' || permissions.includes('manage_users')) {
          s.join('admin-room');
        } else {
          s.leave('admin-room');
        }
      }
    });
  }
}

export async function syncUsersWithRole(roleId: string, permissions: string[]): Promise<void> {
  if (!globalIO) return;
  try {
    const users = await prisma.user.findMany({
      where: { customRoleId: roleId },
      select: { id: true, role: true },
    });
    for (const u of users) {
      updateUserSocketPermissions(u.id, u.role, permissions);
    }
  } catch (err) {
    console.warn('[Socket] Falha ao sincronizar usuários do cargo alterado:', err);
  }
}

interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    username: string;
    email: string;
    role?: string;
    permissions?: string[];
  };
  currentVoice?: {
    serverId: string;
    channelId: string;
  };
  _voiceJoinSeq?: number;
}

export function terminateUserSocketsAndVoice(userId: string): void {
  if (!isValidIdentifier(userId)) return;

  // 1. Remover o usuário de todas as salas de voz em memória
  for (const [channelId, room] of voiceRooms.entries()) {
    if (room.has(userId)) {
      room.delete(userId);
      if (room.size === 0) {
        voiceRooms.delete(channelId);
      }
      if (globalIO) {
        globalIO.to(`voice:${channelId}`).emit('voice-peer-left', {
          channelId,
          userId,
        });
        const updatedUsers = getChannelVoiceParticipants(channelId);
        globalIO.emit('voice-channel-updated', {
          channelId,
          users: updatedUsers,
          participants: updatedUsers,
        });
      }
    }
  }

  // 2. Desconectar forçadamente todos os sockets ativos do usuário
  const targetSocketIds = userSockets.get(userId);
  if (targetSocketIds && globalIO) {
    const socketIdsArray = Array.from(targetSocketIds);
    socketIdsArray.forEach((sid) => {
      const s = globalIO!.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
      if (s) {
        if (s.currentVoice) {
          s.leave(`voice:${s.currentVoice.channelId}`);
          s.currentVoice = undefined;
        }
        s.disconnect(true);
      }
    });
  }

  // 3. Limpar registro de sockets do usuário
  userSockets.delete(userId);
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

      // Buscar papel e permissões atualizadas no banco
      const dbUser = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          role: true,
          isApproved: true,
          customRole: {
            select: { permissions: true },
          },
        },
      });

      if (!dbUser || dbUser.isApproved !== true) {
        return next(new Error('Conta pendente de aprovação ou não autorizada'));
      }

      socket.user = {
        userId: decoded.userId,
        username: sanitizeText(decoded.username, 32) || 'Usuário',
        email: typeof decoded.email === 'string' ? decoded.email : '',
        role: dbUser.role || decoded.role || 'USER',
        permissions: dbUser.customRole?.permissions || [],
      };
      next();
    } catch (err: any) {
      if (err?.message === 'Conta pendente de aprovação ou não autorizada') {
        return next(err);
      }
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

    // Verificador de permissões dinâmico em tempo real
    const userHasPermission = async (perm: string): Promise<boolean> => {
      // 1. Checagem em memória no socket
      if (
        socket.user?.role === 'ADMIN' ||
        (Array.isArray(socket.user?.permissions) && socket.user.permissions.includes(perm))
      ) {
        return true;
      }
      // 2. Consulta de sincronia imediata ao banco caso o cargo tenha acabado de ser atribuído
      try {
        if (!socket.user?.userId) return false;
        const db = await prisma.user.findUnique({
          where: { id: socket.user.userId },
          select: {
            role: true,
            customRole: { select: { permissions: true } },
          },
        });
        if (db) {
          socket.user.role = db.role;
          socket.user.permissions = db.customRole?.permissions || [];
          return (
            db.role === 'ADMIN' ||
            (Array.isArray(db.customRole?.permissions) && db.customRole.permissions.includes(perm))
          );
        }
      } catch {}
      return false;
    };

    // Inicialização da sala de administradores se possuir privilégios
    if (user.role === 'ADMIN' || (Array.isArray(user.permissions) && user.permissions.includes('manage_users'))) {
      socket.join('admin-room');
      prisma.user
        .count({ where: { approvalStatus: 'PENDING' } })
        .then((pendingCount) => {
          socket.emit('admin-pending-count', { pendingCount });
        })
        .catch(() => {});
    }

    // Ouvinte para buscar contagem de pendências (com verificação dinâmica)
    socket.on('admin:get-pending-count', async () => {
      try {
        if (!(await userHasPermission('manage_users'))) return;
        const pendingCount = await prisma.user.count({ where: { approvalStatus: 'PENDING' } });
        socket.emit('admin-pending-count', { pendingCount });
      } catch {}
    });

    // 1. Exclusão de mensagens de chat (Admin ou permissão delete_messages)
    socket.on('admin:delete-message', async (data: { channelId?: unknown; messageId?: unknown }) => {
      try {
        if (!(await userHasPermission('delete_messages'))) {
          console.warn(`[Socket] Usuário ${socket.user?.userId} tentou excluir mensagem sem permissão.`);
          return;
        }
        const channelId = data?.channelId;
        const messageId = data?.messageId;
        if (!isValidIdentifier(channelId) || !isValidIdentifier(messageId)) return;

        const existing = await prisma.message.findFirst({
          where: { id: messageId, channelId },
        });
        if (!existing) return;

        await prisma.message.delete({
          where: { id: messageId },
        });

        if (existing.attachmentUrl) {
          deleteUploadedFileSafe(existing.attachmentUrl).catch(() => {});
        }

        io.to(`channel:${channelId}`).emit('message-deleted', {
          channelId,
          messageId,
        });
      } catch (err) {
        console.error('Erro ao excluir mensagem via admin socket:', err);
      }
    });

    // 2. Desconexão forçada de participante de voz (Admin ou permissão disconnect_voice)
    socket.on(
      'admin:disconnect-voice',
      async (data: { targetUserId?: unknown; channelId?: unknown; serverId?: unknown }) => {
        try {
          if (!(await userHasPermission('disconnect_voice'))) {
            console.warn(`[Socket] Usuário ${socket.user?.userId} tentou desconectar usuário sem permissão.`);
            return;
          }
          const targetUserId = data?.targetUserId;
          const channelId = data?.channelId;
          const serverId = data?.serverId;
          if (
            !isValidIdentifier(targetUserId) ||
            !isValidIdentifier(channelId) ||
            !isValidIdentifier(serverId)
          ) {
            return;
          }

          removeSpecificUserFromVoice(targetUserId, channelId, serverId, { forceAll: true });

          sendToUser(targetUserId, 'force-disconnect-voice', {
            channelId,
            serverId,
            reason: 'Você foi desconectado da chamada por um moderador.',
          });
        } catch (err) {
          console.error('Erro ao desconectar usuário da voz via admin socket:', err);
        }
      }
    );

    // 3. Silenciamento no servidor (Admin ou permissão server_mute)
    socket.on(
      'admin:server-mute-voice',
      async (data: {
        targetUserId?: unknown;
        channelId?: unknown;
        serverId?: unknown;
        isMuted?: unknown;
      }) => {
        try {
          if (!(await userHasPermission('server_mute'))) {
            console.warn(`[Socket] Usuário ${socket.user?.userId} tentou mutar participante sem permissão.`);
            return;
          }
          const targetUserId = data?.targetUserId;
          const channelId = data?.channelId;
          const serverId = data?.serverId;
          const isMuted = Boolean(data?.isMuted);

          if (
            !isValidIdentifier(targetUserId) ||
            !isValidIdentifier(channelId) ||
            !isValidIdentifier(serverId)
          ) {
            return;
          }

          const room = voiceRooms.get(channelId);
          if (room && room.has(targetUserId)) {
            const p = room.get(targetUserId)!;
            p.isMuted = isMuted;
          }

          const statePayload = {
            channelId,
            userId: targetUserId,
            isMuted,
          };
          io.to(`voice:${channelId}`).emit('voice-user-state-updated', statePayload);
          io.to(`server:${serverId}`).except(`voice:${channelId}`).emit('voice-user-state-updated', statePayload);

          sendToUser(targetUserId, 'force-mute-mic', {
            channelId,
            isMuted,
          });
        } catch (err) {
          console.error('Erro ao silenciar usuário no servidor via admin socket:', err);
        }
      }
    );

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
    socket.on('send-message', async (data: { channelId?: unknown; content?: unknown; attachmentUrl?: unknown }) => {
      try {
        if (!allowSocketEvent('send-message', 30, 10_000)) return;
        const channelId = data?.channelId;
        if (!isValidIdentifier(channelId)) return;

        const rawContent = ensureScalarString(data?.content, 4000);
        const cleanContent = sanitizeText(rawContent || '', 4000);
        const safeAttachmentUrl = sanitizeAttachmentUrl(data?.attachmentUrl);

        // Mensagem precisa ter texto ou anexo válido
        if (!cleanContent && !safeAttachmentUrl) return;

        const message = await prisma.message.create({
          data: {
            content: cleanContent,
            attachmentUrl: safeAttachmentUrl,
            attachmentType: safeAttachmentUrl ? 'IMAGE' : null,
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
        console.error('[Socket] Erro ao enviar mensagem via socket:', err);
        socket.emit('message-error', { error: 'Falha ao processar e salvar mensagem.' });
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

    // Auxiliar para enviar evento WebRTC exclusivamente aos sockets do usuário naquele canal de voz,
    // com suporte a direcionamento de socket específico e prevenção de multi-tab glare.
    const sendToUserInChannel = (
      targetUserId: string,
      channelId: string,
      event: string,
      payload: any,
      targetSocketId?: unknown
    ) => {
      if (!isValidIdentifier(targetUserId) || !isValidIdentifier(channelId)) return;
      const targetSocketIds = userSockets.get(targetUserId);
      if (!targetSocketIds || targetSocketIds.size === 0) return;

      // 1. Se um socket específico foi solicitado, validar e direcionar diretamente a ele
      if (typeof targetSocketId === 'string' && targetSocketIds.has(targetSocketId)) {
        const s = io.sockets.sockets.get(targetSocketId) as AuthenticatedSocket | undefined;
        if (s && s.connected && (s.rooms.has(`voice:${channelId}`) || s.currentVoice?.channelId === channelId)) {
          io.to(targetSocketId).emit(event, payload);
          return;
        }
      }

      // 2. Localizar sockets ativos do usuário que pertençam a este canal de voz
      const activeVoiceSockets: string[] = [];
      for (const sid of targetSocketIds) {
        const s = io.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
        if (s && s.connected && (s.rooms.has(`voice:${channelId}`) || s.currentVoice?.channelId === channelId)) {
          activeVoiceSockets.push(sid);
        }
      }

      if (activeVoiceSockets.length === 0) {
        console.debug(`[WebRTC] Nenhum socket ativo encontrado para o usuário ${targetUserId} no canal ${channelId}`);
        return;
      }

      // 3. Prevenir multi-socket glare: se houver mais de um socket do usuário no mesmo canal,
      // direcionar ao primeiro ativo para evitar respostas concorrentes (InvalidStateError)
      const chosenSocketId = activeVoiceSockets[0];
      io.to(chosenSocketId).emit(event, payload);
    };

    // Verifica se o usuário ainda possui outro socket ativo e conectado nesta sala de voz
    const hasOtherActiveVoiceSocket = (
      targetUserId: string,
      channelId: string,
      excludeSocketId?: string
    ): boolean => {
      const socketIds = userSockets.get(targetUserId);
      if (!socketIds) return false;
      for (const sid of socketIds) {
        if (excludeSocketId && sid === excludeSocketId) continue;
        const s = io.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
        if (s && s.connected && s.currentVoice?.channelId === channelId) {
          return true;
        }
      }
      return false;
    };

    // Função auxiliar para remover qualquer usuário de canal de voz
    const removeSpecificUserFromVoice = (
      targetUserId: string,
      channelId: string,
      serverId: string,
      options?: { forceAll?: boolean; excludeSocketId?: string }
    ) => {
      if (!isValidIdentifier(channelId) || !isValidIdentifier(serverId) || !isValidIdentifier(targetUserId)) return;

      const forceAll = Boolean(options?.forceAll);
      const excludeSocketId = options?.excludeSocketId;

      if (forceAll) {
        const targetSocketIds = userSockets.get(targetUserId);
        if (targetSocketIds) {
          targetSocketIds.forEach((sid) => {
            const s = io.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
            if (s) {
              s.leave(`voice:${channelId}`);
              if (s.currentVoice?.channelId === channelId) {
                s.currentVoice = undefined;
              }
            }
          });
        }
      } else {
        if (excludeSocketId) {
          const s = io.sockets.sockets.get(excludeSocketId) as AuthenticatedSocket | undefined;
          if (s) {
            s.leave(`voice:${channelId}`);
            if (s.currentVoice?.channelId === channelId) {
              s.currentVoice = undefined;
            }
          }
        }

        // Se o usuário ainda tem outro socket conectado no mesmo canal de voz, NÃO remover da sala
        if (hasOtherActiveVoiceSocket(targetUserId, channelId, excludeSocketId)) {
          return;
        }
      }

      const room = voiceRooms.get(channelId);
      if (room) {
        room.delete(targetUserId);
        if (room.size === 0) {
          voiceRooms.delete(channelId);
        }
      }
      io.to(`voice:${channelId}`).emit('voice-peer-left', {
        channelId,
        userId: targetUserId,
      });
      const updatedUsers = getChannelVoiceParticipants(channelId);
      io.to(`server:${serverId}`).emit('voice-channel-updated', {
        channelId,
        users: updatedUsers,
        participants: updatedUsers,
      });
    };

    // Função auxiliar para remover usuário atual de canal de voz
    const removeUserFromVoice = (channelId: string, serverId: string, excludeSocketId?: string) => {
      removeSpecificUserFromVoice(user.userId, channelId, serverId, {
        excludeSocketId: excludeSocketId || socket.id,
      });
    };

    // Conectar em canal de voz
    socket.on(
      'join-voice',
      async (data: {
        serverId?: unknown;
        channelId?: unknown;
        isMuted?: unknown;
        isSpeaking?: unknown;
        isScreenSharing?: unknown;
        screenStreamId?: unknown;
      }) => {
        try {
          const serverId = data?.serverId;
          const channelId = data?.channelId;
          if (!isValidIdentifier(serverId) || !isValidIdentifier(channelId)) return;

          // Incrementar sequência atômica de transição de voz para este socket
          const joinSeq = (socket._voiceJoinSeq = (socket._voiceJoinSeq || 0) + 1);

          // 1. Limpeza síncrona e atômica do canal anterior associado a este socket
          if (socket.currentVoice && socket.currentVoice.channelId !== channelId) {
            const prevVoice = socket.currentVoice;
            socket.leave(`voice:${prevVoice.channelId}`);
            socket.currentVoice = undefined;
            removeUserFromVoice(prevVoice.channelId, prevVoice.serverId, socket.id);
          }

          // 2. Garantir isolamento mútuo: remover qualquer ocorrência prévia deste usuário em outras salas de voz
          for (const [otherChannelId, members] of voiceRooms.entries()) {
            if (otherChannelId !== channelId && members.has(user.userId)) {
              removeSpecificUserFromVoice(user.userId, otherChannelId, serverId as string, {
                excludeSocketId: socket.id,
              });
              if (voiceRooms.get(otherChannelId)?.has(user.userId)) {
                voiceRooms.get(otherChannelId)!.delete(user.userId);
                if (voiceRooms.get(otherChannelId)!.size === 0) {
                  voiceRooms.delete(otherChannelId);
                }
                io.to(`voice:${otherChannelId}`).emit('voice-peer-left', {
                  channelId: otherChannelId,
                  userId: user.userId,
                });
                const remParticipants = getChannelVoiceParticipants(otherChannelId);
                io.to(`server:${serverId}`).emit('voice-channel-updated', {
                  channelId: otherChannelId,
                  users: remParticipants,
                  participants: remParticipants,
                });
              }
            }
          }

          // 3. Buscar avatar atualizado do usuário no banco de dados
          const dbUser = await prisma.user.findUnique({
            where: { id: user.userId },
            select: { id: true, username: true, avatarUrl: true },
          });

          // 4. Se o socket foi desconectado ou se uma transição mais recente foi iniciada, abortar
          if (!socket.connected || socket._voiceJoinSeq !== joinSeq) {
            return;
          }

          // 5. Preservação de estado e recuperação de transmissão de tela na reconexão
          const existingRoom = voiceRooms.get(channelId as string);
          const existingEntry = existingRoom?.get(user.userId);

          const safeUsername = dbUser?.username || user.username;

          const isMuted =
            typeof data?.isMuted === 'boolean'
              ? data.isMuted
              : (existingEntry?.isMuted ?? false);

          const isDeafened =
            typeof data?.isDeafened === 'boolean'
              ? data.isDeafened
              : (existingEntry?.isDeafened ?? false);

          const isSpeaking =
            typeof data?.isSpeaking === 'boolean'
              ? data.isSpeaking
              : (existingEntry?.isSpeaking ?? false);

          const isScreenSharing =
            typeof data?.isScreenSharing === 'boolean'
              ? data.isScreenSharing
              : (existingEntry?.isScreenSharing ?? false);

          const rawStreamId = data?.screenStreamId;
          const safeScreenStreamId =
            rawStreamId === null
              ? null
              : (ensureScalarString(rawStreamId, 128) ?? existingEntry?.screenStreamId ?? null);

          const participant: VoiceParticipant = {
            id: user.userId,
            username: safeUsername,
            avatarUrl:
              dbUser?.avatarUrl ||
              `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(safeUsername)}`,
            isMuted,
            isDeafened,
            isSpeaking,
            isScreenSharing,
            screenStreamId: safeScreenStreamId,
          };

          if (!voiceRooms.has(channelId as string)) {
            voiceRooms.set(channelId as string, new Map());
          }
          voiceRooms.get(channelId as string)!.set(user.userId, participant);

          socket.currentVoice = { serverId: serverId as string, channelId: channelId as string };
          socket.join(`voice:${channelId}`);

          const updatedUsers = getChannelVoiceParticipants(channelId as string);

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
        } catch (err) {
          console.error('[Socket] Erro ao conectar no canal de voz:', err);
          socket.emit('voice-error', { message: 'Erro ao ingressar no canal de voz. Tente novamente.' });
        }
      }
    );

    // Sair de canal de voz
    socket.on('leave-voice', (data: { serverId?: unknown; channelId?: unknown }) => {
      try {
        if (!isValidIdentifier(data?.serverId) || !isValidIdentifier(data?.channelId)) return;
        socket.leave(`voice:${data.channelId}`);
        socket.currentVoice = undefined;
        removeUserFromVoice(data.channelId, data.serverId, socket.id);
      } catch (err) {
        console.error('[Socket] Erro ao sair do canal de voz:', err);
      }
    });

    // Sinalização WebRTC Ponto-a-Ponto (Voz + Transmissão de Tela)
    socket.on(
      'webrtc-offer',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        targetSocketId?: unknown;
        toSocketId?: unknown;
        sdp?: any;
        screenStreamId?: unknown;
      }) => {
        try {
          if (!allowSocketEvent('webrtc-sig', 120, 10_000)) return;
          const targetId = data?.toUserId || data?.targetUserId;
          const channelId = data?.channelId;
          if (!isValidIdentifier(targetId) || !isValidIdentifier(channelId)) return;
          if (targetId === user.userId) return;
          if (!socket.rooms.has(`voice:${channelId}`)) return;

          // Validação de isolamento de sala: verificar se o usuário de destino está presente na sala de voz
          const room = voiceRooms.get(channelId as string);
          if (!room || !room.has(targetId as string)) {
            console.debug(`[WebRTC] Discarding webrtc-offer: target ${targetId} not in voice channel ${channelId}`);
            return;
          }

          if (!data?.sdp || typeof data.sdp.sdp !== 'string' || data.sdp.sdp.length > 65536) return;

          sendToUserInChannel(
            targetId as string,
            channelId as string,
            'webrtc-offer',
            {
              fromUserId: user.userId,
              fromUsername: user.username,
              fromSocketId: socket.id,
              channelId,
              sdp: { type: data.sdp.type === 'offer' ? 'offer' : 'offer', sdp: data.sdp.sdp },
              screenStreamId: ensureScalarString(data.screenStreamId, 128) || null,
            },
            data?.targetSocketId || data?.toSocketId
          );
        } catch (err) {
          console.warn('[WebRTC] Erro ao processar webrtc-offer:', err);
        }
      }
    );

    socket.on(
      'webrtc-answer',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        targetSocketId?: unknown;
        toSocketId?: unknown;
        sdp?: any;
        screenStreamId?: unknown;
      }) => {
        try {
          if (!allowSocketEvent('webrtc-sig', 120, 10_000)) return;
          const targetId = data?.toUserId || data?.targetUserId;
          const channelId = data?.channelId;
          if (!isValidIdentifier(targetId) || !isValidIdentifier(channelId)) return;
          if (targetId === user.userId) return;
          if (!socket.rooms.has(`voice:${channelId}`)) return;

          // Validação de isolamento de sala: verificar se o usuário de destino está presente na sala de voz
          const room = voiceRooms.get(channelId as string);
          if (!room || !room.has(targetId as string)) {
            console.debug(`[WebRTC] Discarding webrtc-answer: target ${targetId} not in voice channel ${channelId}`);
            return;
          }

          if (!data?.sdp || typeof data.sdp.sdp !== 'string' || data.sdp.sdp.length > 65536) return;

          sendToUserInChannel(
            targetId as string,
            channelId as string,
            'webrtc-answer',
            {
              fromUserId: user.userId,
              fromUsername: user.username,
              fromSocketId: socket.id,
              channelId,
              sdp: { type: 'answer', sdp: data.sdp.sdp },
              screenStreamId: ensureScalarString(data.screenStreamId, 128) || null,
            },
            data?.targetSocketId || data?.toSocketId
          );
        } catch (err) {
          console.warn('[WebRTC] Erro ao processar webrtc-answer:', err);
        }
      }
    );

    socket.on(
      'webrtc-ice-candidate',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        targetSocketId?: unknown;
        toSocketId?: unknown;
        candidate?: any;
      }) => {
        try {
          if (!allowSocketEvent('webrtc-ice', 300, 10_000)) return;
          const targetId = data?.toUserId || data?.targetUserId;
          const channelId = data?.channelId;
          if (!isValidIdentifier(targetId) || !isValidIdentifier(channelId)) return;
          if (targetId === user.userId) return;
          if (!socket.rooms.has(`voice:${channelId}`)) return;

          // Validação de isolamento de sala: verificar se o usuário de destino está presente na sala de voz
          const room = voiceRooms.get(channelId as string);
          if (!room || !room.has(targetId as string)) {
            console.debug(`[WebRTC] Discarding webrtc-ice-candidate: target ${targetId} not in voice channel ${channelId}`);
            return;
          }

          // Candidato pode ser um objeto RTCIceCandidateInit válido ou null (sinal W3C end-of-candidates)
          if (data?.candidate !== null && (typeof data?.candidate !== 'object' || !data?.candidate)) return;

          sendToUserInChannel(
            targetId as string,
            channelId as string,
            'webrtc-ice-candidate',
            {
              fromUserId: user.userId,
              fromSocketId: socket.id,
              channelId,
              candidate: data.candidate,
            },
            data?.targetSocketId || data?.toSocketId
          );
        } catch (err) {
          console.warn('[WebRTC] Erro ao processar webrtc-ice-candidate:', err);
        }
      }
    );

    socket.on(
      'request-screen-stream',
      (data: {
        toUserId?: unknown;
        targetUserId?: unknown;
        channelId?: unknown;
        targetSocketId?: unknown;
        toSocketId?: unknown;
      }) => {
        try {
          if (!allowSocketEvent('webrtc-sig', 120, 10_000)) return;
          const targetId = data?.toUserId || data?.targetUserId;
          const channelId = data?.channelId;
          if (!isValidIdentifier(targetId) || !isValidIdentifier(channelId)) return;
          if (targetId === user.userId) return;
          if (!socket.rooms.has(`voice:${channelId}`)) return;

          // Validação de isolamento de sala: verificar se o usuário transmissor está presente na sala de voz
          const room = voiceRooms.get(channelId as string);
          if (!room || !room.has(targetId as string)) {
            console.debug(`[WebRTC] Discarding request-screen-stream: target ${targetId} not in voice channel ${channelId}`);
            return;
          }

          sendToUserInChannel(
            targetId as string,
            channelId as string,
            'request-screen-stream',
            {
              fromUserId: user.userId,
              fromSocketId: socket.id,
              channelId,
            },
            data?.targetSocketId || data?.toSocketId
          );
        } catch (err) {
          console.warn('[WebRTC] Erro ao processar request-screen-stream:', err);
        }
      }
    );

    socket.on(
      'voice-user-state',
      (data: {
        channelId?: unknown;
        serverId?: unknown;
        isMuted?: unknown;
        isDeafened?: unknown;
        isSpeaking?: unknown;
        isScreenSharing?: unknown;
        screenStreamId?: unknown;
      }) => {
        try {
          if (!allowSocketEvent('voice-state', 120, 10_000)) return;
          const channelId = data?.channelId;
          if (!isValidIdentifier(channelId)) return;
          if (!socket.rooms.has(`voice:${channelId}`)) return;

          const room = voiceRooms.get(channelId);
          const safeScreenStreamId =
            data.screenStreamId === null
              ? null
              : ensureScalarString(data.screenStreamId, 128) ?? undefined;

          if (room && room.has(user.userId)) {
            const p = room.get(user.userId)!;
            if (typeof data.isMuted === 'boolean') p.isMuted = data.isMuted;
            if (typeof data.isDeafened === 'boolean') p.isDeafened = data.isDeafened;
            if (typeof data.isSpeaking === 'boolean') p.isSpeaking = data.isSpeaking;
            if (typeof data.isScreenSharing === 'boolean') p.isScreenSharing = data.isScreenSharing;
            if (safeScreenStreamId !== undefined) p.screenStreamId = safeScreenStreamId;
          }

          const statePayload = {
            channelId,
            userId: user.userId,
            username: user.username,
            isMuted: typeof data.isMuted === 'boolean' ? data.isMuted : undefined,
            isDeafened: typeof data.isDeafened === 'boolean' ? data.isDeafened : undefined,
            isSpeaking: typeof data.isSpeaking === 'boolean' ? data.isSpeaking : undefined,
            isScreenSharing:
              typeof data.isScreenSharing === 'boolean' ? data.isScreenSharing : undefined,
            screenStreamId: safeScreenStreamId,
          };

          // Notificar membros na sala de voz (exceto o próprio remetente)
          socket.to(`voice:${channelId}`).emit('voice-user-state-updated', statePayload);

          // Notificar membros no servidor que NÃO estejam nesta sala de voz (desduplicação de eventos)
          const targetServerId = isValidIdentifier(data?.serverId)
            ? data.serverId
            : socket.currentVoice?.serverId;
          if (targetServerId) {
            io.to(`server:${targetServerId}`).except(`voice:${channelId}`).emit('voice-user-state-updated', statePayload);
          }
        } catch (err) {
          console.warn('[WebRTC] Erro ao processar voice-user-state:', err);
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

    // Sair da sala do servidor ao trocar de contexto
    socket.on('leave-server', (serverId: unknown) => {
      if (!isValidIdentifier(serverId)) return;
      socket.leave(`server:${serverId}`);
    });

    socket.on('disconnect', () => {
      const currentVoice = socket.currentVoice;
      socket.currentVoice = undefined;

      const sockets = userSockets.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          userSockets.delete(userId);
          io.emit('user-status-changed', { userId, status: 'offline' });

          // Limpeza defensiva de quaisquer salas de voz remanescentes para este usuário
          for (const [cId, room] of voiceRooms.entries()) {
            if (room.has(userId)) {
              room.delete(userId);
              if (room.size === 0) {
                voiceRooms.delete(cId);
              }
              io.to(`voice:${cId}`).emit('voice-peer-left', { channelId: cId, userId });
              const updated = getChannelVoiceParticipants(cId);
              if (currentVoice?.serverId) {
                io.to(`server:${currentVoice.serverId}`).emit('voice-channel-updated', {
                  channelId: cId,
                  users: updated,
                  participants: updated,
                });
              }
            }
          }
        }
      }

      if (currentVoice) {
        removeUserFromVoice(currentVoice.channelId, currentVoice.serverId, socket.id);
      }
    });
  });
}

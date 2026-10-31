import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { adminMiddleware, authMiddleware, AuthRequest } from '../middlewares/auth';
import { ensureScalarString, isValidIdentifier, sanitizeText } from '../middlewares/security';
import { sanitizeAttachmentUrl, deleteUploadedFileSafe } from '../middlewares/uploadSecurity';
import { getGlobalIO } from '../sockets/chatHandler';

const router = Router();

// Buscar mensagens de um canal
router.get('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de canal inválido.' });
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true, serverId: true },
    });

    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    const messages = await prisma.message.findMany({
      where: { channelId: id },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    res.json({ messages });
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro ao carregar mensagens.' });
  }
});

// Enviar mensagem via HTTP (também suportado via WebSocket)
router.post('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!isValidIdentifier(id)) {
      res.status(400).json({ error: 'ID de canal inválido.' });
      return;
    }

    const rawContent = ensureScalarString(req.body?.content, 4000);
    const userId = req.user!.userId;

    const cleanContent = sanitizeText(rawContent || '', 4000);
    const safeAttachmentUrl = sanitizeAttachmentUrl(req.body?.attachmentUrl);

    if (!cleanContent && !safeAttachmentUrl) {
      res.status(400).json({ error: 'Mensagem vazia não é permitida.' });
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        content: cleanContent,
        attachmentUrl: safeAttachmentUrl,
        attachmentType: safeAttachmentUrl ? 'IMAGE' : null,
        channelId: id,
        userId,
      },
      include: {
        user: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    res.status(201).json({ message });
  } catch (error) {
    console.error('Erro ao criar mensagem:', error);
    res.status(500).json({ error: 'Erro ao salvar mensagem.' });
  }
});

// Excluir mensagem do canal (Exclusivo para Administradores)
router.delete(
  '/:channelId/messages/:messageId',
  authMiddleware,
  adminMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const channelId = Array.isArray(req.params.channelId) ? req.params.channelId[0] : req.params.channelId;
      const messageId = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId;

      if (!isValidIdentifier(channelId) || !isValidIdentifier(messageId)) {
        res.status(400).json({ error: 'Parâmetros inválidos.' });
        return;
      }

      const existingMessage = await prisma.message.findFirst({
        where: { id: messageId, channelId },
      });

      if (!existingMessage) {
        res.status(404).json({ error: 'Mensagem não encontrada neste canal.' });
        return;
      }

      await prisma.message.delete({
        where: { id: messageId },
      });

      if (existingMessage.attachmentUrl) {
        deleteUploadedFileSafe(existingMessage.attachmentUrl).catch(() => {});
      }

      // Notificar em tempo real todos os usuários conectados no canal
      const io = getGlobalIO();
      if (io) {
        io.to(`channel:${channelId}`).emit('message-deleted', {
          channelId,
          messageId,
        });
      }

      res.json({ success: true, messageId });
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
      res.status(500).json({ error: 'Erro interno ao excluir mensagem.' });
    }
  }
);

export default router;

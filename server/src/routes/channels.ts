import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();

// Buscar mensagens de um canal
router.get('/:id/messages', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

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
    const { content } = req.body;
    const userId = req.user!.userId;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Mensagem vazia não é permitida.' });
      return;
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
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

export default router;

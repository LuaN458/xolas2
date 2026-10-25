import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { getAllVoiceState } from '../sockets/chatHandler';

const router = Router();

// Listar servidores dos quais o usuário faz parte
router.get('/', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const servers = await prisma.server.findMany({
      where: {
        members: {
          some: { userId },
        },
      },
      include: {
        channels: true,
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ servers });
  } catch (error) {
    console.error('Erro ao listar servidores:', error);
    res.status(500).json({ error: 'Erro ao buscar servidores.' });
  }
});

// Criar um novo servidor
router.post('/', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { name, iconUrl } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Nome do servidor é obrigatório.' });
      return;
    }

    const server = await prisma.server.create({
      data: {
        name: name.trim(),
        iconUrl: iconUrl || null,
        ownerId: userId,
        members: {
          create: {
            userId,
            role: 'ADMIN',
          },
        },
        channels: {
          create: [
            { name: 'geral', type: 'TEXT' },
            { name: 'Geral', type: 'VOICE' },
          ],
        },
      },
      include: {
        channels: true,
        members: {
          include: {
            user: {
              select: { id: true, username: true, avatarUrl: true, status: true },
            },
          },
        },
      },
    });

    res.status(201).json({ server });
  } catch (error) {
    console.error('Erro ao criar servidor:', error);
    res.status(500).json({ error: 'Erro ao criar servidor.' });
  }
});

// Obter detalhes de um servidor
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const userId = req.user!.userId;

    const server = await prisma.server.findUnique({
      where: { id },
      include: {
        channels: {
          orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
        },
        members: {
          include: {
            user: {
              select: { id: true, username: true, avatarUrl: true, status: true },
            },
          },
        },
      },
    });

    if (!server) {
      res.status(404).json({ error: 'Servidor não encontrado.' });
      return;
    }

    // Se o usuário não for membro ainda, adiciona-o automaticamente para simplificar testes
    const membersList = server.members as Array<{ userId: string }>;
    const isMember = membersList.some((m) => m.userId === userId);
    if (!isMember) {
      await prisma.member.create({
        data: {
          serverId: id,
          userId,
          role: 'MEMBER',
        },
      });

      // Recarrega o servidor com o novo membro
      const updatedServer = await prisma.server.findUnique({
        where: { id },
        include: {
          channels: {
            orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
          },
          members: {
            include: {
              user: {
                select: { id: true, username: true, avatarUrl: true, status: true },
              },
            },
          },
        },
      });
      res.json({ server: updatedServer });
      return;
    }

    res.json({ server });
  } catch (error) {
    console.error('Erro ao buscar detalhes do servidor:', error);
    res.status(500).json({ error: 'Erro ao carregar servidor.' });
  }
});

// Obter estado de voz atual (participantes em cada canal de voz)
router.get('/:id/voice-state', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const voiceState = getAllVoiceState();
    res.json({ voiceState });
  } catch (error) {
    console.error('Erro ao buscar estado de voz:', error);
    res.status(500).json({ error: 'Erro ao buscar estado de voz.' });
  }
});

// Criar canal em um servidor
router.post('/:id/channels', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { name, type } = req.body;

    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: 'Nome do canal é obrigatório.' });
      return;
    }

    const channel = await prisma.channel.create({
      data: {
        name: name.trim().toLowerCase().replace(/\s+/g, '-'),
        type: type === 'VOICE' ? 'VOICE' : 'TEXT',
        serverId: id,
      },
    });

    res.status(201).json({ channel });
  } catch (error) {
    console.error('Erro ao criar canal:', error);
    res.status(500).json({ error: 'Erro ao criar canal.' });
  }
});

export default router;

import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { createLiveKitToken } from '../lib/livekit';
import { isValidIdentifier } from '../middlewares/security';

const router = Router();

router.post('/token', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const channelId = req.body?.channelId;
    const userId = req.user!.userId;
    const username = req.user!.username;

    if (!isValidIdentifier(channelId)) {
      res.status(400).json({ error: 'channelId válido é obrigatório.' });
      return;
    }

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      res.status(404).json({ error: 'Canal não encontrado.' });
      return;
    }

    const livekitUrl = process.env.LIVEKIT_URL || 'wss://your-livekit-url.livekit.cloud';

    // Gerar token LiveKit para a sala correspondente ao canal
    const token = await createLiveKitToken(channel.id, userId, username);

    res.json({
      token,
      url: livekitUrl,
      channelId: channel.id,
      channelName: channel.name,
    });
  } catch (error) {
    console.error('Erro ao gerar token LiveKit:', error);
    res.status(500).json({ error: 'Erro ao gerar token de voz/vídeo.' });
  }
});

export default router;

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();

router.post('/register', async (req, res): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Nickname e senha são obrigatórios.' });
      return;
    }

    const cleanUsername = username.trim();
    const userEmail =
      email && email.trim()
        ? email.trim()
        : `${cleanUsername.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user'}@xolas.local`;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: cleanUsername }, { email: userEmail }],
      },
    });

    if (existingUser) {
      res.status(400).json({ error: 'Esse nickname já está cadastrado. Escolha outro.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // Gerar avatar com cor agradável baseada no nome
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUsername)}`;

    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: userEmail,
        password: hashedPassword,
        avatarUrl,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });

    // Inserir o novo usuário automaticamente no servidor principal ("Olá" ou primeiro servidor existente)
    try {
      const defaultServer =
        (await prisma.server.findFirst({
          where: { name: 'Olá' },
          orderBy: { createdAt: 'asc' },
        })) ||
        (await prisma.server.findFirst({
          orderBy: { createdAt: 'asc' },
        }));

      if (defaultServer) {
        await prisma.member.create({
          data: {
            userId: user.id,
            serverId: defaultServer.id,
            role: 'MEMBER',
          },
        });
      }
    } catch (err) {
      console.warn('Aviso: falha ao vincular usuário ao servidor padrão:', err);
    }

    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      secret,
      { expiresIn: '7d' }
    );

    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

router.post('/login', async (req, res): Promise<void> => {
  try {
    const { username, email, password } = req.body;
    const identifier = (username || email || '').trim();

    if (!identifier || !password) {
      res.status(400).json({ error: 'Nickname e senha são obrigatórios.' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
          { email: `${identifier.toLowerCase().replace(/[^a-z0-9_]/g, '')}@xolas.local` },
        ],
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Nickname ou senha incorretos.' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Nickname ou senha incorretos.' });
      return;
    }

    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email },
      secret,
      { expiresIn: '7d' }
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno ao realizar login.' });
  }
});

router.get('/me', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({ user });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil.' });
  }
});

router.patch('/profile', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { username } = req.body;

    if (!username || username.trim().length === 0) {
      res.status(400).json({ error: 'O apelido não pode estar em branco.' });
      return;
    }

    const trimmed = username.trim();

    const existing = await prisma.user.findFirst({
      where: {
        username: trimmed,
        NOT: { id: userId },
      },
    });

    if (existing) {
      res.status(400).json({ error: 'Este apelido já está em uso por outro usuário.' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        username: trimmed,
        avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(trimmed)}`,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
      },
    });

    res.json({ user: updated });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar apelido.' });
  }
});

router.patch('/password', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'A senha atual e a nova senha são obrigatórias.' });
      return;
    }

    if (newPassword.length < 4) {
      res.status(400).json({ error: 'A nova senha deve ter no mínimo 4 caracteres.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      res.status(400).json({ error: 'A senha atual informada está incorreta.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    res.json({ message: 'Senha atualizada com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar senha:', error);
    res.status(500).json({ error: 'Erro interno ao atualizar senha.' });
  }
});

export default router;

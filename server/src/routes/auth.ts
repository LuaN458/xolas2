import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import {
  createRateLimiter,
  ensureScalarString,
  hasSqlInjectionSignature,
  sanitizeText,
  sanitizeSafeUrl,
} from '../middlewares/security';
import { notifyAdminsPendingUpdate } from '../sockets/chatHandler';

const router = Router();

// Hash dummy para comparação em tempo constante contra ataques de enumeração de usuários (Timing Attack)
const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  maxRequests: 25,
  message: 'Muitas tentativas de autenticação. Aguarde alguns minutos antes de tentar novamente.',
});

router.post('/register', authRateLimiter, async (req, res): Promise<void> => {
  try {
    const rawUsername = ensureScalarString(req.body?.username, 64);
    const rawEmail = ensureScalarString(req.body?.email, 128);
    const rawPassword = ensureScalarString(req.body?.password, 128);

    if (!rawUsername || !rawPassword) {
      res.status(400).json({ error: 'Nickname e senha são obrigatórios.' });
      return;
    }

    const cleanUsername = sanitizeText(rawUsername, 32);
    if (cleanUsername.length < 2 || cleanUsername.length > 32) {
      res.status(400).json({ error: 'O nickname deve ter entre 2 e 32 caracteres.' });
      return;
    }

    if (hasSqlInjectionSignature(cleanUsername) || (rawEmail && hasSqlInjectionSignature(rawEmail))) {
      res.status(400).json({ error: 'Caracteres ou padrões inválidos no cadastro.' });
      return;
    }

    if (rawPassword.length < 4 || rawPassword.length > 128) {
      res.status(400).json({ error: 'A senha deve ter entre 4 e 128 caracteres.' });
      return;
    }

    const userEmail =
      rawEmail && rawEmail.length > 0
        ? sanitizeText(rawEmail.toLowerCase(), 128)
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

    const hashedPassword = await bcrypt.hash(rawPassword, 10);
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUsername)}`;

    const user = await prisma.user.create({
      data: {
        username: cleanUsername,
        email: userEmail,
        password: hashedPassword,
        avatarUrl,
        role: 'USER',
        approvalStatus: 'PENDING',
        isApproved: false,
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        role: true,
        approvalStatus: true,
        isApproved: true,
        createdAt: true,
      },
    });

    // Notificar administradores conectados via WebSocket sobre o novo usuário pendente
    notifyAdminsPendingUpdate().catch(() => {});

    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email, role: user.role },
      secret,
      { algorithm: 'HS256', expiresIn: '90d' }
    );

    res.status(201).json({
      user,
      token,
      approvalStatus: user.approvalStatus,
      isApproved: user.isApproved,
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno ao cadastrar usuário.' });
  }
});

router.post('/login', authRateLimiter, async (req, res): Promise<void> => {
  try {
    const rawUsername = ensureScalarString(req.body?.username, 128);
    const rawEmail = ensureScalarString(req.body?.email, 128);
    const rawPassword = ensureScalarString(req.body?.password, 128);

    const identifier = sanitizeText(rawUsername || rawEmail || '', 128);

    if (!identifier || !rawPassword) {
      res.status(400).json({ error: 'Nickname e senha são obrigatórios.' });
      return;
    }

    if (hasSqlInjectionSignature(identifier)) {
      res.status(401).json({ error: 'Nickname ou senha incorretos.' });
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
      // Executar bcrypt dummy para manter tempo constante e impedir enumeração de contas
      await bcrypt.compare(rawPassword, DUMMY_BCRYPT_HASH);
      res.status(401).json({ error: 'Nickname ou senha incorretos.' });
      return;
    }

    const isMatch = await bcrypt.compare(rawPassword, user.password);
    if (!isMatch) {
      res.status(401).json({ error: 'Nickname ou senha incorretos.' });
      return;
    }

    // Verificar se o usuário está aguardando aprovação ou se foi recusado
    if (user.approvalStatus === 'PENDING' || !user.isApproved) {
      res.status(403).json({
        error: 'PENDING_APPROVAL',
        message: 'Sua conta foi criada e está aguardando aprovação de um administrador.',
        status: 'PENDING',
        user: {
          id: user.id,
          username: user.username,
          approvalStatus: 'PENDING',
          isApproved: false,
        },
      });
      return;
    }

    if (user.approvalStatus === 'REJECTED') {
      res.status(403).json({
        error: 'REJECTED',
        message: 'Sua solicitação de cadastro foi recusada pela administração.',
        status: 'REJECTED',
      });
      return;
    }

    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const token = jwt.sign(
      { userId: user.id, username: user.username, email: user.email, role: user.role },
      secret,
      { algorithm: 'HS256', expiresIn: '90d' }
    );

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        status: user.status,
        role: user.role,
        approvalStatus: user.approvalStatus,
        isApproved: user.isApproved,
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
        role: true,
        approvalStatus: true,
        isApproved: true,
        createdAt: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const refreshedToken = jwt.sign(
      { userId: user.id, username: user.username, email: user.email, role: user.role },
      secret,
      { algorithm: 'HS256', expiresIn: '90d' }
    );

    res.json({ user, token: refreshedToken });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil.' });
  }
});

router.patch('/profile', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const hasUsername = req.body?.username !== undefined;
    const hasAvatar = req.body?.avatarUrl !== undefined;

    if (!hasUsername && !hasAvatar) {
      res.status(400).json({ error: 'Nenhum dado fornecido para atualização.' });
      return;
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        role: true,
        approvalStatus: true,
        isApproved: true,
        createdAt: true,
      },
    });

    if (!currentUser) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const dataToUpdate: { username?: string; avatarUrl?: string } = {};

    // 1. Atualizar apelido se fornecido
    if (hasUsername) {
      const rawUsername = ensureScalarString(req.body.username, 64);
      if (!rawUsername) {
        res.status(400).json({ error: 'O apelido não pode estar em branco.' });
        return;
      }
      const trimmed = sanitizeText(rawUsername, 32);
      if (trimmed.length < 2 || trimmed.length > 32 || hasSqlInjectionSignature(trimmed)) {
        res.status(400).json({ error: 'O apelido deve ter entre 2 e 32 caracteres válidos.' });
        return;
      }

      if (trimmed !== currentUser.username) {
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
        dataToUpdate.username = trimmed;
      }
    }

    // 2. Atualizar foto de perfil (avatar) se fornecido
    if (hasAvatar) {
      const rawAvatar = req.body.avatarUrl;
      if (rawAvatar === '' || rawAvatar === null || rawAvatar === 'default') {
        // Restaurar avatar padrão gerado pelo Dicebear
        const baseUsername = dataToUpdate.username || currentUser.username;
        dataToUpdate.avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(baseUsername)}`;
      } else {
        const safeAvatar = sanitizeSafeUrl(rawAvatar);
        if (!safeAvatar) {
          res.status(400).json({ error: 'Formato de imagem ou URL de foto de perfil inválido.' });
          return;
        }
        dataToUpdate.avatarUrl = safeAvatar;
      }
    }

    if (Object.keys(dataToUpdate).length === 0) {
      res.json({ user: currentUser });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: {
        id: true,
        username: true,
        email: true,
        avatarUrl: true,
        status: true,
        role: true,
        approvalStatus: true,
        isApproved: true,
        createdAt: true,
      },
    });

    res.json({ user: updated });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro interno ao atualizar perfil.' });
  }
});

router.patch('/password', authMiddleware, authRateLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const currentPassword = ensureScalarString(req.body?.currentPassword, 128);
    const newPassword = ensureScalarString(req.body?.newPassword, 128);

    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'A senha atual e a nova senha são obrigatórias.' });
      return;
    }

    if (newPassword.length < 4 || newPassword.length > 128) {
      res.status(400).json({ error: 'A nova senha deve ter entre 4 e 128 caracteres.' });
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

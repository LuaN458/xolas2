import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isValidIdentifier } from './security';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    email: string;
    role?: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.substring(7).trim()
      : undefined;

  if (!token || token.length > 2048) {
    res.status(401).json({ error: 'Token de autenticação não fornecido.' });
    return;
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
      res.status(401).json({ error: 'Token de autenticação malformado.' });
      return;
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      role: typeof decoded.role === 'string' ? decoded.role : 'USER',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

/**
 * Middleware para proteger rotas administrativas.
 * Consulta o banco de dados diretamente para garantir que o papel de ADMIN seja atual e válido.
 */
export async function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId || !isValidIdentifier(userId)) {
    res.status(401).json({ error: 'Acesso não autenticado.' });
    return;
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isApproved: true, approvalStatus: true },
    });

    if (!dbUser || dbUser.role !== 'ADMIN' || !dbUser.isApproved) {
      res.status(403).json({ error: 'Acesso restrito a administradores do sistema.' });
      return;
    }

    req.user!.role = 'ADMIN';
    next();
  } catch (err) {
    console.error('Erro na verificação de admin:', err);
    res.status(500).json({ error: 'Erro ao verificar privilégios administrativos.' });
  }
}

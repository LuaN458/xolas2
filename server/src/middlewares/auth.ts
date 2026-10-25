import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    email: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.query.token as string | undefined);

  if (!token) {
    res.status(401).json({ error: 'Token de autenticação não fornecido.' });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026';
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      username: string;
      email: string;
    };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

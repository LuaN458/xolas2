import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isValidIdentifier } from './security';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    username: string;
    email: string;
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
    };

    if (!decoded || !isValidIdentifier(decoded.userId) || typeof decoded.username !== 'string') {
      res.status(401).json({ error: 'Token de autenticação malformado.' });
      return;
    }

    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      email: typeof decoded.email === 'string' ? decoded.email : '',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

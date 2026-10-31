import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { createRateLimiter } from '../middlewares/security';
import {
  validateUploadedImage,
  getChatUploadsDirectory,
} from '../middlewares/uploadSecurity';
import { prisma } from '../lib/prisma';

const router = Router();

// Armazenar temporariamente em memória para inspecionar bytes antes de salvar no disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8 MB
    files: 1,
  },
});

// Rate limiter específico para upload de imagens (máx 20 uploads a cada 60 segundos por IP)
const uploadRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Limite de upload de imagens atingido. Aguarde um momento antes de enviar novos arquivos.',
});

/**
 * POST /api/upload/chat-image
 * Recebe arquivo via multipart/form-data (campo 'image' ou 'file'),
 * aplica filtros de segurança técnica rígidos e salva com UUID seguro.
 */
router.post(
  '/chat-image',
  authMiddleware,
  uploadRateLimiter,
  (req, res, next) => {
    upload.single('image')(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ error: 'A imagem não pode exceder o limite de 8 MB.' });
          return;
        }
        res.status(400).json({ error: `Erro no upload: ${err.message}` });
        return;
      }
      if (err) {
        res.status(400).json({ error: 'Falha ao processar o arquivo enviado.' });
        return;
      }
      next();
    });
  },
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const file = req.file;
      if (!file || !file.buffer) {
        res.status(400).json({ error: 'Nenhuma imagem foi enviada.' });
        return;
      }

      // Validar se o usuário está com conta aprovada
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { approvalStatus: true, isApproved: true },
      });

      if (!dbUser || (dbUser.approvalStatus !== 'APPROVED' && !dbUser.isApproved)) {
        res.status(403).json({ error: 'Sua conta ainda não foi aprovada por um administrador para enviar arquivos.' });
        return;
      }

      // Validação estrita de Magic Bytes, extensão e segurança
      const validation = validateUploadedImage(file.buffer, file.originalname);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const { info } = validation;
      const uploadsDir = getChatUploadsDirectory();
      const targetFilePath = path.join(uploadsDir, info.safeFileName);

      // Salva o buffer validado de forma assíncrona
      await fs.promises.writeFile(targetFilePath, file.buffer);

      const publicRelativeUrl = `/uploads/chat/${info.safeFileName}`;

      res.status(201).json({
        success: true,
        url: publicRelativeUrl,
        format: info.format,
        mimeType: info.mimeType,
        fileSize: info.fileSize,
      });
    } catch (error) {
      console.error('Erro no processamento do upload de imagem:', error);
      res.status(500).json({ error: 'Erro interno ao salvar a imagem no servidor.' });
    }
  }
);

export default router;

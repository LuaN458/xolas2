import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export interface ValidatedImageInfo {
  format: 'png' | 'jpeg' | 'gif' | 'webp';
  mimeType: string;
  extension: string;
  safeFileName: string;
  fileSize: number;
}

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/**
 * Validação rigorosa de Magic Bytes (assinatura binária) para garantir que
 * o buffer seja genuinamente uma imagem rasterizada válida e não código executável / script malicioso disfarçado.
 */
export function detectImageMagicBytes(buffer: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }

  // GIF: GIF87a ou GIF89a (47 49 46 38 37 61 ou 47 49 46 38 39 61)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return 'gif';
  }

  // WebP: RIFF (bytes 0-3: 52 49 46 46) e WEBP (bytes 8-11: 57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

/**
 * Valida o arquivo recebido contra extensões perigosas, tamanho e assinatura binária real.
 * Bloqueia estritamente SVGs (vetor clássico de XSS via tags <script> / onload) e executáveis.
 */
export function validateUploadedImage(
  buffer: Buffer,
  originalFilename?: string,
  maxSizeBytes = 8 * 1024 * 1024
): { valid: true; info: ValidatedImageInfo } | { valid: false; error: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Arquivo de imagem vazio.' };
  }

  if (buffer.length > maxSizeBytes) {
    return {
      valid: false,
      error: `A imagem excede o tamanho máximo permitido de ${Math.round(maxSizeBytes / (1024 * 1024))} MB.`,
    };
  }

  // Se o nome original for fornecido, checa extensão
  if (originalFilename) {
    const rawExt = path.extname(originalFilename).toLowerCase();
    // Bloqueio explícito de SVG e extensões perigosas
    if (rawExt === '.svg') {
      return { valid: false, error: 'Arquivos no formato SVG não são permitidos por motivos de segurança.' };
    }
    if (!ALLOWED_EXTENSIONS.has(rawExt)) {
      return {
        valid: false,
        error: 'Extensão de arquivo não suportada. Formatos permitidos: PNG, JPG, JPEG, WebP, GIF.',
      };
    }
  }

  // Validação real de Magic Bytes
  const detectedFormat = detectImageMagicBytes(buffer);
  if (!detectedFormat) {
    return {
      valid: false,
      error: 'Assinatura binária do arquivo inválida. O arquivo enviado não é uma imagem rasterizada válida.',
    };
  }

  const ext = detectedFormat === 'jpeg' ? '.jpg' : `.${detectedFormat}`;
  const safeId = crypto.randomUUID();
  const safeFileName = `${safeId}${ext}`;

  return {
    valid: true,
    info: {
      format: detectedFormat,
      mimeType: MIME_MAP[detectedFormat] || 'application/octet-stream',
      extension: ext,
      safeFileName,
      fileSize: buffer.length,
    },
  };
}

/**
 * Garante que a pasta de uploads de chat exista no disco
 */
export function getChatUploadsDirectory(): string {
  const uploadsDir = path.resolve(process.cwd(), 'uploads', 'chat');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

/**
 * Valida se uma URL de anexo enviada em mensagem corresponde estritamente
 * a um caminho relativo legítimo gerado pelo servidor em /uploads/chat/<uuid>.<ext>.
 * Evita ataques de SSRF, path traversal e injeção de links maliciosos.
 */
export function sanitizeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();
  const safeChatUploadRegex = /^\/uploads\/chat\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/i;
  if (!safeChatUploadRegex.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Exclui com segurança o arquivo físico correspondente ao anexo no disco
 */
export async function deleteUploadedFileSafe(attachmentUrl?: string | null): Promise<void> {
  if (!attachmentUrl) return;
  const safeUrl = sanitizeAttachmentUrl(attachmentUrl);
  if (!safeUrl) return;

  try {
    const filename = path.basename(safeUrl);
    const uploadsDir = getChatUploadsDirectory();
    const filePath = path.join(uploadsDir, filename);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (err) {
    console.warn('Erro ao remover arquivo físico de anexo:', err);
  }
}


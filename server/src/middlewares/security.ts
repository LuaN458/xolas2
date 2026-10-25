import { Request, Response, NextFunction } from 'express';

// Padrões clássicos de SQL Injection / Comandos maliciosos em parâmetros e identificadores
const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|DECLARE|CAST|CONVERT)\b\s+[\w\*,\s]+\b(FROM|INTO|TABLE|DATABASE|SET|WHERE|ALL|SELECT)\b)/i,
  /(\b(OR|AND)\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
  /(--\s|\/\*[\s\S]*?\*\/|;\s*(DROP|DELETE|UPDATE|INSERT|SHUTDOWN|EXEC))/i,
  /(\b(SLEEP|BENCHMARK|WAITFOR\s+DELAY|PG_SLEEP|XP_CMDSHELL)\b\s*\()/i,
];

const DANGEROUS_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Garante que um valor de entrada seja estritamente uma string escalar (bloqueia Operator Injection no Prisma/ORM,
 * onde objetos como { "$gt": "" } ou { "contains": "" } são enviados no lugar de strings).
 */
export function ensureScalarString(val: unknown, maxLength = 4000): string | null {
  if (typeof val !== 'string') return null;
  const cleaned = val.replace(/\0/g, '').trim();
  if (cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }
  return cleaned;
}

/**
 * Verifica se uma string contém tentativas explícitas de SQL Injection
 */
export function hasSqlInjectionSignature(value: string): boolean {
  if (!value) return false;
  return SQL_INJECTION_PATTERNS.some((regex) => regex.test(value));
}

/**
 * Valida identificadores (UUIDs ou IDs alfanuméricos seguros) para evitar SQLi/Path Traversal em params de rota
 */
export function isValidIdentifier(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length < 1 || trimmed.length > 128) return false;
  // Permitir apenas caracteres alfanuméricos, hífens e underscores (padrão UUID / CUID)
  return /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

/**
 * Sanitiza texto livre (mensagens, nomes de servidores/canais, apelidos) removendo bytes nulos,
 * caracteres de controle invisíveis e vetores de script inline.
 */
export function sanitizeText(input: unknown, maxLength = 4000): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Valida URLs e Data URIs de mídia (como iconUrl e avatarUrl) permitindo apenas protocolos seguros (https://, http://)
 * ou Data URIs de imagens rasterizadas (png, jpeg, webp, gif) para prevenir ataques XSS via javascript:, data:text/html ou file://.
 */
export function sanitizeSafeUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const trimmed = url.trim();

  // Suporte a Data URIs de imagem compactada (PNG, JPEG, WebP, GIF) até 350 KB (~250 KB em imagem binária)
  if (trimmed.startsWith('data:image/')) {
    if (trimmed.length > 350_000) return null;
    const isSafeDataUri = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed);
    return isSafeDataUri ? trimmed : null;
  }

  if (trimmed.length > 2048) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Limpa recursivamente objetos JSON contra Prototype Pollution, bytes nulos e profundidade excessiva
 */
function deepSanitizeObject(obj: any, depth = 0): any {
  if (depth > 6) return undefined;
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return obj.replace(/\0/g, '');
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 100).map((item) => deepSanitizeObject(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const key of Object.keys(obj)) {
      if (DANGEROUS_PROTOTYPE_KEYS.has(key) || key.startsWith('$')) {
        continue;
      }
      cleaned[key] = deepSanitizeObject(obj[key], depth + 1);
    }
    return cleaned;
  }

  return obj;
}

/**
 * Middleware de cabeçalhos de segurança HTTP (equivalente ao Helmet OWASP)
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );
  next();
}

/**
 * Middleware global contra SQL Injection, Prototype Pollution e ORM Operator Injection
 */
export function securitySanitizerMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = deepSanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = deepSanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      for (const [paramKey, paramVal] of Object.entries(req.params)) {
        if (typeof paramVal === 'string' && hasSqlInjectionSignature(paramVal)) {
          console.warn(`[Security] Tentativa de SQL Injection bloqueada no parâmetro "${paramKey}":`, paramVal);
          res.status(400).json({ error: 'Parâmetro inválido bloqueado pelas regras de segurança.' });
          return;
        }
      }
    }

    // Verificar campos de identificação críticos contra assinaturas de SQL Injection
    const fieldsToInspect = ['username', 'email', 'identifier', 'channelId', 'serverId'];
    if (req.body && typeof req.body === 'object') {
      for (const field of fieldsToInspect) {
        const val = req.body[field];
        if (val !== undefined && val !== null) {
          if (typeof val !== 'string') {
            res.status(400).json({ error: `Formato inválido para o campo ${field}.` });
            return;
          }
          if (hasSqlInjectionSignature(val)) {
            console.warn(`[Security] Tentativa de SQL Injection bloqueada no campo "${field}":`, val);
            res.status(400).json({ error: 'Entrada rejeitada por conter padrões de injeção SQL.' });
            return;
          }
        }
      }
    }

    next();
  } catch (err) {
    console.error('[Security] Erro ao sanitizar requisição:', err);
    res.status(400).json({ error: 'Requisição malformada.' });
  }
}

/**
 * Rate Limiter em memória por IP para proteção contra Brute Force e DoS
 */
export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message: string;
}) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Limpeza periódica para evitar crescimento de memória
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of hits.entries()) {
      if (now > data.resetAt) {
        hits.delete(ip);
      }
    }
  }, Math.max(options.windowMs, 60_000)).unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now > record.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    record.count += 1;
    if (record.count > options.maxRequests) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: options.message });
      return;
    }

    next();
  };
}

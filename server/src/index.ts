import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server as SocketIOServer } from 'socket.io';

dotenv.config();

import authRoutes from './routes/auth';
import serverRoutes from './routes/servers';
import channelRoutes from './routes/channels';
import livekitRoutes from './routes/livekit';
import { setupSocketHandlers } from './sockets/chatHandler';
import { prisma } from './lib/prisma';
import {
  securityHeadersMiddleware,
  securitySanitizerMiddleware,
  createRateLimiter,
} from './middlewares/security';

const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);

// Configuração do Socket.io com limite de buffer contra ataques de exaustão de memória
const io = new SocketIOServer(server, {
  maxHttpBufferSize: 100 * 1024, // 100 KB máx por pacote WebSocket
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(securityHeadersMiddleware);
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(securitySanitizerMiddleware);

const globalRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 240,
  message: 'Muitas requisições deste endereço IP. Tente novamente em instantes.',
});

app.use('/api', globalRateLimiter);

// Rota de Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    livekitConfigured: Boolean(process.env.LIVEKIT_URL && !process.env.LIVEKIT_URL.includes('your-livekit-url')),
  });
});

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/livekit', livekitRoutes);

// Configurar WebSockets
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Servidor Discord-Clone rodando na porta ${PORT}`);
  console.log(`📡 WebSocket pronto para conexões`);
});

// Encerramento seguro
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

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

const app = express();
const server = http.createServer(app);

// Configuração do Socket.io com suporte a CORS amplo para desenvolvimento
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

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

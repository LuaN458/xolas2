const http = require('http');
const net = require('net');
const { Server: SocketIOServer } = require('socket.io');
const path = require('path');
const { mockPrisma } = require('./mockPrisma');

// Inject mock Prisma into compiled server module before importing chatHandler
const prismaModulePath = path.resolve(__dirname, '../../server/dist/lib/prisma.js');
const prismaModule = require(prismaModulePath);
prismaModule.prisma = mockPrisma;

// Now require the compiled chatHandler
const chatHandler = require(path.resolve(__dirname, '../../server/dist/sockets/chatHandler.js'));

let activeServer = null;
let activeIo = null;
let activePipeName = null;
let activeUrl = null;

const clientPipes = new Set();
const serverSockets = new Set();

// Hook http.Agent.prototype.createConnection to route local test traffic through Windows named pipe
// This allows genuine socket.io-client network tests to run inside sandboxed Windows environments
const origCreateConnection = http.Agent.prototype.createConnection;
http.Agent.prototype.createConnection = function (options, cb) {
  if (activePipeName) {
    const s = net.connect(activePipeName);
    clientPipes.add(s);
    s.once('close', () => clientPipes.delete(s));
    if (cb) {
      s.on('connect', () => cb(null, s));
      s.on('error', (err) => cb(err));
    }
    return s;
  }
  return origCreateConnection.apply(this, arguments);
};

/**
 * Start an isolated test Socket.IO server on a named pipe.
 * @returns {Promise<{ server: http.Server, io: SocketIOServer, pipeName: string, url: string, close: Function, reset: Function }>}
 */
async function startTestServer() {
  if (activeServer) {
    return {
      server: activeServer,
      io: activeIo,
      pipeName: activePipeName,
      url: activeUrl,
      close: stopTestServer,
      reset: resetServerState,
    };
  }

  activePipeName = `\\\\.\\pipe\\xolas-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeUrl = 'http://localhost';

  const server = http.createServer();
  server.on('connection', (s) => {
    serverSockets.add(s);
    s.once('close', () => serverSockets.delete(s));
  });

  const io = new SocketIOServer(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 1000,
    pingTimeout: 2000,
  });

  chatHandler.setupSocketHandlers(io);

  await new Promise((resolve) => {
    server.listen(activePipeName, () => {
      activeServer = server;
      activeIo = io;
      resolve();
    });
  });

  return {
    server: activeServer,
    io: activeIo,
    pipeName: activePipeName,
    url: activeUrl,
    close: stopTestServer,
    reset: resetServerState,
  };
}

/**
 * Clean up active test server and all connected sockets.
 */
async function stopTestServer() {
  if (activeIo) {
    try {
      activeIo.disconnectSockets(true);
    } catch {}
  }

  for (const s of clientPipes) {
    try {
      s.destroy();
    } catch {}
  }
  clientPipes.clear();

  for (const s of serverSockets) {
    try {
      s.destroy();
    } catch {}
  }
  serverSockets.clear();

  try {
    http.globalAgent.destroy();
  } catch {}

  if (activeIo) {
    await new Promise((resolve) => activeIo.close(resolve));
    activeIo = null;
  }

  if (activeServer) {
    try {
      if (typeof activeServer.closeAllConnections === 'function') {
        activeServer.closeAllConnections();
      }
    } catch {}
    try {
      if (typeof activeServer.unref === 'function') {
        activeServer.unref();
      }
    } catch {}
    await new Promise((resolve) => activeServer.close(resolve));
    activeServer = null;
    activePipeName = null;
    activeUrl = null;
  }
  resetServerState();
}

/**
 * Reset server in-memory maps and mock DB.
 */
function resetServerState() {
  chatHandler.voiceRooms.clear();
  chatHandler.userSockets.clear();
  mockPrisma.reset();
}

module.exports = {
  startTestServer,
  stopTestServer,
  resetServerState,
  chatHandler,
  mockPrisma,
};

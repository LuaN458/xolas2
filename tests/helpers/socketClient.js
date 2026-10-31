const { io } = require('socket.io-client');

const activeClients = new Set();

/**
 * Creates and connects a socket.io-client with Promise resolution.
 * Resolves on 'connect'. Rejects on 'connect_error' or timeout.
 * @param {string} url - Server URL (e.g. http://localhost)
 * @param {string} [token] - JWT token to send in auth
 * @param {Object} [options] - Additional socket.io client options
 * @returns {Promise<import('socket.io-client').Socket>}
 */
function createTestClient(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      transports: ['polling'],
      forceNew: true,
      reconnection: false,
      auth: token !== undefined ? { token } : undefined,
      ...options,
    };

    const client = io(url, opts);
    activeClients.add(client);

    // Suppress unhandled error emissions across all layers
    client.on('error', () => {});
    if (client.io) {
      client.io.on('error', () => {});
      client.io.on('open', () => {
        if (client.io && client.io.engine) {
          client.io.engine.on('error', () => {});
        }
      });
      if (client.io.engine) {
        client.io.engine.on('error', () => {});
      }
    }

    const timer = setTimeout(() => {
      disconnectClient(client);
      reject(new Error(`Socket connection timed out to ${url}`));
    }, options.timeout || 4000);

    client.once('connect', () => {
      clearTimeout(timer);
      if (client.io && client.io.engine) {
        client.io.engine.on('error', () => {});
      }
      resolve(client);
    });

    client.once('connect_error', (err) => {
      clearTimeout(timer);
      disconnectClient(client);
      reject(err);
    });
  });
}

/**
 * Creates a socket expecting a connection rejection (e.g. invalid token, unapproved user).
 * Resolves with Error on 'connect_error'. Rejects if connection unexpectedly succeeds.
 * @param {string} url
 * @param {string} [token]
 * @param {Object} [options]
 * @returns {Promise<{ error: Error, client: import('socket.io-client').Socket }>}
 */
function createRejectedClient(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      transports: ['polling'],
      forceNew: true,
      reconnection: false,
      auth: token !== undefined ? { token } : undefined,
      ...options,
    };

    const client = io(url, opts);
    activeClients.add(client);
    client.on('error', () => {});
    if (client.io) {
      client.io.on('error', () => {});
      if (client.io.engine) {
        client.io.engine.on('error', () => {});
      }
    }

    const timer = setTimeout(() => {
      disconnectClient(client);
      reject(new Error(`Expected rejection timed out without connect_error to ${url}`));
    }, options.timeout || 4000);

    client.once('connect', () => {
      clearTimeout(timer);
      disconnectClient(client);
      reject(new Error('Socket connected successfully when rejection was expected'));
    });

    client.once('connect_error', (err) => {
      clearTimeout(timer);
      disconnectClient(client);
      resolve({ error: err, client });
    });
  });
}

/**
 * Wait for a specific event from a socket.
 * @param {import('socket.io-client').Socket} socket
 * @param {string} eventName
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<any>}
 */
function waitForEvent(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for event "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }

    socket.once(eventName, handler);
  });
}

/**
 * Disconnect a test socket cleanly and maintain dummy error listeners to prevent uncaught error events.
 * @param {import('socket.io-client').Socket} socket
 */
function disconnectClient(socket) {
  if (socket) {
    activeClients.delete(socket);
    try {
      socket.on('error', () => {});
      if (socket.io) {
        socket.io.on('error', () => {});
        socket.io.skipReconnect = true;
        if (socket.io.engine) {
          socket.io.engine.on('error', () => {});
          try {
            socket.io.engine.close();
          } catch {}
        }
        try {
          socket.io.disconnect();
        } catch {}
      }
      socket.disconnect();
    } catch {}
  }
}

/**
 * Disconnect all tracked active clients.
 */
function disconnectAllClients() {
  const clients = Array.from(activeClients);
  activeClients.clear();
  for (const client of clients) {
    disconnectClient(client);
  }
}

/**
 * Helper to sleep for ms.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createTestClient,
  createRejectedClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
};

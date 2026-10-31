const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState, chatHandler } = require('../helpers/testServer');
const {
  createTestClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const { getApprovedUserToken } = require('../helpers/authHelper');

test.describe('Tier 3: Network Disconnect & Reconnection Channel Synchronization', () => {
  let serverInfo;

  test.before(async () => {
    serverInfo = await startTestServer();
  });

  test.after(async () => {
    disconnectAllClients();
    await stopTestServer();
  });

  test.beforeEach(async () => {
    disconnectAllClients();
    await sleep(50);
    resetServerState();
  });

  test('reconnected socket rejoins channel and reliably receives new messages without dropping', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    // Alice connects with initial socket (Socket 1)
    let socketAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'channel_reconnect_flow';
    socketAlice.emit('join-channel', channelId);
    clientBob.emit('join-channel', channelId);
    await sleep(150);

    const initialSocketId = socketAlice.id;
    assert.ok(chatHandler.userSockets.get('user_alice')?.has(initialSocketId));

    // Simulate unexpected network drop on Alice
    disconnectClient(socketAlice);
    await sleep(150);

    // Old socket should be removed from server userSockets
    assert.strictEqual(
      chatHandler.userSockets.get('user_alice')?.has(initialSocketId) || false,
      false,
      'Old socket ID must be pruned from userSockets on disconnect'
    );

    // Alice reconnects with new socket (Socket 2)
    socketAlice = await createTestClient(serverInfo.url, tokenAlice);
    const newSocketId = socketAlice.id;
    assert.notStrictEqual(newSocketId, initialSocketId, 'Reconnection should generate a fresh socket ID');

    // Client reconnect lifecycle: automatically re-joins active channel
    socketAlice.emit('join-channel', channelId);
    await sleep(150);

    // Bob sends a message after Alice's reconnection
    const aliceMessagePromise = waitForEvent(socketAlice, 'new-message', 2500);

    clientBob.emit('send-message', {
      channelId,
      content: 'Message delivered after Alice reconnected!',
    });

    const receivedMessage = await aliceMessagePromise;
    assert.strictEqual(receivedMessage.content, 'Message delivered after Alice reconnected!');
    assert.strictEqual(receivedMessage.channelId, channelId);
    assert.strictEqual(receivedMessage.user.id, 'user_bob');

    disconnectClient(socketAlice);
    disconnectClient(clientBob);
  });
});

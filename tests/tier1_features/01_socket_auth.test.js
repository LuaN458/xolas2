const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState, chatHandler } = require('../helpers/testServer');
const {
  createTestClient,
  createRejectedClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const {
  getApprovedUserToken,
  getInvalidToken,
  getWrongSecretToken,
} = require('../helpers/authHelper');

test.describe('Tier 1: Socket Connection & Authentication', () => {
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

  test('successfully connects with valid JWT token for approved user', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    assert.strictEqual(client.connected, true, 'Socket should be connected');
    assert.ok(client.id, 'Socket should have a valid client ID');

    // Verify server tracking state
    assert.strictEqual(chatHandler.isUserOnline('user_alice'), true, 'Alice should be online in server tracking');
    assert.ok(chatHandler.getOnlineUserIds().includes('user_alice'), 'Online user list should include user_alice');

    disconnectClient(client);
  });

  test('receives online-users-list event upon join-server', async () => {
    const token = getApprovedUserToken('user_bob', 'Bob');
    const client = await createTestClient(serverInfo.url, token);

    const onlineListPromise = waitForEvent(client, 'online-users-list', 2000);
    client.emit('join-server', 'server_test_1');

    const onlineList = await onlineListPromise;
    assert.ok(Array.isArray(onlineList), 'online-users-list should return an array');
    assert.ok(onlineList.includes('user_bob'), 'online-users-list should contain user_bob');

    disconnectClient(client);
  });

  test('broadcasts user-status-changed (online) when user connects, and (offline) on disconnect', async () => {
    // Connect observer client first
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    // Prepare to capture status change when Bob connects
    const onlineEventPromise = waitForEvent(clientAlice, 'user-status-changed', 3000);

    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const onlineEvent = await onlineEventPromise;
    assert.strictEqual(onlineEvent.userId, 'user_bob');
    assert.strictEqual(onlineEvent.status, 'online');

    // Prepare to capture status change when Bob disconnects
    const offlineEventPromise = waitForEvent(clientAlice, 'user-status-changed', 3000);
    disconnectClient(clientBob);

    const offlineEvent = await offlineEventPromise;
    assert.strictEqual(offlineEvent.userId, 'user_bob');
    assert.strictEqual(offlineEvent.status, 'offline');

    disconnectClient(clientAlice);
  });

  test('rejects connection when no auth token is provided', async () => {
    const { error } = await createRejectedClient(serverInfo.url, undefined);
    assert.ok(error, 'Should produce a connect_error');
    assert.match(
      error.message,
      /Autenticação necessária|Authentication required/i,
      'Error message should indicate missing auth'
    );
  });

  test('rejects connection when malformed/invalid JWT token is provided', async () => {
    const invalidToken = getInvalidToken();
    const { error } = await createRejectedClient(serverInfo.url, invalidToken);
    assert.ok(error, 'Should produce a connect_error');
    assert.match(error.message, /Token inválido/i, 'Error message should indicate invalid token');
  });

  test('rejects connection when token is signed with wrong secret', async () => {
    const wrongToken = getWrongSecretToken('user_mallory');
    const { error } = await createRejectedClient(serverInfo.url, wrongToken);
    assert.ok(error, 'Should produce a connect_error');
    assert.match(error.message, /Token inválido/i, 'Error message should indicate invalid token signature');
  });
});

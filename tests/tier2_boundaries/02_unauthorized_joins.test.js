const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState, chatHandler } = require('../helpers/testServer');
const {
  createTestClient,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const { getApprovedUserToken } = require('../helpers/authHelper');

test.describe('Tier 2: Unauthorized & Malicious Identifier Rejection', () => {
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

  test('rejects path traversal patterns in channel and server events', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    const maliciousIds = [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      '../admin-room',
      '../../../root',
      'channel/../secret',
    ];

    for (const badId of maliciousIds) {
      client.emit('join-channel', badId);
      client.emit('leave-channel', badId);
      client.emit('join-server', badId);
      client.emit('leave-server', badId);
      client.emit('join-voice', { serverId: badId, channelId: badId });
      client.emit('leave-voice', { serverId: badId, channelId: badId });
    }

    await sleep(150);

    // Verify client is NOT joined to any malicious voice room
    for (const badId of maliciousIds) {
      assert.strictEqual(chatHandler.voiceRooms.has(badId), false, `voiceRooms must not contain ${badId}`);
    }

    // Verify client is still healthy and connected
    assert.strictEqual(client.connected, true);

    disconnectClient(client);
  });

  test('rejects SQL injection patterns in channel and server identifiers', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    const sqliPatterns = [
      "1' OR '1'='1",
      'channel_1; DROP TABLE Message;',
      "admin' UNION SELECT * FROM users--",
      '1 OR 1=1',
    ];

    for (const sqli of sqliPatterns) {
      client.emit('join-channel', sqli);
      client.emit('join-server', sqli);
      client.emit('join-voice', { serverId: 'server_1', channelId: sqli });
      client.emit('send-message', { channelId: sqli, content: 'Test SQLi' });
    }

    await sleep(150);

    for (const sqli of sqliPatterns) {
      assert.strictEqual(chatHandler.voiceRooms.has(sqli), false);
    }

    assert.strictEqual(client.connected, true);

    disconnectClient(client);
  });

  test('rejects non-string and empty identifiers', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    const invalidInputs = [
      null,
      undefined,
      12345,
      {},
      [],
      '',
      '   ',
      true,
      false,
    ];

    for (const bad of invalidInputs) {
      client.emit('join-channel', bad);
      client.emit('join-server', bad);
      client.emit('join-voice', { serverId: bad, channelId: bad });
      client.emit('send-message', { channelId: bad, content: 'bad' });
    }

    await sleep(150);
    assert.strictEqual(client.connected, true);

    disconnectClient(client);
  });
});

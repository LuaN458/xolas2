const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState, mockPrisma } = require('../helpers/testServer');
const {
  createTestClient,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const { getApprovedUserToken } = require('../helpers/authHelper');

test.describe('Tier 2: Malformed Payloads & Input Hardening', () => {
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

  test('send-message with empty content and null attachment is safely dropped without crash', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    client.emit('join-channel', 'channel_audit');
    await sleep(100);

    let messageDelivered = false;
    client.on('new-message', () => {
      messageDelivered = true;
    });

    // Send completely empty content
    client.emit('send-message', {
      channelId: 'channel_audit',
      content: '',
      attachmentUrl: null,
    });

    // Send null content
    client.emit('send-message', {
      channelId: 'channel_audit',
      content: null,
      attachmentUrl: null,
    });

    // Send whitespace only content
    client.emit('send-message', {
      channelId: 'channel_audit',
      content: '   \n\t   ',
      attachmentUrl: null,
    });

    await sleep(250);

    assert.strictEqual(messageDelivered, false, 'Empty or whitespace-only messages must not be broadcast');
    assert.strictEqual(mockPrisma.messages.size, 0, 'No empty messages should be persisted to DB');

    disconnectClient(client);
  });

  test('send-message with null or primitive payload does not crash server', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    // Completely malformed payload structures
    client.emit('send-message', null);
    client.emit('send-message', undefined);
    client.emit('send-message', 12345);
    client.emit('send-message', 'not-an-object');
    client.emit('send-message', []);

    await sleep(150);

    // Server should still be responsive and handle subsequent valid requests
    assert.strictEqual(client.connected, true, 'Client should remain connected after malformed payloads');

    disconnectClient(client);
  });

  test('send-message with oversized content (>4000 chars) is truncated to 4000 characters safely', async () => {
    const token = getApprovedUserToken('user_alice', 'Alice');
    const client = await createTestClient(serverInfo.url, token);

    const channelId = 'channel_large';
    client.emit('join-channel', channelId);
    await sleep(100);

    let deliveredMessage = null;
    client.on('new-message', (msg) => {
      deliveredMessage = msg;
    });

    const oversizedText = 'A'.repeat(5000);
    client.emit('send-message', {
      channelId,
      content: oversizedText,
    });

    await sleep(250);

    assert.ok(deliveredMessage, 'Message should still be saved and broadcast');
    assert.strictEqual(deliveredMessage.content.length, 4000, 'Content must be truncated to max 4000 chars');

    disconnectClient(client);
  });

  test('webrtc-offer with oversized SDP (>65536 bytes) is dropped to prevent memory exhaustion', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_buffer_test';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    let bobReceivedOffer = false;
    clientBob.on('webrtc-offer', () => {
      bobReceivedOffer = true;
    });

    // Create SDP string larger than 65536 bytes
    const massiveSdp = 'a=candidate:' + 'x'.repeat(70000);
    clientAlice.emit('webrtc-offer', {
      toUserId: 'user_bob',
      channelId,
      sdp: { type: 'offer', sdp: massiveSdp },
    });

    await sleep(250);
    assert.strictEqual(bobReceivedOffer, false, 'Oversized SDP offer must be dropped by server');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });
});

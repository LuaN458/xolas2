const test = require('node:test');
const assert = require('node:assert');
const { startTestServer, stopTestServer, resetServerState } = require('../helpers/testServer');
const {
  createTestClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const { getApprovedUserToken } = require('../helpers/authHelper');

test.describe('Tier 1: Message Sending, Persistence & Delivery', () => {
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

  test('successfully sends and delivers text message to multiple channel members', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'channel_general_chat';
    clientAlice.emit('join-channel', channelId);
    clientBob.emit('join-channel', channelId);
    await sleep(150);

    const bobPromise = waitForEvent(clientBob, 'new-message', 2500);

    clientAlice.emit('send-message', {
      channelId,
      content: 'Hello everyone in general chat!',
    });

    const bobMsg = await bobPromise;

    assert.strictEqual(bobMsg.content, 'Hello everyone in general chat!');
    assert.strictEqual(bobMsg.channelId, channelId);
    assert.strictEqual(bobMsg.user.id, 'user_alice');
    assert.strictEqual(bobMsg.user.username, 'Alice');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('successfully sends message with attachment URL', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'channel_media';
    clientAlice.emit('join-channel', channelId);
    clientBob.emit('join-channel', channelId);
    await sleep(150);

    const bobPromise = waitForEvent(clientBob, 'new-message', 2500);

    clientAlice.emit('send-message', {
      channelId,
      content: 'Check out this screenshot',
      attachmentUrl: '/uploads/chat/screenshot123.png',
    });

    const received = await bobPromise;
    assert.strictEqual(received.content, 'Check out this screenshot');
    assert.strictEqual(received.attachmentUrl, '/uploads/chat/screenshot123.png');
    assert.strictEqual(received.attachmentType, 'IMAGE');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('sender also receives the broadcast if they are joined to the channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    const channelId = 'channel_announcements';
    clientAlice.emit('join-channel', channelId);
    await sleep(150);

    const alicePromise = waitForEvent(clientAlice, 'new-message', 2500);

    clientAlice.emit('send-message', {
      channelId,
      content: 'Self broadcast confirmation',
    });

    const msg = await alicePromise;
    assert.strictEqual(msg.content, 'Self broadcast confirmation');
    assert.strictEqual(msg.user.id, 'user_alice');

    disconnectClient(clientAlice);
  });
});

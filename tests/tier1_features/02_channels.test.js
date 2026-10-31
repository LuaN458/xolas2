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

test.describe('Tier 1: Channel Join, Leave & Membership Isolation', () => {
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

  test('user joins channel and receives messages sent to that channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    // Both join channel_general
    clientAlice.emit('join-channel', 'channel_general');
    clientBob.emit('join-channel', 'channel_general');
    await sleep(100);

    const messagePromise = waitForEvent(clientBob, 'new-message', 2000);

    clientAlice.emit('send-message', {
      channelId: 'channel_general',
      content: 'Hello channel members!',
    });

    const receivedMessage = await messagePromise;
    assert.strictEqual(receivedMessage.content, 'Hello channel members!');
    assert.strictEqual(receivedMessage.channelId, 'channel_general');
    assert.strictEqual(receivedMessage.user.id, 'user_alice');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('user leaves channel and stops receiving subsequent messages', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    clientAlice.emit('join-channel', 'channel_tech');
    clientBob.emit('join-channel', 'channel_tech');
    await sleep(100);

    // Bob leaves channel_tech
    clientBob.emit('leave-channel', 'channel_tech');
    await sleep(100);

    let bobReceivedMessage = false;
    clientBob.on('new-message', () => {
      bobReceivedMessage = true;
    });

    clientAlice.emit('send-message', {
      channelId: 'channel_tech',
      content: 'Is Bob still here?',
    });

    await sleep(200);
    assert.strictEqual(bobReceivedMessage, false, 'Bob should not receive messages after leave-channel');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('channel isolation: messages in channel A are never delivered to channel B', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    clientAlice.emit('join-channel', 'channel_alpha');
    clientBob.emit('join-channel', 'channel_beta');
    await sleep(100);

    let bobReceivedMessage = false;
    clientBob.on('new-message', () => {
      bobReceivedMessage = true;
    });

    clientAlice.emit('send-message', {
      channelId: 'channel_alpha',
      content: 'Alpha secret message',
    });

    await sleep(200);
    assert.strictEqual(bobReceivedMessage, false, 'Client in channel_beta must not receive channel_alpha messages');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('channel switching: cleanly departs previous channel upon joining new channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    // Alice starts in channel_1
    clientAlice.emit('join-channel', 'channel_1');
    clientBob.emit('join-channel', 'channel_1');
    clientBob.emit('join-channel', 'channel_2');
    await sleep(100);

    // Alice switches from channel_1 to channel_2
    clientAlice.emit('leave-channel', 'channel_1');
    clientAlice.emit('join-channel', 'channel_2');
    await sleep(100);

    let aliceReceivedCh1 = false;
    let aliceReceivedCh2 = false;

    clientAlice.on('new-message', (msg) => {
      if (msg.channelId === 'channel_1') aliceReceivedCh1 = true;
      if (msg.channelId === 'channel_2') aliceReceivedCh2 = true;
    });

    // Bob sends to channel_1
    clientBob.emit('send-message', {
      channelId: 'channel_1',
      content: 'Message to channel 1',
    });

    // Bob sends to channel_2
    clientBob.emit('send-message', {
      channelId: 'channel_2',
      content: 'Message to channel 2',
    });

    await sleep(200);

    assert.strictEqual(aliceReceivedCh1, false, 'Alice should not receive channel_1 after leaving');
    assert.strictEqual(aliceReceivedCh2, true, 'Alice should receive channel_2 after joining');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });
});

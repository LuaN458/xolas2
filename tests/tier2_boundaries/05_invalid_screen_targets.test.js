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

test.describe('Tier 2: Invalid Signaling Targets & Room Verification', () => {
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

  test('drops webrtc-offer if sender is not an active member in target voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_secure_ch';
    const serverId = 'server_main';

    // Bob joins voice_secure_ch, but Alice does NOT join!
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    let bobReceivedOffer = false;
    clientBob.on('webrtc-offer', () => {
      bobReceivedOffer = true;
    });

    // Alice attempts to send offer for a channel she has not joined
    clientAlice.emit('webrtc-offer', {
      toUserId: 'user_bob',
      channelId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=- 111 2 IN IP4 127.0.0.1\r\ns=-\r\n' },
    });

    await sleep(250);

    assert.strictEqual(bobReceivedOffer, false, 'Offer must not be relayed when sender is not in voice room');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('drops webrtc-answer and ice-candidate if sender is not in the voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_closed_room';
    const serverId = 'server_main';

    // Only Bob is in the channel
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    let bobReceivedAnswer = false;
    let bobReceivedCandidate = false;

    clientBob.on('webrtc-answer', () => {
      bobReceivedAnswer = true;
    });
    clientBob.on('webrtc-ice-candidate', () => {
      bobReceivedCandidate = true;
    });

    // Alice sends answer and ice candidate without joining
    clientAlice.emit('webrtc-answer', {
      toUserId: 'user_bob',
      channelId,
      sdp: { type: 'answer', sdp: 'v=0\r\n' },
    });
    clientAlice.emit('webrtc-ice-candidate', {
      toUserId: 'user_bob',
      channelId,
      candidate: { candidate: 'candidate:dummy' },
    });

    await sleep(250);

    assert.strictEqual(bobReceivedAnswer, false);
    assert.strictEqual(bobReceivedCandidate, false);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('request-screen-stream to non-existent target user is handled safely without server crash', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    const channelId = 'voice_stream_test';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Alice requests screen from a target that does not exist or is offline
    clientAlice.emit('request-screen-stream', {
      toUserId: 'user_phantom_target_999',
      channelId,
    });

    await sleep(150);

    // Verify Alice is still connected and operational
    assert.strictEqual(clientAlice.connected, true);

    disconnectClient(clientAlice);
  });
});

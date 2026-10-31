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

test.describe('Tier 1: WebRTC P2P Signaling Relay & Screen Stream Request', () => {
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

  test('relays webrtc-offer from caller to callee within active voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_signaling_1';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    const offerPromise = waitForEvent(clientBob, 'webrtc-offer', 2500);

    const mockOfferSdp = { type: 'offer', sdp: 'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
    clientAlice.emit('webrtc-offer', {
      toUserId: 'user_bob',
      channelId,
      sdp: mockOfferSdp,
      screenStreamId: null,
    });

    const receivedOffer = await offerPromise;
    assert.strictEqual(receivedOffer.fromUserId, 'user_alice');
    assert.strictEqual(receivedOffer.fromUsername, 'Alice');
    assert.strictEqual(receivedOffer.channelId, channelId);
    assert.strictEqual(receivedOffer.sdp.type, 'offer');
    assert.strictEqual(receivedOffer.sdp.sdp, mockOfferSdp.sdp);
    assert.strictEqual(receivedOffer.screenStreamId, null);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('relays webrtc-answer from callee back to caller', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_signaling_2';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    const answerPromise = waitForEvent(clientAlice, 'webrtc-answer', 2500);

    const mockAnswerSdp = { type: 'answer', sdp: 'v=0\r\no=- 654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };
    clientBob.emit('webrtc-answer', {
      toUserId: 'user_alice',
      channelId,
      sdp: mockAnswerSdp,
      screenStreamId: null,
    });

    const receivedAnswer = await answerPromise;
    assert.strictEqual(receivedAnswer.fromUserId, 'user_bob');
    assert.strictEqual(receivedAnswer.fromUsername, 'Bob');
    assert.strictEqual(receivedAnswer.channelId, channelId);
    assert.strictEqual(receivedAnswer.sdp.type, 'answer');
    assert.strictEqual(receivedAnswer.sdp.sdp, mockAnswerSdp.sdp);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('relays webrtc-ice-candidate between peers', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_signaling_3';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    const candidatePromise = waitForEvent(clientBob, 'webrtc-ice-candidate', 2500);

    const mockCandidate = {
      candidate: 'candidate:1 1 UDP 2130706431 192.168.1.50 54321 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    clientAlice.emit('webrtc-ice-candidate', {
      toUserId: 'user_bob',
      channelId,
      candidate: mockCandidate,
    });

    const receivedCandidate = await candidatePromise;
    assert.strictEqual(receivedCandidate.fromUserId, 'user_alice');
    assert.strictEqual(receivedCandidate.channelId, channelId);
    assert.deepStrictEqual(receivedCandidate.candidate, mockCandidate);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('relays request-screen-stream to broadcaster', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'voice_signaling_4';
    const serverId = 'server_main';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Alice is broadcaster, Bob is viewer
    const requestPromise = waitForEvent(clientAlice, 'request-screen-stream', 2500);

    clientBob.emit('request-screen-stream', {
      toUserId: 'user_alice',
      channelId,
    });

    const receivedRequest = await requestPromise;
    assert.strictEqual(receivedRequest.fromUserId, 'user_bob');
    assert.strictEqual(receivedRequest.channelId, channelId);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });
});

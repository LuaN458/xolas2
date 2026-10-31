const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { startTestServer, stopTestServer, resetServerState, chatHandler, mockPrisma } = require('../helpers/testServer');
const {
  createTestClient,
  createRejectedClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const {
  JWT_SECRET,
  getApprovedUserToken,
  getUnapprovedUserToken,
  getWrongSecretToken,
  generateToken,
} = require('../helpers/authHelper');

test.describe('Adversarial Resilience Challenge Harness (Challenger 1)', () => {
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

  // =========================================================================
  // CHALLENGE 1: Rapid Reconnect Storm & Ghost Presence Elimination
  // =========================================================================
  test('CHALLENGE 1: Rapid reconnect storm (10 cycles) leaves zero ghost participants and cleans up on final exit', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const serverId = 'server_storm';
    const channelId = 'voice_storm_channel';

    // Bob acts as constant observer in the voice channel
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    clientBob.emit('join-server', serverId);
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    const activeAliceSockets = [];

    // Simulate aggressive network instability: 10 rapid connections created with staggered drops
    for (let i = 0; i < 10; i++) {
      const sock = await createTestClient(serverInfo.url, tokenAlice);
      sock.emit('join-server', serverId);
      sock.emit('join-voice', { serverId, channelId });
      activeAliceSockets.push(sock);

      // Disconnect earlier sockets in an interleaved fashion
      if (activeAliceSockets.length > 2) {
        const stale = activeAliceSockets.shift();
        disconnectClient(stale);
      }
      await sleep(30);
    }

    await sleep(200);

    // At this point, only remaining Alice sockets are still open
    const aliceSocketIds = chatHandler.userSockets.get('user_alice');
    assert.ok(aliceSocketIds && aliceSocketIds.size > 0, 'Alice must have active sockets registered');
    assert.strictEqual(aliceSocketIds.size, activeAliceSockets.length);

    // CRITICAL: Alice must appear exactly ONCE in voiceRooms, NOT 10 times
    const participants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(participants.length, 2, 'voiceRooms must contain exactly Bob and Alice (no ghosts)');
    const aliceEntries = participants.filter((p) => p.id === 'user_alice');
    assert.strictEqual(aliceEntries.length, 1, 'Alice must have exactly 1 participant entry');

    // Now disconnect ALL remaining Alice sockets
    while (activeAliceSockets.length > 0) {
      const sock = activeAliceSockets.shift();
      disconnectClient(sock);
    }
    await sleep(300);

    // Alice must be COMPLETELY evicted from voiceRooms now that all sockets closed
    const finalParticipants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(finalParticipants.length, 1, 'Only Bob should remain in voiceRooms');
    assert.strictEqual(finalParticipants[0].id, 'user_bob');

    // Alice userSockets entry must be deleted
    assert.strictEqual(chatHandler.userSockets.has('user_alice'), false, 'userSockets must not hold stale user_alice entry');

    disconnectClient(clientBob);
  });

  // =========================================================================
  // CHALLENGE 2: Forged & Tampered Token Attack Vector
  // =========================================================================
  test('CHALLENGE 2: Forged, algorithm-none, expired, or malformed tokens cannot connect', async () => {
    // 1. Token with wrong secret
    const wrongSecretToken = getWrongSecretToken('user_attacker');
    const res1 = await createRejectedClient(serverInfo.url, wrongSecretToken);
    assert.ok(res1.error, 'Wrong secret must be rejected');

    // 2. Token with algorithm: none
    const algNoneToken = jwt.sign({ userId: 'user_alice', username: 'Alice' }, '', { algorithm: 'none' });
    const res2 = await createRejectedClient(serverInfo.url, algNoneToken);
    assert.ok(res2.error, 'Algorithm "none" must be rejected');

    // 3. Expired token
    const expiredToken = jwt.sign(
      { userId: 'user_alice', username: 'Alice' },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: -60 }
    );
    const res3 = await createRejectedClient(serverInfo.url, expiredToken);
    assert.ok(res3.error, 'Expired token must be rejected');

    // 4. Token with path traversal userId
    const traversalToken = generateToken({ userId: '../../etc/passwd', username: 'Traverser' });
    const res4 = await createRejectedClient(serverInfo.url, traversalToken);
    assert.ok(res4.error, 'Path traversal userId must be rejected');

    // 5. Token with SQL injection userId
    const sqliToken = generateToken({ userId: "admin' OR 1=1 --", username: 'SQLiUser' });
    const res5 = await createRejectedClient(serverInfo.url, sqliToken);
    assert.ok(res5.error, 'SQLi userId must be rejected');

    // 6. Unapproved user token
    const unapprovedToken = getUnapprovedUserToken('user_pending', 'PendingUser');
    const res6 = await createRejectedClient(serverInfo.url, unapprovedToken);
    assert.ok(res6.error, 'Unapproved user must be rejected');
    assert.match(res6.error.message, /Conta pendente de aprovação ou não autorizada/i);
  });

  // =========================================================================
  // CHALLENGE 3: Unauthorized Cross-Participant Signaling Relay Attack
  // =========================================================================
  test('CHALLENGE 3: Non-participant cannot spoof WebRTC offers, answers, ICE candidates or screen requests', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenMallory = getApprovedUserToken('user_carol', 'Mallory'); // valid approved user

    const channelId = 'voice_secure_private';
    const serverId = 'server_corp';

    // Alice and Bob join the private voice channel
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Mallory connects but does NOT join the voice channel
    const clientMallory = await createTestClient(serverInfo.url, tokenMallory);

    let aliceReceivedSpoofedOffer = false;
    let aliceReceivedSpoofedAnswer = false;
    let aliceReceivedSpoofedIce = false;
    let aliceReceivedSpoofedScreenRequest = false;

    clientAlice.on('webrtc-offer', () => { aliceReceivedSpoofedOffer = true; });
    clientAlice.on('webrtc-answer', () => { aliceReceivedSpoofedAnswer = true; });
    clientAlice.on('webrtc-ice-candidate', () => { aliceReceivedSpoofedIce = true; });
    clientAlice.on('request-screen-stream', () => { aliceReceivedSpoofedScreenRequest = true; });

    // Mallory attempts to send all 4 signaling event types targeting Alice
    clientMallory.emit('webrtc-offer', {
      toUserId: 'user_alice',
      channelId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=mallory 123 456\r\n' },
    });

    clientMallory.emit('webrtc-answer', {
      toUserId: 'user_alice',
      channelId,
      sdp: { type: 'answer', sdp: 'v=0\r\n' },
    });

    clientMallory.emit('webrtc-ice-candidate', {
      toUserId: 'user_alice',
      channelId,
      candidate: { candidate: 'candidate:mallory' },
    });

    clientMallory.emit('request-screen-stream', {
      toUserId: 'user_alice',
      channelId,
    });

    await sleep(250);

    // None should reach Alice
    assert.strictEqual(aliceReceivedSpoofedOffer, false, 'Spoofed offer must be blocked');
    assert.strictEqual(aliceReceivedSpoofedAnswer, false, 'Spoofed answer must be blocked');
    assert.strictEqual(aliceReceivedSpoofedIce, false, 'Spoofed ICE candidate must be blocked');
    assert.strictEqual(aliceReceivedSpoofedScreenRequest, false, 'Spoofed screen request must be blocked');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
    disconnectClient(clientMallory);
  });

  // =========================================================================
  // CHALLENGE 4: Cross-Server Message & Event Leakage Prevention
  // =========================================================================
  test('CHALLENGE 4: leave-server prevents broadcast leakage across server boundaries', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const serverA = 'server_alpha';
    const serverB = 'server_beta';

    // Alice joins Server A initially
    clientAlice.emit('join-server', serverA);
    await sleep(100);

    // Alice switches to Server B: emits leave-server for A, join-server for B
    clientAlice.emit('leave-server', serverA);
    clientAlice.emit('join-server', serverB);
    await sleep(100);

    let aliceReceivedServerABroadcast = false;
    let aliceReceivedServerBBroadcast = false;

    clientAlice.on('voice-channel-updated', (data) => {
      if (data.channelId === 'ch_alpha_announcement') {
        aliceReceivedServerABroadcast = true;
      }
      if (data.channelId === 'ch_beta_announcement') {
        aliceReceivedServerBBroadcast = true;
      }
    });

    // Bob joins Server A and triggers a broadcast on server:server_alpha
    clientBob.emit('join-server', serverA);
    clientBob.emit('join-voice', { serverId: serverA, channelId: 'ch_alpha_announcement' });
    await sleep(200);

    // Alice must NOT receive Server A's broadcast
    assert.strictEqual(
      aliceReceivedServerABroadcast,
      false,
      'Alice must NOT receive broadcasts from Server A after emitting leave-server'
    );

    // Now Bob joins Server B and triggers a broadcast on server:server_beta
    clientBob.emit('leave-voice', { serverId: serverA, channelId: 'ch_alpha_announcement' });
    clientBob.emit('leave-server', serverA);
    clientBob.emit('join-server', serverB);
    clientBob.emit('join-voice', { serverId: serverB, channelId: 'ch_beta_announcement' });
    await sleep(200);

    // Alice DOES receive Server B's broadcast
    assert.strictEqual(
      aliceReceivedServerBBroadcast,
      true,
      'Alice MUST receive broadcasts from active Server B'
    );

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  // =========================================================================
  // CHALLENGE 5: Flood & Rate Limiter Defense
  // =========================================================================
  test('CHALLENGE 5: Flooding 60 rapid messages does not crash server and throttles excess payloads', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    const channelId = 'channel_flood_test';
    clientAlice.emit('join-channel', channelId);
    await sleep(100);

    let messageCount = 0;
    clientAlice.on('new-message', () => {
      messageCount++;
    });

    // Alice fires 60 messages in rapid bursts (limit is 30 per 10s)
    for (let i = 0; i < 60; i++) {
      clientAlice.emit('send-message', {
        channelId,
        content: `Flood packet #${i}`,
      });
    }

    await sleep(400);

    // Rate limiter must have capped messages to 30
    assert.ok(
      messageCount <= 30,
      `Rate limiter should throttle rapid flood (received ${messageCount}, expected <= 30)`
    );

    // Server must still be fully responsive
    assert.strictEqual(clientAlice.connected, true, 'Client should remain connected after rate-limit throttling');

    disconnectClient(clientAlice);
  });
});

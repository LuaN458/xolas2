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

function waitForUserState(socket, targetUserId, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('voice-user-state-updated', handler);
      reject(new Error(`Timed out waiting for voice-user-state-updated for ${targetUserId}`));
    }, timeoutMs);

    function handler(data) {
      if (data.userId === targetUserId) {
        clearTimeout(timer);
        socket.off('voice-user-state-updated', handler);
        resolve(data);
      }
    }

    socket.on('voice-user-state-updated', handler);
  });
}

function waitForPeerJoined(socket, targetUserId, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('voice-peer-joined', handler);
      reject(new Error(`Timed out waiting for voice-peer-joined for ${targetUserId}`));
    }, timeoutMs);

    function handler(data) {
      const pid = data?.peer?.id || data?.participant?.id || data?.userId;
      if (pid === targetUserId) {
        clearTimeout(timer);
        socket.off('voice-peer-joined', handler);
        resolve(data);
      }
    }

    socket.on('voice-peer-joined', handler);
  });
}

function waitForPeerLeft(socket, targetUserId, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('voice-peer-left', handler);
      reject(new Error(`Timed out waiting for voice-peer-left for ${targetUserId}`));
    }, timeoutMs);

    function handler(data) {
      if (data?.userId === targetUserId) {
        clearTimeout(timer);
        socket.off('voice-peer-left', handler);
        resolve(data);
      }
    }

    socket.on('voice-peer-left', handler);
  });
}

test.describe('Tier 4: Real-World Multi-Participant Voice & Screen Sharing Scenario', () => {
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

  test('3-user voice call with state sync, screen share request, WebRTC renegotiation and clean departure', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenCarol = getApprovedUserToken('user_carol', 'Carol');

    const serverId = 'server_prod_workspace';
    const channelId = 'voice_daily_sync';

    // 1. Users connect sequentially to establish stable polling cycles
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    const clientCarol = await createTestClient(serverInfo.url, tokenCarol);

    // 2. Alice joins voice channel first
    clientAlice.emit('join-voice', { serverId, channelId });
    await sleep(200);

    // 3. Bob joins voice channel; Alice receives Bob
    const bobJoinedAlice = waitForPeerJoined(clientAlice, 'user_bob', 4000);
    clientBob.emit('join-voice', { serverId, channelId });
    await bobJoinedAlice;
    await sleep(200);

    // 4. Carol joins voice channel; Alice and Bob receive Carol
    const carolJoinedPromiseAlice = waitForPeerJoined(clientAlice, 'user_carol', 4000);
    const carolJoinedPromiseBob = waitForPeerJoined(clientBob, 'user_carol', 4000);

    clientCarol.emit('join-voice', { serverId, channelId });

    const [aliceGotCarol, bobGotCarol] = await Promise.all([
      carolJoinedPromiseAlice,
      carolJoinedPromiseBob,
    ]);

    assert.strictEqual(aliceGotCarol.peer?.id || aliceGotCarol.participant?.id, 'user_carol');
    assert.strictEqual(bobGotCarol.peer?.id || bobGotCarol.participant?.id, 'user_carol');

    // Verify exactly 3 participants in voiceRooms
    const activeParticipants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(activeParticipants.length, 3);
    const participantIds = activeParticipants.map((p) => p.id).sort();
    assert.deepStrictEqual(participantIds, ['user_alice', 'user_bob', 'user_carol']);

    // 5. Exchange Voice States
    // Alice starts speaking: Bob and Carol receive state update for Alice
    const aliceSpeakingPromiseBob = waitForUserState(clientBob, 'user_alice', 4000);
    const aliceSpeakingPromiseCarol = waitForUserState(clientCarol, 'user_alice', 4000);

    clientAlice.emit('voice-user-state', {
      channelId,
      serverId,
      isSpeaking: true,
      isMuted: false,
    });

    const [bobSawAliceSpeaking, carolSawAliceSpeaking] = await Promise.all([
      aliceSpeakingPromiseBob,
      aliceSpeakingPromiseCarol,
    ]);
    assert.strictEqual(bobSawAliceSpeaking.userId, 'user_alice');
    assert.strictEqual(bobSawAliceSpeaking.isSpeaking, true);
    assert.strictEqual(carolSawAliceSpeaking.userId, 'user_alice');

    // Bob mutes mic: Alice and Carol receive state update for Bob
    const bobMutePromiseAlice = waitForUserState(clientAlice, 'user_bob', 4000);
    clientBob.emit('voice-user-state', {
      channelId,
      serverId,
      isMuted: true,
      isSpeaking: false,
    });
    const aliceSawBobMute = await bobMutePromiseAlice;
    assert.strictEqual(aliceSawBobMute.userId, 'user_bob');
    assert.strictEqual(aliceSawBobMute.isMuted, true);

    // 6. Carol starts screen share
    const carolSharePromiseAlice = waitForUserState(clientAlice, 'user_carol', 4000);
    const carolSharePromiseBob = waitForUserState(clientBob, 'user_carol', 4000);

    const screenId = 'screen-carol-123';
    clientCarol.emit('voice-user-state', {
      channelId,
      serverId,
      isScreenSharing: true,
      screenStreamId: screenId,
    });

    const [aliceSawCarolScreen, bobSawCarolScreen] = await Promise.all([
      carolSharePromiseAlice,
      carolSharePromiseBob,
    ]);
    assert.strictEqual(bobSawCarolScreen.userId, 'user_carol');
    assert.strictEqual(bobSawCarolScreen.isScreenSharing, true);
    assert.strictEqual(bobSawCarolScreen.screenStreamId, screenId);

    assert.strictEqual(aliceSawCarolScreen.userId, 'user_carol');
    assert.strictEqual(aliceSawCarolScreen.isScreenSharing, true);
    assert.strictEqual(aliceSawCarolScreen.screenStreamId, screenId);

    // 7. Bob (viewer) requests screen stream from Carol (broadcaster)
    const carolGotStreamRequestPromise = waitForEvent(clientCarol, 'request-screen-stream', 4000);

    clientBob.emit('request-screen-stream', {
      toUserId: 'user_carol',
      channelId,
    });

    const requestReceivedByCarol = await carolGotStreamRequestPromise;
    assert.strictEqual(requestReceivedByCarol.fromUserId, 'user_bob');
    assert.strictEqual(requestReceivedByCarol.channelId, channelId);

    // Carol negotiates WebRTC screen offer with Bob
    const bobGotScreenOfferPromise = waitForEvent(clientBob, 'webrtc-offer', 4000);
    clientCarol.emit('webrtc-offer', {
      toUserId: 'user_bob',
      channelId,
      sdp: { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' },
      screenStreamId: screenId,
    });

    const screenOffer = await bobGotScreenOfferPromise;
    assert.strictEqual(screenOffer.fromUserId, 'user_carol');
    assert.strictEqual(screenOffer.screenStreamId, screenId);

    // Bob responds with WebRTC answer
    const carolGotScreenAnswerPromise = waitForEvent(clientCarol, 'webrtc-answer', 4000);
    clientBob.emit('webrtc-answer', {
      toUserId: 'user_carol',
      channelId,
      sdp: { type: 'answer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' },
      screenStreamId: screenId,
    });

    const screenAnswer = await carolGotScreenAnswerPromise;
    assert.strictEqual(screenAnswer.fromUserId, 'user_bob');

    // 8. Alice leaves the call cleanly
    const aliceLeftPromiseBob = waitForPeerLeft(clientBob, 'user_alice', 4000);
    const aliceLeftPromiseCarol = waitForPeerLeft(clientCarol, 'user_alice', 4000);

    clientAlice.emit('leave-voice', { serverId, channelId });

    const [bobSawAliceLeave, carolSawAliceLeave] = await Promise.all([
      aliceLeftPromiseBob,
      aliceLeftPromiseCarol,
    ]);
    assert.strictEqual(bobSawAliceLeave.userId, 'user_alice');
    assert.strictEqual(carolSawAliceLeave.userId, 'user_alice');

    // Verify exactly 2 participants remain (Bob and Carol)
    const remainingParticipants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(remainingParticipants.length, 2);
    const remainingIds = remainingParticipants.map((p) => p.id).sort();
    assert.deepStrictEqual(remainingIds, ['user_bob', 'user_carol']);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
    disconnectClient(clientCarol);
  });
});

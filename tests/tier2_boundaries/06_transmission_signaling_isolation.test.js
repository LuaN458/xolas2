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

test.describe('Tier 2: Transmission Signaling Room Isolation & State Deduplication', () => {
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

  test('safely discards webrtc-offer when target user is in a different voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_iso';
      const channelAlice = 'voice_ch_alice';
      const channelBob = 'voice_ch_bob';

      // Alice joins channelAlice, Bob joins channelBob
      clientAlice.emit('join-voice', { serverId, channelId: channelAlice });
      clientBob.emit('join-voice', { serverId, channelId: channelBob });
      await sleep(150);

      assert.strictEqual(chatHandler.voiceRooms.get(channelAlice)?.has('user_alice'), true);
      assert.strictEqual(chatHandler.voiceRooms.get(channelBob)?.has('user_bob'), true);

      let bobReceivedOffer = false;
      clientBob.on('webrtc-offer', () => {
        bobReceivedOffer = true;
      });

      // Alice attempts cross-channel signaling by targeting Bob in channelAlice (where Bob is NOT present)
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId: channelAlice,
        sdp: { type: 'offer', sdp: 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\n' },
        screenStreamId: 'screen-isolated-1',
      });

      await sleep(250);
      assert.strictEqual(bobReceivedOffer, false, 'Bob should NOT receive webrtc-offer from a channel he is not in');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
    }
  });

  test('safely discards webrtc-answer and ice-candidate when target user is outside voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenCarol = getApprovedUserToken('user_carol', 'Carol');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    const clientCarol = await createTestClient(serverInfo.url, tokenCarol);

    try {
      const serverId = 'server_trans_iso';
      const channelVoice = 'voice_secure_iso';

      // Only Alice joins voice channel. Bob is in a different voice channel, Carol is connected but not in voice.
      clientAlice.emit('join-voice', { serverId, channelId: channelVoice });
      clientBob.emit('join-voice', { serverId, channelId: 'voice_other_room' });
      await sleep(150);

      let bobReceivedAnswer = false;
      let bobReceivedIce = false;
      let carolReceivedAnswer = false;
      let carolReceivedIce = false;

      clientBob.on('webrtc-answer', () => { bobReceivedAnswer = true; });
      clientBob.on('webrtc-ice-candidate', () => { bobReceivedIce = true; });
      clientCarol.on('webrtc-answer', () => { carolReceivedAnswer = true; });
      clientCarol.on('webrtc-ice-candidate', () => { carolReceivedIce = true; });

      // Alice attempts to send answer and ice candidate targeting Bob (in other room) and Carol (not in voice)
      clientAlice.emit('webrtc-answer', {
        toUserId: 'user_bob',
        channelId: channelVoice,
        sdp: { type: 'answer', sdp: 'v=0\r\n' },
      });
      clientAlice.emit('webrtc-answer', {
        toUserId: 'user_carol',
        channelId: channelVoice,
        sdp: { type: 'answer', sdp: 'v=0\r\n' },
      });
      clientAlice.emit('webrtc-ice-candidate', {
        toUserId: 'user_bob',
        channelId: channelVoice,
        candidate: { candidate: 'candidate:dummy' },
      });
      clientAlice.emit('webrtc-ice-candidate', {
        toUserId: 'user_carol',
        channelId: channelVoice,
        candidate: { candidate: 'candidate:dummy' },
      });

      await sleep(250);

      assert.strictEqual(bobReceivedAnswer, false, 'Bob should not receive answer');
      assert.strictEqual(bobReceivedIce, false, 'Bob should not receive ICE candidate');
      assert.strictEqual(carolReceivedAnswer, false, 'Carol should not receive answer');
      assert.strictEqual(carolReceivedIce, false, 'Carol should not receive ICE candidate');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
      disconnectClient(clientCarol);
    }
  });

  test('safely discards request-screen-stream targeting user outside voice channel', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_iso';
      const channelVoice = 'voice_screen_stream_iso';

      // Alice joins voice; Bob is connected to server but not joined to voice_screen_stream_iso
      clientAlice.emit('join-voice', { serverId, channelId: channelVoice });
      await sleep(150);

      let bobReceivedRequest = false;
      clientBob.on('request-screen-stream', () => {
        bobReceivedRequest = true;
      });

      // Alice sends screen stream request for Bob (who is not in the channel)
      clientAlice.emit('request-screen-stream', {
        toUserId: 'user_bob',
        channelId: channelVoice,
      });

      await sleep(250);
      assert.strictEqual(bobReceivedRequest, false, 'request-screen-stream must be discarded when target is not in channel');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
    }
  });

  test('multi-socket glare prevention: signaling routes to channel-active socket and attaches fromSocketId', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    // Alice has 1 socket. Bob has 2 sockets (e.g. 2 browser tabs).
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBobVoice = await createTestClient(serverInfo.url, tokenBob);
    const clientBobText = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_iso';
      const channelId = 'voice_glare_prevention';

      // Alice and Bob's first socket join voice. Bob's second socket joins only text channel/server.
      clientAlice.emit('join-voice', { serverId, channelId });
      clientBobVoice.emit('join-voice', { serverId, channelId });
      clientBobText.emit('join-server', serverId);
      await sleep(200);

      let bobTextReceivedOffer = false;
      clientBobText.on('webrtc-offer', () => {
        bobTextReceivedOffer = true;
      });

      const bobVoiceOfferPromise = waitForEvent(clientBobVoice, 'webrtc-offer', 3000);

      const mockSdp = { type: 'offer', sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n' };
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId,
        sdp: mockSdp,
        screenStreamId: 'screen-glare-test',
      });

      const receivedOffer = await bobVoiceOfferPromise;
      assert.strictEqual(receivedOffer.fromUserId, 'user_alice');
      assert.strictEqual(receivedOffer.fromSocketId, clientAlice.id, 'Forwarded signal must include fromSocketId');
      assert.strictEqual(receivedOffer.screenStreamId, 'screen-glare-test');

      await sleep(150);
      assert.strictEqual(bobTextReceivedOffer, false, 'Non-voice socket of target user must NOT receive signaling (glare prevention)');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBobVoice);
      disconnectClient(clientBobText);
    }
  });

  test('voice-user-state deduplication: channel peers and server users receive exactly one update', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenCarol = getApprovedUserToken('user_carol', 'Carol');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    const clientCarol = await createTestClient(serverInfo.url, tokenCarol);

    try {
      const serverId = 'server_dedup_test';
      const channelId = 'voice_dedup_ch';

      // Alice, Bob, and Carol join server room with explicit acknowledgement
      const aliceServerAck = waitForEvent(clientAlice, 'online-users-list', 3000);
      clientAlice.emit('join-server', serverId);
      await aliceServerAck;

      const bobServerAck = waitForEvent(clientBob, 'online-users-list', 3000);
      clientBob.emit('join-server', serverId);
      await bobServerAck;

      const carolServerAck = waitForEvent(clientCarol, 'online-users-list', 3000);
      clientCarol.emit('join-server', serverId);
      await carolServerAck;

      // Alice joins voice channel and waits for voice-channel-updated
      const aliceJoinVoiceConfirmed = waitForEvent(clientAlice, 'voice-channel-updated', 4000);
      clientAlice.emit('join-voice', { serverId, channelId });
      await aliceJoinVoiceConfirmed;

      // Bob joins voice channel and Alice receives peer joined
      const bobPeerJoinedPromise = waitForEvent(clientAlice, 'voice-peer-joined', 4000);
      clientBob.emit('join-voice', { serverId, channelId });
      await bobPeerJoinedPromise;
      await sleep(150);

      // Track event counts
      let aliceEventCount = 0;
      let bobEventCount = 0;
      let carolEventCount = 0;

      clientAlice.on('voice-user-state-updated', () => { aliceEventCount++; });
      clientBob.on('voice-user-state-updated', () => { bobEventCount++; });
      clientCarol.on('voice-user-state-updated', () => { carolEventCount++; });

      // Alice updates her voice state
      clientAlice.emit('voice-user-state', {
        channelId,
        serverId,
        isMuted: true,
        isSpeaking: false,
        isScreenSharing: true,
        screenStreamId: 'screen-dedup-1',
      });

      await sleep(300);

      // Sender (Alice) should receive 0 events
      assert.strictEqual(aliceEventCount, 0, 'Sender Alice should not receive her own voice-user-state update');

      // Bob (in voice channel AND server room) should receive EXACTLY 1 event (not duplicated)
      assert.strictEqual(bobEventCount, 1, 'Bob in voice channel must receive exactly 1 state update (deduplicated)');

      // Carol (in server room only, outside voice channel) should receive EXACTLY 1 event
      assert.strictEqual(carolEventCount, 1, 'Carol in server room must receive exactly 1 state update');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
      disconnectClient(clientCarol);
    }
  });
});

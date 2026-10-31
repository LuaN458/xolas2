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

test.describe('Tier 4: Transmission Reconnect, Ghost Prevention & Admin Teardown Lifecycle', () => {
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

  test('screen share persistence on reconnect retains broadcast state and announces metadata', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    let clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_lifecycle';
      const channelId = 'voice_reconnect_stream';

      // 1. Both join voice channel
      clientAlice.emit('join-voice', { serverId, channelId });
      clientBob.emit('join-voice', { serverId, channelId });
      await sleep(150);

      // 2. Alice starts screen sharing
      const screenId = 'screen-persistent-uuid-42';
      clientAlice.emit('voice-user-state', {
        channelId,
        serverId,
        isScreenSharing: true,
        screenStreamId: screenId,
      });
      await sleep(150);

      // Verify in-memory state before disconnect
      const initialParticipant = chatHandler.voiceRooms.get(channelId)?.get('user_alice');
      assert.strictEqual(initialParticipant?.isScreenSharing, true);
      assert.strictEqual(initialParticipant?.screenStreamId, screenId);

      // 3. Alice disconnects unexpectedly (e.g. WiFi drop / socket restart)
      disconnectClient(clientAlice);
      await sleep(150);

      // 4. Bob sets up listener for Alice's reconnect announcement
      const bobPeerJoinedPromise = waitForEvent(clientBob, 'voice-peer-joined', 3500);

      // 5. Alice reconnects with new socket, supplying persistent screen sharing flags
      clientAlice = await createTestClient(serverInfo.url, tokenAlice);
      clientAlice.emit('join-voice', {
        serverId,
        channelId,
        isScreenSharing: true,
        screenStreamId: screenId,
      });

      const peerJoinedData = await bobPeerJoinedPromise;
      const peer = peerJoinedData.peer || peerJoinedData.participant;
      assert.strictEqual(peer.id, 'user_alice');
      assert.strictEqual(peer.isScreenSharing, true, 'Reconnected peer must retain isScreenSharing=true');
      assert.strictEqual(peer.screenStreamId, screenId, 'Reconnected peer must retain screenStreamId');

      // 6. Verify in-memory state on server
      const reconnectedParticipant = chatHandler.voiceRooms.get(channelId)?.get('user_alice');
      assert.strictEqual(reconnectedParticipant?.isScreenSharing, true);
      assert.strictEqual(reconnectedParticipant?.screenStreamId, screenId);
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
    }
  });

  test('ghost participant prevention: rapid channel switching leaves user in exactly one voice room', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    try {
      const serverId = 'server_trans_lifecycle';
      const ch1 = 'voice_rapid_1';
      const ch2 = 'voice_rapid_2';
      const ch3 = 'voice_rapid_3';
      const ch4 = 'voice_rapid_4';

      // Alice rapidly emits join-voice across 4 channels without awaiting responses
      clientAlice.emit('join-voice', { serverId, channelId: ch1 });
      clientAlice.emit('join-voice', { serverId, channelId: ch2 });
      clientAlice.emit('join-voice', { serverId, channelId: ch3 });
      clientAlice.emit('join-voice', { serverId, channelId: ch4 });

      // Wait for asynchronous database lookups and sequencing to settle
      await sleep(350);

      // Alice must ONLY be in the final channel ch4
      const room1 = chatHandler.voiceRooms.get(ch1);
      const room2 = chatHandler.voiceRooms.get(ch2);
      const room3 = chatHandler.voiceRooms.get(ch3);
      const room4 = chatHandler.voiceRooms.get(ch4);

      assert.strictEqual(room1?.has('user_alice'), undefined, 'Alice must not be left as ghost in ch1');
      assert.strictEqual(room2?.has('user_alice'), undefined, 'Alice must not be left as ghost in ch2');
      assert.strictEqual(room3?.has('user_alice'), undefined, 'Alice must not be left as ghost in ch3');
      assert.strictEqual(room4?.has('user_alice'), true, 'Alice must be registered in target channel ch4');

      // Verify across all active rooms in server memory
      let totalPresenceCount = 0;
      for (const [_, room] of chatHandler.voiceRooms.entries()) {
        if (room.has('user_alice')) {
          totalPresenceCount++;
        }
      }
      assert.strictEqual(totalPresenceCount, 1, 'Alice must occupy exactly one voice room across the server');
    } finally {
      disconnectClient(clientAlice);
    }
  });

  test('admin user teardown: terminates active sockets, purges voiceRooms, and notifies peers', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    // Alice connects 2 sockets (e.g. desktop + mobile)
    const clientAlice1 = await createTestClient(serverInfo.url, tokenAlice);
    const clientAlice2 = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_lifecycle';
      const channelId = 'voice_admin_teardown';

      // Alice joins first
      clientAlice1.emit('join-voice', { serverId, channelId });
      await sleep(150);

      // Bob joins and Alice waits for voice-peer-joined
      const bobJoinedPromise = waitForEvent(clientAlice1, 'voice-peer-joined', 3000);
      clientBob.emit('join-voice', { serverId, channelId });
      await bobJoinedPromise;
      await sleep(100);

      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_alice'), true);
      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_bob'), true);

      // Bob listens for voice-peer-left
      const bobSawAliceLeavePromise = waitForEvent(clientBob, 'voice-peer-left', 3000);

      // Listen for socket disconnect events on Alice's clients
      let alice1Disconnected = false;
      let alice2Disconnected = false;
      clientAlice1.once('disconnect', () => { alice1Disconnected = true; });
      clientAlice2.once('disconnect', () => { alice2Disconnected = true; });

      // Admin triggers teardown of user_alice
      chatHandler.terminateUserSocketsAndVoice('user_alice');

      // Bob receives voice-peer-left
      const leftEvent = await bobSawAliceLeavePromise;
      assert.strictEqual(leftEvent.userId, 'user_alice');
      assert.strictEqual(leftEvent.channelId, channelId);

      await sleep(200);

      // Alice's sockets must be forcefully disconnected
      assert.strictEqual(alice1Disconnected, true, 'Alice socket 1 must be forcefully disconnected');
      assert.strictEqual(alice2Disconnected, true, 'Alice socket 2 must be forcefully disconnected');
      assert.strictEqual(clientAlice1.connected, false);
      assert.strictEqual(clientAlice2.connected, false);

      // Alice must be purged from voiceRooms
      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_alice'), false);

      // Alice's userSockets entry must be cleared
      assert.strictEqual(chatHandler.userSockets.has('user_alice'), false);

      // Bob remains intact
      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_bob'), true);
    } finally {
      disconnectClient(clientAlice1);
      disconnectClient(clientAlice2);
      disconnectClient(clientBob);
    }
  });

  test('resource & channel teardown: empty voice channel is pruned from memory and userSockets released', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_trans_lifecycle';
      const channelId = 'voice_room_gc_check';

      // Both join
      clientAlice.emit('join-voice', { serverId, channelId });
      clientBob.emit('join-voice', { serverId, channelId });
      await sleep(150);

      assert.strictEqual(chatHandler.voiceRooms.has(channelId), true);
      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.size, 2);

      // Alice leaves
      clientAlice.emit('leave-voice', { serverId, channelId });
      await sleep(100);
      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.size, 1);

      // Bob leaves
      clientBob.emit('leave-voice', { serverId, channelId });
      await sleep(100);

      // When the last user leaves, the channel Map must be pruned to avoid memory leaks
      assert.strictEqual(
        chatHandler.voiceRooms.has(channelId),
        false,
        'Empty voice room must be deleted from chatHandler.voiceRooms'
      );
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
    }
  });
});

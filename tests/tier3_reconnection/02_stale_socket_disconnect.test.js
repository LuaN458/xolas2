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

test.describe('Tier 3: Stale Socket Disconnect vs Active Voice Room Isolation', () => {
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

  test('stale socket disconnect does NOT drop active user from voice room or clear presence when a secondary active socket remains', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const serverId = 'server_reconnect';
    const channelId = 'voice_reconnect_room';

    // 1. Observer Bob connects and joins voice channel
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    clientBob.emit('join-server', serverId);
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // 2. Alice connects with initial socket (Socket 1) and joins voice
    const socketAlice1 = await createTestClient(serverInfo.url, tokenAlice);
    socketAlice1.emit('join-server', serverId);
    socketAlice1.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Verify both Alice and Bob are in the voice room
    assert.strictEqual(chatHandler.getChannelVoiceParticipants(channelId).length, 2);

    // 3. Alice rapidly reconnects/opens second connection (Socket 2) for the SAME user
    const socketAlice2 = await createTestClient(serverInfo.url, tokenAlice);
    socketAlice2.emit('join-server', serverId);
    socketAlice2.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Verify userSockets tracks both sockets for Alice
    const aliceSocketIds = chatHandler.userSockets.get('user_alice');
    assert.strictEqual(aliceSocketIds.size, 2, 'userSockets must track both Socket 1 and Socket 2');
    assert.ok(aliceSocketIds.has(socketAlice1.id));
    assert.ok(aliceSocketIds.has(socketAlice2.id));

    // Bob monitors for any spurious 'voice-peer-left' for Alice
    let spuriousPeerLeftReceived = false;
    clientBob.on('voice-peer-left', (data) => {
      if (data.userId === 'user_alice') {
        spuriousPeerLeftReceived = true;
      }
    });

    // 4. Stale Socket 1 disconnects (simulating heartbeat pingTimeout on old connection)
    disconnectClient(socketAlice1);
    await sleep(250);

    // CRITICAL ASSERTION: The disconnect of stale Socket 1 must NOT purge Alice from voice room
    assert.strictEqual(
      spuriousPeerLeftReceived,
      false,
      'Stale socket disconnect must NOT emit voice-peer-left when user still has an active socket'
    );

    const roomParticipants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(
      roomParticipants.length,
      2,
      'voiceRooms must still contain exactly 2 participants (Alice and Bob)'
    );

    const aliceStillInRoom = roomParticipants.find((p) => p.id === 'user_alice');
    assert.ok(aliceStillInRoom, 'Alice must remain an active participant in voiceRooms');

    // Verify Alice Socket 2 is still active in userSockets
    assert.strictEqual(chatHandler.userSockets.get('user_alice')?.size, 1);
    assert.strictEqual(chatHandler.userSockets.get('user_alice')?.has(socketAlice2.id), true);

    // 5. Verify Alice (Socket 2) can still emit voice state updates
    const statePromise = waitForEvent(clientBob, 'voice-user-state-updated', 2500);

    socketAlice2.emit('voice-user-state', {
      channelId,
      serverId,
      isMuted: true,
      isSpeaking: true,
    });

    const statePayload = await statePromise;
    assert.strictEqual(statePayload.userId, 'user_alice');
    assert.strictEqual(statePayload.isSpeaking, true);

    // 6. Finally, when Socket 2 (the last remaining socket) disconnects, Alice should now be cleanly removed
    const genuinePeerLeftPromise = waitForEvent(clientBob, 'voice-peer-left', 2500);
    disconnectClient(socketAlice2);

    const finalLeft = await genuinePeerLeftPromise;
    assert.strictEqual(finalLeft.userId, 'user_alice');
    assert.strictEqual(chatHandler.getChannelVoiceParticipants(channelId).length, 1);

    disconnectClient(clientBob);
  });
});

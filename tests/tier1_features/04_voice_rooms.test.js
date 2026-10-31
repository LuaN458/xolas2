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

test.describe('Tier 1: Voice Room Lifecycle & Participant State', () => {
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

  test('user joins voice channel, updates voiceRooms and notifies existing peers', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const serverId = 'server_main';
    const channelId = 'voice_general';

    // Alice joins voice channel first
    clientAlice.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Verify Alice is in voiceRooms
    const participants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(participants.length, 1);
    assert.strictEqual(participants[0].id, 'user_alice');

    // Alice sets up listener for peer joined
    const peerJoinedPromise = waitForEvent(clientAlice, 'voice-peer-joined', 2500);

    // Bob joins same voice channel
    clientBob.emit('join-voice', { serverId, channelId });

    const peerJoinedData = await peerJoinedPromise;
    assert.strictEqual(peerJoinedData.channelId, channelId);
    const peer = peerJoinedData.peer || peerJoinedData.participant;
    assert.strictEqual(peer.id, 'user_bob');
    assert.strictEqual(peer.username, 'Bob');

    // Verify both are now in voiceRooms
    const updatedParticipants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(updatedParticipants.length, 2);

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('user leaves voice channel, broadcasts voice-peer-left and updates voiceRooms', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const serverId = 'server_main';
    const channelId = 'voice_gaming';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    assert.strictEqual(chatHandler.getChannelVoiceParticipants(channelId).length, 2);

    // Alice listens for Bob leaving
    const peerLeftPromise = waitForEvent(clientAlice, 'voice-peer-left', 2500);

    // Bob leaves voice
    clientBob.emit('leave-voice', { serverId, channelId });

    const leftData = await peerLeftPromise;
    assert.strictEqual(leftData.channelId, channelId);
    assert.strictEqual(leftData.userId, 'user_bob');

    // Bob should be removed from voiceRooms
    const remaining = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].id, 'user_alice');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('voice state updates (mute, speaking, screen share) propagate to peers and update room state', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const serverId = 'server_main';
    const channelId = 'voice_meeting';

    clientAlice.emit('join-voice', { serverId, channelId });
    clientBob.emit('join-voice', { serverId, channelId });
    await sleep(150);

    // Bob listens for state update from Alice
    const stateUpdatePromise = waitForEvent(clientBob, 'voice-user-state-updated', 2500);

    // Alice updates state: muted = true, speaking = false, screen sharing = true
    clientAlice.emit('voice-user-state', {
      channelId,
      serverId,
      isMuted: true,
      isSpeaking: false,
      isScreenSharing: true,
      screenStreamId: 'screen-stream-alice-123',
    });

    const stateData = await stateUpdatePromise;
    assert.strictEqual(stateData.userId, 'user_alice');
    assert.strictEqual(stateData.isMuted, true);
    assert.strictEqual(stateData.isSpeaking, false);
    assert.strictEqual(stateData.isScreenSharing, true);
    assert.strictEqual(stateData.screenStreamId, 'screen-stream-alice-123');

    // Verify room state in memory
    const room = chatHandler.voiceRooms.get(channelId);
    const aliceParticipant = room.get('user_alice');
    assert.strictEqual(aliceParticipant.isMuted, true);
    assert.strictEqual(aliceParticipant.isScreenSharing, true);
    assert.strictEqual(aliceParticipant.screenStreamId, 'screen-stream-alice-123');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });
});

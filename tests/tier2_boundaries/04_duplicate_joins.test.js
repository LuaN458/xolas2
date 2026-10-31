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

test.describe('Tier 2: Duplicate Joins & Channel Switching State Consistency', () => {
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

  test('joining voice channel B while in channel A automatically leaves channel A without orphaned presence', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const serverId = 'server_main';
    const channelA = 'voice_ch_alpha';
    const channelB = 'voice_ch_beta';

    // Alice and Bob join channel A
    clientAlice.emit('join-voice', { serverId, channelId: channelA });
    clientBob.emit('join-voice', { serverId, channelId: channelA });
    await sleep(150);

    assert.strictEqual(chatHandler.getChannelVoiceParticipants(channelA).length, 2);

    // Bob listens for Alice leaving channel A
    const aliceLeftChannelAPromise = waitForEvent(clientBob, 'voice-peer-left', 2500);

    // Alice now calls join-voice on channel B WITHOUT calling leave-voice on channel A
    clientAlice.emit('join-voice', { serverId, channelId: channelB });

    const leftData = await aliceLeftChannelAPromise;
    assert.strictEqual(leftData.channelId, channelA);
    assert.strictEqual(leftData.userId, 'user_alice');

    await sleep(150);

    // Alice must be removed from channel A
    const roomA = chatHandler.getChannelVoiceParticipants(channelA);
    assert.strictEqual(roomA.length, 1);
    assert.strictEqual(roomA[0].id, 'user_bob');

    // Alice must now be in channel B
    const roomB = chatHandler.getChannelVoiceParticipants(channelB);
    assert.strictEqual(roomB.length, 1);
    assert.strictEqual(roomB[0].id, 'user_alice');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('duplicate join-channel on the same channel does not cause duplicate message delivery', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    const channelId = 'channel_dedup';

    // Alice joins channel_dedup 5 times in a row
    for (let i = 0; i < 5; i++) {
      clientAlice.emit('join-channel', channelId);
    }
    clientBob.emit('join-channel', channelId);
    await sleep(150);

    let messagesReceivedByAlice = 0;
    clientAlice.on('new-message', () => {
      messagesReceivedByAlice++;
    });

    clientBob.emit('send-message', {
      channelId,
      content: 'Testing deduplication',
    });

    await sleep(250);

    // Socket.io room sets ensure only one copy of message is received
    assert.strictEqual(messagesReceivedByAlice, 1, 'Alice should receive exactly 1 message, not 5');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });

  test('duplicate join-voice on the same channel does not duplicate participant in voiceRooms', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    const serverId = 'server_main';
    const channelId = 'voice_same_room';

    // Alice joins voice channel 3 times
    clientAlice.emit('join-voice', { serverId, channelId });
    clientAlice.emit('join-voice', { serverId, channelId });
    clientAlice.emit('join-voice', { serverId, channelId });
    await sleep(200);

    const participants = chatHandler.getChannelVoiceParticipants(channelId);
    assert.strictEqual(participants.length, 1, 'Participant map must deduplicate by userId');
    assert.strictEqual(participants[0].id, 'user_alice');

    disconnectClient(clientAlice);
  });
});

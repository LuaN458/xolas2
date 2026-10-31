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

test.describe('Tier 1: leave-server Server Room Lifecycle', () => {
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

  test('client joins server, receives server room updates, then leaves server and stops receiving updates', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    // Alice joins server_work
    clientAlice.emit('join-server', 'server_work');
    await sleep(100);

    // Verify Alice receives updates while joined to server_work
    const bobJoinPromise = waitForEvent(clientAlice, 'voice-channel-updated', 2500);

    // Bob joins a voice channel in server_work
    clientBob.emit('join-voice', {
      serverId: 'server_work',
      channelId: 'voice_standup',
    });

    const update1 = await bobJoinPromise;
    assert.strictEqual(update1.channelId, 'voice_standup');

    // Now Alice leaves server_work and joins server_gaming
    clientAlice.emit('leave-server', 'server_work');
    clientAlice.emit('join-server', 'server_gaming');
    await sleep(150);

    let aliceReceivedWorkUpdate = false;
    let aliceReceivedGamingUpdate = false;

    clientAlice.on('voice-channel-updated', (data) => {
      if (data.channelId === 'voice_standup') {
        aliceReceivedWorkUpdate = true;
      }
      if (data.channelId === 'voice_game_room') {
        aliceReceivedGamingUpdate = true;
      }
    });

    // Bob leaves voice in server_work (emits to server:server_work)
    clientBob.emit('leave-voice', {
      serverId: 'server_work',
      channelId: 'voice_standup',
    });

    // Bob now joins server_gaming voice channel (emits to server:server_gaming)
    clientBob.emit('join-voice', {
      serverId: 'server_gaming',
      channelId: 'voice_game_room',
    });

    await sleep(250);

    assert.strictEqual(aliceReceivedWorkUpdate, false, 'Alice should NOT receive server_work updates after leave-server');
    assert.strictEqual(aliceReceivedGamingUpdate, true, 'Alice should receive server_gaming updates after join-server');

    disconnectClient(clientAlice);
    disconnectClient(clientBob);
  });
});

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { startTestServer, stopTestServer, resetServerState, chatHandler, mockPrisma } = require('../helpers/testServer');
const { MockPrisma } = require('../helpers/mockPrisma');
const {
  createTestClient,
  waitForEvent,
  disconnectClient,
  disconnectAllClients,
  sleep,
} = require('../helpers/socketClient');
const { getApprovedUserToken, generateToken } = require('../helpers/authHelper');

// Extend MockPrisma prototype with update and delete support so admin routes operate cleanly
Object.defineProperty(MockPrisma.prototype, 'user', {
  get() {
    const self = this;
    return {
      async findUnique(args) {
        const id = args?.where?.id;
        if (!id) return null;
        const u = self.users.get(id);
        if (!u) return null;
        if (args.select) {
          const res = {};
          for (const key of Object.keys(args.select)) {
            if (key === 'customRole') {
              res.customRole = u.customRole
                ? { permissions: u.customRole.permissions || [] }
                : null;
            } else {
              res[key] = u[key];
            }
          }
          return res;
        }
        return { ...u };
      },
      async findMany(args) {
        const roleId = args?.where?.customRoleId;
        const results = [];
        for (const u of self.users.values()) {
          if (!roleId || u.customRoleId === roleId) {
            results.push({ id: u.id, role: u.role });
          }
        }
        return results;
      },
      async count(args) {
        const status = args?.where?.approvalStatus;
        let count = 0;
        for (const u of self.users.values()) {
          if (!status || u.approvalStatus === status) {
            count++;
          }
        }
        return count;
      },
      async update(args) {
        const id = args?.where?.id;
        const data = args?.data || {};
        const u = self.users.get(id);
        if (!u) throw new Error('User not found');
        Object.assign(u, data);
        return { ...u };
      },
      async delete(args) {
        const id = args?.where?.id;
        const u = self.users.get(id);
        if (!u) throw new Error('User not found');
        self.users.delete(id);
        return { ...u };
      },
    };
  },
  configurable: true,
});

// Load admin routes for router-level execution
const adminRoutes = require(path.resolve(__dirname, '../../server/dist/routes/admin.js')).default ||
                    require(path.resolve(__dirname, '../../server/dist/routes/admin.js'));

test.describe('Challenger T1: Server Concurrency, Signaling & Boundary Empirical Probes', { concurrency: 1 }, () => {
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
  // PROBE 1: Room Isolation Stress
  // Can forged or mismatched channelId, targetUserId, or toUserId leak signals?
  // =========================================================================
  test('PROBE 1: WebRTC signaling isolation under malicious spoofing, field mismatch & forged room headers', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenCarol = getApprovedUserToken('user_carol', 'Carol');

    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);
    const clientCarol = await createTestClient(serverInfo.url, tokenCarol);

    try {
      const serverId = 'server_probe1';
      const channelA = 'voice_room_alpha';
      const channelB = 'voice_room_beta';

      // Alice and Carol join channelA, Bob joins channelB
      clientAlice.emit('join-voice', { serverId, channelId: channelA });
      await sleep(150);
      clientCarol.emit('join-voice', { serverId, channelId: channelA });
      await sleep(150);
      clientBob.emit('join-voice', { serverId, channelId: channelB });
      await sleep(200);

      assert.strictEqual(chatHandler.voiceRooms.get(channelA)?.has('user_alice'), true);
      assert.strictEqual(chatHandler.voiceRooms.get(channelA)?.has('user_carol'), true);
      assert.strictEqual(chatHandler.voiceRooms.get(channelB)?.has('user_bob'), true);

      let bobReceivedOffer = false;
      let bobReceivedAnswer = false;
      let bobReceivedIce = false;
      let bobReceivedScreenReq = false;

      let carolReceivedOffer = false;
      let carolReceivedAnswer = false;

      let aliceReceivedSelfOffer = false;

      clientBob.on('webrtc-offer', () => { bobReceivedOffer = true; });
      clientBob.on('webrtc-answer', () => { bobReceivedAnswer = true; });
      clientBob.on('webrtc-ice-candidate', () => { bobReceivedIce = true; });
      clientBob.on('request-screen-stream', () => { bobReceivedScreenReq = true; });

      clientCarol.on('webrtc-offer', () => { carolReceivedOffer = true; });
      clientCarol.on('webrtc-answer', () => { carolReceivedAnswer = true; });

      clientAlice.on('webrtc-offer', () => { aliceReceivedSelfOffer = true; });

      // Attack Scenario 1.1: Alice in room A sends offer targeting Bob (in room B) with channelId=A
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId: channelA,
        sdp: { type: 'offer', sdp: 'v=0\r\no=attacker 1 1\r\n' },
      });

      // Attack Scenario 1.2: Alice in room A sends offer targeting Bob (in room B) with channelId=B (forged channelId where Alice is NOT member)
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId: channelB,
        sdp: { type: 'offer', sdp: 'v=0\r\no=attacker 2 2\r\n' },
      });

      // Attack Scenario 1.3: Target-Field Desync: toUserId is Bob (room B), targetUserId is Carol (room A)
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        targetUserId: 'user_carol',
        channelId: channelA,
        sdp: { type: 'offer', sdp: 'v=0\r\no=attacker 3 3\r\n' },
      });

      // Attack Scenario 1.4: Spoofed targetSocketId: Alice targets Carol, but attaches Bob's socketId
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_carol',
        channelId: channelA,
        targetSocketId: clientBob.id,
        sdp: { type: 'offer', sdp: 'v=0\r\no=attacker 4 4\r\n' },
      });

      // Attack Scenario 1.5: Cross-channel answer, ICE, and screen request targeting Bob
      clientAlice.emit('webrtc-answer', {
        toUserId: 'user_bob',
        channelId: channelA,
        sdp: { type: 'answer', sdp: 'v=0\r\n' },
      });
      clientAlice.emit('webrtc-ice-candidate', {
        toUserId: 'user_bob',
        channelId: channelA,
        candidate: { candidate: 'candidate:dummy' },
      });
      clientAlice.emit('request-screen-stream', {
        toUserId: 'user_bob',
        channelId: channelA,
      });

      // Attack Scenario 1.6: Self-targeting loop
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_alice',
        channelId: channelA,
        sdp: { type: 'offer', sdp: 'v=0\r\no=loop 5 5\r\n' },
      });

      await sleep(300);

      // Assertions
      assert.strictEqual(bobReceivedOffer, false, 'Bob in room B must NOT receive any offer from Alice in room A');
      assert.strictEqual(bobReceivedAnswer, false, 'Bob must NOT receive cross-room answer');
      assert.strictEqual(bobReceivedIce, false, 'Bob must NOT receive cross-room ICE candidate');
      assert.strictEqual(bobReceivedScreenReq, false, 'Bob must NOT receive cross-room screen request');
      assert.strictEqual(aliceReceivedSelfOffer, false, 'Alice must NOT receive self-reflected offer');

      // Legitimate signaling between Alice and Carol (both in room A) succeeds
      const carolOfferPromise = waitForEvent(clientCarol, 'webrtc-offer', 3000);
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_carol',
        channelId: channelA,
        sdp: { type: 'offer', sdp: 'v=0\r\no=valid 10 10\r\n' },
        screenStreamId: 'stream-alpha',
      });
      const validOffer = await carolOfferPromise;
      assert.strictEqual(validOffer.fromUserId, 'user_alice');
      assert.strictEqual(validOffer.fromSocketId, clientAlice.id);
      assert.strictEqual(validOffer.screenStreamId, 'stream-alpha');
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
      disconnectClient(clientCarol);
    }
  });

  // =========================================================================
  // PROBE 2: Multi-Socket Glare & Targeting
  // User Bob has 3 active sockets. Does the server route cleanly without glare?
  // =========================================================================
  test('PROBE 2: Multi-socket glare prevention across 3 active sockets (1 voice + 2 non-voice, and 3 voice sockets)', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');

    // Bob opens 3 sockets sequentially
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBobVoice1 = await createTestClient(serverInfo.url, tokenBob);
    await sleep(60);
    const clientBobText2 = await createTestClient(serverInfo.url, tokenBob);
    await sleep(60);
    const clientBobText3 = await createTestClient(serverInfo.url, tokenBob);
    await sleep(100);

    try {
      const serverId = 'server_glare';
      const channelId = 'voice_glare_chamber';

      // Alice and Bob's 1st socket join voice. Bob's 2nd and 3rd sockets join text chat/server
      clientAlice.emit('join-voice', { serverId, channelId });
      clientBobVoice1.emit('join-voice', { serverId, channelId });
      clientBobText2.emit('join-server', serverId);
      clientBobText3.emit('join-server', serverId);
      await sleep(250);

      assert.strictEqual(chatHandler.userSockets.get('user_bob')?.size, 3, 'Bob must have 3 registered sockets');

      let bobText2OfferCount = 0;
      let bobText3OfferCount = 0;
      let bobText2AnswerCount = 0;
      let bobText3AnswerCount = 0;

      clientBobText2.on('webrtc-offer', () => { bobText2OfferCount++; });
      clientBobText3.on('webrtc-offer', () => { bobText3OfferCount++; });
      clientBobText2.on('webrtc-answer', () => { bobText2AnswerCount++; });
      clientBobText3.on('webrtc-answer', () => { bobText3AnswerCount++; });

      const bobVoice1OfferPromise = waitForEvent(clientBobVoice1, 'webrtc-offer', 3000);

      // Alice sends webrtc-offer to user_bob
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId,
        sdp: { type: 'offer', sdp: 'v=0\r\no=alice-glare 1 1\r\n' },
        screenStreamId: 'screen-glare-1',
      });

      const offerReceivedByVoice1 = await bobVoice1OfferPromise;
      assert.strictEqual(offerReceivedByVoice1.fromUserId, 'user_alice');
      assert.strictEqual(offerReceivedByVoice1.fromSocketId, clientAlice.id);

      await sleep(150);

      // Crucial assertion: non-voice sockets must receive ZERO offers
      assert.strictEqual(bobText2OfferCount, 0, 'Bob text socket 2 must receive zero webrtc-offers');
      assert.strictEqual(bobText3OfferCount, 0, 'Bob text socket 3 must receive zero webrtc-offers');

      // Now simulate Bob having 3 sockets ALL in the voice room (multi-tab voice join)
      clientBobText2.emit('join-voice', { serverId, channelId });
      clientBobText3.emit('join-voice', { serverId, channelId });
      await sleep(250);

      let totalOffersReceived = 0;
      const countOffer = () => { totalOffersReceived++; };
      clientBobVoice1.on('webrtc-offer', countOffer);
      clientBobText2.on('webrtc-offer', countOffer);
      clientBobText3.on('webrtc-offer', countOffer);

      // Alice sends another offer. Even though all 3 sockets are in voice, anti-glare must select exactly 1 socket
      clientAlice.emit('webrtc-offer', {
        toUserId: 'user_bob',
        channelId,
        sdp: { type: 'offer', sdp: 'v=0\r\no=alice-glare 2 2\r\n' },
        screenStreamId: 'screen-glare-2',
      });

      await sleep(250);

      assert.strictEqual(
        totalOffersReceived,
        1,
        'Server anti-glare logic must route offer to exactly ONE socket, never duplicating across multi-tab voice sockets'
      );
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBobVoice1);
      disconnectClient(clientBobText2);
      disconnectClient(clientBobText3);
    }
  });

  // =========================================================================
  // PROBE 3: Ghost Participant Storm
  // Rapidly alternate join-voice across 5 voice channels in quick succession
  // =========================================================================
  test('PROBE 3: Rapid 5-channel and 10-cycle hopping storm leaves user in exactly 1 channel with zero ghosts', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const clientAlice = await createTestClient(serverInfo.url, tokenAlice);

    try {
      const serverId = 'server_storm_probe3';
      const ch1 = 'voice_storm_1';
      const ch2 = 'voice_storm_2';
      const ch3 = 'voice_storm_3';
      const ch4 = 'voice_storm_4';
      const ch5 = 'voice_storm_5';

      // Rapidly fire join-voice across 5 distinct voice channels synchronously
      clientAlice.emit('join-voice', { serverId, channelId: ch1 });
      clientAlice.emit('join-voice', { serverId, channelId: ch2 });
      clientAlice.emit('join-voice', { serverId, channelId: ch3 });
      clientAlice.emit('join-voice', { serverId, channelId: ch4 });
      clientAlice.emit('join-voice', { serverId, channelId: ch5 });

      // Wait for all async DB queries and sequence resolutions to settle
      await sleep(400);

      // Validate that Alice is ONLY present in the final target channel ch5
      assert.strictEqual(chatHandler.voiceRooms.get(ch1)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch2)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch3)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch4)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch5)?.has('user_alice'), true);

      // Perform global invariant check across ALL voice rooms
      let globalAliceCount = 0;
      for (const [_, room] of chatHandler.voiceRooms.entries()) {
        if (room.has('user_alice')) {
          globalAliceCount++;
        }
      }
      assert.strictEqual(globalAliceCount, 1, 'Alice must appear in exactly 1 channel globally');

      // Now run an aggressive 10-step zigzag storm
      const zigzag = [ch1, ch3, ch2, ch5, ch4, ch2, ch1, ch4, ch3, ch1];
      for (const ch of zigzag) {
        clientAlice.emit('join-voice', { serverId, channelId: ch });
      }

      await sleep(400);

      // Final target was ch1
      assert.strictEqual(chatHandler.voiceRooms.get(ch1)?.has('user_alice'), true);
      assert.strictEqual(chatHandler.voiceRooms.get(ch2)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch3)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch4)?.has('user_alice'), undefined);
      assert.strictEqual(chatHandler.voiceRooms.get(ch5)?.has('user_alice'), undefined);

      let globalAliceCountAfterZigzag = 0;
      for (const [_, room] of chatHandler.voiceRooms.entries()) {
        if (room.has('user_alice')) {
          globalAliceCountAfterZigzag++;
        }
      }
      assert.strictEqual(globalAliceCountAfterZigzag, 1, 'Alice must remain in exactly 1 channel globally after zigzag storm');
    } finally {
      disconnectClient(clientAlice);
    }
  });

  // =========================================================================
  // PROBE 4: Reconnection Screen State Persistence
  // Screen share client disconnects and reconnects with isScreenSharing: true
  // =========================================================================
  test('PROBE 4: Reconnection screen state persistence and announcement to existing and newly joined peers', async () => {
    const tokenAlice = getApprovedUserToken('user_alice', 'Alice');
    const tokenBob = getApprovedUserToken('user_bob', 'Bob');
    const tokenCarol = getApprovedUserToken('user_carol', 'Carol');

    let clientAlice = await createTestClient(serverInfo.url, tokenAlice);
    const clientBob = await createTestClient(serverInfo.url, tokenBob);

    try {
      const serverId = 'server_recon_screen';
      const channelId = 'voice_screen_recon';

      // Alice and Bob join server and voice channel
      clientAlice.emit('join-server', serverId);
      clientBob.emit('join-server', serverId);
      await sleep(100);

      clientAlice.emit('join-voice', { serverId, channelId });
      clientBob.emit('join-voice', { serverId, channelId });
      await sleep(150);

      // Alice starts screen sharing
      const streamId = 'screen-test-recon-uuid';
      clientAlice.emit('voice-user-state', {
        channelId,
        serverId,
        isScreenSharing: true,
        screenStreamId: streamId,
      });
      await sleep(150);

      // Abruptly disconnect Alice (simulating wifi interruption / process restart)
      disconnectClient(clientAlice);
      await sleep(150);

      // Bob sets up promise for Alice's re-join announcement
      const bobSawAliceRejoinPromise = waitForEvent(clientBob, 'voice-peer-joined', 3500);

      // Alice reconnects with fresh socket and supplies persistent screen share flags
      clientAlice = await createTestClient(serverInfo.url, tokenAlice);
      clientAlice.emit('join-server', serverId);
      await sleep(50);
      clientAlice.emit('join-voice', {
        serverId,
        channelId,
        isScreenSharing: true,
        screenStreamId: streamId,
      });

      const rejoinPayload = await bobSawAliceRejoinPromise;
      const peer = rejoinPayload.peer || rejoinPayload.participant;
      assert.strictEqual(peer.id, 'user_alice');
      assert.strictEqual(peer.isScreenSharing, true, 'Existing peer Bob must receive isScreenSharing=true on reconnect');
      assert.strictEqual(peer.screenStreamId, streamId, 'Existing peer Bob must receive persistent screenStreamId');

      // Now Carol joins as a late-joining peer: Carol joins server first to receive server broadcasts
      const clientCarol = await createTestClient(serverInfo.url, tokenCarol);
      const carolJoinedServerPromise = waitForEvent(clientCarol, 'online-users-list', 3000);
      clientCarol.emit('join-server', serverId);
      await carolJoinedServerPromise;

      const carolChannelUpdatePromise = waitForEvent(clientCarol, 'voice-channel-updated', 3500);
      clientCarol.emit('join-voice', { serverId, channelId });

      const channelUpdateData = await carolChannelUpdatePromise;
      const participants = channelUpdateData.participants || channelUpdateData.users || [];
      const aliceInCarolView = participants.find((p) => p.id === 'user_alice');

      assert.ok(aliceInCarolView, 'Carol must see Alice in channel participants');
      assert.strictEqual(aliceInCarolView.isScreenSharing, true, 'Newly joined Carol must see Alice as screen sharing');
      assert.strictEqual(aliceInCarolView.screenStreamId, streamId, 'Newly joined Carol must see Alice screenStreamId');

      // In addition, verify in-memory voiceRooms state
      const aliceInMemory = chatHandler.voiceRooms.get(channelId)?.get('user_alice');
      assert.strictEqual(aliceInMemory?.isScreenSharing, true);
      assert.strictEqual(aliceInMemory?.screenStreamId, streamId);

      disconnectClient(clientCarol);
    } finally {
      disconnectClient(clientAlice);
      disconnectClient(clientBob);
    }
  });

  // =========================================================================
  // PROBE 5: Admin Teardown
  // Admin rejection / deletion forcefully evicts active sockets and voice state
  // =========================================================================
  test('PROBE 5: Admin user rejection and deletion forceful socket termination and voice eviction', async () => {
    const tokenAdmin = generateToken({
      userId: 'user_admin',
      username: 'AdminUser',
      role: 'ADMIN',
      isApproved: true,
    });
    const tokenTarget = getApprovedUserToken('user_bob', 'Bob');
    const tokenObserver = getApprovedUserToken('user_alice', 'Alice');

    // Bob has 2 active sockets
    const clientBob1 = await createTestClient(serverInfo.url, tokenTarget);
    await sleep(60);
    const clientBob2 = await createTestClient(serverInfo.url, tokenTarget);
    await sleep(60);
    const clientAliceObserver = await createTestClient(serverInfo.url, tokenObserver);
    await sleep(100);

    try {
      const serverId = 'server_admin_teardown';
      const channelId = 'voice_admin_eviction';

      // Both join voice
      clientAliceObserver.emit('join-voice', { serverId, channelId });
      clientBob1.emit('join-voice', { serverId, channelId });
      clientBob2.emit('join-server', serverId);
      await sleep(250);

      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_bob'), true);
      assert.strictEqual(chatHandler.userSockets.get('user_bob')?.size, 2);

      let bob1Disconnected = false;
      let bob2Disconnected = false;
      clientBob1.once('disconnect', () => { bob1Disconnected = true; });
      clientBob2.once('disconnect', () => { bob2Disconnected = true; });

      const aliceSawBobLeavePromise = waitForEvent(clientAliceObserver, 'voice-peer-left', 3500);

      // Execute Admin reject route through Express router dispatcher
      await new Promise((resolve, reject) => {
        const req = {
          method: 'POST',
          url: '/users/user_bob/reject',
          params: { id: 'user_bob' },
          headers: {
            authorization: `Bearer ${tokenAdmin}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(data) {
            try {
              assert.strictEqual(data.success, true);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        };
        adminRoutes(req, res, (err) => {
          if (err) reject(err);
        });
      });

      const leftEvent = await aliceSawBobLeavePromise;
      assert.strictEqual(leftEvent.userId, 'user_bob');
      assert.strictEqual(leftEvent.channelId, channelId);

      await sleep(250);

      // Verify forceful socket disconnect
      assert.strictEqual(bob1Disconnected, true, 'Bob socket 1 must be forcefully disconnected by admin action');
      assert.strictEqual(bob2Disconnected, true, 'Bob socket 2 must be forcefully disconnected by admin action');
      assert.strictEqual(clientBob1.connected, false);
      assert.strictEqual(clientBob2.connected, false);

      // Verify voiceRooms and userSockets cleanup
      assert.strictEqual(Boolean(chatHandler.voiceRooms.get(channelId)?.has('user_bob')), false);
      assert.strictEqual(chatHandler.userSockets.has('user_bob'), false);

      // Test DELETE route for another target user Carol
      const tokenCarol = getApprovedUserToken('user_carol', 'Carol');
      const clientCarol = await createTestClient(serverInfo.url, tokenCarol);
      clientCarol.emit('join-voice', { serverId, channelId });
      await sleep(150);

      assert.strictEqual(chatHandler.voiceRooms.get(channelId)?.has('user_carol'), true);

      let carolDisconnected = false;
      clientCarol.once('disconnect', () => { carolDisconnected = true; });

      await new Promise((resolve, reject) => {
        const req = {
          method: 'DELETE',
          url: '/users/user_carol',
          params: { id: 'user_carol' },
          headers: {
            authorization: `Bearer ${tokenAdmin}`,
          },
        };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(data) {
            try {
              assert.strictEqual(data.success, true);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        };
        adminRoutes(req, res, (err) => {
          if (err) reject(err);
        });
      });

      await sleep(250);
      assert.strictEqual(carolDisconnected, true, 'Carol socket must be forcefully disconnected by admin deletion');
      assert.strictEqual(Boolean(chatHandler.voiceRooms.get(channelId)?.has('user_carol')), false);
      assert.strictEqual(chatHandler.userSockets.has('user_carol'), false);
    } finally {
      disconnectClient(clientBob1);
      disconnectClient(clientBob2);
      disconnectClient(clientAliceObserver);
    }
  });
});

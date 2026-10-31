# Test Infrastructure Documentation (TEST_INFRA.md)

**Project**: Xolas Production-Grade Socket, Channels, Voice & Transmission Refactoring  
**Track**: M4 — Automated E2E & Integration Testing Track  
**Date**: October 31, 2026  
**Status**: COMPLETE & VERIFIED  

---

## 1. Executive Summary & Philosophy

The test infrastructure for Xolas is designed to provide **hermetic, deterministic, opaque-box integration and end-to-end verification** of the real-time communication stack. Prior to Milestone 4, the repository contained zero automated test suites, leaving socket authentication, text channel rooms, WebRTC signaling relays, and voice call reconnection lifecycles unverified.

The M4 test architecture establishes an automated test runner and multi-tier test suite constructed on top of `socket.io-client`, testing actual Socket.io server and client protocols, payload validations, security boundaries, and cross-feature reconnection scenarios.

---

## 2. Test Architecture & Harness Design

```
                     ┌────────────────────────────────────────────────────────┐
                     │                   Test Runner                          │
                     │               (node tests/run-all.js)                  │
                     └──────────────────────────┬─────────────────────────────┘
                                                │
         ┌──────────────────────────────────────┴──────────────────────────────────────┐
         ▼                                                                             ▼
┌─────────────────────────────────┐                                           ┌─────────────────────────────────┐
│     Socket.IO Client Cluster    │                                           │    Isolated Ephemeral Server    │
│  - Socket 1 (Alice)             │   Windows Named-Pipe IPC Transport        │  - HTTP Server (Pipe Listener)  │
│  - Socket 2 (Bob)               │ ◄───────────────────────────────────────► │  - Socket.IO Server Engine      │
│  - Socket 3 (Carol)             │      (\\.\pipe\xolas-test-*)              │  - chatHandler.ts Handlers      │
└─────────────────────────────────┘                                           └────────────────┬────────────────┘
                                                                                               │
                                                                                               ▼
                                                                              ┌─────────────────────────────────┐
                                                                              │      In-Memory MockPrisma       │
                                                                              │  - Zero network latency         │
                                                                              │  - Pre-seeded users & roles     │
                                                                              │  - Dynamic approval transitions │
                                                                              └─────────────────────────────────┘
```

### 2.1 Key Components

1. **Test Runner (`tests/run-all.js`)**:
   - Executes all 14 test suites sequentially across isolated Node.js test runner processes (`node --test`).
   - Collects per-suite durations, pass/fail status, and outputs a structured ANSI terminal dashboard.
   - Exits with status `0` upon complete success or `1` on any failure.

2. **Ephemeral Server Harness (`tests/helpers/testServer.js`)**:
   - Instantiates a dedicated `http.Server` and `SocketIOServer` instance bound to a unique Windows named pipe (`\\.\pipe\xolas-test-<timestamp>-<hash>`).
   - Hooks into `http.Agent.prototype.createConnection` to route test client traffic locally through the pipe. This allows genuine Socket.io network packets to traverse the stack with zero sandbox permission prompts or firewall conflicts.
   - Invokes `chatHandler.setupSocketHandlers(io)` to test the identical server routing, rate limiting, and room logic executed in production.
   - Provides clean teardown via `stopTestServer()` and state resets via `resetServerState()`.

3. **In-Memory Mock Database (`tests/helpers/mockPrisma.js`)**:
   - Monkey-patches `server/dist/lib/prisma.js` during test server initialization.
   - Pre-seeds deterministic users (`user_alice`, `user_bob`, `user_carol`, `user_admin`, `user_pending`, `user_rejected`).
   - Emulates Prisma model queries (`user.findUnique`, `user.count`, `user.findMany`, `message.create`, `message.findUnique`, `message.delete`).
   - Eliminates remote PostgreSQL connection dependencies, guaranteeing fast, offline, and race-free test execution.

4. **Socket Client Harness (`tests/helpers/socketClient.js`)**:
   - `createTestClient(url, token)`: Spawns real `socket.io-client` instances with auth tokens, resolving on `'connect'` and automatically managing connection timeouts.
   - `createRejectedClient(url, token)`: Spawns sockets expecting handshake refusal (e.g. unapproved accounts, invalid tokens), resolving on `'connect_error'`.
   - `waitForEvent(socket, eventName, timeoutMs)`: Promise-based event listener with strict timeout guards.
   - `disconnectClient(socket)` & `disconnectAllClients()`: Safely terminates sockets and cleans up underlying Engine.IO polling cycles.

5. **Authentication Token Helper (`tests/helpers/authHelper.js`)**:
   - Generates HS256-signed JWT tokens using the production secret (`process.env.JWT_SECRET || 'discord_clone_super_secret_jwt_key_2026'`).
   - Provides preset generators for approved users, pending users, admins, malformed tokens, and forged tokens.

---

## 3. Multi-Tier Test Taxonomy

The test suite is structured into four distinct, progressive tiers:

### Tier 1: Feature Coverage (Core Real-Time Primitives)
- **`01_socket_auth.test.js`**: Socket connection with valid JWT; immediate presence tracking; `user-status-changed` broadcast; handshake rejection on missing, invalid, or forged tokens.
- **`02_channels.test.js`**: `join-channel` room ingress; message delivery to joined members; `leave-channel` room departure; text channel message isolation.
- **`03_messages.test.js`**: Message payload sanitization; persistence to database; attachment URL verification (`/uploads/chat/...`); multicast delivery.
- **`04_voice_rooms.test.js`**: `join-voice` presence registration in `voiceRooms`; `voice-peer-joined` broadcast; `leave-voice` removal and `voice-peer-left`; voice state updates (`isMuted`, `isSpeaking`, `isScreenSharing`).
- **`05_webrtc_signaling.test.js`**: Peer-to-peer WebRTC signaling relay (`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`, `request-screen-stream`).
- **`06_leave_server.test.js`**: `join-server` and `leave-server` room lifecycle; verifies departing `server:${serverId}` stops cross-server broadcast leakage.

### Tier 2: Boundary & Corner Cases (Adversarial Hardening)
- **`01_malformed_payloads.test.js`**: Empty or null message content; primitive data types (null, numbers, arrays); oversized content truncated to 4000 characters; oversized SDP (>65536 bytes) dropped.
- **`02_unauthorized_joins.test.js`**: Path traversal vectors (`../../etc/passwd`, `..\..\windows`); SQL injection attempts (`1 OR 1=1`); non-string / empty identifiers safely rejected by `isValidIdentifier`.
- **`03_unapproved_users.test.js`**: Users with `approvalStatus: 'PENDING'` or `'REJECTED'` rejected during auth handshake with `'Conta pendente de aprovação ou não autorizada'`; deleted user rejection; dynamic admission upon approval.
- **`04_duplicate_joins.test.js`**: User calling `join-voice` on channel B while in channel A automatically leaves channel A without leaving orphaned presence; duplicate `join-channel` calls do not duplicate message delivery.
- **`05_invalid_screen_targets.test.js`**: Drops `webrtc-offer`, `webrtc-answer`, or `webrtc-ice-candidate` if sender is not joined to target voice room; handles non-existent screen target user without crashing.

### Tier 3: Cross-Feature & Reconnection (Resilience & State Recovery)
- **`01_network_reconnect.test.js`**: Simulates sudden socket drop; verifies client reconnects with new socket ID; verifies active channel re-join and message delivery continuation.
- **`02_stale_socket_disconnect.test.js`**: Verifies Interface Contract #2: When Socket 1 disconnects (e.g. heartbeat timeout) while Socket 2 is actively connected for the same user, the server **does NOT** evict the user from `voiceRooms`, does NOT clear `currentVoice` on remaining sockets, and does NOT broadcast `voice-peer-left`. Only when the last socket drops is the user removed.

### Tier 4: Real-World Multi-Participant (Complex Mesh Scenarios)
- **`01_multi_user_voice.test.js`**: Full multi-party session with 3 concurrent users (Alice, Bob, Carol):
  1. Users join server and voice room.
  2. Exchange dynamic voice presence (speaking, muting).
  3. Carol initiates screen share (`isScreenSharing: true`, `screenStreamId`).
  4. Bob requests screen stream (`request-screen-stream`).
  5. Carol sends WebRTC screen offer; Bob replies with WebRTC screen answer.
  6. Alice leaves the call; remaining participants receive `voice-peer-left` and updated participant count (2).

---

## 4. Feature Mapping Matrix

| Feature / Issue ID (`PROJECT.md`) | Description | Target Milestone | Test Suite File | Test Status |
|---|---|---|---|---|
| #1 | Server Disconnect Reconnection Race | M1 | `tests/tier3_reconnection/02_stale_socket_disconnect.test.js` | **COVERED** |
| #2 | Socket Auth Approval Verification | M1 | `tests/tier2_boundaries/03_unapproved_users.test.js` | **COVERED** |
| #3 | Safe Async Handlers in Sockets | M1 | `tests/tier2_boundaries/01_malformed_payloads.test.js` | **COVERED** |
| #4 | WebRTC Signaling Relays Room Verification | M1 | `tests/tier2_boundaries/05_invalid_screen_targets.test.js` | **COVERED** |
| #5 | Server-side `leave-server` Support | M1 | `tests/tier1_features/06_leave_server.test.js` | **COVERED** |
| #6 | Client Channel Reconnection Rejoin | M2 | `tests/tier3_reconnection/01_network_reconnect.test.js` | **COVERED** |
| #7 | Client Reconnection Lifecycle State | M2 | `tests/tier3_reconnection/01_network_reconnect.test.js` | **COVERED** |
| #9 | Client Active Server Room Cleanup | M2 | `tests/tier1_features/06_leave_server.test.js` | **COVERED** |
| #11| Screen Share ID Prefix Target Bug | M3 | `tests/tier1_features/05_webrtc_signaling.test.js` & `tests/tier4_multi_participant/01_multi_user_voice.test.js` | **COVERED** |
| #15| Voice Signaling Offer Collision & Multi-Party | M3 | `tests/tier4_multi_participant/01_multi_user_voice.test.js` | **COVERED** |
| #16| Automated Test Infrastructure | M4 | Complete `tests/` directory & `run-all.js` | **DELIVERED** |

---

## 5. Execution Guide

### Prerequisites
- Node.js v20+ or v26+ (tested on Node v26.5.0).
- Server dependencies installed (`npm install` in `server/`).

### Commands

To run the entire multi-tier test suite with summary reporting:
```bash
node tests/run-all.js
```

To run individual test files via native Node.js test runner:
```bash
node --test tests/tier1_features/01_socket_auth.test.js
node --test tests/tier1_features/02_channels.test.js
node --test tests/tier1_features/03_messages.test.js
node --test tests/tier1_features/04_voice_rooms.test.js
node --test tests/tier1_features/05_webrtc_signaling.test.js
node --test tests/tier1_features/06_leave_server.test.js
node --test tests/tier2_boundaries/01_malformed_payloads.test.js
node --test tests/tier2_boundaries/02_unauthorized_joins.test.js
node --test tests/tier2_boundaries/03_unapproved_users.test.js
node --test tests/tier2_boundaries/04_duplicate_joins.test.js
node --test tests/tier2_boundaries/05_invalid_screen_targets.test.js
node --test tests/tier3_reconnection/01_network_reconnect.test.js
node --test tests/tier3_reconnection/02_stale_socket_disconnect.test.js
node --test tests/tier4_multi_participant/01_multi_user_voice.test.js
```

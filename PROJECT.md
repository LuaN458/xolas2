# Project: Xolas Production-Grade Socket, Channels, Voice & Transmission Refactoring

## Architecture
The application is a Discord-like communication desktop & web app featuring text channels, WebRTC voice channels, and screen streaming.
- **Server**: Node.js + TypeScript + Express + Socket.io + Prisma ORM (SQLite).
- **Client**: React + TypeScript + Vite + Tailwind CSS + Socket.io-client + native browser WebRTC full-mesh + Electron for desktop capabilities.
- **Signaling & State**: Socket.io transports chat messages, room membership, voice presence, and WebRTC SDP/ICE signaling for audio/video mesh.

```
       [ Client React / Electron ]
          │                    │
  (Socket.io Client)     (WebRTC Mesh)
          │                    │  (Audio / Screen Tracks P2P)
          ▼                    ▼
  [ Socket.io Server ] ◄── (Signaling: offer/answer/ice/request-screen)
          │
  [ Prisma SQLite DB ]
```

---

## Feature Inventory
All features and issues mapped during Phase 0 Survey:
| # | Feature / Issue | Description | Milestone | Source |
|---|-----------------|-------------|-----------|--------|
| 1 | Server Disconnect Reconnection Race | Old socket ping-timeout disconnect forcibly purging user from voiceRooms and resetting new active socket voice state | M1 | Survey (Explorer 1) |
| 2 | Socket Auth Approval Verification | Server auth middleware selects `isApproved` but fails to reject unapproved/rejected accounts | M1 | Survey (Explorer 1) |
| 3 | Safe Async Handlers in Sockets | Wrap `join-voice` and other async DB lookups in try/catch to prevent unhandled rejections / server crashes | M1 | Survey (Explorer 1) |
| 4 | WebRTC Signaling Relays Room Verification | Verify sender is an active member in target voice room before forwarding SDP/ICE/screen requests | M1 | Survey (Explorer 1) |
| 5 | Server-side `leave-server` Support | Allow client to leave server rooms to prevent monotonic room accumulation on server switching | M1 | Survey (Explorer 1 & 2) |
| 6 | Client Channel Reconnection Rejoin | `MessageArea.tsx` missing socket `connect` listener, dropping incoming messages on reconnect | M2 | Survey (Explorer 2) |
| 7 | Client Reconnection Lifecycle State | `SocketContext` lacking `connect_error`, `reconnect`, `reconnect_failed` handling & UI feedback | M2 | Survey (Explorer 2) |
| 8 | Client Stale Closures in Role Handlers | `App.tsx` role/user handlers capturing stale `user` and `token` closures | M2 | Survey (Explorer 2) |
| 9 | Client Active Server Room Cleanup | Emit `leave-server` on server switch to prevent duplicate broadcasts | M2 | Survey (Explorer 2) |
| 10| Dead Listener Cleanup | Remove dead `member-joined` listener in `App.tsx` | M2 | Survey (Explorer 2) |
| 11| Screen Share ID Prefix Bug | `watchScreenShare` regex `/^screen-/` fails on `remote-screen-<id>`, breaking screen viewing | M3 | Survey (Explorer 3) |
| 12| Logout Media & Process Cleanup | `AuthContext` logout leaving mic tracks, RTCPeerConnections, and `wasapi-loopback.exe` orphaned | M3 | Survey (Explorer 3) |
| 13| DOM Audio Element & Context Leak | Reconnecting peers leaking `<audio>` elements in `#xolas-remote-audio-container` and AudioContexts | M3 | Survey (Explorer 3) |
| 14| Screen Audio Cutoff in Grid View | Screen share audio tied to spotlight video DOM element; lost when switching to grid view | M3 | Survey (Explorer 3) |
| 15| Voice Signaling Offer Collision & Sync | Glare/collision handling in `handleVoicePeerJoined` and voice state re-sync on socket reconnect | M3 | Survey (Explorer 3) |
| 16| Automated Test Infrastructure | Opaque-box automated test suite for socket events, channel joins, chat, and voice/screen signaling | M4 | Survey (E2E Track) |
| 17| Final Build, Hardening & Release Protocol | 100% test pass, adversarial audit, version bump, commit, push, git tag per GEMINI.md | M5 | User Request & GEMINI.md |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Server-Side Socket & Channels Robustness | Fix reconnect disconnect race in `chatHandler.ts`, enforce auth `isApproved`, wrap async DB queries in try/catch, add `leave-server`, validate signaling room membership | none | DONE |
| M2 | Client-Side Socket & Channel Lifecycle | Reconnection re-joining in `MessageArea.tsx`, `SocketContext` reconnect states, fix stale closures in `App.tsx`, emit `leave-server`, prune dead listeners | none | DONE |
| M3 | WebRTC Voice & Screen Transmission Hardening | Fix `watchScreenShare` prefix bug, logout media/process teardown, DOM `<audio>` tag leak pruning, background screen audio in grid view, signaling collision & reconnect sync | none | DONE |
| M4 | E2E & Integration Testing Track | Automated test runner and multi-tier test cases verifying socket connection, channel operations, voice/screen signaling, reconnection isolation, and leak prevention | none | DONE |
| M5 | Final Integration, 100% E2E Pass, Hardening & Release | Verify 100% E2E test pass, adversarial verification, client & server build validation, version bump in `package.json` & `client/package.json`, git commit, push main, git tag v1.0.X | M1, M2, M3, M4 | IN_PROGRESS |

---

## Interface Contracts

### 1. Client ↔ Server Socket Events Contract (Preserved & Enhanced)
- `join-channel`: `(channelId: string)`
- `leave-channel`: `(channelId: string)`
- `join-server`: `(serverId: string)`
- `leave-server`: `(serverId: string)` — New backward-compatible server event to cleanly depart `server:${serverId}`
- `send-message`: `(data: { serverId: string; channelId: string; content?: string; fileUrl?: string; fileName?: string; fileType?: string; fileSize?: number; fileExtension?: string; tempId?: string })`
- `new-message`: `(message: Message)`
- `join-voice`: `(data: { serverId: string; channelId: string; isMuted?: boolean; isScreenSharing?: boolean; screenStreamId?: string | null })`
- `leave-voice`: `(data: { channelId: string; serverId: string })`
- `voice-peer-joined`: `(data: { channelId: string; userId: string; username?: string; avatarUrl?: string; isMuted?: boolean; isScreenSharing?: boolean; screenStreamId?: string | null })`
- `voice-peer-left`: `(data: { channelId: string; userId: string })`
- `voice-user-state`: `(data: { channelId: string; serverId: string; isMuted?: boolean; isDeafened?: boolean; isScreenSharing?: boolean; screenStreamId?: string | null; isSpeaking?: boolean })`
- `voice-user-state-updated`: `(data: { channelId: string; userId: string; ... })`
- `webrtc-offer`: `(data: { toUserId: string; channelId?: string; offer: RTCSessionDescriptionInit })`
- `webrtc-answer`: `(data: { toUserId: string; channelId?: string; answer: RTCSessionDescriptionInit })`
- `webrtc-ice-candidate`: `(data: { toUserId: string; channelId?: string; candidate: RTCIceCandidateInit })`
- `request-screen-stream`: `(data: { channelId: string; targetUserId?: string; toUserId: string })`

### 2. Disconnect Rule (Server)
When a socket disconnects:
- Remove socket from `userSockets.get(userId)`.
- If `socket.currentVoice` exists:
  - Check if `userSockets.get(userId)` still has other active sockets that are currently in `voice:${channelId}`.
  - ONLY IF no other active socket exists for that user in that voice channel, remove the user from `voiceRooms.get(channelId)` and broadcast `voice-peer-left`.
  - Under NO circumstance should a disconnecting stale socket clear `currentVoice` on remaining active sockets.

### 3. Screen Share Target ID Contract (Client)
- `watchScreenShare(shareId)`:
  - Must strip all known prefixes (`remote-screen-`, `screen-`) using `shareId.replace(/^(remote-)?screen-/, '')` to reliably isolate `targetUserId`.

---

## Code Layout
- Server files owned by M1:
  - `server/src/sockets/chatHandler.ts`
  - `server/src/index.ts`
- Client files owned by M2:
  - `client/src/contexts/SocketContext.tsx`
  - `client/src/components/chat/MessageArea.tsx`
  - `client/src/App.tsx`
- Media files owned by M3:
  - `client/src/contexts/VoiceContext.tsx`
  - `client/src/components/voice/VoiceRoom.tsx`
  - `client/src/contexts/AuthContext.tsx`
- Test files owned by M4:
  - `tests/` or `server/tests/` / `client/tests/` (autonomous test runner and suites)
  - `TEST_INFRA.md`, `TEST_READY.md`
- Finalization owned by M5:
  - `package.json`, `client/package.json`, Git repository operations per GEMINI.md

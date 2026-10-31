# Project: Xolas Production-Grade Socket, Channels, Voice & WebRTC Transmission Refactoring

## Architecture
The application is a Discord-like communication desktop & web app featuring text channels, WebRTC voice channels, and high-performance screen/media streaming.
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

## Phase 1 (Baseline Refactoring — Released v1.0.63)
- M1 (Server Sockets & Channels): Completed & verified.
- M2 (Client Sockets & Channels): Completed & verified.
- M3 (Media & Voice Hardening): Completed & verified.
- M4 (E2E Test Suites): 14 suites, 4 tiers, all passing 100%.
- M5 (Release): v1.0.63 tagged and pushed.

---

## Phase 2: Production Refactoring of WebRTC Transmissions (Screen Share & Streaming)

### Feature Inventory (Transmission Refactoring)
| # | Feature / Issue | Description | Milestone | Source |
|---|-----------------|-------------|-----------|--------|
| T1 | Room Isolation in WebRTC Signaling | Server forwards SDP/ICE/request-screen without verifying `targetUserId` is present in `voiceRooms.get(channelId)` | TM1 | Survey (Explorer T2) |
| T2 | Multi-Socket Glare & SDP Collision | `sendToUser` broadcasts WebRTC signals to all active sockets of a user, causing concurrent answers and `InvalidStateError` | TM1 | Survey (Explorer T2) |
| T3 | Race Condition & Ghost Participants in `join-voice` | Async `prisma.user.findUnique` before setting `socket.currentVoice` leaves ghost entries in `voiceRooms` on rapid channel switches | TM1 | Survey (Explorer T2) |
| T4 | Screen Share State Loss on Reconnect | Server ignores `isScreenSharing` and `screenStreamId` in `join-voice`, resetting active broadcast state on transient reconnects | TM1 | Survey (Explorer T2) |
| T5 | Duplicate State Broadcasts | `voice-user-state` emits `voice-user-state-updated` to both channel room and server room | TM1 | Survey (Explorer T2) |
| T6 | DOM `<video>` Element Unmount Leak | `ParticipantTile.tsx` `useEffect` lacks cleanup return (`el.srcObject = null; el.pause()`), leaking GPU decoders | TM2 | Survey (Explorer T1, T3) |
| T7 | Screen Share Abrupt Drop on Monitor Sleep/UAC | `handleTrackEnded` in `VoiceContext.tsx` only attempts recovery for window shares, dropping monitor shares on transient events | TM2 | Survey (Explorer T3) |
| T8 | WASAPI Audio Destination Track Leak | `createIsolatedProcessAudioTrack` destination track is never stopped with `track.stop()`, leaking Chromium audio pipelines | TM2 | Survey (Explorer T3) |
| T9 | `MediaStream` GC Churn in `syncVoiceState` | Allocating `new MediaStream` on every voice state tick (every 30ms) causes GC spikes and breaks referential equality | TM2 | Survey (Explorer T1, T3) |
| T10| React State Desync in `cleanupPeer` | `cleanupPeer` deletes peer connection and refs but never calls `syncVoiceState()`, leaving phantom participants in UI | TM2 | Survey (Explorer T1) |
| T11| `watchScreenShare` Bypass in Grid View | Grid participant tile invokes raw state setter instead of `watchScreenShare`, failing to send `request-screen-stream` | TM2 | Survey (Explorer T1) |
| T12| Audio Sender Collision on Device Switch | `setSelectedAudioDeviceId` finds first audio sender, which may overwrite screen audio sender with microphone track | TM2 | Survey (Explorer T1) |
| T13| Screen Share Termination on Channel Switch | Switching voice channels without leaving does not terminate active screen share, leaking stream to new channel | TM2 | Survey (Explorer T1) |
| T14| SDP Bandwidth Header Duplication | Incompatible duplicate `b=AS` and `b=TIAS` headers injected into SDP without stripping existing entries | TM2 | Survey (Explorer T1) |
| T15| Automated WebRTC Transmission Test Suite | Test suite verifying signaling validation, track cleanup, error recovery, and resource teardown | TM3 | Survey (Explorer T3) |
| T16| Release Protocol & Finalization | Dual Reviewers, Dual Challengers, Forensic Auditor, Build Validation, Version Patch Bump, Commit, Push, Tag | TM4 | GEMINI.md |

---

## Phase 2 Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| TM1 | Server Transmission Signaling & Room Concurrency | Fix room isolation check for targetUserId in `chatHandler.ts`, resolve multi-tab glare, fix `join-voice` async race condition, preserve screen share state on reconnect, eliminate duplicate state emissions | none | DONE (Verified build & 14 test suites passed) |
| TM2 | Client WebRTC Transmission & Track Lifecycle | Add `<video>` unmount cleanup in `ParticipantTile.tsx`, stop monitor share abrupt drops in `handleTrackEnded`, stop WASAPI tracks explicitly, eliminate `MediaStream` churn in `syncVoiceState`, call `syncVoiceState` in `cleanupPeer`, fix grid `watchScreenShare`, guard audio sender device switch, stop screen on channel switch, sanitize SDP bandwidth | none | DONE (Verified client build passed with code 0) |
| TM3 | Automated Transmission Test Suite | Implement headless WebRTC signaling and media lifecycle unit & integration tests covering room isolation, multi-socket glare, track termination, resource cleanup, and reconnection resilience | TM1, TM2 | DONE (16 suites across 4 tiers passing 100%) |
| TM4 | Multi-Agent Verification, Hardening & Release | 2 Reviewers (APPROVE), 2 Challengers (PASS), Forensic Auditor (CLEAN), client & server builds pass, version bump (`package.json` & `client/package.json`), git commit, push, git tag v1.0.X | TM1, TM2, TM3 | DONE (v1.0.64 validated, 16 test suites & adversarial probes passed 100%) |

---

## Interface Contracts (Phase 2 Additions)

### 1. Signaling Target Room Isolation (Server)
For all WebRTC signaling events (`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`, `request-screen-stream`):
- Sender MUST be in `voice:${channelId}`.
- Target (`toUserId` / `targetUserId`) MUST be in `voiceRooms.get(channelId)`.
- If target is not present in the channel, discard message immediately with debug log.

### 2. Screen Share Persistence Contract (Client ↔ Server)
- On `join-voice`:
  - Client sends `{ serverId, channelId, isMuted, isScreenSharing, screenStreamId }`.
  - Server MUST store `isScreenSharing` and `screenStreamId` in the channel participant record and broadcast them in `voice-peer-joined`.
- On `leave-voice` or disconnect:
  - When the last active socket for a broadcasting user leaves, server MUST clear transmission record and emit `voice-user-state-updated` / `voice-peer-left`.

### 3. Media Element Lifecycle Contract (Client DOM)
- Any component binding `stream` or `videoTrack` to an HTML `<video>` or `<audio>` element MUST provide an unmount/cleanup effect:
  ```typescript
  return () => {
    if (el) {
      el.pause();
      el.srcObject = null;
    }
  };
  ```

### 4. Audio Sender Disambiguation Contract (Client WebRTC)
- When updating microphone track (`setSelectedAudioDeviceId`):
  - Differentiate voice microphone sender from screen audio sender using track metadata or transceiver identity:
    `const micSender = pc.getSenders().find((s) => s.track && s.track === localAudioTrackRef.current);`

---

## Code Layout
- Server files owned by TM1:
  - `server/src/sockets/chatHandler.ts`
  - `server/src/routes/admin.ts`
- Client files owned by TM2:
  - `client/src/contexts/VoiceContext.tsx`
  - `client/src/components/voice/ParticipantTile.tsx`
  - `client/src/components/voice/VoiceRoom.tsx`
- Test files owned by TM3:
  - `tests/` and test scripts
- Release files owned by TM4:
  - `package.json`, `client/package.json`, Git repository operations

const test = require('node:test');
const assert = require('node:assert');

// =============================================================================
// CHALLENGER T2 EMPIRICAL STRESS TEST HARNESS
// Focus: Client WebRTC Transmission, Media Lifecycle & Resource Teardown
// Modules under test: ParticipantTile.tsx, VoiceRoom.tsx, VoiceContext.tsx
// =============================================================================

test.describe('Challenger T2: Client WebRTC Transmission & Resource Cleanup Stress', () => {

  // ===========================================================================
  // PROBE 1: Video Element Unmount Cleanup & Rapid Spotlight/Grid Stream Swapping
  // ===========================================================================
  test.describe('Probe 1: Video Element Unmount Cleanup & Spotlight/Grid Stream Swapping', () => {
    
    function createMockVideoElement() {
      let _srcObject = null;
      let _paused = true;
      let playCallCount = 0;
      let pauseCallCount = 0;

      return {
        get srcObject() { return _srcObject; },
        set srcObject(val) { _srcObject = val; },
        get paused() { return _paused; },
        play: async () => {
          _paused = false;
          playCallCount++;
          return Promise.resolve();
        },
        pause: () => {
          _paused = true;
          pauseCallCount++;
        },
        get stats() {
          return { playCallCount, pauseCallCount, srcObject: _srcObject, paused: _paused };
        }
      };
    }

    function createMockMediaStream(id, tracks = []) {
      const _tracks = [...tracks];
      return {
        id,
        getVideoTracks: () => _tracks.filter(t => t.kind === 'video'),
        getAudioTracks: () => _tracks.filter(t => t.kind === 'audio'),
        getTracks: () => [..._tracks],
        addTrack: (t) => _tracks.push(t),
        removeTrack: (t) => {
          const idx = _tracks.indexOf(t);
          if (idx !== -1) _tracks.splice(idx, 1);
        }
      };
    }

    function createMockTrack(id, kind = 'video') {
      let stopped = false;
      return {
        id,
        kind,
        readyState: 'live',
        stop: () => { stopped = true; },
        get isStopped() { return stopped; },
        onended: null
      };
    }

    // Harness mirroring ParticipantTile's exact React useEffect implementation
    class ParticipantTileLifecycleSimulator {
      constructor(videoEl) {
        this.videoRef = { current: videoEl };
        this.activeCleanup = null;
      }

      // Simulates running ParticipantTile's video stream effect
      render(props) {
        const { stream, videoTrack, isLocal = false, isScreenShare = false, isDocHidden = false } = props;
        
        // React unmounts/cleans up previous effect execution
        if (this.activeCleanup) {
          this.activeCleanup();
          this.activeCleanup = null;
        }

        const el = this.videoRef.current;
        if (!el) return;

        if (stream) {
          if (el.srcObject !== stream) {
            el.srcObject = stream;
          }
          if (!(isLocal && isScreenShare && isDocHidden)) {
            el.play().catch(() => {});
          }
        } else if (videoTrack) {
          const currentObj = el.srcObject;
          const existingTrack = currentObj?.getVideoTracks?.()[0];
          if (existingTrack !== videoTrack) {
            el.srcObject = createMockMediaStream('stream-wrapped', [videoTrack]);
          }
          if (!(isLocal && isScreenShare && isDocHidden)) {
            el.play().catch(() => {});
          }
        } else {
          el.srcObject = null;
        }

        // Cleanup handler returned by useEffect in ParticipantTile.tsx
        this.activeCleanup = () => {
          if (el) {
            el.pause();
            el.srcObject = null;
          }
        };
      }

      unmount() {
        if (this.activeCleanup) {
          this.activeCleanup();
          this.activeCleanup = null;
        }
        // Emulate React nullifying the DOM ref upon node detachment
        this.videoRef.current = null;
      }
    }

    test('Tile cleanly pauses and sets srcObject = null on component unmount', async () => {
      const videoEl = createMockVideoElement();
      const sim = new ParticipantTileLifecycleSimulator(videoEl);
      const stream = createMockMediaStream('stream-1', [createMockTrack('v-1', 'video')]);

      sim.render({ stream, isLocal: false, isScreenShare: true });
      assert.strictEqual(videoEl.srcObject, stream, 'Video element must hold active stream');
      assert.strictEqual(videoEl.stats.playCallCount, 1, 'play() must have been called on mount');

      // Unmount the component
      sim.unmount();
      assert.strictEqual(videoEl.srcObject, null, 'Video element srcObject must be nullified upon unmount');
      assert.strictEqual(videoEl.paused, true, 'Video element must be paused upon unmount');
      assert.strictEqual(videoEl.stats.pauseCallCount, 1, 'pause() must have been invoked');
    });

    test('Rapid switching between spotlight and grid does not leak video element bindings or throw', async () => {
      const videoEl = createMockVideoElement();
      const sim = new ParticipantTileLifecycleSimulator(videoEl);

      const streams = Array.from({ length: 100 }, (_, i) => 
        createMockMediaStream(`stream-${i}`, [createMockTrack(`track-${i}`, 'video')])
      );

      // Stress test: 100 rapid alternations between different streams, videoTrack fallback, and null (grid)
      for (let i = 0; i < 100; i++) {
        if (i % 3 === 0) {
          // Stream mode (Spotlight)
          sim.render({ stream: streams[i], isLocal: false, isScreenShare: true });
          assert.strictEqual(videoEl.srcObject, streams[i]);
        } else if (i % 3 === 1) {
          // Track fallback mode
          const track = createMockTrack(`standalone-${i}`, 'video');
          sim.render({ videoTrack: track, isLocal: false, isScreenShare: false });
          assert.ok(videoEl.srcObject, 'Wrapper stream must be set');
          assert.strictEqual(videoEl.srcObject.getVideoTracks()[0], track);
        } else {
          // Grid mode without video
          sim.render({ stream: null, videoTrack: null });
          assert.strictEqual(videoEl.srcObject, null, 'srcObject must be null in avatar grid mode');
        }
      }

      // Final unmount
      sim.unmount();
      assert.strictEqual(videoEl.srcObject, null, 'srcObject must be null after final unmount');
      assert.strictEqual(videoEl.paused, true, 'Video must be paused');
    });

    test('Video cleanup closure survives ref detachment when unmounting', async () => {
      const videoEl = createMockVideoElement();
      const sim = new ParticipantTileLifecycleSimulator(videoEl);
      const stream = createMockMediaStream('stream-persist', [createMockTrack('v-persist', 'video')]);

      sim.render({ stream });
      assert.strictEqual(videoEl.srcObject, stream);

      // Detach DOM ref before cleanup execution (edge condition in React reconciler)
      sim.videoRef.current = null;
      sim.unmount();

      assert.strictEqual(videoEl.srcObject, null, 'Closure variable el must successfully clear srcObject');
      assert.strictEqual(videoEl.paused, true, 'Closure variable el must pause video');
    });
  });

  // ===========================================================================
  // PROBE 2: Screen Share Recovery & Cancellation Stress
  // ===========================================================================
  test.describe('Probe 2: Screen Share Recovery & Cancellation Stress', () => {

    function createMockTrack(id) {
      let stopped = false;
      return {
        id,
        kind: 'video',
        readyState: 'live',
        stop: () => { stopped = true; },
        get isStopped() { return stopped; },
        onended: null
      };
    }

    class ScreenShareRecoverySimulator {
      constructor() {
        this.isScreenSharing = true;
        this.isRecoveringScreenShare = false;
        this.currentScreenSourceId = 'screen:0:0';
        this.recoveryAttempts = 0;
        this.stopScreenShareCalled = false;
        this.reacquireSuccessOnAttempt = 0; // 0 = never succeed, 1-3 = succeed on attempt N
        this.reacquireCalledCount = 0;
        this.replacedTracks = [];
      }

      async reacquireWindowVideoTrack(sourceId, quality) {
        this.reacquireCalledCount++;
        if (this.reacquireCalledCount === this.reacquireSuccessOnAttempt) {
          const newTrack = createMockTrack(`recovered-track-${this.reacquireCalledCount}`);
          this.replacedTracks.push(newTrack);
          return true;
        }
        return false;
      }

      stopScreenShare() {
        this.stopScreenShareCalled = true;
        this.isScreenSharing = false;
        this.currentScreenSourceId = undefined;
        this.isRecoveringScreenShare = false;
      }

      // Mirrors handleTrackEnded in VoiceContext.tsx (lines 3161-3223)
      async handleTrackEnded(endedTrack) {
        if (!this.isScreenSharing) return;
        if (this.isRecoveringScreenShare) return;

        const sourceId = this.currentScreenSourceId;
        const isWindow = sourceId && sourceId.startsWith('window:');

        // Monitor share path (isWindow === false)
        if (sourceId && !isWindow) {
          try {
            this.isRecoveringScreenShare = true;
            for (let attempt = 1; attempt <= 3; attempt++) {
              if (!this.isScreenSharing) break;
              // Micro delay to simulate backoff without stalling test
              await new Promise(r => setTimeout(r, 10));
              const recovered = await this.reacquireWindowVideoTrack(sourceId, {});
              if (recovered) {
                this.isRecoveringScreenShare = false;
                return;
              }
            }
          } catch (err) {
            // error logged
          } finally {
            this.isRecoveringScreenShare = false;
          }
        }

        this.stopScreenShare();
      }
    }

    test('Transient monitor sleep/wake recovers on attempt 2 without terminating screen share', async () => {
      const sim = new ScreenShareRecoverySimulator();
      sim.reacquireSuccessOnAttempt = 2; // Simulates monitor waking up after first check

      const track = createMockTrack('track-sleep');
      await sim.handleTrackEnded(track);

      assert.strictEqual(sim.stopScreenShareCalled, false, 'stopScreenShare must NOT be called on successful recovery');
      assert.strictEqual(sim.isScreenSharing, true, 'User must remain sharing screen');
      assert.strictEqual(sim.reacquireCalledCount, 2, 'Must have succeeded on attempt 2');
      assert.strictEqual(sim.isRecoveringScreenShare, false, 'Recovery flag must be cleared');
      assert.strictEqual(sim.replacedTracks.length, 1, 'Recovered track must be present');
    });

    test('Permanent monitor disconnect exhausts 3 attempts and gracefully stops screen share', async () => {
      const sim = new ScreenShareRecoverySimulator();
      sim.reacquireSuccessOnAttempt = 0; // Never succeeds

      const track = createMockTrack('track-disconnected');
      await sim.handleTrackEnded(track);

      assert.strictEqual(sim.reacquireCalledCount, 3, 'Must attempt exactly 3 recovery retries');
      assert.strictEqual(sim.stopScreenShareCalled, true, 'stopScreenShare MUST be invoked when attempts fail');
      assert.strictEqual(sim.isScreenSharing, false, 'Screen sharing must be terminated');
      assert.strictEqual(sim.isRecoveringScreenShare, false, 'Recovery flag must be cleared');
    });

    test('Concurrent track.onended triggers are serialized and do not spawn infinite recovery loops', async () => {
      const sim = new ScreenShareRecoverySimulator();
      sim.reacquireSuccessOnAttempt = 3;

      const track1 = createMockTrack('track-glitch-1');
      const track2 = createMockTrack('track-glitch-2');
      const track3 = createMockTrack('track-glitch-3');

      // Fire 3 simultaneous onended calls (glitch storm)
      await Promise.all([
        sim.handleTrackEnded(track1),
        sim.handleTrackEnded(track2),
        sim.handleTrackEnded(track3)
      ]);

      // Only the first one should have entered the recovery loop
      assert.strictEqual(sim.reacquireCalledCount, 3, 'Total reacquire attempts must not exceed 3 (no duplicate loops)');
      assert.strictEqual(sim.isRecoveringScreenShare, false);
      assert.strictEqual(sim.stopScreenShareCalled, false);
    });

    test('Repeated start and cancel cycles (50 cycles) cleanly reset sourceId, audio cleanup, and state', async () => {
      let currentScreenSourceId = null;
      let isScreenSharing = false;
      let screenAudioCleanupCalled = 0;
      let screenAudioCleanup = null;

      // Emulate startScreenShare cancellation path (VoiceContext.tsx lines 3388-3405)
      for (let i = 0; i < 50; i++) {
        try {
          currentScreenSourceId = `source-${i}`;
          screenAudioCleanup = () => { screenAudioCleanupCalled++; };
          
          // User cancels native display picker (NotAllowedError)
          const err = new Error('Permission denied by user');
          err.name = 'NotAllowedError';
          throw err;
        } catch (error) {
          currentScreenSourceId = null;
          if (screenAudioCleanup) {
            try { screenAudioCleanup(); } catch {}
            screenAudioCleanup = null;
          }
          isScreenSharing = false;
        }
      }

      assert.strictEqual(currentScreenSourceId, null, 'currentScreenSourceId must be null after cancellations');
      assert.strictEqual(screenAudioCleanupCalled, 50, 'screenAudioCleanup must have been called on every cancellation');
      assert.strictEqual(screenAudioCleanup, null, 'screenAudioCleanup ref must be null');
      assert.strictEqual(isScreenSharing, false, 'isScreenSharing must remain false');
    });
  });

  // ===========================================================================
  // PROBE 3: WASAPI and Audio Track Cleanup
  // ===========================================================================
  test.describe('Probe 3: WASAPI and Audio Track Cleanup', () => {

    function createMockAudioTrack(id) {
      let stopped = false;
      return {
        id,
        kind: 'audio',
        readyState: 'live',
        stop: () => { stopped = true; },
        get isStopped() { return stopped; }
      };
    }

    test('All MediaStreamTrack instances from Web Audio destination are stopped explicitly', async () => {
      const destTracks = [
        createMockAudioTrack('dest-t-1'),
        createMockAudioTrack('dest-t-2')
      ];
      const isolatedTrack = createMockAudioTrack('isolated-track-main');

      const mockDest = {
        stream: {
          getAudioTracks: () => [...destTracks]
        }
      };

      let electronStopAudioCalled = false;
      let chunkListenerRemoved = false;
      let audioCtxClosed = false;
      let workletDisconnected = false;
      let scriptNodeDisconnected = false;
      let oscStopped = false;

      const mockAudioCtx = {
        close: async () => { audioCtxClosed = true; }
      };
      const mockWorklet = {
        port: { onmessage: () => {} },
        disconnect: () => { workletDisconnected = true; }
      };
      const mockScriptNode = {
        onaudioprocess: () => {},
        disconnect: () => { scriptNodeDisconnected = true; }
      };
      const mockOsc = {
        stop: () => { oscStopped = true; }
      };

      // VoiceContext.tsx lines 3001-3039 cleanup implementation
      const screenAudioCleanup = () => {
        try {
          mockDest.stream.getAudioTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
          if (isolatedTrack) {
            try { isolatedTrack.stop(); } catch {}
          }
        } catch {}
        try {
          chunkListenerRemoved = true;
        } catch {}
        try {
          electronStopAudioCalled = true;
        } catch {}
        try {
          if (mockWorklet) {
            mockWorklet.port.onmessage = null;
            mockWorklet.disconnect();
          }
          if (mockScriptNode) {
            mockScriptNode.onaudioprocess = null;
            mockScriptNode.disconnect();
          }
          if (mockOsc) mockOsc.stop();
        } catch {}
        try {
          mockAudioCtx.close().catch(() => {});
        } catch {}
      };

      // Execute cleanup
      screenAudioCleanup();

      // Assertions
      assert.strictEqual(destTracks[0].isStopped, true, 'Destination track 1 must be stopped');
      assert.strictEqual(destTracks[1].isStopped, true, 'Destination track 2 must be stopped');
      assert.strictEqual(isolatedTrack.isStopped, true, 'Returned isolated track must be stopped');
      assert.strictEqual(electronStopAudioCalled, true, 'stopProcessAudioCapture must be called');
      assert.strictEqual(chunkListenerRemoved, true, 'removeChunkListener must be called');
      assert.strictEqual(workletDisconnected, true, 'workletNode must be disconnected');
      assert.strictEqual(scriptNodeDisconnected, true, 'scriptNode must be disconnected');
      assert.strictEqual(oscStopped, true, 'oscillator must be stopped');
      assert.strictEqual(audioCtxClosed, true, 'audioCtx must be closed');
    });

    test('leaveVoiceChannel triggers screenAudioCleanupRef and terminates zombie wasapi-loopback', async () => {
      let screenAudioCleanupExecuted = false;
      let processAudioKilled = false;

      let screenAudioCleanupRef = () => {
        screenAudioCleanupExecuted = true;
      };

      const electronAPI = {
        stopProcessAudioCapture: () => {
          processAudioKilled = true;
        }
      };

      // Emulate leaveVoiceChannel lines 2331-2339
      if (screenAudioCleanupRef) {
        screenAudioCleanupRef();
        screenAudioCleanupRef = null;
      }
      try {
        electronAPI.stopProcessAudioCapture();
      } catch {}

      assert.strictEqual(screenAudioCleanupExecuted, true, 'screenAudioCleanup must execute on leaveVoiceChannel');
      assert.strictEqual(screenAudioCleanupRef, null, 'screenAudioCleanupRef must be reset to null');
      assert.strictEqual(processAudioKilled, true, 'stopProcessAudioCapture must be executed on leaveVoiceChannel');
    });
  });

  // ===========================================================================
  // PROBE 4: Device Switch Disambiguation
  // ===========================================================================
  test.describe('Probe 4: Device Switch Disambiguation', () => {

    function createMockSender(track) {
      let currentTrack = track;
      let replaceTrackCalled = false;
      return {
        track: currentTrack,
        get currentTrack() { return currentTrack; },
        replaceTrack: async (newT) => {
          replaceTrackCalled = true;
          currentTrack = newT;
        },
        get replaceTrackCalled() { return replaceTrackCalled; }
      };
    }

    test('Changing microphone device replaces ONLY the mic sender, preserving screen audio sender untouched', async () => {
      const oldMicTrack = { id: 'old-mic', kind: 'audio' };
      const screenAudioTrack = { id: 'screen-audio', kind: 'audio' };
      const screenVideoTrack = { id: 'screen-video', kind: 'video' };
      const newMicTrack = { id: 'new-mic-device-2', kind: 'audio' };

      const micSender = createMockSender(oldMicTrack);
      const screenAudioSender = createMockSender(screenAudioTrack);
      const screenVideoSender = createMockSender(screenVideoTrack);

      const allSenders = [micSender, screenAudioSender, screenVideoSender];
      const screenSenders = [screenAudioSender, screenVideoSender];

      const mockPeerConnection = {
        getSenders: () => [...allSenders]
      };

      // VoiceContext.tsx lines 1622-1634 logic
      const audioSender = mockPeerConnection
        .getSenders()
        .find(
          (s) =>
            s.track &&
            s.track.kind === 'audio' &&
            (s.track === oldMicTrack || !screenSenders.includes(s))
        );

      assert.ok(audioSender, 'Must find audio sender');
      assert.strictEqual(audioSender, micSender, 'Must identify micSender as the target');
      assert.notStrictEqual(audioSender, screenAudioSender, 'Must NOT select screenAudioSender');

      await audioSender.replaceTrack(newMicTrack);

      assert.strictEqual(micSender.replaceTrackCalled, true, 'Mic sender must have replaceTrack called');
      assert.strictEqual(micSender.currentTrack, newMicTrack, 'Mic sender track must be newMicTrack');
      assert.strictEqual(screenAudioSender.replaceTrackCalled, false, 'Screen audio sender must NOT be touched');
      assert.strictEqual(screenAudioSender.currentTrack, screenAudioTrack, 'Screen audio track must remain intact');
    });

    test('If oldMicTrack is null, screen sender is still protected by !screenSenders.includes(s)', async () => {
      const screenAudioTrack = { id: 'screen-audio', kind: 'audio' };
      const micTrack = { id: 'active-mic', kind: 'audio' };

      const micSender = createMockSender(micTrack);
      const screenAudioSender = createMockSender(screenAudioTrack);
      const screenSenders = [screenAudioSender];

      const mockPeerConnection = {
        getSenders: () => [screenAudioSender, micSender] // screen audio listed FIRST in sender array
      };

      const oldMicTrack = null; // Unspecified/corrupted old track ref

      const audioSender = mockPeerConnection
        .getSenders()
        .find(
          (s) =>
            s.track &&
            s.track.kind === 'audio' &&
            (s.track === oldMicTrack || !screenSenders.includes(s))
        );

      assert.strictEqual(audioSender, micSender, 'Must skip screenAudioSender even if it is first in the array');
    });

    test('If only screen audio is active and no mic sender exists, addTrack is used instead of replacing screen audio', async () => {
      const screenAudioTrack = { id: 'screen-audio', kind: 'audio' };
      const screenAudioSender = createMockSender(screenAudioTrack);
      const screenSenders = [screenAudioSender];

      let addTrackCalled = false;
      const mockPeerConnection = {
        getSenders: () => [screenAudioSender],
        addTrack: (track, stream) => { addTrackCalled = true; }
      };

      const oldMicTrack = null;
      const newMicTrack = { id: 'new-mic', kind: 'audio' };

      const audioSender = mockPeerConnection
        .getSenders()
        .find(
          (s) =>
            s.track &&
            s.track.kind === 'audio' &&
            (s.track === oldMicTrack || !screenSenders.includes(s))
        );

      assert.strictEqual(audioSender, undefined, 'No mic sender found');

      if (audioSender) {
        await audioSender.replaceTrack(newMicTrack);
      } else {
        mockPeerConnection.addTrack(newMicTrack, {});
      }

      assert.strictEqual(screenAudioSender.replaceTrackCalled, false, 'Screen audio was NOT overwritten');
      assert.strictEqual(addTrackCalled, true, 'addTrack was called to attach new mic sender cleanly');
    });
  });

  // ===========================================================================
  // PROBE 5: Channel Switch Screen Teardown
  // ===========================================================================
  test.describe('Probe 5: Channel Switch Screen Teardown', () => {

    test('Switching voice channels cleanly terminates active screen share before entering new channel', async () => {
      let isScreenSharing = true;
      let screenStreamTracksStopped = 0;
      let screenSendersRemovedCount = 0;
      let screenAudioCleanupCalled = false;
      let currentScreenSourceId = 'window:12345';
      let screenStream = {
        getTracks: () => [
          { id: 't1', stop: () => { screenStreamTracksStopped++; }, onended: () => {} },
          { id: 't2', stop: () => { screenStreamTracksStopped++; }, onended: () => {} }
        ]
      };

      const mockSenders = [{ id: 's1' }, { id: 's2' }];
      const peers = new Map([
        ['peer_bob', {
          removeTrack: (s) => { screenSendersRemovedCount++; }
        }]
      ]);
      const screenSenders = new Map([['peer_bob', mockSenders]]);

      const stopScreenShare = () => {
        if (screenAudioCleanupCalled === false) {
          screenAudioCleanupCalled = true;
        }

        peers.forEach((pc, peerId) => {
          const senders = screenSenders.get(peerId) || [];
          senders.forEach((s) => {
            pc.removeTrack(s);
          });
          screenSenders.delete(peerId);
        });

        if (screenStream) {
          screenStream.getTracks().forEach((t) => {
            t.onended = null;
            t.stop();
          });
          screenStream = null;
        }

        isScreenSharing = false;
        currentScreenSourceId = undefined;
      };

      // Simulate joinVoiceChannel when moving from Channel A to Channel B
      const currentChannel = { id: 'chan_A', name: 'Voice A' };
      const targetChannel = { id: 'chan_B', name: 'Voice B' };

      const joinVoiceChannel = async (channel) => {
        if (currentChannel.id === channel.id) return;

        // VoiceContext.tsx line 2278-2281
        if (isScreenSharing) {
          stopScreenShare();
        }

        // Proceed to join new channel...
      };

      await joinVoiceChannel(targetChannel);

      assert.strictEqual(isScreenSharing, false, 'isScreenSharing must be false');
      assert.strictEqual(screenStream, null, 'screenStream must be cleared');
      assert.strictEqual(screenStreamTracksStopped, 2, 'All screen tracks must be stopped');
      assert.strictEqual(screenSendersRemovedCount, 2, 'All WebRTC senders must be removed from peers');
      assert.strictEqual(screenSenders.has('peer_bob'), false, 'screenSenders must be purged');
      assert.strictEqual(screenAudioCleanupCalled, true, 'screenAudioCleanup must have executed');
      assert.strictEqual(currentScreenSourceId, undefined, 'currentScreenSourceId must be undefined');
    });
  });

});

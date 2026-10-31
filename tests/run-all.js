/**
 * Xolas E2E & Integration Test Runner
 * Executes all 4 tiers of automated Socket.io, channel, voice & WebRTC tests.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testSuites = [
  // Tier 1: Feature Coverage
  { tier: 'Tier 1', name: 'Socket Auth & Connection', file: 'tests/tier1_features/01_socket_auth.test.js' },
  { tier: 'Tier 1', name: 'Channel Management & Isolation', file: 'tests/tier1_features/02_channels.test.js' },
  { tier: 'Tier 1', name: 'Message Delivery & Persistence', file: 'tests/tier1_features/03_messages.test.js' },
  { tier: 'Tier 1', name: 'Voice Room Presence & State', file: 'tests/tier1_features/04_voice_rooms.test.js' },
  { tier: 'Tier 1', name: 'WebRTC P2P Signaling Relay', file: 'tests/tier1_features/05_webrtc_signaling.test.js' },
  { tier: 'Tier 1', name: 'Leave Server Room Lifecycle', file: 'tests/tier1_features/06_leave_server.test.js' },

  // Tier 2: Boundary & Corner Cases
  { tier: 'Tier 2', name: 'Malformed Payloads & Hardening', file: 'tests/tier2_boundaries/01_malformed_payloads.test.js' },
  { tier: 'Tier 2', name: 'Unauthorized / Malicious Joins', file: 'tests/tier2_boundaries/02_unauthorized_joins.test.js' },
  { tier: 'Tier 2', name: 'Unapproved User Rejection', file: 'tests/tier2_boundaries/03_unapproved_users.test.js' },
  { tier: 'Tier 2', name: 'Duplicate Joins & Deduplication', file: 'tests/tier2_boundaries/04_duplicate_joins.test.js' },
  { tier: 'Tier 2', name: 'Invalid Signaling Room Targets', file: 'tests/tier2_boundaries/05_invalid_screen_targets.test.js' },

  // Tier 3: Cross-Feature & Reconnection
  { tier: 'Tier 3', name: 'Network Disconnect & Reconnect', file: 'tests/tier3_reconnection/01_network_reconnect.test.js' },
  { tier: 'Tier 3', name: 'Stale Socket Disconnect Isolation', file: 'tests/tier3_reconnection/02_stale_socket_disconnect.test.js' },

  // Tier 4: Real-World Multi-Participant
  { tier: 'Tier 4', name: 'Multi-User Voice, Screen & Renegotiation', file: 'tests/tier4_multi_participant/01_multi_user_voice.test.js' },
];

console.log('='.repeat(75));
console.log('  🚀 XOLAS PRODUCTION E2E & INTEGRATION TEST RUNNER');
console.log('  Track: M4 (Socket.io, Channels, Voice WebRTC & Reconnection)');
console.log('='.repeat(75));
console.log(`Discovered ${testSuites.length} test suites across 4 tiers.\n`);

let passedCount = 0;
let failedCount = 0;
const results = [];
const startTime = Date.now();

for (const suite of testSuites) {
  const filePath = path.resolve(process.cwd(), suite.file);
  process.stdout.write(`▶ Running [${suite.tier}] ${suite.name}... `);

  const suiteStart = Date.now();
  const run = spawnSync(process.execPath, ['--test', filePath], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  const duration = Date.now() - suiteStart;

  if (run.status === 0) {
    passedCount++;
    results.push({ ...suite, status: 'PASS', duration });
    console.log(`\x1b[32m✔ PASS\x1b[0m (${duration}ms)`);
  } else {
    failedCount++;
    results.push({ ...suite, status: 'FAIL', duration, output: run.stderr || run.stdout });
    console.log(`\x1b[31m✖ FAIL\x1b[0m (${duration}ms)`);
    if (run.stdout) console.log(run.stdout);
    if (run.stderr) console.error(run.stderr);
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n' + '='.repeat(75));
console.log('  📊 TEST EXECUTION SUMMARY');
console.log('='.repeat(75));

console.log(`Total Suites : ${testSuites.length}`);
console.log(`Passed       : \x1b[32m${passedCount}\x1b[0m`);
console.log(`Failed       : ${failedCount > 0 ? `\x1b[31m${failedCount}\x1b[0m` : '0'}`);
console.log(`Total Time   : ${totalDuration}s\n`);

console.log('Detailed Tier Breakdown:');
for (const tier of ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']) {
  const tierSuites = results.filter((r) => r.tier === tier);
  const tierPassed = tierSuites.filter((r) => r.status === 'PASS').length;
  console.log(`  - ${tier.padEnd(8)}: ${tierPassed}/${tierSuites.length} passed`);
}

console.log('='.repeat(75));

if (failedCount > 0) {
  console.error('\n❌ TEST RUN FAILED');
  process.exit(1);
} else {
  console.log('\n✅ ALL 4 TIERS PASSED 100% WITH ZERO ERRORS');
  process.exit(0);
}

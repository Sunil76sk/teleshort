/** Phase 5 runtime hardening checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const guard = fs.readFileSync(path.join(root, 'public', 'force-join-fix.js'), 'utf8');
const adStart = fs.readFileSync(path.join(root, 'server', 'ad-session', 'start.js'), 'utf8');
const adEvent = fs.readFileSync(path.join(root, 'server', 'ad-session', 'event.js'), 'utf8');

assert.match(guard, /Monetag SDK unavailable/);
assert.match(guard, /Promise\.reject/);
assert.match(guard, /show_11694314/);
assert.match(guard, /show_11515208/);
assert.match(adStart, /loadRequiredChannels/);
assert.doesNotMatch(adStart, /DEFAULT_FORCE_JOIN_CHANNELS/);
assert.match(adStart, /network: 'MONETAG'/);
assert.match(adStart, /min_duration_ms: 4500/);
assert.match(adEvent, /elapsedSinceStart < 4500/);
assert.match(adEvent, /reportedDuration < 4500/);
assert.match(adEvent, /WATCH_TIME_TOO_SHORT/);
assert.match(adEvent, /network: 'MONETAG'/);

console.log('PHASE 5 RUNTIME HARDENING: PASS');

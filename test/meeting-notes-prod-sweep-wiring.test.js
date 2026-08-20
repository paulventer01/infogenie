// Source-level lock: npm start → node server.js (NODE_ENV=production) is the
// process that enables runtime_flags.background and therefore the 6h excerpt
// sweeper. Does not spawn the production server.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('scripts/start.js spawns node server.js in production', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/start.js'), 'utf8');
  assert.match(src, /run\(\s*"express"\s*,\s*"node"\s*,\s*\[\s*"server\.js"\s*\]/);
  assert.match(src, /NODE_ENV:\s*"production"/);
});

test('server.js enables background before requiring the meeting-notes router', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const bgIdx = src.indexOf('_runtimeFlags.setBackground(require.main === module)');
  const requireIdx = src.indexOf("require('./services/meeting_notes/api')");
  assert.ok(bgIdx >= 0, 'setBackground must run from require.main === module');
  assert.ok(requireIdx >= 0, 'meeting-notes router must be required from server.js');
  assert.ok(requireIdx > bgIdx, 'background flag must be set before meeting-notes api.js is required');
});

test('meeting-notes boot task fails closed in production and does not swallow sweep errors', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = src.indexOf("app.use('/api/meeting-notes'");
  const end = src.indexOf("app.use('/api/headline-tester'");
  assert.ok(start >= 0 && end > start, 'meeting-notes mount + BOOT_TASKS block must be locatable');
  const block = src.slice(start, end);
  assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(block), 'boot sweep must not use empty catch');
  assert.match(block, /backfillMeetingNotesEncryption\(\)/);
  assert.match(block, /sweepExpiredExcerpts\(\)/);
  assert.match(block, /backfillResult\.ok !== true/);
  assert.match(block, /sweepResult\.ok !== true/);
  assert.match(block, /process\.exit\(1\)/);
  assert.match(block, /NODE_ENV === 'production'/);
  assert.match(block, /captureException/);
  assert.ok(!/catch\s*\{\s*console\.warn\('\[meeting-notes\] schema init failed'\)/.test(block));
});

test('api.js registers setInterval only when backgroundEnabled, period 6h', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/meeting_notes/api.js'), 'utf8');
  assert.match(src, /backgroundEnabled\(\)/);
  assert.match(src, /setInterval/);
  assert.match(src, /6 \* 3600 \* 1000/);
  assert.ok(!/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(src), 'recurring sweep must not use empty catch');
  assert.match(src, /startExcerptSweepInterval/);
});

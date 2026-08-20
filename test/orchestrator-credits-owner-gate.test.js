'use strict';
// test/orchestrator-credits-owner-gate.test.js — PR 2 owner-gate exemption shape.
//
// The credits surface has to be reachable by non-owner roles, otherwise the
// per-action credit permissions are unreachable behind a blanket `owner_only`.
// The exemption must be as narrow as the workflows one: the rest of the hub
// (suggest / resolve / apply / history) stays owner-gated and a look-alike
// prefix such as /credits-export must not inherit it.
//
// Reads the regex literals out of server.js source — no bootApp, no database,
// no network. ZERO skips.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// The `_OWNER_GATE_ALLOW` array literal, so a regex written elsewhere in
// server.js cannot satisfy this test.
function ownerGateAllowSource() {
  const start = SERVER_SRC.indexOf('const _OWNER_GATE_ALLOW = [');
  assert.ok(start >= 0, 'server.js must still define _OWNER_GATE_ALLOW');
  const end = SERVER_SRC.indexOf('\n];', start);
  assert.ok(end > start, '_OWNER_GATE_ALLOW must still be an array literal');
  return SERVER_SRC.slice(start, end);
}

function ownerGateAllowPatterns() {
  const body = ownerGateAllowSource();
  const patterns = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(\/\^.*?\/),\s*(?:\/\/.*)?$/);
    if (m) patterns.push(new RegExp(m[1].slice(1, -1)));
  }
  assert.ok(patterns.length >= 8, `expected the full allow-list, parsed ${patterns.length}`);
  return patterns;
}

const exempt = (p) => ownerGateAllowPatterns().some(rx => rx.test(p));

test('the credits prefix is exempt from the legacy owner gate', () => {
  assert.match(
    ownerGateAllowSource(),
    /\/\^\\\/api\\\/agent-orchestrator\\\/credits\(\?:\\\/\|\$\)\//,
    'server.js must exempt /api/agent-orchestrator/credits, path-anchored'
  );
  for (const p of [
    '/api/agent-orchestrator/credits',
    '/api/agent-orchestrator/credits/',
    '/api/agent-orchestrator/credits/balance',
    '/api/agent-orchestrator/credits/limits',
    '/api/agent-orchestrator/credits/ledger/entry_1',
  ]) {
    assert.equal(exempt(p), true, `${p} must reach the credit handlers`);
  }
});

test('the credits exemption does not leak to look-alikes or the rest of the hub', () => {
  for (const p of [
    '/api/agent-orchestrator/credits-export',
    '/api/agent-orchestrator/creditsexport',
    '/api/agent-orchestrator/credits-admin/grant',
    '/api/agent-orchestrator/suggest',
    '/api/agent-orchestrator/resolve',
    '/api/agent-orchestrator/apply',
    '/api/agent-orchestrator/history',
    '/api/agent-orchestrator/state',
    '/api/agent-orchestrator',
    '/api/credits',
    '/api/other/api/agent-orchestrator/credits',
  ]) {
    assert.equal(exempt(p), false, `${p} must stay owner-gated`);
  }
});

test('the PR 1 workflows exemption is unchanged', () => {
  for (const p of [
    '/api/agent-orchestrator/workflows',
    '/api/agent-orchestrator/workflows/ow_abc',
    '/api/agent-orchestrator/workflows/ow_abc/timeline',
  ]) {
    assert.equal(exempt(p), true, `${p} must stay exempt`);
  }
  assert.equal(exempt('/api/agent-orchestrator/workflows-export'), false,
    'the workflows look-alike must stay owner-gated');
});

test('the owner gate itself still runs on /api and still denies non-owners', () => {
  const gateIdx = SERVER_SRC.indexOf('_OWNER_GATE_ALLOW.some');
  assert.ok(gateIdx >= 0, 'the allow-list must still be consulted by the gate middleware');
  const window = SERVER_SRC.slice(gateIdx - 400, gateIdx + 600);
  assert.match(window, /req\.path\.startsWith\('\/api\/'\)/);
  assert.match(window, /req\.user\.isOwner === true/);
  assert.match(window, /error: 'owner_only'/);
});

'use strict';
// test/permission-matrix-coverage.test.js — Guard against features that skip the
// permission check.
//
// WHY: With PERMISSION_ENFORCEMENT=on, the enforcer (permission_enforce.js) treats
// any `/api/...` path NOT covered by a ROUTE_GROUPS prefix as "allow + log" — a
// silent gap that re-opens the hole enforcement was meant to close. Nothing fails
// when a new feature router is mounted in server.js without a matching matrix
// entry; the gap is only visible by reading debug logs.
//
// This test enumerates every top-level `/api/<segment>` mounted in server.js,
// dedupes to the first path segment, and asserts each is covered by a matrix
// prefix (using the SAME longest-prefix matcher the enforcer uses,
// matrix.requiredPermissionForRequest) OR is in a small, documented allowlist of
// intentionally-ungated routers. Adding a new feature router without mapping it
// turns a silent gap into a clear, named CI failure.
//
// Run: node --test   (or: npm test)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const matrix = require('../services/tenants/permission_matrix');

// ── Intentionally-ungated route segments ─────────────────────────────────────
// These are NOT feature surfaces and are deliberately left out of the matrix:
//   /api/auth    — login/signup/verify/reset; runs BEFORE the auth gate, so the
//                  user isn't authenticated yet. Carries its own internal guards.
//   /api/_debug  — owner-only diagnostics; gated server-side by an explicit owner
//                  check on each handler, not via the matrix.
// Anything else MUST be mapped in ROUTE_GROUPS. To intentionally exempt a new
// router, add it here WITH a comment explaining why — don't just silence the test.
const ALLOWLIST = new Set([
  '/api/auth',
  '/api/_debug',
]);

// Extract every `app.<verb>('/api/...')` mount from server.js and reduce each to
// its first path segment (`/api/launch/google-ads` → `/api/launch`).
function mountedApiSegments() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const re = /app\.(?:use|get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]*)['"`]/g;
  const segments = new Map(); // firstSegment → example full path (for messages)
  let m;
  while ((m = re.exec(src)) !== null) {
    const full = m[1];
    const parts = full.split('/').filter(Boolean); // ['api', '<seg>', ...]
    if (parts.length < 2) continue;
    const seg = `/api/${parts[1]}`;
    if (!segments.has(seg)) segments.set(seg, full);
  }
  return segments;
}

test('coverage: every /api router in server.js is mapped in the matrix or allowlisted', () => {
  const segments = mountedApiSegments();
  assert.ok(segments.size > 50, `expected to parse many /api mounts, found ${segments.size}`);

  const unmapped = [];
  for (const [seg, example] of segments) {
    if (ALLOWLIST.has(seg)) continue;
    // Mirror the enforcer: longest-prefix match via the shipped matcher.
    const { matched } = matrix.requiredPermissionForRequest(seg, 'GET');
    if (!matched) unmapped.push(`${seg} (e.g. ${example})`);
  }

  assert.deepEqual(
    unmapped,
    [],
    'These /api routers are mounted in server.js but NOT covered by a ROUTE_GROUPS ' +
    'prefix in services/tenants/permission_matrix.js. With PERMISSION_ENFORCEMENT=on ' +
    'they are silently allowed for everyone. Add a { prefix, view, write } entry to ' +
    'the matrix (or, if intentionally ungated, add the segment to ALLOWLIST in this ' +
    `test with a justifying comment):\n  - ${unmapped.join('\n  - ')}`
  );
});

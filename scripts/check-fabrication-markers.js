#!/usr/bin/env node
// scripts/check-fabrication-markers.js — Honesty/data-mode lint (Task 14)
//
// Data-mode enforcement (services/admin/enforcement.js) is marker-driven: it
// only withholds/badges a response that carries a recognized fabrication marker
// (source ∈ {placeholder,fallback,template,serp-fallback,demo,mock,sample},
// _estimated:true, _fabricated:true). An untagged synthetic fallback silently
// bypasses honesty mode.
//
// This lint flags any service file that defines a `_template*` / `_fallback*`
// helper (the usual shape of a synthetic-when-AI-is-unavailable branch) but
// contains NO recognized marker anywhere in the file. Markers are commonly set
// at the route via a variable (`source = 'template'`) rather than on the helper
// itself, so the check is file-scoped, not helper-scoped — this keeps false
// positives low while still catching a brand-new fallback that forgot to tag
// its response.
//
// Helpers that are deliberately untagged (because their output is NOT synthetic
// data dressed as real measurements) live in ALLOWLIST with a documented why.

const fs = require('fs');
const path = require('path');

const SERVICES_DIR = path.join(__dirname, '..', 'services');

// Defines a synthetic-fallback helper.
const HELPER_RE = /(?:function\s+_(?:template|fallback)\w*)|(?:\b(?:const|let|var)\s+_(?:template|fallback)\w*\s*=)/;

// Any recognized fabrication marker (object literal `:` OR assignment `=`).
const MARKER_RE = /source\s*[:=]\s*['"](?:placeholder|fallback|template|serp-fallback|demo|mock|sample)['"]|_estimated\s*[:=]\s*true|_fabricated\s*[:=]\s*true/i;

// Files that define a _template/_fallback helper but are intentionally NOT
// fabrication-tagged. Each entry must say WHY tagging would be wrong (would
// withhold legitimate functionality in strict mode).
const ALLOWLIST = new Map([
  ['services/digest/generator.js',
    'Internal weekly-digest email body copy. Tagged generated_by="template" (not a real-metrics fabrication); the digest is genuine generated copy, not data presented as a live measurement.'],
  ['services/search_intel/ai_visibility.js',
    '_fallbackPrompts returns UI prompt SUGGESTIONS (scaffolding the user edits), not fabricated metrics dressed as real data.'],
  ['services/growth_ops/routes.js',
    '_fallbackTarget/_fallbackLabel in /api/goals/suggest return AI-suggested goal target VALUES/LABELS for a form field (user-editable suggestions, flagged with fallback:true in the response), not fabricated metrics dressed as real measurements. Pre-existing helpers moved verbatim from server.js (which the lint never scanned).'],
  ['services/market_signals/routes.js',
    '_templateImageCache is an in-memory LRU cache (Map) memoizing AI-generated template image URLs — a performance cache, not a synthetic-when-AI-unavailable data fallback. Name matches the _template* regex only incidentally. Pre-existing helper moved verbatim from server.js (which the lint never scanned).'],
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Returns { flagged: [{file, reason}], scanned, helperFiles }.
function check() {
  const repoRoot = path.join(__dirname, '..');
  const flagged = [];
  let helperFiles = 0;
  const files = walk(SERVICES_DIR);
  for (const full of files) {
    const src = fs.readFileSync(full, 'utf8');
    if (!HELPER_RE.test(src)) continue;
    helperFiles++;
    const rel = path.relative(repoRoot, full).split(path.sep).join('/');
    if (MARKER_RE.test(src)) continue;          // tagged somewhere in the file
    if (ALLOWLIST.has(rel)) continue;           // intentionally untagged
    flagged.push({
      file: rel,
      reason: 'defines a _template*/_fallback* helper but no recognized fabrication marker (source/_estimated/_fabricated) was found — strict data-mode cannot withhold it. Tag the response or add to ALLOWLIST with a reason.',
    });
  }
  return { flagged, scanned: files.length, helperFiles };
}

module.exports = { check, ALLOWLIST, HELPER_RE, MARKER_RE };

if (require.main === module) {
  const { flagged, scanned, helperFiles } = check();
  console.log(`[fabrication-lint] scanned ${scanned} service files, ${helperFiles} with template/fallback helpers, ${ALLOWLIST.size} allowlisted.`);
  if (flagged.length) {
    console.error(`\n[fabrication-lint] ${flagged.length} file(s) FLAGGED — synthetic fallback without an honesty marker:`);
    for (const f of flagged) console.error(`  ✗ ${f.file}\n      ${f.reason}`);
    process.exit(1);
  }
  console.log('[fabrication-lint] OK — every template/fallback helper is honesty-tagged or allowlisted.');
}

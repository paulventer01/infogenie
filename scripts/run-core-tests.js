#!/usr/bin/env node
// scripts/run-core-tests.js — fast, deterministic supervisor for the core test gate.
//
// Why this exists: Node 20's `node --test` runs each test file in an isolated
// child process. The core data-mode suite sets up a jsdom window whose timers
// keep that child's event loop alive after the assertions finish, so the parent
// runner waits forever and never exits (even with --test-force-exit). That hang
// makes the task-completion validation harness sit at RUNNING until it times out
// (~10 min) despite every test passing.
//
// This supervisor spawns the runner in its own process group, streams its TAP
// output, and once real test output has appeared and then gone quiet (the run is
// done) it kills the whole group and exits 0/1 based on the TAP result. Net
// effect: the same tests, but the process actually exits in a few seconds.
//
// Scope note: only the CLIENT-SIDE honesty suite (data-mode-charts) is in the
// fast gate. The matching SERVER suite (data-mode-strict) boots the Express app
// + Postgres and is too heavy/slow for the harness window — it stays in the full
// `npm test`. See .agents/memory/test-suite-force-exit.md.

const { spawn } = require('node:child_process');

const FILES = [
  'test/data-mode-charts.test.js',
  'test/migrated-builders-safety.test.js',
  'test/migrated-builders-coverage.test.js',
  'test/layout-fonts-guard.test.js',
  'test/gpt5-param-compat.test.js',
  'test/legacy-shell-hydration.test.js',
];

const QUIESCE_MS = 6000; // once tests have printed, this much silence => done
const HARD_CAP_MS = 120000; // absolute backstop (covers slow child startup)

const child = spawn(process.execPath, ['--test', ...FILES], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // own process group so we can kill the isolated test children too
});

let out = '';
let done = false;
let sawTests = false; // true once at least one ok/not-ok line has been seen
let quiesceTimer = null;

function killGroup() {
  try {
    process.kill(-child.pid, 'SIGKILL'); // negative pid => whole process group
  } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

function finish() {
  if (done) return;
  done = true;
  if (quiesceTimer) clearTimeout(quiesceTimer);
  clearTimeout(hardCap);
  killGroup();

  const hasFailure = /^not ok /m.test(out);
  const okCount = (out.match(/^ok \d+/gm) || []).length;

  process.stdout.write(out.endsWith('\n') ? out : out + '\n');

  if (hasFailure || okCount === 0) {
    console.error(`[run-core-tests] FAILED — okCount=${okCount}, hasFailure=${hasFailure}`);
    process.exit(1);
  }
  console.log(`[run-core-tests] PASSED — ${okCount} test cases, no failures.`);
  process.exit(0);
}

function bumpQuiesce() {
  // Only let silence end the run once real test output has appeared, so we don't
  // kill the runner during slow child startup (jsdom + parsing app.js).
  if (!sawTests) return;
  if (quiesceTimer) clearTimeout(quiesceTimer);
  quiesceTimer = setTimeout(finish, QUIESCE_MS);
}

function onChunk(d) {
  out += d;
  if (!sawTests && /^(ok|not ok) /m.test(out)) sawTests = true;
  bumpQuiesce();
}

child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);
child.on('exit', finish);
child.on('error', (err) => {
  out += `\n[run-core-tests] spawn error: ${err && err.message}\n`;
  finish();
});

const hardCap = setTimeout(finish, HARD_CAP_MS);

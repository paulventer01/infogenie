'use strict';

/**
 * Promptfoo (or Confident AI) eval gate status for officer/report prompts.
 * Reads last eval results from promptfoo/results.json when present.
 */

const fs = require('fs');
const path = require('path');
const { present } = require('./env');

const ROOT = path.join(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'promptfoo', 'promptfooconfig.yaml');
const RESULTS_PATH = path.join(ROOT, 'promptfoo', 'results.json');

function promptfooConfigured() {
  return fs.existsSync(CONFIG_PATH) || present('PROMPTFOO_CONFIG') || present('CONFIDENT_API_KEY');
}

function readLastResults() {
  const p = process.env.PROMPTFOO_RESULTS_PATH || RESULTS_PATH;
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function evaluateGate(results) {
  if (!results) {
    return {
      gated: false,
      passed: null,
      pass_rate: null,
      failed: [],
      note: 'No promptfoo results yet — run `npm run eval:prompts` before promoting prompt/model changes.',
    };
  }
  const stats = results.results?.stats || results.stats || {};
  const successes = Number(stats.successes ?? results.successes ?? 0);
  const failures = Number(stats.failures ?? results.failures ?? 0);
  const total = successes + failures || Number(results.total || 0);
  const passRate = total > 0 ? successes / total : (results.passRate != null ? Number(results.passRate) : null);
  const threshold = Number(process.env.PROMPTFOO_PASS_THRESHOLD || 0.85);
  const failedCases = Array.isArray(results.failed)
    ? results.failed
    : (results.results?.results || [])
      .filter((r) => r.success === false)
      .slice(0, 10)
      .map((r) => ({
        description: r.description || r.vars?.surface || 'case',
        reason: r.error || r.gradingResult?.reason || 'failed',
      }));

  const passed = passRate == null ? null : passRate >= threshold;
  return {
    gated: true,
    passed,
    pass_rate: passRate,
    threshold,
    failed: failedCases,
    note: passed
      ? `Prompt eval gate green (${Math.round((passRate || 0) * 100)}% ≥ ${Math.round(threshold * 100)}%).`
      : passed === false
        ? `Prompt eval gate blocked promotion (${Math.round((passRate || 0) * 100)}% < ${Math.round(threshold * 100)}%).`
        : 'Prompt eval results present but pass rate unknown.',
  };
}

function collectPromptfooStatus() {
  const results = readLastResults();
  const gate = evaluateGate(results);
  return {
    configured: promptfooConfigured(),
    config_present: fs.existsSync(CONFIG_PATH),
    results_present: !!results,
    confident_ai: present('CONFIDENT_API_KEY'),
    surfaces: ['officer.brief', 'officer.daily-report', 'officer.meeting-minutes', 'governance'],
    gate,
    ok: gate.passed !== false,
    note: gate.note,
  };
}

/** Used by APIs before allowing prompt/model promotion in governance flows */
function assertPromptGateOrThrow() {
  const status = collectPromptfooStatus();
  if (process.env.PROMPTFOO_ENFORCE === '1' && status.gate.passed === false) {
    const err = new Error('promptfoo_gate_failed');
    err.status = 423;
    err.details = status.gate;
    throw err;
  }
  return status;
}

module.exports = {
  promptfooConfigured,
  readLastResults,
  evaluateGate,
  collectPromptfooStatus,
  assertPromptGateOrThrow,
  CONFIG_PATH,
  RESULTS_PATH,
};

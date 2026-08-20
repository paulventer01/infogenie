'use strict';
// test/security-guardrails.test.js — unit coverage for services/security scaffolding.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCsp,
  safeEqualString,
  validatePassword,
  MIN_LENGTH,
  createRateLimiter,
  originAllowed,
} = require('../services/security');

test('buildCsp includes frame-ancestors self and no object-src', () => {
  const csp = buildCsp();
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
});

test('safeEqualString is true for equal secrets and false otherwise', () => {
  assert.equal(safeEqualString('abc', 'abc'), true);
  assert.equal(safeEqualString('abc', 'abd'), false);
  assert.equal(safeEqualString('', 'abc'), false);
  assert.equal(safeEqualString('abc', ''), false);
  assert.equal(safeEqualString(null, 'abc'), false);
});

test('validatePassword enforces length and complexity', () => {
  assert.equal(validatePassword('short').ok, false);
  assert.equal(validatePassword('allletters').ok, false);
  assert.equal(validatePassword('1234567890').ok, false);
  const ok = validatePassword('preview123');
  assert.equal(ok.ok, true);
  assert.ok(MIN_LENGTH >= 10);
});

// The limiter resolves its verdict through a promise (Redis first, process-local
// window as the fallback), so each call has to be awaited. Asserting
// synchronously reads the counters before any verdict has landed.
test('createRateLimiter returns 429 after max', async () => {
  const lim = createRateLimiter({ name: 't', windowMs: 60_000, max: 2, keyFn: () => 'k' });
  const calls = [];
  let nextCount = 0;
  const hit = () => new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      status(code) {
        return {
          json(body) {
            calls.push({ code, body, headers: { ...headers } });
            resolve();
          },
        };
      },
    };
    try {
      lim({ path: '/x' }, res, () => { nextCount += 1; resolve(); });
    } catch (err) { reject(err); }
  });

  await hit();
  await hit();
  await hit();
  assert.equal(nextCount, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].code, 429);
  assert.equal(calls[0].body.error, 'rate_limited');
  assert.equal(calls[0].headers['Retry-After'], '60');
  lim.reset();
});

// The meeting-notes summarize route ships before transcript redaction exists.
// The disclosure below is the only thing standing between an operator and the
// assumption that transcripts are scrubbed, so it must survive edits to the rest
// of the section until the AI/LLM redaction PR actually lands.
test('the guardrails doc still discloses unredacted transcript egress', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /`POST \/api\/meeting-notes\/summarize` still sends \*\*up to 12,000 transcript characters unredacted\*\* to `api\.openai\.com`/);
  assert.match(flat, /No PII detection or masking runs on the transcript body today/);
  assert.match(flat, /Pre-transmission transcript redaction is a \*\*separate follow-up PR owned by AI\/LLM\*\*; per-tenant AI rate\/cost limiting is the PR after that\. Neither is implemented here\./);
});

test('the guardrails doc documents fail-closed backfill and observable retention', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.match(flat, /process\.exit\(1\)/);
  assert.match(flat, /meeting_notes_excerpt_retention_overdue/);
  assert.match(flat, /verifyMeetingNotesEncryption/);
  // Residuals an operator has to keep in mind stay written down.
  assert.match(flat, /`transcript_sha256` is retained after the excerpt is purged/);
  assert.match(flat, /A JSONB `null` `contact` stays `null` at rest/);
});

// The shared BOOT_TASKS loop is an unawaited IIFE, so the port is bound before
// meeting-notes verification runs. Claiming production "cannot serve traffic"
// until it passes would overstate the control and mislead an incident responder.
test('the guardrails doc does not overstate the boot gate', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/security-guardrails.md'), 'utf8');
  const flat = doc.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /cannot serve traffic/);
  assert.match(flat, /`listen` is not gated on boot-task completion/);
});

test('originAllowed accepts matching host and localhost in non-prod', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const req = { get: () => 'example.test' };
  assert.equal(originAllowed(req, 'https://example.test'), true);
  assert.equal(originAllowed(req, 'http://127.0.0.1:5000'), true);
  assert.equal(originAllowed(req, 'https://evil.example'), false);
  process.env.NODE_ENV = prev;
});

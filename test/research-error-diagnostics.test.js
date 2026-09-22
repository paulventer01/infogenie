'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sendOrchError, OrchError } = require('../services/agent_orchestrator/errors');
const { logger } = require('../services/infra/logger');

function response() {
  return { status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
}

test('unexpected research errors log only allowlisted diagnostics and preserve safe response', (t) => {
  const calls = [];
  t.mock.method(logger, 'error', (...args) => calls.push(args));
  const err = Object.assign(new Error('SECRET query token'), {
    code: '23514', detail: 'SECRET row', query: 'SECRET sql',
    stack: 'Error: SECRET\n at insert (/app/services/agent_orchestrator/research_ingest.js:597:20)',
  });
  const res = response();
  sendOrchError(res, err, { requestId: 'd0be5d0a406a1665', body: 'SECRET' });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'internal_error' });
  assert.deepEqual(calls, [['orchestrator_research_unexpected_error', {
    error_kind: 'unexpected', db_code: '23514', requestId: 'd0be5d0a406a1665',
    source: 'research_ingest.js', line: 597,
  }]]);
  assert.ok(!JSON.stringify(calls).includes('SECRET'));
});

test('untrusted codes, paths and request IDs never enter diagnostics', (t) => {
  const calls = [];
  t.mock.method(logger, 'error', (...args) => calls.push(args));
  const err = Object.assign(new TypeError('SECRET'), {
    code: 'SECRET', stack: 'SECRET\n at /private/SECRET.js:12:3',
  });
  sendOrchError(response(), err, { requestId: 'SECRET' });
  assert.deepEqual(calls[0][1], { error_kind: 'type_error', db_code: 'unclassified' });
});

test('expected denials keep status and are not unexpected-error logs', (t) => {
  t.mock.method(logger, 'error', () => assert.fail('unexpected log'));
  for (const err of [new OrchError(409, 'approval_required'), { code: 'permission_denied' }]) {
    const res = response();
    sendOrchError(res, err, {});
    assert.equal(res.body.error, err.code);
    assert.ok([403, 409].includes(res.statusCode));
  }
});

test('diagnostic sink failures cannot change the HTTP 500 response', (t) => {
  t.mock.method(logger, 'error', () => { throw new Error('sink unavailable'); });
  const res = response();
  sendOrchError(res, new Error('private'), {});
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'internal_error' });
});

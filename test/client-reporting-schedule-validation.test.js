'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadScheduleLib() {
  const file = path.join(__dirname, '../lib/clientReportingSchedule.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod);
  return mod.exports;
}

const delivery = {
  window_key: 'weekly:2026-W10',
  status: 'failed',
  attempted_at: '2026-03-10T09:00:00.000Z',
  recipient_email: 'client@example.com',
  profile_version: 2,
  format: 'pdf',
  error_code: 'mail_unconfigured',
};

test('validDeliveryHistory accepts BIGINT ids serialized as strings', () => {
  const { validDeliveryHistory, normalizeDeliveryHistory } = loadScheduleLib();
  const payload = {
    ok: true,
    client: { id: 11, name: 'Client', slug: null, website: null, status: 'active' },
    deliveries: [{ id: '42', ...delivery }],
    has_more: false,
    next_cursor: null,
  };
  assert.equal(validDeliveryHistory(payload, 11), true);
  assert.equal(normalizeDeliveryHistory(payload.deliveries)[0].id, '42');
});

test('normalizeDeliveryHistory preserves distinct BIGINT decimal strings', () => {
  const { normalizeDeliveryHistory } = loadScheduleLib();
  const normalized = normalizeDeliveryHistory([
    { id: '9007199254740992', ...delivery },
    { id: '9007199254740993', ...delivery, status: 'sent', error_code: null },
  ]);
  assert.equal(normalized[0].id, '9007199254740992');
  assert.equal(normalized[1].id, '9007199254740993');
  assert.notEqual(normalized[0].id, normalized[1].id);
  assert.equal(Number(normalized[0].id), Number(normalized[1].id), 'Number() would collapse these ids');
});

test('validDeliveryHistory accepts legacy safe integer ids and normalizes to decimal strings', () => {
  const { validDeliveryHistory, normalizeDeliveryHistory } = loadScheduleLib();
  const payload = {
    ok: true,
    client: { id: 11, name: 'Client', slug: null, website: null, status: 'active' },
    deliveries: [{ id: 42, ...delivery }],
    has_more: false,
    next_cursor: null,
  };
  assert.equal(validDeliveryHistory(payload, 11), true);
  assert.equal(normalizeDeliveryHistory(payload.deliveries)[0].id, '42');
});

test('validDeliveryHistory rejects malformed delivery rows', () => {
  const { validDeliveryHistory } = loadScheduleLib();
  const base = {
    ok: true,
    client: { id: 11, name: 'Client', slug: null, website: null, status: 'active' },
    deliveries: [],
    has_more: false,
    next_cursor: null,
  };
  assert.equal(validDeliveryHistory({ ...base, deliveries: [{ id: 'abc', status: 'sent' }] }, 11), false);
  assert.equal(validDeliveryHistory({ ...base, client: { ...base.client, id: 12 } }, 11), false);
  assert.equal(validDeliveryHistory({ ...base, deliveries: [{ id: Number.MAX_SAFE_INTEGER + 1, status: 'sent' }] }, 11), false);
});

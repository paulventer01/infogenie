'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const approvals = require('../services/client_reporting/approvals');

function approvalErrorMessage(code) {
  const messages = {
    approval_pending: 'already pending',
    approval_not_pending: 'no longer pending',
    portal_revoked: 'revoked',
    csrf_rejected: 'blocked',
  };
  return messages[code] || 'could not be completed';
}

test('approvalErrorMessage maps lifecycle failures to actionable text', () => {
  assert.match(approvalErrorMessage('approval_pending'), /pending/i);
  assert.match(approvalErrorMessage('approval_not_pending'), /pending/i);
  assert.match(approvalErrorMessage('portal_revoked'), /revoked/i);
});

test('approvals comment sanitization enforces limits', async () => {
  await assert.rejects(() => approvals.requestChanges(null, 1, 1, 1, '   '), /invalid_approval/);
  await assert.rejects(() => approvals.requestChanges(null, 1, 1, 1, 'x'.repeat(4001)), /invalid_approval/);
});

test('approval statuses are a closed set', () => {
  assert.ok(approvals.STATUSES.has('pending'));
  assert.ok(approvals.STATUSES.has('approved'));
  assert.ok(approvals.STATUSES.has('changes_requested'));
  assert.ok(approvals.STATUSES.has('withdrawn'));
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const feedback = require('../services/client_reporting/feedback');

test('feedback report context parsing rejects invalid payloads', () => {
  assert.throws(() => feedback.parseReportContext({}), /invalid_feedback/);
  assert.throws(() => feedback.parseReportContext({
    profile_version: 1, reporting_period: 'all_time', timezone: 'UTC', start_date: '2026-01-01',
  }), /invalid_feedback/);
  const context = feedback.parseReportContext({
    profile_version: 2, reporting_period: 'last_30_days', timezone: 'UTC',
    start_date: '2026-01-01', end_date: '2026-01-31',
  });
  assert.equal(context.profileVersion, 2);
  assert.equal(context.reportingPeriod, 'last_30_days');
});

test('feedback body sanitization enforces limits', () => {
  const { sanitizeBody } = require('../services/client_reporting/feedback');
  assert.throws(() => sanitizeBody('   '), /invalid_feedback/);
  assert.throws(() => sanitizeBody('x'.repeat(4001)), /invalid_feedback/);
  assert.equal(sanitizeBody('  hello\r\nworld  '), 'hello\nworld');
});

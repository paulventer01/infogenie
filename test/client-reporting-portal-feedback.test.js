'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const feedback = require('../services/client_reporting/feedback');

// Mirrors lib/clientReportingFeedback.ts — keep in sync with reportContextFromPreview / feedbackErrorMessage.
function reportContextFromPreview(preview) {
  const context = {
    profile_version: preview.profile_version,
    reporting_period: preview.reporting_period || 'all_time',
    timezone: preview.reporting_timezone || preview.reporting_dates?.timezone || 'UTC',
  };
  if (preview.reporting_dates) {
    context.start_date = preview.reporting_dates.start;
    context.end_date = preview.reporting_dates.end;
  }
  return context;
}
function feedbackErrorMessage(code) {
  const messages = {
    report_context_stale: 'reload',
    thread_resolved: 'resolved',
    portal_revoked: 'revoked',
    portal_session_expired: 'expired',
  };
  const text = messages[code] || 'could not be sent';
  return text;
}

test('reportContextFromPreview uses reporting_timezone when reporting_dates is null', () => {
  const context = reportContextFromPreview({
    profile_version: 3,
    reporting_period: 'all_time',
    reporting_timezone: 'Africa/Johannesburg',
    reporting_dates: null,
  });
  assert.equal(context.timezone, 'Africa/Johannesburg');
  assert.equal(context.reporting_period, 'all_time');
  assert.equal(context.start_date, undefined);
});

test('feedbackErrorMessage maps portal and thread failures to actionable text', () => {
  assert.match(feedbackErrorMessage('portal_revoked'), /revoked/i);
  assert.match(feedbackErrorMessage('thread_resolved'), /resolved/i);
  assert.match(feedbackErrorMessage('report_context_stale'), /reload/i);
});

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

'use strict';

const { logger } = require('../infra/logger');

// Deliberate allowlists: never serialize exception messages, SQL values,
// database details, request bodies, credentials, or complete stack traces.
const DB_CODES = new Set(['23502', '23503', '23505', '23514', '22P02',
  '42P01', '42703', '42501', '40001', '40P01', '53300', '57014', '08006']);
const FILES = ['research_api.js', 'research_ingest.js', 'research_store.js',
  'research_validate.js', 'research_runtime.js', 'research_plan.js',
  'leases.js', 'runner.js'];

function reportUnexpectedResearchError(err, context = {}) {
  try {
    const fields = { error_kind: 'unexpected', db_code: 'unclassified' };
    if (err instanceof TypeError) fields.error_kind = 'type_error';
    else if (err instanceof ReferenceError) fields.error_kind = 'reference_error';
    if (err && DB_CODES.has(err.code)) fields.db_code = err.code;
    if (typeof context.requestId === 'string' && /^[a-f0-9]{16}$/i.test(context.requestId)) {
      fields.requestId = context.requestId;
    }
    const stack = err && typeof err.stack === 'string' ? err.stack : '';
    for (const line of stack.split('\n').slice(1, 20)) {
      const match = line.match(/\/services\/agent_orchestrator\/([a-z_]+\.js):(\d{1,6}):(\d{1,6})\)?$/);
      if (match && FILES.includes(match[1])) {
        fields.source = match[1];
        fields.line = Number(match[2]);
        break;
      }
    }
    logger.error('orchestrator_research_unexpected_error', fields);
  } catch (_) { /* Diagnostics must never replace the safe HTTP response. */ }
}

module.exports = { reportUnexpectedResearchError };

'use strict';

// PR7C has a dedicated read-only surface so activation mutations are not
// reachable from delivery monitoring.
const https = require('https');
const { metaGraphVersion } = require('./meta_graph_version');

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const OBJECT_KINDS = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const FIELDS = Object.freeze({
  campaign: Object.freeze(['id', 'account_id', 'status', 'effective_status']),
  adset: Object.freeze(['id', 'account_id', 'status', 'effective_status', 'campaign_id']),
  creative: Object.freeze(['id', 'account_id']),
  ad: Object.freeze(['id', 'account_id', 'status', 'effective_status', 'campaign_id', 'adset_id', 'creative{id}']),
});
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = Object.freeze([25, 75]);
const FORBIDDEN = Object.freeze([
  'providerObjectId', 'provider_object_id', 'accountId', 'account_id', 'credentialReference',
  'credential_reference', 'url', 'apiVersion', 'api_version', 'method', 'fields', 'metrics',
  'dateRange', 'date_range', 'payload', 'body', 'query', 'queryParams',
]);

function invalid(code) { const error = new Error(code); error.code = code; throw error; }
function account(value) { return String(value || '').replace(/^act_/, ''); }
function same(a, b) { return String(a || '') === String(b || ''); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function validate(input) {
  if (!input || typeof input !== 'object') invalid('invalid_monitor_input');
  for (const key of FORBIDDEN) if (Object.hasOwn(input, key)) invalid('caller_provider_control_rejected');
  if (typeof input.accessToken !== 'string' || !input.accessToken) invalid('missing_access_token');
  if (typeof input.adAccountId !== 'string' || !input.adAccountId) invalid('missing_account_binding');
  if (!Array.isArray(input.ledgerObjects) || input.ledgerObjects.length !== 4) invalid('invalid_ledger_lineage');
  if (input.transport !== undefined && typeof input.transport !== 'function') invalid('invalid_transport');
  if (input.sleep !== undefined && typeof input.sleep !== 'function') invalid('invalid_sleep');
  const byKind = Object.create(null);
  for (const row of input.ledgerObjects) {
    if (!row || !OBJECT_KINDS.includes(row.object_kind) || byKind[row.object_kind]
      || typeof row.provider_object_id !== 'string' || !row.provider_object_id) invalid('invalid_ledger_lineage');
    byKind[row.object_kind] = row;
  }
  if (OBJECT_KINDS.some((kind) => !byKind[kind])) invalid('invalid_ledger_lineage');
  return byKind;
}

function defaultTransport(options) {
  const url = new URL(options.url);
  if (url.origin !== GRAPH_ORIGIN || options.method !== 'GET') invalid('unsafe_meta_request');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.request(url, { method: 'GET', headers: options.headers, timeout: options.timeoutMs }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > options.maxResponseBytes) { req.destroy(); finish({ oversized: true }); } else chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        if (res.statusCode >= 300 && res.statusCode < 400) return finish({ redirect: true });
        try { return finish({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (_) { return finish({ status: res.statusCode, malformed: true }); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ transportError: 'timeout' }); });
    req.on('error', () => finish({ transportError: 'unavailable' }));
    req.end();
  });
}

function retryable(response) {
  return response && (response.transportError === 'timeout' || response.status === 429 || response.status >= 500);
}
function failure(response) {
  if (response && response.status === 404) return 'missing_object';
  if (response && (response.status === 401 || response.status === 403)) return 'unauthorized_provider_response';
  if (response && response.oversized) return 'oversized_response';
  if (response && (response.malformed || response.redirect)) return 'malformed_response';
  if (retryable(response)) return 'transient_read_failure';
  return 'permanent_read_failure';
}
function status(kind, body) {
  if (kind === 'creative') return 'unchanged_non_delivering';
  const value = String(body.effective_status || body.status || '').toUpperCase();
  if (value === 'ACTIVE') return 'expected_active';
  if (kind === 'ad' && ['PENDING_REVIEW', 'PREAPPROVED', 'PENDING_BILLING_INFO'].includes(value)) return 'delivery_pending';
  if (['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'INACTIVE', 'ARCHIVED', 'DELETED', 'DISAPPROVED'].includes(value)) return 'unexpected_inactive';
  return 'unknown_provider_state';
}
function normalize(kind, response, byKind, expectedAccount, attempts, now) {
  const body = response.json;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !same(body.id, byKind[kind].provider_object_id)) {
    return Object.freeze({ object_kind: kind, observation: 'failed', failure_classification: 'malformed_response', attempts, observed_at: now });
  }
  const out = {
    object_kind: kind, observation: 'observed', delivery_classification: status(kind, body), attempts,
    account_relationship_matches: typeof body.account_id === 'string' ? account(body.account_id) === account(expectedAccount) : false,
    campaign_relationship_matches: 'not_applicable', adset_relationship_matches: 'not_applicable',
    creative_relationship_matches: 'not_applicable', observed_at: now,
  };
  if (kind === 'adset' || kind === 'ad') out.campaign_relationship_matches = same(body.campaign_id, byKind.campaign.provider_object_id);
  if (kind === 'ad') {
    out.adset_relationship_matches = same(body.adset_id, byKind.adset.provider_object_id);
    out.creative_relationship_matches = Boolean(body.creative && same(body.creative.id, byKind.creative.provider_object_id));
  }
  return Object.freeze(out);
}

async function observeMetaDelivery(input) {
  const byKind = validate(input); const transport = input.transport || defaultTransport;
  const sleep = input.sleep || delay; const now = input.now || (() => new Date().toISOString()); const observations = [];
  for (const kind of OBJECT_KINDS) {
    const url = new URL(`/${metaGraphVersion()}/${encodeURIComponent(byKind[kind].provider_object_id)}`, GRAPH_ORIGIN);
    url.searchParams.set('fields', FIELDS[kind].join(','));
    let response; let attempts = 0;
    do {
      attempts += 1;
      try {
        response = await transport({ url: url.toString(), method: 'GET', headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' }, timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES });
      } catch (_) { response = { transportError: 'unavailable' }; }
      if (attempts < MAX_ATTEMPTS && retryable(response)) await sleep(BACKOFF_MS[attempts - 1]); else break;
    } while (attempts < MAX_ATTEMPTS);
    observations.push(response && response.status >= 200 && response.status < 300 && !response.malformed && !response.oversized
      ? normalize(kind, response, byKind, input.adAccountId, attempts, now())
      : Object.freeze({ object_kind: kind, observation: 'failed', failure_classification: failure(response), attempts, observed_at: now() }));
  }
  return Object.freeze({ observations: Object.freeze(observations) });
}

module.exports = { GRAPH_ORIGIN, OBJECT_KINDS, FIELDS, TIMEOUT_MS, MAX_RESPONSE_BYTES, MAX_ATTEMPTS, BACKOFF_MS, observeMetaDelivery };

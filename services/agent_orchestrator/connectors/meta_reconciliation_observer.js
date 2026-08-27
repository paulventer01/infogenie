'use strict';

// Dedicated read surface for PR6F reconciliation. This module deliberately
// shares no transport or request builder with the Meta mutation connector.
const https = require('https');
const { metaGraphVersion } = require('./meta_graph_version');

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const OBJECT_KINDS = Object.freeze(['campaign', 'adset', 'creative', 'ad']);
const FIELDS = Object.freeze({
  campaign: Object.freeze(['account_id', 'status', 'effective_status']),
  adset: Object.freeze(['account_id', 'status', 'effective_status', 'campaign_id']),
  creative: Object.freeze(['account_id']),
  ad: Object.freeze(['account_id', 'status', 'effective_status', 'campaign_id', 'adset_id', 'creative{id}']),
});
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const FORBIDDEN_INPUTS = Object.freeze(['providerObjectId', 'provider_object_id', 'accountId', 'account_id', 'url', 'apiVersion', 'api_version', 'method', 'fields']);

function invalid(code) { const err = new Error(code); err.code = code; throw err; }
function accountId(value) { return String(value || '').replace(/^act_/, ''); }
function same(a, b) { return String(a || '') === String(b || ''); }

function validateInput(input) {
  if (!input || typeof input !== 'object') invalid('invalid_observation_input');
  for (const key of FORBIDDEN_INPUTS) if (Object.prototype.hasOwnProperty.call(input, key)) invalid('caller_provider_control_rejected');
  if (typeof input.accessToken !== 'string' || !input.accessToken) invalid('missing_access_token');
  if (!input.adAccountId) invalid('missing_account_binding');
  if (!Array.isArray(input.ledgerObjects) || input.ledgerObjects.length !== 4) invalid('invalid_ledger_lineage');
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
    const req = https.request(url, {
      method: 'GET', headers: options.headers, timeout: options.timeoutMs,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > options.maxResponseBytes) { req.destroy(); finish({ oversized: true }); }
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        const location = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400) return finish({ redirect: true, location });
        try { finish({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (_) { finish({ status: res.statusCode, malformed: true }); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ transportError: 'timeout' }); });
    req.on('error', () => finish({ transportError: 'unavailable' }));
    req.end();
  });
}

function statusClass(kind, body) {
  if (kind === 'creative') return 'not_applicable';
  const value = String(body.effective_status || body.status || '').toUpperCase();
  if (value === 'PAUSED') return 'paused';
  if (value === 'ACTIVE') return 'active';
  if (['PENDING_REVIEW', 'PREAPPROVED', 'PENDING_BILLING_INFO'].includes(value)) return 'inactive';
  if (value === 'CAMPAIGN_PAUSED' || value === 'ADSET_PAUSED' || value === 'ARCHIVED' || value === 'DELETED' || value === 'DISAPPROVED') return 'inactive';
  if (value === 'WITH_ISSUES') return 'delivering';
  return 'unknown';
}

function baseObservation(kind, now) {
  return {
    object_kind: kind, outcome: 'malformed', status_classification: kind === 'creative' ? 'not_applicable' : 'unknown',
    account_binding_matches: 'unknown', campaign_parent_matches: kind === 'campaign' ? 'not_applicable' : 'unknown',
    adset_parent_matches: kind === 'ad' ? 'unknown' : 'not_applicable',
    creative_link_matches: kind === 'ad' ? 'unknown' : 'not_applicable', observed_at: now,
  };
}

function failure(kind, response, now) {
  const out = baseObservation(kind, now);
  if (response && response.status === 404) { out.outcome = 'missing'; out.error_classification = 'not_found'; }
  else if (response && (response.status === 401 || response.status === 403)) { out.outcome = 'unauthorized'; out.error_classification = 'provider_unauthorized'; }
  else if (response && (response.status === 429 || response.status >= 500 || response.transportError)) { out.outcome = 'transient_failure'; out.error_classification = response.status === 429 ? 'rate_limited' : 'provider_unavailable'; }
  else if (response && (response.malformed || response.oversized || response.redirect)) { out.outcome = 'malformed'; out.error_classification = response.oversized ? 'response_too_large' : response.redirect ? 'redirect_rejected' : 'invalid_provider_response'; }
  else { out.outcome = 'permanent_failure'; out.error_classification = 'provider_rejected'; }
  return Object.freeze(out);
}

function normalize(kind, body, byKind, expectedAccount, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.id !== 'string'
    || !same(body.id, byKind[kind].provider_object_id)) return failure(kind, { malformed: true }, now);
  const out = baseObservation(kind, now);
  out.outcome = 'observed';
  out.status_classification = statusClass(kind, body);
  out.account_binding_matches = typeof body.account_id === 'string' ? accountId(body.account_id) === accountId(expectedAccount) : 'unknown';
  if (kind === 'adset' || kind === 'ad') out.campaign_parent_matches = typeof body.campaign_id === 'string' ? same(body.campaign_id, byKind.campaign.provider_object_id) : 'unknown';
  if (kind === 'creative') out.campaign_parent_matches = 'not_applicable';
  if (kind === 'ad') {
    out.adset_parent_matches = typeof body.adset_id === 'string' ? same(body.adset_id, byKind.adset.provider_object_id) : 'unknown';
    out.creative_link_matches = body.creative && typeof body.creative.id === 'string' ? same(body.creative.id, byKind.creative.provider_object_id) : 'unknown';
  }
  return Object.freeze(out);
}

async function observeMetaLedger(input) {
  const byKind = validateInput(input);
  const transport = input.transport || defaultTransport;
  const observations = []; let attempted = 0; let completed = 0;
  for (const kind of OBJECT_KINDS) {
    const url = new URL(`/${metaGraphVersion()}/${encodeURIComponent(byKind[kind].provider_object_id)}`, GRAPH_ORIGIN);
    url.searchParams.set('fields', FIELDS[kind].join(','));
    attempted += 1;
    let response;
    try {
      response = await transport({ url: url.toString(), method: 'GET', headers: { Authorization: `Bearer ${input.accessToken}`, Accept: 'application/json' }, timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES });
    } catch (_) { response = { transportError: 'unavailable' }; }
    const now = (input.now || (() => new Date().toISOString()))();
    const observation = response && response.status >= 200 && response.status < 300
      ? normalize(kind, response.json, byKind, input.adAccountId, now) : failure(kind, response || {}, now);
    observations.push(observation); completed += 1;
  }
  return Object.freeze({ authorization_id: input.authorizationId, ledger_reference: input.ledgerReference, attempted_observations: attempted, completed_observations: completed, observations: Object.freeze(observations) });
}

module.exports = { GRAPH_ORIGIN, OBJECT_KINDS, FIELDS, TIMEOUT_MS, MAX_RESPONSE_BYTES, observeMetaLedger };

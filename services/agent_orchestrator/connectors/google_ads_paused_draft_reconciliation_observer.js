'use strict';

// Dedicated GET-only read surface for PR10C.1. Shares no transport with the write connector.
const https = require('https');

const API_ORIGIN = 'https://googleads.googleapis.com';
const API_VERSION = 'v17';
const OBJECT_KINDS = Object.freeze(['campaign_budget', 'campaign', 'ad_group']);
const COLLECTIONS = Object.freeze({
  campaign_budget: 'campaignBudgets', campaign: 'campaigns', ad_group: 'adGroups',
});
const FIELDS = Object.freeze({
  campaign_budget: Object.freeze(['status', 'resourceName']),
  campaign: Object.freeze(['status', 'resourceName', 'campaignBudget']),
  ad_group: Object.freeze(['status', 'resourceName', 'campaign']),
});
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const LIVE_OPT_IN_ENV = 'INFOGENIE_LIVE_GOOGLE_ADS_RECONCILIATION';
const CUSTOMER_DIGITS = /^[0-9]{10}$/;
const OBJECT_ID = /^[0-9]{1,32}$/;
const FORBIDDEN_INPUTS = Object.freeze([
  'url', 'method', 'fields', 'customerId', 'customer_id', 'providerObjectId',
  'provider_object_id', 'status', 'payload', 'body', 'mutateOperations', 'operations',
]);

function invalid(code) { const err = new Error(code); err.code = code; throw err; }
function digits(value) { return String(value || '').replace(/[\s-]/g, ''); }

function validateInput(input) {
  if (!input || typeof input !== 'object') invalid('invalid_observation_input');
  for (const key of FORBIDDEN_INPUTS) {
    if (Object.hasOwn(input, key)) invalid('caller_provider_control_rejected');
  }
  const credentials = input.credentials;
  if (!credentials || typeof credentials !== 'object') invalid('missing_credentials');
  if (typeof credentials.accessToken !== 'string' || !credentials.accessToken) invalid('missing_access_token');
  if (typeof credentials.developerToken !== 'string' || !credentials.developerToken) invalid('missing_developer_token');
  const customer_id = digits(credentials.customerId);
  if (!CUSTOMER_DIGITS.test(customer_id)) invalid('invalid_account_binding');
  const login_customer_id = credentials.loginCustomerId != null ? digits(credentials.loginCustomerId) : null;
  if (login_customer_id && !CUSTOMER_DIGITS.test(login_customer_id)) invalid('invalid_account_binding');
  if (credentials.accountFingerprint != null && !/^[0-9a-f]{64}$/.test(String(credentials.accountFingerprint))) {
    invalid('invalid_account_binding');
  }
  if (input.transport !== undefined && typeof input.transport !== 'function') invalid('invalid_transport');
  if (!Array.isArray(input.ledgerObjects) || input.ledgerObjects.length !== 3) invalid('invalid_ledger_lineage');
  const byKind = Object.create(null);
  for (const row of input.ledgerObjects) {
    if (!row || !OBJECT_KINDS.includes(row.object_kind) || byKind[row.object_kind]
      || typeof row.provider_object_id !== 'string' || !OBJECT_ID.test(row.provider_object_id)) {
      invalid('invalid_ledger_lineage');
    }
    byKind[row.object_kind] = row;
  }
  if (OBJECT_KINDS.some((kind) => !byKind[kind])) invalid('invalid_ledger_lineage');
  return { byKind, customer_id, login_customer_id,
    access_token: credentials.accessToken, developer_token: credentials.developerToken };
}

function headers(bound) {
  const out = {
    Authorization: `Bearer ${bound.access_token}`,
    'developer-token': bound.developer_token,
    Accept: 'application/json',
  };
  if (bound.login_customer_id) out['login-customer-id'] = bound.login_customer_id;
  return out;
}

function defaultTransport(options) {
  const url = new URL(options.url);
  if (url.origin !== API_ORIGIN || options.method !== 'GET') invalid('unsafe_google_ads_request');
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
        if (res.statusCode >= 300 && res.statusCode < 400) return finish({ redirect: true });
        try { finish({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (_) { finish({ status: res.statusCode, malformed: true }); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ transportError: 'timeout' }); });
    req.on('error', () => finish({ transportError: 'unavailable' }));
    req.end();
  });
}

function parseResource(name, collection) {
  const match = new RegExp(`^customers/(\\d+)/${collection}/(\\d+)$`).exec(String(name || ''));
  return match ? { customer: match[1], id: match[2] } : null;
}

function statusClass(value) {
  const v = String(value || '').toUpperCase();
  if (v === 'PAUSED') return 'paused';
  if (v === 'ENABLED' || v === 'ACTIVE') return 'active';
  if (v === 'SERVING' || v === 'ELIGIBLE') return 'unsafe';
  if (v === 'REMOVED' || v === 'DELETED' || v === 'ARCHIVED' || v === 'ENDED') return 'inactive';
  return 'unknown';
}

function baseObservation(kind, now) {
  return {
    object_kind: kind, outcome: 'malformed', status_classification: 'unknown',
    account_binding_matches: 'unknown',
    campaign_parent_matches: kind === 'ad_group' ? 'unknown' : 'not_applicable',
    budget_parent_matches: kind === 'campaign' ? 'unknown' : 'not_applicable',
    observed_at: now,
  };
}

function failure(kind, response, now) {
  const out = baseObservation(kind, now);
  if (response && response.status === 404) { out.outcome = 'missing'; out.error_classification = 'not_found'; }
  else if (response && (response.status === 401 || response.status === 403)) {
    out.outcome = 'unauthorized'; out.error_classification = 'provider_unauthorized';
  } else if (response && (response.status === 429 || response.status >= 500 || response.transportError)) {
    out.outcome = 'transient_failure';
    out.error_classification = response.status === 429 ? 'rate_limited' : 'provider_unavailable';
  } else if (response && (response.malformed || response.oversized || response.redirect)) {
    out.outcome = 'malformed';
    out.error_classification = response.oversized ? 'response_too_large'
      : response.redirect ? 'redirect_rejected' : 'invalid_provider_response';
  } else { out.outcome = 'permanent_failure'; out.error_classification = 'provider_rejected'; }
  return Object.freeze(out);
}

function normalize(kind, body, bound, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.error) {
    return failure(kind, { malformed: true }, now);
  }
  const parsed = parseResource(body.resourceName, COLLECTIONS[kind]);
  if (!parsed || parsed.id !== bound.byKind[kind].provider_object_id) {
    return failure(kind, { malformed: true }, now);
  }
  const out = baseObservation(kind, now);
  out.outcome = 'observed';
  out.status_classification = statusClass(body.status);
  out.account_binding_matches = parsed.customer === bound.customer_id;
  if (kind === 'campaign') {
    const parent = parseResource(body.campaignBudget, COLLECTIONS.campaign_budget);
    out.budget_parent_matches = parent
      ? parent.id === bound.byKind.campaign_budget.provider_object_id : 'unknown';
  }
  if (kind === 'ad_group') {
    const parent = parseResource(body.campaign, COLLECTIONS.campaign);
    out.campaign_parent_matches = parent
      ? parent.id === bound.byKind.campaign.provider_object_id : 'unknown';
  }
  return Object.freeze(out);
}

async function observePausedGoogleAdsLedger(input) {
  const bound = validateInput(input);
  const transport = typeof input.transport === 'function' ? input.transport : null;
  if (!transport && !(input.allowLive === true && process.env[LIVE_OPT_IN_ENV] === '1')) {
    invalid('live_google_ads_reconciliation_disabled');
  }
  const send = transport || ((call) => defaultTransport({ ...call, headers: headers(bound) }));
  const observations = [];
  for (const kind of OBJECT_KINDS) {
    const url = new URL(
      `/${API_VERSION}/customers/${bound.customer_id}/${COLLECTIONS[kind]}/${bound.byKind[kind].provider_object_id}`,
      API_ORIGIN
    );
    url.searchParams.set('fields', FIELDS[kind].join(','));
    let response;
    try {
      response = await send({
        url: url.toString(), method: 'GET', headers: headers(bound),
        timeoutMs: TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES,
      });
    } catch (_) { response = { transportError: 'unavailable' }; }
    const now = (input.now || (() => new Date().toISOString()))();
    observations.push(response && response.status >= 200 && response.status < 300
      ? normalize(kind, response.json, bound, now) : failure(kind, response || {}, now));
  }
  return Object.freeze({
    authorization_id: input.authorizationId, ledger_reference: input.ledgerReference,
    attempted_observations: 3, completed_observations: 3,
    observations: Object.freeze(observations), serving: false,
  });
}

module.exports = {
  API_ORIGIN, API_VERSION, OBJECT_KINDS, FIELDS, TIMEOUT_MS, MAX_RESPONSE_BYTES,
  LIVE_OPT_IN_ENV, observePausedGoogleAdsLedger,
};

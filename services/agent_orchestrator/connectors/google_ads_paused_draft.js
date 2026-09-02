'use strict';

// Narrow Google Ads paused-draft connector. Builds one immutable
// googleAds:mutate create of PAUSED, non-serving objects. Callers cannot
// enable, activate, publish, schedule, launch, optimize, increase spend, or
// request a serving campaign. Default is inject-only; live Google requires an
// explicit opt-in and is never used by default tests.
//
// This module does not settle the provider-operation ledger, read the vault,
// or mount HTTP. Security owns that wrap.

const https = require('https');

const API_ORIGIN = 'https://googleads.googleapis.com';
const API_VERSION = 'v17';
const TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const PAUSED = 'PAUSED';
const OBJECT_SEQUENCE = Object.freeze(['campaign_budget', 'campaign', 'ad_group']);
const RESULT_CODES = Object.freeze({
  succeeded: 'provider_create_succeeded',
  failed: 'provider_create_failed',
  unknown: 'provider_outcome_unknown',
});
const LIVE_OPT_IN_ENV = 'INFOGENIE_LIVE_GOOGLE_ADS_PAUSED_DRAFT';
const SAFE_OP_KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_IDEM = /^[A-Za-z0-9_.:-]{1,256}$/;
const CUSTOMER_DIGITS = /^[0-9]{10}$/;
const FORBIDDEN_INPUT = Object.freeze([
  'status', 'payload', 'body', 'operations', 'mutateOperations', 'url', 'method',
  'fields', 'serving', 'enabled', 'activate', 'publish', 'schedule', 'launch',
  'optimize', 'spend', 'servingStatus', 'startDateTime', 'endDateTime',
  'campaignStatus', 'budgetIncrease', 'amount_micros_increase',
]);
const FORBIDDEN_SNAPSHOT = Object.freeze([
  'status', 'serving', 'serving_status', 'enabled', 'schedule', 'start_at',
  'end_at', 'optimize', 'launch', 'publish',
]);

function invalid(code) {
  const err = new Error(code);
  err.code = code;
  throw err;
}

function digits(value) {
  return String(value || '').replace(/[\s-]/g, '');
}

function liveOptedIn(input) {
  return input && input.allowLive === true && process.env[LIVE_OPT_IN_ENV] === '1';
}

function validate(input) {
  if (!input || typeof input !== 'object') invalid('invalid_draft_input');
  for (const key of FORBIDDEN_INPUT) {
    if (Object.hasOwn(input, key)) invalid('caller_provider_control_rejected');
  }
  const operation = input.operation;
  const credentials = input.credentials;
  const snapshot = input.snapshot;
  if (!operation || typeof operation !== 'object') invalid('invalid_operation');
  if (!SAFE_OP_KEY.test(String(operation.provider_operation_key || ''))) {
    invalid('invalid_provider_operation_key');
  }
  if (!SAFE_IDEM.test(String(operation.idempotency_key || ''))) {
    invalid('invalid_idempotency_key');
  }
  if (!credentials || typeof credentials !== 'object') invalid('missing_credentials');
  if (typeof credentials.accessToken !== 'string' || !credentials.accessToken) {
    invalid('missing_access_token');
  }
  if (typeof credentials.developerToken !== 'string' || !credentials.developerToken) {
    invalid('missing_developer_token');
  }
  if (!CUSTOMER_DIGITS.test(digits(credentials.customerId))) invalid('invalid_account_binding');
  if (credentials.loginCustomerId != null && !CUSTOMER_DIGITS.test(digits(credentials.loginCustomerId))) {
    invalid('invalid_account_binding');
  }
  if (!snapshot || typeof snapshot !== 'object') invalid('invalid_snapshot');
  for (const key of FORBIDDEN_SNAPSHOT) {
    if (Object.hasOwn(snapshot, key)) invalid('caller_provider_control_rejected');
  }
  const name = String(snapshot.name || '').trim();
  if (!name || name.length > 120) invalid('invalid_snapshot');
  const micros = Number(snapshot.budget && snapshot.budget.amount_micros);
  if (!Number.isSafeInteger(micros) || micros <= 0) invalid('invalid_snapshot');
  if (snapshot.budget && snapshot.budget.currency && String(snapshot.budget.currency) !== 'USD') {
    invalid('invalid_snapshot');
  }
  if (input.inject !== undefined) {
    if (!input.inject || typeof input.inject !== 'object' || typeof input.inject.mutate !== 'function') {
      invalid('invalid_inject');
    }
  }
  if (input.transport !== undefined && typeof input.transport !== 'function') {
    invalid('invalid_transport');
  }
  return {
    operation_key: String(operation.provider_operation_key),
    idempotency_key: String(operation.idempotency_key),
    customer_id: digits(credentials.customerId),
    login_customer_id: credentials.loginCustomerId ? digits(credentials.loginCustomerId) : null,
    access_token: credentials.accessToken,
    developer_token: credentials.developerToken,
    name,
    amount_micros: String(micros),
  };
}

function tempName(customerId, collection, tempId) {
  return `customers/${customerId}/${collection}/${tempId}`;
}

function buildPausedGoogleAdsDraftRequest(bound) {
  const budgetRn = tempName(bound.customer_id, 'campaignBudgets', '-1');
  const campaignRn = tempName(bound.customer_id, 'campaigns', '-2');
  const adGroupRn = tempName(bound.customer_id, 'adGroups', '-3');
  const label = bound.operation_key;
  const operations = Object.freeze([
    Object.freeze({
      campaignBudgetOperation: Object.freeze({
        create: Object.freeze({
          resourceName: budgetRn,
          name: `ig-paused-draft-budget-${label}`.slice(0, 255),
          amountMicros: bound.amount_micros,
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        }),
      }),
    }),
    Object.freeze({
      campaignOperation: Object.freeze({
        create: Object.freeze({
          resourceName: campaignRn,
          name: `ig-paused-draft-${label}`.slice(0, 255),
          status: PAUSED,
          advertisingChannelType: 'SEARCH',
          campaignBudget: budgetRn,
          manualCpc: Object.freeze({ enhancedCpcEnabled: false }),
          networkSettings: Object.freeze({
            targetGoogleSearch: true,
            targetSearchNetwork: false,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          }),
        }),
      }),
    }),
    Object.freeze({
      adGroupOperation: Object.freeze({
        create: Object.freeze({
          resourceName: adGroupRn,
          name: `ig-paused-draft-ag-${label}`.slice(0, 255),
          status: PAUSED,
          campaign: campaignRn,
          type: 'SEARCH_STANDARD',
        }),
      }),
    }),
  ]);
  const payload = Object.freeze({
    mutateOperations: operations,
    partialFailure: false,
    validateOnly: false,
  });
  return Object.freeze({
    url: `${API_ORIGIN}/${API_VERSION}/customers/${bound.customer_id}/googleAds:mutate`,
    method: 'POST',
    body: payload,
    timeoutMs: TIMEOUT_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    provider_operation_key: bound.operation_key,
    idempotency_key: bound.idempotency_key,
  });
}

function assertAuthorizedPausedShape(request) {
  if (!request || request.method !== 'POST') invalid('unsafe_google_ads_request');
  let parsed;
  try { parsed = new URL(request.url); } catch (_e) { invalid('unsafe_google_ads_request'); }
  if (parsed.origin !== API_ORIGIN) invalid('unsafe_google_ads_request');
  if (!parsed.pathname.endsWith('/googleAds:mutate')) invalid('unsafe_google_ads_request');
  const payload = request.body;
  if (!payload || payload.validateOnly !== false || payload.partialFailure !== false) {
    invalid('unsafe_google_ads_request');
  }
  const ops = payload.mutateOperations;
  if (!Array.isArray(ops) || ops.length !== 3) invalid('unsafe_google_ads_request');
  const campaign = ops[1] && ops[1].campaignOperation && ops[1].campaignOperation.create;
  const adGroup = ops[2] && ops[2].adGroupOperation && ops[2].adGroupOperation.create;
  if (!campaign || campaign.status !== PAUSED) invalid('serving_request_rejected');
  if (!adGroup || adGroup.status !== PAUSED) invalid('serving_request_rejected');
  const serialized = JSON.stringify(payload);
  if (/\bENABLED\b|\bSERVING\b|\bACTIVATE\b|\bPUBLISH\b|\bLAUNCH\b/.test(serialized)) {
    invalid('serving_request_rejected');
  }
  if (/"update"|"remove"|"promote"|startDateTime|endDateTime|servingStatus/.test(serialized)) {
    invalid('serving_request_rejected');
  }
  return request;
}

function headers(bound) {
  const out = {
    Authorization: `Bearer ${bound.access_token}`,
    'developer-token': bound.developer_token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (bound.login_customer_id) out['login-customer-id'] = bound.login_customer_id;
  return out;
}

function defaultTransport(options) {
  const url = new URL(options.url);
  if (url.origin !== API_ORIGIN || options.method !== 'POST') invalid('unsafe_google_ads_request');
  const body = JSON.stringify(options.body);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.request(url, {
      method: 'POST',
      headers: { ...options.headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: options.timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > options.maxResponseBytes) {
          req.destroy();
          finish({ oversized: true, mayHaveActed: true });
        } else chunks.push(chunk);
      });
      res.on('end', () => {
        if (settled) return;
        if (res.statusCode >= 300 && res.statusCode < 400) {
          return finish({ redirect: true });
        }
        try {
          return finish({
            status: res.statusCode,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (_e) {
          return finish({ status: res.statusCode, malformed: true, mayHaveActed: true });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ transportError: 'timeout', mayHaveActed: true }); });
    req.on('error', () => finish({ transportError: 'unavailable', mayHaveActed: true }));
    req.end(body);
  });
}

function projectId(resourceName, kind) {
  const suffix = {
    campaign_budget: /\/campaignBudgets\/(\d+)$/,
    campaign: /\/campaigns\/(\d+)$/,
    ad_group: /\/adGroups\/(\d+)$/,
  }[kind];
  const match = suffix && suffix.exec(String(resourceName || ''));
  return match ? match[1] : null;
}

function freezeObjects(list) {
  return Object.freeze(list.map((row) => Object.freeze({ ...row })));
}

function result(fields) {
  return Object.freeze({
    published: false,
    activated: false,
    serving: false,
    retry: false,
    ...fields,
  });
}

function failed(bound, extra) {
  return result({
    ok: false,
    result_code: RESULT_CODES.failed,
    objects: freezeObjects([]),
    objects_created: 0,
    external_action_taken: false,
    requires_reconciliation: false,
    provider_operation_key: bound.operation_key,
    idempotency_key: bound.idempotency_key,
    ...extra,
  });
}

function unknown(bound, extra) {
  return result({
    ok: false,
    result_code: RESULT_CODES.unknown,
    objects: freezeObjects([]),
    objects_created: 0,
    external_action_taken: false,
    requires_reconciliation: true,
    provider_operation_key: bound.operation_key,
    idempotency_key: bound.idempotency_key,
    ...extra,
  });
}

function classifyFailure(res) {
  if (res && res.transportError && res.mayHaveActed !== false) return 'unknown';
  if (res && (res.malformed || res.oversized) && res.mayHaveActed) return 'unknown';
  if (res && res.status >= 500) return 'unknown';
  if (res && (res.transportError || res.status >= 500)) return 'unknown';
  return 'failed';
}

function parseSuccess(res) {
  if (!res || res.status < 200 || res.status >= 300 || !res.json || typeof res.json !== 'object') {
    return null;
  }
  if (res.json.error) return null;
  const rows = res.json.mutateOperationResponses;
  if (!Array.isArray(rows) || rows.length !== 3) return null;
  const kinds = OBJECT_SEQUENCE;
  const keys = ['campaignBudgetResult', 'campaignResult', 'adGroupResult'];
  const objects = [];
  for (let i = 0; i < 3; i += 1) {
    const resourceName = rows[i] && rows[i][keys[i]] && rows[i][keys[i]].resourceName;
    const id = projectId(resourceName, kinds[i]);
    if (!id) return null;
    objects.push({
      object_kind: kinds[i],
      provider_object_id: id,
      provider_status: PAUSED,
      sequence_number: i + 1,
    });
  }
  return objects;
}

/**
 * Create PAUSED, non-serving Google Ads draft objects. One mutate, no retries.
 * Provider rejection is determinate. Timeout/transport ambiguity is unknown
 * and requires reconciliation.
 */
async function createPausedGoogleAdsDraft(input) {
  const bound = validate(input);
  const request = assertAuthorizedPausedShape(buildPausedGoogleAdsDraftRequest(bound));
  const mutate = input.inject && typeof input.inject.mutate === 'function'
    ? input.inject.mutate
    : (typeof input.transport === 'function' ? input.transport : null);
  if (!mutate && !liveOptedIn(input)) invalid('live_google_ads_disabled');
  const send = mutate || ((call) => defaultTransport({
    ...call,
    headers: headers(bound),
  }));

  let res;
  try {
    res = await send(request);
  } catch (_err) {
    return unknown(bound);
  }
  if (!res) return unknown(bound);
  if (res.transportError || res.malformed || res.oversized) {
    return classifyFailure(res) === 'unknown' ? unknown(bound) : failed(bound);
  }
  if (res.redirect) return failed(bound);
  if (!res.status || res.status < 200 || res.status >= 300 || (res.json && res.json.error)) {
    if (res.status >= 500) return unknown(bound);
    return failed(bound);
  }
  const objects = parseSuccess(res);
  if (!objects) return unknown(bound);
  return result({
    ok: true,
    result_code: RESULT_CODES.succeeded,
    objects: freezeObjects(objects),
    objects_created: objects.length,
    external_action_taken: true,
    requires_reconciliation: false,
    provider_operation_key: bound.operation_key,
    idempotency_key: bound.idempotency_key,
  });
}

module.exports = {
  API_ORIGIN,
  API_VERSION,
  TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  PAUSED,
  OBJECT_SEQUENCE,
  RESULT_CODES,
  LIVE_OPT_IN_ENV,
  FORBIDDEN_INPUT,
  buildPausedGoogleAdsDraftRequest,
  assertAuthorizedPausedShape,
  createPausedGoogleAdsDraft,
};

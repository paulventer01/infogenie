'use strict';

/**
 * PR3B-1 research-connector runtime.
 *
 * Frozen acceptance (also in the PR body):
 * - Tenant A cannot start/read/cancel/modify Tenant B runs or evidence.
 * - Missing credentials / unsupported capabilities fail closed with no network.
 * - Retries and duplicate deliveries do not create duplicate evidence.
 * - Cancellation and lost leases prevent later stale writes.
 * - Provider URLs/redirects cannot bypass services/security/safe_url.js.
 * - Raw provider bodies, credentials and secret-like values stay out of logs
 *   and stored errors.
 * - HTTP 429 honours Retry-After and stops after a bounded retry budget.
 * - Pagination tokens and payloads satisfy PR3A contracts.
 * - Partial failures are recoverable and observable.
 * - Meta / Google / TikTok have fixture-backed adapter tests.
 * - Live-provider tests are env-gated and skip without credentials.
 * - Existing tenant, permission, approval, credit and PR3A retention
 *   protections stay enabled.
 * No campaign publishing, mutation, creative generation or finished video.
 */

const C = require('./research_contracts');
const { assertConnectorRequest, assertConnectorResult } = require('./research_connector');
const { connectorErrorPage } = require('./research_errors');
const { resolveResearchCredential, assertOwnedRef } = require('./research_auth');
const { defaultTransport } = require('./connectors/transport');

const MAX_RETRIES = 3;
const RUN_DEADLINE_MS = 60_000;
const BACKOFF_BASE_MS = 200;
const BACKOFF_MAX_MS = 4_000;

const CAPABILITY_MATRIX = Object.freeze({
  meta_research: Object.freeze({
    platform: 'meta',
    supported: Object.freeze(['ad_library']),
    unsupported: Object.freeze([
      'ads_transparency_center', 'keyword_planner', 'public_profile',
      'competitor_account_access', 'campaign_publish', 'campaign_mutate',
    ]),
    documented: 'Meta Ad Library Graph ads_archive',
    live: 'PR3B-2',
  }),
  google_research: Object.freeze({
    platform: 'google',
    supported: Object.freeze(['ads_transparency_center']),
    unsupported: Object.freeze([
      'ad_library', 'keyword_planner', 'public_profile',
      'competitor_account_access', 'campaign_publish', 'campaign_mutate',
    ]),
    documented: 'Google Ads Transparency Center (approved export / fixture)',
    live: 'PR3B-3',
  }),
  tiktok_research: Object.freeze({
    platform: 'tiktok',
    supported: Object.freeze(['public_profile']),
    unsupported: Object.freeze([
      'ad_library', 'ads_transparency_center', 'keyword_planner',
      'competitor_account_access', 'campaign_publish', 'campaign_mutate',
    ]),
    documented: 'TikTok Commercial Content Library API',
    live: 'PR3B-4',
  }),
});

function defaultConnectors() {
  return {
    meta_research: require('./connectors/meta_research'),
    google_research: require('./connectors/google_research'),
    tiktok_research: require('./connectors/tiktok_research'),
  };
}

function sleepMs(ms, signal, sleepFn) {
  if (sleepFn) return sleepFn(ms, signal);
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(t);
      reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
    }, { once: true });
  });
}

function backoffMs(attempt, retryAfterMs, random) {
  if (retryAfterMs != null && Number.isFinite(Number(retryAfterMs))) {
    return Math.min(Number(retryAfterMs), 30_000);
  }
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** attempt));
  const jitter = Math.floor((random || Math.random)() * exp * 0.25);
  return exp + jitter;
}

function createResearchRuntime(deps = {}) {
  const connectors = deps.connectors || defaultConnectors();
  const transport = deps.transport || null;
  const now = deps.now || (() => Date.now());
  const random = deps.random || Math.random;
  const sleep = deps.sleep || null;
  const mode = deps.mode || 'fixture';
  const resolveSecret = deps.resolveSecret || (mode === 'fixture'
    ? async ({ credentialRef, userId }) => (assertOwnedRef(credentialRef, userId).ok ? 'fixture-token' : null)
    : null);

  function capabilities(connectorId) {
    const c = connectors[connectorId];
    if (!c) return { ok: false, error: 'connector_unavailable', error_code: 'connector_unavailable' };
    return { ok: true, ...c.capabilities(), matrix: CAPABILITY_MATRIX[connectorId] };
  }

  async function fetchPage(input, opts = {}) {
    const started = now();
    const deadline = started + (opts.deadlineMs != null ? opts.deadlineMs : RUN_DEADLINE_MS);
    const req = assertConnectorRequest(input, { tenantId: opts.tenantId });
    const connector = connectors[req.connector_id];
    if (!connector) {
      return assertConnectorResult(connectorErrorPage('terminal', 'connector_unavailable', {
        connector_id: req.connector_id,
        contract_version: 'v1',
      }));
    }
    const signal = opts.signal;
    if (signal && signal.aborted) {
      return assertConnectorResult(connectorErrorPage('terminal', 'cancelled'));
    }
    const auth = await resolveResearchCredential({
      connectorId: req.connector_id,
      credentialRef: opts.credentialRef,
      userId: opts.userId,
      resolveSecret,
    });
    if (!auth.ok) {
      const code = auth.error_code || auth.error;
      const failCode = code === 'connector_unavailable' ? 'terminal' : 'auth_failure';
      return assertConnectorResult(connectorErrorPage(failCode, code, {
        connector_id: req.connector_id,
        connector_version: connector.version,
        contract_version: 'v1',
      }));
    }
    let attempt = 0;
    let last = null;
    while (attempt <= MAX_RETRIES) {
      if (signal && signal.aborted) {
        return assertConnectorResult(connectorErrorPage('terminal', 'cancelled'));
      }
      if (now() >= deadline) {
        return assertConnectorResult(connectorErrorPage('transient', 'run_deadline', {
          continuation_state: req.continuation_state,
        }));
      }
      last = await connector.fetchPage(req, {
        tenantId: req.tenant_id,
        token: auth.token,
        transport: transport || (mode === 'live' ? defaultTransport : null),
        injected: !!transport,
        mode,
        signal,
        operation: opts.operation,
      });
      last = assertConnectorResult(last, { tenantId: req.tenant_id });
      if (last.ok === true) return last;
      if (last.retry_class !== 'retryable' || attempt === MAX_RETRIES) return last;
      const wait = backoffMs(attempt, last.retry_after_ms, random);
      attempt += 1;
      try {
        await sleepMs(wait, signal, sleep);
      } catch (err) {
        if (err && err.code === 'cancelled') {
          return assertConnectorResult(connectorErrorPage('terminal', 'cancelled'));
        }
        throw err;
      }
    }
    return last;
  }

  return {
    capabilities,
    fetchPage,
    connectors,
    mode,
  };
}

module.exports = {
  CAPABILITY_MATRIX,
  MAX_RETRIES,
  RUN_DEADLINE_MS,
  createResearchRuntime,
  defaultConnectors,
};

'use strict';

const { URL } = require('url');
const C = require('../research_contracts');
const { assertConnectorRequest, assertConnectorResult } = require('../research_connector');
const { connectorErrorPage, containsCredentialMaterial } = require('../research_errors');
const { stampPageHonesty, assertPageHonesty } = require('../research_honesty');
const { createResearchAdapter, UNSUPPORTED_ALWAYS } = require('./factory');
const {
  hostAllowed,
  defaultTransport,
  REQUEST_TIMEOUT_MS,
  MAX_BODY_BYTES,
} = require('./transport');
const { logger } = require('../../infra/logger');

const CONNECTOR_ID = 'tiktok_research';
const CONNECTOR_VERSION = '1.0.0';
const ADLIB_HOST = 'open.tiktokapis.com';
const ADLIB_PATH = '/v2/research/adlib/ad/query/';
const ADLIB_URL = `https://${ADLIB_HOST}${ADLIB_PATH}`;
const DEFAULT_LIMIT = 25;
const VENDOR_MAX_COUNT = 50;
const DUMMY_KEY = /^_DUMMY/i;
const ISO2 = /^[A-Z]{2}$/;
const YMD8 = /^\d{8}$/;

const ADLIB_FIELDS = Object.freeze([
  'ad.id',
  'ad.first_shown_date',
  'ad.last_shown_date',
  'ad.title',
  'ad.external_url',
  'advertiser.business_id',
  'advertiser.business_name',
  'advertiser.country_code',
]);

const fixtureAdapter = createResearchAdapter({
  id: CONNECTOR_ID,
  version: CONNECTOR_VERSION,
  platform: 'tiktok',
  capability: 'public_profile',
  unsupported: ['ad_library', 'ads_transparency_center', 'keyword_planner'],
  allowLive: true,
  host: ADLIB_HOST,
  path: ADLIB_PATH,
  method: 'POST',
  page: require('../fixtures/research/tiktok.v1.json'),
});

function ident(req) {
  return {
    connector_id: CONNECTOR_ID,
    connector_version: CONNECTOR_VERSION,
    contract_version: 'v1',
    continuation_state: req && req.continuation_state ? req.continuation_state : {},
  };
}

function logLiveFailure(req, errorCode) {
  try {
    logger.info('tiktok_research_live_failed', {
      tenant_id: req && req.tenant_id,
      error_code: String(errorCode || 'unknown').slice(0, 64),
    });
  } catch (_) { /* never throw from logs */ }
}

function failPage(code, message, req, extra) {
  logLiveFailure(req, message || code);
  return assertConnectorResult(connectorErrorPage(code, message, { ...ident(req), ...(extra || {}) }));
}

function clip(value, max) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function safeCopy(value, max) {
  const clipped = clip(value, max);
  if (!clipped) return '';
  return containsCredentialMaterial(clipped) ? '' : clipped;
}

function isoCountry(value) {
  const s = clip(value, C.LIMITS.country.max);
  if (!s) return null;
  const up = s.toUpperCase();
  return ISO2.test(up) ? up : null;
}

function dateYyyymmdd(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (YMD8.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function ymdUtc(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function publishedRange(lookbackDays, now) {
  if (!lookbackDays) return null;
  const end = now != null ? new Date(now) : new Date();
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - Number(lookbackDays) * 86400000);
  return { min: ymdUtc(start), max: ymdUtc(end) };
}

function maxCount(maxResults) {
  const n = Number(maxResults);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(VENDOR_MAX_COUNT, Math.max(1, Math.floor(n)));
}

function bindId(researchRunId, stableId) {
  return `${researchRunId}:${stableId}`.slice(0, C.LIMITS.id.max);
}

function bindTikTokCursor(tenantId, researchRunId, searchId, firstAdId) {
  if (searchId == null || searchId === '') return null;
  const token = Buffer.from(JSON.stringify({
    v: 1,
    t: Number(tenantId),
    r: String(researchRunId),
    s: String(searchId),
    f: firstAdId ? String(firstAdId) : '',
  }), 'utf8').toString('base64url');
  if (token.length > C.LIMITS.cursor.max) return null;
  if (containsCredentialMaterial(token)) return null;
  return token;
}

function unbindTikTokCursor(cursor, tenantId, researchRunId) {
  if (cursor == null || cursor === '') return { ok: true, searchId: null, firstAdId: '' };
  if (typeof cursor !== 'string' || cursor.length > C.LIMITS.cursor.max) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (containsCredentialMaterial(cursor)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (_) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (!parsed || parsed.v !== 1 || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (Number(parsed.t) !== Number(tenantId) || String(parsed.r) !== String(researchRunId)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (typeof parsed.s !== 'string' || !parsed.s || parsed.s.length > C.LIMITS.cursor.max) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (containsCredentialMaterial(parsed.s)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  const firstAdId = typeof parsed.f === 'string' ? clip(parsed.f, C.LIMITS.provider_external_id.max) : '';
  if (firstAdId && containsCredentialMaterial(firstAdId)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  return { ok: true, searchId: parsed.s, firstAdId };
}

function mapVendorCode(code, extra) {
  const s = String(code || '').trim();
  if (!s || s.toLowerCase() === 'ok') return null;
  if (/rate_limit|too_many|quota/i.test(s)) {
    return connectorErrorPage('rate_limit', 'provider_rate_limit', extra);
  }
  if (/access_token|unauthorized|unauthenticated|invalid_access|expired_token|invalid_client/i.test(s)) {
    return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  }
  if (/permission|scope|forbidden|not_authorized/i.test(s)) {
    return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  }
  if (/invalid|validation|bad_request|param/i.test(s)) {
    return connectorErrorPage('invalid_response', 'provider_validation_failed', extra);
  }
  return connectorErrorPage('invalid_response', 'unmapped_provider_error', extra);
}

function mapTikTokHttpError({ status, json, retryAfterMs, rate_limit, ident: extra } = {}) {
  const opts = { ...(extra || {}), rate_limit: rate_limit || null };
  if (retryAfterMs != null) opts.retry_after_ms = retryAfterMs;
  if (status === 429) return connectorErrorPage('rate_limit', 'provider_rate_limit', opts);
  if (status === 401) return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  if (status === 403) return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  if (status === 400) return connectorErrorPage('invalid_response', 'provider_validation_failed', extra);
  if (status === 408) return connectorErrorPage('transient', 'provider_unavailable', extra);
  if (status >= 500) return connectorErrorPage('transient', 'provider_unavailable', extra);
  const err = json && json.error && typeof json.error === 'object' ? json.error : null;
  const mapped = mapVendorCode(err && err.code, opts);
  if (mapped) return mapped;
  const msg = err && String(err.message || '');
  if (/rate|too many|quota/i.test(msg)) return connectorErrorPage('rate_limit', 'provider_rate_limit', opts);
  if (/permission|scope|forbidden/i.test(msg)) {
    return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  }
  if (/unauthorized|access.?token/i.test(msg)) {
    return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  }
  return connectorErrorPage('invalid_response', 'unmapped_provider_error', extra);
}

function buildAdlibUrl() {
  const url = new URL(ADLIB_URL);
  url.searchParams.set('fields', ADLIB_FIELDS.join(','));
  return url.toString();
}

function buildAdlibBody({
  query, countries, lookbackDays, maxResults, searchId, now,
} = {}) {
  const body = {
    search_term: String(query || '').slice(0, C.LIMITS.search_query.max),
    max_count: maxCount(maxResults),
  };
  if (searchId) body.search_id = String(searchId);
  const filters = {};
  if (Array.isArray(countries) && countries.length === 1) {
    const iso = isoCountry(countries[0]);
    if (iso) filters.country_code = iso;
  }
  const range = publishedRange(lookbackDays, now);
  if (range) filters.ad_published_date_range = range;
  if (Object.keys(filters).length) body.filters = filters;
  return body;
}

function rejectCapability(req, ctx) {
  const operation = String((ctx && ctx.operation) || 'public_profile');
  const caps = fixtureAdapter.capabilities();
  if (UNSUPPORTED_ALWAYS.includes(operation) || caps.unsupported.includes(operation) || operation !== 'public_profile') {
    return connectorErrorPage('policy_rejection', 'capability_not_supported', ident(req));
  }
  return null;
}

function isMore(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function nestedOrFlat(row, nestedKey, flatKey) {
  if (row && row.ad && row.ad[nestedKey] != null) return row.ad[nestedKey];
  if (row && row[flatKey] != null) return row[flatKey];
  return null;
}

function advertiserOf(row) {
  return row && row.advertiser && typeof row.advertiser === 'object' && !Array.isArray(row.advertiser)
    ? row.advertiser
    : null;
}

function normalizeAdlibPage(json, req, opts) {
  const captured = (opts && opts.capturedAt) || new Date().toISOString();
  const requestedGeo = (opts && Array.isArray(opts.countries) && opts.countries.length === 1)
    ? isoCountry(opts.countries[0])
    : null;
  const ads = json && json.data && Array.isArray(json.data.ads) ? json.data.ads : [];
  const competitorsByAdv = new Map();
  const evidence = [];
  let firstAdId = '';

  for (const row of ads) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const adId = clip(nestedOrFlat(row, 'id', 'id'), C.LIMITS.provider_external_id.max);
    const adv = advertiserOf(row);
    const advertiserId = clip(
      (adv && adv.business_id != null) ? adv.business_id : row.advertiser_id,
      C.LIMITS.provider_advertiser_id.max
    );
    if (!adId || !advertiserId) continue;
    if (!firstAdId) firstAdId = adId;

    const vendorGeo = isoCountry(adv && adv.country_code);
    const geo = vendorGeo || requestedGeo;
    const name = safeCopy(adv && adv.business_name, C.LIMITS.normalized_name.max) || advertiserId;
    if (!competitorsByAdv.has(advertiserId)) {
      competitorsByAdv.set(advertiserId, {
        id: bindId(req.research_run_id, advertiserId),
        tenant_id: req.tenant_id,
        research_run_id: req.research_run_id,
        platform: 'tiktok',
        provider_advertiser_id: advertiserId,
        normalized_name: name,
        canonical_url: `https://library.tiktok.com/ads?advertiser=${encodeURIComponent(advertiserId)}`,
        country: geo,
        market: geo,
        discovery_source: 'public_profile',
        captured_at: captured,
        contract_version: 'v1',
      });
    }

    const headline = safeCopy(nestedOrFlat(row, 'title', 'title'), C.LIMITS.headline.max);
    evidence.push({
      id: bindId(req.research_run_id, adId),
      tenant_id: req.tenant_id,
      research_run_id: req.research_run_id,
      competitor_id: bindId(req.research_run_id, advertiserId),
      platform: 'tiktok',
      source_type: 'public_video',
      provider_external_id: adId,
      canonical_source_url: `https://library.tiktok.com/ads?id=${encodeURIComponent(adId)}`,
      advertiser_name: safeCopy((adv && adv.business_name) || name, C.LIMITS.advertiser_name.max),
      creative_format: 'unknown',
      headline,
      body_text: '',
      excerpt: headline,
      provider_started_on: dateYyyymmdd(nestedOrFlat(row, 'first_shown_date', 'first_shown_date')),
      provider_ended_on: dateYyyymmdd(nestedOrFlat(row, 'last_shown_date', 'last_shown_date')),
      captured_at: captured,
      market: geo,
      language: null,
      placement: null,
      provider_metrics: { source: 'live' },
      metrics_kind: 'estimated',
      provenance_method: 'ad_library',
      connector_id: CONNECTOR_ID,
      connector_version: CONNECTOR_VERSION,
      contract_version: 'v1',
      retention_class: 'standard',
    });
  }

  const searchId = json && json.data && json.data.search_id != null ? String(json.data.search_id) : '';
  const hasMore = isMore(json && json.data && json.data.has_more) && !!searchId;
  const next_cursor = hasMore ? bindTikTokCursor(req.tenant_id, req.research_run_id, searchId, firstAdId) : null;
  return {
    ok: true,
    contract_version: 'v1',
    connector_id: CONNECTOR_ID,
    connector_version: CONNECTOR_VERSION,
    competitors: [...competitorsByAdv.values()],
    evidence,
    assets: [],
    page: { next_cursor, has_more: !!next_cursor },
    continuation_state: { honesty_class: 'live', cursor: next_cursor },
    rate_limit: (opts && opts.rate_limit) || null,
    retry_class: 'none',
    _search_id: searchId,
    _first_ad_id: firstAdId,
  };
}

function liveErrorFromHop(hop, req) {
  if (!hop) return failPage('transient', 'provider_unavailable', req);
  if (hop.ok === false && hop.errorPage) {
    logLiveFailure(req, hop.errorPage.message || hop.errorPage.error);
    return assertConnectorResult(hop.errorPage);
  }
  if (hop.oversized) return failPage('invalid_response', 'oversized_provider_response', req);
  const status = hop.status;
  const json = hop.json;
  if (status === 401 || status === 403 || status === 400 || status === 408 || status === 429 || (status && status >= 500)) {
    const mapped = mapTikTokHttpError({
      status, json, retryAfterMs: hop.retryAfterMs, rate_limit: hop.rate_limit, ident: ident(req),
    });
    logLiveFailure(req, mapped.message || mapped.error);
    return assertConnectorResult(mapped);
  }
  if (hop.malformed || (status === 200 && json == null)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  const errCode = json.error && json.error.code;
  if (errCode != null && String(errCode).toLowerCase() !== 'ok') {
    const mapped = mapTikTokHttpError({
      status: status || 200, json, retryAfterMs: hop.retryAfterMs, rate_limit: hop.rate_limit, ident: ident(req),
    });
    logLiveFailure(req, mapped.message || mapped.error);
    return assertConnectorResult(mapped);
  }
  if (!json.data || typeof json.data !== 'object' || Array.isArray(json.data)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  if (json.data.ads != null && !Array.isArray(json.data.ads)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  return null;
}

function finalizeLive(raw, req) {
  const stamped = stampPageHonesty(raw, 'live');
  assertPageHonesty({ mode: 'live', page: stamped });
  return assertConnectorResult(stamped, { tenantId: req.tenant_id });
}

async function fetchLivePage(input, ctx) {
  const req = assertConnectorRequest(input, { tenantId: ctx && ctx.tenantId });
  const denied = rejectCapability(req, ctx);
  if (denied) {
    logLiveFailure(req, 'capability_not_supported');
    return assertConnectorResult(denied);
  }
  if (!ctx || ctx.token == null || ctx.token === '' || DUMMY_KEY.test(String(ctx.token))) {
    return failPage('auth_failure', 'missing_credentials', req);
  }
  if (ctx.signal && ctx.signal.aborted) return failPage('terminal', 'cancelled', req);

  const query = req.search_parameters && req.search_parameters.query;
  if (!query) return failPage('policy_rejection', 'search_query_required', req);

  const unbound = unbindTikTokCursor(req.cursor, req.tenant_id, req.research_run_id);
  if (!unbound.ok) return failPage('invalid_response', 'invalid_pagination_cursor', req);

  const requestedCountries = (req.search_parameters.countries && req.search_parameters.countries.length)
    ? req.search_parameters.countries
    : [];
  const url = buildAdlibUrl();
  let hostname;
  try { hostname = new URL(url).hostname; } catch (_) {
    return failPage('policy_rejection', 'unsafe_url', req);
  }
  if (!hostAllowed(CONNECTOR_ID, hostname)) {
    return failPage('policy_rejection', 'host_not_allowlisted', req);
  }

  const transport = ctx.transport || defaultTransport;
  const body = buildAdlibBody({
    query,
    countries: requestedCountries,
    lookbackDays: req.search_parameters.lookback_days,
    maxResults: req.search_parameters.max_results_per_page,
    searchId: unbound.searchId,
    now: ctx.now,
  });

  let hop;
  try {
    hop = await transport({
      connectorId: CONNECTOR_ID,
      url,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
      body: JSON.stringify(body),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs || REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
    });
  } catch (err) {
    if (err && (err.code === 'cancelled' || String(err.message || '') === 'cancelled')) {
      return failPage('terminal', 'cancelled', req);
    }
    return failPage('transient', 'provider_unavailable', req);
  }

  const mapped = liveErrorFromHop(hop, req);
  if (mapped) return mapped;

  const raw = normalizeAdlibPage(hop.json, req, {
    capturedAt: (ctx.now != null ? new Date(ctx.now) : new Date()).toISOString(),
    countries: requestedCountries,
    rate_limit: hop.rate_limit || null,
  });
  if (unbound.searchId && raw._search_id && raw._search_id === unbound.searchId) {
    return failPage('invalid_response', 'repeated_continuation_token', req);
  }
  if (unbound.firstAdId && raw._first_ad_id && raw._first_ad_id === unbound.firstAdId) {
    return failPage('invalid_response', 'repeated_continuation_token', req);
  }
  delete raw._search_id;
  delete raw._first_ad_id;
  return finalizeLive(raw, req);
}

async function fetchPage(input, ctx) {
  const mode = String((ctx && ctx.mode) || 'fixture');
  if (mode !== 'live') {
    return fixtureAdapter.fetchPage(input, { ...ctx, mode: 'fixture' });
  }
  return fetchLivePage(input, ctx);
}

module.exports = {
  id: fixtureAdapter.id,
  version: fixtureAdapter.version,
  platform: fixtureAdapter.platform,
  capabilities: fixtureAdapter.capabilities,
  fetchPage,
  bindTikTokCursor,
  unbindTikTokCursor,
  mapTikTokHttpError,
  ADLIB_FIELDS,
  ADLIB_URL,
  ADLIB_HOST,
  ADLIB_PATH,
  buildAdlibUrl,
  buildAdlibBody,
  normalizeAdlibPage,
};

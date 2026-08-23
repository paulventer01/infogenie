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

const CONNECTOR_ID = 'google_research';
const CONNECTOR_VERSION = '1.0.0';
const ADVERTISERS_URL = 'https://api.dataforseo.com/v3/serp/google/ads_advertisers/live/advanced';
const ADS_SEARCH_URL = 'https://api.dataforseo.com/v3/serp/google/ads_search/live/advanced';
const HISTORICAL_MIN = '2018-05-31';
const DEPTH_CAP = 40;
const DEFAULT_DEPTH = 25;
const MAX_ADVERTISER_IDS = 25;
const ATC_HOST = 'adstransparency.google.com';
const DUMMY_KEY = /^_DUMMY/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const LOCATION_CODES = Object.freeze({
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
});

const fixtureAdapter = createResearchAdapter({
  id: CONNECTOR_ID,
  version: CONNECTOR_VERSION,
  platform: 'google',
  capability: 'ads_transparency_center',
  unsupported: ['ad_library', 'keyword_planner', 'public_profile'],
  allowLive: true,
  host: 'api.dataforseo.com',
  path: '/v3/serp/google/ads_search/live/advanced',
  method: 'POST',
  page: require('../fixtures/research/google.v1.json'),
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
    logger.info('google_research_live_failed', {
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

function dateOnly(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function bindId(researchRunId, stableId) {
  return `${researchRunId}:${stableId}`.slice(0, C.LIMITS.id.max);
}

function bindGoogleCursor(tenantId, researchRunId, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const token = Buffer.from(JSON.stringify({
    v: 1,
    t: Number(tenantId),
    r: String(researchRunId),
    a: state,
  }), 'utf8').toString('base64url');
  if (token.length > C.LIMITS.cursor.max) return null;
  if (containsCredentialMaterial(token)) return null;
  return token;
}

function unbindGoogleCursor(cursor, tenantId, researchRunId) {
  if (cursor == null || cursor === '') return { ok: true, state: null };
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
  const a = parsed.a;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  const ids = Array.isArray(a.ids) ? a.ids.map((id) => clip(id, C.LIMITS.provider_advertiser_id.max)).filter(Boolean) : [];
  const tgt = typeof a.tgt === 'string' ? clip(a.tgt, 253) : '';
  const p = Number(a.p);
  const f = typeof a.f === 'string' ? clip(a.f, C.LIMITS.provider_external_id.max) : '';
  if (!Number.isInteger(p) || p < 1 || p > 50) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (!ids.length && !tgt) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (containsCredentialMaterial(tgt) || ids.some((id) => containsCredentialMaterial(id)) || (f && containsCredentialMaterial(f))) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  return { ok: true, state: { ids: ids.slice(0, MAX_ADVERTISER_IDS), tgt: tgt || '', p, f } };
}

function platformKeys() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (login == null || password == null) return null;
  const user = String(login).trim();
  const pass = String(password);
  if (!user || !pass) return null;
  if (DUMMY_KEY.test(user) || DUMMY_KEY.test(pass)) return null;
  return { login: user, password: pass };
}

function basicAuthHeader(creds) {
  return `Basic ${Buffer.from(`${creds.login}:${creds.password}`, 'utf8').toString('base64')}`;
}

function locationCodeFor(countries) {
  if (!Array.isArray(countries)) return null;
  for (const raw of countries) {
    const iso = String(raw || '').trim().toUpperCase();
    if (LOCATION_CODES[iso] != null) return LOCATION_CODES[iso];
  }
  return null;
}

function requestedGeography(countries) {
  if (!Array.isArray(countries) || countries.length !== 1) return null;
  return clip(countries[0], C.LIMITS.country.max) || null;
}

function looksLikeDomain(query) {
  const s = String(query || '').trim().toLowerCase();
  if (!s || /[\s/:?#@]/.test(s)) return false;
  return DOMAIN_RE.test(s);
}

function dateRange(lookbackDays, now) {
  if (!lookbackDays) return null;
  const end = now != null ? new Date(now) : new Date();
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - Number(lookbackDays) * 86400000);
  const min = new Date(`${HISTORICAL_MIN}T00:00:00.000Z`);
  const from = start < min ? min : start;
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = end.toISOString().slice(0, 10);
  if (dateFrom > dateTo) return { date_from: HISTORICAL_MIN, date_to: dateTo };
  return { date_from: dateFrom, date_to: dateTo };
}

function depthOf(maxResults) {
  const n = Number(maxResults);
  if (!Number.isFinite(n)) return DEFAULT_DEPTH;
  return Math.min(DEPTH_CAP, Math.max(1, Math.floor(n)));
}

function isAtcHttps(raw) {
  if (raw == null || raw === '') return false;
  try {
    const u = new URL(String(raw));
    return u.protocol === 'https:' && u.hostname.toLowerCase() === ATC_HOST;
  } catch (_) {
    return false;
  }
}

function advertiserAtcUrl(id) {
  return `https://${ATC_HOST}/advertiser/${encodeURIComponent(id)}`;
}

function creativeAtcUrl(advertiserId, creativeId) {
  return `https://${ATC_HOST}/advertiser/${encodeURIComponent(advertiserId)}/creative/${encodeURIComponent(creativeId)}`;
}

function dfsCodes(json) {
  const top = json && Number(json.status_code);
  const task = json && Array.isArray(json.tasks) && json.tasks[0] ? Number(json.tasks[0].status_code) : null;
  return {
    top: Number.isFinite(top) ? top : null,
    task: Number.isFinite(task) ? task : null,
  };
}

function mapDfsCode(code, extra) {
  if (code == null) return null;
  if (code === 20000 || code === 20100) return null;
  if (code === 40102) return { empty: true };
  if (code === 40202 || code === 40501) {
    return connectorErrorPage('rate_limit', 'provider_rate_limit', extra);
  }
  if (code === 40200) {
    return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  }
  if (code >= 40100 && code < 40200) {
    return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  }
  if (code >= 50000) {
    return connectorErrorPage('transient', 'provider_unavailable', extra);
  }
  if (code >= 40000 && code < 50000) {
    return connectorErrorPage('invalid_response', 'provider_validation_failed', extra);
  }
  return connectorErrorPage('invalid_response', 'unmapped_provider_error', extra);
}

function mapDfsHttpError({ status, json, retryAfterMs, rate_limit, ident: extra } = {}) {
  const opts = { ...(extra || {}), rate_limit: rate_limit || null };
  if (retryAfterMs != null) opts.retry_after_ms = retryAfterMs;
  if (status === 429) return connectorErrorPage('rate_limit', 'provider_rate_limit', opts);
  if (status === 401) return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  if (status === 403) return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  if (status === 400) return connectorErrorPage('invalid_response', 'provider_validation_failed', extra);
  if (status === 408) return connectorErrorPage('transient', 'provider_unavailable', extra);
  if (status >= 500) return connectorErrorPage('transient', 'provider_unavailable', extra);
  const codes = dfsCodes(json);
  const mapped = mapDfsCode(codes.top, opts) || mapDfsCode(codes.task, opts);
  if (mapped) return mapped;
  return connectorErrorPage('invalid_response', 'unmapped_provider_error', extra);
}

function extractItems(json) {
  const tasks = json && Array.isArray(json.tasks) ? json.tasks : [];
  const items = [];
  for (const task of tasks) {
    const results = task && Array.isArray(task.result) ? task.result : [];
    for (const result of results) {
      if (result && Array.isArray(result.items)) items.push(...result.items);
    }
  }
  return items;
}

function collectAdvertisers(json) {
  const ids = [];
  const names = new Map();
  const seen = new Set();
  function add(id, title) {
    const advertiserId = clip(id, C.LIMITS.provider_advertiser_id.max);
    if (!advertiserId || seen.has(advertiserId) || ids.length >= MAX_ADVERTISER_IDS) return;
    seen.add(advertiserId);
    ids.push(advertiserId);
    const name = safeCopy(title, C.LIMITS.normalized_name.max);
    if (name) names.set(advertiserId, name);
  }
  function walk(node, inheritedTitle, depth) {
    if (!node || ids.length >= MAX_ADVERTISER_IDS || depth > 4) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, inheritedTitle, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const title = node.title != null ? node.title : inheritedTitle;
    if (node.advertiser_id != null) add(node.advertiser_id, title);
    if (Array.isArray(node.advertisers)) walk(node.advertisers, title, depth + 1);
    if (Array.isArray(node.ads)) walk(node.ads, title, depth + 1);
  }
  walk(extractItems(json), '', 0);
  return { ids, names };
}

function creativeFormat(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'text' || s === 'image' || s === 'video') return s;
  return 'unknown';
}

function assertLiveUrl(url) {
  let hostname;
  try { hostname = new URL(url).hostname; } catch (_) {
    return { ok: false, error: 'unsafe_url' };
  }
  if (!hostAllowed(CONNECTOR_ID, hostname)) {
    return { ok: false, error: 'host_not_allowlisted' };
  }
  return { ok: true };
}

function buildAdvertisersTask({ query, countries, pageIndex }) {
  const task = { keyword: String(query || '').slice(0, 700), tag: `p${pageIndex || 0}` };
  const loc = locationCodeFor(countries);
  if (loc != null) task.location_code = loc;
  return task;
}

function buildAdsSearchTask({
  advertiserIds, target, countries, lookbackDays, depth, pageIndex, now,
}) {
  const task = { depth: depthOf(depth), tag: `p${pageIndex || 0}` };
  if (advertiserIds && advertiserIds.length) {
    task.advertiser_ids = advertiserIds.slice(0, MAX_ADVERTISER_IDS);
  } else if (target) {
    task.target = String(target);
  }
  const loc = locationCodeFor(countries);
  if (loc != null) task.location_code = loc;
  const range = dateRange(lookbackDays, now);
  if (range) {
    task.date_from = range.date_from;
    task.date_to = range.date_to;
  }
  return task;
}

function normalizeAdsSearchPage(json, req, opts) {
  const captured = (opts && opts.capturedAt) || new Date().toISOString();
  const geo = requestedGeography(opts && opts.countries);
  const nameMap = (opts && opts.names) instanceof Map ? opts.names : new Map();
  const items = extractItems(json);
  const competitorsByAdv = new Map();
  const evidence = [];
  let firstCreativeId = '';

  for (const ad of items) {
    if (!ad || typeof ad !== 'object' || Array.isArray(ad)) continue;
    const advertiserId = ad.advertiser_id != null ? clip(ad.advertiser_id, C.LIMITS.provider_advertiser_id.max) : '';
    const creativeId = ad.creative_id != null ? clip(ad.creative_id, C.LIMITS.provider_external_id.max) : '';
    if (!advertiserId || !creativeId) continue;
    if (!firstCreativeId) firstCreativeId = creativeId;

    const title = safeCopy(ad.title, C.LIMITS.normalized_name.max);
    const name = nameMap.get(advertiserId) || title || advertiserId;
    if (!competitorsByAdv.has(advertiserId)) {
      competitorsByAdv.set(advertiserId, {
        id: bindId(req.research_run_id, advertiserId),
        tenant_id: req.tenant_id,
        research_run_id: req.research_run_id,
        platform: 'google',
        provider_advertiser_id: advertiserId,
        normalized_name: name,
        canonical_url: advertiserAtcUrl(advertiserId),
        country: geo,
        market: geo,
        discovery_source: 'ads_transparency_center',
        captured_at: captured,
        contract_version: 'v1',
      });
    }

    const format = creativeFormat(ad.format);
    const headline = safeCopy(ad.title, C.LIMITS.headline.max);
    const metrics = { source: 'live' };
    if (format !== 'unknown') metrics.format = format;
    const sourceUrl = isAtcHttps(ad.url) ? String(ad.url).trim() : creativeAtcUrl(advertiserId, creativeId);

    evidence.push({
      id: bindId(req.research_run_id, creativeId),
      tenant_id: req.tenant_id,
      research_run_id: req.research_run_id,
      competitor_id: bindId(req.research_run_id, advertiserId),
      platform: 'google',
      source_type: format === 'text' ? 'ad_copy' : 'ad_creative',
      provider_external_id: creativeId,
      canonical_source_url: sourceUrl,
      advertiser_name: safeCopy(name, C.LIMITS.advertiser_name.max),
      creative_format: format,
      headline,
      body_text: '',
      excerpt: headline,
      provider_started_on: dateOnly(ad.first_shown),
      provider_ended_on: dateOnly(ad.last_shown),
      captured_at: captured,
      market: geo,
      language: null,
      placement: null,
      provider_metrics: metrics,
      metrics_kind: 'estimated',
      provenance_method: 'ads_transparency_center',
      connector_id: CONNECTOR_ID,
      connector_version: CONNECTOR_VERSION,
      contract_version: 'v1',
      retention_class: 'standard',
    });
  }

  const depth = depthOf(opts && opts.depth);
  const pageIndex = Number(opts && opts.pageIndex) || 0;
  const ids = (opts && Array.isArray(opts.advertiserIds)) ? opts.advertiserIds : [];
  const target = (opts && opts.target) || '';
  const canContinue = evidence.length >= depth && !!(ids.length || target);
  const nextState = canContinue ? {
    ids: ids.slice(0, MAX_ADVERTISER_IDS),
    tgt: target || '',
    p: pageIndex + 1,
    f: firstCreativeId,
  } : null;
  const next_cursor = nextState ? bindGoogleCursor(req.tenant_id, req.research_run_id, nextState) : null;
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
    _first_creative_id: firstCreativeId,
  };
}

function emptyLivePage(req, opts) {
  return {
    ok: true,
    contract_version: 'v1',
    connector_id: CONNECTOR_ID,
    connector_version: CONNECTOR_VERSION,
    competitors: [],
    evidence: [],
    assets: [],
    page: { next_cursor: null, has_more: false },
    continuation_state: { honesty_class: 'live', cursor: null },
    rate_limit: (opts && opts.rate_limit) || null,
    retry_class: 'none',
  };
}

function rejectCapability(req, ctx) {
  const operation = String((ctx && ctx.operation) || 'ads_transparency_center');
  const caps = fixtureAdapter.capabilities();
  if (UNSUPPORTED_ALWAYS.includes(operation) || caps.unsupported.includes(operation) || operation !== 'ads_transparency_center') {
    return connectorErrorPage('policy_rejection', 'capability_not_supported', ident(req));
  }
  return null;
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
    const mappedHttp = mapDfsHttpError({
      status, json, retryAfterMs: hop.retryAfterMs, rate_limit: hop.rate_limit, ident: ident(req),
    });
    logLiveFailure(req, mappedHttp.message || mappedHttp.error);
    return assertConnectorResult(mappedHttp);
  }
  const codes = dfsCodes(json);
  const extra = { ...ident(req), retry_after_ms: hop.retryAfterMs, rate_limit: hop.rate_limit || null };
  const mappedTop = mapDfsCode(codes.top, extra);
  if (mappedTop && mappedTop.empty) return { empty: true, rate_limit: hop.rate_limit || null };
  if (mappedTop && mappedTop.ok === false) {
    logLiveFailure(req, mappedTop.message || mappedTop.error);
    return assertConnectorResult(mappedTop);
  }
  const mappedTask = mapDfsCode(codes.task, extra);
  if (mappedTask && mappedTask.empty) return { empty: true, rate_limit: hop.rate_limit || null };
  if (mappedTask && mappedTask.ok === false) {
    logLiveFailure(req, mappedTask.message || mappedTask.error);
    return assertConnectorResult(mappedTask);
  }
  if (hop.malformed || (status === 200 && json == null)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  return null;
}

async function postDfs(transport, url, task, ctx, authHeader) {
  const check = assertLiveUrl(url);
  if (!check.ok) return { denied: check.error };
  try {
    return await transport({
      connectorId: CONNECTOR_ID,
      url,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify([task]),
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs || REQUEST_TIMEOUT_MS,
      maxBodyBytes: MAX_BODY_BYTES,
    });
  } catch (err) {
    if (err && (err.code === 'cancelled' || String(err.message || '') === 'cancelled')) {
      return { cancelled: true };
    }
    if (err && /timeout/i.test(String(err.message || ''))) {
      return { timeout: true };
    }
    return { unavailable: true };
  }
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
  if (!ctx || !ctx.token) return failPage('auth_failure', 'missing_credentials', req);
  const creds = platformKeys();
  if (!creds) return failPage('auth_failure', 'missing_credentials', req);
  if (ctx.signal && ctx.signal.aborted) return failPage('terminal', 'cancelled', req);

  const query = req.search_parameters && req.search_parameters.query;
  if (!query) return failPage('policy_rejection', 'search_query_required', req);

  const unbound = unbindGoogleCursor(req.cursor, req.tenant_id, req.research_run_id);
  if (!unbound.ok) return failPage('invalid_response', 'invalid_pagination_cursor', req);

  const requestedCountries = (req.search_parameters.countries && req.search_parameters.countries.length)
    ? req.search_parameters.countries
    : [];
  const depth = depthOf(req.search_parameters.max_results_per_page);
  const transport = ctx.transport || defaultTransport;
  const authHeader = basicAuthHeader(creds);
  const capturedAt = (ctx.now != null ? new Date(ctx.now) : new Date()).toISOString();

  let advertiserIds = unbound.state ? unbound.state.ids : [];
  let target = unbound.state ? unbound.state.tgt : '';
  let names = new Map();
  const pageIndex = unbound.state ? unbound.state.p : 0;

  if (!unbound.state) {
    const advHop = await postDfs(transport, ADVERTISERS_URL, buildAdvertisersTask({
      query, countries: requestedCountries, pageIndex: 0,
    }), ctx, authHeader);
    if (advHop.denied) return failPage('policy_rejection', advHop.denied, req);
    if (advHop.cancelled) return failPage('terminal', 'cancelled', req);
    if (advHop.timeout || advHop.unavailable) return failPage('transient', 'provider_unavailable', req);
    const advMapped = liveErrorFromHop(advHop, req);
    if (advMapped && advMapped.ok === false) return advMapped;
    if (!advMapped || !advMapped.empty) {
      const collected = collectAdvertisers(advHop.json);
      advertiserIds = collected.ids;
      names = collected.names;
    }
    if (!advertiserIds.length && looksLikeDomain(query)) target = String(query).trim().toLowerCase();
    if (!advertiserIds.length && !target) {
      return finalizeLive(emptyLivePage(req, { rate_limit: advHop.rate_limit || null }), req);
    }
  }

  const searchHop = await postDfs(transport, ADS_SEARCH_URL, buildAdsSearchTask({
    advertiserIds,
    target,
    countries: requestedCountries,
    lookbackDays: req.search_parameters.lookback_days,
    depth,
    pageIndex,
    now: ctx.now,
  }), ctx, authHeader);
  if (searchHop.denied) return failPage('policy_rejection', searchHop.denied, req);
  if (searchHop.cancelled) return failPage('terminal', 'cancelled', req);
  if (searchHop.timeout || searchHop.unavailable) return failPage('transient', 'provider_unavailable', req);
  const searchMapped = liveErrorFromHop(searchHop, req);
  if (searchMapped && searchMapped.ok === false) return searchMapped;
  if (searchMapped && searchMapped.empty) {
    return finalizeLive(emptyLivePage(req, { rate_limit: searchHop.rate_limit || null }), req);
  }

  const raw = normalizeAdsSearchPage(searchHop.json, req, {
    capturedAt,
    countries: requestedCountries,
    rate_limit: searchHop.rate_limit || null,
    names,
    advertiserIds,
    target,
    depth,
    pageIndex,
  });
  if (unbound.state && unbound.state.f && raw._first_creative_id && raw._first_creative_id === unbound.state.f) {
    return failPage('invalid_response', 'repeated_continuation_token', req);
  }
  delete raw._first_creative_id;
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
  bindGoogleCursor,
  unbindGoogleCursor,
  mapDfsHttpError,
  LOCATION_CODES,
  ADVERTISERS_URL,
  ADS_SEARCH_URL,
  buildAdvertisersTask,
  buildAdsSearchTask,
  collectAdvertisers,
  normalizeAdsSearchPage,
};

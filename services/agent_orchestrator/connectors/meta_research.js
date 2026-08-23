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

const CONNECTOR_ID = 'meta_research';
const CONNECTOR_VERSION = '1.0.0';
const DEFAULT_GRAPH_VERSION = 'v21.0';
const GRAPH_VERSION_RE = /^v\d{1,2}\.\d{1,2}$/;
const DEFAULT_COUNTRIES = Object.freeze(['US']);
const DEFAULT_LIMIT = 25;

const ARCHIVE_FIELDS = Object.freeze([
  'id',
  'page_id',
  'page_name',
  'ad_creation_time',
  'ad_creative_bodies',
  'ad_creative_link_titles',
  'ad_creative_link_descriptions',
  'ad_delivery_start_time',
  'ad_delivery_stop_time',
  'ad_snapshot_url',
  'publisher_platforms',
  'languages',
  'impressions',
]);

const fixtureAdapter = createResearchAdapter({
  id: CONNECTOR_ID,
  version: CONNECTOR_VERSION,
  platform: 'meta',
  capability: 'ad_library',
  unsupported: ['ads_transparency_center', 'keyword_planner', 'public_profile'],
  allowLive: true,
  host: 'graph.facebook.com',
  path: '/v21.0/ads_archive',
  method: 'GET',
  page: require('../fixtures/research/meta.v1.json'),
  pages: require('../fixtures/research/connector-pagination.v1.json').pages,
});

function graphVersion() {
  const raw = process.env.META_GRAPH_API_VERSION;
  if (typeof raw === 'string' && GRAPH_VERSION_RE.test(raw.trim())) return raw.trim();
  return DEFAULT_GRAPH_VERSION;
}

function ident(req) {
  return {
    connector_id: CONNECTOR_ID,
    connector_version: CONNECTOR_VERSION,
    contract_version: 'v1',
    continuation_state: req && req.continuation_state ? req.continuation_state : {},
  };
}

function failPage(code, message, req, extra) {
  return assertConnectorResult(connectorErrorPage(code, message, { ...ident(req), ...(extra || {}) }));
}

function clip(value, max) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function firstString(list) {
  if (!Array.isArray(list)) return '';
  for (const item of list) {
    if (item == null) continue;
    const s = String(item).trim();
    if (s) return s;
  }
  return '';
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

function bindMetaCursor(tenantId, researchRunId, after) {
  if (after == null || after === '') return null;
  const token = Buffer.from(JSON.stringify({
    v: 1,
    t: Number(tenantId),
    r: String(researchRunId),
    a: String(after),
  }), 'utf8').toString('base64url');
  if (token.length > C.LIMITS.cursor.max) return null;
  if (containsCredentialMaterial(token)) return null;
  return token;
}

function unbindMetaCursor(cursor, tenantId, researchRunId) {
  if (cursor == null || cursor === '') return { ok: true, after: null };
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
  if (typeof parsed.a !== 'string' || !parsed.a || parsed.a.length > C.LIMITS.cursor.max) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  if (containsCredentialMaterial(parsed.a)) {
    return { ok: false, error: 'invalid_pagination_cursor' };
  }
  return { ok: true, after: parsed.a };
}

function mapMetaHttpError({ status, json, retryAfterMs, rate_limit, ident: extra } = {}) {
  const err = json && json.error && typeof json.error === 'object' ? json.error : null;
  const code = err && Number(err.code);
  const opts = {
    ...(extra || {}),
    rate_limit: rate_limit || null,
  };
  if (status === 429) {
    return connectorErrorPage('rate_limit', 'provider_rate_limit', {
      ...opts,
      retry_after_ms: retryAfterMs != null ? retryAfterMs : null,
    });
  }
  if (status === 401 || code === 190 || code === 102) {
    return connectorErrorPage('auth_failure', 'provider_auth_rejected', extra);
  }
  if (status === 403 || code === 10 || code === 200 || code === 294) {
    return connectorErrorPage('policy_rejection', 'provider_permission_denied', extra);
  }
  if (status === 400 || code === 100) {
    return connectorErrorPage('invalid_response', 'provider_validation_failed', extra);
  }
  if (status >= 500) {
    return connectorErrorPage('transient', 'provider_unavailable', extra);
  }
  return connectorErrorPage('invalid_response', 'unmapped_provider_error', extra);
}

function buildMetaArchiveUrl({
  query, countries, lookbackDays, limit, after, now,
} = {}) {
  const version = graphVersion();
  const url = new URL(`https://graph.facebook.com/${version}/ads_archive`);
  url.searchParams.set('search_terms', String(query || ''));
  url.searchParams.set('ad_reached_countries', JSON.stringify(countries && countries.length ? countries : DEFAULT_COUNTRIES));
  url.searchParams.set('ad_type', 'ALL');
  url.searchParams.set('ad_active_status', 'ALL');
  url.searchParams.set('fields', ARCHIVE_FIELDS.join(','));
  url.searchParams.set('limit', String(limit != null ? limit : DEFAULT_LIMIT));
  if (lookbackDays) {
    const end = now != null ? new Date(now) : new Date();
    const start = new Date(end.getTime() - Number(lookbackDays) * 86400000);
    url.searchParams.set('ad_delivery_date_min', start.toISOString().slice(0, 10));
    url.searchParams.set('ad_delivery_date_max', end.toISOString().slice(0, 10));
  }
  if (after) url.searchParams.set('after', String(after));
  url.searchParams.delete('access_token');
  return url.toString();
}

function inferCreativeFormat(ad) {
  const bodies = Array.isArray(ad.ad_creative_bodies) ? ad.ad_creative_bodies : [];
  const titles = Array.isArray(ad.ad_creative_link_titles) ? ad.ad_creative_link_titles : [];
  if (bodies.length > 1 || titles.length > 1) return 'carousel';
  const hasText = bodies.length > 0 || titles.length > 0;
  const snap = typeof ad.ad_snapshot_url === 'string' ? ad.ad_snapshot_url : '';
  if (hasText && !snap) return 'text';
  if (snap) return 'image';
  if (hasText) return 'text';
  return 'unknown';
}

function impressionBounds(impr) {
  if (!impr || typeof impr !== 'object' || Array.isArray(impr)) return null;
  const out = {};
  const lo = Number(impr.lower_bound);
  const hi = Number(impr.upper_bound);
  if (Number.isFinite(lo)) out.impressions_lower = Math.floor(lo);
  if (Number.isFinite(hi)) out.impressions_upper = Math.floor(hi);
  return (out.impressions_lower != null || out.impressions_upper != null) ? out : null;
}

function rejectCapability(req, ctx) {
  const operation = String((ctx && ctx.operation) || 'ad_library');
  const caps = fixtureAdapter.capabilities();
  if (UNSUPPORTED_ALWAYS.includes(operation) || caps.unsupported.includes(operation) || operation !== 'ad_library') {
    return connectorErrorPage('policy_rejection', 'capability_not_supported', ident(req));
  }
  return null;
}

function pagingAfter(json) {
  const after = json && json.paging && json.paging.cursors && json.paging.cursors.after;
  return after == null || after === '' ? null : String(after);
}

function normalizeMetaArchivePage(json, req, opts) {
  const captured = (opts && opts.capturedAt) || new Date().toISOString();
  const countries = (opts && opts.countries) || DEFAULT_COUNTRIES;
  const country = clip(countries[0] || 'US', C.LIMITS.country.max) || 'US';
  const data = Array.isArray(json && json.data) ? json.data : [];
  const competitorsByPage = new Map();
  const evidence = [];

  for (const ad of data) {
    if (!ad || typeof ad !== 'object' || Array.isArray(ad)) continue;
    const adId = ad.id != null ? clip(ad.id, C.LIMITS.provider_external_id.max) : '';
    const pageId = ad.page_id != null ? clip(ad.page_id, C.LIMITS.provider_advertiser_id.max) : '';
    if (!adId || !pageId) continue;

    const pageName = safeCopy(ad.page_name, C.LIMITS.normalized_name.max) || pageId;
    if (!competitorsByPage.has(pageId)) {
      competitorsByPage.set(pageId, {
        id: bindId(req.research_run_id, pageId),
        tenant_id: req.tenant_id,
        research_run_id: req.research_run_id,
        platform: 'meta',
        provider_advertiser_id: pageId,
        normalized_name: pageName,
        canonical_url: `https://www.facebook.com/ads/library/?view_all_page_id=${encodeURIComponent(pageId)}`,
        country,
        market: country,
        discovery_source: 'ad_library',
        captured_at: captured,
        contract_version: 'v1',
      });
    }

    const headline = safeCopy(firstString(ad.ad_creative_link_titles), C.LIMITS.headline.max);
    const body = safeCopy(firstString(ad.ad_creative_bodies), C.LIMITS.body_text.max);
    const excerpt = safeCopy(
      firstString(ad.ad_creative_link_descriptions) || headline || body,
      C.LIMITS.excerpt.max
    );
    const format = inferCreativeFormat(ad);
    const bounds = impressionBounds(ad.impressions);
    const metrics = { source: 'live' };
    if (bounds) Object.assign(metrics, bounds);
    const langs = Array.isArray(ad.languages) ? ad.languages : [];
    const plats = Array.isArray(ad.publisher_platforms) ? ad.publisher_platforms : [];

    evidence.push({
      id: bindId(req.research_run_id, adId),
      tenant_id: req.tenant_id,
      research_run_id: req.research_run_id,
      competitor_id: bindId(req.research_run_id, pageId),
      platform: 'meta',
      source_type: format === 'text' ? 'ad_copy' : 'ad_creative',
      provider_external_id: adId,
      canonical_source_url: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`,
      advertiser_name: safeCopy(ad.page_name || pageName, C.LIMITS.advertiser_name.max),
      creative_format: format,
      headline,
      body_text: body,
      excerpt,
      provider_started_on: dateOnly(ad.ad_delivery_start_time || ad.ad_creation_time),
      provider_ended_on: dateOnly(ad.ad_delivery_stop_time),
      captured_at: captured,
      market: country,
      language: safeCopy(langs[0], C.LIMITS.language.max) || null,
      placement: safeCopy(plats[0], C.LIMITS.placement.max) || null,
      provider_metrics: metrics,
      metrics_kind: bounds ? 'provider_reported' : 'estimated',
      provenance_method: 'ad_library',
      connector_id: CONNECTOR_ID,
      connector_version: CONNECTOR_VERSION,
      contract_version: 'v1',
      retention_class: 'standard',
    });
  }

  const after = pagingAfter(json);
  const next_cursor = after ? bindMetaCursor(req.tenant_id, req.research_run_id, after) : null;
  return {
    ok: true,
    contract_version: 'v1',
    connector_id: CONNECTOR_ID,
    connector_version: CONNECTOR_VERSION,
    competitors: [...competitorsByPage.values()],
    evidence,
    assets: [],
    page: { next_cursor, has_more: !!next_cursor },
    continuation_state: { honesty_class: 'live', cursor: next_cursor },
    rate_limit: (opts && opts.rate_limit) || null,
    retry_class: 'none',
  };
}

function liveErrorFromHop(hop, req) {
  if (!hop) return failPage('transient', 'provider_unavailable', req);
  if (hop.ok === false && hop.errorPage) return assertConnectorResult(hop.errorPage);
  if (hop.oversized) return failPage('invalid_response', 'oversized_provider_response', req);
  const status = hop.status;
  const json = hop.json;
  if (json && json.error) {
    return assertConnectorResult(mapMetaHttpError({
      status: status || 200,
      json,
      retryAfterMs: hop.retryAfterMs,
      rate_limit: hop.rate_limit,
      ident: ident(req),
    }));
  }
  if (status === 401 || status === 403 || status === 400 || status === 429 || (status && status >= 500)) {
    return assertConnectorResult(mapMetaHttpError({
      status,
      json,
      retryAfterMs: hop.retryAfterMs,
      rate_limit: hop.rate_limit,
      ident: ident(req),
    }));
  }
  if (hop.malformed || (status === 200 && json == null)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  if (!json || !Array.isArray(json.data)) {
    return failPage('invalid_response', 'malformed_provider_response', req);
  }
  return null;
}

async function fetchLivePage(input, ctx) {
  const req = assertConnectorRequest(input, { tenantId: ctx && ctx.tenantId });
  const denied = rejectCapability(req, ctx);
  if (denied) return assertConnectorResult(denied);
  if (!ctx || !ctx.token) return failPage('auth_failure', 'missing_credentials', req);
  if (ctx.signal && ctx.signal.aborted) return failPage('terminal', 'cancelled', req);

  const query = req.search_parameters && req.search_parameters.query;
  if (!query) return failPage('policy_rejection', 'search_query_required', req);

  const unbound = unbindMetaCursor(req.cursor, req.tenant_id, req.research_run_id);
  if (!unbound.ok) return failPage('invalid_response', 'invalid_pagination_cursor', req);

  const countries = (req.search_parameters.countries && req.search_parameters.countries.length)
    ? req.search_parameters.countries
    : [...DEFAULT_COUNTRIES];
  const url = buildMetaArchiveUrl({
    query,
    countries,
    lookbackDays: req.search_parameters.lookback_days,
    limit: req.search_parameters.max_results_per_page || DEFAULT_LIMIT,
    after: unbound.after,
    now: ctx.now,
  });

  let hostname;
  try { hostname = new URL(url).hostname; } catch (_) {
    return failPage('policy_rejection', 'unsafe_url', req);
  }
  if (!hostAllowed(CONNECTOR_ID, hostname)) {
    return failPage('policy_rejection', 'host_not_allowlisted', req);
  }

  const transport = ctx.transport || defaultTransport;
  let hop;
  try {
    hop = await transport({
      connectorId: CONNECTOR_ID,
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ctx.token}`,
      },
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

  const raw = normalizeMetaArchivePage(hop.json, req, {
    capturedAt: (ctx.now != null ? new Date(ctx.now) : new Date()).toISOString(),
    countries,
    rate_limit: hop.rate_limit || null,
  });
  const stamped = stampPageHonesty(raw, 'live');
  assertPageHonesty({ mode: 'live', page: stamped });
  return assertConnectorResult(stamped, { tenantId: req.tenant_id });
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
  buildMetaArchiveUrl,
  normalizeMetaArchivePage,
  bindMetaCursor,
  unbindMetaCursor,
  mapMetaHttpError,
  ARCHIVE_FIELDS,
  DEFAULT_GRAPH_VERSION,
};

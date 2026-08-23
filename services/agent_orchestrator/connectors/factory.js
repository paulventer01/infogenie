'use strict';

const C = require('../research_contracts');
const { assertConnectorRequest, assertConnectorResult } = require('../research_connector');
const { connectorErrorPage } = require('../research_errors');
const { stampPageHonesty, assertPageHonesty } = require('../research_honesty');
const { hostAllowed } = require('./transport');

const UNSUPPORTED_ALWAYS = Object.freeze([
  'competitor_account_access',
  'campaign_publish',
  'campaign_mutate',
  'creative_generation',
  'optimization',
]);

function bindPage(page, req, ctx) {
  const mode = (ctx && ctx.mode) || 'fixture';
  const remap = (id) => `${req.research_run_id}:${id}`.slice(0, C.LIMITS.id.max);
  const idMap = {};
  const competitors = (page.competitors || []).map((row) => {
    const id = remap(row.id);
    idMap[row.id] = id;
    return { ...row, id, tenant_id: req.tenant_id, research_run_id: req.research_run_id };
  });
  const evidence = (page.evidence || []).map((row) => ({
    ...row,
    id: remap(row.id),
    tenant_id: req.tenant_id,
    research_run_id: req.research_run_id,
    competitor_id: idMap[row.competitor_id] || remap(row.competitor_id),
    connector_id: req.connector_id,
    connector_version: req.connector_version,
    contract_version: 'v1',
  }));
  const assets = (page.assets || []).map((row) => ({
    ...row,
    id: remap(row.id),
    tenant_id: req.tenant_id,
    evidence_id: remap(row.evidence_id),
  }));
  const bound = stampPageHonesty({
    ...page,
    ok: true,
    contract_version: 'v1',
    connector_id: req.connector_id,
    connector_version: req.connector_version,
    competitors,
    evidence,
    assets,
    retry_class: 'none',
  }, mode);
  assertPageHonesty({ mode, page: bound });
  return bound;
}

function pageForCursor(spec, cursor) {
  const pages = spec.pages && spec.pages.length ? spec.pages : [spec.page];
  if (cursor == null || cursor === '') return pages[0];
  const idx = pages.findIndex((p) => p.page && p.page.next_cursor === cursor);
  if (idx >= 0) return pages[idx + 1] || pages[pages.length - 1];
  const byState = pages.find((p) => p.continuation_state && p.continuation_state.cursor === cursor);
  return byState || null;
}

function capabilitiesOf(spec) {
  return Object.freeze({
    connector_id: spec.id,
    connector_version: spec.version,
    platform: spec.platform,
    supported: Object.freeze([spec.capability]),
    unsupported: Object.freeze([...UNSUPPORTED_ALWAYS, ...(spec.unsupported || [])]),
    live_adapter: spec.allowLive === true,
    documented_host: spec.host,
    documented_path: spec.path,
  });
}

function createResearchAdapter(spec) {
  const capabilities = () => capabilitiesOf(spec);

  async function fetchPage(input, ctx) {
    const req = assertConnectorRequest(input, { tenantId: ctx && ctx.tenantId });
    const operation = String((ctx && ctx.operation) || spec.capability);
    const caps = capabilities();
    if (UNSUPPORTED_ALWAYS.includes(operation) || caps.unsupported.includes(operation)) {
      return assertConnectorResult(connectorErrorPage('policy_rejection', 'capability_not_supported', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
        continuation_state: req.continuation_state,
      }));
    }
    if (operation !== spec.capability) {
      return assertConnectorResult(connectorErrorPage('policy_rejection', 'capability_not_supported', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
        continuation_state: req.continuation_state,
      }));
    }
    if (!ctx || !ctx.token) {
      return assertConnectorResult(connectorErrorPage('auth_failure', 'missing_credentials', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
      }));
    }
    if (ctx.mode === 'fixture') {
      const chosen = pageForCursor(spec, req.cursor);
      if (!chosen) {
        return assertConnectorResult(connectorErrorPage('invalid_response', 'invalid_pagination_cursor', {
          connector_id: spec.id,
          connector_version: spec.version,
          contract_version: 'v1',
        }));
      }
      if (ctx.transport) {
        const hop = await ctx.transport({
          connectorId: spec.id,
          url: `https://${spec.host}${spec.path}`,
          method: spec.method || 'GET',
          signal: ctx.signal,
        });
        if (hop && hop.ok === false && hop.errorPage) return assertConnectorResult(hop.errorPage);
        if (hop && hop.status === 429) {
          return assertConnectorResult(connectorErrorPage('rate_limit', 'provider_rate_limit', {
            connector_id: spec.id,
            connector_version: spec.version,
            contract_version: 'v1',
            retry_after_ms: hop.retryAfterMs,
            rate_limit: hop.rate_limit,
            continuation_state: { cursor: req.cursor || null },
          }));
        }
      }
      return assertConnectorResult(bindPage(chosen, req, ctx), { tenantId: req.tenant_id });
    }
    if (spec.allowLive !== true && !(ctx && ctx.injected)) {
      return assertConnectorResult(connectorErrorPage('terminal', 'connector_unavailable', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
      }));
    }
    const transport = ctx.transport;
    if (!transport) {
      return assertConnectorResult(connectorErrorPage('terminal', 'connector_unavailable', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
      }));
    }
    const url = `https://${spec.host}${spec.path}`;
    if (!hostAllowed(spec.id, spec.host)) {
      return assertConnectorResult(connectorErrorPage('policy_rejection', 'host_not_allowlisted'));
    }
    const hop = await transport({
      connectorId: spec.id,
      url,
      method: spec.method || 'GET',
      headers: { Accept: 'application/json' },
      signal: ctx.signal,
      query: req.search_parameters,
    });
    if (hop && hop.ok === false && hop.errorPage) return assertConnectorResult(hop.errorPage);
    if (hop && hop.status === 429) {
      return assertConnectorResult(connectorErrorPage('rate_limit', 'provider_rate_limit', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
        retry_after_ms: hop.retryAfterMs,
        rate_limit: hop.rate_limit,
        continuation_state: { cursor: req.cursor || null },
      }));
    }
    if (hop && hop.status >= 500) {
      return assertConnectorResult(connectorErrorPage('transient', 'provider_unavailable', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
        continuation_state: { cursor: req.cursor || null },
      }));
    }
    if (hop && hop.status === 401) {
      return assertConnectorResult(connectorErrorPage('auth_failure', 'provider_auth_rejected', {
        connector_id: spec.id,
        connector_version: spec.version,
        contract_version: 'v1',
      }));
    }
    if (ctx.mode === 'fixture' || (hop && hop.json && hop.json.ok === true && hop.json.connector_id)) {
      const page = hop.json && hop.json.ok === true ? hop.json : pageForCursor(spec, req.cursor);
      if (!page) {
        return assertConnectorResult(connectorErrorPage('invalid_response', 'invalid_provider_page', {
          connector_id: spec.id,
          connector_version: spec.version,
          contract_version: 'v1',
        }));
      }
      return assertConnectorResult(bindPage(page, req, ctx), { tenantId: req.tenant_id });
    }
    return assertConnectorResult(connectorErrorPage('invalid_response', 'unmapped_provider_page', {
      connector_id: spec.id,
      connector_version: spec.version,
      contract_version: 'v1',
    }));
  }

  return {
    id: spec.id,
    version: spec.version,
    platform: spec.platform,
    capabilities,
    fetchPage,
  };
}

module.exports = {
  UNSUPPORTED_ALWAYS,
  bindPage,
  createResearchAdapter,
  capabilitiesOf,
};

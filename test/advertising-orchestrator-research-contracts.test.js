'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { OrchError } = require('../services/agent_orchestrator/errors');
const { ConnectorError } = require('../services/agent_orchestrator/research_errors');
const C = require('../services/agent_orchestrator/research_contracts');
const {
  assertResearchRun,
  assertCompetitor,
  assertEvidenceItem,
  assertEvidenceAsset,
  computeEvidenceHash,
  computeCompetitorDedupKey,
  sanitizeEvidenceText,
  stripUnknown,
} = require('../services/agent_orchestrator/research_validate');
const {
  CONNECTOR_IDS,
  assertConnectorRequest,
  assertConnectorPage,
  assertConnectorError,
  assertConnectorResult,
  notImplemented,
} = require('../services/agent_orchestrator/research_connector');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'services/agent_orchestrator/fixtures/research');
const TENANT_A = 1;
const TENANT_B = 2;

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function isValidation(err) {
  return err instanceof OrchError && err.code === 'validation_failed';
}

function throwsValidation(fn) {
  assert.throws(fn, isValidation);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function metaEvidence() {
  return clone(loadJson('meta.v1.json').evidence[0]);
}

function metaCompetitor() {
  return clone(loadJson('meta.v1.json').competitors[0]);
}

const SAMPLE_RUN = Object.freeze({
  id: 'run-meta-001',
  tenant_id: TENANT_A,
  workflow_id: 'wf-001',
  approval_id: 42,
  approval_object_version: 1,
  contract_version: 'v1',
  requested_platforms: ['meta'],
  research_brief: 'Find outdoor jacket ads in public libraries',
  search_parameters: { countries: ['US'], lookback_days: 30, query: 'jackets' },
  state: 'pending',
  idempotency_key: 'idemp-run-meta-001',
});

const SAMPLE_REQUEST = Object.freeze({
  connector_id: 'meta_research',
  connector_version: '1.0.0',
  contract_version: 'v1',
  tenant_id: TENANT_A,
  research_run_id: 'run-meta-001',
  workflow_id: 'wf-001',
  approval_id: 42,
  approval_object_version: 1,
  requested_platforms: ['meta'],
  research_brief: 'Find outdoor jacket ads in public libraries',
  search_parameters: { countries: ['US'], lookback_days: 30, query: 'jackets' },
  cursor: null,
  continuation_state: {},
  idempotency_key: 'idemp-run-meta-001',
});

test('1. all three platform fixtures validate against the same canonical contract', () => {
  const names = ['meta.v1.json', 'google.v1.json', 'tiktok.v1.json'];
  const seenConnectors = new Set();
  for (const name of names) {
    const page = loadJson(name);
    const normalized = assertConnectorPage(page, { tenantId: TENANT_A });
    assert.strictEqual(normalized.ok, true);
    assert.strictEqual(normalized.contract_version, C.CONTRACT_VERSION);
    assert.ok(CONNECTOR_IDS.includes(normalized.connector_id));
    seenConnectors.add(normalized.connector_id);
    assert.ok(normalized.competitors.length >= 1, `${name} needs ≥1 competitor`);
    assert.ok(normalized.evidence.length >= 1, `${name} needs ≥1 evidence item`);
    assert.ok(Array.isArray(normalized.assets));
    assert.strictEqual(normalized.retry_class, 'none');
    for (const ev of normalized.evidence) {
      assert.strictEqual(ev.connector_id, normalized.connector_id);
      assert.strictEqual(ev.contract_version, 'v1');
    }
    const roundTrip = assertConnectorResult(page, { tenantId: TENANT_A });
    assert.strictEqual(roundTrip.ok, true);
  }
  assert.deepStrictEqual([...seenConnectors].sort(), ['google_research', 'meta_research', 'tiktok_research']);
});

test('2. connector error and pagination fixtures validate', () => {
  const errors = loadJson('connector-errors.v1.json').errors;
  assert.strictEqual(errors.length, C.FAILURE_CLASSES.length);
  const seen = new Set();
  for (const row of errors) {
    const normalized = assertConnectorError(row);
    assert.strictEqual(normalized.ok, false);
    seen.add(normalized.error);
    assert.strictEqual(normalized.retry_class, require('../services/agent_orchestrator/research_errors').retryClassFor(normalized.error));
    assert.ok(normalized.message.length <= 512);
    assert.equal(normalized.message.includes('access_token'), false);
    const viaUnion = assertConnectorResult(row, { tenantId: TENANT_A });
    assert.strictEqual(viaUnion.ok, false);
  }
  assert.deepStrictEqual([...seen].sort(), [...C.FAILURE_CLASSES].slice().sort());

  const pages = loadJson('connector-pagination.v1.json').pages;
  assert.strictEqual(pages.length, 2);
  const p1 = assertConnectorPage(pages[0], { tenantId: TENANT_A });
  assert.strictEqual(p1.page.has_more, true);
  assert.strictEqual(p1.page.next_cursor, 'opaque-cursor-page-2');
  assert.ok(p1.competitors.length >= 1);
  const p2 = assertConnectorPage(pages[1], { tenantId: TENANT_A });
  assert.strictEqual(p2.page.has_more, false);
  assert.strictEqual(p2.page.next_cursor, null);
  assert.deepStrictEqual(p2.competitors, []);
  assert.deepStrictEqual(p2.evidence, []);
  assert.deepStrictEqual(p2.assets, []);
});

test('3. invalid platform / source_type / state / contract_version fail', () => {
  throwsValidation(() => assertResearchRun({ ...SAMPLE_RUN, contract_version: 'v2' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertResearchRun({ ...SAMPLE_RUN, state: 'done' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertResearchRun({ ...SAMPLE_RUN, requested_platforms: ['facebook'] }, { tenantId: TENANT_A }));
  throwsValidation(() => assertCompetitor({ ...metaCompetitor(), platform: 'facebook' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({ ...metaEvidence(), source_type: 'secret' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({ ...metaEvidence(), contract_version: 'v0' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertConnectorRequest({ ...SAMPLE_REQUEST, contract_version: 'v2' }, { tenantId: TENANT_A }));
});

test('4. oversized text and JSON fail closed (no silent truncate)', () => {
  throwsValidation(() => sanitizeEvidenceText('h'.repeat(501), 500));
  throwsValidation(() => assertResearchRun({
    ...SAMPLE_RUN,
    research_brief: 'b'.repeat(4001),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    headline: 'h'.repeat(501),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    body_text: 'b'.repeat(4001),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertResearchRun({
    ...SAMPLE_RUN,
    search_parameters: { query: 'ok', pad: 'y'.repeat(9000) },
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    provider_metrics: { blob: 'm'.repeat(9000) },
  }, { tenantId: TENANT_A }));
  const ok = sanitizeEvidenceText('  trail-ready  ', 500);
  assert.strictEqual(ok, 'trail-ready');
});

test('5. forbidden PII and raw-payload keys are rejected', () => {
  const forbidden = C.FORBIDDEN_KEYS;
  for (const key of forbidden) {
    throwsValidation(() => assertEvidenceItem({ ...metaEvidence(), [key]: 'nope' }, { tenantId: TENANT_A }));
    throwsValidation(() => assertCompetitor({ ...metaCompetitor(), [key]: 'nope' }, { tenantId: TENANT_A }));
    throwsValidation(() => assertResearchRun({ ...SAMPLE_RUN, [key]: 'nope' }, { tenantId: TENANT_A }));
  }
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    provider_metrics: { access_token: 'secret-token' },
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertResearchRun({
    ...SAMPLE_RUN,
    search_parameters: { query: 'jackets', extra: { refresh_token: 'r' } },
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertConnectorRequest({
    ...SAMPLE_REQUEST,
    email: 'person@example.com',
  }, { tenantId: TENANT_A }));
});

test('6. media binaries, base64 blobs, and Buffer cannot be stored on evidence', () => {
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    headline: Buffer.from('binary-headline'),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    extra_blob: Buffer.from('nope'),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    excerpt: 'data:image/png;base64,AAAA',
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    image_base64: 'AAAA',
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    media_bytes: new Uint8Array([1, 2, 3]),
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceAsset({
    id: 'asset-bin',
    tenant_id: TENANT_A,
    evidence_id: 'ev-meta-001',
    media_type: 'image',
    storage_ref: 'data:image/png;base64,AAAA',
    checksum_sha256: 'a'.repeat(64),
    captured_at: '2026-08-21T12:00:00.000Z',
  }, { tenantId: TENANT_A }));
  const asset = assertEvidenceAsset(loadJson('meta.v1.json').assets[0], { tenantId: TENANT_A });
  assert.strictEqual(asset.media_type, 'image');
  assert.ok(asset.storage_ref.startsWith('research://'));
  assert.equal(Object.prototype.hasOwnProperty.call(asset, 'media_bytes'), false);
});

test('7. extra unknown provider fields are discarded; required fields kept', () => {
  const incoming = {
    ...metaCompetitor(),
    provider_display_name: 'ignore me',
    impressions: 999,
    foo: { bar: 1 },
  };
  const out = assertCompetitor(incoming, { tenantId: TENANT_A });
  assert.strictEqual(out.normalized_name, 'Northwind Outdoor Co');
  assert.strictEqual(out.provider_advertiser_id, 'ext-meta-page-001');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'provider_display_name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'impressions'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'foo'), false);

  const stripped = stripUnknown({ id: 'x', extra: 1, platform: 'meta' }, ['id', 'platform']);
  assert.deepStrictEqual(stripped, { id: 'x', platform: 'meta' });

  const run = assertResearchRun({
    ...SAMPLE_RUN,
    search_parameters: { query: 'jackets', unknown_filter: 'drop', countries: ['US'] },
  }, { tenantId: TENANT_A });
  assert.deepStrictEqual(run.search_parameters, { query: 'jackets', countries: ['US'] });
});

test('8. tenant_id mismatch vs context fails (no caller override)', () => {
  throwsValidation(() => assertResearchRun(SAMPLE_RUN, { tenantId: TENANT_B }));
  throwsValidation(() => assertCompetitor(metaCompetitor(), { tenantId: TENANT_B }));
  throwsValidation(() => assertEvidenceItem(metaEvidence(), { tenantId: TENANT_B }));
  throwsValidation(() => assertConnectorRequest(SAMPLE_REQUEST, { tenantId: TENANT_B }));
  throwsValidation(() => assertConnectorPage(loadJson('meta.v1.json'), { tenantId: TENANT_B }));
  throwsValidation(() => assertResearchRun(SAMPLE_RUN, {}));
  const ok = assertResearchRun(SAMPLE_RUN, { tenantId: TENANT_A });
  assert.strictEqual(ok.tenant_id, TENANT_A);
});

test('9. evidence_hash mismatch fails; computeEvidenceHash is stable', () => {
  const ev = metaEvidence();
  const subset = {
    platform: ev.platform,
    source_type: ev.source_type,
    provider_external_id: ev.provider_external_id,
    canonical_source_url: ev.canonical_source_url,
    headline: ev.headline,
    body_text: ev.body_text,
    excerpt: ev.excerpt,
    advertiser_name: ev.advertiser_name,
    creative_format: ev.creative_format,
  };
  const h1 = computeEvidenceHash(subset);
  const h2 = computeEvidenceHash(subset);
  assert.strictEqual(h1, h2);
  assert.strictEqual(h1, ev.evidence_hash);
  assert.match(h1, /^[0-9a-f]{64}$/);
  const changed = computeEvidenceHash({ ...subset, headline: 'different' });
  assert.notStrictEqual(changed, h1);
  throwsValidation(() => assertEvidenceItem({
    ...ev,
    evidence_hash: 'a'.repeat(64),
  }, { tenantId: TENANT_A }));
  const recomputed = assertEvidenceItem({ ...ev, evidence_hash: undefined }, { tenantId: TENANT_A });
  assert.strictEqual(recomputed.evidence_hash, h1);
  assert.strictEqual(recomputed.dedup_key, h1);
});

test('10. same external id objects for two tenants both validate', () => {
  const a = { ...metaCompetitor(), tenant_id: TENANT_A };
  const b = { ...metaCompetitor(), tenant_id: TENANT_B, id: 'comp-meta-001' };
  const outA = assertCompetitor(a, { tenantId: TENANT_A });
  const outB = assertCompetitor(b, { tenantId: TENANT_B });
  assert.strictEqual(outA.provider_advertiser_id, outB.provider_advertiser_id);
  assert.strictEqual(outA.tenant_id, TENANT_A);
  assert.strictEqual(outB.tenant_id, TENANT_B);
  const evA = { ...metaEvidence(), tenant_id: TENANT_A };
  const evB = { ...metaEvidence(), tenant_id: TENANT_B };
  assert.strictEqual(assertEvidenceItem(evA, { tenantId: TENANT_A }).provider_external_id, 'ext-meta-ad-001');
  assert.strictEqual(assertEvidenceItem(evB, { tenantId: TENANT_B }).tenant_id, TENANT_B);
  const dedup = computeCompetitorDedupKey({
    platform: 'meta',
    provider_advertiser_id: 'ext-meta-page-001',
  });
  assert.strictEqual(outA.dedup_key, dedup);
  assert.strictEqual(outB.dedup_key, dedup);
});

test('11. provenance fields present on every fixture evidence item', () => {
  const files = ['meta.v1.json', 'google.v1.json', 'tiktok.v1.json', 'connector-pagination.v1.json'];
  const items = [];
  for (const name of files) {
    const doc = loadJson(name);
    const pages = doc.pages || [doc];
    for (const page of pages) {
      const normalized = assertConnectorPage(page, { tenantId: TENANT_A });
      items.push(...normalized.evidence);
    }
  }
  assert.ok(items.length >= 4);
  for (const ev of items) {
    assert.ok(C.PLATFORMS.includes(ev.platform), 'platform');
    assert.ok(ev.canonical_source_url || ev.provider_external_id, 'source URL or provider_external_id');
    if (ev.canonical_source_url) {
      assert.ok(ev.canonical_source_url.startsWith('https://'));
    }
    assert.ok(ev.captured_at, 'captured_at');
    assert.ok(ev.research_run_id, 'research_run_id');
    assert.ok(C.CONNECTOR_IDS.includes(ev.connector_id), 'connector_id');
    assert.ok(ev.connector_version, 'connector_version');
    assert.strictEqual(ev.contract_version, 'v1');
    assert.match(ev.evidence_hash, /^[0-9a-f]{64}$/);
    assert.ok(C.PROVENANCE_METHODS.includes(ev.provenance_method));
  }
});

test('12. new modules do not require http clients or call fetch; no live connectors added', () => {
  const files = [
    'services/agent_orchestrator/research_contracts.js',
    'services/agent_orchestrator/research_errors.js',
    'services/agent_orchestrator/research_validate.js',
    'services/agent_orchestrator/research_connector.js',
  ];
  const requireRe = /require\(\s*['"](?:https|http|node-fetch|undici)['"]\s*\)/;
  const fetchRe = /\bfetch\s*\(/;
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(requireRe.test(src), false, `${rel} must not require http clients`);
    assert.equal(fetchRe.test(src), false, `${rel} must not call fetch`);
  }
  assert.equal(
    fs.existsSync(path.join(ROOT, 'services/agent_orchestrator/connectors/meta_research.js')),
    false,
    'PR3B connector file must not be added in PR3A'
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'services/agent_orchestrator/connectors/google_research.js')),
    false,
    'PR3C connector file must not be added in PR3A'
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'services/agent_orchestrator/connectors/tiktok_research.js')),
    false,
    'PR3D connector file must not be added in PR3A'
  );
});

test('13. metrics_kind is labelled; fixtures do not claim verified facts', () => {
  const names = ['meta.v1.json', 'google.v1.json', 'tiktok.v1.json'];
  const kinds = new Set();
  for (const name of names) {
    const src = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
    assert.equal(/\bverified\b/i.test(src) && /independently/.test(src), false);
    assert.doesNotMatch(src, /independently_verified/);
    const page = assertConnectorPage(loadJson(name), { tenantId: TENANT_A });
    for (const ev of page.evidence) {
      assert.ok(C.METRICS_KINDS.includes(ev.metrics_kind), `${name} metrics_kind`);
      kinds.add(ev.metrics_kind);
      assert.equal(Object.prototype.hasOwnProperty.call(ev, 'verified'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(ev.provider_metrics, 'verified'), false);
      assert.equal(typeof ev.provider_metrics, 'object');
      assert.ok(!Array.isArray(ev.provider_metrics));
    }
  }
  assert.ok(kinds.has('provider_reported'));
  assert.ok(kinds.has('estimated'), 'google fixture should demonstrate estimated metrics_kind');
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    metrics_kind: 'verified',
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({
    ...metaEvidence(),
    provider_metrics: { verified: true },
  }, { tenantId: TENANT_A }));
});

test('research run validator returns INSERT-ready v1 object; connector request matches', () => {
  const run = assertResearchRun({
    ...SAMPLE_RUN,
    requested_platforms: ['tiktok', 'meta', 'google'],
    extra_provider_flag: true,
  }, { tenantId: TENANT_A });
  assert.strictEqual(run.contract_version, 'v1');
  assert.deepStrictEqual(run.requested_platforms, ['tiktok', 'meta', 'google']);
  assert.equal(Object.prototype.hasOwnProperty.call(run, 'extra_provider_flag'), false);
  throwsValidation(() => assertResearchRun({
    ...SAMPLE_RUN,
    requested_platforms: ['meta', 'meta'],
  }, { tenantId: TENANT_A }));
  const req = assertConnectorRequest(SAMPLE_REQUEST, { tenantId: TENANT_A });
  assert.strictEqual(req.connector_id, 'meta_research');
  assert.strictEqual(req.cursor, null);
  throwsValidation(() => assertConnectorRequest({
    ...SAMPLE_REQUEST,
    requested_platforms: ['google'],
  }, { tenantId: TENANT_A }));
});

test('HTTPS shape check rejects http, data, javascript, and credentials-in-URL', () => {
  const ev = metaEvidence();
  throwsValidation(() => assertEvidenceItem({ ...ev, canonical_source_url: 'http://example.com/ad' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({ ...ev, canonical_source_url: 'javascript:alert(1)' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertEvidenceItem({ ...ev, canonical_source_url: 'https://user:pass@example.com/ad' }, { tenantId: TENANT_A }));
  throwsValidation(() => assertCompetitor({
    ...metaCompetitor(),
    canonical_url: 'data:text/html,hi',
  }, { tenantId: TENANT_A }));
});

test('notImplemented throws terminal connector error without HTTP mapping', () => {
  assert.throws(
    () => notImplemented('meta_research'),
    (err) => err instanceof ConnectorError && err.code === 'terminal' && err.retry_class === 'terminal'
  );
  throwsValidation(() => notImplemented('facebook_research'));
});

// Security review (PR 3A). `error_message` is the one column that carries text
// a provider chose, and it is written on the run row rather than the
// append-only evidence row — so it is the easiest place for a token to land.
test('credential material cannot reach error_message, connector message, or evidence text', () => {
  const leaks = [
    'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    'Cookie: infogenie.sid=s%3Aabc123.def',
    'GET /x?api_key=sk-live-ABCDEFGHIJKLMNOP failed',
    'client_secret: 9f8e7d',
  ];
  for (const leak of leaks) {
    throwsValidation(() => assertResearchRun({
      ...SAMPLE_RUN,
      failure_class: 'auth_failure',
      error_message: leak,
    }, { tenantId: TENANT_A }));
    throwsValidation(() => assertConnectorError({
      ok: false,
      error: 'auth_failure',
      retry_class: 'terminal',
      message: leak,
    }));
    throwsValidation(() => assertEvidenceItem({ ...metaEvidence(), body_text: leak }, { tenantId: TENANT_A }));
  }
  // The taxonomy's own wording still survives the scan.
  const kept = assertConnectorError({
    ok: false,
    error: 'auth_failure',
    retry_class: 'terminal',
    message: 'connector credentials rejected; do not retry with the same credentials',
  });
  assert.match(kept.message, /^connector credentials rejected/);
  const run = assertResearchRun({
    ...SAMPLE_RUN,
    failure_class: 'auth_failure',
    error_message: 'provider refused the request',
  }, { tenantId: TENANT_A });
  assert.strictEqual(run.error_message, 'provider refused the request');
});

// PR3E inserts what the validator returned. If that object still aliases the
// connector's own JSON, a forbidden key can be added after the checks pass and
// before the INSERT, and the row is then immutable.
test('validated payloads are detached from caller JSON and frozen through nesting', () => {
  const supplied = { cursor: 'opaque-1' };
  const run = assertResearchRun({ ...SAMPLE_RUN, continuation_state: supplied }, { tenantId: TENANT_A });
  supplied.access_token = 'LEAK';
  assert.notStrictEqual(run.continuation_state, supplied);
  assert.deepStrictEqual(run.continuation_state, { cursor: 'opaque-1' });
  assert.ok(Object.isFrozen(run.continuation_state));
  assert.ok(Object.isFrozen(run.search_parameters));
  assert.ok(Object.isFrozen(run.requested_platforms));

  const metrics = { impressions_range: '100K-500K' };
  const ev = assertEvidenceItem({ ...metaEvidence(), provider_metrics: metrics }, { tenantId: TENANT_A });
  metrics.refresh_token = 'LEAK';
  assert.deepStrictEqual(ev.provider_metrics, { impressions_range: '100K-500K' });
  assert.ok(Object.isFrozen(ev.provider_metrics));
});

test('validated connector requests are frozen through nesting and detached from caller arrays', () => {
  const platforms = ['meta'];
  const req = assertConnectorRequest({
    ...SAMPLE_REQUEST,
    requested_platforms: platforms,
    continuation_state: { cursor: 'opaque-1' },
  }, { tenantId: TENANT_A });
  assert.ok(Object.isFrozen(req));
  assert.ok(Object.isFrozen(req.requested_platforms));
  assert.ok(Object.isFrozen(req.search_parameters));
  assert.ok(Object.isFrozen(req.continuation_state));
  assert.throws(() => req.requested_platforms.push('tiktok'), TypeError);
  assert.throws(() => { req.requested_platforms[0] = 'tiktok'; }, TypeError);
  assert.deepStrictEqual(req.requested_platforms, ['meta']);

  // The caller keeps its own mutable array; the validated copy does not move.
  platforms.push('google');
  assert.deepStrictEqual(req.requested_platforms, ['meta']);
  assert.notStrictEqual(req.requested_platforms, platforms);

  const run = assertResearchRun(SAMPLE_RUN, { tenantId: TENANT_A });
  assert.throws(() => run.requested_platforms.push('tiktok'), TypeError);
});

test('connector_version is scanned for credential material, not just length', () => {
  const leaks = [
    '1.0.0 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    '1.0.0 token=abcdef',
    'access_token',
    '1.0.0\u0000drop',
  ];
  for (const leak of leaks) {
    throwsValidation(() => assertConnectorRequest({
      ...SAMPLE_REQUEST,
      connector_version: leak,
    }, { tenantId: TENANT_A }));
    throwsValidation(() => assertConnectorPage({
      ...loadJson('meta.v1.json'),
      connector_version: leak,
    }, { tenantId: TENANT_A }));
  }
  throwsValidation(() => assertConnectorRequest({
    ...SAMPLE_REQUEST,
    connector_version: '',
  }, { tenantId: TENANT_A }));
  throwsValidation(() => assertConnectorRequest({
    ...SAMPLE_REQUEST,
    connector_version: 'v'.repeat(65),
  }, { tenantId: TENANT_A }));
  const ok = assertConnectorRequest({ ...SAMPLE_REQUEST, connector_version: '1.0.0' }, { tenantId: TENANT_A });
  assert.strictEqual(ok.connector_version, '1.0.0');
});

test('honesty flags are rejected at any depth in provider_metrics', () => {
  for (const metrics of [
    { verified: true },
    { inner: { verified: true } },
    { inner: { deeper: { independently_verified: true } } },
    { list: [{ fact: 'yes' }] },
  ]) {
    throwsValidation(() => assertEvidenceItem({ ...metaEvidence(), provider_metrics: metrics }, { tenantId: TENANT_A }));
  }
});

test('CONTRACT_VERSION is v1 and connector ids match schema', () => {
  assert.strictEqual(C.CONTRACT_VERSION, 'v1');
  assert.deepStrictEqual([...C.PLATFORMS], ['meta', 'google', 'tiktok']);
  assert.deepStrictEqual([...CONNECTOR_IDS], ['meta_research', 'google_research', 'tiktok_research']);
  assert.deepStrictEqual([...C.FAILURE_CLASSES], [
    'rate_limit', 'auth_failure', 'transient', 'invalid_response', 'policy_rejection', 'terminal',
  ]);
});

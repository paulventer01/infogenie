'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { logger } = require('../services/infra/logger');
const { OrchError } = require('../services/agent_orchestrator/errors');
const { sweepExpiredResearchEvidence } = require('../services/agent_orchestrator/research_retention');
const {
  DELETE_LEGACY_RESEARCH_EVIDENCE,
  CLEANUP_BATCH,
  previewLegacyCleanup,
  approveLegacyCleanup,
  executeLegacyCleanup,
} = require('../services/agent_orchestrator/research_cleanup');
const { ensureResearchLimits } = require('../services/agent_orchestrator/research_store');

const HAS_DB = db.hasDb();
const SHA256_A = 'a'.repeat(64);
const SHA256_C = 'c'.repeat(64);
const SUFFIX = `aorcl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RAW_EMAIL = 'ops@ads.example';
const RAW_PHONE = '+1 (415) 555-0100';
let seq = 0;
function nid(prefix) {
  seq += 1;
  return `${prefix}-${SUFFIX}-${seq}`;
}

function wrapPool(origPool, hooks = {}) {
  return {
    query: async (sql, params) => {
      if (typeof hooks.query === 'function') {
        const hijack = await hooks.query(sql, params);
        if (hijack !== undefined) return hijack;
      }
      return origPool.query(sql, params);
    },
    connect: async () => {
      const client = await origPool.connect();
      return {
        query: async (sql, params) => {
          if (typeof hooks.clientQuery === 'function') {
            const hijack = await hooks.clientQuery(sql, params);
            if (hijack !== undefined) return hijack;
          }
          return client.query(sql, params);
        },
        release: (err) => client.release(err),
      };
    },
  };
}

function captureLogs(fn) {
  const lines = [];
  const origInfo = logger.info;
  const origError = logger.error;
  const origWarn = logger.warn;
  const origLog = console.log;
  const origErr = console.error;
  const origWarnC = console.warn;
  logger.info = (msg, fields) => {
    lines.push(JSON.stringify({ msg, ...(fields || {}) }));
    return origInfo(msg, fields);
  };
  logger.error = (msg, fields) => {
    lines.push(JSON.stringify({ msg, ...(fields || {}) }));
    return origError(msg, fields);
  };
  logger.warn = (msg, fields) => {
    lines.push(JSON.stringify({ msg, ...(fields || {}) }));
    return origWarn(msg, fields);
  };
  console.log = (...args) => { lines.push(args.map(String).join(' ')); };
  console.error = (...args) => { lines.push(args.map(String).join(' ')); };
  console.warn = (...args) => { lines.push(args.map(String).join(' ')); };
  const restore = () => {
    logger.info = origInfo;
    logger.error = origError;
    logger.warn = origWarn;
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarnC;
  };
  return { lines, restore, run: async () => {
    try { return await fn(); } finally { restore(); }
  } };
}

function assertNoRawContact(joined) {
  assert.ok(!joined.includes(RAW_EMAIL), 'logs must not contain raw email');
  assert.ok(!joined.includes(RAW_PHONE), 'logs must not contain raw phone');
  assert.ok(!joined.includes('555-0100'), 'logs must not contain phone fragments');
}

async function insertWorkflow(p, tenantId, wfId) {
  await p.query(
    `INSERT INTO orchestrator_workflows (id, tenant_id, name) VALUES ($1,$2,$3)`,
    [wfId, tenantId, `research host ${wfId}`]
  );
}

async function insertApproval(p, tenantId, wfId) {
  const row = (await p.query(
    `INSERT INTO orchestrator_approvals
       (tenant_id, workflow_id, gate, content_hash, decision, object_version, approved_platforms)
     VALUES ($1,$2,'research_execution',$3,'approved',1,$4::jsonb)
     RETURNING id`,
    [tenantId, wfId, `hash-${wfId}`, JSON.stringify(['meta', 'google', 'tiktok'])]
  )).rows[0];
  return row.id;
}

async function insertRun(p, tenantId, wfId, approvalId) {
  const id = nid('run');
  await p.query(
    `INSERT INTO orchestrator_research_runs
       (id, tenant_id, workflow_id, approval_id, approval_object_version,
        requested_platforms, idempotency_key, state, research_brief, search_parameters)
     VALUES ($1,$2,$3,$4,1,$5::text[],$6,'pending','','{}'::jsonb)`,
    [id, tenantId, wfId, approvalId, ['meta'], nid('idemp')]
  );
  return id;
}

async function seedHost(p, tenantId) {
  const wfId = nid('wf');
  await insertWorkflow(p, tenantId, wfId);
  const approvalId = await insertApproval(p, tenantId, wfId);
  const runId = await insertRun(p, tenantId, wfId, approvalId);
  return { wfId, approvalId, runId };
}

async function insertComp(p, tenantId, runId) {
  const id = nid('comp');
  await p.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        discovery_source, captured_at, dedup_key)
     VALUES ($1,$2,$3,'meta',$4,'Acme Ads','ad_library', now(), $5)`,
    [id, tenantId, runId, nid('adv'), nid('cdedup')]
  );
  return id;
}

async function insertEvidenceRow(p, tenantId, runId, competitorId, extra = {}) {
  const id = extra.id || nid('ev');
  const createdAt = extra.createdAt || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const hasExpires = Object.prototype.hasOwnProperty.call(extra, 'expiresAt');
  const expiresAt = hasExpires ? extra.expiresAt : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, canonical_source_url, headline, body_text, excerpt, advertiser_name,
        captured_at, provider_metrics, provenance_method, connector_id, connector_version,
        content_fingerprint, dedup_key, retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,'meta','ad_creative',$5,$6,$7,$8,$9,$10,$11::timestamptz,'{}'::jsonb,
             'ad_library','meta_research','1.0.0',$12,$13,$14,$15::timestamptz,$16::timestamptz)`,
    [
      id, tenantId, runId, competitorId,
      extra.ext || nid('ext'),
      extra.url || `https://www.facebook.com/ads/library/?id=${nid('ad')}`,
      extra.headline || 'hl',
      extra.bodyText || 'body',
      extra.excerpt || 'ex',
      extra.advertiserName || 'Acme',
      extra.capturedAt || createdAt,
      extra.fingerprint || SHA256_A,
      extra.dedupKey || nid('ededup'),
      extra.retentionClass || 'standard',
      expiresAt,
      createdAt,
    ]
  );
  return id;
}

async function insertAssetRow(p, tenantId, evidenceId, extra = {}) {
  const id = extra.id || nid('asset');
  const createdAt = extra.createdAt || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const expiresAt = Object.prototype.hasOwnProperty.call(extra, 'expiresAt')
    ? extra.expiresAt
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO orchestrator_research_evidence_assets
       (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at,
        retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,'image',$4,$5,$6::timestamptz,$7,$8::timestamptz,$9::timestamptz)`,
    [
      id, tenantId, evidenceId,
      extra.storageRef || `research://meta/${id}`,
      extra.checksum || SHA256_C,
      extra.capturedAt || createdAt,
      extra.retentionClass || 'standard',
      expiresAt,
      createdAt,
    ]
  );
  return id;
}

async function insertHold(p, tenantId, kind, targetId, reason = 'missing_expiry') {
  await p.query(
    `INSERT INTO orchestrator_research_legacy_holds (tenant_id, target_kind, target_id, reason)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id, target_kind, target_id) DO NOTHING`,
    [tenantId, kind, targetId, reason]
  );
}

if (!HAS_DB) {
  test('advertising-orchestrator research cleanup skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;
  let actorUserId = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AORCL A ${SUFFIX}`, `aorcl-a-${SUFFIX}`);
    tenantB = await mk(`AORCL B ${SUFFIX}`, `aorcl-b-${SUFFIX}`);
    await ensureResearchLimits(p, tenantA, { records: 100000, bytes: 104857600 });
    await ensureResearchLimits(p, tenantB, { records: 100000, bytes: 104857600 });
    actorUserId = (await p.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1,'x',$2) RETURNING id`,
      [`aorcl-actor-${SUFFIX}@example.com`, `AORCL actor ${SUFFIX}`]
    )).rows[0].id;
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (ids.length) await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
    if (actorUserId) await p.query(`DELETE FROM users WHERE id=$1`, [actorUserId]);
  });

  test('module exports confirmation phrase and does not open HTTP', () => {
    assert.strictEqual(DELETE_LEGACY_RESEARCH_EVIDENCE, 'DELETE_LEGACY_RESEARCH_EVIDENCE');
    assert.strictEqual(CLEANUP_BATCH, 100);
    const src = fs.readFileSync(
      path.join(__dirname, '../services/agent_orchestrator/research_cleanup.js'),
      'utf8'
    );
    assert.match(src, /timingSafeEqual/);
    assert.match(src, /confirmation_sha256/);
    assert.match(src, /orchestrator_research_cleanup_targets/);
    assert.doesNotMatch(src, /infogenie\.research_cleanup/);
    assert.match(src, /lock_timeout/);
    assert.match(src, /tenant_id=\$1/);
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /app\.(?:get|post|use)/);
    const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.doesNotMatch(serverSrc, /approveLegacyCleanup/);
    assert.doesNotMatch(serverSrc, /executeLegacyCleanup/);
  });

  test('boot/ensure does not delete held rows; sweep skips them', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const heldId = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, headline: RAW_EMAIL, bodyText: RAW_PHONE,
    });
    const heldAsset = await insertAssetRow(p, tenantA, heldId, { createdAt, expiresAt: expiredAt });
    await insertHold(p, tenantA, 'evidence', heldId);
    await insertHold(p, tenantA, 'asset', heldAsset);

    await ensureAgentOrchestratorSchema();
    const still = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, heldId]
    )).rows;
    assert.strictEqual(still.length, 1, 'ensure must not delete held evidence');

    const swept = await sweepExpiredResearchEvidence({ tenantId: tenantA, skipHolds: true });
    assert.ok(swept);
    const kept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, heldId]
    )).rows;
    assert.strictEqual(kept.length, 1, 'boot-style skipHolds must skip held evidence');
    const assetKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, heldAsset]
    )).rows;
    assert.strictEqual(assetKept.length, 1, 'sweep must skip held assets');
  });

  test('preview dry-run counts holds and never deletes', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evIds = [];
    for (let i = 0; i < 3; i += 1) {
      const id = await insertEvidenceRow(p, tenantA, host.runId, comp, { headline: RAW_EMAIL });
      await insertHold(p, tenantA, 'evidence', id);
      evIds.push(id);
    }
    const assetId = await insertAssetRow(p, tenantA, evIds[0]);
    await insertHold(p, tenantA, 'asset', assetId);

    const key = nid('idemp-preview');
    const first = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.state, 'previewed');
    assert.ok(first.dry_run_evidence_count >= 3);
    assert.ok(first.dry_run_assets_count >= 1);

    const second = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.state, 'previewed');

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantA, evIds]
    )).rows[0].n;
    assert.strictEqual(leftover, 3, 'preview must not delete');
    const stored = (await p.query(
      `SELECT confirmation_sha256, state FROM orchestrator_research_cleanup_ops
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, first.id]
    )).rows[0];
    assert.strictEqual(stored.state, 'previewed');
    assert.strictEqual(stored.confirmation_sha256, null);
    const targets = (await p.query(
      `SELECT target_kind, target_id FROM orchestrator_research_cleanup_targets
        WHERE tenant_id=$1 AND op_id=$2`,
      [tenantA, first.id]
    )).rows;
    assert.ok(targets.some((row) => row.target_kind === 'evidence' && evIds.includes(row.target_id)));
    assert.ok(targets.some((row) => row.target_kind === 'asset' && row.target_id === assetId));
  });

  test('execute without approve fails; wrong confirmation fails', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evId = await insertEvidenceRow(p, tenantA, host.runId, comp);
    await insertHold(p, tenantA, 'evidence', evId);
    const key = nid('idemp-refuse');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });

    await assert.rejects(
      () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.reason === 'not_approved'
    );
    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, opId: preview.id, actorUserId, confirmation: 'please-delete',
      }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'confirmation'
    );

    const still = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(still.length, 1);
  });

  test('approve + execute purges held rows in batches; second execute is idempotent', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const n = CLEANUP_BATCH + 5;
    const evIds = [];
    for (let i = 0; i < n; i += 1) {
      const id = await insertEvidenceRow(p, tenantA, host.runId, comp, {
        headline: RAW_EMAIL, bodyText: `Call ${RAW_PHONE}`,
      });
      await insertHold(p, tenantA, 'evidence', id);
      evIds.push(id);
    }
    const assetId = await insertAssetRow(p, tenantA, evIds[0]);
    await insertHold(p, tenantA, 'asset', assetId);

    const key = nid('idemp-exec');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.ok(preview.dry_run_evidence_count >= n);

    const approved = await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, actorUserId,
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    assert.strictEqual(approved.state, 'approved');
    const digest = (await p.query(
      `SELECT confirmation_sha256 FROM orchestrator_research_cleanup_ops WHERE tenant_id=$1 AND id=$2`,
      [tenantA, approved.id]
    )).rows[0].confirmation_sha256;
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(digest, DELETE_LEGACY_RESEARCH_EVIDENCE);

    const cap = captureLogs(async () => executeLegacyCleanup({ tenantId: tenantA, opId: approved.id }));
    const executed = await cap.run();
    assert.strictEqual(executed.state, 'completed');
    assert.ok(executed.purged_evidence_count >= n);
    assertNoRawContact(cap.lines.join('\n'));

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantA, evIds]
    )).rows[0].n;
    assert.strictEqual(leftover, 0);
    const holdsLeft = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_legacy_holds
        WHERE tenant_id=$1 AND target_id = ANY($2::text[])`,
      [tenantA, [...evIds, assetId]]
    )).rows[0].n;
    assert.strictEqual(holdsLeft, 0);

    const again = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(again.state, 'completed');
    assert.strictEqual(again.purged_evidence_count, 0);
    assert.strictEqual(again.idempotent, true);
  });

  test('execute deletes only the preview snapshot; later holds survive completed re-run', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const idA = await insertEvidenceRow(p, tenantA, host.runId, comp, { headline: RAW_EMAIL });
    await insertHold(p, tenantA, 'evidence', idA, 'missing_expiry');

    const key = nid('idemp-snapshot');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    const snapA = (await p.query(
      `SELECT target_id FROM orchestrator_research_cleanup_targets
        WHERE tenant_id=$1 AND op_id=$2 AND target_kind='evidence'`,
      [tenantA, preview.id]
    )).rows.map((row) => row.target_id);
    assert.ok(snapA.includes(idA), 'preview must snapshot hold A');

    const idB = await insertEvidenceRow(p, tenantA, host.runId, comp, { headline: RAW_PHONE });
    await insertHold(p, tenantA, 'evidence', idB, 'missing_expiry');
    const idOff = await insertEvidenceRow(p, tenantA, host.runId, comp);
    await insertHold(p, tenantA, 'evidence', idOff, 'legacy_short_due');

    const afterAdd = (await p.query(
      `SELECT target_id FROM orchestrator_research_cleanup_targets
        WHERE tenant_id=$1 AND op_id=$2 AND target_kind='evidence'`,
      [tenantA, preview.id]
    )).rows.map((row) => row.target_id);
    assert.ok(!afterAdd.includes(idB), 'snapshot must stay frozen after preview');
    assert.ok(!afterAdd.includes(idOff), 'off-snapshot hold must not join the preview set');

    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, actorUserId,
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    const executed = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(executed.state, 'completed');

    const aGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const bKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idB]
    )).rows;
    const offKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idOff]
    )).rows;
    assert.strictEqual(aGone.length, 0, 'snapshot A must be purged');
    assert.strictEqual(bKept.length, 1, 'hold B added after preview must remain');
    assert.strictEqual(offKept.length, 1, 'off-snapshot hold must remain after execute');

    const again = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(again.state, 'completed');
    assert.strictEqual(again.idempotent, true);
    assert.strictEqual(again.purged_evidence_count, 0);
    const bStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idB]
    )).rows;
    const offStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idOff]
    )).rows;
    assert.strictEqual(bStill.length, 1, 'completed op must not delete leftover B');
    assert.strictEqual(offStill.length, 1, 'completed op must not delete off-snapshot holds');
  });

  test('retry after injected failure resumes', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evId = await insertEvidenceRow(p, tenantA, host.runId, comp, { bodyText: RAW_PHONE });
    await insertHold(p, tenantA, 'evidence', evId);
    const key = nid('idemp-retry');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, actorUserId,
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });

    let evidenceDeletes = 0;
    const origGetPool = db.getPool;
    const origPool = db.getPool();
    db.getPool = () => wrapPool(origPool, {
      clientQuery: async (sql, params) => {
        if (
          params && params[0] === tenantA
          && /DELETE FROM orchestrator_research_evidence\b/.test(sql)
        ) {
          evidenceDeletes += 1;
          if (evidenceDeletes === 1) {
            throw Object.assign(new Error('injected-cleanup-fail'), { code: 'XX000' });
          }
        }
        return undefined;
      },
    });
    try {
      await assert.rejects(
        () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key }),
        (err) => err && err.code === 'XX000'
      );
    } finally {
      db.getPool = origGetPool;
    }

    const failed = (await origPool.query(
      `SELECT state FROM orchestrator_research_cleanup_ops WHERE tenant_id=$1 AND idempotency_key=$2`,
      [tenantA, key]
    )).rows[0];
    assert.strictEqual(failed.state, 'failed');
    const still = (await origPool.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(still.length, 1, 'injected failure must not skip the delete');

    const resumed = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(resumed.state, 'completed');
    const gone = (await origPool.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(gone.length, 0);
  });

  test('cross-tenant execute does not touch the other tenant', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const compA = await insertComp(p, tenantA, hostA.runId);
    const compB = await insertComp(p, tenantB, hostB.runId);
    const idA = await insertEvidenceRow(p, tenantA, hostA.runId, compA);
    const idB = await insertEvidenceRow(p, tenantB, hostB.runId, compB);
    await insertHold(p, tenantA, 'evidence', idA);
    await insertHold(p, tenantB, 'evidence', idB);

    const keyA = nid('idemp-iso-a');
    const keyB = nid('idemp-iso-b');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyA });
    const previewB = await previewLegacyCleanup({ tenantId: tenantB, idempotencyKey: keyB });
    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: keyA, actorUserId,
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyA });

    const aGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const bKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantB, idB]
    )).rows;
    assert.strictEqual(aGone.length, 0);
    assert.strictEqual(bKept.length, 1);
    const bHold = (await p.query(
      `SELECT 1 FROM orchestrator_research_legacy_holds WHERE tenant_id=$1 AND target_id=$2`,
      [tenantB, idB]
    )).rows;
    assert.strictEqual(bHold.length, 1);
    assert.strictEqual(previewB.state, 'previewed');
  });

  test('held missing_expiry is excluded from invalid_expiry; unheld NULL still fail-closes', async () => {
    const p = db.getPool();
    const origGetPool = db.getPool;
    const expirySql =
      `retention_class = 'legal_hold' OR (expires_at IS NOT NULL AND expires_at > created_at)`;
    const gate = await p.connect();
    const client = await p.connect();
    const heldNullId = nid('ev-held-null');
    const unheldNullId = nid('ev-unheld-null');
    try {
      await gate.query('SELECT pg_advisory_lock($1)', [87231402]);
      await client.query('BEGIN');
      await client.query(
        `ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_retention_expiry_check`
      );
      const host = await seedHost(client, tenantA);
      const comp = await insertComp(client, tenantA, host.runId);
      await insertEvidenceRow(client, tenantA, host.runId, comp, {
        id: heldNullId, expiresAt: null, headline: RAW_EMAIL,
      });
      await insertHold(client, tenantA, 'evidence', heldNullId);
      await insertEvidenceRow(client, tenantA, host.runId, comp, {
        id: unheldNullId, expiresAt: null,
      });
      await client.query(
        `ALTER TABLE orchestrator_research_evidence
           ADD CONSTRAINT orchestrator_research_evidence_retention_expiry_check
           CHECK (${expirySql}) NOT VALID`
      );
      await client.query('COMMIT');

      db.getPool = () => wrapPool(p, {
        query: async (sql) => {
          if (/UNION/i.test(sql) && /orchestrator_research_evidence/.test(sql)) {
            return { rows: [{ tenant_id: tenantA }], rowCount: 1 };
          }
          return undefined;
        },
      });
      const dirty = await sweepExpiredResearchEvidence({ tenantId: tenantA });
      assert.strictEqual(dirty.ok, false, 'unheld NULL expiry must fail-close');
      assert.ok(dirty.invalid_expiry >= 1);

      await insertHold(p, tenantA, 'evidence', unheldNullId);
      const clean = await sweepExpiredResearchEvidence({ tenantId: tenantA });
      assert.strictEqual(clean.invalid_expiry, 0, 'held missing_expiry must not count as invalid_expiry');
      assert.strictEqual(clean.failures, 0);
      assert.strictEqual(clean.ok, true);

      const heldStill = (await p.query(
        `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, heldNullId]
      )).rows;
      assert.strictEqual(heldStill.length, 1);
    } finally {
      db.getPool = origGetPool;
      try {
        await client.query('ROLLBACK');
      } catch { /* ignore */ }
      try {
        await p.query(
          `ALTER TABLE orchestrator_research_evidence DROP CONSTRAINT IF EXISTS orchestrator_research_evidence_retention_expiry_check`
        );
        await p.query(
          `ALTER TABLE orchestrator_research_evidence
             ADD CONSTRAINT orchestrator_research_evidence_retention_expiry_check
             CHECK (${expirySql}) NOT VALID`
        );
      } catch { /* parallel files may race the constraint */ }
      client.release();
      try { await gate.query('SELECT pg_advisory_unlock($1)', [87231402]); } catch { /* ignore */ }
      gate.release();
    }
  });

  test('cleanup and sweep logs never contain raw contact or headlines', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evId = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      headline: `Secret ${RAW_EMAIL}`,
      bodyText: `Call ${RAW_PHONE}`,
      excerpt: RAW_EMAIL,
    });
    await insertHold(p, tenantA, 'evidence', evId);
    const key = nid('idemp-logs');
    const cap = captureLogs(async () => {
      await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
      await assert.rejects(
        () => approveLegacyCleanup({
          tenantId: tenantA, idempotencyKey: key, actorUserId, confirmation: 'nope',
        })
      );
      await approveLegacyCleanup({
        tenantId: tenantA, idempotencyKey: key, actorUserId,
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      });
      await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    });
    await cap.run();
    const joined = cap.lines.join('\n');
    assertNoRawContact(joined);
    assert.ok(!joined.includes('Secret '), 'headline copy must not be logged');
  });
}

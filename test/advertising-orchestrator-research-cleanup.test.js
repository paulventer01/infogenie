'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
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

  function actorReq(id) {
    return { user: { id: id == null ? actorUserId : id } };
  }

  function expectedSnapshotSha256(rows) {
    const lines = (rows || [])
      .map((row) => `${row.target_kind}\0${row.target_id}`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
  }

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
    assert.match(src, /snapshot_sha256/);
    assert.match(src, /orchestrator_research_cleanup_targets/);
    assert.match(src, /Number\(req && req\.user && req\.user\.id\)/);
    assert.doesNotMatch(src, /require\(\s*['"]\.\/runner['"]\s*\)/);
    assert.doesNotMatch(src, /infogenie\.research_cleanup/);
    assert.match(src, /lock_timeout/);
    assert.match(src, /tenant_id=\$1/);
    assert.match(src, /retention_class <> 'legal_hold'/);
    assert.match(src, /expires_at IS NOT NULL/);
    assert.match(src, /expires_at <= now\(\)/);
    assert.match(src, /NOT EXISTS/);
    assert.match(src, /orchestrator_research_evidence_assets/);
    const execBlock = src.slice(
      src.indexOf('async function executeLegacyCleanup'),
      src.indexOf('module.exports')
    );
    const assetIdx = execBlock.indexOf("_purgeHeldKind(client, tid, started.id, 'asset')");
    const evidenceIdx = execBlock.indexOf("_purgeHeldKind(client, tid, started.id, 'evidence')");
    assert.ok(assetIdx >= 0 && evidenceIdx > assetIdx, 'execute must purge assets before evidence');
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
      `SELECT confirmation_sha256, snapshot_sha256, state FROM orchestrator_research_cleanup_ops
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, first.id]
    )).rows[0];
    assert.strictEqual(stored.state, 'previewed');
    assert.strictEqual(stored.confirmation_sha256, null);
    assert.match(stored.snapshot_sha256, /^[0-9a-f]{64}$/);
    const targets = (await p.query(
      `SELECT target_kind, target_id FROM orchestrator_research_cleanup_targets
        WHERE tenant_id=$1 AND op_id=$2`,
      [tenantA, first.id]
    )).rows;
    assert.ok(targets.some((row) => row.target_kind === 'evidence' && evIds.includes(row.target_id)));
    assert.ok(targets.some((row) => row.target_kind === 'asset' && row.target_id === assetId));
    assert.strictEqual(stored.snapshot_sha256, expectedSnapshotSha256(targets));
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
        tenantId: tenantA, opId: preview.id, req: actorReq(), confirmation: 'please-delete',
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
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const assetId = await insertAssetRow(p, tenantA, evIds[0], { createdAt, expiresAt: expiredAt });
    await insertHold(p, tenantA, 'asset', assetId);

    const key = nid('idemp-exec');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.ok(preview.dry_run_evidence_count >= n);

    const approved = await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, req: actorReq(),
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
    assert.ok(executed.purged_assets_count >= 1);
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
      tenantId: tenantA, idempotencyKey: key, req: actorReq(),
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

  test('caller actorUserId is refused; missing req.user is refused', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evId = await insertEvidenceRow(p, tenantA, host.runId, comp);
    await insertHold(p, tenantA, 'evidence', evId);
    const key = nid('idemp-actor');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });

    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, opId: preview.id, actorUserId,
        req: actorReq(), confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'actorUserId'
    );
    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, opId: preview.id,
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'req'
    );
    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, opId: preview.id, req: {},
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      }),
      (err) => err instanceof OrchError && err.code === 'auth_required'
    );
    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, opId: preview.id, req: { user: { id: 0 } },
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      }),
      (err) => err instanceof OrchError && err.code === 'auth_required'
    );

    const approved = await approveLegacyCleanup({
      tenantId: tenantA, opId: preview.id, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    assert.strictEqual(approved.state, 'approved');
    assert.strictEqual(approved.actor_user_id, Number(actorUserId));
    const still = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(still.length, 1, 'refused approve must not delete');
  });

  test('tampered cleanup_targets after preview refuse approve/execute; A and B stay', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const idA = await insertEvidenceRow(p, tenantA, host.runId, comp, { headline: RAW_EMAIL });
    await insertHold(p, tenantA, 'evidence', idA);
    const key = nid('idemp-tamper');
    const preview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    const storedHash = (await p.query(
      `SELECT snapshot_sha256 FROM orchestrator_research_cleanup_ops
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, preview.id]
    )).rows[0].snapshot_sha256;
    assert.match(storedHash, /^[0-9a-f]{64}$/);

    const idB = await insertEvidenceRow(p, tenantA, host.runId, comp, { headline: RAW_PHONE });
    await insertHold(p, tenantA, 'evidence', idB);
    await p.query(
      `INSERT INTO orchestrator_research_cleanup_targets
         (tenant_id, op_id, target_kind, target_id)
       VALUES ($1,$2,'evidence',$3)`,
      [tenantA, preview.id, idB]
    );

    const cap = captureLogs(async () => {
      await assert.rejects(
        () => approveLegacyCleanup({
          tenantId: tenantA, idempotencyKey: key, req: actorReq(),
          confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
        }),
        (err) => err instanceof OrchError && err.code === 'validation_failed'
          && err.extra && err.extra.field === 'snapshot_sha256'
      );
      await assert.rejects(
        () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key }),
        (err) => err instanceof OrchError && err.code === 'validation_failed'
      );
    });
    await cap.run();
    const joined = cap.lines.join('\n');
    assert.ok(!joined.includes(idA), 'logs must not contain raw target id A');
    assert.ok(!joined.includes(idB), 'logs must not contain raw target id B');
    assertNoRawContact(joined);

    const aKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const bKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idB]
    )).rows;
    assert.strictEqual(aKept.length, 1, 'tamper must fail closed; A stays');
    assert.strictEqual(bKept.length, 1, 'tamper must fail closed; B stays');

    const hostExec = await seedHost(p, tenantA);
    const compExec = await insertComp(p, tenantA, hostExec.runId);
    const idExecA = await insertEvidenceRow(p, tenantA, hostExec.runId, compExec);
    await insertHold(p, tenantA, 'evidence', idExecA);
    const keyExec = nid('idemp-tamper-exec');
    const previewExec = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyExec });
    const idExecB = await insertEvidenceRow(p, tenantA, hostExec.runId, compExec);
    await insertHold(p, tenantA, 'evidence', idExecB);
    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: keyExec, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    await p.query(
      `INSERT INTO orchestrator_research_cleanup_targets
         (tenant_id, op_id, target_kind, target_id)
       VALUES ($1,$2,'evidence',$3)`,
      [tenantA, previewExec.id, idExecB]
    );
    await assert.rejects(
      () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyExec }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'snapshot_sha256'
    );
    const execA = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idExecA]
    )).rows;
    const execB = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idExecB]
    )).rows;
    assert.strictEqual(execA.length, 1, 'execute mismatch must not DELETE A');
    assert.strictEqual(execB.length, 1, 'execute mismatch must not DELETE B');
    const state = (await p.query(
      `SELECT state FROM orchestrator_research_cleanup_ops WHERE tenant_id=$1 AND id=$2`,
      [tenantA, previewExec.id]
    )).rows[0].state;
    assert.strictEqual(state, 'approved', 'hash mismatch must not start DELETE / running');
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
      tenantId: tenantA, idempotencyKey: key, req: actorReq(),
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
      tenantId: tenantA, idempotencyKey: keyA, req: actorReq(),
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
          tenantId: tenantA, idempotencyKey: key, req: actorReq(), confirmation: 'nope',
        })
      );
      await approveLegacyCleanup({
        tenantId: tenantA, idempotencyKey: key, req: actorReq(),
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      });
      await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    });
    await cap.run();
    const joined = cap.lines.join('\n');
    assertNoRawContact(joined);
    assert.ok(!joined.includes('Secret '), 'headline copy must not be logged');
  });

  test('legal-hold and future-expiry assets survive cleanup; parents with them are retained', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const holdParent = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, headline: RAW_EMAIL,
    });
    const futureParent = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt,
    });
    const freeParent = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt,
    });
    const holdAsset = await insertAssetRow(p, tenantA, holdParent, {
      createdAt, expiresAt: expiredAt, retentionClass: 'legal_hold',
    });
    const futureAsset = await insertAssetRow(p, tenantA, futureParent, {
      createdAt, expiresAt: futureAt,
    });
    const expiredSnapAsset = await insertAssetRow(p, tenantA, freeParent, {
      createdAt, expiresAt: expiredAt,
    });

    await insertHold(p, tenantA, 'evidence', holdParent);
    await insertHold(p, tenantA, 'evidence', futureParent);
    await insertHold(p, tenantA, 'evidence', freeParent);
    await insertHold(p, tenantA, 'asset', holdAsset);
    await insertHold(p, tenantA, 'asset', futureAsset);
    await insertHold(p, tenantA, 'asset', expiredSnapAsset);

    const key = nid('idemp-protect');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    const executed = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(executed.state, 'completed');
    assert.ok(executed.purged_assets_count >= 1);
    assert.ok(executed.purged_evidence_count >= 1);

    const holdAssetStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, holdAsset]
    )).rows;
    const futureAssetStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, futureAsset]
    )).rows;
    const expiredAssetGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredSnapAsset]
    )).rows;
    assert.strictEqual(holdAssetStill.length, 1, 'legal-hold asset must survive parent cleanup');
    assert.strictEqual(futureAssetStill.length, 1, 'future-expiry asset must survive');
    assert.strictEqual(expiredAssetGone.length, 0, 'snapshot expired non-hold asset must be deleted');

    const holdParentStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, holdParent]
    )).rows;
    const futureParentStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, futureParent]
    )).rows;
    const freeParentGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, freeParent]
    )).rows;
    assert.strictEqual(holdParentStill.length, 1, 'parent of surviving legal-hold asset must be retained');
    assert.strictEqual(futureParentStill.length, 1, 'parent of surviving future-expiry asset must be retained');
    assert.strictEqual(freeParentGone.length, 0, 'parent with no remaining children must be purged');
  });

  test('expired off-snapshot assets survive; only snapshot-approved expired non-held assets are deleted', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const snapParent = await insertEvidenceRow(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt });
    const offParent = await insertEvidenceRow(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt });
    const snapExpired = await insertAssetRow(p, tenantA, snapParent, { createdAt, expiresAt: expiredAt });
    const offExpired = await insertAssetRow(p, tenantA, offParent, { createdAt, expiresAt: expiredAt });
    const offOnSnapParent = await insertAssetRow(p, tenantA, snapParent, { createdAt, expiresAt: expiredAt });

    await insertHold(p, tenantA, 'evidence', snapParent);
    await insertHold(p, tenantA, 'asset', snapExpired);
    const key = nid('idemp-off-snap');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });

    await insertHold(p, tenantA, 'evidence', offParent);
    await insertHold(p, tenantA, 'asset', offExpired);
    await insertHold(p, tenantA, 'asset', offOnSnapParent);

    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    const executed = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key });
    assert.strictEqual(executed.state, 'completed');

    const snapExpiredGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, snapExpired]
    )).rows;
    const offExpiredStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, offExpired]
    )).rows;
    const leftoverOnSnapParent = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, offOnSnapParent]
    )).rows;
    assert.strictEqual(snapExpiredGone.length, 0, 'snapshot-approved expired asset must be deleted');
    assert.strictEqual(offExpiredStill.length, 1, 'expired asset outside the approved snapshot must survive');
    assert.strictEqual(leftoverOnSnapParent.length, 1, 'off-snapshot expired child on a snapshot parent must survive');

    const snapParentStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, snapParent]
    )).rows;
    const offParentStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, offParent]
    )).rows;
    assert.strictEqual(snapParentStill.length, 1, 'parent with surviving off-snapshot child must be retained');
    assert.strictEqual(offParentStill.length, 1, 'off-snapshot evidence must remain');
  });

  test('raw DELETE parent does not remove protected children', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const parentId = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt,
    });
    const holdChild = await insertAssetRow(p, tenantA, parentId, {
      createdAt, expiresAt: expiredAt, retentionClass: 'legal_hold',
    });
    await assert.rejects(
      () => p.query(
        `DELETE FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, parentId]
      ),
      /orchestrator_research_evidence|orchestrator_research_evidence_assets|foreign key|violates/i,
      'raw parent DELETE must not orphan or cascade-remove a protected child'
    );
    const parentStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, parentId]
    )).rows;
    const childStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, holdChild]
    )).rows;
    assert.strictEqual(parentStill.length, 1, 'parent must remain when a protected child blocks DELETE');
    assert.strictEqual(childStill.length, 1, 'protected child must remain after refused parent DELETE');
  });

  test('preview/execute tenant A cannot include or purge tenant B ids', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const compA = await insertComp(p, tenantA, hostA.runId);
    const compB = await insertComp(p, tenantB, hostB.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const idA = await insertEvidenceRow(p, tenantA, hostA.runId, compA, { createdAt, expiresAt: expiredAt });
    const assetA = await insertAssetRow(p, tenantA, idA, { createdAt, expiresAt: expiredAt });
    const idB = await insertEvidenceRow(p, tenantB, hostB.runId, compB, { createdAt, expiresAt: expiredAt });
    const assetB = await insertAssetRow(p, tenantB, idB, { createdAt, expiresAt: expiredAt });
    await insertHold(p, tenantA, 'evidence', idA);
    await insertHold(p, tenantA, 'asset', assetA);
    await insertHold(p, tenantB, 'evidence', idB);
    await insertHold(p, tenantB, 'asset', assetB);
    await insertHold(p, tenantA, 'evidence', idB);

    const keyA = nid('idemp-xt-a');
    const previewA = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyA });
    const targetsA = (await p.query(
      `SELECT target_kind, target_id FROM orchestrator_research_cleanup_targets
        WHERE tenant_id=$1 AND op_id=$2`,
      [tenantA, previewA.id]
    )).rows;
    assert.ok(targetsA.some((row) => row.target_id === idA));
    assert.ok(targetsA.some((row) => row.target_id === assetA));
    assert.ok(!targetsA.some((row) => row.target_id === assetB), 'tenant A snapshot must not include tenant B assets');
    const bEvidenceInA = targetsA.filter((row) => row.target_kind === 'evidence' && row.target_id === idB);
    assert.ok(bEvidenceInA.length <= 1, 'A may snapshot a colliding id string from an A-scoped hold');
    assert.ok(!targetsA.some((row) => row.target_kind === 'asset' && row.target_id === assetB));

    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: keyA, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: keyA });

    const aGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const bEv = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantB, idB]
    )).rows;
    const bAsset = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantB, assetB]
    )).rows;
    assert.strictEqual(aGone.length, 0);
    assert.strictEqual(bEv.length, 1, 'tenant A execute must not delete tenant B evidence');
    assert.strictEqual(bAsset.length, 1, 'tenant A execute must not delete tenant B assets');
  });

  test('missing snapshot_sha256 and unapproved execute fail closed; completed replay stays purged 0', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const evId = await insertEvidenceRow(p, tenantA, host.runId, comp);
    await insertHold(p, tenantA, 'evidence', evId);

    const missingKey = nid('idemp-missing-hash');
    const missingPreview = await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: missingKey });
    await p.query(
      `UPDATE orchestrator_research_cleanup_ops SET snapshot_sha256 = NULL
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, missingPreview.id]
    );
    await assert.rejects(
      () => approveLegacyCleanup({
        tenantId: tenantA, idempotencyKey: missingKey, req: actorReq(),
        confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
      }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'snapshot_sha256'
        && err.extra.reason === 'missing'
    );
    await p.query(
      `UPDATE orchestrator_research_cleanup_ops
          SET snapshot_sha256 = $3, state = 'approved', confirmation_sha256 = $4
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, missingPreview.id, 'a'.repeat(64), 'b'.repeat(64)]
    );
    await p.query(
      `UPDATE orchestrator_research_cleanup_ops SET snapshot_sha256 = NULL
        WHERE tenant_id=$1 AND id=$2`,
      [tenantA, missingPreview.id]
    );
    await assert.rejects(
      () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: missingKey }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.field === 'snapshot_sha256'
        && err.extra.reason === 'missing'
    );
    const stillMissing = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, evId]
    )).rows;
    assert.strictEqual(stillMissing.length, 1, 'missing snapshot hash must not DELETE');

    const unapprovedKey = nid('idemp-unapproved');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: unapprovedKey });
    await assert.rejects(
      () => executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: unapprovedKey }),
      (err) => err instanceof OrchError && err.code === 'validation_failed'
        && err.extra && err.extra.reason === 'not_approved'
    );

    const replayKey = nid('idemp-replay');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: replayKey });
    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: replayKey, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });
    const first = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: replayKey });
    assert.strictEqual(first.state, 'completed');
    const leftoverId = await insertEvidenceRow(p, tenantA, host.runId, comp);
    await insertHold(p, tenantA, 'evidence', leftoverId);
    const replay = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: replayKey });
    assert.strictEqual(replay.state, 'completed');
    assert.strictEqual(replay.purged_evidence_count, 0);
    assert.strictEqual(replay.purged_assets_count, 0);
    assert.strictEqual(replay.idempotent, true);
    const leftoverStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, leftoverId]
    )).rows;
    assert.strictEqual(leftoverStill.length, 1, 'completed replay must not expand the deletion set');
  });

  test('concurrent cleanup cannot expand the approved deletion set', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const idA = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, headline: RAW_EMAIL,
    });
    const assetA = await insertAssetRow(p, tenantA, idA, { createdAt, expiresAt: expiredAt });
    await insertHold(p, tenantA, 'evidence', idA);
    await insertHold(p, tenantA, 'asset', assetA);

    const key1 = nid('idemp-conc-1');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key1 });
    const leftover = await insertEvidenceRow(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, headline: RAW_PHONE,
    });
    const leftoverAsset = await insertAssetRow(p, tenantA, leftover, { createdAt, expiresAt: expiredAt });
    await insertHold(p, tenantA, 'evidence', leftover);
    await insertHold(p, tenantA, 'asset', leftoverAsset);

    const key2 = nid('idemp-conc-2');
    await previewLegacyCleanup({ tenantId: tenantA, idempotencyKey: key2 });

    await approveLegacyCleanup({
      tenantId: tenantA, idempotencyKey: key1, req: actorReq(),
      confirmation: DELETE_LEGACY_RESEARCH_EVIDENCE,
    });

    const [first, second, unapproved] = await Promise.all([
      executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key1 }),
      executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key1 }),
      executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key2 }).then(
        () => { throw new Error('op2 must not execute while unapproved'); },
        (err) => err
      ),
    ]);
    assert.ok(first && second);
    assert.strictEqual(first.state, 'completed');
    assert.strictEqual(second.state, 'completed');
    assert.ok(unapproved instanceof OrchError && unapproved.code === 'validation_failed'
      && unapproved.extra && unapproved.extra.reason === 'not_approved');

    const aGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const leftoverStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, leftover]
    )).rows;
    const leftoverAssetStill = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, leftoverAsset]
    )).rows;
    assert.strictEqual(aGone.length, 0, 'approved snapshot A must be purged');
    assert.strictEqual(leftoverStill.length, 1, 'leftover hold after preview must survive concurrent execute');
    assert.strictEqual(leftoverAssetStill.length, 1, 'leftover asset after preview must survive concurrent execute');

    const replay = await executeLegacyCleanup({ tenantId: tenantA, idempotencyKey: key1 });
    assert.strictEqual(replay.idempotent, true);
    assert.strictEqual(replay.purged_evidence_count, 0);
    const leftoverAfterReplay = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, leftover]
    )).rows;
    assert.strictEqual(leftoverAfterReplay.length, 1);
  });
}

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../db');
const { ensureAgentOrchestratorSchema } = require('../services/agent_orchestrator/schema');
const { ensureTenantSchema } = require('../services/tenants/schema');
const { logger } = require('../services/infra/logger');
const {
  sweepExpiredResearchEvidence,
  SWEEP_BATCH,
  SWEEP_MS,
} = require('../services/agent_orchestrator/research_retention');
const {
  insertEvidenceItem,
  insertCompetitor,
  ensureResearchLimits,
} = require('../services/agent_orchestrator/research_store');
const { OrchError } = require('../services/agent_orchestrator/errors');

const HAS_DB = db.hasDb();
const SHA256_A = 'a'.repeat(64);
const SHA256_C = 'c'.repeat(64);
const SUFFIX = `aorr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

async function insertComp(p, tenantId, runId, extra = {}) {
  const id = extra.id || nid('comp');
  await p.query(
    `INSERT INTO orchestrator_research_competitors
       (id, tenant_id, research_run_id, platform, provider_advertiser_id, normalized_name,
        discovery_source, captured_at, dedup_key)
     VALUES ($1,$2,$3,'meta',$4,'Acme Ads','ad_library', now(), $5)`,
    [id, tenantId, runId, extra.adv || nid('adv'), extra.dedup || nid('cdedup')]
  );
  return id;
}

async function insertExpiredEvidence(p, tenantId, runId, competitorId, extra = {}) {
  const id = extra.id || nid('ev');
  const createdAt = extra.createdAt || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const hasExpires = Object.prototype.hasOwnProperty.call(extra, 'expiresAt');
  const expiresAt = hasExpires ? extra.expiresAt : new Date(Date.now() - 24 * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO orchestrator_research_evidence
       (id, tenant_id, research_run_id, competitor_id, platform, source_type,
        provider_external_id, canonical_source_url, headline, body_text, excerpt, advertiser_name,
        captured_at, provider_metrics, provenance_method, connector_id, connector_version,
        content_fingerprint, dedup_key, retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,$4,'meta','ad_creative',$5,$6,$7,$8,$9,$10,$11::timestamptz,'{}'::jsonb,
             'ad_library','meta_research','1.0.0',$12,$13,$14,$15::timestamptz,$16::timestamptz)`,
    [
      id,
      tenantId,
      runId,
      competitorId,
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

async function insertAssetRaw(p, tenantId, evidenceId, extra = {}) {
  const id = extra.id || nid('asset');
  const createdAt = extra.createdAt || new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const expiresAt = Object.prototype.hasOwnProperty.call(extra, 'expiresAt')
    ? extra.expiresAt
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  await p.query(
    `INSERT INTO orchestrator_research_evidence_assets
       (id, tenant_id, evidence_id, media_type, storage_ref, checksum_sha256, captured_at,
        retention_class, expires_at, created_at)
     VALUES ($1,$2,$3,'image',$4,$5, $6::timestamptz, $7, $8::timestamptz, $9::timestamptz)`,
    [
      id,
      tenantId,
      evidenceId,
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

if (!HAS_DB) {
  test('advertising-orchestrator research retention skipped — no DATABASE_URL', { skip: 'no DATABASE_URL' }, () => {});
} else {
  let tenantA = null;
  let tenantB = null;

  before(async () => {
    await ensureTenantSchema();
    await ensureAgentOrchestratorSchema();
    const p = db.getPool();
    const mk = async (label, slug) => (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [label, slug]
    )).rows[0].id;
    tenantA = await mk(`AORR A ${SUFFIX}`, `aorr-a-${SUFFIX}`);
    tenantB = await mk(`AORR B ${SUFFIX}`, `aorr-b-${SUFFIX}`);
    await ensureResearchLimits(p, tenantA, { records: 100000, bytes: 104857600 });
    await ensureResearchLimits(p, tenantB, { records: 100000, bytes: 104857600 });
  });

  after(async () => {
    const p = db.getPool();
    const ids = [tenantA, tenantB].filter(Boolean);
    if (!ids.length) return;
    await p.query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids]);
  });

  test('exports and SWEEP constants', () => {
    assert.strictEqual(typeof sweepExpiredResearchEvidence, 'function');
    assert.strictEqual(SWEEP_BATCH, 100);
    assert.strictEqual(SWEEP_MS, 6 * 3600 * 1000);
  });

  test('expired standard evidence is purged; future and legal_hold are kept', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const futureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const expiredId = await insertExpiredEvidence(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, bodyText: 'SECRET_BODY_TEXT',
      url: 'https://www.facebook.com/ads/library/?id=ext-secret-query',
    });
    const futureId = await insertExpiredEvidence(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: futureAt,
    });
    const holdId = await insertExpiredEvidence(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: expiredAt, retentionClass: 'legal_hold',
    });
    const holdNoExp = await insertExpiredEvidence(p, tenantA, host.runId, comp, {
      createdAt, expiresAt: null, retentionClass: 'legal_hold',
    });

    const liveForAsset = futureId;
    const expiredAsset = await insertAssetRaw(p, tenantA, liveForAsset, {
      createdAt, expiresAt: expiredAt,
    });
    const holdAsset = await insertAssetRaw(p, tenantA, liveForAsset, {
      createdAt, expiresAt: expiredAt, retentionClass: 'legal_hold',
    });

    const result = await sweepExpiredResearchEvidence();
    assert.ok(result && result.ok === true);
    assert.ok(result.purged >= 2, 'expired evidence and expired asset must be purged');
    assert.strictEqual(result.invalid_expiry, 0);
    assert.strictEqual(result.failures, 0);

    const gone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredId]
    )).rows;
    assert.strictEqual(gone.length, 0);
    const kept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantA, [futureId, holdId, holdNoExp]]
    )).rows.map((r) => r.id).sort();
    assert.deepStrictEqual(kept.sort(), [futureId, holdId, holdNoExp].sort());

    const assetGone = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, expiredAsset]
    )).rows;
    assert.strictEqual(assetGone.length, 0);
    const assetKept = (await p.query(
      `SELECT id FROM orchestrator_research_evidence_assets WHERE tenant_id=$1 AND id=$2`,
      [tenantA, holdAsset]
    )).rows;
    assert.strictEqual(assetKept.length, 1);
  });

  test('tenant A sweep does not delete tenant B', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const compA = await insertComp(p, tenantA, hostA.runId);
    const compB = await insertComp(p, tenantB, hostB.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const idA = await insertExpiredEvidence(p, tenantA, hostA.runId, compA, { createdAt, expiresAt: expiredAt });
    const idB = await insertExpiredEvidence(p, tenantB, hostB.runId, compB, { createdAt, expiresAt: expiredAt });

    const origGetPool = db.getPool;
    const origPool = db.getPool();
    db.getPool = () => wrapPool(origPool, {
      query: async (sql) => {
        if (/UNION/i.test(sql) && /orchestrator_research_evidence/.test(sql)) {
          return { rows: [{ tenant_id: tenantA }], rowCount: 1 };
        }
        return undefined;
      },
    });
    try {
      await sweepExpiredResearchEvidence();
    } finally {
      db.getPool = origGetPool;
    }
    const aGone = (await origPool.query(
      `SELECT 1 FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, idA]
    )).rows;
    const bKept = (await origPool.query(
      `SELECT 1 FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantB, idB]
    )).rows;
    assert.strictEqual(aGone.length, 0);
    assert.strictEqual(bKept.length, 1);
  });

  test('second sweep is idempotent (purged=0)', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    await insertExpiredEvidence(p, tenantA, host.runId, comp);
    const first = await sweepExpiredResearchEvidence();
    assert.ok(first.purged >= 1);
    const second = await sweepExpiredResearchEvidence();
    assert.ok(second.ok === true);
    assert.strictEqual(second.purged, 0);
  });

  test('each inner DELETE is LIMIT-bounded; one call loops until empty', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/agent_orchestrator/research_retention.js'),
      'utf8'
    );
    assert.match(src, /LIMIT \$2/);
    assert.match(src, /SWEEP_BATCH/);
    assert.match(src, /FOR UPDATE SKIP LOCKED/);
    assert.match(src, /p\.connect\s*\(\s*\)/);
    assert.match(src, /client\.query\(\s*['"]BEGIN['"]\s*\)/);
    assert.match(src, /client\.query\(\s*['"]COMMIT['"]\s*\)/);
    assert.match(src, /client\.query\(\s*['"]ROLLBACK['"]\s*\)/);
    assert.match(src, /client\.release\s*\(/);
    assert.match(src, /id = ANY\(\$2/);

    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const n = SWEEP_BATCH + 5;
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (let i = 0; i < n; i += 1) {
      await insertExpiredEvidence(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt });
    }
    const result = await sweepExpiredResearchEvidence();
    assert.ok(result.purged >= n, 'one call loops until empty; each DELETE is still LIMIT-bounded');
    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2
          AND retention_class <> 'legal_hold' AND expires_at <= now()`,
      [tenantA, host.runId]
    )).rows[0].n;
    assert.strictEqual(leftover, 0);
  });

  test('invalid_expiry query is present; CHECK still rejects NULL expires_at for standard', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/agent_orchestrator/research_retention.js'),
      'utf8'
    );
    assert.match(src, /invalid_expiry/);
    assert.match(src, /retention_class IN \('standard','short'\)/);
    assert.match(src, /expires_at IS NULL/);

    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    await assert.rejects(
      () => insertExpiredEvidence(p, tenantA, host.runId, comp, {
        retentionClass: 'standard',
        expiresAt: null,
      }),
      /retention_expiry|check/i
    );
    const result = await sweepExpiredResearchEvidence();
    assert.ok(result);
    assert.strictEqual(typeof result.invalid_expiry, 'number');
  });

  test('one tenant query failure increments failures; the other tenant is still swept', async () => {
    const p = db.getPool();
    const hostA = await seedHost(p, tenantA);
    const hostB = await seedHost(p, tenantB);
    const compA = await insertComp(p, tenantA, hostA.runId);
    const compB = await insertComp(p, tenantB, hostB.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await insertExpiredEvidence(p, tenantA, hostA.runId, compA, { createdAt, expiresAt: expiredAt });
    const idB = await insertExpiredEvidence(p, tenantB, hostB.runId, compB, { createdAt, expiresAt: expiredAt });

    const origGetPool = db.getPool;
    const origPool = db.getPool();
    db.getPool = () => wrapPool(origPool, {
      clientQuery: async (sql, params) => {
        if (
          params && params[0] === tenantA
          && /DELETE FROM orchestrator_research_evidence\b/.test(sql)
        ) {
          throw Object.assign(new Error('injected-fail'), { code: 'XX000' });
        }
        return undefined;
      },
    });
    let result;
    try {
      result = await sweepExpiredResearchEvidence();
    } finally {
      db.getPool = origGetPool;
    }
    assert.ok(result.failures >= 1);
    assert.strictEqual(result.ok, false);
    const bGone = (await origPool.query(
      `SELECT 1 FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantB, idB]
    )).rows;
    assert.strictEqual(bGone.length, 0, 'tenant B must still be swept');
  });

  test('purged logs do not contain body_text, query URLs, or emails', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const secretBody = 'SECRET_BODY_TEXT ads@brand.example';
    const secretUrl = 'https://www.facebook.com/ads/library/?id=ext-secret-query';
    await insertExpiredEvidence(p, tenantA, host.runId, comp, {
      bodyText: secretBody,
      url: secretUrl,
      excerpt: secretBody,
    });

    const lines = [];
    const origInfo = logger.info;
    const origError = logger.error;
    const origLog = console.log;
    const origErr = console.error;
    logger.info = (msg, fields) => {
      lines.push(JSON.stringify({ msg, ...(fields || {}) }));
      return origInfo(msg, fields);
    };
    logger.error = (msg, fields) => {
      lines.push(JSON.stringify({ msg, ...(fields || {}) }));
      return origError(msg, fields);
    };
    console.log = (...args) => { lines.push(args.map(String).join(' ')); };
    console.error = (...args) => { lines.push(args.map(String).join(' ')); };
    try {
      const result = await sweepExpiredResearchEvidence();
      assert.ok(result.purged >= 1);
    } finally {
      logger.info = origInfo;
      logger.error = origError;
      console.log = origLog;
      console.error = origErr;
    }
    const joined = lines.join('\n');
    assert.match(joined, /research_evidence_sweep_complete/);
    assert.ok(!joined.includes('SECRET_BODY_TEXT'), 'body_text must not be logged');
    assert.ok(!joined.includes('ads@brand.example'), 'emails must not be logged');
    assert.ok(!joined.includes('?id=ext-secret-query'), 'query-string URLs must not be logged');
    assert.ok(!joined.includes(secretUrl));
  });

  test('quota decrements so a new insert succeeds after purge', async () => {
    const p = db.getPool();
    const tenantQ = (await p.query(
      `INSERT INTO tenants (name, slug, status) VALUES ($1,$2,'active') RETURNING id`,
      [`AORR q ${SUFFIX}`, `aorr-q-${SUFFIX}`]
    )).rows[0].id;
    try {
      await ensureResearchLimits(p, tenantQ, { records: 1, bytes: 104857600 });
      const host = await seedHost(p, tenantQ);
      const now = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const expired = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const comp = await insertCompetitor(p, {
        id: nid('comp-q'),
        tenant_id: tenantQ,
        research_run_id: host.runId,
        platform: 'meta',
        provider_advertiser_id: nid('adv-q'),
        normalized_name: 'Acme Ads',
        discovery_source: 'ad_library',
        captured_at: now,
      }, { tenantId: tenantQ });
      await insertEvidenceItem(p, {
        id: nid('ev-q1'),
        tenant_id: tenantQ,
        research_run_id: host.runId,
        competitor_id: comp.id,
        platform: 'meta',
        source_type: 'ad_creative',
        provider_external_id: nid('ext-q1'),
        headline: nid('hl-q1'),
        body_text: 'copy',
        excerpt: 'copy',
        captured_at: now,
        created_at: now,
        expires_at: expired,
        retention_class: 'standard',
        provider_metrics: {},
        metrics_kind: 'provider_reported',
        provenance_method: 'ad_library',
        connector_id: 'meta_research',
        connector_version: '1.0.0',
        dedup_key: nid('dk-q1'),
      }, { tenantId: tenantQ });

      await assert.rejects(
        () => insertEvidenceItem(p, {
          id: nid('ev-q-block'),
          tenant_id: tenantQ,
          research_run_id: host.runId,
          competitor_id: comp.id,
          platform: 'meta',
          source_type: 'ad_creative',
          provider_external_id: nid('ext-q-block'),
          headline: nid('hl-block'),
          body_text: 'copy',
          excerpt: 'copy',
          captured_at: new Date().toISOString(),
          retention_class: 'standard',
          provider_metrics: {},
          metrics_kind: 'provider_reported',
          provenance_method: 'ad_library',
          connector_id: 'meta_research',
          connector_version: '1.0.0',
          dedup_key: nid('dk-block'),
        }, { tenantId: tenantQ }),
        (err) => err instanceof OrchError && err.code === 'research_evidence_limit_exceeded'
      );

      const swept = await sweepExpiredResearchEvidence();
      assert.ok(swept.purged >= 1);

      const again = await insertEvidenceItem(p, {
        id: nid('ev-q2'),
        tenant_id: tenantQ,
        research_run_id: host.runId,
        competitor_id: comp.id,
        platform: 'meta',
        source_type: 'ad_creative',
        provider_external_id: nid('ext-q2'),
        headline: nid('hl-q2'),
        body_text: 'copy',
        excerpt: 'copy',
        captured_at: new Date().toISOString(),
        retention_class: 'standard',
        provider_metrics: {},
        metrics_kind: 'provider_reported',
        provenance_method: 'ad_library',
        connector_id: 'meta_research',
        connector_version: '1.0.0',
        dedup_key: nid('dk-q2'),
      }, { tenantId: tenantQ });
      assert.ok(again.id);
      assert.ok(again.content_fingerprint);
    } finally {
      await p.query(`DELETE FROM tenants WHERE id=$1`, [tenantQ]);
    }
  });

  test('SKIP LOCKED skips a held expired row; second sweep purges it after unlock', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lockedId = await insertExpiredEvidence(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt });
    const freeIds = [];
    for (let i = 0; i < 3; i += 1) {
      freeIds.push(await insertExpiredEvidence(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt }));
    }

    const locker = await p.connect();
    let sweepP = null;
    try {
      await locker.query('BEGIN');
      await locker.query(
        `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenantA, lockedId]
      );
      sweepP = sweepExpiredResearchEvidence();
      const timedOut = Object.assign(new Error('sweep blocked on held row'), { code: 'XX000' });
      let timer;
      const result = await Promise.race([
        sweepP,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timedOut), 8000);
        }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      sweepP = null;
      assert.ok(result);
      assert.strictEqual(result.failures, 0, 'SKIP LOCKED must not trip delete_noop');

      const freeGone = (await p.query(
        `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id = ANY($2::text[])`,
        [tenantA, freeIds]
      )).rows;
      assert.strictEqual(freeGone.length, 0, 'unlocked expired rows must be purged');
      const lockedKept = (await p.query(
        `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
        [tenantA, lockedId]
      )).rows;
      assert.strictEqual(lockedKept.length, 1, 'held row must be skipped');
    } catch (err) {
      if (sweepP) {
        try { await locker.query('ROLLBACK'); } catch { /* ignore */ }
        await sweepP.catch(() => {});
        sweepP = null;
      }
      throw err;
    } finally {
      try { await locker.query('ROLLBACK'); } catch { /* ignore */ }
      locker.release();
    }

    const second = await sweepExpiredResearchEvidence();
    assert.strictEqual(second.failures, 0);
    assert.ok(second.purged >= 1);
    const leftover = (await p.query(
      `SELECT id FROM orchestrator_research_evidence WHERE tenant_id=$1 AND id=$2`,
      [tenantA, lockedId]
    )).rows;
    assert.strictEqual(leftover.length, 0, 'second sweep must purge the previously locked row');
  });

  test('two concurrent sweeps partition expired rows without a noop race', async () => {
    const p = db.getPool();
    const host = await seedHost(p, tenantA);
    const comp = await insertComp(p, tenantA, host.runId);
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ids = [];
    for (let i = 0; i < 12; i += 1) {
      ids.push(await insertExpiredEvidence(p, tenantA, host.runId, comp, { createdAt, expiresAt: expiredAt }));
    }

    const [first, second] = await Promise.all([
      sweepExpiredResearchEvidence(),
      sweepExpiredResearchEvidence(),
    ]);
    assert.ok(first && second);
    assert.strictEqual(first.failures, 0, 'ok must not be false because of a noop race');
    assert.strictEqual(second.failures, 0, 'ok must not be false because of a noop race');
    assert.ok(
      (first.purged || 0) + (second.purged || 0) >= ids.length,
      'union of purged counts must cover the seeded expired set'
    );

    const leftover = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND id = ANY($2::text[])`,
      [tenantA, ids]
    )).rows[0].n;
    assert.strictEqual(leftover, 0, 'union of purged rows must be complete');
    const leftoverExpired = (await p.query(
      `SELECT COUNT(*)::int AS n FROM orchestrator_research_evidence
        WHERE tenant_id=$1 AND research_run_id=$2
          AND retention_class <> 'legal_hold' AND expires_at IS NOT NULL AND expires_at <= now()`,
      [tenantA, host.runId]
    )).rows[0].n;
    assert.strictEqual(leftoverExpired, 0);
  });

  // release() does not roll back. A client handed back mid-transaction gives the
  // next borrower an open transaction and the batch's FOR UPDATE row locks, so a
  // rollback that could not be confirmed has to destroy the client instead.
  // Fully stubbed: this test reads and writes no table.
  test('a sweep whose ROLLBACK fails destroys its client instead of pooling it', async () => {
    const FAKE_TENANT = -4242;
    const releases = [];
    const stubPool = (failRollback) => ({
      query: async (sql) => {
        if (/UNION/i.test(sql)) return { rows: [{ tenant_id: FAKE_TENANT }], rowCount: 1 };
        if (/invalid_expiry/i.test(sql)) return { rows: [{ invalid_expiry: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      connect: async () => ({
        query: async (sql) => {
          if (/^ROLLBACK/.test(sql)) {
            if (failRollback) throw Object.assign(new Error('rollback failed'), { code: '08006' });
            return { rows: [], rowCount: 0 };
          }
          if (/FOR UPDATE SKIP LOCKED/.test(sql)) {
            return { rows: [{ tenant_id: FAKE_TENANT, id: 'ev-stub' }], rowCount: 1 };
          }
          if (/^DELETE/.test(sql)) throw Object.assign(new Error('injected'), { code: 'XX000' });
          return { rows: [], rowCount: 0 };
        },
        release: (err) => releases.push(err === undefined ? 'pooled' : 'destroyed'),
      }),
    });

    const origGetPool = db.getPool;
    try {
      db.getPool = () => stubPool(false);
      const clean = await sweepExpiredResearchEvidence();
      assert.strictEqual(clean.ok, false, 'the injected DELETE failure must still be reported');
      assert.deepStrictEqual(
        releases,
        ['pooled'],
        'a confirmed ROLLBACK leaves the client reusable — do not churn the pool'
      );

      releases.length = 0;
      db.getPool = () => stubPool(true);
      const dirty = await sweepExpiredResearchEvidence();
      assert.strictEqual(dirty.ok, false);
      assert.deepStrictEqual(
        releases,
        ['destroyed'],
        'an unconfirmed ROLLBACK must destroy the client, not return an open transaction to the pool'
      );
    } finally {
      db.getPool = origGetPool;
    }
  });
}

'use strict';

const { fail } = require('./errors');
const { newId, insertAudit } = require('./runner');
const { canonicalize } = require('./hash');
const { toBigInt } = require('./money');
const C = require('./campaign_contracts');
const {
  parseContract, contractHash, checkCreatives, checkCredentials, txt,
} = require('./campaign_validate');

const MUTABLE = new Set(['draft', 'validating', 'validation_failed', 'ready_for_approval']);
const ALLOWED = Object.freeze({
  draft: ['validating', 'cancelled'],
  validating: ['validation_failed', 'ready_for_approval', 'cancelled'],
  validation_failed: ['draft', 'validating', 'cancelled'],
  ready_for_approval: ['approved_for_publish', 'validating', 'draft', 'cancelled'],
  approved_for_publish: ['ready_for_approval', 'approval_expired', 'cancelled'],
  approval_expired: ['ready_for_approval', 'validating', 'cancelled'],
});
const PUBLISH_STATUSES = new Set(['publishing', 'published', 'publish_failed']);

function one(c, sql, p) { return c.query(sql, p).then((r) => r.rows[0] || null); }
function j(v) { return JSON.stringify(canonicalize(v)); }
function canGo(from, to) { return (ALLOWED[from] || []).includes(to); }
function assertGo(from, to) { if (!canGo(from, to)) fail('invalid_transition'); }
function assertNotPublish(s) { if (PUBLISH_STATUSES.has(s)) fail('invalid_transition'); }

async function withTx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally { c.release(); }
}

function lockDraft(c, tid, id) {
  return one(c, `SELECT * FROM orchestrator_campaign_drafts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tid, id]);
}
function loadRev(c, tid, draftId, rev) {
  return one(c, `SELECT * FROM orchestrator_campaign_draft_revisions WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3`, [tid, draftId, rev]);
}

async function maybeExpire(c, row) {
  if (!row || row.status !== 'approved_for_publish' || !row.approval_expires_at) return row;
  if (new Date(row.approval_expires_at).getTime() > Date.now()) return row;
  assertGo(row.status, 'approval_expired');
  return (await c.query(
    `UPDATE orchestrator_campaign_drafts
        SET status='approval_expired', approval_id=NULL, approval_hash=NULL, approval_expires_at=NULL, updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [row.tenant_id, row.id]
  )).rows[0];
}

async function insertRev(c, { tenantId, draftId, revision, contract, hash, userId }) {
  const id = newId('cdr');
  await c.query(
    `INSERT INTO orchestrator_campaign_draft_revisions
       (id, tenant_id, draft_id, revision, contract_json, contract_hash, validation_status, validation_json, provenance_json, actor_user_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'pending','{"errors":[]}'::jsonb,$7::jsonb,$8)`,
    [id, tenantId, draftId, revision, j(contract), hash, j(contract.provenance || {}), userId || null]
  );
  for (const cr of contract.creatives) {
    await c.query(
      `INSERT INTO orchestrator_campaign_draft_creatives
         (tenant_id, draft_id, revision, kind, asset_id, asset_version, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, draftId, revision, cr.kind, cr.asset_id, cr.version, cr.content_hash]
    );
  }
  return id;
}

function publicDraft(row, rev, extras) {
  const contract = rev && rev.contract_json ? rev.contract_json : null;
  const out = {
    object_kind: 'campaign_draft',
    id: row.id, tenant_id: row.tenant_id, workflow_id: row.workflow_id,
    label: row.label, notes: row.notes, status: row.status,
    current_revision: Number(row.current_revision), contract_hash: row.contract_hash,
    approval_id: row.approval_id, approval_hash: row.approval_hash,
    approval_expires_at: row.approval_expires_at, created_at: row.created_at, updated_at: row.updated_at,
    validation_status: rev ? rev.validation_status : null,
    validation: rev && rev.validation_json ? rev.validation_json : { errors: [] },
    contract,
  };
  if (row.status !== 'published') out.published = false;
  return extras ? Object.assign(out, extras) : out;
}

async function requireWorkflow(c, tenantId, workflowId) {
  const wf = await one(c, `SELECT id FROM orchestrator_workflows WHERE tenant_id=$1 AND id=$2`, [tenantId, workflowId]);
  if (!wf) fail('not_found');
  return wf;
}

function parseLabelNotes(body) {
  const label = body.label != null ? txt(body.label, 1, 200, 'label') : undefined;
  const notes = body.notes == null ? undefined : (body.notes === '' ? null : txt(body.notes, 0, 500, 'notes'));
  return { label, notes };
}

function contractFromBody(body) {
  if (isPlain(body.contract)) return body.contract;
  const raw = {};
  for (const k of C.KEYS) if (body[k] != null) raw[k] = body[k];
  return Object.keys(raw).length ? raw : null;
}
function isPlain(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

async function createDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const workflowId = String(o.workflowId || '').trim();
  if (!workflowId) fail('validation_failed', { field: 'workflow_id' });
  const key = String(o.idempotencyKey || '').trim();
  if (!key || key.length > 256) fail('validation_failed', { field: 'idempotency_key' });
  const raw = contractFromBody(o.body) || o.body;
  const contract = await parseContract(raw);
  if (contract.provenance.workflow_id !== workflowId) fail('validation_failed', { field: 'provenance.workflow_id' });
  const hash = contractHash(contract);
  const { label, notes } = parseLabelNotes(o.body);
  return withTx(pool, async (c) => {
    await requireWorkflow(c, o.tenantId, workflowId);
    const existing = await one(c, `SELECT * FROM orchestrator_campaign_drafts WHERE tenant_id=$1 AND idempotency_key=$2`, [o.tenantId, key]);
    if (existing) {
      const rev = await loadRev(c, o.tenantId, existing.id, existing.current_revision);
      return { draft: publicDraft(existing, rev), replay: true };
    }
    const id = newId('cd');
    const row = (await c.query(
      `INSERT INTO orchestrator_campaign_drafts
         (id, tenant_id, workflow_id, label, notes, status, current_revision, contract_hash, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'draft',1,$6,$7) RETURNING *`,
      [id, o.tenantId, workflowId, label || 'Campaign draft', notes === undefined ? null : notes, hash, key]
    )).rows[0];
    await insertRev(c, { tenantId: o.tenantId, draftId: id, revision: 1, contract, hash, userId: o.userId });
    const rev = await loadRev(c, o.tenantId, id, 1);
    return { draft: publicDraft(row, rev), replay: false };
  });
}

async function leaveApproved(c, row) {
  if (row.status !== 'approved_for_publish') return row;
  assertGo(row.status, 'ready_for_approval');
  return (await c.query(
    `UPDATE orchestrator_campaign_drafts
        SET status='ready_for_approval', approval_id=NULL, approval_hash=NULL, approval_expires_at=NULL, updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [row.tenant_id, row.id]
  )).rows[0];
}

async function toMutable(c, row) {
  row = await maybeExpire(c, row);
  if (row.status === 'approved_for_publish') row = await leaveApproved(c, row);
  if (row.status === 'approval_expired') {
    assertGo(row.status, 'ready_for_approval');
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts SET status='ready_for_approval', updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [row.tenant_id, row.id]
    )).rows[0];
  }
  if (row.status === 'validation_failed') {
    assertGo(row.status, 'draft');
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts SET status='draft', updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [row.tenant_id, row.id]
    )).rows[0];
  }
  if (!MUTABLE.has(row.status) || row.status === 'cancelled') fail('invalid_transition');
  return row;
}

async function editDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, o.tenantId, o.draftId);
    if (!row) fail('not_found');
    if (row.status === 'cancelled') fail('invalid_transition');
    row = await maybeExpire(c, row);
    const { label, notes } = parseLabelNotes(o.body);
    const raw = contractFromBody(o.body);
    let material = false;
    let contract = null;
    let hash = row.contract_hash;
    if (raw) {
      contract = await parseContract(raw);
      if (contract.provenance.workflow_id !== row.workflow_id) fail('validation_failed', { field: 'provenance.workflow_id' });
      hash = contractHash(contract);
      material = hash !== row.contract_hash;
    }
    if (material) {
      row = await toMutable(c, row);
      const next = Number(row.current_revision) + 1;
      row = (await c.query(
        `UPDATE orchestrator_campaign_drafts
            SET current_revision=$3, contract_hash=$4, label=$5, notes=$6, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [o.tenantId, row.id, next, hash, label === undefined ? row.label : label, notes === undefined ? row.notes : notes]
      )).rows[0];
      await insertRev(c, { tenantId: o.tenantId, draftId: row.id, revision: next, contract, hash, userId: o.userId });
    } else {
      row = (await c.query(
        `UPDATE orchestrator_campaign_drafts
            SET label=$3, notes=$4, updated_at=now()
          WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [o.tenantId, row.id, label === undefined ? row.label : label, notes === undefined ? row.notes : notes]
      )).rows[0];
    }
    const rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    return publicDraft(row, rev);
  });
}

async function validateDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, o.tenantId, o.draftId);
    if (!row) fail('not_found');
    if (row.status === 'cancelled') fail('invalid_transition');
    row = await maybeExpire(c, row);
    if (row.status === 'approved_for_publish') fail('invalid_transition');
    let rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    if (rev && rev.validation_status === 'passed' && row.status === 'ready_for_approval') {
      return publicDraft(row, rev);
    }
    if (row.status !== 'validating') {
      assertGo(row.status, 'validating');
      row = (await c.query(
        `UPDATE orchestrator_campaign_drafts SET status='validating', updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [o.tenantId, row.id]
      )).rows[0];
    }
    if (rev.validation_status !== 'pending') {
      const next = Number(row.current_revision) + 1;
      row = (await c.query(
        `UPDATE orchestrator_campaign_drafts SET current_revision=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
        [o.tenantId, row.id, next]
      )).rows[0];
      await insertRev(c, {
        tenantId: o.tenantId, draftId: row.id, revision: next,
        contract: rev.contract_json, hash: rev.contract_hash, userId: o.userId,
      });
      rev = await loadRev(c, o.tenantId, row.id, next);
    }
    const errors = [];
    let contract = rev.contract_json;
    try { contract = await parseContract(rev.contract_json); }
    catch (e) { errors.push({ code: e.code || 'validation_failed', field: (e.extra && e.extra.field) || 'contract' }); }
    if (!errors.length) {
      errors.push(...await checkCreatives(c, o.tenantId, contract.creatives));
      errors.push(...await checkCredentials(o.userId, contract));
    }
    const passed = errors.length === 0;
    const vjson = { errors };
    await c.query(
      `UPDATE orchestrator_campaign_draft_revisions SET validation_status=$4, validation_json=$5::jsonb
        WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3 AND validation_status='pending'`,
      [o.tenantId, row.id, row.current_revision, passed ? 'passed' : 'failed', j(vjson)]
    );
    const nextStatus = passed ? 'ready_for_approval' : 'validation_failed';
    assertGo('validating', nextStatus);
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts SET status=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [o.tenantId, row.id, nextStatus]
    )).rows[0];
    rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    return publicDraft(row, rev);
  });
}

function refsOf(contract) { return (contract.accounts || []).map((a) => a.credential_ref).slice().sort(); }
function platOf(contract) { return (contract.platforms || []).slice().sort().join(','); }
function creativesOf(contract) {
  return (contract.creatives || []).map((c) => `${c.asset_id}:${c.version}`).sort().join('|');
}
function countriesOf(g) { return ((g && g.countries) || []).slice().sort().join(','); }

function approveMatches(contract, body, revision, hash) {
  if (Number(body.revision) !== Number(revision)) return false;
  if (String(body.contract_hash || '') !== String(hash)) return false;
  const plats = Array.isArray(body.platforms) ? body.platforms.slice().sort().join(',') : '';
  if (plats !== platOf(contract)) return false;
  const refs = Array.isArray(body.accounts)
    ? body.accounts.map((a) => (typeof a === 'string' ? a : a && a.credential_ref)).filter(Boolean).slice().sort()
    : (Array.isArray(body.credential_refs) ? body.credential_refs.slice().sort() : []);
  if (refs.join(',') !== refsOf(contract).join(',')) return false;
  const crs = Array.isArray(body.creatives)
    ? body.creatives.map((c) => `${c.asset_id || c.id}:${c.version}`).sort().join('|') : '';
  if (crs !== creativesOf(contract)) return false;
  const b = body.budget || {};
  try {
    if (toBigInt(b.amount_micros) !== toBigInt(contract.budget.amount_micros)) return false;
  } catch (_) { return false; }
  if (String(b.currency || '') !== String(contract.budget.currency)) return false;
  const sch = body.schedule || {};
  if (String(sch.start_at || '') !== String(contract.schedule.start_at)) return false;
  if (String(sch.end_at || '') !== String(contract.schedule.end_at || '')) return false;
  const geo = (body.targeting && body.targeting.geo) || body.geo || {};
  if (countriesOf(geo) !== countriesOf(contract.geo)) return false;
  if (String(body.landing_page_url || '') !== String(contract.destination.landing_page_url)) return false;
  return true;
}

function parseExpires(raw) {
  const now = Date.now();
  const min = now + 60 * 60 * 1000;
  const max = now + 30 * 24 * 60 * 60 * 1000;
  const def = now + 7 * 24 * 60 * 60 * 1000;
  let t = def;
  if (raw != null && raw !== '') {
    t = Date.parse(raw);
    if (!Number.isFinite(t)) fail('validation_failed', { field: 'expires_at' });
  }
  if (t < min || t > max) fail('validation_failed', { field: 'expires_at' });
  return new Date(t).toISOString();
}

async function ensureApprovedDraft(c, row, approval, expiresAt) {
  if (row.status === 'approved_for_publish') return row;
  assertGo(row.status, 'approved_for_publish');
  return (await c.query(
    `UPDATE orchestrator_campaign_drafts
        SET status='approved_for_publish', approval_id=$3, approval_hash=$4, approval_expires_at=$5, updated_at=now()
      WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [row.tenant_id, row.id, approval.workflow_approval_id, row.contract_hash, expiresAt || approval.expires_at]
  )).rows[0];
}

async function approveDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  const body = o.body && typeof o.body === 'object' ? o.body : {};
  const key = String(o.idempotencyKey || body.idempotency_key || '').trim();
  if (!key) fail('validation_failed', { field: 'idempotency_key' });
  const expiresAt = parseExpires(body.expires_at);
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, o.tenantId, o.draftId);
    if (!row) fail('not_found');
    row = await maybeExpire(c, row);
    if (row.status === 'approval_expired') fail('approval_expired');
    if (row.status === 'cancelled') fail('invalid_transition');
    const existing = await one(c,
      `SELECT * FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND idempotency_key=$2`,
      [o.tenantId, key]);
    if (existing) {
      if (existing.revoked_at) fail('idempotency_conflict', { field: 'idempotency_key' });
      if (String(existing.draft_id) !== String(row.id)) fail('idempotency_conflict', { field: 'idempotency_key' });
      if (Number(existing.revision) !== Number(row.current_revision)
          || String(existing.contract_hash) !== String(row.contract_hash)) {
        fail('idempotency_conflict', { field: 'idempotency_key' });
      }
      const rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
      row = await ensureApprovedDraft(c, row, existing, existing.expires_at);
      return { draft: publicDraft(row, rev), approval: existing, replay: true };
    }
    const rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    if (row.status !== 'ready_for_approval' || !rev || rev.validation_status !== 'passed') fail('approval_required');
    const contract = rev.contract_json;
    if (Number(body.revision) !== Number(row.current_revision) || String(body.contract_hash || '') !== String(row.contract_hash)) {
      fail('approval_stale');
    }
    if (!approveMatches(contract, body, row.current_revision, row.contract_hash)) fail('approval_stale');
    const preErrors = [];
    preErrors.push(...await checkCreatives(c, o.tenantId, contract.creatives || []));
    preErrors.push(...await checkCredentials(o.userId, contract));
    if (preErrors.length) fail('validation_failed', { errors: preErrors });
    const same = await one(c,
      `SELECT * FROM orchestrator_campaign_publish_approvals
        WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3 AND contract_hash=$4 AND revoked_at IS NULL`,
      [o.tenantId, row.id, row.current_revision, row.contract_hash]);
    if (same) {
      row = await ensureApprovedDraft(c, row, same, same.expires_at);
      return { draft: publicDraft(row, rev), approval: same, replay: true };
    }
    const snap = {
      ...canonicalize(contract), object_kind: 'campaign_draft',
      actor_user_id: o.userId, expires_at: expiresAt, revision: Number(row.current_revision),
      contract_hash: row.contract_hash,
    };
    const wfAppr = (await c.query(
      `INSERT INTO orchestrator_approvals
         (tenant_id, workflow_id, gate, object_type, object_id, object_version, content_hash, actor_user_id, decision, approved_platforms)
       VALUES ($1,$2,'campaign_publishing','campaign_draft',$3,$4,$5,$6,'approved','[]'::jsonb) RETURNING *`,
      [o.tenantId, row.workflow_id, row.id, row.current_revision, row.contract_hash, o.userId]
    )).rows[0];
    const pubId = newId('cpa');
    const pub = (await c.query(
      `INSERT INTO orchestrator_campaign_publish_approvals
         (id, tenant_id, draft_id, revision, contract_hash, snapshot_json, workflow_approval_id, actor_user_id, idempotency_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *`,
      [pubId, o.tenantId, row.id, row.current_revision, row.contract_hash, j(snap), wfAppr.id, o.userId, key, expiresAt]
    )).rows[0];
    assertGo(row.status, 'approved_for_publish');
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts
          SET status='approved_for_publish', approval_id=$3, approval_hash=$4, approval_expires_at=$5, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [o.tenantId, row.id, wfAppr.id, row.contract_hash, expiresAt]
    )).rows[0];
    await insertAudit(c, {
      tenantId: o.tenantId, workflowId: row.workflow_id, event: 'approval_granted',
      actorUserId: o.userId, state: row.status, gate: 'campaign_publishing',
      detail: { action: 'approve', version: Number(row.current_revision), state: row.status, gate: 'campaign_publishing', from: 'ready_for_approval', to: 'approved_for_publish' },
    });
    return { draft: publicDraft(row, rev), approval: pub, replay: false };
  });
}

function parseRevokeReason(raw) {
  if (typeof raw !== 'string') fail('validation_failed', { field: 'reason' });
  if (raw !== raw.trim()) fail('validation_failed', { field: 'reason' });
  if (raw.length < 1 || raw.length > 500) fail('validation_failed', { field: 'reason' });
  return raw;
}

async function revokeDraft(pool, o) {
  if (o.bodyTenantId != null && Number(o.bodyTenantId) !== Number(o.tenantId)) fail('validation_failed');
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, o.tenantId, o.draftId);
    if (!row) fail('not_found');
    const reason = parseRevokeReason(o.reason);
    row = await maybeExpire(c, row);
    if (row.status === 'approval_expired') fail('approval_expired');
    if (row.status !== 'approved_for_publish') fail('approval_required');
    const revoked = await c.query(
      `UPDATE orchestrator_campaign_publish_approvals
          SET revoked_at=now(), revoke_reason=$5
        WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3 AND contract_hash=$4 AND revoked_at IS NULL
        RETURNING *`,
      [o.tenantId, row.id, row.current_revision, row.contract_hash, reason]
    );
    if (!revoked.rowCount) fail('approval_required');
    assertGo(row.status, 'ready_for_approval');
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts
          SET status='ready_for_approval', approval_id=NULL, approval_hash=NULL, approval_expires_at=NULL, updated_at=now()
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [o.tenantId, row.id]
    )).rows[0];
    await insertAudit(c, {
      tenantId: o.tenantId, workflowId: row.workflow_id, event: 'approval_rejected',
      actorUserId: o.userId, state: row.status, gate: 'campaign_publishing',
      detail: {
        action: 'revoke', revoke_reason: reason, version: Number(row.current_revision), state: row.status,
        gate: 'campaign_publishing', from: 'approved_for_publish', to: 'ready_for_approval',
      },
    });
    const rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    return publicDraft(row, rev);
  });
}

async function cancelDraft(pool, o) {
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, o.tenantId, o.draftId);
    if (!row) fail('not_found');
    if (row.status === 'cancelled') fail('invalid_transition');
    row = await maybeExpire(c, row);
    assertGo(row.status, 'cancelled');
    const clear = row.status === 'approved_for_publish';
    row = (await c.query(
      `UPDATE orchestrator_campaign_drafts
          SET status='cancelled', updated_at=now()
              ${clear ? ', approval_id=NULL, approval_hash=NULL, approval_expires_at=NULL' : ''}
        WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [o.tenantId, row.id]
    )).rows[0];
    const rev = await loadRev(c, o.tenantId, row.id, row.current_revision);
    return publicDraft(row, rev);
  });
}

async function getDraft(pool, tenantId, draftId) {
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, tenantId, draftId);
    if (!row) fail('not_found');
    row = await maybeExpire(c, row);
    const rev = await loadRev(c, tenantId, row.id, row.current_revision);
    return publicDraft(row, rev);
  });
}

async function listDrafts(pool, tenantId, workflowId) {
  const params = [tenantId];
  let sql = `SELECT * FROM orchestrator_campaign_drafts WHERE tenant_id=$1`;
  if (workflowId) { params.push(workflowId); sql += ` AND workflow_id=$2`; }
  sql += ` ORDER BY created_at DESC LIMIT 100`;
  const rows = (await pool.query(sql, params)).rows;
  const out = [];
  for (const row of rows) {
    const rev = (await pool.query(
      `SELECT * FROM orchestrator_campaign_draft_revisions WHERE tenant_id=$1 AND draft_id=$2 AND revision=$3`,
      [tenantId, row.id, row.current_revision]
    )).rows[0];
    out.push(publicDraft(row, rev));
  }
  return out;
}

async function snapshotDraft(pool, tenantId, draftId) {
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, tenantId, draftId);
    if (!row) fail('not_found');
    row = await maybeExpire(c, row);
    const rev = await loadRev(c, tenantId, row.id, row.current_revision);
    const pub = row.approval_id
      ? await one(c,
        `SELECT * FROM orchestrator_campaign_publish_approvals
           WHERE tenant_id=$1 AND draft_id=$2 AND workflow_approval_id=$3 AND revoked_at IS NULL`,
        [tenantId, row.id, row.approval_id])
      : null;
    const snapshot = pub ? pub.snapshot_json : (rev && rev.contract_json);
    return {
      object_kind: 'campaign_draft',
      status: row.status,
      published: row.status === 'published',
      snapshot,
      draft: publicDraft(row, rev),
    };
  });
}

async function historyDraft(pool, tenantId, draftId, { includeAudit }) {
  const row = await one(pool, `SELECT * FROM orchestrator_campaign_drafts WHERE tenant_id=$1 AND id=$2`, [tenantId, draftId]);
  if (!row) fail('not_found');
  const revisions = (await pool.query(
    `SELECT id, revision, contract_hash, validation_status, validation_json, created_at
       FROM orchestrator_campaign_draft_revisions WHERE tenant_id=$1 AND draft_id=$2 ORDER BY revision ASC`,
    [tenantId, draftId]
  )).rows;
  const approvals = (await pool.query(
    `SELECT id, revision, contract_hash, expires_at, revoked_at, revoke_reason, created_at, actor_user_id
       FROM orchestrator_campaign_publish_approvals WHERE tenant_id=$1 AND draft_id=$2 ORDER BY created_at ASC`,
    [tenantId, draftId]
  )).rows;
  let audit = [];
  if (includeAudit) {
    audit = (await pool.query(
      `SELECT id, event, actor_user_id, detail, created_at FROM orchestrator_audit_events
        WHERE tenant_id=$1 AND workflow_id=$2 ORDER BY created_at ASC LIMIT 200`,
      [tenantId, row.workflow_id]
    )).rows;
  }
  return { object_kind: 'campaign_draft', revisions, approvals, audit };
}

async function assertPublishAuthorized(pool, tenantId, draftId) {
  return withTx(pool, async (c) => {
    let row = await lockDraft(c, tenantId, draftId);
    if (!row) fail('not_found');
    row = await maybeExpire(c, row);
    if (row.status === 'approval_expired') fail('approval_expired');
    if (row.status !== 'approved_for_publish') fail('approval_required');
    const pub = row.approval_id
      ? await one(c,
        `SELECT * FROM orchestrator_campaign_publish_approvals
           WHERE tenant_id=$1 AND draft_id=$2 AND workflow_approval_id=$3 AND revoked_at IS NULL`,
        [tenantId, draftId, row.approval_id])
      : null;
    if (!pub) {
      if (row.approval_id) fail('approval_revoked');
      fail('approval_required');
    }
    if (new Date(pub.expires_at).getTime() <= Date.now()) fail('approval_expired');
    if (String(pub.contract_hash) !== String(row.contract_hash) || Number(pub.revision) !== Number(row.current_revision)) {
      fail('approval_stale');
    }
    return { ok: true, draft: row, approval: pub };
  });
}

module.exports = {
  createDraft, editDraft, validateDraft, approveDraft, revokeDraft, cancelDraft,
  getDraft, listDrafts, snapshotDraft, historyDraft, assertPublishAuthorized, publicDraft,
};

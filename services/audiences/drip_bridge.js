// Dynamic Audiences ⇄ Drip Campaigns bridge (Phase 3).
// onJoin/onLeave/getBinding/setBinding/deleteBinding all accept a tenantId so
// multi-tenant scoping is enforced end-to-end. Tenant is also stamped onto
// each row on INSERT so direct WHERE clauses are fast.
//
// All mutations of the drip JSON store go through global._dripStore.lock so
// they serialize against the 60-second drip tick and any user-initiated
// enrollments. Without this you get last-write-wins and lost tick state.

const _crypto = require('crypto');
const _db = require('../../db');

function _hasStore() {
  return !!(global._dripStore && typeof global._dripStore.lock === 'function');
}

async function getBinding(audienceId, tenantId = null) {
  if (!_db.hasDb()) return null;
  if (tenantId != null) {
    const r = await _db.getPool().query(
      `SELECT * FROM audience_drip_bindings WHERE audience_id=$1 AND tenant_id=$2`,
      [Number(audienceId), tenantId]
    );
    return r.rows[0] || null;
  }
  const r = await _db.getPool().query(
    `SELECT * FROM audience_drip_bindings WHERE audience_id=$1`, [Number(audienceId)]
  );
  return r.rows[0] || null;
}

async function setBinding(audienceId, payload, tenantId = null) {
  if (!_db.hasDb()) throw new Error('db not configured');
  const aid = Number(audienceId);
  if (!Number.isInteger(aid) || aid <= 0) throw new Error('invalid audience_id');
  const seq = Array.isArray(payload?.sequence) ? payload.sequence.slice(0, 30) : null;
  if (!seq || !seq.length) throw new Error('sequence (1-30 steps) required');
  const cleanSeq = seq.map((s, i) => ({
    day:     Number.isFinite(Number(s.day)) ? Math.max(0, Math.min(365, Math.floor(Number(s.day)))) : i,
    channel: String(s.channel || 'Email').slice(0, 32),
    label:   String(s.label   || `Step ${i+1}`).slice(0, 120),
    subject: s.subject !== undefined ? String(s.subject).slice(0, 200) : '',
    msg:     String(s.msg     || '').slice(0, 8000),
  }));
  const brand     = payload?.brand     ? String(payload.brand).slice(0, 200)     : null;
  const dryRun    = payload?.dry_run !== false;
  const enabled   = payload?.enabled !== false;
  const appOrigin = payload?.app_origin ? String(payload.app_origin).slice(0, 400) : null;
  const autoExit  = payload?.auto_exit !== false;

  const r = await _db.getPool().query(`
    INSERT INTO audience_drip_bindings (tenant_id, audience_id, sequence, brand, dry_run, enabled, app_origin, auto_exit)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (audience_id) DO UPDATE SET
      tenant_id  = COALESCE(EXCLUDED.tenant_id, audience_drip_bindings.tenant_id),
      sequence   = EXCLUDED.sequence,
      brand      = EXCLUDED.brand,
      dry_run    = EXCLUDED.dry_run,
      enabled    = EXCLUDED.enabled,
      app_origin = EXCLUDED.app_origin,
      auto_exit  = EXCLUDED.auto_exit,
      updated_at = now()
    RETURNING *
  `, [tenantId, aid, JSON.stringify(cleanSeq), brand, dryRun, enabled, appOrigin, autoExit]);
  return r.rows[0];
}

async function deleteBinding(audienceId, tenantId = null) {
  if (!_db.hasDb()) return false;
  if (tenantId != null) {
    await _db.getPool().query(
      `DELETE FROM audience_drip_bindings WHERE audience_id=$1 AND tenant_id=$2`,
      [Number(audienceId), tenantId]
    );
  } else {
    await _db.getPool().query(`DELETE FROM audience_drip_bindings WHERE audience_id=$1`, [Number(audienceId)]);
  }
  return true;
}

function _seqSig(seq) {
  try {
    const json = JSON.stringify(
      (seq || []).map(s => ({ d:s.day, c:s.channel, m:String(s.msg||'').slice(0,80) }))
    );
    return _crypto.createHash('md5').update(json).digest('hex').slice(0, 12);
  } catch { return ''; }
}

async function onJoin(audienceId, contactId, contactEmail, tenantId = null) {
  if (!_hasStore()) return { skipped: 'drip-store-unavailable' };
  if (!contactEmail) return { skipped: 'no-email' };
  const binding = await getBinding(audienceId, tenantId);
  if (!binding || !binding.enabled) return { skipped: 'no-binding' };

  const sequence = binding.sequence;
  const sig = _seqSig(sequence);
  const email = String(contactEmail).toLowerCase().trim();
  const tid = tenantId != null ? tenantId : (binding.tenant_id != null ? binding.tenant_id : null);
  if (tid == null) return { skipped: 'no-tenant' };

  return global._dripStore.lock(async () => {
    const list = await global._dripStore.load(tid);
    const dup = list.find(e => e.email === email && e.status === 'active' && e._seqSig === sig);
    if (dup) return { skipped: 'duplicate-active', enrollmentId: dup.id };

    const now = Date.now();
    const firstStep = sequence[0] || {};
    const enr = {
      id: 'enr_' + now + '_' + Math.random().toString(36).slice(2, 8),
      email,
      name: '',
      brand: binding.brand || '',
      sequence,
      _seqSig: sig,
      startedAt: now,
      currentStep: 0,
      nextSendAt: now + (Number(firstStep.day) > 0 ? Number(firstStep.day) * 86400000 : 0),
      status: 'active',
      dryRun: !!binding.dry_run,
      appOrigin: binding.app_origin || '',
      history: [],
      audienceId: Number(audienceId),
      audienceBindingId: binding.id,
      sourceContactId: String(contactId || ''),
      tenantId: tenantId || binding.tenant_id || null,
    };
    list.push(enr);
    await global._dripStore.save(tid, list);
    return { enrolled: true, enrollmentId: enr.id };
  });
}

async function onLeave(audienceId, contactId, contactEmail, tenantId = null) {
  if (!_hasStore()) return { skipped: 'drip-store-unavailable' };
  const binding = await getBinding(audienceId, tenantId);
  if (!binding || !binding.auto_exit) return { skipped: 'auto-exit-off' };
  const email = (contactEmail || '').toLowerCase().trim();
  const tid = tenantId != null ? tenantId : (binding.tenant_id != null ? binding.tenant_id : null);
  if (tid == null) return { skipped: 'no-tenant' };

  return global._dripStore.lock(async () => {
    const list = await global._dripStore.load(tid);
    let n = 0;
    for (const e of list) {
      if (e.status !== 'active') continue;
      if (e.audienceBindingId !== binding.id) continue;
      const emailMatch = email && e.email === email;
      const idMatch    = !email && contactId && e.sourceContactId === String(contactId);
      if (emailMatch || idMatch) {
        e.status = 'unsubscribed';
        e.unsubscribedReason = 'left-audience';
        e.unsubscribedAt = Date.now();
        n++;
      }
    }
    if (n) await global._dripStore.save(tid, list);
    return { unsubscribed: n };
  });
}

module.exports = { getBinding, setBinding, deleteBinding, onJoin, onLeave };

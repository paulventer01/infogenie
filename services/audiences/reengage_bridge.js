// Dynamic Audiences ⇄ Re-Engagement Agent bridge (Phase 4B).
// When a contact joins a churn-risk audience, auto-enrol them into a single-
// touch personalised win-back via the existing drip engine. We reuse the drip
// store (with audienceBindingId provenance tags) so:
//   • onLeave can auto-unsubscribe just the win-backs we created (manual
//     re-engagement campaigns are never touched)
//   • the existing /api/drips/* deliverability/bounce/complaint pipeline
//     applies for free
//
// The variant (subject/preheader/body/cta) is stored on the binding and is
// regeneratable via the existing /api/reengage/generate endpoint from the UI.
const _crypto = require('crypto');
const _db = require('../../db');

function _hasStore() { return !!(global._dripStore && typeof global._dripStore.lock === 'function'); }

function _validVariant(v) {
  if (!v || typeof v !== 'object') throw new Error('variant required');
  const subject = String(v.subject || '').slice(0, 200);
  const body    = String(v.body    || '').slice(0, 8000);
  if (!subject.trim() || !body.trim()) throw new Error('variant.subject and variant.body required');
  return {
    subject,
    preheader: String(v.preheader || '').slice(0, 200),
    body,
    cta:       String(v.cta       || '').slice(0, 200),
    angle:     String(v.angle     || '').slice(0, 200),
    tone:      String(v.tone      || 'friendly').slice(0, 40),
  };
}

async function getBinding(audienceId) {
  if (!_db.hasDb()) return null;
  const r = await _db.getPool().query(
    `SELECT * FROM audience_reengage_bindings WHERE audience_id=$1`, [Number(audienceId)]
  );
  return r.rows[0] || null;
}

async function setBinding(audienceId, payload) {
  if (!_db.hasDb()) throw new Error('db not configured');
  const aid = Number(audienceId);
  if (!Number.isInteger(aid) || aid <= 0) throw new Error('invalid audience_id');
  const variant   = _validVariant(payload?.variant);
  const brand     = payload?.brand     ? String(payload.brand).slice(0, 200) : null;
  const dryRun    = payload?.dry_run !== false;
  const enabled   = payload?.enabled !== false;
  const autoExit  = payload?.auto_exit !== false;
  const appOrigin = payload?.app_origin ? String(payload.app_origin).slice(0, 400) : null;

  const r = await _db.getPool().query(`
    INSERT INTO audience_reengage_bindings (audience_id, variant, brand, dry_run, enabled, auto_exit, app_origin)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (audience_id) DO UPDATE SET
      variant    = EXCLUDED.variant,
      brand      = EXCLUDED.brand,
      dry_run    = EXCLUDED.dry_run,
      enabled    = EXCLUDED.enabled,
      auto_exit  = EXCLUDED.auto_exit,
      app_origin = EXCLUDED.app_origin,
      updated_at = now()
    RETURNING *
  `, [aid, JSON.stringify(variant), brand, dryRun, enabled, autoExit, appOrigin]);
  return r.rows[0];
}

async function deleteBinding(audienceId) {
  if (!_db.hasDb()) return false;
  await _db.getPool().query(`DELETE FROM audience_reengage_bindings WHERE audience_id=$1`, [Number(audienceId)]);
  return true;
}

function _seqSig(seq) {
  try {
    const json = JSON.stringify((seq||[]).map(s=>({d:s.day,c:s.channel,m:String(s.msg||'').slice(0,80)})));
    return _crypto.createHash('md5').update(json).digest('hex').slice(0,12);
  } catch { return ''; }
}

async function onJoin(audienceId, contactId, contactEmail) {
  if (!_hasStore()) return { skipped:'drip-store-unavailable' };
  if (!contactEmail) return { skipped:'no-email' };
  const b = await getBinding(audienceId);
  if (!b || !b.enabled) return { skipped:'no-binding' };

  const variant = b.variant;
  const sequence = [{
    day: 0,
    channel: 'Email',
    label: 'Win-back · ' + (variant.angle || 'auto').slice(0, 40),
    subject: variant.subject,
    msg: variant.body + (variant.cta ? `\n\n${variant.cta}` : ''),
  }];
  const sig = _seqSig(sequence);
  const email = String(contactEmail).toLowerCase().trim();

  const result = await global._dripStore.lock(async () => {
    const list = global._dripStore.load();
    const dup = list.find(e => e.email === email && e.status === 'active' && e._seqSig === sig);
    if (dup) return { skipped:'duplicate-active', enrollmentId: dup.id };
    const now = Date.now();
    const enr = {
      id: 'reng_' + now + '_' + Math.random().toString(36).slice(2,8),
      email, name:'',
      brand: b.brand || '',
      sequence, _seqSig: sig,
      startedAt: now, currentStep: 0, nextSendAt: now,
      status:'active', dryRun: !!b.dry_run, appOrigin: b.app_origin || '',
      history: [],
      audienceId: Number(audienceId),
      audienceBindingId: 'reng:' + b.id,   // namespaced so it never collides with drip_bridge ids
      sourceContactId: String(contactId || ''),
      reengageVariant: { subject: variant.subject, angle: variant.angle, tone: variant.tone },
    };
    list.push(enr);
    global._dripStore.save(list);
    return { enrolled:true, enrollmentId: enr.id };
  });

  // Track most-recent fire time for the dashboard badge.
  if (result.enrolled) {
    try { await _db.getPool().query(
      `UPDATE audience_reengage_bindings SET last_triggered_at = now() WHERE audience_id=$1`,
      [Number(audienceId)]
    ); } catch(_){}
  }
  return result;
}

async function onLeave(audienceId, contactId, contactEmail) {
  if (!_hasStore()) return { skipped:'drip-store-unavailable' };
  const b = await getBinding(audienceId);
  if (!b || !b.auto_exit) return { skipped:'auto-exit-off' };
  const tag = 'reng:' + b.id;
  const email = (contactEmail || '').toLowerCase().trim();

  return global._dripStore.lock(async () => {
    const list = global._dripStore.load();
    let n = 0;
    for (const e of list) {
      if (e.status !== 'active') continue;
      if (e.audienceBindingId !== tag) continue;
      const emailMatch = email && e.email === email;
      const idMatch    = !email && contactId && e.sourceContactId === String(contactId);
      if (emailMatch || idMatch) {
        e.status = 'unsubscribed';
        e.unsubscribedReason = 'left-audience';
        e.unsubscribedAt = Date.now();
        n++;
      }
    }
    if (n) global._dripStore.save(list);
    return { unsubscribed: n };
  });
}

module.exports = { getBinding, setBinding, deleteBinding, onJoin, onLeave };

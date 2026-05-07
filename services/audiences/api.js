// Dynamic Audiences — HTTP routes mounted under /api/audiences.
const express = require('express');
const _db = require('../../db');
const { previewSegmentLive, snapshotSegmentCount } = require('./engine');
const { runSweepOnce, reevaluateContact } = require('./sweep');
const _bridge = require('./drip_bridge');

const router = express.Router();

function _str(v, max = 400) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.length > max) return undefined;
  return s;
}
function _validId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null;
}
function _sanitiseRules(r) {
  if (!r || typeof r !== 'object') return { match:'all', conditions:[] };
  const match = ['all','any','none'].includes(String(r.match||'').toLowerCase())
    ? String(r.match).toLowerCase() : 'all';
  const conds = Array.isArray(r.conditions) ? r.conditions.slice(0, 30) : [];
  const cleaned = conds.filter(c => c && typeof c === 'object' && c.type)
    .map(c => ({
      type: String(c.type).slice(0,32),
      field:  c.field  !== undefined ? String(c.field).slice(0,80)  : undefined,
      event:  c.event  !== undefined ? String(c.event).slice(0,80)  : undefined,
      metric: c.metric !== undefined ? String(c.metric).slice(0,40) : undefined,
      source: c.source !== undefined ? String(c.source).slice(0,40) : undefined,
      op:     c.op     !== undefined ? String(c.op).slice(0,16)     : undefined,
      value:  c.value  !== undefined ? (typeof c.value === 'object' ? null : String(c.value).slice(0,200)) : undefined,
      days:   c.days   !== undefined ? Math.max(0, Math.min(3650, Number(c.days)||0)) : undefined,
    }));
  return { match, conditions: cleaned };
}
function _err(res, status, msg) { return res.status(status).json({ ok:false, error:msg }); }

router.get('/', async (_req, res) => {
  try {
    if (!_db.hasDb()) return res.json({ ok:true, segments:[], db:false });
    const r = await _db.getPool().query(`
      SELECT id, name, description, rules, enabled, member_count, last_evaluated_at, created_at, updated_at
      FROM audience_segments ORDER BY created_at DESC LIMIT 200
    `);
    res.json({ ok:true, db:true, segments:r.rows });
  } catch (err) { _err(res, 500, err.message); }
});

router.get('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const r = await _db.getPool().query(`SELECT * FROM audience_segments WHERE id=$1`, [id]);
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.post('/', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const name = _str(req.body?.name, 120);
    if (!name) return _err(res, 400, 'name required');
    const description = _str(req.body?.description, 600) || null;
    const rules = _sanitiseRules(req.body?.rules);
    const r = await _db.getPool().query(`
      INSERT INTO audience_segments (name, description, rules, owner_email)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [name, description, JSON.stringify(rules), _str(req.body?.owner_email, 200) || null]);
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.put('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const name = _str(req.body?.name, 120);
    const description = _str(req.body?.description, 600);
    const rules = req.body?.rules ? _sanitiseRules(req.body.rules) : null;
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : null;
    const fields = []; const vals = []; let i = 1;
    if (name !== undefined && name !== null) { fields.push(`name=$${i++}`); vals.push(name); }
    if (description !== undefined)            { fields.push(`description=$${i++}`); vals.push(description); }
    if (rules)                                { fields.push(`rules=$${i++}`); vals.push(JSON.stringify(rules)); }
    if (enabled !== null)                     { fields.push(`enabled=$${i++}`); vals.push(enabled); }
    if (!fields.length) return _err(res, 400, 'no fields to update');
    fields.push(`updated_at=now()`);
    vals.push(id);
    const r = await _db.getPool().query(
      `UPDATE audience_segments SET ${fields.join(', ')} WHERE id=$${i} RETURNING *`, vals
    );
    if (!r.rows.length) return _err(res, 404, 'not found');
    res.json({ ok:true, segment:r.rows[0] });
  } catch (err) { _err(res, 500, err.message); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    await _db.getPool().query(`DELETE FROM audience_segments WHERE id=$1`, [id]);
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

// Live preview — does NOT require the segment to be saved first.
// Body: { rules:{ match, conditions:[...] }, segmentId?:number }
router.post('/preview', async (req, res) => {
  try {
    const rules = _sanitiseRules(req.body?.rules);
    const result = await previewSegmentLive(rules, { limit: 100 });
    const sid = _validId(req.body?.segmentId);
    if (sid && _db.hasDb() && result.ok) {
      // Best-effort snapshot — don't fail the preview if the segment row is gone.
      try { await snapshotSegmentCount(sid, result.matches); } catch(_) {}
    }
    res.json({ ok:true, preview:result });
  } catch (err) { _err(res, 500, err.message); }
});

// ── Phase 2 — real-time evaluation, members, log, webhook ──────────────────

// Force a sweep against a single segment (or ALL enabled segments if no id).
router.post('/refresh', async (_req, res) => {
  try {
    const result = await runSweepOnce();
    res.json({ ok:true, run: result });
  } catch (err) { _err(res, 500, err.message); }
});

router.post('/:id/refresh', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const result = await runSweepOnce({ segmentId: id });
    res.json({ ok:true, run: result });
  } catch (err) { _err(res, 500, err.message); }
});

// List the live members of a segment (paginated).
router.get('/:id/members', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const limit  = Math.min(Math.max(parseInt(req.query.limit  || '50', 10), 1), 500);
    const offset = Math.max(parseInt(req.query.offset || '0',  10), 0);
    const includeFormer = req.query.includeFormer === '1';
    const where = includeFormer
      ? `WHERE segment_id=$1`
      : `WHERE segment_id=$1 AND left_at IS NULL`;
    const r = await _db.getPool().query(`
      SELECT contact_id, contact_email, joined_at, left_at
      FROM audience_segment_members ${where}
      ORDER BY joined_at DESC LIMIT $2 OFFSET $3
    `, [id, limit, offset]);
    const total = await _db.getPool().query(
      `SELECT COUNT(*)::int AS n FROM audience_segment_members ${where}`, [id]
    );
    res.json({ ok:true, members: r.rows, total: total.rows[0].n, limit, offset });
  } catch (err) { _err(res, 500, err.message); }
});

// Recent evaluation runs for a segment — for the "in/out flow" panel.
router.get('/:id/log', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'db not configured');
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const r = await _db.getPool().query(`
      SELECT ran_at, contacts_scanned, members_added, members_removed, duration_ms, source, error
      FROM audience_evaluation_log
      WHERE segment_id=$1 AND ran_at > now() - interval '7 days'
      ORDER BY ran_at DESC LIMIT 100
    `, [id]);
    res.json({ ok:true, log: r.rows });
  } catch (err) { _err(res, 500, err.message); }
});

// HubSpot webhook receiver — fires on contact create/update so we can re-
// evaluate that single contact in real time. HubSpot POSTs an array of events.
// SECURITY:
//   - When HUBSPOT_WEBHOOK_SECRET is set, we enforce HMAC-SHA256 validation
//     using HubSpot's v3 signature scheme (X-HubSpot-Signature-v3).
//   - When unset (dev), we still accept but log a loud warning. In production
//     (NODE_ENV=production) we REJECT unauthenticated webhooks.
const _crypto = require('crypto');
function _verifyHubspotSig(req) {
  const secret = process.env.HUBSPOT_WEBHOOK_SECRET;
  if (!secret) return { ok: process.env.NODE_ENV !== 'production', reason: 'no-secret' };
  const sig = req.get('X-HubSpot-Signature-v3') || '';
  const ts  = req.get('X-HubSpot-Request-Timestamp') || '';
  if (!sig || !ts) return { ok:false, reason:'missing-headers' };
  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return { ok:false, reason:'stale-timestamp' };
  const raw = (req.method || 'POST') + (req.originalUrl || req.url) + (typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body || '')) + ts;
  const expected = _crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
  try {
    const a = Buffer.from(sig, 'base64'); const b = Buffer.from(expected, 'base64');
    return { ok: a.length === b.length && _crypto.timingSafeEqual(a, b), reason:'hmac' };
  } catch { return { ok:false, reason:'sig-decode' }; }
}
router.post('/webhooks/hubspot', async (req, res) => {
  try {
    const v = _verifyHubspotSig(req);
    if (!v.ok) {
      console.warn('[audiences-webhook] rejected:', v.reason);
      return _err(res, 401, 'unauthorized webhook (' + v.reason + ')');
    }
    if (v.reason === 'no-secret') console.warn('[audiences-webhook] HUBSPOT_WEBHOOK_SECRET not set — accepting in dev only');
    const events = Array.isArray(req.body) ? req.body : [req.body];
    const ids = [...new Set(events.map(e => e?.objectId || e?.contactId).filter(Boolean))].slice(0, 50);
    res.json({ ok:true, accepted: ids.length });
    for (const cid of ids) {
      try { await reevaluateContact(String(cid)); }
      catch (e) { console.error('[audiences-webhook]', cid, e.message); }
    }
  } catch (err) { _err(res, 500, err.message); }
});

// ── Phase 3 — Drip binding CRUD ────────────────────────────────────────────
router.get('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const b = await _bridge.getBinding(id);
    res.json({ ok:true, binding: b });
  } catch (err) { _err(res, 500, err.message); }
});
router.post('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    const b = await _bridge.setBinding(id, req.body || {});
    res.json({ ok:true, binding: b });
  } catch (err) { _err(res, 400, err.message); }
});
router.delete('/:id/drip-binding', async (req, res) => {
  try {
    const id = _validId(req.params.id);
    if (!id) return _err(res, 400, 'invalid id');
    await _bridge.deleteBinding(id);
    res.json({ ok:true });
  } catch (err) { _err(res, 500, err.message); }
});

module.exports = router;

const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const detector = require('./detector');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

router.get('/watchlist', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:watchlist:list' });
    const r = await _db.getPool().query(`
      SELECT w.*, (SELECT COUNT(*) FROM crisis_snapshots s WHERE s.watchlist_id=w.id)::int AS snapshots,
        (SELECT COUNT(*) FROM crisis_incidents i WHERE i.watchlist_id=w.id AND i.status='open')::int AS open_incidents
      FROM crisis_watchlist w WHERE w.tenant_id=$1 ORDER BY w.id ASC`, [tid]);
    res.json({ ok:true, watchlist: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/watchlist', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  if (!brand) return _err(res, 400, 'brand required');
  const competitors = (Array.isArray(req.body?.competitors) ? req.body.competitors : [])
    .map(c => String(c).trim().slice(0, 80)).filter(Boolean).slice(0, 4);
  const country = String(req.body?.country || 'US').toUpperCase().slice(0, 16);
  const spike = Number(req.body?.spike_multiplier);
  const negPct = Number(req.body?.neg_pct_threshold);
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:watchlist:save' });
    if (!tid) return _err(res, 400, 'no_tenant');
    const sp = Number.isFinite(spike) && spike > 0 ? spike : 1.8;
    const np = Number.isFinite(negPct) && negPct > 0 && negPct < 1 ? negPct : 0.35;
    // Atomic upsert on uniq_crisis_tenant_brand_country (Phase 2B).
    const r = await _db.getPool().query(
      `INSERT INTO crisis_watchlist (tenant_id, brand, competitors, country, spike_multiplier, neg_pct_threshold)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, brand, country) DO UPDATE SET
         competitors=EXCLUDED.competitors,
         spike_multiplier=EXCLUDED.spike_multiplier,
         neg_pct_threshold=EXCLUDED.neg_pct_threshold,
         enabled=true
       RETURNING *`,
      [tid, brand, JSON.stringify(competitors), country, sp, np]);
    res.json({ ok:true, item: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/watchlist/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:watchlist:delete' });
    await _db.getPool().query(`DELETE FROM crisis_watchlist WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/incidents', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const status = ['open','acknowledged','resolved'].includes(req.query.status) ? req.query.status : null;
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:incidents:list' });
    const params = [tid]; const where = ['tenant_id=$1'];
    if (status) { params.push(status); where.push(`status=$${params.length}`); }
    const r = await _db.getPool().query(
      `SELECT * FROM crisis_incidents WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, params);
    res.json({ ok:true, incidents: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.patch('/incidents/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  const status = ['open','acknowledged','resolved'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return _err(res, 400, 'bad status');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:incidents:patch' });
    const stamp = status === 'acknowledged' ? 'acknowledged_at=now()' : status === 'resolved' ? 'resolved_at=now()' : 'acknowledged_at=NULL, resolved_at=NULL';
    const r = await _db.getPool().query(
      `UPDATE crisis_incidents SET status=$1, ${stamp} WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [status, id, tid]);
    res.json({ ok:true, item: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/snapshots/:watchlistId', async (req, res) => {
  const id = Number(req.params.watchlistId);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'crisis:snapshots' });
    const r = await _db.getPool().query(
      `SELECT s.* FROM crisis_snapshots s
       JOIN crisis_watchlist w ON w.id=s.watchlist_id
       WHERE s.watchlist_id=$1 AND w.tenant_id=$2
       ORDER BY s.taken_at DESC LIMIT 30`, [id, tid]);
    res.json({ ok:true, snapshots: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/run-now', async (req, res) => {
  try { res.json(await detector.runAll()); }
  catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

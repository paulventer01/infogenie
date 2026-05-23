const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// GET /api/sov/series?brand=<your brand>  → time-series across last 30 days,
// pivoted as { labels:[ts], series:[{ brand, points:[{t, mentions}] }] }
// Only includes the user's actual competitors from crisis_watchlist (plus the brand itself).
router.get('/series', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const target = String(req.query.brand || '').trim().slice(0, 80);
  if (!target) return _err(res, 400, 'brand required');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'sov:series', allowFallback:true });
    const pool = _db.getPool();

    // Get the allowed brand set for this target — the brand itself + its declared competitors.
    let allowed = null;
    try {
      const w = await pool.query(
        `SELECT competitors FROM crisis_watchlist WHERE tenant_id=$1 AND LOWER(brand)=LOWER($2) LIMIT 1`,
        [tid, target]
      );
      if (w.rows.length) {
        const comps = Array.isArray(w.rows[0].competitors) ? w.rows[0].competitors : [];
        allowed = new Set([target.toLowerCase(), ...comps.map(c => String(c).toLowerCase())]);
      }
    } catch {}

    const r = await pool.query(`
      SELECT brand, mentions, pos_count, neu_count, neg_count, taken_at
      FROM sov_snapshots WHERE tenant_id=$1 AND target_brand=$2 AND taken_at > now() - ($3 || ' days')::interval
      ORDER BY taken_at ASC`, [tid, target, String(days)]);

    let rows = r.rows;
    if (allowed) rows = rows.filter(x => allowed.has(String(x.brand).toLowerCase()));

    const brandSet = new Map();
    rows.forEach(x => { if (!brandSet.has(x.brand)) brandSet.set(x.brand, []); brandSet.get(x.brand).push(x); });
    const series = Array.from(brandSet.entries()).map(([brand, pts]) => ({
      brand,
      points: pts.map(p => ({
        t: p.taken_at, mentions: p.mentions,
        pos: p.pos_count, neu: p.neu_count, neg: p.neg_count,
      })),
      total: pts.reduce((s, p) => s + p.mentions, 0),
    })).sort((a, b) => b.total - a.total);
    const grandTotal = series.reduce((s, x) => s + x.total, 0);
    const sov = series.map(s => ({ brand: s.brand, total: s.total, share: grandTotal ? s.total / grandTotal : 0 }));
    res.json({ ok:true, target, days, series, sov, snapshots: rows.length });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /api/sov/targets → distinct target_brand values for the dropdown.
// Filtered to brands the user actively tracks in crisis_watchlist (so stale demo
// entries like "Nike" never leak into the dropdown).
router.get('/targets', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label:'sov:targets', allowFallback:true });
    const pool = _db.getPool();

    let allowedBrands = null;
    try {
      const w = await pool.query(`SELECT DISTINCT brand FROM crisis_watchlist WHERE tenant_id=$1`, [tid]);
      if (w.rows.length) {
        allowedBrands = new Set(w.rows.map(r => String(r.brand).toLowerCase()));
      }
    } catch {}

    const r = await pool.query(`
      SELECT target_brand, COUNT(*)::int AS snapshots, MAX(taken_at) AS last
      FROM sov_snapshots WHERE tenant_id=$1 GROUP BY target_brand ORDER BY last DESC`, [tid]);

    let targets = r.rows;
    if (allowedBrands && allowedBrands.size > 0) {
      targets = targets.filter(t => allowedBrands.has(String(t.target_brand).toLowerCase()));
    } else if (allowedBrands && allowedBrands.size === 0) {
      // User has no watchlist yet — show nothing rather than orphan demo data.
      targets = [];
    }

    res.json({ ok:true, targets });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

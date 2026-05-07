const express = require('express');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// GET /api/sov/series?brand=Nike  → time-series across last 30 days,
// pivoted as { labels:[ts], series:[{ brand, points:[{t, mentions}] }] }
router.get('/series', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const target = String(req.query.brand || '').trim().slice(0, 80);
  if (!target) return _err(res, 400, 'brand required');
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  try {
    const r = await _db.getPool().query(`
      SELECT brand, mentions, pos_count, neu_count, neg_count, taken_at
      FROM sov_snapshots WHERE target_brand=$1 AND taken_at > now() - ($2 || ' days')::interval
      ORDER BY taken_at ASC`, [target, String(days)]);
    const rows = r.rows;
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

// GET /api/sov/targets → distinct target_brand values for the dropdown
router.get('/targets', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const r = await _db.getPool().query(`
      SELECT target_brand, COUNT(*)::int AS snapshots, MAX(taken_at) AS last
      FROM sov_snapshots GROUP BY target_brand ORDER BY last DESC`);
    res.json({ ok:true, targets: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

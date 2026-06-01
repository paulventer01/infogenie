// services/review_monitor/api.js — T46 Deleted Review Detection
// Routes: GET /deleted   GET /stats
// Exported helper: recordSnapshot(tenantId, brand, platform, reviews[])

const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(fn) { return (req, res) => Promise.resolve(fn(req, res)).catch(e => { if (!res.headersSent) _err(res, 500, e.message); }); }

// ── Stable review fingerprint ─────────────────────────────────────────────────
function _reviewId(author, rating, body) {
  const str = `${String(author || '').trim()}|${rating || 0}|${String(body || '').trim().slice(0, 150)}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32);
}

// ── Slack alert helper ────────────────────────────────────────────────────────
async function _sendSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return;
    const body = Buffer.from(JSON.stringify({ text }));
    await new Promise(resolve => {
      const req = _https.request({
        hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
      }, r => { r.resume(); r.on('end', resolve); });
      req.on('error', resolve);
      req.setTimeout(10000, () => { req.destroy(); resolve(); });
      req.write(body); req.end();
    });
  } catch (_) {}
}

// ── Core snapshot helper — called by review_aggregator after every scan ───────
// Returns array of newly-deleted review rows.
async function recordSnapshot(tenantId, brand, platform, reviews) {
  if (!_db.hasDb || !_db.hasDb()) return [];
  if (tenantId == null) return [];
  const pool = _db.getPool();

  // Build list of current review IDs
  const currentIds = reviews.map(rv => _reviewId(rv.author, rv.rating, rv.body));

  // Upsert all current reviews (mark as seen / resurrect if previously deleted)
  for (let i = 0; i < reviews.length; i++) {
    const rv = reviews[i];
    const rid = currentIds[i];
    await pool.query(`
      INSERT INTO review_snapshots (tenant_id, brand, platform, review_id, rating, author, title, body, first_seen_at, last_seen_at, deleted, deleted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),false,NULL)
      ON CONFLICT (tenant_id, brand, platform, review_id) DO UPDATE SET
        last_seen_at = now(),
        deleted      = false,
        deleted_at   = NULL,
        rating       = EXCLUDED.rating,
        title        = EXCLUDED.title
    `, [tenantId, brand, platform, rid,
        Number(rv.rating) || null,
        String(rv.author || '').slice(0, 200),
        rv.title ? String(rv.title).slice(0, 400) : null,
        rv.body  ? String(rv.body).slice(0, 2000)  : null]);
  }

  // Find rows that were active before but are not in the current set → mark deleted
  let newlyDeleted = [];
  if (currentIds.length > 0) {
    // Build a parameterised NOT IN list
    const placeholders = currentIds.map((_, j) => `$${j + 4}`).join(',');
    const r = await pool.query(`
      UPDATE review_snapshots
         SET deleted = true, deleted_at = now()
       WHERE tenant_id = $1 AND brand = $2 AND platform = $3
         AND deleted   = false
         AND review_id NOT IN (${placeholders})
      RETURNING *
    `, [tenantId, brand, platform, ...currentIds]);
    newlyDeleted = r.rows;
  } else {
    // No reviews returned — mark all as deleted
    const r = await pool.query(`
      UPDATE review_snapshots
         SET deleted = true, deleted_at = now()
       WHERE tenant_id = $1 AND brand = $2 AND platform = $3 AND deleted = false
      RETURNING *
    `, [tenantId, brand, platform]);
    newlyDeleted = r.rows;
  }

  // Alert if any reviews disappeared
  if (newlyDeleted.length > 0) {
    const preview = newlyDeleted.slice(0, 3).map(rv =>
      `• ${rv.author || 'Anonymous'} (${rv.rating || '?'}★): "${String(rv.body || '').slice(0, 80)}${(rv.body || '').length > 80 ? '…' : ''}"`
    ).join('\n');
    const text = `🗑️ *Review Deletion Alert* — *${brand}* on *${platform}*\n` +
      `${newlyDeleted.length} review(s) disappeared since the last scan.\n${preview}`;
    _sendSlack(text).catch(() => {});
  }

  return newlyDeleted;
}

// ── GET /api/review-monitor/deleted ──────────────────────────────────────────
router.get('/deleted', _safe(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, deleted: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review-monitor:deleted' });
  if (tid == null) return _err(res, 400, 'no_tenant');

  const brand    = req.query.brand    ? String(req.query.brand).slice(0, 200)    : null;
  const platform = req.query.platform ? String(req.query.platform).slice(0, 40)  : null;
  const params = [tid]; const where = ['tenant_id=$1','deleted=true'];
  if (brand)    { params.push(brand);    where.push(`LOWER(brand)=LOWER($${params.length})`); }
  if (platform) { params.push(platform); where.push(`platform=$${params.length}`); }

  const r = await _db.getPool().query(
    `SELECT * FROM review_snapshots WHERE ${where.join(' AND ')} ORDER BY deleted_at DESC LIMIT 200`,
    params
  );
  res.json({ ok: true, deleted: r.rows });
}));

// ── GET /api/review-monitor/stats ─────────────────────────────────────────────
router.get('/stats', _safe(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, stats: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'review-monitor:stats' });
  if (tid == null) return _err(res, 400, 'no_tenant');

  const brand  = req.query.brand ? String(req.query.brand).slice(0, 200) : null;
  const params = [tid]; const where = ['tenant_id=$1'];
  if (brand) { params.push(brand); where.push(`LOWER(brand)=LOWER($${params.length})`); }

  const r = await _db.getPool().query(`
    SELECT platform,
           COUNT(*) FILTER (WHERE deleted=false) AS active_count,
           COUNT(*) FILTER (WHERE deleted=true)  AS deleted_count,
           COUNT(*) FILTER (WHERE deleted=true AND deleted_at >= date_trunc('month', now())) AS deleted_this_month
      FROM review_snapshots
     WHERE ${where.join(' AND ')}
     GROUP BY platform
     ORDER BY platform
  `, params);
  const totalDeletedThisMonth = r.rows.reduce((s, x) => s + Number(x.deleted_this_month || 0), 0);
  res.json({ ok: true, stats: r.rows, totalDeletedThisMonth });
}));

module.exports = router;
module.exports.recordSnapshot = recordSnapshot;

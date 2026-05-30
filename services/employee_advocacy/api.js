const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const crypto  = require('crypto');
const _tenantCtx = require('../tenants/context');

function pool() { return _db.getPool(); }

// GET /api/advocacy/posts
router.get('/posts', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, posts: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:posts' });
    const r = await pool().query(`SELECT * FROM advocacy_posts WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    res.json({ ok: true, posts: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/advocacy/posts
router.post('/posts', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'No DB' });
  const { title, body, platforms, tags, cta_url } = req.body || {};
  if (!title || !body) return res.status(400).json({ ok: false, error: 'title and body required' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:create-post' });
    const r = await pool().query(
      `INSERT INTO advocacy_posts (tenant_id, title, body, platforms, tags, cta_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, title, body, platforms || ['linkedin','twitter','facebook'], tags || [], cta_url || null, req.user?.id || null]
    );
    res.json({ ok: true, post: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT /api/advocacy/posts/:id
router.put('/posts/:id', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'No DB' });
  const { title, body, platforms, tags, cta_url, status } = req.body || {};
  try {
    const r = await pool().query(
      `UPDATE advocacy_posts SET title=COALESCE($1,title), body=COALESCE($2,body),
       platforms=COALESCE($3,platforms), tags=COALESCE($4,tags), cta_url=COALESCE($5,cta_url),
       status=COALESCE($6,status), updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [title, body, platforms, tags, cta_url, status, req.params.id]
    );
    res.json({ ok: true, post: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/advocacy/posts/:id
router.delete('/posts/:id', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'No DB' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:delete-post' });
    await pool().query(`DELETE FROM advocacy_posts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/advocacy/share-keys
router.get('/share-keys', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, keys: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:share-keys' });
    const r = await pool().query(`SELECT * FROM advocacy_share_keys WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
    res.json({ ok: true, keys: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/advocacy/share-keys — generate a new share link
router.post('/share-keys', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'No DB' });
  const { label } = req.body || {};
  const key = crypto.randomBytes(16).toString('hex');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:create-share-key' });
    const r = await pool().query(
      `INSERT INTO advocacy_share_keys (tenant_id, share_key, label) VALUES ($1,$2,$3) RETURNING *`,
      [tid, key, label || 'Team Share Link']
    );
    res.json({ ok: true, key: r.rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/advocacy/share-keys/:key
router.delete('/share-keys/:key', async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok: false, error: 'No DB' });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:delete-share-key' });
    await pool().query(`DELETE FROM advocacy_share_keys WHERE share_key=$1 AND tenant_id=$2`, [req.params.key, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/advocacy/public/:shareKey — NO AUTH — for employees
router.get('/public/:shareKey', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, posts: [], valid: false });
  try {
    const kr = await pool().query(
      `SELECT * FROM advocacy_share_keys WHERE share_key=$1 AND active=TRUE`, [req.params.shareKey]
    );
    if (!kr.rows.length) return res.status(404).json({ ok: false, valid: false, error: 'Share link not found or deactivated' });
    const pr = await pool().query(`SELECT * FROM advocacy_posts WHERE status='active' ORDER BY created_at DESC`);
    res.json({ ok: true, valid: true, label: kr.rows[0].label, posts: pr.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/advocacy/log-share — track when employee shares
router.post('/log-share', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true });
  const { share_key, platform, post_id } = req.body || {};
  try {
    // Public endpoint — share_key is the auth. Inherit tenant_id from the key row.
    const kr = await pool().query(`SELECT tenant_id FROM advocacy_share_keys WHERE share_key=$1`, [share_key]);
    if (!kr.rows.length) return res.json({ ok: true });
    await pool().query(
      `INSERT INTO advocacy_shares (tenant_id, share_key, platform, post_id) VALUES ($1,$2,$3,$4)`,
      [kr.rows[0].tenant_id, share_key, platform, post_id]
    );
    res.json({ ok: true });
  } catch (e) { res.json({ ok: true }); }
});

// GET /api/advocacy/stats — share counts per post
router.get('/stats', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, stats: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'advocacy:stats' });
    const r = await pool().query(
      `SELECT post_id, platform, COUNT(*) as shares
       FROM advocacy_shares WHERE tenant_id=$1 GROUP BY post_id, platform ORDER BY post_id`,
      [tid]
    );
    res.json({ ok: true, stats: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;

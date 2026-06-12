const express = require('express');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

const CATEGORIES = ['template','campaign','audience','prompt_pack','landing_page','email_sequence','ai_agent','creative'];

// GET /listings — browse public marketplace
router.get('/listings', async (req, res) => {
  const tid = await _tid(req, 'mp:browse'); if (!tid) return _err(res,400,'no_tenant');
  const { category='', search='' } = req.query;
  const p = await _db.getPool();
  let query = `SELECT l.id, l.title, l.description, l.category, l.tags, l.downloads, l.created_at,
    CASE WHEN l.tenant_id=$1 THEN true ELSE false END as is_mine
    FROM marketplace_listings l WHERE l.is_public=TRUE`;
  const params = [tid];
  if (category) { params.push(category); query += ` AND l.category=$${params.length}`; }
  if (search) { params.push('%'+search+'%'); query += ` AND (l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`; }
  query += ' ORDER BY l.downloads DESC, l.created_at DESC LIMIT 50';
  const rows = await p.query(query, params);
  res.json({ ok:true, listings: rows.rows, categories: CATEGORIES });
});

// GET /my-listings
router.get('/my-listings', async (req, res) => {
  const tid = await _tid(req, 'mp:mine'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM marketplace_listings WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok:true, listings: rows.rows });
});

// POST /listings — publish a new listing
router.post('/listings', async (req, res) => {
  const tid = await _tid(req, 'mp:publish'); if (!tid) return _err(res,400,'no_tenant');
  const { title, description, category='template', tags=[], content={}, is_public=true } = req.body || {};
  if (!title) return _err(res,400,'title required');
  if (!CATEGORIES.includes(category)) return _err(res,400,'invalid category');
  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO marketplace_listings(tenant_id,title,description,category,tags,content,is_public) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tid, title, description||'', category, tags, JSON.stringify(content), is_public]
  );
  res.json({ ok:true, listing: ins.rows[0] });
});

// PUT /listings/:id
router.put('/listings/:id', async (req, res) => {
  const tid = await _tid(req, 'mp:update'); if (!tid) return _err(res,400,'no_tenant');
  const { title, description, tags, content, is_public } = req.body || {};
  const p = await _db.getPool();
  const row = await p.query(`SELECT id FROM marketplace_listings WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!row.rows.length) return _err(res,404,'not found');
  const sets = [], vals = [];
  if (title !== undefined) { vals.push(title); sets.push(`title=$${vals.length}`); }
  if (description !== undefined) { vals.push(description); sets.push(`description=$${vals.length}`); }
  if (tags !== undefined) { vals.push(tags); sets.push(`tags=$${vals.length}`); }
  if (content !== undefined) { vals.push(JSON.stringify(content)); sets.push(`content=$${vals.length}`); }
  if (is_public !== undefined) { vals.push(is_public); sets.push(`is_public=$${vals.length}`); }
  if (!sets.length) return _err(res,400,'nothing to update');
  vals.push(req.params.id);
  await p.query(`UPDATE marketplace_listings SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  res.json({ ok:true });
});

// DELETE /listings/:id
router.delete('/listings/:id', async (req, res) => {
  const tid = await _tid(req, 'mp:delete'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  await p.query(`DELETE FROM marketplace_listings WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

// POST /listings/:id/download — record a download and get the content
router.post('/listings/:id/download', async (req, res) => {
  const tid = await _tid(req, 'mp:download'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const row = await p.query(`SELECT * FROM marketplace_listings WHERE id=$1 AND is_public=TRUE`, [req.params.id]);
  if (!row.rows.length) return _err(res,404,'listing not found');
  await p.query(`UPDATE marketplace_listings SET downloads=downloads+1 WHERE id=$1`, [req.params.id]);
  await p.query(`INSERT INTO marketplace_downloads(listing_id,tenant_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, tid]);
  res.json({ ok:true, listing: row.rows[0] });
});

// GET /stats
router.get('/stats', async (req, res) => {
  const tid = await _tid(req, 'mp:stats'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const [total, mine, downloads] = await Promise.all([
    p.query(`SELECT COUNT(*) FROM marketplace_listings WHERE is_public=TRUE`),
    p.query(`SELECT COUNT(*) FROM marketplace_listings WHERE tenant_id=$1`, [tid]),
    p.query(`SELECT COALESCE(SUM(downloads),0) as total_downloads FROM marketplace_listings WHERE tenant_id=$1`, [tid])
  ]);
  res.json({ ok:true, total_listings:parseInt(total.rows[0].count), my_listings:parseInt(mine.rows[0].count), my_total_downloads:parseInt(downloads.rows[0].total_downloads) });
});

module.exports = router;

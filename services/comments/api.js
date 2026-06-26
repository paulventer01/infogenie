// F13 — Team Collaboration: Asset Comments
// Lightweight threaded comment system for any InfoGenie asset
// (campaigns, journeys, landing pages, experiments, etc.)
// Routes mount at /api/comments

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { return res.status(code).json({ ok:false, error:msg }); }

// ── List comments for an asset ───────────────────────────────────────────
router.get('/', async (req, res) => {
  const { asset_type, asset_id } = req.query;
  if (!asset_type || !asset_id) return _err(res, 400, 'asset_type and asset_id required');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.getPool();
  const r = await p.query(
    `SELECT c.*, u.name as author_name, u.email as author_email
     FROM asset_comments c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.tenant_id=$1 AND c.asset_type=$2 AND c.asset_id=$3 AND c.resolved_at IS NULL
     ORDER BY c.created_at ASC`,
    [tid, asset_type, String(asset_id)]
  );
  res.json({ ok:true, comments: r.rows });
});

// ── Add a comment ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:create' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { asset_type, asset_id, body, parent_id } = req.body;
  if (!asset_type || !asset_id || !body?.trim()) {
    return _err(res, 400, 'asset_type, asset_id, and body required');
  }
  const user_id = req.user?.id || null;
  const p = _db.getPool();
  const r = await p.query(
    `INSERT INTO asset_comments(tenant_id, asset_type, asset_id, user_id, body, parent_id)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tid, asset_type, String(asset_id), user_id, body.trim(), parent_id || null]
  );
  // Fetch author name
  let row = r.rows[0];
  if (user_id) {
    const u = await p.query(`SELECT name, email FROM users WHERE id=$1`, [user_id]);
    if (u.rows[0]) row = { ...row, author_name: u.rows[0].name, author_email: u.rows[0].email };
  }
  res.status(201).json({ ok:true, comment: row });
});

// ── Edit a comment (author only) ─────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:edit' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { body } = req.body;
  if (!body?.trim()) return _err(res, 400, 'body required');
  const user_id = req.user?.id;
  const p = _db.getPool();
  const existing = await p.query(
    `SELECT * FROM asset_comments WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
  );
  if (!existing.rows.length) return _err(res, 404, 'not found');
  if (user_id && existing.rows[0].user_id && existing.rows[0].user_id !== user_id) {
    return _err(res, 403, 'you can only edit your own comments');
  }
  const r = await p.query(
    `UPDATE asset_comments SET body=$1, edited_at=NOW() WHERE id=$2 AND tenant_id=$3 RETURNING *`,
    [body.trim(), req.params.id, tid]
  );
  res.json({ ok:true, comment: r.rows[0] });
});

// ── Resolve / delete a comment ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:delete' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.getPool();
  const existing = await p.query(
    `SELECT * FROM asset_comments WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
  );
  if (!existing.rows.length) return _err(res, 404, 'not found');
  const user_id = req.user?.id;
  if (user_id && existing.rows[0].user_id && existing.rows[0].user_id !== user_id) {
    return _err(res, 403, 'you can only delete your own comments');
  }
  await p.query(`UPDATE asset_comments SET resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

// ── Resolve a thread (mark all replies resolved) ─────────────────────────
router.post('/:id/resolve', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:resolve' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = _db.getPool();
  await p.query(
    `UPDATE asset_comments SET resolved_at=NOW() WHERE (id=$1 OR parent_id=$1) AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok:true });
});

// ── React (emoji reactions) ───────────────────────────────────────────────
router.post('/:id/react', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'comments:react' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { emoji } = req.body;
  if (!emoji) return _err(res, 400, 'emoji required');
  const allowed = ['👍','👎','❤️','🎉','🚀','👀','✅','🔥'];
  if (!allowed.includes(emoji)) return _err(res, 400, 'unsupported emoji');
  const p = _db.getPool();
  const r = await p.query(
    `UPDATE asset_comments
     SET reactions = jsonb_set(
       COALESCE(reactions, '{}'),
       $1::text[],
       to_jsonb(COALESCE((reactions->$2)::int, 0) + 1)
     )
     WHERE id=$3 AND tenant_id=$4 RETURNING reactions`,
    [[emoji], emoji, req.params.id, tid]
  );
  if (!r.rows.length) return _err(res, 404, 'not found');
  res.json({ ok:true, reactions: r.rows[0].reactions });
});

module.exports = router;

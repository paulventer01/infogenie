const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

const CATEGORIES = [
  { id: 'brand',     label: 'Brand Calendar',    color: '#0EA5E9' },
  { id: 'email',     label: 'Email Marketing',   color: '#8B5CF6' },
  { id: 'sms_wa',    label: 'SMS & WhatsApp',    color: '#10B981' },
  { id: 'social',    label: 'Social Media',      color: '#EC4899' },
  { id: 'content',   label: 'Content',           color: '#F59E0B' },
  { id: 'ads',       label: 'Ads',               color: '#EF4444' },
  { id: 'event',     label: 'Event',             color: '#6366F1' },
  { id: 'survey',    label: 'Surveys',           color: '#14B8A6' },
  { id: 'website',   label: 'Website Activities',color: '#64748B' },
  { id: 'mine',      label: 'My Activities',     color: '#A855F7' }
];

router.get('/categories', (_req, res) => res.json({ categories: CATEGORIES }));

router.get('/', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ items: [] });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'brand_calendar:list', allowFallback:true });
    const cat = req.query.category;
    const from = req.query.from, to = req.query.to;
    const conds = ['tenant_id = $1']; const params = [tid];
    if (cat) { params.push(cat); conds.push(`category=$${params.length}`); }
    if (from) { params.push(from); conds.push(`scheduled_at >= $${params.length}`); }
    if (to)   { params.push(to);   conds.push(`scheduled_at <= $${params.length}`); }
    const where = `WHERE ${conds.join(' AND ')}`;
    const r = await pool.query(`SELECT * FROM brand_calendar_items ${where} ORDER BY scheduled_at ASC LIMIT 500`, params);
    res.json({ items: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'brand_calendar:save', allowFallback:true });
    if (!tid) return res.status(400).json({ error: 'no_tenant' });
    const { id, category, title, scheduled_at, notes = '', project_id, status = 'planned' } = req.body || {};
    if (!category || !title || !scheduled_at) return res.status(400).json({ error: 'category, title, scheduled_at required' });
    if (!CATEGORIES.find(c => c.id === category)) return res.status(400).json({ error: 'invalid category' });
    const iid = id || ('bcal_' + crypto.randomBytes(5).toString('hex'));
    await pool.query(
      `INSERT INTO brand_calendar_items (id,tenant_id,category,title,scheduled_at,notes,project_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         category=EXCLUDED.category, title=EXCLUDED.title, scheduled_at=EXCLUDED.scheduled_at,
         notes=EXCLUDED.notes, project_id=EXCLUDED.project_id, status=EXCLUDED.status
       WHERE brand_calendar_items.tenant_id = EXCLUDED.tenant_id`,
      [iid, tid, category, title, scheduled_at, notes, project_id || null, status]
    );
    res.json({ ok: true, id: iid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tenantCtx.resolveTenantId(req, { label:'brand_calendar:delete', allowFallback:true });
    const r = await pool.query(`DELETE FROM brand_calendar_items WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;

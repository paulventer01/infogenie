const express = require('express');
const router = express.Router();
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

router.get('/', async (_req, res) => {
  try {
    if (!hasDb()) return res.json({ projects: [] });
    const r = await pool.query(`SELECT * FROM marketing_projects ORDER BY updated_at DESC`);
    res.json({ projects: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const { id, name, goal = '', monthly_budget = 0, channels = [], owner_email, brand_color = '#0066FF', start_date, end_date, status = 'active' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const pid = id || ('proj_' + crypto.randomBytes(5).toString('hex'));
    await pool.query(
      `INSERT INTO marketing_projects (id,name,goal,monthly_budget,channels,owner_email,brand_color,start_date,end_date,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, goal=EXCLUDED.goal, monthly_budget=EXCLUDED.monthly_budget,
         channels=EXCLUDED.channels, owner_email=EXCLUDED.owner_email, brand_color=EXCLUDED.brand_color,
         start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, status=EXCLUDED.status,
         updated_at=now()`,
      [pid, name, goal, +monthly_budget||0, JSON.stringify(channels), owner_email || null, brand_color, start_date || null, end_date || null, status]
    );
    res.json({ ok: true, id: pid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    await pool.query(`DELETE FROM marketing_projects WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

function genId() { return 'jny_' + crypto.randomBytes(6).toString('hex'); }

// ── List journeys ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ journeys: [] });
    const r = await pool.query(`SELECT id,name,description,status,trigger_type,trigger_config,nodes,edges,stats,updated_at FROM journeys ORDER BY updated_at DESC`);
    res.json({ journeys: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get a single journey ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(404).json({ error: 'no db' });
    const r = await pool.query(`SELECT * FROM journeys WHERE id=$1`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ journey: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create / update ──────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const { id, name, description = '', status = 'draft', trigger_type = 'manual', trigger_config = {}, nodes = [], edges = [] } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const jid = id || genId();
    await pool.query(
      `INSERT INTO journeys (id,name,description,status,trigger_type,trigger_config,nodes,edges)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, description=EXCLUDED.description, status=EXCLUDED.status,
         trigger_type=EXCLUDED.trigger_type, trigger_config=EXCLUDED.trigger_config,
         nodes=EXCLUDED.nodes, edges=EXCLUDED.edges, updated_at=now()`,
      [jid, name, description, status, trigger_type, JSON.stringify(trigger_config), JSON.stringify(nodes), JSON.stringify(edges)]
    );
    res.json({ ok: true, id: jid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    await pool.query(`DELETE FROM journeys WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Activate / pause ─────────────────────────────────
router.post('/:id/status', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const status = String(req.body?.status || '').toLowerCase();
    if (!['draft', 'active', 'paused'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    await pool.query(`UPDATE journeys SET status=$1, updated_at=now() WHERE id=$2`, [status, req.params.id]);
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manually start a journey for a contact ───────────
router.post('/:id/start', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const { contact_email, contact_phone, contact_meta = {} } = req.body || {};
    const jr = await pool.query(`SELECT nodes,status FROM journeys WHERE id=$1`, [req.params.id]);
    if (!jr.rows.length) return res.status(404).json({ error: 'journey not found' });
    if (jr.rows[0].status === 'paused') return res.status(400).json({ error: 'journey is paused' });
    const nodes = jr.rows[0].nodes || [];
    const trigger = nodes.find(n => n.type === 'trigger');
    if (!trigger) return res.status(400).json({ error: 'journey has no trigger node' });
    const r = await pool.query(
      `INSERT INTO journey_runs (journey_id, contact_email, contact_phone, contact_meta, current_node, next_run_at)
       VALUES ($1,$2,$3,$4,$5, now()) RETURNING id`,
      [req.params.id, contact_email || null, contact_phone || null, JSON.stringify(contact_meta), trigger.id]
    );
    await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{started}', ((COALESCE(stats->>'started','0')::int)+1)::text::jsonb) WHERE id=$1`, [req.params.id]);
    res.json({ ok: true, run_id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Run history (most recent 50) ─────────────────────
router.get('/:id/runs', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ runs: [] });
    const r = await pool.query(
      `SELECT id,contact_email,current_node,status,started_at,completed_at,jsonb_array_length(log) as steps
       FROM journey_runs WHERE journey_id=$1 ORDER BY started_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ runs: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

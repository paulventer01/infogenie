const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

function genId() { return 'jny_' + crypto.randomBytes(6).toString('hex'); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}

// ── List journeys (tenant-scoped) ─────────────────────
router.get('/', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ journeys: [] });
    const tid = await _tid(req, 'journeys:list');
    const r = await pool.query(
      `SELECT id,name,description,status,trigger_type,trigger_config,nodes,edges,stats,updated_at
         FROM journeys WHERE tenant_id=$1 ORDER BY updated_at DESC`,
      [tid]
    );
    res.json({ journeys: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get a single journey ──────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(404).json({ error: 'no db' });
    const tid = await _tid(req, 'journeys:get');
    const r = await pool.query(
      `SELECT * FROM journeys WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({ journey: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create / update ──────────────────────────────────
// Journey ids are user-generatable TEXT, so we must guard against a tenant
// re-using/upserting another tenant's id. We pre-check ownership; if the id
// already exists but belongs to a different tenant, reject 403.
router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const { id, name, description = '', status = 'draft', trigger_type = 'manual', trigger_config = {}, nodes = [], edges = [] } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const tid = await _tid(req, 'journeys:upsert');
    const jid = id || genId();
    // Atomic upsert with tenant-gated conflict branch. The ON CONFLICT WHERE
    // clause guarantees that a colliding id owned by a different tenant
    // cannot be overwritten even under concurrent requests. Pre-check is
    // kept only to produce a friendly 403 in the no-race case.
    const owner = await pool.query(`SELECT tenant_id FROM journeys WHERE id=$1`, [jid]);
    if (owner.rows.length && owner.rows[0].tenant_id != null && owner.rows[0].tenant_id !== tid) {
      return res.status(403).json({ error: 'journey id belongs to another tenant' });
    }
    const up = await pool.query(
      `INSERT INTO journeys (id,tenant_id,name,description,status,trigger_type,trigger_config,nodes,edges)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id=COALESCE(journeys.tenant_id, EXCLUDED.tenant_id),
         name=EXCLUDED.name, description=EXCLUDED.description, status=EXCLUDED.status,
         trigger_type=EXCLUDED.trigger_type, trigger_config=EXCLUDED.trigger_config,
         nodes=EXCLUDED.nodes, edges=EXCLUDED.edges, updated_at=now()
       WHERE journeys.tenant_id IS NULL OR journeys.tenant_id = EXCLUDED.tenant_id
       RETURNING id`,
      [jid, tid, name, description, status, trigger_type, JSON.stringify(trigger_config), JSON.stringify(nodes), JSON.stringify(edges)]
    );
    if (up.rowCount === 0) {
      // Conflict existed but tenant guard blocked the update — another
      // tenant claimed this id between our pre-check and the upsert.
      return res.status(403).json({ error: 'journey id belongs to another tenant' });
    }
    res.json({ ok: true, id: jid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Delete ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tid(req, 'journeys:delete');
    await pool.query(`DELETE FROM journeys WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Activate / pause (tenant-scoped) ─────────────────
router.post('/:id/status', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const status = String(req.body?.status || '').toLowerCase();
    if (!['draft', 'active', 'paused'].includes(status)) return res.status(400).json({ error: 'invalid status' });
    const tid = await _tid(req, 'journeys:status');
    const r = await pool.query(
      `UPDATE journeys SET status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3`,
      [status, req.params.id, tid]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Manually start a journey for a contact ───────────
router.post('/:id/start', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const tid = await _tid(req, 'journeys:start');
    const { contact_email, contact_phone, contact_meta = {} } = req.body || {};
    const jr = await pool.query(
      `SELECT nodes,status,tenant_id FROM journeys WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid]
    );
    if (!jr.rows.length) return res.status(404).json({ error: 'journey not found' });
    if (jr.rows[0].status === 'paused') return res.status(400).json({ error: 'journey is paused' });
    const nodes = jr.rows[0].nodes || [];
    const trigger = nodes.find(n => n.type === 'trigger');
    if (!trigger) return res.status(400).json({ error: 'journey has no trigger node' });
    const r = await pool.query(
      `INSERT INTO journey_runs (tenant_id, journey_id, contact_email, contact_phone, contact_meta, current_node, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6, now()) RETURNING id`,
      [jr.rows[0].tenant_id, req.params.id, contact_email || null, contact_phone || null, JSON.stringify(contact_meta), trigger.id]
    );
    await pool.query(
      `UPDATE journeys SET stats = jsonb_set(stats,'{started}', ((COALESCE(stats->>'started','0')::int)+1)::text::jsonb)
         WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, tid]
    );
    res.json({ ok: true, run_id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Run history (most recent 50) ─────────────────────
// Joined with journeys so a guessed id from another tenant returns empty.
router.get('/:id/runs', async (req, res) => {
  try {
    if (!hasDb()) return res.json({ runs: [] });
    const tid = await _tid(req, 'journeys:runs');
    const own = await pool.query(`SELECT 1 FROM journeys WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!own.rows.length) return res.status(404).json({ error: 'not found' });
    const r = await pool.query(
      `SELECT id,contact_email,current_node,status,started_at,completed_at,jsonb_array_length(log) as steps
       FROM journey_runs WHERE journey_id=$1 ORDER BY started_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ runs: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

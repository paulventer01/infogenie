const express = require('express');
const router = express.Router();
const _db = require('../../db');
const hasDb = () => _db.hasDb();
const pool = { query: (...a) => _db.getPool().query(...a) };
const crypto = require('crypto');

const SIGNAL_TYPES = [
  { id: 'mention_spike',    label: 'Mention volume spike',     desc: 'Brand mentions surge above normal' },
  { id: 'sentiment_drop',   label: 'Sentiment drops negative', desc: 'Average sentiment turns sour' },
  { id: 'competitor_price', label: 'Competitor price change',  desc: 'A tracked competitor changes pricing' },
  { id: 'trending_keyword', label: 'New trending keyword',     desc: 'A keyword in your space starts trending' },
  { id: 'review_negative',  label: 'New negative review',      desc: '1-2 star review posted on a tracked source' },
  { id: 'crisis_alert',     label: 'Crisis radar alert',       desc: 'Crisis Radar flags a potential PR issue' },
  { id: 'manual',           label: 'Manual trigger',           desc: 'You fire it from the UI' }
];

router.get('/types', (_req, res) => res.json({ types: SIGNAL_TYPES }));

router.get('/', async (_req, res) => {
  try {
    if (!hasDb()) return res.json({ triggers: [] });
    const r = await pool.query(`SELECT * FROM signal_triggers ORDER BY created_at DESC`);
    res.json({ triggers: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    const { id, name, signal_type, condition = {}, journey_id, enabled = true } = req.body || {};
    if (!name || !signal_type) return res.status(400).json({ error: 'name + signal_type required' });
    const tid = id || ('sig_' + crypto.randomBytes(5).toString('hex'));
    await pool.query(
      `INSERT INTO signal_triggers (id,name,signal_type,condition,journey_id,enabled)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         name=EXCLUDED.name, signal_type=EXCLUDED.signal_type,
         condition=EXCLUDED.condition, journey_id=EXCLUDED.journey_id, enabled=EXCLUDED.enabled`,
      [tid, name, signal_type, JSON.stringify(condition), journey_id || null, !!enabled]
    );
    res.json({ ok: true, id: tid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!hasDb()) return res.status(503).json({ error: 'database not configured' });
    await pool.query(`DELETE FROM signal_triggers WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fire a signal — used by other services (or by the manual UI button) to push an event in.
// Each enabled trigger matching the signal_type spawns a journey run for the contact in the payload.
async function fireSignal(signal_type, payload = {}) {
  if (!hasDb()) return { matched: 0 };
  await pool.query(`INSERT INTO signal_events (signal_type, payload) VALUES ($1,$2)`, [signal_type, JSON.stringify(payload)]);
  const t = await pool.query(`SELECT * FROM signal_triggers WHERE signal_type=$1 AND enabled=true`, [signal_type]);
  let matched = 0;
  for (const tr of t.rows) {
    if (!tr.journey_id) continue;
    // Optional condition gate (numeric threshold on payload.value)
    const cond = tr.condition || {};
    if (cond.minValue != null && Number(payload.value || 0) < Number(cond.minValue)) continue;
    if (cond.keyword && !String(JSON.stringify(payload)).toLowerCase().includes(String(cond.keyword).toLowerCase())) continue;
    try {
      // Spawn journey run
      const jr = await pool.query(`SELECT nodes,status FROM journeys WHERE id=$1`, [tr.journey_id]);
      if (!jr.rows.length || jr.rows[0].status === 'paused') continue;
      const trigger = (jr.rows[0].nodes || []).find(n => n.type === 'trigger');
      if (!trigger) continue;
      await pool.query(
        `INSERT INTO journey_runs (journey_id, contact_email, contact_phone, contact_meta, current_node, next_run_at)
         VALUES ($1,$2,$3,$4,$5, now())`,
        [tr.journey_id, payload.email || null, payload.phone || null, JSON.stringify({ ...payload, signal_type }), trigger.id]
      );
      await pool.query(`UPDATE signal_triggers SET last_fired_at=now(), fire_count=fire_count+1 WHERE id=$1`, [tr.id]);
      await pool.query(`UPDATE journeys SET stats = jsonb_set(stats,'{started}', ((COALESCE(stats->>'started','0')::int)+1)::text::jsonb) WHERE id=$1`, [tr.journey_id]);
      matched++;
    } catch (e) {
      console.warn('[signal-triggers] fire failed:', e.message);
    }
  }
  return { matched };
}

router.post('/fire', async (req, res) => {
  try {
    const { signal_type, payload = {} } = req.body || {};
    if (!signal_type) return res.status(400).json({ error: 'signal_type required' });
    const out = await fireSignal(signal_type, payload);
    res.json({ ok: true, ...out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/events/recent', async (_req, res) => {
  try {
    if (!hasDb()) return res.json({ events: [] });
    const r = await pool.query(`SELECT * FROM signal_events ORDER BY created_at DESC LIMIT 30`);
    res.json({ events: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.fireSignal = fireSignal;

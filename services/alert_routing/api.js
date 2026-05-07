const express = require('express');
const _db = require('../../db');
const { dispatchEvent, VALID_TRIGGERS, VALID_CHANNELS } = require('./dispatcher');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _normalizeRule(p = {}) {
  const trigger_kind = VALID_TRIGGERS.includes(p.trigger_kind) ? p.trigger_kind : 'crisis_incident';
  const channels = Array.isArray(p.channels) ? p.channels.filter(c => c && VALID_CHANNELS.includes(c.kind)).map(c => ({
    kind: c.kind,
    email: c.kind === 'email' ? String(c.email || '').slice(0, 200) : undefined,
    webhook_url: c.kind === 'slack' && c.webhook_url ? String(c.webhook_url).slice(0, 500) : undefined,
  })) : [];
  return {
    name: String(p.name || '').trim().slice(0, 120) || 'Untitled rule',
    enabled: p.enabled !== false,
    trigger_kind,
    trigger_filter: typeof p.trigger_filter === 'object' && p.trigger_filter ? p.trigger_filter : {},
    channels,
  };
}

router.get('/', async (_req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const r = await _db.getPool().query('SELECT * FROM alert_rules ORDER BY id DESC');
    res.json({ ok:true, rules: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const n = _normalizeRule(req.body);
  try {
    const r = await _db.getPool().query(
      `INSERT INTO alert_rules (name, enabled, trigger_kind, trigger_filter, channels)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [n.name, n.enabled, n.trigger_kind, JSON.stringify(n.trigger_filter), JSON.stringify(n.channels)]);
    res.json({ ok:true, rule: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.put('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  const n = _normalizeRule(req.body);
  try {
    const r = await _db.getPool().query(
      `UPDATE alert_rules SET name=$1, enabled=$2, trigger_kind=$3, trigger_filter=$4, channels=$5
       WHERE id=$6 RETURNING *`,
      [n.name, n.enabled, n.trigger_kind, JSON.stringify(n.trigger_filter), JSON.stringify(n.channels), id]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, rule: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    await _db.getPool().query('DELETE FROM alert_rules WHERE id=$1', [id]);
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/dispatches', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  try {
    const r = await _db.getPool().query(
      `SELECT d.*, r.name AS rule_name FROM alert_dispatches d
       LEFT JOIN alert_rules r ON r.id=d.rule_id ORDER BY d.created_at DESC LIMIT $1`, [limit]);
    res.json({ ok:true, dispatches: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/test/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const r = await _db.getPool().query('SELECT * FROM alert_rules WHERE id=$1', [id]);
    const rule = r.rows[0];
    if (!rule) return _err(res, 404, 'not found');
    const sample = {
      crisis_incident: { kind:'crisis_incident', brand: rule.trigger_filter?.brand || 'TestBrand', severity:'high', incident_kind:'spike', headline:'TEST — sample crisis alert', detail:'This is a test dispatch from your alert rule.' },
      sov_drop: { kind:'sov_drop', brand: rule.trigger_filter?.brand || 'TestBrand', drop_pct: 0.12, headline:'TEST — SoV drop' },
      digest_ready: { kind:'digest_ready', brand: rule.trigger_filter?.brand || 'TestBrand', headline:'TEST — digest ready' },
      mention_volume: { kind:'mention_volume', brand: rule.trigger_filter?.brand || 'TestBrand', headline:'TEST — mention volume' },
      custom: { kind:'custom', brand:'TestBrand', headline:'TEST — custom alert' },
    }[rule.trigger_kind];
    const out = await dispatchEvent(sample);
    res.json({ ok:true, sample, dispatched: out });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

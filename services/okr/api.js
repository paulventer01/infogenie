// Marketing OKR Tracker — connects company-level marketing objectives to live
// campaign data (spend, impressions, clicks, conversions, ROAS) pulled from
// ad_performance_hourly + spend_events so progress updates automatically.
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const hasDb = () => _db.hasDb && _db.hasDb();
const pool  = { query: (...a) => _db.getPool().query(...a) };
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[okr]', e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function _quarterBounds(quarter) {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const q    = parseInt(m[2], 10);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth   = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2,'0')}-01`;
  const endDate = new Date(year, endMonth, 0);
  const end = endDate.toISOString().slice(0,10);
  return { start, end };
}

async function _pullAutoMetric(tid, metric_type, linked_channel, quarter) {
  if (!hasDb()) return null;
  const bounds = _quarterBounds(quarter);
  if (!bounds) return null;
  try {
    if (metric_type === 'spend') {
      const channelClause = linked_channel ? `AND channel ILIKE $4` : '';
      const args = linked_channel
        ? [tid, bounds.start, bounds.end, `%${linked_channel}%`]
        : [tid, bounds.start, bounds.end];
      const r = await pool.query(
        `SELECT COALESCE(SUM(amount_cents),0) AS val FROM spend_events
         WHERE tenant_id=$1 AND occurred_at BETWEEN $2 AND $3 ${channelClause}`,
        args
      );
      return parseFloat(r.rows[0].val) / 100;
    }
    const colMap = {
      impressions: 'impressions',
      clicks: 'clicks',
      conversions: 'conversions',
      roas: null,
      leads: 'conversions',
    };
    if (metric_type === 'roas') {
      const channelFilter = linked_channel
        ? `AND LOWER(c.platform) ILIKE $4`
        : '';
      const args = linked_channel
        ? [tid, bounds.start + ' 00:00:00', bounds.end + ' 23:59:59', `%${linked_channel.toLowerCase()}%`]
        : [tid, bounds.start + ' 00:00:00', bounds.end + ' 23:59:59'];
      const r = await pool.query(
        `SELECT
           COALESCE(SUM(h.spend),0)       AS total_spend,
           COALESCE(SUM(h.conversions),0) AS total_conv
         FROM ad_performance_hourly h
         JOIN ad_campaigns c ON c.id = h.campaign_id
         WHERE h.tenant_id=$1
           AND h.recorded_at BETWEEN $2 AND $3
           ${channelFilter}`,
        args
      );
      const sp = parseFloat(r.rows[0].total_spend || 0);
      const cv = parseFloat(r.rows[0].total_conv || 0);
      return sp > 0 && cv > 0 ? parseFloat((cv / sp).toFixed(2)) : null;
    }
    const col = colMap[metric_type];
    if (!col) return null;
    const channelFilter = linked_channel
      ? `AND LOWER(c.platform) ILIKE $4` : '';
    const args = linked_channel
      ? [tid, bounds.start + ' 00:00:00', bounds.end + ' 23:59:59', `%${linked_channel.toLowerCase()}%`]
      : [tid, bounds.start + ' 00:00:00', bounds.end + ' 23:59:59'];
    const r = await pool.query(
      `SELECT COALESCE(SUM(h.${col}),0) AS val
       FROM ad_performance_hourly h
       JOIN ad_campaigns c ON c.id = h.campaign_id
       WHERE h.tenant_id=$1
         AND h.recorded_at BETWEEN $2 AND $3
         ${channelFilter}`,
      args
    );
    return parseFloat(r.rows[0].val);
  } catch (e) {
    console.warn('[okr] auto-metric pull failed:', e.message);
    return null;
  }
}

function _deriveStatus(krs) {
  if (!krs.length) return 'on_track';
  const pcts = krs.map(kr => kr.target_value > 0
    ? Math.min(100, (Number(kr.current_value) / Number(kr.target_value)) * 100)
    : 0);
  const avg = pcts.reduce((s, p) => s + p, 0) / pcts.length;
  if (avg >= 70) return 'on_track';
  if (avg >= 40) return 'at_risk';
  return 'off_track';
}

// ── list objectives ───────────────────────────────────────────────────────────

router.get('/objectives', _safe(async (req, res) => {
  if (!hasDb()) return res.json({ ok: true, objectives: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:list' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { quarter } = req.query;
  const whereQ = quarter ? `AND quarter=$2` : '';
  const args   = quarter ? [tid, quarter] : [tid];
  const objs = await pool.query(
    `SELECT * FROM okr_objectives WHERE tenant_id=$1 ${whereQ} ORDER BY created_at DESC`,
    args
  );
  const krs = await pool.query(
    `SELECT * FROM okr_key_results WHERE tenant_id=$1 ORDER BY created_at ASC`,
    [tid]
  );
  const krMap = {};
  for (const kr of krs.rows) {
    if (!krMap[kr.objective_id]) krMap[kr.objective_id] = [];
    krMap[kr.objective_id].push(kr);
  }
  const objectives = objs.rows.map(o => ({ ...o, key_results: krMap[o.id] || [] }));
  res.json({ ok: true, objectives });
}));

// ── quarters list ─────────────────────────────────────────────────────────────

router.get('/quarters', _safe(async (req, res) => {
  const now = new Date();
  const year = now.getFullYear();
  const q    = Math.ceil((now.getMonth() + 1) / 3);
  const quarters = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dq = 1; dq <= 4; dq++) {
      quarters.push(`${year + dy}-Q${dq}`);
    }
  }
  const current = `${year}-Q${q}`;
  res.json({ ok: true, quarters, current });
}));

// ── create / update objective ─────────────────────────────────────────────────

router.post('/objectives', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:save-obj' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { id, title, description = '', quarter, owner_email = '', status } = req.body || {};
  if (!title || !String(title).trim()) return _err(res, 400, 'title required');
  if (!quarter || !/^\d{4}-Q[1-4]$/.test(quarter)) return _err(res, 400, 'quarter required (format YYYY-Q#)');
  const oid = id || ('okr_' + crypto.randomBytes(6).toString('hex'));
  await pool.query(
    `INSERT INTO okr_objectives(id, tenant_id, title, description, quarter, owner_email, status, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,now())
     ON CONFLICT(id) DO UPDATE SET
       title=EXCLUDED.title, description=EXCLUDED.description,
       quarter=EXCLUDED.quarter, owner_email=EXCLUDED.owner_email,
       status=COALESCE($7, okr_objectives.status), updated_at=now()
     WHERE okr_objectives.tenant_id=$2`,
    [oid, tid, String(title).trim(), String(description), quarter, owner_email, status || 'on_track']
  );
  res.json({ ok: true, id: oid });
}));

// ── delete objective ──────────────────────────────────────────────────────────

router.delete('/objectives/:id', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:del-obj' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await pool.query(
    `DELETE FROM okr_objectives WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
}));

// ── add / update key result ───────────────────────────────────────────────────

router.post('/objectives/:objId/key-results', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:save-kr' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { id, title, metric_type = 'manual', linked_channel = '', target_value = 0, current_value = 0, unit = '' } = req.body || {};
  if (!title || !String(title).trim()) return _err(res, 400, 'title required');
  const krid = id || ('kr_' + crypto.randomBytes(6).toString('hex'));
  await pool.query(
    `INSERT INTO okr_key_results(id, tenant_id, objective_id, title, metric_type, linked_channel, target_value, current_value, unit, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT(id) DO UPDATE SET
       title=EXCLUDED.title, metric_type=EXCLUDED.metric_type,
       linked_channel=EXCLUDED.linked_channel, target_value=EXCLUDED.target_value,
       current_value=EXCLUDED.current_value, unit=EXCLUDED.unit, updated_at=now()
     WHERE okr_key_results.tenant_id=$2`,
    [krid, tid, req.params.objId, String(title).trim(), metric_type, linked_channel, target_value, current_value, unit]
  );
  res.json({ ok: true, id: krid });
}));

// ── delete key result ─────────────────────────────────────────────────────────

router.delete('/key-results/:id', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:del-kr' });
  if (!tid) return _err(res, 400, 'no_tenant');
  await pool.query(
    `DELETE FROM okr_key_results WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  res.json({ ok: true });
}));

// ── refresh auto-metrics for an objective ────────────────────────────────────

router.post('/objectives/:id/refresh', _safe(async (req, res) => {
  if (!hasDb()) return _err(res, 503, 'Database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'okr:refresh' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const objRow = await pool.query(
    `SELECT * FROM okr_objectives WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, tid]
  );
  if (!objRow.rowCount) return _err(res, 404, 'Objective not found');
  const obj = objRow.rows[0];
  const krs = await pool.query(
    `SELECT * FROM okr_key_results WHERE objective_id=$1 AND tenant_id=$2`,
    [obj.id, tid]
  );
  const updated = [];
  for (const kr of krs.rows) {
    if (kr.metric_type === 'manual') { updated.push(kr); continue; }
    const val = await _pullAutoMetric(tid, kr.metric_type, kr.linked_channel, obj.quarter);
    if (val !== null) {
      await pool.query(
        `UPDATE okr_key_results SET current_value=$1, updated_at=now() WHERE id=$2`,
        [val, kr.id]
      );
      updated.push({ ...kr, current_value: val });
    } else {
      updated.push(kr);
    }
  }
  const newStatus = _deriveStatus(updated);
  await pool.query(
    `UPDATE okr_objectives SET status=$1, updated_at=now() WHERE id=$2`,
    [newStatus, obj.id]
  );
  res.json({ ok: true, status: newStatus, key_results: updated });
}));

module.exports = router;

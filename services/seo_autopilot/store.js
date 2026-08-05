const _db = require('../../db');
const { ensureSeoAutopilotSchema } = require('./schema');

const _plans = new Map(); // tid -> plan
const _runs = [];
let _planSeq = 1;
let _runSeq = 1;
let _schemaReady = false;

async function _ensure() {
  if (_schemaReady || !_db.hasDb()) return;
  try {
    await ensureSeoAutopilotSchema();
    _schemaReady = true;
  } catch (e) {
    console.warn('[seo-autopilot] schema:', e.message);
  }
}

function _nextRun(frequency = 'daily', from = new Date()) {
  const d = new Date(from);
  const days = { daily: 1, every3days: 3, weekly: 7 }[frequency] || 1;
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function upsertPlan(tid, body = {}) {
  await _ensure();
  const existing = await getPlan(tid);
  const plan = {
    niche: String(body.niche || existing?.niche || '').trim().slice(0, 200),
    domain: String(body.domain || existing?.domain || '').trim().slice(0, 200),
    brand: String(body.brand || existing?.brand || '').trim().slice(0, 120),
    industry: String(body.industry || existing?.industry || body.niche || '').trim().slice(0, 120),
    tone: String(body.tone || existing?.tone || 'professional').slice(0, 40),
    competitors: Array.isArray(body.competitors) ? body.competitors.slice(0, 10) : (existing?.competitors || []),
    keywords: Array.isArray(body.keywords) ? body.keywords.slice(0, 50) : (existing?.keywords || []),
    calendar: Array.isArray(body.calendar) ? body.calendar.slice(0, 60) : (existing?.calendar || []),
    destinations: Array.isArray(body.destinations) ? body.destinations.slice(0, 8) : (existing?.destinations || []),
    autopilot: body.autopilot != null ? !!body.autopilot : !!existing?.autopilot,
    publish_status: ['draft', 'publish', 'pending'].includes(body.publish_status)
      ? body.publish_status
      : (existing?.publish_status || 'draft'),
    frequency: ['daily', 'every3days', 'weekly'].includes(body.frequency)
      ? body.frequency
      : (existing?.frequency || 'daily'),
    meta: { ...(existing?.meta || {}), ...(body.meta || {}) },
  };
  if (!plan.niche) throw new Error('niche required');

  if (plan.autopilot && !existing?.autopilot) {
    plan.next_run_at = new Date().toISOString();
  } else if (body.next_run_at) {
    plan.next_run_at = body.next_run_at;
  } else {
    plan.next_run_at = existing?.next_run_at || (plan.autopilot ? new Date().toISOString() : null);
  }

  if (_db.hasDb()) {
    const pool = _db.getPool();
    if (existing?.id) {
      const r = await pool.query(
        `UPDATE seo_growth_plans SET
           niche=$1, domain=$2, brand=$3, industry=$4, tone=$5,
           competitors=$6::jsonb, keywords=$7::jsonb, calendar=$8::jsonb, destinations=$9::jsonb,
           autopilot=$10, publish_status=$11, frequency=$12, next_run_at=$13, meta=$14::jsonb, updated_at=NOW()
         WHERE id=$15 AND tenant_id=$16 RETURNING *`,
        [
          plan.niche, plan.domain, plan.brand, plan.industry, plan.tone,
          JSON.stringify(plan.competitors), JSON.stringify(plan.keywords),
          JSON.stringify(plan.calendar), JSON.stringify(plan.destinations),
          plan.autopilot, plan.publish_status, plan.frequency, plan.next_run_at,
          JSON.stringify(plan.meta), existing.id, tid,
        ],
      );
      return _normalize(r.rows[0]);
    }
    const r = await pool.query(
      `INSERT INTO seo_growth_plans
        (tenant_id,niche,domain,brand,industry,tone,competitors,keywords,calendar,destinations,autopilot,publish_status,frequency,next_run_at,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15::jsonb)
       RETURNING *`,
      [
        tid, plan.niche, plan.domain, plan.brand, plan.industry, plan.tone,
        JSON.stringify(plan.competitors), JSON.stringify(plan.keywords),
        JSON.stringify(plan.calendar), JSON.stringify(plan.destinations),
        plan.autopilot, plan.publish_status, plan.frequency, plan.next_run_at,
        JSON.stringify(plan.meta),
      ],
    );
    return _normalize(r.rows[0]);
  }

  const mem = {
    id: existing?.id || _planSeq++,
    tenant_id: tid,
    ...plan,
    last_run_at: existing?.last_run_at || null,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  _plans.set(tid, mem);
  return { ...mem };
}

function _normalize(row) {
  if (!row) return null;
  return {
    ...row,
    competitors: typeof row.competitors === 'string' ? JSON.parse(row.competitors) : (row.competitors || []),
    keywords: typeof row.keywords === 'string' ? JSON.parse(row.keywords) : (row.keywords || []),
    calendar: typeof row.calendar === 'string' ? JSON.parse(row.calendar) : (row.calendar || []),
    destinations: typeof row.destinations === 'string' ? JSON.parse(row.destinations) : (row.destinations || []),
    meta: typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta || {}),
  };
}

async function getPlan(tid) {
  await _ensure();
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT * FROM seo_growth_plans WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 1`,
        [tid],
      );
      return _normalize(r.rows[0]);
    } catch (_) {}
  }
  return _plans.get(tid) || null;
}

async function listDuePlans(limit = 20) {
  await _ensure();
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT * FROM seo_growth_plans
         WHERE autopilot=TRUE AND next_run_at IS NOT NULL AND next_run_at <= NOW()
         ORDER BY next_run_at ASC LIMIT $1`,
        [limit],
      );
      return r.rows.map(_normalize);
    } catch (_) { return []; }
  }
  const now = Date.now();
  return [..._plans.values()]
    .filter((p) => p.autopilot && p.next_run_at && new Date(p.next_run_at).getTime() <= now)
    .slice(0, limit);
}

async function markPlanRan(tid, planId, { nextFrequency = 'daily' } = {}) {
  const next = _nextRun(nextFrequency);
  if (_db.hasDb()) {
    await _db.getPool().query(
      `UPDATE seo_growth_plans SET last_run_at=NOW(), next_run_at=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
      [next, planId, tid],
    );
    return;
  }
  const p = _plans.get(tid);
  if (p && p.id === planId) {
    p.last_run_at = new Date().toISOString();
    p.next_run_at = next;
    p.updated_at = new Date().toISOString();
  }
}

async function updateCalendarItem(tid, dayOrDate, patch) {
  const plan = await getPlan(tid);
  if (!plan) return null;
  const calendar = (plan.calendar || []).map((c) => {
    if (c.day === dayOrDate || c.date === dayOrDate) return { ...c, ...patch };
    return c;
  });
  return upsertPlan(tid, { ...plan, calendar });
}

async function recordRun(row) {
  await _ensure();
  if (_db.hasDb()) {
    const r = await _db.getPool().query(
      `INSERT INTO seo_autopilot_runs
        (tenant_id,plan_id,status,keyword,title,word_count,destinations,publish_results,article_html,error,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb) RETURNING *`,
      [
        row.tenant_id, row.plan_id, row.status || 'ok', row.keyword, row.title,
        row.word_count || null, JSON.stringify(row.destinations || []),
        JSON.stringify(row.publish_results || []), row.article_html || null,
        row.error || null, JSON.stringify(row.meta || {}),
      ],
    );
    return r.rows[0];
  }
  const full = {
    id: _runSeq++,
    created_at: new Date().toISOString(),
    ...row,
  };
  _runs.unshift(full);
  if (_runs.length > 200) _runs.pop();
  return full;
}

async function listRuns(tid, limit = 30) {
  await _ensure();
  if (_db.hasDb()) {
    try {
      const r = await _db.getPool().query(
        `SELECT id, plan_id, status, keyword, title, word_count, destinations, publish_results, error, meta, created_at
         FROM seo_autopilot_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [tid, limit],
      );
      return r.rows;
    } catch (_) {}
  }
  return _runs.filter((r) => r.tenant_id === tid).slice(0, limit);
}

async function recentRunSignals(tid, hours = 48) {
  const since = Date.now() - hours * 3600 * 1000;
  const runs = await listRuns(tid, 20);
  return runs.filter((r) => new Date(r.created_at).getTime() >= since);
}

function _resetMem() {
  _plans.clear();
  _runs.length = 0;
  _planSeq = 1;
  _runSeq = 1;
}

module.exports = {
  upsertPlan,
  getPlan,
  listDuePlans,
  markPlanRan,
  updateCalendarItem,
  recordRun,
  listRuns,
  recentRunSignals,
  _nextRun,
  _resetMem,
};

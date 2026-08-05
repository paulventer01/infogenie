/**
 * AI call traces — fail-open persistence for latency / cost / tier observability.
 */
const _db = require('../../db');
const { ensureAiTracesSchema } = require('./schema');

const _mem = []; // { id, ... } when no DB
let _seq = 1;
let _schemaReady = false;

async function _ensure() {
  if (_schemaReady || !_db.hasDb()) return;
  try {
    await ensureAiTracesSchema();
    _schemaReady = true;
  } catch (e) {
    console.warn('[ai-traces] schema:', e.message);
  }
}

function _estimateCostUsd(provider, model, promptTokens, completionTokens) {
  const p = Number(promptTokens || 0);
  const c = Number(completionTokens || 0);
  // Rough public list prices (USD / 1M tokens) — observability estimate only
  const key = `${provider || ''}:${model || ''}`.toLowerCase();
  let inRate = 0.15;
  let outRate = 0.6;
  if (/gpt-4o-mini|flash|glm-4/.test(key)) { inRate = 0.15; outRate = 0.6; }
  else if (/gpt-4o|claude|glm-5|sonnet/.test(key)) { inRate = 2.5; outRate = 10; }
  else if (/gemini/.test(key)) { inRate = 0.1; outRate = 0.4; }
  return +((p * inRate + c * outRate) / 1_000_000).toFixed(6);
}

async function recordTrace(row = {}) {
  try {
    await _ensure();
    const cost_usd = row.cost_usd != null
      ? row.cost_usd
      : _estimateCostUsd(row.provider, row.model, row.prompt_tokens, row.completion_tokens);
    const rec = {
      tenant_id: row.tenant_id != null ? Number(row.tenant_id) : null,
      surface: row.surface || null,
      category: row.category || null,
      provider: row.provider || null,
      model: row.model || null,
      cascade_tier: row.cascade_tier || null,
      escalated_from: row.escalated_from || null,
      context_pack_id: row.context_pack_id || null,
      latency_ms: row.latency_ms != null ? Math.round(row.latency_ms) : null,
      prompt_tokens: row.prompt_tokens != null ? Number(row.prompt_tokens) : null,
      completion_tokens: row.completion_tokens != null ? Number(row.completion_tokens) : null,
      status: row.status || (row.error ? 'error' : 'ok'),
      error: row.error ? String(row.error).slice(0, 500) : null,
      meta: { ...(row.meta || {}), cost_usd },
    };

    if (_db.hasDb()) {
      const pool = _db.getPool();
      const r = await pool.query(
        `INSERT INTO ai_call_traces
          (tenant_id,surface,category,provider,model,cascade_tier,escalated_from,context_pack_id,
           latency_ms,prompt_tokens,completion_tokens,status,error,meta)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         RETURNING id, created_at`,
        [
          rec.tenant_id, rec.surface, rec.category, rec.provider, rec.model,
          rec.cascade_tier, rec.escalated_from, rec.context_pack_id,
          rec.latency_ms, rec.prompt_tokens, rec.completion_tokens,
          rec.status, rec.error, JSON.stringify(rec.meta),
        ],
      );
      return { id: r.rows[0].id, created_at: r.rows[0].created_at, ...rec, cost_usd };
    }

    const id = _seq++;
    const full = { id, created_at: new Date().toISOString(), ...rec, cost_usd };
    _mem.unshift(full);
    if (_mem.length > 500) _mem.pop();
    return full;
  } catch (e) {
    console.warn('[ai-traces] record failed (fail-open):', e.message);
    return null;
  }
}

async function listTraces({ tenantId, limit = 50, surface } = {}) {
  await _ensure();
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  if (_db.hasDb() && tenantId != null) {
    try {
      const pool = _db.getPool();
      const params = [tenantId];
      let sql = `SELECT * FROM ai_call_traces WHERE tenant_id=$1`;
      if (surface) {
        params.push(surface);
        sql += ` AND surface=$${params.length}`;
      }
      params.push(lim);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const r = await pool.query(sql, params);
      return r.rows.map((row) => ({
        ...row,
        cost_usd: row.meta?.cost_usd ?? _estimateCostUsd(row.provider, row.model, row.prompt_tokens, row.completion_tokens),
      }));
    } catch (_) {}
  }
  return _mem
    .filter((t) => (tenantId == null || t.tenant_id === tenantId) && (!surface || t.surface === surface))
    .slice(0, lim);
}

async function traceStats({ tenantId, hours = 24 } = {}) {
  const since = Date.now() - hours * 3600 * 1000;
  const rows = await listTraces({ tenantId, limit: 500 });
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since);
  const by_tier = {};
  const by_provider = {};
  let latency_sum = 0;
  let latency_n = 0;
  let cost_sum = 0;
  let errors = 0;
  let escalated = 0;
  for (const r of recent) {
    const tier = r.cascade_tier || 'unknown';
    by_tier[tier] = (by_tier[tier] || 0) + 1;
    const prov = r.provider || 'unknown';
    by_provider[prov] = (by_provider[prov] || 0) + 1;
    if (r.latency_ms != null) { latency_sum += r.latency_ms; latency_n += 1; }
    cost_sum += Number(r.cost_usd || r.meta?.cost_usd || 0);
    if (r.status === 'error') errors += 1;
    if (r.escalated_from) escalated += 1;
  }
  return {
    window_hours: hours,
    calls: recent.length,
    errors,
    escalated,
    avg_latency_ms: latency_n ? Math.round(latency_sum / latency_n) : null,
    est_cost_usd: +cost_sum.toFixed(6),
    by_tier,
    by_provider,
  };
}

function _resetMem() {
  _mem.length = 0;
  _seq = 1;
}

module.exports = {
  recordTrace,
  listTraces,
  traceStats,
  _estimateCostUsd,
  _resetMem,
};

/**
 * AI output feedback — thumbs up/down → continuous learning signals + memory.
 */
const crypto = require('crypto');
const _db = require('../../db');
const { ensureAiFeedbackSchema } = require('./schema');

const _mem = [];
let _seq = 1;
let _schemaReady = false;

async function _ensure() {
  if (_schemaReady || !_db.hasDb()) return;
  try {
    await ensureAiFeedbackSchema();
    _schemaReady = true;
  } catch (e) {
    console.warn('[ai-feedback] schema:', e.message);
  }
}

function outputHash(text) {
  return crypto.createHash('sha1').update(String(text || '').slice(0, 4000)).digest('hex').slice(0, 16);
}

async function recordFeedback(row = {}) {
  await _ensure();
  const rating = Number(row.rating);
  if (![ -1, 0, 1 ].includes(rating)) throw new Error('rating must be -1, 0, or 1');
  const rec = {
    tenant_id: Number(row.tenant_id),
    user_email: row.user_email || null,
    surface: row.surface || 'unknown',
    call_trace_id: row.call_trace_id != null ? Number(row.call_trace_id) : null,
    rating,
    comment: row.comment ? String(row.comment).slice(0, 2000) : null,
    output_hash: row.output_hash || (row.output_text ? outputHash(row.output_text) : null),
    meta: row.meta || {},
  };
  if (!rec.tenant_id) throw new Error('tenant_id required');

  let saved;
  if (_db.hasDb()) {
    const pool = _db.getPool();
    const r = await pool.query(
      `INSERT INTO ai_output_feedback
        (tenant_id,user_email,surface,call_trace_id,rating,comment,output_hash,meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [
        rec.tenant_id, rec.user_email, rec.surface, rec.call_trace_id,
        rec.rating, rec.comment, rec.output_hash, JSON.stringify(rec.meta),
      ],
    );
    saved = r.rows[0];
  } else {
    saved = { id: _seq++, created_at: new Date().toISOString(), ...rec };
    _mem.unshift(saved);
    if (_mem.length > 500) _mem.pop();
  }

  // Continuous learning: negative feedback → marketing memory observation
  let memory_id = null;
  if (rating === -1) {
    try {
      const { ingestMemoryNode } = require('../knowledge_graph/api');
      memory_id = await ingestMemoryNode({
        tenant_id: rec.tenant_id,
        node_type: 'manual_observation',
        summary: `AI output disliked on ${rec.surface}${rec.comment ? `: ${rec.comment}` : ''}`,
        detail: {
          kind: 'ai_feedback',
          rating: -1,
          surface: rec.surface,
          call_trace_id: rec.call_trace_id,
          output_hash: rec.output_hash,
        },
        source_ref: `ai_feedback:${saved.id}`,
        importance: 0.65,
      });
    } catch (_) {}
  }

  return { ...saved, memory_id };
}

async function listFeedback({ tenantId, limit = 50, surface } = {}) {
  await _ensure();
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  if (_db.hasDb() && tenantId != null) {
    try {
      const pool = _db.getPool();
      const params = [tenantId];
      let sql = `SELECT * FROM ai_output_feedback WHERE tenant_id=$1`;
      if (surface) {
        params.push(surface);
        sql += ` AND surface=$${params.length}`;
      }
      params.push(lim);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      return (await pool.query(sql, params)).rows;
    } catch (_) {}
  }
  return _mem
    .filter((f) => f.tenant_id === tenantId && (!surface || f.surface === surface))
    .slice(0, lim);
}

async function feedbackStats({ tenantId, hours = 24 * 7 } = {}) {
  const since = Date.now() - hours * 3600 * 1000;
  const rows = await listFeedback({ tenantId, limit: 500 });
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since);
  let up = 0;
  let down = 0;
  let neutral = 0;
  const by_surface = {};
  for (const r of recent) {
    if (r.rating === 1) up += 1;
    else if (r.rating === -1) down += 1;
    else neutral += 1;
    const s = r.surface || 'unknown';
    if (!by_surface[s]) by_surface[s] = { up: 0, down: 0, total: 0 };
    by_surface[s].total += 1;
    if (r.rating === 1) by_surface[s].up += 1;
    if (r.rating === -1) by_surface[s].down += 1;
  }
  const total = up + down + neutral;
  return {
    window_hours: hours,
    total,
    up,
    down,
    neutral,
    approval_rate: total ? +(up / total).toFixed(3) : null,
    by_surface,
    /** Surfaces with high dislike — candidates to keep on strong tier / retune prompts */
    escalate_candidates: Object.entries(by_surface)
      .filter(([, v]) => v.total >= 3 && v.down / v.total >= 0.4)
      .map(([surface, v]) => ({ surface, ...v, down_rate: +(v.down / v.total).toFixed(2) })),
  };
}

function _resetMem() {
  _mem.length = 0;
  _seq = 1;
}

module.exports = {
  recordFeedback,
  listFeedback,
  feedbackStats,
  outputHash,
  _resetMem,
};

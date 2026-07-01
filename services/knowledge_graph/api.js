// Marketing Knowledge Graph — persistent memory layer.
//
// Ingest: every major platform event writes a memory node (summary + embedding).
// Query:  natural-language questions retrieve semantically relevant nodes and
//         return an AI-synthesised answer with source citations.
// Rollup: nodes older than 90 days are periodically summarised into monthly
//         digest nodes to prevent unbounded growth.

const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { normalizeChatParams } = require('../ai_compat');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[knowledge-graph]', e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

function _openAIKey() {
  return process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
}
function _hasOpenAI() {
  const k = _openAIKey();
  return k && !/^_DUMMY/i.test(k);
}

// ── Embedding ─────────────────────────────────────────────────────────────────
async function _embed(text) {
  if (!_hasOpenAI()) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_openAIKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: String(text).slice(0, 8000) }),
    });
    const j = await res.json();
    return j?.data?.[0]?.embedding || null;
  } catch { return null; }
}

function _cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function _parseEmb(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw);
  return null;
}

// ── Core ingest function (exported for fire-and-forget hooks) ─────────────────
async function ingestMemoryNode({ tenant_id, node_type, summary, detail = {}, source_ref = null, importance = 0.5 }) {
  if (!_db.hasDb()) return null;
  if (!tenant_id || !node_type || !summary) return null;

  const validTypes = ['campaign_result','competitor_signal','content_performance','audience_shift','lead_event','manual_observation','ai_synthesis'];
  if (!validTypes.includes(node_type)) return null;

  try {
    const pool = _db.getPool();
    const embedding = await _embed(summary);
    const r = await pool.query(
      `INSERT INTO marketing_memory_nodes
         (tenant_id, node_type, source_ref, summary, detail_json, embedding, importance_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        tenant_id,
        node_type,
        source_ref || null,
        summary.slice(0, 2000),
        JSON.stringify(detail),
        embedding ? JSON.stringify(embedding) : null,
        Math.max(0, Math.min(1, Number(importance) || 0.5)),
      ]
    );
    return r.rows[0]?.id || null;
  } catch (e) {
    console.warn('[knowledge-graph] ingest error:', e.message);
    return null;
  }
}

// ── Retrieve top-k nodes by cosine similarity ─────────────────────────────────
async function _retrieveNodes(tenant_id, queryVec, limit = 8) {
  if (!_db.hasDb()) return [];
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT id, node_type, source_ref, summary, detail_json, importance_score, embedding, created_at
       FROM marketing_memory_nodes
       WHERE tenant_id=$1 AND embedding IS NOT NULL AND rolled_up_at IS NULL
       ORDER BY created_at DESC LIMIT 200`,
      [tenant_id]
    );

    if (!queryVec) {
      return r.rows.slice(0, limit).map(row => ({ ...row, score: row.importance_score }));
    }

    return r.rows
      .map(row => {
        const rawEmb = _parseEmb(row.embedding);
        const sim = _cosine(queryVec, rawEmb);
        return { ...row, score: sim * 0.7 + row.importance_score * 0.3 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch { return []; }
}

// ── Public query helper (used by platform_search /ask and direct callers) ─────
async function queryMemoryNodes(tenant_id, question, queryVec, limit = 6) {
  return _retrieveNodes(tenant_id, queryVec, limit);
}

// ── Monthly rollup (called by cron) ──────────────────────────────────────────
async function runMonthlyRollup() {
  if (!_db.hasDb()) return { rolled: 0 };
  const pool = _db.getPool();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  try {
    const tenants = await pool.query(
      `SELECT DISTINCT tenant_id FROM marketing_memory_nodes
       WHERE created_at < $1 AND rolled_up_at IS NULL`,
      [cutoff.toISOString()]
    );

    let totalRolled = 0;
    for (const row of tenants.rows) {
      const tid = row.tenant_id;

      const old = await pool.query(
        `SELECT id, node_type, summary, created_at FROM marketing_memory_nodes
         WHERE tenant_id=$1 AND created_at < $2 AND rolled_up_at IS NULL
         ORDER BY created_at ASC`,
        [tid, cutoff.toISOString()]
      );
      if (!old.rows.length) continue;

      const grouped = {};
      for (const n of old.rows) {
        const month = n.created_at.toISOString().slice(0, 7);
        if (!grouped[month]) grouped[month] = [];
        grouped[month].push(n);
      }

      for (const [month, nodes] of Object.entries(grouped)) {
        const digest = `Monthly memory digest for ${month}: ${nodes.length} events recorded. Types: ${[...new Set(nodes.map(n => n.node_type))].join(', ')}. Key signals: ${nodes.slice(0, 5).map(n => n.summary).join(' | ')}`;
        const digestId = await ingestMemoryNode({
          tenant_id: tid,
          node_type: 'ai_synthesis',
          summary: digest,
          detail: { month, node_count: nodes.length, source_node_ids: nodes.map(n => n.id) },
          source_ref: `rollup:${month}`,
          importance: 0.6,
        });

        if (digestId) {
          const ids = nodes.map(n => n.id);
          await pool.query(
            `UPDATE marketing_memory_nodes SET rolled_up_at=NOW() WHERE id=ANY($1)`,
            [ids]
          );
          totalRolled += ids.length;
        }
      }
    }

    console.log(`[knowledge-graph] rollup complete — ${totalRolled} nodes rolled up`);
    return { rolled: totalRolled };
  } catch (e) {
    console.warn('[knowledge-graph] rollup error:', e.message);
    return { rolled: 0, error: e.message };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/knowledge-graph/ingest
router.post('/ingest', _safe(async (req, res) => {
  if (!req.isAuthenticated?.() && !req.apiKeyUser) return _err(res, 401, 'auth required');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'kg:ingest' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { node_type, summary, detail, source_ref, importance } = req.body;
  if (!node_type || !summary) return _err(res, 400, 'node_type and summary are required');

  const id = await ingestMemoryNode({ tenant_id: tid, node_type, summary, detail, source_ref, importance });
  if (!id) return _err(res, 500, 'Failed to ingest node');
  res.json({ ok: true, id });
}));

// POST /api/knowledge-graph/query
router.post('/query', _safe(async (req, res) => {
  if (!req.isAuthenticated?.() && !req.apiKeyUser) return _err(res, 401, 'auth required');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'kg:query' });
  if (!tid) return _err(res, 400, 'no_tenant');

  const { question, limit = 8 } = req.body;
  if (!question) return _err(res, 400, 'question is required');

  const queryVec = await _embed(question);
  const nodes = await _retrieveNodes(tid, queryVec, Math.min(Number(limit) || 8, 20));

  if (!nodes.length) {
    return res.json({ ok: true, answer: 'No memory nodes found yet. Start using InfoGenie features to build up your Marketing Memory.', nodes: [], sources: [] });
  }

  const context = nodes.map((n, i) =>
    `[${i+1}] (${n.node_type}, ${new Date(n.created_at).toLocaleDateString()}) ${n.summary}`
  ).join('\n');

  let answer = 'AI synthesis unavailable — set an OpenAI API key to enable it.';
  if (_hasOpenAI()) {
    try {
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: _openAIKey() });
      const chat = await client.chat.completions.create(normalizeChatParams({
        model: 'gpt-4o-mini',
        max_tokens: 600,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a marketing intelligence assistant. Answer the question using only the provided memory nodes. Be concise and cite source numbers like [1], [2]. If the nodes do not contain relevant info, say so.' },
          { role: 'user', content: `Memory nodes:\n${context}\n\nQuestion: ${question}` },
        ],
      }));
      answer = chat.choices?.[0]?.message?.content || answer;
    } catch (e) {
      console.warn('[knowledge-graph] query synthesis error:', e.message);
    }
  }

  res.json({
    ok: true,
    answer,
    nodes: nodes.map(n => ({
      id: n.id,
      node_type: n.node_type,
      summary: n.summary,
      source_ref: n.source_ref,
      importance_score: n.importance_score,
      created_at: n.created_at,
      score: n.score,
    })),
    sources: nodes.map((n, i) => ({ ref: i + 1, node_type: n.node_type, created_at: n.created_at })),
  });
}));

// GET /api/knowledge-graph/nodes
router.get('/nodes', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'kg:nodes' });
  if (!tid) return _err(res, 400, 'no_tenant');

  if (!_db.hasDb()) return res.json({ ok: true, nodes: [], total: 0 });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const per = Math.min(50, parseInt(req.query.per) || 20);
  const offset = (page - 1) * per;
  const type_filter = req.query.node_type || null;

  const pool = _db.getPool();
  const whereExtra = type_filter ? ` AND node_type=$3` : '';
  const params = type_filter ? [tid, per, type_filter, offset] : [tid, per, offset];
  const offsetParam = type_filter ? '$4' : '$3';

  const r = await pool.query(
    `SELECT id, node_type, source_ref, summary, detail_json, importance_score, rolled_up_at, created_at
     FROM marketing_memory_nodes
     WHERE tenant_id=$1${whereExtra} AND rolled_up_at IS NULL
     ORDER BY created_at DESC LIMIT $2 OFFSET ${offsetParam}`,
    params
  );

  const countParams = type_filter ? [tid, type_filter] : [tid];
  const countWhere = type_filter ? `WHERE tenant_id=$1 AND rolled_up_at IS NULL AND node_type=$2` : `WHERE tenant_id=$1 AND rolled_up_at IS NULL`;
  const c = await pool.query(`SELECT COUNT(*) AS n FROM marketing_memory_nodes ${countWhere}`, countParams);

  res.json({ ok: true, nodes: r.rows, total: parseInt(c.rows[0]?.n || 0), page, per });
}));

// GET /api/knowledge-graph/health
router.get('/health', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'kg:health' });
  if (!tid) return _err(res, 400, 'no_tenant');

  if (!_db.hasDb()) return res.json({ ok: true, node_count: 0, oldest_node: null, last_ingested: null, embedding_coverage: 0 });

  const pool = _db.getPool();
  const [cnt, oldest, last, embedded] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS n FROM marketing_memory_nodes WHERE tenant_id=$1 AND rolled_up_at IS NULL`, [tid]),
    pool.query(`SELECT created_at FROM marketing_memory_nodes WHERE tenant_id=$1 AND rolled_up_at IS NULL ORDER BY created_at ASC LIMIT 1`, [tid]),
    pool.query(`SELECT created_at FROM marketing_memory_nodes WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tid]),
    pool.query(`SELECT COUNT(*) AS n FROM marketing_memory_nodes WHERE tenant_id=$1 AND embedding IS NOT NULL AND rolled_up_at IS NULL`, [tid]),
  ]);

  const total = parseInt(cnt.rows[0]?.n || 0);
  const embCount = parseInt(embedded.rows[0]?.n || 0);

  res.json({
    ok: true,
    node_count: total,
    oldest_node: oldest.rows[0]?.created_at || null,
    last_ingested: last.rows[0]?.created_at || null,
    embedding_coverage: total ? Math.round((embCount / total) * 100) : 0,
    has_openai: _hasOpenAI(),
  });
}));

// POST /api/knowledge-graph/rollup (admin/cron — owner only)
router.post('/rollup', _safe(async (req, res) => {
  if (!req.isAuthenticated?.() && !req.apiKeyUser) return _err(res, 401, 'auth required');
  const result = await runMonthlyRollup();
  res.json({ ok: true, ...result });
}));

module.exports = { router, ingestMemoryNode, queryMemoryNodes, runMonthlyRollup };

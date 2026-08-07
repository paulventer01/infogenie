/**
 * Unified context pack — best-effort retrieval before LLM calls.
 * Spec: docs/ai-governance-build-spec.md §6.3
 *
 * Fail-open: never throws to callers; returns a degraded empty pack on errors.
 * Loop-engineering note: packs include recent high-importance outcomes so
 * long-horizon agent loops can continue from prior results (not just chat turns).
 */
const crypto = require('crypto');

const _cache = new Map(); // key -> { pack, expires }
const CACHE_TTL_MS = 60_000;
const MAX_SYSTEM_CHARS = 3500;

function _cacheKey(tenantId, question, surface) {
  const h = crypto.createHash('sha1').update(String(question || '')).digest('hex').slice(0, 16);
  return `${tenantId || 0}|${surface || 'default'}|${h}`;
}

function _newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `cp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function _estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function _lastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i].content) {
      return String(messages[i].content).slice(0, 2000);
    }
  }
  return '';
}

async function _safeEmbed(text) {
  try {
    const kg = require('../knowledge_graph/api');
    if (typeof kg.embedText === 'function') return await kg.embedText(text);
  } catch (_) {}
  try {
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!key || /^_DUMMY/i.test(key)) return null;
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: String(text).slice(0, 8000) }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.[0]?.embedding || null;
  } catch (_) {
    return null;
  }
}

async function _memoryNodes(tenantId, question, limit) {
  try {
    const { queryMemoryNodes } = require('../knowledge_graph/api');
    const vec = await _safeEmbed(question);
    return await queryMemoryNodes(tenantId, question, vec, limit);
  } catch (_) {
    return [];
  }
}

async function _brandBlock(tenantId) {
  try {
    const { getBrandContextBlock } = require('../brand_foundation/api');
    return (await getBrandContextBlock(tenantId)) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Recent outcomes for loop continuity — high-importance memory of result types.
 * Supports long-horizon autonomy (plan → act → learn) without a separate scratchpad.
 */
async function _recentOutcomes(tenantId, limit = 4) {
  try {
    const _db = require('../../db');
    if (!_db.hasDb()) return [];
    const r = await _db.getPool().query(
      `SELECT id, node_type, summary, importance_score, created_at
         FROM marketing_memory_nodes
        WHERE tenant_id=$1
          AND rolled_up_at IS NULL
          AND node_type = ANY($2)
        ORDER BY importance_score DESC, created_at DESC
        LIMIT $3`,
      [tenantId, ['campaign_result', 'ai_synthesis', 'manual_observation', 'content_performance'], limit],
    );
    return r.rows || [];
  } catch (_) {
    return [];
  }
}

function _formatSystemBlock(pack, { strict = false } = {}) {
  const lines = [];
  if (strict) {
    lines.push('Answer ONLY using the CONTEXT_PACK below. If insufficient, say what data is missing.');
  } else {
    lines.push('Prefer answering from the provided CONTEXT_PACK when relevant.');
    lines.push('Cite sources as [memory:ID] when used.');
    lines.push('If context is thin, still be helpful using general marketing expertise —');
    lines.push('but clearly mark any numeric claims not grounded in context as estimates.');
  }

  if (pack.brand_block) {
    lines.push('');
    lines.push(pack.brand_block);
  }

  if (pack.memory_nodes?.length) {
    lines.push('');
    lines.push('[MARKETING MEMORY]');
    pack.memory_nodes.forEach((n, i) => {
      lines.push(`[M${i + 1}|memory:${n.id}] (${n.node_type}, score=${(n.score || 0).toFixed(2)}) ${n.summary}`);
    });
  }

  if (pack.recent_outcomes?.length) {
    lines.push('');
    lines.push('[RECENT OUTCOMES — continue from these loop results]');
    pack.recent_outcomes.forEach((n, i) => {
      lines.push(`[O${i + 1}|memory:${n.id}] (${n.node_type}) ${n.summary}`);
    });
  }

  if (pack.facts?.length) {
    lines.push('');
    lines.push('[FACTS]');
    pack.facts.forEach((f, i) => lines.push(`[F${i + 1}] ${f}`));
  }

  let text = lines.join('\n');
  if (text.length > MAX_SYSTEM_CHARS) {
    text = text.slice(0, MAX_SYSTEM_CHARS - 20) + '\n…[truncated]';
  }
  return text;
}

/**
 * @param {{ tenantId:number|string, userId?:number|string, question?:string, surface?:string, limit?:number, requireContext?:boolean, messages?:Array }} opts
 */
async function buildContextPack(opts = {}) {
  const tenantId = opts.tenantId;
  const question = String(opts.question || _lastUserText(opts.messages) || '').trim();
  const surface = String(opts.surface || 'default');
  const limit = Math.min(12, Math.max(1, Number(opts.limit) || 6));
  const id = _newId();
  const built_at = new Date().toISOString();

  if (tenantId == null) {
    return {
      id,
      tenant_id: null,
      surface,
      system_block: '',
      memory_nodes: [],
      recent_outcomes: [],
      brand_block: '',
      facts: [],
      citations: [],
      tokens_estimate: 0,
      degraded: true,
      degrade_reason: 'no_tenant',
      built_at,
      retrieval_meta: { filtered_by_role: false, node_count: 0, cached: false },
    };
  }

  const key = _cacheKey(tenantId, question, surface);
  const hit = _cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return { ...hit.pack, retrieval_meta: { ...hit.pack.retrieval_meta, cached: true } };
  }

  let degraded = false;
  let degrade_reason = null;
  let memory_nodes = [];
  let brand_block = '';
  let recent_outcomes = [];

  try {
    [memory_nodes, brand_block, recent_outcomes] = await Promise.all([
      _memoryNodes(tenantId, question || surface, limit),
      _brandBlock(tenantId),
      _recentOutcomes(tenantId, 4),
    ]);
  } catch (e) {
    degraded = true;
    degrade_reason = e.message || 'pack_build_failed';
  }

  if (!memory_nodes.length && !brand_block && !recent_outcomes.length) {
    degraded = true;
    degrade_reason = degrade_reason || 'thin_context';
  }

  const citations = memory_nodes.map((n) => ({
    id: n.id,
    type: n.node_type,
    summary: n.summary,
    score: n.score,
  }));

  const pack = {
    id,
    tenant_id: tenantId,
    surface,
    memory_nodes,
    recent_outcomes,
    brand_block,
    facts: [],
    citations,
    degraded,
    degrade_reason,
    built_at,
    retrieval_meta: {
      filtered_by_role: false,
      node_count: memory_nodes.length,
      outcome_count: recent_outcomes.length,
      has_brand: !!brand_block,
      cached: false,
    },
  };

  pack.system_block = _formatSystemBlock(pack, { strict: !!opts.requireContext });
  pack.tokens_estimate = _estimateTokens(pack.system_block);

  _cache.set(key, { pack, expires: Date.now() + CACHE_TTL_MS });
  // opportunistic prune
  if (_cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (v.expires < now) _cache.delete(k);
    }
  }

  return pack;
}

/**
 * Prepend context pack as a system message (idempotent if already injected).
 */
function injectContextIntoMessages(messages, pack) {
  if (!pack?.system_block) return { messages, injected: false };
  const arr = Array.isArray(messages) ? [...messages] : [];
  const marker = 'CONTEXT_PACK';
  if (arr.some((m) => m?.role === 'system' && String(m.content || '').includes('[MARKETING MEMORY]'))) {
    return { messages: arr, injected: false };
  }
  // Avoid double-inject on retries
  if (arr.some((m) => m?.role === 'system' && String(m.content || '').includes(marker))) {
    return { messages: arr, injected: false };
  }
  const sys = {
    role: 'system',
    content: `${pack.system_block}\nCONTEXT_PACK_ID: ${pack.id}`,
  };
  // Keep existing system prompts after the pack so task instructions win on conflicts
  const firstSys = arr.findIndex((m) => m?.role === 'system');
  if (firstSys === 0) {
    arr.splice(0, 0, sys);
  } else if (firstSys > 0) {
    arr.splice(firstSys, 0, sys);
  } else {
    arr.unshift(sys);
  }
  return { messages: arr, injected: true };
}

function clearContextPackCache() {
  _cache.clear();
}

module.exports = {
  buildContextPack,
  injectContextIntoMessages,
  clearContextPackCache,
  _lastUserText,
  _formatSystemBlock,
};

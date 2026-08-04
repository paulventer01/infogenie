// AI Providers — let users plug any OpenAI-compatible LLM endpoint
// (Groq, DeepSeek, Mistral, OpenRouter, Together, Azure OpenAI, Ollama, etc.)
// into InfoGenie and route per-category traffic through it.
//
// Categories: writing · analysis · vision · audio
// Other services can call getDefaultProvider(category, tid) to pick a user-defined
// override before falling back to the built-in OpenAI/Anthropic clients. The
// tid argument is required for tenant isolation — callers must thread their
// resolved tenant id through.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const { normalizeChatParams, isKimi, isMoonshotBaseUrl } = require('../ai_compat');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _redact(row) {
  if (!row) return row;
  const k = row.api_key || '';
  return { ...row, api_key: undefined, api_key_preview: k ? (k.slice(0, 4) + '…' + k.slice(-4)) : '', has_api_key: !!k };
}
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

const VALID_CATEGORIES = ['writing', 'analysis', 'vision', 'audio'];

function _chatBody(baseUrl, model, messages, opts = {}) {
  const raw = {
    model,
    messages,
    max_tokens: opts.max_tokens || 800,
    temperature: opts.temperature ?? 0.7,
    ...(opts.response_format ? { response_format: opts.response_format } : {}),
    ...(opts.reasoning_effort ? { reasoning_effort: opts.reasoning_effort } : {}),
  };
  return normalizeChatParams(raw, { baseUrl });
}

// ── List all providers (redacted) — tenant-scoped
router.get('/list', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  try {
    const tid = await _tid(req, 'ai-providers:list');
    const r = await _db.getPool().query(
      `SELECT id, name, base_url, model, category, is_default, enabled, notes, api_key, created_at, updated_at
         FROM ai_providers WHERE tenant_id=$1 ORDER BY category, is_default DESC, name`,
      [tid]
    );
    res.json({ ok: true, items: r.rows.map(_redact) });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Create
router.post('/create', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const { name, base_url, api_key, model, category, is_default = false, notes = '' } = req.body || {};
  if (!name || !base_url || !api_key || !model || !category) return _err(res, 400, 'name, base_url, api_key, model, category required');
  if (!VALID_CATEGORIES.includes(category)) return _err(res, 400, 'category must be one of ' + VALID_CATEGORIES.join(', '));
  if (!/^https?:\/\//i.test(base_url)) return _err(res, 400, 'base_url must be http(s)');
  try {
    const tid = await _tid(req, 'ai-providers:create');
    const pool = _db.getPool();
    // "default" flag is per-tenant scoped — clearing it only resets this tenant's
    // existing default within the category.
    if (is_default) await pool.query(`UPDATE ai_providers SET is_default=FALSE WHERE category=$1 AND tenant_id=$2`, [category, tid]);
    const r = await pool.query(
      `INSERT INTO ai_providers (tenant_id, name, base_url, api_key, model, category, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, String(name).slice(0,80), base_url.trim(), api_key.trim(), String(model).slice(0,120), category, !!is_default, String(notes||'').slice(0,300)]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Update
router.post('/update/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const id = parseInt(req.params.id, 10); if (!id) return _err(res, 400, 'bad id');
  const { name, base_url, api_key, model, category, is_default, enabled, notes } = req.body || {};
  if (category && !VALID_CATEGORIES.includes(category)) return _err(res, 400, 'bad category');
  try {
    const tid = await _tid(req, 'ai-providers:update');
    const pool = _db.getPool();
    const cur = await pool.query(`SELECT category FROM ai_providers WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!cur.rows.length) return _err(res, 404, 'not found');
    const cat = category || cur.rows[0].category;
    if (is_default === true) await pool.query(`UPDATE ai_providers SET is_default=FALSE WHERE category=$1 AND id<>$2 AND tenant_id=$3`, [cat, id, tid]);
    const fields = []; const vals = []; let i = 1;
    const set = (col, v) => { if (v !== undefined) { fields.push(`${col}=$${i++}`); vals.push(v); } };
    set('name', name); set('base_url', base_url); set('model', model); set('category', category);
    if (api_key && api_key.trim()) set('api_key', api_key.trim());
    if (typeof is_default === 'boolean') set('is_default', is_default);
    if (typeof enabled === 'boolean') set('enabled', enabled);
    set('notes', notes);
    if (!fields.length) return res.json({ ok: true, id, note: 'no changes' });
    fields.push(`updated_at=NOW()`);
    vals.push(id); vals.push(tid);
    await pool.query(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id=$${i++} AND tenant_id=$${i}`, vals);
    res.json({ ok: true, id });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Delete
router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const id = parseInt(req.params.id, 10); if (!id) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'ai-providers:delete');
    const r = await _db.getPool().query(`DELETE FROM ai_providers WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rowCount) return _err(res, 404, 'not found');
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Test connection
router.post('/test/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const id = parseInt(req.params.id, 10); if (!id) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'ai-providers:test');
    const r = await _db.getPool().query(`SELECT base_url, api_key, model FROM ai_providers WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows.length) return _err(res, 404, 'not found');
    const p = r.rows[0];
    const url = p.base_url.replace(/\/+$/, '') + '/chat/completions';
    const started = Date.now();
    const body = _chatBody(p.base_url, p.model, [{ role: 'user', content: 'Say "ok" in one word.' }], {
      max_tokens: 32,
      // Kimi always thinks — keep connection tests cheap
      reasoning_effort: (isKimi(p.model) || isMoonshotBaseUrl(p.base_url)) ? 'low' : undefined,
      temperature: 0.7,
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.api_key },
      body: JSON.stringify(body),
    });
    const txt = await resp.text();
    let parsed = null; try { parsed = JSON.parse(txt); } catch {}
    const ms = Date.now() - started;
    if (!resp.ok) return res.json({ ok: false, status: resp.status, latency_ms: ms, error: (parsed && (parsed.error?.message || parsed.error)) || txt.slice(0, 300) });
    const sample = parsed?.choices?.[0]?.message?.content || '';
    res.json({ ok: true, status: resp.status, latency_ms: ms, sample, model: p.model });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Helper exported for other services to pick a user-configured override.
// Requires a tid; returns null if not provided (forcing callers to be
// tenant-aware). Returns { name, base_url, api_key, model } or null.
async function getDefaultProvider(category, tid) {
  if (!_db.hasDb()) return null;
  if (!VALID_CATEGORIES.includes(category)) return null;
  if (!Number.isFinite(+tid)) return null;
  try {
    const r = await _db.getPool().query(
      `SELECT name, base_url, api_key, model FROM ai_providers
        WHERE category=$1 AND tenant_id=$2 AND enabled=TRUE
        ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [category, +tid]
    );
    return r.rows[0] || null;
  } catch { return null; }
}

// Lightweight OpenAI-compatible chat call using a user-configured provider.
async function chatViaProvider(category, messages, opts = {}) {
  const p = await getDefaultProvider(category, opts.tenantId);
  if (!p) return null;
  try {
    const body = _chatBody(p.base_url, p.model, messages, {
      max_tokens: opts.max_tokens || 800,
      temperature: opts.temperature ?? 0.7,
      response_format: opts.response_format,
      reasoning_effort: opts.reasoning_effort,
    });
    const resp = await fetch(p.base_url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.api_key },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    const msg = j?.choices?.[0]?.message || {};
    return {
      provider: p.name,
      model: p.model,
      content: msg.content || '',
      reasoning_content: msg.reasoning_content || null,
    };
  } catch { return null; }
}

router.get('/active', async (req, res) => {
  const tid = await _tid(req, 'ai-providers:active');
  const out = {};
  for (const cat of VALID_CATEGORIES) {
    const p = await getDefaultProvider(cat, tid);
    out[cat] = p ? { name: p.name, model: p.model } : null;
  }
  res.json({ ok: true, active: out });
});

module.exports = router;
module.exports.getDefaultProvider = getDefaultProvider;
module.exports.chatViaProvider = chatViaProvider;

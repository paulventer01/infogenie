// AI Providers — let users plug any OpenAI-compatible LLM endpoint
// (Groq, DeepSeek, Mistral, OpenRouter, Together, Azure OpenAI, Ollama, etc.)
// into InfoGenie and route per-category traffic through it.
//
// Categories: writing · analysis · vision · audio
// Other services can call getDefaultProvider(category) to pick a user-defined
// override before falling back to the built-in OpenAI/Anthropic clients.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _redact(row) {
  if (!row) return row;
  const k = row.api_key || '';
  return { ...row, api_key: undefined, api_key_preview: k ? (k.slice(0, 4) + '…' + k.slice(-4)) : '', has_api_key: !!k };
}

const VALID_CATEGORIES = ['writing', 'analysis', 'vision', 'audio'];

// ── List all providers (redacted)
router.get('/list', async (_req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  try {
    const r = await _db.getPool().query(`SELECT id, name, base_url, model, category, is_default, enabled, notes, api_key, created_at, updated_at FROM ai_providers ORDER BY category, is_default DESC, name`);
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
    const pool = _db.getPool();
    if (is_default) await pool.query(`UPDATE ai_providers SET is_default=FALSE WHERE category=$1`, [category]);
    const r = await pool.query(
      `INSERT INTO ai_providers (name, base_url, api_key, model, category, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [String(name).slice(0,80), base_url.trim(), api_key.trim(), String(model).slice(0,120), category, !!is_default, String(notes||'').slice(0,300)]
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
    const pool = _db.getPool();
    const cur = await pool.query(`SELECT category FROM ai_providers WHERE id=$1`, [id]);
    if (!cur.rows.length) return _err(res, 404, 'not found');
    const cat = category || cur.rows[0].category;
    if (is_default === true) await pool.query(`UPDATE ai_providers SET is_default=FALSE WHERE category=$1 AND id<>$2`, [cat, id]);
    const fields = []; const vals = []; let i = 1;
    const set = (col, v) => { if (v !== undefined) { fields.push(`${col}=$${i++}`); vals.push(v); } };
    set('name', name); set('base_url', base_url); set('model', model); set('category', category);
    if (api_key && api_key.trim()) set('api_key', api_key.trim());
    if (typeof is_default === 'boolean') set('is_default', is_default);
    if (typeof enabled === 'boolean') set('enabled', enabled);
    set('notes', notes);
    if (!fields.length) return res.json({ ok: true, id, note: 'no changes' });
    fields.push(`updated_at=NOW()`);
    vals.push(id);
    await pool.query(`UPDATE ai_providers SET ${fields.join(', ')} WHERE id=$${i}`, vals);
    res.json({ ok: true, id });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Delete
router.delete('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const id = parseInt(req.params.id, 10); if (!id) return _err(res, 400, 'bad id');
  try { await _db.getPool().query(`DELETE FROM ai_providers WHERE id=$1`, [id]); res.json({ ok: true }); }
  catch (e) { _err(res, 500, e.message); }
});

// ── Test connection — sends a tiny chat completion to the provider's
// OpenAI-compatible /chat/completions endpoint and returns the result.
router.post('/test/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const id = parseInt(req.params.id, 10); if (!id) return _err(res, 400, 'bad id');
  try {
    const r = await _db.getPool().query(`SELECT base_url, api_key, model FROM ai_providers WHERE id=$1`, [id]);
    if (!r.rows.length) return _err(res, 404, 'not found');
    const p = r.rows[0];
    const url = p.base_url.replace(/\/+$/, '') + '/chat/completions';
    const started = Date.now();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.api_key },
      body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: 'Say "ok" in one word.' }], max_tokens: 10 })
    });
    const txt = await resp.text();
    let parsed = null; try { parsed = JSON.parse(txt); } catch {}
    const ms = Date.now() - started;
    if (!resp.ok) return res.json({ ok: false, status: resp.status, latency_ms: ms, error: (parsed && (parsed.error?.message || parsed.error)) || txt.slice(0, 300) });
    const sample = parsed?.choices?.[0]?.message?.content || '';
    res.json({ ok: true, status: resp.status, latency_ms: ms, sample });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Helper exported for other services to pick a user-configured override.
// Returns { name, base_url, api_key, model } or null.
async function getDefaultProvider(category) {
  if (!_db.hasDb()) return null;
  if (!VALID_CATEGORIES.includes(category)) return null;
  try {
    const r = await _db.getPool().query(
      `SELECT name, base_url, api_key, model FROM ai_providers WHERE category=$1 AND enabled=TRUE ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [category]
    );
    return r.rows[0] || null;
  } catch { return null; }
}

// Lightweight OpenAI-compatible chat call using a user-configured provider.
async function chatViaProvider(category, messages, opts = {}) {
  const p = await getDefaultProvider(category);
  if (!p) return null;
  try {
    const resp = await fetch(p.base_url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + p.api_key },
      body: JSON.stringify({ model: p.model, messages, max_tokens: opts.max_tokens || 800, temperature: opts.temperature ?? 0.7, ...(opts.response_format ? { response_format: opts.response_format } : {}) })
    });
    if (!resp.ok) return null;
    const j = await resp.json();
    return { provider: p.name, model: p.model, content: j?.choices?.[0]?.message?.content || '' };
  } catch { return null; }
}

router.get('/active', async (_req, res) => {
  const out = {};
  for (const cat of VALID_CATEGORIES) {
    const p = await getDefaultProvider(cat);
    out[cat] = p ? { name: p.name, model: p.model } : null;
  }
  res.json({ ok: true, active: out });
});

module.exports = router;
module.exports.getDefaultProvider = getDefaultProvider;
module.exports.chatViaProvider = chatViaProvider;

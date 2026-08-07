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
const { compatibleCategories, isCompatible } = require('./capabilities');
const { expandProviderAssignments, ensureTenantAssignments } = require('./schema');
const { PRESET_CATALOG, resolvePresetKey, matchConfigured } = require('./presets');

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

function _hasUsableKey(apiKey) {
  if (apiKey == null) return false;
  const k = String(apiKey).trim();
  if (!k) return false;
  if (/^PENDING_/i.test(k)) return false;
  if (/^_DUMMY/i.test(k)) return false;
  return true;
}

/**
 * Put every usable configured provider onto every compatible tile and enable
 * them as one cascade pool so the AI ecosystem works together (not one model).
 */
async function syncEcosystemCascade(pool, tid) {
  const providers = await pool.query(
    `SELECT id, name, base_url, model, category, notes, api_key, tenant_id, enabled
       FROM ai_providers WHERE tenant_id=$1`,
    [tid],
  );
  const usable = providers.rows.filter((p) => p.enabled !== false && _hasUsableKey(p.api_key));
  const byCategory = { writing: [], analysis: [], vision: [], audio: [] };

  for (const p of usable) {
    const cats = compatibleCategories(p);
    if (!cats.includes(p.category)) cats.push(p.category);
    for (const cat of cats) {
      if (!VALID_CATEGORIES.includes(cat)) continue;
      await pool.query(
        `INSERT INTO ai_provider_assignments (provider_id, tenant_id, category, enabled, is_default)
         VALUES ($1,$2,$3,TRUE,FALSE)
         ON CONFLICT (provider_id, category)
         DO UPDATE SET enabled=TRUE, updated_at=NOW()`,
        [p.id, tid, cat],
      );
      byCategory[cat].push(p);
    }
  }

  const summary = {};
  for (const cat of VALID_CATEGORIES) {
    const ids = byCategory[cat].map((p) => p.id);
    // Clear defaults, then enable the full pool and pick a primary
    await pool.query(
      `UPDATE ai_provider_assignments
          SET is_default=FALSE, updated_at=NOW()
        WHERE tenant_id=$1 AND category=$2`,
      [tid, cat],
    );
    if (!ids.length) {
      summary[cat] = { pool_size: 0, mode: 'builtin', ids: [] };
      continue;
    }
    await pool.query(
      `UPDATE ai_provider_assignments
          SET enabled=TRUE, updated_at=NOW()
        WHERE tenant_id=$1 AND category=$2 AND provider_id = ANY($3::int[])`,
      [tid, cat, ids],
    );
    // Prefer catalog order for primary (first matching PRESET_CATALOG), else lowest id
    let primaryId = ids[0];
    for (const preset of PRESET_CATALOG) {
      const hit = byCategory[cat].find(
        (p) =>
          String(p.model || '').toLowerCase() === String(preset.model).toLowerCase() &&
          String(p.base_url || '').replace(/\/+$/, '') === String(preset.base_url).replace(/\/+$/, ''),
      );
      if (hit) {
        primaryId = hit.id;
        break;
      }
    }
    await pool.query(
      `UPDATE ai_provider_assignments
          SET is_default=TRUE, enabled=TRUE, updated_at=NOW()
        WHERE tenant_id=$1 AND category=$2 AND provider_id=$3`,
      [tid, cat, primaryId],
    );
    summary[cat] = {
      pool_size: ids.length,
      mode: ids.length > 1 ? 'cascade' : 'single',
      ids,
      primary_id: primaryId,
      providers: byCategory[cat].map((p) => ({ id: p.id, name: p.name, model: p.model })),
    };
  }
  return summary;
}

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

async function _assignmentsForTenant(pool, tid) {
  const r = await pool.query(
    `SELECT provider_id, category, enabled, is_default
       FROM ai_provider_assignments WHERE tenant_id=$1`,
    [tid],
  );
  return r.rows;
}

function _attachMeta(row, assignRows) {
  const mine = assignRows.filter((a) => a.provider_id === row.id);
  const compatible = compatibleCategories(row);
  if (!compatible.includes(row.category)) compatible.push(row.category);
  return _redact({
    ...row,
    compatible_categories: compatible,
    categories: mine.map((a) => a.category),
    assignments: mine.map((a) => ({
      category: a.category,
      enabled: !!a.enabled,
      is_default: !!a.is_default,
    })),
  });
}

// ── List all providers (redacted) — tenant-scoped
router.get('/list', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  try {
    const tid = await _tid(req, 'ai-providers:list');
    const pool = _db.getPool();
    // Cheap insert-missing only (no-op when already expanded)
    try { await ensureTenantAssignments(pool, tid); } catch (_) { /* non-fatal */ }
    const r = await pool.query(
      `SELECT id, name, base_url, model, category, is_default, enabled, notes, api_key, created_at, updated_at
         FROM ai_providers WHERE tenant_id=$1 ORDER BY name`,
      [tid],
    );
    const assigns = await _assignmentsForTenant(pool, tid);
    const items = r.rows.map((row) => _attachMeta(row, assigns));
    const presets = PRESET_CATALOG.map((preset) => {
      const matched = matchConfigured(preset, items);
      return {
        id: preset.id,
        name: preset.name,
        base_url: preset.base_url,
        model: preset.model,
        tiles: preset.tiles,
        configured: !!matched,
        provider_id: matched ? matched.id : null,
        key_ready: !!resolvePresetKey(preset) || !!matched,
        requires_custom_url: !!preset.requiresCustomUrl,
        allow_empty_key: !!preset.allowEmptyKey,
      };
    });
    res.json({
      ok: true,
      items,
      presets,
      category_capabilities: {
        writing: 'Chat LLMs (copy, email, creative)',
        analysis: 'Chat LLMs (plans, scoring, Q&A)',
        vision: 'Multimodal + chat cascade',
        audio: 'Voiceover scripts + TTS endpoints',
      },
    });
  } catch (e) { _err(res, 500, e.message); }
});

/**
 * Create every catalog preset that has a resolvable API key (or empty-key OK),
 * expand onto all tiles, and enable them so Select-all cascade works.
 */
router.post('/activate-presets', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const onlyKeyReady = req.body?.onlyKeyReady !== false;
  try {
    const tid = await _tid(req, 'ai-providers:activate-presets');
    const pool = _db.getPool();
    const existing = await pool.query(
      `SELECT id, name, base_url, model, api_key, category, notes, tenant_id
         FROM ai_providers WHERE tenant_id=$1`,
      [tid],
    );
    const created = [];
    const skipped = [];
    const reused = [];

    for (const preset of PRESET_CATALOG) {
      if (preset.requiresCustomUrl && /YOUR-RESOURCE/i.test(preset.base_url)) {
        skipped.push({ id: preset.id, reason: 'needs_custom_azure_url' });
        continue;
      }
      const matched = matchConfigured(preset, existing.rows);
      if (matched) {
        await expandProviderAssignments(pool, {
          id: matched.id,
          tenant_id: tid,
          name: matched.name,
          base_url: matched.base_url,
          model: matched.model,
          category: matched.category || 'writing',
          notes: matched.notes,
        });
        await pool.query(
          `UPDATE ai_provider_assignments SET enabled=TRUE, updated_at=NOW()
           WHERE provider_id=$1 AND tenant_id=$2`,
          [matched.id, tid],
        );
        reused.push({ id: preset.id, provider_id: matched.id });
        continue;
      }

      const apiKey = resolvePresetKey(preset);
      if (!apiKey && onlyKeyReady) {
        skipped.push({ id: preset.id, reason: 'missing_api_key' });
        continue;
      }

      const ins = await pool.query(
        `INSERT INTO ai_providers (tenant_id, name, base_url, api_key, model, category, is_default, notes)
         VALUES ($1,$2,$3,$4,$5,'writing',FALSE,$6)
         RETURNING id, tenant_id, name, base_url, model, category, notes`,
        [
          tid,
          preset.name,
          preset.base_url,
          apiKey || 'PENDING_SET_API_KEY',
          preset.model,
          'Seeded from preset catalog · ' + preset.id,
        ],
      );
      const row = ins.rows[0];
      await expandProviderAssignments(pool, row);
      await pool.query(
        `UPDATE ai_provider_assignments SET enabled=TRUE, updated_at=NOW()
         WHERE provider_id=$1 AND tenant_id=$2`,
        [row.id, tid],
      );
      await pool.query(`UPDATE ai_providers SET enabled=TRUE WHERE id=$1`, [row.id]);
      created.push({ id: preset.id, provider_id: row.id });
      existing.rows.push({ ...row, api_key: apiKey || 'PENDING_SET_API_KEY' });
    }

    const ecosystem = await syncEcosystemCascade(pool, tid);

    res.json({
      ok: true,
      created: created.length,
      reused: reused.length,
      skipped,
      details: { created, reused },
      ecosystem,
    });
  } catch (e) { _err(res, 500, e.message); }
});

/**
 * Activate key-ready catalog presets AND put every usable provider into a
 * cascade pool on Writing · Analysis · Vision · Audio so they work together.
 */
router.post('/enable-ecosystem', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  try {
    // Reuse activate-presets logic by calling the same path internals
    const tid = await _tid(req, 'ai-providers:enable-ecosystem');
    const pool = _db.getPool();
    const onlyKeyReady = req.body?.onlyKeyReady !== false;

    const existing = await pool.query(
      `SELECT id, name, base_url, model, api_key, category, notes, tenant_id
         FROM ai_providers WHERE tenant_id=$1`,
      [tid],
    );
    const created = [];
    const skipped = [];
    const reused = [];

    for (const preset of PRESET_CATALOG) {
      if (preset.requiresCustomUrl && /YOUR-RESOURCE/i.test(preset.base_url)) {
        skipped.push({ id: preset.id, reason: 'needs_custom_azure_url' });
        continue;
      }
      const matched = matchConfigured(preset, existing.rows);
      if (matched) {
        await expandProviderAssignments(pool, {
          id: matched.id,
          tenant_id: tid,
          name: matched.name,
          base_url: matched.base_url,
          model: matched.model,
          category: matched.category || 'writing',
          notes: matched.notes,
        });
        reused.push({ id: preset.id, provider_id: matched.id });
        continue;
      }
      const apiKey = resolvePresetKey(preset);
      if (!apiKey && onlyKeyReady) {
        skipped.push({ id: preset.id, reason: 'missing_api_key' });
        continue;
      }
      const ins = await pool.query(
        `INSERT INTO ai_providers (tenant_id, name, base_url, api_key, model, category, is_default, notes)
         VALUES ($1,$2,$3,$4,$5,'writing',FALSE,$6)
         RETURNING id, tenant_id, name, base_url, model, category, notes, api_key`,
        [
          tid,
          preset.name,
          preset.base_url,
          apiKey || 'PENDING_SET_API_KEY',
          preset.model,
          'Seeded from preset catalog · ' + preset.id,
        ],
      );
      const row = ins.rows[0];
      await expandProviderAssignments(pool, row);
      await pool.query(`UPDATE ai_providers SET enabled=TRUE WHERE id=$1`, [row.id]);
      created.push({ id: preset.id, provider_id: row.id });
      existing.rows.push(row);
    }

    const ecosystem = await syncEcosystemCascade(pool, tid);
    res.json({
      ok: true,
      created: created.length,
      reused: reused.length,
      skipped,
      ecosystem,
      message: 'All usable AI providers are cascading together across Writing, Analysis, Vision, and Audio.',
    });
  } catch (e) { _err(res, 500, e.message); }
});

// ── Create — expands into all compatible category tiles
router.post('/create', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const { name, base_url, api_key, model, category, is_default = false, notes = '' } = req.body || {};
  if (!name || !base_url || !api_key || !model || !category) return _err(res, 400, 'name, base_url, api_key, model, category required');
  if (!VALID_CATEGORIES.includes(category)) return _err(res, 400, 'category must be one of ' + VALID_CATEGORIES.join(', '));
  if (!/^https?:\/\//i.test(base_url)) return _err(res, 400, 'base_url must be http(s)');
  try {
    const tid = await _tid(req, 'ai-providers:create');
    const pool = _db.getPool();
    if (is_default) {
      await pool.query(
        `UPDATE ai_providers SET is_default=FALSE WHERE category=$1 AND tenant_id=$2`,
        [category, tid],
      );
      await pool.query(
        `UPDATE ai_provider_assignments SET is_default=FALSE WHERE tenant_id=$1 AND category=$2`,
        [tid, category],
      );
    }
    const r = await pool.query(
      `INSERT INTO ai_providers (tenant_id, name, base_url, api_key, model, category, is_default, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, tenant_id, name, base_url, model, category, notes`,
      [tid, String(name).slice(0,80), base_url.trim(), api_key.trim(), String(model).slice(0,120), category, !!is_default, String(notes||'').slice(0,300)],
    );
    const row = r.rows[0];
    const cats = await expandProviderAssignments(pool, row);
    if (is_default) {
      await pool.query(
        `UPDATE ai_provider_assignments SET is_default=TRUE, enabled=TRUE
         WHERE provider_id=$1 AND category=$2`,
        [row.id, category],
      );
    }
    // Keep the whole ecosystem cascading together whenever a provider is added
    try { await syncEcosystemCascade(pool, tid); } catch (_) { /* non-fatal */ }
    res.json({ ok: true, id: row.id, categories: cats });
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
  const list = await getEnabledProviders(category, tid);
  return list[0] || null;
}

/** Enabled providers for a category via assignments — default first. */
async function getEnabledProviders(category, tid) {
  if (!_db.hasDb()) return [];
  if (!VALID_CATEGORIES.includes(category)) return [];
  if (!Number.isFinite(+tid)) return [];
  try {
    const r = await _db.getPool().query(
      `SELECT p.id, p.name, p.base_url, p.api_key, p.model,
              a.is_default, a.enabled
         FROM ai_provider_assignments a
         JOIN ai_providers p ON p.id = a.provider_id
        WHERE a.tenant_id=$1 AND a.category=$2 AND a.enabled=TRUE
        ORDER BY a.is_default DESC, a.updated_at DESC`,
      [+tid, category],
    );
    // Fallback for tenants not yet backfilled: old single-category rows
    if (!r.rows.length) {
      const legacy = await _db.getPool().query(
        `SELECT id, name, base_url, api_key, model, is_default, enabled
           FROM ai_providers
          WHERE category=$1 AND tenant_id=$2 AND enabled=TRUE
          ORDER BY is_default DESC, updated_at DESC`,
        [category, +tid],
      );
      return legacy.rows;
    }
    return r.rows;
  } catch { return []; }
}

async function _callOneProvider(p, messages, opts = {}) {
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
}

// Cascade through all enabled providers in the category (default first).
async function chatViaProvider(category, messages, opts = {}) {
  const list = (await getEnabledProviders(category, opts.tenantId))
    .filter((p) => _hasUsableKey(p.api_key));
  if (!list.length) return null;
  for (const p of list) {
    try {
      const out = await _callOneProvider(p, messages, opts);
      if (out && out.content) return { ...out, cascade_tried: list.length };
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Set which providers are active for a category (assignment-based).
 * body: { ids: number[], primaryId?: number|null }
 */
router.post('/category/:category/selection', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  const category = String(req.params.category || '');
  if (!VALID_CATEGORIES.includes(category)) return _err(res, 400, 'bad_category');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  let primaryId = req.body?.primaryId != null ? Number(req.body.primaryId) : null;
  if (primaryId != null && !Number.isInteger(primaryId)) primaryId = null;
  if (primaryId != null && ids.length && !ids.includes(primaryId)) {
    return _err(res, 400, 'primary_not_in_selection');
  }
  if (!primaryId && ids.length) primaryId = ids[0];

  try {
    const tid = await _tid(req, 'ai-providers:selection');
    const pool = _db.getPool();

    const owned = await pool.query(
      `SELECT id, name, base_url, model, category, notes, tenant_id
         FROM ai_providers WHERE tenant_id=$1`,
      [tid],
    );
    const byId = new Map(owned.rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) return _err(res, 400, 'provider_not_found');
      if (!isCompatible(p, category) && p.category !== category) {
        return _err(res, 400, 'provider_incompatible_with_category');
      }
      // Ensure assignment row exists for this category
      await pool.query(
        `INSERT INTO ai_provider_assignments (provider_id, tenant_id, category, enabled, is_default)
         VALUES ($1,$2,$3,FALSE,FALSE)
         ON CONFLICT (provider_id, category) DO NOTHING`,
        [id, tid, category],
      );
    }

    await pool.query(
      `UPDATE ai_provider_assignments
          SET enabled=FALSE, is_default=FALSE, updated_at=NOW()
        WHERE tenant_id=$1 AND category=$2`,
      [tid, category],
    );

    if (ids.length) {
      await pool.query(
        `UPDATE ai_provider_assignments
            SET enabled=TRUE, updated_at=NOW()
          WHERE tenant_id=$1 AND category=$2 AND provider_id = ANY($3::int[])`,
        [tid, category, ids],
      );
      if (primaryId) {
        await pool.query(
          `UPDATE ai_provider_assignments
              SET is_default=TRUE, enabled=TRUE, updated_at=NOW()
            WHERE tenant_id=$1 AND category=$2 AND provider_id=$3`,
          [tid, category, primaryId],
        );
      }
    }

    const enabled = await getEnabledProviders(category, tid);
    res.json({
      ok: true,
      category,
      mode: enabled.length > 1 ? 'cascade' : (enabled.length === 1 ? 'single' : 'builtin'),
      enabled: enabled.map((p) => ({ id: p.id, name: p.name, model: p.model, is_default: p.is_default })),
    });
  } catch (e) { _err(res, 500, e.message); }
});

/** Expand every provider into all compatible tiles (enabled). Fast no-op when complete. */
router.post('/expand-compatible', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 500, 'database not configured');
  try {
    const tid = await _tid(req, 'ai-providers:expand');
    const pool = _db.getPool();
    const result = await ensureTenantAssignments(pool, tid);
    res.json({ ok: true, expanded: result.providers, inserted: result.inserted });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/active', async (req, res) => {
  const tid = await _tid(req, 'ai-providers:active');
  const out = {};
  for (const cat of VALID_CATEGORIES) {
    const list = await getEnabledProviders(cat, tid);
    const primary = list[0] || null;
    out[cat] = primary
      ? {
          name: primary.name,
          model: primary.model,
          id: primary.id,
          pool_size: list.length,
          mode: list.length > 1 ? 'cascade' : 'single',
          pool: list.map((p) => ({ id: p.id, name: p.name, model: p.model, is_default: !!p.is_default })),
        }
      : null;
  }
  res.json({ ok: true, active: out });
});

module.exports = router;
module.exports.getDefaultProvider = getDefaultProvider;
module.exports.getEnabledProviders = getEnabledProviders;
module.exports.chatViaProvider = chatViaProvider;
module.exports.syncEcosystemCascade = syncEcosystemCascade;

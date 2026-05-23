// Napkin.ai-style — text in, structured infographic JSON out. Client renders
// to SVG so the user gets a downloadable, on-brand visual without us paying
// per-image costs.

const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

let getBrandContextBlock = async () => '';
try { ({ getBrandContextBlock } = require('../brand_foundation/api')); } catch {}

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[infographics]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}
// Kv keys are tenant-namespaced as `infographic:t<tid>:<id>`. Legacy keys
// (no t-prefix) get rewritten once at boot so the pre-multitenancy infographics
// surface to platform tenant 1 (the original owner) and stay scoped correctly.
const _kvKey = (tid, id) => `infographic:t${tid}:${id}`;
const _legacyPrefix = 'infographic:';
const _tenantPrefix = tid => `infographic:t${tid}:`;

async function _migrateLegacyKeys() {
  if (!_db.hasDb()) return;
  try {
    // Match anything starting with 'infographic:' that's NOT already tenant-prefixed.
    const r = await _db.getPool().query(
      `SELECT key FROM kv_store WHERE key LIKE 'infographic:%' AND key NOT LIKE 'infographic:t%:%'`
    );
    for (const row of r.rows) {
      const oldKey = row.key;
      const newKey = `infographic:t1:${oldKey.slice(_legacyPrefix.length)}`;
      await _db.getPool().query(
        `UPDATE kv_store SET key=$1 WHERE key=$2 AND NOT EXISTS (SELECT 1 FROM kv_store WHERE key=$1)`,
        [newKey, oldKey]
      );
      await _db.getPool().query(`DELETE FROM kv_store WHERE key=$1`, [oldKey]);
    }
    if (r.rows.length) console.log(`[infographics] migrated ${r.rows.length} legacy keys to tenant 1`);
  } catch (e) { console.warn('[infographics] legacy migrate:', e.message); }
}
_migrateLegacyKeys();

const LAYOUTS = ['funnel', 'list', 'comparison', 'journey', 'quadrant', 'pyramid', 'cycle'];

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return k && !/^_DUMMY/i.test(k);
}

async function _openaiJSON(messages, maxTokens = 1200) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.6, max_tokens: maxTokens, response_format: { type: 'json_object' } });
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(45000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _fallback(topic, layout) {
  const items = ['Awareness', 'Consideration', 'Purchase', 'Retention', 'Advocacy'];
  return {
    title: topic.slice(0, 80),
    layout,
    palette: { primary: '#0066FF', accent: '#7C3AED', text: '#0A1628' },
    items: items.slice(0, layout === 'quadrant' ? 4 : 5).map((label, i) => ({
      label, value: `Step ${i + 1}`, detail: 'Outline the key action for this stage.',
    })),
    takeaway: 'Map every stage to a single owner and a single metric.',
  };
}

router.post('/generate', _safe(async (req, res) => {
  const topic = String(req.body?.topic || '').trim().slice(0, 400);
  const layout = LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'funnel';
  const itemCount = Math.max(3, Math.min(7, parseInt(req.body?.itemCount, 10) || 5));
  if (!topic) return _err(res, 400, 'topic required');

  let result;
  if (_hasOpenAI()) {
    const brand = await getBrandContextBlock().catch(() => '');
    const prompt = `Design an infographic on: "${topic}".
Layout: ${layout} with ${itemCount} items.
Return STRICT JSON: { "title":"...", "subtitle":"...", "layout":"${layout}",
  "palette": { "primary":"#hex", "accent":"#hex", "text":"#hex" },
  "items": [{"label":"...","value":"...","detail":"1 short sentence"}, ...],
  "takeaway":"1 actionable insight" }
Make labels under 24 chars. Make values under 18 chars. Make details under 80 chars.`;
    result = await _openaiJSON([
      { role: 'system', content: 'You are an infographic designer for marketers. Return strict JSON only.\n' + (brand || '') },
      { role: 'user', content: prompt },
    ]);
  }
  if (!result || !Array.isArray(result.items)) result = _fallback(topic, layout);

  const tid = await _tid(req, 'infographics:generate');
  const id = 'ig_' + (require('crypto').randomUUID ? require('crypto').randomUUID().replace(/-/g,'').slice(0,16) : Date.now() + '_' + Math.random().toString(36).slice(2,8));
  if (_db.hasDb()) {
    try { await _db.kvSet(_kvKey(tid, id), { ...result, topic, createdAt: new Date().toISOString() }); } catch {}
  }
  res.json({ ok: true, id, infographic: result });
}));

router.get('/list', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'infographics:list');
  const prefix = _tenantPrefix(tid);
  const r = await _db.getPool().query(
    `SELECT key, value FROM kv_store WHERE key LIKE $1 ORDER BY key DESC LIMIT 50`,
    [prefix + '%']
  );
  res.json({ ok: true, items: r.rows.map(row => ({ id: row.key.slice(prefix.length), ...row.value })) });
}));

router.delete('/:id', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'db unavailable');
  const tid = await _tid(req, 'infographics:delete');
  const r = await _db.getPool().query(
    `DELETE FROM kv_store WHERE key = $1`,
    [_kvKey(tid, req.params.id)]
  );
  if (!r.rowCount) return _err(res, 404, 'infographic not found');
  res.json({ ok: true });
}));

router.get('/layouts', (_req, res) => res.json({ ok: true, layouts: LAYOUTS }));

module.exports = router;

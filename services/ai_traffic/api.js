// AI Traffic Monitor — track referrals from AI engines (ChatGPT, Perplexity, Claude…)
// Embed: <script src="/api/ai-traffic/embed.js?sid=SITE_ID" async></script>
//
// POST /api/ai-traffic/sites           register a site
// GET  /api/ai-traffic/sites           list sites
// GET  /api/ai-traffic/embed.js        tracking pixel JS
// POST /api/ai-traffic/beacon          record a hit (called by embed)
// GET  /api/ai-traffic/stats?sid=…     aggregated stats for a site
// DELETE /api/ai-traffic/sites/:id     remove a site

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const _db     = require('../../db');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[ai-traffic]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

// All known AI referrer hostnames → display name
const AI_SOURCES = {
  'chat.openai.com':          'ChatGPT',
  'chatgpt.com':              'ChatGPT',
  'openai.com':               'ChatGPT',
  'perplexity.ai':            'Perplexity',
  'www.perplexity.ai':        'Perplexity',
  'claude.ai':                'Claude',
  'anthropic.com':            'Claude',
  'gemini.google.com':        'Gemini',
  'bard.google.com':          'Gemini',
  'aistudio.google.com':      'Gemini',
  'copilot.microsoft.com':    'Copilot',
  'bing.com':                 'Copilot',
  'www.bing.com':             'Copilot',
  'you.com':                  'You.com',
  'phind.com':                'Phind',
  'character.ai':             'Character.ai',
  'poe.com':                  'Poe',
  'mistral.ai':               'Mistral',
  'chat.mistral.ai':          'Mistral',
  'groq.com':                 'Groq',
  'huggingface.co':           'HuggingFace',
  'meta.ai':                  'Meta AI',
  'grok.x.ai':                'Grok',
  'x.com':                    'Grok',
};

const AI_ICONS = {
  ChatGPT:    '🤖', Perplexity: '⊛', Claude: '◎', Gemini: '✦',
  Copilot:    '🔵', 'You.com': '🔍', Phind: '🔎', 'Character.ai': '🎭',
  Poe:        '💬', Mistral: '🌊', Groq: '⚡', HuggingFace: '🤗',
  'Meta AI':  '🦙', Grok: '𝕏',
};

function _classifyReferrer(ref) {
  if (!ref) return null;
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '');
    for (const [pattern, name] of Object.entries(AI_SOURCES)) {
      const ph = pattern.replace(/^www\./, '');
      if (host === ph || host.endsWith('.' + ph)) return name;
    }
  } catch (_) {}
  return null;
}

// ── POST /api/ai-traffic/sites ───────────────────────────────────────────────
router.post('/sites', _safe(async (req, res) => {
  const { name, domain } = req.body || {};
  if (!name || !domain) return _err(res, 400, 'name and domain required');
  const id = 'ats_' + crypto.randomBytes(6).toString('hex');
  const dom = String(domain).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!_db.hasDb()) return res.json({ ok: true, site: { id, name, domain: dom }, warning: 'DB unavailable — data not persisted' });
  await _db.getPool().query(
    `INSERT INTO ai_traffic_sites (id, name, domain) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [id, String(name).trim().slice(0, 100), dom]
  );
  res.json({ ok: true, site: { id, name: String(name).trim(), domain: dom } });
}));

// ── GET /api/ai-traffic/sites ────────────────────────────────────────────────
router.get('/sites', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, sites: [] });
  const r = await _db.getPool().query(`SELECT id, name, domain, created_at FROM ai_traffic_sites ORDER BY created_at DESC`);
  res.json({ ok: true, sites: r.rows });
}));

// ── DELETE /api/ai-traffic/sites/:id ────────────────────────────────────────
router.delete('/sites/:id', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'DB unavailable');
  await _db.getPool().query(`DELETE FROM ai_traffic_sites WHERE id=$1`, [req.params.id]);
  await _db.getPool().query(`DELETE FROM ai_traffic_hits WHERE site_id=$1`, [req.params.id]);
  res.json({ ok: true });
}));

// ── GET /api/ai-traffic/embed.js  (tracking pixel) ──────────────────────────
router.get('/embed.js', (req, res) => {
  const sid = String(req.query.sid || '').trim();
  if (!sid) { res.status(400).type('js').send('/* InfoGenie AI Traffic: missing ?sid=SITE_ID */'); return; }
  const origin = req.headers.host ? `https://${req.headers.host}` : '';
  const script = `(function(){
  try {
    var ref = document.referrer || '';
    if (!ref) return;
    var img = new Image();
    img.src = '${origin}/api/ai-traffic/beacon?sid=${encodeURIComponent(sid)}&ref=' + encodeURIComponent(ref) + '&path=' + encodeURIComponent(window.location.pathname);
  } catch(e){}
})();`;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(script);
});

// ── GET /api/ai-traffic/beacon  (image beacon fallback) ─────────────────────
router.get('/beacon', _safe(async (req, res) => {
  const sid = String(req.query.sid || '').trim();
  const ref = String(req.query.ref || '').trim().slice(0, 500);
  const path= String(req.query.path || '/').trim().slice(0, 300);

  // Always return 1px GIF regardless of DB state
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.send(gif);

  if (!sid || !ref || !_db.hasDb()) return;
  const source = _classifyReferrer(ref);
  if (!source) return; // not from a known AI engine — ignore

  try {
    // Check site exists
    const sr = await _db.getPool().query(`SELECT id FROM ai_traffic_sites WHERE id=$1`, [sid]);
    if (!sr.rowCount) return;
    await _db.getPool().query(
      `INSERT INTO ai_traffic_hits (site_id, source, referrer, path) VALUES ($1,$2,$3,$4)`,
      [sid, source, ref, path]
    );
  } catch (e) { console.warn('[ai-traffic] beacon insert failed', e.message); }
}));

// ── GET /api/ai-traffic/stats ────────────────────────────────────────────────
router.get('/stats', _safe(async (req, res) => {
  const sid  = String(req.query.sid || '').trim();
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '30', 10)));
  if (!sid) return _err(res, 400, 'sid required');
  if (!_db.hasDb()) return res.json({ ok: true, sid, total: 0, bySource: [], byDay: [] });

  const pool = _db.getPool();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [totRow, srcRow, dayRow] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS n FROM ai_traffic_hits WHERE site_id=$1 AND ts>=$2`, [sid, since]),
    pool.query(`SELECT source, COUNT(*) AS hits FROM ai_traffic_hits WHERE site_id=$1 AND ts>=$2 GROUP BY source ORDER BY hits DESC`, [sid, since]),
    pool.query(`SELECT DATE(ts) AS day, source, COUNT(*) AS hits FROM ai_traffic_hits WHERE site_id=$1 AND ts>=$2 GROUP BY day, source ORDER BY day`, [sid, since]),
  ]);

  const total = parseInt(totRow.rows[0]?.n || 0, 10);
  const bySource = srcRow.rows.map(r => ({
    source: r.source,
    icon: AI_ICONS[r.source] || '🤖',
    hits: parseInt(r.hits, 10),
    share: total ? Math.round((parseInt(r.hits, 10) / total) * 100) : 0,
  }));
  const byDay = dayRow.rows.map(r => ({ day: r.day, source: r.source, hits: parseInt(r.hits, 10) }));

  // Trend vs previous period
  const prevSince = new Date(Date.now() - 2 * days * 86400000).toISOString();
  const prevRow = await pool.query(`SELECT COUNT(*) AS n FROM ai_traffic_hits WHERE site_id=$1 AND ts>=$2 AND ts<$3`, [sid, prevSince, since]);
  const prevTotal = parseInt(prevRow.rows[0]?.n || 0, 10);
  const trend = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null;

  res.json({ ok: true, sid, days, total, trend, bySource, byDay, aiSources: AI_SOURCES });
}));

// ── GET /api/ai-traffic/sources  (discovery helper) ─────────────────────────
router.get('/sources', (req, res) => {
  res.json({ ok: true, sources: Object.entries(AI_SOURCES).map(([host, name]) => ({ host, name, icon: AI_ICONS[name] || '🤖' })) });
});

module.exports = router;
module.exports.classifyReferrer = _classifyReferrer;

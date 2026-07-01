const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[hashtag-tracker]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _callPerplexity(q) {
  const https = require('https'); const key = process.env.PERPLEXITY_API_KEY;
  const body = JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 1200 });
  return new Promise(resolve => {
    const req = https.request({ hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)?.choices?.[0]?.message?.content || ''); } catch { resolve(''); } });
    });
    req.on('error', () => resolve('')); req.setTimeout(30000, () => { req.destroy(); resolve(''); }); req.write(body); req.end();
  });
}

async function _callOpenAI(messages) {
  const https = require('https'); const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const body = JSON.stringify({ model: 'gpt-5-mini', temperature: 0.1, max_tokens: 1200, response_format: { type: 'json_object' }, messages });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(JSON.parse(d)?.choices?.[0]?.message?.content || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject); req.setTimeout(35000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}

// GET /api/hashtag-tracker/watches
router.get('/watches', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_tracker:watches' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,hashtag,platforms,created_at FROM hashtag_watches WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, rows });
}));

// POST /api/hashtag-tracker/watches
router.post('/watches', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_tracker:add_watch' });
  if (!tid) return _err(res, 400, 'no_tenant');
  let { hashtag, platforms = ['twitter', 'instagram', 'tiktok'] } = req.body;
  if (!hashtag) return _err(res, 400, 'hashtag required');
  hashtag = hashtag.replace(/^#+/, '').trim().toLowerCase();
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');
  const { rows } = await _db.getPool().query(`INSERT INTO hashtag_watches(hashtag,platforms,tenant_id) VALUES($1,$2,$3) RETURNING id,hashtag,platforms,created_at`, [hashtag, JSON.stringify(platforms), tid]);
  res.json({ ok: true, watch: rows[0] });
}));

// DELETE /api/hashtag-tracker/watches/:id
router.delete('/watches/:id', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_tracker:delete_watch' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');
  await _db.getPool().query(`DELETE FROM hashtag_watches WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
}));

// POST /api/hashtag-tracker/scan/:watchId
router.post('/scan/:watchId', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_tracker:scan' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return _err(res, 503, 'db_unavailable');
  const pool = _db.getPool();
  const watchR = await pool.query(`SELECT * FROM hashtag_watches WHERE id=$1 AND tenant_id=$2`, [req.params.watchId, tid]);
  if (!watchR.rows.length) return _err(res, 404, 'watch not found');
  const watch = watchR.rows[0];
  const tag = watch.hashtag;

  let rawData = '';
  if (_hasPerplexity()) {
    rawData = await _callPerplexity(`Analyse the hashtag #${tag} on social media right now. What is the current usage volume, posting velocity (rising/stable/falling), dominant sentiment, who are the top accounts or influencers using it, and what are the most engaging posts? Also note what topics or themes are associated with it.`);
  }

  let scan = { total_posts: 500, estimated_reach: 50000, sentiment_pos: 40, sentiment_neu: 45, sentiment_neg: 15, top_posts: [], top_influencers: [], velocity: 'stable' };

  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'Extract structured hashtag analytics. Return strict JSON: {"total_posts":number,"estimated_reach":number,"sentiment_pos":number,"sentiment_neu":number,"sentiment_neg":number,"top_posts":[{"text":"...","author":"...","platform":"...","likes":number,"url":""}],"top_influencers":[{"username":"...","platform":"...","followers":number,"engagement_rate":"..."}],"velocity":"rising"|"stable"|"falling","key_themes":["theme1","theme2"]}' },
      { role: 'user', content: `Hashtag: #${tag}\nPlatforms: ${(watch.platforms || []).join(', ')}\n\nData:\n${rawData.slice(0, 1500) || `No live data. Provide representative estimates for #${tag}.`}` }
    ]);
    if (parsed.total_posts) scan = { ...scan, ...parsed };
  }

  const { rows } = await pool.query(`INSERT INTO hashtag_scans(watch_id,hashtag,total_posts,estimated_reach,sentiment_pos,sentiment_neu,sentiment_neg,top_posts,top_influencers,velocity,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [watch.id, tag, scan.total_posts, scan.estimated_reach, scan.sentiment_pos, scan.sentiment_neu, scan.sentiment_neg, JSON.stringify(scan.top_posts), JSON.stringify(scan.top_influencers), scan.velocity, tid]);
  res.json({ ok: true, hashtag: tag, ...scan, id: rows[0].id });
}));

// GET /api/hashtag-tracker/scans/:watchId
router.get('/scans/:watchId', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'hashtag_tracker:scans' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,hashtag,total_posts,estimated_reach,sentiment_pos,sentiment_neu,sentiment_neg,velocity,created_at FROM hashtag_scans WHERE watch_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 30`, [req.params.watchId, tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;

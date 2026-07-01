const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, c, m) { res.status(c).json({ ok: false, error: m }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[presence-score]', e.message); if (!res.headersSent) _err(res, 500, 'Internal error'); }); }
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

router.post('/calculate', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'presence_score:calculate' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { brand, competitors = [] } = req.body;
  if (!brand) return _err(res, 400, 'brand required');

  let context = '';
  if (_hasPerplexity()) {
    context = await _callPerplexity(`Evaluate the online presence of "${brand}". How prominent are they in: 1) Google search results for their category, 2) social media following and engagement (Twitter/X, LinkedIn, Instagram, TikTok), 3) news and press mentions, 4) online communities (Reddit, forums, review sites), 5) influencer mentions. ${competitors.length ? `Compare against: ${competitors.slice(0, 3).join(', ')}.` : ''} Give specific numbers where available.`);
  }

  let scores = { overall_score: 50, search_presence: 50, social_presence: 50, news_presence: 50, community_presence: 50, influencer_presence: 50, vs_competitors: [], insights: [] };

  if (_hasOpenAI()) {
    const parsed = await _callOpenAI([
      { role: 'system', content: 'Score online presence dimensions 0-100 each. Return strict JSON: {"search_presence":number,"social_presence":number,"news_presence":number,"community_presence":number,"influencer_presence":number,"vs_competitors":[{"brand":"...","overall_score":number}],"insights":["insight1","insight2","insight3"],"strongest_channel":"...","weakest_channel":"..."}' },
      { role: 'user', content: `Brand: ${brand}\nCompetitors: ${competitors.join(', ') || 'none'}\n\nContext:\n${context.slice(0, 1500) || `Estimate presence scores for ${brand} based on typical market signals.`}` }
    ]);
    if (parsed.search_presence !== undefined) {
      scores = { ...scores, ...parsed };
      scores.overall_score = Math.round((scores.search_presence + scores.social_presence + scores.news_presence + scores.community_presence + scores.influencer_presence) / 5);
    }
  }

  const pool = _db.hasDb() ? _db.getPool() : null;
  if (pool) {
    await pool.query(`INSERT INTO presence_scores(brand,overall_score,search_presence,social_presence,news_presence,community_presence,influencer_presence,vs_competitors,insights,tenant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [brand, scores.overall_score, scores.search_presence, scores.social_presence, scores.news_presence, scores.community_presence, scores.influencer_presence, JSON.stringify(scores.vs_competitors), JSON.stringify(scores.insights), tid]);
  }
  res.json({ ok: true, brand, ...scores });
}));

router.get('/history', _safe(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'presence_score:history' });
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb()) return res.json({ ok: true, rows: [] });
  const { rows } = await _db.getPool().query(`SELECT id,brand,overall_score,search_presence,social_presence,news_presence,community_presence,influencer_presence,insights,created_at FROM presence_scores WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`, [tid]);
  res.json({ ok: true, rows });
}));

module.exports = router;

const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label, allowFallback: true });
}

async function _pplxPodcasts({ brand, days, count }) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a podcast research analyst. Find recent podcast episodes (audio shows on Apple/Spotify/Google/YouTube) that mention the given brand or company.
Return strict JSON ONLY in this exact shape:
{"episodes":[{"podcast":"<show name>","episode_title":"<episode title>","host":"<host name(s)>","platform":"apple|spotify|youtube|other","published":"YYYY-MM-DD","sentiment":"positive|neutral|negative","summary":"<1-2 sentence what was said about the brand>","url":"<direct episode URL>"}]}
Rules:
- Real, currently-listed podcast episodes only — no fabrication.
- Last ${days} days only.
- Up to ${count} episodes, ranked by reach + recency.
- If you cannot verify an episode, omit it. Empty array is acceptable.
- Sentiment is about how the brand was discussed.`;
  const user = `Brand: ${brand}\nLookback: last ${days} days\nReturn up to ${count} episodes.`;
  const body = JSON.stringify({
    model:'sonar',
    messages: [{ role:'system', content: sys }, { role:'user', content: user }],
    temperature: 0.2, max_tokens: 2200,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        let txt = j?.choices?.[0]?.message?.content || '';
        const m = txt.match(/\{[\s\S]*\}/); if (!m) return resolve(null);
        resolve(JSON.parse(m[0]));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

router.post('/scan', async (req, res) => {
  const brand = String(req.body?.brand || '').trim().slice(0, 80);
  const days = Math.min(180, Math.max(1, parseInt(req.body?.days, 10) || 30));
  const count = Math.min(20, Math.max(1, parseInt(req.body?.count, 10) || 10));
  if (!brand) return _err(res, 400, 'brand required');
  let result = await _pplxPodcasts({ brand, days, count });
  let source = 'perplexity';
  if (!result || !Array.isArray(result.episodes)) {
    result = { episodes: [] }; source = 'placeholder';
  }
  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'podcast:scan');
      await _db.getPool().query(
        `INSERT INTO podcast_monitor_runs (tenant_id, brand, lookback_days, episodes, source) VALUES ($1,$2,$3,$4,$5)`,
        [tid, brand, days, JSON.stringify(result.episodes), source]);
    } catch (e) { console.warn('[podcast-monitor] persist failed:', e.message); }
  }
  res.json({ ok:true, source, brand, days, count: result.episodes.length, episodes: result.episodes });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  try {
    const tid = await _tid(req, 'podcast:history');
    const r = await _db.getPool().query(
      `SELECT id, brand, lookback_days, source, ran_at, jsonb_array_length(episodes) AS episode_count
       FROM podcast_monitor_runs WHERE tenant_id=$1 ORDER BY ran_at DESC LIMIT $2`, [tid, limit]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'podcast:get');
    const r = await _db.getPool().query(
      `SELECT * FROM podcast_monitor_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

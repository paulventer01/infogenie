const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _normDomain(d) { return String(d||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,''); }

const COUNTRY_TO_LOC = { us:2840, gb:2826, ca:2124, au:2036, in:2356, de:2276, fr:2250, jp:2392, br:2076, mx:2484, za:2710, nl:2528, es:2724, it:2380, sg:2702 };

async function _serpSearch(q, country) {
  const login = process.env.DATAFORSEO_LOGIN, pw = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw || /^_DUMMY/i.test(login) || /^_DUMMY/i.test(pw)) return null;
  const auth = 'Basic ' + Buffer.from(login + ':' + pw).toString('base64');
  const body = JSON.stringify([{ language_code:'en', location_code: COUNTRY_TO_LOC[country] || 2840, keyword: q, depth: 10 }]);
  return await new Promise((resolve) => {
    const req = _https.request({ hostname:'api.dataforseo.com', path:'/v3/serp/google/organic/live/regular', method:'POST',
      headers:{ 'Authorization':auth, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data', c => d += c); r.on('end', () => {
        try { if (r.statusCode !== 200) { console.warn('[serp-tracker]', r.statusCode, d.slice(0,200)); return resolve(null); } resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _findTarget(items, target) {
  const tn = _normDomain(target);
  for (const it of items) {
    const itd = _normDomain(it.displayLink || '');
    if (itd === tn || itd.endsWith('.'+tn) || tn.endsWith('.'+itd)) return { position: it.position, url: it.link };
  }
  return { position: null, url: null };
}

router.get('/keywords', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const r = await _db.getPool().query(`
      SELECT k.*, lr.target_position AS last_position, lr.ran_at AS last_run_at
      FROM serp_tracker_keywords k
      LEFT JOIN LATERAL (SELECT target_position, ran_at FROM serp_tracker_runs WHERE keyword_id=k.id ORDER BY ran_at DESC LIMIT 1) lr ON true
      ORDER BY k.created_at DESC`);
    res.json({ ok:true, keywords: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.post('/keywords', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const keyword = String(req.body?.keyword||'').trim().slice(0, 200);
  const target_domain = _normDomain(req.body?.target_domain||'');
  const country = String(req.body?.country||'us').toLowerCase().slice(0, 5);
  if (!keyword || !target_domain) return _err(res, 400, 'keyword + target_domain required');
  try {
    const r = await _db.getPool().query(
      `INSERT INTO serp_tracker_keywords (keyword, target_domain, country) VALUES ($1,$2,$3)
       ON CONFLICT (keyword, target_domain, country) DO UPDATE SET enabled=true RETURNING *`,
      [keyword, target_domain, country]);
    res.json({ ok:true, keyword: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

router.delete('/keywords/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try { await _db.getPool().query(`DELETE FROM serp_tracker_keywords WHERE id=$1`, [Number(req.params.id)]); res.json({ ok:true }); }
  catch (e) { _err(res, 500, e.message); }
});

async function _scanOne(id) {
  const k = (await _db.getPool().query(`SELECT * FROM serp_tracker_keywords WHERE id=$1`, [id])).rows[0];
  if (!k) return { ok:false, error:'keyword not found' };
  const raw = await _serpSearch(k.keyword, k.country);
  if (!raw) return { ok:true, source:'placeholder', note:'DATAFORSEO credentials missing or call failed — set DATAFORSEO_LOGIN/PASSWORD for live SERP tracking.' };
  const result = raw.tasks?.[0]?.result?.[0];
  const items = ((result?.items)||[])
    .filter(it => it.type === 'organic' && it.rank_absolute)
    .slice(0, 10)
    .map(it => ({ position: it.rank_absolute, title: it.title, link: it.url, displayLink: it.domain, snippet: it.description }));
  const target = _findTarget(items, k.target_domain);
  const totalResults = result?.se_results_count ? String(result.se_results_count) : '';
  const ins = await _db.getPool().query(
    `INSERT INTO serp_tracker_runs (keyword_id, target_position, target_url, total_results, results) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [id, target.position, target.url, totalResults, JSON.stringify(items)]);
  return { ok:true, source:'dataforseo', run: ins.rows[0], target };
}

router.post('/scan/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try { const r = await _scanOne(Number(req.params.id)); if (!r.ok) return _err(res, 404, r.error); res.json(r); }
  catch (e) { _err(res, 500, e.message); }
});

router.post('/scan-all', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const ks = (await _db.getPool().query(`SELECT id FROM serp_tracker_keywords WHERE enabled=true`)).rows;
    let scanned = 0, failed = 0;
    for (const k of ks) {
      try { const r = await _scanOne(k.id); if (r.ok && r.source==='dataforseo') scanned++; else failed++; }
      catch { failed++; }
    }
    res.json({ ok:true, scanned, failed, total: ks.length });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/history/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const r = await _db.getPool().query(
      `SELECT id, target_position, target_url, total_results, ran_at FROM serp_tracker_runs WHERE keyword_id=$1 ORDER BY ran_at DESC LIMIT 60`,
      [Number(req.params.id)]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

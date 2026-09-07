// SERP Gap Analyzer — find easy-rank / under-optimized competitor opportunities.
const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }
function _normDomain(d) {
  return String(d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

async function _serpAdvanced(keyword, locationCode = 2840) {
  const login = process.env.DATAFORSEO_LOGIN, pw = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pw || /^_DUMMY/i.test(login)) return null;
  const auth = 'Basic ' + Buffer.from(login + ':' + pw).toString('base64');
  const body = JSON.stringify([{
    keyword, language_code: 'en', location_code: locationCode, depth: 20, device: 'desktop',
  }]);
  return new Promise((resolve) => {
    const req = _https.request({
      hostname: 'api.dataforseo.com',
      path: '/v3/serp/google/organic/live/advanced',
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try { resolve(r.statusCode === 200 ? JSON.parse(d) : null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

function _scoreWeakness(item, keyword) {
  const title = String(item.title || '');
  const desc = String(item.description || item.snippet || '');
  const url = String(item.url || '');
  const kw = keyword.toLowerCase();
  let score = 0;
  const reasons = [];
  if (!title.toLowerCase().includes(kw.split(' ')[0])) {
    score += 25; reasons.push('title missing primary keyword');
  }
  if (desc.length < 80) {
    score += 20; reasons.push('thin meta/snippet');
  }
  if (url.split('/').filter(Boolean).length <= 2) {
    score += 5;
  }
  if (/wikipedia\.org|youtube\.com|facebook\.com|linkedin\.com|amazon\./i.test(url)) {
    score -= 30; // hard SERPs — less "easy"
  }
  if ((item.rank_absolute || 99) > 5 && (item.rank_absolute || 99) <= 15) {
    score += 15; reasons.push('ranks outside top 5 — displaceable');
  }
  if (!desc.toLowerCase().includes(kw.split(' ').slice(0, 2).join(' '))) {
    score += 10; reasons.push('snippet poorly aligned');
  }
  return { weakness_score: Math.max(0, Math.min(100, score)), reasons };
}

router.post('/analyze', async (req, res) => {
  try {
    const tid = await _tid(req, 'serp-gap:analyze');
    const myDomain = _normDomain(req.body?.my_domain || req.body?.domain);
    let keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map((k) => String(k).trim()).filter(Boolean) : [];
    if (!keywords.length && req.body?.keyword) keywords = [String(req.body.keyword).trim()];
    keywords = keywords.slice(0, 8);
    if (!myDomain) return _err(res, 400, 'my_domain required');
    if (!keywords.length) return _err(res, 400, 'keywords required');

    const opportunities = [];
    for (const keyword of keywords) {
      const raw = await _serpAdvanced(keyword);
      const items = (raw?.tasks?.[0]?.result?.[0]?.items || [])
        .filter((it) => it.type === 'organic')
        .slice(0, 15);

      let myPos = null;
      for (const it of items) {
        const dom = _normDomain(it.domain || it.url || '');
        if (dom === myDomain || dom.endsWith('.' + myDomain)) {
          myPos = it.rank_absolute || it.rank_group;
          break;
        }
      }

      for (const it of items) {
        const dom = _normDomain(it.domain || it.url || '');
        if (!dom || dom === myDomain || dom.endsWith('.' + myDomain)) continue;
        if (/google\.|facebook\.|instagram\.|twitter\.|x\.com/i.test(dom)) continue;
        const weak = _scoreWeakness(it, keyword);
        if (weak.weakness_score < 25) continue;
        const pos = it.rank_absolute || it.rank_group || 99;
        const opportunity = Math.round(weak.weakness_score * (1 + (20 - Math.min(pos, 20)) / 40));
        opportunities.push({
          keyword,
          competitor_domain: dom,
          competitor_url: it.url,
          competitor_title: it.title,
          position: pos,
          my_position: myPos,
          weakness_score: weak.weakness_score,
          opportunity_score: Math.min(100, opportunity),
          reasons: weak.reasons,
          suggested_action: myPos && myPos < pos
            ? 'Defend — you already outrank this weak page; expand content depth.'
            : 'Attack — publish a tighter page targeting this keyword and outrank the weak result.',
        });
      }
    }

    opportunities.sort((a, b) => b.opportunity_score - a.opportunity_score);
    const top = opportunities.slice(0, 40);

    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO serp_gap_runs (tenant_id, my_domain, seed_keywords, opportunities)
         VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
        [tid, myDomain, JSON.stringify(keywords), JSON.stringify(top)]
      ).catch(() => {});
    }

    res.json({
      ok: true,
      my_domain: myDomain,
      keywords,
      count: top.length,
      opportunities: top,
      summary: top.length
        ? `${top.length} under-optimized SERP opportunities — top score ${top[0].opportunity_score} on “${top[0].keyword}”.`
        : 'No weak SERP gaps found for these seeds — try commercial mid-tail keywords.',
    });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, runs: [] });
  try {
    const tid = await _tid(req, 'serp-gap:history');
    const r = await _db.getPool().query(
      `SELECT id, my_domain, seed_keywords, created_at,
              jsonb_array_length(opportunities) AS opportunity_count
       FROM serp_gap_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [tid]
    );
    res.json({ ok: true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

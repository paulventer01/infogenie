const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

function _dfsAuth() {
  const u = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD;
  if (!u || !p) return null;
  return 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
}
async function _dfsCall(path, payload, timeoutMs = 25000) {
  const auth = _dfsAuth(); if (!auth) throw new Error('DataForSEO not configured');
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = _https.request({
      hostname:'api.dataforseo.com', path, method:'POST',
      headers:{ 'Authorization':auth, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
    }); });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('dfs timeout')));
    req.write(body); req.end();
  });
}

function _normTarget(t) {
  return String(t || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').slice(0, 253);
}

router.post('/summary', async (req, res) => {
  const target = _normTarget(req.body?.target);
  if (!target) return _err(res, 400, 'target required');
  if (!_dfsAuth()) return res.json({ ok:true, source:'placeholder', target,
    summary: { backlinks:0, referring_domains:0, rank:0, broken:0 },
    note:'DataForSEO not configured — connect DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to enable real data.' });
  try {
    const j = await _dfsCall('/v3/backlinks/summary/live', [{ target, internal_list_limit:10, backlinks_status_type:'live' }]);
    const task = j?.tasks?.[0] || {};
    const item = task.result?.[0] || {};
    const denied = /access denied|subscription/i.test(task.status_message || '');
    res.json({ ok:true, source:'dataforseo', target, summary: {
      backlinks: item.backlinks || 0,
      referring_domains: item.referring_domains || 0,
      referring_main_domains: item.referring_main_domains || 0,
      rank: item.rank || 0,
      broken: item.broken_backlinks || 0,
      first_seen: item.first_seen || null,
      lost_date: item.lost_date || null,
    }, raw_status: task.status_message || 'ok',
       note: denied ? 'DataForSEO Backlinks API requires a separate subscription. Activate at app.dataforseo.com/backlinks-subscription to see live data.' : undefined });
  } catch (e) { _err(res, 502, e.message); }
});

router.post('/referring-domains', async (req, res) => {
  const target = _normTarget(req.body?.target);
  const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 50));
  if (!target) return _err(res, 400, 'target required');
  if (!_dfsAuth()) return res.json({ ok:true, source:'placeholder', target, domains: [],
    note:'DataForSEO not configured — connect DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to enable real data.' });
  try {
    const j = await _dfsCall('/v3/backlinks/referring_domains/live', [{ target, limit, order_by:['rank,desc'], backlinks_status_type:'live' }]);
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    res.json({ ok:true, source:'dataforseo', target, domains: items.map(it => ({
      domain: it.domain,
      rank: it.rank || 0,
      backlinks: it.backlinks || 0,
      first_seen: it.first_seen,
      lost_date: it.lost_date,
      is_lost: !!it.is_lost,
      country: it.country,
    })) });
  } catch (e) { _err(res, 502, e.message); }
});

// ── T35.3 — Backlink Research dimensions ────────────────────────────────────
// Top Anchors (the words other sites use to link to you), Top Linked Pages
// (which of YOUR pages attract the most links), Top Linking TLDs/Countries
// (geographic + domain-type clustering — derived locally from the existing
// referring_domains pull so we don't burn a second DataForSEO credit per call).

router.post('/anchors', async (req, res) => {
  const target = _normTarget(req.body?.target);
  const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 50));
  if (!target) return _err(res, 400, 'target required');
  if (!_dfsAuth()) return res.json({ ok: true, source: 'placeholder', target, anchors: [],
    note: 'DataForSEO not configured — connect DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to enable real data.' });
  try {
    const j = await _dfsCall('/v3/backlinks/anchors/live', [{ target, limit, order_by: ['backlinks,desc'], backlinks_status_type: 'live' }]);
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    res.json({ ok: true, source: 'dataforseo', target, anchors: items.map(it => ({
      anchor: it.anchor || '', backlinks: it.backlinks || 0, referring_domains: it.referring_domains || 0,
      first_seen: it.first_seen || null, lost_date: it.lost_date || null,
    })) });
  } catch (e) { _err(res, 502, e.message); }
});

router.post('/pages', async (req, res) => {
  const target = _normTarget(req.body?.target);
  const limit = Math.min(100, Math.max(1, parseInt(req.body?.limit, 10) || 50));
  if (!target) return _err(res, 400, 'target required');
  if (!_dfsAuth()) return res.json({ ok: true, source: 'placeholder', target, pages: [],
    note: 'DataForSEO not configured — connect DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to enable real data.' });
  try {
    const j = await _dfsCall('/v3/backlinks/pages/live', [{ target, limit, order_by: ['backlinks,desc'], backlinks_status_type: 'live' }]);
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    res.json({ ok: true, source: 'dataforseo', target, pages: items.map(it => ({
      url: it.url || '', backlinks: it.backlinks || 0, referring_domains: it.referring_domains || 0,
      rank: it.rank || 0, first_seen: it.first_seen || null,
    })) });
  } catch (e) { _err(res, 502, e.message); }
});

// TLD / country breakdowns are derived from the (already-cheap) referring
// domains call — no extra DataForSEO credit. We pull a wide sample (200) and
// group locally so the user gets both views from one network round-trip.
router.post('/breakdown', async (req, res) => {
  const target = _normTarget(req.body?.target);
  if (!target) return _err(res, 400, 'target required');
  if (!_dfsAuth()) return res.json({ ok: true, source: 'placeholder', target,
    tlds: [], countries: [], note: 'DataForSEO not configured — connect DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD to enable real data.' });
  try {
    const j = await _dfsCall('/v3/backlinks/referring_domains/live',
      [{ target, limit: 200, order_by: ['backlinks,desc'], backlinks_status_type: 'live' }]);
    const items = j?.tasks?.[0]?.result?.[0]?.items || [];
    const tldCounts = new Map();
    const ctyCounts = new Map();
    for (const it of items) {
      const dom = String(it.domain || '');
      const parts = dom.split('.');
      const tld = parts.length > 1 ? '.' + parts.slice(-1)[0].toLowerCase() : '';
      if (tld) tldCounts.set(tld, (tldCounts.get(tld) || { tld, domains: 0, backlinks: 0 }));
      if (tld) { const e = tldCounts.get(tld); e.domains++; e.backlinks += (it.backlinks || 0); }
      const cty = it.country || '—';
      if (!ctyCounts.has(cty)) ctyCounts.set(cty, { country: cty, domains: 0, backlinks: 0 });
      const e = ctyCounts.get(cty); e.domains++; e.backlinks += (it.backlinks || 0);
    }
    const tlds = Array.from(tldCounts.values()).sort((a, b) => b.backlinks - a.backlinks).slice(0, 25);
    const countries = Array.from(ctyCounts.values()).sort((a, b) => b.backlinks - a.backlinks).slice(0, 25);
    res.json({ ok: true, source: 'dataforseo', target, sampleSize: items.length, tlds, countries });
  } catch (e) { _err(res, 502, e.message); }
});

module.exports = router;

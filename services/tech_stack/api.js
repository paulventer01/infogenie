const express = require('express');
const _https = require('https');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;
function _normDomain(d) { return String(d||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]; }

async function _builtwithFree(domain) {
  const key = process.env.BUILTWITH_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.builtwith.com', method:'GET',
      path:`/free1/api.json?KEY=${encodeURIComponent(key)}&LOOKUP=${encodeURIComponent(domain)}`,
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null); resolve(JSON.parse(d)); } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => req.destroy());
    req.end();
  });
}

function _normalizeBuiltwith(raw) {
  // BuiltWith FREE tier returns { domain, groups:[{name, live:N, dead:N, categories:[{name, live:N, dead:N, latest, oldest}]}] }
  // Free tier returns COUNTS only — no individual technology names.
  if (!raw || !Array.isArray(raw.groups)) return { groups: [], total: 0 };
  const groups = raw.groups.map(g => ({
    group: g.name,
    live: Number(g.live) || 0,
    dead: Number(g.dead) || 0,
    latest: g.latest || null,
    categories: (g.categories || []).map(c => ({
      name: c.name,
      live: Number(c.live) || 0,
      dead: Number(c.dead) || 0,
      latest: c.latest || null,
    })).filter(c => c.live > 0 || c.dead > 0)
      .sort((a,b) => b.live - a.live),
  })).filter(g => g.categories.length).sort((a,b) => b.live - a.live);
  const total = groups.reduce((s, g) => s + g.live, 0);
  return { groups, total };
}

router.post('/detect', async (req, res) => {
  const domain = _normDomain(req.body?.domain);
  if (!domain || !DOMAIN_RE.test(domain)) return _err(res, 400, 'Valid domain required (e.g. example.com)');
  const raw = await _builtwithFree(domain);
  if (!raw) return res.json({ ok:true, domain, source:'placeholder', note:'BUILTWITH_API_KEY missing or rate-limited — set the key for real detection.', groups: [], total: 0 });
  const norm = _normalizeBuiltwith(raw);
  res.json({ ok:true, domain, source:'builtwith', total: norm.total, groups: norm.groups, note: norm.groups.length ? 'BuiltWith Free tier returns category counts only. Upgrade to BuiltWith Pro/Lookups for individual technology names.' : '' });
});

router.post('/compare', async (req, res) => {
  const domains = Array.isArray(req.body?.domains) ? req.body.domains.slice(0, 5).map(_normDomain).filter(d => DOMAIN_RE.test(d)) : [];
  if (!domains.length) return _err(res, 400, 'domains[] (1-5) required');
  const results = [];
  for (const d of domains) {
    // One retry with longer backoff — BuiltWith Free frequently throttles
    // the FIRST request in a batch, and a 4-second second-attempt usually
    // succeeds. Without this, the user's own analysed domain (always first
    // in the list) systematically came back empty while competitors loaded
    // fine.
    let raw = await _builtwithFree(d);
    if (!raw) {
      await new Promise(r => setTimeout(r, 4000));
      raw = await _builtwithFree(d);
    }
    if (!raw) {
      results.push({ domain:d, total:0, groups:[], source:'placeholder', note:'BuiltWith Free returned no data for this domain (rate-limit or not in their index).' });
    } else {
      const n = _normalizeBuiltwith(raw);
      results.push({ domain:d, total:n.total, groups:n.groups, source:'builtwith' });
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  // Build a category-presence matrix (Free tier doesn't expose tech names, so compare at category level)
  const catIndex = {};
  for (const r of results) {
    for (const g of r.groups) for (const c of g.categories) {
      const k = `${g.group}::${c.name}`.toLowerCase();
      if (!catIndex[k]) catIndex[k] = { name: c.name, tag: g.group, present: {}, counts: {} };
      catIndex[k].present[r.domain] = c.live > 0;
      catIndex[k].counts[r.domain] = c.live;
    }
  }
  const matrix = Object.values(catIndex)
    .sort((a,b) => Object.values(b.counts).reduce((s,v)=>s+v,0) - Object.values(a.counts).reduce((s,v)=>s+v,0));
  res.json({ ok:true, domains, results, matrix });
});

module.exports = router;

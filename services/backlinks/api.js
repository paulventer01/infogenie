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

// Detect a Backlinks-API gate (40200 Payment Required / 40400 Forbidden /
// "access denied" / "subscription") — DataForSEO sells Backlinks as a
// separate paid product, but SERP credits still work, so we fall back to
// a Google "linkmention" discovery using SERP.
function _backlinksGated(task) {
  const sc = Number(task?.status_code || 0);
  const sm = String(task?.status_message || '');
  if ([40200, 40300, 40400, 40500].includes(sc)) return true;
  return /payment required|access denied|forbidden|subscription/i.test(sm);
}

// SERP-based fallback: search Google for `"<domain>" -site:<domain>` to find
// pages on the open web that mention the target. Returns real URLs, real
// referring domains — costs ~1 SERP credit (which the user already has).
async function _serpLinkMentions(target, limit = 100) {
  const auth = _dfsAuth(); if (!auth) return { items: [] };
  const query = `"${target}" -site:${target}`;
  return new Promise((resolve) => {
    const body = JSON.stringify([{
      keyword: query, language_code: 'en', location_code: 2840,
      depth: Math.min(100, Math.max(20, limit)),
    }]);
    const r = _https.request({
      hostname:'api.dataforseo.com', path:'/v3/serp/google/organic/live/advanced', method:'POST',
      headers:{ 'Authorization':auth, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, resp => { let d=''; resp.on('data', c => d += c); resp.on('end', () => {
      try {
        const j = JSON.parse(d);
        const items = j?.tasks?.[0]?.result?.[0]?.items || [];
        const out = items
          .filter(it => it.type === 'organic' && it.url)
          .map(it => ({ url: it.url, title: it.title || '', snippet: it.description || '', rank_group: it.rank_group || 0 }));
        resolve({ items: out, raw_status: j?.tasks?.[0]?.status_message || 'ok' });
      } catch (e) { resolve({ items: [], error: e.message }); }
    }); });
    r.on('error', () => resolve({ items: [] }));
    r.setTimeout(20000, () => { r.destroy(); resolve({ items: [] }); });
    r.write(body); r.end();
  });
}
function _domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
function _tldOf(d) { const p = String(d || '').split('.'); return p.length > 1 ? '.' + p.slice(-1)[0].toLowerCase() : ''; }

async function _fallbackBacklinkData(target, limit) {
  const { items, raw_status } = await _serpLinkMentions(target, Math.max(100, limit));
  const byDomain = new Map();
  for (const it of items) {
    const d = _domainOf(it.url); if (!d || d === target) continue;
    if (!byDomain.has(d)) byDomain.set(d, { domain: d, backlinks: 0, pages: [], rank: 0, country: '—' });
    const e = byDomain.get(d); e.backlinks++; e.pages.push({ url: it.url, title: it.title });
    e.rank = Math.max(e.rank, 101 - (it.rank_group || 100));
  }
  const domains = Array.from(byDomain.values())
    .sort((a, b) => b.backlinks - a.backlinks)
    .slice(0, limit)
    .map(e => ({ ...e, first_seen: null, lost_date: null, is_lost: false }));
  return {
    summary: {
      backlinks: items.length, referring_domains: byDomain.size, referring_main_domains: byDomain.size,
      rank: domains[0]?.rank || 0, broken: 0, first_seen: null, lost_date: null,
    },
    domains, items, raw_status,
  };
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
    if (_backlinksGated(task) || (!item.backlinks && !item.referring_domains)) {
      const fb = await _fallbackBacklinkData(target, 50);
      return res.json({ ok:true, source:'serp-fallback', target, summary: fb.summary, raw_status: task.status_message || 'ok',
        note: `DataForSEO Backlinks subscription is not active on this account — showing real link mentions discovered via Google SERP instead (${fb.summary.referring_domains} referring domains from ${fb.summary.backlinks} mentions). For full historical backlink data, activate the Backlinks add-on at app.dataforseo.com/backlinks-subscription.` });
    }
    res.json({ ok:true, source:'dataforseo', target, summary: {
      backlinks: item.backlinks || 0,
      referring_domains: item.referring_domains || 0,
      referring_main_domains: item.referring_main_domains || 0,
      rank: item.rank || 0,
      broken: item.broken_backlinks || 0,
      first_seen: item.first_seen || null,
      lost_date: item.lost_date || null,
    }, raw_status: task.status_message || 'ok' });
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
    const task = j?.tasks?.[0] || {};
    const items = task.result?.[0]?.items || [];
    if (_backlinksGated(task) || items.length === 0) {
      const fb = await _fallbackBacklinkData(target, limit);
      return res.json({ ok:true, source:'serp-fallback', target, domains: fb.domains,
        note: 'Discovered via Google SERP (DataForSEO Backlinks subscription not active).' });
    }
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
    const task = j?.tasks?.[0] || {};
    const items = task.result?.[0]?.items || [];
    if (_backlinksGated(task) || items.length === 0) {
      const fb = await _fallbackBacklinkData(target, limit);
      const anchorMap = new Map();
      const target_re = new RegExp(target.replace(/[.\\]/g, '\\$&'), 'i');
      for (const it of fb.items) {
        // Use the SERP title (or first 80 chars of snippet) as the best-available "anchor".
        const a = (it.title || '').replace(target_re, '').replace(/[|–—-].*$/, '').trim().slice(0, 80) || '(untitled)';
        if (!anchorMap.has(a)) anchorMap.set(a, { anchor: a, backlinks: 0, referring_domains: new Set() });
        const e = anchorMap.get(a); e.backlinks++;
        const d = _domainOf(it.url); if (d) e.referring_domains.add(d);
      }
      const anchors = Array.from(anchorMap.values())
        .map(e => ({ anchor: e.anchor, backlinks: e.backlinks, referring_domains: e.referring_domains.size, first_seen: null, lost_date: null }))
        .sort((a, b) => b.backlinks - a.backlinks).slice(0, limit);
      return res.json({ ok: true, source: 'serp-fallback', target, anchors,
        note: 'Anchor-like phrases derived from Google SERP titles (DataForSEO Backlinks subscription not active).' });
    }
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
    const task = j?.tasks?.[0] || {};
    const items = task.result?.[0]?.items || [];
    if (_backlinksGated(task) || items.length === 0) {
      const fb = await _fallbackBacklinkData(target, limit);
      const pages = fb.items.slice(0, limit).map(it => ({
        url: it.url, backlinks: 1, referring_domains: 1, rank: it.rank_group || 0, first_seen: null,
      }));
      return res.json({ ok: true, source: 'serp-fallback', target, pages,
        note: 'Linking pages discovered via Google SERP (DataForSEO Backlinks subscription not active).' });
    }
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
    const task = j?.tasks?.[0] || {};
    let items = task.result?.[0]?.items || [];
    let sourceTag = 'dataforseo';
    let noteTxt = undefined;
    if (_backlinksGated(task) || items.length === 0) {
      const fb = await _fallbackBacklinkData(target, 100);
      items = fb.domains.map(d => ({ domain: d.domain, backlinks: d.backlinks, country: d.country }));
      sourceTag = 'serp-fallback';
      noteTxt = 'Breakdown derived from Google SERP (DataForSEO Backlinks subscription not active).';
    }
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
    res.json({ ok: true, source: sourceTag, target, sampleSize: items.length, tlds, countries, note: noteTxt });
  } catch (e) { _err(res, 502, e.message); }
});

module.exports = router;

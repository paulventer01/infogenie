// Semrush integration — domain overview, organic keywords, competitors, keyword lookup.
// API: api.semrush.com (CSV/semicolon-delimited responses)
// Requires SEMRUSH_API_KEY (set via Manage → Platform APIs).
// Docs: https://developer.semrush.com/api/
const express = require('express');
const router  = express.Router();
const _tenantCtx = require('../tenants/context');

const BASE    = 'https://api.semrush.com';
const TIMEOUT = 15000;

function _key()  { return process.env.SEMRUSH_API_KEY || ''; }
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safe(h) {
  return (req, res) => Promise.resolve(h(req, res)).catch(e => {
    console.warn('[semrush]', e.message);
    if (!res.headersSent) _err(res, 500, e.message);
  });
}

// Parse Semrush semicolon-delimited response into array of objects
function _parseCsv(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(';');
  return lines.slice(1).map(line => {
    const vals = line.split(';');
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = vals[i]?.trim() ?? ''; });
    return obj;
  });
}

async function _smGet(params = {}) {
  const key = _key();
  if (!key) throw new Error('SEMRUSH_API_KEY not configured');
  const qs = new URLSearchParams({ ...params, key }).toString();
  const url = `${BASE}/?${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  const text = await r.text();
  if (text.startsWith('ERROR')) throw new Error(text.replace(/^ERROR \d+\s*::\s*/i, '').trim());
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return text;
}

// ── GET /api/semrush/status ───────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ ok: true, configured: !!_key() });
});

// ── POST /api/semrush/domain-overview ────────────────────────────────────
// Returns organic + paid summary for a domain: traffic estimate, keyword
// count, traffic cost, authority score.
router.post('/domain-overview', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SEMRUSH_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'semrush:overview' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, database = 'us' } = req.body;
  if (!domain) return _err(res, 400, 'domain required');

  // Domain organic summary row
  const [orgText, scoreText] = await Promise.allSettled([
    _smGet({ type: 'domain_organic', domain, database,
      export_columns: 'Or,Ot,Oc,Ad,At,Ac,FKn,FKd', display_limit: 1 }),
    _smGet({ type: 'domain_score', domain, database }),
  ]);

  // Organic row is a single data line (no header for this type)
  let organic = {};
  if (orgText.status === 'fulfilled') {
    const lines = orgText.value.trim().split('\n').filter(Boolean);
    if (lines.length >= 2) {
      const [hdr, row] = [lines[0].split(';'), lines[1].split(';')];
      hdr.forEach((h, i) => { organic[h.trim()] = row[i]?.trim() ?? '0'; });
    } else if (lines.length === 1) {
      // Some API tiers return just one summary row without header
      const vals = lines[0].split(';');
      ['Or','Ot','Oc','Ad','At','Ac','FKn','FKd'].forEach((h,i)=>{ organic[h]=vals[i]?.trim()||'0'; });
    }
  }

  let score = null;
  if (scoreText.status === 'fulfilled') {
    const rows = _parseCsv(scoreText.value);
    score = rows[0]?.Score ?? null;
  }

  res.json({
    ok: true,
    domain,
    database,
    overview: {
      authorityScore:     score ? parseInt(score, 10) : null,
      organicKeywords:    parseInt(organic.Or  || organic['Organic Keywords'] || '0', 10),
      organicTraffic:     parseInt(organic.Ot  || organic['Organic Traffic']  || '0', 10),
      organicTrafficCost: parseFloat(organic.Oc || '0'),
      paidKeywords:       parseInt(organic.Ad  || '0', 10),
      paidTraffic:        parseInt(organic.At  || '0', 10),
      paidTrafficCost:    parseFloat(organic.Ac || '0'),
    },
  });
}));

// ── POST /api/semrush/keywords ────────────────────────────────────────────
// Top organic keywords a domain ranks for.
router.post('/keywords', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SEMRUSH_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'semrush:keywords' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, database = 'us', limit = 20 } = req.body;
  if (!domain) return _err(res, 400, 'domain required');
  const text = await _smGet({
    type: 'domain_organic', domain, database,
    export_columns: 'Ph,Po,Pp,Nq,Kd,Tc,Co,Nr,Td',
    display_limit: Math.min(parseInt(limit, 10) || 20, 50),
    display_sort: 'tr_desc',
  });
  const rows = _parseCsv(text);
  res.json({
    ok: true, domain, database,
    keywords: rows.map(r => ({
      keyword:          r.Keyword   || r.Ph || '',
      position:         parseInt(r.Position || r.Po || '0', 10),
      prevPosition:     parseInt(r['Previous position'] || r.Pp || '0', 10),
      searchVolume:     parseInt(r['Search Volume'] || r.Nq || '0', 10),
      difficulty:       parseFloat(r['Keyword Difficulty'] || r.Kd || '0'),
      cpc:              parseFloat(r.CPC || r.Tc || '0'),
      competition:      parseFloat(r.Competition || r.Co || '0'),
      results:          parseInt(r['Number of Results'] || r.Nr || '0', 10),
      trend:            r.Trends || r.Td || '',
    })),
  });
}));

// ── POST /api/semrush/competitors ─────────────────────────────────────────
// Organic competitors for a domain.
router.post('/competitors', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SEMRUSH_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'semrush:competitors' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { domain, database = 'us', limit = 10 } = req.body;
  if (!domain) return _err(res, 400, 'domain required');
  const text = await _smGet({
    type: 'domain_organic_organic', domain, database,
    export_columns: 'Dn,Cr,Np,Or,Ot,Oc,Ad,At',
    display_limit: Math.min(parseInt(limit, 10) || 10, 30),
    display_sort: 'np_desc',
  });
  const rows = _parseCsv(text);
  res.json({
    ok: true, domain, database,
    competitors: rows.map(r => ({
      domain:          r.Domain          || r.Dn || '',
      competitorScore: parseFloat(r['Competition level'] || r.Cr || '0'),
      commonKeywords:  parseInt(r['Common keywords'] || r.Np || '0', 10),
      organicKeywords: parseInt(r['Organic Keywords'] || r.Or || '0', 10),
      organicTraffic:  parseInt(r['Organic Traffic']  || r.Ot || '0', 10),
    })),
  });
}));

// ── POST /api/semrush/keyword-lookup ─────────────────────────────────────
// Volume, KD, CPC and trend for a single keyword.
router.post('/keyword-lookup', _safe(async (req, res) => {
  if (!_key()) return _err(res, 400, 'SEMRUSH_API_KEY not configured');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'semrush:kw-lookup' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const { keyword, database = 'us' } = req.body;
  if (!keyword) return _err(res, 400, 'keyword required');
  const [overText, relText] = await Promise.all([
    _smGet({ type: 'phrase_this', phrase: keyword, database,
      export_columns: 'Ph,Nq,Cp,Co,Nr,Td,Kd', display_limit: 1 }),
    _smGet({ type: 'phrase_related', phrase: keyword, database,
      export_columns: 'Ph,Nq,Cp,Co,Kd', display_limit: 10,
      display_sort: 'nq_desc' }),
  ]);
  const [main] = _parseCsv(overText);
  const related = _parseCsv(relText);
  res.json({
    ok: true, keyword, database,
    metrics: main ? {
      keyword:      main.Keyword    || main.Ph || keyword,
      searchVolume: parseInt(main['Search Volume'] || main.Nq || '0', 10),
      cpc:          parseFloat(main.CPC || main.Cp || '0'),
      competition:  parseFloat(main.Competition || main.Co || '0'),
      results:      parseInt(main['Number of Results'] || main.Nr || '0', 10),
      trend:        main.Trends     || main.Td || '',
      difficulty:   parseFloat(main['Keyword Difficulty'] || main.Kd || '0'),
    } : null,
    relatedKeywords: related.map(r => ({
      keyword:      r.Keyword     || r.Ph || '',
      searchVolume: parseInt(r['Search Volume'] || r.Nq || '0', 10),
      cpc:          parseFloat(r.CPC || r.Cp || '0'),
      difficulty:   parseFloat(r['Keyword Difficulty'] || r.Kd || '0'),
    })),
  });
}));

module.exports = router;

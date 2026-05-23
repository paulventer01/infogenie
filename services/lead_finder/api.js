const express = require('express');
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _perplexitySearch(payload) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const titles = (payload.titles||[]).join(', ') || 'decision-makers';
  const seniorities = (payload.seniorities||[]).join(', ');
  const locations = (payload.locations||[]).join(', ') || 'global';
  const industries = (payload.industries||[]).join(', ');
  const sizeRange = (payload.company_size_min || payload.company_size_max)
    ? `between ${payload.company_size_min||1} and ${payload.company_size_max||100000} employees` : 'any size';
  const sys = `You are a B2B prospect researcher. Return STRICT JSON only:
{"leads":[{"name":"<full name>","title":"<exact current title>","seniority":"<c_suite|vp|director|head|manager|senior>","department":"<marketing|sales|product|engineering|operations|other>","company":"<company name>","company_domain":"<domain.com>","company_size":<number>,"company_industry":"<industry>","location":"<city, country>","linkedin_url":"<https://linkedin.com/in/...>","email_status":"unknown","email":"","why_fit":"<one sentence why this lead matches the ICP>","source_url":"<source URL where you found them>"}]}
Hard rules:
- Only real, currently-active people verified from public sources (LinkedIn, company press, news).
- NEVER invent emails — leave email empty and email_status='unknown'.
- linkedin_url MUST be a real public LinkedIn profile URL.
- Diversity: max 2 leads per company.`;
  const user = `Find ${payload.per_page} real B2B prospects matching this ICP:
- Job titles: ${titles}
- Seniority: ${seniorities||'any'}
- Locations: ${locations}
- Industries: ${industries||'any'}
- Company size: ${sizeRange}
Return JSON only.`;
  const body = JSON.stringify({
    model:'sonar', messages:[{role:'system',content:sys},{role:'user',content:user}],
    temperature:0.2, max_tokens:3500, return_citations:true,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) { console.warn('[lead-finder] perplexity', r.statusCode, d.slice(0,200)); return resolve(null); }
        const j = JSON.parse(d); const txt = j.choices?.[0]?.message?.content || '';
        const m = txt.match(/\{[\s\S]*\}/); if (!m) return resolve(null);
        resolve(JSON.parse(m[0]));
      } catch (e) { console.warn('[lead-finder] parse', e.message); resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body); req.end();
  });
}

router.post('/search', async (req, res) => {
  const titles = Array.isArray(req.body?.titles) ? req.body.titles.slice(0, 10) : [];
  const seniorities = Array.isArray(req.body?.seniorities) ? req.body.seniorities.slice(0, 10) : [];
  const locations = Array.isArray(req.body?.locations) ? req.body.locations.slice(0, 10) : [];
  const industries = Array.isArray(req.body?.industries) ? req.body.industries.slice(0, 10) : [];
  const company_size_min = parseInt(req.body?.company_size_min, 10) || null;
  const company_size_max = parseInt(req.body?.company_size_max, 10) || null;
  const per_page = Math.max(3, Math.min(15, parseInt(req.body?.per_page, 10) || 10));
  const filters = { titles, seniorities, locations, industries, company_size_min, company_size_max, per_page };

  if (!titles.length && !seniorities.length) return _err(res, 400, 'At least one title or seniority required');

  const raw = await _perplexitySearch(filters);
  if (!raw || !Array.isArray(raw.leads)) {
    return res.json({ ok:true, source:'placeholder', note:'PERPLEXITY_API_KEY missing or search failed — set the key for live B2B prospect research.', filters, leads: [], total: 0 });
  }

  const leads = raw.leads.slice(0, per_page);
  if (_db.hasDb()) {
    try {
      const tid = await _tid(req, 'lead-finder:search');
      await _db.getPool().query(
        `INSERT INTO lead_finder_runs (tenant_id, query_filters, result_count, leads, source) VALUES ($1,$2,$3,$4,$5)`,
        [tid, JSON.stringify(filters), leads.length, JSON.stringify(leads), 'perplexity']);
    } catch (e) { console.warn('[lead-finder] persist failed:', e.message); }
  }
  res.json({ ok:true, source:'perplexity', filters, leads, total: leads.length });
});

router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  try {
    const tid = await _tid(req, 'lead-finder:history');
    const r = await _db.getPool().query(
      `SELECT id, query_filters, result_count, source, created_at FROM lead_finder_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [tid]);
    res.json({ ok:true, runs: r.rows });
  } catch (e) { _err(res, 500, e.message); }
});

router.get('/:id', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return _err(res, 400, 'bad id');
  try {
    const tid = await _tid(req, 'lead-finder:get');
    const r = await _db.getPool().query(
      `SELECT * FROM lead_finder_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    if (!r.rows[0]) return _err(res, 404, 'not found');
    res.json({ ok:true, run: r.rows[0] });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

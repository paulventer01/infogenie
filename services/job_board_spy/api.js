const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[job-spy]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
function _hasPerplexity() { const k = process.env.PERPLEXITY_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _scanJobs(company) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  const prompt = `Search LinkedIn Jobs, Indeed, and the company's careers page for current open job postings at "${company}". Return strict JSON only:
{
  "total_jobs": <integer>,
  "jobs": [
    {"title":"...","department":"engineering|sales|marketing|product|design|ops|finance|hr|other","location":"...","posted":"YYYY-MM-DD or relative","seniority":"junior|mid|senior|director|vp|c-suite","url":"https://...","summary":"1-line"}
  ],
  "by_dept": {"engineering":<count>,"sales":<count>,...},
  "strategic_signals": [
    "Hiring 5 engineers in AI/ML — likely building AI-powered product",
    "3 senior sales hires in EMEA — geographic expansion",
    ...
  ]
}
Up to 25 jobs. Strategic signals: 2-5 plain-English insights about what these hires reveal about company direction. Never invent — only real listings.`;
  return await new Promise(resolve => {
    const body = JSON.stringify({ model:'sonar', temperature:0.2, max_tokens:3000, messages:[{ role:'user', content: prompt }] });
    const req = _https.request({
      hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          const txt = j?.choices?.[0]?.message?.content || '';
          const m = txt.match(/\{[\s\S]*\}/);
          if (!m) return resolve({ total_jobs:0, jobs:[], by_dept:{}, strategic_signals:[] });
          resolve(JSON.parse(m[0]));
        } catch { resolve({ total_jobs:0, jobs:[], by_dept:{}, strategic_signals:[] }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(45000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, perplexity: _hasPerplexity(), db: _db.hasDb && _db.hasDb() }));

router.post('/scan', _safeAsync(async (req, res) => {
  const company = String(req.body?.company || '').trim().slice(0, 200);
  if (!company) return _err(res, 400, 'company required');
  if (!_hasPerplexity()) return _err(res, 400, 'PERPLEXITY_API_KEY required');
  const r = await _scanJobs(company);
  if (r.error) return _err(res, 502, r.error);

  if (_db.hasDb && _db.hasDb()) {
    try {
      const tid = await _tenantCtx.resolveTenantId(req, { label: 'job_board_spy:scan' });
      await _db.getPool().query(
      `INSERT INTO job_board_runs (tenant_id, company, total_jobs, by_dept, jobs, strategic_signals) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, company, parseInt(r.total_jobs,10) || (r.jobs||[]).length, JSON.stringify(r.by_dept||{}), JSON.stringify((r.jobs||[]).slice(0,50)), JSON.stringify(r.strategic_signals||[])]
    ); } catch(_) {}
  }
  res.json({ ok:true, company, ...r });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'job_board_spy:runs' });
  const r = await _db.getPool().query('SELECT id, company, total_jobs, by_dept, strategic_signals, created_at FROM job_board_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

module.exports = router;

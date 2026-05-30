const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safeAsync(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[newsletter]', e.stack || e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }
const _scanLocks = new Set();
function _hasFirecrawl() { const k = process.env.FIRECRAWL_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _hasOpenAI() { const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return k && !/^_DUMMY/i.test(k); }

async function _firecrawlScrape(url) {
  if (!_hasFirecrawl()) return null;
  return await new Promise(resolve => {
    const data = JSON.stringify({ url, formats:['markdown'], onlyMainContent:true });
    const req = _https.request({
      hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => { try { const j = JSON.parse(d); resolve(j?.data?.markdown ? String(j.data.markdown).slice(0, 12000) : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(data); req.end();
  });
}

async function _extractIssues(markdown, archiveUrl) {
  if (!_hasOpenAI() || !markdown) return [];
  const prompt = `From this newsletter archive page (${archiveUrl}), extract the most recent 10 newsletter issues. For each return: subject (exact subject line), sent_date (if shown, ISO or "X days ago"), preview (1 sentence if available), url (link to issue if available). Reply strict JSON: {"issues":[{...}]}. Never invent.\n\nPage content:\n${markdown}`;
  return await new Promise(resolve => {
    const body = JSON.stringify({
      model:'gpt-4o-mini', temperature:0.1, max_tokens:1500,
      response_format:{ type:'json_object' },
      messages:[{ role:'system', content:'You extract structured data from newsletter archive pages. Strict JSON only.' },
                { role:'user', content: prompt }]
    });
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try { const j = JSON.parse(d); const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}'); resolve(parsed.issues || []); }
        catch { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(25000, () => { req.destroy(); resolve([]); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => res.json({ ok:true, firecrawl: _hasFirecrawl(), openai: _hasOpenAI(), db: _db.hasDb && _db.hasDb() }));

router.get('/targets', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, targets:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'newsletter:targets' });
  const r = await _db.getPool().query('SELECT * FROM newsletter_targets WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
  res.json({ ok:true, targets: r.rows });
}));

router.post('/targets', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const brand = String(req.body?.brand || '').trim();
  const newsletter_name = String(req.body?.newsletter_name || '').trim();
  const archive_url = String(req.body?.archive_url || '').trim();
  if (!brand || !newsletter_name || !archive_url) return _err(res, 400, 'brand, newsletter_name, archive_url required');
  if (!/^https?:\/\//i.test(archive_url)) return _err(res, 400, 'archive_url must be a valid http(s) URL');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'newsletter:target-create' });
  const r = await _db.getPool().query(
    `INSERT INTO newsletter_targets (tenant_id, brand, newsletter_name, archive_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (brand, archive_url) DO UPDATE SET newsletter_name=EXCLUDED.newsletter_name RETURNING *`,
    [tid, brand, newsletter_name, archive_url]
  );
  res.json({ ok:true, target: r.rows[0] });
}));

router.delete('/targets/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'newsletter:target-delete' });
  await _db.getPool().query('DELETE FROM newsletter_targets WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id, 10), tid]);
  res.json({ ok:true });
}));

router.post('/scan/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  if (!_hasFirecrawl()) return _err(res, 400, 'FIRECRAWL_API_KEY required for newsletter scans');
  const id = parseInt(req.params.id, 10);
  if (_scanLocks.has(id)) return _err(res, 409, 'A scan is already in progress for this newsletter — wait for it to finish');
  _scanLocks.add(id);
  try {
    const t = await _db.getPool().query('SELECT * FROM newsletter_targets WHERE id=$1', [id]);
    if (!t.rows.length) return _err(res, 404, 'target not found');
    const target = t.rows[0];
    const md = await _firecrawlScrape(target.archive_url);
    if (!md) return _err(res, 502, 'Firecrawl scrape failed — check the archive URL is publicly accessible');
    const issues = await _extractIssues(md, target.archive_url);
    for (const iss of issues) {
      try { await _db.getPool().query(
        'INSERT INTO newsletter_issues (tenant_id, target_id, subject, sent_date, preview, url) VALUES ($1,$2,$3,$4,$5,$6)',
        [target.tenant_id, id, String(iss.subject||'').slice(0,500), String(iss.sent_date||'').slice(0,100), String(iss.preview||'').slice(0,500), String(iss.url||'').slice(0,500)]
      ); } catch(_) {}
    }
    await _db.getPool().query('UPDATE newsletter_targets SET last_scanned_at=now() WHERE id=$1', [id]);
    res.json({ ok:true, target, issues });
  } finally { _scanLocks.delete(id); }
}));

router.get('/history/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, issues:[] });
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'newsletter:history' });
  const r = await _db.getPool().query('SELECT * FROM newsletter_issues WHERE target_id=$1 AND tenant_id=$2 ORDER BY captured_at DESC LIMIT 50', [parseInt(req.params.id, 10), tid]);
  res.json({ ok:true, issues: r.rows });
}));

module.exports = router;

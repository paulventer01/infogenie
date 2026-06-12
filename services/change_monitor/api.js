const express  = require('express');
const _https   = require('https');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({ model: opts.model || 'gpt-4o-mini', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature: opts.temperature ?? 0.5, max_tokens: opts.max_tokens || 1000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _firecrawlFetch(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const body = JSON.stringify({ url, formats:['markdown'], onlyMainContent: true });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); resolve(j.data?.markdown || j.markdown || null); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(30000,()=>req.destroy()); req.write(body); req.end();
  });
}

function _textDiff(a, b) {
  if (!a) return 100;
  const aWords = new Set(a.toLowerCase().split(/\s+/).filter(w=>w.length>3));
  const bWords = new Set(b.toLowerCase().split(/\s+/).filter(w=>w.length>3));
  const added   = [...bWords].filter(w=>!aWords.has(w)).length;
  const removed = [...aWords].filter(w=>!bWords.has(w)).length;
  return Math.round(((added + removed) / Math.max(aWords.size, bWords.size, 1)) * 100);
}

async function _analyseChange(oldSnap, newSnap, url, label) {
  const sys = `You are a competitive intelligence analyst. The user watches a competitor's web page for strategic changes. Analyse the difference between old and new page content and return JSON:
{"summary":"<2-3 sentence plain English of what changed>","strategic_insight":"<why this matters competitively and what to do>","change_type":"<pricing|features|messaging|design|content|other>","severity":"<low|medium|high>"}`;
  const user = `URL: ${url}\nLabel: ${label||url}\n\nOLD CONTENT (excerpt):\n${(oldSnap||'').slice(0,1500)}\n\nNEW CONTENT (excerpt):\n${newSnap.slice(0,1500)}`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:user}], { json:true, max_tokens:500 });
  if (!raw) return { summary:'Page content changed.', strategic_insight:'Review the new content manually.', change_type:'other', severity:'medium' };
  try { return JSON.parse(raw); } catch { return { summary:'Page content changed.', strategic_insight:'Review manually.', change_type:'other', severity:'medium' }; }
}

router.get('/watches', async (req, res) => {
  const tid = await _tid(req,'cm:list'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT w.*, (SELECT COUNT(*) FROM change_monitor_diffs d WHERE d.watch_id=w.id) AS diff_count FROM change_monitor_watches w WHERE w.tenant_id=$1 ORDER BY w.created_at DESC`, [tid]);
  res.json({ ok:true, watches: rows.rows });
});

router.post('/watches', async (req, res) => {
  const tid = await _tid(req,'cm:add'); if (!tid) return _err(res,400,'no_tenant');
  const { url, label, check_interval_hours=6, alert_email=true, alert_slack=false } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return _err(res,400,'invalid_url');
  const p = await _db.getPool();
  const r = await p.query(`INSERT INTO change_monitor_watches(tenant_id,url,label,check_interval_hours,alert_email,alert_slack) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tid, url.slice(0,1000), (label||url).slice(0,200), Number(check_interval_hours)||6, !!alert_email, !!alert_slack]);
  res.json({ ok:true, watch: r.rows[0] });
});

router.delete('/watches/:id', async (req, res) => {
  const tid = await _tid(req,'cm:del'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  await p.query(`DELETE FROM change_monitor_watches WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

router.post('/watches/:id/pause', async (req, res) => {
  const tid = await _tid(req,'cm:pause'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const w = await p.query(`SELECT * FROM change_monitor_watches WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!w.rows.length) return _err(res,404,'not_found');
  const newStatus = w.rows[0].status === 'active' ? 'paused' : 'active';
  await p.query(`UPDATE change_monitor_watches SET status=$1 WHERE id=$2`, [newStatus, req.params.id]);
  res.json({ ok:true, status: newStatus });
});

router.post('/check/:id', async (req, res) => {
  const tid = await _tid(req,'cm:check'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const wr = await p.query(`SELECT * FROM change_monitor_watches WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!wr.rows.length) return _err(res,404,'not_found');
  const watch = wr.rows[0];
  const newSnap = await _firecrawlFetch(watch.url);
  if (!newSnap) return res.json({ ok:false, error:'Could not fetch page — Firecrawl API key required or page unreachable.' });
  const pctChange = _textDiff(watch.last_snapshot, newSnap);
  let diff = null;
  if (pctChange >= 5 && watch.last_snapshot) {
    const analysis = await _analyseChange(watch.last_snapshot, newSnap, watch.url, watch.label);
    const dr = await p.query(`INSERT INTO change_monitor_diffs(watch_id,tenant_id,diff_summary,strategic_insight,old_snapshot_len,new_snapshot_len) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [watch.id, tid, analysis.summary, analysis.strategic_insight, (watch.last_snapshot||'').length, newSnap.length]);
    diff = { ...dr.rows[0], change_type: analysis.change_type, severity: analysis.severity, pct_change: pctChange };
  }
  await p.query(`UPDATE change_monitor_watches SET last_snapshot=$1, last_checked=NOW(), last_changed=${pctChange>=5?'NOW()':'last_changed'} WHERE id=$2`,
    [newSnap.slice(0,50000), watch.id]);
  res.json({ ok:true, pct_change: pctChange, changed: pctChange >= 5, diff, first_check: !watch.last_snapshot });
});

router.get('/diffs/:watchId', async (req, res) => {
  const tid = await _tid(req,'cm:diffs'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM change_monitor_diffs WHERE watch_id=$1 AND tenant_id=$2 ORDER BY detected_at DESC LIMIT 50`, [req.params.watchId, tid]);
  res.json({ ok:true, diffs: rows.rows });
});

module.exports = router;

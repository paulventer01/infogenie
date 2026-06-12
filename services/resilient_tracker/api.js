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
  const body = JSON.stringify({ model:'gpt-4o-mini', messages, response_format: opts.json ? { type:'json_object' } : undefined, temperature:0.2, max_tokens:opts.max_tokens||1000 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { if (r.statusCode!==200) return resolve(null); const j=JSON.parse(d); resolve(j.choices[0].message.content); } catch { resolve(null); } });
    });
    req.on('error',()=>resolve(null)); req.setTimeout(60000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _firecrawlFetch(url) {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok:false, source:'none', markdown:null };
  const body = JSON.stringify({ url, formats:['markdown'], onlyMainContent:true });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.firecrawl.dev', path:'/v1/scrape', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); const md=j.data?.markdown||j.markdown||null; resolve({ ok:!!md, source:'firecrawl', markdown:md }); } catch { resolve({ ok:false, source:'firecrawl', markdown:null }); } });
    });
    req.on('error',()=>resolve({ ok:false, source:'firecrawl', markdown:null })); req.setTimeout(30000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _perplexityFetch(url, dataPoints) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return { ok:false, source:'perplexity', data:{} };
  const dpStr = dataPoints.map(d=>`- ${d.key}: ${d.description}`).join('\n');
  const body = JSON.stringify({ model:'sonar', messages:[{ role:'user', content:`Visit ${url} and extract these data points:\n${dpStr}\nReturn JSON: {${dataPoints.map(d=>`"${d.key}":"<value>"`).join(',')}}` }], temperature:0.1, max_tokens:800 });
  return new Promise(resolve => {
    const req = _https.request({ hostname:'api.perplexity.ai', path:'/chat/completions', method:'POST', headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) } }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try { const j=JSON.parse(d); const txt=j.choices?.[0]?.message?.content||''; const m=txt.match(/\{[\s\S]*?\}/); if (!m) return resolve({ ok:false, source:'perplexity', data:{} }); resolve({ ok:true, source:'perplexity', data:JSON.parse(m[0]) }); } catch { resolve({ ok:false, source:'perplexity', data:{} }); } });
    });
    req.on('error',()=>resolve({ ok:false, source:'perplexity', data:{} })); req.setTimeout(45000,()=>req.destroy()); req.write(body); req.end();
  });
}

async function _extractDataPoints(markdown, dataPoints) {
  const dpStr = dataPoints.map(d=>`"${d.key}": <${d.description}>`).join(', ');
  const sys = `Extract specific data points from this webpage content. Return strict JSON: {${dpStr}}. Use null for any value not found on the page.`;
  const raw = await _openai([{role:'system',content:sys},{role:'user',content:markdown.slice(0,6000)}], { json:true, max_tokens:600 });
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function _runTrackerCheck(tracker) {
  let result = await _firecrawlFetch(tracker.url);
  let method = 'firecrawl';
  let data = {};
  if (result.ok && result.markdown) {
    data = await _extractDataPoints(result.markdown, tracker.data_points || []);
    method = 'firecrawl+gpt';
  } else {
    const pr = await _perplexityFetch(tracker.url, tracker.data_points || []);
    if (pr.ok) { data = pr.data; method = 'perplexity'; }
    else { return { ok:false, method:'all_failed', data:{} }; }
  }
  return { ok:true, method, data };
}

router.get('/trackers', async (req, res) => {
  const tid = await _tid(req,'rt:list'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM resilient_trackers WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok:true, trackers: rows.rows });
});

router.post('/trackers', async (req, res) => {
  const tid = await _tid(req,'rt:add'); if (!tid) return _err(res,400,'no_tenant');
  const { url, label, data_points=[] } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) return _err(res,400,'invalid_url');
  const p = await _db.getPool();
  const r = await p.query(`INSERT INTO resilient_trackers(tenant_id,url,label,data_points) VALUES($1,$2,$3,$4) RETURNING *`,
    [tid, url.slice(0,500), (label||url).slice(0,200), JSON.stringify((Array.isArray(data_points)?data_points:[]).slice(0,20))]);
  res.json({ ok:true, tracker: r.rows[0] });
});

router.delete('/trackers/:id', async (req, res) => {
  const tid = await _tid(req,'rt:del'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  await p.query(`DELETE FROM resilient_trackers WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok:true });
});

router.post('/check/:id', async (req, res) => {
  const tid = await _tid(req,'rt:check'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const tr = await p.query(`SELECT * FROM resilient_trackers WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!tr.rows.length) return _err(res,404,'not_found');
  const tracker = tr.rows[0];
  const result = await _runTrackerCheck(tracker);
  if (result.ok) {
    await p.query(`UPDATE resilient_trackers SET last_data=$1, last_method=$2, last_checked=NOW(), consecutive_failures=0 WHERE id=$3`, [JSON.stringify(result.data), result.method, tracker.id]);
    await p.query(`INSERT INTO resilient_tracker_snapshots(tracker_id,tenant_id,data,method,success) VALUES($1,$2,$3,$4,TRUE)`, [tracker.id, tid, JSON.stringify(result.data), result.method]);
    res.json({ ok:true, method:result.method, data:result.data });
  } else {
    await p.query(`UPDATE resilient_trackers SET last_checked=NOW(), consecutive_failures=consecutive_failures+1 WHERE id=$1`, [tracker.id]);
    res.json({ ok:false, error:'All extraction methods failed. The page may require login or is blocking scrapers.', method:result.method });
  }
});

router.get('/snapshots/:trackerId', async (req, res) => {
  const tid = await _tid(req,'rt:snaps'); if (!tid) return _err(res,400,'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM resilient_tracker_snapshots WHERE tracker_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 30`, [req.params.trackerId, tid]);
  res.json({ ok:true, snapshots: rows.rows });
});

module.exports = router;

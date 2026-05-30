// Site-search analytics — captures internal-search queries from the new
// "search" block in Site Builder pages, flags zero-result queries, and
// surfaces them as content-gap signals in the dashboard.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

async function _tid(req, label) { return await _tenantCtx.resolveTenantId(req, { label }); }

async function ensureSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS site_search_events (
      id SERIAL PRIMARY KEY,
      page_slug TEXT NOT NULL,
      query TEXT NOT NULL,
      result_count INT NOT NULL DEFAULT 0,
      session_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sse_page ON site_search_events(page_slug, created_at DESC);
    CREATE INDEX IF NOT EXISTS sse_query ON site_search_events(LOWER(query));
  `);
}
ensureSchema().catch(e => console.error('[site-search] schema:', e.message));

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _normQuery(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200); }

// ─── PUBLIC: capture a search performed on a rendered Site Builder page ────
router.post('/event', express.json({ limit:'2kb' }), async (req, res) => {
  try {
    const { slug, query, resultCount = 0, sessionId } = req.body || {};
    if (typeof slug !== 'string' || !slug) return _err(res, 400, 'bad slug');
    const q = _normQuery(query);
    if (!q || q.length < 2) return res.json({ ok:true, ignored:true });
    const sid = String(sessionId || '').slice(0, 64) || null;
    if (!_db.hasDb()) return res.json({ ok:true, persisted:false });
    await _db.getPool().query(
      `INSERT INTO site_search_events (page_slug, query, result_count, session_id) VALUES ($1,$2,$3,$4)`,
      [slug, q, Math.max(0, Math.min(9999, Number(resultCount) || 0)), sid]
    );
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

// ─── DASHBOARD: top queries + zero-result queries ──────────────────────────
router.get('/insights/:slug?', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, top: [], zeroResults: [], total: 0 });
  try {
    const tid = await _tid(req, 'site-search:insights');
    const slug = req.params.slug || null;
    const filter = slug ? `WHERE tenant_id = $1 AND page_slug = $2` : `WHERE tenant_id = $1`;
    const args = slug ? [tid, slug] : [tid];
    const top = await _db.getPool().query(
      `SELECT query, COUNT(*)::int AS searches, AVG(result_count)::int AS avg_results,
              SUM(CASE WHEN result_count=0 THEN 1 ELSE 0 END)::int AS zero_hits
         FROM site_search_events ${filter}
         GROUP BY query ORDER BY searches DESC LIMIT 50`, args);
    const zr = await _db.getPool().query(
      `SELECT query, COUNT(*)::int AS searches FROM site_search_events
         ${filter} AND result_count = 0
         GROUP BY query ORDER BY searches DESC LIMIT 30`, args);
    const total = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM site_search_events ${filter}`, args);
    res.json({
      ok: true,
      total: total.rows[0].n,
      top: top.rows.map(r => ({ query: r.query, searches: r.searches, avgResults: r.avg_results, zeroHits: r.zero_hits })),
      zeroResults: zr.rows.map(r => ({ query: r.query, searches: r.searches })),
    });
  } catch (e) { _err(res, 500, e.message); }
});

// Inline snippet for the rendered "search" block on Site Builder pages.
// `targets` is a CSS selector pointing at the elements the search filters
// over (default: cards inside #search-results). Each card needs a data-
// search-text attribute; the snippet hides non-matching items and pings the
// API once per query (debounced 400 ms).
function snippet(slug) {
  const safeSlug = String(slug).replace(/[^a-zA-Z0-9_\-]/g, '');
  return `<script>(function(){try{
    var sid=localStorage.getItem('_ig_sid')||'';
    var input=document.getElementById('site-search-input');
    var results=document.getElementById('site-search-results');
    if(!input||!results)return;
    var items=results.querySelectorAll('[data-search-text]');
    var noHits=document.getElementById('site-search-empty');
    var t=null;
    function run(){
      var q=input.value.trim().toLowerCase();
      var n=0;
      items.forEach(function(el){
        var hay=(el.getAttribute('data-search-text')||el.textContent||'').toLowerCase();
        var match=!q||hay.indexOf(q)!==-1;
        el.style.display=match?'':'none';
        if(match)n++;
      });
      if(noHits)noHits.style.display=(q&&n===0)?'block':'none';
      if(!q)return;
      clearTimeout(t);
      t=setTimeout(function(){
        try{
          var body=JSON.stringify({slug:'${safeSlug}',query:q,resultCount:n,sessionId:sid});
          if(navigator.sendBeacon){navigator.sendBeacon('/api/site-search/event',new Blob([body],{type:'application/json'}));}
          else{fetch('/api/site-search/event',{method:'POST',headers:{'Content-Type':'application/json'},body:body,keepalive:true});}
        }catch(e){}
      },400);
    }
    input.addEventListener('input',run);
  }catch(e){}})();</script>`;
}
router.snippet = snippet;

module.exports = router;

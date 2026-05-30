// Scroll-depth tracker — captures 10/25/50/75/100 % scroll milestones on
// public Site Builder (/lp/:slug) and Link-in-Bio (/bio/:slug) pages.
// A tiny inline snippet on the rendered page POSTs each milestone once per
// session, and the dashboard surfaces drop-off rates so the user can see
// whether visitors are actually reading the AI-generated copy.
//
// Storage: per (page_type, slug, depth) row counter, incremented on each
// event. Sessions tracked in-memory (24h TTL) to dedupe.

const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');

const ALLOWED_DEPTHS = new Set([10, 25, 50, 75, 100]);
const ALLOWED_TYPES  = new Set(['lp', 'bio']);

async function ensureScrollSchema() {
  if (!_db.hasDb()) return;
  await _db.getPool().query(`
    CREATE TABLE IF NOT EXISTS scroll_events (
      id SERIAL PRIMARY KEY,
      page_type TEXT NOT NULL,
      page_slug TEXT NOT NULL,
      depth INT NOT NULL,
      session_id TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scroll_events_pg ON scroll_events(page_type, page_slug, depth);
    CREATE INDEX IF NOT EXISTS scroll_events_when ON scroll_events(created_at);
  `);
}
ensureScrollSchema().catch(e => console.error('[scroll-tracker] schema:', e.message));

// In-memory dedupe: never count the same (session, type, slug, depth) twice
const _seen = new Map(); // key -> ts
const _SEEN_TTL = 24 * 60 * 60 * 1000;
function _wasSeen(key) {
  const now = Date.now();
  // Lazy GC: keep map bounded
  if (_seen.size > 50_000) {
    for (const [k, t] of _seen) if (now - t > _SEEN_TTL) _seen.delete(k);
  }
  const t = _seen.get(key);
  if (t && now - t < _SEEN_TTL) return true;
  _seen.set(key, now);
  return false;
}

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

// ─── PUBLIC ingest (called from injected page snippet) ─────────────────────
router.post('/event', express.json({ limit:'2kb' }), async (req, res) => {
  try {
    const { type, slug, depth, sessionId } = req.body || {};
    if (!ALLOWED_TYPES.has(type)) return _err(res, 400, 'bad type');
    if (typeof slug !== 'string' || !slug || slug.length > 200) return _err(res, 400, 'bad slug');
    const d = Number(depth);
    if (!ALLOWED_DEPTHS.has(d)) return _err(res, 400, 'bad depth');
    const sid = String(sessionId || '').slice(0, 64) || 'anon_' + Math.random().toString(36).slice(2);
    const key = `${type}|${slug}|${d}|${sid}`;
    if (_wasSeen(key)) return res.json({ ok:true, deduped:true });
    if (!_db.hasDb()) return res.json({ ok:true, persisted:false });
    // Public ingest from a rendered page — no parent entity carries tenant_id,
    // so scope events to the default tenant (same convention as cron writers).
    const tid = await _tenantCtx.getDefaultTenantId();
    await _db.getPool().query(
      `INSERT INTO scroll_events (tenant_id, page_type, page_slug, depth, session_id, user_agent) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, type, slug, d, sid, String(req.headers['user-agent'] || '').slice(0, 300)]
    );
    res.json({ ok:true });
  } catch (e) { _err(res, 500, e.message); }
});

// ─── DASHBOARD: per-page funnel ─────────────────────────────────────────────
router.get('/page/:type/:slug', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, depths: {}, sessions: 0 });
  if (!ALLOWED_TYPES.has(req.params.type)) return _err(res, 400, 'bad type');
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'scroll-tracker:page' });
    const r = await _db.getPool().query(
      `SELECT depth, COUNT(*)::int AS hits, COUNT(DISTINCT session_id)::int AS sessions
         FROM scroll_events WHERE page_type=$1 AND page_slug=$2 AND tenant_id=$3 GROUP BY depth ORDER BY depth`,
      [req.params.type, req.params.slug, tid]
    );
    const depths = {};
    r.rows.forEach(row => { depths[row.depth] = { hits: row.hits, sessions: row.sessions }; });
    const top = depths[10]?.sessions || 0;
    const rd = (n) => top ? Math.round(((depths[n]?.sessions || 0) / top) * 100) : 0;
    res.json({
      ok: true,
      sessions: top,
      depths,
      readRate: { p25: rd(25), p50: rd(50), p75: rd(75), p100: rd(100) },
      hint: top < 5 ? 'Need more traffic for a reliable read — share the page first.' : null,
    });
  } catch (e) { _err(res, 500, e.message); }
});

// ─── DASHBOARD: leaderboard across all pages ────────────────────────────────
router.get('/summary', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, pages: [] });
  try {
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'scroll-tracker:summary' });
    const r = await _db.getPool().query(`
      WITH per AS (
        SELECT page_type, page_slug, depth, COUNT(DISTINCT session_id)::int AS sessions
          FROM scroll_events WHERE created_at > now() - interval '90 days' AND tenant_id = $1
          GROUP BY page_type, page_slug, depth
      )
      SELECT page_type, page_slug,
             COALESCE(MAX(sessions) FILTER (WHERE depth=10), 0)  AS s10,
             COALESCE(MAX(sessions) FILTER (WHERE depth=50), 0)  AS s50,
             COALESCE(MAX(sessions) FILTER (WHERE depth=100), 0) AS s100
        FROM per GROUP BY page_type, page_slug
        ORDER BY s10 DESC LIMIT 50
    `, [tid]);
    res.json({
      ok: true,
      pages: r.rows.map(row => ({
        type: row.page_type, slug: row.page_slug,
        sessions: row.s10,
        midReadPct: row.s10 ? Math.round(row.s50 * 100 / row.s10) : 0,
        fullReadPct: row.s10 ? Math.round(row.s100 * 100 / row.s10) : 0,
      })),
    });
  } catch (e) { _err(res, 500, e.message); }
});

// Inline JS snippet to embed inside rendered public pages.
function snippet(type, slug) {
  const safeSlug = String(slug).replace(/[^a-zA-Z0-9_\-]/g, '');
  return `<script>(function(){try{
    var sid=localStorage.getItem('_ig_sid'); if(!sid){sid='s_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);localStorage.setItem('_ig_sid',sid);}
    var sent={};var depths=[10,25,50,75,100];
    function pct(){var h=document.documentElement,b=document.body;var sh=Math.max(h.scrollHeight,b.scrollHeight)-window.innerHeight;if(sh<=0)return 100;return Math.round((window.scrollY||window.pageYOffset)*100/sh);}
    function fire(d){if(sent[d])return;sent[d]=1;try{var blob=new Blob([JSON.stringify({type:'${type}',slug:'${safeSlug}',depth:d,sessionId:sid})],{type:'application/json'});if(navigator.sendBeacon)navigator.sendBeacon('/api/scroll-tracker/event',blob);else fetch('/api/scroll-tracker/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'${type}',slug:'${safeSlug}',depth:d,sessionId:sid}),keepalive:true});}catch(e){}}
    function check(){var p=pct();depths.forEach(function(d){if(p>=d)fire(d);});}
    setTimeout(function(){fire(10);},1500);
    window.addEventListener('scroll',check,{passive:true});
    window.addEventListener('beforeunload',check);
  }catch(e){}})();</script>`;
}
router.snippet = snippet;

module.exports = router;

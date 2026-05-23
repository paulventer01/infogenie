const express = require('express');
const _https = require('https');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _safe(h) { return (req, res) => Promise.resolve(h(req, res)).catch(e => { console.warn('[ad-swipe]', e.message); if (!res.headersSent) _err(res, 500, 'Internal server error'); }); }

async function _openaiJson(messages, maxTokens=600) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const body = JSON.stringify({ model:'gpt-4o-mini', messages, response_format:{type:'json_object'}, temperature:0.4, max_tokens:maxTokens });
  return await new Promise(resolve => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { if (r.statusCode !== 200) return resolve(null); const j = JSON.parse(d); resolve(JSON.parse(j.choices[0].message.content)); } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

router.post('/save', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:save' });
  if (!tid) return _err(res, 400, 'no_tenant');
  const b = req.body || {};
  const source = String(b.source || 'meta').slice(0, 32);
  const advertiser = String(b.advertiser || b.page_name || '').slice(0, 200);
  if (!advertiser) return _err(res, 400, 'advertiser required');
  const external_id = b.external_id ? String(b.external_id).slice(0, 120) : null;
  const headline = String(b.headline || b.title || '').slice(0, 500);
  const body = String(b.body || '').slice(0, 4000);
  const cta = String(b.cta || b.description || '').slice(0, 200);
  let snapshot_url = String(b.snapshot_url || '').slice(0, 2000).trim();
  if (snapshot_url && !/^https?:\/\//i.test(snapshot_url)) snapshot_url = '';
  const platforms = Array.isArray(b.platforms) ? b.platforms.slice(0, 8) : [];
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 12).map(t => String(t).slice(0, 40)) : [];
  const notes = String(b.notes || '').slice(0, 1000);
  const score = Math.max(0, Math.min(10, parseInt(b.score, 10) || 0));
  try {
    // Atomic upsert on the partial unique index ad_swipe_tenant_source_extid_uidx
    // (Phase 2B). Partial-index ON CONFLICT must restate the WHERE clause.
    const r = await _db.getPool().query(
      `INSERT INTO ad_swipe (tenant_id, source, external_id, advertiser, headline, body, cta, snapshot_url, platforms, tags, notes, score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, source, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         advertiser=EXCLUDED.advertiser, headline=EXCLUDED.headline, body=EXCLUDED.body,
         cta=EXCLUDED.cta, snapshot_url=EXCLUDED.snapshot_url, platforms=EXCLUDED.platforms,
         tags=EXCLUDED.tags, notes=EXCLUDED.notes, score=EXCLUDED.score
       RETURNING id, saved_at`,
      [tid, source, external_id, advertiser, headline, body, cta, snapshot_url,
       JSON.stringify(platforms), JSON.stringify(tags), notes, score]);
    res.json({ ok:true, id: r.rows[0].id, saved_at: r.rows[0].saved_at });
  } catch (e) { _err(res, 500, e.message); }
}));

router.get('/list', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, items: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:list' });
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const tag = req.query.tag ? String(req.query.tag).slice(0, 40) : null;
  const advertiser = req.query.advertiser ? String(req.query.advertiser).slice(0, 200) : null;
  let sql = `SELECT id, source, external_id, advertiser, headline, body, cta, snapshot_url, platforms, tags, notes, score, saved_at FROM ad_swipe WHERE tenant_id=$1`;
  const params = [tid];
  if (advertiser) { params.push(advertiser); sql += ` AND advertiser ILIKE '%' || $${params.length} || '%'`; }
  if (tag)        { params.push(JSON.stringify([tag])); sql += ` AND tags @> $${params.length}::jsonb`; }
  params.push(limit);
  sql += ` ORDER BY score DESC, saved_at DESC LIMIT $${params.length}`;
  const r = await _db.getPool().query(sql, params);
  res.json({ ok:true, items: r.rows });
}));

router.post('/:id/update', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:update' });
  const b = req.body || {};
  const tags = Array.isArray(b.tags) ? b.tags.slice(0, 12).map(t => String(t).slice(0, 40)) : null;
  const notes = b.notes !== undefined ? String(b.notes).slice(0, 1000) : null;
  const score = b.score !== undefined ? Math.max(0, Math.min(10, parseInt(b.score, 10) || 0)) : null;
  const sets = []; const params = [];
  if (tags !== null)  { params.push(JSON.stringify(tags));  sets.push(`tags=$${params.length}::jsonb`); }
  if (notes !== null) { params.push(notes);  sets.push(`notes=$${params.length}`); }
  if (score !== null) { params.push(score);  sets.push(`score=$${params.length}`); }
  if (!sets.length) return _err(res, 400, 'nothing to update');
  params.push(id, tid);
  await _db.getPool().query(
    `UPDATE ad_swipe SET ${sets.join(', ')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`, params);
  res.json({ ok:true });
}));

router.delete('/:id', _safe(async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'database unavailable');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'invalid id');
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:delete' });
  await _db.getPool().query('DELETE FROM ad_swipe WHERE id=$1 AND tenant_id=$2', [id, tid]);
  res.json({ ok:true });
}));

router.get('/tags', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, tags: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:tags' });
  const r = await _db.getPool().query(
    `SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM ad_swipe WHERE tenant_id=$1 ORDER BY tag`, [tid]);
  res.json({ ok:true, tags: r.rows.map(x => x.tag) });
}));

router.get('/advertisers', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok:true, advertisers: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:advertisers' });
  const r = await _db.getPool().query(
    `SELECT advertiser, COUNT(*)::int AS n FROM ad_swipe WHERE tenant_id=$1
     GROUP BY advertiser ORDER BY n DESC, advertiser ASC LIMIT 100`, [tid]);
  res.json({ ok:true, advertisers: r.rows });
}));

router.post('/suggest-tags', _safe(async (req, res) => {
  if (!_db.hasDb()) return res.status(503).json({ ok:false, error:'database unavailable', suggestions: [], existing: [] });
  const tid = await _tenantCtx.resolveTenantId(req, { label:'ad_swipe:suggest-tags' });
  const body = req.body || {};
  let items = [];
  let existing = [];
  try {
    const r = await _db.getPool().query(
      `SELECT advertiser, headline, body, tags FROM ad_swipe WHERE tenant_id=$1 ORDER BY saved_at DESC LIMIT 60`, [tid]);
    items = r.rows || [];
    const tagsRow = await _db.getPool().query(
      `SELECT DISTINCT jsonb_array_elements_text(tags) AS tag FROM ad_swipe WHERE tenant_id=$1`, [tid]);
    existing = tagsRow.rows.map(x => x.tag).filter(Boolean);
  } catch (e) {
    return res.status(500).json({ ok:false, error:'DB query failed: '+e.message, suggestions: [], existing: [] });
  }

  if (!items.length) {
    const brand = String(body.brand || '').slice(0, 80);
    const competitors = Array.isArray(body.competitors) ? body.competitors.slice(0, 8).map(s=>String(s).slice(0,60)) : [];
    const fallbackOut = await _openaiJson([
      { role:'system', content:
        'You are a marketing strategist. The user just opened their Ad Swipe File for the first time and has NOT saved any competitor ads yet. Propose 10 useful SHORT filter tags (1-3 words each, lowercase, no punctuation) they will likely need once they start saving ads: cover angle (social proof, scarcity, fomo, problem-solution), format (ugc video, carousel, static, motion graphic), offer (free trial, discount, lead magnet), audience (smb, creators, enterprise), funnel stage (awareness, consideration, conversion). Return strict JSON: {"suggestions":[{"tag":"social proof","why":"<one short reason this matters for the user\'s brand>"}, …]}' },
      { role:'user', content: `BRAND: ${brand || '(unknown)'}\nKNOWN_COMPETITORS: ${competitors.join(', ') || '(none yet)'}` },
    ], 600);
    if (fallbackOut && Array.isArray(fallbackOut.suggestions) && fallbackOut.suggestions.length) {
      const clean = fallbackOut.suggestions
        .map(s => ({ tag: String(s.tag||'').toLowerCase().replace(/[^a-z0-9 \-]/g,'').trim().slice(0,40), why: String(s.why||'').slice(0,140) }))
        .filter(s => s.tag && s.tag.length >= 2);
      return res.json({ ok:true, suggestions: clean, existing: [], source:'brand_context', note:'Swipe file is empty — these are starter tags. Save some ads and click 🤖 AI Suggest again for tags tailored to your library.' });
    }
    const starter = [
      { tag:'social proof',   why:'Testimonials, reviews, customer counts.' },
      { tag:'scarcity',       why:'Limited time / limited stock urgency.' },
      { tag:'ugc video',      why:'User-generated short videos perform on Meta/TikTok.' },
      { tag:'carousel',       why:'Multi-image swipe format.' },
      { tag:'free trial',     why:'Frictionless trial offers.' },
      { tag:'discount',       why:'Price-led promos.' },
      { tag:'awareness',      why:'Top-of-funnel education.' },
      { tag:'conversion',     why:'Bottom-of-funnel direct response.' },
      { tag:'problem solution', why:'Pain-point led copy.' },
      { tag:'fomo',           why:'Fear-of-missing-out angles.' },
    ];
    return res.json({ ok:true, suggestions: starter, existing: [], source:'starter', note:'Swipe file is empty + no AI key — starter tags shown. Save some ads and connect an LLM for tailored suggestions.' });
  }

  const snippet = items.slice(0, 30).map((a, i) =>
    `${i+1}. ${a.advertiser} | ${a.headline||''} | ${(a.body||'').slice(0,160)}`
  ).join('\n');
  const out = await _openaiJson([
    { role:'system', content:
      'You are a marketing strategist. Look at the user\'s saved competitor ads and propose 8-12 SHORT filter tags (1-3 words each, lowercase, no punctuation) that group these ads by useful axes: angle (e.g. "social proof", "scarcity"), format (e.g. "ugc video", "carousel"), offer (e.g. "free trial", "discount"), audience (e.g. "smb", "creators"), funnel stage. Re-use any tag from EXISTING_TAGS when it fits. Return strict JSON: {"suggestions":[{"tag":"social proof","why":"<one short reason this groups several saved ads>"}, …]}'
    },
    { role:'user', content: `EXISTING_TAGS: ${existing.join(', ') || '(none yet)'}\n\nSAVED_ADS (${items.length}):\n${snippet}` },
  ], 600);
  if (!out || !Array.isArray(out.suggestions)) return res.status(502).json({ ok:false, error:'AI tag suggestions unavailable — set OPENAI key or add tags manually.', suggestions: [], existing });
  const clean = out.suggestions
    .map(s => ({ tag: String(s.tag||'').toLowerCase().replace(/[^a-z0-9 \-]/g,'').trim().slice(0,40), why: String(s.why||'').slice(0,140) }))
    .filter(s => s.tag && s.tag.length >= 2);
  res.json({ ok:true, suggestions: clean, existing, source:'saved_ads' });
}));

module.exports = router;

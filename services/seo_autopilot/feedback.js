'use strict';

/**
 * Environment feedback for SEO autopilot — closes the autonomous loop.
 * Sources: prior runs, SERP rankings, GSC queries, opportunity scores.
 * Fail-open to demo/heuristic scores when live data unavailable.
 */

const _db = require('../../db');
const store = require('./store');

function _norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function _scoreFromRun(run) {
  if (!run) return 50;
  if (run.status === 'ok') return 72;
  if (run.status === 'publish_failed') return 28;
  if (run.status === 'error') return 20;
  return 45;
}

async function _serpForKeywords(tid, keywords) {
  if (!_db.hasDb() || !keywords.length) return [];
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT keyword, position, prev_position, url, checked_at
       FROM serp_rankings
       WHERE tenant_id=$1 AND checked_at > NOW() - INTERVAL '30 days'
       ORDER BY checked_at DESC LIMIT 200`,
      [tid],
    );
    const want = new Set(keywords.map(_norm));
    const best = new Map();
    for (const row of r.rows) {
      const k = _norm(row.keyword);
      if (!want.has(k) && ![...want].some((w) => k.includes(w) || w.includes(k))) continue;
      if (!best.has(k)) best.set(k, row);
    }
    return [...best.values()];
  } catch {
    return [];
  }
}

async function _gscForDomain(domain) {
  const host = String(domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!host) return { ok: false, rows: [], configured: false };
  try {
    const { hasGscCredentials, listSites, querySearchAnalytics } = require('../gsc_social_search/client');
    if (!hasGscCredentials()) return { ok: false, rows: [], configured: false };
    let siteUrl = process.env.GSC_SITE_URL || `https://${host}/`;
    const sites = await listSites();
    if (sites.sites?.length) {
      const match = sites.sites.find((s) => String(s.siteUrl || '').includes(host));
      if (match) siteUrl = match.siteUrl;
    }
    const q = await querySearchAnalytics({
      siteUrl,
      days: 28,
      dimensions: ['query'],
      rowLimit: 100,
    });
    return { ok: !!q.ok, configured: true, siteUrl, rows: q.rows || [], error: q.error };
  } catch (e) {
    return { ok: false, rows: [], configured: true, error: e.message };
  }
}

function _matchGsc(rows, keyword) {
  const k = _norm(keyword);
  if (!k) return null;
  let best = null;
  for (const row of rows) {
    const q = _norm((row.keys && row.keys[0]) || '');
    if (!q) continue;
    if (q === k || q.includes(k) || k.includes(q)) {
      if (!best || (row.clicks || 0) > (best.clicks || 0)) best = { ...row, query: q };
    }
  }
  return best;
}

/**
 * @returns {{ ok:boolean, winners:array, losers:array, keyword_scores:object, summary:string, sources:string[], demo?:boolean }}
 */
async function gatherEnvironmentFeedback(tenantId, plan = null) {
  const p = plan || (await store.getPlan(tenantId)) || {};
  const keywords = (p.keywords || []).map((k) => (typeof k === 'string' ? { keyword: k } : k));
  const kwList = keywords.map((k) => k.keyword).filter(Boolean);
  const runs = await store.listRuns(tenantId, 40);
  const serp = await _serpForKeywords(tenantId, kwList);
  const gsc = await _gscForDomain(p.domain);

  const sources = ['runs'];
  if (serp.length) sources.push('serp');
  if (gsc.ok && gsc.rows.length) sources.push('gsc');

  const keyword_scores = {};
  for (const k of keywords) {
    const key = k.keyword;
    if (!key) continue;
    let score = 50;
    const reasons = [];

    if (k.opportunity_score != null) {
      score += (Number(k.opportunity_score) - 50) * 0.25;
      reasons.push(`opportunity ${k.opportunity_score}`);
    }
    if (k.difficulty != null && Number(k.difficulty) > 60) {
      score -= 8;
      reasons.push(`hard difficulty ${k.difficulty}`);
    }

    const relatedRuns = runs.filter((r) => _norm(r.keyword) === _norm(key) || _norm(r.title || '').includes(_norm(key)));
    if (relatedRuns.length) {
      const avg = relatedRuns.reduce((s, r) => s + _scoreFromRun(r), 0) / relatedRuns.length;
      score = score * 0.45 + avg * 0.55;
      reasons.push(`${relatedRuns.length} run(s) avg ${Math.round(avg)}`);
    }

    const serpRow = serp.find((s) => _norm(s.keyword) === _norm(key) || _norm(s.keyword).includes(_norm(key)));
    if (serpRow) {
      const pos = Number(serpRow.position) || 100;
      const prev = serpRow.prev_position != null ? Number(serpRow.prev_position) : null;
      if (pos <= 10) { score += 18; reasons.push(`SERP #${pos}`); }
      else if (pos <= 20) { score += 8; reasons.push(`SERP #${pos}`); }
      else { score -= 10; reasons.push(`SERP #${pos}`); }
      if (prev != null && prev - pos >= 3) { score += 10; reasons.push('ranking up'); }
      if (prev != null && pos - prev >= 3) { score -= 12; reasons.push('ranking down'); }
    }

    const gscRow = gsc.ok ? _matchGsc(gsc.rows, key) : null;
    if (gscRow) {
      if ((gscRow.clicks || 0) >= 5) { score += 16; reasons.push(`${gscRow.clicks} GSC clicks`); }
      else if ((gscRow.impressions || 0) >= 50) { score += 8; reasons.push(`${gscRow.impressions} impressions`); }
      else if ((gscRow.impressions || 0) < 10 && gscRow.position > 30) { score -= 8; reasons.push('low GSC visibility'); }
    }

    // Failed publish for this keyword recently
    if (relatedRuns.some((r) => r.status !== 'ok')) {
      score -= 15;
      reasons.push('recent publish/error issues');
    }

    keyword_scores[key] = {
      score: Math.round(Math.max(0, Math.min(100, score))),
      reasons,
      opportunity_score: k.opportunity_score,
    };
  }

  // Also score calendar keywords not in keyword list
  for (const c of p.calendar || []) {
    if (!c.keyword || keyword_scores[c.keyword]) continue;
    const relatedRuns = runs.filter((r) => _norm(r.keyword) === _norm(c.keyword));
    let score = c.status === 'failed' ? 25 : 50;
    if (relatedRuns.length) score = relatedRuns.reduce((s, r) => s + _scoreFromRun(r), 0) / relatedRuns.length;
    keyword_scores[c.keyword] = { score: Math.round(score), reasons: ['calendar item'], opportunity_score: null };
  }

  let ranked = Object.entries(keyword_scores)
    .map(([keyword, v]) => ({ keyword, ...v }))
    .sort((a, b) => b.score - a.score);

  let demo = false;
  if (!ranked.length) {
    demo = true;
    ranked = (kwList.length ? kwList : ['demo keyword']).slice(0, 6).map((keyword, i) => ({
      keyword,
      score: 80 - i * 8,
      reasons: ['demo feedback — connect GSC/SERP for live scores'],
      opportunity_score: null,
    }));
    for (const r of ranked) keyword_scores[r.keyword] = r;
    sources.push('demo');
  }

  const winners = ranked.filter((r) => r.score >= 65).slice(0, 5);
  const losers = ranked.filter((r) => r.score <= 40).slice(0, 5);

  // If no clear losers but we have failed runs, mark those keywords
  if (!losers.length) {
    for (const r of runs.filter((x) => x.status !== 'ok').slice(0, 3)) {
      if (r.keyword && !losers.find((l) => l.keyword === r.keyword)) {
        losers.push({
          keyword: r.keyword,
          score: keyword_scores[r.keyword]?.score ?? 30,
          reasons: [r.error || r.status || 'failed run'],
        });
      }
    }
  }

  const summary = [
    winners.length ? `Double down: ${winners.map((w) => w.keyword).slice(0, 3).join(', ')}` : 'No clear winners yet',
    losers.length ? `Defer/skip: ${losers.map((l) => l.keyword).slice(0, 3).join(', ')}` : null,
    `Sources: ${sources.join(', ')}`,
  ].filter(Boolean).join(' · ');

  return {
    ok: true,
    winners,
    losers,
    keyword_scores,
    ranked,
    summary,
    sources,
    demo,
    gsc: { configured: !!gsc.configured, ok: !!gsc.ok, siteUrl: gsc.siteUrl || null, rows: (gsc.rows || []).length },
    serp_count: serp.length,
    runs_count: runs.length,
  };
}

module.exports = {
  gatherEnvironmentFeedback,
  _scoreFromRun,
  _matchGsc,
  _norm,
};

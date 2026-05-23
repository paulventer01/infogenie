const _db = require('../../db');
const _https = require('https');

async function _gatherStats(brand, tenantId) {
  const pool = _db.getPool();
  const since = "now() - interval '24 hours'";
  const stats = { brand, since: new Date(Date.now() - 86400000).toISOString() };
  // Guard: only accept finite numeric tenantId; otherwise null-scope (no filter).
  const tid = Number.isFinite(Number(tenantId)) && Number(tenantId) > 0 ? Number(tenantId) : null;
  const tidClause = tid ? ` AND tenant_id=${tid}` : '';

  // Crisis incidents in last 24h
  try {
    const r = await pool.query(
      `SELECT id, kind, severity, headline, detail, status, created_at
       FROM crisis_incidents WHERE brand=$1 AND created_at > ${since}${tidClause}
       ORDER BY severity DESC, created_at DESC LIMIT 10`, [brand]);
    stats.incidents = r.rows;
  } catch { stats.incidents = []; }

  // SoV
  try {
    const cur = await pool.query(
      `SELECT brand, SUM(mentions)::int AS m, SUM(neg_count)::int AS n
       FROM sov_snapshots WHERE target_brand=$1 AND taken_at > ${since}${tidClause}
       GROUP BY brand`, [brand]);
    const prev = await pool.query(
      `SELECT brand, SUM(mentions)::int AS m
       FROM sov_snapshots WHERE target_brand=$1
         AND taken_at > now() - interval '48 hours'
         AND taken_at <= ${since}${tidClause}
       GROUP BY brand`, [brand]);
    const prevMap = new Map(prev.rows.map(r => [r.brand, r.m]));
    const tot = cur.rows.reduce((s, r) => s + r.m, 0) || 1;
    stats.sov = cur.rows.map(r => ({
      brand: r.brand, mentions: r.m, neg: r.n,
      share: r.m / tot,
      delta_pct: prevMap.has(r.brand) && prevMap.get(r.brand) > 0
        ? (r.m - prevMap.get(r.brand)) / prevMap.get(r.brand)
        : null,
    })).sort((a, b) => b.mentions - a.mentions);
  } catch { stats.sov = []; }

  // Trending topics
  try {
    const r = await pool.query(
      `SELECT category, country, topics FROM trend_runs
       WHERE ran_at > ${since}${tidClause} ORDER BY ran_at DESC LIMIT 3`);
    stats.trends = r.rows.flatMap(row => (row.topics || []).slice(0, 3).map(t => ({
      ...t, category: row.category, country: row.country,
    }))).slice(0, 6);
  } catch { stats.trends = []; }

  // New battle cards
  try {
    const r = await pool.query(
      `SELECT competitor, summary, created_at FROM battle_cards
       WHERE brand=$1 AND created_at > ${since}${tidClause}
       ORDER BY created_at DESC LIMIT 5`, [brand]);
    stats.new_battle_cards = r.rows;
  } catch { stats.new_battle_cards = []; }

  // New influencers
  try {
    const r = await pool.query(
      `SELECT handle, platform, followers, status FROM influencers
       WHERE created_at > ${since}${tidClause} ORDER BY created_at DESC LIMIT 8`);
    stats.new_influencers = r.rows;
  } catch { stats.new_influencers = []; }

  return stats;
}

async function _aiSummary(stats) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;
  const sys = `You are a marketing intelligence analyst writing the daily executive digest for the user's marketing team. Output strict JSON with this shape:
{"headline":"one-line punchy summary (max 100 chars)","summary_md":"2-3 paragraph markdown overview","sections":[{"title":"section name","kind":"highlight|warning|win|action","body":"1-3 sentence markdown"}],"recommended_actions":["action 1","action 2","action 3"]}
- headline: opens with brand name, ties together the most important signal of the last 24h.
- sections: 3-6 sections, prioritise crisis incidents (kind=warning) > sov shifts (highlight/win) > trending opportunities (action) > new intel (highlight).
- recommended_actions: 3-5 concrete next steps the marketing team should take today.
Be specific, grounded in the data, no fluff or filler.`;
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Brand: ${stats.brand}\nWindow: last 24h\n\nData:\n${JSON.stringify(stats, null, 2)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4, max_tokens: 1400,
  });
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try {
        if (r.statusCode !== 200) return resolve(null);
        const j = JSON.parse(d);
        resolve(JSON.parse(j.choices[0].message.content));
      } catch { resolve(null); }
    }); });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _templateSummary(stats) {
  const sections = [];
  const highSev = stats.incidents.filter(i => i.severity === 'high');
  if (highSev.length) sections.push({ title: 'Crisis Incidents', kind: 'warning',
    body: `${highSev.length} high-severity incident(s) opened in last 24h: ${highSev.map(i => i.headline).slice(0, 3).join('; ')}` });
  if (stats.sov.length) {
    const me = stats.sov.find(s => s.brand === stats.brand);
    if (me) sections.push({ title: 'Share of Voice', kind: me.delta_pct > 0 ? 'win' : 'highlight',
      body: `${stats.brand}: ${(me.share*100).toFixed(0)}% share (${me.mentions} mentions)${me.delta_pct != null ? `, ${me.delta_pct >= 0 ? '+' : ''}${(me.delta_pct*100).toFixed(0)}% vs prior 24h` : ''}.` });
  }
  if (stats.trends.length) sections.push({ title: 'Trending Topics', kind: 'action',
    body: `Top: ${stats.trends.slice(0, 3).map(t => t.title).join(' · ')}` });
  if (stats.new_battle_cards.length) sections.push({ title: 'New Battle Cards', kind: 'highlight',
    body: `${stats.new_battle_cards.length} new competitor card(s) generated.` });
  if (stats.new_influencers.length) sections.push({ title: 'Influencer Pipeline', kind: 'highlight',
    body: `${stats.new_influencers.length} new creator(s) added to CRM.` });

  const headline = highSev.length
    ? `⚠️ ${stats.brand}: ${highSev.length} crisis signal(s) need attention`
    : stats.sov.length
      ? `${stats.brand} digest — ${stats.sov.reduce((s, x) => s + x.mentions, 0)} mentions tracked`
      : `${stats.brand} daily digest — quiet 24h`;

  return {
    headline,
    summary_md: `**${stats.brand}** snapshot for the last 24 hours: ${stats.incidents.length} incident(s), ${stats.sov.length} brand(s) tracked, ${stats.trends.length} trending topic(s), ${stats.new_battle_cards.length} new battle card(s), ${stats.new_influencers.length} new creator(s) in pipeline.`,
    sections: sections.length ? sections : [{ title: 'Quiet Day', kind: 'highlight', body: 'No notable signals in the last 24 hours. Consider running fresh trend detection or refreshing battle cards.' }],
    recommended_actions: [
      highSev.length ? 'Triage high-severity crisis incidents in Crisis Radar' : 'Review Crisis Radar watchlist coverage',
      'Open Share of Voice tracker for week-over-week trend',
      stats.trends.length ? 'Pick a trending topic and draft content' : 'Run fresh trending-topic detection',
    ].filter(Boolean),
  };
}

async function generateDigest(brand, tenantId) {
  const b = String(brand || '').trim().slice(0, 80);
  if (!b) throw new Error('brand required');
  const stats = await _gatherStats(b, tenantId);
  let body = await _aiSummary(stats);
  let generated_by = 'openai';
  if (!body) { body = _templateSummary(stats); generated_by = 'template'; }
  const r = await _db.getPool().query(
    `INSERT INTO digest_runs (tenant_id, brand, headline, summary_md, sections, stats, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId || null, b, body.headline, body.summary_md, JSON.stringify(body.sections || []),
     JSON.stringify(stats), generated_by]);
  return { ...r.rows[0], recommended_actions: body.recommended_actions || [] };
}

module.exports = { generateDigest };

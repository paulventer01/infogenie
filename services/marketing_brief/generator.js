const _db   = require('../../db');
const _https = require('https');

// ── Signal gatherers (each wrapped in try/catch — missing tables = empty array) ──

async function _gatherSignals(pool, tid) {
  const since24h  = "NOW() - INTERVAL '24 hours'";
  const since7d   = "NOW() - INTERVAL '7 days'";
  const signals   = [];
  const activePillars = [];

  // 1 · Optimizer / ROAS
  try {
    const r = await pool.query(
      `SELECT name, channel, status, roas, daily_budget, optimizer_enabled
       FROM optimizer_campaigns
       WHERE tenant_id=$1 AND optimizer_enabled=TRUE
       ORDER BY roas ASC NULLS LAST LIMIT 10`, [tid]);
    if (r.rows.length) {
      activePillars.push('optimizer');
      const low = r.rows.filter(c => c.roas != null && c.roas < 1.5);
      const good = r.rows.filter(c => c.roas != null && c.roas >= 3);
      if (low.length)  signals.push({ kind:'warning',  pillar:'optimizer', headline:`${low.length} campaign${low.length>1?'s':''} with ROAS below 1.5×`, detail:`Underperforming: ${low.map(c=>c.name).slice(0,3).join(', ')}`, action_view:'optimizer', action_label:'Open AI Optimizer' });
      if (good.length) signals.push({ kind:'win',      pillar:'optimizer', headline:`${good.length} campaign${good.length>1?'s':''} hitting 3×+ ROAS`, detail:`Top performers: ${good.map(c=>c.name).slice(0,3).join(', ')}`, action_view:'optimizer', action_label:'View Optimizer' });
    }
  } catch { /* table may not exist */ }

  // 2 · SERP / keyword positions
  try {
    const r = await pool.query(
      `SELECT keyword, position, prev_position, url
       FROM serp_rankings
       WHERE tenant_id=$1 AND checked_at > ${since24h}
         AND prev_position IS NOT NULL
       ORDER BY (position - prev_position) DESC LIMIT 20`, [tid]);
    if (r.rows.length) {
      activePillars.push('serp');
      const lost  = r.rows.filter(x => x.position > x.prev_position && (x.position - x.prev_position) >= 3);
      const gained = r.rows.filter(x => x.position < x.prev_position && (x.prev_position - x.position) >= 3);
      if (lost.length)   signals.push({ kind:'warning', pillar:'serp', headline:`Losing rank on ${lost.length} keyword${lost.length>1?'s':''}`, detail:`Dropped: ${lost.slice(0,3).map(x=>`"${x.keyword}" (pos ${x.prev_position}→${x.position})`).join(', ')}`, action_view:'serp-tracker', action_label:'Open SERP Tracker' });
      if (gained.length) signals.push({ kind:'win',     pillar:'serp', headline:`Gained rank on ${gained.length} keyword${gained.length>1?'s':''}`, detail:`Up: ${gained.slice(0,3).map(x=>`"${x.keyword}" (pos ${x.prev_position}→${x.position})`).join(', ')}`, action_view:'serp-tracker', action_label:'Open SERP Tracker' });
    }
  } catch { /* table may not exist */ }

  // 3 · AI / Search visibility
  try {
    const r = await pool.query(
      `SELECT visibility_score, brand, created_at FROM search_intel_runs
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 2`, [tid]);
    if (r.rows.length >= 2) {
      activePillars.push('search-intel');
      const [cur, prev] = r.rows;
      const delta = cur.visibility_score - prev.visibility_score;
      if (Math.abs(delta) >= 5) {
        signals.push({ kind: delta < 0 ? 'warning' : 'win', pillar:'search-intel',
          headline: `AI Search Visibility ${delta < 0 ? 'dropped' : 'rose'} ${Math.abs(Math.round(delta))} pts`,
          detail: `Now ${Math.round(cur.visibility_score)}/100 vs ${Math.round(prev.visibility_score)}/100 previously`,
          action_view:'search-intel', action_label:'View AI Visibility' });
      }
    }
  } catch { /* table may not exist */ }

  // 4 · Crisis incidents
  try {
    const r = await pool.query(
      `SELECT headline, severity, kind, status FROM crisis_incidents
       WHERE tenant_id=$1 AND created_at > ${since24h} AND status != 'resolved'
       ORDER BY severity DESC, created_at DESC LIMIT 5`, [tid]);
    if (r.rows.length) {
      activePillars.push('crisis');
      const high = r.rows.filter(x => x.severity === 'high');
      signals.push({ kind:'warning', pillar:'crisis',
        headline:`${r.rows.length} open crisis signal${r.rows.length>1?'s':''} (${high.length} high-severity)`,
        detail: r.rows.slice(0,2).map(x=>x.headline).join(' · '),
        action_view:'crisis', action_label:'Open Crisis Radar' });
    }
  } catch { /* table may not exist */ }

  // 5 · Share of Voice shifts
  try {
    const cur  = await pool.query(
      `SELECT brand, SUM(mentions)::int AS m FROM sov_snapshots
       WHERE tenant_id=$1 AND taken_at > ${since24h} GROUP BY brand`, [tid]);
    const prev = await pool.query(
      `SELECT brand, SUM(mentions)::int AS m FROM sov_snapshots
       WHERE tenant_id=$1 AND taken_at BETWEEN NOW()-INTERVAL '48 hours' AND NOW()-INTERVAL '24 hours'
       GROUP BY brand`, [tid]);
    if (cur.rows.length) {
      activePillars.push('sov');
      const prevMap = new Map(prev.rows.map(r => [r.brand, r.m]));
      const moved = cur.rows.filter(r => {
        const p = prevMap.get(r.brand);
        return p && Math.abs((r.m - p) / p) >= 0.1;
      });
      moved.slice(0,2).forEach(r => {
        const p = prevMap.get(r.brand);
        const pct = Math.round((r.m - p) / p * 100);
        signals.push({ kind: pct < 0 ? 'warning' : 'opportunity', pillar:'sov',
          headline:`${r.brand} share of voice ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`,
          detail:`${r.m} mentions today vs ${p} yesterday`,
          action_view:'sov', action_label:'Open Share of Voice' });
      });
    }
  } catch { /* table may not exist */ }

  // 6 · Competitor activity (new battle cards)
  try {
    const r = await pool.query(
      `SELECT competitor, summary FROM battle_cards
       WHERE tenant_id=$1 AND created_at > ${since24h}
       ORDER BY created_at DESC LIMIT 5`, [tid]);
    if (r.rows.length) {
      activePillars.push('battle-cards');
      signals.push({ kind:'opportunity', pillar:'battle-cards',
        headline:`${r.rows.length} new competitor intelligence card${r.rows.length>1?'s':''}`,
        detail:`Competitors: ${[...new Set(r.rows.map(x=>x.competitor))].slice(0,3).join(', ')}`,
        action_view:'battle', action_label:'Open Battle Cards' });
    }
  } catch { /* table may not exist */ }

  // 7 · Web vitals / page speed
  try {
    const r = await pool.query(
      `SELECT url, performance_score, lcp_ms, created_at FROM web_vitals_runs
       WHERE tenant_id=$1 AND created_at > ${since7d}
       ORDER BY performance_score ASC LIMIT 5`, [tid]);
    if (r.rows.length) {
      activePillars.push('web-vitals');
      const slow = r.rows.filter(x => x.performance_score < 60);
      if (slow.length) signals.push({ kind:'warning', pillar:'web-vitals',
        headline:`${slow.length} page${slow.length>1?'s':''} with poor Core Web Vitals (score < 60)`,
        detail:`Worst: ${slow[0].url} — score ${slow[0].performance_score}`,
        action_view:'web-vitals', action_label:'Web Vitals Report' });
    }
  } catch { /* table may not exist */ }

  // 8 · Decision Engine top recommendations (pre-existing)
  try {
    const r = await pool.query(
      `SELECT title, expected_impact, priority_score, category FROM decision_recommendations
       WHERE tenant_id=$1 AND acted_at IS NULL AND dismissed_at IS NULL
       ORDER BY priority_score DESC LIMIT 3`, [tid]);
    if (r.rows.length) {
      activePillars.push('decision-engine');
      r.rows.forEach(rec => {
        signals.push({ kind:'opportunity', pillar:'decision-engine',
          headline:`AI recommends: ${rec.title}`,
          detail:`Expected: ${rec.expected_impact}`,
          action_view:'decision-engine', action_label:'See Full Analysis' });
      });
    }
  } catch { /* table may not exist */ }

  // 9 · Review signals
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS cnt, AVG(rating)::numeric(3,1) AS avg_rating
       FROM review_reply_drafts
       WHERE tenant_id=$1 AND created_at > ${since24h} AND replied_at IS NULL`, [tid]);
    if (r.rows[0]?.cnt > 0) {
      activePillars.push('reviews');
      const row = r.rows[0];
      signals.push({ kind: row.avg_rating < 3 ? 'warning' : 'opportunity', pillar:'reviews',
        headline:`${row.cnt} customer review${row.cnt>1?'s':''} awaiting reply (avg ${row.avg_rating}★)`,
        detail:'AI draft replies are ready — one click to publish',
        action_view:'review-automation', action_label:'Reply Now' });
    }
  } catch { /* table may not exist */ }

  return { signals, activePillars };
}

// ── AI brief generation ──

async function _aiGenerate(brand, signals, activePillars) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return null;

  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const sys = `You are an AI Marketing Director giving the daily morning brief. You are sharp, direct, and data-driven.
Output strict JSON:
{
  "headline": "one punchy sentence — the single most important thing today (max 100 chars)",
  "greeting": "personal AI marketing director morning greeting, 1 sentence, references the date or day of week",
  "sections": [
    { "title": "Section title", "kind": "warning|win|opportunity|info", "items": ["bullet 1", "bullet 2"] }
  ],
  "actions": [
    { "label": "Short action label", "rationale": "one sentence why", "expected_impact": "e.g. +12% ROAS", "view": "optimizer", "priority": 1 }
  ]
}
- sections: 2–5 sections, only from active pillars, grouped by theme. Skip pillars with no data.
- actions: 3–7 ranked actions, each with a direct link to the relevant feature (view field = the feature's URL fragment, e.g. "optimizer", "serp-tracker", "decision-engine", "battle", "crisis", "review-automation", "web-vitals", "sov", "search-intel").
- Be specific and grounded in the signals. No filler.`;

  const body = JSON.stringify({
    model: 'gpt-4o',
    messages: [
      { role:'system', content:sys },
      { role:'user', content:`Date: ${today}\nBrand: ${brand}\nActive pillars: ${activePillars.join(', ')}\n\nSignals:\n${JSON.stringify(signals, null, 2)}` },
    ],
    response_format: { type:'json_object' },
    temperature: 0.35,
    max_tokens: 1600,
  });

  return new Promise(resolve => {
    const req = _https.request({
      hostname:'api.openai.com', path:'/v1/chat/completions', method:'POST',
      headers:{ 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve(JSON.parse(j.choices[0].message.content));
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(40000, () => req.destroy());
    req.write(body); req.end();
  });
}

// ── Template fallback ──

function _templateBrief(signals, activePillars, brand) {
  const _estimated = true;
  const today = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

  const warnings     = signals.filter(s => s.kind === 'warning');
  const wins         = signals.filter(s => s.kind === 'win');
  const opportunities = signals.filter(s => s.kind === 'opportunity');

  const headline = warnings.length
    ? `⚠️ ${warnings.length} signal${warnings.length>1?'s':''} need your attention today`
    : wins.length
      ? `✅ Strong day — ${wins.length} win${wins.length>1?'s':''} recorded`
      : signals.length
        ? `📊 ${signals.length} marketing signal${signals.length>1?'s':''} ready for review`
        : '📋 Your marketing brief is ready — no urgent signals today';

  const greeting = `Good morning! Here is your marketing brief for ${today}.`;

  const sections = [];
  if (warnings.length) sections.push({ title:'Needs Attention', kind:'warning', items: warnings.slice(0,4).map(s=>`${s.headline}${s.detail?' — '+s.detail:''}`) });
  if (wins.length)     sections.push({ title:'Wins Today',      kind:'win',     items: wins.slice(0,4).map(s=>`${s.headline}${s.detail?' — '+s.detail:''}`) });
  if (opportunities.length) sections.push({ title:'Opportunities', kind:'opportunity', items: opportunities.slice(0,4).map(s=>`${s.headline}${s.detail?' — '+s.detail:''}`) });
  if (!sections.length) sections.push({ title:'All Clear', kind:'info', items:[`No urgent signals in the last 24 hours across ${activePillars.length || 0} active pillar${activePillars.length!==1?'s':''}.`,'Consider refreshing competitor intelligence or running a fresh keyword check.'] });

  const actions = [
    ...warnings.slice(0,3).map((s,i) => ({ label:s.action_label||'View Details', rationale:s.headline, expected_impact:'Address risk', view:s.action_view||'dashboard', priority:i+1 })),
    ...opportunities.slice(0,3).map((s,i) => ({ label:s.action_label||'View Details', rationale:s.headline, expected_impact:s.detail||'Capture opportunity', view:s.action_view||'dashboard', priority:warnings.length+i+1 })),
  ].slice(0,7);

  if (!actions.length) actions.push({ label:'Run Decision Engine', rationale:'Generate fresh AI recommendations across all marketing channels', expected_impact:'Uncover optimisation opportunities', view:'decision-engine', priority:1 });

  return { headline, greeting, sections, actions, _estimated };
}

// ── Main export ──

async function generateBrief(brand, tenantId) {
  const pool = _db.getPool();
  const b = String(brand || '').trim().slice(0, 80);

  const { signals, activePillars } = await _gatherSignals(pool, tenantId);

  let body = await _aiGenerate(b, signals, activePillars);
  let generated_by = 'openai';
  if (!body) {
    body = _templateBrief(signals, activePillars, b);
    generated_by = 'template';
  }

  const { headline, greeting, sections, actions } = body;

  const r = await pool.query(
    `INSERT INTO marketing_briefs
       (tenant_id, brand, headline, greeting, signals, actions, sections, active_pillars, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenantId, b, headline, greeting,
     JSON.stringify(signals), JSON.stringify(actions || []),
     JSON.stringify(sections || []), JSON.stringify(activePillars),
     generated_by]);

  return r.rows[0];
}

module.exports = { generateBrief };

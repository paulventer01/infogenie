const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const CATEGORIES = ['budget','channel','creative','audience','seo','lifecycle','competitive'];

let _ingestMemoryNode = null;
try {
  _ingestMemoryNode = require('../knowledge_graph/api').ingestMemoryNode;
} catch (_) { /* optional */ }

async function _loadLearningContext(p, tid) {
  const learning = {
    category_outcomes: [],
    preferred_actions: [],
    avoided_actions: [],
    memory_lessons: [],
  };
  try {
    const stats = await p.query(
      `SELECT category,
              COUNT(*) FILTER (WHERE acted_at IS NOT NULL)::int AS acted,
              COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL)::int AS dismissed,
              COUNT(*)::int AS total
       FROM decision_recommendations
       WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '90 days'
       GROUP BY category
       ORDER BY acted DESC NULLS LAST`,
      [tid]
    );
    learning.category_outcomes = stats.rows.map(r => ({
      category: r.category,
      acted: r.acted,
      dismissed: r.dismissed,
      act_rate: r.total ? Math.round((r.acted / r.total) * 100) : 0,
    }));
  } catch (_) {}

  try {
    const acts = await p.query(
      `SELECT category, title, recommendation, expected_impact, why_best
       FROM decision_recommendations
       WHERE tenant_id=$1 AND acted_at IS NOT NULL
       ORDER BY acted_at DESC LIMIT 8`,
      [tid]
    );
    learning.preferred_actions = acts.rows;
  } catch (_) {}

  try {
    const dismissed = await p.query(
      `SELECT category, title, recommendation
       FROM decision_recommendations
       WHERE tenant_id=$1 AND dismissed_at IS NOT NULL
       ORDER BY dismissed_at DESC LIMIT 8`,
      [tid]
    );
    learning.avoided_actions = dismissed.rows;
  } catch (_) {}

  try {
    const mem = await p.query(
      `SELECT summary, detail_json, node_type, importance_score, created_at
       FROM marketing_memory_nodes
       WHERE tenant_id=$1
         AND (source_ref LIKE 'decision:%' OR node_type IN ('manual_observation','campaign_result','ai_synthesis'))
       ORDER BY created_at DESC LIMIT 12`,
      [tid]
    );
    learning.memory_lessons = mem.rows.map(r => ({
      summary: r.summary,
      detail: r.detail_json,
      type: r.node_type,
      importance: r.importance_score,
    }));
  } catch (_) {}

  return learning;
}

function _num(v, fallback = null) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function _loadDiagSnapshot() {
  try {
    const dir = path.join(__dirname, '../../data/diag-captures');
    const latestPath = path.join(dir, '_latest.json');
    let file = null;
    if (fs.existsSync(latestPath)) {
      const ptr = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      file = ptr.file || null;
    }
    if (!file) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      file = files.sort().pop() || null;
    }
    if (!file) return null;
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return null;
    const blob = JSON.parse(fs.readFileSync(full, 'utf8'));
    return blob.analysisData || blob;
  } catch (_) {
    return null;
  }
}

async function _loadEntityContext(p, tid, analysisSnapshot = null) {
  const ctx = {
    brand: null,
    url: null,
    industry: null,
    your_kpis: {},
    campaigns: [], // paid campaigns with names + metrics
    competitors: [],
    keywords: [],
    creatives: [],
    sources: [],
  };

  const snap = analysisSnapshot && typeof analysisSnapshot === 'object'
    ? analysisSnapshot
    : _loadDiagSnapshot();

  if (snap) {
    ctx.brand = snap.brand || snap.brandName || null;
    ctx.url = snap.url || snap.domain || null;
    ctx.industry = typeof snap.industry === 'string' ? snap.industry : snap.industry?.name || null;
    ctx.your_kpis = snap.websiteKPIs || snap.kpis || {};
    ctx.sources.push(analysisSnapshot ? 'live_analysis_snapshot' : 'diag_capture');
    (snap.competitors || []).forEach((c) => {
      ctx.competitors.push({
        name: c.name || c.domain || 'Competitor',
        domain: c.domain || null,
        roas: _num(c.roas),
        ctr: _num(c.ctr),
        cpa: _num(c.cpa),
        adSpend: _num(c.adSpend || c.spend),
        topChannel: c.topChannel || c.channel || null,
        topKeywords: (c.topKeywords || c.keywords || []).slice(0, 5),
        threatLevel: c.threatLevel || null,
      });
    });
    // Synthesize "campaign" entities from competitor channel performance so reallocations name FROM/TO
    const yours = {
      name: `${(ctx.url || 'Your brand').replace(/^https?:\/\//, '').replace(/\/$/, '')} — paid mix`,
      channel: 'Blended paid',
      roas: _num(ctx.your_kpis.roas, 2.2),
      daily_budget: _num(ctx.your_kpis.adSpend) ? Math.round(_num(ctx.your_kpis.adSpend) / 30) : null,
      status: 'active',
      kind: 'brand_paid',
    };
    ctx.campaigns.push(yours);
    ctx.competitors
      .filter(c => c.topChannel || c.roas != null)
      .slice(0, 6)
      .forEach((c) => {
        ctx.campaigns.push({
          name: `${c.name} — ${c.topChannel || 'Paid'}`,
          channel: c.topChannel || 'Paid',
          competitor: c.name,
          roas: c.roas,
          daily_budget: c.adSpend != null ? Math.round(c.adSpend / 30) : null,
          status: 'competitor_benchmark',
          kind: 'competitor_channel',
          ctr: c.ctr,
          cpa: c.cpa,
        });
      });
  }

  // Live optimizer / ad campaigns if present
  try {
    const r = await p.query(
      `SELECT id, name, platform, status, daily_budget, target_roas, optimizer_enabled
       FROM ad_campaigns WHERE tenant_id=$1 ORDER BY daily_budget DESC NULLS LAST LIMIT 20`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('ad_campaigns');
      for (const row of r.rows) {
        let roas = null, spend7 = null;
        try {
          const perf = await p.query(
            `SELECT COALESCE(SUM(spend),0) spend, COALESCE(SUM(revenue),0) revenue
             FROM ad_performance_hourly
             WHERE campaign_id=$1 AND bucket_hour > NOW() - INTERVAL '7 days'`,
            [row.id]
          );
          spend7 = _num(perf.rows[0]?.spend, 0);
          const rev = _num(perf.rows[0]?.revenue, 0);
          if (spend7 > 0) roas = +(rev / spend7).toFixed(2);
        } catch (_) {}
        ctx.campaigns.push({
          name: row.name,
          channel: row.platform,
          roas,
          daily_budget: _num(row.daily_budget),
          target_roas: _num(row.target_roas),
          status: row.status,
          kind: 'owned_campaign',
          spend_7d: spend7,
          id: row.id,
        });
      }
    }
  } catch (_) {}

  try {
    const r = await p.query(
      `SELECT name, channel, status, roas, daily_budget
       FROM optimizer_campaigns WHERE tenant_id=$1
       ORDER BY daily_budget DESC NULLS LAST LIMIT 20`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('optimizer_campaigns');
      r.rows.forEach((row) => {
        ctx.campaigns.push({
          name: row.name,
          channel: row.channel,
          roas: _num(row.roas),
          daily_budget: _num(row.daily_budget),
          status: row.status,
          kind: 'owned_campaign',
        });
      });
    }
  } catch (_) {}

  try {
    const r = await p.query(
      `SELECT competitor, summary, positioning, weaknesses, counter_plays
       FROM battle_cards WHERE tenant_id=$1 ORDER BY generated_at DESC NULLS LAST LIMIT 8`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('battle_cards');
      r.rows.forEach((b) => {
        if (!ctx.competitors.find(c => c.name === b.competitor)) {
          ctx.competitors.push({ name: b.competitor, summary: b.summary, weaknesses: b.weaknesses, counter_plays: b.counter_plays });
        }
      });
    }
  } catch (_) {}

  try {
    const r = await p.query(
      `SELECT competitor, prediction, confidence FROM war_room_analyses
       WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('war_room');
      r.rows.forEach((w) => {
        if (!ctx.competitors.find(c => c.name === w.competitor)) {
          ctx.competitors.push({ name: w.competitor, war_room: w.prediction, confidence: w.confidence });
        }
      });
    }
  } catch (_) {}

  try {
    const r = await p.query(
      `SELECT keyword, target_domain, country FROM serp_tracker_keywords
       WHERE tenant_id=$1 AND enabled IS DISTINCT FROM FALSE LIMIT 15`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('serp_tracker');
      ctx.keywords = r.rows.map(k => k.keyword);
    }
  } catch (_) {}

  try {
    const r = await p.query(
      `SELECT brand_name, headline, platform, format, created_at
       FROM ad_creatives WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [tid]
    );
    if (r.rows.length) {
      ctx.sources.push('ad_creatives');
      ctx.creatives = r.rows;
    }
  } catch (_) {}

  // Dedupe campaigns by name
  const seen = new Set();
  ctx.campaigns = ctx.campaigns.filter((c) => {
    const key = `${c.kind}|${c.name}|${c.channel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return ctx;
}

function _pickWorstBest(campaigns, competitors = []) {
  const owned = campaigns.filter(c => c.kind === 'owned_campaign');
  const brand = campaigns.find(c => c.kind === 'brand_paid');
  const comps = campaigns.filter(c => c.kind === 'competitor_channel' && c.roas != null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0));

  // Prefer real owned campaigns when present
  let worst = owned.filter(c => c.roas != null).sort((a, b) => (a.roas ?? 99) - (b.roas ?? 99))[0] || null;
  let best = owned.filter(c => c.roas != null).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0] || null;

  // No owned campaigns: brand paid is the leak; destination is an OWNED conquest campaign
  // modeled on the strongest competitor Search/paid channel — never "to the competitor".
  if (!worst) worst = brand;
  if (!best || (worst && best && worst.name === best.name)) {
    const model = comps.find(c => /search|google|meta|facebook|linkedin/i.test(`${c.channel || ''} ${c.name || ''}`)) || comps[0];
    const brandHost = (brand?.name || 'Your brand').split('—')[0].trim();
    if (model) {
      best = {
        name: `${brandHost} — ${model.channel || 'Search'} conquest`,
        channel: model.channel || 'Google Search',
        roas: model.roas,
        daily_budget: null,
        status: 'planned',
        kind: 'owned_target',
        modeled_on: model.competitor || model.name,
      };
    } else if (brand) {
      best = {
        name: `${brandHost} — high-intent Search`,
        channel: 'Google Search',
        roas: Math.max((brand.roas || 2) + 1.2, 3.5),
        kind: 'owned_target',
      };
    }
  }

  const topCompetitorProfile = competitors.slice().sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0] || null;
  return { worst, best, topCompetitorCampaign: comps[0] || null, topCompetitorProfile };
}

function _entities(from, to, affected = [], metrics = {}) {
  return {
    from: from ? [{ name: from.name, channel: from.channel, roas: from.roas, daily_budget: from.daily_budget, kind: from.kind, competitor: from.competitor || null }] : [],
    to: to ? [{ name: to.name, channel: to.channel, roas: to.roas, daily_budget: to.daily_budget, kind: to.kind, competitor: to.competitor || null }] : [],
    affected: affected.filter(Boolean).map(a => (typeof a === 'string' ? { name: a } : a)),
    metrics,
  };
}

function _buildGroundedRecommendations(entityCtx) {
  const { worst, best, topCompetitorProfile } = _pickWorstBest(entityCtx.campaigns, entityCtx.competitors);
  const brandLabel = (entityCtx.url || 'your brand').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const yourRoas = _num(entityCtx.your_kpis.roas, worst?.roas || 2.2);
  const industry = entityCtx.industry || 'your market';
  const competitor = topCompetitorProfile || entityCtx.competitors[0];
  const kw = entityCtx.keywords[0] || competitor?.topKeywords?.[0] || `${industry} software`;
  const creative = entityCtx.creatives[0];

  const worstName = worst?.name || 'lowest-ROAS campaign';
  const bestName = best?.name || 'best-performing campaign';
  const worstRoas = worst?.roas != null ? `${worst.roas}×` : 'below target';
  const bestRoas = best?.roas != null ? `${best.roas}×` : 'above target';
  const worstBudget = worst?.daily_budget != null ? `$${worst.daily_budget}/day` : 'current daily budget';
  const shiftBudget = worst?.daily_budget != null ? `$${Math.max(20, Math.round(worst.daily_budget * 0.2))}/day` : '20% of its budget';

  const recs = [
    {
      category: 'budget',
      title: `Move spend from “${worstName}” → “${bestName}”`,
      problem_summary: `“${worstName}” is underperforming at ${worstRoas} ROAS${worst?.channel ? ` on ${worst.channel}` : ''} while “${bestName}” delivers ${bestRoas}.`,
      change_summary: `Reallocate ${shiftBudget} from “${worstName}” to “${bestName}”; keep “${worstName}” alive only if ROAS recovers above 1.5× within 14 days.`,
      recommendation: `Cut ~20% (${shiftBudget}) from “${worstName}” (${worstRoas} ROAS, ${worstBudget}) and add it to “${bestName}” (${bestRoas} ROAS). Review in 7 days — if “${worstName}” stays <1.5×, pause it.`,
      expected_impact: '+15–20% blended ROAS',
      confidence_pct: worst?.roas != null && best?.roas != null ? 78 : 62,
      cost_estimate: '$0 - reallocation only',
      time_to_result: '2–3 weeks',
      priority_score: 92,
      data_sources: entityCtx.sources.join(' + ') || 'analysis snapshot',
      why_best: `Named reallocation beats “shift from lowest channel” advice — operators know exactly which campaign is leaking and which one absorbs the budget.`,
      entities: _entities(worst, best, [brandLabel], { from_roas: worst?.roas, to_roas: best?.roas, shift: shiftBudget }),
    },
    {
      category: 'competitive',
      title: competitor
        ? `Counter ${competitor.name} on ${competitor.topChannel || 'their primary channel'}`
        : 'Counter top competitor channel push',
      problem_summary: competitor
        ? `${competitor.name} runs ~${competitor.roas ?? '—'}× ROAS${competitor.topChannel ? ` via ${competitor.topChannel}` : ''} while ${brandLabel} sits at ${yourRoas}×.`
        : `Competitive pressure in ${industry} is outpacing ${brandLabel}'s paid efficiency.`,
      change_summary: competitor
        ? `Launch a conquest / comparison campaign aimed at ${competitor.name}'s ${competitor.topChannel || 'audience'} this week.`
        : 'Launch a conquest campaign against the #1 competitor channel.',
      recommendation: competitor
        ? `Build a comparison angle vs ${competitor.name}${competitor.topKeywords?.[0] ? ` on keyword “${competitor.topKeywords[0]}”` : ''}. Put first budget on ${competitor.topChannel || 'their strongest channel'} — not a net-new untested platform.`
        : `Identify the #1 competitor channel and launch a comparison campaign there first.`,
      expected_impact: '+10–15% share of voice on conquest terms',
      confidence_pct: 68,
      cost_estimate: '$500–$1,000 test',
      time_to_result: '2 weeks',
      priority_score: 84,
      data_sources: 'competitive analysis',
      why_best: `Attacking a named competitor on a named channel converts existing demand faster than broad awareness.`,
      entities: _entities(
        { name: brandLabel, channel: 'Your paid', roas: yourRoas, kind: 'brand_paid' },
        competitor ? { name: `${competitor.name} — ${competitor.topChannel || 'Paid'}`, channel: competitor.topChannel, roas: competitor.roas, kind: 'competitor_channel', competitor: competitor.name } : null,
        competitor?.topKeywords || [],
      ),
    },
    {
      category: 'seo',
      title: `Publish pillars for “${kw}” (gap vs ${competitor?.name || 'competitors'})`,
      problem_summary: `Competitors${competitor ? ` (notably ${competitor.name})` : ''} capture demand for “${kw}” that ${brandLabel} does not own.`,
      change_summary: `Brief and publish 3 pillar pages targeting “${kw}” and 2 related terms within 6 weeks.`,
      recommendation: `Create 3 pillar articles around “${kw}” with comparison sections vs ${competitor?.name || 'the category leader'}. Wire each to a dedicated landing URL and track rankings weekly.`,
      expected_impact: '+25% organic traffic in 60 days',
      confidence_pct: 65,
      cost_estimate: '$200–$500 content production',
      time_to_result: '6–8 weeks',
      priority_score: 80,
      data_sources: 'serp + competitive keywords',
      why_best: `Owning the exact keyword competitors already monetise compounds; paid-only capture resets every billing cycle.`,
      entities: {
        from: [],
        to: [],
        affected: [{ name: kw, type: 'keyword' }, competitor ? { name: competitor.name, type: 'competitor' } : null].filter(Boolean),
        metrics: {},
      },
    },
    {
      category: 'creative',
      title: creative
        ? `Refresh creatives for “${creative.headline || creative.brand_name || 'active ads'}” (${creative.platform || 'ads'})`
        : `Refresh fatigued creatives on “${worstName}”`,
      problem_summary: creative
        ? `Creative “${creative.headline || creative.brand_name}” on ${creative.platform || 'ads'} is aging — frequency fatigue typically lifts CPM after 30 days.`
        : `“${worstName}” shows efficiency drag consistent with creative fatigue; hooks need replacement.`,
      change_summary: `Ship 3 new hooks this week for ${creative ? `“${creative.headline || creative.brand_name}”` : `“${worstName}”`} and pause the oldest variant once CTR recovers.`,
      recommendation: creative
        ? `Replace the primary hook on “${creative.headline || 'current ad'}” (${creative.platform || 'ad account'}) with 3 new angles. Keep spend on the same campaign — do not rebuild audiences yet.`
        : `On “${worstName}”, launch 3 new creative hooks and kill variants older than 30 days after a 7-day read.`,
      expected_impact: '-18% CPM, +8% CTR',
      confidence_pct: 76,
      cost_estimate: '$100–$300 design',
      time_to_result: '1 week',
      priority_score: 78,
      data_sources: creative ? 'ad_creatives' : 'campaign efficiency',
      why_best: `Named creative refresh is faster and cheaper than audience rebuilds or bid strategy changes.`,
      entities: _entities(worst, null, creative ? [creative.headline || creative.brand_name] : [worstName]),
    },
    {
      category: 'lifecycle',
      title: `Win-back silent ${brandLabel} subscribers (>90 days)`,
      problem_summary: `Owned contacts silent >90 days are idle CAC you already paid for — cheaper than buying equivalent net-new leads.`,
      change_summary: `Launch a 3-email win-back with 15% incentive to the >90-day inactive segment; suppress engaged openers.`,
      recommendation: `Segment ${brandLabel} list: contacts with no open/click in 90 days. Send 3-step win-back (value → social proof → 15% offer). Exclude anyone who converts from paid retargeting.`,
      expected_impact: '4–8% reactivation rate',
      confidence_pct: 70,
      cost_estimate: '$0 - email only',
      time_to_result: '1 week',
      priority_score: 70,
      data_sources: 'lifecycle',
      why_best: `Reactivating a named owned audience beats cold paid acquisition on CAC.`,
      entities: { from: [], to: [], affected: [{ name: `${brandLabel} · inactive >90d`, type: 'segment' }], metrics: {} },
    },
    {
      category: 'audience',
      title: `1% LTV lookalike for ${brandLabel} (seed: top customers)`,
      problem_summary: `${brandLabel}'s best customers are not yet seeding paid lookalikes — broad interest targeting wastes learning budget.`,
      change_summary: `Build a 1% lookalike from top 200 LTV customers; test $1k on ${best?.channel || competitor?.topChannel || 'Meta/Google'}.`,
      recommendation: `Export top 200 customers by LTV for ${brandLabel}. Create a 1% lookalike on ${best?.channel || 'Meta'}. Cap test at $1,000. Kill if CPA > 1.3× current blended after 14 days.`,
      expected_impact: '+20% lead quality',
      confidence_pct: 66,
      cost_estimate: '$1,000 test budget',
      time_to_result: '2 weeks',
      priority_score: 74,
      data_sources: 'audience + brand KPIs',
      why_best: `LTV-seeded lookalikes inherit proven buyer economics — better than interest stacks.`,
      entities: {
        from: [],
        to: [{ name: `${brandLabel} 1% LTV lookalike`, channel: best?.channel || 'Meta', kind: 'audience' }],
        affected: [{ name: 'Top 200 LTV customers', type: 'seed' }],
        metrics: {},
      },
    },
    {
      category: 'channel',
      title: worst?.channel && best?.channel && worst.channel !== best.channel
        ? `Shift mix toward ${best.channel} (away from weak ${worst.channel})`
        : `Scale ${best?.channel || 'best channel'} with a controlled test`,
      problem_summary: worst && best
        ? `${worst.channel || worstName} under-indexes (${worstRoas}) versus ${best.channel || bestName} (${bestRoas}).`
        : `Channel mix for ${brandLabel} is not concentrating on the highest-efficiency surface.`,
      change_summary: `Move the next $500 of test budget into ${best?.channel || 'the top channel'}, not into a third unproven platform.`,
      recommendation: `Hold ${worst?.channel || 'the weak channel'} flat. Put the next $500 into ${best?.channel || 'the winning channel'} creative tests tied to “${bestName}”.`,
      expected_impact: '+12% channel ROAS',
      confidence_pct: 64,
      cost_estimate: '$500',
      time_to_result: '3 weeks',
      priority_score: 66,
      data_sources: entityCtx.sources.join(' + ') || 'channel mix',
      why_best: `Doubling down on a named winning channel beats spreading thin across new platforms.`,
      entities: _entities(worst, best),
    },
    {
      category: 'audience',
      title: `Saturation guard on “${worstName}”`,
      problem_summary: `“${worstName}” is the efficiency laggard — saturation/frequency is the first place waste shows up.`,
      change_summary: `Exclude converters + expand interests on “${worstName}” today; do not raise budget until frequency cools.`,
      recommendation: `On “${worstName}”, exclude recent converters, cap frequency, and add an interest-expansion layer. Re-check ROAS in 72 hours before any budget increase.`,
      expected_impact: '-22% wasted impressions',
      confidence_pct: 80,
      cost_estimate: '$0',
      time_to_result: 'Immediate',
      priority_score: 58,
      data_sources: 'optimizer / efficiency',
      why_best: `Stopping named-campaign waste protects ROAS immediately; creative-only fixes cannot repair exhausted audiences.`,
      entities: _entities(worst, null, [worstName]),
    },
  ];

  return {
    recommendations: recs,
    summary: `Grounded priorities for ${brandLabel} using ${entityCtx.sources.join(', ') || 'available signals'} — every action names the campaign, channel, competitor, or keyword involved.`,
    top_opportunity: `Reallocate from “${worstName}” (${worstRoas}) to “${bestName}” (${bestRoas}) for the fastest zero-cost lift.`,
    future_risks: [
      `If “${worstName}” keeps ${worstBudget} at ${worstRoas}, wasted spend compounds over the next 30 days.`,
      competitor ? `${competitor.name} pressure on ${competitor.topChannel || 'paid'} can siphon mid-funnel demand.` : 'Unmonitored competitor moves can erode share.',
    ],
    future_opportunities: [
      `Owning “${kw}” organically reduces paid dependency within 60 days.`,
      `LTV lookalike tests on ${best?.channel || 'the winning channel'} can raise lead quality before the next budget cycle.`,
    ],
  };
}

async function _recordDecisionFeedback(tid, id, outcome) {
  const p = await _db.getPool();
  let row = null;
  try {
    const r = await p.query(
      `SELECT id, category, title, recommendation, expected_impact, why_best, priority_score, entities, problem_summary, change_summary
       FROM decision_recommendations WHERE id=$1 AND tenant_id=$2`,
      [id, tid]
    );
    row = r.rows[0] || null;
  } catch (_) {}
  if (!row || !_ingestMemoryNode) return;

  const verb = outcome === 'acted' ? 'Acted on' : 'Dismissed';
  const importance = outcome === 'acted' ? 0.78 : 0.55;
  try {
    await _ingestMemoryNode({
      tenant_id: tid,
      node_type: outcome === 'acted' ? 'campaign_result' : 'manual_observation',
      summary: `${verb} Decision Engine rec (${row.category}): ${row.title}`,
      detail: {
        outcome,
        category: row.category,
        title: row.title,
        recommendation: row.recommendation,
        expected_impact: row.expected_impact,
        why_best: row.why_best,
        entities: row.entities,
        problem_summary: row.problem_summary,
        change_summary: row.change_summary,
        priority_score: row.priority_score,
        decision_id: row.id,
      },
      source_ref: `decision:${row.id}:${outcome}`,
      importance,
    });
  } catch (e) {
    console.warn('[decision-engine] memory ingest failed:', e.message);
  }
}

async function runAnalyse(tid, { context_notes = null, analysis_snapshot = null, replace_open = true } = {}) {
  const p = await _db.getPool();

  const entityCtx = await _loadEntityContext(p, tid, analysis_snapshot || null);
  const learning = await _loadLearningContext(p, tid);
  const grounded = _buildGroundedRecommendations(entityCtx);

  let recommendations = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are the AI marketing decision engine for InfoGenie.
CRITICAL RULE: Every recommendation MUST name the specific campaigns, ad sets, channels, competitors, keywords, or segments involved.
Never say "lowest ROAS channel" or "best-performing" without the actual names and metrics.
If reallocating budget, state FROM campaign/channel (with ROAS + budget) TO campaign/channel (with ROAS).
Explain what is not working and exactly what changes.

ENTITY CONTEXT (authoritative names + metrics):
${JSON.stringify(entityCtx, null, 2)}

LEARNING FROM PAST USE:
${JSON.stringify(learning, null, 2)}

Extra notes: ${context_notes || 'none'}

Generate 8 ranked recommendations. Categories: ${CATEGORIES.join(', ')}.
Return strict JSON:
{
  "recommendations":[{
    "category":"budget",
    "title":"Must include entity names",
    "problem_summary":"What is broken, naming entities + metrics",
    "change_summary":"Exact FROM → TO / what changes",
    "recommendation":"Actionable steps naming entities",
    "expected_impact":"+12% ROAS in 3 weeks",
    "confidence_pct":75,
    "cost_estimate":"$0 - reallocation only",
    "time_to_result":"2-3 weeks",
    "priority_score":88,
    "data_sources":"...",
    "why_best":"why this beats alternatives",
    "entities":{
      "from":[{"name":"...","channel":"...","roas":1.2,"daily_budget":100}],
      "to":[{"name":"...","channel":"...","roas":4.1}],
      "affected":[{"name":"...","type":"keyword|segment|creative|competitor"}],
      "metrics":{}
    }
  }],
  "summary":"...",
  "top_opportunity":"...",
  "future_risks":["..."],
  "future_opportunities":["..."]
}`;
    const r = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    const first = parsed.recommendations?.[0];
    const named = !!(first && (
      first.entities?.from?.length || first.entities?.to?.length || first.entities?.affected?.length
      || /[“"]/.test(`${first.title || ''} ${first.recommendation || ''}`)
      || first.problem_summary
    ));
    const stillGeneric = /lowest ROAS channel|underperforming spend|best-performing(?! [“"])/i.test(`${first?.title || ''} ${first?.recommendation || ''}`);
    if (first?.title && named && !stillGeneric) {
      recommendations = parsed;
    }
  } catch (e) {
    console.warn('[decision-engine] ai analyse:', e.message);
  }

  if (!recommendations?.recommendations?.length) {
    recommendations = grounded;
  } else {
    // Ensure entities exist; backfill from grounded twins by category if AI omitted names
    recommendations.recommendations = recommendations.recommendations.map((rec, i) => {
      if (rec.entities?.from?.length || rec.entities?.to?.length || rec.entities?.affected?.length) return rec;
      const twin = grounded.recommendations.find(g => g.category === rec.category) || grounded.recommendations[i];
      if (!twin) return rec;
      return {
        ...rec,
        title: /lowest|underperforming|best-performing|competitors?/i.test(rec.title) ? twin.title : rec.title,
        recommendation: twin.recommendation,
        problem_summary: rec.problem_summary || twin.problem_summary,
        change_summary: rec.change_summary || twin.change_summary,
        entities: twin.entities,
        why_best: rec.why_best || twin.why_best,
      };
    });
  }

  // Replace prior open generic/ungrounded recs so the Brief shows the new clear set
  if (replace_open !== false) {
    try {
      await p.query(
        `UPDATE decision_recommendations
         SET dismissed_at=NOW()
         WHERE tenant_id=$1 AND acted_at IS NULL AND dismissed_at IS NULL`,
        [tid]
      );
    } catch (_) {}
  }

  const now = new Date();
  const inserted = [];
  for (const r of recommendations.recommendations) {
    try {
      const ins = await p.query(
        `INSERT INTO decision_recommendations(
           tenant_id,category,title,recommendation,expected_impact,confidence_pct,cost_estimate,
           time_to_result,priority_score,data_sources,why_best,entities,problem_summary,change_summary
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          tid, r.category, r.title, r.recommendation, r.expected_impact, r.confidence_pct || 0,
          r.cost_estimate, r.time_to_result, r.priority_score || 0, r.data_sources,
          r.why_best || null, JSON.stringify(r.entities || {}),
          r.problem_summary || null, r.change_summary || null,
        ]
      );
      inserted.push(ins.rows[0]);
    } catch (e) {
      try {
        await p.query(
          `INSERT INTO decision_recommendations(tenant_id,category,title,recommendation,expected_impact,confidence_pct,cost_estimate,time_to_result,priority_score,data_sources,why_best)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [tid, r.category, r.title, r.recommendation, r.expected_impact, r.confidence_pct || 0, r.cost_estimate, r.time_to_result, r.priority_score || 0, r.data_sources, r.why_best || null]
        );
      } catch (_) {}
    }
  }

  return {
    ok: true,
    ...recommendations,
    recommendations: inserted.length ? inserted : recommendations.recommendations,
    entity_context: {
      brand: entityCtx.brand || entityCtx.url,
      industry: entityCtx.industry,
      campaigns_named: entityCtx.campaigns.map(c => c.name).slice(0, 12),
      competitors_named: entityCtx.competitors.map(c => c.name).slice(0, 8),
      sources: entityCtx.sources,
    },
    learning_applied: {
      categories_tracked: learning.category_outcomes.length,
      preferred_count: learning.preferred_actions.length,
      avoided_count: learning.avoided_actions.length,
      memory_lessons: learning.memory_lessons.length,
    },
    generated_at: now,
  };
}

router.post('/analyse', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'decision-engine:analyse' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { context_notes, analysis_snapshot, replace_open } = req.body || {};
  res.json(await runAnalyse(tid, { context_notes, analysis_snapshot, replace_open }));
});

router.get('/recommendations', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'decision-engine:list' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT * FROM decision_recommendations WHERE tenant_id=$1 AND dismissed_at IS NULL ORDER BY priority_score DESC, created_at DESC LIMIT 50`,
    [tid]
  );
  res.json({ ok:true, recommendations: rows.rows });
});

router.post('/act/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'decision-engine:act' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  await p.query(`UPDATE decision_recommendations SET acted_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  await _recordDecisionFeedback(tid, req.params.id, 'acted');
  res.json({ ok:true, learned:true });
});

router.post('/dismiss/:id', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'decision-engine:dismiss' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const p = await _db.getPool();
  await p.query(`UPDATE decision_recommendations SET dismissed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  await _recordDecisionFeedback(tid, req.params.id, 'dismissed');
  res.json({ ok:true, learned:true });
});

module.exports = router;
module.exports.runAnalyse = runAnalyse;

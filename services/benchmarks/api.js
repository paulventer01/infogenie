const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');


const METRICS = [
  { key:'cpa', label:'Cost per Acquisition', unit:'currency' },
  { key:'cac', label:'Customer Acquisition Cost', unit:'currency' },
  { key:'roas', label:'Return on Ad Spend', unit:'multiplier' },
  { key:'ctr', label:'Click-Through Rate', unit:'percent' },
  { key:'cvr', label:'Conversion Rate', unit:'percent' },
  { key:'cpm', label:'Cost per 1,000 Impressions', unit:'currency' },
  { key:'email_open_rate', label:'Email Open Rate', unit:'percent' },
  { key:'email_ctr', label:'Email Click Rate', unit:'percent' },
  { key:'ltv', label:'Customer Lifetime Value', unit:'currency' },
  { key:'ltv_cac_ratio', label:'LTV:CAC Ratio', unit:'multiplier' },
  { key:'cac_payback_months', label:'CAC Payback (months)', unit:'number' },
  { key:'monthly_ad_spend', label:'Monthly Ad Spend', unit:'currency' },
  { key:'organic_traffic', label:'Monthly Organic Traffic', unit:'number' },
];

const VERTICALS = ['e-commerce','saas','local-business','finance','health','agency','education','real-estate'];
const REGIONS   = ['North America','Europe','APAC','Africa','Latin America','Middle East'];
const SIZES     = ['1-10','11-50','51-200','201-500','500+'];

// Suppress buckets whose contributing workspaces would identify a single tenant.
// sample_count stays raw submission rows; publication is gated on contributor_count.
const K = 5;

router.get('/config', async (req, res) => {
  res.json({ ok:true, metrics:METRICS, verticals:VERTICALS, regions:REGIONS, sizes:SIZES });
});

// Submit your own metrics to contribute to benchmark pool
router.post('/submit', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'benchmarks:submit' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { vertical, region, company_size, metrics } = req.body;
  if (!vertical || !metrics || !Object.keys(metrics).length)
    return res.status(400).json({ ok:false, error:'vertical and metrics required' });
  const p = await _db.getPool();
  const rows = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (value == null || isNaN(+value)) continue;
    const r = await p.query(
      `INSERT INTO benchmark_submissions(tenant_id,vertical,region,company_size,metric_key,metric_value)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, vertical, region||null, company_size||null, key, +value]
    );
    rows.push(r.rows[0].id);
  }
  await _rebuildAggregates(p, vertical, region||null, company_size||null);
  res.json({ ok:true, submitted: rows.length });
});

// Get benchmarks for a vertical (compare your metrics vs network)
router.post('/compare', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'benchmarks:compare' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });
  const { vertical, region, company_size, your_metrics } = req.body;
  if (!vertical) return res.status(400).json({ ok:false, error:'vertical required' });
  const p = await _db.getPool();
  const aggs = await p.query(
    `SELECT metric_key,p25,median,p75,sample_count FROM benchmark_aggregates
     WHERE vertical=$1 AND (region=$2 OR region IS NULL) AND (company_size=$3 OR company_size IS NULL)
       AND contributor_count >= $4`,
    [vertical, region||null, company_size||null, K]
  );
  const benchmarks = {};
  for (const r of aggs.rows) benchmarks[r.metric_key] = r;
  // AI interpretation
  let ai_insights = [];
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a marketing benchmark analyst.
Vertical: ${vertical}${region ? ', '+region : ''}${company_size ? ', size '+company_size : ''}
User metrics: ${JSON.stringify(your_metrics||{})}
Network medians: ${JSON.stringify(Object.fromEntries(Object.entries(benchmarks).map(([k,v])=>[k,v.median])))}
Identify where the user is above/below median, explain what it means, and give 3 specific improvement actions.
Return strict JSON: {"insights":[{"metric":"...","status":"above|below|on_par","gap_pct":0,"takeaway":"...","action":"..."}],"summary":"...","biggest_opportunity":"..."}`;
    const r = await openai.chat.completions.create({ model:'gpt-5-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed.insights?.[0]?._DUMMY) ai_insights = parsed;
  } catch(e) {
    ai_insights = {
      insights: (your_metrics ? Object.keys(your_metrics) : []).slice(0,3).map(k=>({
        metric:k, status:'unknown', gap_pct:0,
        takeaway:`Compare your ${k} against the ${vertical} median.`,
        action:`Review your ${k} and identify top performers in your category.`
      })),
      summary:`Benchmark comparison for ${vertical}. Submit more data to refine insights.`,
      biggest_opportunity:'Improve your top-of-funnel conversion rate.'
    };
  }
  res.json({ ok:true, vertical, benchmarks, ai_insights, your_metrics: your_metrics||{} });
});

// AI Suggest — uses brand foundation + company context to estimate your metrics
router.post('/ai-suggest', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label:'benchmarks:ai-suggest' });
  if (!tid) return res.status(400).json({ ok:false, error:'no_tenant' });

  // Fetch brand foundation for this tenant
  let bf = {};
  try {
    const p = _db.getPool();
    if (p) {
      const r = await p.query(`SELECT * FROM brand_foundation WHERE tenant_id=$1 LIMIT 1`, [tid]);
      bf = r.rows[0] || {};
    }
  } catch(e) { console.warn('[benchmarks:ai-suggest] bf fetch failed:', e.message); }

  const companyCtx = [
    bf.positioning_statement && `Positioning: ${bf.positioning_statement}`,
    bf.purpose_why && `Why they exist: ${bf.purpose_why}`,
    bf.icp_role && `Ideal customer role: ${bf.icp_role}`,
    bf.icp_pain && `Customer pain: ${bf.icp_pain}`,
    bf.icp_dream_outcome && `Customer dream outcome: ${bf.icp_dream_outcome}`,
    bf.purpose_beyond_money && `Mission: ${bf.purpose_beyond_money}`,
  ].filter(Boolean).join('\n');

  if (!companyCtx) {
    return res.json({
      ok: false,
      error: 'No company profile found. Please fill in your Brand Foundation first (Manage → Brand Foundation).',
    });
  }

  const metricList = METRICS.map(m => `${m.key} (${m.label}, unit: ${m.unit})`).join(', ');

  const prompt = `You are a marketing metrics analyst. Based on the following company profile, estimate realistic current marketing performance metrics for this business. Use industry knowledge to produce plausible estimates — not ideal targets, but realistic current figures for a company fitting this profile.

Company profile:
${companyCtx}

Metrics to estimate: ${metricList}

Rules:
- cpa, cac, cpm, ltv, monthly_ad_spend: dollar values (positive numbers)
- roas, ltv_cac_ratio: multipliers (e.g. 3.2 means 3.2x)
- ctr, cvr, email_open_rate, email_ctr: percentages (e.g. 2.5 means 2.5%)
- organic_traffic: monthly visitors (integer)
- Return ONLY strict JSON: { "cpa": <number>, "cac": <number>, "roas": <number>, "ctr": <number>, "cvr": <number>, "cpm": <number>, "email_open_rate": <number>, "email_ctr": <number>, "ltv": <number>, "ltv_cac_ratio": <number>, "monthly_ad_spend": <number>, "organic_traffic": <number> }
- No nulls. Every field must have a positive number. No extra keys. No markdown.`;

  let suggested = null;

  // Try OpenAI first
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) suggested = parsed;
  } catch(e) {
    console.warn('[benchmarks:ai-suggest] openai failed:', e.message);
  }

  // Try Anthropic
  if (!suggested) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const ant = new Anthropic({ apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY });
      const r = await ant.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = r.content[0]?.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) suggested = JSON.parse(match[0]);
    } catch(e) {
      console.warn('[benchmarks:ai-suggest] anthropic failed:', e.message);
    }
  }

  if (!suggested) {
    return res.status(503).json({ ok:false, error:'No AI provider available. Please configure one under Manage → AI Providers.' });
  }

  // Validate — ensure all values are positive numbers
  const clean = {};
  for (const m of METRICS) {
    const v = +suggested[m.key];
    if (Number.isFinite(v) && v >= 0) clean[m.key] = v;
  }

  res.json({ ok: true, suggested: clean });
});

router.get('/leaderboard', async (req, res) => {
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT vertical, metric_key, median, p25, p75, sample_count
     FROM benchmark_aggregates
     WHERE contributor_count >= $1
     ORDER BY sample_count DESC LIMIT 50`,
    [K]
  );
  res.json({ ok:true, leaderboard: rows.rows });
});

async function _rebuildAggregates(p, vertical, region, company_size) {
  try {
    // Percentiles over one value per workspace (latest submission). sample_count
    // remains COUNT(*) of raw rows; contributor_count is COUNT(DISTINCT tenant_id).
    const metrics = await p.query(
      `WITH bucket AS (
         SELECT tenant_id, metric_key, metric_value, submitted_at, id
           FROM benchmark_submissions
          WHERE vertical=$1
            AND (region=$2 OR ($2 IS NULL AND region IS NULL))
            AND (company_size=$3 OR ($3 IS NULL AND company_size IS NULL))
       ),
       per_tenant AS (
         SELECT DISTINCT ON (tenant_id, metric_key)
                tenant_id, metric_key, metric_value
           FROM bucket
          ORDER BY tenant_id, metric_key, submitted_at DESC NULLS LAST, id DESC
       ),
       row_counts AS (
         SELECT metric_key, COUNT(*)::int AS sample_count
           FROM bucket
          GROUP BY metric_key
       )
       SELECT p.metric_key,
              PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY p.metric_value) AS p25,
              PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY p.metric_value) AS median,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY p.metric_value) AS p75,
              r.sample_count,
              COUNT(DISTINCT p.tenant_id)::int AS contributor_count
         FROM per_tenant p
         JOIN row_counts r ON r.metric_key = p.metric_key
        GROUP BY p.metric_key, r.sample_count`,
      [vertical, region, company_size]
    );
    for (const r of metrics.rows) {
      if (Number(r.contributor_count) < K) {
        // Drop a previously published statistic — not tenant business rows.
        await p.query(
          `DELETE FROM benchmark_aggregates
            WHERE vertical=$1
              AND region IS NOT DISTINCT FROM $2
              AND company_size IS NOT DISTINCT FROM $3
              AND metric_key=$4`,
          [vertical, region, company_size, r.metric_key]
        );
        continue;
      }
      await p.query(
        `INSERT INTO benchmark_aggregates(vertical,region,company_size,metric_key,p25,median,p75,sample_count,contributor_count,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT(vertical,region,company_size,metric_key)
         DO UPDATE SET p25=$5,median=$6,p75=$7,sample_count=$8,contributor_count=$9,updated_at=NOW()`,
        [vertical, region, company_size, r.metric_key, r.p25, r.median, r.p75, r.sample_count, r.contributor_count]
      );
    }
  } catch(e) { console.warn('[benchmarks] aggregate rebuild failed:', e.message); }
}

module.exports = router;

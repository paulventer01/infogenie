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
  { key:'monthly_ad_spend', label:'Monthly Ad Spend', unit:'currency' },
  { key:'organic_traffic', label:'Monthly Organic Traffic', unit:'number' },
];

const VERTICALS = ['e-commerce','saas','local-business','finance','health','agency','education','real-estate'];
const REGIONS   = ['North America','Europe','APAC','Africa','Latin America','Middle East'];
const SIZES     = ['1-10','11-50','51-200','201-500','500+'];

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
     WHERE vertical=$1 AND (region=$2 OR region IS NULL) AND (company_size=$3 OR company_size IS NULL)`,
    [vertical, region||null, company_size||null]
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
    const r = await openai.chat.completions.create({ model:'gpt-4o-mini', response_format:{type:'json_object'}, messages:[{role:'user',content:prompt}] });
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

router.get('/leaderboard', async (req, res) => {
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT vertical, metric_key, median, p25, p75, sample_count
     FROM benchmark_aggregates ORDER BY sample_count DESC LIMIT 50`
  );
  res.json({ ok:true, leaderboard: rows.rows });
});

async function _rebuildAggregates(p, vertical, region, company_size) {
  try {
    const metrics = await p.query(
      `SELECT metric_key,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY metric_value) as p25,
        PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY metric_value) as median,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY metric_value) as p75,
        COUNT(*) as sample_count
       FROM benchmark_submissions
       WHERE vertical=$1 AND (region=$2 OR ($2 IS NULL AND region IS NULL))
         AND (company_size=$3 OR ($3 IS NULL AND company_size IS NULL))
       GROUP BY metric_key`,
      [vertical, region, company_size]
    );
    for (const r of metrics.rows) {
      await p.query(
        `INSERT INTO benchmark_aggregates(vertical,region,company_size,metric_key,p25,median,p75,sample_count,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT(vertical,region,company_size,metric_key)
         DO UPDATE SET p25=$5,median=$6,p75=$7,sample_count=$8,updated_at=NOW()`,
        [vertical, region, company_size, r.metric_key, r.p25, r.median, r.p75, r.sample_count]
      );
    }
  } catch(e) { console.warn('[benchmarks] aggregate rebuild failed:', e.message); }
}

module.exports = router;

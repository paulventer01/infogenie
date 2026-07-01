'use strict';
// Predictive Intelligence Engine — T-PIE
// Forecasts competitor moves, campaign outcomes, churn trajectory, and 90-day
// revenue scenarios. Results are cached in prediction_runs for 6 hours so the
// dashboard renders instantly on repeat loads.
//
// Endpoints (all require auth):
//   POST /api/predictions/competitor-moves
//   POST /api/predictions/campaign-outcome
//   POST /api/predictions/churn-trajectory
//   GET  /api/predictions/history
//   POST /api/predictions/refresh          (runs all 4 in sequence)

const express     = require('express');
const _https      = require('https');
const _db         = require('../../db');
const _tenantCtx  = require('../tenants/context');

const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }
function _auth(req) { return !!(req.isAuthenticated?.() || req.apiKeyUser); }

function _safeAsync(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch(e => {
    console.warn('[predictions]', e.stack || e.message);
    if (!res.headersSent) _err(res, 500, 'Internal server error');
  });
}

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── OpenAI helper (gpt-4o) ────────────────────────────────────────────────
function _openai(messages, maxTokens = 1200) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: maxTokens,
  });
  return new Promise(resolve => {
    const req = _https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          const text = j.choices?.[0]?.message?.content;
          resolve(text ? JSON.parse(text) : null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(50000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ── Persist a prediction run ───────────────────────────────────────────────
async function _savePrediction(tenantId, predictionType, inputs, output, modelUsed = 'gpt-4o') {
  const pool = _db.getPool();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const r = await pool.query(
    `INSERT INTO prediction_runs (tenant_id, prediction_type, inputs_json, output_json, model_used, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, created_at`,
    [tenantId, predictionType, JSON.stringify(inputs), JSON.stringify(output), modelUsed, expiresAt]
  );
  return r.rows[0];
}

// ── Fetch most recent non-expired prediction for a tenant+type ─────────────
async function _latestValid(tenantId, predictionType) {
  if (!_db.hasDb || !_db.hasDb()) return null;
  try {
    const pool = _db.getPool();
    const r = await pool.query(
      `SELECT id, inputs_json, output_json, model_used, created_at, expires_at
       FROM prediction_runs
       WHERE tenant_id=$1 AND prediction_type=$2 AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, predictionType]
    );
    return r.rows[0] || null;
  } catch { return null; }
}

// ── KG ingest (fire-and-forget) ────────────────────────────────────────────
function _kgIngest(tenantId, nodeType, summary, detail, sourceRef, importance = 0.65) {
  try {
    const { ingestMemoryNode } = require('../knowledge_graph/api');
    ingestMemoryNode({ tenant_id: tenantId, node_type: nodeType, summary, detail, source_ref: sourceRef, importance }).catch(() => {});
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPETITOR MOVES PREDICTION
// Sources: crisis_incidents (last 30d) + pricing_watch_snapshots (last 30d) +
//          sov_snapshots (last 30d). Falls back to template when AI unavailable.
// ─────────────────────────────────────────────────────────────────────────────
async function _runCompetitorMoves(tenantId, inputs = {}) {
  let incidents = [], pricingChanges = [], sovShifts = [], jobSignals = [], adSpendTrend = [];
  if (_db.hasDb && _db.hasDb()) {
    const pool = _db.getPool();
    try {
      const ir = await pool.query(
        `SELECT title, severity, status, detected_at FROM crisis_incidents
         WHERE tenant_id=$1 AND detected_at > NOW() - INTERVAL '30 days'
         ORDER BY detected_at DESC LIMIT 10`,
        [tenantId]
      );
      incidents = ir.rows;
    } catch (_) {}
    try {
      const pr = await pool.query(
        `SELECT target_domain, price_before, price_after, currency, detected_at
         FROM pricing_watch_snapshots
         WHERE tenant_id=$1 AND detected_at > NOW() - INTERVAL '30 days'
         ORDER BY detected_at DESC LIMIT 10`,
        [tenantId]
      );
      pricingChanges = pr.rows;
    } catch (_) {}
    try {
      const sr = await pool.query(
        `SELECT target_brand, sov_pct, channel, taken_at FROM sov_snapshots
         WHERE tenant_id=$1 AND taken_at > NOW() - INTERVAL '30 days'
         ORDER BY taken_at DESC LIMIT 15`,
        [tenantId]
      );
      sovShifts = sr.rows;
    } catch (_) {}
    // Job board spy: hiring velocity as a leading indicator of competitor expansion
    try {
      const jr = await pool.query(
        `SELECT company, total_jobs, by_dept, strategic_signals, created_at
         FROM job_board_runs
         WHERE created_at > NOW() - INTERVAL '30 days'
         ORDER BY created_at DESC LIMIT 10`
      );
      jobSignals = jr.rows;
    } catch (_) {}
    // Ad spend trend: rising competitor spend signals an incoming push
    try {
      const ar = await pool.query(
        `SELECT SUM(spend) AS total_spend, SUM(impressions) AS total_impressions,
                DATE_TRUNC('week', bucket_hour) AS week
         FROM ad_performance_hourly
         WHERE bucket_hour > NOW() - INTERVAL '30 days'
         GROUP BY week ORDER BY week DESC LIMIT 4`
      );
      adSpendTrend = ar.rows;
    } catch (_) {}
  }

  const sys = `You are a competitive intelligence strategist. Analyse the provided signals and predict likely competitor moves over the next 90 days.
Return strict JSON:
{
  "confidence": 0-100,
  "summary": "2-3 sentence strategic overview",
  "predictions": [
    { "competitor": "name", "move": "description", "probability": 0-100, "timeframe": "e.g. 30 days", "impact": "low|medium|high" }
  ],
  "evidence": ["bullet 1", "bullet 2", "bullet 3"],
  "recommended_action": "Plain English playbook (2-3 sentences)",
  "watch_signals": ["signal 1", "signal 2"]
}`;
  const userMsg = `Crisis / sentiment incidents (last 30 days): ${JSON.stringify(incidents)}
Competitor pricing changes: ${JSON.stringify(pricingChanges)}
Share of Voice shifts: ${JSON.stringify(sovShifts)}
Competitor hiring signals (job board, last 30 days): ${JSON.stringify(jobSignals)}
Your ad spend trend by week (last 4 weeks): ${JSON.stringify(adSpendTrend)}
Additional context: ${JSON.stringify(inputs)}

Produce the competitor moves prediction using all available signals above.`;

  const ai = await _openai([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 1000);

  const output = ai || {
    confidence: 45,
    summary: 'Template estimate — connect AI providers for personalised competitive intelligence.',
    predictions: [
      { competitor: 'Primary Rival', move: 'Likely to increase ad spend in response to SOV shifts', probability: 60, timeframe: '30 days', impact: 'medium' },
      { competitor: 'Secondary Rival', move: 'Potential pricing adjustment based on recent changes', probability: 40, timeframe: '60 days', impact: 'low' },
    ],
    evidence: ['SOV data suggests market pressure', 'Pricing watch active for tracked domains', 'No recent crisis incidents detected'],
    recommended_action: 'Monitor competitor ad spend and prepare counter-messaging. Review pricing positioning quarterly.',
    watch_signals: ['Competitor job board activity', 'Pricing page changes', 'Ad creative volume'],
  };

  _kgIngest(tenantId, 'competitor_signal',
    `Competitor move prediction — confidence ${output.confidence}%: ${output.summary?.slice(0, 160)}`,
    { predictions: output.predictions, watch_signals: output.watch_signals },
    'prediction:competitor_move',
    Math.min(1, (output.confidence || 50) / 100)
  );

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAMPAIGN OUTCOME PREDICTION
// Extends revenue_forecast logic with 90-day horizon.
// ─────────────────────────────────────────────────────────────────────────────
async function _runCampaignOutcome(tenantId, inputs = {}) {
  const {
    current_monthly_spend = 10000,
    budget_change = 0,
    current_leads = 200,
    conversion_rate = 3,
    aov = 500,
    cac = 250,
    ltv = 1500,
    currency = 'USD',
    channels = [],
  } = inputs;

  const sys = `You are a campaign performance modeller. Predict the 90-day outcome of the described campaign.
Return strict JSON:
{
  "confidence": 0-100,
  "summary": "2-3 sentence summary of expected performance",
  "best_case":     { "leads": 0, "customers": 0, "revenue": 0, "roas": 0 },
  "expected_case": { "leads": 0, "customers": 0, "revenue": 0, "roas": 0 },
  "worst_case":    { "leads": 0, "customers": 0, "revenue": 0, "roas": 0 },
  "evidence": ["bullet 1", "bullet 2"],
  "recommended_action": "2-3 sentence optimisation play",
  "key_risks": ["risk 1", "risk 2"],
  "monthly_breakdown": [
    { "month": "Month 1", "revenue_best": 0, "revenue_expected": 0, "revenue_worst": 0 },
    { "month": "Month 2", "revenue_best": 0, "revenue_expected": 0, "revenue_worst": 0 },
    { "month": "Month 3", "revenue_best": 0, "revenue_expected": 0, "revenue_worst": 0 }
  ]
}`;
  const userMsg = `Monthly spend: ${currency} ${current_monthly_spend} (change: ${budget_change >= 0 ? '+' : ''}${budget_change})
Leads/month: ${current_leads}, Conversion rate: ${conversion_rate}%, AOV: ${currency} ${aov}
CAC: ${currency} ${cac}, LTV: ${currency} ${ltv}, Channels: ${channels.join(', ') || 'unspecified'}`;

  const newSpend = current_monthly_spend + budget_change;
  const spendRatio = newSpend / Math.max(1, current_monthly_spend);
  const baseLeads = current_leads * spendRatio;
  const baseRev = baseLeads * (conversion_rate / 100) * aov;

  const template = {
    confidence: 42,
    summary: 'Template estimate — connect AI providers for personalised campaign modelling.',
    best_case:     { leads: Math.round(baseLeads * 1.2), customers: Math.round(baseLeads * 1.2 * conversion_rate / 100), revenue: Math.round(baseRev * 1.3), roas: +((baseRev * 1.3) / Math.max(1, newSpend)).toFixed(2) },
    expected_case: { leads: Math.round(baseLeads), customers: Math.round(baseLeads * conversion_rate / 100), revenue: Math.round(baseRev), roas: +(baseRev / Math.max(1, newSpend)).toFixed(2) },
    worst_case:    { leads: Math.round(baseLeads * 0.7), customers: Math.round(baseLeads * 0.7 * conversion_rate / 100), revenue: Math.round(baseRev * 0.6), roas: +((baseRev * 0.6) / Math.max(1, newSpend)).toFixed(2) },
    evidence: ['Spend-to-lead ratio held constant', 'Conversion rate and AOV unchanged from inputs'],
    recommended_action: 'Connect AI providers for personalised modelling. Review channel mix and conversion optimisation.',
    key_risks: ['Ad fatigue may reduce CTR over time', 'Seasonal demand fluctuations not modelled'],
    monthly_breakdown: [
      { month: 'Month 1', revenue_best: Math.round(baseRev * 1.3 * 0.3), revenue_expected: Math.round(baseRev * 0.3), revenue_worst: Math.round(baseRev * 0.6 * 0.3) },
      { month: 'Month 2', revenue_best: Math.round(baseRev * 1.3 * 0.35), revenue_expected: Math.round(baseRev * 0.35), revenue_worst: Math.round(baseRev * 0.6 * 0.35) },
      { month: 'Month 3', revenue_best: Math.round(baseRev * 1.3 * 0.35), revenue_expected: Math.round(baseRev * 0.35), revenue_worst: Math.round(baseRev * 0.6 * 0.35) },
    ],
  };

  const ai = await _openai([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 1200);
  const output = ai || template;

  _kgIngest(tenantId, 'campaign_result',
    `Campaign outcome prediction — confidence ${output.confidence}%: expected ${output.expected_case?.revenue || 0} ${currency} revenue over 90 days.`,
    { expected: output.expected_case, best: output.best_case, worst: output.worst_case },
    'prediction:campaign_outcome',
    Math.min(1, (output.confidence || 50) / 100)
  );

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHURN TRAJECTORY PREDICTION
// Aggregates churn_scores for the tenant and forecasts 90-day retention curve.
// ─────────────────────────────────────────────────────────────────────────────
async function _runChurnTrajectory(tenantId, inputs = {}) {
  let scoreData = { avg: 0, high: 0, critical: 0, total: 0, topSignals: [] };
  if (_db.hasDb && _db.hasDb()) {
    try {
      const pool = _db.getPool();
      const r = await pool.query(
        `SELECT AVG(score) AS avg_score,
                COUNT(*) FILTER (WHERE risk_level IN ('high','critical')) AS high_risk,
                COUNT(*) FILTER (WHERE risk_level = 'critical') AS critical_risk,
                COUNT(*) AS total
         FROM churn_scores
         WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '60 days'`,
        [tenantId]
      );
      const row = r.rows[0] || {};
      scoreData.avg = Math.round(parseFloat(row.avg_score) || 0);
      scoreData.high = parseInt(row.high_risk) || 0;
      scoreData.critical = parseInt(row.critical_risk) || 0;
      scoreData.total = parseInt(row.total) || 0;

      const sigR = await pool.query(
        `SELECT signals FROM churn_scores
         WHERE tenant_id=$1 AND score >= 60 AND created_at > NOW() - INTERVAL '60 days'
         ORDER BY score DESC LIMIT 20`,
        [tenantId]
      );
      const allSigs = sigR.rows.flatMap(r2 => Array.isArray(r2.signals) ? r2.signals : []);
      const freq = {};
      allSigs.forEach(s => { freq[s] = (freq[s] || 0) + 1; });
      scoreData.topSignals = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    } catch (_) {}
  }

  const sys = `You are a customer retention analyst. Given churn score aggregate data, predict the 90-day churn trajectory.
Return strict JSON:
{
  "confidence": 0-100,
  "summary": "2-3 sentence churn outlook",
  "predicted_churn_rate_30d": 0-100,
  "predicted_churn_rate_90d": 0-100,
  "revenue_at_risk": 0,
  "top_risk_drivers": ["driver 1 (most critical)", "driver 2", "driver 3"],
  "evidence": ["bullet 1", "bullet 2", "bullet 3"],
  "recommended_action": "2-3 sentence retention playbook",
  "retention_levers": ["lever 1", "lever 2", "lever 3"],
  "monthly_breakdown": [
    { "month": "Month 1", "churn_best": 0, "churn_expected": 0, "churn_worst": 0 },
    { "month": "Month 2", "churn_best": 0, "churn_expected": 0, "churn_worst": 0 },
    { "month": "Month 3", "churn_best": 0, "churn_expected": 0, "churn_worst": 0 }
  ]
}`;
  const userMsg = `Churn score aggregate (last 60 days):
- Average score: ${scoreData.avg}/100
- High/critical risk contacts: ${scoreData.high} (${scoreData.critical} critical)
- Total scored: ${scoreData.total}
- Top churn signals: ${scoreData.topSignals.join(', ') || 'none'}
Additional inputs: ${JSON.stringify(inputs)}`;

  const churnPct = Math.min(100, Math.round(scoreData.avg * 0.8));
  const topDrivers = scoreData.topSignals.length
    ? scoreData.topSignals.slice(0, 3)
    : ['Low engagement / infrequent logins', 'No recent product activity', 'Support tickets unresolved'];
  const template = {
    confidence: 38,
    summary: 'Template estimate — score more contacts and connect AI providers for personalised churn modelling.',
    predicted_churn_rate_30d: Math.round(churnPct * 0.35),
    predicted_churn_rate_90d: churnPct,
    revenue_at_risk: 0,
    top_risk_drivers: topDrivers,
    evidence: [
      `Average churn score: ${scoreData.avg}/100`,
      `${scoreData.high} contacts flagged as high or critical risk`,
      scoreData.topSignals.length ? `Top signals: ${scoreData.topSignals.join(', ')}` : 'No dominant churn signal detected',
    ],
    recommended_action: 'Prioritise outreach to critical-risk contacts. Implement a win-back email sequence for high-risk cohort.',
    retention_levers: ['Proactive success check-ins', 'Feature adoption nudges', 'Loyalty incentives for at-risk accounts'],
    monthly_breakdown: [
      { month: 'Month 1', churn_best: Math.round(churnPct * 0.3 * 0.7), churn_expected: Math.round(churnPct * 0.3), churn_worst: Math.round(churnPct * 0.3 * 1.3) },
      { month: 'Month 2', churn_best: Math.round(churnPct * 0.35 * 0.7), churn_expected: Math.round(churnPct * 0.35), churn_worst: Math.round(churnPct * 0.35 * 1.3) },
      { month: 'Month 3', churn_best: Math.round(churnPct * 0.35 * 0.7), churn_expected: Math.round(churnPct * 0.35), churn_worst: Math.round(churnPct * 0.35 * 1.3) },
    ],
  };

  const ai = await _openai([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 1000);
  const output = ai || template;

  _kgIngest(tenantId, 'campaign_result',
    `Churn trajectory prediction — confidence ${output.confidence}%: predicted 90-day churn rate ${output.predicted_churn_rate_90d}%. Top drivers: ${(output.top_risk_drivers || []).slice(0,2).join('; ')}.`,
    { churn_30d: output.predicted_churn_rate_30d, churn_90d: output.predicted_churn_rate_90d, top_risk_drivers: output.top_risk_drivers, levers: output.retention_levers },
    'prediction:churn_trajectory',
    Math.min(1, (output.confidence || 50) / 100)
  );

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE SCENARIO PREDICTION
// 90-day multi-scenario revenue forecast with monthly breakdown.
// ─────────────────────────────────────────────────────────────────────────────
async function _runRevenueScenario(tenantId, inputs = {}) {
  const {
    current_mrr = 0,
    growth_rate = 5,
    channels = [],
    headwinds = [],
    tailwinds = [],
    currency = 'USD',
  } = inputs;

  const sys = `You are a revenue modeller. Produce a 90-day revenue scenario analysis with best/expected/worst cases.
Return strict JSON:
{
  "confidence": 0-100,
  "summary": "2-3 sentence revenue outlook",
  "best_case_90d": 0,
  "expected_case_90d": 0,
  "worst_case_90d": 0,
  "evidence": ["bullet 1", "bullet 2", "bullet 3"],
  "recommended_action": "2-3 sentence strategic recommendation",
  "growth_levers": ["lever 1", "lever 2"],
  "scenario_data": [
    { "month": "Month 1", "best": 0, "expected": 0, "worst": 0 },
    { "month": "Month 2", "best": 0, "expected": 0, "worst": 0 },
    { "month": "Month 3", "best": 0, "expected": 0, "worst": 0 }
  ]
}`;
  const userMsg = `Current MRR: ${currency} ${current_mrr}
MoM growth rate: ${growth_rate}%
Channels: ${channels.join(', ') || 'unspecified'}
Headwinds: ${headwinds.join(', ') || 'none specified'}
Tailwinds: ${tailwinds.join(', ') || 'none specified'}`;

  const base = current_mrr || 10000;
  const g = 1 + growth_rate / 100;
  const m1 = Math.round(base * g), m2 = Math.round(m1 * g), m3 = Math.round(m2 * g);
  const template = {
    confidence: 40,
    summary: 'Template estimate — provide current MRR and connect AI providers for personalised revenue modelling.',
    best_case_90d: Math.round((m1 + m2 + m3) * 1.25),
    expected_case_90d: m1 + m2 + m3,
    worst_case_90d: Math.round((m1 + m2 + m3) * 0.7),
    evidence: [
      `Current MRR: ${currency} ${base.toLocaleString()}`,
      `Assumed ${growth_rate}% MoM growth compounded`,
      'No headwinds or tailwinds modelled',
    ],
    recommended_action: 'Provide actual MRR data and channel breakdown for a more accurate forecast. Focus on conversion optimisation.',
    growth_levers: ['Increase average contract value', 'Reduce churn below 2%'],
    scenario_data: [
      { month: 'Month 1', best: Math.round(m1 * 1.25), expected: m1, worst: Math.round(m1 * 0.7) },
      { month: 'Month 2', best: Math.round(m2 * 1.25), expected: m2, worst: Math.round(m2 * 0.7) },
      { month: 'Month 3', best: Math.round(m3 * 1.25), expected: m3, worst: Math.round(m3 * 0.7) },
    ],
  };

  const ai = await _openai([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], 1000);
  const output = ai || template;

  _kgIngest(tenantId, 'campaign_result',
    `Revenue scenario prediction — confidence ${output.confidence}%: expected 90-day revenue ${output.expected_case_90d?.toLocaleString()} ${currency}.`,
    { best: output.best_case_90d, expected: output.expected_case_90d, worst: output.worst_case_90d, levers: output.growth_levers },
    'prediction:revenue_scenario',
    Math.min(1, (output.confidence || 50) / 100)
  );

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.post('/competitor-moves', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:competitor-moves');
  if (!tid) return _err(res, 400, 'no_tenant');

  const inputs = req.body || {};
  const cached = await _latestValid(tid, 'competitor_move');
  if (cached && !inputs.force) {
    return res.json({ ok: true, cached: true, prediction_type: 'competitor_move', ...cached.output_json, _meta: { id: cached.id, created_at: cached.created_at, expires_at: cached.expires_at } });
  }

  const output = await _runCompetitorMoves(tid, inputs);
  if (_db.hasDb && _db.hasDb()) {
    const saved = await _savePrediction(tid, 'competitor_move', inputs, output);
    return res.json({ ok: true, cached: false, prediction_type: 'competitor_move', ...output, _meta: { id: saved.id, created_at: saved.created_at } });
  }
  res.json({ ok: true, cached: false, prediction_type: 'competitor_move', ...output });
}));

router.post('/campaign-outcome', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:campaign-outcome');
  if (!tid) return _err(res, 400, 'no_tenant');

  const inputs = req.body || {};
  const cached = await _latestValid(tid, 'campaign_outcome');
  if (cached && !inputs.force) {
    return res.json({ ok: true, cached: true, prediction_type: 'campaign_outcome', ...cached.output_json, _meta: { id: cached.id, created_at: cached.created_at, expires_at: cached.expires_at } });
  }

  const output = await _runCampaignOutcome(tid, inputs);
  if (_db.hasDb && _db.hasDb()) {
    const saved = await _savePrediction(tid, 'campaign_outcome', inputs, output);
    return res.json({ ok: true, cached: false, prediction_type: 'campaign_outcome', ...output, _meta: { id: saved.id, created_at: saved.created_at } });
  }
  res.json({ ok: true, cached: false, prediction_type: 'campaign_outcome', ...output });
}));

router.post('/churn-trajectory', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:churn-trajectory');
  if (!tid) return _err(res, 400, 'no_tenant');

  const inputs = req.body || {};
  const cached = await _latestValid(tid, 'churn_trajectory');
  if (cached && !inputs.force) {
    return res.json({ ok: true, cached: true, prediction_type: 'churn_trajectory', ...cached.output_json, _meta: { id: cached.id, created_at: cached.created_at, expires_at: cached.expires_at } });
  }

  const output = await _runChurnTrajectory(tid, inputs);
  if (_db.hasDb && _db.hasDb()) {
    const saved = await _savePrediction(tid, 'churn_trajectory', inputs, output);
    return res.json({ ok: true, cached: false, prediction_type: 'churn_trajectory', ...output, _meta: { id: saved.id, created_at: saved.created_at } });
  }
  res.json({ ok: true, cached: false, prediction_type: 'churn_trajectory', ...output });
}));

router.post('/revenue-scenario', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:revenue-scenario');
  if (!tid) return _err(res, 400, 'no_tenant');

  const inputs = req.body || {};
  const cached = await _latestValid(tid, 'revenue_scenario');
  if (cached && !inputs.force) {
    return res.json({ ok: true, cached: true, prediction_type: 'revenue_scenario', ...cached.output_json, _meta: { id: cached.id, created_at: cached.created_at, expires_at: cached.expires_at } });
  }

  const output = await _runRevenueScenario(tid, inputs);
  if (_db.hasDb && _db.hasDb()) {
    const saved = await _savePrediction(tid, 'revenue_scenario', inputs, output);
    return res.json({ ok: true, cached: false, prediction_type: 'revenue_scenario', ...output, _meta: { id: saved.id, created_at: saved.created_at } });
  }
  res.json({ ok: true, cached: false, prediction_type: 'revenue_scenario', ...output });
}));

router.get('/history', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:history');
  if (!tid) return _err(res, 400, 'no_tenant');
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, runs: [] });

  const pool = _db.getPool();
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const type = req.query.type || null;
  const params = type ? [tid, type, limit] : [tid, limit];
  const whereType = type ? 'AND prediction_type=$2' : '';
  const limitParam = type ? '$3' : '$2';
  const r = await pool.query(
    `SELECT id, prediction_type, model_used, output_json->>'confidence' AS confidence,
            output_json->>'summary' AS summary,
            created_at, expires_at,
            CASE WHEN expires_at > NOW() THEN true ELSE false END AS is_valid
     FROM prediction_runs
     WHERE tenant_id=$1 ${whereType}
     ORDER BY created_at DESC
     LIMIT ${limitParam}`,
    params
  );
  res.json({ ok: true, runs: r.rows });
}));

// POST /refresh — run all 4 prediction types in sequence (fire 6-hour refresh)
router.post('/refresh', _safeAsync(async (req, res) => {
  if (!_auth(req)) return _err(res, 401, 'auth required');
  const tid = await _tid(req, 'predictions:refresh');
  if (!tid) return _err(res, 400, 'no_tenant');

  const inputs = req.body || {};
  const force = { ...inputs, force: true };

  const [competitor, campaign, churn, revenue] = await Promise.all([
    _runCompetitorMoves(tid, force).catch(e => ({ error: e.message })),
    _runCampaignOutcome(tid, force).catch(e => ({ error: e.message })),
    _runChurnTrajectory(tid, force).catch(e => ({ error: e.message })),
    _runRevenueScenario(tid, force).catch(e => ({ error: e.message })),
  ]);

  if (_db.hasDb && _db.hasDb()) {
    await Promise.all([
      !competitor.error && _savePrediction(tid, 'competitor_move', inputs, competitor),
      !campaign.error && _savePrediction(tid, 'campaign_outcome', inputs, campaign),
      !churn.error && _savePrediction(tid, 'churn_trajectory', inputs, churn),
      !revenue.error && _savePrediction(tid, 'revenue_scenario', inputs, revenue),
    ].filter(Boolean)).catch(() => {});
  }

  res.json({
    ok: true,
    refreshed_at: new Date().toISOString(),
    results: { competitor_move: competitor, campaign_outcome: campaign, churn_trajectory: churn, revenue_scenario: revenue },
  });
}));

// Exported runner for the 6-hour background cron (called from server.js)
async function runPredictionsRefreshForAllTenants() {
  if (!_db.hasDb || !_db.hasDb()) return;
  try {
    const pool = _db.getPool();
    const tr = await pool.query(`SELECT id FROM tenants WHERE status='active' LIMIT 50`);
    for (const row of tr.rows) {
      const tid = row.id;
      await Promise.all([
        _runCompetitorMoves(tid, {}).then(o => _savePrediction(tid, 'competitor_move', {}, o)).catch(() => {}),
        _runCampaignOutcome(tid, {}).then(o => _savePrediction(tid, 'campaign_outcome', {}, o)).catch(() => {}),
        _runChurnTrajectory(tid, {}).then(o => _savePrediction(tid, 'churn_trajectory', {}, o)).catch(() => {}),
        _runRevenueScenario(tid, {}).then(o => _savePrediction(tid, 'revenue_scenario', {}, o)).catch(() => {}),
      ]);
    }
    console.log(`[predictions] background refresh complete — ${tr.rows.length} tenant(s)`);
  } catch (e) {
    console.warn('[predictions] background refresh error:', e.message);
  }
}

module.exports = { router, runPredictionsRefreshForAllTenants };

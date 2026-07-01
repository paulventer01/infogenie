const express  = require('express');
const _crypto  = require('crypto');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');
const { normalizeChatParams } = require('../ai_compat');
const { streamPdf }           = require('../exports/pdf_report');
let _kgIngest = null;
try { _kgIngest = require('../knowledge_graph/api').ingestMemoryNode; } catch {}

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error:msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

function _callOpenAI(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const raw = normalizeChatParams({
    model: 'gpt-4o',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: opts.max_tokens || 2500,
  });
  const body = JSON.stringify(raw);
  const https = require('https');
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          if (r.statusCode !== 200) return resolve(null);
          const j = JSON.parse(d);
          resolve(j.choices[0].message.content);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => req.destroy());
    req.write(body);
    req.end();
  });
}

const SIM_SYSTEM = `You are a business simulation engine for a digital marketing company. The user has described their business and is asking a "what if" scenario question. Simulate the most likely outcome using marketing and business fundamentals.

Return strict JSON:
{
  "scenario_title": "Brief title",
  "verdict": "positive|neutral|negative|mixed",
  "confidence": <integer 0-100>,
  "executive_summary": "2-3 sentence plain English summary of what would happen",
  "timeline": [
    { "period":"Days 1-30",  "what_happens":"...", "metric_impact":"..." },
    { "period":"Days 31-60", "what_happens":"...", "metric_impact":"..." },
    { "period":"Days 61-90", "what_happens":"...", "metric_impact":"..." }
  ],
  "upsides": ["upside 1","upside 2","upside 3"],
  "risks": ["risk 1","risk 2","risk 3"],
  "key_metrics_affected": [
    { "metric":"CAC", "direction":"up|down|neutral", "estimated_change":"e.g. +15%" },
    { "metric":"Revenue", "direction":"up|down|neutral", "estimated_change":"e.g. +8%" }
  ],
  "recommended_action": "The one thing the user should do right now to prepare for or exploit this scenario",
  "alternative_scenarios": ["What if X instead","What if Y also"]
}
Be specific and grounded in real marketing outcomes. Clearly flag uncertainty where data is thin.`;

function _templateResult(q) {
  return {
    scenario_title: q,
    verdict: 'mixed',
    confidence: 65,
    executive_summary: 'Template simulation — connect AI providers for a personalised business simulation. Based on typical patterns, this scenario would have mixed results depending on execution speed and market conditions.',
    timeline: [
      { period:'Days 1-30',  what_happens:'Initial setup and transition period.', metric_impact:'Costs increase temporarily.' },
      { period:'Days 31-60', what_happens:'First results begin to show.',          metric_impact:'Performance stabilises.'   },
      { period:'Days 61-90', what_happens:'Full impact becomes measurable.',       metric_impact:'ROI becomes clearer.'      },
    ],
    upsides: ['Potential efficiency gain','New audience reach','Competitive differentiation'],
    risks:   ['Execution risk','Market timing','Resource constraints'],
    key_metrics_affected: [
      { metric:'CAC',     direction:'up', estimated_change:'+10-20%' },
      { metric:'Revenue', direction:'up', estimated_change:'+5-15% over 90 days' },
    ],
    recommended_action: 'Run a small pilot before committing full resources.',
    alternative_scenarios: ['What if you combined this with SEO?','What if you phased the change over 6 months?'],
  };
}

async function _autoContext(tid) {
  try {
    const p = await _db.getPool();
    const r = await p.query(
      `SELECT name, platform, status, budget_monthly, objective
         FROM ad_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [tid]
    );
    if (!r.rows.length) return null;
    return r.rows.map(c =>
      `Campaign "${c.name}" on ${c.platform} | ${c.status} | budget $${c.budget_monthly}/mo | goal: ${c.objective}`
    ).join('\n');
  } catch { return null; }
}

/* ── GET /api/digital-twin/scenarios ───────────────────────────────────────── */
router.get('/scenarios', async (req, res) => {
  const tid = await _tid(req, 'dt:scenarios'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id, category, icon, label, prompt FROM simulation_templates ORDER BY sort_order`,
  ).catch(() => ({ rows: [] }));
  res.json({ ok: true, scenarios: rows.rows, count: rows.rows.length });
});

/* ── GET /api/digital-twin/templates ──────────────────────────────────────── */
router.get('/templates', async (req, res) => {
  const tid = await _tid(req, 'dt:templates'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id, category, icon, label, prompt FROM simulation_templates ORDER BY sort_order`,
  ).catch(() => ({ rows: [] }));
  const grouped = {};
  for (const r of rows.rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push(r);
  }
  res.json({ ok: true, templates: rows.rows, grouped });
});

/* ── GET /api/digital-twin/autofill ──────────────────────────────────────── */
router.get('/autofill', async (req, res) => {
  const tid = await _tid(req, 'dt:autofill'); if (!tid) return _err(res, 400, 'no_tenant');
  const ctx = await _autoContext(tid);
  res.json({ ok: true, context: ctx });
});

/* ── POST /api/digital-twin/simulate ────────────────────────────────────────*/
router.post('/simulate', async (req, res) => {
  const tid = await _tid(req, 'dt:simulate'); if (!tid) return _err(res, 400, 'no_tenant');
  const { scenario, question, business_context = {}, scenario_name, template_id } = req.body || {};
  if (!scenario && !question) return _err(res, 400, 'scenario or question required');

  const q = (question || scenario || '').trim();
  const liveCtx = await _autoContext(tid);
  const manualCtx = Object.entries(business_context)
    .map(([k, v]) => `${k}: ${v}`).join('\n');
  const fullCtx = [liveCtx, manualCtx].filter(Boolean).join('\n') || 'No business context provided.';

  const raw = await _callOpenAI([
    { role: 'system', content: SIM_SYSTEM },
    { role: 'user',   content: `Business context:\n${fullCtx}\n\nScenario question: ${q}` },
  ]);

  let results = _templateResult(q);
  if (raw) { try { results = JSON.parse(raw); } catch {} }

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO digital_twin_scenarios(tenant_id,scenario,question,results,scenario_name,template_id)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at`,
    [tid, scenario || 'custom', q, JSON.stringify(results),
     scenario_name || results.scenario_title || q, template_id || null],
  );
  const row = ins.rows[0];

  if (_kgIngest && results.executive_summary) {
    _kgIngest({
      tenant_id: tid,
      node_type: 'manual_observation',
      summary: `Marketing Simulator: ${q}`,
      detail: { verdict: results.verdict, confidence: results.confidence, summary: results.executive_summary },
      importance: 0.6,
    }).catch(() => {});
  }

  res.json({ ok: true, id: row.id, scenario: scenario || 'custom', question: q,
             results, created_at: row.created_at });
});

/* ── GET /api/digital-twin/history ──────────────────────────────────────────*/
router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'dt:history'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id,scenario,question,results,scenario_name,template_id,share_token,comparison_group_id,created_at
       FROM digital_twin_scenarios WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [tid],
  );
  res.json({ ok: true, simulations: rows.rows });
});

/* ── POST /api/digital-twin/compare ─────────────────────────────────────────*/
router.post('/compare', async (req, res) => {
  const tid = await _tid(req, 'dt:compare'); if (!tid) return _err(res, 400, 'no_tenant');
  const { scenario_ids } = req.body || {};
  if (!Array.isArray(scenario_ids) || scenario_ids.length < 2 || scenario_ids.length > 4)
    return _err(res, 400, 'provide 2-4 scenario_ids');

  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id,question,scenario_name,results,created_at FROM digital_twin_scenarios
      WHERE tenant_id=$1 AND id = ANY($2::int[])`,
    [tid, scenario_ids],
  );
  if (rows.rows.length < 2) return _err(res, 404, 'scenarios not found');

  const groupId = _crypto.randomUUID();
  await p.query(
    `UPDATE digital_twin_scenarios SET comparison_group_id=$1 WHERE tenant_id=$2 AND id=ANY($3::int[])`,
    [groupId, tid, scenario_ids],
  );

  const scenarios = rows.rows.map(r => ({
    id: r.id,
    name: r.scenario_name || r.question,
    question: r.question,
    created_at: r.created_at,
    results: r.results,
  }));

  const verdictOrder = { positive:3, mixed:2, neutral:1, negative:0 };
  const winner = scenarios.reduce((best, s) =>
    (verdictOrder[s.results?.verdict] || 0) > (verdictOrder[best.results?.verdict] || 0) ? s : best
  , scenarios[0]);

  res.json({ ok: true, comparison_group_id: groupId, scenarios, winner_id: winner.id });
});

/* ── POST /api/digital-twin/scenarios/:id/share ─────────────────────────────*/
router.post('/scenarios/:id/share', async (req, res) => {
  const tid = await _tid(req, 'dt:share'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const check = await p.query(
    `SELECT id, share_token FROM digital_twin_scenarios WHERE id=$1 AND tenant_id=$2`,
    [parseInt(req.params.id), tid],
  );
  if (!check.rows.length) return _err(res, 404, 'not found');

  let token = check.rows[0].share_token;
  if (!token) {
    token = _crypto.randomBytes(16).toString('hex');
    await p.query(
      `UPDATE digital_twin_scenarios SET share_token=$1 WHERE id=$2 AND tenant_id=$3`,
      [token, parseInt(req.params.id), tid],
    );
  }
  const base = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG}.replit.app`;
  res.json({ ok: true, token, url: `${base}/api/digital-twin/share/${token}` });
});

/* ── GET /api/digital-twin/share/:token  (public — no auth) ─────────────── */
router.get('/share/:token', async (req, res) => {
  const token = (req.params.token || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return res.status(400).json({ ok: false, error: 'invalid token' });
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id,question,scenario_name,results,created_at FROM digital_twin_scenarios WHERE share_token=$1`,
    [token],
  );
  if (!row.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const r = row.rows[0];
  res.json({ ok: true, id: r.id, question: r.question, scenario_name: r.scenario_name,
             results: r.results, created_at: r.created_at });
});

/* ── GET /api/digital-twin/scenarios/:id/pdf ────────────────────────────── */
router.get('/scenarios/:id/pdf', async (req, res) => {
  const tid = await _tid(req, 'dt:pdf'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id,question,scenario_name,results,created_at FROM digital_twin_scenarios WHERE id=$1 AND tenant_id=$2`,
    [parseInt(req.params.id), tid],
  );
  if (!row.rows.length) return _err(res, 404, 'not found');
  const r   = row.rows[0];
  const res_ = r.results || {};
  const name = r.scenario_name || r.question;

  const metricsRows = (res_.key_metrics_affected || []).map(m => [
    m.metric, m.estimated_change, m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→',
  ]);

  const report = {
    title: `Marketing Simulator: ${name}`,
    generated_at: r.created_at,
    sections: [
      {
        kind: 'text',
        title: '📋 Scenario',
        body: r.question,
      },
      {
        kind: 'text',
        title: '🧠 Executive Summary',
        body: `Verdict: ${(res_.verdict || '').toUpperCase()}  |  Confidence: ${res_.confidence || 0}%\n\n${res_.executive_summary || ''}`,
      },
      {
        kind: 'table',
        title: '📅 90-Day Timeline',
        headers: ['Period', 'What happens', 'Metric impact'],
        rows: (res_.timeline || []).map(t => [t.period, t.what_happens, t.metric_impact]),
      },
      {
        kind: 'table',
        title: '📊 Metrics Affected',
        headers: ['Metric', 'Estimated change', 'Direction'],
        rows: metricsRows,
      },
      {
        kind: 'text',
        title: '✅ Upsides',
        body: (res_.upsides || []).map((u, i) => `${i + 1}. ${u}`).join('\n'),
      },
      {
        kind: 'text',
        title: '⚠️ Risks',
        body: (res_.risks || []).map((u, i) => `${i + 1}. ${u}`).join('\n'),
      },
      {
        kind: 'text',
        title: '⚡ Recommended Action',
        body: res_.recommended_action || '',
      },
    ],
  };

  const filename = `simulation-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)}.pdf`;
  streamPdf(report, res, filename, { primaryColor: '#8b5cf6', accentColor: '#7c3aed' });
});

module.exports = router;

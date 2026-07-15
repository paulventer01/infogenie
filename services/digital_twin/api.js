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

/* Pull real baseline metrics from ad_campaigns + ad_performance_hourly (last 30 days). */
async function _autoContext(tid) {
  try {
    const p = await _db.getPool();
    const perf = await p.query(
      `SELECT
         c.platform,
         c.name               AS campaign_name,
         c.status,
         c.daily_budget,
         c.currency,
         c.target_roas,
         c.objective,
         SUM(h.spend)         AS total_spend_30d,
         SUM(h.revenue)       AS total_revenue_30d,
         SUM(h.clicks)        AS total_clicks_30d,
         SUM(h.conversions)   AS total_conversions_30d,
         SUM(h.impressions)   AS total_impressions_30d
       FROM ad_campaigns c
       LEFT JOIN ad_performance_hourly h
         ON h.campaign_id = c.id
        AND h.tenant_id   = c.tenant_id
        AND h.bucket_hour >= NOW() - INTERVAL '30 days'
       WHERE c.tenant_id = $1
       GROUP BY c.id, c.platform, c.name, c.status, c.daily_budget, c.currency, c.target_roas, c.objective
       ORDER BY total_spend_30d DESC NULLS LAST
       LIMIT 6`,
      [tid],
    );
    if (!perf.rows.length) return null;

    const lines = perf.rows.map(r => {
      const spend   = parseFloat(r.total_spend_30d   || 0).toFixed(2);
      const revenue = parseFloat(r.total_revenue_30d || 0).toFixed(2);
      const roas    = parseFloat(spend) > 0 ? (parseFloat(revenue) / parseFloat(spend)).toFixed(2) : null;
      const cpa     = parseFloat(r.total_conversions_30d || 0) > 0
        ? (parseFloat(spend) / parseFloat(r.total_conversions_30d)).toFixed(2) : null;
      const parts = [
        `Campaign "${r.campaign_name}" (${r.platform}, ${r.status})`,
        `30d spend: ${r.currency || 'USD'} ${spend}`,
        roas   ? `ROAS: ${roas}x`   : null,
        cpa    ? `CPA: ${r.currency || 'USD'} ${cpa}` : null,
        r.total_conversions_30d > 0 ? `conversions: ${r.total_conversions_30d}` : null,
        r.objective ? `goal: ${r.objective}` : null,
        r.daily_budget ? `daily budget: ${r.currency || 'USD'} ${r.daily_budget}` : null,
      ].filter(Boolean);
      return parts.join(' | ');
    });
    return lines.join('\n');
  } catch { return null; }
}

function _safeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ── Public share HTML view ─────────────────────────────────────────────────*/
function _renderShareHtml(row) {
  const r   = row.results || {};
  const name = _safeHtml(row.scenario_name || row.question);
  const verdictColor = { positive:'#10b981', mixed:'#f59e0b', neutral:'#6b7280', negative:'#ef4444' };
  const col = verdictColor[r.verdict] || '#6b7280';
  const conf = Math.min(100, Math.max(0, r.confidence || 65));

  const timelineHtml = (r.timeline || []).map(t => `
    <tr>
      <td style="padding:8px 12px;font-weight:700;color:#8b5cf6;width:100px;white-space:nowrap">${_safeHtml(t.period)}</td>
      <td style="padding:8px 12px">${_safeHtml(t.what_happens)}</td>
      <td style="padding:8px 12px;color:#6b7280;font-size:.85em">${_safeHtml(t.metric_impact)}</td>
    </tr>`).join('');

  const metricsHtml = (r.key_metrics_affected || []).map(m => {
    const mc  = m.direction==='up'?'#10b981':m.direction==='down'?'#ef4444':'#6b7280';
    const arr = m.direction==='up'?'↑':m.direction==='down'?'↓':'→';
    return `<div style="background:#f9fafb;border-radius:8px;padding:10px 14px;text-align:center;min-width:100px">
      <div style="font-size:.75rem;color:#6b7280">${_safeHtml(m.metric)}</div>
      <div style="font-size:1.05rem;font-weight:700;color:${mc}">${arr} ${_safeHtml(m.estimated_change)}</div>
    </div>`;
  }).join('');

  const upsides = (r.upsides||[]).map(u=>`<li>${_safeHtml(u)}</li>`).join('');
  const risks   = (r.risks  ||[]).map(u=>`<li>${_safeHtml(u)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Marketing Simulator — ${name}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;color:#111827;padding:0}
  .header{background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;padding:32px 24px 24px}
  .header h1{font-size:1.4rem;font-weight:800;margin-bottom:6px}
  .header p{font-size:.9rem;opacity:.8}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:20px 24px;margin:16px auto;max-width:820px}
  h2{font-size:1rem;font-weight:700;margin-bottom:12px;color:#374151}
  table{width:100%;border-collapse:collapse}
  tr:nth-child(even){background:#faf5ff}
  ul{padding-left:18px;color:#374151;font-size:.88rem;line-height:1.8}
  .badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:.75rem;font-weight:700;text-transform:uppercase;color:#fff}
  .ring{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700}
  .metrics{display:flex;flex-wrap:wrap;gap:10px}
  .cta{text-align:center;padding:20px;font-size:.85rem;color:#6b7280}
  .cta a{color:#8b5cf6;font-weight:700;text-decoration:none}
  .action-box{background:#eff6ff;border-radius:8px;padding:14px 16px;font-size:.9rem}
</style>
</head>
<body>
<div class="header">
  <p style="font-size:.75rem;opacity:.7;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">InfoGenie · Marketing Simulator</p>
  <h1>${name}</h1>
  <p>${_safeHtml(row.question)}</p>
  <p style="font-size:.75rem;margin-top:8px;opacity:.6">Generated ${new Date(row.created_at).toLocaleString()}</p>
</div>
<div style="max-width:820px;margin:0 auto;padding:0 16px 48px">
  <div class="card">
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div class="ring" style="background:conic-gradient(${col} ${conf}%,#e5e7eb 0);color:${col}">${conf}</div>
      <div>
        <div style="font-size:.75rem;color:#6b7280;text-transform:uppercase">Confidence score</div>
        <div style="font-size:1.1rem;font-weight:800;margin:4px 0">${_safeHtml(r.scenario_title || row.question)}</div>
        <span class="badge" style="background:${col}">${_safeHtml(r.verdict || 'mixed')}</span>
      </div>
    </div>
    <p style="margin-top:16px;line-height:1.65;color:#374151">${_safeHtml(r.executive_summary || '')}</p>
  </div>

  ${timelineHtml ? `<div class="card">
    <h2>📅 What happens over 90 days</h2>
    <table>${timelineHtml}</table>
  </div>` : ''}

  ${metricsHtml ? `<div class="card">
    <h2>📊 Metrics affected</h2>
    <div class="metrics">${metricsHtml}</div>
  </div>` : ''}

  <div class="card">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <h2 style="color:#10b981">✅ Upsides</h2>
        <ul>${upsides}</ul>
      </div>
      <div>
        <h2 style="color:#ef4444">⚠️ Risks</h2>
        <ul>${risks}</ul>
      </div>
    </div>
  </div>

  ${r.recommended_action ? `<div class="card">
    <h2>⚡ Recommended Action</h2>
    <div class="action-box">${_safeHtml(r.recommended_action)}</div>
  </div>` : ''}

  <div class="cta">
    <a href="/">Run your own simulation with InfoGenie →</a>
  </div>
</div>
</body>
</html>`;
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
  const {
    scenario, question, business_context = {},
    scenario_name, template_id, comparison_group_id,
  } = req.body || {};
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
  let source = 'template';
  if (raw) { try { results = JSON.parse(raw); source = 'openai'; } catch {} }
  results.source = source;

  const p = await _db.getPool();
  const ins = await p.query(
    `INSERT INTO digital_twin_scenarios
       (tenant_id, scenario, question, results, scenario_name, template_id, comparison_group_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, created_at`,
    [
      tid,
      scenario || 'custom',
      q,
      JSON.stringify(results),
      scenario_name || results.scenario_title || q,
      template_id  || null,
      comparison_group_id || null,
    ],
  );
  const row = ins.rows[0];

  if (_kgIngest) {
    _kgIngest({
      tenant_id: tid,
      node_type: 'manual_observation',
      summary: `Marketing Simulator [${results.verdict || 'mixed'}]: ${q}`,
      detail: { verdict: results.verdict, confidence: results.confidence, full_simulation: results },
      importance: 0.6,
    }).catch(() => {});
  }

  res.json({
    ok: true, id: row.id, scenario: scenario || 'custom', question: q,
    results, created_at: row.created_at,
  });
});

/* ── GET /api/digital-twin/history ──────────────────────────────────────────*/
router.get('/history', async (req, res) => {
  const tid = await _tid(req, 'dt:history'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id, scenario, question, results, scenario_name, template_id,
            share_token, comparison_group_id, created_at
       FROM digital_twin_scenarios
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
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

  const ids = scenario_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  if (ids.length < 2) return _err(res, 400, 'invalid scenario_ids');

  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT id, question, scenario_name, results, created_at
       FROM digital_twin_scenarios
      WHERE tenant_id = $1 AND id = ANY($2::int[])`,
    [tid, ids],
  );
  if (rows.rows.length < 2) return _err(res, 404, 'scenarios not found');

  const groupId = _crypto.randomUUID();
  await p.query(
    `UPDATE digital_twin_scenarios SET comparison_group_id = $1
      WHERE tenant_id = $2 AND id = ANY($3::int[])`,
    [groupId, tid, ids],
  );

  const scenarios = rows.rows.map(r => ({
    id:         r.id,
    name:       r.scenario_name || r.question,
    question:   r.question,
    created_at: r.created_at,
    results:    r.results,
  }));

  const verdictOrder = { positive:3, mixed:2, neutral:1, negative:0 };
  const winner = scenarios.reduce((best, s) => {
    const bScore = (verdictOrder[best.results?.verdict] || 0) * 100 + (best.results?.confidence || 0);
    const sScore = (verdictOrder[s.results?.verdict]    || 0) * 100 + (s.results?.confidence   || 0);
    return sScore > bScore ? s : best;
  }, scenarios[0]);

  res.json({ ok: true, comparison_group_id: groupId, scenarios, winner_id: winner.id });
});

/* ── POST /api/digital-twin/scenarios/:id/share ─────────────────────────────*/
router.post('/scenarios/:id/share', async (req, res) => {
  const tid = await _tid(req, 'dt:share'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const check = await p.query(
    `SELECT id, share_token FROM digital_twin_scenarios WHERE id = $1 AND tenant_id = $2`,
    [parseInt(req.params.id, 10), tid],
  );
  if (!check.rows.length) return _err(res, 404, 'not found');

  let token = check.rows[0].share_token;
  if (!token) {
    token = _crypto.randomBytes(16).toString('hex');
    await p.query(
      `UPDATE digital_twin_scenarios SET share_token = $1 WHERE id = $2 AND tenant_id = $3`,
      [token, parseInt(req.params.id, 10), tid],
    );
  }
  const base = process.env.PUBLIC_URL || `https://${process.env.REPL_SLUG}.replit.app`;
  res.json({ ok: true, token, url: `${base}/simulator/share/${token}` });
});

/* ── GET /api/digital-twin/share/:token/view  (public HTML — no auth) ───── */
router.get('/share/:token/view', async (req, res) => {
  const token = (req.params.token || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return res.status(400).send('Invalid token');
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id, question, scenario_name, results, created_at
       FROM digital_twin_scenarios WHERE share_token = $1`,
    [token],
  );
  if (!row.rows.length) return res.status(404).send('Simulation not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_renderShareHtml(row.rows[0]));
});

/* ── GET /api/digital-twin/share/:token  (public JSON — no auth) ─────────── */
router.get('/share/:token', async (req, res) => {
  const token = (req.params.token || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return res.status(400).json({ ok: false, error: 'invalid token' });
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id, question, scenario_name, results, created_at
       FROM digital_twin_scenarios WHERE share_token = $1`,
    [token],
  );
  if (!row.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const r = row.rows[0];
  res.json({ ok: true, id: r.id, question: r.question, scenario_name: r.scenario_name,
             results: r.results, created_at: r.created_at });
});

/* ── GET /api/digital-twin/share/:token/pdf  (public PDF — no auth) ─────── */
router.get('/share/:token/pdf', async (req, res) => {
  const token = (req.params.token || '').replace(/[^a-f0-9]/gi, '');
  if (!token) return _err(res, 400, 'invalid token');
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id, question, scenario_name, results, created_at
       FROM digital_twin_scenarios WHERE share_token = $1`,
    [token],
  );
  if (!row.rows.length) return _err(res, 404, 'not found');
  _streamSimPdf(row.rows[0], res);
});

/* ── GET /api/digital-twin/scenarios/:id/pdf  (auth-gated PDF) ─────────────*/
router.get('/scenarios/:id/pdf', async (req, res) => {
  const tid = await _tid(req, 'dt:pdf'); if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const row = await p.query(
    `SELECT id, question, scenario_name, results, created_at
       FROM digital_twin_scenarios WHERE id = $1 AND tenant_id = $2`,
    [parseInt(req.params.id, 10), tid],
  );
  if (!row.rows.length) return _err(res, 404, 'not found');
  _streamSimPdf(row.rows[0], res);
});

function _streamSimPdf(r, res) {
  const res_  = r.results || {};
  const name  = r.scenario_name || r.question;
  const metricsRows = (res_.key_metrics_affected || []).map(m => [
    m.metric,
    m.estimated_change,
    m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→',
  ]);
  const report = {
    title: `Marketing Simulator: ${name}`,
    generated_at: r.created_at,
    sections: [
      { kind:'text',  title:'📋 Scenario',          body: r.question },
      { kind:'text',  title:'🧠 Executive Summary',  body: `Verdict: ${(res_.verdict||'').toUpperCase()}  |  Confidence: ${res_.confidence||0}%\n\n${res_.executive_summary||''}` },
      { kind:'table', title:'📅 90-Day Timeline',    headers:['Period','What happens','Metric impact'], rows:(res_.timeline||[]).map(t=>[t.period,t.what_happens,t.metric_impact]) },
      { kind:'table', title:'📊 Metrics Affected',   headers:['Metric','Estimated change','Direction'],  rows:metricsRows },
      { kind:'text',  title:'✅ Upsides',             body:(res_.upsides||[]).map((u,i)=>`${i+1}. ${u}`).join('\n') },
      { kind:'text',  title:'⚠️ Risks',              body:(res_.risks  ||[]).map((u,i)=>`${i+1}. ${u}`).join('\n') },
      { kind:'text',  title:'⚡ Recommended Action', body:res_.recommended_action||'' },
    ],
  };
  const filename = `simulation-${name.replace(/[^a-z0-9]+/gi,'-').toLowerCase().slice(0,60)}.pdf`;
  streamPdf(report, res, filename, { primaryColor:'#8b5cf6', accentColor:'#7c3aed' });
}

module.exports = router;

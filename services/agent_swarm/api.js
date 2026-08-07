'use strict';
// Agent Swarm API — T102
// Adds a Marketing Team Briefing Room on top of the existing trigger-chain system.
// Endpoints:
//   GET  /api/swarm/config
//   GET  /api/swarm/configs
//   POST /api/swarm/configs
//   PUT  /api/swarm/configs/:id
//   DELETE /api/swarm/configs/:id
//   POST /api/swarm/trigger
//   GET  /api/swarm/runs
//   GET  /api/swarm/runs/:id
//   GET  /api/swarm/quick-briefings
//   GET  /api/swarm/personas
//   GET  /api/swarm/persona-overrides
//   PUT  /api/swarm/persona-overrides/:id
//   POST /api/swarm/briefing

const express    = require('express');
const _https     = require('https');
const router     = express.Router();
const _db        = require('../../db');
const _tenantCtx = require('../tenants/context');

const TRIGGER_EVENTS = ['competitor_change','ad_rejected','roas_drop','budget_pacing','keyword_spike','content_published','lead_scored','manual'];
const AGENT_TYPES = ['competitor_spy','media_buyer','copywriter','seo_analyst','email_composer','audience_builder','approval_gate','slack_notify','webhook'];

// ── Default agent persona registry ────────────────────────────────────────
// These serve as the static defaults. Per-tenant overrides are stored in
// swarm_persona_overrides and merged at request time.
const DEFAULT_PERSONAS = {
  cmo: {
    id: 'cmo',
    name: 'CMO',
    title: 'Chief Marketing Officer',
    icon: '👑',
    color: '#7C3AED',
    description: 'Strategic marketing leadership, brand positioning, budget allocation, and cross-channel alignment.',
    expertise: ['Strategy', 'Brand', 'Budget', 'Leadership'],
    system_prompt: `You are the Chief Marketing Officer (CMO) of a fast-growing company. You have 20 years of marketing experience across B2B and B2C.
Your expertise: brand strategy, budget allocation, channel mix, competitive positioning, go-to-market planning, and executive communication.
You speak with authority and decisiveness. You think in terms of business outcomes, not just marketing metrics.
When contributing as a specialist, give the CMO-level strategic view. When synthesising, produce a clear prioritised action plan.`,
    model: 'gpt-4o',
    temperature: 0.3,
  },
  seo_director: {
    id: 'seo_director',
    name: 'SEO Director',
    title: 'SEO & Content Director',
    icon: '🔍',
    color: '#059669',
    description: 'Organic search strategy, content marketing, keyword opportunities, and technical SEO guidance.',
    expertise: ['SEO', 'Content', 'Keywords', 'Technical'],
    system_prompt: `You are the SEO & Content Director with deep expertise in organic search, content strategy, and technical SEO.
Your expertise: keyword research, content gap analysis, on-page optimisation, link-building strategy, Core Web Vitals, E-E-A-T, and AI search (GEO/AIO).
You speak in specifics — suggest actual content angles, keyword clusters, and page-level fixes.
Consider the challenge from the angle of: search visibility, content investment ROI, and organic lead quality.`,
    model: 'gpt-4o',
    temperature: 0.3,
  },
  media_buyer: {
    id: 'media_buyer',
    name: 'Media Buyer',
    title: 'Paid Media Director',
    icon: '📣',
    color: '#DC2626',
    description: 'Paid advertising strategy, ROAS optimisation, creative testing, and cross-platform budget management.',
    expertise: ['Paid Ads', 'ROAS', 'Creative', 'Attribution'],
    system_prompt: `You are the Paid Media Director, a performance marketing expert with deep hands-on experience in Meta, Google, TikTok, and LinkedIn Ads.
Your expertise: campaign architecture, audience targeting, creative strategy, bid management, ROAS optimisation, and incrementality testing.
You think in terms of CAC, LTV, ROAS, and marginal returns. You are data-driven and test-and-learn focused.
Consider the challenge from the angle of: ad spend efficiency, audience quality, creative performance, and attribution accuracy.`,
    model: 'gpt-4o',
    temperature: 0.3,
  },
  cro_specialist: {
    id: 'cro_specialist',
    name: 'CRO Specialist',
    title: 'Conversion Rate Optimisation Specialist',
    icon: '🧪',
    color: '#D97706',
    description: 'Landing page optimisation, A/B testing, funnel analysis, and user experience improvements.',
    expertise: ['CRO', 'A/B Testing', 'UX', 'Funnels'],
    system_prompt: `You are the Conversion Rate Optimisation (CRO) Specialist, an expert in turning traffic into customers.
Your expertise: landing page design, A/B and multivariate testing, heatmap analysis, session replay insights, funnel leak identification, and copy optimisation.
You think in terms of CVR, bounce rate, scroll depth, form completion, and micro-conversions.
Consider the challenge from the angle of: where users are dropping off, what friction exists, and what tests would have the highest impact.`,
    model: 'gpt-4o',
    temperature: 0.3,
  },
  data_analyst: {
    id: 'data_analyst',
    name: 'Data Analyst',
    title: 'Marketing Data Analyst',
    icon: '📊',
    color: '#0284C7',
    description: 'Data interpretation, marketing attribution, trend analysis, and performance benchmarking.',
    expertise: ['Analytics', 'Attribution', 'Trends', 'Reporting'],
    system_prompt: `You are the Marketing Data Analyst, the team's evidence-based thinker who grounds strategy in data.
Your expertise: multi-touch attribution, cohort analysis, funnel metrics, marketing mix modelling, A/B test significance, and dashboard design.
You question assumptions, look for confounding variables, and quantify uncertainty. You always cite what data would be needed to confirm a hypothesis.
Consider the challenge from the angle of: what the data says, what data is missing, and what metrics should be tracked to measure success.`,
    model: 'gpt-4o',
    temperature: 0.2,
  },
};

// Quick briefing templates (static config — canonical scenarios)
const QUICK_BRIEFINGS = [
  {
    id: 'competitor_launched',
    name: 'Competitor Just Launched',
    description: 'A key competitor launched a major product or campaign. How do we respond?',
    icon: '🏆',
    default_agents: ['cmo', 'seo_director', 'media_buyer', 'cro_specialist'],
    challenge_template: 'A key competitor just launched a new product/feature/campaign that directly competes with us. Our sales team is already getting questions about it. What should our immediate and 90-day response strategy be?',
  },
  {
    id: 'roas_dropped',
    name: 'ROAS Dropped 30%',
    description: 'Paid ad returns fell sharply. Diagnose the problem and fix it.',
    icon: '📉',
    default_agents: ['media_buyer', 'cro_specialist', 'data_analyst', 'cmo'],
    challenge_template: 'Our blended ROAS has dropped 30% over the past 3 weeks across Meta and Google Ads. CPC is up but conversion rates are flat. CAC has crossed our breakeven point. What is causing this and what do we do?',
  },
  {
    id: 'new_market',
    name: 'Entering a New Market',
    description: 'Planning expansion into a new geography or customer segment.',
    icon: '🌍',
    default_agents: ['cmo', 'seo_director', 'media_buyer', 'data_analyst'],
    challenge_template: 'We are planning to expand into a new market (new geography / new customer segment). We have 90 days and a limited budget. What is our go-to-market strategy across organic, paid, and content channels?',
  },
  {
    id: 'peak_season',
    name: 'Preparing for Peak Season',
    description: 'Build the strategy for your biggest sales period of the year.',
    icon: '🚀',
    default_agents: ['cmo', 'media_buyer', 'cro_specialist', 'seo_director'],
    challenge_template: 'Our peak sales season is 60 days away. Last year we left significant revenue on the table due to poor preparation. What should we be doing right now — across ads, content, landing pages, and offers — to maximise this year\'s peak season revenue?',
  },
];

// ── Resolve effective personas (static defaults + per-tenant DB overrides) ──
async function _resolvePersonas(tenantId) {
  const personas = {};
  for (const [k, v] of Object.entries(DEFAULT_PERSONAS)) {
    personas[k] = { ...v };
  }
  if (!tenantId) return personas;
  try {
    const p = await _db.getPool();
    const rows = await p.query(
      `SELECT persona_id, display_name, system_prompt, model, temperature, is_active
       FROM swarm_persona_overrides WHERE tenant_id=$1`,
      [tenantId]
    );
    for (const row of rows.rows) {
      if (!personas[row.persona_id]) continue;
      if (row.display_name) personas[row.persona_id].name = row.display_name;
      if (row.system_prompt) personas[row.persona_id].system_prompt = row.system_prompt;
      if (row.model) personas[row.persona_id].model = row.model;
      if (row.temperature != null) personas[row.persona_id].temperature = parseFloat(row.temperature);
      if (row.is_active === false) delete personas[row.persona_id];
    }
  } catch (_) {}
  return personas;
}

// ── OpenAI helper (gpt-4o) ────────────────────────────────────────────────
function _openai(messages, opts = {}) {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key || /^_DUMMY/i.test(key)) return Promise.resolve(null);
  const body = JSON.stringify({
    model: opts.model || 'gpt-4o',
    messages,
    response_format: opts.jsonMode ? { type: 'json_object' } : undefined,
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens || 1500,
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
          resolve(text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(60000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// ── Knowledge Graph hook ──────────────────────────────────────────────────
function _kgIngest(tenantId, type, summary, detail, sourceRef, importance = 0.7) {
  try {
    const { ingestMemoryNode } = require('../knowledge_graph/api');
    ingestMemoryNode({ tenant_id: tenantId, node_type: type, summary, detail, source_ref: sourceRef, importance }).catch(() => {});
  } catch (_) {}
}

// ── Existing routes ───────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  res.json({ ok: true, trigger_events: TRIGGER_EVENTS, agent_types: AGENT_TYPES });
});

router.get('/configs', async (req, res) => {
  const tid = await _tid(req, 'swarm:configs');
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM swarm_configs WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]);
  res.json({ ok: true, configs: rows.rows });
});

router.post('/configs', async (req, res) => {
  const tid = await _tid(req, 'swarm:create-config');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { name, description, trigger_event, trigger_conditions, agent_chain, notification_email } = req.body;
  if (!name || !trigger_event || !agent_chain) return _err(res, 400, 'name, trigger_event, agent_chain required');
  const p = await _db.getPool();
  const chain = Array.isArray(agent_chain) ? JSON.stringify(agent_chain) : agent_chain;
  const r = await p.query(
    `INSERT INTO swarm_configs(tenant_id,name,description,trigger_event,trigger_conditions,agent_chain,notification_email)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tid, name, description || null, trigger_event, trigger_conditions || null, chain, notification_email || null]
  );
  res.json({ ok: true, config: r.rows[0] });
});

router.put('/configs/:id', async (req, res) => {
  const tid = await _tid(req, 'swarm:update-config');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { name, description, trigger_conditions, agent_chain, notification_email, is_active } = req.body;
  const p = await _db.getPool();
  const chain = agent_chain ? (Array.isArray(agent_chain) ? JSON.stringify(agent_chain) : agent_chain) : null;
  const r = await p.query(
    `UPDATE swarm_configs SET
       name=COALESCE($1,name), description=COALESCE($2,description),
       trigger_conditions=COALESCE($3,trigger_conditions),
       agent_chain=COALESCE($4,agent_chain),
       notification_email=COALESCE($5,notification_email),
       is_active=COALESCE($6,is_active), updated_at=NOW()
     WHERE id=$7 AND tenant_id=$8 RETURNING *`,
    [name || null, description || null, trigger_conditions || null, chain, notification_email || null,
     is_active != null ? is_active : null, req.params.id, tid]
  );
  if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, config: r.rows[0] });
});

router.delete('/configs/:id', async (req, res) => {
  const tid = await _tid(req, 'swarm:delete-config');
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  await p.query(`DELETE FROM swarm_configs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  res.json({ ok: true });
});

router.post('/trigger', async (req, res) => {
  const tid = await _tid(req, 'swarm:trigger');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { event_type, event_data, config_id } = req.body;
  if (!event_type) return _err(res, 400, 'event_type required');
  const p = await _db.getPool();

  let config = null;
  if (config_id) {
    const cr = await p.query(`SELECT * FROM swarm_configs WHERE id=$1 AND tenant_id=$2 AND is_active=TRUE`, [config_id, tid]);
    config = cr.rows[0] || null;
  } else {
    const cr = await p.query(`SELECT * FROM swarm_configs WHERE tenant_id=$1 AND trigger_event=$2 AND is_active=TRUE LIMIT 1`, [tid, event_type]);
    config = cr.rows[0] || null;
  }

  let chain = [];
  if (config) {
    try { chain = JSON.parse(config.agent_chain || '[]'); } catch (e) { chain = []; }
  } else {
    chain = [
      { agent_type: 'competitor_spy', step_name: 'Gather competitive intelligence' },
      { agent_type: 'copywriter', step_name: 'Draft counter-messaging' },
      { agent_type: 'approval_gate', step_name: 'Push to approval queue' },
    ];
  }

  const run = await p.query(
    `INSERT INTO swarm_runs(tenant_id,config_id,config_name,trigger_event,trigger_data,status,steps_total,run_type)
     VALUES($1,$2,$3,$4,$5,'running',$6,'trigger') RETURNING *`,
    [tid, config?.id || null, config?.name || 'Ad-hoc run', event_type, JSON.stringify(event_data || {}), chain.length]
  );
  const runId = run.rows[0].id;
  const stepResults = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    let output = '';
    try {
      const prompt = `You are the ${step.agent_type} agent in a multi-agent marketing swarm.
Trigger event: ${event_type}
Event data: ${JSON.stringify(event_data || {})}
Previous steps: ${JSON.stringify(stepResults)}
Your task: ${step.step_name}
Execute your role and return a concrete output. Be specific and actionable.
Return strict JSON: {"output":"...","action_taken":"...","next_recommendation":"...","confidence_pct":80}`;
      const raw = await _openai([{ role: 'user', content: prompt }], { jsonMode: true, model: 'gpt-4o', temperature: 0.3 });
      const parsed = raw ? JSON.parse(raw) : null;
      output = parsed?.output || '';
      stepResults.push({ step: step.step_name, agent: step.agent_type, result: parsed || { output, action_taken: 'completed' } });
    } catch (e) {
      output = `${step.agent_type} executed: ${step.step_name}`;
      stepResults.push({ step: step.step_name, agent: step.agent_type, result: { output, action_taken: 'completed' } });
    }
    await p.query(
      `INSERT INTO swarm_steps(run_id,tenant_id,step_order,step_name,agent_type,input_summary,output_summary,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'completed')`,
      [runId, tid, i + 1, step.step_name, step.agent_type, JSON.stringify(event_data || {}).slice(0, 300), output.slice(0, 500)]
    );
  }

  let summary = `Swarm completed ${chain.length} agent steps for ${event_type} event.`;
  try {
    const raw = await _openai([{ role: 'user', content: `Summarise in 1 sentence what this agent swarm accomplished: ${JSON.stringify(stepResults)}` }], { model: 'gpt-4o' });
    if (raw) summary = raw;
  } catch (e) {}

  await p.query(
    `UPDATE swarm_runs SET status='completed', steps_completed=$1, summary=$2, completed_at=NOW() WHERE id=$3`,
    [chain.length, summary, runId]
  );
  if (config) await p.query(`UPDATE swarm_configs SET run_count=run_count+1, last_run_at=NOW() WHERE id=$1`, [config.id]);

  try {
    const { logAction } = require('../roi_ledger/logger');
    await logAction(tid, {
      action_type: 'swarm_completed', module: 'agent_swarm',
      title: `Agent swarm completed: ${event_type} (${chain.length} agents)`,
      description: summary, estimated_value: chain.length * 65,
      metadata: { run_id: runId, event_type, steps: chain.length },
    });
  } catch (e) {}

  _kgIngest(tid, 'ai_synthesis',
    `AI agent swarm completed: ${event_type} — ${summary}`,
    { run_id: runId, event_type, steps: chain.length },
    `swarm:${runId}`, 0.55
  );

  res.json({ ok: true, run_id: runId, steps: stepResults, summary });
});

// ── GET /quick-briefings — returns the 4 pre-built scenarios ─────────────
router.get('/quick-briefings', async (req, res) => {
  const tid = await _tid(req, 'swarm:quick-briefings');
  if (!tid) return _err(res, 400, 'no_tenant');
  res.json({ ok: true, quick_briefings: QUICK_BRIEFINGS });
});

// ── GET /personas — returns effective personas (defaults merged with overrides) ──
router.get('/personas', async (req, res) => {
  const tid = await _tid(req, 'swarm:personas');
  if (!tid) return _err(res, 400, 'no_tenant');
  const personas = await _resolvePersonas(tid);
  const safe = Object.values(personas).map(({ id, name, title, icon, color, description, expertise }) =>
    ({ id, name, title, icon, color, description, expertise })
  );
  res.json({ ok: true, personas: safe });
});

// ── GET /persona-overrides — returns raw per-tenant overrides ─────────────
router.get('/persona-overrides', async (req, res) => {
  const tid = await _tid(req, 'swarm:persona-overrides');
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const rows = await p.query(
    `SELECT persona_id, display_name, system_prompt, model, temperature, is_active, updated_at
     FROM swarm_persona_overrides WHERE tenant_id=$1`,
    [tid]
  );
  res.json({ ok: true, overrides: rows.rows, defaults: Object.fromEntries(
    Object.entries(DEFAULT_PERSONAS).map(([k, v]) => [k, { model: v.model, temperature: v.temperature, system_prompt: v.system_prompt }])
  )});
});

// ── PUT /persona-overrides/:persona_id — upsert a persona override ─────────
router.put('/persona-overrides/:persona_id', async (req, res) => {
  const tid = await _tid(req, 'swarm:persona-override-put');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { persona_id } = req.params;
  if (!DEFAULT_PERSONAS[persona_id]) return _err(res, 400, 'unknown persona_id');
  const { display_name, system_prompt, model, temperature, is_active } = req.body || {};
  const ALLOWED_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  if (model && !ALLOWED_MODELS.includes(model)) return _err(res, 400, `model must be one of: ${ALLOWED_MODELS.join(', ')}`);
  if (temperature != null && (isNaN(Number(temperature)) || Number(temperature) < 0 || Number(temperature) > 2)) {
    return _err(res, 400, 'temperature must be 0–2');
  }
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO swarm_persona_overrides(tenant_id, persona_id, display_name, system_prompt, model, temperature, is_active, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT(tenant_id, persona_id) DO UPDATE SET
       display_name=COALESCE(EXCLUDED.display_name, swarm_persona_overrides.display_name),
       system_prompt=COALESCE(EXCLUDED.system_prompt, swarm_persona_overrides.system_prompt),
       model=COALESCE(EXCLUDED.model, swarm_persona_overrides.model),
       temperature=COALESCE(EXCLUDED.temperature, swarm_persona_overrides.temperature),
       is_active=COALESCE(EXCLUDED.is_active, swarm_persona_overrides.is_active),
       updated_at=NOW()`,
    [tid, persona_id, display_name || null, system_prompt || null, model || null,
     temperature != null ? Number(temperature) : null, is_active != null ? is_active : null]
  );
  res.json({ ok: true });
});

// ── DELETE /persona-overrides/:persona_id — reset persona to defaults ──────
router.delete('/persona-overrides/:persona_id', async (req, res) => {
  const tid = await _tid(req, 'swarm:persona-override-delete');
  if (!tid) return _err(res, 400, 'no_tenant');
  const { persona_id } = req.params;
  const p = await _db.getPool();
  await p.query(`DELETE FROM swarm_persona_overrides WHERE tenant_id=$1 AND persona_id=$2`, [tid, persona_id]);
  res.json({ ok: true });
});

// ── POST /briefing — runs multi-agent strategy session ───────────────────
// ALL selected agents contribute as specialists (sequentially, building on prior context).
// CMO always runs a dedicated synthesis pass at the end regardless of selection.
router.post('/briefing', async (req, res) => {
  const tid = await _tid(req, 'swarm:briefing');
  if (!tid) return _err(res, 400, 'no_tenant');

  if (!(req.user || req.apiKeyUser || req.viaApiKey)) return _err(res, 401, 'auth required');

  const { challenge, agents = Object.keys(DEFAULT_PERSONAS), quick_briefing_id } = req.body || {};
  if (!challenge || typeof challenge !== 'string' || challenge.trim().length < 10) {
    return _err(res, 400, 'challenge must be at least 10 characters');
  }
  const challengeText = challenge.trim().slice(0, 2000);

  // Resolve effective personas (with per-tenant overrides)
  const AGENT_PERSONAS = await _resolvePersonas(tid);

  // Validate & resolve agent list — ALL selected agents run as specialists
  const agentIds = (Array.isArray(agents) ? agents : Object.keys(DEFAULT_PERSONAS))
    .filter(id => AGENT_PERSONAS[id])
    .slice(0, 5);
  if (!agentIds.length) return _err(res, 400, 'at least one valid agent required');

  // CMO persona is always used for the final synthesis pass
  const cmoPersona = AGENT_PERSONAS['cmo'] || DEFAULT_PERSONAS['cmo'];

  const p = await _db.getPool();
  // steps_total = number of specialists + 1 (synthesis pass)
  const runRow = await p.query(
    `INSERT INTO swarm_runs(tenant_id,config_name,trigger_event,trigger_data,status,steps_total,run_type)
     VALUES($1,'Marketing Team Briefing','briefing',$2,'running',$3,'briefing') RETURNING id,started_at`,
    [tid, JSON.stringify({ challenge: challengeText, quick_briefing_id: quick_briefing_id || null }), agentIds.length + 1]
  );
  const runId = runRow.rows[0].id;

  const agentContributions = [];
  let priorContext = '';

  // Run ALL selected agents sequentially as specialists
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    const persona = AGENT_PERSONAS[agentId];
    const step = i + 1;

    let contribution = null;
    try {
      const userMsg = `STRATEGIC CHALLENGE: ${challengeText}

${priorContext ? `PRIOR TEAM INPUT:\n${priorContext}\n` : ''}
Now provide your specialist perspective on this challenge. Be specific, actionable, and build on prior input where relevant.

Return strict JSON:
{
  "perspective": "Your 2-3 sentence specialist view on the challenge",
  "recommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"],
  "quick_wins": ["action achievable in <2 weeks"],
  "risks_to_flag": ["key risk or blind spot from your area of expertise"],
  "confidence": 0-100,
  "key_metric": "The single metric you'd watch to measure success"
}`;

      const raw = await _openai(
        [{ role: 'system', content: persona.system_prompt }, { role: 'user', content: userMsg }],
        { model: persona.model, temperature: persona.temperature, jsonMode: true, maxTokens: 800 }
      );
      contribution = raw ? JSON.parse(raw) : null;
    } catch (e) { contribution = null; }

    // Template fallback
    if (!contribution) {
      contribution = {
        perspective: `As ${persona.title}, I would analyse this challenge through the lens of ${persona.expertise.join(', ')}.`,
        recommendations: [
          `Audit current ${persona.expertise[0].toLowerCase()} performance against benchmarks`,
          `Identify the top 3 quick wins within the ${persona.expertise[0].toLowerCase()} domain`,
          `Develop a 90-day roadmap with measurable milestones`,
        ],
        quick_wins: [`Run a ${persona.expertise[0].toLowerCase()} diagnostic in the next 48 hours`],
        risks_to_flag: [`Without proper ${persona.expertise[0].toLowerCase()} data, strategy will be based on assumptions`],
        confidence: 42,
        key_metric: `${persona.expertise[0]} performance score`,
      };
    }

    agentContributions.push({ id: agentId, name: persona.name, title: persona.title, icon: persona.icon, color: persona.color, contribution });
    priorContext += `\n${persona.title.toUpperCase()} says:\n- Perspective: ${contribution.perspective}\n- Recommendations: ${contribution.recommendations.join('; ')}\n`;

    await p.query(
      `INSERT INTO swarm_steps(run_id,tenant_id,step_order,step_name,agent_type,input_summary,output_summary,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'completed')`,
      [runId, tid, step, `${persona.title} analysis`, agentId,
       challengeText.slice(0, 300),
       JSON.stringify(contribution).slice(0, 500)]
    );
  }

  // Dedicated CMO synthesis pass (always runs, even if CMO was a specialist above)
  let synthesis = null;
  try {
    const synthMsg = `STRATEGIC CHALLENGE: ${challengeText}

FULL TEAM INPUT:
${agentContributions.map(a => `${a.title.toUpperCase()}:\n- Perspective: ${a.contribution.perspective}\n- Recommendations: ${a.contribution.recommendations.join('; ')}\n- Quick wins: ${(a.contribution.quick_wins || []).join('; ')}\n- Risks: ${(a.contribution.risks_to_flag || []).join('; ')}`).join('\n\n')}

As CMO, synthesise all team input into a unified executive strategy. Be decisive and prioritised.

Return strict JSON:
{
  "executive_summary": "2-3 sentence overall strategic direction",
  "priority_actions": [
    { "action": "specific action", "owner": "team role", "timeline": "e.g. Week 1-2", "expected_impact": "what this achieves" }
  ],
  "confidence": 0-100,
  "rationale": "Why this is the right approach (2-3 sentences)",
  "success_metrics": ["metric 1", "metric 2", "metric 3"],
  "biggest_risk": "The single biggest risk to this strategy and how to mitigate it"
}`;

    const raw = await _openai(
      [{ role: 'system', content: cmoPersona.system_prompt }, { role: 'user', content: synthMsg }],
      { model: cmoPersona.model, temperature: cmoPersona.temperature, jsonMode: true, maxTokens: 1200 }
    );
    synthesis = raw ? JSON.parse(raw) : null;
  } catch (e) { synthesis = null; }

  if (!synthesis) {
    synthesis = {
      executive_summary: 'Template synthesis — connect AI providers for full CMO-level strategic analysis. The team has identified key perspectives across all marketing disciplines.',
      priority_actions: [
        { action: 'Consolidate team recommendations into a 90-day plan', owner: 'CMO', timeline: 'Week 1', expected_impact: 'Alignment and prioritisation' },
        { action: 'Launch quick-win initiatives identified by specialists', owner: 'All', timeline: 'Week 1-2', expected_impact: 'Early momentum and learning' },
        { action: 'Set up measurement framework for all initiatives', owner: 'Data Analyst', timeline: 'Week 2', expected_impact: 'Data-driven decision making' },
      ],
      confidence: 38,
      rationale: 'A multi-disciplinary approach combining all specialist inputs gives the highest probability of success. Quick wins build confidence while longer-term strategies compound.',
      success_metrics: ['Blended ROAS improvement', 'CAC reduction', 'Organic traffic growth'],
      biggest_risk: 'Lack of execution focus — trying to do everything at once. Prioritise ruthlessly.',
    };
  }

  // Record synthesis step
  await p.query(
    `INSERT INTO swarm_steps(run_id,tenant_id,step_order,step_name,agent_type,input_summary,output_summary,status)
     VALUES($1,$2,$3,$4,'cmo',$5,$6,'completed')`,
    [runId, tid, agentIds.length + 1, 'CMO Strategy Synthesis',
     `${agentIds.length} specialist contributions`,
     JSON.stringify(synthesis).slice(0, 500)]
  );

  // Persist session output
  const sessionOutput = {
    session_id: runId,
    challenge: challengeText,
    quick_briefing_id: quick_briefing_id || null,
    agents: agentContributions,
    synthesis,
    created_at: runRow.rows[0].started_at,
  };

  const summaryText = synthesis.executive_summary || `Briefing complete — ${agentContributions.length} agents contributed.`;
  await p.query(
    `UPDATE swarm_runs SET status='completed', steps_completed=$1, summary=$2, session_output=$3, completed_at=NOW() WHERE id=$4`,
    [agentIds.length + 1, summaryText, JSON.stringify(sessionOutput), runId]
  );

  // KG ingest — fire-and-forget
  _kgIngest(tid, 'ai_synthesis',
    `Marketing team briefing — CMO synthesis: ${summaryText}`,
    { session_id: runId, challenge: challengeText.slice(0, 200), priority_actions: synthesis.priority_actions?.slice(0, 3), confidence: synthesis.confidence },
    `swarm:briefing:${runId}`,
    Math.min(1, (synthesis.confidence || 50) / 100)
  );

  try {
    const { logAction } = require('../roi_ledger/logger');
    await logAction(tid, {
      action_type: 'briefing_completed', module: 'agent_swarm',
      title: `Marketing team briefing: ${agentContributions.length} agents — ${challengeText.slice(0, 60)}`,
      description: summaryText, estimated_value: agentContributions.length * 120,
      metadata: { session_id: runId, agents: agentContributions.map(a => a.id) },
    });
  } catch (e) {}

  res.json({ ok: true, ...sessionOutput });
});

// ── GET /runs — list runs, filterable by type, date range, and search ─────
router.get('/runs', async (req, res) => {
  const tid = await _tid(req, 'swarm:runs');
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();

  const type = ['trigger', 'briefing'].includes(req.query.type) ? req.query.type : null;
  const q = req.query.q ? String(req.query.q).trim().slice(0, 200) : null;
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;

  const conditions = ['tenant_id=$1'];
  const params = [tid];

  if (type) { params.push(type); conditions.push(`run_type=$${params.length}`); }
  if (q) { params.push(`%${q}%`); conditions.push(`(summary ILIKE $${params.length} OR trigger_data ILIKE $${params.length} OR config_name ILIKE $${params.length})`); }
  if (from && !isNaN(from)) { params.push(from.toISOString()); conditions.push(`started_at>=$${params.length}`); }
  if (to && !isNaN(to)) { params.push(to.toISOString()); conditions.push(`started_at<=$${params.length}`); }

  const sql = `SELECT id, config_name, trigger_event, run_type, status, steps_completed, steps_total,
                      summary, session_output, started_at, completed_at
               FROM swarm_runs WHERE ${conditions.join(' AND ')}
               ORDER BY started_at DESC LIMIT 50`;
  const rows = await p.query(sql, params);
  res.json({ ok: true, runs: rows.rows });
});

router.get('/runs/:id', async (req, res) => {
  const tid = await _tid(req, 'swarm:run-detail');
  if (!tid) return _err(res, 400, 'no_tenant');
  const p = await _db.getPool();
  const [run, steps] = await Promise.all([
    p.query(`SELECT * FROM swarm_runs WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]),
    p.query(`SELECT * FROM swarm_steps WHERE run_id=$1 ORDER BY step_order`, [req.params.id])
  ]);
  if (!run.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, run: run.rows[0], steps: steps.rows });
});

module.exports = router;

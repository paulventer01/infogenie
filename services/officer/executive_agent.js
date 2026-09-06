'use strict';
/**
 * AI Executive Agent Runtime
 *
 * Every AI Team roster member runs through this shared agent stack so they can
 * reason independently, call tools, recall memory (RAG), and return intelligent
 * feedback for their area of responsibility.
 *
 * Skill pack mirrors the AI Agent Development blueprint:
 * Foundations · LLMs · Frameworks · Agent Skills · Databases · APIs · Deployment
 *
 * Implementation uses InfoGenie's existing OpenAI function-calling loop,
 * PostgreSQL snapshots, and Marketing Memory retrieval (no LangChain dependency).
 */

const _db = require('../../db');

const AGENT_SKILL_PACK = {
  foundations: ['Python', 'JavaScript', 'Git'],
  llms: ['OpenAI GPT', 'Claude', 'Gemini', 'Llama'],
  frameworks: [
    'LangChain-style tool chains',
    'LangGraph-style stateful loops',
    'LlamaIndex-style retrieval over workspace data',
  ],
  agentSkills: [
    'Prompt Engineering',
    'Tool Calling',
    'Function Calling',
    'RAG',
    'Memory',
    'Multi-Agent Systems',
  ],
  databases: ['Vector DB (pgvector / Pinecone patterns)', 'ChromaDB / FAISS patterns', 'PostgreSQL'],
  apis: ['REST API', 'GraphQL', 'MCP (Model Context Protocol)'],
  deployment: ['Docker', 'FastAPI patterns', 'Vercel', 'AWS'],
};

const OFFICER_SPECIALTIES = {
  marketing: 'campaign strategy, budget allocation, creative briefs, channel mix, competitive response',
  sales: 'pipeline health, lead qualification (BANT), outbound, re-engagement, CRM hygiene',
  analyst: 'attribution, KPI anomalies, blended ROAS/MER, cohort insight, data integrity',
  content: 'editorial calendar, content scoring, social distribution, brand voice, repurposing',
  seo: 'rankings, on-page/GEO, keywords, technical SEO, AI-search visibility',
  cro: 'experiments, landing conversion, A/B design, funnel drop-offs',
  finance: 'P&L, CAC, LTV/CAC, runway, channel efficiency, cash-risk from ad spend',
  ops: 'campaign QA, asset library, lead routing, goals on/off track, weekly ops hygiene',
  technical:
    'platform integrity, APIs, LLMs/gateway, auth/sessions, credential vault, security, readiness',
};

/**
 * 8 strategic thinking & decision-making modes (applied by every executive).
 * Each mode has a persona + instruction for intelligent reasoning/feedback.
 */
const STRATEGIC_THINKING_MODES = {
  stress_test: {
    id: 'stress_test',
    label: 'Stress-Test My Thinking',
    persona: 'reasoning analyst',
    instruction:
      'Evaluate logic, assumptions, and potential flaws. Pressure-test the thinking — do NOT invent a brand-new plan. Call out weak premises and missing evidence.',
    template: 'This is the plan I’m working on: [idea / plan / strategy]',
  },
  shift_perspective: {
    id: 'shift_perspective',
    label: 'Shift the Perspective',
    persona: 'perspective strategist',
    instruction:
      'Explore alternate framings: new audience, different emotional driver, shifted brand message, or channel angle — while staying useful for this officer’s domain.',
    template: 'Here’s the main idea I’m working with: [idea]',
  },
  translate_gut: {
    id: 'translate_gut',
    label: 'Translate My Gut Feeling',
    persona: 'clarity finder',
    instruction:
      'Articulate what feels off: confusion, mixed signals, misplaced tactics, or brand inconsistency. Name the discomfort precisely.',
    template: 'Something about this doesn’t feel right: [situation / message / tactic]',
  },
  organize_thoughts: {
    id: 'organize_thoughts',
    label: 'Organize My Messy Thoughts',
    persona: 'structure builder',
    instruction:
      'Turn rough notes into a clear outline. Keep the user’s tone. Prefer structure over adding net-new ideas unless a gap blocks clarity.',
    template: 'Here’s a rough mix of thoughts and notes: [notes]',
  },
  face_decision: {
    id: 'face_decision',
    label: 'Help Me Face the Decision',
    persona: 'decision coach',
    instruction:
      'Show where the user may be stalling, overthinking, or avoiding a clear choice. Reflect what is keeping them stuck and propose a decisive next move.',
    template: 'Here’s the situation I’m dealing with: [project / context]',
  },
  deeper_question: {
    id: 'deeper_question',
    label: 'Surface the Deeper Question',
    persona: 'strategic advisor',
    instruction:
      'Uncover the core question behind the ask. Identify the bigger issue or choice that should really be in focus.',
    template: 'Here’s the situation I’m working through: [idea / challenge]',
  },
  execution_risks: {
    id: 'execution_risks',
    label: 'Spot Execution Risks',
    persona: 'operations analyst',
    instruction:
      'Review the plan for where it could fall apart: timelines, resources, coordination, dependencies, data gaps, or delivery blockers.',
    template: 'Here’s the plan I’m about to put into action: [strategy / outline]',
  },
  sense_instinct: {
    id: 'sense_instinct',
    label: 'Make Sense of My Instinct',
    persona: 'reasoning guide',
    instruction:
      'Explore what is behind the instinct: signals, patterns, prior results, or logic that may be driving the lean — separate signal from bias.',
    template: 'Here’s the idea I’m leaning toward, and it feels right: [idea / insight]',
  },
};

/** Domain → connected tool stack (agentic OS “Business Tools” layer). */
const DOMAIN_TOOL_STACK = {
  marketing: [
    'Google Ads', 'Meta Ads', 'TikTok Ads', 'LinkedIn Ads',
    'Google Analytics', 'Search Console', 'Google Business Profile',
  ],
  sales: [
    'HubSpot', 'Salesforce', 'Pipedrive', 'Apollo', 'Calendly', 'Google Calendar',
  ],
  ops: [
    'Asana', 'ClickUp', 'Monday.com', 'Airtable', 'Jira', 'Slack', 'Microsoft Teams',
  ],
  follow_up: [
    'Gmail', 'Outlook', 'Twilio', 'WhatsApp', 'Intercom', 'HubSpot', 'Mailchimp', 'DocuSign',
  ],
  finance: [
    'Stripe', 'QuickBooks', 'Xero', 'Ramp', 'Expensify', 'Google Sheets', 'Power BI',
  ],
  content: ['Content Calendar', 'Social Publisher', 'Content Scorer', 'Brand Voice'],
  seo: ['SEO Auditor', 'GEO Audit', 'Search Console', 'Keyword Map', 'Rank Tracker'],
  cro: ['CRO Lab', 'A/B Designer', 'Conversion Boosters', 'Heatmaps'],
  analyst: ['Cross-Channel Report', 'Attribution', 'Analytics Hub', 'Amplitude'],
  technical: ['APIs', 'LLM Gateway', 'Credential Vault', 'Auth/Sessions', 'MCP / Integrations'],
};

function resolveThinkingMode(modeId) {
  const key = String(modeId || '').trim().toLowerCase().replace(/-/g, '_');
  if (STRATEGIC_THINKING_MODES[key]) return STRATEGIC_THINKING_MODES[key];
  return STRATEGIC_THINKING_MODES.deeper_question;
}

function domainStackForRole(role) {
  const r = String(role || '').toLowerCase();
  if (DOMAIN_TOOL_STACK[r]) return DOMAIN_TOOL_STACK[r];
  if (r === 'sales') return DOMAIN_TOOL_STACK.sales;
  return DOMAIN_TOOL_STACK.marketing;
}

/**
 * Tool-grounded structured advice when LLM is unavailable — still applies
 * the selected strategic thinking mode for intelligent feedback.
 */
function buildStrategicOfflineAdvice({ role, title, goal, tasks, snap, thinkingMode }) {
  const mode = resolveThinkingMode(thinkingMode);
  const specialty = OFFICER_SPECIALTIES[role] || title;
  const stack = domainStackForRole(role);
  const g = String(goal || '').trim();
  const taskLine = Array.isArray(tasks) && tasks.length ? tasks[0] : null;
  const signals = `Workspace signals: ${snap?.activeProjects ?? 0} active projects, ${snap?.adCampaigns_total ?? 0} campaigns, ${snap?.leadsLinksell_last7d ?? 0} leads/7d, ${snap?.bookings_last7d ?? 0} bookings/7d.`;

  const modeBlocks = {
    stress_test: {
      assessment: `As a ${mode.persona} (${title}), I stress-tested “${g.slice(0, 140)}” for ${specialty}. ${signals} Assumptions that need evidence: that current channel mix is still efficient, and that assigned responsibilities are actually moving.`,
      suggestions: [
        { title: 'Name the unproven assumption', detail: 'Pick one claim in the plan and attach a metric from Cross-Channel / Analytics before scaling spend.', priority: 'high' },
        { title: 'Pressure-test with a kill criterion', detail: 'Define what result in 7 days would force a pause or rewrite.', priority: 'high' },
        taskLine
          ? { title: 'Tie a responsibility to the test', detail: taskLine, priority: 'med' }
          : { title: 'Assign a falsifiable task', detail: 'Open Tasks and add one responsibility that produces measurable evidence.', priority: 'med' },
      ],
    },
    shift_perspective: {
      assessment: `As a ${mode.persona}, reframing “${g.slice(0, 140)}” for ${specialty}. ${signals} Consider a different audience slice, emotional driver, or proof point than the default brand message.`,
      suggestions: [
        { title: 'Reframe for a secondary ICP', detail: 'Rewrite the offer for one adjacent segment and A/B the hook.', priority: 'high' },
        { title: 'Change the emotional driver', detail: 'Swap fear-of-missing-out vs proof-led trust and test creative.', priority: 'med' },
        { title: 'Reuse connected stack creatively', detail: `Lean on ${stack.slice(0, 3).join(', ')} for a fresh distribution angle.`, priority: 'med' },
      ],
    },
    translate_gut: {
      assessment: `As a ${mode.persona}, the discomfort around “${g.slice(0, 140)}” likely comes from mixed signals or missing proof in ${specialty}. ${signals}`,
      suggestions: [
        { title: 'Isolate the confusing signal', detail: 'Separate message, offer, and CTA — which one feels off?', priority: 'high' },
        { title: 'Check brand/voice consistency', detail: 'Compare against Brand Voice / recent creatives for tone drift.', priority: 'med' },
        { title: 'Validate with one live metric', detail: 'If CTR/reply rate is weak, the gut is probably about clarity, not volume.', priority: 'med' },
      ],
    },
    organize_thoughts: {
      assessment: `As a ${mode.persona}, here is a clean outline for “${g.slice(0, 140)}” in ${specialty} without inventing a new strategy. ${signals}`,
      suggestions: [
        { title: 'Section 1 — Goal', detail: 'One sentence outcome for this week.', priority: 'high' },
        { title: 'Section 2 — Evidence', detail: 'List only facts from workspace/tools (campaigns, leads, bookings).', priority: 'high' },
        { title: 'Section 3 — Next 3 actions', detail: taskLine || 'Assign tasks so each action has an owner responsibility.', priority: 'med' },
      ],
    },
    face_decision: {
      assessment: `As a ${mode.persona}, stall risk on “${g.slice(0, 140)}” looks like overthinking vs choosing a single path in ${specialty}. ${signals}`,
      suggestions: [
        { title: 'Force a binary choice', detail: 'Option A vs Option B — pick one for 7 days with a review date.', priority: 'high' },
        { title: 'Name the avoidance', detail: 'What bad outcome are you protecting against by not deciding?', priority: 'high' },
        { title: 'Ship a reversible move', detail: 'Prefer a change you can undo (creative, bid, sequence) over a permanent cut.', priority: 'med' },
      ],
    },
    deeper_question: {
      assessment: `As a ${mode.persona}, the surface ask “${g.slice(0, 140)}” likely hides a deeper choice in ${specialty}: what should we optimize for (growth, efficiency, proof, or risk control)? ${signals}`,
      suggestions: [
        { title: 'State the real question', detail: 'Is this about more demand, better conversion, or cleaner attribution?', priority: 'high' },
        { title: 'Align metrics to that question', detail: 'Pick one north-star KPI for the next sprint.', priority: 'high' },
        { title: 'Consult a peer agent', detail: 'Use multi-agent consult (Analyst / Finance / Ops) before locking the frame.', priority: 'med' },
      ],
    },
    execution_risks: {
      assessment: `As a ${mode.persona}, execution risk on “${g.slice(0, 140)}” in ${specialty}: timelines, ownership, and connected-tool readiness. ${signals}`,
      suggestions: [
        { title: 'Call out the critical path', detail: 'What single dependency (creative, CRM, tracking) can stop launch?', priority: 'high' },
        { title: 'Check connected stack gaps', detail: `Confirm access for: ${stack.slice(0, 4).join(', ')}.`, priority: 'high' },
        { title: 'Add an ops checkpoint', detail: 'Schedule a mid-week QA on assets, UTMs, and lead routing.', priority: 'med' },
      ],
    },
    sense_instinct: {
      assessment: `As a ${mode.persona}, the lean toward “${g.slice(0, 140)}” may be driven by pattern recognition in ${specialty} — prior wins, recent signals, or bias. ${signals}`,
      suggestions: [
        { title: 'Separate signal from preference', detail: 'List 2 data signals that support the instinct and 1 that challenges it.', priority: 'high' },
        { title: 'Recall prior memory', detail: 'Check Marketing Memory / past campaigns for similar bets.', priority: 'med' },
        { title: 'Run a small confirming test', detail: 'Validate the instinct with a low-budget or limited-audience experiment.', priority: 'med' },
      ],
    },
  };

  const block = modeBlocks[mode.id] || modeBlocks.deeper_question;
  return {
    assessment: block.assessment,
    suggestions: block.suggestions,
    risks: [
      (snap?.adCampaigns_total == null || snap?.adCampaigns_total === 0)
        ? 'Sparse workspace data — keep recommendations provisional until ads/CRM integrations feed the connected stack.'
        : 'Watch for stale dashboards before reallocating budget or pausing channels.',
      `Mode focus (${mode.label}): incomplete application of the thinking lens if tool data is thin.`,
    ],
    nextChecks: [
      `Re-run Ask Agent in “${mode.label}” after OpenAI is available for full tool-loop reasoning`,
      'Open Daily Report for task-level evidence',
      `Review connected tools for this domain: ${stack.slice(0, 5).join(', ')}`,
    ],
    reasoning: [
      `Orchestrator assigned thinking mode: ${mode.label} (${mode.persona})`,
      'Loaded workspace snapshot from the connected stack',
      `Applied ${title} specialty: ${specialty}`,
      'Human provides vision/quality; agent returns structured feedback for decision',
    ],
    deeperQuestion: mode.id === 'deeper_question'
      ? 'What outcome are we actually optimizing for this week — growth, efficiency, proof, or risk control?'
      : undefined,
    thinkingMode: mode.id,
    thinkingModeLabel: mode.label,
  };
}

const EXECUTIVE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_workspace_snapshot',
      description:
        'Load real workspace activity counts (campaigns, leads, bookings, content calendar, projects) to ground your reasoning.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_marketing_memory',
      description:
        'RAG over Marketing Memory — retrieve prior campaigns, decisions, and learnings relevant to a question.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'What you want to recall from past marketing memory.',
          },
          limit: { type: 'integer', description: 'Max memories (default 5, max 10).' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_blended_performance',
      description: 'Fetch blended ad spend / CAC style performance signals for the last N days.',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'integer', description: 'Lookback days (default 30, max 90).' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_marketing_goals',
      description: 'List configured marketing goals and current progress if available.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consult_peer_officer',
      description:
        'Multi-agent consult — get a short specialty brief from another AI Executive (does not invent their private data).',
      parameters: {
        type: 'object',
        properties: {
          peer_role: {
            type: 'string',
            enum: Object.keys(OFFICER_SPECIALTIES),
            description: 'Which peer officer to consult.',
          },
          question: { type: 'string', description: 'What you need from that peer.' },
        },
        required: ['peer_role', 'question'],
      },
    },
  },
];

function skillPackFlat() {
  return Object.entries(AGENT_SKILL_PACK).flatMap(([group, items]) =>
    items.map((item) => ({ group, item })),
  );
}

function systemPrompt(role, title, thinkingMode) {
  const specialty = OFFICER_SPECIALTIES[role] || 'your functional domain';
  const mode = resolveThinkingMode(thinkingMode);
  const stack = domainStackForRole(role);
  const packLines = Object.entries(AGENT_SKILL_PACK)
    .map(([g, items]) => `- ${g}: ${items.join(', ')}`)
    .join('\n');
  return `You are the AI ${title} on InfoGenie's AI Executive team — an autonomous agent inside an agentic operating system.

Architecture you operate under:
- HUMAN provides creative vision + quality feedback
- ORCHESTRATOR maps the ask, selects thinking mode, and routes work
- YOU (specialized agent) reason, call tools via MCP/APIs, and return intelligent decisions/feedback
- CONNECTED STACK for your domain: ${stack.join(', ')}

Domain specialty: ${specialty}.

Active strategic thinking mode — "${mode.label}" (act as a ${mode.persona}):
${mode.instruction}

Full agent skill pack you employ on every assignment:
${packLines}

Operating rules:
1. Apply the thinking mode rigorously — decisions, reasoning, and feedback must reflect that lens.
2. Call tools (function calling) for workspace evidence, memory (RAG), goals, or peer multi-agent input.
3. Never invent platform numbers. If data is missing, say so and recommend what to connect.
4. Produce intelligent, specific suggestions the human can act on inside InfoGenie.
5. Stay in your lane; consult peers when cross-functional impact is real.
6. Final answer must be strict JSON only (no markdown).`;
}

async function _safeCount(sql, params) {
  if (!_db.hasDb()) return null;
  try {
    const r = await _db.getPool().query(sql, params);
    return r.rows?.[0]?.c == null ? null : +r.rows[0].c;
  } catch {
    return null;
  }
}

async function loadWorkspaceSnapshot(tenantId) {
  const snap = {
    tenantId: tenantId || null,
    adCampaigns_total: null,
    brandCalendar_next7d: null,
    landingPages_total: null,
    leadsLinksell_last7d: null,
    bookings_last7d: null,
    waCampaigns_total: null,
    activeProjects: null,
  };
  if (!_db.hasDb() || tenantId == null) return snap;
  snap.adCampaigns_total = await _safeCount(
    `SELECT COUNT(*)::int c FROM ad_campaigns WHERE tenant_id=$1`,
    [tenantId],
  );
  snap.brandCalendar_next7d = await _safeCount(
    `SELECT COUNT(*)::int c FROM brand_calendar_items WHERE event_date BETWEEN current_date AND current_date + 7 AND tenant_id=$1`,
    [tenantId],
  );
  snap.landingPages_total = await _safeCount(
    `SELECT COUNT(*)::int c FROM landing_pages WHERE tenant_id=$1`,
    [tenantId],
  );
  snap.leadsLinksell_last7d = await _safeCount(
    `SELECT COUNT(*)::int c FROM linksell_leads WHERE created_at > now() - interval '7 days' AND tenant_id=$1`,
    [tenantId],
  );
  snap.bookings_last7d = await _safeCount(
    `SELECT COUNT(*)::int c FROM bookings WHERE created_at > now() - interval '7 days' AND tenant_id=$1`,
    [tenantId],
  );
  snap.waCampaigns_total = await _safeCount(
    `SELECT COUNT(*)::int c FROM wa_campaigns WHERE tenant_id=$1`,
    [tenantId],
  );
  snap.activeProjects = await _safeCount(
    `SELECT COUNT(*)::int c FROM marketing_projects WHERE status='active' AND tenant_id=$1`,
    [tenantId],
  );
  return snap;
}

async function recallMemory(tenantId, question, limit = 5) {
  const lim = Math.min(10, Math.max(1, Number(limit) || 5));
  if (!_db.hasDb() || tenantId == null) {
    return { ok: false, memories: [], note: 'no_tenant_or_db' };
  }
  try {
    // Prefer recent keyword-ish matches without requiring embeddings at call time.
    const q = String(question || '').trim();
    const r = await _db.getPool().query(
      `SELECT node_type, summary, created_at
         FROM marketing_memory_nodes
        WHERE tenant_id=$1
          AND ($2 = '' OR summary ILIKE '%' || $2 || '%' OR node_type ILIKE '%' || $2 || '%')
        ORDER BY created_at DESC
        LIMIT $3`,
      [tenantId, q.slice(0, 80), lim],
    );
    if (r.rows.length) {
      return {
        ok: true,
        memories: r.rows.map((row) => ({
          type: row.node_type,
          summary: row.summary,
          at: row.created_at,
        })),
      };
    }
    // Fallback: latest memories for context
    const recent = await _db.getPool().query(
      `SELECT node_type, summary, created_at
         FROM marketing_memory_nodes
        WHERE tenant_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [tenantId, lim],
    );
    return {
      ok: true,
      memories: recent.rows.map((row) => ({
        type: row.node_type,
        summary: row.summary,
        at: row.created_at,
      })),
      note: recent.rows.length ? 'returned_recent_fallback' : 'no_memory_yet',
    };
  } catch (e) {
    return { ok: false, memories: [], error: e.message };
  }
}

async function listGoals(tenantId) {
  if (!_db.hasDb() || tenantId == null) return { ok: true, goals: [] };
  try {
    // Goals may live in kv or a table depending on feature — try common kv key first.
    const raw = await _db.kvGet(`marketing_goals:t${tenantId}`, null);
    if (Array.isArray(raw)) return { ok: true, goals: raw.slice(0, 40) };
    if (raw && typeof raw === 'object' && Array.isArray(raw.goals)) {
      return { ok: true, goals: raw.goals.slice(0, 40) };
    }
  } catch {
    /* ignore */
  }
  try {
    const r = await _db.getPool().query(
      `SELECT id, label, metric, target, current_value, status
         FROM marketing_goals
        WHERE tenant_id=$1
        ORDER BY id DESC
        LIMIT 40`,
      [tenantId],
    );
    return { ok: true, goals: r.rows };
  } catch {
    return { ok: true, goals: [], note: 'goals_table_unavailable' };
  }
}

async function getBlended(tenantId, days = 30) {
  const d = Math.min(90, Math.max(1, Number(days) || 30));
  // Lightweight spend proxy from ad_performance if present
  if (!_db.hasDb() || tenantId == null) {
    return { ok: true, days: d, spend: null, note: 'no_tenant_or_db' };
  }
  try {
    const r = await _db.getPool().query(
      `SELECT COALESCE(SUM(p.spend),0)::float8 AS spend,
              COALESCE(SUM(p.conversions),0)::float8 AS conversions,
              COALESCE(SUM(p.revenue),0)::float8 AS revenue
         FROM ad_performance_hourly p
         JOIN ad_campaigns c ON c.id = p.campaign_id
        WHERE c.tenant_id=$1
          AND p.bucket_hour >= now() - ($2 || ' days')::interval`,
      [tenantId, String(d)],
    );
    const row = r.rows[0] || {};
    return {
      ok: true,
      days: d,
      spend: Number(row.spend || 0),
      conversions: Number(row.conversions || 0),
      revenue: Number(row.revenue || 0),
    };
  } catch (e) {
    return { ok: true, days: d, spend: null, error: e.message };
  }
}

function consultPeer(peerRole, question, selfRole) {
  const peer = String(peerRole || '').toLowerCase();
  const specialty = OFFICER_SPECIALTIES[peer];
  if (!specialty) return { ok: false, error: 'unknown_peer' };
  return {
    ok: true,
    from: peer,
    to: selfRole,
    specialty,
    guidance: `As ${peer} officer specializing in ${specialty}: evaluate “${String(question || '').slice(0, 280)}” through that lens. Flag cross-functional risks and one concrete hand-off action.`,
  };
}

async function executeTool(name, args, ctx) {
  const tid = ctx.tenantId;
  switch (name) {
    case 'get_workspace_snapshot':
      return { ok: true, snapshot: await loadWorkspaceSnapshot(tid) };
    case 'recall_marketing_memory':
      return recallMemory(tid, args.question, args.limit);
    case 'get_blended_performance':
      return getBlended(tid, args.days);
    case 'list_marketing_goals':
      return listGoals(tid);
    case 'consult_peer_officer':
      return consultPeer(args.peer_role, args.question, ctx.role);
    default:
      return { ok: false, error: 'unknown_tool', name };
  }
}

function parseJsonContent(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Run an AI Executive through the shared agent skill pack.
 *
 * @param {object} opts
 * @param {string} opts.role
 * @param {string} opts.title
 * @param {'advise'|'daily-report'|'brief'} opts.mode
 * @param {string} [opts.goal]
 * @param {string[]} [opts.tasks]
 * @param {object} [opts.facts]
 * @param {string} [opts.thinkingMode] — one of STRATEGIC_THINKING_MODES ids
 * @param {number|null} opts.tenantId
 * @param {Function} opts.openaiChatWithRetry
 */
async function runExecutiveAgent(opts) {
  const {
    role,
    title,
    mode = 'advise',
    goal = '',
    tasks = [],
    facts = null,
    thinkingMode = 'deeper_question',
    tenantId = null,
    openaiChatWithRetry,
  } = opts || {};

  if (typeof openaiChatWithRetry !== 'function') {
    throw new Error('openaiChatWithRetry required');
  }

  const thinking = resolveThinkingMode(thinkingMode);

  const schema =
    mode === 'daily-report'
      ? `{
  "summary": "<2-3 sentence honest executive summary>",
  "tasksReviewed": [{"task":"<exact task>","status":"done|in_progress|blocked|not_started","evidence":"<tool-grounded evidence>"}],
  "successes": ["<concrete win>"],
  "issues": ["<concrete blocker>"],
  "actionPlan": [{"step":"<verb-led InfoGenie action>","priority":"high|med|low"}],
  "reasoning": ["<short chain-of-thought step you took>", "..."],
  "thinkingMode": "${thinking.id}"
}`
      : mode === 'brief'
        ? `{
  "summary": "<2-3 sentence executive narrative>",
  "highlights": ["<win>"],
  "risks": ["<risk with numbers when available>"],
  "actions": [{"title":"<verb-led>","detail":"<why>","priority":"high|med|low"}],
  "reasoning": ["<how you used tools / memory>"],
  "thinkingMode": "${thinking.id}"
}`
        : `{
  "assessment": "<independent assessment applying the ${thinking.label} lens>",
  "suggestions": [{"title":"<verb-led suggestion>","detail":"<why / how>","priority":"high|med|low"}],
  "risks": ["<risk>"],
  "nextChecks": ["<what you will monitor next>"],
  "deeperQuestion": "<optional — the core question behind the ask>",
  "decision": "<optional — the clear choice you recommend when facing a decision>",
  "reasoning": ["<orchestrator → tools → judgment steps>"],
  "thinkingMode": "${thinking.id}",
  "thinkingModeLabel": "${thinking.label}"
}`;

  const userPayload = {
    mode,
    role,
    title,
    specialty: OFFICER_SPECIALTIES[role] || '',
    domainToolStack: domainStackForRole(role),
    thinkingMode: thinking,
    goal: String(goal || '').slice(0, 2000),
    responsibilities: Array.isArray(tasks) ? tasks.slice(0, 40) : [],
    facts: facts && typeof facts === 'object' ? facts : undefined,
    skillPack: AGENT_SKILL_PACK,
    osNote: 'Human vision → Orchestrator planning → Agent execution via MCP/APIs → Connected stack',
  };

  const messages = [
    { role: 'system', content: systemPrompt(role, title, thinking.id) },
    {
      role: 'user',
      content: `Assignment JSON:\n${JSON.stringify(userPayload, null, 2)}\n\nUse tools as needed, then return ONLY valid JSON matching:\n${schema}`,
    },
  ];

  const toolTrace = [];
  let finalText = '';
  const maxRounds = 4;

  for (let round = 0; round < maxRounds; round++) {
    const completion = await openaiChatWithRetry({
      model: process.env.OFFICER_AGENT_MODEL || 'gpt-5-mini',
      messages,
      tools: EXECUTIVE_TOOLS,
      tool_choice: round === maxRounds - 1 ? 'none' : 'auto',
      temperature: 0.25,
      max_tokens: 1800,
      ...(round === maxRounds - 1 || mode !== 'advise'
        ? { response_format: { type: 'json_object' } }
        : {}),
    });
    const msg = completion.choices?.[0]?.message || {};
    if (msg.tool_calls && msg.tool_calls.length) {
      messages.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });
      for (const tc of msg.tool_calls.slice(0, 4)) {
        let args = {};
        try {
          args = JSON.parse(tc.function?.arguments || '{}');
        } catch {
          args = {};
        }
        const result = await executeTool(tc.function?.name, args, { tenantId, role });
        toolTrace.push({ tool: tc.function?.name, args, ok: result?.ok !== false });
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result).slice(0, 6000),
        });
      }
      continue;
    }
    finalText = msg.content || '';
    break;
  }

  if (!finalText) {
    // Force a JSON close-out without tools
    const close = await openaiChatWithRetry({
      model: process.env.OFFICER_AGENT_MODEL || 'gpt-5-mini',
      messages: [
        ...messages,
        {
          role: 'user',
          content: `Return the final JSON now using this schema:\n${schema}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1600,
      response_format: { type: 'json_object' },
    });
    finalText = close.choices?.[0]?.message?.content || '';
  }

  const parsed = parseJsonContent(finalText);
  if (parsed && typeof parsed === 'object') {
    parsed.thinkingMode = parsed.thinkingMode || thinking.id;
    parsed.thinkingModeLabel = parsed.thinkingModeLabel || thinking.label;
  }
  return {
    ok: !!parsed,
    role,
    title,
    mode,
    thinkingMode: thinking,
    skillPack: AGENT_SKILL_PACK,
    toolTrace,
    result: parsed,
    raw: parsed ? undefined : finalText?.slice?.(0, 1500),
  };
}

module.exports = {
  AGENT_SKILL_PACK,
  OFFICER_SPECIALTIES,
  STRATEGIC_THINKING_MODES,
  DOMAIN_TOOL_STACK,
  EXECUTIVE_TOOLS,
  skillPackFlat,
  resolveThinkingMode,
  domainStackForRole,
  buildStrategicOfflineAdvice,
  loadWorkspaceSnapshot,
  runExecutiveAgent,
};

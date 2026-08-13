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

function systemPrompt(role, title) {
  const specialty = OFFICER_SPECIALTIES[role] || 'your functional domain';
  const packLines = Object.entries(AGENT_SKILL_PACK)
    .map(([g, items]) => `- ${g}: ${items.join(', ')}`)
    .join('\n');
  return `You are the AI ${title} on InfoGenie's AI Executive team — an autonomous agent, not a chatbot.

You reason independently about ${specialty}.
You MUST use tools when facts are needed. Never invent platform numbers.

Full agent skill pack you employ on every assignment:
${packLines}

Operating rules:
1. Think step-by-step about the CEO's ask and your responsibilities.
2. Call tools (function calling) to gather workspace evidence, memory (RAG), goals, or peer input.
3. Give intelligent, specific feedback and suggestions the user can act on inside InfoGenie.
4. Be honest when data is missing — recommend what to connect or assign next.
5. Stay in your lane, but consult peers when cross-functional impact is real.
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
    tenantId = null,
    openaiChatWithRetry,
  } = opts || {};

  if (typeof openaiChatWithRetry !== 'function') {
    throw new Error('openaiChatWithRetry required');
  }

  const schema =
    mode === 'daily-report'
      ? `{
  "summary": "<2-3 sentence honest executive summary>",
  "tasksReviewed": [{"task":"<exact task>","status":"done|in_progress|blocked|not_started","evidence":"<tool-grounded evidence>"}],
  "successes": ["<concrete win>"],
  "issues": ["<concrete blocker>"],
  "actionPlan": [{"step":"<verb-led InfoGenie action>","priority":"high|med|low"}],
  "reasoning": ["<short chain-of-thought step you took>", "..."]
}`
      : mode === 'brief'
        ? `{
  "summary": "<2-3 sentence executive narrative>",
  "highlights": ["<win>"],
  "risks": ["<risk with numbers when available>"],
  "actions": [{"title":"<verb-led>","detail":"<why>","priority":"high|med|low"}],
  "reasoning": ["<how you used tools / memory>"]
}`
        : `{
  "assessment": "<independent assessment of the situation in your domain>",
  "suggestions": [{"title":"<verb-led suggestion>","detail":"<why / how>","priority":"high|med|low"}],
  "risks": ["<risk>"],
  "nextChecks": ["<what you will monitor next>"],
  "reasoning": ["<tool/memory steps you took>"]
}`;

  const userPayload = {
    mode,
    role,
    title,
    specialty: OFFICER_SPECIALTIES[role] || '',
    goal: String(goal || '').slice(0, 2000),
    responsibilities: Array.isArray(tasks) ? tasks.slice(0, 40) : [],
    facts: facts && typeof facts === 'object' ? facts : undefined,
    skillPack: AGENT_SKILL_PACK,
  };

  const messages = [
    { role: 'system', content: systemPrompt(role, title) },
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
  return {
    ok: !!parsed,
    role,
    title,
    mode,
    skillPack: AGENT_SKILL_PACK,
    toolTrace,
    result: parsed,
    raw: parsed ? undefined : finalText?.slice?.(0, 1500),
  };
}

module.exports = {
  AGENT_SKILL_PACK,
  OFFICER_SPECIALTIES,
  EXECUTIVE_TOOLS,
  skillPackFlat,
  loadWorkspaceSnapshot,
  runExecutiveAgent,
};

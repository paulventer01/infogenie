// InfoGenie MCP (Model Context Protocol) Server
// Exposes InfoGenie capabilities as MCP-compatible tools so AI agents (Claude, Cursor, etc.)
// can query segments, trigger campaigns, and pull analytics.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _pool() { return _db.getPool(); }

const TOOLS = [
  {
    name: 'list_segments',
    description: 'List all audience segments in InfoGenie for this tenant',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_segment_members',
    description: 'Get the members of a specific audience segment by ID',
    inputSchema: {
      type: 'object',
      properties: { segment_id: { type: 'number', description: 'The segment ID' } },
      required: ['segment_id']
    }
  },
  {
    name: 'list_journeys',
    description: 'List all customer journeys (automations) in InfoGenie',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_campaign_stats',
    description: 'Get drip campaign statistics (sent, delivered, bounce rate)',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'list_surveys',
    description: 'List all surveys and their response counts',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_identity_profiles',
    description: 'Get customer identity profiles with LTV and propensity scores',
    inputSchema: {
      type: 'object',
      properties: {
        lifecycle_stage: { type: 'string', description: 'Filter by stage: unknown|aware|interested|considering|customer|churned' },
        limit: { type: 'number', description: 'Max results (default 20, max 100)' }
      },
      required: []
    }
  },
  {
    name: 'get_experiments',
    description: 'List A/B experiments and their results',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_competitor_insights',
    description: 'Get recent competitor analysis data (battle cards, SOV)',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max results' } },
      required: []
    }
  },
  {
    name: 'get_email_templates',
    description: 'List email templates from the Email Designer',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_drip_enrollments',
    description: 'Get recent drip email enrollments and their status',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', description: 'Filter: active|completed|cancelled|paused' } },
      required: []
    }
  },
  {
    name: 'query_marketing_memory',
    description: 'Semantic search over Marketing Memory (RAG). Returns top relevant memory nodes for a question.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural-language question' },
        limit: { type: 'number', description: 'Max nodes (default 6)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_ai_observability',
    description: 'AI call-trace stats (latency, cost estimate, cascade tiers) + feedback approval rates for this tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Lookback window hours (default 24)' },
      },
      required: [],
    },
  },
  {
    name: 'get_social_search_winners',
    description: 'Social × Search winners from Google Search Console (Instagram/TikTok/YouTube/X earning Google clicks).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max winners (default 5)' },
        days: { type: 'number', description: 'GSC lookback days (default 28)' },
      },
      required: [],
    },
  },
];

// MCP discovery endpoint — returns available tools
router.get('/tools', (req, res) => {
  res.json({
    protocol: 'mcp',
    version: '2024-11-05',
    name: 'infogenie',
    description: 'InfoGenie AI Marketing Intelligence Platform',
    tools: TOOLS
  });
});

// MCP JSON-RPC handler
router.post('/call', async (req, res) => {
  try {
    const { name, arguments: args = {} } = req.body || {};
    if (!name) return res.status(400).json({ error: { code: -32600, message: 'tool name required' } });
    const tid = await _tenantCtx.resolveTenantId(req, { label: 'mcp:call' });
    if (!tid) return res.status(400).json({ error: { code: -32000, message: 'no_tenant' } });
    const p = _pool();
    let result = null;

    switch(name) {
      case 'list_segments': {
        const r = await p.query(
          `SELECT id,name,description,member_count,enabled,last_evaluated_at FROM audience_segments
           WHERE tenant_id=$1 ORDER BY member_count DESC LIMIT 50`, [tid]
        );
        result = { segments: r.rows, count: r.rows.length };
        break;
      }
      case 'get_segment_members': {
        const { segment_id } = args;
        if (!segment_id) return res.status(400).json({ error: { code: -32602, message: 'segment_id required' } });
        const r = await p.query(
          `SELECT contact_id,contact_email,joined_at FROM audience_segment_members
           WHERE segment_id=$1 AND left_at IS NULL LIMIT 100`, [segment_id]
        );
        result = { members: r.rows, count: r.rows.length };
        break;
      }
      case 'list_journeys': {
        const r = await p.query(
          `SELECT id,name,description,status,trigger_type,stats,updated_at,
                  jsonb_array_length(nodes) as step_count
           FROM journeys WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 50`, [tid]
        );
        result = { journeys: r.rows };
        break;
      }
      case 'get_campaign_stats': {
        try {
          const r = await fetch ? null : null; // stats come from kv_store
          result = { message: 'Use /api/drips/stats for live drip statistics', hint: 'Drip stats include: total, active, completed, bounce_rate, complaint_rate' };
        } catch(e) { result = { error: e.message }; }
        break;
      }
      case 'list_surveys': {
        if (_db.hasDb()) {
          try {
            const r = await p.query(
              `SELECT id,title,status,response_count,embed_key,created_at FROM surveys
               WHERE tenant_id=$1 ORDER BY response_count DESC LIMIT 50`, [tid]
            );
            result = { surveys: r.rows };
          } catch(e) { result = { surveys: [], note: 'surveys table not yet initialised' }; }
        } else { result = { surveys: [] }; }
        break;
      }
      case 'get_identity_profiles': {
        const stage = args.lifecycle_stage;
        const limit = Math.min(+(args.limit || 20), 100);
        const where = stage ? 'AND lifecycle_stage=$3' : '';
        const params = stage ? [tid, limit, stage] : [tid, limit];
        const r = await p.query(
          `SELECT id,email,name,company,lifecycle_stage,ltv_score,propensity_score,next_best_action,last_seen_at
           FROM identity_profiles WHERE tenant_id=$1 ${where} ORDER BY ltv_score DESC LIMIT $2`,
          params
        );
        result = { profiles: r.rows, count: r.rows.length };
        break;
      }
      case 'get_experiments': {
        const r = await p.query(
          `SELECT id,name,type,status,lift_pct,confidence_pct,p_value,outcome,created_at
           FROM experiments WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]
        );
        result = { experiments: r.rows };
        break;
      }
      case 'get_competitor_insights': {
        const limit = Math.min(+(args.limit || 10), 50);
        const [bc, sov] = await Promise.all([
          p.query(`SELECT id,created_at,result FROM battle_cards WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT $2`, [tid, limit]).catch(()=>({rows:[]})),
          p.query(`SELECT brand,avg_share FROM sov_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date DESC LIMIT $2`, [tid, limit]).catch(()=>({rows:[]}))
        ]);
        result = { battle_cards: bc.rows, sov_data: sov.rows };
        break;
      }
      case 'get_email_templates': {
        try {
          const r = await p.query(
            `SELECT id,name,subject,status,spam_score,version,updated_at FROM email_templates
             WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 50`, [tid]
          );
          result = { templates: r.rows };
        } catch(e) { result = { templates: [], note: 'email_templates table not yet initialised' }; }
        break;
      }
      case 'get_drip_enrollments': {
        result = { message: 'Drip enrollments are stored in kv_store. Use GET /api/drips to retrieve them.', status_filter: args.status || 'all' };
        break;
      }
      case 'query_marketing_memory': {
        const question = String(args.question || '').trim();
        if (!question) return res.status(400).json({ error: { code: -32602, message: 'question required' } });
        const { queryMemoryNodes, embedText, vectorStatus } = require('../knowledge_graph/api');
        const vec = await embedText(question);
        const nodes = await queryMemoryNodes(tid, question, vec, Math.min(Number(args.limit) || 6, 20));
        const vs = await vectorStatus();
        result = {
          question,
          nodes: nodes.map((n) => ({
            id: n.id,
            node_type: n.node_type,
            summary: n.summary,
            score: n.score,
            retrieval: n.retrieval,
          })),
          vector: vs,
        };
        break;
      }
      case 'get_ai_observability': {
        const hours = Number(args.hours) || 24;
        const { traceStats } = require('../ai_traces/store');
        const { feedbackStats } = require('../ai_feedback/store');
        const [traces, feedback] = await Promise.all([
          traceStats({ tenantId: tid, hours }),
          feedbackStats({ tenantId: tid, hours: Math.max(hours, 24 * 7) }),
        ]);
        result = { traces, feedback };
        break;
      }
      case 'get_social_search_winners': {
        const { fetchSocialSearchWinners, insightFromWinners } = require('../gsc_social_search/winners');
        const payload = await fetchSocialSearchWinners({
          limit: Math.min(Number(args.limit) || 5, 15),
          days: Number(args.days) || 28,
          allowDemo: true,
        });
        result = {
          source: payload.source,
          configured: payload.configured,
          insight: insightFromWinners(payload),
          winners: payload.winners || [],
        };
        break;
      }
      default:
        return res.status(404).json({ error: { code: -32601, message: `Unknown tool: ${name}` } });
    }

    res.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: false
    });
  } catch(e) {
    res.status(500).json({ error: { code: -32603, message: e.message } });
  }
});

// OpenAI-compatible function-calling discovery (for tools that read llms.txt)
router.get('/llms.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(`# InfoGenie MCP API

InfoGenie is an AI-powered marketing intelligence platform.

## Available Tools

${TOOLS.map(t => `### ${t.name}\n${t.description}\nEndpoint: POST /api/mcp/call with {"name":"${t.name}","arguments":{...}}`).join('\n\n')}

## Authentication
Pass session cookie or X-Api-Key header.

## Discovery
GET /api/mcp/tools — returns all available tools in MCP format.
`);
});

module.exports = router;

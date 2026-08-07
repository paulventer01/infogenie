/**
 * In-process MCP-style servers (no subprocess / no arbitrary shell).
 * Safe analogues of official Fetch + Memory from the ecosystem map.
 */

async function listBuiltinTools(builtin) {
  if (builtin === 'fetch') {
    return [
      {
        name: 'fetch_url',
        description: 'Fetch a public http(s) URL and return text (max 50KB). Blocks private IPs.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'https://… URL' },
            max_chars: { type: 'number', description: 'Truncate length (default 8000)' },
          },
          required: ['url'],
        },
      },
    ];
  }
  if (builtin === 'memory') {
    return [
      {
        name: 'memory_query',
        description: 'Query marketing memory nodes by natural language.',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['question'],
        },
      },
      {
        name: 'memory_ingest',
        description: 'Ingest a manual observation into marketing memory.',
        inputSchema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            importance: { type: 'number' },
          },
          required: ['summary'],
        },
      },
    ];
  }
  return [];
}

function _isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.local') || h === '0.0.0.0') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fe80')) return true;
  return false;
}

async function callBuiltin(builtin, name, args = {}, { tenantId } = {}) {
  if (builtin === 'fetch' && name === 'fetch_url') {
    const url = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('url must be http(s)');
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('invalid url'); }
    if (_isPrivateHost(parsed.hostname)) throw new Error('private/local hosts blocked');
    const maxChars = Math.min(50000, Math.max(500, Number(args.max_chars) || 8000));
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'InfoGenie-MCP-Fetch/1.0', Accept: 'text/html,application/json,text/plain,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const ctype = resp.headers.get('content-type') || '';
    let text = await resp.text();
    text = text.slice(0, maxChars);
    return {
      ok: resp.ok,
      status: resp.status,
      content_type: ctype,
      url: resp.url || url,
      text,
      truncated: text.length >= maxChars,
    };
  }

  if (builtin === 'memory') {
    const { queryMemoryNodes, embedText, ingestMemoryNode } = require('../knowledge_graph/api');
    if (name === 'memory_query') {
      const question = String(args.question || '').trim();
      if (!question) throw new Error('question required');
      const vec = await embedText(question);
      const nodes = await queryMemoryNodes(tenantId, question, vec, Math.min(Number(args.limit) || 6, 20));
      return { question, nodes };
    }
    if (name === 'memory_ingest') {
      const summary = String(args.summary || '').trim();
      if (!summary) throw new Error('summary required');
      const id = await ingestMemoryNode({
        tenant_id: tenantId,
        node_type: 'manual_observation',
        summary,
        detail: { via: 'mcp_client_builtin_memory' },
        importance: args.importance != null ? Number(args.importance) : 0.6,
      });
      return { ok: !!id, id };
    }
  }

  throw new Error(`Unknown builtin tool ${builtin}.${name}`);
}

module.exports = { listBuiltinTools, callBuiltin };

/**
 * Catalog of MCP-style servers InfoGenie can connect to as a client.
 * Official/community names from the ecosystem map — HTTP-compatible or builtin.
 */
const PRESET_CATALOG = [
  {
    id: 'builtin-fetch',
    name: 'Fetch (builtin)',
    category: 'official',
    transport: 'builtin',
    builtin: 'fetch',
    description: 'Fetch public web URLs (read-only) — analogue of official Fetch MCP.',
    allowEmptyUrl: true,
  },
  {
    id: 'builtin-memory',
    name: 'Memory (builtin)',
    category: 'official',
    transport: 'builtin',
    builtin: 'memory',
    description: 'Persistent marketing memory via InfoGenie knowledge graph.',
    allowEmptyUrl: true,
  },
  {
    id: 'infogenie-self',
    name: 'InfoGenie (self)',
    category: 'data',
    transport: 'rest',
    base_url: '/api/mcp',
    description: 'Loopback to this tenant’s InfoGenie MCP tool server.',
    allowEmptyUrl: true,
    loopback: true,
  },
  {
    id: 'http-rest-generic',
    name: 'Custom REST MCP',
    category: 'community',
    transport: 'rest',
    base_url: '',
    description: 'Any server exposing GET /tools + POST /call (InfoGenie-compatible).',
    requiresCustomUrl: true,
  },
  {
    id: 'http-jsonrpc-generic',
    name: 'Custom JSON-RPC MCP',
    category: 'community',
    transport: 'jsonrpc',
    base_url: '',
    description: 'HTTP JSON-RPC endpoint supporting tools/list + tools/call.',
    requiresCustomUrl: true,
  },
  {
    id: 'http-streamable-generic',
    name: 'Custom Streamable HTTP MCP',
    category: 'community',
    transport: 'streamable',
    base_url: '',
    description: 'MCP Streamable HTTP endpoint (initialize + tools/list + tools/call).',
    requiresCustomUrl: true,
  },
  {
    id: 'mangools',
    name: 'Mangools SEO MCP',
    category: 'official',
    transport: 'streamable',
    base_url: 'https://mcp.mangools.com/mcp',
    description: 'KWFinder, SiteProfiler, LinkMiner, SERPChecker & AI Watcher tools via Mangools Streamable HTTP MCP. Auth: x-access-token from MANGOOLS_API_KEY.',
    authEnv: 'MANGOOLS_API_KEY',
    authHeaderName: 'x-access-token',
    autoSeedWhenKeyed: true,
  },
];

module.exports = { PRESET_CATALOG };

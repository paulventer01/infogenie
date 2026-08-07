// test/mcp-client-data.test.js — MCP client + expanded server data/action tools
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const db = require('../db');
db.hasDb = () => false;

const tenantCtx = require('../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req && req.headers && req.headers['x-test-tid'];
  return h ? parseInt(h, 10) : 1;
};

const mcpServer = require('../services/mcp/api');
const mcpClient = require('../services/mcp_client/api');
const drafts = require('../services/social_drafts/api');
const inbox = require('../services/social_inbox/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/mcp', mcpServer);
  app.use('/api/mcp-client', mcpClient);
  app.use('/api/social-drafts', drafts);
  return http.createServer(app);
}

function req(server, method, path, { tid, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid || 1) },
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let j = {};
        try { j = d ? JSON.parse(d) : {}; } catch { j = { raw: d }; }
        resolve({ status: res.statusCode, body: j });
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

beforeEach(() => {
  if (mcpClient._resetMem) mcpClient._resetMem();
  if (drafts._resetMem) drafts._resetMem();
  if (inbox._resetMem) inbox._resetMem();
});

test('MCP server exposes expanded data + action tools', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const t = await req(server, 'GET', '/api/mcp/tools');
    const names = (t.body.tools || []).map((x) => x.name);
    assert.ok(names.includes('query_marketing_memory'));
    assert.ok(names.includes('list_social_drafts'));
    assert.ok(names.includes('list_inbox_threads'));
    assert.ok(names.includes('create_social_draft'));
    assert.ok(names.includes('ingest_memory_observation'));
    assert.ok(names.includes('rate_ai_output'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('MCP create_social_draft + list_social_drafts + list_inbox_threads', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const created = await req(server, 'POST', '/api/mcp/call', {
      body: {
        name: 'create_social_draft',
        arguments: { profile_id: 'p1', text: 'MCP drafted caption', platforms: ['instagram'] },
      },
    });
    assert.equal(created.body.isError, false);
    const text = created.body.content[0].text;
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.draft.id);

    const listed = await req(server, 'POST', '/api/mcp/call', {
      body: { name: 'list_social_drafts', arguments: { profile_id: 'p1' } },
    });
    const list = JSON.parse(listed.body.content[0].text);
    assert.ok(list.drafts.length >= 1);

    const threads = await req(server, 'POST', '/api/mcp/call', {
      body: { name: 'list_inbox_threads', arguments: {} },
    });
    const th = JSON.parse(threads.body.content[0].text);
    assert.ok(Array.isArray(th.threads));
    assert.ok(th.threads.length >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('MCP client seeds builtins and lists fetch tools', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const seeded = await req(server, 'POST', '/api/mcp-client/servers/seed', {});
    assert.equal(seeded.body.ok, true);
    assert.ok(seeded.body.servers.length >= 2);

    const fetchServer = seeded.body.servers.find((s) => s.builtin === 'fetch' || /fetch/i.test(s.name));
    assert.ok(fetchServer);

    const tools = await req(server, 'GET', `/api/mcp-client/servers/${fetchServer.id}/tools`);
    assert.equal(tools.body.ok, true);
    assert.ok((tools.body.tools || []).some((t) => t.name === 'fetch_url'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('MCP client builtin memory_ingest + memory_query', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const seeded = await req(server, 'POST', '/api/mcp-client/servers/seed', {});
    const mem = seeded.body.servers.find((s) => s.builtin === 'memory');
    assert.ok(mem);

    const call = await req(server, 'POST', `/api/mcp-client/servers/${mem.id}/call`, {
      body: { name: 'memory_ingest', arguments: { summary: 'MCP client wrote a memory note about hooks.' } },
    });
    // Without DB ingest returns null id — still ok response shape
    assert.equal(call.body.ok, true);
    assert.ok(Array.isArray(call.body.content));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('MCP client presets catalog includes official + community', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const p = await req(server, 'GET', '/api/mcp-client/presets');
    assert.equal(p.body.ok, true);
    const cats = new Set(p.body.presets.map((x) => x.category));
    assert.ok(cats.has('official'));
    assert.ok(cats.has('community') || cats.has('data'));
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('rate_ai_output MCP action', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await req(server, 'POST', '/api/mcp/call', {
      body: {
        name: 'rate_ai_output',
        arguments: { surface: 'mcp_test', rating: 1, output_text: 'great' },
      },
    });
    const parsed = JSON.parse(r.body.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.feedback.rating, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

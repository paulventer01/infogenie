// test/ai-infra-musts.test.js — vector retrieval helpers, feedback loop, AI traces
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

const { cosine, vectorStatus } = require('../services/knowledge_graph/api');
const { recordTrace, listTraces, traceStats, _estimateCostUsd, _resetMem: resetTraces } = require('../services/ai_traces/store');
const { recordFeedback, feedbackStats, outputHash, _resetMem: resetFeedback } = require('../services/ai_feedback/store');
const tracesApi = require('../services/ai_traces/api');
const feedbackApi = require('../services/ai_feedback/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/ai-traces', tracesApi);
  app.use('/api/ai-feedback', feedbackApi);
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
  resetTraces();
  resetFeedback();
});

test('cosine similarity: identical vectors → 1', () => {
  const a = [1, 0, 0];
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert.ok(cosine([1, 0], [0, 1]) < 0.01);
});

test('vectorStatus reports jsonb fallback without DB', async () => {
  const vs = await vectorStatus();
  assert.equal(vs.ready, false);
  assert.equal(vs.mode, 'jsonb_cosine');
});

test('recordTrace + stats capture tier and cost', async () => {
  await recordTrace({
    tenant_id: 1,
    surface: 'social_self_heal',
    category: 'writing',
    provider: 'openai',
    model: 'gpt-4o-mini',
    cascade_tier: 'fast',
    latency_ms: 120,
    prompt_tokens: 200,
    completion_tokens: 80,
  });
  await recordTrace({
    tenant_id: 1,
    surface: 'autoclaw',
    category: 'analysis',
    provider: 'zai',
    model: 'glm-5.2',
    cascade_tier: 'strong',
    escalated_from: 'fast',
    latency_ms: 900,
    prompt_tokens: 800,
    completion_tokens: 400,
  });
  const list = await listTraces({ tenantId: 1, limit: 10 });
  assert.equal(list.length, 2);
  const stats = await traceStats({ tenantId: 1, hours: 24 });
  assert.equal(stats.calls, 2);
  assert.equal(stats.escalated, 1);
  assert.ok(stats.by_tier.fast >= 1);
  assert.ok(stats.by_tier.strong >= 1);
  assert.ok(stats.est_cost_usd > 0);
  assert.ok(_estimateCostUsd('openai', 'gpt-4o-mini', 1000, 1000) > 0);
});

test('feedback dislike creates escalate candidate after enough downs', async () => {
  for (let i = 0; i < 3; i++) {
    await recordFeedback({
      tenant_id: 1,
      surface: 'social_self_heal',
      rating: -1,
      comment: `bad rewrite ${i}`,
      output_text: `caption ${i}`,
    });
  }
  await recordFeedback({
    tenant_id: 1,
    surface: 'social_self_heal',
    rating: 1,
    output_text: 'good one',
  });
  const stats = await feedbackStats({ tenantId: 1, hours: 24 * 7 });
  assert.equal(stats.down, 3);
  assert.equal(stats.up, 1);
  assert.ok(stats.escalate_candidates.some((c) => c.surface === 'social_self_heal'));
  assert.ok(outputHash('hello').length >= 8);
});

test('GET/POST /api/ai-traces and /api/ai-feedback', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    const t = await req(server, 'POST', '/api/ai-traces', {
      body: {
        surface: 'compose_assist',
        provider: 'openai',
        model: 'gpt-4o-mini',
        cascade_tier: 'fast',
        latency_ms: 50,
        prompt_tokens: 10,
        completion_tokens: 20,
      },
    });
    assert.equal(t.body.ok, true);
    assert.ok(t.body.trace.id);

    const ts = await req(server, 'GET', '/api/ai-traces/stats');
    assert.equal(ts.body.ok, true);
    assert.ok(ts.body.stats.calls >= 1);

    const f = await req(server, 'POST', '/api/ai-feedback', {
      body: { surface: 'compose_assist', rating: 1, output_text: 'nice caption' },
    });
    assert.equal(f.body.ok, true);
    assert.equal(f.body.feedback.rating, 1);

    const fs = await req(server, 'GET', '/api/ai-feedback/stats');
    assert.equal(fs.body.ok, true);
    assert.ok(fs.body.stats.total >= 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('chatForCategory records a trace (fail-open, no keys)', async () => {
  const { chatForCategory } = require('../services/ai/chat_router');
  const before = await listTraces({ tenantId: 1, limit: 50 });
  const r = await chatForCategory('writing', [{ role: 'user', content: 'hello' }], {
    tenantId: 1,
    surface: 'compose_assist',
    tier: 'fast',
    useContextPack: false,
    escalate: false,
  });
  // No providers configured → null result, but trace should still land
  void r;
  const after = await listTraces({ tenantId: 1, limit: 50 });
  assert.ok(after.length >= before.length + 1);
  assert.ok(after.some((t) => t.surface === 'compose_assist'));
});

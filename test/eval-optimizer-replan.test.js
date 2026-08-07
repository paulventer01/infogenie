// test/eval-optimizer-replan.test.js — shared eval loop · SEO optimize · feedback · replan
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

const { runEvaluatorOptimizer } = require('../services/ai/evaluator_optimizer');
const { evaluateSeoArticle, optimizeSeoArticle, _heuristicOptimize } = require('../services/seo_autopilot/eval_optimize');
const { gatherEnvironmentFeedback } = require('../services/seo_autopilot/feedback');
const { replanFromFeedback } = require('../services/seo_autopilot/replan');
const store = require('../services/seo_autopilot/store');
const { runPlanOnce } = require('../services/seo_autopilot/runner');
const { selfHealDraft, _heuristicScan } = require('../services/social_drafts/self_heal');
const { resolveCascadePlan } = require('../services/ai/efficient_cascade');
const api = require('../services/seo_autopilot/api');

function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'rev@test.local' }; next(); });
  app.use('/api/seo-autopilot', api);
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
  store._resetMem();
});

test('runEvaluatorOptimizer revises until pass', async () => {
  let n = 0;
  const r = await runEvaluatorOptimizer({
    content: 'bad',
    maxAttempts: 3,
    evaluate: (c) => ({ verdict: c.includes('good') ? 'pass' : 'fail', flags: [{ rule: 'x', fix: 'make good' }] }),
    optimize: async (c) => {
      n += 1;
      return 'good content';
    },
  });
  assert.equal(r.passed, true);
  assert.equal(r.content, 'good content');
  assert.ok(n >= 1);
  assert.equal(r.final_verdict, 'pass');
});

test('evaluateSeoArticle flags thin / missing structure', () => {
  const thin = evaluateSeoArticle('<p>Hi</p>', { keyword: 'local seo', minWords: 500 });
  assert.equal(thin.verdict, 'fail');
  assert.ok(thin.flags.some((f) => f.rule === 'too_thin' || f.rule === 'missing_h2'));

  const okHtml = `<h1>Local SEO Guide</h1>
<p>This guide covers local seo for multi-location brands with practical steps.</p>
<h2>Why local seo matters</h2>
<p>${'word '.repeat(520)}</p>
<h2>FAQ</h2>
<p><strong>Where to start?</strong> Claim your listings.</p>`;
  const ok = evaluateSeoArticle(okHtml, { keyword: 'local seo', minWords: 500 });
  assert.equal(ok.verdict, 'pass');
});

test('heuristic optimize clears common SEO flags', () => {
  const html = '<p>Short</p>';
  const ev = evaluateSeoArticle(html, { keyword: 'crm tools' });
  const fixed = _heuristicOptimize(html, ev, { keyword: 'crm tools', title: 'CRM Tools' });
  const again = evaluateSeoArticle(fixed, { keyword: 'crm tools', minWords: 50 });
  assert.ok(again.flags.filter((f) => f.rule === 'missing_h1').length === 0);
  assert.ok(/FAQ/i.test(fixed));
});

test('optimizeSeoArticle fail-open improves demo HTML', async () => {
  const r = await optimizeSeoArticle(1, '<p>Tiny</p>', { keyword: 'email marketing', title: 'Email Marketing' });
  assert.ok(r.ok);
  assert.ok(r.content.length > 40);
  assert.ok(r.attempts.length >= 1);
});

test('selfHealDraft still passes clean text via shared loop', async () => {
  assert.equal(_heuristicScan('guaranteed results overnight').overall_verdict, 'fail');
  const r = await selfHealDraft(1, 'A clear tip on content cadence for B2B teams.');
  assert.equal(r.passed, true);
  assert.equal(r.final_verdict, 'pass');
});

test('seo_article_eval is a fast cascade surface', () => {
  const p = resolveCascadePlan({ category: 'writing', surface: 'seo_article_eval' });
  assert.equal(p.tier, 'fast');
});

test('feedback scores failed runs as losers; replan defers them', async () => {
  await store.upsertPlan(3, {
    niche: 'seo tools',
    brand: 'ToolCo',
    domain: 'tool.co',
    keywords: [
      { keyword: 'best seo tools', opportunity_score: 90, difficulty: 20 },
      { keyword: 'spammy seo hacks', opportunity_score: 20, difficulty: 80 },
    ],
    calendar: [
      { day: 1, date: '2026-08-05', title: 'Best SEO Tools', keyword: 'best seo tools', status: 'queued' },
      { day: 2, date: '2026-08-06', title: 'Spammy', keyword: 'spammy seo hacks', status: 'planned' },
      { day: 3, date: '2026-08-07', title: 'Day 3', keyword: 'best seo tools', status: 'planned' },
    ],
    destinations: [{ type: 'webhook', enabled: true }],
  });
  await store.recordRun({
    tenant_id: 3,
    plan_id: 1,
    status: 'error',
    keyword: 'spammy seo hacks',
    title: 'Spammy',
    error: 'publish_failed',
  });
  await store.recordRun({
    tenant_id: 3,
    plan_id: 1,
    status: 'ok',
    keyword: 'best seo tools',
    title: 'Best SEO Tools',
  });

  const fb = await gatherEnvironmentFeedback(3);
  assert.ok(fb.ok);
  assert.ok(fb.winners.some((w) => w.keyword === 'best seo tools'));
  assert.ok(fb.losers.some((l) => l.keyword === 'spammy seo hacks'));

  const rp = await replanFromFeedback(3, { feedback: fb, apply: true });
  assert.ok(rp.ok);
  assert.ok(rp.changes.length >= 1);
  const deferred = rp.plan.calendar.filter((c) => c.status === 'deferred');
  assert.ok(deferred.some((c) => c.keyword === 'spammy seo hacks'));
  assert.ok(rp.plan.meta.replan?.summary);
});

test('runPlanOnce includes eval meta and can skip replan', async () => {
  const plan = await store.upsertPlan(11, {
    niche: 'email marketing',
    brand: 'MailCo',
    domain: 'mail.co',
    keywords: [{ keyword: 'best email tools', opportunity_score: 80 }],
    calendar: [
      { day: 1, date: '2026-08-05', title: 'Best Email Tools', keyword: 'best email tools', status: 'queued' },
      { day: 2, date: '2026-08-06', title: 'Day 2', keyword: 'email checklist', status: 'planned' },
    ],
    destinations: [{ type: 'shopify', enabled: true }],
    autopilot: true,
  });
  const result = await runPlanOnce(plan, { skipReplan: true });
  assert.ok(result.run);
  assert.ok(result.eval);
  assert.ok(['pass', 'caution', 'fail'].includes(result.eval.final_verdict));
  const refreshed = await store.getPlan(11);
  assert.equal(refreshed.calendar.find((c) => c.keyword === 'best email tools')?.status, 'published');
});

test('API feedback + replan + evaluate-article', async () => {
  const server = startServer();
  await new Promise((r) => server.listen(0, r));
  try {
    await req(server, 'POST', '/api/seo-autopilot/onboard', {
      tid: 7,
      body: {
        niche: 'geo seo',
        brand: 'GeoCo',
        domain: 'geo.co',
        keywords: [
          { keyword: 'geo seo tools', opportunity_score: 88 },
          { keyword: 'weak geo spam', opportunity_score: 15, difficulty: 90 },
        ],
      },
    });
    await store.recordRun({
      tenant_id: 7,
      status: 'error',
      keyword: 'weak geo spam',
      error: 'fail',
    });

    const fb = await req(server, 'GET', '/api/seo-autopilot/feedback', { tid: 7 });
    assert.ok(fb.body.ok);
    assert.ok(fb.body.feedback.summary);

    const rp = await req(server, 'POST', '/api/seo-autopilot/replan', { tid: 7, body: { apply: true } });
    assert.ok(rp.body.ok);
    assert.ok(Array.isArray(rp.body.changes));

    const ev = await req(server, 'POST', '/api/seo-autopilot/evaluate-article', {
      tid: 7,
      body: { html: '<p>Hi</p>', keyword: 'geo seo', optimize: true },
    });
    assert.ok(ev.body.ok);
    assert.ok(ev.body.content.length > 20);

    const st = await req(server, 'GET', '/api/seo-autopilot/status', { tid: 7 });
    assert.ok(st.body.capabilities.includes('eval_optimizer'));
  } finally {
    server.close();
  }
});

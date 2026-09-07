'use strict';
// Dummy-key / provider-down fallback for POST /api/ai-attack-plan.
// Mounts only services/ai_content/routes.js with stub LLM clients so the
// dummy-key path never hits a vendor network (rule 04 / rule 07).

require('./helpers/env');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const https = require('node:https');
const express = require('express');
const { EventEmitter } = require('events');

const register = require('../services/ai_content/routes');
const { detectFabrication } = require('../services/admin/enforcement');

const KEY_ENVS = [
  'AI_INTEGRATIONS_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY',
];

const savedKeys = {};
for (const k of KEY_ENVS) savedKeys[k] = process.env[k];

function setKeys(map) {
  for (const k of KEY_ENVS) {
    if (map[k] === undefined) delete process.env[k];
    else process.env[k] = map[k];
  }
}

function restoreKeys() {
  for (const k of KEY_ENVS) {
    if (savedKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedKeys[k];
  }
}

let networkHits = 0;

function isLocalUrl(urlOrOpts) {
  try {
    if (typeof urlOrOpts === 'string') {
      const u = new URL(urlOrOpts);
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    }
    const host = (urlOrOpts && (urlOrOpts.hostname || urlOrOpts.host)) || '';
    return host === '127.0.0.1' || host === 'localhost' || String(host).startsWith('127.0.0.1:');
  } catch {
    return false;
  }
}

function makeBlockedReq() {
  const req = new EventEmitter();
  req.setTimeout = () => req;
  req.write = () => {};
  req.destroy = () => {};
  req.end = () => {
    networkHits += 1;
    req.emit('error', new Error('network must not be called'));
  };
  return req;
}

const origHttpsRequest = https.request;
const origHttpRequest = http.request;
const origFetch = global.fetch;

https.request = function blockedHttps(urlOrOpts, optsOrCb, maybeCb) {
  if (isLocalUrl(urlOrOpts)) return origHttpsRequest.apply(this, arguments);
  return makeBlockedReq();
};
http.request = function guardedHttp(urlOrOpts, optsOrCb, maybeCb) {
  if (isLocalUrl(urlOrOpts)) return origHttpRequest.apply(this, arguments);
  return makeBlockedReq();
};
global.fetch = async function guardedFetch(url, opts) {
  const raw = typeof url === 'string' ? url : (url && (url.url || url.href)) || '';
  if (isLocalUrl(raw)) return origFetch(url, opts);
  networkHits += 1;
  throw new Error('network must not be called');
};

const clientCalls = { openai: 0, anthropic: 0 };

function gptPayload(plan) {
  return { choices: [{ message: { content: JSON.stringify(plan) } }] };
}
function claudePayload(plan) {
  return { content: [{ text: JSON.stringify(plan) }] };
}

const stubOpenai = {
  chat: {
    completions: {
      create: async () => {
        clientCalls.openai += 1;
        throw new Error('openai stub must be overridden');
      },
    },
  },
};
const stubAnthropic = {
  messages: {
    create: async () => {
      clientCalls.anthropic += 1;
      throw new Error('anthropic stub must be overridden');
    },
  },
};

const app = express();
app.use(express.json());
register(app, {
  _tkvCtx: { resolveTenantId: async () => 1 },
  anthropic: stubAnthropic,
  callDataForSEO: async () => { throw new Error('unused'); },
  callRapidAPI: async () => { throw new Error('unused'); },
  getDataForSEOAuth: () => '',
  getRapidApiKey: () => '',
  https,
  loadAivisHistory: async () => ({}),
  openai: stubOpenai,
  path: require('path'),
});

let server;
let baseUrl;

before(async () => {
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  https.request = origHttpsRequest;
  http.request = origHttpRequest;
  global.fetch = origFetch;
  restoreKeys();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  networkHits = 0;
  clientCalls.openai = 0;
  clientCalls.anthropic = 0;
  stubOpenai.chat.completions.create = async () => {
    clientCalls.openai += 1;
    throw new Error('openai stub default reject');
  };
  stubAnthropic.messages.create = async () => {
    clientCalls.anthropic += 1;
    throw new Error('anthropic stub default reject');
  };
});

async function postPlan(body) {
  const res = await fetch(`${baseUrl}/api/ai-attack-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {
      myDomain: 'acme.test',
      competitor: 'rival.test',
      industry: 'payroll software',
      prefillKeywords: ['payroll comparison'],
    }),
  });
  return { status: res.status, json: await res.json() };
}

function assertTemplateContract(body) {
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.source, 'template');
  assert.strictEqual(body._fabricated, true);
  assert.deepStrictEqual(body.sources, ['template']);
  assert.ok(body.plan && typeof body.plan === 'object');
  assert.ok(typeof body.plan.executiveSummary === 'string' && body.plan.executiveSummary);
  assert.strictEqual(typeof body.plan.opportunityScore, 'number');
  assert.ok(body.plan.estimatedROILift);
  assert.ok(body.plan.timeToResults);
  assert.ok(Array.isArray(body.plan.weeklyPlan) && body.plan.weeklyPlan.length === 4);
  for (const week of body.plan.weeklyPlan) {
    assert.ok(week.week && week.focus && week.kpi);
    assert.ok(Array.isArray(week.actions) && week.actions.length >= 3);
  }
  assert.ok(Array.isArray(body.plan.keywordTargets) && body.plan.keywordTargets.length === 5);
  for (const kw of body.plan.keywordTargets) {
    assert.ok(kw.keyword && kw.volume && kw.cpc && kw.intent && kw.priority);
  }
  assert.ok(Array.isArray(body.plan.channelStrategy) && body.plan.channelStrategy.length === 4);
  const budgetSum = body.plan.channelStrategy.reduce((s, c) => s + Number(c.budgetPct || 0), 0);
  assert.strictEqual(budgetSum, 100);
  assert.ok(Array.isArray(body.plan.contentAttacks) && body.plan.contentAttacks.length === 3);
  assert.ok(Array.isArray(body.plan.criticalWins) && body.plan.criticalWins.length === 3);
  for (const w of body.plan.criticalWins) {
    assert.ok(w.win && w.impact && w.effort && w.timeframe);
  }
  const marker = detectFabrication(body);
  assert.ok(marker, 'enforcement must see a fabrication marker');
  assert.strictEqual(networkHits, 0);
  assert.strictEqual(clientCalls.openai, 0);
  assert.strictEqual(clientCalls.anthropic, 0);
}

function assertLiveUntagged(body) {
  assert.strictEqual(body.ok, true);
  assert.ok(body.plan && typeof body.plan === 'object');
  assert.notStrictEqual(body.source, 'template');
  assert.notStrictEqual(body._fabricated, true);
  assert.ok(!detectFabrication(body), 'live AI output must not be honesty-tagged');
}

const samplePlan = (suffix) => ({
  executiveSummary: `Live plan ${suffix}`,
  opportunityScore: suffix === 'gpt' ? 70 : 80,
  estimatedROILift: '+10%',
  timeToResults: '6-8 weeks',
  weeklyPlan: [
    { week: 'Week 1–2', focus: 'A', actions: [`${suffix} action`, 'shared action'], kpi: 'k1' },
    { week: 'Week 3–4', focus: 'B', actions: ['launch'], kpi: 'k2' },
    { week: 'Week 5–6', focus: 'C', actions: ['scale'], kpi: 'k3' },
    { week: 'Week 7–8', focus: 'D', actions: ['expand'], kpi: 'k4' },
  ],
  keywordTargets: [
    { keyword: 'shared kw', volume: '1', cpc: '$1', intent: 'Commercial', priority: 'Critical' },
    { keyword: `${suffix} only`, volume: '1', cpc: '$1', intent: 'Informational', priority: 'High' },
  ],
  channelStrategy: [
    { channel: 'Google Search', budgetPct: 40, tactic: suffix === 'claude' ? 'much longer claude tactic for google' : 'gpt', expectedROAS: '1x' },
  ],
  contentAttacks: [
    { title: 'shared title', type: 'Blog Post', angle: 'a', cta: 'c' },
    { title: `${suffix} content`, type: 'Video Ad', angle: 'a', cta: 'c' },
  ],
  criticalWins: [
    { win: 'shared win', impact: 'High', effort: 'Low', timeframe: 'This week' },
    { win: `${suffix} win`, impact: 'High', effort: 'Low', timeframe: 'Week 2' },
  ],
});

test('dummy keys return a tagged template plan with no network', async () => {
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: '_DUMMY_ATTACK_PLAN',
    OPENAI_API_KEY: '_DUMMY_ATTACK_PLAN',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: '_dummy_claude',
    ANTHROPIC_API_KEY: '_dummy_claude',
  });
  const { status, json } = await postPlan();
  assert.strictEqual(status, 200);
  assertTemplateContract(json);
  assert.match(json.plan.executiveSummary, /acme\.test/);
  assert.strictEqual(json.plan.keywordTargets[0].keyword, 'payroll comparison');
  assert.strictEqual(json.plan.keywordTargets[0].priority, 'Critical');
});

test('missing keys return a tagged template plan with no network', async () => {
  setKeys({});
  const { status, json } = await postPlan();
  assert.strictEqual(status, 200);
  assertTemplateContract(json);
});

test('both providers failing or unparseable falls back to tagged template', async () => {
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: 'sk-test-not-dummy',
    OPENAI_API_KEY: 'sk-test-not-dummy',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
  });
  stubOpenai.chat.completions.create = async () => {
    clientCalls.openai += 1;
    return { choices: [{ message: { content: 'not-json' } }] };
  };
  stubAnthropic.messages.create = async () => {
    clientCalls.anthropic += 1;
    throw new Error('claude down');
  };
  const { status, json } = await postPlan();
  assert.strictEqual(status, 200);
  assert.strictEqual(json.ok, true);
  assert.strictEqual(json.source, 'template');
  assert.strictEqual(json._fabricated, true);
  assert.deepStrictEqual(json.sources, ['template']);
  assert.ok(detectFabrication(json));
  assert.strictEqual(networkHits, 0);
  assert.strictEqual(clientCalls.openai, 1);
  assert.strictEqual(clientCalls.anthropic, 1);
});

test('single live provider is returned untagged', async () => {
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: 'sk-test-not-dummy',
    OPENAI_API_KEY: 'sk-test-not-dummy',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: '_DUMMY_CLAUDE',
    ANTHROPIC_API_KEY: '_DUMMY_CLAUDE',
  });
  const live = samplePlan('gpt');
  stubOpenai.chat.completions.create = async () => {
    clientCalls.openai += 1;
    return gptPayload(live);
  };
  const { status, json } = await postPlan();
  assert.strictEqual(status, 200);
  assertLiveUntagged(json);
  assert.deepStrictEqual(json.sources, ['GPT-4o']);
  assert.strictEqual(json.plan.executiveSummary, 'Live plan gpt');
  assert.strictEqual(clientCalls.openai, 1);
  assert.strictEqual(clientCalls.anthropic, 0);
  assert.strictEqual(networkHits, 0);
});

test('both live providers merge without honesty tags', async () => {
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: 'sk-test-not-dummy',
    OPENAI_API_KEY: 'sk-test-not-dummy',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
  });
  stubOpenai.chat.completions.create = async () => {
    clientCalls.openai += 1;
    return gptPayload(samplePlan('gpt'));
  };
  stubAnthropic.messages.create = async () => {
    clientCalls.anthropic += 1;
    return claudePayload(samplePlan('claude'));
  };
  const { status, json } = await postPlan();
  assert.strictEqual(status, 200);
  assertLiveUntagged(json);
  assert.deepStrictEqual(json.sources, ['GPT-4o', 'Claude']);
  assert.strictEqual(json.plan.opportunityScore, 80);
  const kws = json.plan.keywordTargets.map((k) => k.keyword);
  assert.ok(kws.includes('shared kw'));
  assert.ok(kws.includes('gpt only'));
  assert.ok(kws.includes('claude only'));
  assert.ok(json.plan.weeklyPlan[0].actions.includes('gpt action'));
  assert.ok(json.plan.weeklyPlan[0].actions.includes('claude action'));
  assert.ok(json.plan.channelStrategy[0].tactic.includes('much longer claude tactic'));
  const wins = json.plan.criticalWins.map((w) => w.win);
  assert.ok(wins.includes('shared win'));
  assert.ok(wins.includes('gpt win'));
  assert.ok(wins.includes('claude win'));
  const titles = json.plan.contentAttacks.map((c) => c.title);
  assert.ok(titles.includes('shared title'));
  assert.ok(titles.includes('gpt content'));
  assert.ok(titles.includes('claude content'));
  assert.strictEqual(clientCalls.openai, 1);
  assert.strictEqual(clientCalls.anthropic, 1);
  assert.strictEqual(networkHits, 0);
});

test('unexpected hard failure returns ok:false without a plan', async () => {
  setKeys({
    AI_INTEGRATIONS_OPENAI_API_KEY: 'sk-test-not-dummy',
    OPENAI_API_KEY: 'sk-test-not-dummy',
    AI_INTEGRATIONS_ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-dummy',
  });
  const { status, json } = await postPlan({
    myDomain: 'acme.test',
    competitor: 'rival.test',
    industry: 'payroll software',
    competitorData: null,
  });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(json, { ok: false, plan: null, error: json.error });
  assert.ok(typeof json.error === 'string' && json.error);
  assert.strictEqual(json.source, undefined);
  assert.notStrictEqual(json._fabricated, true);
  assert.strictEqual(networkHits, 0);
});

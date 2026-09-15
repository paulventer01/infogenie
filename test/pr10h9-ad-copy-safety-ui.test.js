'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

function load(file) {
  const cache = load.cache || (load.cache = new Map());
  if (cache.has(file)) return cache.get(file);
  const { outputText } = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '..', file), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id.startsWith('@/')) {
      const rel = id.slice(2);
      const ext = rel.startsWith('components/') ? '.tsx' : '.ts';
      return load(rel + ext);
    }
    return require(id);
  }, mod);
  cache.set(file, mod.exports);
  return mod.exports;
}

function json(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

const surfaces = {
  score: { file: 'create/AdCreative', input: 'input[placeholder*="Stop wasting money"]', button: 'Score This Creative' },
  ugc: { file: 'create/AdCreative', input: 'input[placeholder="e.g. AI email writing tool"]', button: 'Generate Script' },
  packages: { file: 'grow/LandingPages', input: 'input[placeholder="e.g. Air Max 270 launch"]', button: 'Generate Ad Package' },
};
async function harness(t, surface) {
  const config = surfaces[surface];
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/create' });
  const state = { response: null, pending: null, pageId: 10, copied: '' };
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => { state.copied = text; } } });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => {
      if (url.includes('/history')) return json({ ok: true, items: [] });
      if (url === '/api/landing-pages/generate') return json({ ok: true, id: ++state.pageId, html: '<p>Landing page</p>', source: 'template' });
      assert.ok(['/api/ad-creative/score', '/api/ad-creative/ugc-script', '/api/ad-creative/from-landing-page'].includes(url));
      const response = state.pending ? await state.pending : state.response;
      assert.ok(response);
      return json(response, response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
    },
  };
  const previous = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(global, k)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const Component = load(`components/features/${config.file}.tsx`).default;
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, desc] of previous) { if (desc) Object.defineProperty(global, key, desc); else delete global[key]; }
  });
  await act(async () => root.render(React.createElement(Component)));
  const input = document.querySelector(config.input); assert.ok(input);
  await act(async () => require('react-dom/test-utils').Simulate.change(input, { target: { value: 'Keep my input' } }));
  async function click(label) {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(label));
    assert.ok(button, label); await act(async () => button.click());
  }
  if (surface === 'packages') { await click('Generate Page'); await click('📣 Ad Package'); }
  async function generate(response) { state.response = response; await click(config.button); }
  return { generate, click, state, input, document, text: () => dom.window.document.body.textContent };
}
function success(surface, text, warnings = []) {
  const payload = surface === 'score' ? { overall: 0, verdict: text, scores: { hook_strength: 0, cta_clarity: null }, grade: null }
    : surface === 'ugc' ? { scenes: [{ script: text, type: 'hook' }], caption: 'Launch caption' }
      : { packages: [{ platform: 'Meta', headline: text }] };
  return { ok: true, source: 'openai', ...payload, content_safety_warnings: warnings };
}
for (const surface of Object.keys(surfaces)) {
  for (const error of ['content_safety_blocked', 'content_safety_unavailable']) {
    test(`${surface}: failure preserves result, warnings and input; retry clears alert`, async t => {
      const h = await harness(t, surface);
      await h.generate(success(surface, 'Existing result', ['Review this claim']));
      assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
      await h.generate({ ok: false, error, userMessage: 'Please revise or retry later.' });
      assert.match(h.document.querySelector('[role="alert"]').textContent, /Please revise or retry later/);
      assert.match(h.text(), /Existing result/); assert.match(h.text(), /Review this claim/);
      assert.equal(h.input.value, 'Keep my input');
      await h.generate(success(surface, 'Replacement result'));
      assert.equal(h.document.querySelector('[role="alert"]'), null);
      assert.match(h.text(), /Replacement result/);
      assert.doesNotMatch(h.text(), /Existing result|Review this claim|CONTENT SAFETY WARNINGS/);
    });
  }
  test(`${surface}: initial failure shows no new output`, async t => {
    const h = await harness(t, surface);
    await h.generate({ ok: false, error: 'content_safety_blocked', userMessage: 'Request human review.' });
    assert.match(h.document.querySelector('[role="alert"]').textContent, /Request human review/);
    assert.doesNotMatch(h.text(), /CONTENT SAFETY WARNINGS|Ad Package Ready|POST CAPTION|IMPROVEMENT TIPS/);
  });
}

test('score shows zero and withholds missing dimensions/grade', async t => {
  const h = await harness(t, 'score');
  await h.generate(success('score', 'Zero-score example'));
  assert.match(h.text(), /0\/10/); assert.match(h.text(), /—\/10/);
  const scorer = h.document.getElementById('csScorer');
  assert.match(scorer.textContent, /—GRADE/);
  await h.generate({ ...success('score', 'Missing-score example'), overall: null });
  assert.match(scorer.textContent, /—\/ 100/);
});

test('landing-page switch ignores a late ad-package result and its warnings', async t => {
  const h = await harness(t, 'packages');
  let finish;
  h.state.pending = new Promise(resolve => { finish = resolve; });
  await h.click('Generate Ad Package');
  await h.click('Generate Page');
  await act(async () => finish(success('packages', 'Stale result', ['Stale warning'])));
  h.state.pending = null;
  await h.click('📣 Ad Package');
  assert.doesNotMatch(h.text(), /Stale result|Stale warning|Ad Package Ready/);
  await h.generate(success('packages', 'Current page result'));
  assert.match(h.text(), /Current page result/);
});

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

async function harness(t, surface, history = []) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/create' });
  const state = { response: null };
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url) => {
      if (url.includes('/history')) return json({ ok: true, items: history });
      assert.equal(url, `/api/${surface === 'PressRelease' ? 'press-release' : 'ad-creative'}/generate`);
      assert.ok(state.response);
      return json(state.response, state.response.ok ? 200 : state.response.error === 'content_safety_unavailable' ? 503 : 403);
    },
  };
  const previous = new Map(Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(global, k)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(global, key, { configurable: true, writable: true, value });
  const Component = load(`components/features/create/${surface}.tsx`).default;
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, desc] of previous) { if (desc) Object.defineProperty(global, key, desc); else delete global[key]; }
  });
  await act(async () => root.render(React.createElement(Component)));
  const input = surface === 'PressRelease' ? document.querySelector('textarea') : document.querySelector('input[placeholder*="Stop overpaying"]');
  await act(async () => {
    require('react-dom/test-utils').Simulate.change(input, { target: { value: 'Keep this user input' } });
  });
  async function generate(response) {
    state.response = response;
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes(surface === 'PressRelease' ? 'Generate Press Release' : 'Generate Creative'));
    assert.ok(button, 'generation button exists');
    await act(async () => button.click());
  }
  return { generate, input, document, text: () => dom.window.document.body.textContent };
}

function success(surface, text, warnings = []) {
  return surface === 'PressRelease'
    ? { ok: true, source: 'openai', release: { headline: text, body: 'Launch details' }, content_safety_warnings: warnings }
    : { ok: true, source: 'placeholder', image_url: '/test-creative.png', prompt: text, content_safety_warnings: warnings };
}

for (const surface of ['PressRelease', 'AdCreative']) {
  for (const error of ['content_safety_blocked', 'content_safety_unavailable']) {
    test(`${surface}: ${error} preserves prior result, warnings and inputs; successful retry clears alert`, async t => {
      const h = await harness(t, surface);
      await h.generate(success(surface, 'Existing result', ['Existing caution']));
      assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
      assert.match(h.text(), /Existing caution/);
      await h.generate({ ok: false, error, userMessage: 'Revise your content or retry later.' });
      assert.equal(h.document.querySelector('[role="alert"]').textContent, 'Revise your content or retry later.');
      assert.match(h.text(), /Existing result/);
      assert.match(h.text(), /Existing caution/);
      assert.equal(h.input.value, 'Keep this user input');
      await h.generate(success(surface, 'Replacement result'));
      assert.equal(h.document.querySelector('[role="alert"]'), null);
      assert.match(h.text(), /Replacement result/);
      assert.doesNotMatch(h.text(), /Existing result|Existing caution|CONTENT SAFETY WARNINGS/);
    });
  }
  test(`${surface}: first blocked generation renders alert without usable new output`, async t => {
    const h = await harness(t, surface);
    await h.generate({ ok: false, error: 'content_safety_blocked', userMessage: 'Request human review.' });
    assert.equal(h.document.querySelector('[role="alert"]').textContent, 'Request human review.');
    assert.equal(h.document.querySelector('#prFull'), null);
    assert.equal(h.document.querySelector('img'), null);
  });
}

test('AdCreative renders persisted warnings when history loads on a fresh mount', async t => {
  const h = await harness(t, 'AdCreative', [{ id: 2, image_url: '/saved.png', headline: 'Saved creative',
    platform: 'facebook_ad', style: 'minimalist', content_safety_warnings: ['Saved warning for review'] }]);
  assert.match(h.text(), /Saved creative/);
  assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
  assert.match(h.text(), /Saved warning for review/);
});

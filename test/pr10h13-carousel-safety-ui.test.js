// test/pr10h13-carousel-safety-ui.test.js — rendered UI acceptance for PR10H.13
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

const router = { push: () => {} };

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
    if (id === 'next/navigation') return { useRouter: () => router };
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

const SAFE_SLIDE = {
  n: 1,
  role: 'Hook',
  headline: 'Existing hook headline',
  body: 'Existing body copy for the carousel.',
  visualHint: 'Bold hero layout',
};

function successCarousel(warnings = []) {
  return {
    ok: true,
    topic: 'Existing carousel topic',
    structure: 'pure-info',
    structureLabel: 'Pure Info',
    slides: [SAFE_SLIDE],
    source: 'template',
    content_safety_warnings: warnings,
  };
}

async function harness(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/create' });
  const state = {
    generateResponse: null,
    loadResponse: null,
    holdGenerate: false,
    holdLoad: false,
    pendingGenerate: [],
    pendingLoad: [],
  };
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init) => {
      if (url === '/api/carousel/structures') {
        return json({
          ok: true,
          structures: {
            'pure-info': { label: 'Pure Info', description: 'Straight value' },
          },
        });
      }
      if (url === '/api/carousel/list') {
        return json({ ok: true, items: options.history || [] });
      }
      if (url === '/api/carousel/generate') {
        if (state.holdGenerate) {
          state.holdGenerate = false;
          return new Promise((resolve) => {
            state.pendingGenerate.push({
              resolve,
              response: state.generateResponse,
            });
          });
        }
        assert.ok(state.generateResponse);
        const r = state.generateResponse;
        const status = r.ok ? 200 : r.error === 'content_safety_unavailable' ? 503 : 403;
        return json(r, status);
      }
      if (url.startsWith('/api/carousel/')) {
        if (state.holdLoad) {
          state.holdLoad = false;
          return new Promise((resolve) => {
            state.pendingLoad.push({
              resolve,
              response: state.loadResponse,
            });
          });
        }
        assert.ok(state.loadResponse);
        const r = state.loadResponse;
        const status = r.ok ? 200 : 404;
        return json(r, status);
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  };
  const previous = new Map(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(global, k)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const Component = load('components/features/create/Carousel.tsx').default;
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, desc] of previous) {
      if (desc) Object.defineProperty(global, key, desc);
      else delete global[key];
    }
  });
  await act(async () => root.render(React.createElement(Component)));

  const topicInput = document.querySelector('input[placeholder*="small businesses"]');
  assert.ok(topicInput, 'topic input exists');

  async function setTopic(value) {
    await act(async () => {
      require('react-dom/test-utils').Simulate.change(topicInput, { target: { value } });
    });
  }

  async function clickGenerate() {
    const button = [...document.querySelectorAll('button')].find((b) => (
      b.textContent.includes('Generate 10-Slide Carousel')
      || b.textContent.includes('Drafting your slides')
    ));
    assert.ok(button, 'generate button exists');
    await act(async () => button.click());
  }

  async function generate(response, { pending = false } = {}) {
    state.generateResponse = response;
    state.holdGenerate = pending;
    await clickGenerate();
  }

  async function finishPendingGenerate(index = 0) {
    const item = state.pendingGenerate[index];
    assert.ok(item, `expected pending generate at index ${index}`);
    const r = item.response;
    const status = r.ok ? 200 : r.error === 'content_safety_unavailable' ? 503 : 403;
    await act(async () => {
      item.resolve(json(r, status));
    });
    state.pendingGenerate.splice(index, 1);
  }

  async function loadCarousel(response, { pending = false } = {}) {
    state.loadResponse = response;
    state.holdLoad = pending;
    const openBtn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Open');
    assert.ok(openBtn, 'open history button exists');
    await act(async () => openBtn.click());
  }

  async function finishPendingLoad(index = 0) {
    const item = state.pendingLoad[index];
    assert.ok(item, `expected pending load at index ${index}`);
    const r = item.response;
    await act(async () => {
      item.resolve(json(r, r.ok ? 200 : 404));
    });
    state.pendingLoad.splice(index, 1);
  }

  function isLoading() {
    const text = dom.window.document.body.textContent;
    return text.includes('Generating 10 slides') || text.includes('Loading carousel');
  }

  async function waitFor(check, attempts = 40) {
    for (let i = 0; i < attempts; i += 1) {
      if (check()) return;
      await act(async () => {});
    }
    throw new Error('waitFor timed out');
  }

  return {
    document,
    dom,
    setTopic,
    clickGenerate,
    generate,
    finishPendingGenerate,
    loadCarousel,
    finishPendingLoad,
    waitFor,
    isLoading,
    text: () => dom.window.document.body.textContent,
    alerts: () => [...document.querySelectorAll('[role="alert"]')],
  };
}

for (const error of ['content_safety_blocked', 'content_safety_unavailable']) {
  test(`Carousel: ${error} preserves prior slides, warnings and topic; successful retry clears alert`, async (t) => {
    const h = await harness(t);
    await h.setTopic('Keep this topic input');
    await h.generate(successCarousel(['Existing caution']));
    assert.match(h.text(), /Existing hook headline/);
    assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
    assert.match(h.text(), /Existing caution/);

    await h.generate({
      ok: false,
      error,
      userMessage: 'Revise your carousel or retry later.',
    });
    assert.equal(h.alerts()[0].textContent, 'Revise your carousel or retry later.');
    assert.match(h.text(), /Existing hook headline/);
    assert.match(h.text(), /Existing caution/);
    assert.equal(document.querySelector('input[placeholder*="small businesses"]').value, 'Keep this topic input');

    await h.generate(successCarousel());
    assert.equal(h.document.querySelector('[role="alert"]'), null);
    assert.match(h.text(), /Existing hook headline/);
    assert.doesNotMatch(h.text(), /Existing caution|CONTENT SAFETY WARNINGS/);
  });
}

test('Carousel: first blocked generation renders alert without usable slides', async (t) => {
  const h = await harness(t);
  await h.setTopic('Blocked first attempt');
  await h.generate({
    ok: false,
    error: 'content_safety_blocked',
    userMessage: 'Request human review.',
  });
  assert.equal(h.alerts()[0].textContent, 'Request human review.');
  assert.doesNotMatch(h.text(), /SLIDE 1/);
});

test('Carousel: warning-only success displays persisted warnings', async (t) => {
  const h = await harness(t);
  await h.setTopic('Warning-only carousel');
  await h.generate(successCarousel(['Warning-only carousel retained this caution.']));
  assert.match(h.text(), /Warning-only carousel retained this caution/);
  assert.equal(h.alerts().length, 0);
});

test('Carousel: loading stays active until the latest pending generate finishes', async (t) => {
  const h = await harness(t);
  await h.setTopic('Concurrent generates');
  await h.generate(successCarousel(['First request warning']), { pending: true });
  await h.generate({
    ok: true,
    topic: 'Second topic',
    structure: 'pure-info',
    structureLabel: 'Pure Info',
    slides: [{ ...SAFE_SLIDE, headline: 'Second hook headline' }],
    source: 'template',
    content_safety_warnings: [],
  }, { pending: true });
  assert.ok(h.isLoading(), 'expected loading indicator while both requests are pending');

  await h.finishPendingGenerate(0);
  await h.waitFor(() => h.isLoading());
  assert.ok(h.isLoading(), 'loading should remain while the second generate is still pending');

  await h.finishPendingGenerate(0);
  await h.waitFor(() => !h.isLoading());
  assert.match(h.text(), /Second hook headline/);
  assert.doesNotMatch(h.text(), /First request warning/);
});

test('Carousel: ignores a late blocked response after a newer generate succeeds', async (t) => {
  const h = await harness(t);
  await h.setTopic('First topic');
  await h.generate(successCarousel(['Baseline warning']), { pending: true });
  await h.setTopic('Second topic');
  await h.generate({
    ok: true,
    topic: 'Second topic',
    structure: 'pure-info',
    structureLabel: 'Pure Info',
    slides: [{ ...SAFE_SLIDE, headline: 'Replacement hook headline' }],
    source: 'template',
    content_safety_warnings: [],
  });
  await h.waitFor(() => h.text().includes('Replacement hook headline'));
  await h.finishPendingGenerate();
  await h.waitFor(() => true);
  assert.equal(h.alerts().length, 0);
  assert.match(h.text(), /Replacement hook headline/);
  assert.doesNotMatch(h.text(), /Baseline warning/);
});

test('Carousel: restores warnings when loading a saved carousel', async (t) => {
  const h = await harness(t, {
    history: [{
      id: 55,
      topic: 'Saved carousel topic',
      structure: 'pure-info',
      created_at: new Date().toISOString(),
    }],
  });
  await h.waitFor(() => h.text().includes('Saved carousel topic'));
  await h.loadCarousel({
    ok: true,
    item: {
      id: 55,
      topic: 'Saved carousel topic',
      structure: 'pure-info',
      slides: [SAFE_SLIDE],
      meta: {
        source: 'template',
        structureLabel: 'Pure Info',
        content_safety_warnings: ['Reloaded carousel warning.'],
      },
    },
    content_safety_warnings: ['Reloaded carousel warning.'],
  });
  await h.waitFor(() => h.text().includes('Reloaded carousel warning.'));
  assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
  assert.match(h.text(), /Existing hook headline/);
});

test('Carousel component renders ContentSafetyWarnings import', () => {
  const src = fs.readFileSync(require.resolve('../components/features/create/Carousel.tsx'), 'utf8');
  assert.match(src, /ContentSafetyWarnings/);
  assert.match(src, /content_safety_warnings/);
  assert.match(src, /generateRequestRef/);
  assert.match(src, /loadRequestRef/);
  assert.match(src, /role="alert"/);
});

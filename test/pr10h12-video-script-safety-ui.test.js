// test/pr10h12-video-script-safety-ui.test.js — rendered UI acceptance for PR10H.12
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

const SAFE_SCRIPT = {
  hook: 'Existing hook line',
  body: [{ line: 'Existing body spoken', onscreen_text: 'EXISTING', cue: 'pan left' }],
  cta: 'Existing CTA',
  viral_pattern: 'curiosity_gap',
  hashtags: ['#existing'],
};

function successScripts(warnings = []) {
  return {
    ok: true,
    scripts: [SAFE_SCRIPT],
    content_safety_warnings: warnings,
  };
}

async function harness(t, options = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/create' });
  const state = {
    response: null,
    holdNext: false,
    pendingQueue: [],
  };
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, init) => {
      assert.equal(url, '/api/video-script/generate');
      if (state.holdNext) {
        state.holdNext = false;
        return new Promise((resolve) => {
          state.pendingQueue.push({
            resolve,
            response: state.response,
          });
        });
      }
      assert.ok(state.response);
      return json(
        state.response,
        state.response.ok ? 200 : state.response.error === 'content_safety_unavailable' ? 503 : 403,
      );
    },
  };
  const previous = new Map(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(global, k)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  const Component = load('components/features/create/VideoScript.tsx').default;
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

  const topicInput = document.querySelector('input[placeholder*="analytics dashboard"]');
  assert.ok(topicInput, 'topic input exists');

  async function setTopic(value) {
    await act(async () => {
      require('react-dom/test-utils').Simulate.change(topicInput, { target: { value } });
    });
  }

  async function clickGenerate() {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Generate Scripts'));
    assert.ok(button, 'generate button exists');
    await act(async () => button.click());
  }

  async function generate(response, { pending = false } = {}) {
    state.response = response;
    state.holdNext = pending;
    await clickGenerate();
  }

  async function finishPending(index = 0) {
    const item = state.pendingQueue[index];
    assert.ok(item, `expected pending generate at index ${index}`);
    await act(async () => {
      item.resolve(json(
        item.response,
        item.response.ok ? 200 : item.response.error === 'content_safety_unavailable' ? 503 : 403,
      ));
    });
    state.pendingQueue.splice(index, 1);
  }

  function isLoading() {
    return dom.window.document.body.textContent.includes('Generating');
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
    finishPending,
    waitFor,
    isLoading,
    text: () => dom.window.document.body.textContent,
    alerts: () => [...document.querySelectorAll('[role="alert"]')],
  };
}

for (const error of ['content_safety_blocked', 'content_safety_unavailable']) {
  test(`VideoScript: ${error} preserves prior scripts, warnings and topic; successful retry clears alert`, async (t) => {
    const h = await harness(t);
    await h.setTopic('Keep this topic input');
    await h.generate(successScripts(['Existing caution']));
    assert.match(h.text(), /Existing hook line/);
    assert.match(h.text(), /CONTENT SAFETY WARNINGS/);
    assert.match(h.text(), /Existing caution/);

    await h.generate({
      ok: false,
      error,
      userMessage: 'Revise your script or retry later.',
    });
    assert.equal(h.alerts()[0].textContent, 'Revise your script or retry later.');
    assert.match(h.text(), /Existing hook line/);
    assert.match(h.text(), /Existing caution/);
    assert.equal(document.querySelector('input[placeholder*="analytics dashboard"]').value, 'Keep this topic input');

    await h.generate(successScripts());
    assert.equal(h.document.querySelector('[role="alert"]'), null);
    assert.match(h.text(), /Existing hook line/);
    assert.doesNotMatch(h.text(), /Existing caution|CONTENT SAFETY WARNINGS/);
  });
}

test('VideoScript: first blocked generation renders alert without usable scripts', async (t) => {
  const h = await harness(t);
  await h.setTopic('Blocked first attempt');
  await h.generate({
    ok: false,
    error: 'content_safety_blocked',
    userMessage: 'Request human review.',
  });
  assert.equal(h.alerts()[0].textContent, 'Request human review.');
  assert.doesNotMatch(h.text(), /Variant 1/);
});

test('VideoScript: warning-only success displays persisted warnings', async (t) => {
  const h = await harness(t);
  await h.setTopic('Warning-only scripts');
  await h.generate(successScripts(['Warning-only script retained this caution.']));
  assert.match(h.text(), /Warning-only script retained this caution/);
  assert.equal(h.alerts().length, 0);
});

test('VideoScript: loading stays active until the latest pending generate finishes', async (t) => {
  const h = await harness(t);
  await h.setTopic('Concurrent generates');
  await h.generate(successScripts(['First request warning']), { pending: true });
  await h.generate({
    ok: true,
    scripts: [{ ...SAFE_SCRIPT, hook: 'Second hook line' }],
    content_safety_warnings: [],
  }, { pending: true });
  assert.ok(h.isLoading(), 'expected loading indicator while both requests are pending');

  await h.finishPending(0);
  await h.waitFor(() => h.isLoading());
  assert.ok(h.isLoading(), 'loading should remain while the second generate is still pending');

  await h.finishPending(0);
  await h.waitFor(() => !h.isLoading());
  assert.match(h.text(), /Second hook line/);
  assert.doesNotMatch(h.text(), /First request warning/);
});

test('VideoScript: ignores a late blocked response after a newer generate succeeds', async (t) => {
  const h = await harness(t);
  await h.setTopic('First topic');
  await h.generate(successScripts(['Baseline warning']), { pending: true });
  await h.setTopic('Second topic');
  await h.generate({
    ok: true,
    scripts: [{ ...SAFE_SCRIPT, hook: 'Replacement hook line' }],
    content_safety_warnings: [],
  });
  await h.waitFor(() => h.text().includes('Replacement hook line'));
  await h.finishPending();
  await h.waitFor(() => true);
  assert.equal(h.alerts().length, 0);
  assert.match(h.text(), /Replacement hook line/);
  assert.doesNotMatch(h.text(), /Baseline warning/);
});

test('VideoScript component renders ContentSafetyWarnings import', () => {
  const src = fs.readFileSync(require.resolve('../components/features/create/VideoScript.tsx'), 'utf8');
  assert.match(src, /ContentSafetyWarnings/);
  assert.match(src, /content_safety_warnings/);
  assert.match(src, /generateRequestRef/);
  assert.match(src, /role="alert"/);
});

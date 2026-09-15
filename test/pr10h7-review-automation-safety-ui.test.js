// test/pr10h7-review-automation-safety-ui.test.js — rendered UI acceptance for PR10H.7
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

async function reviewHarness(t, opts = {}) {
  const state = {
    drafts: opts.drafts || [{
      id: 1,
      platform: 'Google',
      reviewer_name: 'Alice',
      rating: 5,
      review_text: 'Great service',
      ai_draft_reply: 'Thank you for your kind words!',
      status: 'pending',
      created_at: '2026-01-01T00:00:00.000Z',
      content_safety_warnings: opts.warnings || [],
    }],
    generateHandler: opts.generateHandler || null,
  };

  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/compete/review-automation',
    pretendToBeVisual: true,
  });

  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.includes('/api/review-monitor/replies?status=pending')) {
        return json({ ok: true, drafts: state.drafts });
      }
      if (url.endsWith('/api/review-monitor/request-rules')) {
        return json({ ok: true, rules: [] });
      }
      if (url.endsWith('/api/review-monitor/request-logs')) {
        return json({ ok: true, logs: [] });
      }
      if (url.endsWith('/api/review-monitor/replies/generate') && method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        const response = state.generateHandler
          ? await state.generateHandler(body, state)
          : {
            ok: true,
            draft: {
              ...state.drafts[0],
              ai_draft_reply: 'Regenerated reply text.',
              content_safety_warnings: [],
            },
          };
        const status = response.httpStatus || (response.ok ? 200 : 403);
        return json(response, status);
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  };

  const previous = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]),
  );
  Object.entries(values).forEach(([key, value]) => {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  });

  const Component = load('components/features/compete/ReviewAutomation.tsx').default;
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
  const render = async () => act(async () => root.render(React.createElement(Component)));

  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => {
      if (d) Object.defineProperty(global, k, d);
      else delete global[k];
    });
  });

  await render();
  await act(async () => {
    for (let i = 0; i < 40 && dom.window.document.body.textContent.includes('Loading...'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const textarea = () => dom.window.document.querySelector('textarea');
  const setReplyText = async (value) => act(async () => {
    const el = textarea();
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const clickRegenerate = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Regenerate');
    assert.ok(btn, 'Regenerate');
    btn.click();
  });

  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    textarea,
    setReplyText,
    clickRegenerate,
    state,
    render,
  };
}

test('ReviewAutomation renders content safety warning banner from draft warnings', async (t) => {
  const h = await reviewHarness(t, {
    warnings: ['Uncited metric or percentage detected — verify before external publish'],
  });
  assert.match(h.text(), /CONTENT SAFETY WARNINGS/i);
  assert.match(h.text(), /Uncited metric or percentage detected/i);
});

test('ReviewAutomation blocked regeneration shows role=alert and preserves edited reply text', async (t) => {
  const h = await reviewHarness(t, {
    warnings: ['Existing caution should remain when regeneration is blocked.'],
    generateHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Generated content did not pass brand and compliance checks. Revise the prompt or request human review.',
      httpStatus: 403,
    }),
  });

  await h.setReplyText('My edited reply that must stay visible.');
  await h.clickRegenerate();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const alert = h.document.querySelector('[role="alert"]');
  assert.ok(alert, 'expected role=alert for blocked regeneration');
  assert.match(alert.textContent, /did not pass brand and compliance checks/i);
  assert.equal(h.textarea().value, 'My edited reply that must stay visible.');
  assert.match(h.text(), /Existing caution should remain when regeneration is blocked/);
});

test('ReviewAutomation unavailable regeneration shows role=alert and preserves edited reply text', async (t) => {
  const h = await reviewHarness(t, {
    warnings: ['Existing caution should remain after unavailable regeneration.'],
    generateHandler: async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
      httpStatus: 503,
    }),
  });

  await h.setReplyText('Edited reply preserved on scanner failure.');
  await h.clickRegenerate();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const alert = h.document.querySelector('[role="alert"]');
  assert.ok(alert, 'expected role=alert for unavailable regeneration');
  assert.match(alert.textContent, /temporarily unavailable/i);
  assert.equal(h.textarea().value, 'Edited reply preserved on scanner failure.');
  assert.match(h.text(), /Existing caution should remain/);
});

test('ReviewAutomation clears regeneration alert after successful regeneration', async (t) => {
  let calls = 0;
  const h = await reviewHarness(t, {
    generateHandler: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          error: 'content_safety_blocked',
          userMessage: 'Generated content did not pass brand and compliance checks.',
          httpStatus: 403,
        };
      }
      return {
        ok: true,
        draft: {
          id: 1,
          platform: 'Google',
          reviewer_name: 'Alice',
          rating: 5,
          review_text: 'Great service',
          ai_draft_reply: 'Fresh regenerated reply.',
          status: 'pending',
          created_at: '2026-01-01T00:00:00.000Z',
          content_safety_warnings: [],
        },
        content_safety_warnings: [],
      };
    },
  });

  await h.clickRegenerate();
  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.ok(h.document.querySelector('[role="alert"]'));

  await h.clickRegenerate();
  await act(async () => {
    for (let i = 0; i < 20 && h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.equal(h.textarea().value, 'Fresh regenerated reply.');
});

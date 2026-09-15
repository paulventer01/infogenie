// test/pr10h10-composer-draft-save-safety-ui.test.js — rendered UI acceptance for PR10H.10
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

const BASE_DRAFT = {
  campaign_name: 'Onboarding nurture',
  audience_description: 'Recent signups',
  audience_rules: { match: 'all', conditions: [] },
  channel: 'email',
  subject: 'Your onboarding guide',
  body: 'Here is a helpful walkthrough of our product.',
  recommended_send_time: 'Tuesday 10am',
  rationale: 'Target engaged signups',
  source: 'openai',
};

async function composerHarness(t, opts = {}) {
  const state = {
    drafts: opts.drafts || [{
      id: 42,
      prompt: 'Nurture recent signups',
      draft: { ...BASE_DRAFT },
      status: 'draft',
      segment_id: null,
      content_safety_warnings: opts.warnings || ['Existing warning should remain when save is blocked.'],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }],
    saveHandler: opts.saveHandler || null,
  };

  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/reach/campaign-composer',
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
      if (url.endsWith('/api/campaign-composer/drafts') && method === 'GET') {
        return json({ ok: true, drafts: state.drafts });
      }
      if (url.endsWith('/api/campaign-composer/drafts/42') && method === 'PUT') {
        const payload = JSON.parse(options.body || '{}');
        const response = state.saveHandler
          ? await state.saveHandler(payload, state)
          : {
            ok: true,
            draft: {
              ...state.drafts[0],
              draft: payload.draft,
              content_safety_warnings: [],
            },
          };
        const status = response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
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

  const Component = load('components/features/reach/CampaignComposer.tsx').default;
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));

  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => {
      if (d) Object.defineProperty(global, k, d);
      else delete global[k];
    });
  });

  await act(async () => root.render(React.createElement(Component)));

  await act(async () => {
    for (let i = 0; i < 40 && dom.window.document.body.textContent.includes('No drafts yet'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const selectDraft = async () => act(async () => {
    const row = [...dom.window.document.querySelectorAll('div')]
      .find((el) => el.textContent?.includes('Onboarding nurture') && el.style?.cursor === 'pointer');
    assert.ok(row, 'history draft row');
    row.click();
  });

  await selectDraft();

  await act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.querySelector('textarea[rows="6"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const bodyInput = () => dom.window.document.querySelector('textarea[rows="6"]');
  const setBodyText = async (value) => act(async () => {
    const el = bodyInput();
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const clickSave = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Save Changes'));
    assert.ok(btn, 'Save Changes');
    btn.click();
  });

  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    bodyInput,
    setBodyText,
    clickSave,
    state,
  };
}

test('CampaignComposer renders content safety warning banner from draft warnings', async (t) => {
  const h = await composerHarness(t, {
    warnings: ['Uncited metric or percentage detected — verify before external publish'],
  });
  assert.match(h.text(), /CONTENT SAFETY WARNINGS/i);
  assert.match(h.text(), /Uncited metric or percentage detected/i);
});

test('CampaignComposer blocked save shows role=alert and preserves edited body text', async (t) => {
  const h = await composerHarness(t, {
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Generated content did not pass brand and compliance checks. Revise the copy or request human review.',
      httpStatus: 403,
    }),
  });

  await h.setBodyText('My edited body that must stay visible.');
  await h.clickSave();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const alert = h.document.querySelector('[role="alert"]');
  assert.ok(alert, 'expected role=alert for blocked save');
  assert.match(alert.textContent, /did not pass brand and compliance checks/i);
  assert.equal(h.bodyInput().value, 'My edited body that must stay visible.');
  assert.match(h.text(), /Existing warning should remain when save is blocked/);
});

test('CampaignComposer unavailable save shows role=alert and preserves edited body text', async (t) => {
  const h = await composerHarness(t, {
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
      httpStatus: 503,
    }),
  });

  await h.setBodyText('Edited body preserved on scanner failure.');
  await h.clickSave();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const alert = h.document.querySelector('[role="alert"]');
  assert.ok(alert, 'expected role=alert for unavailable save');
  assert.match(alert.textContent, /temporarily unavailable/i);
  assert.equal(h.bodyInput().value, 'Edited body preserved on scanner failure.');
  assert.match(h.text(), /Existing warning should remain/);
});

test('CampaignComposer successful warning-only save displays persisted warnings', async (t) => {
  const h = await composerHarness(t, {
    saveHandler: async (payload, state) => ({
      ok: true,
      draft: {
        ...state.drafts[0],
        draft: payload.draft,
        content_safety_warnings: ['Warning-only save retained this caution.'],
      },
      content_safety_warnings: ['Warning-only save retained this caution.'],
    }),
  });

  await h.setBodyText('Saved copy with warning-only flag.');
  await h.clickSave();

  await act(async () => {
    for (let i = 0; i < 20 && !h.text().includes('Warning-only save retained this caution.'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.match(h.text(), /Warning-only save retained this caution/);
  assert.equal(h.bodyInput().value, 'Saved copy with warning-only flag.');
});

test('CampaignComposer successful save clears prior save alert', async (t) => {
  const h = await composerHarness(t, {
    saveHandler: async (payload, state) => {
      if (payload.draft.body.includes('blocked attempt')) {
        return {
          ok: false,
          error: 'content_safety_blocked',
          userMessage: 'Please revise or retry later.',
          httpStatus: 403,
        };
      }
      return {
        ok: true,
        draft: {
          ...state.drafts[0],
          draft: payload.draft,
          content_safety_warnings: [],
        },
      };
    },
  });

  await h.setBodyText('blocked attempt');
  await h.clickSave();
  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.ok(h.document.querySelector('[role="alert"]'));

  await h.setBodyText('Clean save copy');
  await h.clickSave();
  await act(async () => {
    for (let i = 0; i < 20 && h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.equal(h.bodyInput().value, 'Clean save copy');
});

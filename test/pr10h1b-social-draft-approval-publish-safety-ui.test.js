// test/pr10h1b-social-draft-approval-publish-safety-ui.test.js — rendered UI for PR-1b
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('react');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { waitFor } = require('./helpers/social-publisher-ui-harness');

function load(file) {
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  const dir = path.dirname(abs);
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id.startsWith('@/')) {
      const rel = id.slice(2);
      return load(rel + (rel.startsWith('components/') ? '.tsx' : '.ts'));
    }
    if (id.startsWith('.')) {
      const resolved = path.resolve(dir, id);
      const hit = [resolved, `${resolved}.tsx`, `${resolved}.ts`].find((c) => fs.existsSync(c));
      if (hit) return load(path.relative(path.join(__dirname, '..'), hit));
    }
    return require(id);
  }, mod);
  return mod.exports;
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

async function approvalsHarness(t, opts = {}) {
  const state = { approveHandler: opts.approveHandler || null, drafts: opts.drafts || [] };
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/reach/social-publisher', pretendToBeVisual: true });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.includes('/api/social-drafts/approvals/queue')) {
        return json({ ok: true, drafts: state.drafts });
      }
      if (url.includes('/api/social-drafts/settings')) {
        return json({ ok: true, settings: { require_approval: true } });
      }
      const approveMatch = url.match(/\/api\/social-drafts\/(\d+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const response = state.approveHandler
          ? await state.approveHandler(Number(approveMatch[1]))
          : { ok: true, draft: { id: Number(approveMatch[1]), status: 'published' }, content_safety_warnings: [] };
        const status = response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
        return json(response, status);
      }
      return json({ ok: true });
    },
  };
  const previous = new Map(Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(global, k)]));
  Object.entries(values).forEach(([k, v]) => Object.defineProperty(global, k, { configurable: true, writable: true, value: v }));
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; });
  });
  const Panel = load('components/features/reach/SocialApprovalsPanel.tsx').default;
  await act(async () => root.render(React.createElement(Panel)));
  await waitFor(() => dom.window.document.body.textContent.includes('Approvals'), 40, 'approvals panel');
  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    clickApprove: async (id) => act(async () => {
      const btn = [...dom.window.document.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Approve') && !b.disabled);
      assert.ok(btn, 'approve button');
      btn.click();
    }),
    waitForAlert: () => waitFor(() => !!dom.window.document.querySelector('[role="alert"]'), 20, 'role=alert'),
    state,
  };
}

test('SocialApprovalsPanel shows role=alert on content safety block', async (t) => {
  const h = await approvalsHarness(t, {
    drafts: [{ id: 51, text: 'Pending caption', platforms: ['linkedin'], meta: {}, content_safety_warnings: ['Prior queue warning.'] }],
    approveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Approval blocked by brand safety rules.',
      httpStatus: 403,
    }),
  });
  await waitFor(() => h.text().includes('Prior queue warning'), 20, 'seeded warnings');
  await h.clickApprove(51);
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /blocked by brand safety/);
  assert.match(h.text(), /Prior queue warning/);
});

test('SocialPublisher self-heal shows alert and preserves caption on block', async (t) => {
  const { publisherHarness } = require('./helpers/social-publisher-ui-harness');
  const h = await publisherHarness(t, {
    drafts: {
      60: {
        id: 60,
        profile_id: 'prof1',
        status: 'draft',
        text: 'Caption to heal',
        platforms: ['instagram'],
        meta: {},
        content_safety_warnings: ['Existing warning.'],
      },
    },
    saveHandler: async ({ method }) => {
      if (method === 'POST') {
        return { ok: true, draft: { id: 60, profile_id: 'prof1', status: 'draft', text: 'Caption to heal', platforms: ['instagram'], meta: {}, content_safety_warnings: ['Existing warning.'] } };
      }
      return { ok: true, draft: { id: 60, profile_id: 'prof1', status: 'draft', text: 'Caption to heal', platforms: ['instagram'], meta: {}, content_safety_warnings: ['Existing warning.'] } };
    },
  });
  const origFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (url.includes('/self-heal')) {
      return json({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Self-heal blocked by brand safety rules.',
      }, 403);
    }
    return origFetch(url, options);
  };
  t.after(() => { global.fetch = origFetch; });
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Caption to heal');
  await h.waitForDraftEditor(60);
  await waitFor(() => h.text().includes('Existing warning'), 20, 'existing warnings');
  await act(async () => {
    const btn = [...h.document.querySelectorAll('button')].find((b) => /Self-heal/.test(b.textContent || ''));
    assert.ok(btn);
    btn.click();
  });
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /Self-heal blocked/);
  assert.equal(h.captionInput().value, 'Caption to heal');
  assert.match(h.text(), /Existing warning/);
});

test('SocialPublisher resets self-heal loading after response', async (t) => {
  const { publisherHarness } = require('./helpers/social-publisher-ui-harness');
  let finish;
  const h = await publisherHarness(t, {
    saveHandler: async () => ({ ok: true, draft: { id: 61, profile_id: 'prof1', status: 'draft', text: 'Heal me', platforms: ['instagram'], meta: {}, content_safety_warnings: [] } }),
  });
  const origFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (url.includes('/self-heal')) {
      return new Promise((resolve) => {
        finish = () => resolve(json({ ok: true, draft: { id: 61, text: 'Healed copy', content_safety_warnings: ['Heal warning.'] }, content_safety_warnings: ['Heal warning.'] }));
      });
    }
    return origFetch(url, options);
  };
  t.after(() => { global.fetch = origFetch; });
  await h.setCaption('Heal me');
  await h.selectInstagram();
  await act(async () => {
    const btn = [...h.document.querySelectorAll('button')].find((b) => /Self-heal/.test(b.textContent || ''));
    btn.click();
  });
  await waitFor(() => h.text().includes('Self-healing'), 20, 'self-heal loading');
  await act(async () => finish());
  await waitFor(() => h.text().includes('Heal warning'), 20, 'heal warnings');
  const btn = [...h.document.querySelectorAll('button')].find((b) => /Self-heal/.test(b.textContent || ''));
  assert.ok(btn);
  assert.equal(btn.disabled, false);
});

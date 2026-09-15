'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;
const { BASE_DRAFT } = require('./composer-draft-fixtures');

async function waitFor(pred, tries = 20) {
  await act(async () => {
    for (let i = 0; i < tries && !pred(); i++) await new Promise((r) => setTimeout(r, 25));
  });
}

function load(file) {
  const cache = load.cache || (load.cache = new Map());
  if (cache.has(file)) return cache.get(file);
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  });
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id.startsWith('@/')) return load(id.slice(2) + (id.slice(2).startsWith('components/') ? '.tsx' : '.ts'));
    return require(id);
  }, mod);
  cache.set(file, mod.exports);
  return mod.exports;
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

async function composerHarness(t, opts = {}) {
  const secondDraft = {
    id: 43,
    prompt: 'Win-back campaign',
    draft: { ...BASE_DRAFT, campaign_name: 'Win-back offer', body: 'Come back for a special offer.' },
    status: 'draft',
    segment_id: null,
    content_safety_warnings: ['Second draft baseline warning.'],
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  };
  const state = {
    drafts: opts.drafts || [{
      id: 42,
      prompt: 'Nurture recent signups',
      draft: { ...BASE_DRAFT },
      status: 'draft',
      segment_id: null,
      content_safety_warnings: opts.warnings || ['Existing warning should remain when approve is blocked.'],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }, ...(opts.includeSecondDraft === false ? [] : [secondDraft])],
    saveHandler: opts.saveHandler || null,
    approveHandler: opts.approveHandler || null,
    generateHandler: opts.generateHandler || null,
    nextDraftId: 100,
    nextSegmentId: 900,
    putCalls: [],
    approveCalls: [],
    historyRefreshHold: null,
    historyRefreshRelease: null,
  };
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/reach/campaign-composer', pretendToBeVisual: true });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    alert: dom.window.alert,
    confirm: dom.window.confirm,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.endsWith('/api/campaign-composer/drafts') && method === 'GET') {
        if (state.historyRefreshHold) await state.historyRefreshHold;
        return json({ ok: true, drafts: state.drafts });
      }
      if (url.endsWith('/api/campaign-composer/generate') && method === 'POST') {
        const payload = JSON.parse(options.body || '{}');
        const response = state.generateHandler ? await state.generateHandler(payload, state) : {
          ok: true,
          draft: {
            id: ++state.nextDraftId,
            prompt: payload.prompt,
            draft: { ...BASE_DRAFT, campaign_name: 'Generated campaign', body: `Generated for ${payload.prompt}` },
            status: 'draft',
            segment_id: null,
            content_safety_warnings: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        };
        return json(response, response.httpStatus || (response.ok ? 200 : 403));
      }
      const approveMatch = url.match(/\/api\/campaign-composer\/drafts\/(\d+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const draftId = Number(approveMatch[1]);
        state.approveCalls.push({ draftId });
        const response = state.approveHandler ? await state.approveHandler({ draftId }, state) : {
          ok: true,
          draft: { ...state.drafts.find((d) => d.id === draftId), status: 'approved', segment_id: ++state.nextSegmentId, content_safety_warnings: [] },
          segment_id: state.nextSegmentId,
        };
        if (response.ok && response.draft) {
          state.drafts = state.drafts.map((row) => (row.id === draftId ? { ...response.draft } : row));
        }
        return json(response, response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403));
      }
      const putMatch = url.match(/\/api\/campaign-composer\/drafts\/(\d+)$/);
      if (putMatch && method === 'PUT') {
        const draftId = Number(putMatch[1]);
        const payload = JSON.parse(options.body || '{}');
        state.putCalls.push({ draftId, payload });
        const response = state.saveHandler ? await state.saveHandler({ draftId, ...payload }, state) : {
          ok: true,
          draft: { ...state.drafts.find((d) => d.id === draftId), draft: payload.draft, content_safety_warnings: [] },
        };
        return json(response, response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403));
      }
      throw new Error(`Unexpected ${method} ${url}`);
    },
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.entries(values).forEach(([key, value]) => {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  });
  const Component = load('components/features/reach/CampaignComposer.tsx').default;
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; });
  });
  await act(async () => root.render(React.createElement(Component)));
  await waitFor(() => !dom.window.document.body.textContent.includes('No drafts yet'), 40);
  const selectDraft = async (label) => act(async () => {
    const row = [...dom.window.document.querySelectorAll('div')]
      .find((el) => el.textContent?.includes(label) && el.style?.cursor === 'pointer');
    assert.ok(row, `history draft row: ${label}`);
    row.click();
  });
  await selectDraft('Onboarding nurture');
  await waitFor(() => !!dom.window.document.querySelector('textarea[rows="6"]'), 40);
  const bodyInput = () => dom.window.document.querySelector('textarea[rows="6"]');
  const promptInput = () => dom.window.document.querySelector('textarea[rows="3"]');
  const setFieldText = async (el, value) => act(async () => {
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const setBodyText = async (value) => setFieldText(bodyInput(), value);
  const setPromptText = async (value) => setFieldText(promptInput(), value);
  const clickSave = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent?.includes('Save Changes'));
    assert.ok(btn, 'Save Changes');
    btn.click();
  });
  const clickApprove = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => /Approve & Create Segment|Approving\.\.\./.test(b.textContent || ''));
    assert.ok(btn, 'Approve & Create Segment');
    btn.click();
  });
  const clickGenerate = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent?.includes('Generate Campaign Draft'));
    assert.ok(btn, 'Generate Campaign Draft');
    btn.click();
  });
  const saveButton = () => [...dom.window.document.querySelectorAll('button')].find((b) => /Save Changes|Saving\.\.\./.test(b.textContent || ''));
  const approveButton = () => [...dom.window.document.querySelectorAll('button')].find((b) => /Approve & Create Segment|Approving\.\.\./.test(b.textContent || ''));
  const assertDraftActionsUsable = () => {
    const save = saveButton();
    const approve = approveButton();
    assert.ok(save, 'Save Changes button');
    assert.ok(approve, 'Approve button');
    assert.equal(save.disabled, false);
    assert.equal(approve.disabled, false);
    assert.doesNotMatch(save.textContent || '', /Saving/i);
    assert.doesNotMatch(approve.textContent || '', /Approving/i);
  };
  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    bodyInput,
    promptInput,
    setBodyText,
    setPromptText,
    clickSave,
    clickApprove,
    clickGenerate,
    selectDraft,
    saveButton,
    approveButton,
    assertDraftActionsUsable,
    alerts: () => [...dom.window.document.querySelectorAll('[role="alert"]')],
    state,
    waitFor,
    releaseHistoryRefresh: () => {
      state.historyRefreshRelease?.();
      state.historyRefreshHold = null;
      state.historyRefreshRelease = null;
    },
    blockHistoryRefresh: () => {
      state.historyRefreshHold = new Promise((resolve) => { state.historyRefreshRelease = resolve; });
    },
  };
}

module.exports = { BASE_DRAFT, waitFor, composerHarness };

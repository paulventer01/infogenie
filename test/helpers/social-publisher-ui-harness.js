'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

async function waitFor(pred, tries = 20, label = 'condition') {
  let ok = false;
  await act(async () => {
    for (let i = 0; i < tries; i++) {
      if (pred()) {
        ok = true;
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  if (!ok) throw new Error(`Timed out waiting for ${label}`);
}

function load(file) {
  const cache = load.cache || (load.cache = new Map());
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', '..', file);
  if (cache.has(abs)) return cache.get(abs);
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
      if (hit) return load(path.relative(path.join(__dirname, '..', '..'), hit));
    }
    return require(id);
  }, mod);
  cache.set(abs, mod.exports);
  return mod.exports;
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body };
}

function safetyStatus(response) {
  return response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
}

function uiDraft(id, text, opts = {}) {
  return {
    id,
    profile_id: 'prof1',
    status: 'draft',
    text,
    platforms: opts.platforms || ['instagram'],
    meta: opts.meta || {},
    content_safety_warnings: opts.warnings || [],
  };
}

function saveOk(draft) {
  return async () => ({ ok: true, draft });
}

function safetyBlocked(userMessage, error = 'content_safety_blocked') {
  return { ok: false, error, userMessage, httpStatus: error === 'content_safety_unavailable' ? 503 : 403 };
}

async function testInflightEditPreserved(t, { id, snippet, editedCaption, loadingText, actionKey, click, resolve }) {
  const draft = uiDraft(id, snippet);
  const pending = deferred(resolve);
  const h = await publisherHarness(t, {
    drafts: { [id]: draft },
    saveHandler: saveOk(draft),
    [`${actionKey}Handler`]: pending.handler,
  });
  await openEditorDraft(h, id, snippet);
  await click(h);
  await waitFor(() => h.text().includes(loadingText), 20, loadingText);
  await h.setCaption(editedCaption);
  await act(async () => pending.finish());
  await waitFor(() => h.captionInput().value === editedCaption, 20, 'preserved caption');
}

async function testUnsavedCreateThenAction(t, { actionKey, switchAway = false }) {
  const created = uiDraft(201, 'Unsaved compose caption');
  const draftB = uiDraft(80, 'Draft B caption', { platforms: ['linkedin'] });
  const create = deferred(() => ({ ok: true, draft: created }));
  const h = await publisherHarness(t, {
    drafts: switchAway ? { 80: draftB } : {},
    saveHandler: async ({ method }) => (method === 'POST' ? create.handler() : { ok: true, draft: switchAway ? draftB : created }),
    [`${actionKey}Handler`]: async ({ draftId }) => ({
      ok: true, draft: { ...created, id: draftId, status: actionKey === 'submit' ? 'pending_approval' : 'draft' },
    }),
  });
  await h.setCaption(created.text);
  await h.selectInstagram();
  await (actionKey === 'submit' ? h.clickSubmitApproval() : h.clickSelfHeal());
  await waitFor(() => h.state.postCalls.length === 1, 20, 'create started');
  if (switchAway) await openEditorDraft(h, 80, draftB.text);
  await act(async () => create.finish());
  const calls = h.state[`${actionKey}Calls`];
  if (switchAway) {
    await waitFor(() => h.captionInput().value === draftB.text, 20, 'draft B editor');
    assert.equal(calls.length, 0);
    assert.doesNotMatch(h.text(), /Submitting|Self-healing/);
    return;
  }
  await waitFor(() => calls[0]?.draftId === 201, 20, `${actionKey} once`);
  await waitFor(() => !/Submitting|Self-healing/.test(h.text()), 20, 'loading cleared');
  assert.equal(h.state.postCalls.length, 1);
  assert.equal(calls.length, 1);
}

async function testLateResponseIgnored(t, { idA, idB, snippetA, snippetB, actionKey, callsKey, finish, assertQuiet }) {
  const draftA = uiDraft(idA, snippetA);
  const draftB = uiDraft(idB, snippetB, { platforms: ['linkedin'] });
  const pending = deferred(finish);
  const h = await publisherHarness(t, {
    drafts: { [idA]: draftA, [idB]: draftB },
    saveHandler: async ({ method, draftId }) => ({ ok: true, draft: method === 'PATCH' ? { ...draftA, id: draftId } : draftA }),
    [`${actionKey}Handler`]: async ({ draftId }) => (draftId === idA
      ? pending.handler()
      : { ok: true, draft: { id: draftId, status: 'pending_approval', text: draftB.text, content_safety_warnings: [] } }),
  });
  await openEditorDraft(h, idA, snippetA);
  await (actionKey === 'submit' ? h.clickSubmitApproval() : h.clickSelfHeal());
  await waitFor(() => h.state[callsKey].length === 1, 20, `${actionKey} initiation`);
  await openEditorDraft(h, idB, snippetB);
  await act(async () => pending.finish());
  await waitFor(() => h.captionInput().value === snippetB, 20, 'draft B editor');
  assertQuiet(h);
}

function deferred(build) {
  let finish;
  const handler = async () => new Promise((resolve) => {
    finish = () => resolve(build());
  });
  return { handler, finish: () => { assert.ok(finish, 'deferred handler not started'); finish(); } };
}

async function openEditorDraft(h, id, snippet) {
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar(snippet);
  await h.waitForDraftEditor(id);
}

function installGlobals(dom, values) {
  const previous = new Map(Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(global, k)]));
  Object.entries(values).forEach(([k, v]) => Object.defineProperty(global, k, { configurable: true, writable: true, value: v }));
  return () => {
    dom.window.close();
    previous.forEach((d, k) => { if (d) Object.defineProperty(global, k, d); else delete global[k]; });
  };
}

async function publisherHarness(t, opts = {}) {
  const state = {
    drafts: opts.drafts || {},
    saveHandler: opts.saveHandler || null,
    selfHealHandler: opts.selfHealHandler || null,
    submitHandler: opts.submitHandler || null,
    postCalls: [],
    patchCalls: [],
    selfHealCalls: [],
    submitCalls: [],
    publishCalls: [],
    postsLoads: [],
    listLoads: [],
    publishHandler: opts.publishHandler || null,
    nextDraftId: 200,
  };
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/reach/social-publisher',
    pretendToBeVisual: true,
  });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  dom.window.localStorage.setItem('ig-social-drafts-imported:prof1', '1');
  const restoreGlobals = installGlobals(dom, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    alert: dom.window.alert,
    confirm: dom.window.confirm,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.includes('/api/social-publisher/')) {
        if (method === 'POST' && /\/api\/social-publisher\/post$/.test(url)) {
          const payload = JSON.parse(options.body || '{}');
          state.publishCalls.push(payload);
          const response = state.publishHandler
            ? await state.publishHandler(payload, state)
            : { ok: true, scheduled: false, content_safety_warnings: [] };
          return json(response, safetyStatus(response));
        }
        if (url.includes('/profiles')) return json({ ok: true, profiles: [{ id: 'prof1', name: 'Main profile' }] });
        if (url.includes('/accounts')) return json({ ok: true, accounts: [] });
        if (url.includes('/posts')) {
          const pid = String(url.split('profileId=')[1] || '').split('&')[0];
          state.postsLoads.push(decodeURIComponent(pid));
          return json({ ok: true, posts: [] });
        }
        if (url.includes('/best-times')) return json({ ok: true, slots: [] });
      }
      if (url.endsWith('/api/social-drafts') && method === 'POST') {
        const payload = JSON.parse(options.body || '{}');
        state.postCalls.push(payload);
        const response = state.saveHandler
          ? await state.saveHandler({ method: 'POST', payload }, state)
          : {
            ok: true,
            draft: {
              id: ++state.nextDraftId,
              profile_id: payload.profileId,
              status: payload.status || 'draft',
              text: payload.text,
              media_urls: payload.media_urls || [],
              platforms: payload.platforms || [],
              scheduled_for: payload.scheduled_for || null,
              meta: payload.meta || {},
              content_safety_warnings: payload.content_safety_warnings || [],
            },
          };
        if (response.ok && response.draft?.id) state.drafts[response.draft.id] = response.draft;
        return json(response, safetyStatus(response));
      }
      const patchMatch = url.match(/\/api\/social-drafts\/(\d+)$/);
      if (patchMatch && method === 'PATCH') {
        const draftId = Number(patchMatch[1]);
        const payload = JSON.parse(options.body || '{}');
        state.patchCalls.push({ draftId, payload });
        const response = state.saveHandler
          ? await state.saveHandler({ method: 'PATCH', draftId, payload }, state)
          : { ok: true, draft: { id: draftId, profile_id: 'prof1', status: 'draft', text: payload.text, platforms: ['instagram'], meta: {}, content_safety_warnings: [] } };
        return json(response, safetyStatus(response));
      }
      if (url.includes('/api/social-drafts/list')) {
        state.listLoads.push(url);
        return json({ ok: true, drafts: Object.values(state.drafts) });
      }
      const actionMatch = url.match(/\/api\/social-drafts\/(\d+)\/(self-heal|submit-approval)$/);
      if (actionMatch && method === 'POST') {
        const draftId = Number(actionMatch[1]);
        const kind = actionMatch[2] === 'self-heal' ? 'selfHeal' : 'submit';
        state[`${kind}Calls`].push({ draftId });
        const handler = state[`${kind}Handler`];
        const fallback = kind === 'selfHeal'
          ? { ok: true, draft: { id: draftId, text: 'Healed caption', content_safety_warnings: [] }, content_safety_warnings: [] }
          : { ok: true, draft: { id: draftId, status: 'pending_approval', text: state.drafts[draftId]?.text || 'Submitted', content_safety_warnings: [] }, content_safety_warnings: [] };
        const response = handler ? await handler({ draftId }, state) : fallback;
        return json(response, safetyStatus(response));
      }
      return json({ ok: true });
    },
  });
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    restoreGlobals();
  });
  await act(async () => root.render(React.createElement(load('components/features/reach/SocialPublisher.tsx').default, { embedded: true })));
  await waitFor(() => dom.window.document.body.textContent.includes('Compose'), 40);
  const clickTab = async (label) => act(async () => {
    const tab = [...dom.window.document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
    assert.ok(tab, label);
    tab.click();
  });
  await clickTab('Compose');
  await waitFor(() => !!dom.window.document.querySelector('textarea'), 40);
  await waitFor(() => {
    const sel = dom.window.document.querySelector('select');
    return sel && String(sel.value || '').length > 0;
  }, 40, 'profile selected');
  const captionInput = () => dom.window.document.querySelector('textarea');
  const setCaption = async (value) => act(async () => {
    const el = captionInput();
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const selectInstagram = async () => act(async () => {
    const buttons = [...dom.window.document.querySelectorAll('button')].filter((b) => b.textContent?.includes('Instagram'));
    const btn = buttons[buttons.length - 1];
    assert.ok(btn, 'Instagram');
    const bg = String(btn.style.background || '');
    if (!bg.includes('#FF5722') && !bg.includes('255, 87, 34')) btn.click();
  });
  const clickSaveDraft = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => /Save draft|Saving…/.test(b.textContent || ''));
    assert.ok(btn, 'Save draft');
    btn.click();
  });
  const clickBy = (re, label) => async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => re.test(b.textContent || ''));
    assert.ok(btn, label);
    btn.click();
  });
  const clickSelfHeal = clickBy(/Self-heal|Self-healing/, 'Self-heal');
  const clickSubmitApproval = clickBy(/Submit for approval|Submitting…/, 'Submit for approval');
  const clickPublishNow = clickBy(/Publish now|Publishing…/, 'Publish now');
  const editDraftFromCalendar = async (snippet) => act(async () => {
    const editBtn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Edit' && b.closest('div')?.textContent?.includes(snippet));
    if (editBtn) { editBtn.click(); return; }
    const chip = [...dom.window.document.querySelectorAll('div')]
      .find((el) => el.title?.includes(snippet) || (el.textContent?.includes(snippet) && el.style?.cursor === 'grab'));
    assert.ok(chip, snippet);
    chip.click();
  });
  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    captionInput,
    setCaption,
    selectInstagram,
    clickSaveDraft,
    clickSelfHeal,
    clickSubmitApproval,
    clickPublishNow,
    openCalendar: () => clickTab('Calendar'),
    editDraftFromCalendar,
    waitForAlert: () => waitFor(() => !!dom.window.document.querySelector('[role="alert"]'), 20, 'role=alert'),
    waitForCalendarDrafts: () => waitFor(() => dom.window.document.body.textContent.includes('Content calendar'), 40, 'calendar view'),
    waitForDraftEditor: (id) => waitFor(() => dom.window.document.body.textContent.includes(`draft #${id}`), 20, `draft #${id} editor`),
    state,
    waitFor,
  };
}

async function approvalsHarness(t, opts = {}) {
  const state = { approveHandler: opts.approveHandler || null, drafts: opts.drafts || [] };
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/reach/social-publisher', pretendToBeVisual: true });
  const restoreGlobals = installGlobals(dom, {
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
        return json(response, safetyStatus(response));
      }
      return json({ ok: true });
    },
  });
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    restoreGlobals();
  });
  const Panel = load('components/features/reach/SocialApprovalsPanel.tsx').default;
  await act(async () => root.render(React.createElement(Panel)));
  await waitFor(() => dom.window.document.body.textContent.includes('Approvals'), 40, 'approvals panel');
  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    clickApprove: async () => act(async () => {
      const btn = [...dom.window.document.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Approve') && !b.disabled);
      assert.ok(btn, 'approve button');
      btn.click();
    }),
    waitForAlert: () => waitFor(() => !!dom.window.document.querySelector('[role="alert"]'), 20, 'role=alert'),
    state,
  };
}

module.exports = {
  publisherHarness,
  approvalsHarness,
  waitFor,
  uiDraft,
  saveOk,
  safetyBlocked,
  deferred,
  openEditorDraft,
  testInflightEditPreserved,
  testLateResponseIgnored,
  testUnsavedCreateThenAction,
};

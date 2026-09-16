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
    nextDraftId: 200,
  };
  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/reach/social-publisher',
    pretendToBeVisual: true,
  });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  dom.window.localStorage.setItem('ig-social-drafts-imported:prof1', '1');
  const values = {
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
        if (url.includes('/profiles')) return json({ ok: true, profiles: [{ id: 'prof1', name: 'Main profile' }] });
        if (url.includes('/accounts')) return json({ ok: true, accounts: [] });
        if (url.includes('/posts')) return json({ ok: true, posts: [] });
        if (url.includes('/best-times')) return json({ ok: true, slots: [] });
      }
      if (url.endsWith('/api/social-drafts') && method === 'POST') {
        const payload = JSON.parse(options.body || '{}');
        state.postCalls.push(payload);
        const response = state.saveHandler
          ? await state.saveHandler({ method: 'POST', payload }, state)
          : { ok: true, draft: { id: ++state.nextDraftId, profile_id: payload.profileId, status: 'draft', text: payload.text, media_urls: [], platforms: payload.platforms || [], meta: {}, content_safety_warnings: [] } };
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
      if (url.includes('/api/social-drafts/list')) return json({ ok: true, drafts: Object.values(state.drafts) });
      const selfHealMatch = url.match(/\/api\/social-drafts\/(\d+)\/self-heal$/);
      if (selfHealMatch && method === 'POST') {
        const draftId = Number(selfHealMatch[1]);
        state.selfHealCalls.push({ draftId });
        const response = state.selfHealHandler
          ? await state.selfHealHandler({ draftId }, state)
          : { ok: true, draft: { id: draftId, text: 'Healed caption', content_safety_warnings: [] }, content_safety_warnings: [] };
        return json(response, safetyStatus(response));
      }
      const submitMatch = url.match(/\/api\/social-drafts\/(\d+)\/submit-approval$/);
      if (submitMatch && method === 'POST') {
        const draftId = Number(submitMatch[1]);
        state.submitCalls.push({ draftId });
        const response = state.submitHandler
          ? await state.submitHandler({ draftId }, state)
          : { ok: true, draft: { id: draftId, status: 'pending_approval', text: state.drafts[draftId]?.text || 'Submitted', content_safety_warnings: [] }, content_safety_warnings: [] };
        return json(response, safetyStatus(response));
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
  const clickSelfHeal = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => /Self-heal|Self-healing/.test(b.textContent || ''));
    assert.ok(btn, 'Self-heal');
    btn.click();
  });
  const clickSubmitApproval = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')].find((b) => /Submit for approval|Submitting…/.test(b.textContent || ''));
    assert.ok(btn, 'Submit for approval');
    btn.click();
  });
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
    openCalendar: () => clickTab('Calendar'),
    editDraftFromCalendar,
    waitForAlert: () => waitFor(() => !!dom.window.document.querySelector('[role="alert"]'), 20, 'role=alert'),
    waitForCalendarDrafts: () => waitFor(() => dom.window.document.body.textContent.includes('Content calendar'), 40, 'calendar view'),
    waitForDraftEditor: (id) => waitFor(() => dom.window.document.body.textContent.includes(`draft #${id}`), 20, `draft #${id} editor`),
    state,
    waitFor,
  };
}

module.exports = { publisherHarness, waitFor };

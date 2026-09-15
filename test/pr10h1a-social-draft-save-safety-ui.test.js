// test/pr10h1a-social-draft-save-safety-ui.test.js — rendered UI acceptance for PR-1a
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

function load(file, fromDir = '') {
  const cache = load.cache || (load.cache = new Map());
  const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
  const cacheKey = abs;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const { outputText } = ts.transpileModule(
    fs.readFileSync(abs, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const mod = { exports: {} };
  const dir = path.dirname(abs);
  new Function('exports', 'require', 'module', outputText)(mod.exports, (id) => {
    if (id.startsWith('@/')) {
      const rel = id.slice(2);
      const ext = rel.startsWith('components/') ? '.tsx' : '.ts';
      return load(rel + ext);
    }
    if (id.startsWith('.')) {
      const resolved = path.resolve(dir, id);
      const candidates = [
        resolved,
        resolved + '.tsx',
        resolved + '.ts',
        path.join(resolved, 'index.tsx'),
        path.join(resolved, 'index.ts'),
      ];
      const hit = candidates.find((c) => fs.existsSync(c));
      if (hit) {
        const rel = path.relative(path.join(__dirname, '..'), hit);
        return load(rel);
      }
    }
    return require(id);
  }, mod);
  cache.set(cacheKey, mod.exports);
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

async function publisherHarness(t, opts = {}) {
  const state = {
    editingDraftId: opts.editingDraftId || null,
    drafts: opts.drafts || {},
    warnings: opts.warnings || ['Existing warning should remain when save is blocked.'],
    saveHandler: opts.saveHandler || null,
    postCalls: [],
    patchCalls: [],
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
      if (url.includes('/api/social-publisher/profiles')) {
        return json({ ok: true, profiles: [{ id: 'prof1', name: 'Main profile' }] });
      }
      if (url.includes('/api/social-publisher/accounts')) {
        return json({ ok: true, accounts: [] });
      }
      if (url.includes('/api/social-publisher/posts')) {
        return json({ ok: true, posts: [] });
      }
      if (url.includes('/api/social-publisher/best-times')) {
        return json({ ok: true, slots: [] });
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
              status: 'draft',
              text: payload.text,
              media_urls: payload.media_urls || [],
              platforms: payload.platforms || [],
              scheduled_for: payload.scheduled_for || null,
              meta: payload.meta || {},
              content_safety_warnings: [],
            },
          };
        const status = response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
        return json(response, status);
      }
      const patchMatch = url.match(/\/api\/social-drafts\/(\d+)$/);
      if (patchMatch && method === 'PATCH') {
        const draftId = Number(patchMatch[1]);
        const payload = JSON.parse(options.body || '{}');
        state.patchCalls.push({ draftId, payload });
        const response = state.saveHandler
          ? await state.saveHandler({ method: 'PATCH', draftId, payload }, state)
          : {
            ok: true,
            draft: {
              id: draftId,
              profile_id: payload.profileId || 'prof1',
              status: 'draft',
              text: payload.text,
              media_urls: payload.media_urls || [],
              platforms: payload.platforms || ['instagram'],
              scheduled_for: payload.scheduled_for || null,
              meta: payload.meta || {},
              content_safety_warnings: [],
            },
          };
        const status = response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
        return json(response, status);
      }
      if (url.includes('/api/social-drafts/list')) {
        return json({ ok: true, drafts: Object.values(state.drafts) });
      }
      return json({ ok: true });
    },
  };

  const previous = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]),
  );
  Object.entries(values).forEach(([key, value]) => {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  });

  const Component = load('components/features/reach/SocialPublisher.tsx').default;
  const root = require('react-dom/client').createRoot(dom.window.document.getElementById('root'));

  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    previous.forEach((d, k) => {
      if (d) Object.defineProperty(global, k, d);
      else delete global[k];
    });
  });

  await act(async () => root.render(React.createElement(Component, { embedded: true })));

  await act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.body.textContent.includes('Compose'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const clickTab = async (label) => act(async () => {
    const tab = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes(label));
    assert.ok(tab, `${label} tab`);
    tab.click();
  });

  const openCompose = () => clickTab('Compose');
  const openCalendar = () => clickTab('Calendar');

  await openCompose();

  await act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.querySelector('textarea'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const captionInput = () => dom.window.document.querySelector('textarea');
  const setCaption = async (value) => act(async () => {
    const el = captionInput();
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const selectInstagram = async () => act(async () => {
    const buttons = [...dom.window.document.querySelectorAll('button')]
      .filter((b) => b.textContent?.includes('Instagram'));
    const btn = buttons[buttons.length - 1];
    assert.ok(btn, 'Instagram publish platform');
    const bg = String(btn.style.background || '');
    const selected = bg.includes('#FF5722') || bg.includes('255, 87, 34');
    if (!selected) btn.click();
  });
  const waitForCalendarDrafts = async () => act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.body.textContent.includes('Unscheduled drafts'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  const waitForDraftEditor = async (id) => act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.body.textContent.includes(`draft #${id}`); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.match(dom.window.document.body.textContent, new RegExp(`draft #${id}`));
  });

  const clickSaveDraft = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => /Save draft|Saving…/.test(b.textContent || ''));
    assert.ok(btn, 'Save draft');
    btn.click();
  });
  const editDraftFromCalendar = async (snippet) => act(async () => {
    const editBtn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent === 'Edit' && b.closest('div')?.textContent?.includes(snippet));
    if (editBtn) {
      editBtn.click();
      return;
    }
    const chip = [...dom.window.document.querySelectorAll('div')]
      .find((el) => el.title?.includes(snippet)
        || (el.textContent?.includes(snippet) && el.style?.cursor === 'grab'));
    assert.ok(chip, `calendar draft chip: ${snippet}`);
    chip.click();
  });

  return {
    document: dom.window.document,
    text: () => dom.window.document.body.textContent,
    captionInput,
    setCaption,
    selectInstagram,
    clickSaveDraft,
    openCompose,
    openCalendar,
    editDraftFromCalendar,
    waitForCalendarDrafts,
    waitForDraftEditor,
    state,
  };
}

test('SocialPublisher shows actionable content_safety_blocked alert and preserves caption', async (t) => {
  const h = await publisherHarness(t, {
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'This caption was blocked by brand safety rules.',
      httpStatus: 403,
    }),
  });

  await h.setCaption('guaranteed 100% returns');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const alert = h.document.querySelector('[role="alert"]');
  assert.ok(alert, 'expected role=alert banner');
  assert.match(alert.textContent, /blocked by brand safety/);
  assert.equal(h.captionInput().value, 'guaranteed 100% returns');
});

test('SocialPublisher keeps existing warnings visible when save is blocked', async (t) => {
  const seededDraft = {
    id: 42,
    profile_id: 'prof1',
    status: 'draft',
    text: 'Existing caption with warnings.',
    media_urls: [],
    platforms: ['instagram'],
    scheduled_for: null,
    meta: {},
    content_safety_warnings: ['Prior warning stays visible.'],
  };
  const h = await publisherHarness(t, {
    drafts: { 42: seededDraft },
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'This caption was blocked by brand safety rules.',
      httpStatus: 403,
    }),
  });

  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Existing caption');
  await h.waitForDraftEditor(42);
  await act(async () => {
    for (let i = 0; i < 20 && !h.text().includes('Prior warning stays visible'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  await h.setCaption('guaranteed 100% returns');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.match(h.text(), /Prior warning stays visible/);
  assert.equal(h.captionInput().value, 'guaranteed 100% returns');
});

test('SocialPublisher shows content_safety_unavailable without clearing the editor', async (t) => {
  const h = await publisherHarness(t, {
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
      httpStatus: 503,
    }),
  });

  await h.setCaption('Draft text stays put.');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.match(h.document.querySelector('[role="alert"]').textContent, /temporarily unavailable/);
  assert.equal(h.captionInput().value, 'Draft text stays put.');
});

test('SocialPublisher displays saved content_safety_warnings after successful save', async (t) => {
  const h = await publisherHarness(t, {
    saveHandler: async () => ({
      ok: true,
      content_safety_warnings: ['Warning-only phrase flagged.'],
      draft: {
        id: 301,
        profile_id: 'prof1',
        status: 'draft',
        text: 'Benign caption',
        media_urls: [],
        platforms: ['instagram'],
        scheduled_for: null,
        meta: {},
        content_safety_warnings: ['Warning-only phrase flagged.'],
      },
    }),
  });

  await h.setCaption('Benign caption');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await act(async () => {
    for (let i = 0; i < 20 && !h.text().includes('Warning-only phrase flagged'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.match(h.text(), /Warning-only phrase flagged/);
  assert.match(h.text(), /Draft saved/);
});

test('SocialPublisher preserves edits made while a save is in flight', async (t) => {
  let finish;
  const h = await publisherHarness(t, {
    saveHandler: async () => new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        content_safety_warnings: ['Saved warning.'],
        draft: {
          id: 302,
          profile_id: 'prof1',
          status: 'draft',
          text: 'Server saved stale caption.',
          media_urls: [],
          platforms: ['instagram'],
          scheduled_for: null,
          meta: {},
          content_safety_warnings: ['Saved warning.'],
        },
      });
    }),
  });

  await h.setCaption('Initial save caption.');
  await h.selectInstagram();
  await h.clickSaveDraft();
  await h.setCaption('Edited again while saving.');
  await act(async () => finish());
  await act(async () => {
    for (let i = 0; i < 20 && !h.text().includes('Saved warning.'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.captionInput().value, 'Edited again while saving.');
  assert.match(h.text(), /Saved warning/);
  assert.doesNotMatch(h.text(), /Server saved stale caption/);
});

test('SocialPublisher ignores a late blocked save response after switching drafts', async (t) => {
  let finish;
  const draftA = {
    id: 42,
    profile_id: 'prof1',
    status: 'draft',
    text: 'Draft A baseline',
    media_urls: [],
    platforms: ['instagram'],
    scheduled_for: null,
    meta: {},
    content_safety_warnings: [],
  };
  const draftB = {
    id: 43,
    profile_id: 'prof1',
    status: 'draft',
    text: 'Draft B caption',
    media_urls: [],
    platforms: ['linkedin'],
    scheduled_for: null,
    meta: {},
    content_safety_warnings: [],
  };
  const h = await publisherHarness(t, {
    drafts: { 42: draftA, 43: draftB },
    saveHandler: async ({ method, draftId }) => new Promise((resolve) => {
      if (method === 'PATCH' && draftId === 42) {
        finish = () => resolve({
          ok: false,
          error: 'content_safety_blocked',
          userMessage: 'Late blocked response for draft A.',
          httpStatus: 403,
        });
        return;
      }
      resolve({
        ok: true,
        draft: method === 'PATCH'
          ? { ...draftA, id: draftId, text: 'saved' }
          : draftA,
      });
    }),
  });

  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Draft A baseline');
  await h.waitForDraftEditor(42);
  await h.setCaption('Draft A pending save.');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Draft B caption');
  await h.waitForDraftEditor(43);

  await act(async () => {
    assert.ok(finish, 'PATCH save should have started before switching drafts');
    finish();
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.equal(h.captionInput().value, 'Draft B caption');
});

test('switching drafts clears the prior save alert', async (t) => {
  const secondDraft = {
    id: 43,
    profile_id: 'prof1',
    status: 'draft',
    text: 'Second draft caption',
    media_urls: [],
    platforms: ['linkedin'],
    scheduled_for: '2026-09-20T10:00:00.000Z',
    meta: {},
    content_safety_warnings: ['Second draft baseline warning.'],
  };
  const h = await publisherHarness(t, {
    drafts: {
      43: secondDraft,
    },
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Draft A save blocked.',
      httpStatus: 403,
    }),
    warnings: ['Existing warning should remain when save is blocked.'],
  });

  await h.setCaption('Blocked caption attempt.');
  await h.selectInstagram();
  await h.clickSaveDraft();

  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.match(h.document.querySelector('[role="alert"]').textContent, /Draft A save blocked/);

  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Second draft caption');

  await act(async () => {
    for (let i = 0; i < 20 && !h.captionInput().value.includes('Second draft'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.match(h.text(), /Second draft baseline warning/);
  assert.equal(h.captionInput().value, 'Second draft caption');
});

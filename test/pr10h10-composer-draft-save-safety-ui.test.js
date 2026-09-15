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
  const secondDraft = {
    id: 43,
    prompt: 'Win-back campaign',
    draft: {
      ...BASE_DRAFT,
      campaign_name: 'Win-back offer',
      body: 'Come back for a special offer.',
    },
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
      content_safety_warnings: opts.warnings || ['Existing warning should remain when save is blocked.'],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }, ...(opts.includeSecondDraft === false ? [] : [secondDraft])],
    saveHandler: opts.saveHandler || null,
    generateHandler: opts.generateHandler || null,
    nextDraftId: 100,
    putCalls: [],
  };

  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/reach/campaign-composer',
    pretendToBeVisual: true,
  });
  dom.window.alert = () => {};

  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    alert: dom.window.alert,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      if (url.endsWith('/api/campaign-composer/drafts') && method === 'GET') {
        return json({ ok: true, drafts: state.drafts });
      }
      if (url.endsWith('/api/campaign-composer/generate') && method === 'POST') {
        const payload = JSON.parse(options.body || '{}');
        const response = state.generateHandler
          ? await state.generateHandler(payload, state)
          : {
            ok: true,
            draft: {
              id: ++state.nextDraftId,
              prompt: payload.prompt,
              draft: {
                ...BASE_DRAFT,
                campaign_name: 'Generated campaign',
                body: `Generated for ${payload.prompt}`,
              },
              status: 'draft',
              segment_id: null,
              content_safety_warnings: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };
        const status = response.httpStatus || (response.ok ? 200 : 403);
        return json(response, status);
      }
      const putMatch = url.match(/\/api\/campaign-composer\/drafts\/(\d+)$/);
      if (putMatch && method === 'PUT') {
        const draftId = Number(putMatch[1]);
        const payload = JSON.parse(options.body || '{}');
        state.putCalls.push({ draftId, payload });
        const response = state.saveHandler
          ? await state.saveHandler({ draftId, ...payload }, state)
          : {
            ok: true,
            draft: {
              ...state.drafts.find((d) => d.id === draftId),
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

  const selectDraft = async (label) => act(async () => {
    const row = [...dom.window.document.querySelectorAll('div')]
      .find((el) => el.textContent?.includes(label) && el.style?.cursor === 'pointer');
    assert.ok(row, `history draft row: ${label}`);
    row.click();
  });

  await selectDraft('Onboarding nurture');

  await act(async () => {
    for (let i = 0; i < 40 && !dom.window.document.querySelector('textarea[rows="6"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  const bodyInput = () => dom.window.document.querySelector('textarea[rows="6"]');
  const promptInput = () => dom.window.document.querySelector('textarea[rows="3"]');
  const setBodyText = async (value) => act(async () => {
    const el = bodyInput();
    assert.ok(el);
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')
      .set.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const setPromptText = async (value) => act(async () => {
    const el = promptInput();
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
  const clickGenerate = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Generate Campaign Draft'));
    assert.ok(btn, 'Generate Campaign Draft');
    btn.click();
  });
  const saveButton = () => [...dom.window.document.querySelectorAll('button')]
    .find((b) => /Save Changes|Saving\.\.\./.test(b.textContent || ''));
  const approveButton = () => [...dom.window.document.querySelectorAll('button')]
    .find((b) => /Approve & Create Segment|Approving\.\.\./.test(b.textContent || ''));
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
    clickGenerate,
    selectDraft,
    saveButton,
    approveButton,
    assertDraftActionsUsable,
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

test('CampaignComposer switching drafts clears the prior draft save alert', async (t) => {
  const h = await composerHarness(t, {
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Draft A save blocked.',
      httpStatus: 403,
    }),
  });

  await h.setBodyText('Blocked on draft A.');
  await h.clickSave();
  await act(async () => {
    for (let i = 0; i < 20 && !h.document.querySelector('[role="alert"]'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.match(h.document.querySelector('[role="alert"]').textContent, /Draft A save blocked/);

  await h.selectDraft('Win-back offer');
  await act(async () => {
    for (let i = 0; i < 20 && !h.bodyInput().value.includes('Come back'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.match(h.text(), /Second draft baseline warning/);
  assert.equal(h.bodyInput().value, 'Come back for a special offer.');
});

test('CampaignComposer ignores a late blocked save response after switching drafts', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    saveHandler: async () => new Promise((resolve) => {
      finish = () => resolve({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Late blocked response for draft A.',
        httpStatus: 403,
      });
    }),
  });

  await h.setBodyText('Draft A pending save.');
  await h.clickSave();
  await h.selectDraft('Win-back offer');
  await act(async () => {
    for (let i = 0; i < 20 && !h.bodyInput().value.includes('Come back'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  await act(async () => finish());
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.equal(h.bodyInput().value, 'Come back for a special offer.');
});

test('CampaignComposer ignores a late successful save response after switching drafts', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    saveHandler: async ({ draftId, draft }, state) => new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          draft: { ...draft, body: 'Server overwrote draft A.' },
          content_safety_warnings: ['Late success warning.'],
        },
      });
    }),
  });

  await h.setBodyText('Draft A pending save.');
  await h.clickSave();
  await h.selectDraft('Win-back offer');
  await act(async () => {
    for (let i = 0; i < 20 && !h.bodyInput().value.includes('Come back'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  await act(async () => finish());
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.equal(h.bodyInput().value, 'Come back for a special offer.');
  assert.doesNotMatch(h.text(), /Server overwrote draft A|Late success warning/);
});

test('CampaignComposer preserves edits made while a save is in flight', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    saveHandler: async ({ draftId, draft }, state) => new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          draft: { ...draft, body: 'Server saved stale body.' },
          content_safety_warnings: ['Saved warning.'],
        },
        content_safety_warnings: ['Saved warning.'],
      });
    }),
  });

  await h.setBodyText('Initial save body.');
  await h.clickSave();
  await h.setBodyText('Edited again while saving.');
  await act(async () => finish());
  await act(async () => {
    for (let i = 0; i < 20 && !h.text().includes('Saved warning.'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.bodyInput().value, 'Edited again while saving.');
  assert.match(h.text(), /Saved warning/);
  assert.doesNotMatch(h.text(), /Server saved stale body/);
});

test('CampaignComposer generate clears a prior save alert and ignores late save responses', async (t) => {
  let finishBlocked;
  const h = await composerHarness(t, {
    saveHandler: async () => new Promise((resolve) => {
      finishBlocked = () => resolve({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Draft A blocked after generate started.',
        httpStatus: 403,
      });
    }),
  });

  await h.setBodyText('Draft A blocked save.');
  await h.clickSave();
  await h.setPromptText('Launch a spring promo');
  await h.clickGenerate();
  await act(async () => {
    for (let i = 0; i < 40 && !h.text().includes('Generated campaign'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  assert.equal(h.document.querySelector('[role="alert"]'), null);
  await act(async () => finishBlocked());
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });
  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.match(h.text(), /Generated campaign/);
});

test('CampaignComposer resets saving state when generate succeeds during a pending save', async (t) => {
  let finishSave;
  const h = await composerHarness(t, {
    saveHandler: async ({ draftId, draft }, state) => new Promise((resolve) => {
      finishSave = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          draft: { ...draft, body: 'Late saved body.' },
        },
      });
    }),
  });

  await h.setBodyText('Pending save body.');
  await h.clickSave();
  await act(async () => {
    for (let i = 0; i < 20 && !h.saveButton()?.disabled; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.equal(h.saveButton()?.disabled, true);

  await h.setPromptText('Launch a spring promo');
  await h.clickGenerate();
  await act(async () => {
    for (let i = 0; i < 40 && !h.text().includes('Generated campaign'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  h.assertDraftActionsUsable();
  await act(async () => finishSave());
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });
  h.assertDraftActionsUsable();
});

test('CampaignComposer resets saving state when generate fails during a pending save', async (t) => {
  let finishSave;
  const h = await composerHarness(t, {
    saveHandler: async ({ draftId, draft }, state) => new Promise((resolve) => {
      finishSave = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          draft,
        },
      });
    }),
    generateHandler: async () => ({
      ok: false,
      error: 'generation_failed',
      userMessage: 'Generation failed for test.',
      httpStatus: 502,
    }),
  });

  await h.setBodyText('Pending save body.');
  await h.clickSave();
  await act(async () => {
    for (let i = 0; i < 20 && !h.saveButton()?.disabled; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });
  assert.equal(h.saveButton()?.disabled, true);

  await h.setPromptText('Broken prompt');
  await h.clickGenerate();
  await act(async () => {
    for (let i = 0; i < 40 && !h.text().includes('Onboarding nurture'); i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
  });

  h.assertDraftActionsUsable();
  await act(async () => finishSave());
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  });
  h.assertDraftActionsUsable();
  assert.match(h.text(), /Onboarding nurture/);
});

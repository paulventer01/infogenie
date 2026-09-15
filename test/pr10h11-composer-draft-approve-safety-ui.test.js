// test/pr10h11-composer-draft-approve-safety-ui.test.js — rendered UI acceptance for PR10H.11
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

async function waitFor(pred, tries = 20) {
  await act(async () => {
    for (let i = 0; i < tries && !pred(); i++) await new Promise((r) => setTimeout(r, 25));
  });
}

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
  };

  const dom = new JSDOM('<div id="root"></div>', {
    url: 'http://localhost/reach/campaign-composer',
    pretendToBeVisual: true,
  });
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
      const approveMatch = url.match(/\/api\/campaign-composer\/drafts\/(\d+)\/approve$/);
      if (approveMatch && method === 'POST') {
        const draftId = Number(approveMatch[1]);
        state.approveCalls.push({ draftId });
        const response = state.approveHandler
          ? await state.approveHandler({ draftId }, state)
          : {
            ok: true,
            draft: {
              ...state.drafts.find((d) => d.id === draftId),
              status: 'approved',
              segment_id: ++state.nextSegmentId,
              content_safety_warnings: [],
            },
            segment_id: state.nextSegmentId,
          };
        if (response.ok && response.draft) {
          state.drafts = state.drafts.map((row) => (
            row.id === draftId ? { ...response.draft } : row
          ));
        }
        const status = response.httpStatus || (response.ok ? 200 : response.error === 'content_safety_unavailable' ? 503 : 403);
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
  const clickApprove = async () => act(async () => {
    const btn = [...dom.window.document.querySelectorAll('button')]
      .find((b) => /Approve & Create Segment|Approving\.\.\./.test(b.textContent || ''));
    assert.ok(btn, 'Approve & Create Segment');
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
  const alerts = () => [...dom.window.document.querySelectorAll('[role="alert"]')];

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
    alerts,
    state,
    waitFor,
  };
}

test('CampaignComposer blocked approve shows role=alert and preserves edited body text', async (t) => {
  const h = await composerHarness(t, {
    approveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Generated content did not pass brand and compliance checks. Revise the copy or request human review.',
      httpStatus: 403,
    }),
  });

  await h.setBodyText('My edited body that must stay visible on blocked approve.');
  await h.clickApprove();
  await h.waitFor(() => h.alerts().length > 0);

  const alert = h.alerts()[0];
  assert.ok(alert, 'expected role=alert for blocked approve');
  assert.match(alert.textContent, /did not pass brand and compliance checks/i);
  assert.equal(h.bodyInput().value, 'My edited body that must stay visible on blocked approve.');
  assert.match(h.text(), /Existing warning should remain when approve is blocked/);
  h.assertDraftActionsUsable();
});

test('CampaignComposer unavailable approve shows role=alert and preserves edited body text', async (t) => {
  const h = await composerHarness(t, {
    approveHandler: async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
      httpStatus: 503,
    }),
  });

  await h.setBodyText('Edited body preserved on approve scanner failure.');
  await h.clickApprove();
  await h.waitFor(() => h.alerts().length > 0);

  const alert = h.alerts()[0];
  assert.ok(alert, 'expected role=alert for unavailable approve');
  assert.match(alert.textContent, /temporarily unavailable/i);
  assert.equal(h.bodyInput().value, 'Edited body preserved on approve scanner failure.');
  h.assertDraftActionsUsable();
});

test('CampaignComposer successful warning-only approve displays persisted warnings', async (t) => {
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => ({
      ok: true,
      draft: {
        ...state.drafts.find((d) => d.id === draftId),
        status: 'approved',
        segment_id: 901,
        content_safety_warnings: ['Warning-only approve retained this caution.'],
      },
      segment_id: 901,
      content_safety_warnings: ['Warning-only approve retained this caution.'],
    }),
  });

  await h.clickApprove();
  await h.waitFor(() => h.text().includes('Warning-only approve retained this caution.'));

  assert.equal(h.alerts().length, 0);
  assert.match(h.text(), /Warning-only approve retained this caution/);
  assert.match(h.text(), /Audience segment created/);
});

test('CampaignComposer switching drafts clears the prior draft approve alert', async (t) => {
  const h = await composerHarness(t, {
    approveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Draft A approve blocked.',
      httpStatus: 403,
    }),
  });

  await h.setBodyText('Blocked on draft A approve.');
  await h.clickApprove();
  await h.waitFor(() => h.alerts().length > 0);
  assert.match(h.alerts()[0].textContent, /Draft A approve blocked/);

  await h.selectDraft('Win-back offer');
  await h.waitFor(() => h.bodyInput().value.includes('Come back'));

  assert.equal(h.alerts().length, 0);
  assert.match(h.text(), /Second draft baseline warning/);
  assert.equal(h.bodyInput().value, 'Come back for a special offer.');
});

test('CampaignComposer ignores a late blocked approve response after switching drafts', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    approveHandler: async () => new Promise((resolve) => {
      finish = () => resolve({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Late blocked approve response for draft A.',
        httpStatus: 403,
      });
    }),
  });

  await h.setBodyText('Draft A pending approve.');
  await h.clickApprove();
  await h.selectDraft('Win-back offer');
  await h.waitFor(() => h.bodyInput().value.includes('Come back'));

  await act(async () => finish());
  await h.waitFor(() => true);

  assert.equal(h.alerts().length, 0);
  assert.equal(h.bodyInput().value, 'Come back for a special offer.');
});

test('CampaignComposer resets approving state when blocked approve completes', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    approveHandler: async () => new Promise((resolve) => {
      finish = () => resolve({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Blocked approve should not leave Approving… stuck.',
        httpStatus: 403,
      });
    }),
  });

  await h.clickApprove();
  await h.waitFor(() => h.approveButton()?.disabled);
  assert.equal(h.approveButton()?.disabled, true);

  await act(async () => finish());
  await h.waitFor(() => h.alerts().length > 0);

  h.assertDraftActionsUsable();
  assert.match(h.alerts()[0].textContent, /Blocked approve should not leave Approving/);
});

test('CampaignComposer generate clears a prior approve alert and ignores late approve responses', async (t) => {
  let finishBlocked;
  const h = await composerHarness(t, {
    approveHandler: async () => new Promise((resolve) => {
      finishBlocked = () => resolve({
        ok: false,
        error: 'content_safety_blocked',
        userMessage: 'Draft A blocked after generate started.',
        httpStatus: 403,
      });
    }),
  });

  await h.setBodyText('Draft A blocked approve.');
  await h.clickApprove();
  await h.setPromptText('Launch a spring promo');
  await h.clickGenerate();
  await h.waitFor(() => h.text().includes('Generated campaign'), 40);

  assert.equal(h.alerts().length, 0);
  await act(async () => finishBlocked());
  await h.waitFor(() => true);
  assert.equal(h.alerts().length, 0);
  assert.match(h.text(), /Generated campaign/);
});

test('CampaignComposer preserves edits made while approve is in flight', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          status: 'approved',
          segment_id: 902,
          draft: { ...BASE_DRAFT, body: 'Server approved stale body.' },
          content_safety_warnings: ['Approved warning.'],
        },
        segment_id: 902,
        content_safety_warnings: ['Approved warning.'],
      });
    }),
  });

  await h.setBodyText('Initial approve body.');
  await h.clickApprove();
  await h.setBodyText('Edited again while approving.');
  await act(async () => finish());
  await h.waitFor(() => h.text().includes('Approved warning.'));

  assert.equal(h.bodyInput().value, 'Edited again while approving.');
  assert.match(h.text(), /Approved warning/);
  assert.match(h.text(), /Audience segment created/);
  assert.doesNotMatch(h.text(), /Server approved stale body/);
});

test('CampaignComposer late approve success updates history so re-selected draft shows approved', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => new Promise((resolve) => {
      finish = () => {
        const approved = {
          ...state.drafts.find((d) => d.id === draftId),
          status: 'approved',
          segment_id: 903,
          content_safety_warnings: [],
        };
        resolve({ ok: true, draft: approved, segment_id: 903 });
      };
    }),
  });

  await h.clickApprove();
  await h.selectDraft('Win-back offer');
  await h.waitFor(() => h.bodyInput().value.includes('Come back'));

  await act(async () => finish());
  await h.waitFor(() => true);

  await h.selectDraft('Onboarding nurture');
  await h.waitFor(() => h.text().includes('Audience segment created'), 40);

  assert.match(h.text(), /Audience segment created \(ID: 903\)/);
  assert.equal(h.bodyInput()?.disabled, true);
});

test('CampaignComposer draft A approving does not disable draft B actions', async (t) => {
  let finishA;
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => new Promise((resolve) => {
      if (draftId === 42) {
        finishA = () => resolve({
          ok: true,
          draft: {
            ...state.drafts.find((d) => d.id === 42),
            status: 'approved',
            segment_id: 904,
            content_safety_warnings: [],
          },
          segment_id: 904,
        });
        return;
      }
      resolve({ ok: true, draft: { ...state.drafts.find((d) => d.id === draftId), status: 'approved', segment_id: 905 }, segment_id: 905 });
    }),
  });

  await h.clickApprove();
  await h.waitFor(() => h.approveButton()?.disabled);
  assert.equal(h.approveButton()?.disabled, true);

  await h.selectDraft('Win-back offer');
  await h.waitFor(() => h.bodyInput().value.includes('Come back'));

  h.assertDraftActionsUsable();
  await h.setBodyText('Draft B edits stay editable while A approves.');
  assert.equal(h.bodyInput().value, 'Draft B edits stay editable while A approves.');

  await act(async () => finishA());
  await h.waitFor(() => true);

  assert.equal(h.bodyInput().value, 'Draft B edits stay editable while A approves.');
  h.assertDraftActionsUsable();
  await h.selectDraft('Onboarding nurture');
  await h.waitFor(() => h.text().includes('Audience segment created'), 40);
  assert.match(h.text(), /Audience segment created \(ID: 904\)/);
});

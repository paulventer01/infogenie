// test/pr10h11-composer-draft-approve-safety-ui.test.js — rendered UI acceptance for PR10H.11
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act } = React;
const { BASE_DRAFT, composerHarness } = require('./helpers/composer-ui-harness');

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
      finish = () => resolve({ ok: false, error: 'content_safety_blocked', userMessage: 'Blocked approve should not leave Approving… stuck.', httpStatus: 403 });
    }),
  });
  await h.clickApprove();
  await h.waitFor(() => h.approveButton()?.disabled);
  await act(async () => finish());
  await h.waitFor(() => h.alerts().length > 0);
  h.assertDraftActionsUsable();
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

test('CampaignComposer re-checks active draft and edits after approval history refresh', async (t) => {
  let finish;
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => new Promise((resolve) => {
      finish = () => resolve({
        ok: true,
        draft: {
          ...state.drafts.find((d) => d.id === draftId),
          status: 'approved',
          segment_id: 906,
          draft: { ...BASE_DRAFT, body: 'Server body should not overwrite latest edits.' },
          content_safety_warnings: ['Post-refresh warning.'],
        },
        segment_id: 906,
      });
    }),
  });
  await h.blockHistoryRefresh();
  await h.setBodyText('Body before approve.');
  await h.clickApprove();
  await act(async () => finish());
  await h.setBodyText('Edited during history refresh.');
  h.releaseHistoryRefresh();
  await h.waitFor(() => h.text().includes('Audience segment created'), 40);
  assert.equal(h.bodyInput().value, 'Edited during history refresh.');
  assert.doesNotMatch(h.text(), /Server body should not overwrite/);
});

test('CampaignComposer generate keeps late approval outcome in history without touching new draft', async (t) => {
  let finishApprove;
  const h = await composerHarness(t, {
    approveHandler: async ({ draftId }, state) => new Promise((resolve) => {
      finishApprove = () => resolve({
        ok: true,
        draft: { ...state.drafts.find((d) => d.id === draftId), status: 'approved', segment_id: 907 },
        segment_id: 907,
      });
    }),
  });
  await h.clickApprove();
  await h.setPromptText('Launch a spring promo');
  await h.clickGenerate();
  await h.waitFor(() => h.text().includes('Generated campaign'), 40);
  h.assertDraftActionsUsable();
  await act(async () => finishApprove());
  await h.waitFor(() => h.text().includes('approved'), 40);
  assert.doesNotMatch(h.text(), /Audience segment created \(ID: 907\)/);
  await h.selectDraft('Onboarding nurture');
  await h.waitFor(() => h.text().includes('Audience segment created'), 40);
  assert.match(h.text(), /Audience segment created \(ID: 907\)/);
});

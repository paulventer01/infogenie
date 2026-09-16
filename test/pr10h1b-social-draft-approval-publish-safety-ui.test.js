// test/pr10h1b-social-draft-approval-publish-safety-ui.test.js — rendered UI for PR-1b
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('react');
const {
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
} = require('./helpers/social-publisher-ui-harness');

test('SocialApprovalsPanel shows role=alert on content safety block', async (t) => {
  const h = await approvalsHarness(t, {
    drafts: [{ id: 51, text: 'Pending caption', platforms: ['linkedin'], meta: {}, content_safety_warnings: ['Prior queue warning.'] }],
    approveHandler: async () => safetyBlocked('Approval blocked by brand safety rules.'),
  });
  await waitFor(() => h.text().includes('Prior queue warning'), 20, 'seeded warnings');
  await h.clickApprove();
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /blocked by brand safety/);
  assert.match(h.text(), /Prior queue warning/);
});

test('SocialPublisher self-heal shows alert and preserves caption on block', async (t) => {
  const draft = uiDraft(60, 'Caption to heal', { warnings: ['Existing warning.'] });
  const h = await publisherHarness(t, {
    drafts: { 60: draft },
    saveHandler: saveOk(draft),
    selfHealHandler: async () => safetyBlocked('Self-heal blocked by brand safety rules.'),
  });
  await openEditorDraft(h, 60, 'Caption to heal');
  await waitFor(() => h.text().includes('Existing warning'), 20, 'existing warnings');
  await h.clickSelfHeal();
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /Self-heal blocked/);
  assert.equal(h.captionInput().value, 'Caption to heal');
  assert.match(h.text(), /Existing warning/);
});

test('SocialPublisher preserves edits made while self-heal is in flight', async (t) => {
  await testInflightEditPreserved(t, {
    id: 70,
    snippet: 'Caption to heal',
    editedCaption: 'Edited again while self-healing.',
    loadingText: 'Self-healing',
    actionKey: 'selfHeal',
    click: (h) => h.clickSelfHeal(),
    resolve: () => ({
      ok: true,
      draft: { id: 70, text: 'Server healed stale caption.', content_safety_warnings: ['Heal warning.'] },
      content_safety_warnings: ['Heal warning.'],
    }),
  });
});

test('SocialPublisher preserves edits made while submit is in flight', async (t) => {
  await testInflightEditPreserved(t, {
    id: 71,
    snippet: 'Submit me',
    editedCaption: 'Edited again while submitting.',
    loadingText: 'Submitting',
    actionKey: 'submit',
    click: (h) => h.clickSubmitApproval(),
    resolve: () => ({
      ok: true,
      draft: { id: 71, status: 'pending_approval', text: 'Server submit stale caption.', content_safety_warnings: ['Submit warning.'] },
      content_safety_warnings: ['Submit warning.'],
    }),
  });
});

test('SocialPublisher ignores late blocked self-heal response after switching drafts', async (t) => {
  await testLateResponseIgnored(t, {
    idA: 72,
    idB: 73,
    snippetA: 'Draft A heal',
    snippetB: 'Draft B caption',
    actionKey: 'selfHeal',
    callsKey: 'selfHealCalls',
    finish: () => safetyBlocked('Late blocked self-heal for draft A.'),
    assertQuiet: (h) => assert.equal(h.document.querySelector('[role="alert"]'), null),
  });
});

test('SocialPublisher ignores late submit response after switching drafts', async (t) => {
  await testLateResponseIgnored(t, {
    idA: 74,
    idB: 75,
    snippetA: 'Draft A submit',
    snippetB: 'Draft B caption',
    actionKey: 'submit',
    callsKey: 'submitCalls',
    finish: () => ({
      ok: true,
      draft: { id: 74, status: 'pending_approval', text: 'Server submit should not apply.', content_safety_warnings: [] },
    }),
    assertQuiet: (h) => assert.doesNotMatch(h.text(), /Server submit should not apply/),
  });
});

test('SocialPublisher resets self-heal loading after response', async (t) => {
  const draft = uiDraft(61, 'Heal me');
  const heal = deferred(() => ({
    ok: true,
    draft: { id: 61, text: 'Healed copy', content_safety_warnings: ['Heal warning.'] },
    content_safety_warnings: ['Heal warning.'],
  }));
  const h = await publisherHarness(t, {
    drafts: { 61: draft },
    saveHandler: saveOk(draft),
    selfHealHandler: heal.handler,
  });
  await openEditorDraft(h, 61, 'Heal me');
  await h.clickSelfHeal();
  await waitFor(() => /Self-healing|Running self-heal/.test(h.text()), 20, 'self-heal loading');
  await act(async () => heal.finish());
  await waitFor(() => h.text().includes('Heal warning'), 20, 'heal warnings');
  const btn = [...h.document.querySelectorAll('button')].find((b) => /Self-heal/.test(b.textContent || ''));
  assert.ok(btn);
  assert.equal(btn.disabled, false);
});

[
  ['unsaved submit create calls submit-approval once', { actionKey: 'submit' }],
  ['unsaved self-heal create calls self-heal once', { actionKey: 'selfHeal' }],
  ['ignores late unsaved create after switching drafts', { actionKey: 'submit', switchAway: true }],
].forEach(([name, spec]) => {
  test(`SocialPublisher ${name}`, (t) => testUnsavedCreateThenAction(t, spec));
});

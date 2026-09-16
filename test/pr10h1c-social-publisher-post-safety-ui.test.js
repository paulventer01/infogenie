// test/pr10h1c-social-publisher-post-safety-ui.test.js — rendered UI for PR-1c
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('react');
const {
  publisherHarness,
  waitFor,
  uiDraft,
  deferred,
  openEditorDraft,
} = require('./helpers/social-publisher-ui-harness');

const blocked = {
  ok: false,
  error: 'content_safety_blocked',
  userMessage: 'This caption was blocked by brand safety rules.',
  httpStatus: 403,
};

async function publishCaption(h, caption = 'guaranteed 100% returns') {
  await h.setCaption(caption);
  await h.selectInstagram();
  await h.clickPublishNow();
}

test('SocialPublisher publish shows role=alert on block and preserves caption', async (t) => {
  const h = await publisherHarness(t, { publishHandler: async () => blocked });
  await publishCaption(h);
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /blocked by brand safety/);
  assert.equal(h.captionInput().value, 'guaranteed 100% returns');
  assert.equal(h.state.publishCalls.length, 1);
  assert.equal(h.state.postCalls.length, 0);
});

test('SocialPublisher publish shows unavailable alert without clearing the editor', async (t) => {
  const h = await publisherHarness(t, {
    publishHandler: async () => ({
      ok: false,
      error: 'content_safety_unavailable',
      userMessage: 'Content safety checks are temporarily unavailable.',
      httpStatus: 503,
    }),
  });
  await publishCaption(h, 'Draft text stays put.');
  await h.waitForAlert();
  assert.match(h.document.querySelector('[role="alert"]').textContent, /temporarily unavailable/);
  assert.equal(h.captionInput().value, 'Draft text stays put.');
  assert.equal(h.state.postCalls.length, 0);
});

test('SocialPublisher keeps prior warnings visible when publish is blocked', async (t) => {
  const h = await publisherHarness(t, {
    drafts: {
      81: uiDraft(81, 'Existing caption with warnings.', { warnings: ['Prior warning stays visible.'] }),
    },
    publishHandler: async () => blocked,
  });
  await openEditorDraft(h, 81, 'Existing caption');
  await waitFor(() => h.text().includes('Prior warning stays visible'), 20, 'seeded warnings');
  await publishCaption(h);
  await h.waitForAlert();
  assert.match(h.text(), /Prior warning stays visible/);
  assert.equal(h.captionInput().value, 'guaranteed 100% returns');
});

test('SocialPublisher shows content_safety_warnings after warning-only publish', async (t) => {
  const h = await publisherHarness(t, {
    publishHandler: async () => ({
      ok: true,
      scheduled: false,
      content_safety_warnings: ['Warning-only phrase flagged.'],
    }),
  });
  await publishCaption(h, 'Benign publish caption');
  await waitFor(() => h.text().includes('Warning-only phrase flagged'), 20, 'publish warnings');
  await waitFor(() => h.text().includes('Published'), 20, 'publish success');
  assert.equal(h.state.publishCalls.length, 1);
});

test('SocialPublisher preserves edits made while publish is in flight', async (t) => {
  const pending = deferred(() => ({ ok: true, scheduled: false, content_safety_warnings: ['Saved warning.'] }));
  const h = await publisherHarness(t, { publishHandler: pending.handler });
  await h.setCaption('Initial publish caption.');
  await h.selectInstagram();
  await h.clickPublishNow();
  await waitFor(() => h.text().includes('Sending to Zernio') || h.text().includes('Publishing'), 20, 'publish loading');
  await h.setCaption('Edited again while publishing.');
  await act(async () => pending.finish());
  await waitFor(() => h.captionInput().value === 'Edited again while publishing.', 20, 'preserved caption');
});

test('SocialPublisher ignores a late blocked publish after switching drafts', async (t) => {
  const pending = deferred(() => blocked);
  const draftA = uiDraft(82, 'Draft A baseline');
  const draftB = uiDraft(83, 'Draft B caption', { platforms: ['linkedin'] });
  const h = await publisherHarness(t, {
    drafts: { 82: draftA, 83: draftB },
    publishHandler: async () => pending.handler(),
  });
  await openEditorDraft(h, 82, 'Draft A baseline');
  await h.selectInstagram();
  await h.clickPublishNow();
  await waitFor(() => h.state.publishCalls.length === 1, 20, 'publish initiation');
  await openEditorDraft(h, 83, 'Draft B caption');
  await act(async () => pending.finish());
  await waitFor(() => h.captionInput().value === 'Draft B caption', 20, 'draft B editor');
  assert.equal(h.document.querySelector('[role="alert"]'), null);
});

test('SocialPublisher resets publish loading after the response', async (t) => {
  const pending = deferred(() => ({ ok: true, scheduled: false, content_safety_warnings: [] }));
  const h = await publisherHarness(t, { publishHandler: pending.handler });
  await h.setCaption('Publish me');
  await h.selectInstagram();
  await h.clickPublishNow();
  await waitFor(() => /Publishing…|Sending to Zernio/.test(h.text()), 20, 'loading shown');
  await act(async () => pending.finish());
  await waitFor(() => !/Publishing…|Sending to Zernio/.test(h.text()), 20, 'loading cleared');
});

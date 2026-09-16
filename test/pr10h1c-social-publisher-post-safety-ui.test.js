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
  assert.equal(h.state.publishCalls.length, 1);
  assert.equal(h.state.postCalls.length, 0);
});

test('SocialPublisher late successful publish still records A after switching to B', async (t) => {
  const pending = deferred(() => ({
    ok: true,
    scheduled: false,
    content_safety_warnings: ['A warning must not land on B.'],
  }));
  const draftA = uiDraft(84, 'Draft A publish caption');
  const draftB = uiDraft(85, 'Draft B stays put', { platforms: ['linkedin'], warnings: ['B warning stays.'] });
  const h = await publisherHarness(t, {
    drafts: { 84: draftA, 85: draftB },
    publishHandler: async () => pending.handler(),
  });
  await openEditorDraft(h, 84, 'Draft A publish caption');
  await h.selectInstagram();
  await h.clickPublishNow();
  await waitFor(() => h.state.publishCalls.length === 1, 20, 'publish A started');
  const postsBefore = h.state.postsLoads.length;
  await openEditorDraft(h, 85, 'Draft B stays put');
  await waitFor(() => h.text().includes('B warning stays'), 20, 'B warnings');
  await act(async () => pending.finish());
  await waitFor(() => h.state.postCalls.length === 1, 20, 'A calendar record');
  assert.equal(h.state.publishCalls.length, 1);
  assert.equal(h.state.postCalls[0].text, 'Draft A publish caption');
  assert.equal(h.state.postCalls[0].status, 'published');
  assert.equal(h.state.postCalls[0].meta.direct_publish, true);
  await waitFor(() => h.captionInput().value === 'Draft B stays put', 20, 'B caption');
  assert.match(h.text(), /B warning stays/);
  assert.doesNotMatch(h.text(), /A warning must not land on B/);
  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.doesNotMatch(h.text(), /Published to /);
  await waitFor(() => h.state.postsLoads.length > postsBefore, 50, 'A history refresh');
  assert.ok(h.state.postsLoads.slice(postsBefore).includes('prof1'));
  await h.openCalendar();
  await waitFor(() => h.text().includes('Draft A publish caption'), 40, 'calendar shows A');
});

test('SocialPublisher late success records original copy and keeps in-flight caption edits', async (t) => {
  const pending = deferred(() => ({ ok: true, scheduled: false, content_safety_warnings: ['Sent-copy warning.'] }));
  const h = await publisherHarness(t, { publishHandler: pending.handler });
  await h.setCaption('Original sent copy.');
  await h.selectInstagram();
  await h.clickPublishNow();
  await waitFor(() => h.text().includes('Sending to Zernio') || h.text().includes('Publishing'), 20, 'publish loading');
  const postsBefore = h.state.postsLoads.length;
  await h.setCaption('Edited again while publishing.');
  await act(async () => pending.finish());
  await waitFor(() => h.state.postCalls.length === 1, 20, 'recorded original copy');
  assert.equal(h.state.publishCalls.length, 1);
  assert.equal(h.state.publishCalls[0].text, 'Original sent copy.');
  assert.equal(h.state.postCalls[0].text, 'Original sent copy.');
  assert.equal(h.state.postCalls[0].status, 'published');
  await waitFor(() => h.captionInput().value === 'Edited again while publishing.', 20, 'preserved caption');
  assert.doesNotMatch(h.text(), /Sent-copy warning/);
  await waitFor(() => h.state.postsLoads.length > postsBefore, 50, 'list refresh');
  await h.openCalendar();
  await waitFor(() => h.text().includes('Original sent copy.'), 40, 'calendar shows sent copy');
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

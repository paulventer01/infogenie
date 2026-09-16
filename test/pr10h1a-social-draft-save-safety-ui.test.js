// test/pr10h1a-social-draft-save-safety-ui.test.js — rendered UI acceptance for PR-1a
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { act } = require('react');
const { publisherHarness, waitFor } = require('./helpers/social-publisher-ui-harness');

const blocked = {
  ok: false,
  error: 'content_safety_blocked',
  userMessage: 'This caption was blocked by brand safety rules.',
  httpStatus: 403,
};

async function saveBlockedCaption(h, caption = 'guaranteed 100% returns') {
  await h.setCaption(caption);
  await h.selectInstagram();
  await h.clickSaveDraft();
  await h.waitForAlert();
}

test('SocialPublisher shows actionable content_safety_blocked alert and preserves caption', async (t) => {
  const h = await publisherHarness(t, { saveHandler: async () => blocked });
  await saveBlockedCaption(h);
  assert.match(h.document.querySelector('[role="alert"]').textContent, /blocked by brand safety/);
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
  await saveBlockedCaption(h, 'Draft text stays put.');
  assert.match(h.document.querySelector('[role="alert"]').textContent, /temporarily unavailable/);
  assert.equal(h.captionInput().value, 'Draft text stays put.');
});

test('SocialPublisher keeps prior warnings visible when save is blocked', async (t) => {
  const h = await publisherHarness(t, {
    drafts: {
      42: {
        id: 42,
        profile_id: 'prof1',
        status: 'draft',
        text: 'Existing caption with warnings.',
        media_urls: [],
        platforms: ['instagram'],
        meta: {},
        content_safety_warnings: ['Prior warning stays visible.'],
      },
    },
    saveHandler: async () => blocked,
  });
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Existing caption');
  await h.waitForDraftEditor(42);
  await waitFor(() => h.text().includes('Prior warning stays visible'), 20, 'seeded warnings');
  await saveBlockedCaption(h);
  assert.match(h.text(), /Prior warning stays visible/);
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
        platforms: ['instagram'],
        content_safety_warnings: ['Warning-only phrase flagged.'],
      },
    }),
  });
  await h.setCaption('Benign caption');
  await h.selectInstagram();
  await h.clickSaveDraft();
  await waitFor(() => h.text().includes('Warning-only phrase flagged'), 20, 'saved warnings');
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
          platforms: ['instagram'],
          content_safety_warnings: ['Saved warning.'],
        },
      });
    }),
  });
  await h.setCaption('Initial save caption.');
  await h.selectInstagram();
  await h.clickSaveDraft();
  await waitFor(() => h.state.postCalls.length === 1, 20, 'save request initiation');
  await h.setCaption('Edited again while saving.');
  await act(async () => finish());
  await waitFor(() => h.text().includes('Saved warning.'), 20, 'saved warning banner');
  assert.equal(h.captionInput().value, 'Edited again while saving.');
});

test('SocialPublisher ignores a late blocked save response after switching drafts', async (t) => {
  let finish;
  const draftA = { id: 42, profile_id: 'prof1', status: 'draft', text: 'Draft A baseline', platforms: ['instagram'], meta: {}, content_safety_warnings: [] };
  const draftB = { id: 43, profile_id: 'prof1', status: 'draft', text: 'Draft B caption', platforms: ['linkedin'], meta: {}, content_safety_warnings: [] };
  const h = await publisherHarness(t, {
    drafts: { 42: draftA, 43: draftB },
    saveHandler: async ({ method, draftId }) => new Promise((resolve) => {
      if (method === 'PATCH' && draftId === 42) {
        finish = () => resolve({ ok: false, error: 'content_safety_blocked', userMessage: 'Late blocked response for draft A.', httpStatus: 403 });
        return;
      }
      resolve({ ok: true, draft: method === 'PATCH' ? { ...draftA, id: draftId } : draftA });
    }),
  });
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Draft A baseline');
  await h.waitForDraftEditor(42);
  await h.setCaption('Draft A pending save.');
  await h.selectInstagram();
  await h.clickSaveDraft();
  await waitFor(() => h.state.patchCalls.length === 1, 20, 'patch save initiation');
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Draft B caption');
  await h.waitForDraftEditor(43);
  await act(async () => { assert.ok(finish); finish(); });
  await waitFor(() => h.captionInput().value === 'Draft B caption', 20, 'draft B editor');
  assert.equal(h.document.querySelector('[role="alert"]'), null);
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
    drafts: { 43: secondDraft },
    saveHandler: async () => ({
      ok: false,
      error: 'content_safety_blocked',
      userMessage: 'Draft A save blocked.',
      httpStatus: 403,
    }),
  });
  await saveBlockedCaption(h, 'Blocked caption attempt.');
  assert.match(h.document.querySelector('[role="alert"]').textContent, /Draft A save blocked/);
  await h.openCalendar();
  await h.waitForCalendarDrafts();
  await h.editDraftFromCalendar('Second draft caption');
  await waitFor(() => h.captionInput().value.includes('Second draft'), 20, 'second draft editor');
  assert.equal(h.document.querySelector('[role="alert"]'), null);
  assert.match(h.text(), /Second draft baseline warning/);
  assert.equal(h.captionInput().value, 'Second draft caption');
});

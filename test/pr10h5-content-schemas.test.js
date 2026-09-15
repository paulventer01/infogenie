// test/pr10h5-content-schemas.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRedditReply,
  redditReplyGateText,
  normalizeProofreadFeedback,
  normalizeComposerDraft,
} = require('../services/ai_governance/content_schemas');

describe('content_schemas normalization', () => {
  it('normalizeRedditReply keeps only reply and tone_note', () => {
    const out = normalizeRedditReply({
      reply: 'Hello',
      tone_note: 'Helpful tone',
      extra_field: 'drop me',
      nested: { evil: true },
    });
    assert.equal(out.reply, 'Hello');
    assert.equal(out.tone_note, 'Helpful tone');
    assert.equal(out.extra_field, undefined);
    assert.equal(out.nested, undefined);
  });

  it('redditReplyGateText includes tone_note for gating', () => {
    const text = redditReplyGateText({ reply: 'safe', tone_note: 'guaranteed 100% returns' });
    assert.match(text, /guaranteed 100% returns/);
  });

  it('normalizeProofreadFeedback strips unexpected keys', () => {
    const out = normalizeProofreadFeedback({
      overall_score: 8,
      issues: [{ severity: 'warning', text: 'Fix CTA' }],
      improved_copy: 'Better copy',
      summary: 'Looks good',
      surprise: 'nope',
    });
    assert.equal(out.summary, 'Looks good');
    assert.equal(out.surprise, undefined);
  });

  it('normalizeComposerDraft constrains channel enum', () => {
    const out = normalizeComposerDraft({ campaign_name: 'X', channel: 'fax' }, 'openai');
    assert.equal(out.channel, 'email');
    assert.equal(out.source, 'openai');
  });
});

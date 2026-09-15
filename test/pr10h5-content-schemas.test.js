// test/pr10h5-content-schemas.test.js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRedditReply,
  redditReplyGateText,
  normalizeProofreadFeedback,
  normalizeComposerDraft,
  composerDraftGateText,
  normalizeChannelAd,
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

  it('normalizeComposerDraft sanitises audience_rules.conditions and drops unexpected nested keys', () => {
    const out = normalizeComposerDraft({
      campaign_name: 'Segment test',
      audience_rules: {
        match: 'any',
        conditions: [
          {
            type: 'property',
            field: 'lifecycle',
            op: 'eq',
            value: 'active',
            nested: { evil: true },
            surprise: 'drop me',
          },
          { field: 'status', op: 'eq', value: 'missing type' },
          { type: 'event', event: 'signup', op: 'happened', value: { bad: true }, days: 14 },
        ],
        extra_rules_key: 'nope',
      },
    }, 'openai');
    assert.equal(out.audience_rules.match, 'any');
    assert.equal(out.audience_rules.extra_rules_key, undefined);
    assert.equal(out.audience_rules.conditions.length, 2);
    assert.equal(out.audience_rules.conditions[0].field, 'lifecycle');
    assert.equal(out.audience_rules.conditions[0].value, 'active');
    assert.equal(out.audience_rules.conditions[0].nested, undefined);
    assert.equal(out.audience_rules.conditions[0].surprise, undefined);
    assert.equal(out.audience_rules.conditions[1].value, null);
  });

  it('composerDraftGateText includes retained condition values for gating', () => {
    const text = composerDraftGateText({
      campaign_name: 'Safe campaign',
      subject: 'Hello',
      body: 'Welcome aboard.',
      audience_rules: {
        match: 'all',
        conditions: [
          { type: 'property', field: 'tier', op: 'eq', value: 'guaranteed 100% returns with zero risk' },
        ],
      },
    });
    assert.match(text, /guaranteed 100% returns with zero risk/);
  });

  it('normalizeChannelAd sets source from server arg, not model payload', () => {
    const out = normalizeChannelAd({
      headline: 'Grow',
      body: 'Start today',
      cta: 'Join',
      hashtags: '#growth',
      source: 'forged-provenance',
    }, 'openai');
    assert.equal(out.source, 'openai');
    const tpl = normalizeChannelAd({ headline: 'X', source: 'forged' }, 'template');
    assert.equal(tpl.source, 'template');
    const bare = normalizeChannelAd({ headline: 'X' });
    assert.equal(bare.source, undefined);
  });
});

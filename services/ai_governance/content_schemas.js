/**
 * Allowed response shapes for Step 6 gated generation paths.
 * Strips unexpected fields before gate/persist/return.
 */

const { sanitiseAudienceRules } = require('../audiences/rules_sanitise');

function _str(v, max = 8000) {
  return String(v == null ? '' : v).slice(0, max);
}

function _num(v, min, max, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function _pickStrings(arr, maxItems = 10, maxLen = 500) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => _str(typeof x === 'string' ? x : (x?.text || x?.title || ''), maxLen).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeProofreadFeedback(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const issues = Array.isArray(src.issues) ? src.issues : [];
  const out = {
    overall_score: src.overall_score == null ? null : _num(src.overall_score, 1, 10, null),
    issues: issues.slice(0, 30).map((i) => {
      if (typeof i === 'string') return { severity: 'suggestion', text: _str(i, 500) };
      const sev = ['error', 'warning', 'suggestion'].includes(i?.severity) ? i.severity : 'suggestion';
      return { severity: sev, text: _str(i?.text, 500) };
    }).filter((i) => i.text),
    improved_copy: _str(src.improved_copy, 8000),
    summary: _str(src.summary, 2000),
  };
  if (src._estimated) out._estimated = true;
  return out;
}

function proofreadGateText(feedback) {
  const norm = normalizeProofreadFeedback(feedback);
  const issueText = norm.issues.map((i) => i.text).join('\n');
  return [norm.summary, norm.improved_copy, issueText].filter(Boolean).join('\n');
}

const COMPOSER_CHANNELS = new Set(['email', 'sms', 'whatsapp']);

function _conditionGateText(conditions) {
  return (conditions || [])
    .map((c) => [c.type, c.op, c.field, c.event, c.metric, c.source, c.value]
      .filter((v) => v != null && v !== '')
      .join(' '))
    .filter(Boolean)
    .join('\n');
}

function normalizeComposerDraft(raw, source = 'template') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const channel = COMPOSER_CHANNELS.has(src.channel) ? src.channel : 'email';
  const out = {
    campaign_name: _str(src.campaign_name || 'Untitled Campaign', 200),
    audience_description: _str(src.audience_description, 2000),
    audience_rules: sanitiseAudienceRules(src.audience_rules),
    channel,
    subject: _str(src.subject, 500),
    body: _str(src.body, 8000),
    recommended_send_time: _str(src.recommended_send_time, 200),
    rationale: _str(src.rationale, 2000),
    source: source === 'openai' ? 'openai' : 'template',
  };
  if (src._estimated) out._estimated = true;
  return out;
}

function composerDraftGateText(draft) {
  const d = normalizeComposerDraft(draft, draft?.source || 'template');
  return [
    d.campaign_name,
    d.audience_description,
    d.subject,
    d.body,
    d.recommended_send_time,
    d.rationale,
    _conditionGateText(d.audience_rules?.conditions),
  ].filter(Boolean).join('\n');
}

function normalizeRedditReply(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    reply: _str(src.reply, 4000),
    tone_note: _str(src.tone_note, 500),
  };
}

function redditReplyGateText(raw) {
  const n = normalizeRedditReply(raw);
  return [n.reply, n.tone_note].filter(Boolean).join('\n');
}

function normalizeRedditStudioSuggest(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const titles = Array.isArray(src.titles) ? src.titles : [];
  return {
    persona: _str(src.persona, 300),
    titles: titles
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => _str(t, 200).trim())
      .slice(0, 3),
  };
}

function redditStudioGateText(raw) {
  const n = normalizeRedditStudioSuggest(raw);
  return [n.persona, ...n.titles].filter(Boolean).join('\n');
}

function normalizeChannelAd(raw, source) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    headline: _str(src.headline, 200),
    body: _str(src.body, 2000),
    cta: _str(src.cta, 100),
    hashtags: _str(src.hashtags, 300),
  };
  if (src._estimated) out._estimated = true;
  if (source === 'openai' || source === 'template') out.source = source;
  return out;
}

function channelAdGateText(raw, source) {
  const a = normalizeChannelAd(raw, source);
  return [a.headline, a.body, a.cta, a.hashtags].filter(Boolean).join('\n');
}

function normalizeContentCluster(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    pillar: _str(src.pillar, 300),
    topics: _pickStrings(src.topics, 12, 200),
    questions: _pickStrings(src.questions, 12, 300),
    aiNote: _str(src.aiNote || src.ai_note, 1000),
  };
  if (src._dualAI) out._dualAI = true;
  return out;
}

function contentClusterGateText(raw) {
  const c = normalizeContentCluster(raw);
  return JSON.stringify(c);
}

function normalizeColdEmailItem(raw, stepFallback) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    step: _num(src.step, 1, 10, stepFallback) || stepFallback,
    days_after_prev: _num(src.days_after_prev, 0, 30, 0),
    subject: _str(src.subject, 200),
    preview: _str(src.preview, 200),
    body: _str(src.body, 8000),
    cta: _str(src.cta, 500),
    why_this_works: _str(src.why_this_works, 1000),
  };
}

function normalizeColdEmailSequence(raw, source = 'template') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.emails) ? src.emails : [];
  const emails = list
    .slice(0, 5)
    .map((e, i) => normalizeColdEmailItem(e, i + 1))
    .filter((e) => e.body || e.subject);
  return {
    emails,
    source: source === 'openai' ? 'openai' : 'template',
  };
}

function coldEmailGateText(emailsOrRaw) {
  const emails = Array.isArray(emailsOrRaw)
    ? emailsOrRaw
    : normalizeColdEmailSequence(emailsOrRaw).emails;
  return emails
    .flatMap((e) => [e.subject, e.preview, e.body, e.cta, e.why_this_works])
    .filter(Boolean)
    .join('\n');
}

function normalizeReviewReply(raw, source = 'template') {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { reply: _str(src.reply, 4000) };
  if (source === 'openai' || source === 'template') out.source = source;
  if (src._estimated) out._estimated = true;
  return out;
}

function reviewReplyGateText(raw) {
  return normalizeReviewReply(raw).reply;
}

module.exports = {
  normalizeProofreadFeedback,
  proofreadGateText,
  normalizeComposerDraft,
  composerDraftGateText,
  normalizeRedditReply,
  redditReplyGateText,
  normalizeRedditStudioSuggest,
  redditStudioGateText,
  normalizeChannelAd,
  channelAdGateText,
  normalizeContentCluster,
  contentClusterGateText,
  normalizeColdEmailItem,
  normalizeColdEmailSequence,
  coldEmailGateText,
  normalizeReviewReply,
  reviewReplyGateText,
};

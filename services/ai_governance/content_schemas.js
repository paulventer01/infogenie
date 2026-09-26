/**
 * Allowed response shapes for Step 6 gated generation paths.
 * Strips unexpected fields before gate/persist/return.
 */

const { jsonGateText } = require('./json_text');
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
  return jsonGateText(c);
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

function normalizePressRelease(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    headline: _str(src.headline, 200),
    subhead: _str(src.subhead, 400),
    dateline: _str(src.dateline, 200),
    body: _str(src.body, 12000),
    quote: { text: _str(src.quote?.text, 2000), attribution: _str(src.quote?.attribution, 400) },
    boilerplate: _str(src.boilerplate, 3000),
    contact: { name: _str(src.contact?.name, 200), email: _str(src.contact?.email, 320) },
  };
}

function pressReleaseGateText(release) {
  const r = normalizePressRelease(release);
  return [r.headline, r.subhead, r.dateline, r.body, r.quote.text,
    r.quote.attribution, r.boilerplate, r.contact.name, r.contact.email].join('\n');
}

// Ad copy surfaces retain only known fields before their decoded values are scanned.
function adCopyGateText(normalized) {
  const values = [];
  function collect(value) {
    if (value && typeof value === 'object') Object.values(value).forEach(collect);
    else if (value != null) values.push(String(value));
  }
  collect(normalized);
  return values.join('\n');
}

function normalizeAdScore(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const number = (v, max) => !['number', 'string'].includes(typeof v) || String(v).trim() === ''
    ? null : _num(v, 0, max);
  const scores = {};
  for (const key of ['hook_strength', 'cta_clarity', 'urgency', 'emotional_resonance', 'relevance']) {
    scores[key] = number(src.scores?.[key], 10);
  }
  return {
    scores, overall: number(src.overall, 100),
    ctr_range: { low: _str(src.ctr_range?.low, 200), high: _str(src.ctr_range?.high, 200) },
    grade: ['A', 'B', 'C', 'D', 'F'].includes(src.grade) ? src.grade : null,
    verdict: _str(src.verdict, 2000),
    tips: (Array.isArray(src.tips) ? src.tips : []).slice(0, 5).map(t => ({
      dimension: _str(t?.dimension, 100), tip: _str(t?.tip, 1000),
    })),
  };
}

function normalizeUgcScript(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    scenes: (Array.isArray(src.scenes) ? src.scenes : []).slice(0, 12).map(s => ({
      timestamp: _str(s?.timestamp, 100), type: _str(s?.type, 100),
      script: _str(s?.script, 3000), direction: _str(s?.direction, 1000),
      text_overlay: s?.text_overlay == null ? null : _str(s.text_overlay, 1000),
    })),
    caption: _str(src.caption, 4000), hashtags: _pickStrings(src.hashtags, 30, 100),
    creator_tips: _pickStrings(src.creator_tips, 10, 1000),
  };
}

function normalizeAdPackages(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    packages: (Array.isArray(src.packages) ? src.packages : []).slice(0, 3).map(p => ({
      platform: _str(p?.platform, 100), formats: _pickStrings(p?.formats, 6, 100),
      headline: _str(p?.headline, 200), primary_text: _str(p?.primary_text, 2000),
      description: _str(p?.description, 1000), cta_button: _str(p?.cta_button, 100),
      notes: _str(p?.notes, 1000), hook: _str(p?.hook, 1000),
      script_summary: _str(p?.script_summary, 3000), hashtags: _pickStrings(p?.hashtags, 30, 100),
    })),
  };
}

const VIDEO_VIRAL_PATTERNS = new Set([
  'curiosity_gap', 'problem_solution', 'listicle', 'transformation', 'controversy', 'story',
]);

function normalizeVideoScriptItem(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const body = (Array.isArray(src.body) ? src.body : [])
    .slice(0, 12)
    .map((line) => {
      const l = line && typeof line === 'object' ? line : {};
      return {
        line: _str(l.line, 500),
        onscreen_text: _str(l.onscreen_text, 300),
        cue: _str(l.cue, 500),
      };
    })
    .filter((l) => l.line || l.onscreen_text || l.cue);
  const out = {
    hook: _str(src.hook, 500),
    body,
    cta: _str(src.cta, 500),
    estimated_duration_sec: _num(src.estimated_duration_sec, 1, 600, null),
    viral_pattern: VIDEO_VIRAL_PATTERNS.has(src.viral_pattern) ? src.viral_pattern : null,
    hashtags: _pickStrings(src.hashtags, 20, 100),
  };
  if (src._estimated) out._estimated = true;
  return out;
}

function normalizeVideoScriptResult(raw, maxScripts = 5) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.scripts) ? src.scripts : [];
  const scripts = list
    .slice(0, maxScripts)
    .map(normalizeVideoScriptItem)
    .filter((s) => s.hook || s.body.length || s.cta);
  return { scripts };
}

function videoScriptGateText(scriptsOrRaw) {
  const scripts = Array.isArray(scriptsOrRaw)
    ? scriptsOrRaw.map(normalizeVideoScriptItem)
    : normalizeVideoScriptResult(scriptsOrRaw).scripts;
  return scripts.flatMap((s) => [
    s.hook,
    ...s.body.map((b) => [b.line, b.onscreen_text, b.cue].filter(Boolean).join('\t')),
    s.cta,
    s.viral_pattern || '',
    ...s.hashtags,
  ].filter(Boolean)).join('\n');
}

function normalizeCarouselSlideItem(raw, indexFallback = 1, roleFallback = '') {
  const src = raw && typeof raw === 'object' ? raw : {};
  let n = _num(src.n, 1, 10, indexFallback) || indexFallback;
  return {
    n,
    role: _str(src.role || roleFallback, 40),
    headline: _str(src.headline, 140),
    body: _str(src.body, 400),
    visualHint: _str(src.visualHint, 200),
  };
}

function normalizeCarouselSlides(slidesOrRaw, structureKey = 'pure-info') {
  const list = Array.isArray(slidesOrRaw) ? slidesOrRaw : [];
  const roles = {
    'pure-info': ['Hook', 'Context', 'Value', 'Value', 'Value', 'Value', 'Value', 'Recap', 'Climax', 'CTA'],
    storytelling: ['Hook', 'Setup', 'Journey', 'Journey', 'Turning Point', 'Turning Point', 'Turning Point', 'Lesson', 'Lesson', 'CTA'],
    'problem-solution': ['Hook', 'Problem', 'Why It Happens', 'Why It Happens', 'Solution', 'Solution', 'Solution', 'Outcome', 'Outcome', 'CTA'],
    listicle: ['Hook', 'Context', 'List Item', 'List Item', 'List Item', 'List Item', 'List Item', 'List Item', 'Bonus / Recap', 'CTA'],
  };
  const fallbackRoles = roles[structureKey] || roles['pure-info'];
  return list
    .slice(0, 10)
    .map((slide, i) => normalizeCarouselSlideItem(slide, i + 1, fallbackRoles[i] || ''))
    .filter((s) => s.role || s.headline || s.body || s.visualHint);
}

function carouselGateText(slidesOrRaw, structureKey) {
  const slides = Array.isArray(slidesOrRaw)
    ? slidesOrRaw.map((s, i) => normalizeCarouselSlideItem(s, i + 1))
    : normalizeCarouselSlides(slidesOrRaw, structureKey);
  return slides
    .map((s) => [s.role, s.headline, s.body, s.visualHint].filter(Boolean).join('\t'))
    .filter(Boolean)
    .join('\n');
}

function _rawStr(v) {
  return v == null ? '' : String(v);
}

function _collectMediaAltText(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const alts = [];
  if (m.alt_text) alts.push(_rawStr(m.alt_text));
  if (m.media_alt) alts.push(_rawStr(m.media_alt));
  if (Array.isArray(m.media_alts)) {
    for (const item of m.media_alts) {
      if (typeof item === 'string') alts.push(_rawStr(item));
      else if (item && typeof item === 'object' && item.alt) alts.push(_rawStr(item.alt));
    }
  }
  return alts.filter(Boolean);
}

function normalizeSocialDraft(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const meta = src.meta && typeof src.meta === 'object' ? src.meta : {};
  return {
    text: _rawStr(src.text),
    media_alts: _collectMediaAltText(meta),
  };
}

function socialDraftGateText(draft) {
  const n = normalizeSocialDraft(draft);
  return [n.text, ...n.media_alts].filter((part) => part != null && part !== '').join('\n');
}

function socialDraftScanSizeError(draft, maxChars) {
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const length = socialDraftGateText(draft).length;
  if (length <= limit) return null;
  return {
    ok: false,
    error: 'content_too_long',
    userMessage: 'Draft text exceeds supported content safety scan limits.',
    warnings: [],
    length,
    max: limit,
  };
}

function _publisherCaptionParts(src) {
  const parts = [];
  const seen = new Set();
  const push = (value) => {
    const s = _rawStr(value);
    if (!s || seen.has(s)) return;
    seen.add(s);
    parts.push(s);
  };
  push(src.text);
  push(src.caption);
  push(src.copy);
  const captions = src.captions;
  if (Array.isArray(captions)) {
    for (const item of captions) push(item);
  } else if (captions && typeof captions === 'object') {
    for (const item of Object.values(captions)) push(item);
  }
  return parts;
}

function normalizeSocialPublisherPost(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const meta = src.meta && typeof src.meta === 'object' ? src.meta : {};
  return {
    text: _publisherCaptionParts(src).join('\n'),
    media_alts: _collectMediaAltText({
      alt_text: src.alt_text || src.altText || meta.alt_text,
      media_alt: src.media_alt || src.mediaAlt || meta.media_alt,
      media_alts: src.media_alts || src.mediaAlts || meta.media_alts,
    }),
  };
}

function socialPublisherGateText(body) {
  const n = normalizeSocialPublisherPost(body);
  return [n.text, ...n.media_alts].filter((part) => part != null && part !== '').join('\n');
}

function socialPublisherScanSizeError(body, maxChars) {
  const limit = Number(maxChars);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const length = socialPublisherGateText(body).length;
  if (length <= limit) return null;
  return {
    ok: false,
    error: 'content_too_long',
    userMessage: 'Post text exceeds supported content safety scan limits.',
    warnings: [],
    length,
    max: limit,
  };
}

module.exports = {
  adCopyGateText,
  normalizeAdScore,
  normalizeUgcScript,
  normalizeAdPackages,
  normalizePressRelease,
  pressReleaseGateText,
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
  normalizeVideoScriptItem,
  normalizeVideoScriptResult,
  videoScriptGateText,
  normalizeCarouselSlideItem,
  normalizeCarouselSlides,
  carouselGateText,
  normalizeSocialDraft,
  socialDraftGateText,
  socialDraftScanSizeError,
  normalizeSocialPublisherPost,
  socialPublisherGateText,
  socialPublisherScanSizeError,
};

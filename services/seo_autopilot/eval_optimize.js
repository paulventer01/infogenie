'use strict';

/**
 * SEO article Evaluator–Optimizer — reuse shared generate→critique→revise loop.
 */
const { runEvaluatorOptimizer } = require('../ai/evaluator_optimizer');

const CRITICAL_PATTERNS = [
  { id: 'guaranteed_results', re: /\b(guaranteed? (results?|rankings?|traffic)|risk[- ]free|100%\s*(guaranteed|safe))\b/i, severity: 'critical', fix: 'Remove absolute SEO/traffic guarantees.' },
  { id: 'get_rich_quick', re: /\b(get rich quick|make \$\d+k?\s*(per|a)\s*(day|week))\b/i, severity: 'critical', fix: 'Remove get-rich claims.' },
];

function evaluateSeoArticle(html, { keyword, minWords = 500 } = {}) {
  const raw = String(html || '');
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(/\s+/).length : 0;
  const flags = [];
  const kw = String(keyword || '').trim().toLowerCase();

  for (const p of CRITICAL_PATTERNS) {
    const m = raw.match(p.re);
    if (m) flags.push({ rule: p.id, severity: p.severity, quote: m[0], fix: p.fix });
  }

  if (words < Math.min(200, minWords)) {
    flags.push({ rule: 'too_thin', severity: 'critical', issue: `${words} words`, fix: `Expand to at least ${minWords} words with useful sections.` });
  } else if (words < minWords) {
    flags.push({ rule: 'below_target_length', severity: 'warning', issue: `${words} words`, fix: `Aim for ~${minWords}+ words.` });
  }

  if (!/<h1[\s>]/i.test(raw)) {
    flags.push({ rule: 'missing_h1', severity: 'warning', fix: 'Add a single H1 title.' });
  }
  if (!/<h2[\s>]/i.test(raw)) {
    flags.push({ rule: 'missing_h2', severity: 'warning', fix: 'Add H2 sections for structure (and AEO scannability).' });
  }
  if (kw && !text.toLowerCase().includes(kw)) {
    flags.push({ rule: 'keyword_missing', severity: 'warning', fix: `Include primary keyword “${keyword}” naturally in intro and an H2.` });
  }
  if (!/\bFAQ\b|frequently asked/i.test(raw)) {
    flags.push({ rule: 'missing_faq', severity: 'warning', fix: 'Add a short FAQ block for answer-engine citations.' });
  }

  const critical = flags.filter((f) => f.severity === 'critical').length;
  const warning = flags.filter((f) => f.severity === 'warning').length;
  let verdict = 'pass';
  if (critical) verdict = 'fail';
  else if (warning >= 3) verdict = 'fail';
  else if (warning) verdict = 'caution';

  const score = Math.max(0, 100 - critical * 35 - warning * 12);
  return {
    verdict,
    score,
    flags,
    source: 'seo_heuristic',
    meta: { words, keyword: keyword || null },
  };
}

async function _aiOptimizeArticle(html, evaluation, { tenantId, escalate, keyword, title } = {}) {
  try {
    const { chatForCategory } = require('../ai/chat_router');
    const issues = (evaluation?.flags || []).map((f) => `- ${f.rule}: ${f.fix || f.issue || ''}`).join('\n');
    const r = await chatForCategory(
      'writing',
      [
        {
          role: 'system',
          content:
            'You revise SEO/GEO HTML articles. Keep clean HTML (h1,h2,p,ul,li,strong). Fix the listed issues. Preserve factual tone. Return ONLY HTML — no markdown fences.',
        },
        {
          role: 'user',
          content: `Title: ${title || ''}\nKeyword: ${keyword || ''}\nIssues:\n${issues || '(polish for clarity + FAQ)'}\n\nArticle HTML:\n${String(html).slice(0, 12000)}`,
        },
      ],
      {
        tenantId,
        surface: 'seo_article_eval',
        tier: escalate ? 'strong' : 'fast',
        escalate: escalate ? false : { minChars: 400 },
        max_tokens: escalate ? 3500 : 2800,
        temperature: 0.4,
      },
    );
    let out = String(r?.content || '').replace(/^```html\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    if (out.length < 200) return null;
    return out;
  } catch {
    return null;
  }
}

/** Deterministic polish when AI unavailable — enough to clear common heuristic fails. */
function _heuristicOptimize(html, evaluation, { keyword, title } = {}) {
  let out = String(html || '');
  const flags = new Set((evaluation?.flags || []).map((f) => f.rule));
  if (flags.has('missing_h1') && !/<h1[\s>]/i.test(out)) {
    out = `<h1>${title || keyword || 'Guide'}</h1>\n` + out;
  }
  if (flags.has('missing_h2') && !/<h2[\s>]/i.test(out)) {
    out += `\n<h2>How to approach ${keyword || 'this topic'}</h2>\n<p>Start with one clear outcome, publish consistently, and measure what earns clicks.</p>`;
  }
  if (flags.has('keyword_missing') && keyword && !out.toLowerCase().includes(String(keyword).toLowerCase())) {
    out = out.replace(/<\/h1>/i, `</h1>\n<p>This guide covers <strong>${keyword}</strong> with practical steps you can ship this month.</p>`);
  }
  if (flags.has('missing_faq') && !/\bFAQ\b/i.test(out)) {
    out += `\n<h2>FAQ</h2>\n<p><strong>What is the first step?</strong> Define the outcome and one primary keyword cluster.</p>\n<p><strong>How long until results?</strong> Many teams see early impressions in 2–4 weeks with consistent publishing.</p>`;
  }
  if (flags.has('too_thin') || flags.has('below_target_length')) {
    out += `\n<h2>Practical checklist</h2>\n<ul><li>Clarify audience intent</li><li>Cover the primary question in the first screen</li><li>Add examples and FAQs</li><li>Link related internal guides</li><li>Update from real performance data</li></ul>`;
  }
  for (const p of CRITICAL_PATTERNS) {
    out = out.replace(p.re, 'proven approaches (results vary)');
  }
  return out;
}

async function optimizeSeoArticle(tenantId, html, { keyword, title, maxAttempts = 3 } = {}) {
  const result = await runEvaluatorOptimizer({
    tenantId,
    content: html,
    maxAttempts,
    evaluate: (content) => evaluateSeoArticle(content, { keyword, minWords: 500 }),
    optimize: async (content, evaluation, ctx) => {
      const ai = await _aiOptimizeArticle(content, evaluation, {
        tenantId,
        escalate: ctx.escalate,
        keyword,
        title,
      });
      if (ai) return ai;
      return _heuristicOptimize(content, evaluation, { keyword, title });
    },
    shouldEscalate: (evaluation, attemptIndex) => evaluation?.verdict === 'fail' && attemptIndex >= 1,
  });

  const words = String(result.content || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return {
    ok: result.ok,
    passed: result.passed,
    content: result.content,
    wordCount: words,
    attempts: result.attempts,
    final_verdict: result.final_verdict,
    needs_human: result.needs_human || false,
    rewrite_failed: result.rewrite_failed || false,
    cascade: result.cascade,
  };
}

module.exports = {
  evaluateSeoArticle,
  optimizeSeoArticle,
  _heuristicOptimize,
  CRITICAL_PATTERNS,
};

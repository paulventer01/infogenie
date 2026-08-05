/**
 * Self-heal loop for social drafts — verify → fix → re-verify before approval.
 * Built on shared Evaluator–Optimizer (`services/ai/evaluator_optimizer`).
 *
 * Fail-open on AI outages: heuristic scan still runs; if AI rewrite unavailable,
 * returns caution with original text so humans can still review.
 */
const { runEvaluatorOptimizer } = require('../ai/evaluator_optimizer');

const MAX_ATTEMPTS = 3;

const CRITICAL_PATTERNS = [
  { id: 'guaranteed_results', re: /\b(guaranteed? (results?|income|roi|returns?)|risk[- ]free|100%\s*(safe|guaranteed))\b/i, severity: 'critical', fix: 'Remove absolute guarantees; add “results may vary”.' },
  { id: 'get_rich_quick', re: /\b(get rich quick|make \$\d+k?\s*(per|a)\s*(day|week)|passive income overnight)\b/i, severity: 'critical', fix: 'Tone down income claims; use specific, evidenced outcomes.' },
  { id: 'medical_cure', re: /\b(cures?|miracle (drug|treatment)|fda[- ]approved claim)\b/i, severity: 'critical', fix: 'Avoid medical cure claims without substantiation.' },
];

const WARNING_PATTERNS = [
  { id: 'all_caps_spam', re: /\b[A-Z]{8,}\b/, severity: 'warning', fix: 'Reduce ALL-CAPS shouting.' },
  { id: 'fake_urgency', re: /\b(only \d+ left|act now or lose|last chance ever)\b/i, severity: 'warning', fix: 'Soften urgency or make scarcity verifiable.' },
  { id: 'competitor_bash', re: /\b(unlike (our )?(competitors?|others) who (scam|lie|fail))\b/i, severity: 'warning', fix: 'Remove competitor attacks; focus on your proof.' },
];

function _heuristicScan(text) {
  const flags = [];
  const raw = String(text || '');
  for (const p of CRITICAL_PATTERNS) {
    const m = raw.match(p.re);
    if (m) flags.push({ rule: p.id, severity: p.severity, quote: m[0], issue: p.id, fix: p.fix });
  }
  for (const p of WARNING_PATTERNS) {
    const m = raw.match(p.re);
    if (m) flags.push({ rule: p.id, severity: p.severity, quote: m[0], issue: p.id, fix: p.fix });
  }
  const critical = flags.filter((f) => f.severity === 'critical').length;
  const warning = flags.filter((f) => f.severity === 'warning').length;
  let verdict = 'pass';
  if (critical) verdict = 'fail';
  else if (warning) verdict = 'caution';
  return {
    overall_verdict: verdict,
    risk_score: critical ? 80 : warning ? 40 : 5,
    flags,
    source: 'heuristic',
  };
}

async function _aiRewrite(tenantId, text, flags, { escalate = false } = {}) {
  try {
    const { chatForCategory } = require('../ai/chat_router');
    const issues = (flags || []).map((f) => `- ${f.rule}: ${f.fix || f.issue}`).join('\n');
    const r = await chatForCategory(
      'writing',
      [
        {
          role: 'system',
          content:
            'You rewrite social media captions to pass brand-safety and tone checks. Keep the core message and CTA. Return ONLY the rewritten caption text — no JSON, no preamble.',
        },
        {
          role: 'user',
          content: `Fix these issues:\n${issues || '(general polish)'}\n\nOriginal caption:\n"""${String(text).slice(0, 2500)}"""`,
        },
      ],
      {
        tenantId,
        surface: 'social_self_heal',
        tier: escalate ? 'strong' : 'fast',
        escalate: escalate ? false : { minChars: 12 },
        max_tokens: escalate ? 700 : 400,
        temperature: 0.4,
        useAutoclaw: escalate ? true : false,
      },
    );
    const out = String(r?.content || '').trim();
    if (!out || out.length < 10) return null;
    return {
      text: out.replace(/^["']|["']$/g, ''),
      cascade_tier: r?.cascade_tier || (escalate ? 'strong' : 'fast'),
      escalated_from: r?.escalated_from || null,
      model: r?.model || null,
    };
  } catch (_) {
    return null;
  }
}

async function _voiceSoftCheck(tenantId, text) {
  try {
    const { getBrandContextBlock } = require('../brand_foundation/api');
    const brand = await getBrandContextBlock(tenantId);
    if (!brand) return { ok: true, score: 100 };
    const bannedLine = brand.split('\n').find((l) => /BANNED WORDS:/i.test(l));
    if (!bannedLine) return { ok: true, score: 90 };
    const words = bannedLine.replace(/.*BANNED WORDS:/i, '').split(/[,;]/).map((w) => w.trim()).filter(Boolean);
    const hits = words.filter((w) => w.length > 2 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
    if (!hits.length) return { ok: true, score: 90 };
    return {
      ok: false,
      score: 40,
      flags: hits.map((w) => ({
        rule: 'banned_word',
        severity: 'warning',
        quote: w,
        issue: `Banned word "${w}"`,
        fix: `Remove or replace "${w}"`,
      })),
    };
  } catch (_) {
    return { ok: true, score: 100 };
  }
}

/**
 * Run verify→fix loop on draft text.
 * @returns {{ ok:boolean, text:string, attempts:array, passed:boolean, final_verdict:string }}
 */
async function selfHealDraft(tenantId, text, opts = {}) {
  const maxAttempts = Math.min(MAX_ATTEMPTS, Math.max(1, Number(opts.maxAttempts) || MAX_ATTEMPTS));

  const result = await runEvaluatorOptimizer({
    tenantId,
    content: String(text || ''),
    maxAttempts,
    evaluate: async (current) => {
      const scan = _heuristicScan(current);
      const voice = await _voiceSoftCheck(tenantId, current);
      const flags = [...(scan.flags || []), ...(voice.flags || [])];
      let verdict = scan.overall_verdict;
      if (!voice.ok && verdict === 'pass') verdict = 'caution';
      if (!voice.ok && flags.some((f) => f.severity === 'critical')) verdict = 'fail';
      return {
        verdict,
        score: 100 - (scan.risk_score || 0),
        flags,
        source: scan.source,
        meta: { risk_score: scan.risk_score },
      };
    },
    optimize: async (current, evaluation, ctx) => {
      const rewritten = await _aiRewrite(tenantId, current, evaluation.flags, { escalate: ctx.escalate });
      return rewritten?.text || null;
    },
    shouldEscalate: (evaluation, attemptIndex) => evaluation?.verdict === 'fail' && attemptIndex >= 1,
  });

  // Preserve prior response shape for social drafts API + tests
  return {
    ok: result.ok,
    passed: result.passed,
    text: result.content,
    attempts: (result.attempts || []).map((a) => ({
      attempt: a.attempt,
      verdict: a.verdict,
      risk_score: a.meta?.risk_score ?? (a.verdict === 'fail' ? 80 : a.verdict === 'caution' ? 40 : 5),
      flags: a.flags,
      text_preview: a.text_preview,
      cascade_tier: a.cascade_tier,
    })),
    final_verdict: result.final_verdict,
    needs_human: result.needs_human,
    rewrite_failed: result.rewrite_failed,
    cascade: result.cascade,
  };
}

module.exports = { selfHealDraft, _heuristicScan };

/**
 * Self-heal loop for social drafts — verify → fix → re-verify before approval.
 * Loop-engineering pattern: like "tests fail → fix → merge" for social copy.
 *
 * Fail-open on AI outages: heuristic scan still runs; if AI rewrite unavailable,
 * returns caution with original text so humans can still review.
 */
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

async function _aiRewrite(tenantId, text, flags) {
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
        max_tokens: 500,
        temperature: 0.4,
        useAutoclaw: false,
      },
    );
    const out = String(r?.content || '').trim();
    if (!out || out.length < 10) return null;
    return out.replace(/^["']|["']$/g, '');
  } catch (_) {
    return null;
  }
}

async function _voiceSoftCheck(tenantId, text) {
  try {
    const { getBrandContextBlock } = require('../brand_foundation/api');
    const brand = await getBrandContextBlock(tenantId);
    if (!brand) return { ok: true, score: 100 };
    // Lightweight banned-word hit from brand block line
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
  let current = String(text || '');
  const attempts = [];

  for (let i = 0; i < maxAttempts; i++) {
    const scan = _heuristicScan(current);
    const voice = await _voiceSoftCheck(tenantId, current);
    const flags = [...(scan.flags || []), ...(voice.flags || [])];
    let verdict = scan.overall_verdict;
    if (!voice.ok && verdict === 'pass') verdict = 'caution';
    if (!voice.ok && flags.some((f) => f.severity === 'critical')) verdict = 'fail';

    attempts.push({
      attempt: i + 1,
      verdict,
      risk_score: scan.risk_score,
      flags,
      text_preview: current.slice(0, 160),
    });

    if (verdict === 'pass') {
      return { ok: true, passed: true, text: current, attempts, final_verdict: 'pass' };
    }

    // Last attempt — return best effort
    if (i === maxAttempts - 1) {
      return {
        ok: true,
        passed: false,
        text: current,
        attempts,
        final_verdict: verdict,
        needs_human: true,
      };
    }

    const rewritten = await _aiRewrite(tenantId, current, flags);
    if (!rewritten || rewritten === current) {
      // Can't improve further
      return {
        ok: true,
        passed: false,
        text: current,
        attempts,
        final_verdict: verdict,
        needs_human: true,
        rewrite_failed: true,
      };
    }
    current = rewritten;
  }

  return { ok: true, passed: false, text: current, attempts, final_verdict: 'caution', needs_human: true };
}

module.exports = { selfHealDraft, _heuristicScan };

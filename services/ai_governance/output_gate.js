/**
 * Content output gate — PR10H.1 real brand/compliance + PII checks.
 * Deterministic only (no LLM). Verdicts: pass | caution | block | unavailable.
 */

const { scanPii, scanCompliance } = require('./brand_rules');

const USER_MESSAGES = Object.freeze({
  blocked: 'Generated content did not pass brand and compliance checks. Revise the prompt or request human review.',
  unavailable: 'Content safety checks are temporarily unavailable. Generation was stopped to protect your brand.',
  caution: 'Content includes claims or patterns that need review before external publish.',
});

function _aggregateVerdict(checks) {
  if (!checks.length) return 'pass';
  if (checks.some((c) => c.verdict === 'block')) return 'block';
  if (checks.some((c) => c.verdict === 'caution')) return 'caution';
  return 'pass';
}

/**
 * @param {object} payload
 * @param {object} [opts]
 * @param {boolean} [opts.forceBrandSafetyBlock] — test hook only
 * @param {boolean} [opts.forceUnavailable] — test hook only
 */
function scanOutput(payload, opts = {}) {
  if (opts.forceUnavailable) {
    return {
      verdict: 'unavailable',
      warnings: [USER_MESSAGES.unavailable],
      checks: [{
        check_type: 'gate_health',
        verdict: 'unavailable',
        risk_score: 100,
        detail: { reason: USER_MESSAGES.unavailable },
      }],
      userMessage: USER_MESSAGES.unavailable,
      enforcedSurfaces: ['content_generation'],
    };
  }

  const warnings = [];
  const checks = [];
  const text = String(
    payload?.draft
    || payload?.text
    || payload?.content
    || payload?.preview
    || payload?.title
    || '',
  ).slice(0, 8000);

  if (!text.trim()) {
    return {
      verdict: 'pass',
      warnings: [],
      checks: [],
      userMessage: null,
      enforcedSurfaces: ['content_generation'],
    };
  }

  // Uncited metrics / ROAS claims
  if (/\b\d+(\.\d+)?%\b/.test(text) || /\bROAS\b/i.test(text)) {
    const check = {
      check_type: 'claim_citation',
      verdict: 'caution',
      risk_score: 20,
      detail: { reason: 'Uncited metric or percentage detected — verify before external publish' },
    };
    checks.push(check);
    warnings.push(check.detail.reason);
  }

  checks.push(...scanPii(text));
  checks.push(...scanCompliance(text));

  // Test-only simulated block (never used in production payloads)
  if (opts.forceBrandSafetyBlock || payload?.__force_brand_safety_block) {
    checks.push({
      check_type: 'brand_safety',
      verdict: 'block',
      risk_score: 90,
      detail: { reason: 'Brand safety block verdict (test hook)' },
    });
  }

  for (const c of checks) {
    if (c.detail?.reason && !warnings.includes(c.detail.reason)) {
      warnings.push(c.detail.reason);
    }
  }

  const verdict = _aggregateVerdict(checks);
  let userMessage = null;
  if (verdict === 'block') userMessage = USER_MESSAGES.blocked;
  else if (verdict === 'caution') userMessage = USER_MESSAGES.caution;

  return {
    verdict,
    warnings,
    checks,
    userMessage,
    enforcedSurfaces: ['content_generation'],
  };
}

module.exports = { scanOutput, USER_MESSAGES };

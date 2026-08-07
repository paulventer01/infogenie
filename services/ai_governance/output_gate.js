/**
 * Phase A output gate — warn-first, never hard-blocks by itself.
 * Full PII/brand pipeline lands in Phase D; here we do a light scan only.
 */

function scanOutput(payload, opts = {}) {
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

  // Lightweight claim / number cue (warn only)
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

  // Simulated brand-safety block verdict for tests — never stops in shadow
  if (opts.forceBrandSafetyBlock || payload?.__force_brand_safety_block) {
    const check = {
      check_type: 'brand_safety',
      verdict: 'block',
      risk_score: 90,
      detail: { reason: 'Brand safety block verdict (simulated)' },
    };
    checks.push(check);
    warnings.push(check.detail.reason);
  }

  const hasBlock = checks.some((c) => c.verdict === 'block');
  const hasCaution = checks.some((c) => c.verdict === 'caution');
  return {
    verdict: hasBlock ? 'block' : hasCaution ? 'caution' : 'pass',
    warnings,
    checks,
  };
}

module.exports = { scanOutput };

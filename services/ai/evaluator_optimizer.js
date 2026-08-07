'use strict';

/**
 * Shared Evaluator–Optimizer loop (generate → critique → revise).
 *
 * Used by social self-heal and SEO article quality. Fail-open: if optimize
 * cannot rewrite, returns best-effort content with needs_human.
 *
 * evaluate(content, ctx) → { verdict: 'pass'|'caution'|'fail', flags?, score?, ... }
 * optimize(content, evaluation, ctx) → Promise<string|null>
 */

async function runEvaluatorOptimizer({
  content,
  evaluate,
  optimize,
  maxAttempts = 3,
  tenantId = null,
  shouldEscalate = null,
} = {}) {
  if (typeof evaluate !== 'function') throw new Error('evaluate required');
  if (typeof optimize !== 'function') throw new Error('optimize required');

  const attemptsCap = Math.min(5, Math.max(1, Number(maxAttempts) || 3));
  let current = String(content ?? '');
  const attempts = [];
  let usedEscalate = false;

  for (let i = 0; i < attemptsCap; i++) {
    const evaluation = await evaluate(current, { attempt: i + 1, tenantId });
    const verdict = evaluation?.verdict || 'caution';
    attempts.push({
      attempt: i + 1,
      verdict,
      score: evaluation?.score,
      flags: evaluation?.flags || [],
      source: evaluation?.source || null,
      text_preview: current.slice(0, 160),
      meta: evaluation?.meta || undefined,
    });

    if (verdict === 'pass') {
      return {
        ok: true,
        passed: true,
        content: current,
        attempts,
        final_verdict: 'pass',
        cascade: { used_escalate: usedEscalate },
      };
    }

    if (i === attemptsCap - 1) {
      return {
        ok: true,
        passed: false,
        content: current,
        attempts,
        final_verdict: verdict,
        needs_human: true,
        cascade: { used_escalate: usedEscalate },
      };
    }

    const escalate = typeof shouldEscalate === 'function'
      ? !!shouldEscalate(evaluation, i)
      : (verdict === 'fail' && i >= 1);
    if (escalate) usedEscalate = true;

    let next = await optimize(current, evaluation, { attempt: i + 1, escalate, tenantId });
    next = next != null ? String(next).trim() : null;

    if (!next || next === current) {
      if (!escalate && verdict === 'fail') {
        usedEscalate = true;
        const strong = await optimize(current, evaluation, { attempt: i + 1, escalate: true, tenantId });
        const strongText = strong != null ? String(strong).trim() : null;
        if (strongText && strongText !== current) {
          attempts[attempts.length - 1].cascade_tier = 'strong';
          current = strongText;
          continue;
        }
      }
      return {
        ok: true,
        passed: false,
        content: current,
        attempts,
        final_verdict: verdict,
        needs_human: true,
        rewrite_failed: true,
        cascade: { used_escalate: usedEscalate },
      };
    }

    attempts[attempts.length - 1].cascade_tier = escalate ? 'strong' : 'fast';
    current = next;
  }

  return {
    ok: true,
    passed: false,
    content: current,
    attempts,
    final_verdict: 'caution',
    needs_human: true,
    cascade: { used_escalate: usedEscalate },
  };
}

module.exports = { runEvaluatorOptimizer };

/**
 * Thin adapters for calling govern() from existing surfaces.
 * Always fail-open — callers should proceed unless they honor enforce + !proceeded.
 */

async function governSafe(opts) {
  try {
    const { govern } = require('./orchestrator');
    return await govern(opts);
  } catch (e) {
    console.warn('[ai-governance] hook failed open:', e.message || e);
    return {
      allowed: true,
      proceeded: true,
      warnings: ['governance_degraded'],
      executionTier: 'auto',
      status: 'governance_degraded',
      auditId: null,
      mode: 'shadow',
      degraded: true,
      softCue: false,
      contextPack: null,
      outputChecks: { verdict: 'pass', warnings: [], checks: [] },
    };
  }
}

module.exports = { governSafe };

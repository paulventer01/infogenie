/**
 * Governance hooks — PR10H.1 content paths fail closed; spine/safe-agent audit stays fail-open.
 */

const { isContentGeneration } = require('./brand_rules');
const outputGate = require('./output_gate');

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
      contentSafetyMode: 'enforce',
      degraded: true,
      softCue: false,
      contextPack: null,
      outputChecks: { verdict: 'pass', warnings: [], checks: [] },
    };
  }
}

/** Content generation — enforce by default; gate/orchestrator errors fail closed. */
async function governContent(opts = {}) {
  const { govern } = require('./orchestrator');
  const surface = String(opts.surface || 'content_ai');
  const action = String(opts.action || 'generate_content');
  return govern({
    ...opts,
    surface,
    action,
    failClosed: true,
  });
}

/**
 * Scan + govern generated text. Returns { ok, content?, governance, error? }.
 * Blocked or unavailable content is never returned as usable output.
 */
async function gateGeneratedContent(opts = {}) {
  const text = String(opts.text || opts.content || '').trim();
  if (!text) {
    return { ok: true, content: text, governance: null, warnings: [] };
  }

  const gate = outputGate.scanOutput({ text, draft: text, content: text }, opts.gateOpts || {});
  const governance = await governContent({
    tenantId: opts.tenantId ?? null,
    userId: opts.userId ?? null,
    surface: opts.surface || 'content_ai',
    action: opts.action || 'generate_content',
    payload: {
      text,
      draft: text,
      content: text,
      preview: text.slice(0, 280),
      hasContext: !!opts.hasContext,
      contextPack: opts.contextPack || null,
    },
    outputChecks: gate,
  });

  if (!governance.proceeded) {
    return {
      ok: false,
      error: governance.blockReason || 'content_safety_blocked',
      userMessage: governance.userMessage || outputGate.USER_MESSAGES.blocked,
      governance,
      warnings: governance.warnings || [],
    };
  }

  return {
    ok: true,
    content: text,
    governance,
    warnings: governance.warnings || [],
    content_safety_warnings: governance.content_safety_warnings || governance.warnings || [],
  };
}

module.exports = {
  governSafe,
  governContent,
  gateGeneratedContent,
  isContentGeneration,
};

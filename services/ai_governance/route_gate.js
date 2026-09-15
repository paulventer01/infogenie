/**
 * HTTP route helpers for PR10H content-safety enforcement.
 * Gates generated text before it is returned, persisted, or queued.
 */

const { gateGeneratedContent } = require('./hooks');
const { USER_MESSAGES } = require('./output_gate');

const CONTENT_SAFETY_CODES = new Set(['content_safety_blocked', 'content_safety_unavailable']);

function isContentSafetyError(err) {
  if (!err) return false;
  if (CONTENT_SAFETY_CODES.has(err.code)) return true;
  return CONTENT_SAFETY_CODES.has(err.error);
}

/**
 * Gate generated text for an HTTP handler.
 * @returns {Promise<{ok:boolean, warnings?:string[], userMessage?:string, error?:string}>}
 */
async function gateRouteText(opts = {}) {
  const text = String(opts.text || opts.content || '').trim();
  if (!text) return { ok: true, warnings: [], content: text };

  const gated = await gateGeneratedContent({
    tenantId: opts.tenantId ?? null,
    userId: opts.userId ?? null,
    surface: opts.surface || 'ai_content',
    action: opts.action || 'generate_content',
    text,
    hasContext: !!opts.hasContext,
    contextPack: opts.contextPack || null,
    gateOpts: opts.gateOpts || null,
  });

  if (!gated.ok) {
    return {
      ok: false,
      error: gated.error || 'content_safety_blocked',
      userMessage: gated.userMessage || USER_MESSAGES.blocked,
      warnings: gated.warnings || [],
      governance: gated.governance || null,
    };
  }

  return {
    ok: true,
    content: gated.content,
    warnings: gated.warnings || [],
    content_safety_warnings: gated.content_safety_warnings || gated.warnings || [],
  };
}

function contentSafetyHttpBody(gated) {
  return {
    ok: false,
    error: gated.error || 'content_safety_blocked',
    userMessage: gated.userMessage || USER_MESSAGES.blocked,
    content_safety_warnings: gated.warnings || [],
  };
}

function attachContentSafetyWarnings(payload, warnings) {
  if (!warnings?.length) return payload;
  return { ...payload, content_safety_warnings: warnings };
}

module.exports = {
  gateRouteText,
  isContentSafetyError,
  contentSafetyHttpBody,
  attachContentSafetyWarnings,
  CONTENT_SAFETY_CODES,
};

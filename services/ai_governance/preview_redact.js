/**
 * Redact sensitive generated content before audit persistence and API exposure.
 */

const { PII_PATTERNS } = require('./brand_rules');

const REDACTED = '[redacted]';

function redactSensitiveText(text, maxLen = 280) {
  let out = String(text || '');
  for (const cfg of Object.values(PII_PATTERNS)) {
    out = out.replace(cfg.pattern, REDACTED);
    cfg.pattern.lastIndex = 0;
  }
  if (maxLen > 0 && out.length > maxLen) out = out.slice(0, maxLen);
  return out;
}

function buildSafePreview(payload, maxLen = 280) {
  const raw = String(
    payload?.preview || payload?.title || payload?.draft || payload?.text || '',
  );
  if (!raw.trim()) return null;
  return redactSensitiveText(raw, maxLen);
}

function sanitizeCheckDetail(detail) {
  if (!detail || typeof detail !== 'object') return detail || {};
  const next = { ...detail };
  if (typeof next.sample === 'string') next.sample = redactSensitiveText(next.sample, 120);
  if (typeof next.matched_text === 'string') next.matched_text = REDACTED;
  return next;
}

module.exports = {
  REDACTED,
  redactSensitiveText,
  buildSafePreview,
  sanitizeCheckDetail,
};

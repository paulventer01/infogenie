/**
 * Deterministic brand/compliance rules for the content output gate (PR10H.1).
 * Mirrors themes from services/brand_safety/api.js RULE_SETS without LLM calls.
 */

const PII_PATTERNS = Object.freeze({
  ssn: { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'US Social Security number' },
  credit_card: { pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, label: 'Credit card number' },
  passport: { pattern: /\b[A-Z]{1,2}\d{6,9}\b/g, label: 'Passport-style identifier' },
});

/** High-confidence compliance phrases — block under enforce mode */
const COMPLIANCE_PATTERNS = Object.freeze([
  {
    id: 'guaranteed_returns',
    jurisdiction: 'FCA/FTC',
    pattern: /\b(guaranteed|100%|risk[- ]free)\s+(returns?|profit|roi|gains?)\b/i,
    message: 'Guaranteed or risk-free return claims are prohibited in regulated advertising',
    verdict: 'block',
    risk_score: 90,
  },
  {
    id: 'medical_guarantee',
    jurisdiction: 'FTC/HIPAA',
    pattern: /\b(cure[sd]?|guaranteed to (heal|fix|treat)|miracle (cure|treatment))\b/i,
    message: 'Unsubstantiated medical outcome or cure claims require evidence and disclaimers',
    verdict: 'block',
    risk_score: 85,
  },
  {
    id: 'misleading_urgency',
    jurisdiction: 'ASA/GDPR',
    pattern: /\b(act now|limited time only|expires tonight)\b.*\b(free|discount|offer)\b/i,
    message: 'High-pressure urgency combined with promotional claims may violate fair advertising rules',
    verdict: 'caution',
    risk_score: 35,
  },
  {
    id: 'unsubstantiated_superlative',
    jurisdiction: 'FTC',
    pattern: /\b(#1|number one|best in (the )?world|fastest growing)\b/i,
    message: 'Superlative claims must be substantiated before external publish',
    verdict: 'caution',
    risk_score: 30,
  },
  {
    id: 'crypto_risk_missing',
    jurisdiction: 'FCA/ESMA',
    pattern: /\b(crypto|bitcoin|token)\b.*\b(guaranteed|safe investment|no risk)\b/i,
    message: 'Crypto promotions require risk warnings and cannot imply safety or guaranteed outcomes',
    verdict: 'block',
    risk_score: 88,
  },
]);

const CONTENT_GENERATION_ACTIONS = new Set([
  'generate',
  'generate_content',
  'generate_brief',
  'generate_decision',
  'generate_analysis',
  'chat',
]);

const CONTENT_GENERATION_SURFACES = new Set([
  'marketing_brief',
  'content_ai',
  'ask_copilot',
  'chat',
  'ai_content',
]);

function isContentGeneration(surface, action) {
  const a = String(action || '').toLowerCase();
  const s = String(surface || '').toLowerCase();
  if (CONTENT_GENERATION_ACTIONS.has(a)) return true;
  if (a.startsWith('generate_')) return true;
  if (CONTENT_GENERATION_SURFACES.has(s)) return true;
  if (s.includes('brief') || s.includes('content') || s.includes('copilot')) return true;
  return false;
}

function scanPii(text) {
  const checks = [];
  for (const [type, cfg] of Object.entries(PII_PATTERNS)) {
    if (cfg.pattern.test(text)) {
      checks.push({
        check_type: 'pii',
        verdict: 'block',
        risk_score: 95,
        detail: {
          reason: `Possible ${cfg.label} detected — remove before publishing or sending`,
          pattern: type,
        },
      });
      cfg.pattern.lastIndex = 0;
    }
  }
  return checks;
}

function scanCompliance(text) {
  const checks = [];
  for (const rule of COMPLIANCE_PATTERNS) {
    if (rule.pattern.test(text)) {
      checks.push({
        check_type: 'brand_compliance',
        verdict: rule.verdict,
        risk_score: rule.risk_score,
        detail: {
          reason: rule.message,
          rule_id: rule.id,
          jurisdiction: rule.jurisdiction,
        },
      });
    }
  }
  return checks;
}

module.exports = {
  PII_PATTERNS,
  COMPLIANCE_PATTERNS,
  isContentGeneration,
  scanPii,
  scanCompliance,
};

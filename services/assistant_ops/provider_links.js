'use strict';

/**
 * Provider destinations for Real-Time Alerts (billing top-up, signup, API keys).
 * Used when emitting credit / missing-key alerts and as a client-side fallback.
 */
const PROVIDERS = {
  OPENAI_API_KEY: {
    name: 'OpenAI',
    envKeys: ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY'],
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
    signupUrl: 'https://platform.openai.com/api-keys',
    settingsKey: 'AI_INTEGRATIONS_OPENAI_API_KEY',
  },
  AI_INTEGRATIONS_OPENAI_API_KEY: {
    name: 'OpenAI',
    envKeys: ['OPENAI_API_KEY', 'AI_INTEGRATIONS_OPENAI_API_KEY'],
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
    signupUrl: 'https://platform.openai.com/api-keys',
    settingsKey: 'AI_INTEGRATIONS_OPENAI_API_KEY',
  },
  ANTHROPIC_API_KEY: {
    name: 'Claude (Anthropic)',
    envKeys: ['ANTHROPIC_API_KEY', 'AI_INTEGRATIONS_ANTHROPIC_API_KEY'],
    billingUrl: 'https://console.anthropic.com/settings/billing',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    settingsKey: 'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
  },
  AI_INTEGRATIONS_ANTHROPIC_API_KEY: {
    name: 'Claude (Anthropic)',
    envKeys: ['ANTHROPIC_API_KEY', 'AI_INTEGRATIONS_ANTHROPIC_API_KEY'],
    billingUrl: 'https://console.anthropic.com/settings/billing',
    signupUrl: 'https://console.anthropic.com/settings/keys',
    settingsKey: 'AI_INTEGRATIONS_ANTHROPIC_API_KEY',
  },
  PERPLEXITY_API_KEY: {
    name: 'Perplexity',
    envKeys: ['PERPLEXITY_API_KEY'],
    billingUrl: 'https://www.perplexity.ai/settings/billing',
    signupUrl: 'https://www.perplexity.ai/settings/api',
    settingsKey: 'PERPLEXITY_API_KEY',
  },
  GEMINI_API_KEY: {
    name: 'Gemini',
    envKeys: ['GEMINI_API_KEY', 'AI_INTEGRATIONS_GEMINI_API_KEY'],
    billingUrl: 'https://aistudio.google.com/apikey',
    signupUrl: 'https://aistudio.google.com/apikey',
    settingsKey: 'GEMINI_API_KEY',
  },
  DATAFORSEO_LOGIN: {
    name: 'DataForSEO',
    envKeys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    billingUrl: 'https://app.dataforseo.com/billing',
    signupUrl: 'https://app.dataforseo.com/sign-up',
    settingsKey: 'DATAFORSEO_LOGIN',
  },
  DATAFORSEO_PASSWORD: {
    name: 'DataForSEO',
    envKeys: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    billingUrl: 'https://app.dataforseo.com/billing',
    signupUrl: 'https://app.dataforseo.com/sign-up',
    settingsKey: 'DATAFORSEO_LOGIN',
  },
  FIRECRAWL_API_KEY: {
    name: 'Firecrawl',
    envKeys: ['FIRECRAWL_API_KEY'],
    billingUrl: 'https://www.firecrawl.dev/app/billing',
    signupUrl: 'https://www.firecrawl.dev/app/api-keys',
    settingsKey: 'FIRECRAWL_API_KEY',
  },
  RESEND_API_KEY: {
    name: 'Resend',
    envKeys: ['RESEND_API_KEY'],
    billingUrl: 'https://resend.com/settings/billing',
    signupUrl: 'https://resend.com/api-keys',
    settingsKey: 'RESEND_API_KEY',
  },
  HUBSPOT_PRIVATE_APP_TOKEN: {
    name: 'HubSpot',
    envKeys: ['HUBSPOT_PRIVATE_APP_TOKEN'],
    billingUrl: 'https://app.hubspot.com/account-and-billing/overview',
    signupUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    settingsKey: 'HUBSPOT_PRIVATE_APP_TOKEN',
  },
};

function getProvider(envKey) {
  return PROVIDERS[envKey] || null;
}

function adminSettingsPath(settingsKey) {
  const focus = encodeURIComponent(settingsKey || '');
  return `/manage/admin?tab=platform-keys&focus=${focus}`;
}

/** Re-apply provider links when serving stored alerts (older rows may lack actionUrl). */
function rehydrateAlert(alert) {
  const key = alert.providerKey || inferProviderKeyFromAlert(alert);
  if (!key) return alert;
  return enrichAlert(alert, key);
}

function inferProviderKeyFromAlert(alert) {
  const t = String(alert.title || '') + ' ' + String(alert.body || '');
  if (/dataforseo/i.test(t)) return 'DATAFORSEO_LOGIN';
  if (/openai/i.test(t)) return 'OPENAI_API_KEY';
  if (/anthropic|claude/i.test(t)) return 'ANTHROPIC_API_KEY';
  if (/perplexity/i.test(t)) return 'PERPLEXITY_API_KEY';
  if (/gemini/i.test(t)) return 'GEMINI_API_KEY';
  if (/firecrawl/i.test(t)) return 'FIRECRAWL_API_KEY';
  if (/resend/i.test(t)) return 'RESEND_API_KEY';
  if (/hubspot/i.test(t)) return 'HUBSPOT_PRIVATE_APP_TOKEN';
  const m = String(alert.body || '').match(/\b([A-Z][A-Z0-9_]{4,})\b/);
  return m ? m[1] : null;
}

/** Attach actionUrl / actionLabel / providerKey for alert UI clicks. */
function enrichAlert(alert, envKey) {
  const p = getProvider(envKey);
  if (!p) return alert;
  const out = { ...alert, providerKey: envKey, provider: p.name };
  if (alert.type === 'credit_low' || alert.type === 'credit_error') {
    out.actionUrl = p.billingUrl;
    out.actionLabel = `Top up ${p.name} balance →`;
  } else if (alert.type === 'service_missing' || alert.type === 'key_placeholder') {
    out.actionUrl = p.signupUrl || p.billingUrl;
    out.actionLabel = `Get ${p.name} API access →`;
    out.settingsUrl = adminSettingsPath(p.settingsKey);
    out.settingsLabel = 'Add key in Platform APIs';
  }
  return out;
}

/** JSON-safe map for the browser fallback (no secrets). */
function clientMap() {
  const out = {};
  for (const [key, p] of Object.entries(PROVIDERS)) {
    out[key] = {
      name: p.name,
      billingUrl: p.billingUrl,
      signupUrl: p.signupUrl,
      settingsKey: p.settingsKey,
    };
  }
  return out;
}

module.exports = {
  PROVIDERS,
  getProvider,
  adminSettingsPath,
  enrichAlert,
  rehydrateAlert,
  clientMap,
};

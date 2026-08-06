'use strict';
/**
 * Technical Manager system scan — aggregates platform health, integrations,
 * LLM/AI providers, auth/session, credentials/tokens, and security posture
 * into one snapshot for live status + officer briefings.
 */

const _db = require('../../db');

function _envPresent(key) {
  const v = process.env[key];
  return !!(v && String(v).trim() && !/^_DUMMY/i.test(String(v)));
}

function _envDummy(key) {
  const v = process.env[key];
  return !!(v && /^_DUMMY/i.test(String(v)));
}

function _event(severity, area, message, action = null) {
  return {
    id: `${area}_${severity}_${Buffer.from(message).toString('base64url').slice(0, 12)}`,
    severity, // critical | high | medium | low | info
    area,
    message,
    action,
    at: new Date().toISOString(),
  };
}

async function runTechnicalScan(tid = null) {
  const events = [];
  const now = new Date().toISOString();

  // ── Core runtime ──────────────────────────────────────────────────────────
  const runtime = {
    node: process.version,
    uptime_sec: Math.round(process.uptime()),
    memory_mb: Math.round((process.memoryUsage().rss || 0) / (1024 * 1024)),
    env: process.env.NODE_ENV || 'development',
    express_port: process.env.EXPRESS_PORT || process.env.PORT || '8000',
  };

  // ── Database / readiness ──────────────────────────────────────────────────
  const postgres = { ok: false, configured: _envPresent('DATABASE_URL') };
  if (!postgres.configured) {
    events.push(_event('critical', 'database', 'DATABASE_URL is not configured — core data plane is offline.', 'Set DATABASE_URL and restart Express'));
  } else {
    try {
      const r = await _db.getPool().query('SELECT 1 AS ok, NOW() AS ts');
      postgres.ok = r.rows[0]?.ok === 1;
      postgres.ts = r.rows[0]?.ts;
      if (!postgres.ok) events.push(_event('critical', 'database', 'Postgres responded but health probe failed.', 'Inspect DB logs and connection pool'));
    } catch (e) {
      postgres.error = e.message;
      events.push(_event('critical', 'database', `Postgres unreachable: ${e.message}`, 'Restore DATABASE_URL connectivity immediately'));
    }
  }

  // ── Auth / session / vault ────────────────────────────────────────────────
  const auth = {
    session_secret: _envPresent('SESSION_SECRET'),
    credential_encryption: _envPresent('CREDENTIAL_ENCRYPTION_KEY'),
    preview_auth: process.env.PREVIEW_AUTH === '1' || process.env.PREVIEW_MODE === '1',
  };
  if (!auth.session_secret) {
    events.push(_event('critical', 'auth', 'SESSION_SECRET missing — user sessions are insecure or will fail.', 'Set a strong SESSION_SECRET'));
  }
  if (!auth.credential_encryption) {
    events.push(_event('high', 'security', 'CREDENTIAL_ENCRYPTION_KEY not set — credential vault disabled.', 'Generate with openssl rand -base64 32'));
  }

  // ── LLM / AI providers ────────────────────────────────────────────────────
  const llm = {
    openai: _envPresent('AI_INTEGRATIONS_OPENAI_API_KEY') || _envPresent('OPENAI_API_KEY'),
    openai_dummy: _envDummy('AI_INTEGRATIONS_OPENAI_API_KEY') || _envDummy('OPENAI_API_KEY'),
    openai_base: !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    perplexity: _envPresent('PERPLEXITY_API_KEY'),
    anthropic: _envPresent('ANTHROPIC_API_KEY'),
    providers: [],
  };
  if (!llm.openai || llm.openai_dummy) {
    events.push(_event('high', 'llm', 'Primary OpenAI key missing or dummy — AI briefs, narratives, and agents degrade.', 'Configure a real OpenAI (or compatible) API key'));
  }
  try {
    const { listProviders } = require('../ai_providers/store');
    if (typeof listProviders === 'function' && tid != null) {
      llm.providers = await listProviders(tid).catch(() => []);
    }
  } catch (_) {
    try {
      // Fallback: probe ai-providers table directly
      if (_db.hasDb() && tid != null) {
        const r = await _db.getPool().query(
          `SELECT id, name, provider, status, active FROM ai_providers WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`,
          [tid],
        ).catch(() => ({ rows: [] }));
        llm.providers = r.rows || [];
      }
    } catch (_) { /* optional */ }
  }
  if (Array.isArray(llm.providers) && llm.providers.length === 0 && !llm.openai) {
    events.push(_event('medium', 'llm', 'No BYO AI providers configured and no platform OpenAI key.', 'Add a provider under AI Providers'));
  }

  // ── Integrations / tokens (presence only — never return secrets) ──────────
  const tokenChecks = [
    ['meta', ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']],
    ['google_ads', ['GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN']],
    ['tiktok', ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID']],
    ['hubspot', ['HUBSPOT_PRIVATE_APP_TOKEN']],
    ['amplitude', ['AMPLITUDE_API_KEY']],
    ['dataforseo', ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']],
    ['gsc_ga4', ['GOOGLE_SERVICE_ACCOUNT_JSON']],
    ['semrush', ['SEMRUSH_API_KEY']],
    ['shopify', ['SHOPIFY_SHOP', 'SHOPIFY_ADMIN_TOKEN']],
    ['resend', ['RESEND_API_KEY']],
    ['apify', ['APIFY_API_KEY']],
  ];
  const integrations = { configured: [], missing_recommended: [], dummy: [], details: {} };
  for (const [name, keys] of tokenChecks) {
    const present = keys.every(_envPresent);
    const dummy = keys.some(_envDummy);
    integrations.details[name] = { present, dummy, keys_required: keys.length };
    if (present && !dummy) integrations.configured.push(name);
    else if (dummy) {
      integrations.dummy.push(name);
      events.push(_event('high', 'integrations', `${name} credentials look like dummy placeholders.`, `Replace ${name} tokens in Settings / env`));
    }
  }
  // Recommended always-on for smooth InfoGenie ops
  for (const rec of ['openai', 'resend']) {
    const keyMap = { openai: llm.openai && !llm.openai_dummy, resend: _envPresent('RESEND_API_KEY') };
    if (!keyMap[rec]) integrations.missing_recommended.push(rec);
  }

  // ── Security posture ──────────────────────────────────────────────────────
  const security = {
    node_env_production: (process.env.NODE_ENV || '') === 'production',
    permission_enforcement: process.env.PERMISSION_ENFORCEMENT === 'on' || process.env.PERMISSION_ENFORCEMENT === '1',
    preview_mode: auth.preview_auth,
    vault_enabled: auth.credential_encryption,
  };
  if (!security.permission_enforcement) {
    events.push(_event('medium', 'security', 'PERMISSION_ENFORCEMENT is not on — API permission gaps are only logged.', 'Enable PERMISSION_ENFORCEMENT=on in production'));
  }
  if (security.preview_mode && security.node_env_production) {
    events.push(_event('high', 'security', 'Preview auth flags enabled while NODE_ENV=production.', 'Disable PREVIEW_AUTH / PREVIEW_MODE in production'));
  }

  // ── Officer / AI Team schedulers ──────────────────────────────────────────
  let officerStack = { ok: null };
  try {
    officerStack = {
      db: postgres.ok,
      openai: llm.openai && !llm.openai_dummy,
      note: 'Technical Manager attends daily management meetings via AI Team auto-meetings',
    };
  } catch (_) { /* ignore */ }

  // ── Update / tooling research stubs (deterministic recommendations) ───────
  const tooling_gaps = [];
  if (!integrations.configured.includes('hubspot') && !integrations.configured.includes('amplitude')) {
    tooling_gaps.push({
      need: 'CRM / product analytics ground truth',
      suggestion: 'Connect HubSpot and/or Amplitude for true ROAS and conversion telemetry',
      urgency: 'high',
    });
  }
  if (!auth.credential_encryption) {
    tooling_gaps.push({
      need: 'Credential vault encryption',
      suggestion: 'Enable CREDENTIAL_ENCRYPTION_KEY so ad tokens are stored encrypted at rest',
      urgency: 'critical',
    });
  }
  if (!llm.openai || llm.openai_dummy) {
    tooling_gaps.push({
      need: 'Production LLM access',
      suggestion: 'Provision OpenAI or a BYO provider under AI Providers; verify with a live test',
      urgency: 'high',
    });
  }
  tooling_gaps.push({
    need: 'Continuous dependency & CVE monitoring',
    suggestion: 'Evaluate Snyk / Dependabot / npm audit CI gates before applying package updates',
    urgency: 'medium',
  });
  tooling_gaps.push({
    need: 'Synthetic uptime monitoring',
    suggestion: 'Add external uptime checks (e.g. Better Stack / Checkly) against /api/health and /api/ready',
    urgency: 'medium',
  });

  for (const g of tooling_gaps.filter((x) => x.urgency === 'critical' || x.urgency === 'high')) {
    events.push(_event(g.urgency === 'critical' ? 'critical' : 'high', 'tooling', g.need + ' — ' + g.suggestion, 'Send tooling report to management for approval'));
  }

  // ── Overall status ────────────────────────────────────────────────────────
  const critical = events.filter((e) => e.severity === 'critical').length;
  const high = events.filter((e) => e.severity === 'high').length;
  let overall = 'healthy';
  if (critical > 0) overall = 'critical';
  else if (high > 0) overall = 'degraded';
  else if (events.some((e) => e.severity === 'medium')) overall = 'watch';

  const plan_of_action = events
    .filter((e) => e.severity === 'critical' || e.severity === 'high')
    .slice(0, 8)
    .map((e, i) => ({
      step: i + 1,
      severity: e.severity,
      area: e.area,
      problem: e.message,
      action: e.action || 'Investigate and remediate',
      approval_required: e.severity === 'critical' || e.area === 'security' || e.area === 'tooling',
      status: 'pending_approval',
    }));

  return {
    ok: true,
    role: 'technical',
    title: 'Technical Manager',
    generated_at: now,
    overall,
    runtime,
    postgres,
    auth,
    llm: {
      openai_configured: llm.openai,
      openai_dummy: llm.openai_dummy,
      openai_base: llm.openai_base,
      perplexity: llm.perplexity,
      anthropic: llm.anthropic,
      provider_count: Array.isArray(llm.providers) ? llm.providers.length : 0,
    },
    integrations,
    security,
    officer_stack: officerStack,
    tooling_gaps,
    events: events.sort((a, b) => {
      const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
    }),
    plan_of_action,
    meeting_note: 'Technical Manager attends daily management meetings and reports live system status to all officers.',
    counts: {
      events: events.length,
      critical,
      high,
      integrations_configured: integrations.configured.length,
      tooling_gaps: tooling_gaps.length,
      actions_pending_approval: plan_of_action.filter((p) => p.approval_required).length,
    },
  };
}

module.exports = { runTechnicalScan };

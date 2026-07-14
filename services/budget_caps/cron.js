// Budget Caps enforcer — runs hourly, checks each tenant's platform caps,
// fires Slack alerts at threshold, marks campaigns paused in DB at limit.
const https = require('https');
const _db   = require('../../db');

const ALERT_COOLDOWN_MS = 22 * 60 * 60 * 1000; // 22h — one alert per day

// In-memory dedup: { `${tid}:${platform}` -> lastAlertAt ms }
const _alerted = new Map();

function _sha(s) { return s; } // identity — just for label clarity

function _sendSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const allowed = new Set(['hooks.slack.com', 'discord.com', 'discordapp.com']);
      if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) return resolve();
      const body = JSON.stringify({ text });
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = https.request(opts, () => resolve());
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    } catch { resolve(); }
  });
}

async function runBudgetCapsCheck() {
  if (!_db.hasDb()) return;
  const p = _db.getPool();

  try {
    const { rows: caps } = await p.query(
      "SELECT bc.* FROM platform_budget_caps bc JOIN tenants t ON t.id = bc.tenant_id WHERE t.status = 'active'"
    );

    for (const cap of caps) {
      const tid = cap.tenant_id;
      const platform = cap.platform;

      // Sum daily_budget + total_spend for this platform + tenant
      const { rows: agg } = await p.query(
        `SELECT
           COALESCE(SUM(daily_budget),0)    AS daily_budgeted,
           COALESCE(SUM(total_spend),0)     AS total_spend,
           COALESCE(SUM(lifetime_budget),0) AS lifetime_budgeted
         FROM ad_campaigns
         WHERE tenant_id=$1 AND platform=$2`,
        [tid, platform]
      );

      const { daily_budgeted, total_spend, lifetime_budgeted } = agg[0];
      const threshold = (cap.alert_threshold_pct || 80) / 100;
      const key = `${tid}:${platform}`;

      // ── Daily cap check ──────────────────────────────────────────────────
      if (cap.daily_cap) {
        const dailyPct = Number(daily_budgeted) / Number(cap.daily_cap);

        if (dailyPct >= 1.0 && cap.paused_at_limit) {
          // Pause all active campaigns for this platform/tenant in our DB
          await p.query(
            `UPDATE ad_campaigns SET status='paused'
             WHERE tenant_id=$1 AND platform=$2 AND (status IS NULL OR status='active')`,
            [tid, platform]
          );
          await p.query(
            'UPDATE platform_budget_caps SET paused_at_limit=true,updated_at=NOW() WHERE tenant_id=$1 AND platform=$2',
            [tid, platform]
          );
          console.log(`[budget-caps] PAUSED ${platform} campaigns for tenant ${tid} — daily cap reached ($${cap.daily_cap})`);
        }

        if (dailyPct >= threshold) {
          const lastAlert = _alerted.get(key + ':daily') || 0;
          if (Date.now() - lastAlert > ALERT_COOLDOWN_MS) {
            _alerted.set(key + ':daily', Date.now());
            await _sendSlack(
              `⚠️ *InfoGenie Budget Alert* — ${platform.toUpperCase()} daily cap at ${Math.round(dailyPct * 100)}%\n` +
              `Budget: $${Number(daily_budgeted).toFixed(0)} of $${Number(cap.daily_cap).toFixed(0)} cap (tenant ${tid})`
            );
          }
        }
      }

      // ── Lifetime cap check ────────────────────────────────────────────────
      if (cap.lifetime_cap) {
        const lifetimePct = Number(total_spend) / Number(cap.lifetime_cap);

        if (lifetimePct >= 1.0 && cap.paused_at_limit) {
          await p.query(
            `UPDATE ad_campaigns SET status='paused'
             WHERE tenant_id=$1 AND platform=$2 AND (status IS NULL OR status='active')`,
            [tid, platform]
          );
          console.log(`[budget-caps] PAUSED ${platform} campaigns for tenant ${tid} — lifetime cap reached ($${cap.lifetime_cap})`);
        }

        if (lifetimePct >= threshold) {
          const lastAlert = _alerted.get(key + ':lifetime') || 0;
          if (Date.now() - lastAlert > ALERT_COOLDOWN_MS) {
            _alerted.set(key + ':lifetime', Date.now());
            await _sendSlack(
              `⚠️ *InfoGenie Budget Alert* — ${platform.toUpperCase()} lifetime cap at ${Math.round(lifetimePct * 100)}%\n` +
              `Spend: $${Number(total_spend).toFixed(0)} of $${Number(cap.lifetime_cap).toFixed(0)} lifetime cap (tenant ${tid})`
            );
          }
        }
      }
    }
  } catch (e) {
    console.error('[budget-caps] cron error:', e.message);
  }
}

function startBudgetCapsCron() {
  if (!_db.hasDb()) return;
  // Run immediately at boot, then every hour
  runBudgetCapsCheck().catch(() => {});
  setInterval(() => runBudgetCapsCheck().catch(() => {}), 60 * 60 * 1000);
  console.log('[budget-caps] cron started — hourly cap enforcement');
}

module.exports = { startBudgetCapsCron, runBudgetCapsCheck };

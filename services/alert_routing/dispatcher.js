const _db = require('../../db');
const _https = require('https');

const VALID_TRIGGERS = ['crisis_incident','sov_drop','mention_volume','digest_ready','custom'];
const VALID_CHANNELS = ['slack','email'];

function _matches(rule, event) {
  if (rule.trigger_kind !== event.kind) return false;
  const f = rule.trigger_filter || {};
  if (f.brand && event.brand && String(f.brand).toLowerCase() !== String(event.brand).toLowerCase()) return false;
  if (rule.trigger_kind === 'crisis_incident') {
    if (f.min_severity) {
      const sevRank = { low:1, med:2, high:3 };
      if ((sevRank[event.severity]||0) < (sevRank[f.min_severity]||0)) return false;
    }
    if (f.kind && event.incident_kind && f.kind !== event.incident_kind) return false;
  }
  if (rule.trigger_kind === 'sov_drop') {
    if (f.min_drop_pct != null && event.drop_pct != null && event.drop_pct < Number(f.min_drop_pct)) return false;
  }
  return true;
}

function _renderText(event) {
  if (event.kind === 'crisis_incident') {
    return `🚨 *${(event.severity||'').toUpperCase()}* — ${event.headline}\n${event.detail || ''}`;
  }
  if (event.kind === 'sov_drop') {
    return `📉 SoV drop for *${event.brand}* — ${(event.drop_pct*100).toFixed(0)}% decrease vs prior window.`;
  }
  if (event.kind === 'digest_ready') {
    return `📋 Daily digest ready for *${event.brand}*: ${event.headline}`;
  }
  return `🔔 ${event.headline || event.kind}`;
}

async function _dispatchSlack(text, webhookUrl) {
  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!url) throw new Error('no slack url');
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('slack url not https');
  if (!['hooks.slack.com','discord.com','discordapp.com'].includes(u.hostname)) throw new Error('host not allowed');
  const isDiscord = u.hostname.includes('discord');
  const body = JSON.stringify(isDiscord ? { content: text.slice(0, 1900) } : { text });
  return new Promise((resolve, reject) => {
    const r = _https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resp => { resp.on('data', () => {}); resp.on('end', () =>
      resp.statusCode < 300 ? resolve() : reject(new Error('slack '+resp.statusCode))); });
    r.on('error', reject);
    r.setTimeout(8000, () => r.destroy(new Error('slack timeout')));
    r.write(body); r.end();
  });
}

async function _dispatchEmail(text, toEmail, subject) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('no resend key');
  if (!toEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) throw new Error('bad email');
  const fromAddr = process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>';
  const body = JSON.stringify({ from: fromAddr, to: toEmail, subject: subject || 'InfoGenie alert',
    text, html: `<pre style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${text.replace(/[<>&]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;' }[c]))}</pre>` });
  return new Promise((resolve, reject) => {
    const r = _https.request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization':'Bearer '+key, 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, resp => { let d=''; resp.on('data', c => d += c); resp.on('end', () =>
      resp.statusCode < 300 ? resolve() : reject(new Error('resend '+resp.statusCode+' '+d.slice(0,120)))); });
    r.on('error', reject);
    r.setTimeout(10000, () => r.destroy(new Error('resend timeout')));
    r.write(body); r.end();
  });
}

async function dispatchEvent(event) {
  if (!_db.hasDb()) return { matched: 0 };
  const pool = _db.getPool();
  // Phase 2B: tenant-isolated fan-out. Event MUST carry tenant_id when origin is
  // tenant-bound (crisis_radar, sov, digest). Without it we still scan but only
  // dispatch to rules with NULL tenant_id (legacy global rules) so we cannot
  // cross-leak between tenants.
  const evtTid = event.tenant_id != null ? Number(event.tenant_id) : null;
  const rules = evtTid != null
    ? await pool.query(
        `SELECT * FROM alert_rules WHERE enabled=true AND trigger_kind=$1 AND tenant_id=$2`,
        [event.kind, evtTid])
    : await pool.query(
        `SELECT * FROM alert_rules WHERE enabled=true AND trigger_kind=$1 AND tenant_id IS NULL`,
        [event.kind]);
  const matched = rules.rows.filter(r => _matches(r, event));
  const out = [];
  for (const rule of matched) {
    const text = _renderText(event);
    const channelsSent = [];
    for (const ch of (rule.channels || [])) {
      try {
        if (ch.kind === 'slack') {
          await _dispatchSlack(text, ch.webhook_url);
          channelsSent.push({ kind:'slack', ok:true, at: new Date().toISOString() });
        } else if (ch.kind === 'email') {
          await _dispatchEmail(text, ch.email, `[InfoGenie] ${event.headline || event.kind}`);
          channelsSent.push({ kind:'email', target: ch.email, ok:true, at: new Date().toISOString() });
        }
      } catch (e) {
        channelsSent.push({ kind: ch.kind, ok:false, error: e.message });
      }
    }
    await pool.query(
      `INSERT INTO alert_dispatches (tenant_id, rule_id, event_kind, event_ref, channels_sent) VALUES ($1,$2,$3,$4,$5)`,
      [rule.tenant_id, rule.id, event.kind, JSON.stringify(event), JSON.stringify(channelsSent)]);
    await pool.query(`UPDATE alert_rules SET fire_count=fire_count+1, last_fired_at=now() WHERE id=$1`, [rule.id]);
    out.push({ rule_id: rule.id, name: rule.name, channels: channelsSent });
  }
  return { matched: matched.length, dispatched: out };
}

module.exports = { dispatchEvent, VALID_TRIGGERS, VALID_CHANNELS };

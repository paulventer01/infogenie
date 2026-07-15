const express = require('express');
const router  = express.Router();
const _db     = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI  = require('openai');

const BLACKLISTS = [
  'Spamhaus ZEN','Barracuda','Spamcop','SORBS','MXToolBox','Mailspike','UCEProtect L1','UCEProtect L2','PSBL','RATS Dyna'
];

const PROVIDERS = [
  { id: 'gmail', label: 'Gmail / Google Workspace', smtp_host: 'smtp.gmail.com', smtp_port: 587 },
  { id: 'outlook', label: 'Outlook / Microsoft 365', smtp_host: 'smtp.office365.com', smtp_port: 587 },
  { id: 'zoho', label: 'Zoho Mail', smtp_host: 'smtp.zoho.com', smtp_port: 587 },
  { id: 'resend', label: 'Resend (sending domain)', smtp_host: 'smtp.resend.com', smtp_port: 587 },
  { id: 'smtp', label: 'Custom SMTP', smtp_host: '', smtp_port: 587 },
];

// Helper: compute daily volume for a given warmup day using exponential ramp
function computeVolume(currentDay, startVol, maxVol, targetDays) {
  if (currentDay <= 0) return startVol;
  if (currentDay >= targetDays) return maxVol;
  const progress = currentDay / targetDays;
  const vol = Math.round(startVol + (maxVol - startVol) * Math.pow(progress, 1.5));
  return Math.min(vol, maxVol);
}

router.get('/config', (req, res) => {
  res.json({ ok: true, providers: PROVIDERS, blacklists: BLACKLISTS });
});

router.get('/accounts', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:accounts' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const r = await p.query(
    `SELECT a.*,
       (SELECT COUNT(*) FROM email_warmup_log WHERE account_id=a.id) as days_logged,
       (SELECT logged_at FROM email_warmup_log WHERE account_id=a.id ORDER BY day_number DESC LIMIT 1) as last_log_at
     FROM email_warmup_accounts a WHERE a.tenant_id=$1 ORDER BY a.created_at DESC`,
    [tid]
  );
  res.json({ ok: true, accounts: r.rows });
});

router.post('/accounts', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:create' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { email, display_name, provider = 'smtp', smtp_host, smtp_port = 587, smtp_user, max_volume = 200, target_days = 42 } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'email required' });
  const provConf = PROVIDERS.find(pp => pp.id === provider) || {};
  const p = await _db.getPool();
  const r = await p.query(
    `INSERT INTO email_warmup_accounts(tenant_id,email,display_name,provider,smtp_host,smtp_port,smtp_user,max_volume,target_days,current_daily_volume,start_volume)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,3,3) RETURNING *`,
    [tid, email, display_name || null, provider, smtp_host || provConf.smtp_host || '', smtp_port, smtp_user || null, max_volume, target_days]
  );
  res.json({ ok: true, account: r.rows[0] });
});

router.get('/accounts/:id/log', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:log' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM email_warmup_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const log = await p.query(
    `SELECT * FROM email_warmup_log WHERE account_id=$1 AND tenant_id=$2 ORDER BY day_number ASC LIMIT 60`,
    [req.params.id, tid]
  );
  // Build projected schedule for remaining days
  const a = acc.rows[0];
  const schedule = [];
  for (let d = a.current_day + 1; d <= a.target_days; d++) {
    schedule.push({ day: d, projected_volume: computeVolume(d, a.start_volume, a.max_volume, a.target_days) });
  }
  res.json({ ok: true, account: a, log: log.rows, schedule });
});

router.post('/accounts/:id/pause', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:pause' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM email_warmup_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const next = acc.rows[0].status === 'active' ? 'paused' : 'active';
  await p.query(`UPDATE email_warmup_accounts SET status=$1 WHERE id=$2 AND tenant_id=$3`, [next, req.params.id, tid]);
  res.json({ ok: true, status: next });
});

router.post('/accounts/:id/check-blacklist', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:blacklist' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM email_warmup_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  // Simulated blacklist check (real implementation would query MXToolBox/Spamhaus APIs)
  const domain = acc.rows[0].email.split('@')[1] || '';
  const hits = []; // In production: call blacklist APIs
  await p.query(
    `INSERT INTO email_warmup_blacklist_checks(account_id,tenant_id,lists_checked,lists_hit,hit_details)
     VALUES($1,$2,$3,$4,$5)`,
    [req.params.id, tid, BLACKLISTS.length, hits.length, JSON.stringify(hits)]
  );
  if (hits.length > 0) {
    await p.query(`UPDATE email_warmup_accounts SET status='blacklisted', reputation_score=GREATEST(reputation_score-20,0) WHERE id=$1`, [req.params.id]);
  }
  res.json({ ok: true, domain, lists_checked: BLACKLISTS.length, lists_hit: hits.length, hit_details: hits, clean: hits.length === 0 });
});

router.post('/accounts/:id/log-day', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:log-day' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { sent_volume = 0, delivered_count = 0, bounced_count = 0, spam_count = 0, open_rate = 0 } = req.body;
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM email_warmup_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const a = acc.rows[0];
  const nextDay = a.current_day + 1;
  const nextVol = computeVolume(nextDay, a.start_volume, a.max_volume, a.target_days);
  // Update reputation based on bounce/spam rates
  let repDelta = 0;
  if (sent_volume > 0) {
    const bounceRate = bounced_count / sent_volume;
    const spamRate   = spam_count / sent_volume;
    if (bounceRate > 0.05) repDelta -= 10;
    if (bounceRate > 0.10) repDelta -= 15;
    if (spamRate   > 0.01) repDelta -= 20;
    if (open_rate  > 0.30) repDelta += 5;
    if (bounceRate < 0.02 && spamRate < 0.005) repDelta += 2;
  }
  const newRep = Math.max(0, Math.min(100, a.reputation_score + repDelta));
  await p.query(
    `INSERT INTO email_warmup_log(account_id,tenant_id,day_number,planned_volume,sent_volume,delivered_count,bounced_count,spam_count,open_rate,reputation_score)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [req.params.id, tid, nextDay, nextVol, sent_volume, delivered_count, bounced_count, spam_count, open_rate, newRep]
  );
  await p.query(
    `UPDATE email_warmup_accounts SET current_day=$1, current_daily_volume=$2, reputation_score=$3, last_sent_at=NOW() WHERE id=$4`,
    [nextDay, nextVol, newRep, req.params.id]
  );
  res.json({ ok: true, day: nextDay, next_day_volume: computeVolume(nextDay + 1, a.start_volume, a.max_volume, a.target_days), reputation_score: newRep });
});

router.post('/accounts/:id/ai-advice', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'email-warmup:ai-advice' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const acc = await p.query(`SELECT * FROM email_warmup_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
  if (!acc.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
  const log = await p.query(
    `SELECT * FROM email_warmup_log WHERE account_id=$1 ORDER BY day_number DESC LIMIT 7`, [req.params.id]
  );
  const a = acc.rows[0];
  const recentLog = log.rows;

  let advice = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are an email deliverability expert. Analyse this warmup account and give actionable advice.

Account: ${a.email}
Provider: ${a.provider}
Day ${a.current_day} of ${a.target_days}
Current daily volume: ${a.current_daily_volume}
Reputation score: ${a.reputation_score}/100
Status: ${a.status}

Recent log (last 7 days):
${recentLog.map(l => `Day ${l.day_number}: sent=${l.sent_volume}, delivered=${l.delivered_count}, bounced=${l.bounced_count}, spam=${l.spam_count}, open_rate=${l.open_rate}%`).join('\n') || 'No log yet'}

Return strict JSON: {
  "health": "good|warning|critical",
  "overall_assessment": "...",
  "issues": ["..."],
  "recommendations": ["..."],
  "next_steps": ["..."],
  "estimated_inbox_rate": 0
}`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    });
    const parsed = JSON.parse(resp.choices[0].message.content);
    if (!parsed._DUMMY) advice = parsed;
  } catch (e) {}

  if (!advice) {
    const rep = a.reputation_score;
    advice = {
      health: rep >= 80 ? 'good' : rep >= 50 ? 'warning' : 'critical',
      overall_assessment: `Day ${a.current_day}/${a.target_days}. Reputation score: ${rep}/100. ${rep >= 80 ? 'Warmup is progressing well.' : 'Monitor closely for bounce/spam issues.'}`,
      issues: rep < 80 ? ['Reputation score is below optimal'] : [],
      recommendations: ['Keep daily volume at or below the scheduled amount', 'Ensure all warmup emails get opened and replied to', 'Avoid sending to purchased or unverified lists during warmup'],
      next_steps: [`Send ${a.current_daily_volume} emails today`, 'Check blacklists weekly', 'Monitor open rates — aim for >30%'],
      estimated_inbox_rate: rep
    };
  }

  res.json({ ok: true, advice });
});

module.exports = router;

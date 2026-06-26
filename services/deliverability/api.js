const express = require('express');
const _dns = require('dns').promises;

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;
const COMMON_DKIM_SELECTORS = ['default','google','selector1','selector2','k1','mail','dkim','s1','s2','smtpapi','mandrill','mxvault','pm','resend','everlytickey1','everlytickey2','sm','dk'];

function _scoreSpf(txt) {
  if (!txt) return { ok:false, severity:'high', score:0, msg:'No SPF record found.' };
  const t = txt.toLowerCase();
  const hasAll = / [-~?+]all\b/.test(t) || /[-~?+]all$/.test(t);
  const isHard = / -all\b/.test(t) || /-all$/.test(t);
  const isSoft = / ~all\b/.test(t) || /~all$/.test(t);
  const isNeutral = / \?all\b/.test(t) || /\?all$/.test(t);
  if (!hasAll) return { ok:false, severity:'med', score:50, msg:'SPF present but missing the qualifier "all" — allows anyone to spoof.' };
  if (isHard) return { ok:true, severity:'low', score:100, msg:'SPF set to -all (strict reject). Excellent.' };
  if (isSoft) return { ok:true, severity:'low', score:85, msg:'SPF set to ~all (soft fail). Good — recommended for most senders.' };
  if (isNeutral) return { ok:false, severity:'med', score:55, msg:'SPF set to ?all (neutral) — provides no protection.' };
  return { ok:true, severity:'low', score:70, msg:'SPF present.' };
}
function _scoreDmarc(txt) {
  if (!txt) return { ok:false, severity:'high', score:0, msg:'No DMARC record found at _dmarc.<domain>.' };
  const t = txt.toLowerCase();
  const m = t.match(/p=(none|quarantine|reject)/);
  const policy = m ? m[1] : 'none';
  const pct = (t.match(/pct=(\d+)/)||[])[1];
  const rua = /rua=/.test(t);
  if (policy === 'reject') return { ok:true, severity:'low', score:100, msg:`DMARC p=reject${pct?` pct=${pct}`:''}${rua?' (with reporting)':''}. Strongest protection.` };
  if (policy === 'quarantine') return { ok:true, severity:'low', score:80, msg:`DMARC p=quarantine${pct?` pct=${pct}`:''}${rua?' (with reporting)':''}. Good.` };
  return { ok:false, severity:'med', score:40, msg:'DMARC p=none — only monitoring, no enforcement. Move to quarantine then reject.' };
}
function _scoreDkim(found) {
  if (!found.length) return { ok:false, severity:'high', score:0, msg:'No DKIM records found at common selectors.', selectors_tried: COMMON_DKIM_SELECTORS };
  return { ok:true, severity:'low', score:100, msg:`DKIM published at ${found.length} selector(s): ${found.map(f=>f.selector).join(', ')}.`, selectors_found: found };
}
function _scoreMx(records) {
  if (!records.length) return { ok:false, severity:'high', score:0, msg:'No MX records — cannot receive email.' };
  return { ok:true, severity:'low', score:100, msg:`${records.length} MX record(s): ${records.slice(0,5).map(r=>`${r.exchange} (pri ${r.priority})`).join(', ')}` };
}
function _scoreMta(txt) {
  if (!txt) return { ok:false, severity:'low', score:50, msg:'No MTA-STS policy at _mta-sts.<domain>. Optional but boosts deliverability.' };
  return { ok:true, severity:'low', score:100, msg:'MTA-STS policy published.' };
}
function _scoreBimi(txt) {
  if (!txt) return { ok:false, severity:'low', score:0, msg:'No BIMI record at default._bimi.<domain>. Optional — shows your logo in Gmail.' };
  return { ok:true, severity:'low', score:100, msg:'BIMI record published — your logo can show in inbox.' };
}

async function _txtFlat(name) {
  try {
    const arr = await _dns.resolveTxt(name);
    return arr.map(parts => parts.join('')).filter(Boolean);
  } catch (e) { return []; }
}
async function _findSpf(domain) {
  const txts = await _txtFlat(domain);
  return txts.find(t => /^v=spf1\b/i.test(t)) || null;
}
async function _findDmarc(domain) {
  const txts = await _txtFlat('_dmarc.' + domain);
  return txts.find(t => /^v=DMARC1\b/i.test(t)) || null;
}
async function _findDkim(domain) {
  const found = [];
  for (const sel of COMMON_DKIM_SELECTORS) {
    const txts = await _txtFlat(`${sel}._domainkey.${domain}`);
    const dkim = txts.find(t => /v=DKIM1|p=/i.test(t));
    if (dkim) found.push({ selector: sel, value: dkim.slice(0, 200) + (dkim.length>200?'…':'') });
  }
  return found;
}

router.post('/audit', async (req, res) => {
  const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
  if (!domain || !DOMAIN_RE.test(domain)) return _err(res, 400, 'Valid domain required (e.g. example.com)');

  let mx = [];
  try { mx = await _dns.resolveMx(domain); } catch {}
  const [spfTxt, dmarcTxt, dkimFound, mtaTxt, bimiTxt] = await Promise.all([
    _findSpf(domain), _findDmarc(domain), _findDkim(domain),
    _txtFlat('_mta-sts.' + domain).then(t => t[0] || null),
    _txtFlat('default._bimi.' + domain).then(t => t.find(x => /^v=BIMI1\b/i.test(x)) || null),
  ]);
  const checks = {
    mx:    { record: mx, ..._scoreMx(mx) },
    spf:   { record: spfTxt, ..._scoreSpf(spfTxt) },
    dkim:  { ..._scoreDkim(dkimFound) },
    dmarc: { record: dmarcTxt, ..._scoreDmarc(dmarcTxt) },
    mta_sts: { record: mtaTxt, ..._scoreMta(mtaTxt) },
    bimi:  { record: bimiTxt, ..._scoreBimi(bimiTxt) },
  };
  const weights = { mx:0.15, spf:0.25, dkim:0.20, dmarc:0.25, mta_sts:0.10, bimi:0.05 };
  let total = 0;
  for (const k of Object.keys(weights)) total += (checks[k].score || 0) * weights[k];
  const score = Math.round(total);
  const grade = score>=90?'A':score>=75?'B':score>=60?'C':score>=40?'D':'F';
  const recs = [];
  if (!checks.spf.ok)     recs.push('Publish or harden SPF record (recommend `~all`).');
  if (!checks.dkim.ok)    recs.push('Publish DKIM keys at your provider\'s selector (e.g. `selector1._domainkey`).');
  if (!checks.dmarc.ok)   recs.push('Publish DMARC at `_dmarc` — start with `p=none` then move to `quarantine` and `reject`.');
  else if (/p=none/i.test(checks.dmarc.record||'')) recs.push('Upgrade DMARC from `p=none` to `p=quarantine` once monitoring is clean.');
  if (!checks.mta_sts.ok) recs.push('Publish MTA-STS policy for TLS-enforced delivery.');
  if (!checks.bimi.ok)    recs.push('Add BIMI to display your logo in Gmail/Yahoo (requires VMC).');
  res.json({ ok:true, domain, score, grade, checks, recommendations: recs });
});

// ── Ongoing Inbox Placement Monitor ──────────────────────────────────────
// Tracks campaign-level deliverability signals: open rates, bounce rates, and
// a simple inbox-placement heuristic across the drip history snapshot.
router.post('/campaign-monitor', async (req, res) => {
  try {
    const { campaign_name, sends = [] } = req.body || {};
    if (!Array.isArray(sends) || !sends.length) {
      return res.status(400).json({ ok: false, error: 'sends array required (each: {email, delivered, bounced, opened, complained})' });
    }
    const total = sends.length;
    const delivered  = sends.filter(s => s.delivered).length;
    const bounced    = sends.filter(s => s.bounced).length;
    const opened     = sends.filter(s => s.opened).length;
    const complained = sends.filter(s => s.complained).length;
    const deliveryRate = total ? Math.round((delivered / total) * 1000) / 10 : 0;
    const bounceRate   = total ? Math.round((bounced  / total) * 1000) / 10 : 0;
    const openRate     = delivered ? Math.round((opened / delivered) * 1000) / 10 : 0;
    const complaintRate = delivered ? Math.round((complained / delivered) * 10000) / 100 : 0;
    // Heuristic inbox-placement score (0-100)
    let inboxScore = 100;
    if (bounceRate > 5)    inboxScore -= 30;
    else if (bounceRate > 2) inboxScore -= 15;
    if (complaintRate > 0.1) inboxScore -= 25;
    if (openRate < 15)     inboxScore -= 10;
    if (openRate < 5)      inboxScore -= 15;
    inboxScore = Math.max(0, Math.min(100, inboxScore));
    const grade = inboxScore >= 80 ? 'A' : inboxScore >= 65 ? 'B' : inboxScore >= 50 ? 'C' : inboxScore >= 35 ? 'D' : 'F';
    const flags = [];
    if (bounceRate > 5)      flags.push({ severity: 'high',   issue: 'High bounce rate — clean your list immediately' });
    else if (bounceRate > 2) flags.push({ severity: 'medium', issue: 'Elevated bounce rate — review your email collection flow' });
    if (complaintRate > 0.1) flags.push({ severity: 'high',   issue: 'Spam complaint rate above 0.1% — ISPs may block your sending domain' });
    if (openRate < 15)       flags.push({ severity: 'medium', issue: 'Low open rate — consider subject line and send-time optimisation' });
    if (openRate === 0)      flags.push({ severity: 'high',   issue: 'Zero opens detected — check for spam folder placement or delivery failures' });
    const recommendations = [];
    if (bounceRate > 2)      recommendations.push('Remove hard-bounced addresses immediately to protect sender reputation.');
    if (complaintRate > 0.08) recommendations.push('Add one-click unsubscribe to all emails and review list-building practices.');
    if (openRate < 20)       recommendations.push('A/B test subject lines and use Recommended Send Time to improve open rates.');
    if (flags.length === 0)  recommendations.push('Deliverability looks healthy. Keep monitoring every campaign.');
    res.json({
      ok: true,
      campaign_name: campaign_name || 'Unnamed Campaign',
      analysed_at: new Date().toISOString(),
      stats: { total, delivered, bounced, opened, complained, deliveryRate, bounceRate, openRate, complaintRate },
      inbox_score: inboxScore,
      grade,
      flags,
      recommendations
    });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Bot-filtered click analysis ───────────────────────────────────────────
// Filters suspected bot clicks from campaign click data using heuristics
// (clicks within < 2 seconds of delivery, identical click patterns across
// many emails). Returns a cleaned dataset.
router.post('/filter-bots', async (req, res) => {
  try {
    const { clicks = [] } = req.body || {};
    const cleaned = [];
    const suspected_bots = [];
    const ipCounts = {};
    for (const c of clicks) { if (c.ip) ipCounts[c.ip] = (ipCounts[c.ip] || 0) + 1; }
    for (const c of clicks) {
      const isBot = (c.time_to_click_ms != null && c.time_to_click_ms < 2000) ||
                    (c.ip && ipCounts[c.ip] > 10) ||
                    /bot|spider|crawl|preview|outlook|office/i.test(c.user_agent || '');
      isBot ? suspected_bots.push({ ...c, bot_reason: c.time_to_click_ms < 2000 ? 'instant_click' : ipCounts[c.ip] > 10 ? 'ip_flood' : 'bot_ua' })
            : cleaned.push(c);
    }
    res.json({ ok: true, total: clicks.length, human_clicks: cleaned.length, bot_clicks: suspected_bots.length, cleaned, suspected_bots });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;

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

module.exports = router;

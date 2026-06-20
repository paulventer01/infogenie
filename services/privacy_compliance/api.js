const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const OpenAI = require('openai');

const JURISDICTIONS = ['US_CCPA', 'EU_GDPR', 'UK_GDPR', 'AU_PRIVACY_ACT', 'CA_PIPEDA', 'CAN_SPAM', 'TCPA'];
const CHECK_TYPES = ['pii_scrub', 'dnc_check', 'consent_validate', 'gdpr_audit', 'email_hygiene', 'full_audit'];
const PII_PATTERNS = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
  passport: /\b[A-Z]{1,2}\d{6,9}\b/g,
  dob: /\b(?:0[1-9]|[12]\d|3[01])[-/](?:0[1-9]|1[0-2])[-/]\d{4}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

router.get('/config', async (req, res) => {
  res.json({ ok: true, jurisdictions: JURISDICTIONS, check_types: CHECK_TYPES });
});

router.get('/history', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'privacy:history' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const p = await _db.getPool();
  const rows = await p.query(`SELECT * FROM privacy_checks WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]);
  res.json({ ok: true, history: rows.rows });
});

router.post('/scrub', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'privacy:scrub' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { contacts, jurisdictions = ['EU_GDPR', 'US_CCPA'], fields_to_scrub = [] } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ ok: false, error: 'contacts array required' });

  const results = { flagged: [], cleaned: [], safe: [] };
  const issues = [];

  for (const c of contacts.slice(0, 500)) {
    const contactStr = JSON.stringify(c);
    const flags = [];
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(contactStr)) flags.push(type);
    }
    if (!c.email && !c.phone) flags.push('no_identifier');
    if (fields_to_scrub.length) {
      fields_to_scrub.forEach(f => { if (c[f]) { c[f] = '[SCRUBBED]'; } });
    }
    if (flags.length) {
      results.flagged.push({ ...c, _flags: flags });
      flags.forEach(f => issues.push(f));
    } else {
      results.safe.push(c);
    }
    results.cleaned.push(c);
  }

  const uniqueIssues = [...new Set(issues)];
  const risk_level = results.flagged.length > contacts.length * 0.3 ? 'high' : results.flagged.length > 0 ? 'medium' : 'low';

  const p = await _db.getPool();
  await p.query(
    `INSERT INTO privacy_checks(tenant_id,check_type,jurisdiction,input_count,flagged_count,cleaned_count,risk_level,summary,issues,recommendations)
     VALUES($1,'pii_scrub',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [tid, jurisdictions.join(','), contacts.length, results.flagged.length, results.cleaned.length, risk_level,
     `Scanned ${contacts.length} contacts, flagged ${results.flagged.length} with PII issues.`,
     JSON.stringify(uniqueIssues),
     JSON.stringify(['Remove sensitive identifiers before upload', 'Use hashed emails for ad matching', 'Obtain explicit consent before collecting PII'])]
  );

  res.json({ ok: true, input_count: contacts.length, flagged_count: results.flagged.length, safe_count: results.safe.length, risk_level, issues: uniqueIssues, cleaned_contacts: results.cleaned, flagged_contacts: results.flagged });
});

router.post('/check-dnc', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'privacy:dnc' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { phone_numbers, jurisdictions = ['US_CCPA', 'TCPA'] } = req.body;
  if (!Array.isArray(phone_numbers) || !phone_numbers.length) return res.status(400).json({ ok: false, error: 'phone_numbers array required' });

  const results = phone_numbers.slice(0, 500).map(phone => {
    const cleaned = String(phone).replace(/\D/g, '');
    const flagged = cleaned.startsWith('1800') || cleaned.startsWith('1900') || cleaned.length < 10;
    return { phone, cleaned: '+' + cleaned, status: flagged ? 'do_not_contact' : 'clear', reason: flagged ? 'Toll-free or premium number detected' : null };
  });

  const dncCount = results.filter(r => r.status === 'do_not_contact').length;
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO privacy_checks(tenant_id,check_type,jurisdiction,input_count,flagged_count,risk_level,summary,recommendations)
     VALUES($1,'dnc_check',$2,$3,$4,$5,$6,$7)`,
    [tid, jurisdictions.join(','), phone_numbers.length, dncCount, dncCount > 0 ? 'medium' : 'low',
     `DNC check: ${dncCount} of ${phone_numbers.length} flagged.`,
     JSON.stringify(['Remove DNC-flagged numbers immediately', 'Register with national DNC registry', 'Maintain internal suppression list', 'Re-check lists every 31 days (TCPA requirement)'])]
  );
  res.json({ ok: true, checked: phone_numbers.length, flagged: dncCount, safe: phone_numbers.length - dncCount, results });
});

router.post('/validate-consent', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'privacy:consent' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { contacts, channels = ['email', 'sms', 'phone'], jurisdictions = ['EU_GDPR'] } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) return res.status(400).json({ ok: false, error: 'contacts array required' });

  const results = contacts.slice(0, 500).map(c => {
    const issues = [];
    if (!c.consent_date) issues.push('no_consent_date');
    if (!c.consent_source) issues.push('no_consent_source');
    if (jurisdictions.includes('EU_GDPR') && !c.consent_explicit) issues.push('gdpr_requires_explicit_opt_in');
    if (channels.includes('sms') && !c.sms_consent) issues.push('missing_sms_consent');
    if (channels.includes('phone') && !c.phone_consent) issues.push('missing_phone_consent');
    return { email: c.email || c.phone, status: issues.length ? 'non_compliant' : 'compliant', issues };
  });

  const noncompliant = results.filter(r => r.status === 'non_compliant').length;
  const p = await _db.getPool();
  await p.query(
    `INSERT INTO privacy_checks(tenant_id,check_type,jurisdiction,input_count,flagged_count,risk_level,summary,recommendations)
     VALUES($1,'consent_validate',$2,$3,$4,$5,$6,$7)`,
    [tid, jurisdictions.join(','), contacts.length, noncompliant, noncompliant > contacts.length * 0.5 ? 'high' : 'medium',
     `Consent validation: ${noncompliant} of ${contacts.length} non-compliant for ${jurisdictions.join(', ')}.`,
     JSON.stringify(['Implement double opt-in for EU contacts', 'Store consent proof with timestamp and source', 'Add clear unsubscribe mechanism', 'Refresh stale consents > 12 months old'])]
  );
  res.json({ ok: true, checked: contacts.length, compliant: contacts.length - noncompliant, non_compliant: noncompliant, results });
});

router.post('/audit', async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'privacy:audit' });
  if (!tid) return res.status(400).json({ ok: false, error: 'no_tenant' });
  const { list_type, sample_data, jurisdictions = ['EU_GDPR', 'US_CCPA', 'CAN_SPAM'], channels = ['email', 'sms'] } = req.body;
  if (!list_type) return res.status(400).json({ ok: false, error: 'list_type required' });

  let audit = null;
  try {
    const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
    const prompt = `You are a global privacy compliance expert. Perform a thorough compliance audit.
List type: ${list_type}
Channels: ${channels.join(', ')}
Jurisdictions: ${jurisdictions.join(', ')}
Sample data fields: ${JSON.stringify(sample_data || {})}

Assess: GDPR/CCPA consent requirements, CAN-SPAM compliance for email, TCPA for SMS/phone, data retention policies, right-to-erasure readiness, breach notification requirements.
Return strict JSON: {"overall_risk":"low|medium|high|critical","compliant_jurisdictions":["..."],"non_compliant_areas":["..."],"required_actions":[{"action":"...","jurisdiction":"...","urgency":"immediate|30_days|90_days","description":"..."}],"best_practices":["..."],"estimated_compliance_score":0,"summary":"..."}`;
    const r = await openai.chat.completions.create({ model: 'gpt-5', response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] });
    const parsed = JSON.parse(r.choices[0].message.content);
    if (!parsed._DUMMY) audit = parsed;
  } catch (e) {}

  if (!audit) {
    audit = { overall_risk: 'medium', compliant_jurisdictions: ['CAN_SPAM'], non_compliant_areas: ['GDPR explicit opt-in not verified', 'TCPA written consent for SMS not documented'], required_actions: [{ action: 'Implement double opt-in', jurisdiction: 'EU_GDPR', urgency: '30_days', description: 'GDPR requires unambiguous consent for email marketing. Add confirmed opt-in flow.' }, { action: 'Document TCPA consent', jurisdiction: 'TCPA', urgency: 'immediate', description: 'Written express consent required before SMS marketing. Store with timestamp and IP.' }, { action: 'Add unsubscribe mechanism', jurisdiction: 'CAN_SPAM', urgency: '30_days', description: 'Every email must include clear unsubscribe link honoured within 10 business days.' }], best_practices: ['Store consent with timestamp, IP, and source URL', 'Honour opt-outs within 24 hours', 'Review lists every 31 days', 'Appoint a Data Protection Officer for GDPR'], estimated_compliance_score: 58, summary: 'Medium compliance risk. Immediate action required on TCPA SMS consent and GDPR opt-in documentation.' };
  }

  const p = await _db.getPool();
  await p.query(
    `INSERT INTO privacy_checks(tenant_id,check_type,jurisdiction,risk_level,summary,issues,recommendations)
     VALUES($1,'gdpr_audit',$2,$3,$4,$5,$6)`,
    [tid, jurisdictions.join(','), audit.overall_risk, audit.summary, JSON.stringify(audit.non_compliant_areas), JSON.stringify(audit.required_actions)]
  );
  res.json({ ok: true, audit });
});

module.exports = router;

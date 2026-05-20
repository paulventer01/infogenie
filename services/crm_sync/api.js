const express = require('express');
const router  = express.Router();
const _db     = require('../../db');

const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

// ── Provider config ───────────────────────────────────────────────────────────
const PROVIDERS = {
  activecampaign: {
    label: 'ActiveCampaign',
    icon: '⚡',
    color: '#356AE6',
    configured: () => !!(process.env.ACTIVECAMPAIGN_API_KEY && process.env.ACTIVECAMPAIGN_BASE_URL),
    fields: ['ACTIVECAMPAIGN_API_KEY', 'ACTIVECAMPAIGN_BASE_URL']
  },
  convertkit: {
    label: 'ConvertKit',
    icon: '📬',
    color: '#FB6970',
    configured: () => !!process.env.CONVERTKIT_API_KEY,
    fields: ['CONVERTKIT_API_KEY']
  },
  mailchimp: {
    label: 'Mailchimp',
    icon: '🐵',
    color: '#FFE01B',
    textColor: '#000',
    configured: () => !!(process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_SERVER_PREFIX),
    fields: ['MAILCHIMP_API_KEY', 'MAILCHIMP_SERVER_PREFIX']
  }
};

// ── GET /providers ────────────────────────────────────────────────────────────
router.get('/providers', (req, res) => {
  const out = Object.entries(PROVIDERS).map(([id, p]) => ({
    id, label: p.label, icon: p.icon, color: p.color, textColor: p.textColor || '#fff',
    configured: p.configured(), fields: p.fields
  }));
  res.json({ ok: true, providers: out });
});

// ── POST /test ────────────────────────────────────────────────────────────────
router.post('/test', async (req, res) => {
  const provider = String(req.body?.provider || '').toLowerCase();
  if (!PROVIDERS[provider]) return _err(res, 400, `Unknown provider. Valid: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!PROVIDERS[provider].configured()) return res.json({ ok: false, configured: false, provider, error: `Missing env vars: ${PROVIDERS[provider].fields.join(', ')}` });

  try {
    if (provider === 'activecampaign') {
      const base = process.env.ACTIVECAMPAIGN_BASE_URL.replace(/\/$/, '');
      const r = await fetch(`${base}/api/3/accounts?limit=1`, {
        headers: { 'Api-Token': process.env.ACTIVECAMPAIGN_API_KEY },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      res.json({ ok: true, provider, configured: true, message: 'ActiveCampaign connected.' });

    } else if (provider === 'convertkit') {
      const r = await fetch(`https://api.convertkit.com/v3/account?api_key=${process.env.CONVERTKIT_API_KEY}`, { signal: AbortSignal.timeout(8000) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.message || d.error || `HTTP ${r.status}`);
      res.json({ ok: true, provider, configured: true, message: `ConvertKit connected — account: ${d.name || '(unnamed)'}` });

    } else if (provider === 'mailchimp') {
      const server = process.env.MAILCHIMP_SERVER_PREFIX;
      const r = await fetch(`https://${server}.api.mailchimp.com/3.0/`, {
        headers: { 'Authorization': `Bearer ${process.env.MAILCHIMP_API_KEY}` },
        signal: AbortSignal.timeout(8000)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || `HTTP ${r.status}`);
      res.json({ ok: true, provider, configured: true, message: `Mailchimp connected — account: ${d?.account_name || '(unnamed)'}` });
    }
  } catch(e) { res.json({ ok: false, provider, configured: true, error: e.message }); }
});

// ── POST /push ────────────────────────────────────────────────────────────────
// { provider, contacts: [{email, first_name?, last_name?, phone?, tags?[], list_id?}] }
router.post('/push', async (req, res) => {
  const provider = String(req.body?.provider || '').toLowerCase();
  const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  const listId   = String(req.body?.list_id || req.body?.form_id || '').trim();

  if (!PROVIDERS[provider]) return _err(res, 400, 'Unknown provider.');
  if (!PROVIDERS[provider].configured()) return _err(res, 503, `${PROVIDERS[provider].label} not configured — add the required API keys.`);
  if (!contacts.length) return _err(res, 400, 'contacts array required');

  const valid = contacts
    .filter(c => c?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email))
    .slice(0, 2000);
  if (!valid.length) return _err(res, 400, 'no valid email addresses in contacts');

  let ok = 0, failed = 0, errors = [];

  try {
    if (provider === 'activecampaign') {
      const base = process.env.ACTIVECAMPAIGN_BASE_URL.replace(/\/$/, '');
      for (const c of valid) {
        try {
          const body = {
            contact: {
              email: c.email,
              firstName: c.first_name || c.firstName || '',
              lastName: c.last_name || c.lastName || '',
              phone: c.phone || ''
            }
          };
          const r = await fetch(`${base}/api/3/contacts`, {
            method: 'POST',
            headers: { 'Api-Token': process.env.ACTIVECAMPAIGN_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000)
          });
          const d = await r.json();
          if (!r.ok && r.status !== 422) throw new Error(d?.message || `HTTP ${r.status}`);
          // Add to list if specified
          const contactId = d?.contact?.id || d?.contacts?.[0]?.id;
          if (listId && contactId) {
            await fetch(`${base}/api/3/contactLists`, {
              method: 'POST',
              headers: { 'Api-Token': process.env.ACTIVECAMPAIGN_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ contactList: { list: listId, contact: contactId, status: 1 } }),
              signal: AbortSignal.timeout(6000)
            });
          }
          ok++;
        } catch(e) { failed++; if (errors.length < 5) errors.push(`${c.email}: ${e.message}`); }
      }

    } else if (provider === 'convertkit') {
      if (!listId) return _err(res, 400, 'form_id required for ConvertKit — find it in your ConvertKit Forms settings.');
      for (const c of valid) {
        try {
          const body = {
            api_key: process.env.CONVERTKIT_API_KEY,
            email: c.email,
            first_name: c.first_name || c.firstName || '',
            fields: { last_name: c.last_name || c.lastName || '', phone: c.phone || '' },
            tags: Array.isArray(c.tags) ? c.tags.map(String) : []
          };
          const r = await fetch(`https://api.convertkit.com/v3/forms/${encodeURIComponent(listId)}/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000)
          });
          const d = await r.json();
          if (!r.ok || d.error) throw new Error(d?.message || d?.error || `HTTP ${r.status}`);
          ok++;
        } catch(e) { failed++; if (errors.length < 5) errors.push(`${c.email}: ${e.message}`); }
      }

    } else if (provider === 'mailchimp') {
      if (!listId) return _err(res, 400, 'list_id required for Mailchimp — find it in Audience Settings.');
      const server = process.env.MAILCHIMP_SERVER_PREFIX;
      // Use batch endpoint (up to 500 per call)
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500);
        try {
          const body = {
            members: chunk.map(c => ({
              email_address: c.email,
              status: 'subscribed',
              merge_fields: {
                FNAME: c.first_name || c.firstName || '',
                LNAME: c.last_name || c.lastName || '',
                PHONE: c.phone || ''
              }
            })),
            update_existing: true
          };
          const r = await fetch(`https://${server}.api.mailchimp.com/3.0/lists/${encodeURIComponent(listId)}/members`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${process.env.MAILCHIMP_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000)
          });
          const d = await r.json();
          ok += d?.new_members?.length || 0;
          ok += d?.updated_members?.length || 0;
          failed += d?.error_count || 0;
          if (d?.errors?.length) errors.push(...d.errors.slice(0, 3).map(e => `${e.email_address}: ${e.error}`));
        } catch(e) { failed += chunk.length; if (errors.length < 5) errors.push(e.message); }
      }
    }

    const status = failed === 0 ? 'ok' : (ok > 0 ? 'partial' : 'failed');
    if (_db.hasDb()) {
      await _db.getPool().query(
        `INSERT INTO crm_sync_logs (provider, contacts_total, contacts_ok, contacts_failed, status, error)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [provider, valid.length, ok, failed, status, errors.length ? errors.join('; ') : null]
      );
    }
    res.json({ ok: true, provider, pushed: ok, failed, total: valid.length, status, errors: errors.slice(0, 5) });

  } catch(e) { _err(res, 500, e.message); }
});

// ── GET /history ──────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  if (!_db.hasDb()) return res.json({ ok: true, history: [] });
  try {
    const { rows } = await _db.getPool().query(
      `SELECT id,provider,operation,contacts_total,contacts_ok,contacts_failed,status,error,created_at
       FROM crm_sync_logs ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ ok: true, history: rows });
  } catch(e) { _err(res, 500, e.message); }
});

module.exports = router;

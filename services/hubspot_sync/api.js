const express = require('express');
const _https = require('https');
const _db = require('../../db');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }

async function _hubspotRequest(method, path, body) {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token || /^_DUMMY/i.test(token)) return { ok:false, error:'HUBSPOT_PRIVATE_APP_TOKEN missing' };
  const payload = body ? JSON.stringify(body) : null;
  return await new Promise((resolve) => {
    const req = _https.request({
      hostname:'api.hubapi.com', path, method,
      headers: { 'Authorization':'Bearer '+token, 'Content-Type':'application/json',
                 ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { const j = d ? JSON.parse(d) : {};
        if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok:true, data:j });
        else resolve({ ok:false, status:r.statusCode, error: j.message || j.errors?.[0]?.message || `hubspot ${r.statusCode}` });
      } catch { resolve({ ok:false, error:'parse failed' }); }
    }); });
    req.on('error', e => resolve({ ok:false, error: e.message }));
    req.setTimeout(20000, () => req.destroy());
    if (payload) req.write(payload); req.end();
  });
}

function _splitName(full) {
  const p = String(full||'').trim().split(/\s+/);
  return { firstname: p[0]||'', lastname: p.slice(1).join(' ')||'' };
}

router.post('/test', async (req, res) => {
  const r = await _hubspotRequest('GET', '/crm/v3/objects/contacts?limit=1');
  if (!r.ok) return _err(res, 400, r.error);
  res.json({ ok:true, message:'HubSpot connection OK', sample_count: (r.data?.results||[]).length });
});

router.post('/push-lead', async (req, res) => {
  const lead = req.body?.lead || {};
  const { firstname, lastname } = _splitName(lead.name);
  const props = {
    firstname, lastname,
    email: lead.email || undefined,
    jobtitle: lead.title || undefined,
    company: lead.company || undefined,
    website: lead.company_domain || undefined,
    city: (lead.location||'').split(',')[0]?.trim() || undefined,
    industry: lead.company_industry || undefined,
    hs_lead_status: 'NEW',
    lifecyclestage: 'lead',
  };
  Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
  if (!props.email && !props.firstname) return _err(res, 400, 'lead must have email or name');
  const path = props.email ? `/crm/v3/objects/contacts?idProperty=email` : `/crm/v3/objects/contacts`;
  let r = await _hubspotRequest('POST', path, { properties: props });
  if (!r.ok && /already exists|conflict/i.test(r.error||'') && props.email) {
    const updPath = `/crm/v3/objects/contacts/${encodeURIComponent(props.email)}?idProperty=email`;
    r = await _hubspotRequest('PATCH', updPath, { properties: props });
  }
  if (!r.ok) {
    if (/scope/i.test(r.error||'')) return _err(res, 403, `${r.error} → Add the 'crm.objects.contacts.write' scope to your HubSpot Private App.`);
    return _err(res, 400, r.error);
  }
  res.json({ ok:true, contact_id: r.data?.id, action: r.data?.createdAt === r.data?.updatedAt ? 'created' : 'updated' });
});

router.post('/push-influencer', async (req, res) => {
  const inf = req.body?.influencer || {};
  const props = {
    firstname: inf.handle || inf.name || 'Creator',
    company: inf.platform || 'Influencer',
    jobtitle: `${inf.platform||''} Creator`.trim(),
    hs_lead_status: 'NEW',
    lifecyclestage: 'lead',
  };
  Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
  const r = await _hubspotRequest('POST', '/crm/v3/objects/contacts', { properties: props });
  if (!r.ok) {
    if (/scope/i.test(r.error||'')) return _err(res, 403, `${r.error} → Add the 'crm.objects.contacts.write' scope to your HubSpot Private App.`);
    return _err(res, 400, r.error);
  }
  res.json({ ok:true, contact_id: r.data?.id });
});

router.post('/push-bulk', async (req, res) => {
  const items = Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 50) : [];
  if (!items.length) return _err(res, 400, 'leads array required');
  const inputs = items.map(lead => {
    const { firstname, lastname } = _splitName(lead.name);
    const props = { firstname, lastname,
      email: lead.email || undefined, jobtitle: lead.title || undefined,
      company: lead.company || undefined, website: lead.company_domain || undefined,
      hs_lead_status:'NEW', lifecyclestage:'lead',
    };
    Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
    return lead.email ? { idProperty:'email', id: lead.email, properties: props } : { properties: props };
  }).filter(x => x.properties.email || x.properties.firstname);
  const r = await _hubspotRequest('POST', '/crm/v3/objects/contacts/batch/upsert', { inputs });
  if (!r.ok) {
    if (/scope/i.test(r.error||'')) return _err(res, 403, `${r.error} → Add the 'crm.objects.contacts.write' scope to your HubSpot Private App.`);
    return _err(res, 400, r.error);
  }
  res.json({ ok:true, pushed: (r.data?.results||[]).length, total_attempted: inputs.length });
});

router.get('/recent-contacts', async (req, res) => {
  const limit = Math.min(50, parseInt(req.query?.limit, 10) || 20);
  const r = await _hubspotRequest('GET', `/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,company,jobtitle,createdate,lifecyclestage&sort=-createdate`);
  if (!r.ok) return _err(res, 400, r.error);
  res.json({ ok:true, contacts: (r.data?.results||[]).map(c => ({ id:c.id, ...(c.properties||{}) })) });
});

module.exports = router;

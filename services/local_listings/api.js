const express = require('express');
const router = express.Router();
const _https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
function _safeAsync(h) { 
  return (req, res) => Promise.resolve(h(req, res)).catch(e => { 
    console.warn('[local-listings]', e.stack || e.message); 
    if (!res.headersSent) _err(res, 500, 'Internal server error'); 
  }); 
}
function _hasPerplexity() { 
  const k = process.env.PERPLEXITY_API_KEY; 
  return k && !/^_DUMMY/i.test(k); 
}

function _extractJson(txt) {
  const stripped = txt.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();
  const sources = [stripped, txt];
  for (const src of sources) {
    const start = src.indexOf('{');
    if (start === -1) continue;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { 
        depth--; 
        if (depth === 0) { 
          try { return JSON.parse(src.slice(start, i + 1)); } catch (_) { break; } 
        } 
      }
    }
  }
  return null;
}

const PLATFORMS = ['google', 'facebook', 'apple_maps', 'bing', 'yelp'];

async function _scrapePlatformListing(business, platform) {
  if (!_hasPerplexity()) return { error: 'PERPLEXITY_API_KEY required' };
  
  const prompt = `Search for the current business listing for "${business.business_name}" located at "${business.address}, ${business.city}, ${business.state} ${business.zip}" on the platform "${platform}".
  
You MUST return ONLY a valid JSON object — no prose, no markdown, no explanation before or after. 

The JSON must have this shape:
{
  "found": boolean,
  "name": "business name found",
  "address": "full address found",
  "phone": "phone number found",
  "website": "website URL found",
  "hours": { "monday": "...", "tuesday": "...", etc }
}

If not found, return {"found": false}. 
Be precise with the data found on the platform.`;

  return await new Promise(resolve => {
    const body = JSON.stringify({
      model: 'sonar-pro',
      temperature: 0.1,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = _https.request({
      hostname: 'api.perplexity.ai', path: '/chat/completions', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) return resolve({ error: String(j.error.message || j.error) });
          const txt = j?.choices?.[0]?.message?.content || '';
          const parsed = _extractJson(txt);
          if (!parsed) return resolve({ error: 'parse_failed' });
          resolve(parsed);
        } catch (e) { resolve({ error: 'parse_failed:' + e.message }); }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ error: 'Perplexity timeout' }); });
    req.write(body); req.end();
  });
}

function _diff(canonical, detected) {
  const discrepancies = {};
  const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  
  const fields = ['business_name', 'address', 'phone', 'website'];
  const mapping = { business_name: 'name', address: 'address', phone: 'phone', website: 'website' };

  for (const f of fields) {
    const cVal = canonical[f];
    const dVal = detected[mapping[f]];
    if (normalize(cVal) !== normalize(dVal)) {
      discrepancies[f] = { expected: cVal, detected: dVal };
    }
  }
  return discrepancies;
}

router.get('/profile', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'local_listings:get_profile' });
  const r = await _db.getPool().query('SELECT * FROM business_listing_profile WHERE tenant_id=$1', [tid]);
  res.json({ ok: true, profile: r.rows[0] || null });
}));

router.put('/profile', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'local_listings:put_profile' });
  const { business_name, address, city, state, zip, phone, website, hours } = req.body;
  
  if (!business_name || !address || !city || !state || !zip) {
    return _err(res, 400, 'Missing required NAP fields');
  }

  await _db.getPool().query(`
    INSERT INTO business_listing_profile (tenant_id, business_name, address, city, state, zip, phone, website, hours, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      business_name=EXCLUDED.business_name,
      address=EXCLUDED.address,
      city=EXCLUDED.city,
      state=EXCLUDED.state,
      zip=EXCLUDED.zip,
      phone=EXCLUDED.phone,
      website=EXCLUDED.website,
      hours=EXCLUDED.hours,
      updated_at=NOW()
  `, [tid, business_name, address, city, state, zip, phone, website, JSON.stringify(hours || {})]);

  res.json({ ok: true });
}));

router.get('/status', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'local_listings:status' });
  const r = await _db.getPool().query('SELECT * FROM listing_sync_status WHERE tenant_id=$1', [tid]);
  res.json({ ok: true, statuses: r.rows });
}));

router.post('/scan', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'local_listings:scan' });
  const profR = await _db.getPool().query('SELECT * FROM business_listing_profile WHERE tenant_id=$1', [tid]);
  const business = profR.rows[0];

  if (!business) return _err(res, 400, 'Business profile not set. Please configure NAP profile first.');

  const results = {};
  if (!_hasPerplexity()) {
    for (const p of PLATFORMS) {
      results[p] = { status: 'unknown', message: 'PERPLEXITY_API_KEY required' };
    }
  } else {
    const scans = await Promise.all(PLATFORMS.map(p => _scrapePlatformListing(business, p)));
    for (let i = 0; i < PLATFORMS.length; i++) {
      const p = PLATFORMS[i];
      const r = scans[i];
      
      let status = 'error';
      let discrepancies = null;
      let detected_data = null;

      if (r.error) {
        status = 'error';
      } else if (!r.found) {
        status = 'not_found';
      } else {
        detected_data = r;
        discrepancies = _diff(business, r);
        status = Object.keys(discrepancies).length > 0 ? 'mismatch' : 'synced';
      }
      
      results[p] = { status, detected_data, discrepancies };
    }
  }

  // Persist results
  for (const p of PLATFORMS) {
    const res_p = results[p];
    await _db.getPool().query(`
      INSERT INTO listing_sync_status (tenant_id, platform, status, detected_data, discrepancies, last_checked)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (tenant_id, platform) DO UPDATE SET
        status=EXCLUDED.status,
        detected_data=EXCLUDED.detected_data,
        discrepancies=EXCLUDED.discrepancies,
        last_checked=NOW()
    `, [tid, p, res_p.status, JSON.stringify(res_p.detected_data || null), JSON.stringify(res_p.discrepancies || null)]);
  }

  res.json({ ok: true, results });
}));

router.post('/status/:platform/resolve', _safeAsync(async (req, res) => {
  const tid = await _tenantCtx.resolveTenantId(req, { label: 'local_listings:resolve' });
  const { platform } = req.params;
  
  await _db.getPool().query(`
    UPDATE listing_sync_status 
    SET status='synced', discrepancies=NULL, last_checked=NOW()
    WHERE tenant_id=$1 AND platform=$2
  `, [tid, platform]);

  res.json({ ok: true });
}));

module.exports = router;

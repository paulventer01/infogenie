const express  = require('express');
const _https   = require('https');
const _crypto  = require('crypto');
const _db      = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }

// ── Helpers ──────────────────────────────────────────────────────────────────

function _sessionKey(ip, dateStr) {
  return _crypto.createHash('sha256').update(ip + '|' + dateStr).digest('hex').slice(0, 64);
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}

function _calcIntentScore(pages, visitCount, companySize) {
  let score = 0;
  const urls = (pages || []).map(p => (p.url || '').toLowerCase());
  const uniquePages = new Set(urls).size;
  score += Math.min(uniquePages, 5) * 8;             // up to 40: depth of browsing
  const highIntentKeywords = ['pricing', 'price', 'demo', 'contact', 'trial', 'book', 'plan', 'buy', 'start'];
  if (urls.some(u => highIntentKeywords.some(k => u.includes(k)))) score += 20;
  if (visitCount > 1) score += 15;                   // returning visitor
  if (visitCount > 3) score += 10;                   // frequent visitor
  const emp = parseInt(String(companySize).replace(/[^0-9]/g, ''), 10) || 0;
  if (emp >= 100) score += 15;                       // meaningful company size
  return Math.min(score, 100);
}

// ── IP → Company lookup via ipapi.co ────────────────────────────────────────

function _lookupIp(ip) {
  return new Promise(resolve => {
    if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1'
        || ip.startsWith('192.168.') || ip.startsWith('172.')) {
      return resolve(null);
    }
    const req = _https.request(
      { hostname: 'ipapi.co', path: `/api/v1/ip/${encodeURIComponent(ip)}/`, method: 'GET',
        headers: { 'User-Agent': 'InfoGenie/1.0' } },
      r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Fallback: ipapi.co public endpoint
function _lookupIpFallback(ip) {
  return new Promise(resolve => {
    if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip === '::1'
        || ip.startsWith('192.168.') || ip.startsWith('172.')) {
      return resolve(null);
    }
    const req = _https.request(
      { hostname: 'ipapi.co', path: `/${encodeURIComponent(ip)}/json/`, method: 'GET',
        headers: { 'User-Agent': 'InfoGenie/1.0' } },
      r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Apollo company search ────────────────────────────────────────────────────

function _apolloSearch(orgName) {
  return new Promise(resolve => {
    const key = process.env.APOLLO_API_KEY;
    if (!key || /^_DUMMY/i.test(key)) return resolve(null);
    const body = JSON.stringify({ q_organization_name: orgName, per_page: 1 });
    const req = _https.request(
      { hostname: 'api.apollo.io', path: '/api/v1/mixed_companies/search', method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-cache', 'x-api-key': key,
        } },
      r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const j = JSON.parse(d);
            const org = (j.organizations || j.accounts || [])[0];
            resolve(org || null);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// Strip ASN prefix (e.g. "AS15169 Google LLC" → "Google LLC")
function _cleanOrgName(raw) {
  if (!raw) return null;
  return raw.replace(/^AS\d+\s+/i, '').trim();
}

// Decide if an org name looks like a real company (not residential ISP)
function _isCompanyOrg(name) {
  if (!name) return false;
  const lowName = name.toLowerCase();
  const residentialKeywords = ['comcast', 'at&t', 'verizon', 'spectrum', 'xfinity', 'cox communications',
    'charter', 'centurylink', 'lumen', 'frontier', 'telecom', 'broadband', 'residential',
    'isp ', 'internet service', 'cable', 'wireless', 'mobile', 'vodafone', 'tmobile',
    't-mobile', 'sprint', 'boost', 'virgin', 'sky broadband', 'bt group', 'bt plc',
    'orange s.a', 'deutsche telekom', 'italia', 'telia', 'cloudflare', 'amazon',
    'google llc', 'microsoft corporation', 'digitalocean', 'linode', 'vultr', 'hetzner',
    'ovh', 'fastly', 'akamai', 'level 3', 'cogent', 'hurricane electric'];
  if (residentialKeywords.some(k => lowName.includes(k))) return false;
  return name.length >= 3 && name.length <= 100;
}

// ── Async enrichment: runs after ping returns ────────────────────────────────

async function _enrich(tenantId, sessionId, ip) {
  try {
    const ipData = await _lookupIpFallback(ip);
    if (!ipData || ipData.error) return;

    const rawOrg = ipData.org || ipData.organization || '';
    const ispName = rawOrg;
    const cleanOrg = _cleanOrgName(rawOrg);
    const isCompany = _isCompanyOrg(cleanOrg);

    let companyName = isCompany ? cleanOrg : null;
    let companyDomain = null;
    let companyIndustry = null;
    let companySize = null;
    let companyCountry = ipData.country_name || ipData.country || null;
    let companyLinkedin = null;
    let companyLogo = null;
    let companyDesc = null;

    if (isCompany && cleanOrg) {
      const apolloOrg = await _apolloSearch(cleanOrg);
      if (apolloOrg) {
        companyName     = apolloOrg.name || companyName;
        companyDomain   = (apolloOrg.website_url || '').replace(/^https?:\/\//,'').replace(/\//,'').toLowerCase() || null;
        companyIndustry = apolloOrg.industry || apolloOrg.primary_industry || null;
        companySize     = apolloOrg.estimated_num_employees
          ? String(apolloOrg.estimated_num_employees)
          : (apolloOrg.employee_count ? String(apolloOrg.employee_count) : null);
        companyCountry  = apolloOrg.country || companyCountry;
        companyLinkedin = apolloOrg.linkedin_url || null;
        companyLogo     = apolloOrg.logo_url || null;
        companyDesc     = apolloOrg.short_description || null;
      }
    }

    if (!companyLogo && companyDomain) {
      companyLogo = `https://logo.clearbit.com/${companyDomain}`;
    }

    if (!_db.hasDb()) return;
    const pool = _db.getPool();

    // Fetch current session pages to recalculate intent
    const cur = await pool.query('SELECT pages, visit_count FROM visitor_sessions WHERE id=$1 AND tenant_id=$2', [sessionId, tenantId]);
    const pages = cur.rows[0]?.pages || [];
    const visitCount = cur.rows[0]?.visit_count || 1;
    const intentScore = _calcIntentScore(pages, visitCount, companySize);

    await pool.query(`
      UPDATE visitor_sessions SET
        isp_name=$1, company_name=$2, company_domain=$3, company_industry=$4,
        company_size=$5, company_country=$6, company_linkedin=$7, company_logo=$8,
        company_description=$9, is_company=$10, enriched=TRUE, intent_score=$11
      WHERE id=$12 AND tenant_id=$13
    `, [ispName, companyName, companyDomain, companyIndustry, companySize, companyCountry,
        companyLinkedin, companyLogo, companyDesc, isCompany, intentScore, sessionId, tenantId]);
  } catch (e) {
    console.warn('[visitor-intel] enrichment error:', e.message);
  }
}

// ── CORS helper (ping is called cross-origin from user's customer sites) ─────

function _cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Public: POST /ping — tracking pixel endpoint ─────────────────────────────
// No auth required. Token in body identifies the tenant.

router.options('/ping', (req, res) => {
  _cors(res);
  res.sendStatus(204);
});

router.post('/ping', async (req, res) => {
  _cors(res);
  res.json({ ok: true });   // respond immediately, enrich async

  try {
    const { t: token, p: pageUrl, n: pageTitle } = req.body || {};
    if (!token || typeof token !== 'string') return;

    if (!_db.hasDb()) return;
    const pool = _db.getPool();

    // Resolve tenant from tracking token
    const tokRow = await pool.query('SELECT tenant_id FROM visitor_tracking_tokens WHERE token=$1', [token]);
    if (!tokRow.rows.length) return;
    const tenantId = tokRow.rows[0].tenant_id;

    // Determine visitor IP — trust first hop of XFF (we're behind a proxy in prod)
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
             || req.socket.remoteAddress
             || 'unknown';

    const sessionKey = _sessionKey(ip, _today());
    const safeUrl    = String(pageUrl  || '').slice(0, 500);
    const safeTitle  = String(pageTitle || '').slice(0, 200);
    const pageEntry  = { url: safeUrl, title: safeTitle, ts: new Date().toISOString() };

    // Upsert session — increment visit if page already seen today, else append
    const existing = await pool.query(
      'SELECT id, pages, visit_count, enriched FROM visitor_sessions WHERE tenant_id=$1 AND session_key=$2',
      [tenantId, sessionKey]
    );

    let sessionId;
    if (existing.rows.length) {
      const row   = existing.rows[0];
      const pages = Array.isArray(row.pages) ? row.pages : [];
      const alreadySeen = pages.some(p => p.url === safeUrl);
      const newPages = alreadySeen ? pages : [...pages, pageEntry];
      const visitCount = row.visit_count + (alreadySeen ? 0 : 1);
      const score = _calcIntentScore(newPages, visitCount, null);

      await pool.query(`
        UPDATE visitor_sessions SET pages=$1, visit_count=$2, last_seen=NOW(), intent_score=$3
        WHERE id=$4
      `, [JSON.stringify(newPages), visitCount, score, row.id]);
      sessionId = row.id;

      // Re-enrich only if not yet enriched
      if (!row.enriched) _enrich(tenantId, sessionId, ip).catch(() => {});
    } else {
      const ins = await pool.query(`
        INSERT INTO visitor_sessions (tenant_id, session_key, ip, pages, visit_count, intent_score)
        VALUES ($1,$2,$3,$4,1,$5)
        ON CONFLICT (tenant_id, session_key) DO UPDATE SET last_seen=NOW()
        RETURNING id
      `, [tenantId, sessionKey, ip, JSON.stringify([pageEntry]), 0]);
      sessionId = ins.rows[0]?.id;
      if (sessionId) _enrich(tenantId, sessionId, ip).catch(() => {});
    }
  } catch (e) {
    console.warn('[visitor-intel] ping error:', e.message);
  }
});

// ── Authenticated routes ─────────────────────────────────────────────────────

// GET /token — get or create tracking token for this tenant
router.get('/token', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:token');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: true, token: 'DEMO_TOKEN_NO_DB', note: 'Database not connected.' });

    const pool = _db.getPool();
    await pool.query(
      'INSERT INTO visitor_tracking_tokens (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
      [tid]
    );
    const row = await pool.query('SELECT token FROM visitor_tracking_tokens WHERE tenant_id=$1', [tid]);
    res.json({ ok: true, token: row.rows[0]?.token || null });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /snippet — returns the JS snippet to embed, with the token and domain baked in
router.get('/snippet', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:snippet');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: false, error: 'Database not connected.' });

    const pool = _db.getPool();
    await pool.query(
      'INSERT INTO visitor_tracking_tokens (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING',
      [tid]
    );
    const row = await pool.query('SELECT token FROM visitor_tracking_tokens WHERE tenant_id=$1', [tid]);
    const token = row.rows[0]?.token;

    const host = process.env.PUBLIC_URL
      || `https://${process.env.REPL_SLUG || ''}.replit.app`;

    const snippet = `<!-- InfoGenie Visitor Intelligence -->
<script>
(function(){
  var _igt='${token}';
  var _igp=window.location.href;
  var _ign=document.title;
  fetch('${host}/api/visitor-intel/ping',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({t:_igt,p:_igp,n:_ign}),
    keepalive:true
  }).catch(function(){});
})();
</script>`;

    res.json({ ok: true, token, snippet, host });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /visitors — paginated list with filters
router.get('/visitors', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:visitors');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: true, visitors: [], total: 0, note: 'Database not connected.' });

    const pool   = _db.getPool();
    const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const intent = req.query.intent || 'all';   // all | high | warm | low
    const days   = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 7));
    const search = (req.query.q || '').toLowerCase().trim();

    let where = [`tenant_id=$1`, `last_seen >= NOW() - INTERVAL '${days} days'`];
    const params = [tid];
    let pi = 2;

    if (intent === 'high') { where.push(`intent_score >= 70`); }
    else if (intent === 'warm') { where.push(`intent_score >= 40 AND intent_score < 70`); }
    else if (intent === 'low') { where.push(`intent_score < 40`); }

    if (search) {
      params.push(`%${search}%`);
      where.push(`(LOWER(COALESCE(company_name,'')) LIKE $${pi} OR LOWER(COALESCE(company_domain,'')) LIKE $${pi} OR LOWER(COALESCE(company_industry,'')) LIKE $${pi})`);
      pi++;
    }

    const whereStr = where.join(' AND ');
    const countRes = await pool.query(`SELECT COUNT(*) FROM visitor_sessions WHERE ${whereStr}`, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const rows = await pool.query(`
      SELECT id, company_name, company_domain, company_industry, company_size, company_country,
             company_linkedin, company_logo, company_description, isp_name, is_company,
             pages, visit_count, intent_score, first_seen, last_seen, enriched
      FROM visitor_sessions
      WHERE ${whereStr}
      ORDER BY intent_score DESC, last_seen DESC
      LIMIT $${pi} OFFSET $${pi+1}
    `, params);

    res.json({ ok: true, visitors: rows.rows, total, limit, offset });
  } catch (e) { _err(res, 500, e.message); }
});

// GET /stats — summary stats
router.get('/stats', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:stats');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return res.json({ ok: true, today: 0, high_intent: 0, week: 0, pages_today: 0 });

    const pool = _db.getPool();
    const [todayRes, weekRes, highRes, pagesRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM visitor_sessions WHERE tenant_id=$1 AND last_seen >= NOW() - INTERVAL '1 day'`, [tid]),
      pool.query(`SELECT COUNT(*) FROM visitor_sessions WHERE tenant_id=$1 AND last_seen >= NOW() - INTERVAL '7 days'`, [tid]),
      pool.query(`SELECT COUNT(*) FROM visitor_sessions WHERE tenant_id=$1 AND intent_score >= 70 AND last_seen >= NOW() - INTERVAL '7 days'`, [tid]),
      pool.query(`SELECT COALESCE(SUM(jsonb_array_length(pages)),0) as pg FROM visitor_sessions WHERE tenant_id=$1 AND last_seen >= NOW() - INTERVAL '1 day'`, [tid]),
    ]);

    res.json({
      ok: true,
      today:       parseInt(todayRes.rows[0].count, 10),
      week:        parseInt(weekRes.rows[0].count, 10),
      high_intent: parseInt(highRes.rows[0].count, 10),
      pages_today: parseInt(pagesRes.rows[0].pg, 10),
    });
  } catch (e) { _err(res, 500, e.message); }
});

// DELETE /visitors/:id
router.delete('/visitors/:id', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:delete');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return _err(res, 503, 'Database not connected.');

    const pool = _db.getPool();
    await pool.query('DELETE FROM visitor_sessions WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.json({ ok: true });
  } catch (e) { _err(res, 500, e.message); }
});

// POST /visitors/:id/enroll — future: enroll into Journey or Dynamic Audience
router.post('/visitors/:id/enroll', async (req, res) => {
  try {
    const tid = await _tid(req, 'visitor-intel:enroll');
    if (!tid) return _err(res, 400, 'no_tenant');
    if (!_db.hasDb()) return _err(res, 503, 'Database not connected.');

    const pool = _db.getPool();
    const row = await pool.query(
      'SELECT company_name, company_domain FROM visitor_sessions WHERE id=$1 AND tenant_id=$2',
      [req.params.id, tid]
    );
    if (!row.rows.length) return _err(res, 404, 'Session not found');

    const { company_name, company_domain } = row.rows[0];
    res.json({
      ok: true,
      company_name,
      company_domain,
      message: `${company_name || company_domain || 'Visitor'} queued for outreach. Configure the Journey or Audience in Reach → Journey Builder.`,
    });
  } catch (e) { _err(res, 500, e.message); }
});

module.exports = router;

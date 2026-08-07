// Google Ads search-term sync + negative keyword suggestions.

const _https = require('https');
const _db = require('../../db');
const { resolveGoogleAdsCredentials } = require('../credentials/vault');
const { chatForCategory } = require('../ai/chat_router');

const _accessTokenCache = new Map();

async function _refreshAccessToken(creds) {
  const cached = _accessTokenCache.get(creds.refreshToken);
  if (cached && Date.now() < cached.expiresAt - 60000) return { ok: true, token: cached.token };
  const body = `client_id=${encodeURIComponent(creds.clientId)}&client_secret=${encodeURIComponent(creds.clientSecret)}&refresh_token=${encodeURIComponent(creds.refreshToken)}&grant_type=refresh_token`;
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (r.statusCode >= 200 && r.statusCode < 300 && j.access_token) {
            _accessTokenCache.set(creds.refreshToken, { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 });
            resolve({ ok: true, token: j.access_token });
          } else resolve({ ok: false, error: j.error_description || j.error || `oauth ${r.statusCode}` });
        } catch { resolve({ ok: false, error: 'oauth parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(15000, () => req.destroy());
    req.write(body); req.end();
  });
}

async function _gaQuery(creds, query) {
  const tok = await _refreshAccessToken(creds);
  if (!tok.ok) return { ok: false, error: tok.error };
  const cid = String(creds.customerId || '').replace(/[^0-9]/g, '');
  const body = JSON.stringify({ query });
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': `Bearer ${tok.token}`,
    'developer-token': creds.devToken,
  };
  const lc = creds.loginCustomerId;
  if (lc && !/^_DUMMY/i.test(lc)) headers['login-customer-id'] = String(lc).replace(/[^0-9]/g, '');
  return await new Promise(resolve => {
    const req = _https.request({
      hostname: 'googleads.googleapis.com',
      path: `/v17/customers/${cid}/googleAds:searchStream`,
      method: 'POST', headers,
    }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => {
        try {
          const j = d ? JSON.parse(d) : {};
          if (r.statusCode >= 200 && r.statusCode < 300) resolve({ ok: true, data: j });
          else {
            const arr = Array.isArray(j) ? j : [j];
            const msg = arr[0]?.error?.message || `google ads ${r.statusCode}`;
            resolve({ ok: false, error: msg });
          }
        } catch { resolve({ ok: false, error: 'parse failed' }); }
      });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => req.destroy());
    req.write(body); req.end();
  });
}

function _flat(rows, picker) {
  const out = [];
  for (const stream of rows) for (const r of (stream.results || [])) out.push(picker(r));
  return out;
}

async function syncSearchTerms(tenantId, userId, windowDays = 30) {
  if (!_db.hasDb()) return { ok: false, error: 'database not configured' };
  const c = await resolveGoogleAdsCredentials(userId);
  if (!c.ok) return { ok: false, error: c.error, note: 'Connect Google Ads in Settings → Integrations' };

  const preset = windowDays <= 7 ? 'LAST_7_DAYS' : windowDays <= 14 ? 'LAST_14_DAYS' : 'LAST_30_DAYS';
  const q = `SELECT search_term_view.search_term, campaign.name, segments.search_term_match_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE segments.date DURING ${preset} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT 200`;
  const r = await _gaQuery(c.creds, q);
  if (!r.ok) return { ok: false, error: r.error };

  const pool = _db.getPool();
  let upserted = 0;
  for (const row of _flat(r.data || [], x => x)) {
    const term = row.searchTermView?.searchTerm || row.search_term_view?.search_term;
    if (!term) continue;
    const camp = row.campaign?.name || null;
    const m = row.metrics || {};
    const cost = (parseInt(m.costMicros || 0, 10) / 1e6);
    await pool.query(`
      INSERT INTO lead_intel_search_terms (tenant_id, platform, campaign_name, search_term, match_type, impressions, clicks, cost, conversions, window_days, synced_at)
      VALUES ($1,'google',$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (tenant_id, platform, search_term, campaign_name, window_days)
      DO UPDATE SET impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, cost=EXCLUDED.cost,
                    conversions=EXCLUDED.conversions, match_type=EXCLUDED.match_type, synced_at=now()
    `, [
      tenantId, camp, String(term).slice(0, 250),
      String(row.segments?.searchTermMatchType || row.segments?.search_term_match_type || '').slice(0, 40),
      parseInt(m.impressions || 0, 10), parseInt(m.clicks || 0, 10),
      cost, parseFloat(m.conversions || 0), windowDays,
    ]);
    upserted++;
  }
  return { ok: true, synced: upserted, windowDays };
}

async function suggestNegativeKeywords(tenantId, userId) {
  if (!_db.hasDb()) return { ok: false, error: 'database not configured' };
  const pool = _db.getPool();
  const terms = await pool.query(`
    SELECT id, search_term, campaign_name, cost, clicks, conversions
    FROM lead_intel_search_terms
    WHERE tenant_id=$1 AND cost > 5 AND (conversions IS NULL OR conversions < 0.5)
    ORDER BY cost DESC LIMIT 40
  `, [tenantId]);

  if (!terms.rows.length) {
    return { ok: true, suggested: 0, note: 'Sync search terms first, or no wasteful terms found.' };
  }

  const waste = terms.rows.map(t => ({
    term: t.search_term,
    campaign: t.campaign_name,
    spend: +t.cost,
    clicks: t.clicks,
    conversions: t.conversions,
  }));

  const prompt = `These Google Ads search terms spent money with few/no conversions. Suggest negative keywords (exact or phrase) to block waste.

Terms JSON:
${JSON.stringify(waste).slice(0, 6000)}

Return JSON: { "negatives": [ { "keyword": string, "reason": string, "estimated_waste": number } ] }`;

  const ai = await chatForCategory('analysis', [
    { role: 'system', content: 'You are a Google Ads specialist. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ], { tenantId, max_tokens: 900, response_format: { type: 'json_object' } });

  let negatives = [];
  if (ai?.content) {
    try {
      const j = JSON.parse(ai.content);
      negatives = Array.isArray(j.negatives) ? j.negatives : [];
    } catch { /* heuristic fallback below */ }
  }

  if (!negatives.length) {
    negatives = waste.slice(0, 10).map(w => ({
      keyword: w.term,
      reason: `Spent $${w.spend.toFixed(2)} with ${w.conversions || 0} conversions`,
      estimated_waste: w.spend,
    }));
  }

  let count = 0;
  for (const n of negatives.slice(0, 25)) {
    const kw = String(n.keyword || '').trim().slice(0, 120);
    if (!kw) continue;
    await pool.query(`
      INSERT INTO lead_intel_negative_suggestions (tenant_id, platform, keyword, reason, estimated_waste, status)
      VALUES ($1,'google',$2,$3,$4,'suggested')
      ON CONFLICT (tenant_id, platform, keyword)
      DO UPDATE SET reason=EXCLUDED.reason, estimated_waste=EXCLUDED.estimated_waste, created_at=now()
    `, [tenantId, kw, String(n.reason || '').slice(0, 500), Number(n.estimated_waste) || 0]);
    count++;
  }

  // Queue specialist review for high-waste negatives
  if (count > 0) {
    await pool.query(`
      INSERT INTO lead_intel_review_queue (tenant_id, item_type, title, summary, priority, meta)
      VALUES ($1,'negative_keywords',$2,$3,'high',$4)
    `, [
      tenantId,
      `${count} negative keyword suggestions ready`,
      'Review AI-suggested negatives before applying to Google Ads.',
      JSON.stringify({ count }),
    ]);
  }

  return { ok: true, suggested: count };
}

module.exports = { syncSearchTerms, suggestNegativeKeywords };

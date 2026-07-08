// Customer 360 — read-only aggregation of everything InfoGenie already knows
// about this tenant's brand + customers/leads, stitched into one dashboard.
// No new tables: this service purely joins/reads brand_foundation, voc_runs,
// landing_page_leads, linksell_leads, audience_segments, brand_deals and the
// qualified_leads KV blob that already exist for other tiers.
const express = require('express');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const _tkvScope = require('../tenants/kv_scope');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

async function _safeQuery(p, sql, params, fallbackRows = []) {
  try {
    const r = await p.query(sql, params);
    return r.rows;
  } catch (e) {
    console.warn('[customer-360] query failed:', e.message);
    return fallbackRows;
  }
}

router.get('/overview', async (req, res) => {
  if (!_db.hasDb()) return _err(res, 503, 'no-db');
  const tid = await _tid(req, 'customer360:overview');
  if (!tid) return _err(res, 400, 'no_tenant');

  const p = _db.getPool();

  const [
    foundationRows, vocRows, lpLeadRows, lpCountRows,
    linksellLeadRows, linksellCountRows, segmentRows, dealRows,
  ] = await Promise.all([
    _safeQuery(p, `SELECT * FROM brand_foundation WHERE tenant_id=$1 LIMIT 1`, [tid]),
    _safeQuery(p, `SELECT id, brand, mention_count, themes, summary, generated_by, created_at
                   FROM voc_runs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [tid]),
    _safeQuery(p, `SELECT id, name, email, message, created_at FROM landing_page_leads
                   WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]),
    _safeQuery(p, `SELECT COUNT(*)::int AS n FROM landing_page_leads WHERE tenant_id=$1`, [tid], [{ n: 0 }]),
    _safeQuery(p, `SELECT id, name, email, source, created_at FROM linksell_leads
                   WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]),
    _safeQuery(p, `SELECT COUNT(*)::int AS n FROM linksell_leads WHERE tenant_id=$1`, [tid], [{ n: 0 }]),
    _safeQuery(p, `SELECT id, name, member_count, enabled, last_evaluated_at FROM audience_segments
                   WHERE tenant_id=$1 ORDER BY member_count DESC LIMIT 10`, [tid]),
    _safeQuery(p, `SELECT id, brand_name, status, offered_rate, negotiated_rate, currency, created_at
                   FROM brand_deals WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]),
  ]);

  let qualifiedLeads = [];
  try {
    const v = await _db.kvGet(_tkvScope.tkey('qualified_leads', tid), undefined);
    if (Array.isArray(v)) qualifiedLeads = v;
  } catch (e) { console.warn('[customer-360] kv read failed:', e.message); }

  const foundation = foundationRows[0] || null;
  const vocRun = vocRows[0] || null;

  const recent = [
    ...lpLeadRows.map(r => ({
      id: `lp-${r.id}`, name: r.name || '(no name)', email: r.email || '',
      source: 'Landing Page', detail: r.message || '', at: r.created_at,
    })),
    ...linksellLeadRows.map(r => ({
      id: `ls-${r.id}`, name: r.name || '(no name)', email: r.email || '',
      source: `Link-in-Bio (${r.source || 'optin'})`, detail: '', at: r.created_at,
    })),
    ...qualifiedLeads.map(l => ({
      id: l.id, name: l.name || '(no name)', email: l.email || '',
      source: `Qualified Lead${l.source ? ` — ${l.source}` : ''}`,
      detail: l.qualification ? `${l.qualification.tier || ''} tier · score ${l.qualification.score ?? '—'}` : '',
      at: l.qualifiedAt ? new Date(l.qualifiedAt).toISOString() : null,
    })),
  ]
    .filter(r => r.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 15);

  const leadTotals = {
    landing_pages: lpCountRows[0]?.n || 0,
    link_in_bio: linksellCountRows[0]?.n || 0,
    qualified: qualifiedLeads.length,
  };
  leadTotals.total = leadTotals.landing_pages + leadTotals.link_in_bio + leadTotals.qualified;

  const qualifiedByTier = qualifiedLeads.reduce((acc, l) => {
    const tier = l?.qualification?.tier || 'unscored';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});

  res.json({
    ok: true,
    brand: foundation ? {
      has_data: !!(foundation.icp_name || foundation.positioning_statement || foundation.purpose_why),
      icp_name: foundation.icp_name || '',
      icp_role: foundation.icp_role || '',
      icp_pain: foundation.icp_pain || '',
      icp_dream_outcome: foundation.icp_dream_outcome || '',
      positioning_statement: foundation.positioning_statement || '',
      purpose_why: foundation.purpose_why || '',
      voice_tone_warm: foundation.voice_tone_warm,
      voice_tone_witty: foundation.voice_tone_witty,
      voice_tone_bold: foundation.voice_tone_bold,
      updated_at: foundation.updated_at,
    } : { has_data: false },
    voice_of_customer: vocRun ? {
      brand: vocRun.brand,
      mention_count: vocRun.mention_count,
      themes: Array.isArray(vocRun.themes) ? vocRun.themes.slice(0, 6) : [],
      summary: vocRun.summary || '',
      source: vocRun.generated_by || 'unknown',
      created_at: vocRun.created_at,
    } : null,
    leads: {
      totals: leadTotals,
      qualified_by_tier: qualifiedByTier,
      recent,
    },
    audience_segments: segmentRows.map(s => ({
      id: s.id, name: s.name, member_count: s.member_count,
      enabled: s.enabled, last_evaluated_at: s.last_evaluated_at,
    })),
    brand_deals: dealRows.map(d => ({
      id: d.id, brand_name: d.brand_name, status: d.status,
      offered_rate: d.offered_rate, negotiated_rate: d.negotiated_rate,
      currency: d.currency, created_at: d.created_at,
    })),
  });
});

module.exports = router;

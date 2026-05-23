// Dynamic Audiences — rule evaluation engine.
//
// A "segment" is { match: 'all'|'any'|'none', conditions: [Condition, ...] }
// where each Condition is one of:
//   { type:'property', field:'<hubspot_prop>', op:'eq|neq|contains|gt|lt|exists', value }
//   { type:'event',    event:'<event_name>',   op:'happened|not_happened|count_gt|count_lt', value, days }
//   { type:'commerce', field:'total_purchases|last_purchase_days|aov', op, value }
//   { type:'engagement', metric:'opened_email|clicked_email|page_visited',
//                       op:'happened|not_happened', days, value }
//   { type:'ai_source', source:'chatgpt|perplexity|gemini|claude|copilot|googleAi', days }
//
// A "contact" coming into evaluateContact() is a normalised shape:
//   { id, email, props:{...hubspot_properties}, events:[{name, ts, count}],
//     commerce:{ total_purchases, last_purchase_at, aov },
//     engagement:{ opened_at, clicked_at, pages_visited:[] },
//     ai_referrers:{ chatgpt:bool, perplexity:bool, ... } }
//
// Phase 1 ships the rule engine + a HubSpot-contact preview (live count). Real-
// time evaluation against Amplitude events arrives in Phase 2.

const _db = require('../../db');

function _toDate(v) { try { return v ? new Date(v) : null; } catch { return null; } }
function _daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - Number(n||0)); return d; }

function _evalCondition(cond, contact) {
  if (!cond || !cond.type) return false;
  const props = contact.props || {};
  const ev    = contact.events || [];
  const com   = contact.commerce || {};
  const eng   = contact.engagement || {};
  const ai    = contact.ai_referrers || {};

  switch (cond.type) {
    case 'property': {
      const v = props[cond.field];
      switch (cond.op) {
        case 'exists':   return v !== undefined && v !== null && v !== '';
        case 'eq':       return String(v ?? '').toLowerCase() === String(cond.value ?? '').toLowerCase();
        case 'neq':      return String(v ?? '').toLowerCase() !== String(cond.value ?? '').toLowerCase();
        case 'contains': return String(v ?? '').toLowerCase().includes(String(cond.value ?? '').toLowerCase());
        case 'gt':       return Number(v) > Number(cond.value);
        case 'lt':       return Number(v) < Number(cond.value);
        default:         return false;
      }
    }
    case 'event': {
      const since = cond.days ? _daysAgo(cond.days) : null;
      const matching = ev.filter(e => e.name === cond.event && (!since || _toDate(e.ts) >= since));
      const totalCount = matching.reduce((s,e) => s + (Number(e.count) || 1), 0);
      switch (cond.op) {
        case 'happened':     return matching.length > 0;
        case 'not_happened': return matching.length === 0;
        case 'count_gt':     return totalCount > Number(cond.value || 0);
        case 'count_lt':     return totalCount < Number(cond.value || 0);
        default:             return false;
      }
    }
    case 'commerce': {
      const map = {
        total_purchases:    Number(com.total_purchases || 0),
        aov:                Number(com.aov || 0),
        last_purchase_days: com.last_purchase_at
          ? Math.floor((Date.now() - _toDate(com.last_purchase_at).getTime()) / 86400000)
          : 99999,
      };
      const v = map[cond.field];
      if (v === undefined) return false;
      switch (cond.op) {
        case 'eq': return v === Number(cond.value);
        case 'gt': return v >  Number(cond.value);
        case 'lt': return v <  Number(cond.value);
        default:   return false;
      }
    }
    case 'engagement': {
      const since = cond.days ? _daysAgo(cond.days) : null;
      const stamps = {
        opened_email:  eng.opened_at  ? [_toDate(eng.opened_at)]  : [],
        clicked_email: eng.clicked_at ? [_toDate(eng.clicked_at)] : [],
        page_visited:  (eng.pages_visited || [])
          .filter(p => !cond.value || (p.url || '').includes(cond.value))
          .map(p => _toDate(p.ts)),
      }[cond.metric] || [];
      const recent = stamps.filter(d => d && (!since || d >= since));
      return cond.op === 'happened' ? recent.length > 0 : recent.length === 0;
    }
    case 'ai_source': {
      const since = cond.days ? _daysAgo(cond.days) : null;
      const hit = ai[cond.source];
      if (typeof hit === 'boolean') return hit;
      if (hit && hit.last_seen) return !since || _toDate(hit.last_seen) >= since;
      return false;
    }
    default: return false;
  }
}

function evaluateContact(rules, contact) {
  if (!rules || !Array.isArray(rules.conditions) || rules.conditions.length === 0) return false;
  const results = rules.conditions.map(c => _evalCondition(c, contact));
  switch ((rules.match || 'all').toLowerCase()) {
    case 'any':  return results.some(Boolean);
    case 'none': return results.every(r => !r);
    case 'all':
    default:     return results.every(Boolean);
  }
}

// HubSpot-backed live preview. Pulls a sample of contacts (capped) and counts
// how many match the rules right now. In Phase 2 this is replaced with a
// proper Postgres-backed contact mirror that supports full counts.
async function previewSegmentLive(rules, opts = {}) {
  const limit = Math.min(Number(opts.limit) || 100, 100);
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const out = { ok:true, sampleSize:0, matches:0, source:'unknown', sampleMatches:[] };

  if (!token) {
    // Synthetic fallback so the UI can still demo the rule logic.
    const synth = _syntheticContacts(60);
    const matched = synth.filter(c => evaluateContact(rules, c));
    out.sampleSize = synth.length;
    out.matches    = matched.length;
    out.source     = 'synthetic';
    out.sampleMatches = matched.slice(0, 10).map(c => ({ id:c.id, email:c.email }));
    out.note = 'HubSpot not connected — showing rule preview against 60 synthetic contacts.';
    return out;
  }

  try {
    const props = ['email','firstname','lastname','lifecyclestage','country','jobtitle',
                   'num_unique_pages_viewed','total_revenue','recent_conversion_date',
                   'hs_email_open_count','hs_email_click_count'];
    const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=${limit}&properties=${props.join(',')}`;
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j.results)) throw new Error(j.message || `hubspot ${r.status}`);

    const normalised = j.results.map(h => _hubspotToContact(h));
    const matched = normalised.filter(c => evaluateContact(rules, c));
    out.sampleSize = normalised.length;
    out.matches    = matched.length;
    out.source     = 'hubspot';
    out.sampleMatches = matched.slice(0, 10).map(c => ({ id:c.id, email:c.email }));
    out.note = `Sampled ${normalised.length} contacts from HubSpot. Phase 2 will scan your full contact list and re-evaluate in real time.`;
  } catch (err) {
    out.ok = false; out.error = err.message; out.source = 'hubspot_error';
  }
  return out;
}

function _hubspotToContact(h) {
  const p = h.properties || {};
  return {
    id:    String(h.id),
    email: p.email || '',
    props: p,
    events: [],
    commerce: {
      total_purchases:    Number(p.total_revenue ? 1 : 0),
      last_purchase_at:   p.recent_conversion_date || null,
      aov:                Number(p.total_revenue || 0),
    },
    engagement: {
      opened_at:    Number(p.hs_email_open_count  || 0) > 0 ? new Date().toISOString() : null,
      clicked_at:   Number(p.hs_email_click_count || 0) > 0 ? new Date().toISOString() : null,
      pages_visited: [],
    },
    ai_referrers: {},
  };
}

// Tiny in-memory contact pool for the no-HubSpot demo path. Deterministic so
// the preview count is stable across calls within a session.
function _syntheticContacts(n = 60) {
  const out = [];
  const stages = ['lead','marketingqualifiedlead','salesqualifiedlead','customer','evangelist'];
  const countries = ['US','GB','ZA','DE','AU','CA','IN'];
  for (let i = 0; i < n; i++) {
    const purchases = (i % 7 === 0) ? 2 : (i % 3 === 0 ? 1 : 0);
    out.push({
      id: `synth_${i}`,
      email: `demo${i}@example.com`,
      props: {
        lifecyclestage: stages[i % stages.length],
        country: countries[i % countries.length],
        jobtitle: i % 4 === 0 ? 'Marketing Manager' : 'Other',
      },
      events: [{ name:'page_view', ts:new Date(Date.now() - (i*86400000/2)).toISOString(), count:1+(i%5) }],
      commerce: {
        total_purchases: purchases,
        last_purchase_at: purchases > 0 ? new Date(Date.now() - (i*86400000)).toISOString() : null,
        aov: purchases > 0 ? 25 + (i*7 % 200) : 0,
      },
      engagement: {
        opened_at:  i % 2 === 0 ? new Date(Date.now() - i*86400000).toISOString() : null,
        clicked_at: i % 5 === 0 ? new Date(Date.now() - i*86400000).toISOString() : null,
        pages_visited: [],
      },
      ai_referrers: i % 11 === 0 ? { chatgpt:{ last_seen:new Date().toISOString() } } : {},
    });
  }
  return out;
}

// Persist the live count snapshot back to the segment row. tenantId is
// optional — when provided, the update is hard-scoped to that tenant so a
// caller can never accidentally write counts to another tenant's segment.
async function snapshotSegmentCount(segmentId, count, tenantId = null) {
  if (!_db.hasDb()) return;
  if (tenantId != null) {
    await _db.getPool().query(
      `UPDATE audience_segments SET member_count=$1, last_evaluated_at=now(), updated_at=now()
       WHERE id=$2 AND tenant_id=$3`,
      [Number(count) || 0, segmentId, tenantId]
    );
  } else {
    await _db.getPool().query(
      `UPDATE audience_segments SET member_count=$1, last_evaluated_at=now(), updated_at=now() WHERE id=$2`,
      [Number(count) || 0, segmentId]
    );
  }
}

module.exports = { evaluateContact, previewSegmentLive, snapshotSegmentCount };

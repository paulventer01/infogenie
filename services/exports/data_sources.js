// Centralised data fetchers for export reports. Each source returns a normalised
// shape: { title, generated_at, sections: [{ title, kind:'kv'|'table'|'text', ... }] }
const _db = require('../../db');

async function _searchIntelData(tid) {
  const out = { title: 'Search & AI Visibility Report', generated_at: new Date().toISOString(), sections: [] };
  if (!_db.hasDb()) return out;
  const pool = _db.getPool();

  const q = await pool.query(`
    SELECT q.id, q.query, q.brand, q.competitors, q.locale, q.last_run_at,
      (SELECT COUNT(*) FROM search_intel_llm_runs r WHERE r.query_id=q.id AND r.tenant_id=$1) AS run_count,
      (SELECT COUNT(*) FROM search_intel_llm_runs r WHERE r.query_id=q.id AND r.tenant_id=$1 AND r.brand_mentioned=true) AS hit_count
    FROM search_intel_queries q WHERE q.enabled=true AND q.tenant_id=$1 ORDER BY q.id ASC LIMIT 200`, [tid]);

  out.sections.push({
    kind: 'table', title: 'Tracked AI Visibility Prompts',
    headers: ['Prompt', 'Brand', 'Locale', 'Runs', 'Brand Cited', 'Hit Rate', 'Last Run'],
    rows: q.rows.map(r => [
      r.query, r.brand, r.locale, Number(r.run_count), Number(r.hit_count),
      r.run_count ? Math.round(100 * Number(r.hit_count) / Number(r.run_count)) + '%' : '0%',
      r.last_run_at ? new Date(r.last_run_at).toLocaleString() : 'never',
    ]),
  });

  const recent = await pool.query(`
    SELECT r.provider, r.brand_mentioned, r.brand_position, r.competitor_hits,
      r.response_text, r.ran_at, q.query
    FROM search_intel_llm_runs r JOIN search_intel_queries q ON q.id=r.query_id AND q.tenant_id=$1
    WHERE r.error IS NULL AND r.tenant_id=$1 ORDER BY r.ran_at DESC LIMIT 50`, [tid]);
  out.sections.push({
    kind: 'table', title: 'Latest AI Engine Runs (last 50)',
    headers: ['Time', 'Engine', 'Prompt', 'Cited?', 'Position', 'Competitors Named'],
    rows: recent.rows.map(r => [
      new Date(r.ran_at).toLocaleString(),
      r.provider,
      (r.query || '').slice(0, 80),
      r.brand_mentioned ? 'Yes' : 'No',
      r.brand_position ? '#' + r.brand_position : '-',
      Array.isArray(r.competitor_hits) ? r.competitor_hits.join(', ') : '',
    ]),
  });

  const pulse = await pool.query(`
    SELECT seed, locale, total_volume, suggestions, ran_at FROM search_intel_pulse_runs
    WHERE tenant_id=$1 ORDER BY ran_at DESC LIMIT 10`, [tid]);
  out.sections.push({
    kind: 'table', title: 'Recent Search Pulses',
    headers: ['Seed', 'Locale', 'Total Volume', '# Keywords', 'Time'],
    rows: pulse.rows.map(r => [
      r.seed, r.locale, Number(r.total_volume).toLocaleString(),
      Array.isArray(r.suggestions) ? r.suggestions.length : 0,
      new Date(r.ran_at).toLocaleString(),
    ]),
  });

  if (pulse.rows[0]) {
    const top = (pulse.rows[0].suggestions || []).slice(0, 25);
    out.sections.push({
      kind: 'table', title: `Top Keywords — "${pulse.rows[0].seed}" (${pulse.rows[0].locale})`,
      headers: ['Keyword', 'Monthly Volume', 'CPC', 'Competition', 'Intent'],
      rows: top.map(s => [
        s.keyword || '', (s.search_volume || 0).toLocaleString(),
        '$' + (s.cpc || 0).toFixed(2),
        s.competition || '-',
        s.intent || '-',
      ]),
    });
  }

  const imgs = await pool.query(`SELECT source_url, brands, objects, ran_at FROM search_intel_images WHERE tenant_id=$1 ORDER BY ran_at DESC LIMIT 25`, [tid]);
  out.sections.push({
    kind: 'table', title: 'Image / Logo Recognition (recent)',
    headers: ['When', 'Image URL', 'Brands Detected', 'Objects'],
    rows: imgs.rows.map(r => [
      new Date(r.ran_at).toLocaleString(),
      (r.source_url || '').slice(0, 80),
      (Array.isArray(r.brands) ? r.brands : []).map(b => b.name || b).slice(0, 5).join(', '),
      (Array.isArray(r.objects) ? r.objects : []).slice(0, 6).join(', '),
    ]),
  });

  return out;
}

async function _campaignsData(tid) {
  const out = { title: 'Campaign Performance Report', generated_at: new Date().toISOString(), sections: [] };
  try {
    // Per-workspace launch store: kv key `launches:t<tid>` (shape { launches: [] }).
    // Previously read the legacy global data/launches.json backup, which leaked
    // one workspace's launches into every report and is now removed.
    let launches = [];
    if (_db.hasDb() && tid != null) {
      const store = await _db.kvGet(`launches:t${tid}`, null);
      if (store && Array.isArray(store.launches)) launches = store.launches;
    }
    out.sections.push({
      kind: 'table', title: 'Tracked Campaign Launches',
      headers: ['Name', 'Channel', 'Status', 'Scheduled', 'Created'],
      rows: launches.slice(0, 100).map(l => [
        l.name || '-', l.channel || '-', l.status || '-',
        l.datetimeISO ? new Date(l.datetimeISO).toLocaleString() : '-',
        l.createdAt ? new Date(l.createdAt).toLocaleString() : '-',
      ]),
    });
  } catch (e) { /* no data yet */ }

  if (_db.hasDb()) {
    try {
      const opt = await _db.getPool().query(`SELECT campaign_id, platform, decision, reason, created_at FROM optimizer_decisions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 50`, [tid]);
      out.sections.push({
        kind: 'table', title: 'Recent Optimizer Decisions',
        headers: ['When', 'Platform', 'Campaign', 'Decision', 'Reason'],
        rows: opt.rows.map(r => [
          new Date(r.created_at).toLocaleString(),
          r.platform || '-', r.campaign_id || '-',
          r.decision || '-', (r.reason || '').slice(0, 80),
        ]),
      });
    } catch (e) { /* table may not exist */ }
  }

  return out;
}

const SOURCES = {
  'search-intel': _searchIntelData,
  'campaigns':    _campaignsData,
};

async function fetchSource(name, tid) {
  const fn = SOURCES[name];
  if (!fn) throw new Error('unknown source: ' + name);
  return await fn(tid);
}

module.exports = { fetchSource, SOURCES };

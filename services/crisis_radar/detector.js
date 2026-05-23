// Crisis Radar — detects mention-volume spikes + sentiment dips, persists
// snapshots and incidents, fires Slack alerts when configured.
const _db = require('../../db');
const _https = require('https');

let _running = false;
let _cronTimer = null;

async function _fetchMentions(brand, competitors, country) {
  // Calls our own /api/mentions endpoint via plain HTTP loopback so we reuse
  // all the DataForSEO + sentiment-classifier logic. Includes the
  // INFOGENIE_API_KEY header when set so the global auth gate (server.js
  // L107-119) lets the request through.
  const _http = require('http');
  const port = process.env.PORT || 5000;
  // 7-day rolling window per snapshot — gives smaller competitors enough surface
  // to register without flattening spike detection (each scan compares against
  // its 7-snapshot baseline, so relative deltas still surface volume changes).
  const body = JSON.stringify({ brand, competitors: competitors || [], country: country || 'US', days: 7 });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (process.env.INFOGENIE_API_KEY) headers['X-InfoGenie-Key'] = process.env.INFOGENIE_API_KEY;
  return await new Promise((resolve, reject) => {
    const req = _http.request({
      hostname: 'localhost', port, path: '/api/mentions', method: 'POST', headers,
    }, r => { let d=''; r.on('data', c => d += c); r.on('end', () => {
      try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('mentions returned non-JSON (status '+r.statusCode+')')); }
    }); });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('mentions timeout')));
    req.write(body); req.end();
  });
}

async function _sendSlack(text, blocks) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const body = JSON.stringify({ text, blocks });
    return await new Promise(resolve => {
      const r = _https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode < 300)); });
      r.on('error', () => resolve(false));
      r.setTimeout(8000, () => { r.destroy(); resolve(false); });
      r.write(body); r.end();
    });
  } catch { return false; }
}

function _summarise(mentionsResp, brand) {
  const mentions = (mentionsResp.mentions || []).filter(m => m.brand === brand);
  const sent = mentionsResp.byBrandSent?.[brand] || { positive: 0, neutral: 0, negative: 0 };
  const total = mentions.length;
  const neg = sent.negative || 0;
  const pos = sent.positive || 0;
  const neu = sent.neutral || 0;
  const negPct = total > 0 ? neg / total : 0;
  const sourceMap = {};
  mentions.forEach(m => { if (m.source) sourceMap[m.source] = (sourceMap[m.source] || 0) + 1; });
  const topSources = Object.entries(sourceMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>({source:s,count:c}));
  return { total, pos, neu, neg, negPct, topSources, sampleMentions: mentions.slice(0, 5) };
}

async function _runOne(w) {
  const pool = _db.getPool();
  const competitors = Array.isArray(w.competitors) ? w.competitors : [];
  const resp = await _fetchMentions(w.brand, competitors, w.country);
  if (!resp || !resp.ok) throw new Error(resp?.error || 'mentions-failed');
  const s = _summarise(resp, w.brand);

  const snap = await pool.query(`
    INSERT INTO crisis_snapshots (tenant_id, watchlist_id, brand, total_mentions, pos_count, neu_count, neg_count, neg_pct, top_sources)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [w.tenant_id, w.id, w.brand, s.total, s.pos, s.neu, s.neg, s.negPct, JSON.stringify(s.topSources)]);

  // Also persist Share-of-Voice rows: one per brand (target + each competitor)
  // sharing the same taken_at timestamp so the SoV chart can pivot easily.
  try {
    const allBrands = [w.brand, ...competitors];
    const takenAt = snap.rows[0].taken_at;
    for (const b of allBrands) {
      const bs = _summarise(resp, b);
      await pool.query(`
        INSERT INTO sov_snapshots (tenant_id, watchlist_id, target_brand, brand, mentions, pos_count, neu_count, neg_count, taken_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [w.tenant_id, w.id, w.brand, b, bs.total, bs.pos, bs.neu, bs.neg, takenAt]);
    }
  } catch (e) { console.warn('[sov] persist failed:', e.message); }

  // Baseline = mean of previous 7 snapshots (excluding this one).
  const base = await pool.query(`
    SELECT AVG(total_mentions)::float AS avg_total, AVG(neg_pct)::float AS avg_neg_pct, COUNT(*) AS n
    FROM (SELECT total_mentions, neg_pct FROM crisis_snapshots
          WHERE watchlist_id=$1 AND id<>$2 ORDER BY taken_at DESC LIMIT 7) sub`,
    [w.id, snap.rows[0].id]);
  const avgTotal = Number(base.rows[0].avg_total) || 0;
  const avgNegPct = Number(base.rows[0].avg_neg_pct) || 0;
  const n = Number(base.rows[0].n) || 0;
  const incidents = [];

  // Incident 1: mention-volume spike
  if (n >= 3 && avgTotal >= 3 && s.total > avgTotal * Number(w.spike_multiplier || 1.8)) {
    const sev = s.total > avgTotal * 3 ? 'high' : s.total > avgTotal * 2.2 ? 'med' : 'low';
    const headline = `📈 Mention spike for ${w.brand} — ${s.total} mentions (baseline ${avgTotal.toFixed(1)})`;
    const detail = `Last 24h has ${(s.total/Math.max(avgTotal,1)).toFixed(1)}× normal volume. Top sources: ${s.topSources.map(x=>x.source).join(', ')||'n/a'}.`;
    incidents.push({ kind:'spike', severity:sev, headline, detail, metric:s.total, baseline:avgTotal });
  }

  // Incident 2: sentiment dip
  if (n >= 3 && s.total >= 5 && s.negPct > Number(w.neg_pct_threshold || 0.35) && s.negPct > avgNegPct + 0.15) {
    const sev = s.negPct > 0.6 ? 'high' : s.negPct > 0.45 ? 'med' : 'low';
    const headline = `⚠ Negative sentiment surge for ${w.brand} — ${(s.negPct*100).toFixed(0)}% negative (was ${(avgNegPct*100).toFixed(0)}%)`;
    const detail = `${s.neg}/${s.total} mentions are negative. Sample: "${(s.sampleMentions.find(m=>m)||{}).title || ''}".`;
    incidents.push({ kind:'sentiment_dip', severity:sev, headline, detail, metric:s.negPct, baseline:avgNegPct });
  }

  const created = [];
  for (const inc of incidents) {
    const r = await pool.query(`
      INSERT INTO crisis_incidents (tenant_id, watchlist_id, brand, kind, severity, headline, detail, metric_value, baseline, sample_mentions)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [w.tenant_id, w.id, w.brand, inc.kind, inc.severity, inc.headline, inc.detail, inc.metric, inc.baseline, JSON.stringify(s.sampleMentions)]);
    const slackOk = await _sendSlack(inc.headline, [
      { type:'header', text:{ type:'plain_text', text:'🚨 Crisis Radar — ' + inc.severity.toUpperCase() } },
      { type:'section', text:{ type:'mrkdwn', text:`*${inc.headline}*\n${inc.detail || ''}` } },
    ]);
    if (slackOk) await pool.query(`UPDATE crisis_incidents SET slack_sent=true WHERE id=$1`, [r.rows[0].id]);
    // Tier 5: also fan out to Smart Alert Routing rules — stamp tenant_id so
    // dispatcher only matches rules in the same tenant.
    try {
      const { dispatchEvent } = require('../alert_routing/dispatcher');
      await dispatchEvent({ kind:'crisis_incident', brand:w.brand, severity:inc.severity,
        incident_kind:inc.kind, headline:inc.headline, detail:inc.detail, incident_id:r.rows[0].id,
        tenant_id: w.tenant_id });
    } catch (e) { console.warn('[alert-routing] dispatch failed:', e.message); }
    created.push(r.rows[0]);
  }
  return { snapshot: snap.rows[0], incidents: created };
}

async function runAll() {
  if (_running) return { skipped: 'already-running' };
  _running = true;
  try {
    if (!_db.hasDb()) return { ok:false, error:'no-db' };
    const pool = _db.getPool();
    const wl = await pool.query(`SELECT * FROM crisis_watchlist WHERE enabled=true ORDER BY id ASC`);
    const results = [];
    for (const w of wl.rows) {
      try { results.push({ brand:w.brand, ...(await _runOne(w)) }); }
      catch (e) { results.push({ brand:w.brand, error:e.message }); }
    }
    return { ok:true, ran: results.length, results };
  } finally { _running = false; }
}

function startCron(everyHours = 6) {
  if (_cronTimer) return;
  const tick = () => { runAll().catch(e => console.warn('[crisis-radar] tick failed:', e.message)); };
  _cronTimer = setInterval(tick, Math.max(1, everyHours) * 3600 * 1000);
  setTimeout(tick, 60 * 1000); // first run 1min after boot
}

module.exports = { runAll, startCron };

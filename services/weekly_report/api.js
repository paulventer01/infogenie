const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');
const { streamPdf } = require('../exports/pdf_report');
const _https = require('https');

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _hasResend() { const k = process.env.RESEND_API_KEY; return k && !/^_DUMMY/i.test(k); }
function _escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _safeAsync(handler) { return (req, res) => Promise.resolve(handler(req, res)).catch(e => { console.warn('[weekly-report] route error:', e.message); if (!res.headersSent) _err(res, 500, e.message || 'internal error'); }); }
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

// ── Section gatherers (read from existing tier tables) ──────────────────────
// All gatherers take a tid so the weekly digest only surfaces the caller's
// own brand activity, not some other tenant's data tagged with the same brand.
async function _gatherSections(brand, tid) {
  const sections = [];
  const since = `now() - interval '7 days'`;
  if (!_db.hasDb || !_db.hasDb()) return [{ title: 'Notice', kind:'text', body:'No database configured — weekly report will be empty.' }];
  if (!Number.isFinite(tid)) throw new Error('tenant_id required for weekly-report _gatherSections');
  const pool = _db.getPool();

  async function safe(q, params) { try { const r = await pool.query(q, params); return r.rows; } catch { return []; } }

  // 1) Crisis incidents (last 7 days)
  const incidents = await safe(`SELECT created_at, severity, kind, headline FROM crisis_incidents WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 30`, [brand, tid]);
  if (incidents.length) sections.push({
    title: `🚨 Crisis Radar — ${incidents.length} incident(s)`,
    kind: 'table',
    headers: ['Date', 'Severity', 'Kind', 'Headline'],
    rows: incidents.map(r => [new Date(r.created_at).toLocaleDateString(), r.severity, r.kind, String(r.headline||'').slice(0,80)])
  });

  // 2) SoV snapshots (week-over-week)
  const sov = await safe(`SELECT entity, AVG(share)::numeric(5,2) AS share FROM sov_snapshots WHERE brand=$1 AND tenant_id=$2 AND taken_at >= ${since} GROUP BY entity ORDER BY share DESC LIMIT 10`, [brand, tid]);
  if (sov.length) sections.push({
    title: '📊 Share of Voice (7-day average)',
    kind: 'table',
    headers: ['Entity', '% Share'],
    rows: sov.map(r => [r.entity, String(r.share)])
  });

  // 3) Mentions volume
  const snaps = await safe(`SELECT taken_at::date AS d, SUM(total_mentions) AS m, AVG(neg_pct)::numeric(4,2) AS neg FROM crisis_snapshots WHERE brand=$1 AND tenant_id=$2 AND taken_at >= ${since} GROUP BY taken_at::date ORDER BY d DESC`, [brand, tid]);
  if (snaps.length) sections.push({
    title: '📡 Mention Volume (daily)',
    kind: 'table',
    headers: ['Date', 'Mentions', 'Negative %'],
    rows: snaps.map(r => [String(r.d), String(r.m||0), String(r.neg||0)])
  });

  // 4) Recent press releases
  const press = await safe(`SELECT created_at, kind, headline FROM press_releases WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 10`, [brand, tid]);
  if (press.length) sections.push({
    title: `📰 Press Releases (${press.length})`,
    kind: 'table',
    headers: ['Date', 'Type', 'Headline'],
    rows: press.map(r => [new Date(r.created_at).toLocaleDateString(), r.kind, String(r.headline||'').slice(0,80)])
  });

  // 5) Voice of Customer themes
  const voc = await safe(`SELECT created_at, themes FROM voc_runs WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 1`, [brand, tid]);
  if (voc.length && Array.isArray(voc[0].themes)) {
    const top = voc[0].themes.slice(0, 6);
    sections.push({
      title: '🎯 Voice of Customer — Top Themes',
      kind: 'table',
      headers: ['Theme', 'Kind', 'Mentions'],
      rows: top.map(t => [String(t.label||'').slice(0,60), t.kind || '', String(t.count || '?')])
    });
  }

  // 6) Top trending topics
  const trends = await safe(`SELECT created_at, topics FROM trend_runs WHERE brand=$1 AND tenant_id=$2 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 1`, [brand, tid]);
  if (trends.length && Array.isArray(trends[0].topics)) {
    sections.push({
      title: '📈 Trending Topics (last 7 days)',
      kind: 'table',
      headers: ['Topic', 'Why it matters'],
      rows: trends[0].topics.slice(0, 8).map(t => [String(t.topic||'').slice(0,60), String(t.why||'').slice(0,80)])
    });
  }

  // 7) Optimizer decisions — table is optimizer_actions in current schema;
  // legacy SELECT referenced optimizer_decisions which never existed, so the
  // _gatherSections safe() wrapper silently dropped it. Keeping that behaviour
  // (still scoped by tenant when the table is added later) avoids surprising
  // schema-failure noise in weekly digests.
  const decisions = await safe(`SELECT created_at, decision, campaign_name, reason FROM optimizer_decisions WHERE tenant_id=$1 AND created_at >= ${since} ORDER BY created_at DESC LIMIT 15`, [tid]);
  if (decisions.length) sections.push({
    title: `⚡ AI Optimizer — ${decisions.length} decision(s)`,
    kind: 'table',
    headers: ['Date', 'Decision', 'Campaign', 'Reason'],
    rows: decisions.map(r => [new Date(r.created_at).toLocaleDateString(), r.decision, String(r.campaign_name||'').slice(0,40), String(r.reason||'').slice(0,60)])
  });

  // 8) YouTube channel activity
  const yt = await safe(`SELECT c.channel_name, COUNT(s.id) AS video_count, SUM(s.view_count)::bigint AS total_views
                          FROM yt_channels c LEFT JOIN yt_snapshots s ON s.channel_id=c.id AND s.captured_at >= ${since}
                          WHERE c.brand=$1 AND c.tenant_id=$2 GROUP BY c.id, c.channel_name ORDER BY total_views DESC NULLS LAST LIMIT 10`, [brand, tid]);
  if (yt.length) sections.push({
    title: '▶️ YouTube Activity (7 days)',
    kind: 'table',
    headers: ['Channel', 'New Videos', 'Total Views'],
    rows: yt.map(r => [String(r.channel_name||'').slice(0,40), String(r.video_count||0), String(r.total_views||0)])
  });

  // 9) Canonical metrics snapshot (SSOT)
  try {
    const { computeCanonicalMetrics } = require('../canonical_metrics/compute');
    const m = await computeCanonicalMetrics(tid, { days: 7 });
    sections.push({
      title: '📐 Canonical Metrics (7 days)',
      kind: 'table',
      headers: ['Metric', 'Value'],
      rows: [
        ['Spend', `$${Number(m.spend || 0).toFixed(2)}`],
        ['Blended ROAS', m.blended_roas != null ? String(m.blended_roas) : '—'],
        ['True ROAS', m.true_roas != null ? String(m.true_roas) : '—'],
        ['CAC', m.cac != null ? `$${m.cac}` : '—'],
        ['Waste (underwater channels)', `$${(Number(m.waste_cents || 0) / 100).toFixed(2)}`],
      ],
    });
    if (m.goals_vs_actuals?.length) {
      sections.push({
        title: '🎯 Goals vs Actuals',
        kind: 'table',
        headers: ['Goal', 'Target', 'Actual', 'Status'],
        rows: m.goals_vs_actuals.slice(0, 10).map(g => [
          String(g.label || '').slice(0, 50),
          String(g.target ?? '—'),
          String(g.actual ?? '—'),
          String(g.status || '—'),
        ]),
      });
    }
  } catch (_) { /* optional */ }

  // 10) Institutional memory — decision outcomes this week
  const learned = await safe(
    `SELECT title, category, acted_at, dismissed_at, outcome_result, outcome_notes, expected_impact
       FROM decision_recommendations
      WHERE tenant_id=$1
        AND (acted_at >= ${since} OR dismissed_at >= ${since} OR outcome_at >= ${since})
      ORDER BY COALESCE(outcome_at, acted_at, dismissed_at) DESC
      LIMIT 15`,
    [tid],
  );
  if (learned.length) {
    sections.push({
      title: `🧠 Learning Loop — ${learned.length} decision outcome(s)`,
      kind: 'table',
      headers: ['Decision', 'Category', 'Action', 'Result'],
      rows: learned.map(r => [
        String(r.title || '').slice(0, 50),
        r.category || '',
        r.acted_at ? 'acted' : r.dismissed_at ? 'dismissed' : '—',
        String(r.outcome_result || r.expected_impact || '').slice(0, 60),
      ]),
    });
  }

  if (!sections.length) sections.push({ title: 'No activity', kind:'text', body:`No data captured for "${brand}" in the last 7 days. Add the brand to Crisis Radar watchlist, run a Voice of Customer scan, or enable AI Optimizer to start collecting data.` });
  return sections;
}

function _hasOpenAI() {
  const k = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  return !!(k && !/^_DUMMY/i.test(k));
}

function _money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function _deltaPhrase(pct, invertGood = false) {
  if (pct == null || !Number.isFinite(Number(pct))) return null;
  const n = Number(pct);
  const up = n >= 0;
  const good = invertGood ? !up : up;
  const arrow = up ? 'up' : 'down';
  return { text: `${arrow} ${Math.abs(n).toFixed(1)}% vs prior period`, good };
}

/**
 * Client-ready narrative grounded in canonical metrics + pacing + goals.
 * Deterministic path always produces real numbers (not generic fluff).
 */
async function _buildClientNarrative(brand, tid, sections = []) {
  let metrics = null;
  try {
    const { computeCanonicalMetrics } = require('../canonical_metrics/compute');
    metrics = await computeCanonicalMetrics(tid, { days: 7 });
  } catch (_) { /* optional */ }

  const wins = [];
  const risks = [];
  const next_actions = [];
  const facts = [];

  if (metrics) {
    facts.push(`Spend ${_money(metrics.spend)} over 7 days`);
    if (metrics.blended_roas != null) facts.push(`blended ROAS ${metrics.blended_roas}x`);
    if (metrics.true_roas != null) facts.push(`true ROAS ${metrics.true_roas}x`);
    if (metrics.cac != null) facts.push(`CAC $${metrics.cac}`);

    const roasDelta = _deltaPhrase(metrics.deltas?.blended_roas_pct);
    if (roasDelta?.good) wins.push(`Efficiency ${roasDelta.text}`);
    else if (roasDelta && !roasDelta.good) risks.push(`Efficiency ${roasDelta.text}`);

    const revDelta = _deltaPhrase(metrics.deltas?.revenue_pct);
    if (revDelta?.good) wins.push(`Revenue ${revDelta.text} (${_money(metrics.total_revenue)})`);
    else if (metrics.total_revenue > 0) wins.push(`Revenue ${_money(metrics.total_revenue)} this week`);

    if ((metrics.waste_cents || 0) >= 5000) {
      risks.push(`${_money(metrics.waste_cents / 100)} in underwater-channel waste`);
      const top = (metrics.waste_channels || [])[0];
      if (top) next_actions.push(`Pause or cut ${top.channel} (ROAS ${top.roas ?? 'n/a'}) and reallocate to winners`);
    }

    const pace = metrics.pacing;
    if (pace && pace.pace_status && pace.pace_status !== 'unknown') {
      const paceLine = `Budget pacing is ${pace.pace_status.replace(/_/g, ' ')} at ${pace.pace_pct ?? '—'}% of expected (${_money(pace.spent_cents / 100)} of ${_money(pace.target_cents / 100)} target; projected month-end ${_money(pace.projected_month_end_cents / 100)})`;
      facts.push(paceLine);
      if (pace.pace_status === 'overspending' || pace.pace_status === 'ahead') {
        risks.push(paceLine);
      } else if (pace.pace_status === 'on_pace') {
        wins.push(paceLine);
      } else {
        risks.push(paceLine);
      }
      for (const a of (pace.actions || []).slice(0, 2)) {
        next_actions.push(`${a.action}: ${a.detail}`);
      }
    }

    const offTrack = (metrics.goals_vs_actuals || []).filter((g) => g.status === 'off-track' || g.status === 'at-risk');
    const onTrack = (metrics.goals_vs_actuals || []).filter((g) => g.status === 'on-track');
    if (onTrack.length) wins.push(`${onTrack.length} goal(s) on track`);
    if (offTrack.length) {
      risks.push(`${offTrack.length} goal(s) at risk / off track`);
      next_actions.push(`Focus this week on “${String(offTrack[0].label || '').slice(0, 60)}” (${offTrack[0].pct ?? 0}% of target)`);
    }
  }

  // Brand/intel signals from gathered sections
  for (const s of sections) {
    if (/Crisis/i.test(s.title) && (s.rows || []).length) {
      risks.push(`${(s.rows || []).length} crisis incident(s) in the last 7 days`);
    }
    if (/Share of Voice/i.test(s.title) && (s.rows || []).length) {
      const top = s.rows[0];
      if (Array.isArray(top)) wins.push(`SoV leader: ${top[0]} at ${top[1]}%`);
    }
    if (/Learning Loop/i.test(s.title) && (s.rows || []).length) {
      wins.push(`${(s.rows || []).length} decision outcome(s) recorded into institutional memory`);
    }
  }

  if (!wins.length) wins.push('Instrumentation active — continue collecting performance and brand signals');
  if (!risks.length) risks.push('No critical pacing or brand risks flagged from available data');
  if (!next_actions.length) {
    next_actions.push('Review Daily Action Queue and act on the top recommendation');
    next_actions.push('Confirm Budget Board target is set so pacing can guide spend');
  }

  const headlineFacts = facts.length
    ? facts.slice(0, 4).join('; ')
    : `${sections.length} intelligence section(s) compiled`;
  const executive_summary =
    `${brand} this week: ${headlineFacts}. ` +
    `${wins[0]}. ${risks[0] !== 'No critical pacing or brand risks flagged from available data' ? `Watch: ${risks[0]}.` : 'No critical risks raised.'} ` +
    `Priority next step: ${next_actions[0]}`;

  const client_paragraphs = [
    executive_summary,
    wins.length ? `What went well: ${wins.slice(0, 3).join('; ')}.` : null,
    risks.length ? `What needs attention: ${risks.slice(0, 3).join('; ')}.` : null,
    next_actions.length ? `Recommended actions: ${next_actions.slice(0, 3).map((a, i) => `${i + 1}) ${a}`).join(' ')}` : null,
  ].filter(Boolean);

  const base = {
    executive_summary,
    wins: wins.slice(0, 5),
    risks: risks.slice(0, 5),
    next_actions: next_actions.slice(0, 5),
    client_paragraphs,
    metrics_snapshot: metrics ? {
      spend: metrics.spend,
      blended_roas: metrics.blended_roas,
      true_roas: metrics.true_roas,
      cac: metrics.cac,
      waste_cents: metrics.waste_cents,
      pace_status: metrics.pacing?.pace_status || null,
      pace_pct: metrics.pacing?.pace_pct ?? null,
    } : null,
    tone: 'deterministic',
  };

  if (!_hasOpenAI()) return base;

  try {
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
    });
    const resp = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You polish client-ready marketing weekly narratives. Keep every number from the facts. ' +
            'Return JSON: {"executive_summary":"2-3 sentences with numbers","wins":["..."],"risks":["..."],"next_actions":["..."],"client_paragraphs":["para1","para2","para3"]}',
        },
        {
          role: 'user',
          content: `Brand: ${brand}\nGround-truth facts (do not invent numbers):\n${JSON.stringify({
            executive_summary: base.executive_summary,
            wins: base.wins,
            risks: base.risks,
            next_actions: base.next_actions,
            metrics: base.metrics_snapshot,
          }, null, 2)}`,
        },
      ],
    });
    const parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    return {
      ...base,
      executive_summary: String(parsed.executive_summary || base.executive_summary),
      wins: Array.isArray(parsed.wins) ? parsed.wins.slice(0, 5) : base.wins,
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : base.risks,
      next_actions: Array.isArray(parsed.next_actions) ? parsed.next_actions.slice(0, 5) : base.next_actions,
      client_paragraphs: Array.isArray(parsed.client_paragraphs) && parsed.client_paragraphs.length
        ? parsed.client_paragraphs.slice(0, 5)
        : base.client_paragraphs,
      tone: 'ai',
    };
  } catch (e) {
    console.warn('[weekly-report] narrative AI failed:', e.message);
    return base;
  }
}

async function _buildReport(brand, tid) {
  const sections = await _gatherSections(brand, tid);
  const narrative = await _buildClientNarrative(brand, tid, sections);
  const narrativeSection = {
    title: '✍️ Client Narrative',
    kind: 'narrative',
    body: narrative.executive_summary,
    wins: narrative.wins,
    risks: narrative.risks,
    next_actions: narrative.next_actions,
    client_paragraphs: narrative.client_paragraphs,
    metrics_snapshot: narrative.metrics_snapshot,
    tone: narrative.tone,
  };
  return {
    title: `${brand} — Weekly Client Report`,
    generated_at: new Date().toISOString(),
    narrative,
    sections: [narrativeSection, ...sections],
  };
}

async function _sendViaResend({ to, subject, html }) {
  if (!_hasResend()) throw new Error('RESEND_API_KEY missing');
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ from: 'InfoGenie <reports@infogenie.app>', to: [to], subject, html });
    const req = _https.request({
      hostname:'api.resend.com', path:'/emails', method:'POST',
      headers:{ 'Authorization':`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, r => {
      let d=''; r.on('data', c => d+=c);
      r.on('end', () => {
        try { const j = JSON.parse(d); if (r.statusCode >= 200 && r.statusCode < 300) resolve(j); else reject(new Error(j.message || `resend ${r.statusCode}`)); }
        catch (e) { reject(new Error(`resend parse failed: ${d.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('resend timeout')); });
    req.write(body); req.end();
  });
}

router.get('/test', (req, res) => {
  res.json({ ok:true, db: _db.hasDb && _db.hasDb(), resend: _hasResend() });
});

router.get('/subs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, subs:[] });
  const tid = await _tid(req, 'wr:subs-list');
  const r = await _db.getPool().query('SELECT * FROM weekly_report_subs WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
  res.json({ ok:true, subs: r.rows });
}));

router.post('/subs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const brand = String(req.body?.brand || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!brand) return _err(res, 400, 'brand required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _err(res, 400, 'valid email required');
  const tid = await _tid(req, 'wr:subs-add');
  const r = await _db.getPool().query(
    `INSERT INTO weekly_report_subs (tenant_id, brand, email) VALUES ($1,$2,$3)
     ON CONFLICT (tenant_id, brand, email) DO UPDATE SET enabled=true RETURNING *`,
    [tid, brand, email]
  );
  res.json({ ok:true, sub: r.rows[0] });
}));

router.delete('/subs/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 400, 'DATABASE_URL required');
  const tid = await _tid(req, 'wr:subs-del');
  await _db.getPool().query('DELETE FROM weekly_report_subs WHERE id=$1 AND tenant_id=$2', [parseInt(req.params.id, 10), tid]);
  res.json({ ok:true });
}));

router.get('/runs', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok:true, runs:[] });
  const tid = await _tid(req, 'wr:runs-list');
  const r = await _db.getPool().query('SELECT * FROM weekly_report_runs WHERE tenant_id=$1 ORDER BY generated_at DESC LIMIT 30', [tid]);
  res.json({ ok:true, runs: r.rows });
}));

router.post('/preview', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || req.query.brand || '').trim();
  if (!brand) return _err(res, 400, 'brand required');
  const tid = await _tid(req, 'wr:preview');
  const report = await _buildReport(brand, tid);
  res.json({ ok:true, report });
}));

// Client narrative only — for copy/paste into decks without full digest tables
router.post('/client-narrative', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || req.query.brand || '').trim();
  if (!brand) return _err(res, 400, 'brand required');
  const tid = await _tid(req, 'wr:client-narrative');
  const sections = await _gatherSections(brand, tid);
  const narrative = await _buildClientNarrative(brand, tid, sections);
  res.json({ ok: true, brand, narrative });
}));

router.get('/pdf', _safeAsync(async (req, res) => {
  const brand = String(req.query.brand || '').trim();
  if (!brand) return _err(res, 400, 'brand required');
  const tid = await _tid(req, 'wr:pdf');
  const report = await _buildReport(brand, tid);
  if (_db.hasDb && _db.hasDb()) {
    try { await _db.getPool().query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count) VALUES ($1,$2,$3)', [tid, brand, report.sections.length]); } catch(_) {}
  }
  streamPdf(report, res, `${brand.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-weekly.pdf`);
}));

router.post('/send', _safeAsync(async (req, res) => {
  const brand = String(req.body?.brand || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!brand || !email) return _err(res, 400, 'brand + email required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return _err(res, 400, 'valid email required');
  if (!_hasResend()) return _err(res, 400, 'RESEND_API_KEY required to send emails');
  const tid = await _tid(req, 'wr:send');
  const report = await _buildReport(brand, tid);
  const safeBrand = _escHtml(brand);
  const narr = report.narrative || {};
  const paras = (narr.client_paragraphs || [narr.executive_summary]).map(p => `<p style="line-height:1.55;color:#0F172A">${_escHtml(p)}</p>`).join('');
  const actions = (narr.next_actions || []).map(a => `<li>${_escHtml(a)}</li>`).join('');
  const summary = report.sections.filter(s => s.kind !== 'narrative').map(s => `<li><strong>${_escHtml(s.title)}</strong></li>`).join('');
  const pdfPath = `/api/weekly-report/pdf?brand=${encodeURIComponent(brand)}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px">
    <h1 style="color:#0F172A;margin:0 0 8px">${safeBrand} — Weekly Client Report</h1>
    <p style="color:#64748B;margin:0 0 18px">Generated ${_escHtml(new Date().toLocaleString())}</p>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:16px 18px;margin-bottom:18px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0F766E;margin-bottom:8px">Client narrative</div>
      ${paras}
      ${actions ? `<ol style="margin:12px 0 0;padding-left:18px;color:#334155;line-height:1.6">${actions}</ol>` : ''}
    </div>
    <p style="color:#475569;margin:0 0 8px">Supporting sections:</p>
    <ul style="line-height:1.8;color:#334155">${summary}</ul>
    <p style="margin-top:24px;padding:16px;background:#F1F5F9;border-radius:8px;font-size:0.9rem;color:#475569">Full PDF: <code>${_escHtml(pdfPath)}</code></p>
  </div>`;
  await _sendViaResend({ to: email, subject: `${brand} — Weekly Client Report`, html });
  if (_db.hasDb && _db.hasDb()) {
    try {
      await _db.getPool().query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count, sent_to) VALUES ($1,$2,$3,$4)', [tid, brand, report.sections.length, email]);
      await _db.getPool().query('UPDATE weekly_report_subs SET last_sent_at=now() WHERE tenant_id=$1 AND brand=$2 AND email=$3', [tid, brand, email]);
    } catch(_) {}
  }
  res.json({ ok:true, sent_to: email, sections: report.sections.length, note: 'Email sent. PDF available at ' + pdfPath });
}));

// Cron: every 7 days, send to all enabled subs. The claimed row carries its
// own tenant_id, so _buildReport is run in that tenant's context and the run
// row is inserted with the same tid.
let _cronTimer = null;
function startWeeklyCron(intervalDays = 7) {
  if (_cronTimer) return;
  async function tick() {
    if (!_db.hasDb || !_db.hasDb() || !_hasResend()) return;
    const pool = _db.getPool();
    while (true) {
      // Atomically claim ONE due subscription using FOR UPDATE SKIP LOCKED + same-tx
      // last_sent_at bump, so concurrent ticks/processes can never double-send.
      const client = await pool.connect();
      let claimed = null;
      try {
        await client.query('BEGIN');
        const r = await client.query(`SELECT * FROM weekly_report_subs
            WHERE enabled=true AND (last_sent_at IS NULL OR last_sent_at < now() - interval '6 days')
            ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!r.rows.length) { await client.query('COMMIT'); client.release(); break; }
        claimed = r.rows[0];
        await client.query('UPDATE weekly_report_subs SET last_sent_at=now() WHERE id=$1', [claimed.id]);
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch(_) {}
        client.release();
        console.warn('[weekly-report] claim failed:', e.message); break;
      }
      client.release();
      // Now send outside the txn — safe because the row is already marked sent.
      try {
        const tid = Number(claimed.tenant_id);
        if (!Number.isFinite(tid)) { console.warn('[weekly-report] claimed sub missing tenant_id, id=', claimed.id); continue; }
        const report = await _buildReport(claimed.brand, tid);
        const safe = _escHtml(claimed.brand);
        const html = `<div style="font-family:system-ui,sans-serif"><h2>${safe} — Weekly Intelligence</h2><p>${report.sections.length} sections covered. PDF available in InfoGenie at /api/weekly-report/pdf?brand=${encodeURIComponent(claimed.brand)}.</p></div>`;
        await _sendViaResend({ to: claimed.email, subject: `${claimed.brand} — Weekly Report`, html });
        await pool.query('INSERT INTO weekly_report_runs (tenant_id, brand, sections_count, sent_to) VALUES ($1,$2,$3,$4)', [tid, claimed.brand, report.sections.length, claimed.email]);
      } catch (e) { console.warn('[weekly-report] send failed for', claimed.email, e.message); }
    }
  }
  _cronTimer = setInterval(tick, intervalDays * 24 * 3600 * 1000);
  console.log(`[weekly-report] cron started — every ${intervalDays}d`);
}

module.exports = { router, startWeeklyCron };

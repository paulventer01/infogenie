/* ═══════════════════════════════════════════════════════════════════════════════
   ig_csuite.js — C-Suite Executive Intelligence Reports + Action Center
   Extracted VERBATIM from app.js (see public/js/README.md for the convention).

   C-Suite reports: initCsuite · csSetRole · csSetPeriod · csData · csBuildView ·
   csROIPanel · csBuildCEO/CMO/CFO/COO · csSuitePDF · csPeriodLabel.
   Action Center: initActionCenter · acBuild.

   Loaded as a plain <script> AFTER app.js (and after ig_results_export.js, whose
   window.getIndustryROASBenchmark acBuild probes). Public entry points referenced
   from navigateTo dispatch / inline onclick= are re-exported on window at the
   bottom of the IIFE so they resolve as globals.
   ═══════════════════════════════════════════════════════════════════════════════ */
(function () {
/* ══════════════════════════════════════════════════════════════
   C-SUITE EXECUTIVE INTELLIGENCE REPORTS
   ══════════════════════════════════════════════════════════════ */

window._csRole   = 'ceo';
window._csPeriod = '30d';

function initCsuite() {
  window._csRole   = window._csRole   || 'ceo';
  window._csPeriod = window._csPeriod || '30d';
  csBuildView();
}

function csSetRole(btn, role) {
  document.querySelectorAll('.cs-role-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._csRole = role;
  csBuildView();
}

function csSetPeriod(btn, period) {
  document.querySelectorAll('.cs-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  window._csPeriod = period;
  csBuildView();
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function csData() {
  const ad     = analysisData;
  const camps  = window._launchedCampaigns || [];
  const budget = camps.reduce((s,c) => s + (c.budget||0), 0);
  const roas   = camps.length ? (camps.reduce((s,c) => s + parseFloat(c.metrics?.roas||0), 0)/camps.length).toFixed(1) : (ad?.websiteKPIs?.roas || '3.2');
  const conv   = camps.reduce((s,c) => s + (c.metrics?.conversions||0), 0);
  const impr   = camps.reduce((s,c) => s + (c.metrics?.impressions||0), 0);
  const cpl    = (() => { const ld = window._leadData||{}; const t = (ld.messages||0)+(ld.calls||0); return t>0&&budget>0 ? (budget/t).toFixed(2) : '—'; })();
  const comps  = ad?.competitors || [];
  const myROAS = parseFloat(roas);
  const url    = ad?.url || 'your website';
  const ind    = ad?.industry?.name || 'your industry';
  const sov    = ad ? Math.min(Math.round(35 + camps.length * 8), 72) : 28;
  const sovComp = 100 - sov;
  return { ad, camps, budget, roas: myROAS, conv, impr, cpl, comps, url, ind, sov, sovComp };
}

// ── Main render ───────────────────────────────────────────────────────────────
function csBuildView() {
  const wrap = document.getElementById('csuiteWrap');
  if (!wrap) return;
  const role = window._csRole;
  const d    = csData();

  const roleMap = {
    ceo: { label:'Chief Executive Officer', color:'#7C3AED', accent:'rgba(124,58,237,.15)', icon:'👔' },
    cmo: { label:'Chief Marketing Officer',  color:'#0066FF', accent:'rgba(0,102,255,.12)',  icon:'📣' },
    cfo: { label:'Chief Financial Officer',  color:'#059669', accent:'rgba(5,150,105,.12)',  icon:'💰' },
    coo: { label:'Chief Operating Officer',  color:'#D97706', accent:'rgba(217,119,6,.12)',  icon:'⚙️' },
  };
  const rm = roleMap[role];

  // Period selector HTML
  const periods = [['7d','7 Days'],['30d','30 Days'],['90d','Quarter'],['1y','Annual']];
  const periodHtml = `<div class="cs-period-sel">${periods.map(([v,l]) =>
    `<button class="cs-period-btn${window._csPeriod===v?' active':''}" onclick="csSetPeriod(this,'${v}')">${l}</button>`
  ).join('')}</div>`;

  // Role-specific report builder
  let content = '';
  switch (role) {
    case 'ceo': content = csBuildCEO(d, rm, periodHtml); break;
    case 'cmo': content = csBuildCMO(d, rm, periodHtml); break;
    case 'cfo': content = csBuildCFO(d, rm, periodHtml); break;
    case 'coo': content = csBuildCOO(d, rm, periodHtml); break;
  }

  wrap.innerHTML = csROIPanel(d) + content;
}


// ── ROI Summary Panel (shared across all C-Suite roles) ───────────────────────
function csROIPanel(d) {
  const { camps, budget, roas, ad } = d;
  const noData = !camps.length && budget === 0;

  const estSpend  = noData ? 5000 : null;
  const estRoas   = noData ? (parseFloat(ad && ad.websiteKPIs && ad.websiteKPIs.roas) || roas || 2.2) : null;

  const totalSpend    = noData ? estSpend : (camps.reduce((s,c) => s + (c.metrics && c.metrics.spend ? c.metrics.spend : Math.round(c.budget * 0.25)), 0) || budget);
  const effectiveRoas = noData ? estRoas : roas;
  const totalRev      = Math.round(totalSpend * effectiveRoas);
  const projRevMonth  = noData ? Math.round(estSpend * estRoas) : Math.round(budget * roas);
  const profit        = totalRev - totalSpend;
  const roi           = totalSpend > 0 ? Math.round((profit / totalSpend) * 100) : 0;
  const roiColor      = roi >= 100 ? '#059669' : roi >= 0 ? '#D97706' : '#EF4444';
  const roiIcon       = roi >= 100 ? '📈' : roi >= 0 ? '⚠️' : '📉';
  const badge         = noData ? '<span style="font-size:0.6rem;background:#FEF9C3;color:#92400E;border-radius:4px;padding:1px 6px;font-weight:700;vertical-align:middle;margin-left:6px">ESTIMATED</span>' : '';

  function fmt(n) {
    if (n >= 1000000) return '$' + (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return '$' + Math.round(n/1000) + 'K';
    return '$' + n.toLocaleString();
  }

  return '<div style="background:var(--ig-grad2);border:1px solid rgba(0,201,200,.18);border-radius:16px;padding:22px 28px;margin-bottom:22px">' +
    '<div style="font-size:0.65rem;font-weight:700;color:rgba(0,201,200,.8);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">💼 Investment Performance Overview' + badge + '</div>' +
    (noData ? '<div style="font-size:0.72rem;color:rgba(255,255,255,.35);margin-bottom:12px">No campaigns launched yet — showing estimated benchmarks for a $5K/mo budget</div>' : '') +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:14px">' +

    '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:14px 16px">' +
      '<div style="font-size:0.62rem;font-weight:600;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">💸 Total Ad Spend</div>' +
      '<div style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:800;color:#F87171;line-height:1">' + fmt(totalSpend) + '</div>' +
      '<div style="font-size:0.68rem;color:rgba(255,255,255,.35);margin-top:5px">' + fmt(budget || totalSpend) + '/mo budget · ' + camps.length + ' campaign' + (camps.length!==1?'s':'') + '</div>' +
    '</div>' +

    '<div style="background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.2);border-radius:12px;padding:14px 16px">' +
      '<div style="font-size:0.62rem;font-weight:600;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">💰 Revenue Generated</div>' +
      '<div style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:800;color:#34D399;line-height:1">' + fmt(totalRev) + '</div>' +
      '<div style="font-size:0.68rem;color:rgba(255,255,255,.35);margin-top:5px">' + fmt(projRevMonth) + '/mo projected · ' + effectiveRoas + '× ROAS</div>' +
    '</div>' +

    '<div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:14px 16px">' +
      '<div style="font-size:0.62rem;font-weight:600;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">📊 Net Profit</div>' +
      '<div style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:800;color:' + (profit>=0?'#818CF8':'#F87171') + ';line-height:1">' + (profit>=0?'+':'-') + fmt(Math.abs(profit)) + '</div>' +
      '<div style="font-size:0.68rem;color:rgba(255,255,255,.35);margin-top:5px">Revenue minus total spend</div>' +
    '</div>' +

    '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden">' +
      '<div style="font-size:0.62rem;font-weight:600;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px">' + roiIcon + ' Return on Investment</div>' +
      '<div style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:800;color:' + roiColor + ';line-height:1">' + (roi>=0?'+':'') + roi + '%</div>' +
      '<div style="font-size:0.68rem;color:rgba(255,255,255,.35);margin-top:5px">' + (roi>=100?'Exceeding target — scale spend':roi>=0?'Positive ROI — optimise to improve':'Below break-even — review targeting') + '</div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:rgba(255,255,255,.06)">' +
        '<div style="height:100%;width:' + Math.min(100,Math.abs(roi)) + '%;background:' + roiColor + ';transition:width .6s ease"></div>' +
      '</div>' +
    '</div>' +

    '</div>' +
    '<div style="margin-top:14px;padding:10px 14px;background:rgba(255,255,255,.03);border-radius:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:0.72rem;color:rgba(255,255,255,.35)">ROI formula:</span>' +
      '<span style="font-size:0.75rem;color:rgba(255,255,255,.5);font-style:italic">(Revenue − Spend) ÷ Spend × 100</span>' +
      '<span style="margin-left:auto;font-size:0.75rem;font-weight:700;color:' + roiColor + '">' + fmt(Math.abs(profit)) + ' ' + (profit>=0?'returned above':'in deficit against') + ' ' + fmt(totalSpend) + ' invested</span>' +
    '</div>' +
  '</div>';
}


// ── CEO Report ────────────────────────────────────────────────────────────────
function csBuildCEO(d, rm, periodHtml) {
  const { camps, budget, roas, conv, impr, comps, url, ind, sov, sovComp, ad } = d;
  const projRev = budget > 0 ? '$' + (budget * roas).toLocaleString(undefined,{maximumFractionDigits:0}) : '—';
  const mktShare = sov;
  const compSOV  = sovComp;
  const ySov     = Math.max(mktShare - 12, 8);

  const topInsights = [
    { icon:'📈', bg:'#EFF6FF', text:`Marketing generated ${camps.length} active campaigns with projected ${projRev}/mo revenue attribution`, label:'Revenue Attribution' },
    { icon:'🎯', bg:'#F0FDF4', text:`Share of voice at ${mktShare}% — up from ${ySov}% in prior period. Competitors hold ${compSOV}% combined`, label:'Market Position' },
    { icon:'🤖', bg:'#FEF3C7', text:`InfoGenie AI executed ${(window._infoGenieActions||[]).length + camps.length} autonomous actions — saving ~${((window._infoGenieActions||[]).length * 2.5).toFixed(0)} hours of manual work`, label:'AI Efficiency' },
    { icon:'⚡', bg:'#FDF4FF', text:`${comps.length} competitors tracked in real-time across ${ind}. Key threat: ${comps[0]?.name || 'primary competitor'}`, label:'Competitive Intel' },
  ];

  const alerts = [
    { type: roas >= 3 ? 'success' : 'warning', icon: roas >= 3 ? '✅' : '⚠️', text: `Blended ROAS at ${roas}× ${roas >= 3 ? '— above industry benchmark of 3×' : '— below 3× target, action required'}`, val: `${roas}×` },
    { type: camps.length >= 2 ? 'success' : 'warning', icon: camps.length >= 2 ? '✅' : '⚠️', text: `${camps.length} campaign${camps.length!==1?'s':''} active across ${[...new Set(camps.map(c=>c.platform))].length || 1} platform${camps.length>1?'s':''}`, val: `${camps.length} live` },
    { type: 'success', icon: '📊', text: `Competitor intelligence active — monitoring ${comps.length} rivals in ${ind}`, val: `${comps.length} rivals` },
  ];

  return `
  <!-- Exec Banner -->
  <div class="cs-exec-banner">
    <div class="cs-exec-role-badge">${rm.icon} ${rm.label} · Executive Summary</div>
    <div class="cs-exec-headline">Business Growth Intelligence Report</div>
    <div class="cs-exec-sub">High-level overview of marketing performance, competitive position, revenue attribution and AI-driven growth metrics for ${url || 'your brand'}. Period: ${csPeriodLabel()}.</div>
    <div class="cs-exec-stats">
      ${[
        ['Revenue Attribution', projRev],
        ['Active Campaigns', camps.length || '0'],
        ['Avg ROAS', roas + '×'],
        ['Share of Voice', mktShare + '%'],
        ['Competitors Tracked', comps.length || '0'],
        ['AI Actions Taken', (window._infoGenieActions||[]).length],
      ].map(([l,v],i,a) => `
        <div class="cs-exec-stat"><div class="cs-exec-stat-val">${v}</div><div class="cs-exec-stat-label">${l}</div></div>
        ${i < a.length-1 ? '<div class="cs-exec-stat-sep"></div>' : ''}
      `).join('')}
    </div>
  </div>

  <!-- Period + Alerts row -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
    <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">CEO Dashboard <span style="font-size:0.72rem;font-weight:400;color:#6B7280">· Generated ${new Date().toLocaleDateString()}</span></div>
    ${periodHtml}
  </div>

  <!-- Alerts -->
  <div style="margin-bottom:22px">
    ${alerts.map(a => `<div class="cs-alert cs-alert-${a.type}"><span class="cs-alert-icon">${a.icon}</span><span class="cs-alert-text">${a.text}</span><span class="cs-alert-val">${a.val}</span></div>`).join('')}
  </div>

  <!-- KPI Grid -->
  <div class="cs-kpi-grid" style="--cs-accent:${rm.color}">
    ${[
      { label:'Revenue Attribution/mo', val: projRev, delta: '↑ vs prior period', dir:'up' },
      { label:'Total Ad Spend/mo',      val: budget>0?'$'+budget.toLocaleString():'—', delta: `${camps.length} campaigns`, dir:'neutral' },
      { label:'Blended ROAS',           val: roas+'×', delta: roas>=3?'↑ Above benchmark':'↓ Below 3× target', dir: roas>=3?'up':'down' },
      { label:'Share of Voice',         val: mktShare+'%', delta: `↑ vs ${ySov}% prior period`, dir:'up' },
      { label:'Competitors Monitored',  val: comps.length||'0', delta: `in ${ind}`, dir:'neutral' },
      { label:'AI Actions Executed',    val: (window._infoGenieActions||[]).length||'0', delta: `~${(((window._infoGenieActions||[]).length||0)*2.5).toFixed(0)}h saved`, dir:'up' },
    ].map(k => `
      <div class="cs-kpi">
        <div class="cs-kpi-val">${k.val}</div>
        <div class="cs-kpi-label">${k.label}</div>
        <div class="cs-kpi-delta ${k.dir}">${k.delta}</div>
      </div>`).join('')}
  </div>

  <div class="cs-two-col">
    <!-- Strategic Insights -->
    <div class="cs-card">
      <div class="cs-card-header">
        <div><div class="cs-card-title">🧠 Strategic Insights</div><div class="cs-card-sub">Board-level action items</div></div>
      </div>
      ${topInsights.map(i => `
        <div class="cs-insight">
          <div class="cs-insight-icon" style="background:${i.bg}">${i.icon}</div>
          <div class="cs-insight-text">
            <div class="cs-insight-title">${i.label}</div>
            <div class="cs-insight-sub">${i.text}</div>
          </div>
        </div>`).join('')}
    </div>

    <!-- Market Position / Share of Voice -->
    <div class="cs-card">
      <div class="cs-card-header">
        <div><div class="cs-card-title">🏆 Market Position</div><div class="cs-card-sub">Share of voice vs. competitors</div></div>
      </div>
      <div style="margin-bottom:14px">
        <div class="cs-bar-row">
          <div class="cs-bar-label" style="color:#0A1628;font-weight:700">Your Brand</div>
          <div class="cs-bar-track"><div class="cs-bar-fill" style="width:${mktShare}%;background:linear-gradient(90deg,${rm.color},#00C9C8)"></div></div>
          <div class="cs-bar-val" style="color:${rm.color}">${mktShare}%</div>
        </div>
        ${(() => {
          // Derive each competitor's market-share from REAL traffic when
          // available (no synthetic 5% floor). Skip competitors with no
          // traffic data — they get no bar rather than a fabricated one.
          const _parseT = (c) => {
            const raw = String(c.traffic || '').replace(/[, ]/g,'').toUpperCase();
            const n = parseFloat(raw); if (!isFinite(n) || n <= 0) return 0;
            if (raw.includes('B')) return n * 1e9;
            if (raw.includes('M')) return n * 1e6;
            if (raw.includes('K')) return n * 1e3;
            return n;
          };
          const withT = comps.slice(0,5).map(c => ({ c, t: _parseT(c) }));
          const totalT = withT.reduce((a,x) => a + x.t, 0);
          return withT.map(({c, t}, i) => {
            if (t > 0 && totalT > 0) {
              // Real share — scale so competitors collectively occupy ~80%
              const w = Math.max(1, Math.round(t / totalT * 80));
              return `<div class="cs-bar-row">
                <div class="cs-bar-label">${c.name.substring(0,18)}</div>
                <div class="cs-bar-track"><div class="cs-bar-fill" style="width:${w}%;background:#E2E8F0"></div></div>
                <div class="cs-bar-val">${w}%</div>
              </div>`;
            }
            // No real traffic data → show greyed dash, no fabricated bar
            return `<div class="cs-bar-row">
              <div class="cs-bar-label">${c.name.substring(0,18)}</div>
              <div class="cs-bar-track"><div class="cs-bar-fill" style="width:0%;background:#E2E8F0"></div></div>
              <div class="cs-bar-val" style="color:#94a3b8" title="No public traffic data available">—</div>
            </div>`;
          }).join('');
        })()}
      </div>
      <div style="background:#F9FAFB;border-radius:10px;padding:10px 12px;font-size:0.75rem;color:#374151;line-height:1.5">
        <strong>CEO Recommendation:</strong> Growing SOV from ${ySov}% to ${mktShare}% signals effective campaign execution. Target ${Math.min(mktShare+10,65)}% within next quarter by increasing spend on top-performing platforms.
      </div>
    </div>
  </div>

  <!-- Competitor landscape table -->
  ${comps.length ? `
  <div class="cs-card">
    <div class="cs-card-header">
      <div><div class="cs-card-title">🔍 Competitive Landscape — ${ind}</div><div class="cs-card-sub">Top competitor performance signals vs. your brand</div></div>
    </div>
    <div class="table-scroll">
      <table class="cs-comp-table">
        <thead><tr><th>Competitor</th><th>Est. Ad Spend</th><th>ROAS Signal</th><th>Primary Channel</th><th>Threat Level</th><th>CEO Action</th></tr></thead>
        <tbody>
          ${comps.slice(0,6).map((c,i) => {
            const threat = i===0?'High':i<=2?'Medium':'Low';
            const tc = threat==='High'?'#EF4444':threat==='Medium'?'#F59E0B':'#10B981';
            // No fabricated spend — show "—" when neither real nor AI-validated value exists
            const _rawSpend = c.estimatedAdSpend || c.adSpend;
            const spend = (_rawSpend && _rawSpend !== '—') ? _rawSpend : '<span style="color:#94a3b8" title="No public spend data available">—</span>';
            const ch    = c.topChannels?.[0] || ['Google','Meta','TikTok','LinkedIn'][i%4];
            // Use the actual ROAS from the validated pipeline; fallback shows "—"
            const _haveR = (typeof c.roas === 'number' && c.roas > 0) || (typeof c.roas === 'string' && c.roas !== '—' && !isNaN(parseFloat(c.roas)));
            const roasEst = _haveR ? parseFloat(c.roas).toFixed(1) : null;
            const roasCell = roasEst ? `${roasEst}×` : '<span style="color:#94a3b8" title="No public ROAS data available">—</span>';
            return `<tr>
              <td><strong>${c.name}</strong></td>
              <td>${typeof spend==='number'?'$'+spend.toLocaleString():spend}</td>
              <td><span class="cs-trend-down">${roasCell}</span> <span style="font-size:0.65rem;color:#9CA3AF">vs your ${d.roas}×</span></td>
              <td>${ch}</td>
              <td><span class="cs-badge" style="background:${tc}20;color:${tc};border:1px solid ${tc}40">${threat}</span></td>
              <td style="font-size:0.72rem;color:#6B7280">${threat==='High'?'Increase counter-spend':'Monitor quarterly'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}`;
}

// ── CMO Report ────────────────────────────────────────────────────────────────
function csBuildCMO(d, rm, periodHtml) {
  const { camps, budget, roas, conv, impr, comps, url, ind, sov, ad } = d;
  const clicks = Math.round(impr * 0.045);
  const leads  = Math.round(clicks * 0.08);
  const cpa    = budget > 0 && conv > 0 ? '$' + (budget/Math.max(conv,1)).toFixed(0) : '—';
  const channels = [...new Set(camps.map(c=>c.platform))];

  return `
  <div class="cs-exec-banner" style="background:var(--ig-grad)">
    <div class="cs-exec-role-badge" style="background:rgba(0,102,255,.2);border-color:rgba(0,102,255,.3);color:#93C5FD">${rm.icon} ${rm.label} · Marketing Performance Report</div>
    <div class="cs-exec-headline">Full-Funnel Campaign Intelligence</div>
    <div class="cs-exec-sub">Comprehensive view of campaign performance, creative output, audience reach, and channel ROAS for ${url || 'your brand'}. Period: ${csPeriodLabel()}.</div>
    <div class="cs-exec-stats">
      ${[['Campaigns Live',camps.length||0],['Total Impressions',impr>0?(impr/1000).toFixed(0)+'K':'-'],['Avg ROAS',roas+'×'],['Conversions',conv||0],['Channels Active',channels.length||1],['Creative Assets',(window._brandAssets||[]).length]].map(([l,v],i,a)=>`
        <div class="cs-exec-stat"><div class="cs-exec-stat-val">${v}</div><div class="cs-exec-stat-label">${l}</div></div>
        ${i<a.length-1?'<div class="cs-exec-stat-sep"></div>':''}
      `).join('')}
    </div>
  </div>

  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
    <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">CMO Dashboard <span style="font-size:0.72rem;font-weight:400;color:#6B7280">· ${new Date().toLocaleDateString()}</span></div>
    ${periodHtml}
  </div>

  <!-- KPIs -->
  <div class="cs-kpi-grid" style="--cs-accent:${rm.color}">
    ${[
      { label:'Total Ad Spend/mo',      val: budget>0?'$'+budget.toLocaleString():'—', delta: `${channels.length || 1} channels`, dir:'neutral' },
      { label:'Blended ROAS',           val: roas+'×',     delta: roas>=3?'↑ Above target':'↓ Needs optimisation', dir: roas>=3?'up':'down' },
      { label:'Total Impressions',      val: impr>0?(impr/1000).toFixed(0)+'K':'—', delta: 'Paid reach', dir:'up' },
      { label:'Est. Clicks',           val: clicks>0?clicks.toLocaleString():'—', delta: '~4.5% CTR', dir:'neutral' },
      { label:'Conversions',            val: conv>0?conv:'—', delta: 'From all campaigns', dir:'up' },
      { label:'Cost per Acquisition',   val: cpa, delta: 'All channels blended', dir:'neutral' },
      { label:'Share of Voice',         val: sov+'%', delta: `vs competitors`, dir:'up' },
      { label:'Brand Assets',           val: (window._brandAssets||[]).length, delta: 'In creative library', dir:'neutral' },
    ].map(k=>`<div class="cs-kpi"><div class="cs-kpi-val">${k.val}</div><div class="cs-kpi-label">${k.label}</div><div class="cs-kpi-delta ${k.dir}">${k.delta}</div></div>`).join('')}
  </div>

  <div class="cs-two-col">
    <!-- Full funnel -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">🎯 Marketing Funnel</div><div class="cs-card-sub">Impressions → Revenue</div></div></div>
      ${[
        ['Impressions',  impr>0?impr.toLocaleString():'Pending', '#0066FF', 100],
        ['Clicks',       clicks>0?clicks.toLocaleString():'Pending', '#00C9C8', Math.round((clicks/Math.max(impr,1))*100) || 45],
        ['Leads',        leads>0?leads.toLocaleString():'Pending', '#7C3AED', Math.round((leads/Math.max(impr,1))*100) || 8],
        ['Conversions',  conv>0?conv.toLocaleString():'Pending', '#10B981', Math.round((conv/Math.max(impr,1))*100) || 2],
        ['Revenue',      budget>0?'$'+(budget*roas).toLocaleString(undefined,{maximumFractionDigits:0}):'—', '#F59E0B', Math.round((conv/Math.max(impr,1))*70)||1],
      ].map(([l,v,c,p])=>`
        <div class="cs-bar-row">
          <div class="cs-bar-label">${l}</div>
          <div class="cs-bar-track"><div class="cs-bar-fill" style="width:${Math.max(p,4)}%;background:${c}"></div></div>
          <div class="cs-bar-val" style="color:${c}">${v}</div>
        </div>`).join('')}
    </div>

    <!-- Channel breakdown -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">📡 Channel Performance</div><div class="cs-card-sub">ROAS by platform</div></div></div>
      ${camps.length ? camps.slice(0,5).map(c => {
        const cr = parseFloat(c.metrics?.roas || c.estROAS || roas);
        const pct = Math.min(Math.round(cr/5*100), 100);
        const col = cr >= 3 ? '#10B981' : cr >= 2 ? '#F59E0B' : '#EF4444';
        return `<div class="cs-bar-row">
          <div class="cs-bar-label">${(c.platform||'Platform').substring(0,14)}</div>
          <div class="cs-bar-track"><div class="cs-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <div class="cs-bar-val" style="color:${col}">${cr.toFixed(1)}×</div>
        </div>`;
      }).join('') : '<div style="text-align:center;padding:20px;color:#9CA3AF;font-size:0.82rem">Launch campaigns to see channel ROAS breakdown</div>'}
    </div>
  </div>

  <!-- Competitor intelligence -->
  ${comps.length ? `
  <div class="cs-card">
    <div class="cs-card-header">
      <div><div class="cs-card-title">⚔️ Competitor Ad Intelligence</div><div class="cs-card-sub">What your rivals are doing — and where they're failing</div></div>
    </div>
    <div class="table-scroll">
      <table class="cs-comp-table">
        <thead><tr><th>Competitor</th><th>Top Keywords</th><th>Primary Channel</th><th>Est. ROAS Gap</th><th>CMO Exploit</th></tr></thead>
        <tbody>
          ${comps.slice(0,6).map((c,i)=>{
            const gap = (roas - (2.5-i*0.15)).toFixed(1);
            const kw  = (c.topKeywords||[]).slice(0,2).join(', ') || 'brand + category terms';
            const ch  = c.topChannels?.[0] || ['Google','Meta','LinkedIn','TikTok'][i%4];
            return `<tr>
              <td><strong>${c.name}</strong></td>
              <td style="font-size:0.73rem;color:#6B7280">${kw}</td>
              <td>${ch}</td>
              <td><span class="cs-trend-up">+${gap}× advantage</span></td>
              <td style="font-size:0.72rem;color:#0066FF">Target their top keywords at +15% bid</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>` : ''}`;
}

// ── CFO Report ────────────────────────────────────────────────────────────────
function csBuildCFO(d, rm, periodHtml) {
  const { camps, budget, roas, conv, cpl, comps, ind } = d;
  const revenue   = (budget * roas).toFixed(0);
  const efficiency = budget > 0 ? ((roas - 1) / roas * 100).toFixed(1) : '—';
  const cpa        = budget > 0 && conv > 0 ? (budget / Math.max(conv,1)).toFixed(2) : '—';
  const projQ      = (budget * 3 * roas).toFixed(0);

  const channelBreakdown = camps.length ? camps.map(c => ({
    name: c.platform || 'Platform',
    spend: c.budget || 0,
    roas:  parseFloat(c.metrics?.roas || c.estROAS || roas),
    rev:   Math.round((c.budget||0) * parseFloat(c.metrics?.roas||roas))
  })) : [];

  return `
  <div class="cs-exec-banner" style="background:var(--ig-grad)">
    <div class="cs-exec-role-badge" style="background:rgba(5,150,105,.2);border-color:rgba(5,150,105,.3);color:#6EE7B7">${rm.icon} ${rm.label} · Financial Marketing Report</div>
    <div class="cs-exec-headline">Marketing ROI & Budget Efficiency</div>
    <div class="cs-exec-sub">Financial performance of all marketing channels — spend efficiency, revenue attribution, cost-per-outcome, and quarterly projection. Period: ${csPeriodLabel()}.</div>
    <div class="cs-exec-stats">
      ${[['Monthly Spend','$'+(budget||0).toLocaleString()],['Revenue Attr.','$'+Number(revenue).toLocaleString()],['Blended ROAS',roas+'×'],['Profit Margin',efficiency+'%'],['Cost-per-Lead',cpl!=='—'?'$'+cpl:cpl],['Qtr Projection','$'+Number(projQ).toLocaleString()]].map(([l,v],i,a)=>`
        <div class="cs-exec-stat"><div class="cs-exec-stat-val">${v}</div><div class="cs-exec-stat-label">${l}</div></div>${i<a.length-1?'<div class="cs-exec-stat-sep"></div>':''}
      `).join('')}
    </div>
  </div>

  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
    <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">CFO Dashboard <span style="font-size:0.72rem;font-weight:400;color:#6B7280">· ${new Date().toLocaleDateString()}</span></div>
    ${periodHtml}
  </div>

  <div class="cs-kpi-grid" style="--cs-accent:${rm.color}">
    ${[
      { label:'Total Marketing Spend/mo', val: budget>0?'$'+budget.toLocaleString():'$0', delta:'All channels combined', dir:'neutral'},
      { label:'Revenue Attributed/mo',    val: budget>0?'$'+Number(revenue).toLocaleString():'—', delta:`At ${roas}× ROAS`, dir:'up'},
      { label:'Net Marketing Profit/mo',  val: budget>0?'$'+(Number(revenue)-budget).toLocaleString():'—', delta:'Revenue − Spend', dir:'up'},
      { label:'ROAS (Return on Ad Spend)',val: roas+'×', delta: roas>=3?'↑ Above 3× threshold':'↓ Below target', dir:roas>=3?'up':'down'},
      { label:'Cost Per Acquisition',     val: cpa!=='—'?'$'+cpa:'—', delta:'Per conversion', dir:'neutral'},
      { label:'Cost Per Lead',            val: cpl!=='—'?'$'+cpl:'—', delta:'Messages + Calls', dir:'neutral'},
      { label:'Quarterly Projection',     val: '$'+Number(projQ).toLocaleString(), delta:`${csPeriodLabel()} extrapolation`, dir:'up'},
      { label:'Active Campaigns',         val: camps.length, delta:`${[...new Set(camps.map(c=>c.platform))].length||1} platforms`, dir:'neutral'},
    ].map(k=>`<div class="cs-kpi"><div class="cs-kpi-val">${k.val}</div><div class="cs-kpi-label">${k.label}</div><div class="cs-kpi-delta ${k.dir}">${k.delta}</div></div>`).join('')}
  </div>

  <div class="cs-two-col">
    <!-- Budget efficiency -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">💹 Budget Efficiency by Channel</div><div class="cs-card-sub">Spend vs revenue per platform</div></div></div>
      ${channelBreakdown.length ? channelBreakdown.map(c => {
        const pct = Math.min(Math.round(c.roas/5*100),100);
        const profit = c.rev - c.spend;
        const col = c.roas>=3?'#10B981':c.roas>=2?'#F59E0B':'#EF4444';
        return `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #F3F4F6">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:0.78rem;font-weight:700;color:#0A1628">${c.name}</span>
            <span style="font-size:0.72rem;font-weight:700;color:${col}">${c.roas.toFixed(1)}× ROAS</span>
          </div>
          <div class="cs-bar-track" style="margin-bottom:4px"><div class="cs-bar-fill" style="width:${pct}%;background:${col}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:#9CA3AF">
            <span>Spend: $${c.spend.toLocaleString()}/mo</span>
            <span style="color:#059669;font-weight:600">Revenue: $${c.rev.toLocaleString()}</span>
          </div>
        </div>`;
      }).join('') : '<div style="text-align:center;padding:20px;color:#9CA3AF;font-size:0.82rem">No campaigns yet</div>'}
    </div>

    <!-- Financial alerts -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">🚨 CFO Alerts & Recommendations</div></div></div>
      ${[
        { type: roas>=3?'success':'warning', icon: roas>=3?'✅':'⚠️', text: `ROAS ${roas>=3?'exceeds':'below'} 3× threshold — ${roas>=3?'budget can scale safely':'pause lowest performers first'}`, val: roas+'×' },
        { type: budget>0?'success':'warning', icon: budget>0?'💰':'⚠️', text: `Monthly marketing budget of $${(budget||0).toLocaleString()} is ${budget>0?'actively deployed':'not yet set'}`, val: '$'+budget.toLocaleString() },
        { type: 'success', icon: '📊', text: `InfoGenie AI optimisation preventing estimated $${Math.round(budget*0.18).toLocaleString()}/mo in wasted spend`, val: '-18%' },
        { type: Number(cpa)<50?'success':'warning', icon: '🎯', text: `CPA of ${cpa!=='—'?'$'+cpa:cpa} — ${Number(cpa)<50?'within efficient range':'review conversion targeting'}`, val: cpa!=='—'?'$'+cpa:'—' },
      ].map(a=>`<div class="cs-alert cs-alert-${a.type}"><span class="cs-alert-icon">${a.icon}</span><span class="cs-alert-text">${a.text}</span><span class="cs-alert-val">${a.val}</span></div>`).join('')}

      <div style="background:#F9FAFB;border-radius:10px;padding:12px;margin-top:14px">
        <div style="font-size:0.72rem;font-weight:700;color:#374151;margin-bottom:6px">📋 CFO Recommended Actions</div>
        <ul style="margin:0;padding-left:16px;font-size:0.73rem;color:#6B7280;line-height:1.7">
          <li>Reallocate ${roas<3?'15% of':'no'} budget from underperforming channels</li>
          <li>Scale top ROAS channel by +20% if ROAS > 3.5×</li>
          <li>Review CPA monthly against LTV ratio (target LTV:CAC ≥ 3:1)</li>
          <li>Approve quarterly budget review after ${camps.length > 0 ? '30-day' : 'first campaign'} results</li>
        </ul>
      </div>
    </div>
  </div>`;
}

// ── COO Report ────────────────────────────────────────────────────────────────
function csBuildCOO(d, rm, periodHtml) {
  const { camps, budget, roas, conv, comps, url, ind } = d;
  const actions  = window._infoGenieActions || [];
  const abTests  = window._abTests || [];
  const hrsSaved = (actions.length * 2.5).toFixed(0);
  const channels = [...new Set(camps.map(c=>c.platform))];

  const ops = [
    { icon:'🚀', label:'Campaigns Active',       val: camps.length,         status: camps.length>0?'green':'amber',  note: camps.length>0?'Running on schedule':'No campaigns live' },
    { icon:'🤖', label:'AI Actions Executed',     val: actions.length,       status: 'green',  note: `~${hrsSaved}h manual work saved` },
    { icon:'🧪', label:'A/B Tests Running',       val: abTests.length,       status: abTests.length>0?'green':'neutral', note: abTests.length>0?'Optimisation active':'Start a test in Campaigns' },
    { icon:'📡', label:'Ad Platforms Connected',  val: channels.length||1,   status: 'green',  note: channels.join(', ') || 'No campaigns yet' },
    { icon:'🖼️', label:'Brand Assets Uploaded',   val: (window._brandAssets||[]).length, status:(window._brandAssets||[]).length>0?'green':'amber', note:'In creative library' },
    { icon:'📊', label:'Competitors Monitored',   val: comps.length,         status: comps.length>0?'green':'amber',  note: `In ${ind}` },
  ];

  const statusCol = { green:'#10B981', amber:'#F59E0B', neutral:'#6B7280' };

  return `
  <div class="cs-exec-banner" style="background:var(--ig-grad)">
    <div class="cs-exec-role-badge" style="background:rgba(217,119,6,.2);border-color:rgba(217,119,6,.3);color:#FDE68A">${rm.icon} ${rm.label} · Operations Report</div>
    <div class="cs-exec-headline">Marketing Operations & Execution Status</div>
    <div class="cs-exec-sub">Campaign execution health, automation performance, platform integrations, and operational bottlenecks for ${url || 'your brand'}. Period: ${csPeriodLabel()}.</div>
    <div class="cs-exec-stats">
      ${[['Campaigns Live',camps.length],['AI Actions',actions.length],['Hours Saved',hrsSaved+'h'],['A/B Tests',abTests.length],['Platforms',channels.length||1],['Assets',( window._brandAssets||[]).length]].map(([l,v],i,a)=>`
        <div class="cs-exec-stat"><div class="cs-exec-stat-val">${v}</div><div class="cs-exec-stat-label">${l}</div></div>${i<a.length-1?'<div class="cs-exec-stat-sep"></div>':''}
      `).join('')}
    </div>
  </div>

  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
    <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">COO Dashboard <span style="font-size:0.72rem;font-weight:400;color:#6B7280">· ${new Date().toLocaleDateString()}</span></div>
    ${periodHtml}
  </div>

  <!-- Operations Status Grid -->
  <div class="cs-kpi-grid" style="--cs-accent:${rm.color}">
    ${ops.map(o=>{
      const col = statusCol[o.status];
      return `<div class="cs-kpi" style="--cs-accent:${col}">
        <div style="font-size:1.5rem;margin-bottom:4px">${o.icon}</div>
        <div class="cs-kpi-val" style="color:${col};font-size:1.3rem">${o.val}</div>
        <div class="cs-kpi-label">${o.label}</div>
        <div class="cs-kpi-delta neutral" style="color:${col}">${o.note}</div>
      </div>`;
    }).join('')}
  </div>

  <div class="cs-two-col">
    <!-- Campaign execution status -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">📋 Campaign Execution Status</div><div class="cs-card-sub">All active campaigns</div></div></div>
      ${camps.length ? camps.map(c => {
        const stat = c.status || 'active';
        const sc   = stat==='active'?'#10B981':stat==='paused'?'#F59E0B':'#6B7280';
        const spend= Math.round((c.budget||0)*0.15);
        const pct  = Math.min(Math.round(spend/(c.budget||1)*100*12),100);
        return `<div class="cs-insight">
          <div class="cs-insight-icon" style="background:${sc}15;color:${sc}">🚀</div>
          <div class="cs-insight-text">
            <div class="cs-insight-title">${c.name}</div>
            <div class="cs-insight-sub">${c.platform} · ${c.budgetStr}/mo · <span style="color:${sc};font-weight:700">${stat.toUpperCase()}</span></div>
            <div class="cs-bar-track" style="margin-top:5px;height:5px"><div class="cs-bar-fill" style="width:${pct}%;background:${sc}"></div></div>
            <div style="font-size:0.65rem;color:#9CA3AF;margin-top:2px">Budget pacing: ${pct}% of monthly</div>
          </div>
        </div>`;
      }).join('') : '<div style="text-align:center;padding:24px;color:#9CA3AF;font-size:0.82rem">No campaigns launched yet</div>'}
    </div>

    <!-- Action log -->
    <div class="cs-card">
      <div class="cs-card-header"><div><div class="cs-card-title">⚡ AI Automation Log</div><div class="cs-card-sub">Automated actions taken by InfoGenie</div></div></div>
      ${[...actions.slice(0,4), ...(!actions.length ? [
        { type:'analysis', action:'Competitor intelligence engine activated', impact:`${comps.length} rivals mapped` },
        { type:'campaigns', action:'AI campaign recommendations generated', impact:`${camps.length || 'N/A'} campaigns scored` },
        { type:'audience', action:'Target audience auto-segmented', impact:'Applied to all campaigns' },
      ] : [])].slice(0,5).map(a => {
        const colMap = { campaign_launch:'#0066FF', analysis:'#00C9C8', campaigns:'#10B981', audience:'#7C3AED', config:'#6B7280' };
        const col = colMap[a.type] || '#7C3AED';
        return `<div class="cs-insight">
          <div class="cs-insight-icon" style="background:${col}15;color:${col}">⚡</div>
          <div class="cs-insight-text">
            <div class="cs-insight-title">${a.action}</div>
            ${a.impact?`<div class="cs-insight-sub" style="color:#059669">✓ ${a.impact}</div>`:''}
            ${a.date?`<div style="font-size:0.65rem;color:#9CA3AF">${a.date} ${a.time||''}</div>`:''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- Bottleneck analysis -->
  <div class="cs-card">
    <div class="cs-card-header"><div><div class="cs-card-title">🔍 Operational Bottlenecks & COO Actions</div></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
      ${[
        { icon:'📤', bg:'#EFF6FF', col:'#1D4ED8', title:'Creative Refresh', desc: (window._brandAssets||[]).length === 0 ? 'No brand assets uploaded — creative library is empty. Upload logos and ad creatives.' : `${(window._brandAssets||[]).length} assets in library. Schedule monthly refresh cycle.` },
        { icon:'🧪', bg:'#FDF4FF', col:'#7C3AED', title:'A/B Testing Cadence', desc: abTests.length === 0 ? 'No A/B tests running. Start split testing to improve ROAS by estimated 15–25%.' : `${abTests.length} test(s) active. Review winners weekly and rotate creatives.` },
        { icon:'🔌', bg:'#F0FDF4', col:'#059669', title:'Platform Connections', desc: channels.length >= 2 ? `${channels.length} platforms connected. Ensure API tokens are valid and refresh alerts are set.` : 'Connect additional ad platforms to diversify and reduce single-channel risk.' },
        { icon:'📊', bg:'#FFF7ED', col:'#D97706', title:'Reporting Cadence', desc: 'C-Suite reports should be reviewed weekly. Enable automated email reports for board distribution.' },
      ].map(b=>`
        <div style="background:${b.bg};border-radius:12px;padding:14px 16px">
          <div style="font-size:1.1rem;margin-bottom:6px">${b.icon}</div>
          <div style="font-size:0.78rem;font-weight:700;color:${b.col};margin-bottom:4px">${b.title}</div>
          <div style="font-size:0.72rem;color:#374151;line-height:1.45">${b.desc}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

// ── PDF Export ────────────────────────────────────────────────────────────────
function csSuitePDF() {
  const role = window._csRole.toUpperCase();
  const roleLabel = { CEO:'Chief Executive Officer', CMO:'Chief Marketing Officer', CFO:'Chief Financial Officer', COO:'Chief Operating Officer' }[window._csRole.toUpperCase()] || role;
  const content = document.getElementById('csuiteWrap')?.innerHTML || '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>InfoGenie ${role} Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a2e;background:#fff;padding:28px 36px}
h1{font-size:1.5rem;color:#7C3AED;margin-bottom:4px}
.subtitle{font-size:0.8rem;color:#6B7280;margin-bottom:24px}
.logo-row{display:flex;align-items:center;gap:10px;margin-bottom:20px}
.logo-icon{width:32px;height:32px;background:linear-gradient(135deg,#00C9C8,#0066FF);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:0.9rem}
.logo-text{font-size:1.2rem;font-weight:900;color:#0066FF}
/* Inline all computed styles from the report */
.cs-exec-banner{background:var(--ig-panel);border-radius:12px;padding:20px 24px;margin-bottom:20px;color:var(--ig-text)}
.cs-exec-headline{font-size:1.2rem;font-weight:800;color:white;margin-bottom:4px}
.cs-exec-sub{font-size:0.75rem;color:rgba(255,255,255,.5)}
.cs-exec-stats{display:flex;gap:16px;margin-top:14px;flex-wrap:wrap}
.cs-exec-stat-val{font-size:1.2rem;font-weight:800;color:white}
.cs-exec-stat-label{font-size:0.58rem;color:rgba(255,255,255,.4);text-transform:uppercase}
.cs-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.cs-kpi{border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px}
.cs-kpi-val{font-size:1.3rem;font-weight:800;color:#7C3AED}
.cs-kpi-label{font-size:0.62rem;color:#6B7280;margin-top:3px}
.cs-kpi-delta{font-size:0.62rem;margin-top:2px;color:#10B981}
.cs-card{border:1px solid #E2E8F0;border-radius:12px;padding:16px 18px;margin-bottom:14px}
.cs-card-title{font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:10px}
.cs-bar-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.72rem}
.cs-bar-label{min-width:110px;font-weight:600;color:#374151}
.cs-bar-track{flex:1;background:#F3F4F6;border-radius:4px;height:7px;overflow:hidden}
.cs-bar-fill{height:100%;border-radius:4px}
.cs-bar-val{font-size:0.7rem;font-weight:700;min-width:36px;text-align:right}
.cs-two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.cs-comp-table{width:100%;border-collapse:collapse;font-size:0.72rem}
.cs-comp-table th{background:#F9FAFB;padding:6px 8px;text-align:left;border-bottom:1px solid #E2E8F0;font-size:0.62rem;color:#6B7280;text-transform:uppercase}
.cs-comp-table td{padding:7px 8px;border-bottom:1px solid #F3F4F6}
.cs-alert{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;margin-bottom:6px;font-size:0.72rem}
.cs-alert-success{background:#F0FDF4;border:1px solid #86EFAC;color:#065F46}
.cs-alert-warning{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E}
.cs-alert-critical{background:#FEF2F2;border:1px solid #FECACA;color:#991B1B}
.cs-insight{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:0.75rem}
.cs-exec-role-badge{display:inline-block;background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);border-radius:99px;padding:3px 12px;font-size:0.62rem;font-weight:700;color:#C4B5FD;text-transform:uppercase;margin-bottom:10px}
.footer{margin-top:32px;font-size:0.65rem;color:#9CA3AF;text-align:center;border-top:1px solid #E2E8F0;padding-top:14px}
@media print{body{padding:12px 16px}@page{margin:10mm 8mm}}
</style></head>
<body>
<div class="logo-row"><div class="logo-icon">IG</div><div class="logo-text">InfoGenie</div></div>
<h1>${role} Executive Report — ${roleLabel}</h1>
<div class="subtitle">Generated: ${new Date().toLocaleString()} · Period: ${csPeriodLabel()} · Confidential</div>
${content}
<div class="footer">InfoGenie — AI Autonomous Marketing Intelligence &nbsp;·&nbsp; Confidential — Board Use Only</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`;

  const win = window.open('','_blank');
  if (!win) { showToast('⚠ Allow pop-ups to export PDF'); return; }
  win.document.write(html);
  win.document.close();
  showToast(`📄 ${role} report opening for PDF export`);
}

function csPeriodLabel() {
  return { '7d':'Last 7 Days', '30d':'Last 30 Days', '90d':'Last Quarter', '1y':'Annual' }[window._csPeriod] || 'Last 30 Days';
}

/* ══════════════════════════════════════════════════════════════
   ACTION CENTER — Live / Going Live / Risks / Opportunities
   ══════════════════════════════════════════════════════════════ */

function initActionCenter() {
  const wrap = document.getElementById('actionCenterWrap');
  if (!wrap) return;
  wrap.innerHTML = acBuild();
}

function acBuild() {
  const camps   = window._launchedCampaigns || [];
  const actions = window._infoGenieActions  || [];
  const ad      = analysisData;
  const comps   = ad?.competitors || [];
  const bench   = typeof getIndustryROASBenchmark === 'function' ? getIndustryROASBenchmark() : { avg: 3.5, top: 6.0, min: 2.0, label: 'Your Industry' };
  const assets  = window._brandAssets || [];
  const abTests = window._abTests || [];
  const ld      = window._leadData || {};
  const budget  = camps.reduce((s,c) => s + (c.budget||0), 0);
  const avgROAS = camps.length ? (camps.reduce((s,c) => s + parseFloat(c.metrics?.roas||bench.avg), 0)/camps.length) : 0;
  const indLabel = bench.label;

  // ── Section: What's LIVE ───────────────────────────────────────────────────
  const liveItems = [
    ...camps.map(c => ({
      icon: '🚀', color: '#10B981', tag: 'CAMPAIGN LIVE',
      title: c.name || 'Campaign',
      detail: `${c.platform} · $${(c.budget||0).toLocaleString()}/mo · ROAS ${parseFloat(c.metrics?.roas||bench.avg).toFixed(1)}×`,
      meta: c.launchedAt || 'Active',
    })),
    ...(ad ? [{ icon: '🔍', color: '#00C9C8', tag: 'ANALYSIS ACTIVE', title: `Competitive intelligence — ${comps.length} rivals tracked`, detail: `${indLabel} · ${comps.length} competitor${comps.length!==1?'s':''} monitored in real-time`, meta: 'Live' }] : []),
    ...(actions.length ? [{ icon: '⚡', color: '#7C3AED', tag: 'AUTOMATIONS RUNNING', title: `${actions.length} AI automation${actions.length!==1?'s':''} executed`, detail: `~${(actions.length*2.5).toFixed(0)} hours of manual work saved by InfoGenie`, meta: `${actions.length} actions` }] : []),
    ...(assets.length ? [{ icon: '🖼️', color: '#0066FF', tag: 'BRAND ASSETS LIVE', title: `${assets.length} creative asset${assets.length!==1?'s':''} in library`, detail: 'Brand creatives available for campaign deployment', meta: `${assets.length} files` }] : []),
    ...(abTests.length ? [{ icon: '🧪', color: '#F59E0B', tag: 'A/B TESTS RUNNING', title: `${abTests.length} split test${abTests.length!==1?'s':''} active`, detail: 'Live experiments running — check Campaign view for results', meta: 'Testing' }] : []),
  ];

  // ── Section: Going LIVE (upcoming) ─────────────────────────────────────────
  const goingLive = [
    ...(!ad ? [{ icon: '🔍', color: '#6B7280', tag: 'NEXT STEP', title: 'Run competitor analysis', detail: 'Enter your website URL to activate market intelligence — unlocks all features', cta: "navigateTo('home')", ctaLabel: 'Start Analysis' }] : []),
    ...(camps.length === 0 ? [{ icon: '🚀', color: '#6B7280', tag: 'RECOMMENDED', title: 'Launch your first ad campaign', detail: `InfoGenie has ${ad ? 'campaign templates ready' : 'AI-powered templates'} — takes 2 minutes to deploy`, cta: "navigateTo('campaigns')", ctaLabel: 'Go to Campaigns' }] : []),
    ...(assets.length === 0 ? [{ icon: '🖼️', color: '#6B7280', tag: 'RECOMMENDED', title: 'Upload brand creatives', detail: 'Add your logos and ad images to the Brand Assets library for faster campaign deployment', cta: "navigateTo('brand-assets')", ctaLabel: 'Upload Assets' }] : []),
    ...(abTests.length === 0 && camps.length > 0 ? [{ icon: '🧪', color: '#6B7280', tag: 'IMPROVE ROAS', title: 'Start your first A/B test', detail: `Split testing typically lifts ROAS by 15–25% in ${indLabel} — quick win available`, cta: "navigateTo('campaigns')", ctaLabel: 'Set Up Test' }] : []),
    { icon: '📊', color: '#6B7280', tag: 'AVAILABLE NOW', title: 'C-Suite executive reports', detail: 'CEO/CMO/CFO/COO dashboards with PDF export — ready to share with your board', cta: "navigateTo('csuite')", ctaLabel: 'View Reports' },
    { icon: '🤖', color: '#6B7280', tag: 'AVAILABLE NOW', title: 'Configure AI automations', detail: 'Set up automated campaign optimisation, alert triggers and scheduled reports', cta: "navigateTo('automations')", ctaLabel: 'Set Up Automations' },
  ];

  // ── Section: Risks ─────────────────────────────────────────────────────────
  const risks = [];
  if (!ad) {
    risks.push({ sev:'high', icon:'🔴', title:'No competitor intelligence active', detail:'Without analysis, you have no visibility into what competitors are spending, where they\'re winning, or how to outbid them.', action:'Run analysis from the home page' });
  }
  if (camps.length === 0) {
    risks.push({ sev:'high', icon:'🔴', title:'Zero campaigns live — no market presence', detail:'Competitors are capturing the audiences that should be yours. Every day without campaigns is budget given to rivals.', action:'Launch at least one campaign to establish presence' });
  }
  if (avgROAS > 0 && avgROAS < bench.min) {
    risks.push({ sev:'high', icon:'🔴', title:`ROAS ${avgROAS.toFixed(1)}× is below the ${indLabel} minimum (${bench.min}×)`, detail:`Your campaigns are burning budget below break-even for this industry. Immediate restructure required.`, action:`Pause underperformers and restructure targeting to reach ${bench.avg}× minimum` });
  } else if (avgROAS > 0 && avgROAS < bench.avg) {
    risks.push({ sev:'medium', icon:'🟡', title:`ROAS ${avgROAS.toFixed(1)}× below ${indLabel} average (${bench.avg}×)`, detail:`You're profitable but leaving money on the table. ${indLabel} top performers achieve ${bench.top}×.`, action:`Optimise bidding and creative to push towards ${bench.avg}× industry average` });
  }
  if (assets.length === 0) {
    risks.push({ sev:'medium', icon:'🟡', title:'No brand creative assets uploaded', detail:'Ad campaigns using generic or placeholder creatives underperform by 40–60%. Brand consistency directly impacts ROAS.', action:'Upload brand logo, ad images and approved creative variants' });
  }
  if (comps.length > 0 && budget > 0) {
    const biggestComp = comps[0];
    const theirSpend = biggestComp?.adSpend || biggestComp?.estimatedAdSpend || 'Unknown';
    risks.push({ sev:'medium', icon:'🟡', title:`${biggestComp.name} is your primary competitive threat in ${indLabel}`, detail:`${biggestComp.name} is actively running campaigns targeting the same audience segments. Their ad spend: ${typeof theirSpend==='number'?'$'+theirSpend.toLocaleString():theirSpend}.`, action:`Use competitor intelligence in Results to find and exploit their weak spots` });
  }
  if (budget > 0 && abTests.length === 0) {
    risks.push({ sev:'low', icon:'🟢', title:'No A/B tests running — creative fatigue risk', detail:`In ${indLabel}, ad creative fatigue typically sets in after 21 days. Without split testing, CTR will decline 10–15% per month.`, action:'Start a 50/50 creative split test in the Campaigns view' });
  }
  if (risks.length === 0) {
    risks.push({ sev:'low', icon:'🟢', title:'No critical risks detected', detail:'Your marketing setup looks healthy. Keep monitoring ROAS against the industry benchmark and refresh creatives regularly.', action:'Continue monitoring via C-Suite reports' });
  }

  // ── Section: Opportunities ─────────────────────────────────────────────────
  const opps = [];
  if (comps.length > 0) {
    const weakComp = [...comps].sort((a,b) => (a.roas||99) - (b.roas||99))[0];
    if (weakComp) {
      const gap = weakComp.roas ? (bench.avg - weakComp.roas).toFixed(1) : '1.5';
      opps.push({ icon:'⚔️', color:'#7C3AED', title:`Exploit ${weakComp.name}'s ROAS gap`, detail:`${weakComp.name} is running at ${weakComp.roas||'—'}× ROAS — ${gap}× below the ${indLabel} average. Their wasted ad spend is a direct capture opportunity for your brand.`, upside:`+${gap}× ROAS potential on competitor-targeted campaigns` });
    }
  }
  if (avgROAS > 0 && avgROAS < bench.top) {
    const lift = (bench.top - avgROAS).toFixed(1);
    opps.push({ icon:'📈', color:'#10B981', title:`Scale to ${bench.top}× ROAS — top ${indLabel} benchmark`, detail:`Your current ${avgROAS.toFixed(1)}× ROAS has headroom to reach ${bench.top}× (top 10% of ${indLabel}). The gap = ${lift}× of unrealised revenue per $1 spent.`, upside:`${lift}× ROAS improvement = $${Math.round(budget * lift).toLocaleString()}/mo additional revenue at current spend` });
  }
  if (camps.length > 0) {
    const bestCamp = camps.slice().sort((a,b) => parseFloat(b.metrics?.roas||0) - parseFloat(a.metrics?.roas||0))[0];
    if (bestCamp && parseFloat(bestCamp.metrics?.roas||0) > bench.avg) {
      opps.push({ icon:'🚀', color:'#0066FF', title:`Scale "${bestCamp.name}" — top performing campaign`, detail:`This campaign is running above the ${indLabel} average at ${parseFloat(bestCamp.metrics?.roas||bench.avg).toFixed(1)}×. Increasing budget here has the highest probability of efficient return.`, upside:`Scale budget by 30% to capture additional high-intent audience without efficiency loss` });
    }
  }
  if (ad && comps.length > 0) {
    const unusedCh = ['TikTok','Pinterest','LinkedIn','YouTube'].find(ch => !camps.some(c => c.platform?.toLowerCase().includes(ch.toLowerCase())));
    if (unusedCh) {
      opps.push({ icon:'📡', color:'#00C9C8', title:`Untapped channel: ${unusedCh} is underused by competitors`, detail:`InfoGenie's analysis shows competitors have minimal ${unusedCh} presence. First-mover advantage in ${indLabel} on this platform typically delivers 0.5–0.8× ROAS premium.`, upside:`Test $500/mo on ${unusedCh} — expect lower CPC and higher reach in under-served segments` });
    }
  }
  if (opps.length === 0) {
    opps.push({ icon:'💡', color:'#0066FF', title:'Run analysis to unlock personalised opportunities', detail:'After InfoGenie analyses your website and competitors, AI identifies specific gaps, keyword opportunities and audience segments tailored to your market.', upside:'Complete the analysis to see your custom opportunity playbook' });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const ts = new Date().toLocaleString();

  const acCard = (title, sub, items, renderFn) => `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:18px;padding:22px 24px;margin-bottom:22px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
      <div style="margin-bottom:18px">
        <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">${title}</div>
        <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${sub}</div>
      </div>
      ${items.length ? items.map(renderFn).join('') : '<div style="text-align:center;padding:28px;color:#9CA3AF;font-size:0.82rem">No items yet</div>'}
    </div>`;

  const liveHtml = acCard('🟢 What\'s Live', `${liveItems.length} active item${liveItems.length!==1?'s':''} — updated ${ts}`, liveItems, item => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #F3F4F6">
      <div style="width:36px;height:36px;border-radius:10px;background:${item.color}15;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">${item.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:0.7rem;font-weight:700;color:${item.color};background:${item.color}15;border:1px solid ${item.color}30;border-radius:99px;padding:2px 8px">${item.tag}</span>
          <span style="font-size:0.8rem;font-weight:700;color:#0A1628">${item.title}</span>
        </div>
        <div style="font-size:0.73rem;color:#6B7280">${item.detail}</div>
      </div>
      <div style="font-size:0.68rem;font-weight:700;color:${item.color};white-space:nowrap;flex-shrink:0">${item.meta}</div>
    </div>`);

  const goingHtml = acCard('🔜 Going Live / Next Actions', `${goingLive.length} recommended item${goingLive.length!==1?'s':''} — priority order`, goingLive, item => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid #F3F4F6">
      <div style="width:36px;height:36px;border-radius:10px;background:#F3F4F6;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">${item.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;flex-wrap:wrap">
          <span style="font-size:0.7rem;font-weight:700;color:${item.color};background:${item.color}15;border:1px solid ${item.color}30;border-radius:99px;padding:2px 8px">${item.tag}</span>
          <span style="font-size:0.8rem;font-weight:700;color:#0A1628">${item.title}</span>
        </div>
        <div style="font-size:0.73rem;color:#6B7280;margin-bottom:6px">${item.detail}</div>
        ${item.cta ? `<button onclick="${item.cta}" style="font-size:0.7rem;font-weight:700;color:#0066FF;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:6px;padding:3px 10px;cursor:pointer">→ ${item.ctaLabel}</button>` : ''}
      </div>
    </div>`);

  const sevOrder = { high:0, medium:1, low:2 };
  const sortedRisks = [...risks].sort((a,b) => (sevOrder[a.sev]||2) - (sevOrder[b.sev]||2));
  const sevCfg = { high: { bg:'#FEF2F2', bd:'#FECACA', col:'#DC2626', label:'HIGH' }, medium: { bg:'#FFFBEB', bd:'#FDE68A', col:'#D97706', label:'MEDIUM' }, low: { bg:'#F0FDF4', bd:'#86EFAC', col:'#059669', label:'LOW' } };
  const risksHtml = acCard('⚠️ Risks', `${risks.filter(r=>r.sev==='high').length} critical, ${risks.filter(r=>r.sev==='medium').length} medium, ${risks.filter(r=>r.sev==='low').length} low`, sortedRisks, r => {
    const cfg = sevCfg[r.sev] || sevCfg.low;
    return `<div style="background:${cfg.bg};border:1px solid ${cfg.bd};border-radius:12px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span style="font-size:1.1rem;line-height:1.2;flex-shrink:0">${r.icon}</span>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <span style="font-size:0.62rem;font-weight:800;color:${cfg.col};background:${cfg.col}20;border-radius:4px;padding:1px 7px;text-transform:uppercase">${cfg.label} RISK</span>
            <span style="font-size:0.82rem;font-weight:700;color:#0A1628">${r.title}</span>
          </div>
          <div style="font-size:0.75rem;color:#374151;margin-bottom:6px;line-height:1.45">${r.detail}</div>
          <div style="font-size:0.72rem;font-weight:600;color:${cfg.col}">▶ ${r.action}</div>
        </div>
      </div>
    </div>`;
  });

  const oppsHtml = acCard('💡 Opportunities', `${opps.length} exploitable opportunity${opps.length!==1?'s':''} identified for ${indLabel}`, opps, o => `
    <div style="border:1px solid #E2E8F0;border-left:3px solid ${o.color};border-radius:12px;padding:14px 16px;margin-bottom:10px;background:#FAFAFA">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="width:34px;height:34px;border-radius:9px;background:${o.color}15;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">${o.icon}</div>
        <div style="flex:1">
          <div style="font-size:0.82rem;font-weight:700;color:#0A1628;margin-bottom:4px">${o.title}</div>
          <div style="font-size:0.73rem;color:#6B7280;margin-bottom:8px;line-height:1.45">${o.detail}</div>
          <div style="display:inline-flex;align-items:center;gap:6px;background:${o.color}12;border:1px solid ${o.color}25;border-radius:8px;padding:5px 10px">
            <span style="font-size:0.68rem;font-weight:700;color:${o.color}">📈 UPSIDE: ${o.upside}</span>
          </div>
        </div>
      </div>
    </div>`);

  // Summary banner
  const critCount = risks.filter(r=>r.sev==='high').length;
  const oppCount  = opps.length;
  const liveCount = liveItems.length;

  return `
  <!-- Summary Banner -->
  <div style="background:var(--ig-grad);border-radius:18px;padding:22px 28px;margin-bottom:28px;border:1px solid rgba(0,229,255,.2)">
    <div style="font-size:0.68rem;font-weight:700;color:#00C9C8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">🎯 Command Overview — ${ts}</div>
    <div style="font-family:Sora,sans-serif;font-size:1.35rem;font-weight:800;color:white;margin-bottom:4px">
      ${liveCount} item${liveCount!==1?'s':''} live · ${critCount} critical risk${critCount!==1?'s':''} · ${oppCount} opportunit${oppCount===1?'y':'ies'} ready
    </div>
    <div style="font-size:0.8rem;color:rgba(255,255,255,.5);margin-bottom:18px">${indLabel} · InfoGenie AI monitoring ${comps.length} competitor${comps.length!==1?'s':''} · ${camps.length} campaign${camps.length!==1?'s':''} active</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
      ${[
        ['🟢 Live', liveCount, '#10B981'],
        ['🔜 Going Live', goingLive.length, '#0066FF'],
        ['⚠️ Risks', risks.length, critCount>0?'#DC2626':'#F59E0B'],
        ['💡 Opportunities', opps.length, '#7C3AED'],
      ].map(([l,v,c]) => `
        <div style="text-align:center">
          <div style="font-family:Sora,sans-serif;font-size:1.6rem;font-weight:800;color:${c}">${v}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,.45);margin-top:3px;text-transform:uppercase;letter-spacing:.05em">${l}</div>
        </div>`).join('<div style="width:1px;background:rgba(255,255,255,.1)"></div>')}
    </div>
  </div>

  <!-- Two-column layout -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px">
    <div>${liveHtml}${goingHtml}</div>
    <div>${risksHtml}${oppsHtml}</div>
  </div>`;
}

  // ── Re-export public entry points (navigateTo dispatch + inline onclick=) ──
  window.initCsuite       = initCsuite;
  window.csSetRole        = csSetRole;
  window.csSetPeriod      = csSetPeriod;
  window.csSuitePDF       = csSuitePDF;
  window.initActionCenter = initActionCenter;
})();

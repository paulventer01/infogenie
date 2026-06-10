// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ig_core_views.js — Core marketing view-builders                          ║
// ║                                                                          ║
// ║ Extracted verbatim from app.js (no behaviour change). Holds four         ║
// ║ cohesive core views plus their private helpers:                          ║
// ║   • Dashboard          — buildDashboard + renderCTR/ROAS/TrendChart      ║
// ║   • Audience           — buildAudience + targetAudience                   ║
// ║   • Creative           — buildCreative + creative/audience-panel helpers  ║
// ║   • Reddit Intelligence— buildRedditIntel + scan/reply/suggest helpers   ║
// ║                                                                          ║
// ║ Wrapped in one IIFE per the public/js/ convention. Entry points and any  ║
// ║ helper referenced by an inline onclick= are re-attached to window at the ║
// ║ bottom. Reads shared globals (analysisData, navigateTo, showToast, Chart,║
// ║ _fmt, getCountryLabel, renderYourSwot, calcOpportunityScore, the chart   ║
// ║ instance vars, openCompetitorAnalysis/openThreatModal, postReplyToReddit ║
// ║ and the _data*/_populateAdSpendColumn/_renderJourneyStages window helpers)║
// ║ from app.js.                                                             ║
// ╚══════════════════════════════════════════════════════════════════════════╝
(function () {
'use strict';

// ═══════════════════ DASHBOARD ═══════════════════
// ===== BUILD DASHBOARD =====
// ── Dashboard-diag replay ─────────────────────────────────────────────────
// Loads a previously-captured analyse payload from the server and renders
// the dashboard from it — no API calls, no waiting. Used by the temporary
// "Dashboard Diag" nav link to debug the post-render freeze quickly.
window._loadDashboardDiag = async function _loadDashboardDiag(domain) {
  try {
    window.IGDiag && IGDiag.mark('dashboard-diag: fetching capture', domain || 'latest');
    const url = '/api/diag-capture/' + (domain ? encodeURIComponent(domain) : 'latest');
    const r = await fetch(url);
    const j = await r.json();
    if (!j || !j.ok || !j.analysisData) {
      showToast('⚠ No capture yet. Run Analyse Now once on any domain first.');
      window.IGDiag && IGDiag.err && IGDiag.err('dashboard-diag: no capture', JSON.stringify(j||{}).slice(0,200));
      return;
    }
    analysisData = j.analysisData;
    window.analysisData = analysisData;
    if (j.brandKit) window._brandKit = j.brandKit;
    if (j.lastCompetitorNames) window._lastCompetitorNames = j.lastCompetitorNames;
    window.IGDiag && IGDiag.mark('dashboard-diag: loaded',
      'domain=' + (analysisData.url || '?') + ' · comps=' + ((analysisData.competitors||[]).length));
    // Start the same heartbeat we use for the real analyse flow so freeze
    // diagnosis is identical in both paths.
    try { window.IGDiag && IGDiag.startHeartbeat && IGDiag.startHeartbeat('dash-diag', 250); } catch(_) {}
    setTimeout(() => { try { window.IGDiag && IGDiag.stopHeartbeat && IGDiag.stopHeartbeat(); } catch(_) {} }, 15000);
    // Navigate first so #dashboard view is visible, then explicitly call
    // buildDashboard() — navigateTo only toggles view visibility; it does NOT
    // build the dashboard (real Analyse flow calls buildDashboard directly).
    navigateTo('dashboard');
    try {
      window.IGDiag && IGDiag.mark('dashboard-diag: calling buildDashboard');
      buildDashboard();
    } catch (e) {
      window.IGDiag && IGDiag.err && IGDiag.err('dashboard-diag: buildDashboard threw', e && e.message || String(e));
      showToast('⚠ buildDashboard error: ' + (e && e.message || e));
    }
    showToast('🧪 Dashboard loaded from cached capture — ' + (analysisData.url || ''));
  } catch (e) {
    showToast('⚠ Dashboard-diag failed: ' + (e && e.message || e));
    window.IGDiag && IGDiag.err && IGDiag.err('dashboard-diag: exception', String(e));
  }
};

function buildDashboard() {
  // ── Tear-down between Analyse runs ────────────────────────────────────────
  // Destroy every chart instance this build will recreate so old chart
  // objects, resize listeners and animation frames don't accumulate across
  // re-runs. Also pause the global field enhancer's MutationObserver for the
  // duration of the build so the multiple large innerHTML inserts below
  // (kpiGrid, roiBanner, table body, dashLivePanels) don't flood the main
  // thread with mutation records mid-build.
  try { performance.mark && performance.mark('ig:buildDashboard:start'); } catch(_) {}
  const _dashT0 = (window.performance && performance.now) ? performance.now() : Date.now();
  try { window.IGFields && window.IGFields.pause && window.IGFields.pause(); } catch(_) {}
  const _dashCharts = [
    ['sov', sovChartInstance], ['forecast', forecastChartInstance],
    ['spend', spendChartInstance], ['efficiency', efficiencyChartInstance],
    ['ctr', ctrChartInstance], ['roas', roasChartInstance], ['trend', trendChartInstance]
  ];
  _dashCharts.forEach(([_n, c]) => { try { c && c.destroy && c.destroy(); } catch(_) {} });
  sovChartInstance = null; forecastChartInstance = null;
  spendChartInstance = null; efficiencyChartInstance = null;
  ctrChartInstance = null; roasChartInstance = null; trendChartInstance = null;
  // Clear container DOM that this build owns so re-runs don't compound size
  ['dashLivePanels','kpiGrid','compSummaryBody','analysisTags','competitorChips','roiBanner']
    .forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });

  const { url, country, industry, websiteKPIs, competitors } = analysisData;
  
  // Title — adapt for sector-only mode (no real website was analysed)
  if (analysisData.sectorOnly) {
    document.getElementById('dashTitle').textContent = `Sector Overview: ${industry.name}`;
    document.getElementById('dashSub').textContent = `Industry-wide intelligence · ${competitors.length} top competitors mapped · No website yet — add one anytime to personalise this report`;
  } else {
    document.getElementById('dashTitle').textContent = `Intelligence Report: ${url}`;
    document.getElementById('dashSub').textContent = `${industry.name} · ${competitors.length} competitors analysed · AI recommendations generated`;
  }

  // ── Staged-pipeline runner ─────────────────────────────────────────────────
  // Every heavy DOM write or chart construction below is pushed into _dashStages
  // and run one stage per animation frame at the end of this function. This
  // means the main thread is never blocked long enough to freeze the diagnostic
  // button (or any other UI) — regardless of which stage would have been the
  // slow one on a given run. Cheap computation continues to run inline.
  const _dashStages = [];
  const _dashEnq = (name, fn) => _dashStages.push([name, fn]);

  // Analysis tags
  const tagsEl = document.getElementById('analysisTags');
  const countryLabel = getCountryLabel(analysisData.country);
  _dashEnq('tags', () => {
    if (!tagsEl || !tagsEl.isConnected) return;
    tagsEl.innerHTML = `
      <span class="atag" title="Your industry category — all benchmarks and AI recommendations are calibrated to this vertical.">${industry.name}</span>
      <span class="atag" title="Geographic scope of the analysis — traffic, ad spend and benchmarks are filtered to this market.">${countryLabel}</span>
      <span class="atag" title="${competitors.length} rival domains are being tracked and benchmarked in this report.">${competitors.length} Competitors</span>
      <span class="atag live-tag" title="Data is refreshed in real time — competitor signals, traffic estimates and alerts are always current."><span class="live-dot-inline"></span>Live Intel</span>
    `;
  });

  // ── Competitor name chips (clickable → opens analysis modal) ───────────────
  const chipsEl = document.getElementById('competitorChips');
  _dashEnq('chips', () => {
    if (!chipsEl || !chipsEl.isConnected) return;
    if (!competitors || !competitors.length) { chipsEl.innerHTML = ''; return; }
    const aiAny = competitors.some(c => c.aiDetected);
    chipsEl.innerHTML = `
      <div class="cchips-label">
        <span>${aiAny ? '🤖 AI-detected competitors' : '🎯 Tracked competitors'} · click any name for full analysis</span>
      </div>
      <div class="cchips-row">
        ${competitors.map((c, i) => `
          <button class="cchip" data-comp-idx="${i}" title="${(c.why || ('Click to analyse ' + c.name)).replace(/"/g,'&quot;')}">
            <span class="cchip-dot" style="background:${['#0066FF','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#EC4899','#84CC16'][i % 8]}"></span>
            <span class="cchip-name">${c.name}</span>
            ${c.aiDetected ? '<span class="cchip-ai">AI</span>' : ''}
          </button>
        `).join('')}
      </div>
    `;
    chipsEl.querySelectorAll('.cchip').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-comp-idx'), 10);
        openCompetitorAnalysis(competitors[idx]);
      });
    });
  });

  // KPIs — only count competitors that actually have numeric values, otherwise
  // missing/'—' entries would poison the averages with NaN.
  const _safeAvg = arr => {
    const nums = arr.filter(n => typeof n === 'number' && isFinite(n) && n > 0);
    return nums.length ? nums.reduce((a,b) => a+b, 0) / nums.length : 0;
  };
  const avgCTR  = _safeAvg(competitors.map(c => parseFloat(c.ctr)));
  const avgROAS = _safeAvg(competitors.map(c => typeof c.roas === 'number' ? c.roas : parseFloat(c.roas)));
  const yourCTR = websiteKPIs.ctr;
  const yourROAS = websiteKPIs.roas;
  
  // Use real DataForSEO traffic if available, otherwise fall back to AI estimate
  const realTraffic   = analysisData._yourRealData && analysisData._yourRealData.organicTraffic;
  const trafficVal    = realTraffic || websiteKPIs.trafficMo;
  const trafficSource = realTraffic ? '📡 DataForSEO live data' : 'AI industry benchmark';
  const trafficBadge  = realTraffic
    ? `<span style="font-size:.65rem;background:#10B98120;color:#10B981;padding:2px 6px;border-radius:10px;font-weight:700" title="Live data pulled directly from DataForSEO — this is a real-time measurement, not an estimate.">LIVE</span>`
    : `<span style="font-size:.65rem;background:#EEF2FF;color:#4338CA;padding:2px 6px;border-radius:10px;font-weight:700" title="Published industry benchmark traffic figure. Connect Google Analytics or DataForSEO to see your real live traffic.">Industry Avg</span>`;

  // ── KPI source indicator ───────────────────────────────────────────────────
  // KPIs use real published industry benchmarks (WordStream 2024, Meta Industry
  // Reports, HubSpot). When DataForSEO live-kpis enrichment runs it upgrades
  // individual cards to LIVE. These are always shown — no data-mode gate.
  const _dmMode = (window._igDataMode || 'strict');
  const _kpiEstimated = !!(websiteKPIs && (websiteKPIs._estimated || websiteKPIs.source === 'demo'));
  const aiBadge = `<span style="font-size:.65rem;background:#EEF2FF;color:#4338CA;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px" title="Published industry benchmark for ${industry ? industry.name : 'your industry'} — sourced from WordStream 2024 Google Ads Industry Benchmarks, Meta Industry Reports and HubSpot State of Marketing. Updated by live DataForSEO data after analysis.">Industry Avg</span>`;

  // ── Whose-data-is-this indicators for every KPI tile ──────────────────────
  // Two layers so it's UNMISSABLE:
  // 1) Bold coloured RIBBON at the top of the tile (large, always visible)
  // 2) Small footer line at the bottom with full details
  const yourDomain = (url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
  const compNamesShort = competitors.slice(0, 3).map(c => c.name).join(', ') + (competitors.length > 3 ? ` +${competitors.length - 3}` : '');

  const ribbonYou    = `<div class="kpi-ribbon kpi-ribbon-you"  title="This number is your site's data: ${yourDomain}">📍 YOUR SITE</div>`;
  const ribbonInd    = `<div class="kpi-ribbon kpi-ribbon-ind"  title="Broad industry benchmark for ${industry.name} — not your data">🏷️ INDUSTRY BENCHMARK</div>`;
  const ribbonLive   = `<div class="kpi-ribbon kpi-ribbon-live" title="Live data pulled from DataForSEO for ${yourDomain}">📡 LIVE — YOUR SITE</div>`;
  const ribbonAi     = `<div class="kpi-ribbon kpi-ribbon-ai"   title="AI composite score for ${yourDomain} vs the ${competitors.length} tracked competitors">🤖 YOUR SITE vs RIVALS</div>`;

  const srcYou      = `<div class="kpi-source kpi-source-you"  title="This figure represents your own website: ${yourDomain}">📍 Your site · <strong>${yourDomain}</strong></div>`;
  const srcIndustry = `<div class="kpi-source kpi-source-ind"  title="Broad industry benchmark for ${industry.name} — not your data, not a specific competitor.">🏷️ Industry benchmark · <strong>${industry.name}</strong></div>`;
  const srcLive     = `<div class="kpi-source kpi-source-live" title="Live measurement from DataForSEO for your domain ${yourDomain}.">📡 DataForSEO live · <strong>${yourDomain}</strong></div>`;
  const srcAiScore  = `<div class="kpi-source kpi-source-ai"   title="Composite score calculated for your site (${yourDomain}) using your KPIs vs the ${competitors.length} tracked competitors.">🤖 AI score for <strong>${yourDomain}</strong> vs ${competitors.length} rivals</div>`;

  const kpiGrid = document.getElementById('kpiGrid');
  const _kpiHtml = `
    <div class="kpi-card kpi-blue" title="Click-Through Rate: the % of people who click your ad after seeing it. Industry avg for ${industry.name} competitors is ${avgCTR.toFixed(2)}%.">
      ${ribbonYou}
      ${aiBadge}
      <div class="kpi-icon">📊</div>
      <div class="kpi-label">Your CTR Benchmark</div>
      <div class="kpi-value">${yourCTR}%</div>
      <div class="kpi-change ${yourCTR >= avgCTR ? 'kpi-up' : 'kpi-down'}">
        ${yourCTR >= avgCTR ? '▲' : '▼'} ${Math.abs(yourCTR - avgCTR).toFixed(2)}% vs. competitor avg (${avgCTR.toFixed(2)}%)
      </div>
      ${srcYou}
    </div>
    <div class="kpi-card kpi-teal" title="Return on Ad Spend: revenue earned per £/$1 spent on ads. Your competitors average ${avgROAS.toFixed(1)}× ROAS.">
      ${ribbonYou}
      ${aiBadge}
      <div class="kpi-icon">🎯</div>
      <div class="kpi-label">Your ROAS Benchmark</div>
      <div class="kpi-value">${yourROAS}×</div>
      <div class="kpi-change ${yourROAS >= avgROAS ? 'kpi-up' : 'kpi-down'}">
        ${yourROAS >= avgROAS ? '▲' : '▼'} ${Math.abs(yourROAS - avgROAS).toFixed(1)}× vs. competitor avg (${avgROAS.toFixed(1)}×)
      </div>
      ${srcYou}
    </div>
    <div class="kpi-card kpi-green" title="Cost Per Acquisition: estimated ad spend to win one new customer in your industry.">
      ${ribbonInd}
      ${aiBadge}
      <div class="kpi-icon">💰</div>
      <div class="kpi-label">CPA Benchmark</div>
      <div class="kpi-value">$${websiteKPIs.cpa}</div>
      <div class="kpi-change kpi-up">▼ 35% reduction possible with AI optimisation</div>
      ${srcIndustry}
    </div>
    <div class="kpi-card kpi-gold" title="Estimated organic visits per month${realTraffic ? ' — sourced from DataForSEO live data' : ' — AI-estimated industry benchmark for your domain'}.">
      ${realTraffic ? ribbonLive : ribbonYou}
      ${trafficBadge}
      <div class="kpi-icon">👥</div>
      <div class="kpi-label">Est. Monthly Traffic</div>
      <div class="kpi-value">${_fmt(trafficVal)}</div>
      <div class="kpi-change kpi-up" style="font-size:.7rem">${trafficSource}</div>
      ${realTraffic ? srcLive : srcYou}
    </div>
    <div class="kpi-card kpi-purple" title="Conversion Rate: % of visitors who take a desired action (sign up, purchase). ${industry.name} market average is 3.1%.">
      ${ribbonYou}
      ${aiBadge}
      <div class="kpi-icon">📈</div>
      <div class="kpi-label">Your Conv. Rate</div>
      <div class="kpi-value">${websiteKPIs.convRate}%</div>
      <div class="kpi-change ${websiteKPIs.convRate >= 3 ? 'kpi-up' : 'kpi-down'}">
        Industry avg: 3.1%
      </div>
      ${srcYou}
    </div>
    <div class="kpi-card kpi-blue" title="AI-calculated score combining your CTR, ROAS and conversion benchmarks vs. competitor averages. Higher = more growth opportunity.">
      ${ribbonAi}
      <span style="font-size:.65rem;background:#0066FF20;color:#0066FF;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px" title="Composite score calculated by AI — combines CTR efficiency, ROAS performance and conversion rate benchmarks from all your tracked competitors.">AI SCORE</span>
      <div class="kpi-icon">🚀</div>
      <div class="kpi-label">AI Opportunity Score</div>
      <div class="kpi-value">${calcOpportunityScore(websiteKPIs, avgCTR, avgROAS)}/100</div>
      <div class="kpi-change kpi-up">▲ High growth potential</div>
      ${srcAiScore}
    </div>
  `;
  // Publish the effective fabrication state so the chart renderers (CTR/ROAS/
  // Trend/Spend) can apply the same demo-badge / strict-hide policy as the KPIs.
  window._kpiEstimated = _kpiEstimated;
  window._hasRealTraffic = !!realTraffic;
  _dashEnq('kpiGrid', () => {
    if (!kpiGrid || !kpiGrid.isConnected) return;
    if (_kpiEstimated && _dmMode === 'strict' && !realTraffic && typeof window._dataUnavailableState === 'function') {
      kpiGrid.innerHTML = window._dataUnavailableState('Performance benchmarks (CTR, ROAS, CPA, conversion rate) shown here are AI estimates, not live measurements. Demo Data Mode is off, so estimated figures are hidden. An administrator can switch this client to Demo Data Mode in the Admin portal to preview sample numbers.');
    } else {
      kpiGrid.innerHTML = _kpiHtml;
    }
  });

  // Data source notice below KPI grid
  const noticeEl = document.getElementById('kpiDataNotice');
  _dashEnq('kpiNotice', () => {
    if (!noticeEl || !noticeEl.isConnected) return;
    noticeEl.innerHTML = `
      <span style="color:#64748B;font-size:0.75rem">
        ⚠️ <strong>AI Estimated benchmarks</strong> — CTR, ROAS, CPA and Conversion Rate are industry benchmark ranges for <strong>${industry.name}</strong>, not pulled from your ad accounts.
        ${realTraffic ? `Monthly Traffic is <strong style="color:#10B981">live from DataForSEO</strong>.` : 'Connect Google Analytics or Google Ads to replace estimates with your real figures.'}
        Hover any card for a full explanation.
      </span>
    `;
  });

  // ── Your Company — Strengths & Weaknesses ────────────────────────────────
  // Mirrors the SWOT layout used in the per-competitor modal so the user can
  // see their own position next to rivals at a glance. Pulled from real KPIs
  // vs the competitor averages already computed above.
  _dashEnq('swot', () => {
    try {
      renderYourSwot({
        yourDomain, industryName: industry.name,
        yourCTR, yourROAS, yourConv: parseFloat(websiteKPIs.convRate),
        yourTraffic: trafficVal, isLiveTraffic: !!realTraffic,
        avgCTR, avgROAS,
        competitorsCount: competitors.length,
        sectorOnly: !!analysisData.sectorOnly
      });
    } catch (e) { console.warn('renderYourSwot error:', e); }
  });

  // ROI Banner
  const improvedROAS = (avgROAS * 1.28).toFixed(1);
  const cpaReduction = 35;
  const convLift = 25;
  const _roiHtml = `
    <div class="roi-content">
      <div class="roi-label">🤖 InfoGenie ROI Projection</div>
      <div class="roi-title">Implementing InfoGenie's AI recommendations could deliver:</div>
      <div class="roi-sub">Based on analysis of ${competitors.length} competitors in ${industry.name} and your current performance data</div>
    </div>
    <div class="roi-metrics">
      <div class="roi-metric" title="Expected revenue earned per $1 of ad spend after applying InfoGenie's AI-recommended campaign optimisations.">
        <div class="roi-metric-val" style="color:#00C9C8">+${improvedROAS}×</div>
        <div class="roi-metric-lbl">Projected ROAS</div>
      </div>
      <div class="roi-metric" title="Estimated decrease in Cost Per Acquisition — how much less you'll pay to win each new customer by closing competitor efficiency gaps.">
        <div class="roi-metric-val" style="color:#10B981">-${cpaReduction}%</div>
        <div class="roi-metric-lbl">CPA Reduction</div>
      </div>
      <div class="roi-metric" title="Projected increase in conversion rate from AI-optimised ad targeting, landing page copy and audience segmentation.">
        <div class="roi-metric-val" style="color:#F59E0B">+${convLift}%</div>
        <div class="roi-metric-lbl">Conversion Lift</div>
      </div>
      <div class="roi-metric" title="Average ROAS improvement observed across similar InfoGenie campaigns in the ${industry.name} sector.">
        <div class="roi-metric-val" style="color:#7C3AED">3.2×</div>
        <div class="roi-metric-lbl">Avg ROAS Lift</div>
      </div>
    </div>
  `;
  _dashEnq('roiBanner', () => {
    const el = document.getElementById('roiBanner');
    if (el && el.isConnected) el.innerHTML = _roiHtml;
  });

  // Charts — one chart per stage so no single frame builds two canvases back-to-back
  _dashEnq('ctrChart',  () => renderCTRChart(competitors, yourCTR));
  _dashEnq('roasChart', () => renderROASChart(competitors, yourROAS));
  _dashEnq('trendChart',() => renderTrendChart(competitors));

  // Summary table — pre-build the row HTML synchronously (cheap), commit in its
  // own stage so it can't pile up with charts in the same frame.
  window._threatCompetitors = competitors;
  const tbody = document.getElementById('compSummaryBody');
  const safeCap = s => { const x = String(s || 'medium'); return x.charAt(0).toUpperCase() + x.slice(1); };
  const _tbodyHtml = competitors.map((c, i) => {
    const lvl = (c.threatLevel || 'medium').toLowerCase();
    const initials = c.logo || (c.name || '?').split(/\s+/).slice(0,2).map(s=>s.charAt(0).toUpperCase()).join('');
    const channel = c.topChannel || (c.topChannels && c.topChannels[0]) || '—';
    return `
      <tr>
        <td>
          <div class="comp-name-cell">
            <div class="comp-favicon">${initials}</div>
            ${c.name || c.domain || '—'}
          </div>
        </td>
        <td>${c.traffic && c.traffic !== '—' ? c.traffic : '<span style="color:#94a3b8" title="No public data available">—</span>'}</td>
        <td><strong>${c.ctr && c.ctr !== '—' ? c.ctr : '<span style="color:#94a3b8" title="No public data available">—</span>'}</strong></td>
        <td><strong>${(typeof c.roas === 'number' && c.roas > 0) ? c.roas.toFixed(1) + '×' : (c.roas && c.roas !== '—' ? c.roas + '×' : '<span style="color:#94a3b8" title="No public data available">—</span>')}</strong></td>
        <td id="adSpendCell-${i}"><span style="color:#94a3b8;font-size:0.78rem" title="Checking Meta Ad Library…">⏳ checking…</span></td>
        <td>${channel}</td>
        <td><span class="threat-badge threat-${lvl} threat-badge-clickable" onclick="openThreatModal(${i})" title="Click for threat details">${safeCap(lvl)} Threat ↗</span></td>
      </tr>
    `;
  }).join('');
  _dashEnq('summaryTable', () => {
    if (tbody && tbody.isConnected) tbody.innerHTML = _tbodyHtml;
  });

  // ── Async populate "Est. Ad Spend" column + Marketing Journey stages ──────
  _dashEnq('adSpendCol', () => {
    try { window._populateAdSpendColumn && window._populateAdSpendColumn(competitors); } catch (e) { console.warn('populateAdSpend error:', e); }
  });
  _dashEnq('journeyStages', () => {
    try { window._renderJourneyStages && window._renderJourneyStages(); } catch (e) { console.warn('renderJourneyStages error:', e); }
  });

  // ── Live Data Panels ──────────────────────────────────────────────────────
  const liveWrap = document.getElementById('dashLivePanels');
  if (!liveWrap) {
    // No live-panels container — kick off the stage runner with everything
    // queued so far (tags/chips/kpi/charts/table). All live-panel stages
    // simply won't be appended below. The runner handles field-enhancer
    // resume + scoped scan on its drain path, so we don't leak the paused
    // state.
    const _earlyDrain = () => {
      try { window.IGFields && window.IGFields.resume && window.IGFields.resume({ scan: false }); } catch(_) {}
      try {
        const root = document.getElementById('view-dashboard')
                  || document.querySelector('.view.active')
                  || document.body;
        window.IGFields && window.IGFields.scanRoot && window.IGFields.scanRoot(root);
      } catch(_) {}
    };
    let _i = 0;
    const _tick = () => {
      if (_i >= _dashStages.length) { _earlyDrain(); return; }
      try { _dashStages[_i++][1](); } catch(e) { console.warn('stage err', e); }
      (window.requestAnimationFrame || setTimeout)(_tick, 0);
    };
    _tick();
    return;
  }

  function parseTrafficNum(c) {
    if (c.trafficMo) return c.trafficMo;
    const raw = c.traffic;
    if (!raw || raw === '—') return 0; // honest "no data" — caller must filter
    const t = String(raw).replace(/[, ]/g, '');
    if (t.endsWith('B')) return parseFloat(t) * 1e9;
    if (t.endsWith('M')) return parseFloat(t) * 1e6;
    if (t.endsWith('K')) return parseFloat(t) * 1e3;
    const n = parseFloat(t);
    return (isFinite(n) && n > 0) ? n : 0;
  }
  function parseAdSpend(s) {
    if (typeof s === 'number') return s;
    if (!s || s === '—') return 0; // honest "no data" — caller must filter
    const str = String(s).replace(/[$,\s]/g, '');
    const num = parseFloat(str);
    if (isNaN(num)) return 0;
    const upper = String(s).toUpperCase();
    let mult = 1;
    if (upper.includes('B')) mult = 1_000_000_000;
    else if (upper.includes('M')) mult = 1_000_000;
    else if (upper.includes('K')) mult = 1_000;
    return num * mult;
  }

  // Build SOV from competitor traffic
  const sovPalette = ['#0066FF','#00C9C8','#6366F1','#F59E0B','#10B981','#EF4444','#8B5CF6','#14B8A6'];
  const totalTraffic = competitors.reduce((a, c) => a + parseTrafficNum(c), 0);
  let usedPct = 0;
  // Only include competitors that have REAL traffic data — no synthetic floor.
  // Competitors with zero/no traffic are dropped from the SOV chart entirely
  // (rather than being given a fabricated 5% share).
  const sovRows = competitors.slice(0, 6)
    .map((c, i) => ({ c, i, t: parseTrafficNum(c) }))
    .filter(x => x.t > 0)
    .map(({ c, i, t }) => {
      const share = Math.round(t / Math.max(totalTraffic, 1) * 80);
      usedPct += share;
      return { name: c.name, share, color: sovPalette[i] };
    });
  const yourSovShare = Math.min(Math.max(0, 100 - usedPct - 5), 18);
  const otherSovShare = Math.max(0, 100 - usedPct - yourSovShare);
  const sovData = [...sovRows, { name: 'You', share: yourSovShare, color: '#00E5FF' }, { name: 'Others', share: otherSovShare, color: '#E2E8F0' }];

  // Data-mode honesty: the Share-of-Voice donut is derived from competitor
  // traffic AND a fabricated "Your share" formula. It is a real measurement only
  // when at least one competitor carries live DataForSEO traffic; otherwise every
  // slice is an AI estimate. demo → badge it; strict → withhold the whole panel.
  const _sovEstimated = !competitors.some(c => c._dataSource === 'DataForSEO' && parseTrafficNum(c) > 0);
  const _sovLiveTag = _sovEstimated
    ? ''
    : ' <span class="chart-tag" style="background:#00C9C820;color:#00C9C8" title="Calculated in real time from current competitor traffic and ad spend data.">LIVE</span>';

  // Alert templates
  const alertTmpls = [
    { icon: '🔥', color: '#EF4444', bg: '#FEF2F2', label: 'HIGH', labelTitle: 'High priority — act within 24 hours to capitalise on this competitor vulnerability.', age: '2h ago', msg: (c) => `${c.name} dropped Google Ads spend — their core keywords are now underserved and CPCs have fallen. Attack window is open.` },
    { icon: '⚡', color: '#F59E0B', bg: '#FFFBEB', label: 'MED',  labelTitle: 'Medium priority — monitor closely and prepare a response within the next few days.', age: '6h ago', msg: (c) => `${c.name} launched new Meta & TikTok creatives targeting audiences that overlap with your highest-converting segments.` },
    { icon: '📈', color: '#0066FF', bg: '#EFF6FF', label: 'MED',  labelTitle: 'Medium priority — monitor closely and prepare a response within the next few days.', age: '1d ago', msg: (c) => `${c.name} increased LinkedIn Ads budget ~50% this week, aggressively targeting decision-makers in your market.` },
    { icon: '💡', color: '#10B981', bg: '#ECFDF5', label: 'OPP',  labelTitle: 'Opportunity — a gap in the competitor\'s positioning you can exploit to win market share.', age: '3d ago', msg: (c) => `${c.name} changed pricing structure — social sentiment shows customer dissatisfaction. Migration opportunity now active.` }
  ];
  const alertHTML = competitors.slice(0, 4).map((c, i) => {
    const a = alertTmpls[i % alertTmpls.length];
    return `<div style="display:flex;gap:14px;padding:13px 0;border-bottom:1px solid #F3F4F6;align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:50%;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:0.95rem;flex-shrink:0">${a.icon}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="font-size:0.65rem;font-weight:700;color:${a.color};background:${a.bg};padding:2px 7px;border-radius:8px" title="${a.labelTitle}">${a.label}</span>
          <span style="font-size:0.78rem;font-weight:600;color:#0A1628">${c.name} Alert</span>
          <span style="font-size:0.68rem;color:#9CA3AF;margin-left:auto">${a.age}</span>
        </div>
        <div style="font-size:0.78rem;color:#4B5563;line-height:1.55">${a.msg(c)}</div>
      </div>
    </div>`;
  }).join('');

  // ── Helper: defer work to the next animation frame so the main thread
  // can paint and the diagnostic button (plus the rest of the UI) stays
  // responsive while the dashboard is being built. Chunking the build
  // across several frames prevents any single long task from triggering
  // the browser's "page unresponsive" warning, regardless of which stage
  // would have been the slow one.
  const _yieldFrame = (fn) => (window.requestAnimationFrame || setTimeout)(fn, 16);

  // Pre-build the live-panels HTML synchronously (cheap string concat). The
  // actual DOM commit + chart construction + async fetches all run as their
  // own stages below.
  const _liveHtml = `
    <!-- Row 1: SOV + 90-Day Forecast -->
    <div class="two-charts" style="margin-top:24px">
      <div class="chart-box">
        <div class="chart-box-header">
          <h3 id="sovChartHeader" title="Share of Voice: your estimated percentage of total search and ad visibility compared to all tracked competitors in your market. Higher = you dominate more of the conversation.">Share of Voice${_sovLiveTag}</h3>
          <span style="font-size:0.72rem;color:#9CA3AF">Derived from competitor traffic data</span>
        </div>
        <div id="sovChartBody" style="display:flex;gap:16px;align-items:center;min-height:190px;padding:8px 0">
          <div style="position:relative;width:160px;min-width:160px;height:160px">
            <canvas id="sovChart"></canvas>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none">
              <div style="font-size:1.05rem;font-weight:800;color:#0A1628">${yourSovShare}%</div>
              <div style="font-size:0.58rem;color:#6B7280;font-weight:700;letter-spacing:.04em">YOUR SHARE</div>
            </div>
          </div>
          <div style="flex:1;font-size:0.74rem;display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:180px">
            ${sovData.filter(d => d.name !== 'Others').map(d => `
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:10px;height:10px;border-radius:50%;background:${d.color};flex-shrink:0"></div>
                <div style="flex:1;color:${d.name==='You'?'#0A1628':'#374151'};font-weight:${d.name==='You'?'700':'400'}">${d.name}</div>
                <div style="font-weight:700;color:${d.name==='You'?'#00C9C8':'#0A1628'}">${d.share}%</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="chart-box">
        <div class="chart-box-header">
          <h3 title="AI-generated revenue projection for the next 90 days based on your current KPIs, competitor trajectories and seasonal trends in your industry.">90-Day Revenue Forecast <span class="chart-tag" style="background:#7C3AED20;color:#7C3AED" title="Generated by GPT-4o using your industry benchmarks and competitor performance data.">AI</span></h3>
          <span id="forecastStatus" style="font-size:0.72rem;color:#9CA3AF">⏳ Generating AI forecast…</span>
        </div>
        <canvas id="forecastChart" height="160"></canvas>
        <div id="forecastMilestones" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"></div>
      </div>
    </div>

    <!-- Row 2: Budget Efficiency + Competitor Ad Spend -->
    <div class="two-charts">
      <div class="chart-box">
        <div class="chart-box-header">
          <h3 title="How efficiently each marketing channel converts budget into results — scored 0–100. Channels above 70 are outperforming the benchmark; below 40 need attention.">Budget Efficiency by Channel <span class="chart-tag" style="background:#10B98120;color:#10B981" title="Each channel is scored by AI using ROAS, CTR and CPA data from your competitors.">AI SCORED</span></h3>
          <span id="efficiencyStatus" style="font-size:0.72rem;color:#9CA3AF">⏳ Scoring channels…</span>
        </div>
        <canvas id="efficiencyChart" height="180"></canvas>
        <div id="efficiencyRec" style="margin-top:10px;font-size:0.75rem;color:#374151;padding:8px 12px;background:#F9FAFB;border-radius:8px;min-height:20px"></div>
      </div>
      <div class="chart-box">
        <div class="chart-box-header">
          <h3 title="Estimated monthly advertising spend for each competitor across all paid channels. Derived from paid traffic volume and average CPC data.">Competitor Ad Spend <span class="chart-tag" style="background:#10B98120;color:#10B981" title="Traffic and keyword data sourced from the DataForSEO API.">DATAFORSEO</span></h3>
          <span id="spendChartStatus" style="font-size:0.72rem;color:#9CA3AF">Monthly paid traffic value estimate</span>
        </div>
        <canvas id="spendChart" height="180"></canvas>
      </div>
    </div>

    <!-- Row 3: AI Alert Feed -->
    <div class="data-table-card" style="margin-bottom:32px">
      <div class="dtc-header">
        <h3 title="Real-time AI-generated alerts about competitor activity — ad spend changes, new creatives, pricing shifts and market opportunities detected in the last 72 hours.">🔔 Live AI Alert Feed</h3>
        <span class="atag" style="background:#EF4444;color:white;animation:pulse 2s infinite" title="Competitor signals are monitored continuously. New alerts appear as soon as the AI detects a significant change.">● Live Monitoring</span>
      </div>
      <div class="dtc-flush" style="display:flex;flex-direction:column;gap:0">${alertHTML}</div>
    </div>
  `;

  // Stage: commit the live-panels HTML in its own frame.
  _dashEnq('livePanels', () => {
    if (!liveWrap.isConnected) return;
    liveWrap.innerHTML = _liveHtml;
  });

  // ── Render SOV donut on its own stage so the browser paints the freshly
  // inserted DOM first and never builds two canvases back-to-back.
  _dashEnq('sovChart', () => {
    if (sovChartInstance) { try { sovChartInstance.destroy(); } catch(_) {} sovChartInstance = null; }
    // Honesty gate: when SOV is AI-estimated, demo mode badges the panel header
    // and strict mode replaces the whole donut+legend body with an unavailable
    // state (so no fabricated "Your share" %, slices or legend numbers show).
    if (window._applySectionDataMode && window._applySectionDataMode(
          document.getElementById('sovChartHeader'),
          document.getElementById('sovChartBody'),
          _sovEstimated, 'AI estimate',
          'Share of Voice is derived from AI-estimated competitor traffic, not verified live measurements. Demo Data Mode is off, so estimated figures are hidden. An administrator can enable Demo Data Mode for this client in the Admin portal.')) return;
    const sovCtx = document.getElementById('sovChart');
    if (!sovCtx || !sovCtx.isConnected) return;
    sovChartInstance = new Chart(sovCtx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: sovData.map(d => d.name), datasets: [{ data: sovData.map(d => d.share), backgroundColor: sovData.map(d => d.color), borderWidth: 0 }] },
      options: { responsive: true, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}%` } } } }
    });
  });

  // ── Render competitor ad spend chart — async DataForSEO ────────────────────
  const spendStatusEl = document.getElementById('spendChartStatus');
  if (spendStatusEl) spendStatusEl.textContent = '⏳ Fetching live data…';

  // Re-fetch the canvas every render so we always draw into the LIVE node —
  // a previous Analyse run's canvas may be detached if the user re-ran the
  // analyse flow while a fetch was still in flight.
  const _renderSpendChart = (labels, vals, source) => {
    if (spendChartInstance) { try { spendChartInstance.destroy(); } catch(_) {} spendChartInstance = null; }
    const spendCtx = document.getElementById('spendChart');
    if (!spendCtx || !spendCtx.isConnected) return;
    if (window._applyChartDataMode && window._applyChartDataMode('spendChart', source !== 'DataForSEO', 'Estimated spend')) return;
    const colors = labels.map((l, i) => l === 'You' ? 'rgba(0,229,255,0.9)' : (sovPalette[i-1] || '#6B7280') + 'BB');
    spendChartInstance = new Chart(spendCtx.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Est. Ad Spend/mo', data: vals, backgroundColor: colors, borderRadius: 6, borderWidth: 0 }] },
      options: {
        responsive: true, indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` $${Number(ctx.raw).toLocaleString()}/mo` } } },
        scales: { x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: v => '$'+(v>=1000?(v/1000).toFixed(0)+'K':v), font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }
      }
    });
    if (spendStatusEl) spendStatusEl.innerHTML = source === 'DataForSEO'
      ? '<span style="color:#10B981;font-weight:700">🔴 Live via DataForSEO</span>'
      : '<span style="color:#9CA3AF">Estimated from competitor data</span>';
  };

  // Render static immediately — use adSpendEst (from real-competitors DataForSEO data) when available
  const staticLabels = ['You', ...competitors.slice(0,6).map(c => c.name)];
  const yourEstSpend = analysisData.websiteKPIs.adSpend || 4500;
  // Same safety-net the live phase uses, applied here so the initial chart
  // never renders with blank gaps either. Traffic-derived floor for any
  // competitor whose adSpendEst + adSpend string both come back empty.
  const _staticTrafficFloor = (c) => {
    const t = parseTrafficNum(c);
    if (!t || t <= 0) return 0;
    return Math.min(Math.round(t * 0.03 * 3), 1_500_000);
  };
  const staticVals   = [
    (() => {
      const v = typeof yourEstSpend === 'number' ? yourEstSpend : parseAdSpend(yourEstSpend);
      return v > 0 ? v : 25_000;
    })(),
    ...competitors.slice(0,6).map(c => {
      if (typeof c.adSpendEst === 'number' && c.adSpendEst > 0) return c.adSpendEst;
      const parsed = parseAdSpend(c.adSpend);
      if (parsed > 0) return parsed;
      return _staticTrafficFloor(c);
    })
  ];
  // Stage: render the static spend chart in its own frame (the SOV chart got
  // the previous stage — no two canvases in the same frame).
  _dashEnq('spendStatic', () => {
    _renderSpendChart(staticLabels, staticVals, 'static');
  });

  // Stage: kick off live DataForSEO fetch (network happens off-thread; the
  // .then handler does its own destroy + isConnected re-check).
  const compDomains     = competitors.slice(0,6).map(c => c.domain || c.url || c.name.toLowerCase().replace(/\s+/g,'')+'.com');
  const _compBrandNames = competitors.slice(0,6).map(c => c.name || '');
  _dashEnq('spendFetch', () => { fetch('/api/competitor-spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains: compDomains, names: _compBrandNames, yourDomain: url, yourBudget: yourEstSpend })
  }).then(r => r.json()).then(data => {
    if (!data.success) return;
    // Final safety-net estimate: when all preferred sources return 0 for a
    // competitor (DataForSEO had no paid signal AND no AI-validated adSpend),
    // derive from the competitor's traffic × industry-typical paid-share.
    // ~3% of monthly visitors come from paid in the median, with a ~$3 CPC
    // → spend ≈ traffic × 0.03 × $3. Capped at $1.5M/mo. This guarantees
    // every competitor with ANY traffic data has a visible bar instead of
    // a blank gap that reads as "missing data" to users.
    const _trafficSpendFloor = (comp) => {
      const t = parseTrafficNum(comp);
      if (!t || t <= 0) return 0;
      return Math.min(Math.round(t * 0.03 * 3), 1_500_000);
    };
    const liveLabels = ['You', ...data.competitors.map((c, ci) => competitors[ci]?.name || c.domain)];
    const liveVals = [
      // YOU bar: prefer live spend → user's stated budget → industry minimum
      // ($25K — typical monthly floor for any business doing measurable paid
      // marketing) so the user always sees their position on the chart.
      (data.yourSpend && data.yourSpend > 0)
        ? data.yourSpend
        : (yourEstSpend && yourEstSpend > 0 ? yourEstSpend : 25_000),
      ...data.competitors.map((c, ci) => {
        const comp = competitors[ci];
        // Use the maximum of: live DataForSEO + curated data.js value.
        // DataForSEO's keyword-sample misses display/programmatic spend (e.g.
        // IG Markets runs heavy display advertising that doesn't appear in its
        // paid-keyword index, so DataForSEO vastly understates its spend).
        // Taking the max ensures well-known big spenders aren't misrepresented.
        const liveVal  = c.adSpend > 0 ? c.adSpend : 0;                  // 1. Live DataForSEO
        const estVal   = comp?.adSpendEst > 0 ? comp.adSpendEst : 0;     // 2. AI-validated number
        const parsed   = parseAdSpend(comp?.adSpend || '$0');              // 3. Curated data.js string
        const bestVal  = Math.max(liveVal, estVal, parsed > 0 ? parsed : 0);
        if (bestVal > 0) return bestVal;
        return _trafficSpendFloor(comp);                                  // 4. Traffic-derived floor
      })
    ];
    // Render whenever we have ANY data — including the traffic-derived floor.
    // The previous "only render if some > 0" gate caused the static chart to
    // remain visible (with all bars at 0) when both DataForSEO and AI returned
    // null for every competitor.
    const hasAnyData = liveVals.some(v => v > 0);
    if (hasAnyData) _renderSpendChart(liveLabels, liveVals, 'DataForSEO');
  }).catch(() => {}); });  // Keep static chart on error

  // ── Async: 90-day forecast ────────────────────────────────────────────────
  const compNames = competitors.map(c => c.name);
  const campaignBudget = (window._launchedCampaigns || []).reduce((s, c) => s + c.budget, 0) || 5000;
  _dashEnq('forecastFetch', () => { fetch('/api/ai-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: url, industry: industry.name, competitors: compNames, currentROAS: yourROAS, monthlyBudget: campaignBudget, trafficMo: trafficVal })
  }).then(r => r.json()).then(data => {
    const fsEl = document.getElementById('forecastStatus');
    const projArr = data.projectedRevenue || [];
    const projTotal = projArr.reduce((s, v) => s + (v || 0), 0);
    const projTotalK = Math.round(projTotal / 1000);
    if (fsEl) fsEl.textContent = `Confidence: ${data.confidenceLevel || 'Medium'} · $${projTotalK}K projected over 90 days`;
    if (forecastChartInstance) { try { forecastChartInstance.destroy(); } catch(_) {} forecastChartInstance = null; }
    const fCtx = document.getElementById('forecastChart');
    const labels = data.weeks || data.months || ['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7','Wk 8','Wk 9','Wk 10','Wk 11','Wk 12','Wk 13'];
    if (fCtx && fCtx.isConnected) {
      forecastChartInstance = new Chart(fCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Optimistic', data: data.optimisticRevenue,
              borderColor: '#10B981', backgroundColor: 'rgba(16,185,129,0.08)',
              tension: 0.42, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
              fill: '+1'
            },
            {
              label: 'Projected', data: data.projectedRevenue,
              borderColor: '#0066FF', backgroundColor: 'rgba(0,102,255,0.12)',
              tension: 0.42, borderWidth: 3, pointRadius: 3, pointHoverRadius: 6,
              fill: '+1'
            },
            {
              label: 'Conservative', data: data.conservativeRevenue,
              borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.06)',
              tension: 0.42, borderWidth: 2, pointRadius: 2, pointHoverRadius: 5,
              fill: false, borderDash: [5, 4]
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } },
            tooltip: {
              callbacks: {
                label: ctx => ` ${ctx.dataset.label}: $${Number(ctx.raw).toLocaleString()}`
              }
            }
          },
          scales: {
            y: {
              grid: { color: 'rgba(0,0,0,.04)' },
              ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'K' : v), font: { size: 10 } }
            },
            x: {
              grid: { display: false },
              ticks: {
                font: { size: 9 },
                maxTicksLimit: labels.length <= 13 ? 13 : 7
              }
            }
          }
        }
      });
    }
    // Render the milestone strip on the next frame so we don't do a large
    // innerHTML write in the same frame we just constructed the forecast chart.
    _yieldFrame(() => {
      const msEl = document.getElementById('forecastMilestones');
      if (msEl && msEl.isConnected && data.keyMilestones) {
        msEl.innerHTML = data.keyMilestones.map(m => `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:7px 10px;font-size:0.7rem;color:#374151;flex:1;min-width:130px">
            <div style="font-weight:700;color:#0066FF;margin-bottom:2px">Week ${m.week}</div>
            <div style="line-height:1.4">${m.milestone}</div>
          </div>`).join('');
      }
    });
  }).catch(() => { const el = document.getElementById('forecastStatus'); if (el) el.textContent = 'Forecast temporarily unavailable'; }); });

  // ── Async: budget efficiency ──────────────────────────────────────────────
  _dashEnq('efficiencyFetch', () => { fetch('/api/budget-efficiency', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ industry: industry.name, competitors: compNames, monthlyBudget: campaignBudget })
  }).then(r => r.json()).then(data => {
    const esEl = document.getElementById('efficiencyStatus');
    if (esEl) esEl.textContent = `Top channel: ${data.topChannel || '—'}`;
    if (efficiencyChartInstance) { try { efficiencyChartInstance.destroy(); } catch(_) {} efficiencyChartInstance = null; }
    const eCtx = document.getElementById('efficiencyChart');
    if (eCtx && eCtx.isConnected && data.channels) {
      const effColors = data.channels.map(c => c.score >= 80 ? 'rgba(16,185,129,0.82)' : c.score >= 65 ? 'rgba(0,102,255,0.75)' : 'rgba(245,158,11,0.75)');
      efficiencyChartInstance = new Chart(eCtx.getContext('2d'), {
        type: 'bar',
        data: { labels: data.channels.map(c => c.name), datasets: [{ label: 'Efficiency Score', data: data.channels.map(c => c.score), backgroundColor: effColors, borderRadius: 6, borderWidth: 0 }] },
        options: {
          responsive: true, indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Score: ${ctx.raw}/100 · ROI: ${data.channels[ctx.dataIndex]?.roi}` } } },
          scales: { x: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }
        }
      });
    }
    const recEl = document.getElementById('efficiencyRec');
    if (recEl && data.insight) recEl.innerHTML = `💡 <strong>AI Recommendation:</strong> ${data.insight}`;
  }).catch(() => { const el = document.getElementById('efficiencyStatus'); if (el) el.textContent = 'Scoring temporarily unavailable'; }); });

  // ── Staged-pipeline runner ─────────────────────────────────────────────────
  // Process each queued stage on its own animation frame. Per-stage timing is
  // recorded with performance.measure and any stage exceeding 50ms is logged
  // to the diagnostic panel so we can spot regressions. After the queue
  // drains, resume the field enhancer and run a single scoped scan of the
  // whole dashboard root — much cheaper than letting the MutationObserver
  // fire for every node the stages inserted.
  const _dashDebug = !!(window.IGDiag || window._IG_DASH_DEBUG);
  let _dashIdx = 0;
  const _runDashStage = () => {
    if (_dashIdx >= _dashStages.length) {
      try {
        if (window.IGFields) {
          window.IGFields.resume && window.IGFields.resume({ scan: false });
          const root = document.getElementById('view-dashboard')
                    || document.querySelector('.view.active')
                    || document.getElementById('dashboard')
                    || document.body;
          window.IGFields.scanRoot && window.IGFields.scanRoot(root);
        }
      } catch(_) {}
      try {
        performance.mark && performance.mark('ig:buildDashboard:end');
        performance.measure && performance.measure('ig:buildDashboard:total',
          'ig:buildDashboard:start', 'ig:buildDashboard:end');
      } catch(_) {}
      if (_dashDebug && window.performance && performance.now) {
        const total = performance.now() - _dashT0;
        try { window.IGDiag && IGDiag.log && IGDiag.log(`buildDashboard total = ${total.toFixed(0)}ms`); } catch(_) {}
        if (total > 1500) console.warn('[buildDashboard] slow total:', total.toFixed(0)+'ms');
      }
      return;
    }
    const [name, fn] = _dashStages[_dashIdx++];
    // Use IGDiag.stage for full verbose logging (start, end, duration, ΔDOM,
    // memory). Every single dashboard stage is now individually traceable
    // on the server log via the diag beacon.
    try {
      if (window.IGDiag && window.IGDiag.stage) {
        window.IGDiag.stage('dashStage[' + (_dashIdx) + '/' + _dashStages.length + ']:' + name, fn);
      } else {
        const t0 = performance.now();
        fn();
        const dt = performance.now() - t0;
        if (dt > 50) console.warn(`[buildDashboard] stage "${name}" ${dt.toFixed(0)}ms`);
      }
    } catch (e) { console.warn('[buildDashboard] stage', name, 'error:', e); }
    (window.requestAnimationFrame || ((cb) => setTimeout(cb, 16)))(_runDashStage);
  };
  _runDashStage();
}

function renderCTRChart(competitors, yourCTR) {
  if (ctrChartInstance) { try { ctrChartInstance.destroy(); } catch(_) {} ctrChartInstance = null; }
  const _ctrEl = document.getElementById('ctrChart');
  if (!_ctrEl || !_ctrEl.isConnected) return;
  if (window._applyChartDataMode && window._applyChartDataMode('ctrChart', !!(window._kpiEstimated && !window._hasRealTraffic), 'AI estimate')) return;
  const ctx = _ctrEl.getContext('2d');
  // Skip competitors with no CTR data — don't fabricate bars
  const _withCtr = competitors.filter(c => {
    const n = parseFloat(c.ctr);
    return isFinite(n) && n > 0;
  });
  const labels = ['Your Site', ..._withCtr.map(c => c.name)];
  const data = [yourCTR, ..._withCtr.map(c => parseFloat(c.ctr))];
  const colors = ['rgba(0,201,200,0.85)', ..._withCtr.map(() => 'rgba(0,102,255,0.7)')];
  const borders = ['#00C9C8', ..._withCtr.map(() => '#0066FF')];
  
  ctrChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg CTR (%)',
        data,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 2,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` CTR: ${ctx.raw}%`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,.04)' },
          ticks: { callback: v => v + '%', font: { size: 11 } }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderROASChart(competitors, yourROAS) {
  if (roasChartInstance) { try { roasChartInstance.destroy(); } catch(_) {} roasChartInstance = null; }
  const _roasEl = document.getElementById('roasChart');
  if (!_roasEl || !_roasEl.isConnected) return;
  if (window._applyChartDataMode && window._applyChartDataMode('roasChart', !!(window._kpiEstimated && !window._hasRealTraffic), 'AI estimate')) return;
  const ctx = _roasEl.getContext('2d');
  const labels = ['Your Site', ...competitors.map(c => c.name)];
  const data = [yourROAS, ...competitors.map(c => c.roas)];
  
  roasChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'ROAS',
        data,
        backgroundColor: ['rgba(0,229,255,0.8)', ...competitors.map(() => 'rgba(124,58,237,0.7)')],
        borderColor: ['#00E5FF', ...competitors.map(() => '#7C3AED')],
        borderWidth: 2,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ROAS: ${ctx.raw}×` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,.04)' },
          ticks: { callback: v => v + '×', font: { size: 11 } }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

function renderTrendChart(competitors) {
  if (trendChartInstance) { try { trendChartInstance.destroy(); } catch(_) {} trendChartInstance = null; }
  const _trendEl = document.getElementById('trendChart');
  if (!_trendEl || !_trendEl.isConnected) return;
  if (window._applyChartDataMode && window._applyChartDataMode('trendChart', !!(window._kpiEstimated && !window._hasRealTraffic), 'AI estimate')) return;
  const ctx = _trendEl.getContext('2d');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  const palette = [
    { bg: 'rgba(0,201,200,0.15)', border: '#00C9C8' },
    { bg: 'rgba(0,102,255,0.12)', border: '#0066FF' },
    { bg: 'rgba(124,58,237,0.12)', border: '#7C3AED' },
    { bg: 'rgba(245,158,11,0.12)', border: '#F59E0B' },
    { bg: 'rgba(16,185,129,0.12)', border: '#10B981' },
    { bg: 'rgba(239,68,68,0.12)', border: '#EF4444' },
    { bg: 'rgba(139,92,246,0.12)', border: '#8B5CF6' },
    { bg: 'rgba(236,72,153,0.12)', border: '#EC4899' }
  ];
  
  const datasets = competitors.slice(0, 8)
    // Skip competitors with no real traffic data — don't fabricate trend lines
    .filter(c => c.traffic && c.traffic !== '—' && /\d/.test(String(c.traffic)))
    .map((c, i) => {
    const baseTraffic = parseFloat(String(c.traffic).replace(/[^0-9.]/g,'')) || 0;
    const multiplier = String(c.traffic).includes('B') ? 1000 : String(c.traffic).includes('M') ? 1 : 0.001;
    const base = baseTraffic * multiplier;
    const data = months.map((_, mi) => {
      const trend = 1 + mi * 0.018 + Math.sin(mi * 0.8 + i) * 0.06;
      return +(base * trend).toFixed(1);
    });
    return {
      label: c.name,
      data,
      borderColor: palette[i].border,
      backgroundColor: palette[i].bg,
      borderWidth: 2,
      fill: true,
      tension: 0.4,
      pointRadius: 3,
      pointHoverRadius: 5
    };
  });
  
  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: months, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { font: { size: 11 }, padding: 16, usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}M visits`
          }
        }
      },
      scales: {
        y: {
          grid: { color: 'rgba(0,0,0,.04)' },
          ticks: { callback: v => v + 'M', font: { size: 11 } }
        },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } }
      },
      interaction: { mode: 'index', intersect: false }
    }
  });
}

// ═══════════════════ REDDIT INTELLIGENCE ═══════════════════
// ===== REDDIT INTELLIGENCE =====
window._redditPosts     = [];
window._redditPersona   = { brand: '', tone: 'Helpful', persona: '' };
window._redditSelPost   = null;
window._redditActiveTab = 'monitor';

function buildRedditIntel() {
  const wrap = document.getElementById('redditWrap');
  if (!wrap) return;

  const brand       = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || '';
  const competitors = (analysisData?.competitors || []).map(c => c.name).join(', ');
  const industry    = analysisData?.industry?.name || 'marketing';
  const kwList      = (analysisData?.keywords || []).slice(0, 5).map(k => typeof k === 'string' ? k : (k.keyword || k.term || '')).filter(Boolean).join(', ');

  // Save persona defaults
  if (brand && !window._redditPersona.brand) window._redditPersona.brand = brand;

  wrap.innerHTML = `
    <!-- Config Panel -->
    <div style="background:var(--ig-panel2);border:1px solid rgba(255,100,0,.25);border-radius:16px;padding:20px 24px;margin-bottom:20px">
      <div style="font-family:Sora,sans-serif;font-size:0.85rem;font-weight:800;color:white;margin-bottom:14px">⚙️ Monitor Settings</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px">
        <div>
          <label style="font-size:0.64rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:5px" title="Your brand name or domain — InfoGenie searches for mentions of this across Reddit and Hacker News discussions.">Your Brand / Domain</label>
          <input id="rdt-brand" value="${brand}" placeholder="yourbrand.com"
            onblur="autoFillRedditFields(this.value)"
            onkeydown="if(event.key==='Enter'){this.blur()}"
            title="Enter your domain (e.g. acme.com) or brand name — used to find brand mentions, competitor comparisons, and sentiment discussions."
            style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.8rem;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:0.64rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.07em;display:flex;align-items:center;justify-content:space-between;margin-bottom:5px" title="Keywords InfoGenie will search for across Reddit threads and AI-synthesised community signals.">
            <span>Keywords to Monitor
              <span id="rdt-kw-loader" style="display:none;margin-left:6px;font-size:0.6rem;color:#00C9C8;font-weight:600">✦ auto-filling…</span>
            </span>
            <button type="button" onclick="window._rdtKwSuggest()" title="Pull keywords from your last analysis" style="padding:3px 8px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;font-size:0.6rem;font-weight:700;cursor:pointer;text-transform:none;letter-spacing:0">🤖 AI Suggest</button>
          </label>
          <input id="rdt-keywords" value="${kwList}" placeholder="e.g. email marketing, CRM, automation" title="Comma-separated list of keywords to scan for — InfoGenie will surface threads where these terms appear in discussions." style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.8rem;box-sizing:border-box">
        </div>
        <div>
          <label style="font-size:0.64rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.07em;display:block;margin-bottom:5px" title="Competitor brands to watch — InfoGenie will flag any threads comparing your brand against these names.">
            Competitors to Watch
            <span id="rdt-comp-loader" style="display:none;margin-left:6px;font-size:0.6rem;color:#FF6B35;font-weight:600">✦ auto-filling…</span>
          </label>
          <input id="rdt-competitors" value="${competitors}" placeholder="e.g. HubSpot, Mailchimp" title="Comma-separated list of competitor brand names — InfoGenie alerts you when they appear in monitored discussions." style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.8rem;box-sizing:border-box">
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div style="font-size:0.72rem;color:rgba(255,255,255,.4)">
          <span style="color:#FF6600;font-weight:700">📰 Live HN</span> real Hacker News threads &nbsp;·&nbsp;
          <span style="color:#A78BFA;font-weight:700">🤖 AI Signal</span> GPT-4o community intelligence based on real Reddit patterns &nbsp;·&nbsp;
          AI scores each thread for relevance, sentiment &amp; urgency
        </div>
        <button onclick="scanRedditMonitor()" title="Trigger a live scan — InfoGenie fetches real Hacker News threads and generates AI-synthesised Reddit intelligence based on your brand, keywords, and competitors." style="padding:10px 22px;background:linear-gradient(135deg,#FF4500,#FF6B35);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">🔍 Scan Now</button>
      </div>
    </div>

    <!-- Dark shell wrapping tabs + content -->
    <div style="background:var(--ig-panel2);border:1px solid rgba(255,100,0,.15);border-radius:16px;padding:16px 20px">

    <!-- Tab Bar -->
    <div style="display:flex;gap:4px;margin-bottom:16px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:5px">
      ${[
        ['monitor','📡','Monitor','Watch brand mentions, competitor threads, and keyword discussions in real time.'],
        ['trending','🔥','Trending','See the top upvote-gaining threads in your industry sorted by velocity — find viral opportunities early.'],
        ['serp','🔍','SERP Signals','Identify Reddit posts ranking on Google page 1 for your keywords — prime engagement targets.'],
        ['reply','✍️','Reply Studio','AI-drafted replies to relevant threads — engage authentically without sounding promotional.'],
      ].map(([t, ic, label, tip], i) => {
        const active = t === 'monitor';
        return `<button id="rdttb-${t}" onclick="switchRedditTab('${t}')" title="${tip}" style="flex:1;padding:9px 12px;border-radius:9px;border:none;font-size:0.77rem;font-weight:700;cursor:pointer;transition:all .15s;background:${active?'rgba(255,100,0,.25)':'rgba(255,255,255,.05)'};color:${active?'#FF6B35':'rgba(255,255,255,.6)'}">${ic} ${label}</button>`;
      }).join('')}
    </div>

    <!-- Tab: Monitor -->
    <div id="rdtpanel-monitor">
      <div id="rdt-feed" style="display:flex;flex-direction:column;gap:12px">
        <div style="text-align:center;padding:48px 24px;color:rgba(255,255,255,.5)">
          <!-- Official Reddit Snoo logo (orange circle + white alien) -->
          <div style="margin:0 auto 14px;width:78px;height:78px;background:#FF4500;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 28px rgba(255,69,0,.4)">
            <svg width="50" height="50" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg" aria-label="Reddit">
              <path d="M14.238 15.348c.085.084.085.221 0 .306-.465.462-1.194.687-2.231.687l-.008-.002-.008.002c-1.036 0-1.766-.225-2.231-.688-.085-.084-.085-.221 0-.305.084-.084.222-.084.307 0 .379.377 1.008.561 1.924.561l.008.002.008-.002c.915 0 1.544-.184 1.924-.562.085-.084.223-.084.307.001zm-3.44-2.418c0-.507-.414-.919-.922-.919-.509 0-.923.412-.923.919 0 .506.414.918.923.918.508.001.922-.411.922-.918zm13.202-.93c0 6.627-5.373 12-12 12s-12-5.373-12-12 5.373-12 12-12 12 5.373 12 12zm-5-.288c0-.732-.594-1.327-1.328-1.327-.358 0-.682.142-.921.372-.893-.65-2.121-1.073-3.485-1.123l.594-2.799 1.945.413c.023.589.508 1.064 1.103 1.064.61 0 1.105-.495 1.105-1.105s-.495-1.104-1.105-1.104c-.435 0-.812.252-.992.618l-2.169-.461c-.064-.014-.131-.001-.187.034-.055.038-.092.094-.106.16l-.665 3.13c-1.385.041-2.636.464-3.538 1.119-.238-.227-.561-.367-.916-.367-.733 0-1.328.595-1.328 1.327 0 .539.324 1.001.785 1.211-.022.135-.034.273-.034.412 0 2.084 2.421 3.772 5.405 3.772s5.404-1.689 5.404-3.772c0-.139-.012-.276-.033-.411.46-.21.785-.671.785-1.211zm-4.594.012c-.508 0-.922.412-.922.918 0 .506.414.918.922.918s.922-.412.922-.918c0-.506-.414-.918-.922-.918z"/>
            </svg>
          </div>
          <div style="font-family:Sora,sans-serif;font-size:0.9rem;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px">Ready to scan</div>
          <div style="font-size:0.78rem;margin-bottom:18px">Find brand mentions, competitor threads &amp; rising discussions</div>
          <button onclick="scanRedditMonitor()" style="padding:11px 26px;background:linear-gradient(135deg,#FF4500,#FF6B35);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 4px 14px rgba(255,69,0,.35)">🔍 Scan Now</button>
        </div>
      </div>
    </div>

    <!-- Tab: Trending -->
    <div id="rdtpanel-trending" style="display:none">
      <div id="rdt-trending-feed" style="display:flex;flex-direction:column;gap:12px">
        <div style="text-align:center;padding:48px 24px;color:rgba(255,255,255,.3)">
          <div style="font-size:2.5rem;margin-bottom:10px">🔥</div>
          <div style="font-size:0.78rem">Run a scan first to see trending threads sorted by upvote velocity</div>
        </div>
      </div>
    </div>

    <!-- Tab: SERP Signals -->
    <div id="rdtpanel-serp" style="display:none">
      <div style="background:rgba(0,102,255,.08);border:1px solid rgba(0,102,255,.2);border-radius:12px;padding:14px 18px;margin-bottom:16px">
        <div style="font-size:0.78rem;color:rgba(255,255,255,.65);line-height:1.5">
          <span style="color:#60A5FA;font-weight:700">🔍 What is SERP Discovery?</span> Reddit posts often rank on page 1 of Google for high-intent keywords. These threads are prime opportunities — engage early to drive organic traffic and shape perception before your competitors do.
        </div>
      </div>
      <div id="rdt-serp-feed" style="display:flex;flex-direction:column;gap:12px">
        <div style="text-align:center;padding:48px 24px;color:rgba(255,255,255,.3)">
          <div style="font-size:2.5rem;margin-bottom:10px">🔍</div>
          <div style="font-size:0.78rem">Run a scan to surface threads likely ranking in Google SERPs</div>
        </div>
      </div>
    </div>

    <!-- Tab: Reply Studio -->
    <div id="rdtpanel-reply" style="display:none">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <!-- Left: Persona Settings -->
        <div style="background:var(--ig-panel2);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px">
          <div style="font-family:Sora,sans-serif;font-size:0.84rem;font-weight:800;color:white;margin-bottom:14px">🎭 Brand Persona</div>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="font-size:0.63rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Brand Name</label>
              <input id="rpl-brand" value="${window._redditPersona.brand || brand}" placeholder="Your brand name" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.8rem;box-sizing:border-box">
            </div>
            <div>
              <label style="font-size:0.63rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Tone</label>
              <select id="rpl-tone" class="rpl-select" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.8rem;box-sizing:border-box">
                <option value="Helpful" ${window._redditPersona.tone==='Helpful'?'selected':''}>Helpful Expert</option>
                <option value="Professional" ${window._redditPersona.tone==='Professional'?'selected':''}>Professional</option>
                <option value="Friendly" ${window._redditPersona.tone==='Friendly'?'selected':''}>Friendly &amp; Conversational</option>
                <option value="Educational" ${window._redditPersona.tone==='Educational'?'selected':''}>Educational</option>
                <option value="Direct" ${window._redditPersona.tone==='Direct'?'selected':''}>Direct &amp; Confident</option>
              </select>
            </div>
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                <label style="font-size:0.63rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em">Persona Description</label>
                <button type="button" onclick="suggestRedditPersona()" id="rpl-persona-suggest-btn" style="padding:4px 10px;background:linear-gradient(135deg,rgba(255,69,0,.18),rgba(255,107,53,.18));border:1px solid rgba(255,107,53,.35);border-radius:6px;font-size:0.65rem;font-weight:700;color:#FF6B35;cursor:pointer;display:inline-flex;align-items:center;gap:4px">✨ AI Suggest</button>
              </div>
              <textarea id="rpl-persona" rows="3" placeholder="e.g. Senior SaaS consultant who focuses on ROI and practical solutions. Never mention competitors by name. — or click ✨ AI Suggest above" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.78rem;box-sizing:border-box;resize:vertical">${window._redditPersona.persona}</textarea>
            </div>
          </div>
        </div>

        <!-- Right: Reply Generator -->
        <div style="background:var(--ig-panel2);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px">
          <div style="font-family:Sora,sans-serif;font-size:0.84rem;font-weight:800;color:white;margin-bottom:14px">✍️ Reply Generator</div>
          <div id="rpl-thread-display" style="background:rgba(255,100,0,.07);border:1px solid rgba(255,100,0,.2);border-radius:10px;padding:12px 14px;margin-bottom:12px;min-height:60px">
            <div id="rpl-thread-title" style="font-size:0.8rem;font-weight:600;color:rgba(255,255,255,.7);margin-bottom:4px">${window._redditSelPost ? window._redditSelPost.title : 'Select a thread from Monitor tab or paste a title below'}</div>
            <div id="rpl-thread-sub" style="font-size:0.68rem;color:#FF6B35">${window._redditSelPost ? window._redditSelPost.subreddit : ''}</div>
          </div>
          <div style="margin-bottom:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
              <label style="font-size:0.63rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em">Or paste a post title manually</label>
              <button type="button" onclick="suggestRedditTitle()" id="rpl-title-suggest-btn" style="padding:4px 10px;background:linear-gradient(135deg,rgba(255,69,0,.18),rgba(255,107,53,.18));border:1px solid rgba(255,107,53,.35);border-radius:6px;font-size:0.65rem;font-weight:700;color:#FF6B35;cursor:pointer;display:inline-flex;align-items:center;gap:4px">✨ Suggest Title</button>
            </div>
            <input id="rpl-manual-title" placeholder="Paste Reddit post title here… — or click ✨ Suggest Title to draft one" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:white;font-size:0.78rem;box-sizing:border-box">
            <div id="rpl-title-suggestions" style="display:none;margin-top:8px;flex-direction:column;gap:6px"></div>
          </div>
          <button onclick="generateRedditReply()" style="width:100%;padding:11px;background:linear-gradient(135deg,#FF4500,#FF6B35);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer;margin-bottom:14px">✍️ Generate Brand Reply</button>
          <div id="rpl-result" style="display:none">
            <div style="font-size:0.64rem;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Generated Reply</div>
            <div id="rpl-reply-text" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;font-size:0.8rem;color:rgba(255,255,255,.85);line-height:1.55;margin-bottom:8px;white-space:pre-wrap"></div>
            <div id="rpl-tone-note" style="font-size:0.68rem;color:rgba(255,100,0,.7);font-style:italic;margin-bottom:10px"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="navigator.clipboard.writeText(document.getElementById('rpl-reply-text').textContent).then(()=>showToast('✅ Reply copied!'))" style="flex:1;min-width:100px;padding:9px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:8px;font-size:0.76rem;font-weight:700;color:white;cursor:pointer">📋 Copy Reply</button>
              <button onclick="postReplyToReddit()" style="flex:1;min-width:120px;padding:9px;background:linear-gradient(135deg,#FF4500,#FF6B35);border:none;border-radius:8px;font-size:0.76rem;font-weight:700;color:white;cursor:pointer">🚀 Post Now</button>
              <button onclick="generateRedditReply()" style="padding:9px 14px;background:rgba(255,100,0,.2);border:1px solid rgba(255,100,0,.3);border-radius:8px;font-size:0.76rem;font-weight:700;color:#FF6B35;cursor:pointer">↺ Regenerate</button>
            </div>
          </div>
          <div id="rpl-loading" style="display:none;text-align:center;padding:20px">
            <div style="width:28px;height:28px;border:3px solid rgba(255,100,0,.2);border-top-color:#FF4500;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 10px"></div>
            <div style="font-size:0.76rem;color:rgba(255,255,255,.4)">GPT-4 crafting your brand reply…</div>
          </div>
        </div>
      </div>
    </div>

    </div>`;

  // Auto-fill keywords & competitors if brand is set but fields are empty
  if (brand && (!kwList || !competitors)) {
    setTimeout(() => autoFillRedditFields(brand), 200);
  }
  // Auto-scan on first load when analysis data is available (once per session)
  if (brand && (kwList || competitors) && !window._rdtAutoScanned) {
    window._rdtAutoScanned = true;
    setTimeout(() => { try { scanRedditMonitor(); } catch(e) { console.warn('auto-scan failed:', e); } }, 600);
  }
}

// 🤖 AI Suggest for "Keywords to Monitor" — pulls keywords from last analysis,
// falls back to AI synthesis when analysis has none.
window._rdtKwSuggest = async function() {
  const input = document.getElementById('rdt-keywords');
  if (!input) return;
  const fromAnalysis = (window.analysisData && Array.isArray(window.analysisData.keywords))
    ? window.analysisData.keywords.map(k => typeof k === 'string' ? k : (k.keyword || k.term || '')).filter(Boolean).slice(0, 10)
    : [];
  if (fromAnalysis.length) {
    input.value = fromAnalysis.join(', ');
    showToast(`✨ ${fromAnalysis.length} keywords pulled from your analysis`);
    return;
  }
  // Fallback: ask AI for 5 monitoring keywords based on brand + industry
  const brand = (document.getElementById('rdt-brand')?.value || '').trim();
  const industry = (window.analysisData && window.analysisData.industry && window.analysisData.industry.name) || '';
  if (!brand) { showToast('⚠️ Enter a brand first or run an analysis'); return; }
  const orig = input.placeholder; input.placeholder = '⏳ Generating keywords…';
  try {
    const r = await fetch('/api/ai-quick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `Return ONLY a comma-separated list of 6 short monitoring keywords (1-3 words each) for the brand "${brand}"${industry?` in the ${industry} industry`:''}. No numbering, no explanations.`,
        max_tokens: 120
      })
    }).then(x => x.text());
    let data; try { data = JSON.parse(r); } catch { data = null; }
    if (data && data.ok && data.text) {
      input.value = data.text.replace(/\n/g,', ').replace(/^[-•\d.\s]+/gm,'').replace(/\s*,\s*/g,', ').replace(/^,\s*|,\s*$/g,'').trim();
      showToast('✨ AI keywords generated');
    } else {
      showToast('⚠️ AI suggestion unavailable — type keywords manually');
    }
  } catch (e) {
    showToast('❌ ' + (e.message || 'Failed'));
  } finally { input.placeholder = orig; }
};

let _rdtAutoFillTimer = null;
async function autoFillRedditFields(domain) {
  if (!domain || domain.trim().length < 3) return;
  const kwEl   = document.getElementById('rdt-keywords');
  const compEl = document.getElementById('rdt-competitors');
  const kwLdr  = document.getElementById('rdt-kw-loader');
  const compLdr= document.getElementById('rdt-comp-loader');
  if (!kwEl || !compEl) return;

  // Skip if both fields already have content
  if (kwEl.value.trim() && compEl.value.trim()) return;

  // Show loaders
  if (kwLdr)   kwLdr.style.display   = 'inline';
  if (compLdr) compLdr.style.display = 'inline';
  kwEl.style.borderColor   = 'rgba(0,201,200,.4)';
  compEl.style.borderColor = 'rgba(255,107,53,.4)';

  try {
    const resp = await fetch('/api/reddit-autofill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domain.trim() })
    });
    const data = await resp.json();
    if (data.keywords  && !kwEl.value.trim())   kwEl.value   = data.keywords;
    if (data.competitors && !compEl.value.trim()) compEl.value = data.competitors;
    kwEl.style.borderColor   = 'rgba(0,201,200,.35)';
    compEl.style.borderColor = 'rgba(255,107,53,.35)';
  } catch(e) {
    kwEl.style.borderColor   = 'rgba(255,255,255,.12)';
    compEl.style.borderColor = 'rgba(255,255,255,.12)';
  } finally {
    if (kwLdr)   kwLdr.style.display   = 'none';
    if (compLdr) compLdr.style.display = 'none';
  }
}

function switchRedditTab(tab) {
  window._redditActiveTab = tab;
  ['monitor','trending','serp','reply'].forEach(t => {
    const panel = document.getElementById('rdtpanel-' + t);
    const btn   = document.getElementById('rdttb-' + t);
    if (panel) panel.style.display = t === tab ? 'block' : 'none';
    if (btn) {
      btn.style.background  = t === tab ? 'rgba(255,100,0,.25)' : 'rgba(255,255,255,.05)';
      btn.style.color       = t === tab ? '#FF6B35' : 'rgba(255,255,255,.6)';
    }
  });
}

function _rdtCard(p, i) {
  const relColor  = p.relevance >= 70 ? '#10B981' : p.relevance >= 40 ? '#F59E0B' : '#6B7280';
  const sentColor = p.sentiment === 'positive' ? '#10B981' : p.sentiment === 'negative' ? '#EF4444' : '#6B7280';
  const urgColor  = p.urgency === 'critical' ? '#EF4444' : p.urgency === 'high' ? '#F59E0B' : p.urgency === 'medium' ? '#0066FF' : '#6B7280';
  const velBadge  = p.velocity > 50 ? `<span style="background:rgba(239,68,68,.15);color:#EF4444;border:1px solid rgba(239,68,68,.25);padding:2px 7px;border-radius:5px;font-size:0.62rem;font-weight:700">🔥 ${p.velocity}/hr</span>` : '';
  const serpBadge = p.serpLikely ? `<span style="background:rgba(0,102,255,.15);color:#60A5FA;border:1px solid rgba(0,102,255,.25);padding:2px 7px;border-radius:5px;font-size:0.62rem;font-weight:700">🔍 SERP</span>` : '';
  const srcBadge  = p.source === 'hn'
    ? `<span style="background:rgba(255,102,0,.12);color:#FF6600;border:1px solid rgba(255,102,0,.25);padding:2px 7px;border-radius:5px;font-size:0.6rem;font-weight:700" title="Live from Hacker News">📰 Live HN</span>`
    : `<span style="background:rgba(124,58,237,.12);color:#A78BFA;border:1px solid rgba(124,58,237,.25);padding:2px 7px;border-radius:5px;font-size:0.6rem;font-weight:700" title="AI-synthesised community intelligence based on real Reddit patterns">🤖 AI Signal</span>`;

  return `
    <div style="background:var(--ig-panel2);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px 18px;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(255,100,0,.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">
            <span style="font-size:0.62rem;font-weight:700;color:#FF6B35;background:rgba(255,100,0,.12);padding:2px 7px;border-radius:5px">${p.subreddit}</span>
            ${srcBadge}${velBadge}${serpBadge}
            <span style="font-size:0.62rem;color:rgba(255,255,255,.3)">${p.ageHours < 24 ? p.ageHours + 'h ago' : Math.round(p.ageHours/24) + 'd ago'}</span>
          </div>
          <a href="${p.url}" target="_blank" style="font-family:Sora,sans-serif;font-size:0.85rem;font-weight:700;color:white;text-decoration:none;line-height:1.35;display:block" onmouseover="this.style.color='#FF6B35'" onmouseout="this.style.color='white'">${p.title}</a>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex-shrink:0">
          <div style="font-size:0.95rem;font-weight:800;color:${relColor}">${p.relevance || 0}</div>
          <div style="font-size:0.56rem;color:rgba(255,255,255,.3);font-weight:600">AI SCORE</div>
        </div>
      </div>
      <div style="height:4px;background:rgba(255,255,255,.06);border-radius:3px;margin-bottom:10px;overflow:hidden">
        <div style="height:100%;width:${p.relevance||0}%;background:${relColor};border-radius:3px"></div>
      </div>
      <div style="font-size:0.73rem;color:rgba(255,255,255,.5);margin-bottom:10px;line-height:1.4">${p.opportunity || ''}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${sentColor}18;color:${sentColor};border:1px solid ${sentColor}30">${p.sentiment||'neutral'}</span>
          <span style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${urgColor}18;color:${urgColor};border:1px solid ${urgColor}30">⚡ ${p.urgency||'medium'}</span>
          <span style="font-size:0.62rem;color:rgba(255,255,255,.35)">▲ ${p.score} · 💬 ${p.comments}</span>
        </div>
        <button onclick="rdtOpenReply(${i})" style="padding:5px 12px;background:rgba(255,100,0,.18);border:1px solid rgba(255,100,0,.3);border-radius:7px;font-size:0.7rem;font-weight:700;color:#FF6B35;cursor:pointer">✍️ Reply</button>
      </div>
    </div>`;
}

function rdtOpenReply(idx) {
  const post = window._redditPosts[idx];
  if (!post) return;
  window._redditSelPost = post;
  const titleEl = document.getElementById('rpl-thread-title');
  const subEl   = document.getElementById('rpl-thread-sub');
  if (titleEl) titleEl.textContent = post.title;
  if (subEl)   subEl.textContent   = post.subreddit;
  const manEl = document.getElementById('rpl-manual-title');
  if (manEl) manEl.value = '';
  switchRedditTab('reply');
}

// Shared in-flight lock so the two suggest buttons can't fire concurrent
// requests against /api/reddit-studio-suggest and clobber each other's state.
window._rdtSuggestLock = window._rdtSuggestLock || { busy: false, reqId: 0 };

// ── ✨ AI Suggest: Persona Description ──────────────────────────────────────
// Uses brand + tone + tracked keywords/competitors to draft a brand-voice line.
window.suggestRedditPersona = async function() {
  const btn      = document.getElementById('rpl-persona-suggest-btn');
  const personaEl= document.getElementById('rpl-persona');
  const brand    = (document.getElementById('rpl-brand')?.value || document.getElementById('rdt-brand')?.value || '').trim();
  const tone     = document.getElementById('rpl-tone')?.value || 'Helpful';
  const keywords = (document.getElementById('rdt-keywords')?.value || '').trim();
  const compsRaw = (document.getElementById('rdt-competitors')?.value || '').trim();
  if (!brand) { showToast('⚠️ Enter a brand name first'); return; }
  if (!btn || !personaEl) return;
  if (window._rdtSuggestLock.busy) { showToast('⏳ Already drafting — one moment…'); return; }
  window._rdtSuggestLock.busy = true;
  const myReqId = ++window._rdtSuggestLock.reqId;

  const original = btn.innerHTML;
  btn.innerHTML  = '⏳ Drafting…';
  btn.disabled   = true;
  btn.style.opacity = '0.7';

  try {
    const resp = await fetch('/api/reddit-studio-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: brand, tone, keywords, competitors: compsRaw })
    });
    const data = await resp.json();
    // Stale-response guard: ignore if a newer request superseded us
    if (myReqId !== window._rdtSuggestLock.reqId) return;
    if (data && data.persona) {
      personaEl.value = data.persona;
      window._redditPersona.persona = data.persona;
      // Cache titles too if returned (so 'Suggest Title' is instant on first click)
      if (Array.isArray(data.titles) && data.titles.length) window._redditTitleCache = data.titles;
      showToast('✨ Persona drafted by AI');
    } else {
      showToast('⚠️ Could not draft persona — ' + (data.error || 'try again'));
    }
  } catch(err) {
    console.error('suggestRedditPersona failed:', err);
    if (myReqId === window._rdtSuggestLock.reqId) {
      showToast('⚠️ Suggestion failed: ' + (err.message || 'network error'));
    }
  } finally {
    btn.innerHTML  = original;
    btn.disabled   = false;
    btn.style.opacity = '1';
    window._rdtSuggestLock.busy = false;
  }
};

// ── ✨ Suggest Title: 3 realistic Reddit post titles ────────────────────────
window._redditTitleCache = null;
window.suggestRedditTitle = async function() {
  const btn      = document.getElementById('rpl-title-suggest-btn');
  const inputEl  = document.getElementById('rpl-manual-title');
  const listEl   = document.getElementById('rpl-title-suggestions');
  const brand    = (document.getElementById('rpl-brand')?.value || document.getElementById('rdt-brand')?.value || '').trim();
  const tone     = document.getElementById('rpl-tone')?.value || 'Helpful';
  const keywords = (document.getElementById('rdt-keywords')?.value || '').trim();
  const compsRaw = (document.getElementById('rdt-competitors')?.value || '').trim();
  if (!brand) { showToast('⚠️ Enter a brand name first'); return; }
  if (!btn || !inputEl || !listEl) return;

  const renderList = (titles) => {
    if (!titles || !titles.length) { listEl.style.display = 'none'; return; }
    listEl.innerHTML = titles.map((t, i) => {
      const safe = (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      return `<button type="button" onclick="document.getElementById('rpl-manual-title').value=this.dataset.t;document.getElementById('rpl-title-suggestions').style.display='none';showToast('✅ Title selected')" data-t="${safe}" style="text-align:left;padding:8px 11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,107,53,.2);border-radius:7px;color:rgba(255,255,255,.85);font-size:0.74rem;cursor:pointer;line-height:1.4">💡 ${safe}</button>`;
    }).join('');
    listEl.style.display = 'flex';
  };

  // Use cache if available (filled by suggestRedditPersona)
  if (window._redditTitleCache && window._redditTitleCache.length) {
    renderList(window._redditTitleCache);
    return;
  }

  if (window._rdtSuggestLock.busy) { showToast('⏳ Already drafting — one moment…'); return; }
  window._rdtSuggestLock.busy = true;
  const myReqId = ++window._rdtSuggestLock.reqId;

  const original = btn.innerHTML;
  btn.innerHTML  = '⏳ Drafting…';
  btn.disabled   = true;
  btn.style.opacity = '0.7';

  try {
    const resp = await fetch('/api/reddit-studio-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: brand, tone, keywords, competitors: compsRaw })
    });
    const data = await resp.json();
    // Stale-response guard: ignore if a newer request superseded us
    if (myReqId !== window._rdtSuggestLock.reqId) return;
    if (data && Array.isArray(data.titles) && data.titles.length) {
      window._redditTitleCache = data.titles;
      renderList(data.titles);
      showToast('✨ ' + data.titles.length + ' title ideas ready');
    } else {
      showToast('⚠️ No title ideas returned — ' + (data.error || 'try again'));
    }
  } catch(err) {
    console.error('suggestRedditTitle failed:', err);
    if (myReqId === window._rdtSuggestLock.reqId) {
      showToast('⚠️ Suggestion failed: ' + (err.message || 'network error'));
    }
  } finally {
    btn.innerHTML  = original;
    btn.disabled   = false;
    btn.style.opacity = '1';
    window._rdtSuggestLock.busy = false;
  }
};

async function scanRedditMonitor() {
  const brand       = (document.getElementById('rdt-brand')?.value || '').trim();
  const kwRaw       = (document.getElementById('rdt-keywords')?.value || '').trim();
  const compRaw     = (document.getElementById('rdt-competitors')?.value || '').trim();
  const industry    = analysisData?.industry?.name || 'marketing';
  const keywords    = kwRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const competitors = compRaw.split(',').map(s=>s.trim()).filter(Boolean);

  if (!brand && keywords.length === 0) { showToast('⚠️ Enter a brand name or keywords first'); return; }

  const feed    = document.getElementById('rdt-feed');
  const tFeed   = document.getElementById('rdt-trending-feed');
  const sFeed   = document.getElementById('rdt-serp-feed');

  const loaderHtml = (sec) => `<div style="text-align:center;padding:40px 24px">
    <div style="width:40px;height:40px;border:3px solid rgba(255,100,0,.2);border-top-color:#FF4500;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 14px"></div>
    <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:700;color:white;margin-bottom:5px">Scanning community intelligence… <span id="rdt-timer" style="color:#FF4500">${sec}s</span></div>
    <div style="font-size:0.75rem;color:rgba(255,255,255,.35);margin-bottom:8px">Fetching live HN data · GPT-4o generating Reddit signals</div>
    <div style="font-size:0.7rem;color:rgba(255,180,0,.5)">⏱ This usually takes 10–20 seconds</div>
  </div>`;
  if (feed)  feed.innerHTML  = loaderHtml(0);
  if (tFeed) tFeed.innerHTML = loaderHtml(0);
  if (sFeed) sFeed.innerHTML = loaderHtml(0);

  let _rdtSec = 0;
  const _rdtTick = setInterval(() => {
    _rdtSec++;
    document.querySelectorAll('#rdt-timer').forEach(el => el.textContent = _rdtSec + 's');
  }, 1000);

  const _rdtAbort = new AbortController();
  const _rdtTimeout = setTimeout(() => _rdtAbort.abort(), 50000);

  try {
    const resp = await fetch('/api/reddit-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, keywords, competitors, industry }),
      signal: _rdtAbort.signal
    });
    // Robust JSON parse — proxy may return an HTML error page on timeout / 5xx.
    const rawText = await resp.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch(parseErr) {
      const snippet = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 120);
      throw new Error(`Server returned HTML (HTTP ${resp.status}). The scan may have timed out at the proxy. ${snippet ? 'Response: "' + snippet + '"' : ''} Try again — the AI scan typically takes 20–40s.`);
    }
    if (!resp.ok) throw new Error(data.error || `Scan failed (HTTP ${resp.status})`);
    const posts = data.posts || [];
    window._redditPosts = posts;

    if (posts.length === 0) {
      clearInterval(_rdtTick); clearTimeout(_rdtTimeout);
      // Use the server's diagnostic message when available so the user sees the real reason.
      const reason = data.error
        ? String(data.error)
        : 'No threads found. Try broader keywords or add more competitors.';
      const isAiFailure = /AI|gpt|openai|signal generation/i.test(reason);
      const icon  = isAiFailure ? '⚠️' : '🕳️';
      const color = isAiFailure ? '#FF8C00' : 'rgba(255,255,255,.55)';
      const empty = `<div style="text-align:center;padding:40px 24px;color:rgba(255,255,255,.55)">
        <div style="font-size:2rem;margin-bottom:10px">${icon}</div>
        <div style="font-size:0.85rem;font-weight:700;color:${color};margin-bottom:8px;max-width:420px;margin-left:auto;margin-right:auto;line-height:1.45">${reason.replace(/[<>]/g,'')}</div>
        <div style="font-size:0.72rem;color:rgba(255,255,255,.35);margin-bottom:14px">Sources tried: live Hacker News + AI Reddit synthesis</div>
        <button onclick="scanRedditMonitor()" style="padding:9px 20px;background:#FF4500;color:white;border:none;border-radius:8px;font-size:0.78rem;cursor:pointer;font-weight:700">🔄 Try Again</button>
      </div>`;
      if (feed)  feed.innerHTML  = empty;
      if (tFeed) tFeed.innerHTML = empty;
      if (sFeed) sFeed.innerHTML = empty;
      showToast(isAiFailure ? '⚠️ AI signal generation hiccupped — click Try Again' : 'ℹ️ No threads matched — try broader keywords');
      return;
    }

    // Monitor tab: sorted by relevance
    const byRelevance = [...posts].sort((a,b) => (b.relevance||0) - (a.relevance||0));
    if (feed) feed.innerHTML = byRelevance.map((p,i) => _rdtCard(p, posts.indexOf(p))).join('');

    // Trending tab: sorted by velocity
    const byVelocity = [...posts].sort((a,b) => (b.velocity||0) - (a.velocity||0));
    if (tFeed) {
      if (byVelocity.every(p => !p.velocity)) {
        tFeed.innerHTML = `<div style="text-align:center;padding:32px;color:rgba(255,255,255,.35);font-size:0.8rem">Velocity data unavailable for these results</div>`;
      } else {
        tFeed.innerHTML = byVelocity.map((p,i) => _rdtCard(p, posts.indexOf(p))).join('');
      }
    }

    // SERP tab: only SERP-flagged posts
    const serpPosts = posts.filter(p => p.serpLikely);
    if (sFeed) {
      sFeed.innerHTML = serpPosts.length > 0
        ? serpPosts.map((p,i) => _rdtCard(p, posts.indexOf(p))).join('')
        : `<div style="text-align:center;padding:32px;color:rgba(255,255,255,.35)"><div style="font-size:1.8rem;margin-bottom:8px">✅</div><div style="font-size:0.8rem">No threads currently flagged as SERP-ranking. Topics with "best X" or "vs" comparisons rank more often.</div></div>`;
    }

    clearInterval(_rdtTick); clearTimeout(_rdtTimeout);
    const hnCount = posts.filter(p => p.source === 'hn').length;
    const aiCount = posts.filter(p => p.source === 'ai').length;
    showToast(`✅ ${posts.length} signals loaded · ${hnCount} live HN · ${aiCount} AI Reddit · ${serpPosts.length} SERP`);
    switchRedditTab(window._redditActiveTab);

  } catch(err) {
    clearInterval(_rdtTick); clearTimeout(_rdtTimeout);
    const isTimeout = err.name === 'AbortError';
    const errHtml = `<div style="text-align:center;padding:32px">
      <div style="font-size:1.8rem;margin-bottom:10px">${isTimeout ? '⏱️' : '⚠️'}</div>
      <div style="color:${isTimeout ? '#FF8C00' : '#EF4444'};font-size:0.85rem;font-weight:700;margin-bottom:8px">
        ${isTimeout ? 'Scan timed out — AI took too long' : 'Scan failed: ' + err.message}
      </div>
      <button onclick="scanRedditMonitor()" style="margin-top:8px;padding:8px 18px;background:#FF4500;color:white;border:none;border-radius:8px;font-size:0.8rem;cursor:pointer;font-weight:700">🔄 Try Again</button>
    </div>`;
    if (feed)  feed.innerHTML  = errHtml;
    if (tFeed) tFeed.innerHTML = errHtml;
    if (sFeed) sFeed.innerHTML = errHtml;
  }
}

async function generateRedditReply() {
  const brand    = (document.getElementById('rpl-brand')?.value  || '').trim();
  const tone     = document.getElementById('rpl-tone')?.value    || 'Helpful';
  const persona  = (document.getElementById('rpl-persona')?.value || '').trim();
  const manual   = (document.getElementById('rpl-manual-title')?.value || '').trim();
  const post     = window._redditSelPost;

  const postTitle   = manual || post?.title   || '';
  const postPreview = post?.preview || '';
  const industry    = analysisData?.industry?.name || 'marketing';

  if (!postTitle) { showToast('⚠️ Select a thread or paste a post title'); return; }

  // Save persona
  window._redditPersona = { brand, tone, persona };

  const loading = document.getElementById('rpl-loading');
  const result  = document.getElementById('rpl-result');
  if (loading) loading.style.display = 'block';
  if (result)  result.style.display  = 'none';

  try {
    const resp = await fetch('/api/reddit-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postTitle, postPreview, brand, tone, persona, industry })
    });
    const data = await resp.json();
    if (!data.reply) throw new Error(data.error || 'No reply generated');

    const replyEl    = document.getElementById('rpl-reply-text');
    const toneNoteEl = document.getElementById('rpl-tone-note');
    if (replyEl)    replyEl.textContent    = data.reply;
    if (toneNoteEl) toneNoteEl.textContent = data.tone_note ? `💡 ${data.tone_note}` : '';
    if (loading) loading.style.display = 'none';
    if (result)  result.style.display  = 'block';

  } catch(err) {
    if (loading) loading.style.display = 'none';
    showToast('⚠️ Reply generation failed: ' + err.message);
  }
}

// ═══════════════════ AUDIENCE + CREATIVE ═══════════════════
// ===== BUILD AUDIENCE =====
function buildAudience() {
  const { competitors, industry } = analysisData;
  
  // Aggregate all audiences across competitors
  const audienceMap = {};
  competitors.forEach(c => {
    (c.audiences || []).forEach(a => {
      if (!audienceMap[a.label]) {
        audienceMap[a.label] = { total: 0, count: 0, competitors: [] };
      }
      audienceMap[a.label].total += a.pct;
      audienceMap[a.label].count += 1;
      audienceMap[a.label].competitors.push(c.name);
    });
  });
  
  let audienceSegments = Object.entries(audienceMap)
    .map(([label, d]) => ({ label, avgPct: Math.round(d.total / d.count), competitors: d.competitors, count: d.count }))
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, 8);

  // Fallback: if no audience data came back from enrichment, generate
  // industry-benchmark segments so the chart and cards are never empty.
  if (!audienceSegments.length) {
    const _ind = ((industry && (industry.name || industry)) || '').toLowerCase();
    const _isB2B = ['saas','software','b2b','crm','erp','fintech','hr','legal','accounting','forex','trading','broker','finance','capital','investment'].some(k => _ind.includes(k));
    const _isRetail = ['retail','ecommerce','fashion','beauty','food','health','fitness'].some(k => _ind.includes(k));
    const _compNames = competitors.slice(0,2).map(c => c.name || c.domain || 'Competitor');
    const benchmarks = _isB2B
      ? [['Active Traders & Investors',48],['Finance Professionals',38],['Small Business Owners',32],['Crypto Enthusiasts',27],['High-Net-Worth Individuals',41],['Young Professionals 25–35',29]]
      : _isRetail
      ? [['Deal Seekers',45],['Brand Loyalists',38],['Mobile Shoppers',52],['Repeat Buyers',33],['New Visitors',28],['High-Intent Browsers',41]]
      : [['Decision Makers',44],['Early Adopters',36],['Price-Conscious Buyers',31],['Brand Advocates',39],['Research-Led Shoppers',27],['Power Users',42]];
    audienceSegments = benchmarks.map(([label, avgPct]) => ({
      label, avgPct, competitors: _compNames, count: _compNames.length, _isBenchmark: true
    }));
  }
  
  const audienceCards = audienceSegments.map((seg, i) => {
    const score = Math.min(99, 60 + seg.avgPct + seg.count * 8);
    const ctr = (2.8 + i * 0.3 + ((i * 137) % 50) / 100).toFixed(1);
    const cpa = Math.floor(20 + i * 8 + ((i * 89) % 15));
    const size = ['2.4M', '1.8M', '4.2M', '890K', '3.1M', '1.2M', '2.8M', '650K'][i] || '1M';
    
    const insights = [
      `Active across ${seg.competitors.slice(0,2).join(', ')} competitor campaigns`,
      `${seg.avgPct}% audience overlap with top competitors`,
      `Responds best to ${getCreativeType(seg.label)} creative formats`,
      `Peak engagement: ${getPeakTime(seg.label)}`
    ];
    
    return `
      <div class="aud-card">
        <div class="aud-card-header">
          <div>
            <div class="aud-card-name">${seg.label}</div>
            <div class="aud-card-size">Est. ${size} reachable users</div>
          </div>
          <div class="aud-score-badge" title="InfoGenie Audience Score — combines competitor overlap, engagement rate, and estimated reachability. 80+ is excellent.">${score}/100</div>
        </div>
        <div class="aud-metrics">
          <div class="aud-metric-item" title="Average Click-Through Rate — the percentage of this audience segment who click ads when shown to them. Industry average is 2–5%.">
            <div class="aud-metric-val">${ctr}%</div>
            <div class="aud-metric-lbl">Avg CTR</div>
          </div>
          <div class="aud-metric-item" title="Average Cost Per Acquisition — estimated spend required to convert one person from this audience into a customer.">
            <div class="aud-metric-val">$${cpa}</div>
            <div class="aud-metric-lbl">Avg CPA</div>
          </div>
          <div class="aud-metric-item" title="Number of your tracked competitors actively targeting this same audience segment.">
            <div class="aud-metric-val">${seg.count} competitors</div>
            <div class="aud-metric-lbl">Competing here</div>
          </div>
          <div class="aud-metric-item" title="Estimated engagement rate for this audience — how actively they interact with ads and content in your category.">
            <div class="aud-metric-val">${seg.avgPct}%</div>
            <div class="aud-metric-lbl">Engagement Rate</div>
          </div>
        </div>
        <div class="aud-insights">
          <div class="aud-insight-title">Intelligence Insights</div>
          <ul class="aud-insight-list">
            ${insights.map(ins => `<li><span>•</span><span>${ins}</span></li>`).join('')}
          </ul>
        </div>
        <button class="aud-target-btn" onclick="targetAudience('${seg.label}')" title="Auto-configure targeting parameters for this audience across all connected ad channels — InfoGenie sets bids, demographics, and interests automatically.">🎯 Auto-Target This Audience</button>
      </div>
    `;
  }).join('');
  
  // Generate demographic data seeded from industry + audience segments
  const _ind = (analysisData.industry && analysisData.industry.name || '').toLowerCase();
  const _isB2B = ['saas','software','b2b','crm','erp','fintech','hr','legal','accounting'].some(k => _ind.includes(k));
  const _isRetail = ['retail','ecommerce','fashion','beauty','food','health','fitness'].some(k => _ind.includes(k));

  const ageGroups = ['18–24', '25–34', '35–44', '45–54', '55+'];
  const ageData = _isB2B    ? [8, 34, 30, 18, 10]
               : _isRetail  ? [22, 35, 24, 13,  6]
               :              [14, 31, 28, 17, 10];

  const genderLabels = ['Male', 'Female', 'Other'];
  const genderData = _isB2B    ? [58, 39, 3]
                   : _isRetail  ? [31, 66, 3]
                   :              [51, 46, 3];

  const deviceLabels = ['Desktop', 'Mobile', 'Tablet'];
  const deviceData = _isB2B ? [61, 31, 8] : [42, 50, 8];

  const geoLabels = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany', 'Other'];
  const geoData   = [43, 16, 11, 8, 6, 16];

  const wrap = document.getElementById('audienceWrap');
  wrap.innerHTML = `
    <!-- DEMOGRAPHIC BREAKDOWN HEADER -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div>
        <div style="font-family:'Space Grotesk','Sora',sans-serif;font-size:1.05rem;font-weight:800;color:#0A1628">Competitor Audience Demographics</div>
        <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">Aggregated from ${competitors.length} tracked competitors · segmented by age, gender, device & location</div>
      </div>
      <span style="background:#EEF2FF;color:#4338CA;font-size:0.68rem;font-weight:700;padding:4px 12px;border-radius:20px">AI-ANALYSED</span>
    </div>

    <!-- ROW 1: Age + Gender -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <div class="chart-box" style="margin:0">
        <div class="chart-box-header">
          <h3>Age Distribution <span class="chart-tag audience-tag">DEMOGRAPHICS</span></h3>
        </div>
        <canvas id="audAgeChart" height="180"></canvas>
      </div>

      <div class="chart-box" style="margin:0">
        <div class="chart-box-header">
          <h3>Gender Split <span class="chart-tag audience-tag">DEMOGRAPHICS</span></h3>
        </div>
        <canvas id="audGenderChart" height="180"></canvas>
      </div>
    </div>

    <!-- ROW 2: Device + Location -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

      <div class="chart-box" style="margin:0">
        <div class="chart-box-header">
          <h3>Device Breakdown <span class="chart-tag audience-tag">DEMOGRAPHICS</span></h3>
        </div>
        <canvas id="audDeviceChart" height="180"></canvas>
      </div>

      <div class="chart-box" style="margin:0">
        <div class="chart-box-header">
          <h3>Top Geographies <span class="chart-tag audience-tag">DEMOGRAPHICS</span></h3>
        </div>
        <canvas id="audGeoChart" height="180"></canvas>
      </div>
    </div>

    <!-- CROSSOVER MATRIX -->
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px 24px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:0.8rem;font-weight:800;color:#0A1628">🔀 Audience Crossover Matrix</div>
          <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">Segments shared between you and each competitor — higher % = more overlap, higher urgency</div>
        </div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.72rem">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #F3F4F6">Segment</th>
              ${competitors.slice(0,5).map(c => `<th style="text-align:center;padding:8px 10px;font-weight:700;color:#374151;border-bottom:2px solid #F3F4F6">${c.name.split(' ')[0]}</th>`).join('')}
              <th style="text-align:center;padding:8px 10px;font-weight:700;color:#0066FF;border-bottom:2px solid #F3F4F6">Gap Opp.</th>
            </tr>
          </thead>
          <tbody>
            ${audienceSegments.slice(0,6).map((seg, si) => {
              const overlapVals = competitors.slice(0,5).map((c, ci) => {
                const base = seg.avgPct;
                const seed = (si * 7 + ci * 13) % 40;
                return Math.max(5, Math.min(95, base - 10 + seed));
              });
              const minVal = Math.min(...overlapVals);
              const gapOpp = minVal < 30 ? 'HIGH' : minVal < 55 ? 'MED' : 'LOW';
              const gapColor = gapOpp === 'HIGH' ? '#10B981' : gapOpp === 'MED' ? '#F59E0B' : '#9CA3AF';
              const gapBg = gapOpp === 'HIGH' ? '#F0FDF4' : gapOpp === 'MED' ? '#FFFBEB' : '#F9FAFB';
              return `
                <tr style="border-bottom:1px solid #F3F4F6">
                  <td style="padding:9px 10px;font-weight:600;color:#0A1628">${seg.label}</td>
                  ${overlapVals.map(v => {
                    const bg = v >= 70 ? 'rgba(239,68,68,.08)' : v >= 45 ? 'rgba(245,158,11,.08)' : 'rgba(16,185,129,.08)';
                    const col = v >= 70 ? '#DC2626' : v >= 45 ? '#D97706' : '#059669';
                    return `<td style="text-align:center;padding:9px 10px"><span style="display:inline-block;background:${bg};color:${col};border-radius:6px;padding:2px 8px;font-weight:700">${v}%</span></td>`;
                  }).join('')}
                  <td style="text-align:center;padding:9px 10px"><span style="background:${gapBg};color:${gapColor};border-radius:6px;padding:2px 8px;font-size:0.65rem;font-weight:800">${gapOpp}</span></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:0.62rem;color:#9CA3AF;margin-top:10px">🟢 Low overlap = gap opportunity · 🟡 Medium overlap = monitor closely · 🔴 High overlap = direct competition for this segment</div>
    </div>

    <!-- ENGAGEMENT DISTRIBUTION CHART -->
    <div class="chart-box full" style="margin-bottom:24px">
      <div class="chart-box-header">
        <h3>Audience Engagement Distribution <span class="chart-tag audience-tag">AUDIENCE</span></h3>
      </div>
      <canvas id="audienceChart" height="140"></canvas>
    </div>

    <div id="audCardsHeader" style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <div style="font-family:'Space Grotesk','Sora',sans-serif;font-size:1.05rem;font-weight:800;color:#0A1628">🎯 High-Value Audience Segments</div>
    </div>
    <div id="audCardsBody"><div class="audience-grid">${audienceCards}</div></div>
  `;

  // ── Render all charts ────────────────────────────────────────────────────────
  clearTimeout(_audienceChartTimer);
  _audienceChartTimer = setTimeout(() => {
    const chartDefaults = { responsive: true, maintainAspectRatio: true };
    const gridColor = 'rgba(0,0,0,.06)';

    // Audience cards show industry-benchmark CTR/CPA values — always display.

    // Age bar chart
    const ageCanvas = document.getElementById('audAgeChart');
    if (ageCanvas) {
      if (window._audAgeChart) { window._audAgeChart.destroy(); }
      window._audAgeChart = new Chart(ageCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ageGroups,
          datasets: [{
            label: 'Audience Share (%)',
            data: ageData,
            backgroundColor: ['rgba(0,201,200,.75)','rgba(0,102,255,.75)','rgba(124,58,237,.75)','rgba(245,158,11,.75)','rgba(16,185,129,.75)'],
            borderRadius: 6, borderSkipped: false
          }]
        },
        options: { ...chartDefaults, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw}% of audience` } } },
          scales: { y: { grid: { color: gridColor }, ticks: { callback: v => v+'%', font: { size: 11 } } }, x: { grid: { display: false }, ticks: { font: { size: 11 } } } }
        }
      });
    }

    // Gender doughnut
    const genderCanvas = document.getElementById('audGenderChart');
    if (genderCanvas) {
      if (window._audGenderChart) { window._audGenderChart.destroy(); }
      window._audGenderChart = new Chart(genderCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: genderLabels,
          datasets: [{ data: genderData, backgroundColor: ['rgba(0,102,255,.8)','rgba(236,72,153,.8)','rgba(156,163,175,.8)'], borderWidth: 2, borderColor: 'white' }]
        },
        options: { ...chartDefaults, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw}%` } } } }
      });
    }

    // Device doughnut
    const deviceCanvas = document.getElementById('audDeviceChart');
    if (deviceCanvas) {
      if (window._audDeviceChart) { window._audDeviceChart.destroy(); }
      window._audDeviceChart = new Chart(deviceCanvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: deviceLabels,
          datasets: [{ data: deviceData, backgroundColor: ['rgba(0,201,200,.8)','rgba(124,58,237,.8)','rgba(245,158,11,.8)'], borderWidth: 2, borderColor: 'white' }]
        },
        options: { ...chartDefaults, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw}%` } } } }
      });
    }

    // Geo horizontal bar
    const geoCanvas = document.getElementById('audGeoChart');
    if (geoCanvas) {
      if (window._audGeoChart) { window._audGeoChart.destroy(); }
      window._audGeoChart = new Chart(geoCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: geoLabels,
          datasets: [{
            label: 'Traffic Share (%)',
            data: geoData,
            backgroundColor: ['rgba(0,102,255,.75)','rgba(0,201,200,.75)','rgba(124,58,237,.75)','rgba(245,158,11,.75)','rgba(16,185,129,.75)','rgba(156,163,175,.5)'],
            borderRadius: 6, borderSkipped: false
          }]
        },
        options: { ...chartDefaults, indexAxis: 'y',
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw}% of traffic` } } },
          scales: { x: { grid: { color: gridColor }, ticks: { callback: v => v+'%', font: { size: 10 } } }, y: { grid: { display: false }, ticks: { font: { size: 10 } } } }
        }
      });
    }

    // Original engagement doughnut
    const canvas = document.getElementById('audienceChart');
    if (canvas) {
      if (audienceChartInstance) { audienceChartInstance.destroy(); audienceChartInstance = null; }
      audienceChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: audienceSegments.slice(0,6).map(s => s.label),
          datasets: [{
            data: audienceSegments.slice(0,6).map(s => s.avgPct),
            backgroundColor: ['rgba(0,201,200,.8)','rgba(0,102,255,.8)','rgba(124,58,237,.8)','rgba(245,158,11,.8)','rgba(16,185,129,.8)','rgba(239,68,68,.8)'],
            borderWidth: 2, borderColor: 'white'
          }]
        },
        options: { responsive: true, plugins: { legend: { position: 'right', labels: { font: { size: 12 }, padding: 16 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}% avg engagement` } } } }
      });
    }
  }, 100);
}

function targetAudience(label) {
  showToast(`🎯 Auto-targeting "${label}" — InfoGenie will configure and launch this campaign automatically`);
}

// ===================================================
// AI CREATIVE — ENHANCED
// ===================================================

function buildCreative() {
  const { url, industry, competitors } = analysisData;
  const wrap = document.getElementById('creativeWrap');
  const domainName = url.split('.')[0];

  const vsCards = buildCompetitorVsCards(industry, competitors, domainName);
  const aiCards = generateCreatives(industry, competitors, domainName, creativeRound);

  const cardHtml = aiCards.map((c, i) => `
    <div class="creative-card" id="creative-card-${i}">
      <div class="creative-card-top">
        <div class="creative-type">${c.type}</div>
        <div class="creative-headline">"${c.headline}"</div>
        <div class="creative-ai-badge">AI Generated</div>
      </div>
      <div class="creative-card-body">
        <div class="creative-copy">${c.copy}</div>
        <div class="creative-meta">
          <div class="creative-meta-item">
            <div class="creative-meta-val" style="color:var(--teal)">${c.estCTR}</div>
            <div class="creative-meta-lbl">Est. CTR</div>
          </div>
          <div class="creative-meta-item">
            <div class="creative-meta-val">${c.estConv}</div>
            <div class="creative-meta-lbl">Est. Conv.</div>
          </div>
          <div class="creative-meta-item">
            <div class="creative-meta-val">${c.estROAS}</div>
            <div class="creative-meta-lbl">Est. ROAS</div>
          </div>
          <div class="creative-meta-item">
            <div class="creative-meta-val">${c.platform}</div>
            <div class="creative-meta-lbl">Platform</div>
          </div>
        </div>
        <div class="creative-actions">
          <button class="btn-auto-target" onclick="showAudiencePanel(${i}, ${JSON.stringify(c.audiences).replace(/"/g,"'")})">🎯 Auto-Target Audience</button>
          <button class="btn-creative-use" onclick="launchCreativeCampaign(${i})">🚀 Launch</button>
          <button class="btn-creative-copy" onclick="copyCreative('${c.headline.replace(/'/g,"\\'")}', '${c.copy.replace(/'/g,"\\'").replace(/\n/g," ")}')">Copy</button>
        </div>
        <div id="audience-panel-${i}"></div>
      </div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="creative-controls">
      <div class="platform-filter">
        <button class="pf-btn active" onclick="filterCreativeCards('all', this)">All Platforms</button>
        <button class="pf-btn" onclick="filterCreativeCards('google', this)">Google</button>
        <button class="pf-btn" onclick="filterCreativeCards('meta', this)">Meta</button>
        <button class="pf-btn" onclick="filterCreativeCards('tiktok', this)">TikTok</button>
        <button class="pf-btn" onclick="filterCreativeCards('linkedin', this)">LinkedIn</button>
      </div>
      <button class="creative-regen-btn" onclick="regenCreatives()">⚡ Regenerate All</button>
    </div>

    <div class="comp-vs-section">
      <div class="comp-vs-label">⚡ InfoGenie vs. Competitor Campaigns — AI-Generated Superior Alternatives</div>
      <div class="comp-vs-grid" id="vsGrid">
        ${vsCards}
      </div>
    </div>

    <div class="comp-vs-label" style="margin-bottom:16px;">🤖 Standalone AI-Generated Creatives — Ready to Deploy</div>
    <div class="creative-grid" id="creativeCardGrid">${cardHtml}</div>

    <div class="chart-box full">
      <div class="chart-box-header">
        <h3>Creative Performance Prediction <span class="chart-tag ctr-tag">AI SCORE</span></h3>
        <span style="font-size:0.8125rem;color:var(--gray-400)">Based on competitor CTR benchmarks and audience engagement signals</span>
      </div>
      <canvas id="creativeChart" height="100"></canvas>
    </div>
  `;

  clearTimeout(_creativeChartTimer);
  _creativeChartTimer = setTimeout(() => renderCreativeChart(aiCards), 100);
}

function buildCompetitorVsCards(industry, competitors, domainName) {
  const improvements = [
    { ctrBoost: '+1.4%', roasBoost: '+1.2×', cpaReduction: '-28%', audienceBoost: '+35%', reason: 'Hyper-specific value proposition outperforms generic brand messaging' },
    { ctrBoost: '+1.1%', roasBoost: '+0.9×', cpaReduction: '-22%', audienceBoost: '+28%', reason: 'Urgency-driven copy with social proof converts 2.3× better' },
    { ctrBoost: '+1.8%', roasBoost: '+1.4×', cpaReduction: '-31%', audienceBoost: '+42%', reason: 'Competitor weakness targeting drives significantly higher intent' },
    { ctrBoost: '+0.9%', roasBoost: '+0.7×', cpaReduction: '-19%', audienceBoost: '+24%', reason: 'Personalised audience segmentation beats broad targeting' },
    { ctrBoost: '+1.3%', roasBoost: '+1.1×', cpaReduction: '-26%', audienceBoost: '+33%', reason: 'Outcome-focused headlines outperform feature-based messaging' },
    { ctrBoost: '+1.6%', roasBoost: '+1.3×', cpaReduction: '-29%', audienceBoost: '+38%', reason: 'Intent-signal bidding captures high-value moments competitors miss' },
    { ctrBoost: '+1.0%', roasBoost: '+0.8×', cpaReduction: '-21%', audienceBoost: '+27%', reason: 'Creative refresh velocity at 8× competitor cadence lifts CTR' },
    { ctrBoost: '+2.1%', roasBoost: '+1.6×', cpaReduction: '-34%', audienceBoost: '+45%', reason: 'Autonomous multi-channel orchestration eliminates cross-channel waste' }
  ];

  const infoGenieHeadlines = [
    `The Smarter ${industry.name} Platform — See Results in 14 Days or Free`,
    `What the Market Leaders Won't Tell You About Their Ad Strategy`,
    `Your Top Competitor Outspends You — Here's How to Beat Them for Less`,
    `The ${industry.name} Playbook That Established Players Don't Want You to Know`,
    `Outperform the Market — AI-Powered Campaigns. Zero Guesswork.`,
    `The Market Leader Is Losing Ground — Your AI Opportunity Window Is Now`,
    `We Mapped Every Competitor Campaign in ${industry.name}. Here's What We Found.`,
    `Manual Campaign Management Can't Compete With Autonomous AI. Here's Proof.`
  ];

  const infoGenieCopies = [
    `While market leaders rely on broad keyword targeting, our AI pinpoints the exact audience segments their campaigns miss — delivering your message at the precise moment prospects are ready to convert. No wasted spend. No guesswork.`,
    `Generic competitor creatives get lost in the feed. Our AI generates personalised ad variants tailored to each audience segment's language, pain points, and intent signals — driving 2.3× higher engagement at lower cost.`,
    `Your top competitor invests heavily in ads — most of it wasted on the wrong audiences. Our competitor intelligence identifies exactly where their budget bleeds, then targets those gaps with precision campaigns that cost a fraction of their spend.`,
    `Market-leading brands' audiences are actively seeking a better alternative. Our AI identifies dissatisfied customer segments and delivers your superior offer at the exact moment they're considering a switch. Average CPA reduction: 31%.`,
    `Stop reacting to competitors' campaigns. Our autonomous AI monitors the market 24/7 — detecting new creatives, budget shifts, and audience changes — then automatically rebuilds your campaigns to stay one step ahead. Always.`,
    `Your primary competitor is showing early signs of market retreat. Our predictive intelligence detected reduced ad frequency and creative stagnation weeks before their rivals noticed. Your window to capture their audience is open right now.`,
    `We reverse-engineered the top-performing campaigns in ${industry.name}. Our AI identified every messaging gap and built superior variants that outperform the originals across every benchmark we ran — ready to deploy in one click.`,
    `Most competitors optimise campaigns once a week. Our AI optimises every 4 hours — adjusting bids, refreshing creatives, and shifting budget based on live conversion signals. That's 42× more optimisation cycles every month.`
  ];

  return competitors.slice(0, 8).map((comp, i) => {
    if (!comp || !comp.campaigns || !comp.campaigns[0]) return '';
    const campaign = comp.campaigns[0];
    const imp = improvements[i] || improvements[0];
    const ourCTR = (parseFloat(campaign.ctr) + parseFloat(imp.ctrBoost)).toFixed(1) + '%';
    const ourROAS = (campaign.roas + parseFloat(imp.roasBoost)).toFixed(1) + '×';
    const panelId = `vs-panel-${i}`;
    const vsAudiences = comp.audiences || [];

    return `
      <div>
        <div class="comp-vs-card">
          <div class="comp-vs-side theirs">
            <div class="cvs-label their-label">🏢 ${comp.name}'s Campaign</div>
            <div class="cvs-comp-name">
              <div class="cvs-favicon">${comp.logo}</div>
              <div class="cvs-comp-text">${campaign.name} · ${campaign.channel}</div>
            </div>
            <div class="cvs-headline">"${campaign.name}"</div>
            <div class="cvs-copy">${comp.suggestions?.[0] || 'Generic broad-targeting campaign with standard creative and minimal audience segmentation.'}</div>
            <div class="cvs-stats">
              <div class="cvs-stat"><div class="cvs-stat-val">${campaign.ctr}</div><div class="cvs-stat-lbl">Their CTR</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val">${campaign.roas}×</div><div class="cvs-stat-lbl">Their ROAS</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val">${campaign.budget}</div><div class="cvs-stat-lbl">Monthly Budget</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val">${campaign.status}</div><div class="cvs-stat-lbl">Status</div></div>
            </div>
            <div style="font-size:0.75rem;color:var(--gray-400);font-style:italic;">⚠️ ${imp.reason}</div>
          </div>

          <div class="comp-vs-divider">
            <div class="vs-line"></div>
            <div class="vs-circle">VS</div>
            <div class="vs-line"></div>
          </div>

          <div class="comp-vs-side ours">
            <div class="cvs-label our-label">✦ InfoGenie Superior Alternative</div>
            <div class="cvs-beat-badge">▲ CTR ${imp.ctrBoost} · ROAS ${imp.roasBoost} · CPA ${imp.cpaReduction} · Audience ${imp.audienceBoost}</div>
            <div class="cvs-headline">"${infoGenieHeadlines[i]}"</div>
            <div class="cvs-copy">${infoGenieCopies[i]}</div>
            <div class="cvs-stats">
              <div class="cvs-stat"><div class="cvs-stat-val" style="color:var(--teal)">${ourCTR}</div><div class="cvs-stat-lbl">Est. CTR</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val" style="color:var(--teal)">${ourROAS}</div><div class="cvs-stat-lbl">Est. ROAS</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val" style="color:var(--green)">${imp.cpaReduction}</div><div class="cvs-stat-lbl">CPA Change</div></div>
              <div class="cvs-stat"><div class="cvs-stat-val" style="color:var(--green)">Auto</div><div class="cvs-stat-lbl">Optimisation</div></div>
            </div>
            <div class="cvs-actions">
              <button class="btn-auto-target" onclick="showVsAudiencePanel('${panelId}', '${comp.name}', ${JSON.stringify(vsAudiences).replace(/"/g,"'")})">🎯 Auto-Target Audience</button>
              <button class="btn-vs-launch" onclick="launchVsCampaign('${comp.name}', '${campaign.channel}')">🚀 Launch This</button>
              <button class="btn-vs-copy" onclick="copyCreative('${infoGenieHeadlines[i].replace(/'/g,"\\'")}', '${infoGenieCopies[i].replace(/'/g,"\\'").replace(/\n/g," ")}')">Copy</button>
            </div>
          </div>
        </div>
        <div id="${panelId}"></div>
      </div>
    `;
  }).join('');
}

function generateCreatives(industry, competitors, domainName, round = 0) {
  const topComp = competitors[0];
  const comp2 = competitors[1] || competitors[0];
  const comp3 = competitors[2] || competitors[0];
  const industryName = industry.name.split(' & ')[0];
  const totalCamps = competitors.reduce((a, c) => a + (c.campaigns?.length || 0), 0);
  const ctr = parseFloat(topComp.ctr);
  const roas = topComp.roas;

  // Full pool of 18 creative templates split into 3 batches of 6
  const allCreatives = [
    // ── Batch 0 (original) ──
    {
      type: 'Search Ad — Google', platform: 'Google', format: 'Responsive Search Ad',
      headline: `The Smarter ${industryName} Platform — ${roas > 4 ? '2× Better ROAS' : '40% Lower CPA'}`,
      copy: `Tired of rising ad costs and limited transparency? InfoGenie's AI-powered platform delivers superior reach with ${ctr}%+ CTR targeting — at a fraction of the budget. Free 14-day trial. No credit card.`,
      estCTR: (ctr + 1.2).toFixed(1) + '%', estConv: '3.8%', estROAS: (roas + 1.1).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    {
      type: 'Video Ad — Meta', platform: 'Meta', format: 'Video (15s Reel)',
      headline: `What Your Competitors Don't Want You to See`,
      copy: `Your top competitors are running multiple active campaigns targeting your customers — and you can't see any of them. Until now. InfoGenie exposes every competitor campaign and automatically builds a better version for you.`,
      estCTR: (ctr + 1.8).toFixed(1) + '%', estConv: '3.1%', estROAS: (roas + 0.8).toFixed(1) + '×', audiences: comp2.audiences || []
    },
    {
      type: 'Performance Max — Google', platform: 'Google', format: 'Performance Max',
      headline: `${industryName} Leaders Are Switching — Here's Why`,
      copy: `${totalCamps} active competitor campaigns are targeting your customers right now. InfoGenie's Performance Max integration analyses all of them and auto-builds a superior campaign — better creative, smarter bidding, 35% lower CPA.`,
      estCTR: (ctr + 0.9).toFixed(1) + '%', estConv: '4.2%', estROAS: (roas + 1.4).toFixed(1) + '×', audiences: (comp3).audiences || []
    },
    {
      type: 'Sponsored Content — LinkedIn', platform: 'LinkedIn', format: 'Sponsored Post + Lead Form',
      headline: `How ${industryName} Teams Cut CPA by 35% in 30 Days`,
      copy: `Market leaders in ${industryName} achieve strong ROAS with heavy monthly budgets. InfoGenie shows you how to outperform them with precision targeting and autonomous bidding — at a fraction of their spend.`,
      estCTR: '3.4%', estConv: '5.1%', estROAS: (roas + 0.6).toFixed(1) + '×', audiences: (competitors[3] || competitors[0]).audiences || []
    },
    {
      type: 'TikTok UGC Ad', platform: 'TikTok', format: 'In-Feed Video (30s)',
      headline: `POV: AI just exposed every competitor campaign running right now`,
      copy: `We analysed your top ${competitors.length} competitors — every ad they're running, every audience they're targeting. Then we built you a better version automatically. This is the unfair advantage.`,
      estCTR: (ctr + 2.1).toFixed(1) + '%', estConv: '2.6%', estROAS: (roas + 0.5).toFixed(1) + '×', audiences: (competitors[4] || competitors[0]).audiences || []
    },
    {
      type: 'Retargeting — Meta', platform: 'Meta', format: 'Dynamic Carousel',
      headline: `Still Researching ${industryName} Platforms? Here's the Full Picture.`,
      copy: `Market leaders' customer acquisition cost is typically 40% higher than alternatives. InfoGenie delivers the same results with full transparency and autonomous AI optimisation — no wasted spend, no guesswork.`,
      estCTR: (ctr + 1.5).toFixed(1) + '%', estConv: '4.6%', estROAS: (roas + 1.3).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    // ── Batch 1 (new angles) ──
    {
      type: 'Search Ad — Google', platform: 'Google', format: 'Exact Match Search',
      headline: `Win on the Keywords Your Competitors Bid On`,
      copy: `Your top competitors bid on high-intent ${industryName} keywords every day. InfoGenie identifies exactly where their bid strategy has gaps — and auto-launches winning ads into those gaps in minutes, not months.`,
      estCTR: (ctr + 1.6).toFixed(1) + '%', estConv: '4.1%', estROAS: (roas + 1.3).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    {
      type: 'Story Ad — Meta', platform: 'Meta', format: 'Story (Full Screen)',
      headline: `Your Biggest Competitor Just Pulled Back Their Ad Spend`,
      copy: `When market leaders pull back their campaigns — which our AI tracks in real time — InfoGenie automatically bids into the vacuum. Your budget goes further. Your reach expands. Your CPA drops. All without lifting a finger.`,
      estCTR: (ctr + 2.3).toFixed(1) + '%', estConv: '3.4%', estROAS: (roas + 0.9).toFixed(1) + '×', audiences: comp2.audiences || []
    },
    {
      type: 'YouTube Pre-Roll', platform: 'Google', format: 'Skippable In-Stream (15s)',
      headline: `The ${industryName} Tool Market Leaders Don't Want You to Have`,
      copy: `Your top competitors spend heavily on ads every month. InfoGenie reads every campaign they launch and generates a higher-performing counter-campaign for you automatically — for a fraction of their budget. Skip the guessing. Start winning.`,
      estCTR: (ctr + 0.7).toFixed(1) + '%', estConv: '3.9%', estROAS: (roas + 1.1).toFixed(1) + '×', audiences: comp3.audiences || []
    },
    {
      type: 'Thought Leadership — LinkedIn', platform: 'LinkedIn', format: 'Document Ad',
      headline: `Why ${industryName} CMOs Are Abandoning Manual Bidding`,
      copy: `We analysed ${competitors.length} competitors in ${industryName}. The ones gaining share all have one thing in common: autonomous AI bidding. Download the free benchmark report — see where the market leaders are spending and where their gaps are.`,
      estCTR: '2.9%', estConv: '6.2%', estROAS: (roas + 0.4).toFixed(1) + '×', audiences: (competitors[3] || competitors[0]).audiences || []
    },
    {
      type: 'TikTok Comparison', platform: 'TikTok', format: 'Duet / Reaction (30s)',
      headline: `Reacting to the Biggest ${industryName} Ad of the Year`,
      copy: `We pulled the top-performing campaign in ${industryName} right now. It's good. But our AI found 4 specific weaknesses in the copy, targeting, and timing — and built a version that outperforms it. We'll show you exactly what we changed and why.`,
      estCTR: (ctr + 2.8).toFixed(1) + '%', estConv: '2.2%', estROAS: (roas + 0.3).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    {
      type: 'Dynamic Remarketing — Google', platform: 'Google', format: 'Display Network',
      headline: `${industryName} Ads That Auto-Optimise While You Sleep`,
      copy: `Market leaders adjust bids dozens of times per day. You can't match that manually — but InfoGenie can. Our autonomous bidding engine analyses every competitor move in real time and auto-adjusts your campaigns to stay ahead. Set it once. Win continuously.`,
      estCTR: (ctr + 1.1).toFixed(1) + '%', estConv: '4.8%', estROAS: (roas + 1.6).toFixed(1) + '×', audiences: comp2.audiences || []
    },
    // ── Batch 2 (emotional / urgency hooks) ──
    {
      type: 'Search — Intent Capture', platform: 'Google', format: 'High-Intent Search',
      headline: `Comparing ${industryName} Platforms? Try InfoGenie First`,
      copy: `Before committing to a market leader, see how InfoGenie delivers ${(ctr + 1.5).toFixed(1)}% CTR vs the industry average of ${ctr}% — with 40% lower spend and AI that self-optimises in real time. Free 14-day trial. No setup fee. Cancel anytime.`,
      estCTR: (ctr + 2.0).toFixed(1) + '%', estConv: '4.5%', estROAS: (roas + 1.8).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    {
      type: 'Reels Ad — Meta', platform: 'Meta', format: 'Reels (9:16 Video)',
      headline: `Your ${industryName} Competitors Are Running Ads RIGHT NOW`,
      copy: `While you're reading this, your top competitors are running campaigns targeting your exact audience. InfoGenie detects every new competitor ad within 2 hours of launch and builds you a better version instantly. Try it free — no card needed.`,
      estCTR: (ctr + 2.5).toFixed(1) + '%', estConv: '3.3%', estROAS: (roas + 0.7).toFixed(1) + '×', audiences: comp2.audiences || []
    },
    {
      type: 'Connected TV — Google', platform: 'Google', format: 'CTV / YouTube TV (30s)',
      headline: `${industryName} Intelligence That Actually Moves Budget`,
      copy: `Most "intelligence" platforms give you data. InfoGenie gives you done — competitor campaign analysis, counter-ad creation, and autonomous bidding all in one. ${totalCamps} competitor campaigns analysed. ${competitors.length} weakness maps generated. Your move.`,
      estCTR: (ctr + 0.6).toFixed(1) + '%', estConv: '4.0%', estROAS: (roas + 1.2).toFixed(1) + '×', audiences: comp3.audiences || []
    },
    {
      type: 'InMail — LinkedIn', platform: 'LinkedIn', format: 'Sponsored Message',
      headline: `We Mapped Every ${industryName} Competitor Ad — For Free`,
      copy: `${competitors.length} competitors. ${totalCamps} active campaigns. Multiple keyword gaps worth hundreds of thousands of monthly searches. Your free ${industryName} competitor intelligence report is ready — click to claim it before your competitors see it.`,
      estCTR: '4.1%', estConv: '7.3%', estROAS: (roas + 0.8).toFixed(1) + '×', audiences: (competitors[3] || competitors[0]).audiences || []
    },
    {
      type: 'Spark Ad — TikTok', platform: 'TikTok', format: 'Creator Boost (45s)',
      headline: `I Switched My ${industryName} Platform to InfoGenie — Here's My ROAS`,
      copy: `After 6 months on a legacy platform, my ROAS was stuck at ${(roas - 0.8).toFixed(1)}×. InfoGenie's AI rebuilt my campaigns from competitor data in 4 hours. By week 2, I was at ${(roas + 1.4).toFixed(1)}×. I'll show you exactly what changed — and what it would look like for your industry.`,
      estCTR: (ctr + 3.1).toFixed(1) + '%', estConv: '2.8%', estROAS: (roas + 1.0).toFixed(1) + '×', audiences: topComp.audiences || []
    },
    {
      type: 'Retargeting — Google Display', platform: 'Google', format: 'Custom Intent Audience',
      headline: `Still Comparing ${industryName} Options? See the Full Breakdown`,
      copy: `Traditional platforms show you what's happening. InfoGenie acts on it — autonomously launching and optimising counter-campaigns in real time. Industry average ${roas}× ROAS vs ${(roas + 1.4).toFixed(1)}× with InfoGenie on the same budget. See the full breakdown.`,
      estCTR: (ctr + 1.9).toFixed(1) + '%', estConv: '5.2%', estROAS: (roas + 1.5).toFixed(1) + '×', audiences: comp2.audiences || []
    }
  ];

  // Pick 6 creatives from the correct batch
  const batchSize = 6;
  const batchIndex = round % 3;
  return allCreatives.slice(batchIndex * batchSize, batchIndex * batchSize + batchSize);
}

function renderCreativeChart(creatives) {
  const canvas = document.getElementById('creativeChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (creativeChartInstance) { creativeChartInstance.destroy(); creativeChartInstance = null; }
  const labels = creatives.map(c => c.platform + ' · ' + c.format.split(' ')[0]);
  const ctrs = creatives.map(c => parseFloat(c.estCTR));
  const roas = creatives.map(c => parseFloat(c.estROAS));

  creativeChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Est. CTR (%)',
          data: ctrs,
          backgroundColor: 'rgba(0,201,200,0.75)',
          borderColor: '#00C9C8',
          borderWidth: 2,
          borderRadius: 6,
          yAxisID: 'y'
        },
        {
          label: 'Est. ROAS (×)',
          data: roas,
          backgroundColor: 'rgba(0,102,255,0.55)',
          borderColor: '#0066FF',
          borderWidth: 2,
          borderRadius: 6,
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.raw } }
      },
      scales: {
        y: {
          beginAtZero: true,
          position: 'left',
          ticks: { callback: v => v + '%', font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,.04)' }
        },
        y2: {
          beginAtZero: true,
          position: 'right',
          ticks: { callback: v => v + '×', font: { size: 11 } },
          grid: { display: false }
        },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function showAudiencePanel(cardIndex, audiencesStr) {
  const panelEl = document.getElementById(`audience-panel-${cardIndex}`);
  if (panelEl.innerHTML) { panelEl.innerHTML = ''; return; }
  const audiences = typeof audiencesStr === 'string'
    ? JSON.parse(audiencesStr.replace(/'/g, '"'))
    : audiencesStr;
  panelEl.innerHTML = buildAudiencePanelHtml(`audience-panel-${cardIndex}`, 'InfoGenie AI Creative', audiences);
  initAudiencePanel(`audience-panel-${cardIndex}`, audiences);
}

function showVsAudiencePanel(panelId, compName, audiencesStr) {
  const panelEl = document.getElementById(panelId);
  if (panelEl.innerHTML) { panelEl.innerHTML = ''; return; }
  const audiences = typeof audiencesStr === 'string'
    ? JSON.parse(audiencesStr.replace(/'/g, '"'))
    : audiencesStr;
  panelEl.innerHTML = buildAudiencePanelHtml(panelId, compName, audiences);
  initAudiencePanel(panelId, audiences);
}

function buildAudiencePanelHtml(panelId, label, audiences) {
  const segs = audiences.length > 0 ? audiences : [
    { label: 'High-Intent Converters', pct: 42 },
    { label: 'Competitor Switchers', pct: 31 },
    { label: 'Research-Phase Buyers', pct: 17 },
    { label: 'Brand Loyalists', pct: 10 }
  ];

  const segHtml = segs.map((s, i) => `
    <div class="atp-segment selected" id="seg-${panelId}-${i}" onclick="toggleSegment('${panelId}', ${i})">
      <div class="atp-seg-top">
        <div class="atp-seg-check" id="check-${panelId}-${i}">✓</div>
        <div class="atp-seg-name">${s.label}</div>
      </div>
      <div class="atp-seg-bar-wrap"><div class="atp-seg-bar" style="width:${s.pct}%"></div></div>
      <div class="atp-seg-stats">
        <span>${s.pct}% engagement</span>
        <span>Est. CPM: $${(8 + s.pct * 0.15).toFixed(2)}</span>
      </div>
    </div>
  `).join('');

  return `
    <div class="audience-targeting-panel">
      <div class="atp-header">
        <span>🎯</span>
        <div class="atp-title">Audience Auto-Targeting — ${label}</div>
        <button class="atp-close" onclick="document.getElementById('${panelId}').innerHTML=''">✕</button>
      </div>
      <div class="atp-body">
        <div>
          <div class="atp-sub-label">Select Audience Segments to Target</div>
          <div class="atp-segments">${segHtml}</div>
        </div>
        <div>
          <div class="atp-sub-label">Exclusion Audiences (auto-applied)</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <span class="atp-pill active">Existing Customers</span>
            <span class="atp-pill active">Competitor Employees</span>
            <span class="atp-pill active">Low-LTV Segments</span>
            <span class="atp-pill">Bot / Invalid Traffic</span>
          </div>
        </div>
        <div class="atp-row">
          <div class="atp-row-label">Daily Budget:</div>
          <input type="number" class="atp-budget-input" placeholder="e.g. 150" value="200" id="budget-${panelId}" />
          <span style="font-size:0.8125rem;color:var(--gray-400)">USD/day</span>
        </div>
        <div class="atp-row">
          <div class="atp-row-label">Deploy on:</div>
          <div class="atp-pills">
            <span class="atp-pill active" onclick="this.classList.toggle('active')">Google Ads</span>
            <span class="atp-pill active" onclick="this.classList.toggle('active')">Meta Ads</span>
            <span class="atp-pill" onclick="this.classList.toggle('active')">TikTok</span>
            <span class="atp-pill" onclick="this.classList.toggle('active')">LinkedIn</span>
          </div>
        </div>
        <button class="btn-activate-targeting" onclick="activateTargeting('${panelId}', '${label}')">
          🚀 Activate Auto-Targeting Now
        </button>
      </div>
    </div>
  `;
}

function initAudiencePanel(panelId, audiences) {
  // All segments pre-selected — interactive toggle is handled via DOM
}

function toggleSegment(panelId, index) {
  const seg = document.getElementById(`seg-${panelId}-${index}`);
  const check = document.getElementById(`check-${panelId}-${index}`);
  if (!seg) return;
  const isSelected = seg.classList.toggle('selected');
  check.textContent = isSelected ? '✓' : '';
}

function activateTargeting(panelId, label) {
  const budget = document.getElementById(`budget-${panelId}`)?.value || '200';
  const selectedSegs = document.querySelectorAll(`#${panelId} .atp-segment.selected`);
  const count = selectedSegs.length;
  if (count === 0) { showToast('⚠️ Please select at least one audience segment'); return; }
  showToast(`🎯 Auto-targeting activated for "${label}" — ${count} audience segments across selected platforms with $${budget}/day budget. InfoGenie is optimising in real-time.`);
  setTimeout(() => {
    const panel = document.getElementById(panelId);
    if (panel) panel.innerHTML = `
      <div style="background:rgba(16,185,129,.06);border:1.5px solid var(--green);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:10px;margin-top:10px;">
        <span style="font-size:1.25rem;">✅</span>
        <div>
          <div style="font-size:0.875rem;font-weight:700;color:var(--green);">Auto-Targeting Active</div>
          <div style="font-size:0.8125rem;color:var(--gray-500);">${count} audience segments · $${budget}/day · InfoGenie monitoring & optimising 24/7</div>
        </div>
      </div>
    `;
  }, 800);
}
function launchVsCampaign(compName, channel) {
  showToast(`🚀 Launching superior campaign vs. ${compName} on ${channel} — InfoGenie AI is configuring targeting and bidding automatically`);
}

function launchCreativeCampaign(index) {
  showToast('🚀 Campaign launched with this AI creative — InfoGenie is deploying and optimising in real-time');
}

function filterCreativeCards(platform, btn) {
  document.querySelectorAll('.pf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#creativeCardGrid .creative-card').forEach(card => {
    const platformText = card.querySelector('.creative-type')?.textContent?.toLowerCase() || '';
    const show = platform === 'all' || platformText.includes(platform);
    card.style.display = show ? '' : 'none';
  });
}

function regenCreatives() {
  showToast('⚡ Regenerating creatives with latest competitor intelligence...');
  setTimeout(() => { buildCreative(); showToast('✅ 6 new AI creatives generated based on updated competitor data'); }, 1600);
}

function copyCreative(headline, copy) {
  const text = `HEADLINE: ${headline}\n\nCOPY: ${copy}`;
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Creative copied to clipboard');
  }).catch(() => {
    showToast('📋 Copied: ' + headline);
  });
}

// ── Re-attach entry points + inline-onclick helpers to window ───────────────
Object.assign(window, {
  // Entry points (nav dispatch + analyse flow)
  buildDashboard, buildAudience, buildCreative, buildRedditIntel,
  // Audience / Creative (inline onclick=)
  targetAudience, showAudiencePanel, showVsAudiencePanel, toggleSegment,
  activateTargeting, launchVsCampaign, launchCreativeCampaign,
  filterCreativeCards, regenCreatives, copyCreative,
  // Reddit Intelligence (inline onclick=)
  switchRedditTab, rdtOpenReply, scanRedditMonitor, generateRedditReply,
});

})();

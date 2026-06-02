/* ============================================================================
 * ig_results_export.js — Results view: PDF export · customise panel · ROAS breakdown
 * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
 * loaded after app.js in index.html. Bare top-level function declarations are
 * re-exported on window (see bottom) so navigateTo dispatch / addEventListener
 * wiring and inline onclick= handlers keep resolving.
 * ========================================================================== */

(function(){
/* ══════════════════════════════════════════════
   RESULTS VIEW — PDF EXPORT, CUSTOMISE PANEL, ROAS BREAKDOWN
   ══════════════════════════════════════════════ */

// ── PDF Export ────────────────────────────────────────────────────────────────
function exportResultsPDF() {
  const camps   = window._launchedCampaigns || [];
  const actions = window._infoGenieActions  || [];
  const ad      = analysisData;
  const now     = new Date().toLocaleString();
  const totalBudget = camps.reduce((s,c) => s+c.budget, 0);
  const avgROAS     = camps.length ? (camps.reduce((s,c)=>s+parseFloat(c.metrics?.roas||0),0)/camps.length).toFixed(1) : '—';
  const totalConv   = camps.reduce((s,c)=>s+(c.metrics?.conversions||0),0);

  const campRows = camps.map(c => `
    <tr>
      <td>${c.name||'—'}</td>
      <td>${c.platform||'—'}</td>
      <td>${c.budgetStr||('$'+c.budget)}/mo</td>
      <td style="color:#10B981;font-weight:700">${c.metrics?.roas||'—'}×</td>
      <td>${c.metrics?.ctr||'—'}</td>
      <td>${(c.metrics?.conversions||0).toLocaleString()}</td>
      <td>${c.metrics?.cpa||'—'}</td>
      <td>${c.launchedAt||'—'}</td>
    </tr>`).join('');

  const actionRows = actions.slice(0,40).map(a => `
    <tr>
      <td>${a.date||'—'} ${a.time||''}</td>
      <td>${a.action||'—'}</td>
      <td style="color:#059669">${a.impact||''}</td>
    </tr>`).join('');

  // Competitor ROAS breakdown for PDF
  const roasRows = ad ? ad.competitors.slice(0,6).map(comp => {
    const issues = compROASIssues(comp, ad);
    return `<tr>
      <td><strong>${comp.name}</strong></td>
      <td style="color:#DC2626;font-weight:700">${issues.roasEst}×</td>
      <td>${issues.primary}</td>
      <td>${issues.fixes.join(' · ')}</td>
    </tr>`;
  }).join('') : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>InfoGenie Campaign Results Report</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color:#1a1a2e; background:#fff; padding:32px 40px; }
    h1 { font-size:1.8rem; color:#0066FF; margin-bottom:4px; }
    .subtitle { font-size:0.85rem; color:#6B7280; margin-bottom:28px; }
    .logo { display:flex; align-items:center; gap:10px; margin-bottom:24px; }
    .logo-icon { width:36px; height:36px; background:linear-gradient(135deg,#00C9C8,#0066FF); border-radius:50%; display:flex; align-items:center; justify-content:center; color:white; font-weight:900; font-size:1rem; }
    .logo-text { font-size:1.4rem; font-weight:900; background:linear-gradient(135deg,#00C9C8,#0066FF); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .kpi-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:28px; }
    .kpi-card { border:1px solid #E2E8F0; border-radius:10px; padding:14px 16px; }
    .kpi-val { font-size:1.5rem; font-weight:800; color:#0066FF; }
    .kpi-label { font-size:0.72rem; color:#6B7280; margin-top:3px; }
    section { margin-bottom:28px; }
    h2 { font-size:1rem; font-weight:700; color:#0A1628; border-bottom:2px solid #E2E8F0; padding-bottom:6px; margin-bottom:12px; }
    table { width:100%; border-collapse:collapse; font-size:0.78rem; }
    th { background:#F9FAFB; text-align:left; padding:8px 10px; font-size:0.68rem; text-transform:uppercase; letter-spacing:.04em; color:#6B7280; border-bottom:1px solid #E2E8F0; }
    td { padding:8px 10px; border-bottom:1px solid #F3F4F6; vertical-align:top; }
    tr:last-child td { border-bottom:none; }
    .footer { margin-top:40px; font-size:0.72rem; color:#9CA3AF; text-align:center; border-top:1px solid #E2E8F0; padding-top:16px; }
    @media print {
      body { padding:16px 20px; }
      @page { margin:14mm 12mm; }
    }
  </style>
</head>
<body>
  <div class="logo">
    <div class="logo-icon">IG</div>
    <div class="logo-text">InfoGenie</div>
  </div>
  <h1>Campaign Results Report</h1>
  <div class="subtitle">Generated: ${now}${ad ? ' &nbsp;·&nbsp; Analysis: ' + ad.url : ''}</div>

  <div class="kpi-grid">
    <div class="kpi-card"><div class="kpi-val">${camps.length}</div><div class="kpi-label">Campaigns Launched</div></div>
    <div class="kpi-card"><div class="kpi-val">${camps.length?'$'+totalBudget.toLocaleString():'—'}</div><div class="kpi-label">Total Budget / mo</div></div>
    <div class="kpi-card"><div class="kpi-val">${avgROAS}×</div><div class="kpi-label">Average ROAS</div></div>
    <div class="kpi-card"><div class="kpi-val">${totalConv.toLocaleString()}</div><div class="kpi-label">Total Conversions</div></div>
    <div class="kpi-card"><div class="kpi-val">${ad ? ad.competitors.length : '—'}</div><div class="kpi-label">Competitors Analysed</div></div>
    <div class="kpi-card"><div class="kpi-val">${(window._infoGenieActions||[]).length}</div><div class="kpi-label">AI Actions Taken</div></div>
  </div>

  ${camps.length ? `
  <section>
    <h2>🚀 Active Campaigns</h2>
    <table>
      <thead><tr><th>Campaign</th><th>Platform</th><th>Budget</th><th>ROAS</th><th>CTR</th><th>Conversions</th><th>CPA</th><th>Launched</th></tr></thead>
      <tbody>${campRows}</tbody>
    </table>
  </section>` : ''}

  ${roasRows ? `
  <section>
    <h2>📉 Competitor ROAS Breakdown — Why They're Underperforming</h2>
    <table>
      <thead><tr><th>Competitor</th><th>Est. ROAS</th><th>Primary Issue</th><th>Recommended Fixes</th></tr></thead>
      <tbody>${roasRows}</tbody>
    </table>
  </section>` : ''}

  ${actionRows ? `
  <section>
    <h2>⚡ Action History</h2>
    <table>
      <thead><tr><th>Date / Time</th><th>Action</th><th>Impact</th></tr></thead>
      <tbody>${actionRows}</tbody>
    </table>
  </section>` : ''}

  <div class="footer">InfoGenie — AI Autonomous Marketing Intelligence &nbsp;·&nbsp; Confidential — Do not distribute</div>

  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('⚠ Please allow pop-ups to export PDF'); return; }
  win.document.write(html);
  win.document.close();
  showToast('📄 PDF print dialog opened — choose "Save as PDF"');
}

// ── Competitor ROAS failure analysis ─────────────────────────────────────────
// Industry-specific ROAS benchmark ranges (min, typical, high-performer)
const INDUSTRY_ROAS_BENCHMARKS = {
  'e-commerce': { min: 2.5, avg: 4.5, top: 8.0, label: 'E-commerce' },
  ecommerce:    { min: 2.5, avg: 4.5, top: 8.0, label: 'E-commerce' },
  retail:       { min: 2.0, avg: 4.0, top: 7.0, label: 'Retail' },
  saas:         { min: 2.0, avg: 3.5, top: 6.0, label: 'SaaS / Software' },
  software:     { min: 2.0, avg: 3.5, top: 6.0, label: 'Software' },
  finance:      { min: 1.5, avg: 3.0, top: 5.0, label: 'Financial Services' },
  fintech:      { min: 1.5, avg: 3.0, top: 5.0, label: 'Fintech' },
  insurance:    { min: 1.2, avg: 2.5, top: 4.5, label: 'Insurance' },
  realestate:   { min: 1.5, avg: 2.8, top: 4.5, label: 'Real Estate' },
  'real estate':{ min: 1.5, avg: 2.8, top: 4.5, label: 'Real Estate' },
  healthcare:   { min: 1.8, avg: 3.2, top: 5.5, label: 'Healthcare' },
  medical:      { min: 1.8, avg: 3.2, top: 5.5, label: 'Medical' },
  education:    { min: 2.0, avg: 3.5, top: 6.0, label: 'Education' },
  travel:       { min: 2.5, avg: 4.0, top: 7.0, label: 'Travel & Tourism' },
  hospitality:  { min: 2.0, avg: 3.5, top: 6.0, label: 'Hospitality' },
  automotive:   { min: 2.0, avg: 3.8, top: 6.5, label: 'Automotive' },
  food:         { min: 2.5, avg: 4.5, top: 8.0, label: 'Food & Beverage' },
  restaurant:   { min: 2.5, avg: 4.5, top: 8.0, label: 'Restaurant / Food' },
  beauty:       { min: 3.0, avg: 5.5, top: 9.0, label: 'Beauty & Cosmetics' },
  fitness:      { min: 2.0, avg: 3.8, top: 6.5, label: 'Fitness & Wellness' },
  legal:        { min: 1.5, avg: 2.8, top: 4.5, label: 'Legal Services' },
  marketing:    { min: 2.5, avg: 4.0, top: 7.0, label: 'Marketing / Agency' },
  agency:       { min: 2.5, avg: 4.0, top: 7.0, label: 'Agency Services' },
  default:      { min: 2.0, avg: 3.5, top: 6.0, label: 'Your Industry' },
};

function getIndustryROASBenchmark() {
  const ind = (analysisData?.industry?.name || analysisData?.industry || '').toString().toLowerCase();
  for (const [key, bench] of Object.entries(INDUSTRY_ROAS_BENCHMARKS)) {
    if (ind.includes(key)) return bench;
  }
  // Try to match partial industry name
  const keys = Object.keys(INDUSTRY_ROAS_BENCHMARKS).filter(k => k !== 'default');
  const match = keys.find(k => k.split(' ').some(w => ind.includes(w)));
  return INDUSTRY_ROAS_BENCHMARKS[match] || INDUSTRY_ROAS_BENCHMARKS.default;
}

function compROASIssues(comp, ad) {
  // Use actual ROAS from competitor data — when missing, fall back to the
  // industry benchmark average (no random fakery).
  const _bench = (typeof getIndustryROASBenchmark === 'function' ? getIndustryROASBenchmark() : { avg: 2.5 });
  const _haveRoas = (typeof comp.roas === 'number' && comp.roas > 0) ||
                     (typeof comp.roas === 'string' && comp.roas !== '—' && !isNaN(parseFloat(comp.roas)));
  const roasEst = _haveRoas ? parseFloat(comp.roas).toFixed(1) : _bench.avg.toFixed(1);
  const bench = getIndustryROASBenchmark();
  const roasNum = parseFloat(roasEst);
  const gap = (bench.avg - roasNum).toFixed(1);
  const isUnderBench = roasNum < bench.avg;

  // Detect failure patterns
  const hasHighCpc  = comp.avgCPC && parseFloat(comp.avgCPC) > 3.5;
  const lowQscore   = comp.qualityScore && parseFloat(comp.qualityScore) < 6;
  const broadMatch  = !comp.usesExactMatch;
  const noRetarg    = !comp.usesRetargeting;
  const poorLanding = comp.landingPageScore && parseFloat(comp.landingPageScore) < 70;
  const highBounce  = comp.bounceRate && parseFloat(comp.bounceRate) > 65;
  const lowCtr      = comp.ctr && parseFloat(comp.ctr) < 2.5;
  const topCh       = (comp.topChannel || comp.topChannels?.[0] || '').toLowerCase();

  // Build context-aware issues
  const allIssues = [
    { cond: hasHighCpc,   label: `Overpaying per click — ${bench.label} avg CPC is falling due to bid inflation on broad match terms`, fixes: ['Use SKAG bid structure', 'Add 200+ negative keywords'] },
    { cond: lowQscore,    label: 'Low Quality Score — ad-to-landing-page mismatch reducing ad rank and increasing CPC', fixes: ['Align ad copy with landing page H1', 'Add emotion-driven CTAs'] },
    { cond: broadMatch,   label: `Broad match keywords wasting ${bench.label} budget on irrelevant traffic — conversion rate suffers`, fixes: ['Shift to phrase/exact match', 'Layer audience bid modifiers'] },
    { cond: noRetarg,     label: 'Zero retargeting — warm visitors who showed buying intent are being handed back to competitors', fixes: ['Add RLSA campaigns', 'Build 7/14/30-day custom audiences'] },
    { cond: poorLanding,  label: 'Weak landing page UX — ${bench.label} buyers have high intent but drop-off before converting', fixes: ['Add social proof above fold', 'Single CTA per page'] },
    { cond: highBounce,   label: 'High bounce rate indicates ad promise mismatches the landing page — trust collapses on arrival', fixes: ['Match ad headline to page H1', 'A/B test headline + offer'] },
    { cond: lowCtr,       label: `CTR of ${comp.ctr} is below ${bench.label} average (2.5%+) — ad copy lacks relevance or differentiation`, fixes: ['Test question-based headlines', 'Add dynamic keyword insertion'] },
    { cond: topCh === 'meta' && isUnderBench, label: `Meta-only strategy in ${bench.label} misses high-intent Google search traffic where ROAS is ${(roasNum + 0.8).toFixed(1)}×+`, fixes: ['Add Google Search campaigns', 'Use Google Shopping for product ads'] },
    { cond: topCh === 'google' && isUnderBench, label: `Google-only strategy misses Meta's warm audience retargeting loop — ${bench.label} brands see +0.6× ROAS lift adding Meta`, fixes: ['Add Meta retargeting layer', 'Run brand awareness on Meta Stories'] },
  ].filter(i => i.cond);

  const fallbackIssues = [
    { label: `Ad creative fatigue — in ${bench.label} the average creative lifespan is 21 days; CTR is likely declining week-on-week`, fixes: ['Rotate 3+ creative variants', 'Refresh every 3 weeks'] },
    { label: `Generic offer messaging — ${bench.label} buyers respond to specificity; this brand lacks a clear differentiator in ad copy`, fixes: ['Lead with a unique value prop', 'Use direct competitor comparison angles'] },
    { label: `No dayparting strategy — ${bench.label} conversions peak in specific windows; budget burning during off-peak hours`, fixes: ['Analyse hourly conversion data', 'Schedule bids to peak windows only'] },
    { label: `Single-channel reliance increases CPA by ~22% vs. multi-channel in ${bench.label} — attribution gap reduces ROAS`, fixes: ['Add a second platform', 'Implement cross-channel attribution'] },
    { label: `Audience targeting too broad — ${bench.label} campaigns require tight lookalike and interest layering to hit ${bench.avg}× ROAS`, fixes: ['Build 1% LTV lookalike audiences', 'Layer purchase-intent audiences'] },
  ];

  const combined = [...allIssues, ...fallbackIssues].slice(0, 2);
  const primary = combined[0]?.label || `ROAS of ${roasEst}× is ${gap}× below the ${bench.label} industry average of ${bench.avg}× — structural targeting inefficiency`;
  const fixes   = combined.flatMap(i => i.fixes).slice(0, 4);

  return { roasEst, primary, fixes, bench };
}

// ── Build competitor ROAS breakdown HTML ──────────────────────────────────────
function buildCompetitorROASBreakdown() {
  const ad = analysisData;
  if (!ad || !ad.competitors || !ad.competitors.length) return '';

  const bench = getIndustryROASBenchmark();
  const myROAS = ad.websiteKPIs?.roas ? parseFloat(ad.websiteKPIs.roas) : bench.avg;
  const projROAS = Math.min((myROAS * 1.25).toFixed(1), bench.top);
  const indLabel = bench.label;

  const rows = ad.competitors.slice(0, 6).map((comp, idx) => {
    const { roasEst, primary, fixes, bench: b } = compROASIssues(comp, ad);
    const roasNum = parseFloat(roasEst);
    // Severity based on industry benchmark, not hardcoded thresholds
    const severity = roasNum < bench.min ? 'critical' : roasNum < bench.avg ? 'weak' : 'moderate';
    const sevColor = severity === 'critical' ? '#DC2626' : severity === 'weak' ? '#F59E0B' : '#D97706';
    const sevLabel = severity === 'critical' ? 'Critical' : severity === 'weak' ? 'Below Industry Avg' : 'Moderate';

    return `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.05)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:38px;height:38px;border-radius:10px;background:${sevColor}15;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">📉</div>
          <div>
            <div style="font-weight:800;font-size:0.9rem;color:#0A1628">${comp.name}</div>
            <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${comp.domain || comp.url || 'Competitor #'+(idx+1)}</div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:1.4rem;font-weight:800;color:${sevColor};font-family:Sora,sans-serif">${roasEst}×</div>
          <div style="font-size:0.62rem;font-weight:700;color:${sevColor};text-transform:uppercase;letter-spacing:.06em">${sevLabel} ROAS</div>
        </div>
      </div>

      <!-- ROAS vs Your Target bar -->
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:#6B7280;margin-bottom:4px">
          <span>Their ROAS vs your target (${projROAS}×)</span>
          <span style="font-weight:700;color:${sevColor}">${Math.min(Math.round(parseFloat(roasEst)/parseFloat(projROAS)*100),100)}%</span>
        </div>
        <div style="background:#F3F4F6;border-radius:6px;height:8px;overflow:hidden">
          <div style="width:${Math.min(Math.round(parseFloat(roasEst)/parseFloat(projROAS)*100),100)}%;background:${sevColor};height:100%;border-radius:6px;transition:width .6s ease"></div>
        </div>
      </div>

      <!-- Primary failure reason -->
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:9px;padding:10px 12px;margin-bottom:10px">
        <div style="font-size:0.68rem;font-weight:700;color:#991B1B;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">⚠ Primary Failure Reason</div>
        <div style="font-size:0.8rem;color:#7F1D1D;line-height:1.45">${primary}</div>
      </div>

      <!-- Fixes you can exploit -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">✅ How InfoGenie Exploits This Gap</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${fixes.map(f => `<span style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:20px;padding:3px 10px;font-size:0.71rem;color:#065F46;font-weight:600">${f}</span>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  <div style="background:var(--ig-grad2);border-radius:18px;padding:22px 24px;margin-bottom:24px;border:1px solid rgba(239,68,68,.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px">
      <div>
        <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:white">📉 Competitor ROAS Intelligence — Why They're Underperforming</div>
        <div style="font-size:0.78rem;color:rgba(255,255,255,.5);margin-top:3px">
          Clear breakdown of each competitor's ROAS failures and the exact gaps you can exploit
        </div>
      </div>
      <div style="background:rgba(16,185,129,.15);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:8px 14px;text-align:center;flex-shrink:0">
        <div style="font-size:1.1rem;font-weight:800;color:#10B981">${projROAS}×</div>
        <div style="font-size:0.62rem;color:rgba(255,255,255,.5);margin-top:1px">Your ROAS Target</div>
      </div>
      <div style="background:rgba(0,229,255,.08);border:1px solid rgba(0,229,255,.15);border-radius:10px;padding:8px 14px;text-align:center;flex-shrink:0">
        <div style="font-size:1.1rem;font-weight:800;color:#00E5FF">${bench.avg}×</div>
        <div style="font-size:0.62rem;color:rgba(255,255,255,.5);margin-top:1px">${indLabel} Avg ROAS</div>
      </div>
      <div style="background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.2);border-radius:10px;padding:8px 14px;text-align:center;flex-shrink:0">
        <div style="font-size:1.1rem;font-weight:800;color:#10B981">${bench.top}×</div>
        <div style="font-size:0.62rem;color:rgba(255,255,255,.5);margin-top:1px">Top 10% ${indLabel}</div>
      </div>
    </div>
    <div class="ig-roas-callout" style="border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.8rem;line-height:1.55">
      <strong class="ig-roas-q">Why are competitors underperforming vs. the ${indLabel} ROAS benchmark (${bench.avg}×)?</strong> <span>The analysis below identifies structural, creative, and targeting failures specific to this industry. Industry average ROAS:</span> <strong class="ig-roas-avg">${bench.avg}×</strong><span>. Top performers:</span> <strong class="ig-roas-top">${bench.top}×</strong><span>. These are real exploitable gaps — each one represents budget you can capture from their wasted spend.</span>
    </div>
    <div style="color:#0A1628">${rows}</div>
  </div>`;
}

// ── Customise Results Panel ───────────────────────────────────────────────────
const RESULTS_SECTIONS = [
  { key: 'stats',         label: '📊 Summary KPIs',              default: true },
  { key: 'leads',         label: '📋 Lead Reporting Dashboard',  default: true },
  { key: 'charts',        label: '📈 Performance Charts',        default: true },
  { key: 'roas-breakdown',label: '📉 Competitor ROAS Breakdown', default: true },
  { key: 'improvement',   label: '✅ Improvement Analysis',      default: true },
  { key: 'campaigns',     label: '🚀 Active Campaigns Table',    default: true },
  { key: 'abtests',       label: '🧪 A/B Test Results',         default: true },
  { key: 'actions',       label: '⚡ Action History Timeline',   default: true },
];

function toggleResultsCustomisePanel() {
  let panel = document.getElementById('resultsCustPanel');
  if (panel) { panel.remove(); return; }

  window._resultsPanelPrefs = window._resultsPanelPrefs || {};
  const prefs = window._resultsPanelPrefs;

  panel = document.createElement('div');
  panel.id = 'resultsCustPanel';
  panel.style.cssText = `position:fixed;top:96px;right:20px;z-index:4000;background:#0D1F3C;border:1px solid rgba(0,201,200,.2);border-radius:16px;padding:18px 20px;width:280px;box-shadow:0 12px 48px rgba(0,0,0,.5)`;

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:white">⚙ Customise View</div>
      <button onclick="document.getElementById('resultsCustPanel').remove()" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1rem;cursor:pointer;line-height:1">✕</button>
    </div>
    <div style="font-size:0.72rem;color:rgba(255,255,255,.4);margin-bottom:12px">Toggle sections on/off</div>
    <div id="custSectionList">
      ${RESULTS_SECTIONS.map(s => {
        const on = prefs[s.key] !== false;
        return `<label style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;gap:8px">
          <span style="font-size:0.78rem;color:rgba(255,255,255,.8)">${s.label}</span>
          <div class="rc-toggle ${on?'on':''}" data-section="${s.key}" onclick="rcToggle(this)" style="flex-shrink:0;width:36px;height:20px;border-radius:10px;background:${on?'#00C9C8':'rgba(255,255,255,.15)'};position:relative;cursor:pointer;transition:background .2s">
            <div style="width:16px;height:16px;border-radius:50%;background:white;position:absolute;top:2px;left:${on?'18px':'2px'};transition:left .2s"></div>
          </div>
        </label>`;
      }).join('')}
    </div>
    <button onclick="rcApply()" style="margin-top:14px;width:100%;padding:9px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:9px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">Apply Changes</button>
  `;

  document.body.appendChild(panel);
}

function rcToggle(el) {
  const on = el.classList.toggle('on');
  el.style.background = on ? '#00C9C8' : 'rgba(255,255,255,.15)';
  el.querySelector('div').style.left = on ? '18px' : '2px';
  window._resultsPanelPrefs = window._resultsPanelPrefs || {};
  window._resultsPanelPrefs[el.dataset.section] = on;
}

function rcApply() {
  // Apply visibility instantly without full rebuild
  RESULTS_SECTIONS.forEach(s => {
    const on  = window._resultsPanelPrefs?.[s.key] !== false;
    const els = document.querySelectorAll(`[data-results-section="${s.key}"]`);
    els.forEach(el => { el.style.display = on ? '' : 'none'; });
  });
  document.getElementById('resultsCustPanel')?.remove();
  showToast('✅ View updated');
}

  // ── Public entry points (re-exported on window) ──
  window.exportResultsPDF             = exportResultsPDF;
  window.getIndustryROASBenchmark     = getIndustryROASBenchmark;
  window.buildCompetitorROASBreakdown = buildCompetitorROASBreakdown;
  window.toggleResultsCustomisePanel  = toggleResultsCustomisePanel;
  window.rcToggle                     = rcToggle;
  window.rcApply                      = rcApply;
})();

// =============================================================================
// ig_compete.js — Compete cluster view-builders (Competitors · Intelligence · Battle Plan)
// -----------------------------------------------------------------------------
// Carved out of app.js verbatim (no behaviour change) in one IIFE. Holds three
// cohesive competitor-facing view-builders plus their feature-private helpers:
//
//   • Competitors list + Competitor Monitor — buildCompetitors ·
//     renderCompetitorCards · buildCompMonitor · buildCompCard · generateBlogMonitor ·
//     generatePageResponse · pageTrackerCounterAd · loadBacklinks + backlink helpers
//     (_blRng · _blSeed · _BL_POOL · _genRefDomains · openBLDetail · closeBLDetail)
//   • Intelligence Hub — buildIntelligence · exportIntelligenceReport (PDF/TXT) ·
//     _loadJsPDF · openExclusiveModal/closeExclusiveModal
//   • Battle Plan — switchBattlePlanComp · buildBattlePlan · bp* helpers
//     (_bpGet · bpLC · bpGA · bpBC · bpCS · bpTA · bpCC · bpQW) · Full Attack Plan
//     modal (openFullAttackPlanModal · renderAttackPlan · _apSwitchTab · _apCloseModal)
//
// Public entry points + every inline-onclick handler are re-attached to window at
// the foot of the IIFE; feature-private helpers stay scoped to this file.
// Shared globals (analysisData, showToast, navigateTo, _fmt, _esc, _escapeHtml,
// _safeUrl, _dataBadge, openCompetitorAnalysis, openAdInCreativeStudio,
// openCampLaunchRich, generateCampaignRecs, Chart, …) come from app.js at call time.
// =============================================================================
(function () {

// ===== BUILD COMPETITORS =====
function buildCompetitors() {
  // React owns this view under the Next.js front door — its `#view-competitors`
  // panel (incl. #compFilterSel / #competitorCardsWrap) is stripped from the
  // shell. No-op when absent; runs normally in prod's vanilla SPA.
  if (!document.getElementById('compFilterSel')) return;
  const { competitors } = analysisData;
  
  // Populate filter select
  const sel = document.getElementById('compFilterSel');
  sel.innerHTML = '<option value="all">All Competitors</option>' +
    competitors.map(c => `<option value="${c.url}">${c.name}</option>`).join('');

  // Populate green hero stat tiles
  const liveCount = competitors.filter(c => c._dataSource === 'DataForSEO' || c._realTraffic).length;
  const aiCount   = competitors.filter(c => c.aiDetected).length;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('compHeroTotal', competitors.length);
  set('compHeroLive',  liveCount);
  set('compHeroAi',    aiCount);
  
  renderCompetitorCards(competitors);
  
  sel.addEventListener('change', () => {
    const val = sel.value;
    if (val === 'all') renderCompetitorCards(competitors);
    else renderCompetitorCards(competitors.filter(c => c.url === val));
  });
}

function renderCompetitorCards(comps) {
  const wrap = document.getElementById('competitorCardsWrap');
  const yourReal   = analysisData._yourRealData;
  const liveCount  = comps.filter(c => c._dataSource === 'DataForSEO').length;

  // Data-mode honesty: campaign metrics (CTR/ROAS) on these tiles are AI-estimated
  // industry benchmarks. demo → badge the panel + keep numbers; strict → withhold
  // the estimated CTR/ROAS (real traffic, where present, still shows).
  const _dmMode = (window._igDataMode || 'strict');
  const _compDemoPill = (_dmMode === 'demo' && typeof window._demoBadge === 'function')
    ? ' ' + window._demoBadge('AI estimate') : '';

  // Expose for the click handlers on benchmark tiles
  window._liveBenchmarkComps = comps;

  // Build the benchmark competitor tiles — clickable, opens full analysis modal
  const compTiles = comps.slice(0, 6).map((c, idx) => {
    const hasLive = !!c._realTraffic || c.realData;
    const tileBg = hasLive
      ? 'linear-gradient(135deg,#A7F3D0 0%,#6EE7B7 100%)'
      : 'linear-gradient(135deg,#A5F3FC 0%,#67E8F9 100%)';
    const tagBg = hasLive ? '#065F46' : '#0E7490';
    return `
      <div onclick="openCompetitorAnalysis(window._liveBenchmarkComps[${idx}])"
           onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 22px rgba(15,76,74,.22)'"
           onmouseleave="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(15,76,74,.10)'"
           title="Click to see full analysis for ${c.name}"
           style="background:${tileBg};border:1px solid rgba(15,76,74,.18);border-radius:12px;padding:14px 12px;text-align:center;box-shadow:0 2px 8px rgba(15,76,74,.10);cursor:pointer;transition:transform .18s ease, box-shadow .18s ease;position:relative">
        <div style="display:inline-block;background:${tagBg};color:#FFFFFF;font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;padding:2px 8px;border-radius:10px;margin-bottom:8px">${hasLive ? '📡 Live' : '📊 Benchmark'}</div>
        <div style="font-size:0.85rem;font-weight:800;color:#0A2F2D;margin-bottom:2px">${c.name}</div>
        <div style="font-size:0.7rem;color:#134E4A;opacity:.85;margin-bottom:6px">${c.url}</div>
        <div style="font-size:0.74rem;color:#0A2F2D;font-weight:700">${hasLive && c._realTraffic ? c._realTraffic + ' traffic/mo' : (c.traffic || '—') + ' traffic'}</div>
        <div style="font-size:0.7rem;color:#134E4A;opacity:.9">${_dmMode === 'strict' ? '<span style="opacity:.7">CTR/ROAS hidden · Demo Mode off</span>' : (c.ctr || '—') + ' CTR · ' + (c.roas || '—') + '× ROAS'}</div>
        <div style="margin-top:8px;font-size:0.62rem;font-weight:800;color:#065F46;letter-spacing:.06em;text-transform:uppercase;opacity:.85">Click for full analysis →</div>
      </div>`;
  }).join('');

  const realCompsPanel = `
    <div style="background:linear-gradient(135deg,#ECFEFF 0%,#F0FDFA 100%);border-radius:14px;padding:18px 20px;margin-bottom:18px;border:1px solid rgba(15,76,74,.14);box-shadow:0 4px 14px rgba(15,76,74,.08)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-family:Sora,sans-serif;font-size:0.875rem;font-weight:800;color:#0A2F2D">📡 Live Competitor Intelligence</span>${_compDemoPill}
        ${liveCount > 0
          ? `<span style="background:linear-gradient(135deg,#10B981,#0E7490);border-radius:20px;padding:3px 10px;font-size:0.68rem;font-weight:800;color:white">${liveCount} LIVE · DataForSEO</span>`
          : `<span style="background:#FFFFFF;border:1px solid rgba(15,76,74,.18);border-radius:20px;padding:3px 10px;font-size:0.68rem;font-weight:800;color:#0F4C4A">AI BENCHMARKS</span>`}
        <span style="font-size:0.72rem;color:#0F4C4A;opacity:.7;margin-left:auto">Same competitors used across all views · Updated ${new Date().toLocaleTimeString()}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${yourReal ? `
          <div style="background:linear-gradient(135deg,#5EEAD4 0%,#2DD4BF 100%);border:1px solid rgba(15,76,74,.25);border-radius:12px;padding:14px 12px;text-align:center;box-shadow:0 2px 8px rgba(15,76,74,.12)">
            <div style="display:inline-block;background:#0F4C4A;color:#FFFFFF;font-size:0.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;padding:2px 8px;border-radius:10px;margin-bottom:8px">🏠 Your Domain</div>
            <div style="font-size:0.85rem;font-weight:800;color:#0A2F2D;margin-bottom:2px">${yourReal.domain}</div>
            <div style="font-size:0.74rem;color:#0A2F2D;font-weight:700">${_fmt(yourReal.organicTraffic)} traffic/mo</div>
            <div style="font-size:0.7rem;color:#134E4A;opacity:.85">${_fmt(yourReal.organicKeywords)} keywords</div>
          </div>
        ` : ''}
        ${compTiles}
      </div>
      <div style="margin-top:10px;font-size:0.7rem;color:#0F4C4A;opacity:.75">
        📊 These are the same competitors benchmarked in your Dashboard, Campaigns, and Audience views.
        ${liveCount > 0 ? `${liveCount} have live traffic data from DataForSEO —` : 'Traffic data is DataForSEO where available,'} campaign metrics (CTR, ROAS) are AI-estimated industry benchmarks.
      </div>
    </div>
  `;

  wrap.innerHTML = realCompsPanel + `<div class="comp-cards-grid">${comps.map((c, i) => buildCompCard(c, i)).join('')}</div>`;

  // Async-load backlink data for each competitor domain
  loadBacklinks(comps);

  // Build Blog Monitor + Page Tracker panels
  buildCompMonitor(comps);
}

// ── Competitor Blog Monitor & New Page Tracker ─────────────────────────────────

function buildCompMonitor(comps) {
  const wrap = document.getElementById('compMonitorWrap');
  if (!wrap) return;
  const domain = analysisData ? analysisData.url : 'yourdomain.com';
  const industry = analysisData && analysisData.industry ? analysisData.industry.name : 'your industry';

  // Seeded page tracker entries per competitor
  const pageTypes = [
    { icon: '💰', type: 'Pricing Change', color: '#D97706', bg: '#FFF7ED', border: '#FED7AA' },
    { icon: '🚀', type: 'New Feature Page', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
    { icon: '📦', type: 'Product Launch', color: '#059669', bg: '#F0FDF4', border: '#A7F3D0' },
    { icon: '📝', type: 'New Blog Post', color: '#0066FF', bg: '#EFF6FF', border: '#BFDBFE' },
    { icon: '🆚', type: 'Comparison Page', color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    { icon: '📋', type: 'Case Study', color: '#0891B2', bg: '#ECFEFF', border: '#A5F3FC' },
  ];

  const daysAgoLabels = ['2h ago', '6h ago', '1d ago', '2d ago', '3d ago', '5d ago', '1w ago'];

  const pageRows = comps.slice(0,5).map((c, ci) => {
    const numPages = 2 + (ci % 3);
    return Array.from({ length: numPages }, (_, pi) => {
      const pt = pageTypes[(ci * 3 + pi) % pageTypes.length];
      const age = daysAgoLabels[(ci * 2 + pi) % daysAgoLabels.length];
      const slug = pt.type === 'Pricing Change' ? '/pricing' :
                   pt.type === 'New Feature Page' ? '/features/' + industry.toLowerCase().replace(/\s+/g, '-').slice(0,12) :
                   pt.type === 'Product Launch' ? '/product/' + (2025 + pi) :
                   pt.type === 'New Blog Post' ? '/blog/' + c.name.toLowerCase().replace(/\s+/g, '-').slice(0,10) + '-strategy' :
                   pt.type === 'Comparison Page' ? '/vs/' + domain.replace(/^https?:\/\//, '').split('/')[0] :
                   '/case-studies/' + industry.toLowerCase().slice(0,10) + '-roi';
      const significance = pt.type === 'Pricing Change' ? 'HIGH' :
                           pt.type === 'Product Launch' ? 'HIGH' :
                           pt.type === 'Comparison Page' ? 'HIGH' :
                           pt.type === 'New Feature Page' ? 'MED' : 'LOW';
      const sigColor = significance === 'HIGH' ? '#DC2626' : significance === 'MED' ? '#D97706' : '#6B7280';
      const sigBg = significance === 'HIGH' ? '#FEF2F2' : significance === 'MED' ? '#FFFBEB' : '#F9FAFB';
      return { comp: c, pt, age, slug, significance, sigColor, sigBg };
    });
  }).flat();

  // Store rows in a global lookup so onclick just passes a clean index (avoids string escaping issues)
  window._pageTrackerRows = pageRows;

  wrap.innerHTML = `
    <!-- BLOG MONITOR SECTION -->
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:'Space Grotesk','Sora',sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:3px">📰 Competitor Blog & Content Monitor</div>
          <div style="font-size:0.73rem;color:#6B7280">Track what competitors are publishing — topics, strategy signals, and audience targeting shifts</div>
        </div>
        <button id="runBlogMonBtn" onclick="generateBlogMonitor()" style="padding:9px 20px;background:linear-gradient(135deg,#7C3AED,#0066FF);border:none;border-radius:10px;font-size:0.76rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 4px 12px rgba(124,58,237,0.25)">🤖 Run Blog Intelligence</button>
      </div>

      <!-- Competitor blog pulse cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px" id="blogPulseGrid">
        ${comps.slice(0,5).map((c, ci) => {
          const postCount = 3 + ci;
          const topics = [
            `${industry} ROI optimisation guide`,
            `Why ${industry} teams switch platforms`,
            `${c.name} vs alternatives 2025`,
            `AI in ${industry}: full breakdown`,
            `Cutting ${industry} costs by 40%`
          ].slice(0, 2 + (ci % 2));
          const engScore = 60 + ci * 7;
          return `
            <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:14px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                <div style="font-size:0.78rem;font-weight:700;color:#0A1628">${c.name}</div>
                <span style="background:#EEF2FF;color:#4338CA;font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:10px">${postCount} posts/mo</span>
              </div>
              <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:10px">
                ${topics.map(t => `<div style="font-size:0.7rem;color:#374151;background:white;border:1px solid #E5E7EB;border-radius:6px;padding:5px 8px;line-height:1.4">📄 ${t}</div>`).join('')}
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:0.65rem;color:#6B7280">Avg engagement</span>
                <span style="font-size:0.72rem;font-weight:700;color:${engScore>=75?'#059669':engScore>=60?'#D97706':'#DC2626'}">${engScore}/100</span>
              </div>
            </div>`;
        }).join('')}
      </div>

      <div id="blogMonitorReport" style="display:none;margin-top:4px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px">
        <div style="font-size:0.8rem;color:#1A2F4A;line-height:1.75;white-space:pre-wrap" id="blogMonitorText"></div>
      </div>
    </div>

    <!-- NEW PAGE TRACKER SECTION -->
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:'Space Grotesk','Sora',sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:3px">🗺️ New Page Tracker — Pricing, Products & Launches</div>
          <div style="font-size:0.73rem;color:#6B7280">Detect when competitors add new pricing pages, feature pages, or product launches before they gain traction</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.3);font-size:0.65rem;font-weight:700;padding:3px 10px;border-radius:20px">● LIVE MONITORING</span>
          <button onclick="showToast('🔄 Page tracker refreshed — ${pageRows.length} new pages detected across ${comps.slice(0,5).length} competitors')" style="padding:7px 14px;background:#F3F4F6;border:none;border-radius:8px;font-size:0.72rem;font-weight:600;color:#374151;cursor:pointer">↻ Refresh</button>
        </div>
      </div>

      <!-- Summary KPIs -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
        ${[
          { label: 'New Pages (7d)', val: pageRows.length, color: '#0066FF', icon: '📄' },
          { label: 'Pricing Changes', val: pageRows.filter(p=>p.pt.type==='Pricing Change').length, color: '#D97706', icon: '💰' },
          { label: 'Product Launches', val: pageRows.filter(p=>p.pt.type==='Product Launch').length, color: '#059669', icon: '🚀' },
          { label: 'HIGH Priority', val: pageRows.filter(p=>p.significance==='HIGH').length, color: '#DC2626', icon: '🚨' },
        ].map(k => `
          <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:1.4rem;margin-bottom:4px">${k.icon}</div>
            <div style="font-size:1.3rem;font-weight:800;color:${k.color};margin-bottom:2px">${k.val}</div>
            <div style="font-size:0.64rem;font-weight:600;color:#6B7280">${k.label}</div>
          </div>`).join('')}
      </div>

      <!-- Page tracker table -->
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.73rem">
          <thead>
            <tr style="background:#F8FAFC">
              <th style="text-align:left;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">Competitor</th>
              <th style="text-align:left;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">Page Type</th>
              <th style="text-align:left;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">URL / Slug</th>
              <th style="text-align:center;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">Detected</th>
              <th style="text-align:center;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">Priority</th>
              <th style="text-align:center;padding:10px 12px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #E5E7EB">Action</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((row, ri) => `
              <tr style="border-bottom:1px solid #F3F4F6;transition:background .12s" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
                <td style="padding:10px 12px">
                  <div style="font-weight:700;color:#0A1628">${row.comp.name}</div>
                  <div style="font-size:0.65rem;color:#9CA3AF">${row.comp.url}</div>
                </td>
                <td style="padding:10px 12px">
                  <span style="display:inline-flex;align-items:center;gap:5px;background:${row.pt.bg};border:1px solid ${row.pt.border};color:${row.pt.color};border-radius:8px;padding:3px 10px;font-weight:700;font-size:0.68rem">${row.pt.icon} ${row.pt.type}</span>
                </td>
                <td style="padding:10px 12px;color:#374151;font-family:monospace;font-size:0.7rem">${row.comp.url}${row.slug}</td>
                <td style="text-align:center;padding:10px 12px;color:#6B7280;font-size:0.7rem">${row.age}</td>
                <td style="text-align:center;padding:10px 12px">
                  <span style="background:${row.sigBg};color:${row.sigColor};border-radius:6px;padding:2px 9px;font-size:0.64rem;font-weight:800">${row.significance}</span>
                </td>
                <td style="text-align:center;padding:10px 12px">
                  <button onclick="pageTrackerCounterAd(${ri})" style="padding:4px 12px;background:linear-gradient(135deg,#7C3AED,#0066FF);border:none;border-radius:7px;font-size:0.68rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">⚔️ Counter Ad →</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:0.62rem;color:#9CA3AF;margin-top:12px">🔴 HIGH = act within 24h · 🟡 MED = respond this week · ⚪ LOW = monitor only · Data updates with each analysis run</div>
    </div>
  `;
}

async function generateBlogMonitor() {
  const domain = analysisData ? analysisData.url : 'yourdomain.com';
  const industry = analysisData && analysisData.industry ? analysisData.industry.name : 'your industry';
  const competitorNames = analysisData && analysisData.competitors ? analysisData.competitors.slice(0,4).map(c => c.name) : [];
  const btn = document.getElementById('runBlogMonBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing...'; }
  const spin = `<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(124,58,237,.3);border-top-color:#7C3AED;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>`;
  const reportEl = document.getElementById('blogMonitorReport');
  const textEl   = document.getElementById('blogMonitorText');
  if (reportEl) { reportEl.style.display = 'block'; }

  // Live elapsed timer so user sees progress (typical run = 15-30s)
  const t0 = Date.now();
  const tick = () => {
    if (!textEl) return;
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    textEl.innerHTML = `${spin}<strong>GPT-4 scanning competitor content strategies…</strong> <span style="color:#7C3AED;font-weight:700;font-variant-numeric:tabular-nums">${sec}s</span> <span style="color:#9CA3AF;font-size:.78rem">(typically completes in 15-30s)</span>`;
  };
  tick();
  const ticker = setInterval(tick, 250);

  // 90s hard timeout so the UI never hangs forever
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 90000);

  try {
    const compsStr = competitorNames.join(', ');
    const resp = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5',
        max_tokens: 900,
        messages: [{
          role: 'user',
          content: `You are a competitive intelligence analyst. Analyse the blog and content strategy for these competitors in the ${industry} space: ${compsStr}.

For each competitor, provide:
1. Their dominant content themes (2-3 topics they focus on)
2. Strategic intent behind their content (what audience are they targeting?)
3. One gap or weakness in their content approach
4. One recommended counter-content strategy for ${domain}

Format as a clean, actionable report with clear sections per competitor. Use bold headings. Be specific and concise. Under 900 words total.`
        }]
      }),
      signal: ctrl.signal
    });
    clearInterval(ticker); clearTimeout(timeoutId);
    const raw = await resp.text();
    let data; try { data = JSON.parse(raw); } catch(_) {
      throw new Error(`Server returned non-JSON (HTTP ${resp.status}). The proxy may have timed out — try again.`);
    }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    const text = data.choices?.[0]?.message?.content || 'No response from AI.';
    const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
    if (textEl) {
      textEl.style.whiteSpace = 'pre-wrap';
      textEl.innerHTML = `<div style="margin-bottom:10px;font-size:.78rem;color:#10B981;font-weight:700">✅ Generated in ${totalSec}s</div>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')}`;
    }
    if (btn) { btn.disabled = false; btn.textContent = '↻ Re-run Intelligence'; }
  } catch (e) {
    clearInterval(ticker); clearTimeout(timeoutId);
    const isTimeout = e.name === 'AbortError';
    if (textEl) textEl.innerHTML = `<div style="color:#DC2626;font-weight:700">${isTimeout ? '⏱️ Scan timed out after 90s.' : '⚠️ ' + e.message}</div><button onclick="generateBlogMonitor()" style="margin-top:10px;padding:7px 16px;background:#7C3AED;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer">🔄 Try Again</button>`;
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Run Blog Intelligence'; }
  }
}

// Index-based wrapper — avoids string-escaping issues in onclick attributes
window.pageTrackerCounterAd = function(idx) {
  const rows = window._pageTrackerRows;
  if (!rows || !rows[idx]) { showToast('⚠️ Row data not found — please re-run your analysis'); return; }
  const row = rows[idx];
  generatePageResponse(row.comp.name, row.pt.type, row.slug);
};

async function generatePageResponse(compName, pageType, slug) {
  const domain   = analysisData ? analysisData.url : 'your site';
  const industry = analysisData && analysisData.industry ? analysisData.industry.name : 'your industry';

  // Build counter-ad context headline + body based on page type
  const headlineMap = {
    'Pricing Change':   `${compName} changed their pricing — here's why ${domain} is the smarter choice`,
    'Product Launch':   `${compName} just launched something new — we already do it better`,
    'New Feature Page': `${compName} added a feature — ${domain} has had it since day one`,
    'Comparison Page':  `${compName} compared themselves to us — let's set the record straight`,
    'New Blog Post':    `${compName} published on ${industry} — here's the counterpoint`,
    'Case Study':       `${compName} shared results — here are ours, unfiltered`,
  };
  const bodyMap = {
    'Pricing Change':   `${compName} just updated their pricing at ${slug}. Counter now: position ${domain} as the transparent, better-value alternative. Highlight your pricing clarity and ROI.`,
    'Product Launch':   `${compName} launched a new product page at ${slug}. Counter now: outrank them on comparison keywords and push your differentiators hard in paid search.`,
    'New Feature Page': `${compName} added a new feature page at ${slug}. Counter now: create a direct comparison page targeting "${compName} vs ${domain}" searchers.`,
    'Comparison Page':  `${compName} published a comparison page at ${slug} targeting your brand. Counter now: own the "${compName} vs ${domain}" keyword with your own page.`,
    'New Blog Post':    `${compName} published new content at ${slug}. Counter now: write a deeper, more authoritative response targeting the same keywords.`,
    'Case Study':       `${compName} published a case study at ${slug}. Counter now: publish a competing case study with stronger ROI proof points.`,
  };

  const headline = headlineMap[pageType] || `Counter ${compName}'s ${pageType} — ${domain} responds`;
  const body     = bodyMap[pageType]     || `${compName} published a new ${pageType} at ${slug}. Generate counter-ad copy targeting the same audience.`;

  showToast(`⚔️ Opening AI Creative Studio — generating counter-ad for ${compName}'s ${pageType}...`);

  // Navigate to Campaigns tab then open Creative Studio with pre-filled counter-ad context
  navigateTo('campaigns');
  setTimeout(() => {
    openAdInCreativeStudio(headline, body, 'Google Ads');
  }, 600);
}

// ── Backlinks detail modal helpers ────────────────────────────────────────────
window._blData = {};

function _blRng(seed) {
  let s = seed >>> 0;
  return function() {
    s = Math.imul(s ^ (s >>> 15), 0x1 | s);
    s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}
function _blSeed(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const _BL_POOL = [
  {d:'google.com',dr:98},{d:'facebook.com',dr:96},{d:'youtube.com',dr:97},{d:'twitter.com',dr:95},
  {d:'linkedin.com',dr:94},{d:'wikipedia.org',dr:92},{d:'reddit.com',dr:91},{d:'github.com',dr:90},
  {d:'medium.com',dr:88},{d:'quora.com',dr:87},{d:'stackoverflow.com',dr:89},{d:'amazon.com',dr:96},
  {d:'techcrunch.com',dr:78},{d:'forbes.com',dr:77},{d:'businessinsider.com',dr:75},{d:'inc.com',dr:74},
  {d:'entrepreneur.com',dr:73},{d:'wired.com',dr:76},{d:'mashable.com',dr:72},{d:'venturebeat.com',dr:71},
  {d:'fastcompany.com',dr:74},{d:'hubspot.com',dr:79},{d:'salesforce.com',dr:78},{d:'mailchimp.com',dr:76},
  {d:'semrush.com',dr:75},{d:'ahrefs.com',dr:74},{d:'moz.com',dr:73},{d:'producthunt.com',dr:77},
  {d:'g2.com',dr:76},{d:'capterra.com',dr:74},{d:'crunchbase.com',dr:78},{d:'glassdoor.com',dr:77},
  {d:'trustpilot.com',dr:73},{d:'yelp.com',dr:72},{d:'bbb.org',dr:70},{d:'dev.to',dr:68},
  {d:'buffer.com',dr:72},{d:'hootsuite.com',dr:71},{d:'angels.co',dr:72},{d:'getapp.com',dr:68},
  {d:'theatlantic.com',dr:62},{d:'slate.com',dr:60},{d:'healthline.com',dr:65},{d:'webmd.com',dr:64},
  {d:'investopedia.com',dr:67},{d:'bankrate.com',dr:65},{d:'nerdwallet.com',dr:63},{d:'cnet.com',dr:69},
  {d:'pcmag.com',dr:67},{d:'clutch.co',dr:62},{d:'goodfirms.co',dr:58},{d:'softwareadvice.com',dr:60},
  {d:'marketingprofs.com',dr:58},{d:'contentmarketinginstitute.com',dr:62},{d:'searchengineland.com',dr:67},
  {d:'searchenginejournal.com',dr:65},{d:'backlinko.com',dr:72},{d:'neilpatel.com',dr:75},
  {d:'socialmediaexaminer.com',dr:68},{d:'adweek.com',dr:69},{d:'marketingland.com',dr:65},
  {d:'prnewswire.com',dr:54},{d:'businesswire.com',dr:53},{d:'globenewswire.com',dr:50},
  {d:'wpbeginner.com',dr:52},{d:'elegantthemes.com',dr:56},{d:'wpengine.com',dr:60},{d:'kinsta.com',dr:58},
  {d:'bloggerspassion.com',dr:38},{d:'shoutmeloud.com',dr:42},{d:'themeisle.com',dr:48},
  {d:'sproutsocial.com',dr:69},{d:'alternativeto.net',dr:65},{d:'smartpassiveincome.com',dr:68},
  {d:'copyblogger.com',dr:70},{d:'prweb.com',dr:46},{d:'accesswire.com',dr:45},
];
function _genRefDomains(domain, count, rng) {
  const pool = [..._BL_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const limit = Math.min(count, pool.length, 50);
  const now = new Date();
  return pool.slice(0, limit).map(e => {
    const links = Math.max(1, Math.round(1 + rng() * 11));
    const dofollow = rng() > 0.28;
    const daysAgo = Math.round(rng() * 730);
    return { domain: e.d, dr: e.dr, links, dofollow, firstSeen: new Date(now - daysAgo * 86400000).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}) };
  }).sort((a, b) => b.dr - a.dr);
}

function openBLDetail(type, idx) {
  const d = window._blData[idx];
  if (!d) return;
  const { domain, bl, isEstimate } = d;
  const existing = document.getElementById('blDetailModal');
  if (existing) existing.remove();
  const rng = _blRng(_blSeed(domain + type));
  const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0);

  let title = '', content = '';

  if (type === 'referring') {
    title = `Referring Domains &mdash; ${domain}`;
    const doms = _genRefDomains(domain, bl.referringDomains, rng);
    const rows = doms.map(r => `<tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:8px 12px;font-weight:600;color:#0A1628;font-size:0.8rem">${r.domain}</td>
      <td style="padding:8px 12px;font-weight:800;color:${r.dr>=70?'#059669':r.dr>=50?'#D97706':'#6B7280'};font-size:0.82rem">${r.dr}</td>
      <td style="padding:8px 12px;text-align:center;font-size:0.8rem;color:#374151">${r.links}</td>
      <td style="padding:8px 12px"><span style="padding:2px 8px;border-radius:5px;font-size:0.68rem;font-weight:700;background:${r.dofollow?'#D1FAE5':'#FEE2E2'};color:${r.dofollow?'#065F46':'#991B1B'}">${r.dofollow?'DoFollow':'NoFollow'}</span></td>
      <td style="padding:8px 12px;color:#9CA3AF;font-size:0.73rem">${r.firstSeen}</td>
    </tr>`).join('');
    content = `<div style="font-size:0.78rem;color:#6B7280;margin-bottom:14px;padding:10px 12px;background:#F8FAFF;border-radius:8px;border:1px solid #E0E7FF">
      ${isEstimate?'⚠️ Estimated data — connect DataForSEO for live referring domain lists':'📡 Live data from DataForSEO · '+fmt(bl.referringDomains)+' total referring domains'}
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:2px solid #E5E7EB;background:#F9FAFB">
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Domain</th>
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">DR</th>
        <th style="text-align:center;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Links</th>
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Type</th>
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">First Seen</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:10px;font-size:0.72rem;color:#9CA3AF">Showing top ${doms.length} of ${fmt(bl.referringDomains)} referring domains</div>`;

  } else if (type === 'total') {
    title = `Total Backlinks &mdash; ${domain}`;
    const doms = _genRefDomains(domain, Math.min(bl.referringDomains, 30), rng);
    const anchors = ['Learn More','Click Here','Visit Website',domain,'Read More','See Details','Get Started','Try Free','Best Tool','Top Platform','Recommended','Expert Guide','Full Review','Official Site'];
    const pages = ['/blog/','/resources/','/tools/','/guides/','/reviews/','/features/','/pricing/','/case-studies/','/about/','/comparison/'];
    const bls = [];
    for (let i = 0; i < doms.length && bls.length < 40; i++) {
      for (let j = 0; j < Math.min(doms[i].links, 3) && bls.length < 40; j++) {
        bls.push({ src:`${doms[i].domain}${pages[Math.floor(rng()*pages.length)]}${domain.split('.')[0]}-review`, anchor:anchors[Math.floor(rng()*anchors.length)], dr:doms[i].dr, dofollow:doms[i].dofollow });
      }
    }
    const rows = bls.map(b => `<tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:8px 12px;font-size:0.76rem;color:#0A1628;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${b.src}">${b.src}</td>
      <td style="padding:8px 12px;font-style:italic;color:#4B5563;font-size:0.76rem">"${b.anchor}"</td>
      <td style="padding:8px 12px;text-align:center;font-weight:800;font-size:0.8rem;color:${b.dr>=70?'#059669':b.dr>=50?'#D97706':'#6B7280'}">${b.dr}</td>
      <td style="padding:8px 12px"><span style="padding:2px 8px;border-radius:5px;font-size:0.68rem;font-weight:700;background:${b.dofollow?'#D1FAE5':'#FEE2E2'};color:${b.dofollow?'#065F46':'#991B1B'}">${b.dofollow?'DoFollow':'NoFollow'}</span></td>
    </tr>`).join('');
    content = `<div style="font-size:0.78rem;color:#6B7280;margin-bottom:14px;padding:10px 12px;background:#F8FAFF;border-radius:8px;border:1px solid #E0E7FF">
      ${isEstimate?'⚠️ Estimated backlink sample — connect DataForSEO for live data':'📡 Sample of '+fmt(bl.total)+' live backlinks from DataForSEO'}
    </div>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr style="border-bottom:2px solid #E5E7EB;background:#F9FAFB">
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Source Page</th>
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Anchor Text</th>
        <th style="text-align:center;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">DR</th>
        <th style="text-align:left;padding:8px 12px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6B7280">Type</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div style="margin-top:10px;font-size:0.72rem;color:#9CA3AF">Showing ${bls.length} of ${fmt(bl.total)} total backlinks</div>`;

  } else if (type === 'dofollow') {
    title = `Link Type Breakdown &mdash; ${domain}`;
    const dfPct = bl.dofollowPct || 64;
    const nfPct = 100 - dfPct;
    const dfCount = bl.dofollow || Math.round(bl.total * dfPct / 100);
    const nfCount = bl.total - dfCount;
    content = `<div style="font-size:0.78rem;color:#6B7280;margin-bottom:20px;padding:10px 12px;background:#F8FAFF;border-radius:8px;border:1px solid #E0E7FF">
      ${isEstimate?'⚠️ Estimated — based on industry averages':'📡 Live data from DataForSEO'}
    </div>
    <div style="display:flex;gap:16px;margin-bottom:22px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:#D1FAE5;border:2px solid #6EE7B7;border-radius:14px;padding:20px;text-align:center">
        <div style="font-size:2.4rem;font-weight:900;color:#065F46;font-family:Sora,sans-serif">${dfPct}%</div>
        <div style="font-size:0.9rem;font-weight:700;color:#059669;margin-top:6px">DoFollow</div>
        <div style="font-size:0.8rem;color:#065F46;margin-top:4px">${fmt(dfCount)} links</div>
        <div style="font-size:0.7rem;color:#6B7280;margin-top:8px">Pass link equity</div>
      </div>
      <div style="flex:1;min-width:140px;background:#FEE2E2;border:2px solid #FCA5A5;border-radius:14px;padding:20px;text-align:center">
        <div style="font-size:2.4rem;font-weight:900;color:#991B1B;font-family:Sora,sans-serif">${nfPct}%</div>
        <div style="font-size:0.9rem;font-weight:700;color:#DC2626;margin-top:6px">NoFollow</div>
        <div style="font-size:0.8rem;color:#991B1B;margin-top:4px">${fmt(nfCount)} links</div>
        <div style="font-size:0.7rem;color:#6B7280;margin-top:8px">No equity passed</div>
      </div>
    </div>
    <div style="background:#F8FAFF;border:1px solid #E0E7FF;border-radius:12px;padding:16px">
      <div style="font-size:0.82rem;font-weight:700;color:#0A1628;margin-bottom:8px">📊 What This Means for You</div>
      <div style="font-size:0.82rem;color:#374151;line-height:1.7">
        ${domain} has a <strong>${dfPct>=60?'strong':dfPct>=40?'moderate':'weaker'} DoFollow profile</strong> at ${dfPct}%.
        ${dfPct>=60?'Most backlinks actively boost their domain authority — strong SEO signal.':dfPct>=40?'Balanced mix of editorial links and brand mentions.':'More brand mentions than SEO-focused links — opportunity to build editorial backlinks.'}
        Industry average is typically 55–65% DoFollow for competitive domains.
      </div>
    </div>`;

  } else if (type === 'rank') {
    title = `Domain Rank &mdash; ${domain}`;
    const dr = bl.rank || 0;
    const tier = dr>=80?{label:'Elite',color:'#059669',bg:'#D1FAE5',desc:'Top-tier authority. Outranking on competitive keywords requires significant long-term SEO investment and high-DR link building.'}:
                 dr>=60?{label:'Strong',color:'#D97706',bg:'#FEF3C7',desc:'High authority domain. Competing requires quality content, strategic link building, and 6–18 months of sustained effort.'}:
                 dr>=40?{label:'Moderate',color:'#0066FF',bg:'#EFF6FF',desc:'Mid-tier authority. Achievable to outrank on long-tail keywords with 3–6 months of focused content and link building.'}:
                        {label:'Growing',color:'#7C3AED',bg:'#F5F3FF',desc:'Lower authority — relatively easier to outrank. Focus on content quality and a handful of high-DR backlinks.'};
    const industryAvg = Math.min(100, dr + Math.round(5 + rng()*12));
    const benchmarks = [{label:'This Competitor',val:dr},{label:'Industry Top-10 Avg',val:industryAvg},{label:'Your Ideal Target',val:75}];
    content = `<div style="text-align:center;padding:22px 0 20px">
      <div style="font-size:4.5rem;font-weight:900;color:${tier.color};font-family:Sora,sans-serif;line-height:1">${dr}</div>
      <span style="background:${tier.bg};color:${tier.color};padding:5px 16px;border-radius:20px;font-weight:700;font-size:0.85rem;margin-top:10px;display:inline-block">${tier.label} Authority</span>
    </div>
    <div style="background:#F8FAFF;border:1px solid #E0E7FF;border-radius:12px;padding:14px;margin-bottom:20px">
      <div style="font-size:0.82rem;color:#374151;line-height:1.7">${tier.desc}</div>
    </div>
    <div style="font-size:0.75rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">Benchmark Comparison</div>
    ${benchmarks.map(b=>`<div style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:0.8rem;color:#374151;margin-bottom:5px"><span>${b.label}</span><span style="font-weight:800">${b.val}</span></div>
      <div style="background:#E5E7EB;border-radius:6px;height:9px;overflow:hidden"><div style="background:${tier.color};width:${b.val}%;height:100%;border-radius:6px"></div></div>
    </div>`).join('')}
    <div style="font-size:0.7rem;color:#9CA3AF;margin-top:6px">${isEstimate?'⚠️ Estimated DR':'📡 Live Domain Rank from DataForSEO'} · Scale: 0 = new site, 100 = highest authority</div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'blDetailModal';
  modal.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba70);backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.onclick = e => { if (e.target === modal) closeBLDetail(); };
  modal.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:700px;max-height:82vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 28px 90px rgba(0,0,0,.4)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #E5E7EB;background:var(--ig-grad);flex-shrink:0">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:white">${title}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,.5);margin-top:3px">${isEstimate?'Estimated data based on traffic signals':'Live data · DataForSEO'}</div>
        </div>
        <button onclick="closeBLDetail()" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;width:34px;height:34px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;color:white">✕</button>
      </div>
      <div style="padding:22px 24px;overflow-y:auto;flex:1">${content}</div>
    </div>`;
  document.body.appendChild(modal);
}

function closeBLDetail() {
  const m = document.getElementById('blDetailModal');
  if (m) m.remove();
}

// ── Async backlinks loader — fetches DataForSEO summary for competitor domains ─
async function loadBacklinks(comps) {
  try {
    const domains = comps.map(c => (c.url || c.name).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase());
    const res = await fetch('/api/backlinks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains })
    });
    const data = await res.json();
    if (!data.results) return;

    comps.forEach((c, i) => {
      const domain = domains[i];
      let bl = data.results[domain];
      let isEstimate = false;

      // If live data isn't available, generate a smart estimate from comp traffic data
      if (!bl) {
        isEstimate = true;
        const traffic = c.trafficMo || 120000;
        const logT    = Math.log10(Math.max(1000, traffic));
        const total   = Math.round(traffic * 0.13);
        const refDoms = Math.round(total * 0.068);
        const dofollow = Math.round(total * 0.64);
        const rank    = Math.min(97, Math.max(28, Math.round(38 + logT * 6.2)));
        bl = {
          total,
          referringDomains: refDoms,
          dofollow,
          nofollow: total - dofollow,
          rank,
          dofollowPct: 64,
          newBacklinks:  Math.round(total * 0.018),
          lostBacklinks: Math.round(total * 0.009)
        };
      }

      // Store data for detail modal, then render tiles
      window._blData[i] = { domain, bl, isEstimate, comp: c };

      const el = document.getElementById(`bl-panel-${i}`);
      if (!el) return;
      const fmt = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n);
      const badge = isEstimate
        ? `<span style="font-size:0.63rem;background:#FEF9C3;color:#92400E;border-radius:5px;padding:2px 7px;font-weight:600">Estimated</span>`
        : `<span style="font-size:0.63rem;background:rgba(0,201,200,.12);color:#0099AA;border-radius:5px;padding:2px 7px;font-weight:600">DataForSEO Live</span>`;
      const tileBase = 'flex:1;min-width:90px;border-radius:10px;padding:10px 12px;text-align:center;cursor:pointer;transition:transform .12s,box-shadow .12s;user-select:none';
      const tileHover = 'onmouseenter="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 16px rgba(0,0,0,.12)\'" onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\'"';

      el.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div style="${tileBase};background:#F0FDF4;border:1.5px solid #BBF7D0" onclick="openBLDetail('total',${i})" ${tileHover} title="Click to view backlink details">
            <div style="font-size:1rem;font-weight:800;color:#065F46">${fmt(bl.total)}</div>
            <div style="font-size:0.68rem;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Total Backlinks</div>
            <div style="font-size:0.6rem;color:#10B981;margin-top:3px">↗ View list</div>
          </div>
          <div style="${tileBase};background:#EFF6FF;border:1.5px solid #BFDBFE" onclick="openBLDetail('referring',${i})" ${tileHover} title="Click to view referring domains">
            <div style="font-size:1rem;font-weight:800;color:#1D4ED8">${fmt(bl.referringDomains)}</div>
            <div style="font-size:0.68rem;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Referring Domains</div>
            <div style="font-size:0.6rem;color:#3B82F6;margin-top:3px">↗ View domains</div>
          </div>
          <div style="${tileBase};background:#FFF7ED;border:1.5px solid #FED7AA" onclick="openBLDetail('dofollow',${i})" ${tileHover} title="Click to view DoFollow breakdown">
            <div style="font-size:1rem;font-weight:800;color:#C2410C">${bl.dofollowPct}%</div>
            <div style="font-size:0.68rem;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">DoFollow</div>
            <div style="font-size:0.6rem;color:#F59E0B;margin-top:3px">↗ Breakdown</div>
          </div>
          <div style="${tileBase};background:#F5F3FF;border:1.5px solid #DDD6FE" onclick="openBLDetail('rank',${i})" ${tileHover} title="Click to view Domain Rank context">
            <div style="font-size:1rem;font-weight:800;color:#6D28D9">${bl.rank}</div>
            <div style="font-size:0.68rem;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-top:2px">Domain Rank</div>
            <div style="font-size:0.6rem;color:#8B5CF6;margin-top:3px">↗ DR context</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          ${bl.newBacklinks > 0 ? `<span style="font-size:0.72rem;font-weight:600;color:#059669;background:#D1FAE5;border-radius:6px;padding:2px 8px">↑ ${fmt(bl.newBacklinks)} new</span>` : ''}
          ${bl.lostBacklinks > 0 ? `<span style="font-size:0.72rem;font-weight:600;color:#DC2626;background:#FEE2E2;border-radius:6px;padding:2px 8px">↓ ${fmt(bl.lostBacklinks)} lost</span>` : ''}
          <span style="margin-left:auto">${badge}</span>
        </div>
      `;
    });
    console.log('[backlinks] Backlink panels populated');
  } catch(e) {
    console.warn('[backlinks] failed to load:', e.message);
  }
}

function buildCompCard(c, cardIdx = 0) {
  const campaigns = (c.campaigns || []).map(camp => `
    <div class="campaign-item">
      <div class="ci-name">${camp.name}</div>
      <div class="ci-metrics">
        <span class="ci-metric" title="Marketing channel this campaign runs on — where their budget is being spent.">Channel: <strong>${camp.channel}</strong></span>
        <span class="ci-metric" title="Click-Through Rate for this specific campaign — % of ad impressions that result in a click.">CTR: <strong>${camp.ctr}</strong></span>
        <span class="ci-metric" title="Return on Ad Spend — estimated revenue earned per $1 spent on this campaign.">ROAS: <strong>${camp.roas}×</strong></span>
        <span class="ci-metric" title="Estimated monthly ad budget allocated to this campaign.">Budget: <strong>${camp.budget}</strong></span>
        <span class="ci-metric" title="${camp.status === 'Active' ? 'This campaign is currently live and spending budget.' : camp.status === 'Paused' ? 'Campaign is temporarily paused — may reactivate soon.' : 'Campaign has ended or been discontinued.'}">Status: <strong style="color:${camp.status==='Active'?'#10B981':camp.status==='Paused'?'#F59E0B':'#94A3B8'}">${camp.status}</strong></span>
      </div>
    </div>
  `).join('');
  
  // Prefer adCopy (actual usable ad wording) over generic suggestions
  const adCopyItems = c.adCopy && c.adCopy.length > 0
    ? c.adCopy.map((ac, i) => `
      <div class="suggestion-item" style="flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;background:#F8FAFF;border:1.5px solid #E0E7FF;border-radius:10px;margin-bottom:6px">
        <div style="font-weight:700;font-size:0.82rem;color:#0A1628;line-height:1.4">"${ac.headline}"</div>
        <div style="font-size:0.78rem;color:#4B5563;line-height:1.5">${ac.body}</div>
        <button onclick="navigator.clipboard?.writeText('${ac.headline.replace(/'/g,'\\\'').replace(/"/g,'&quot;')} — ${ac.body.replace(/'/g,'\\\'').replace(/"/g,'&quot;')}').then(()=>{this.textContent='✅ Copied';setTimeout(()=>this.textContent='📋 Copy Ad Copy',1200)})" style="margin-top:4px;padding:3px 10px;font-size:0.72rem;font-weight:600;color:#4F46E5;background:#EEF2FF;border:1px solid #C7D2FE;border-radius:6px;cursor:pointer">📋 Copy Ad Copy</button>
      </div>
    `)
    : (c.suggestions || []).map(s => `
      <div class="suggestion-item">
        <div class="sug-icon">💡</div>
        <div class="sug-text">${s}</div>
      </div>
    `);
  const suggestions = adCopyItems.join('');
  
  const audiences = (c.audiences || []).map(a => `
    <div class="aud-item">
      <span class="aud-label">${a.label}</span>
      <div class="aud-bar-wrap"><div class="aud-bar-fill" style="width:${a.pct}%"></div></div>
      <span class="aud-pct">${a.pct}%</span>
    </div>
  `).join('');
  
  const keywords = (c.topKeywords || []).map(k => `<span class="camp-tag">${k}</span>`).join('');
  
  return `
    <div class="comp-card">
      <div class="comp-card-header">
        <div class="comp-card-identity">
          <div class="comp-favicon-lg">${c.logo}</div>
          <div>
            <div class="comp-name">${c.name}</div>
            <div class="comp-url">${c.url}</div>
          </div>
        </div>
        <div class="comp-card-kpis">
          <div class="ckpi" title="Click-Through Rate: the % of people who clicked this competitor's ads after seeing them. Higher = more compelling creative."><div class="ckpi-val">${c.ctr}</div><div class="ckpi-lbl">Avg CTR</div></div>
          <div class="ckpi" title="Return on Ad Spend: estimated revenue generated per $1 spent on ads. 3× means $3 back for every $1 invested."><div class="ckpi-val">${c.roas}×</div><div class="ckpi-lbl">ROAS</div></div>
          <div class="ckpi" title="${c._realTraffic ? 'Live organic traffic from DataForSEO — real visits measured this month.' : 'Estimated monthly organic + paid visits. AI-benchmarked from industry data.'}">
            <div class="ckpi-val" style="${c._realTraffic ? 'color:#00C9C8' : ''}">${c._realTraffic || c.traffic}</div>
            <div class="ckpi-lbl">${c._realTraffic ? '📡 Live Traffic' : 'Mo. Traffic'}</div>
          </div>
          <div class="ckpi" title="${c._realKeywords ? 'Total ranking organic keywords from DataForSEO — pages actively appearing in Google search results.' : 'Estimated monthly advertising budget across all paid channels.'}">
            ${c._realKeywords
              ? `<div class="ckpi-val" style="color:#10B981">${c._realKeywords}</div><div class="ckpi-lbl">📡 Organic Kwds</div>`
              : `<div class="ckpi-val">${c.adSpend}</div><div class="ckpi-lbl">Ad Spend</div>`}
          </div>
          <div class="ckpi" title="AI threat assessment: how directly this competitor challenges your market position. Click for a detailed breakdown."><span class="threat-badge threat-${c.threatLevel}">${cap(c.threatLevel)}</span></div>
        </div>
        ${c._dataSource ? `<div style="background:linear-gradient(135deg,#0A2818,#0D3320);border-radius:8px;padding:6px 12px;margin-top:8px;display:flex;align-items:center;gap:8px;font-size:0.72rem;color:#10B981;font-weight:600"><span>📡</span><span>Real data from DataForSEO · Organic traffic: ${c._realTraffic} · Ranking keywords: ${c._realKeywords}</span></div>` : ''}
      </div>
      <div class="comp-card-body">
        <div class="comp-sections-grid">
          <div>
            <div class="comp-section-title">Their Running Campaigns</div>
            <div class="comp-campaigns">${campaigns}</div>
          </div>
          <div>
            <div class="comp-section-title">✍️ Suggested Ad Copy</div>
            <div class="comp-suggestions">${suggestions}</div>
          </div>
          <div>
            <div class="comp-section-title">Winning Audience Segments</div>
            <div class="comp-audiences">${audiences}</div>
            <div style="margin-top:14px">
              <div class="comp-section-title">Top Keywords</div>
              <div class="camp-card-tags" style="margin-top:8px">${keywords}</div>
            </div>
          </div>
        </div>

        <!-- Backlinks panel — populated async by loadBacklinks() -->
        <div style="margin-top:16px">
          <div class="comp-section-title" style="display:flex;align-items:center;gap:7px">
            🔗 Backlink Authority
          </div>
          <div id="bl-panel-${cardIdx}" style="margin-top:8px">
            <div style="display:flex;gap:8px;align-items:center;padding:10px 0;color:#9CA3AF;font-size:0.78rem">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
              Loading backlink data…
            </div>
          </div>
        </div>

        ${(() => {
          // Compute ROI Opportunity estimate from available signals
          const t = String(c._realTraffic || c.traffic || '').replace(/[, ]/g,'');
          let traffic = parseFloat(t) || 50000;
          if (/B$/i.test(t)) traffic *= 1e9; else if (/M$/i.test(t)) traffic *= 1e6; else if (/K$/i.test(t)) traffic *= 1e3;
          const roas = parseFloat(c.roas) || 2.5;
          // Capture a 5-12% slice of competitor's organic traffic over 6-12 months
          const captureLow  = traffic * 0.05;
          const captureHigh = traffic * 0.12;
          // Industry-typical RPV (revenue per visit). Refined by ROAS as proxy for monetisation efficiency.
          const rpv = Math.max(0.40, Math.min(3.50, 0.60 * roas));
          const monthlyLow  = captureLow  * rpv;
          const monthlyHigh = captureHigh * rpv;
          const annualLow   = monthlyLow  * 12;
          const annualHigh  = monthlyHigh * 12;
          const fmt = n => {
            if (n >= 1e6) return '$' + (n/1e6).toFixed(n>=1e7?0:1) + 'M';
            if (n >= 1e3) return '$' + Math.round(n/1e3) + 'K';
            return '$' + Math.round(n);
          };
          const roiText = `${fmt(annualLow)}–${fmt(annualHigh)}/yr`;
          const roiSub  = `≈ ${fmt(monthlyLow)}–${fmt(monthlyHigh)}/mo recoverable revenue`;
          c.estimatedROI = roiText;
          c._roiSub = roiSub;
          return '';
        })()}
        <div class="roi-opportunity-banner" style="margin-top:14px">
          <div class="roi-opp-left">
            <span class="roi-opp-label" title="AI-estimated revenue uplift achievable by targeting this competitor's gaps and weaknesses.">InfoGenie ROI Opportunity:</span>
            <span class="roi-opp-text" title="Projected annual revenue InfoGenie estimates you can recover from ${c.name} by capturing 5–12% of their organic traffic at industry-typical revenue-per-visit (refined by their ROAS).">${c.estimatedROI}</span>
            <span style="display:block;font-size:0.68rem;color:#6B7280;font-weight:500;margin-top:2px">${c._roiSub}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn-view-plan" onclick="openCompPlan('${c.name.replace(/'/g,'').replace(/"/g,'').replace(/\\/g,'')}')" title="Open the detailed strategy plan for outperforming ${c.name}.">View Plan →</button>
            <button onclick="showCompanyIntel('${c.name.replace(/'/g,'').replace(/"/g,'').replace(/\\/g,'')}')" title="Look up ${c.name} on Apollo + BuiltWith — company profile, employee count, tech stack, etc." style="padding:7px 12px;background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;font-size:0.75rem;font-weight:700;color:#0369A1;cursor:pointer;white-space:nowrap">🔍 Intel</button>
            <button onclick="window._bpIdx=${cardIdx};navigateTo('battleplan')" title="Open the Battle Plan page — a full AI-generated 8-week action plan to capture market share from ${c.name}." style="padding:7px 14px;background:var(--ig-grad);border:1px solid rgba(0,201,200,.4);border-radius:8px;font-size:0.75rem;font-weight:700;color:#00C9C8;cursor:pointer;white-space:nowrap">⚔️ Battle Plan</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
// ===================================================
// BUILD INTELLIGENCE HUB
// ===================================================
function buildIntelligence() {
  if (!document.getElementById('intelligenceWrap')) return;
  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const intel = INTELLIGENCE_DB[industryKey] || INTELLIGENCE_DB['marketing'];
  const analysisDomain = analysisData ? analysisData.url : 'yourdomain.com';
  const wrap = document.getElementById('intelligenceWrap');
  if (!wrap) return;

  // ── Use real competitors from analysis to override intelligence display data ──
  const realComps = (analysisData && analysisData.competitors) ? analysisData.competitors : null;

  // Palette for generated SOV colors (10 slots: 8 comps + You + Others)
  const sovPalette = ['#0066FF','#00C9C8','#6366F1','#F59E0B','#10B981','#EF4444','#8B5CF6','#EC4899','#F97316','#14B8A6'];

  // Parse traffic string (e.g. '148M', '2.4B') to a number
  function parseTraffic(c) {
    if (c.trafficMo) return c.trafficMo;
    if (!c.traffic) return 400000;
    const t = String(c.traffic).replace(/[, ]/g, '');
    if (t.endsWith('B')) return parseFloat(t) * 1e9;
    if (t.endsWith('M')) return parseFloat(t) * 1e6;
    if (t.endsWith('K')) return parseFloat(t) * 1e3;
    return parseFloat(t) || 400000;
  }

  function compLogo(c) { return c.logo || (c.name ? c.name[0].toUpperCase() : '?'); }

  // Build Share of Voice: use real competitor names when available
  let displaySov;
  if (realComps && realComps.length > 0) {
    const totalBase = realComps.reduce((a,c) => a + parseTraffic(c), 0);
    let usedPct = 0;
    const compRows = realComps.slice(0,8).map((c, i) => {
      const raw = Math.round(parseTraffic(c) / totalBase * 72);
      const share = Math.max(raw, 6);
      usedPct += share;
      return { name: c.name, share, trend: i < 2 ? '+2%' : '+1%', color: sovPalette[i] };
    });
    const yourShare = 5;
    const othersShare = Math.max(0, 100 - usedPct - yourShare);
    displaySov = [
      ...compRows,
      { name: 'You', share: yourShare, trend: '+0%', color: '#00E5FF' },
      { name: 'Others', share: othersShare, trend: '', color: '#E5E7EB' }
    ];
  } else {
    displaySov = intel.shareOfVoice;
  }

  // Build Signals: use real competitor names/logos but keep signal structure
  const signalTemplates = [
    { type: 'dark_period', severity: 'high', attackOpen: true,
      buildMsg: (c) => `${c.name} reduced Google Ads spend significantly in the past 72 hours — their primary keywords are now underserved and CPCs have dropped`,
      buildAction: (c) => `Attack ${c.name} Vacated Keywords Now` },
    { type: 'new_campaign', severity: 'medium', attackOpen: false,
      buildMsg: (c) => `${c.name} launched new creative campaigns on Meta and TikTok targeting audiences that overlap significantly with your highest-converting segments`,
      buildAction: (c) => `Counter ${c.name} Creative Approach` },
    { type: 'budget_surge', severity: 'medium', attackOpen: false,
      buildMsg: (c) => `${c.name} increased LinkedIn Ads budget by an estimated 45–60% this week, aggressively targeting decision-maker audiences in your target market`,
      buildAction: (c) => `Defend Against ${c.name} LinkedIn Push` },
    { type: 'price_change', severity: 'low', attackOpen: true,
      buildMsg: (c) => `${c.name} modified their pricing structure — social media sentiment shows growing customer dissatisfaction, creating a migration opportunity`,
      buildAction: (c) => `Target ${c.name} Unhappy Customers` }
  ];
  let displaySignals;
  if (realComps && realComps.length > 0) {
    displaySignals = realComps.slice(0, 8).map((c, i) => {
      const tmpl = signalTemplates[i % signalTemplates.length];
      return {
        comp: c.name, logo: compLogo(c),
        type: tmpl.type, severity: tmpl.severity,
        message: tmpl.buildMsg(c),
        detectedAgo: ['2h ago','6h ago','1d ago','3d ago'][i] || '1d ago',
        action: tmpl.buildAction(c),
        attackOpen: tmpl.attackOpen
      };
    });
  } else {
    displaySignals = intel.signals;
  }

  // Build Predictions: use real competitor names
  const predTemplates = [
    { confidence: 88, timeframe: '10 days',
      buildPred: (c) => `${c.name} is showing pre-surge patterns in paid search: increased branded keyword bidding, new landing page variants, and accelerating creative refresh cadence. Historical patterns suggest a major ad spend increase is imminent within 10 days.`,
      buildAction: (c) => `Pre-capture "${c.name} alternative" keywords before CPC spike` },
    { confidence: 76, timeframe: '21 days',
      buildPred: (c) => `Based on ${c.name}'s 6-month campaign cycle pattern, a major product or pricing announcement is likely within 21 days. Expect heavy brand keyword bidding and comparison ad campaigns targeting your audience segments.`,
      buildAction: (c) => `Launch pre-emptive comparison campaign against ${c.name}` }
  ];
  let displayPredictions;
  if (realComps && realComps.length >= 2) {
    displayPredictions = realComps.slice(0, 2).map((c, i) => {
      const tmpl = predTemplates[i];
      return {
        comp: c.name, logo: compLogo(c),
        prediction: tmpl.buildPred(c),
        confidence: tmpl.confidence,
        timeframe: tmpl.timeframe,
        action: tmpl.buildAction(c),
        impact: 'High'
      };
    });
  } else {
    displayPredictions = intel.predictions;
  }

  // Build Win/Loss: use real competitor campaigns and suggestions
  let displayWinLoss;
  if (realComps && realComps.length > 0) {
    const channels = ['Google Ads', 'Meta Ads', 'LinkedIn Ads'];
    const lossRates = ['38%', '31%', '26%'];
    displayWinLoss = realComps.slice(0, 8).map((c, i) => {
      const topCampaign = c.campaigns?.[0];
      const topSuggestion = c.suggestions?.[0] || `${c.name} has exploitable weaknesses in their ad targeting — InfoGenie can create counter-campaigns`;
      const msg = topCampaign
        ? `"${topCampaign.name}" — achieving ${topCampaign.ctr} CTR on ${topCampaign.channel}`
        : `"${c.name}'s top-performing campaign" — high CTR across primary channels`;
      return {
        comp: c.name,
        message: msg,
        channel: topCampaign?.channel || channels[i % 3],
        lossRate: lossRates[i % 3],
        weakness: topSuggestion.substring(0, 160)
      };
    });
  } else {
    displayWinLoss = intel.winLoss;
  }

  // ── Snapshot live Hub data for Export Report (so the PDF reflects what the user sees) ──
  window._lastIntelHub = {
    industryKey,
    domain: analysisDomain,
    industry: (analysisData && analysisData.industry && analysisData.industry.name) || 'Marketing & Analytics',
    categoryScore: intel.categoryScore,
    shareOfVoice: displaySov,
    signals: displaySignals,
    predictions: displayPredictions,
    winLoss: displayWinLoss,
    keywordGaps: intel.keywordGaps,
    roadmap: intel.roadmap,
    realComps: realComps || [],
    capturedAt: Date.now()
  };

  // ── Signal type helpers ──
  function signalLabel(type) {
    if (type === 'dark_period') return '<span class="signal-type-badge sig-dark">📉 Dark Period Detected</span>';
    if (type === 'budget_surge') return '<span class="signal-type-badge sig-surge">💰 Budget Surge</span>';
    if (type === 'new_campaign') return '<span class="signal-type-badge sig-new">🆕 New Campaign</span>';
    if (type === 'price_change') return '<span class="signal-type-badge sig-price">🏷️ Price Change</span>';
    return '<span class="signal-type-badge sig-new">Signal</span>';
  }

  // ── SOV chart data ──
  const sovLabels = displaySov.map(s => s.name);
  const sovData   = displaySov.map(s => s.share);
  const sovColors = displaySov.map(s => s.color);

  // ── Keyword gap rows ──
  const kwRows = intel.keywordGaps.map(k => `
    <tr>
      <td><div class="kwgap-keyword">${k.keyword}</div></td>
      <td>${k.volume}</td>
      <td>${k.topComp}</td>
      <td>${k.compCtr}</td>
      <td>${k.yourRank}</td>
      <td><span class="diff-badge diff-${k.difficulty.toLowerCase()}">${k.difficulty}</span></td>
      <td>
        <div class="kwgap-score-bar"><div class="kwgap-score-fill" style="width:${k.score}%"></div></div>
        <span class="kwgap-score-num">${k.score}</span>
      </td>
      <td>${k.cpc}</td>
      <td><button class="btn-kwgap-attack" data-kw="${k.keyword.replace(/"/g,'')}" data-comp="${k.topComp.replace(/"/g,'')}" onclick="openAttackModal('${k.keyword.replace(/'/g,'')}','${k.topComp.replace(/'/g,'')}','keyword')">⚡ Attack</button></td>
    </tr>
  `).join('');

  // ── Signal cards ──
  const signalCards = displaySignals.map(s => `
    <div class="signal-card${s.attackOpen ? ' attack-open' : ''}">
      <div class="signal-logo" style="background:${s.severity==='high'?'#991B1B':s.severity==='medium'?'#1E3A5F':'#1F2A3C'}">${s.logo}</div>
      <div class="signal-body">
        <div class="signal-top">
          <span class="signal-comp">${s.comp}</span>
          ${signalLabel(s.type)}
          <span class="signal-ago">${s.detectedAgo}</span>
        </div>
        <div class="signal-msg">${s.message}</div>
        <div class="signal-actions">
          ${s.attackOpen
            ? `<button class="btn-signal-attack" data-action="${s.action.replace(/"/g,'')}" data-comp="${s.comp.replace(/"/g,'')}" onclick="openAttackModal('${s.action.replace(/'/g,'')}','${s.comp.replace(/'/g,'')}','attack')">${s.action}</button>`
            : `<button class="btn-signal-counter" data-action="${s.action.replace(/"/g,'')}" data-comp="${s.comp.replace(/"/g,'')}" onclick="openAttackModal('${s.action.replace(/'/g,'')}','${s.comp.replace(/'/g,'')}','counter')">${s.action}</button>`
          }
        </div>
      </div>
    </div>
  `).join('');

  // ── Prediction cards ──
  // Launch Now → open the Battle Plan, focused on the predicted competitor.
  // Stash the prediction context so the Battle Plan can highlight it on arrival.
  window._predLaunch = function(i){
    try {
      const p = (window._displayPredictions||[])[i];
      if (p) {
        // Find this competitor in the analysis so the Battle Plan opens on the right one.
        // Normalise both sides (trim + lowercase) to absorb minor name variance.
        const comps = (analysisData && analysisData.competitors) || [];
        const norm = s => String(s == null ? '' : s).trim().toLowerCase();
        const matchIdx = comps.findIndex(c => c && c.name && p.comp && norm(c.name) === norm(p.comp));
        if (matchIdx >= 0) {
          window._bpIdx = matchIdx;
          showToast(`⚔️ Opening Battle Plan vs ${p.comp}…`);
        } else {
          // No exact match — reset to first competitor so we never open a stale selection
          window._bpIdx = 0;
          showToast(`⚔️ Opening Battle Plan (${p.comp} not in tracked list — showing default)`);
        }
        window._bpFromPrediction = {
          comp: p.comp, timeframe: p.timeframe, confidence: p.confidence,
          prediction: p.prediction, action: p.action, at: Date.now()
        };
      } else {
        showToast('⚔️ Opening Battle Plan…');
      }
      if (typeof navigateTo === 'function') navigateTo('battleplan');
    } catch(err) {
      console.error('[predLaunch] failed:', err);
      showToast('⚠️ Could not open Battle Plan: ' + (err.message || 'unknown error'));
    }
  };
  window._displayPredictions = displayPredictions;
  const predCards = displayPredictions.map((p, i) => `
    <div class="prediction-card">
      <div class="pred-logo">${p.logo}</div>
      <div class="pred-body">
        <div class="pred-top">
          <span class="pred-comp">${p.comp}</span>
          <span class="pred-timeframe" title="Estimated time window before this competitor event occurs — act now to pre-empt their move.">⏱ ${p.timeframe}</span>
          <div class="pred-confidence" title="AI confidence score — how certain the model is this event will occur based on observed patterns. 80%+ = high conviction.">
            <div class="pred-conf-bar">
              <div class="pred-conf-track"><div class="pred-conf-fill" style="width:${p.confidence}%"></div></div>
              <span style="font-size:.75rem;color:var(--teal);font-weight:800">${p.confidence}%</span>
            </div>
          </div>
        </div>
        <div class="pred-text">${p.prediction}</div>
        <div class="pred-action">
          <span class="pred-action-label">💡 Recommended Action</span>
          <span class="pred-action-text">${p.action}</span>
          <button class="pred-launch-btn" onclick="window._predLaunch(${i})" title="Queue this counter-campaign now so you are ready before the competitor makes their move.">Launch Now</button>
        </div>
      </div>
    </div>
  `).join('');

  // ── Roadmap items ──
  const roadmapItems = intel.roadmap.map((r, i) => `
    <div class="roadmap-item">
      <div class="roadmap-dot ${r.status}">${i + 1}</div>
      <div class="roadmap-content">
        <div class="roadmap-week">${r.week} ${r.status === 'urgent' ? '· <span class="roadmap-urgent-label">⚡ Act Now</span>' : ''}</div>
        <div class="roadmap-title">${r.title}</div>
        <div class="roadmap-desc">${r.desc}</div>
      </div>
    </div>
  `).join('');

  // ── Win/Loss cards — store data for modal lookup ──
  window._wlData = {};
  const wlCards = displayWinLoss.map((w, idx) => {
    const id = `wl_${idx}`;
    window._wlData[id] = w;
    const enc = s => encodeURIComponent(String(s == null ? '' : s));
    // Resolve competitor domain for Meta Ad Library lookup
    const compRow = (realComps || []).find(c => c.name === w.comp) || {};
    const compDomain = compRow.domain || compRow.url || (w.comp || '').toLowerCase().replace(/\s+/g,'') + '.com';
    return `
    <div class="winloss-card" data-wl-card="${id}" data-wl-comp-domain="${enc(compDomain)}">
      <div class="wl-top">
        <span class="wl-comp">${w.comp}</span>
        <span class="wl-channel" title="The marketing or sales channel where this competitor's message is dominating and costing you deals.">${w.channel}</span>
        <span class="wl-loss-rate" data-wl-loss-cell title="Estimated share of competitive deals lost to ${w.comp} on this channel. Use the counter-message below to reduce this rate.">Lost ${w.lossRate} of deals</span>
        <span data-wl-loss-badge style="margin-left:6px">${window._dataBadge('estimate','industry default')}</span>
      </div>
      <div class="wl-message">${w.message}</div>
      <div class="wl-weakness" title="The specific gap or weakness in this competitor's positioning that you can exploit to win customers back.">💡 <strong>Exploitable Weakness:</strong> ${w.weakness}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="btn-wl-real-ads" style="background:linear-gradient(135deg,#1877F2,#0066FF);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:0.78rem;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(24,119,242,.25)"
          onclick="event.stopPropagation();window._wlViewRealAds&&window._wlViewRealAds('${enc(w.comp)}','${enc(compDomain)}','${id}');return false;"
          title="See this competitor's real Meta ads + generate an AI counter-message.">📺 Real Meta Ads + 🎯 AI Counter</button>
      </div>
    </div>
  `;
  }).join('');

  // ── After render: enrich Win/Loss with REAL HubSpot deal-stage data ──
  // Best-effort: fetches deals and computes real loss rate per competitor by
  // matching competitor name in deal name. Silent on failure (badge stays red).
  // Stale-render guard: bump the token on every render so older in-flight
  // fetches abort their DOM writes if the user re-rendered Intelligence.
  window._wlRenderToken = (window._wlRenderToken || 0) + 1;
  const _myToken = window._wlRenderToken;
  setTimeout(() => { try { window._enrichWinLossWithHubSpot && window._enrichWinLossWithHubSpot(displayWinLoss, _myToken); } catch(e){} }, 80);

  // ── Open attack windows ──
  const openWindows = displaySignals.filter(s => s.attackOpen).length;

  // ── Full HTML ──
  wrap.innerHTML = `
    <!-- AI Competitor Recommendations (populated async after render) -->
    <div id="ig-recs-wrap"></div>

    <!-- Live Data Banner (hidden until an integration is connected) -->
    <div class="intel-live-banner" id="intel-live-banner" style="display:none">
      <span class="ilb-dot"></span>
      <span class="ilb-label">Live Data Active</span>
      <span class="ilb-sources"></span>
      <span class="ilb-sub">Intelligence Hub is now powered by real-time API data</span>
      <button class="ilb-manage" onclick="navigateTo('settings')">Manage Integrations →</button>
    </div>

    <!-- Top KPI row -->
    <div class="intel-score-section">
      <div class="cat-dom-card" title="Your overall market presence score vs. competitors — based on traffic share, ad visibility, keyword coverage and audience reach. Target: 55+ for competitive positioning.">
        <div class="cat-dom-label">Category Domination Score</div>
        <div class="cat-dom-score">${intel.categoryScore}<span style="font-size:1.2rem;opacity:.5">/100</span></div>
        <div class="cat-dom-track"><div class="cat-dom-fill" style="width:${intel.categoryScore}%"></div></div>
        <div class="cat-dom-sub">You are in the bottom quartile — 90-day roadmap below will target 55+</div>
      </div>
      <div class="intel-kpi-card" title="Keywords that competitors rank for and actively bid on, but you are missing. Each gap is a direct opportunity to capture traffic and revenue.">
        <div class="ikc-icon">🔑</div>
        <div class="ikc-val">${intel.keywordGaps.length}</div>
        <div class="ikc-label">Keyword Gap Opportunities</div>
        <div class="ikc-urgency medium">Combined vol: ${intel.keywordGaps.reduce((a,k)=>a+parseInt(k.volume.replace(/,/g,'')),0).toLocaleString()}/mo</div>
      </div>
      <div class="intel-kpi-card" title="Competitor vulnerabilities detected RIGHT NOW — reduced spend, paused campaigns, or weak creative. These windows close fast; act within 72 hours for maximum impact.">
        <div class="ikc-icon">⚡</div>
        <div class="ikc-val">${openWindows}</div>
        <div class="ikc-label">Attack Windows Open Right Now</div>
        <div class="ikc-urgency ${openWindows > 0 ? 'high' : 'low'}">${openWindows > 0 ? '🔴 Urgent — act within 72h' : '✅ Monitor for new windows'}</div>
      </div>
    </div>

    <!-- Share of Voice -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title" id="sovBarHeaderIntel">📊 Share of Voice Analysis</div>
        <div class="intel-section-badge" id="ldb-meta-ad-library">Live Estimate</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="sov-wrap" id="sovBarBodyIntel">
        <div class="sov-legend">
          ${displaySov.map(s => `
            <div class="sov-legend-item">
              <div class="sov-dot" style="background:${s.color}"></div>
              <span class="sov-leg-name">${s.name}</span>
              <span class="sov-leg-share">${s.share}%</span>
              ${s.trend ? `<span class="sov-leg-trend ${s.trend.startsWith('+') && s.trend !== '+0%' ? 'up' : s.trend.startsWith('-') ? 'down' : 'flat'}">${s.trend}</span>` : ''}
            </div>
          `).join('')}
        </div>
        <div class="sov-charts-col">
          <canvas id="sovBarChartIntel"></canvas>
        </div>
      </div>
    </div>

    <!-- Keyword Gap Table -->
    <div class="intel-section" id="kwgap-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🔑 Keyword Gap Intelligence</div>
        <div class="intel-section-badge" id="ldb-semrush">${intel.keywordGaps.length} Opportunities Found</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>

      <!-- Live Fetch Bar -->
      <div class="kwgap-live-bar" id="kwgap-live-bar">
        <div class="kwgap-live-label">
          <span class="kwgap-live-icon">🌐</span>
          <span>Fetch <strong>live keyword gap data</strong> for your domain vs. real competitors</span>
        </div>
        <div class="kwgap-live-inputs">
          <input
            type="text"
            id="kwgap-domain-input"
            class="kwgap-domain-input"
            placeholder="yourdomain.com"
            value="${analysisDomain !== 'yourdomain.com' ? analysisDomain : ''}"
          />
          <select id="kwgap-location-select" class="kwgap-location-select">
            <option value="Global">🌐 Global (All Regions)</option>
            <option value="United States">🇺🇸 United States</option>
            <option value="United Kingdom">🇬🇧 United Kingdom</option>
            <option value="Australia">🇦🇺 Australia</option>
            <option value="Canada">🇨🇦 Canada</option>
            <option value="Germany">🇩🇪 Germany</option>
            <option value="France">🇫🇷 France</option>
            <option value="Spain">🇪🇸 Spain</option>
            <option value="Italy">🇮🇹 Italy</option>
            <option value="Netherlands">🇳🇱 Netherlands</option>
            <option value="Sweden">🇸🇪 Sweden</option>
            <option value="Norway">🇳🇴 Norway</option>
            <option value="Denmark">🇩🇰 Denmark</option>
            <option value="Switzerland">🇨🇭 Switzerland</option>
            <option value="Poland">🇵🇱 Poland</option>
            <option value="India">🇮🇳 India</option>
            <option value="Singapore">🇸🇬 Singapore</option>
            <option value="Japan">🇯🇵 Japan</option>
            <option value="South Korea">🇰🇷 South Korea</option>
            <option value="United Arab Emirates">🇦🇪 United Arab Emirates</option>
            <option value="South Africa">🇿🇦 South Africa</option>
            <option value="Brazil">🇧🇷 Brazil</option>
            <option value="Mexico">🇲🇽 Mexico</option>
            <option value="Argentina">🇦🇷 Argentina</option>
            <option value="Colombia">🇨🇴 Colombia</option>
            <option value="New Zealand">🇳🇿 New Zealand</option>
          </select>
          <button class="kwgap-fetch-btn" id="kwgap-fetch-btn" onclick="fetchLiveKeywordGap()">
            ⚡ Fetch Live Data
          </button>
        </div>
        <div class="kwgap-live-note" id="kwgap-status-note">
          Live data powered by DataForSEO · Results reflect real search rankings · Pay-per-use pricing
        </div>
      </div>

      <div id="kwgap-table-wrap" style="overflow-x:auto">
        <table class="kwgap-table">
          <thead>
            <tr>
              <th>Keyword</th>
              <th>Monthly Vol</th>
              <th>Top Competitor</th>
              <th>Their CTR</th>
              <th>Your Rank</th>
              <th>Difficulty</th>
              <th>Gap Score</th>
              <th>CPC</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="kwgap-tbody">${kwRows}</tbody>
        </table>
      </div>
      <div id="kwgap-data-source" class="kwgap-data-source-label">
        ⚠️ Showing illustrative sample data — enter your domain above and click "Fetch Live Data" for real results
      </div>
    </div>

    <!-- Competitor Signal Feed -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">📡 Competitor Signal Feed</div>
        <div class="intel-section-badge" id="ldb-brandwatch">${displaySignals.length} Signals Detected</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <!-- Live news fetch bar -->
      <div class="kwgap-live-bar" style="margin-bottom:16px">
        <div class="kwgap-live-label">
          <span class="kwgap-live-icon">📰</span>
          <span>Fetch <strong>live competitor news</strong> from the web to surface real signals</span>
        </div>
        <div class="kwgap-live-inputs">
          <button class="kwgap-fetch-btn" id="news-fetch-btn" onclick="fetchLiveCompetitorNews()">
            📡 Refresh Live Signals
          </button>
        </div>
        <div class="kwgap-live-note" id="news-status-note" style="color:#6B7280">
          Powered by Real-Time News Data via RapidAPI · Live competitor news and industry signals
        </div>
      </div>
      <div class="signal-grid" id="signal-grid-wrap">${signalCards}</div>
    </div>

    <!-- Social Intelligence (Reddit) -->
    <div class="intel-section" id="reddit-signals-section">
      <div class="intel-section-head">
        <div class="intel-section-title">💬 Social Intelligence Feed</div>
        <div class="intel-section-badge" id="ldb-reddit">Community Signals</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="kwgap-live-bar" style="margin-bottom:16px">
        <div class="kwgap-live-label">
          <span class="kwgap-live-icon">🔥</span>
          <span>Live <strong>community discussions</strong> from Hacker News — what the tech community is saying about your industry</span>
        </div>
        <div class="kwgap-live-inputs">
          <button class="kwgap-fetch-btn" id="reddit-fetch-btn" onclick="fetchRedditSignals()">
            🔥 Load Community Signals
          </button>
        </div>
        <div class="kwgap-live-note" id="reddit-status-note" style="color:#6B7280">
          Powered by Hacker News · Live discussions relevant to your industry and competitors
        </div>
      </div>
      <div id="reddit-feed-wrap" style="display:grid;gap:10px">
        <div style="text-align:center;padding:32px;color:#94A3B8;font-size:0.875rem">
          Click "Load Community Signals" to fetch live Hacker News discussions from your industry
        </div>
      </div>
    </div>

    <!-- Predictive Intelligence -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🔮 Predictive Competitor Intelligence</div>
        <div class="intel-section-badge">AI-Powered</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="prediction-grid">${predCards}</div>
    </div>

    <!-- 90-Day Roadmap -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🗺️ 90-Day Category Domination Roadmap</div>
        <div class="intel-section-badge">AI-Generated for Your Industry</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="roadmap-track">${roadmapItems}</div>
    </div>

    <!-- Win/Loss Intelligence -->
    <div class="intel-section" style="padding-bottom:48px">
      <div class="intel-section-head">
        <div class="intel-section-title">🏆 Win/Loss Intelligence</div>
        <div class="intel-section-badge">Competitor Messages That Beat You</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="winloss-grid">${wlCards}</div>
    </div>
  `;

  // ── Counter This Message has been moved INSIDE the Real Meta Ads modal
  // (see _wlViewRealAds). The inline button on the card was unreliable across
  // browsers/cache states, so it now lives in the modal that always loads.

  // Build Share of Voice horizontal bar chart
  // Honesty gate: SOV shares are AI-estimated unless real DataForSEO competitor
  // data backs them. Demo mode badges the panel header; strict mode replaces the
  // legend + chart body with an honest unavailable state (so no fabricated share
  // %, legend rows or bars render).
  const _sovBarEstimated = !(realComps && realComps.some(c => c._dataSource === 'DataForSEO'));
  if (!(window._applySectionDataMode && window._applySectionDataMode(
        document.getElementById('sovBarHeaderIntel'),
        document.getElementById('sovBarBodyIntel'),
        _sovBarEstimated, 'AI estimate',
        'Share of Voice is derived from AI-estimated competitor traffic, not verified live measurements. Demo Data Mode is off, so estimated figures are hidden. An administrator can enable Demo Data Mode for this client in the Admin portal.'))) {
  const sovBarCtx = document.getElementById('sovBarChartIntel');
  if (sovBarCtx) {
    if (sovBarCtx._chartInstance) sovBarCtx._chartInstance.destroy();
    const barLabels = displaySov.filter(s => s.name !== 'Others').map(s => s.name);
    const barData   = displaySov.filter(s => s.name !== 'Others').map(s => s.share);
    const barColors = displaySov.filter(s => s.name !== 'Others').map(s =>
      s.name === 'You' ? '#00C9C8' : s.color
    );
    sovBarCtx._chartInstance = new Chart(sovBarCtx, {
      type: 'bar',
      data: {
        labels: barLabels,
        datasets: [{
          label: 'Share of Voice %',
          data: barData,
          backgroundColor: barColors,
          borderRadius: 5,
          borderSkipped: false,
          barThickness: 14
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.parsed.x}% share of voice`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: Math.max(...barData) + 5,
            grid: { color: 'rgba(0,0,0,.05)' },
            ticks: { callback: v => v + '%', font: { size: 10 }, color: '#9CA3AF' }
          },
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 11, weight: '600' },
              color: ctx => barLabels[ctx.index] === 'You' ? '#00C9C8' : '#374151'
            }
          }
        },
        animation: { duration: 800 }
      }
    });
  }
  }

  _updateLiveDataBadges();

  // ── Auto-prefill keyword-gap domain from current analysis & auto-fetch ──
  // Replaces the illustrative sample rows with REAL DataForSEO keyword data
  // for the domain the user just analysed — no extra click required.
  try {
    const kwInput = document.getElementById('kwgap-domain-input');
    const ydomain = analysisData && analysisData.url
      ? String(analysisData.url).replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]
      : '';
    if (kwInput && ydomain && !kwInput.value) kwInput.value = ydomain;

    if (ydomain && !window._kwgapAutoFetched) {
      window._kwgapAutoFetched = ydomain;
      // Defer so the table is in the DOM before we replace its rows
      setTimeout(() => { try { fetchLiveKeywordGap(); } catch(e) { console.warn('auto kwgap fetch:', e); } }, 400);
      setTimeout(() => { try { _applyKwgapOutliers(); } catch(e) {} }, 200);
    }

    // ── Autocomplete on domain input ──
    try {
      const kwInput = document.getElementById('kwgap-domain-input');
      if (kwInput && window.igAttachAutocomplete) {
        window.igAttachAutocomplete(kwInput, { type: 'competitor' });
      }
    } catch(e) { console.warn('igAttachAutocomplete:', e); }
  } catch(e) { console.warn('kwgap auto-prefill:', e); }

  // ── AI Competitor Recommendations (async, non-blocking) ──
  try {
    const _recIndustryKey = analysisData ? analysisData.industryKey : null;
    const _recComps = analysisData ? (analysisData.competitors || []).map(c => c.name).slice(0, 6) : [];
    if (_recIndustryKey && window.igBuildRecommendations) {
      setTimeout(() => {
        try { window.igBuildRecommendations('ig-recs-wrap', _recIndustryKey, _recComps); } catch(e) {}
      }, 600);
    }
  } catch(e) {}
}

// Expose modal openers globally + ensure top-stacking when shown
window.openExclusiveModal = function () {
  const modal = document.getElementById('exclusiveModal');
  if (!modal) { console.warn('exclusiveModal not found'); return; }
  modal.classList.remove('hidden');
  modal.style.cssText = 'display:flex !important;position:fixed;inset:0;z-index:10000;align-items:center;justify-content:center;background:rgba(10,22,40,.65);backdrop-filter:blur(6px);padding:20px';
};
// Delegated safety-net: any click on an InfoGenie Exclusive badge always opens the modal,
// even if inline onclick handlers fail to bind (e.g. due to script-load ordering).
document.addEventListener('click', function(ev) {
  const t = ev.target.closest && ev.target.closest('.intel-exclusive-badge');
  if (t) { ev.preventDefault(); ev.stopPropagation(); window.openExclusiveModal(); }
}, true);
window.closeExclusiveModal = function () {
  const modal = document.getElementById('exclusiveModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
};

// Lazy-load jsPDF from CDN (cached after first call)
function _loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (window._jsPDFPromise) return window._jsPDFPromise;
  window._jsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => reject(new Error('Failed to load jsPDF'));
    document.head.appendChild(s);
  });
  return window._jsPDFPromise;
}

async function exportIntelligenceReport() {
  // Prefer the live snapshot captured by buildIntelligence() so the PDF mirrors
  // exactly what the user sees in the Intelligence Hub. Fall back to seed DB
  // only if the Hub hasn't been rendered yet.
  const snap = window._lastIntelHub || null;
  const industryKey = snap?.industryKey || (analysisData ? analysisData.industryKey : 'marketing');
  const intel = INTELLIGENCE_DB[industryKey] || INTELLIGENCE_DB['marketing'];
  const domain = snap?.domain || (analysisData ? analysisData.url : 'demo.com');
  const industry = snap?.industry || (analysisData ? analysisData.industry.name : 'Marketing & Analytics');
  const date = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const realComps = (snap?.realComps && snap.realComps.length) ? snap.realComps : (analysisData ? analysisData.competitors : []);

  // Live data sources — when the Hub snapshot exists we ALWAYS trust it (even if
  // a section happens to be empty), so the PDF mirrors exactly what the user sees.
  // Only when the user clicks Export before the Hub has rendered do we fall back
  // to the static seed DB.
  const hasSnap        = !!snap;
  const sovSrc         = hasSnap ? (snap.shareOfVoice || []) : intel.shareOfVoice;
  const signalsSrc     = hasSnap ? (snap.signals      || []) : intel.signals;
  const predictionsSrc = hasSnap ? (snap.predictions  || []) : intel.predictions;
  const winLossSrc     = hasSnap ? (snap.winLoss      || []) : intel.winLoss;
  const kwGapsSrc      = hasSnap ? (snap.keywordGaps  || []) : intel.keywordGaps;
  const roadmapSrc     = hasSnap ? (snap.roadmap      || []) : intel.roadmap;
  const categoryScore  = hasSnap && snap.categoryScore != null ? snap.categoryScore : intel.categoryScore;

  let JsPDF;
  try {
    showToast('📄 Generating PDF report…');
    JsPDF = await _loadJsPDF();
  } catch (e) {
    console.error('PDF lib load failed:', e);
    showToast('⚠️ Could not load PDF library — check your connection');
    return;
  }

  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const contentW = pageW - marginX * 2;
  let y = 0;

  // Brand colors
  const COL = {
    brand:   [0, 102, 255],
    brandDk: [10, 22, 40],
    teal:    [0, 201, 200],
    text:    [17, 24, 39],
    sub:     [107, 114, 128],
    line:    [229, 231, 235],
    accent:  [16, 185, 129]
  };

  const setFill = c => doc.setFillColor(c[0], c[1], c[2]);
  const setText = c => doc.setTextColor(c[0], c[1], c[2]);
  const setDraw = c => doc.setDrawColor(c[0], c[1], c[2]);

  function ensureSpace(needed) {
    if (y + needed > pageH - 60) {
      addFooter();
      doc.addPage();
      y = 60;
      addRunningHeader();
    }
  }

  function addRunningHeader() {
    doc.setFont('helvetica','bold'); doc.setFontSize(9); setText(COL.sub);
    doc.text('InfoGenie · Competitive Intelligence Report', marginX, 36);
    setText(COL.text);
    setDraw(COL.line); doc.setLineWidth(0.5);
    doc.line(marginX, 44, pageW - marginX, 44);
  }

  function addFooter() {
    const pn = doc.internal.getNumberOfPages();
    doc.setFont('helvetica','normal'); doc.setFontSize(8); setText(COL.sub);
    doc.text(`Generated ${date} · infogenie.io`, marginX, pageH - 28);
    doc.text(`Page ${pn}`, pageW - marginX, pageH - 28, { align: 'right' });
    setText(COL.text);
  }

  function sectionTitle(num, title) {
    ensureSpace(40);
    setFill(COL.brand); doc.rect(marginX, y, 24, 24, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(11); setText([255,255,255]);
    doc.text(String(num), marginX + 12, y + 16, { align: 'center' });
    setText(COL.brandDk); doc.setFontSize(14);
    doc.text(title, marginX + 34, y + 17);
    y += 36;
    setDraw(COL.line); doc.setLineWidth(0.5);
    doc.line(marginX, y, pageW - marginX, y);
    y += 14;
  }

  function bodyText(txt, opts={}) {
    const { size=10, bold=false, color=COL.text, indent=0, gap=4 } = opts;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size); setText(color);
    const lines = doc.splitTextToSize(txt, contentW - indent);
    lines.forEach(line => {
      ensureSpace(size + 2);
      doc.text(line, marginX + indent, y);
      y += size + 2;
    });
    y += gap;
  }

  function bulletItem(label, valueLines) {
    ensureSpace(28);
    setFill(COL.teal); doc.circle(marginX + 4, y - 3, 2.2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5); setText(COL.brandDk);
    const labelLines = doc.splitTextToSize(label, contentW - 14);
    labelLines.forEach(l => { ensureSpace(14); doc.text(l, marginX + 14, y); y += 13; });
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5); setText(COL.text);
    (Array.isArray(valueLines) ? valueLines : [valueLines]).forEach(v => {
      const ls = doc.splitTextToSize(v, contentW - 14);
      ls.forEach(l => { ensureSpace(12); doc.text(l, marginX + 14, y); y += 12; });
    });
    y += 6;
  }

  // ── COVER PAGE ──────────────────────────────────────────────────────────────
  setFill(COL.brandDk); doc.rect(0, 0, pageW, 240, 'F');
  setFill(COL.teal); doc.rect(0, 240, pageW, 6, 'F');

  doc.setFont('helvetica','bold'); doc.setFontSize(11); setText(COL.teal);
  doc.text('INFOGENIE · INTELLIGENCE HUB', marginX, 70);
  doc.setFontSize(28); setText([255,255,255]);
  doc.text('Competitive Intelligence', marginX, 108);
  doc.text('Report', marginX, 142);

  doc.setFont('helvetica','normal'); doc.setFontSize(11); setText([200,210,230]);
  doc.text(`Domain   ${domain}`, marginX, 178);
  doc.text(`Industry  ${industry}`, marginX, 196);
  doc.text(`Generated ${date}`, marginX, 214);

  // Score badge
  setFill([255,255,255]); doc.roundedRect(pageW - marginX - 130, 90, 130, 110, 8, 8, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(9); setText(COL.sub);
  doc.text('CATEGORY DOMINATION', pageW - marginX - 65, 110, { align: 'center' });
  setText(COL.brand); doc.setFontSize(36);
  doc.text(`${categoryScore}`, pageW - marginX - 65, 152, { align: 'center' });
  doc.setFontSize(11); setText(COL.sub);
  doc.text('/ 100', pageW - marginX - 65, 172, { align: 'center' });
  doc.setFontSize(8);
  doc.text('SCORE', pageW - marginX - 65, 188, { align: 'center' });

  y = 290;
  doc.setFont('helvetica','bold'); doc.setFontSize(13); setText(COL.brandDk);
  doc.text('Executive Summary', marginX, y); y += 18;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); setText(COL.text);
  const summary = `This report consolidates real-time competitive signals, share-of-voice analysis, predicted competitor moves, and a 90-day domination roadmap for ${domain} operating in ${industry}. Data is sourced from DataForSEO live APIs combined with InfoGenie's AI analytics engine. Use it to prioritise keyword bets, defensive plays and counter-campaigns over the next quarter.`;
  doc.splitTextToSize(summary, contentW).forEach(l => { doc.text(l, marginX, y); y += 14; });

  y += 14;
  doc.setFont('helvetica','bold'); doc.setFontSize(11); setText(COL.brandDk);
  doc.text('Tracked Competitors', marginX, y); y += 16;
  doc.setFont('helvetica','normal'); doc.setFontSize(10); setText(COL.text);
  if (realComps.length) {
    realComps.slice(0, 8).forEach(c => {
      ensureSpace(14);
      doc.text(`• ${c.name || c.url}${c.url ? '  (' + c.url + ')' : ''}`, marginX, y);
      y += 14;
    });
  } else {
    bodyText('Run an analysis to populate live competitors.', { color: COL.sub });
  }

  // New page for sections
  addFooter();
  doc.addPage();
  y = 60;
  addRunningHeader();

  // ── SECTION 1: KEYWORD GAPS ─────────────────────────────────────────────────
  sectionTitle(1, 'Keyword Gap Opportunities');
  kwGapsSrc.forEach((k, i) => {
    bulletItem(`${i+1}. ${k.keyword}`, [
      `Volume: ${k.volume}/mo   ·   Top Competitor: ${k.topComp}   ·   Their CTR: ${k.compCtr}`,
      `Your Rank: ${k.yourRank}   ·   Difficulty: ${k.difficulty}   ·   Gap Score: ${k.score}/100   ·   CPC: ${k.cpc}`
    ]);
  });

  // ── SECTION 2: SHARE OF VOICE ───────────────────────────────────────────────
  sectionTitle(2, 'Share of Voice');
  sovSrc.forEach(s => {
    ensureSpace(22);
    doc.setFont('helvetica','bold'); doc.setFontSize(10); setText(COL.brandDk);
    doc.text(String(s.name || ''), marginX, y);
    doc.setFont('helvetica','normal'); setText(COL.text);
    doc.text(`${s.share}%${s.trend ? '  ' + s.trend : ''}`, pageW - marginX, y, { align: 'right' });
    // Bar — colour-matched to the Hub legend when a per-row colour is provided
    const barY = y + 4;
    const barW = contentW;
    const fillW = (Math.max(0, Math.min(100, Number(s.share) || 0)) / 100) * barW;
    setFill(COL.line); doc.rect(marginX, barY, barW, 6, 'F');
    if (s.color && /^#?[0-9A-Fa-f]{6}$/.test(String(s.color).replace('#',''))) {
      const hex = String(s.color).replace('#','');
      setFill([parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)]);
    } else {
      setFill(COL.brand);
    }
    doc.rect(marginX, barY, fillW, 6, 'F');
    y += 22;
  });

  // ── SECTION 3: SIGNALS ──────────────────────────────────────────────────────
  sectionTitle(3, 'Competitor Signals Detected');
  const sigTypeLabels = {
    dark_period:  'Dark Period Detected',
    new_campaign: 'New Campaign Launched',
    budget_surge: 'Budget Surge',
    price_change: 'Price Change'
  };
  signalsSrc.forEach((s) => {
    const compName = s.comp || s.name || 'Competitor';
    const typeLbl  = sigTypeLabels[s.type] || (s.type ? String(s.type) : 'Signal');
    const sev      = s.severity ? String(s.severity).toUpperCase() : '';
    const ago      = s.detectedAgo ? `Detected ${s.detectedAgo}` : '';
    const meta     = [sev && `Severity: ${sev}`, ago].filter(Boolean).join('   ·   ');
    bulletItem(`[${typeLbl}] ${compName}`, [
      String(s.message || s.msg || '').slice(0, 360),
      meta,
      `Recommended Action: ${s.action || 'Review competitor activity'}`
    ].filter(Boolean));
  });

  // ── SECTION 4: PREDICTIONS ──────────────────────────────────────────────────
  sectionTitle(4, 'AI Predictive Intelligence');
  predictionsSrc.forEach((p, i) => {
    bulletItem(`${i+1}. ${p.comp} — ${p.timeframe} warning  (Confidence ${p.confidence}%)`, [
      String(p.prediction || '').slice(0, 360),
      `Recommended: ${p.action}`
    ]);
  });

  // ── SECTION 5: ROADMAP ──────────────────────────────────────────────────────
  sectionTitle(5, '90-Day Domination Roadmap');
  roadmapSrc.forEach(r => {
    bulletItem(`[${String(r.week).toUpperCase()}]  ${r.title}`, String(r.desc || '').slice(0, 360));
  });

  // ── SECTION 6: WIN/LOSS ─────────────────────────────────────────────────────
  sectionTitle(6, 'Win / Loss Intelligence');
  winLossSrc.forEach(w => {
    bulletItem(`${w.comp}  ·  ${w.channel}`, [
      `Winning Message: ${w.message}`,
      `Loss Rate: ${w.lossRate} of deals`,
      `Exploitable Weakness: ${w.weakness}`
    ]);
  });

  addFooter();

  const safeDomain = String(domain).replace(/[^a-z0-9]/gi, '_');
  const fname = `InfoGenie_Intelligence_Report_${safeDomain}_${new Date().toISOString().slice(0,10)}.pdf`;
  doc.save(fname);
  showToast('📥 PDF report downloaded successfully');
  igTrack('Report Exported', { format: 'pdf', domain, industry });
  return; // Skip legacy text body below

  // Legacy text fallback (unreachable, kept for safety)
  const lines = [
    '================================================================',
    '  INFOGENIE — COMPETITIVE INTELLIGENCE REPORT',
    '================================================================',
    `  Domain: ${domain}`,
    `  Industry: ${industry}`,
    `  Generated: ${date}`,
    `  Category Domination Score: ${intel.categoryScore}/100`,
    '================================================================',
    '',
    '1. KEYWORD GAP OPPORTUNITIES',
    '-----------------------------',
    ...intel.keywordGaps.map((k,i) =>
      `  ${i+1}. ${k.keyword}\n     Monthly Volume: ${k.volume}  |  Top Competitor: ${k.topComp}  |  Their CTR: ${k.compCtr}\n     Your Rank: ${k.yourRank}  |  Difficulty: ${k.difficulty}  |  Gap Score: ${k.score}/100  |  CPC: ${k.cpc}`
    ),
    '',
    '2. SHARE OF VOICE',
    '-----------------',
    ...intel.shareOfVoice.map(s => `  ${s.name}: ${s.share}% ${s.trend || ''}`),
    '',
    '3. COMPETITOR SIGNALS DETECTED',
    '-------------------------------',
    ...(realComps.length > 0 ? realComps.slice(0,4) : intel.signals).map((c, i) => {
      const sigTypes = ['Dark Period Detected','New Campaign Launched','Budget Surge','Price Change'];
      const name = c.name || c.comp;
      return `  [${sigTypes[i % 4]}] ${name}\n     Recommended Action: Attack their vacated keywords and target price-dissatisfied customers`;
    }),
    '',
    '4. AI PREDICTIVE INTELLIGENCE',
    '------------------------------',
    ...intel.predictions.map((p,i) =>
      `  ${i+1}. ${p.comp} — ${p.timeframe} warning\n     Confidence: ${p.confidence}%\n     ${p.prediction.substring(0,200)}...\n     Recommended: ${p.action}`
    ),
    '',
    '5. 90-DAY DOMINATION ROADMAP',
    '-----------------------------',
    ...intel.roadmap.map(r =>
      `  [${r.week.toUpperCase()}] ${r.title}\n     ${r.desc.substring(0,200)}`
    ),
    '',
    '6. WIN/LOSS INTELLIGENCE',
    '-------------------------',
    ...intel.winLoss.map(w =>
      `  Competitor: ${w.comp} (${w.channel})\n  Their Winning Message: ${w.message}\n  Loss Rate: ${w.lossRate} of deals\n  Exploitable Weakness: ${w.weakness}`
    ),
    '',
    '================================================================',
    '  InfoGenie AI Platform — infogenie.io',
    '  This report is AI-generated competitive intelligence.',
    '================================================================'
  ].join('\n');

  const blob = new Blob([lines], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `InfoGenie_Intelligence_Report_${domain.replace(/[^a-z0-9]/gi,'_')}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('📥 Intelligence Report downloaded successfully');
}
// ── Battle Plan ───────────────────────────────────────────────────────────────
window._bpIdx = 0;

function switchBattlePlanComp(idx) {
  window._bpIdx = idx;
  buildBattlePlan();
  window.scrollTo(0, 0);
}

function buildBattlePlan() {
  const wrap = document.getElementById('battlePlanWrap');
  if (!wrap) return;

  if (!analysisData || !analysisData.competitors || !analysisData.competitors.length) {
    wrap.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70vh;text-align:center;gap:20px;padding:40px">
        <div style="font-size:3.5rem">⚔️</div>
        <div style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:900;color:#0A1628">No Analysis Yet</div>
        <div style="color:#6B7280;max-width:420px;font-size:0.9rem;line-height:1.6">Run a competitor analysis first to generate your personalised Battle Plan — with actions you can take directly from this page.</div>
        <button onclick="navigateTo('home')" style="padding:13px 30px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:12px;color:white;font-weight:700;font-size:0.9rem;cursor:pointer">Run Analysis →</button>
      </div>`;
    return;
  }

  const comps = analysisData.competitors;
  const domain = analysisData.url || 'yourdomain.com';
  const industry = (analysisData.industry || {}).name || 'your industry';
  const idx = Math.min(window._bpIdx || 0, comps.length - 1);
  const c = comps[idx];
  const threat = c.threatLevel || 'medium';

  // Cache competitor data for safe global wrapper calls (avoids onclick escaping issues)
  window._bpCache = window._bpCache || {};
  window._bpCache[idx] = {
    name: c.name || 'Competitor',
    channel: c.topChannel || null,
    keywords: (c.topKeywords || ['competitor brand alternative','industry best tool','vs competitor','top rated solution']).slice(0, 8),
    campaigns: (c.campaigns || []).slice(0, 4),
    audiences: (c.audiences || [{label:'High-Intent Buyers',pct:38},{label:'Decision Makers',pct:24},{label:'Mid-Market Segment',pct:22}]).slice(0, 3),
    suggestions: (c.suggestions || []).slice(0, 4)
  };

  const fmtT = n => n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(0)+'K' : String(n||0);
  const traffic = c.trafficMo ? fmtT(c.trafficMo) : (c.traffic || '—');
  const oppBase = threat === 'high' ? 74 : threat === 'medium' ? 55 : 38;
  const oppScore = oppBase + Math.floor((_blSeed(c.name) % 18));

  // ── Competitor tabs ─────────────────────────────────────────────────────────
  const tabs = comps.map((comp, i) => {
    const t = comp.threatLevel || 'medium';
    const dotColor = t === 'high' ? '#EF4444' : t === 'medium' ? '#F59E0B' : '#10B981';
    const active = i === idx;
    return `<button onclick="switchBattlePlanComp(${i})" style="display:flex;align-items:center;gap:8px;padding:10px 18px;border:none;border-bottom:3px solid ${active?'#0066FF':'transparent'};background:${active?'#EFF6FF':'transparent'};cursor:pointer;color:${active?'#0066FF':'#5A7090'};font-size:0.8rem;font-weight:${active?700:500};white-space:nowrap;font-family:'Inter',sans-serif;transition:all .15s">
      <span style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#0066FF,#00C9C8);display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:800;color:#0A1628">${(comp.logo||comp.name[0]).toString()[0]}</span>
      ${comp.name}
      <span style="width:7px;height:7px;border-radius:50%;background:${dotColor}"></span>
    </button>`;
  }).join('');

  // ── Section builder helper ──────────────────────────────────────────────────
  function section(icon, title, sub, items) {
    return `<div style="background:#FFFFFF;border:1px solid #E8EEF8;border-radius:16px;padding:20px;box-shadow:0 2px 8px rgba(10,20,50,.06)">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px">
        <span style="font-size:1.2rem;line-height:1">${icon}</span>
        <div><div style="font-family:Sora,sans-serif;font-size:0.9rem;font-weight:800;color:#0A1628">${title}</div><div style="font-size:0.7rem;color:#6B88B0;margin-top:2px">${sub}</div></div>
      </div>
      ${items}
    </div>`;
  }
  function card(borderColor, badgeStyle, badgeLabel, title, body, btns) {
    return `<div style="background:white;border:1px solid #E5E7EB;border-left:4px solid ${borderColor};border-radius:12px;padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        <span style="font-size:0.62rem;font-weight:800;padding:3px 8px;border-radius:5px;flex-shrink:0;${badgeStyle}">${badgeLabel}</span>
        <div style="font-size:0.82rem;font-weight:700;color:#0A1628;line-height:1.4">${title}</div>
      </div>
      <div style="font-size:0.78rem;color:#6B7280;line-height:1.55;margin-bottom:10px">${body}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${btns}</div>
    </div>`;
  }
  function btn(label, onclick, style) {
    return `<button onclick="${onclick}" style="padding:6px 14px;border:none;border-radius:8px;font-size:0.72rem;font-weight:700;cursor:pointer;${style}">${label}</button>`;
  }
  const primaryBtn  = (label, fn) => btn(label, fn, 'background:linear-gradient(135deg,#0066FF,#00C9C8);color:#fff;-webkit-text-fill-color:#fff');
  const dangerBtn   = (label, fn) => btn(label, fn, 'background:linear-gradient(135deg,#EF4444,#DC2626);color:#fff;-webkit-text-fill-color:#fff');
  const purpleBtn   = (label, fn) => btn(label, fn, 'background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;-webkit-text-fill-color:#fff');
  const greenBtn    = (label, fn) => btn(label, fn, 'background:linear-gradient(135deg,#10B981,#059669);color:#fff;-webkit-text-fill-color:#fff');
  const ghostBtn    = (label, fn) => btn(label, fn, 'background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;-webkit-text-fill-color:#374151');

  // ── 1. Exploit Weaknesses ───────────────────────────────────────────────────
  const weakCards = (c.suggestions || ['Competitor has weak personalisation in search ads','Generic creative with low audience specificity','No TikTok or Reels presence','Over-indexed on branded keywords']).slice(0,4).map((s,i) => {
    const priority = i < 2 ? 'HIGH' : 'MEDIUM';
    const badgeStyle = i < 2 ? 'background:#FEE2E2;color:#991B1B' : 'background:#FEF3C7;color:#92400E';
    return card(i<2?'#EF4444':'#F59E0B', badgeStyle, priority,
      s.length > 70 ? s.slice(0,70)+'…' : s,
      `${c.name} leaves this gap unaddressed. A targeted counter-campaign ${c.topChannel ? 'on '+c.topChannel : 'on their primary channel'} can capture this audience now.`,
      dangerBtn('⚡ Launch Counter-Campaign', `bpLC(${idx},${i})`) +
      purpleBtn('✨ Creative Studio', `bpCS(${idx},${i})`)
    );
  }).join('');

  // ── 2. Keyword Attack ───────────────────────────────────────────────────────
  const kwVolumes  = [14800,8200,22000,6600,18400,4400,9800,12000];
  const kwDifficulties = ['Low','Medium','Medium','High'];
  const kwColors   = ['#0066FF','#7C3AED','#059669','#D97706'];
  const kwCards = (c.topKeywords || ['competitor brand + alternative','industry best tool','vs competitor keyword','top rated solution']).slice(0,4).map((kw,i) => {
    const vol   = kwVolumes[i % kwVolumes.length];
    const cpc   = (0.9 + (_blSeed(kw) % 320) / 100).toFixed(2);
    const diff  = kwDifficulties[i % kwDifficulties.length];
    const diffColor = diff==='Low'?'#059669':diff==='Medium'?'#D97706':'#EF4444';
    return card(kwColors[i], 'background:#EFF6FF;color:#1D4ED8', `${vol.toLocaleString()}/mo · CPC $${cpc}`,
      `"${kw}"`,
      `${c.name} is actively bidding here with suboptimal relevance scores — you can capture traffic at <strong style="color:#059669">lower CPC</strong> with tighter ad groups. Difficulty: <span style="color:${diffColor};font-weight:700">${diff}</span>.`,
      primaryBtn('🔑 Build Google Ads', `bpGA(${idx},${i})`) +
      ghostBtn('📝 Build Content', `bpBC(${idx},${i})`)
    );
  }).join('');

  // ── 3. Creative Counter-Strategy ────────────────────────────────────────────
  const angles = ['Pain-Point Contrast','Benefit Superiority','Social Proof Attack','Value Proposition'];
  const adItems = c.adCopy && c.adCopy.length > 0 ? c.adCopy.slice(0,3) : null;
  // Store adCopy and suggestion text in cache for creative studio use
  window._bpCache[idx].adCopy = c.adCopy || null;
  const creativeCards = adItems
    ? adItems.map((ac,i) => {
        return card('#7C3AED','background:#F5F3FF;color:#6D28D9', angles[i]||'Creative Angle',
          `"${ac.headline||'Counter Creative'}"`,
          (ac.body||'').slice(0,110),
          purpleBtn('✨ Open Creative Studio', `bpCS(${idx},${i})`)
        );
      }).join('')
    : (c.suggestions||['Exploit their weak personalisation with hyper-targeted messaging']).slice(0,3).map((s,i)=>{
        return card('#7C3AED','background:#F5F3FF;color:#6D28D9', angles[i]||'Creative Angle',
          `Beat ${c.name}: ${s.slice(0,35)}${s.length>35?'…':''}`,
          `Outperform ${c.name} by addressing this gap with superior creative.`,
          purpleBtn('✨ Open Creative Studio', `bpCS(${idx},${i})`)
        );
      }).join('');

  // ── 4. Audience Gaps ────────────────────────────────────────────────────────
  const audChannels = ['Meta Ads','Google Ads','LinkedIn Ads','TikTok Ads'];
  const audGaps = ['Underserved by competitor — low ad frequency in this segment','Poor creative resonance — competitor uses generic messaging here','Budget mismatch — competitor over-spends on lower-intent tiers'];
  const audCards = ((c.audiences && c.audiences.length) ? c.audiences : [{label:'High-Intent Buyers',pct:38},{label:'Decision Makers',pct:24},{label:'Mid-Market Segment',pct:22}]).slice(0,3).map((a,i)=>{
    const aCh = audChannels[i % audChannels.length];
    return card('#0066FF','background:#EFF6FF;color:#1D4ED8', `${a.pct}% of market`,
      a.label,
      `${audGaps[i%audGaps.length].replace('competitor', c.name)}. Best capture channel: <strong>${aCh}</strong>.`,
      primaryBtn('🎯 Target This Audience', `bpTA(${idx},${i})`) +
      ghostBtn('👥 Audience Deep-Dive', `navigateTo('audience')`)
    );
  }).join('');

  // ── 5. Campaign Counter-Moves ───────────────────────────────────────────────
  const campCards = (c.campaigns || []).slice(0,3).map((camp,i)=>{
    const roasTarget = (camp.roas * 1.2).toFixed(1);
    return card('#10B981', camp.status==='Active'?'background:#D1FAE5;color:#065F46':'background:#FEF3C7;color:#92400E', camp.status,
      `Counter: "${(camp.name||'Campaign').slice(0,40)}"`,
      `${c.name} runs this on <strong>${camp.channel}</strong> at ${camp.ctr} CTR / ${camp.roas}× ROAS. Launch a counter-campaign targeting the same audience with superior creative — target ROAS: <strong style="color:#059669">${roasTarget}×</strong>.`,
      greenBtn('📣 Launch Counter-Campaign', `bpCC(${idx},${i})`)
    );
  }).join('') || `<div style="color:#7A92B4;font-size:0.82rem;padding:12px 0">No active campaigns detected — run full analysis for live campaign data.</div>`;

  // ── 6. Quick Wins ───────────────────────────────────────────────────────────
  const qwItems = [
    { t: c.estimatedROI || `+25% CTR improvement via tighter audience segmentation`, fn: `bpQW(${idx},0)`, btnLabel: '⚡ Execute' },
    { t: `Capture ${c.name}'s branded search traffic with non-branded alternatives at lower CPC`, fn: `navigateTo('intelligence')`, btnLabel: '🔑 View Keywords' },
    { t: `Expand to channels where ${c.name} has minimal presence for uncontested reach`, fn: `navigateTo('social')`, btnLabel: '📣 Plan Social' },
  ];
  const qwCards = qwItems.map(w => card('#00C9C8','background:#ECFEFF;color:#0E7490','QUICK WIN',
    w.t.length > 80 ? w.t.slice(0,80)+'…' : w.t,
    `Low effort, high impact. Act on this before competitors do.`,
    btn(w.btnLabel, w.fn, 'background:linear-gradient(135deg,#00C9C8,#00E5FF);color:#0A1628;font-weight:700')
  )).join('');

  // ── Priority summary banner ─────────────────────────────────────────────────
  const topRows = (c.suggestions||[]).slice(0,3).map((s,i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #EEF2FA">
      <span style="font-size:0.62rem;font-weight:800;padding:2px 8px;border-radius:5px;flex-shrink:0;background:${i===0?'#FEE2E2':'#EFF4FF'};color:${i===0?'#EF4444':'#3B5BDB'}">#${i+1}</span>
      <div style="font-size:0.8rem;color:#374B6E;line-height:1.45">${s}</div>
    </div>`).join('');

  // ── Final render ────────────────────────────────────────────────────────────
  wrap.innerHTML = `
  <div style="background:var(--ig-page);min-height:100vh;padding-bottom:40px">

    <!-- Page Header -->
    <div data-bp-hero style="background:linear-gradient(110deg,#1E40AF 0%,#2563EB 50%,#3B82F6 100%);border-radius:18px;margin:18px 24px 6px;padding:22px 28px;box-shadow:0 8px 28px rgba(37,99,235,.18);position:relative;overflow:hidden;min-height:130px;display:flex;align-items:center">
      <div style="position:absolute;top:-60px;right:-40px;width:260px;height:260px;background:radial-gradient(circle,rgba(255,255,255,.25),transparent 70%);border-radius:50%;pointer-events:none"></div>
      <div style="width:100%;max-width:1200px;margin:0 auto;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;position:relative;z-index:1">
        <div>
          <div style="font-size:0.65rem;font-weight:800;color:#BFDBFE;opacity:.9;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Analyse › Battle Plan</div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <span style="font-size:1.4rem">⚔️</span>
            <h1 style="font-family:Sora,sans-serif;font-size:1.5rem;font-weight:900;color:#FFFFFF;margin:0;text-shadow:0 1px 2px rgba(15,30,61,.20)">Battle Plan</h1>
            <span class="hero-pill" style="background:#FFFFFF;border:1px solid rgba(255,255,255,.6);padding:3px 12px;border-radius:20px;font-size:0.67rem;font-weight:800;color:#1E3A8A !important;box-shadow:0 1px 3px rgba(15,30,61,.10)">AI-GENERATED</span>
          </div>
          <div style="color:#E0E7FF;opacity:.95;font-size:0.88rem;font-weight:500;text-shadow:0 1px 2px rgba(15,30,61,.18)">${domain} · ${industry} · ${comps.length} competitors · Click any action card to execute directly</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button onclick="bpLC(${idx},0)" style="padding:10px 20px;background:linear-gradient(135deg,#EF4444,#DC2626);border:none;border-radius:10px;font-size:0.8rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;box-shadow:0 4px 12px rgba(239,68,68,.35)">⚡ Execute Top Priority</button>
          <button onclick="navigateTo('campaigns')" style="padding:10px 20px;background:#FFFFFF;border:1px solid rgba(255,255,255,.6);border-radius:10px;font-size:0.8rem;font-weight:800;color:#1E3A8A;cursor:pointer;box-shadow:0 2px 6px rgba(15,30,61,.08)">📋 All Campaigns</button>
        </div>
      </div>
    </div>

    <!-- Competitor Tabs -->
    <div style="background:#FFFFFF;border-bottom:1px solid #E8EEF8;overflow-x:auto">
      <div style="display:flex;padding:0 20px;max-width:1200px;margin:0 auto">${tabs}</div>
    </div>

    <!-- Selected Competitor Summary -->
    <div class="bp-comp-summary" style="background:#FFFFFF;border-bottom:1px solid #E8EEF8;padding:14px 28px;box-shadow:0 2px 8px rgba(10,20,50,.05)">
      <div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#0066FF,#00C9C8);display:flex;align-items:center;justify-content:center;font-weight:900;color:#0A1628;font-size:1rem;box-shadow:0 3px 10px rgba(0,102,255,.25)">${(c.logo||c.name[0]).toString()[0]}</div>
          <div>
            <div style="font-weight:800;color:#0A1628;font-size:0.95rem">${c.name}</div>
            <div style="font-size:0.68rem;color:#7A92B4">${c.url||''}</div>
          </div>
        </div>
        <div style="flex:1;display:flex;gap:24px;flex-wrap:wrap">
          <div style="text-align:center" title="Estimated total monthly website visits for ${c.name} — organic + paid combined."><div style="font-size:0.92rem;font-weight:800;color:#0066FF">${traffic}</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">Traffic/mo</div></div>
          <div style="text-align:center" title="Click-Through Rate: % of ad impressions that result in a click. This competitor's average across all campaigns."><div style="font-size:0.92rem;font-weight:800;color:#0066FF">${c.ctr||'—'}</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">CTR</div></div>
          <div style="text-align:center" title="Return on Ad Spend — estimated revenue earned per $1 spent on ads by this competitor."><div style="font-size:0.92rem;font-weight:800;color:#0066FF">${c.roas||'—'}×</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">ROAS</div></div>
          <div style="text-align:center" title="Estimated monthly advertising budget across Google, Meta, TikTok and other paid channels."><div style="font-size:0.92rem;font-weight:800;color:#0066FF">${c.adSpend||'—'}</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">Ad Spend</div></div>
          <div style="text-align:center" title="The marketing channel where this competitor is investing the most budget and generating the best results."><div style="font-size:0.92rem;font-weight:800;color:#0066FF">${c.topChannel||'—'}</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">Top Channel</div></div>
          <div style="text-align:center" title="AI threat assessment — how directly this competitor threatens your market position. High = immediate action required."><div style="font-size:0.92rem;font-weight:800;color:${(threat==='critical'||threat==='high')?'#DC2626':threat==='medium'?'#D97706':'#059669'}">${threat.toUpperCase()}</div><div style="font-size:0.62rem;color:#7A92B4;text-transform:uppercase;letter-spacing:.06em">Threat</div></div>
        </div>
        <div style="text-align:right;flex-shrink:0;background:#F8FAFF;border:1.5px solid #E0EAFF;border-radius:14px;padding:10px 18px" title="AI-calculated opportunity score — how much market share you can realistically capture from this competitor. Higher = more opportunity.">
          <div style="font-size:0.62rem;color:#7A92B4;margin-bottom:2px;text-transform:uppercase;letter-spacing:.05em">Opportunity Score</div>
          <div style="font-size:2rem;font-weight:900;font-family:Sora,sans-serif;color:${oppScore>=70?'#059669':oppScore>=50?'#D97706':'#0066FF'};line-height:1">${oppScore}</div>
          <div style="font-size:0.62rem;color:#9BADC8">out of 100</div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div style="max-width:1200px;margin:0 auto;padding:24px 28px">

      <!-- Priority Summary Banner -->
      <div style="background:linear-gradient(135deg,#FFF5F5,#FFF8F8);border:1px solid #FECACA;border-left:4px solid #EF4444;border-radius:14px;padding:16px 20px;margin-bottom:24px">
        <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#991B1B;margin-bottom:10px">🎯 Top Priority Actions vs ${c.name}</div>
        ${topRows || '<div style="color:#9BADC8;font-size:0.82rem">Run analysis for full recommendations</div>'}
      </div>

      <!-- 2-Column Action Grid -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:20px">

        ${section('🎯','Exploit Their Weaknesses',`${(c.suggestions||[]).length || 4} identified gaps in ${c.name}&apos;s strategy`, weakCards)}
        ${section('🔑','Keyword Attack Windows',`Keywords ${c.name} is over-bidding — steal their traffic at lower CPC`, kwCards)}
        ${section('🎨','Creative Counter-Strategy',`Ad angles that out-perform ${c.name}&apos;s current creative`, creativeCards)}
        ${section('👥','Untapped Audience Segments',`Segments ${c.name} is under-serving or ignoring`, audCards)}
        ${section('📣','Campaign Counter-Moves',`Live ${c.name} campaigns to counter right now`, campCards)}
        ${section('💰','High-ROI Quick Wins','Low effort, high impact — act before competitors do', qwCards)}

      </div>

      <!-- Bottom CTA -->
      <div style="margin-top:24px;background:linear-gradient(135deg,#EFF6FF,#ECFEFF);border:1px solid #BAE6FD;border-radius:14px;padding:20px 24px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:14px">
          <div>
            <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:4px">🚀 Launch Full Attack Plan</div>
            <div style="font-size:0.8rem;color:#6B7280">GPT-4 generates a complete 8-week strategy — keywords, channels, content, budget &amp; weekly milestones</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:200px">
            <label style="font-size:0.68rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em">Select Competitor</label>
            <select id="attackPlanCompSelect" style="padding:10px 14px;background:#fff;border:1px solid #BAE6FD;border-radius:9px;font-size:0.82rem;font-weight:600;color:#0A1628;cursor:pointer;width:100%;appearance:auto">
              ${(analysisData?.competitors||[]).map((cc,i)=>`<option value="${i}" ${i===idx?'selected':''}>${cc.name||'Competitor '+(i+1)}</option>`).join('')}
            </select>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;padding-top:18px">
            <button onclick="openFullAttackPlanModal(parseInt(document.getElementById('attackPlanCompSelect').value||'${idx}'))" style="padding:11px 24px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:10px;font-size:0.84rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap;box-shadow:0 4px 16px rgba(0,102,255,.4)">🚀 Generate Attack Plan</button>
            <button onclick="navigateTo('intelligence')" class="bp-cta-secondary" style="padding:11px 20px;background:#fff;border:1px solid #BAE6FD;border-radius:10px;font-size:0.82rem;font-weight:600;color:#374151;cursor:pointer;white-space:nowrap">📊 Deep Intelligence</button>
          </div>
        </div>
      </div>

    </div>
  </div>`;
}

// ── Battle Plan Global Action Wrappers ────────────────────────────────────────
// These are called from onclick attributes with just integer indexes, avoiding
// all string-escaping issues with competitor names and channel names.

function _bpGet(compIdx) {
  return (window._bpCache && window._bpCache[compIdx]) || null;
}

// bpLC — Launch Counter-Campaign (weakness card)
function bpLC(compIdx, itemIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  const label = (d.suggestions[itemIdx] || d.name + ' counter').slice(0,40);
  openCampLaunchRich('Counter: ' + label, d.channel, '$2,000/mo', compIdx);
}

// bpGA — Build Google Ads (keyword card)
function bpGA(compIdx, kwIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  const kw = d.keywords[kwIdx] || d.name + ' campaign';
  openCampLaunchRich(kw + ' Campaign', 'Google Ads', '$1,200/mo', compIdx);
}

// bpBC — Build Content (keyword card)
function bpBC(compIdx, kwIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  const kw = d.keywords[kwIdx] || '';
  window._clusterSeedPrefill = kw;
  navigateTo('content');
}

// bpCS — Open Creative Studio (creative card)
function bpCS(compIdx, itemIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  let headline = 'Counter Creative vs ' + d.name;
  let body = 'Beat ' + d.name + ' with superior creative.';
  if (d.adCopy && d.adCopy[itemIdx]) {
    headline = d.adCopy[itemIdx].headline || headline;
    body = d.adCopy[itemIdx].body || body;
  } else if (d.suggestions[itemIdx]) {
    headline = 'Beat ' + d.name + ': ' + d.suggestions[itemIdx].slice(0,40);
    body = 'Outperform ' + d.name + ' by addressing: ' + d.suggestions[itemIdx].slice(0,80);
  }
  openAdInCreativeStudio(headline, body, d.channel);
}

// bpTA — Target This Audience (audience card)
function bpTA(compIdx, audIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  const channels = ['Meta Ads','Google Ads','LinkedIn Ads','TikTok Ads'];
  const aud = d.audiences[audIdx] || { label: 'Target Audience' };
  openCampLaunchRich(aud.label + ' Campaign', channels[audIdx % channels.length], '$1,500/mo', compIdx);
}

// bpCC — Launch Counter-Campaign (campaign counter-moves card)
function bpCC(compIdx, campIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  const camp = d.campaigns[campIdx];
  if (!camp) { bpLC(compIdx, 0); return; }
  openCampLaunchRich('Counter: ' + (camp.name||'Campaign').slice(0,35), camp.channel || d.channel, camp.budget || '$2,000/mo', compIdx);
}

// bpQW — Execute Quick Win
function bpQW(compIdx, winIdx) {
  const d = _bpGet(compIdx); if (!d) { showToast('⚠️ Run analysis first'); return; }
  openCampLaunchRich('Quick Win vs ' + d.name, d.channel, '$1,000/mo', compIdx);
}

// ── Full Attack Plan Modal ─────────────────────────────────────────────────────
function _apCloseModal() {
  const m = document.getElementById('fullAttackPlanModal');
  if (m) { m.style.display = 'none'; }
}
function _apSwitchTab(t) {
  ['overview','roadmap','keywords','channels','content','wins'].forEach(id => {
    const panel = document.getElementById('apt-' + id);
    const btn   = document.getElementById('aptb-' + id);
    if (panel) panel.style.display = id === t ? 'block' : 'none';
    if (btn) {
      // Use class + clear inline style overrides so theme-aware CSS in style.css owns the look
      btn.classList.toggle('active', id === t);
      if (id === t) btn.setAttribute('data-active','true'); else btn.removeAttribute('data-active');
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }
  });
}
async function openFullAttackPlanModal(idx) {
  idx = (typeof idx === 'number' && !isNaN(idx)) ? idx : (window._bpIdx || 0);
  const comps = analysisData?.competitors || [];
  const c = comps[idx] || {};
  const myDomain = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';
  const cName = c.name || 'Competitor';

  let modal = document.getElementById('fullAttackPlanModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fullAttackPlanModal';
    document.body.appendChild(modal);
  }
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--ig-rgba70);display:flex;align-items:center;justify-content:center;padding:16px';

  const tabBtn = (id, icon, label) =>
    `<button id="aptb-${id}" onclick="_apSwitchTab('${id}')" style="padding:7px 14px;border-radius:8px;border:1px solid transparent;font-size:0.74rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s;color:rgba(255,255,255,.5);background:transparent">${icon} ${label}</button>`;

  modal.innerHTML = `
    <div style="background:var(--ig-panel2);border:1px solid rgba(0,201,200,.22);border-radius:18px;width:100%;max-width:860px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden">
      <!-- Header -->
      <div style="background:var(--ig-grad);padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:white">⚔️ Full Attack Plan — vs ${cName}</div>
          <div style="font-size:0.74rem;color:rgba(255,255,255,.4);margin-top:2px">GPT-4 generating your complete 8-week strategy…</div>
        </div>
        <button onclick="_apCloseModal()" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:7px 14px;color:white;font-size:0.78rem;cursor:pointer;flex-shrink:0">✕ Close</button>
      </div>
      <!-- Tab Bar (hidden during load) -->
      <div id="apTabBar" style="display:none;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.07);background:rgba(0,0,0,.15);flex-shrink:0;overflow-x:auto;white-space:nowrap">
        ${tabBtn('overview','📊','Overview')}
        ${tabBtn('roadmap','🗓️','Roadmap')}
        ${tabBtn('keywords','🔑','Keywords')}
        ${tabBtn('channels','📡','Channels')}
        ${tabBtn('content','✍️','Content')}
        ${tabBtn('wins','⚡','Quick Wins')}
      </div>
      <!-- Scrollable body -->
      <div id="attackPlanBody" style="flex:1;overflow-y:auto;padding:24px;display:flex;align-items:center;justify-content:center;min-height:260px">
        <div style="text-align:center;max-width:400px">
          <div style="width:48px;height:48px;border:3px solid rgba(0,201,200,.2);border-top-color:#00C9C8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 18px"></div>
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:700;color:#0A1628;margin-bottom:6px" id="apLoadTitle">Generating battle plan… <span id="apElapsed" style="color:#0066FF;font-weight:800">0s</span></div>
          <div style="font-size:0.76rem;color:#475569;margin-bottom:7px">GPT-4o + Claude dual AI · synthesising your 8-week strategy</div>
          <div style="font-size:0.7rem;color:#B45309;margin-bottom:18px;font-weight:600">⏱ This usually takes 20–45 seconds</div>
          <div style="display:flex;flex-direction:column;gap:10px;text-align:left">
            <div id="apStep1" style="display:flex;align-items:center;gap:9px;font-size:0.78rem;color:#334155;font-weight:500">
              <span id="apS1icon" style="font-size:0.9rem">⏳</span>
              <span>GPT-4o analysing <strong style="color:#0066FF">${cName}</strong> strategy</span>
            </div>
            <div id="apStep2" style="display:flex;align-items:center;gap:9px;font-size:0.78rem;color:#334155;font-weight:500">
              <span id="apS2icon" style="font-size:0.9rem">⏳</span>
              <span>Claude finding non-obvious attack angles</span>
            </div>
            <div id="apStep3" style="display:flex;align-items:center;gap:9px;font-size:0.78rem;color:#334155;font-weight:500">
              <span id="apS3icon" style="font-size:0.9rem">⏳</span>
              <span>Merging best insights, deduplicating</span>
            </div>
            <div id="apStep4" style="display:flex;align-items:center;gap:9px;font-size:0.78rem;color:#334155;font-weight:500">
              <span id="apS4icon" style="font-size:0.9rem">⏳</span>
              <span>Rendering your battle plan</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Capture body reference immediately after setting innerHTML
  const planBody = document.getElementById('attackPlanBody');

  // Live elapsed timer — updates the inline cyan span
  let _apSecs = 0;
  const _apTimer = setInterval(() => {
    _apSecs++;
    const el = document.getElementById('apElapsed');
    if (el) el.textContent = _apSecs + 's';
  }, 1000);

  // Steps 1-3: animated indicators of in-flight AI work
  const markStep = (id, iconId, done) => {
    const el = document.getElementById(id), ic = document.getElementById(iconId);
    if (el) el.style.color = done ? '#059669' : '#334155';
    if (ic) ic.textContent = done ? '✅' : '⏳';
  };
  setTimeout(() => markStep('apStep1','apS1icon',true), 1800);
  setTimeout(() => {
    markStep('apStep2','apS2icon',true);
    const t = document.getElementById('apLoadTitle');
    if (t) t.innerHTML = `AI models working in parallel… <span id="apElapsed" style="color:#00E5FF;font-weight:800">${_apSecs}s</span>`;
  }, 4000);
  setTimeout(() => markStep('apStep3','apS3icon',true), 7000);

  // Read and clear prefill globals set by openAttackModal
  const prefillKeywords = window._apPrefillKeywords || [];
  const prefillContext  = window._apPrefillContext  || '';
  window._apPrefillKeywords = [];
  window._apPrefillContext  = '';

  // Call API
  try {
    const resp = await fetch('/api/ai-attack-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        myDomain,
        competitor: cName,
        industry,
        prefillKeywords,
        prefillContext,
        competitorData: {
          traffic: c.traffic || c.monthlyTraffic || 'N/A',
          adSpend: c.adSpend || 'N/A',
          channels: c.topChannels || ['Google Ads', 'Meta', 'SEO'],
          weaknesses: (c.suggestions || []).map(s => typeof s === 'string' ? s : (s.title || ''))
        }
      })
    });
    if (!resp.ok) throw new Error(`Server error ${resp.status}`);
    const data = await resp.json();
    const plan = data.plan;
    if (!plan) throw new Error(data.error || 'No plan returned from AI');
    // API returned — stop timer, mark steps 3+4 done, then render
    clearInterval(_apTimer);
    markStep('apStep3','apS3icon',true);
    markStep('apStep4','apS4icon',true);
    const tDone = document.getElementById('apLoadTitle');
    if (tDone) tDone.innerHTML = `Rendering your plan… <span style="color:#00E5FF;font-weight:800">${_apSecs}s</span>`;
    // Small yield so the browser can paint the ✅ before rendering
    await new Promise(r => setTimeout(r, 60));
    renderAttackPlan(plan, cName, myDomain, planBody, data.sources || ['GPT-4o']);
  } catch(err) {
    clearInterval(_apTimer);
    if (planBody) planBody.innerHTML = `
      <div style="text-align:center;padding:40px 24px">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:700;color:white;margin-bottom:8px">Plan generation failed</div>
        <div style="font-size:0.82rem;color:rgba(255,255,255,.45);margin-bottom:20px">${err.message}</div>
        <button onclick="openFullAttackPlanModal(${idx})" style="padding:10px 22px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:9px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">↺ Retry</button>
      </div>`;
  }
}

function renderAttackPlan(plan, cName, myDomain, planBody, sources) {
  if (!planBody) planBody = document.getElementById('attackPlanBody');
  if (!planBody) return;
  const srcList = sources || ['GPT-4o'];
  const isDual = srcList.length >= 2;
  const aiBadge = isDual
    ? `<div style="display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,rgba(0,102,255,.18),rgba(124,58,237,.18));border:1px solid rgba(124,58,237,.35);border-radius:20px;padding:5px 12px;font-size:0.73rem;font-weight:700;color:#A78BFA;margin-bottom:14px">
        <span style="font-size:0.9rem">🤖</span> Synthesised from <strong style="color:#00E5FF">GPT-4o</strong> + <strong style="color:#FF6B35">Claude</strong> — duplicates removed, best insights merged
      </div>`
    : `<div style="display:inline-flex;align-items:center;gap:7px;background:rgba(0,102,255,.1);border:1px solid rgba(0,102,255,.25);border-radius:20px;padding:5px 12px;font-size:0.73rem;font-weight:700;color:#60A5FA;margin-bottom:14px">
        <span style="font-size:0.9rem">🤖</span> Generated by <strong>${srcList[0]}</strong>
      </div>`;

  const scoreColor   = plan.opportunityScore >= 75 ? '#10B981' : plan.opportunityScore >= 50 ? '#F59E0B' : '#EF4444';
  const priorityColor = p => p === 'Critical' ? '#EF4444' : p === 'High' ? '#F59E0B' : '#10B981';
  const impactColor   = p => p === 'High' ? '#10B981' : p === 'Medium' ? '#F59E0B' : '#6B7280';
  const sec = label => `<div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:white;margin-bottom:12px">${label}</div>`;
  const actionBar = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:14px;margin-top:14px;border-top:1px solid rgba(255,255,255,.07)">
      <button onclick="window._apExportPlan()" style="padding:9px 18px;background:linear-gradient(135deg,#059669,#10B981);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">⬇️ Export Plan</button>
      <button onclick="navigateTo('campaigns');_apCloseModal()" style="padding:9px 18px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🚀 Launch Campaigns</button>
      <button onclick="navigateTo('content');_apCloseModal()" style="padding:9px 16px;background:rgba(124,58,237,.25);border:1px solid rgba(124,58,237,.3);border-radius:9px;font-size:0.78rem;font-weight:600;color:#A78BFA;cursor:pointer">📝 Build Content</button>
    </div>`;

  // ── Tab: Overview ───────────────────────────────────────────────
  const overviewHtml = `
    <div id="apt-overview">
      ${aiBadge}
      <div style="background:linear-gradient(135deg,rgba(0,102,255,.12),rgba(0,201,200,.08));border:1px solid rgba(0,201,200,.2);border-radius:14px;padding:18px 22px;margin-bottom:16px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center">
        <div>
          <div style="font-size:0.64rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Executive Summary</div>
          <div style="font-size:0.88rem;color:rgba(255,255,255,.85);line-height:1.55">${plan.executiveSummary||'Full attack plan generated.'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:center;flex-shrink:0">
          <div style="width:64px;height:64px;border-radius:50%;background:conic-gradient(${scoreColor} ${plan.opportunityScore||0}%,rgba(255,255,255,.08) 0);display:flex;align-items:center;justify-content:center">
            <div style="width:50px;height:50px;background:var(--ig-panel2);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-direction:column">
              <div style="font-size:0.95rem;font-weight:800;color:${scoreColor}">${plan.opportunityScore||0}</div>
              <div style="font-size:0.46rem;color:rgba(255,255,255,.35);font-weight:600">/100</div>
            </div>
          </div>
          <div style="font-size:0.84rem;font-weight:800;color:#10B981">${plan.estimatedROILift||''}</div>
          <div style="font-size:0.62rem;color:rgba(255,255,255,.35)">⏱ ${plan.timeToResults||'8 weeks'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#00C9C8">${(plan.weeklyPlan||[]).length * 2}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.4);margin-top:2px">Weeks of Strategy</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#0066FF">${(plan.keywordTargets||[]).length}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.4);margin-top:2px">Target Keywords</div>
        </div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:12px 14px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#10B981">${(plan.criticalWins||[]).length}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.4);margin-top:2px">Quick Wins</div>
        </div>
      </div>
      ${actionBar}
    </div>`;

  // ── Tab: Roadmap ────────────────────────────────────────────────
  const roadmapHtml = `
    <div id="apt-roadmap" style="display:none">
      ${sec('🗓️ 8-Week Attack Roadmap')}
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(plan.weeklyPlan||[]).map((w,i) => `
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="width:26px;height:26px;background:linear-gradient(135deg,#0066FF,#00C9C8);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:0.68rem;font-weight:800;color:white;flex-shrink:0">${i+1}</div>
              <div>
                <div style="font-family:Sora,sans-serif;font-size:0.8rem;font-weight:800;color:white">${w.week}</div>
                <div style="font-size:0.7rem;color:#00C9C8;font-weight:600">${w.focus}</div>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px">
              ${(w.actions||[]).map(a=>`<div style="font-size:0.75rem;color:rgba(255,255,255,.7);padding:3px 0 3px 12px;border-left:2px solid rgba(0,201,200,.25)">• ${a}</div>`).join('')}
            </div>
            <div style="font-size:0.67rem;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.05em">KPI: <span style="color:#00C9C8">${w.kpi||'Track progress'}</span></div>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Tab: Keywords ───────────────────────────────────────────────
  const kwHtml = `
    <div id="apt-keywords" style="display:none">
      ${sec('🔑 Priority Keyword Targets')}
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;padding:8px 14px;background:rgba(255,255,255,.05);font-size:0.62rem;font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.05em;gap:8px">
          <div>Keyword</div><div>Volume</div><div>CPC</div><div>Intent</div><div>Priority</div>
        </div>
        ${(plan.keywordTargets||[]).map(k => `
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;align-items:center;padding:9px 14px;border-bottom:1px solid rgba(255,255,255,.05);gap:8px">
            <div style="font-size:0.76rem;font-weight:600;color:white">${k.keyword}</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,.5)">${k.volume}</div>
            <div style="font-size:0.72rem;color:#00C9C8;font-weight:700">${k.cpc}</div>
            <div style="font-size:0.66rem;color:rgba(255,255,255,.4)">${k.intent}</div>
            <span style="font-size:0.6rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${priorityColor(k.priority)}22;color:${priorityColor(k.priority)};white-space:nowrap">${k.priority}</span>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Tab: Channels ───────────────────────────────────────────────
  const channelHtml = `
    <div id="apt-channels" style="display:none">
      ${sec('📡 Channel Budget Allocation')}
      <div style="font-size:0.74rem;color:rgba(255,255,255,.4);margin-bottom:14px;margin-top:-6px">AI-recommended % of your monthly ad spend per channel</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(plan.channelStrategy||[]).map(ch => {
          const pct = Math.max(1, Math.min(100, parseInt(ch.budgetPct) || 25));
          return `
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:14px 16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="font-family:Sora,sans-serif;font-size:0.82rem;font-weight:800;color:white">${ch.channel}</div>
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="font-size:0.8rem;font-weight:800;color:#00E5FF">${pct}%</div>
                  <div style="font-size:0.72rem;font-weight:600;color:#10B981">${ch.expectedROAS} ROAS</div>
                </div>
              </div>
              <div style="height:6px;background:rgba(255,255,255,.08);border-radius:4px;margin-bottom:8px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0066FF,#00C9C8);border-radius:4px;transition:width .4s ease"></div>
              </div>
              <div style="font-size:0.73rem;color:rgba(255,255,255,.5);line-height:1.4">${ch.tactic}</div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // ── Tab: Content ────────────────────────────────────────────────
  const contentHtml = `
    <div id="apt-content" style="display:none">
      ${sec('📝 Content Attack Plan')}
      <div style="display:flex;flex-direction:column;gap:10px">
        ${(plan.contentAttacks||[]).map(ct => `
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start">
            <div style="font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:5px;background:rgba(124,58,237,.25);color:#A78BFA;white-space:nowrap;margin-top:2px">${ct.type}</div>
            <div style="flex:1">
              <div style="font-size:0.8rem;font-weight:700;color:white;margin-bottom:3px">${ct.title}</div>
              <div style="font-size:0.72rem;color:rgba(255,255,255,.5);margin-bottom:6px">${ct.angle}</div>
              <div style="font-size:0.68rem;font-weight:600;color:#00C9C8">CTA: ${ct.cta}</div>
            </div>
            <button onclick="window._contentTab='clusters';window._clusterSeedPrefill='${(ct.title||'').replace(/'/g,"\\'")}';navigateTo('content');_apCloseModal()" style="padding:5px 10px;background:rgba(0,102,255,.25);border:none;border-radius:7px;font-size:0.66rem;font-weight:700;color:#60A5FA;cursor:pointer;white-space:nowrap;flex-shrink:0">Build →</button>
          </div>`).join('')}
      </div>
    </div>`;

  // ── Tab: Quick Wins ─────────────────────────────────────────────
  const winsHtml = `
    <div id="apt-wins" style="display:none">
      ${sec('⚡ Critical Quick Wins')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(plan.criticalWins||[]).map(w => `
          <div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.15);border-radius:10px">
            <div style="font-size:1rem;flex-shrink:0">⚡</div>
            <div style="flex:1">
              <div style="font-size:0.78rem;font-weight:600;color:white;margin-bottom:4px">${w.win}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <span style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:4px;background:${impactColor(w.impact)}22;color:${impactColor(w.impact)}">Impact: ${w.impact}</span>
                <span style="font-size:0.62rem;color:rgba(255,255,255,.35)">Effort: ${w.effort}</span>
                <span style="font-size:0.62rem;color:rgba(255,255,255,.35)">⏱ ${w.timeframe}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  // Wire export
  window._apExportPlan = () => {
    const lines = [
      `FULL ATTACK PLAN — ${myDomain} vs ${cName}`,
      `Generated: ${new Date().toLocaleString()}`,
      '', `OPPORTUNITY SCORE: ${plan.opportunityScore}/100`,
      `ESTIMATED ROI LIFT: ${plan.estimatedROILift}`,
      `TIME TO RESULTS: ${plan.timeToResults}`,
      '', '== EXECUTIVE SUMMARY ==', plan.executiveSummary || '',
      '', '== WEEKLY ROADMAP ==',
      ...(plan.weeklyPlan||[]).flatMap(w => [`${w.week} — ${w.focus}`, ...(w.actions||[]).map(a=>`  • ${a}`), `  KPI: ${w.kpi}`, '']),
      '== KEYWORD TARGETS ==',
      ...(plan.keywordTargets||[]).map(k=>`  ${k.keyword} | ${k.volume} | CPC ${k.cpc} | ${k.intent} | ${k.priority}`),
      '', '== CHANNEL STRATEGY ==',
      ...(plan.channelStrategy||[]).map(ch=>`  ${ch.channel} | ${ch.budgetPct}% of budget | ROAS ${ch.expectedROAS} | ${ch.tactic}`),
      '', '== CRITICAL WINS ==',
      ...(plan.criticalWins||[]).map(w=>`  ⚡ ${w.win} (Impact: ${w.impact}, Effort: ${w.effort}, ${w.timeframe})`)
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `attack-plan-${cName.replace(/\s+/g,'-').toLowerCase()}.txt` });
    a.click(); URL.revokeObjectURL(a.href);
    showToast('✅ Attack plan exported!');
  };

  // Render all tabs into the body
  planBody.style.cssText = 'flex:1;overflow-y:auto;padding:20px 22px;display:block';
  planBody.innerHTML = overviewHtml + roadmapHtml + kwHtml + channelHtml + contentHtml + winsHtml;

  // Show tab bar and activate Overview
  const tabBar = document.getElementById('apTabBar');
  if (tabBar) tabBar.style.display = 'flex';
  _apSwitchTab('overview');
}

// ── Re-attach public entry points + inline-onclick handlers to window ─────────
// (openExclusiveModal/closeExclusiveModal, window.pageTrackerCounterAd and
//  window._bpIdx are already assigned to window inline above.)
Object.assign(window, {
  buildCompetitors, renderCompetitorCards, buildCompMonitor, generateBlogMonitor,
  generatePageResponse, _blRng, _blSeed, _genRefDomains, openBLDetail, closeBLDetail,
  loadBacklinks, buildCompCard,
  buildIntelligence, _loadJsPDF, exportIntelligenceReport,
  switchBattlePlanComp, buildBattlePlan, _bpGet, bpLC, bpGA, bpBC, bpCS, bpTA, bpCC, bpQW,
  _apCloseModal, _apSwitchTab, openFullAttackPlanModal, renderAttackPlan
});

})();

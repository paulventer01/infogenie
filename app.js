// ============================================================
// InfoGenie — Main Application Controller
// ============================================================

let currentView = 'home';
let analysisData = null;
let ctrChartInstance = null;
let roasChartInstance = null;
let trendChartInstance = null;

// ===== NAVIGATION =====
function navigateTo(viewId, updateActive = true) {
  document.querySelectorAll('.view').forEach(v => {
    v.style.display = 'none';
    v.classList.remove('active');
  });
  const target = document.getElementById('view-' + viewId);
  if (target) {
    target.classList.remove('hidden');
    target.style.display = 'block';
    target.classList.add('active');
  }
  currentView = viewId;
  if (updateActive) {
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.view === viewId);
    });
  }
  // Show/hide navbar links for home vs app
  const navLinks = document.getElementById('navLinks');
  const navPlan = document.getElementById('navPlanBadge');
  const navBtn = document.getElementById('navAnalyseBtn');
  if (viewId === 'home') {
    navLinks.style.display = 'flex';
    navPlan.style.display = 'none';
    navBtn.style.display = 'none';
  } else {
    navLinks.style.display = 'flex';
    navPlan.style.display = 'block';
    navBtn.style.display = 'block';
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== ANALYSIS FLOW =====
async function runAnalysis(url, country) {
  if (!url || url.trim().length < 3) {
    showToast('⚠️ Please enter a valid website URL to analyse');
    return;
  }
  
  const cleanUrl = url.replace(/https?:\/\//,'').replace(/www\./,'').trim();
  const industryKey = detectIndustry(cleanUrl);
  const industry = INDUSTRY_DB[industryKey];
  const websiteKPIs = generateWebsiteKPIs(cleanUrl, industryKey);
  
  // Show loading
  const overlay = document.getElementById('loadingOverlay');
  overlay.classList.remove('hidden');
  overlay.style.display = 'flex';
  
  // Animate loading steps
  const steps = [
    { id: 'lst1', label: `Detecting industry: ${industry.name}`, duration: 1200 },
    { id: 'lst2', label: `Found ${industry.competitors.length} top competitors in ${industry.name}`, duration: 1400 },
    { id: 'lst3', label: 'Analysing campaign performance, CTR, and ROAS...', duration: 1600 },
    { id: 'lst4', label: 'Generating AI campaign recommendations...', duration: 1400 },
    { id: 'lst5', label: 'Building full intelligence report...', duration: 1000 }
  ];
  
  const bar = document.getElementById('loadingBarFill');
  const pct = document.getElementById('loadingPct');
  const statusText = document.getElementById('loadingStatusText');
  
  // Reset steps
  steps.forEach(s => {
    const el = document.getElementById(s.id);
    el.classList.remove('active', 'done');
    el.querySelector('.lstep-check').classList.add('hidden');
  });
  
  bar.style.width = '0%';
  pct.textContent = '0%';
  
  let cumulativeTime = 0;
  const totalTime = steps.reduce((a, s) => a + s.duration, 0);
  
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const el = document.getElementById(s.id);
    el.classList.add('active');
    statusText.textContent = s.label;
    
    await wait(s.duration);
    
    cumulativeTime += s.duration;
    const progress = Math.round((cumulativeTime / totalTime) * 100);
    bar.style.width = progress + '%';
    pct.textContent = progress + '%';
    
    el.classList.remove('active');
    el.classList.add('done');
    el.querySelector('.lstep-check').classList.remove('hidden');
    el.querySelector('.lstep-dot').style.background = 'var(--green)';
  }
  
  bar.style.width = '100%';
  pct.textContent = '100%';
  statusText.textContent = '✅ Intelligence report ready!';
  
  await wait(600);
  overlay.style.display = 'none';
  overlay.classList.add('hidden');
  
  // Store analysis data
  analysisData = { url: cleanUrl, country, industryKey, industry, websiteKPIs, competitors: industry.competitors };
  
  // Build all views
  buildDashboard();
  buildCompetitors();
  buildCampaigns();
  buildAudience();
  buildCreative();
  buildIntelligence();
  
  // Navigate first so a settings error never blocks the dashboard
  navigateTo('dashboard');
  showToast(`✅ Analysis complete for ${cleanUrl} — ${industry.competitors.length} competitors found in ${industry.name}`);
  
  // Build settings after navigation (non-critical)
  try { buildSettings(); } catch(e) { console.warn('Settings build error:', e); }
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== BUILD DASHBOARD =====
function buildDashboard() {
  const { url, country, industry, websiteKPIs, competitors } = analysisData;
  
  // Title
  document.getElementById('dashTitle').textContent = `Intelligence Report: ${url}`;
  document.getElementById('dashSub').textContent = `${industry.name} · ${competitors.length} competitors analysed · AI recommendations generated`;
  
  // Analysis tags
  const tagsEl = document.getElementById('analysisTags');
  const countryLabel = getCountryLabel(analysisData.country);
  tagsEl.innerHTML = `
    <span class="atag">${industry.name}</span>
    <span class="atag">${countryLabel}</span>
    <span class="atag">${competitors.length} Competitors</span>
    <span class="atag live-tag"><span class="live-dot-inline"></span>Live Intel</span>
  `;
  
  // KPIs
  const avgCTR = avg(competitors.map(c => parseFloat(c.ctr)));
  const avgROAS = avg(competitors.map(c => c.roas));
  const yourCTR = websiteKPIs.ctr;
  const yourROAS = websiteKPIs.roas;
  
  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = `
    <div class="kpi-card kpi-blue">
      <div class="kpi-icon">📊</div>
      <div class="kpi-label">Your Avg CTR</div>
      <div class="kpi-value">${yourCTR}%</div>
      <div class="kpi-change ${yourCTR >= avgCTR ? 'kpi-up' : 'kpi-down'}">
        ${yourCTR >= avgCTR ? '▲' : '▼'} ${Math.abs(yourCTR - avgCTR).toFixed(2)}% vs. market avg
      </div>
    </div>
    <div class="kpi-card kpi-teal">
      <div class="kpi-icon">🎯</div>
      <div class="kpi-label">Your ROAS</div>
      <div class="kpi-value">${yourROAS}×</div>
      <div class="kpi-change ${yourROAS >= avgROAS ? 'kpi-up' : 'kpi-down'}">
        ${yourROAS >= avgROAS ? '▲' : '▼'} ${Math.abs(yourROAS - avgROAS).toFixed(1)}× vs. market avg
      </div>
    </div>
    <div class="kpi-card kpi-green">
      <div class="kpi-icon">💰</div>
      <div class="kpi-label">Your CPA</div>
      <div class="kpi-value">$${websiteKPIs.cpa}</div>
      <div class="kpi-change kpi-up">▼ 35% improvement possible</div>
    </div>
    <div class="kpi-card kpi-gold">
      <div class="kpi-icon">👥</div>
      <div class="kpi-label">Est. Monthly Traffic</div>
      <div class="kpi-value">${formatNum(websiteKPIs.trafficMo)}</div>
      <div class="kpi-change kpi-up">▲ 22% growth opportunity</div>
    </div>
    <div class="kpi-card kpi-purple">
      <div class="kpi-icon">📈</div>
      <div class="kpi-label">Conversion Rate</div>
      <div class="kpi-value">${websiteKPIs.convRate}%</div>
      <div class="kpi-change ${websiteKPIs.convRate >= 3 ? 'kpi-up' : 'kpi-down'}">
        Market avg: ${(3.1).toFixed(1)}%
      </div>
    </div>
    <div class="kpi-card kpi-blue">
      <div class="kpi-icon">🚀</div>
      <div class="kpi-label">AI Opportunity Score</div>
      <div class="kpi-value">${calcOpportunityScore(websiteKPIs, avgCTR, avgROAS)}/100</div>
      <div class="kpi-change kpi-up">▲ High growth potential</div>
    </div>
  `;
  
  // ROI Banner
  const improvedROAS = (avgROAS * 1.28).toFixed(1);
  const cpaReduction = 35;
  const convLift = 25;
  document.getElementById('roiBanner').innerHTML = `
    <div class="roi-content">
      <div class="roi-label">🤖 InfoGenie ROI Projection</div>
      <div class="roi-title">Implementing InfoGenie's AI recommendations could deliver:</div>
      <div class="roi-sub">Based on analysis of ${competitors.length} competitors in ${industry.name} and your current performance data</div>
    </div>
    <div class="roi-metrics">
      <div class="roi-metric">
        <div class="roi-metric-val" style="color:#00C9C8">+${improvedROAS}×</div>
        <div class="roi-metric-lbl">Projected ROAS</div>
      </div>
      <div class="roi-metric">
        <div class="roi-metric-val" style="color:#10B981">-${cpaReduction}%</div>
        <div class="roi-metric-lbl">CPA Reduction</div>
      </div>
      <div class="roi-metric">
        <div class="roi-metric-val" style="color:#F59E0B">+${convLift}%</div>
        <div class="roi-metric-lbl">Conversion Lift</div>
      </div>
      <div class="roi-metric">
        <div class="roi-metric-val" style="color:#7C3AED">3.2×</div>
        <div class="roi-metric-lbl">Avg ROAS Lift</div>
      </div>
    </div>
  `;
  
  // Charts
  renderCTRChart(competitors, yourCTR);
  renderROASChart(competitors, yourROAS);
  renderTrendChart(competitors);
  
  // Summary table
  const tbody = document.getElementById('compSummaryBody');
  tbody.innerHTML = competitors.map(c => `
    <tr>
      <td>
        <div class="comp-name-cell">
          <div class="comp-favicon">${c.logo}</div>
          ${c.name}
        </div>
      </td>
      <td>${c.traffic}</td>
      <td><strong>${c.ctr}</strong></td>
      <td><strong>${c.roas}×</strong></td>
      <td>${c.adSpend}</td>
      <td>${c.topChannel}</td>
      <td><span class="threat-badge threat-${c.threatLevel}">${cap(c.threatLevel)} Threat</span></td>
    </tr>
  `).join('');
}

function renderCTRChart(competitors, yourCTR) {
  if (ctrChartInstance) ctrChartInstance.destroy();
  const ctx = document.getElementById('ctrChart').getContext('2d');
  const labels = ['Your Site', ...competitors.map(c => c.name)];
  const data = [yourCTR, ...competitors.map(c => parseFloat(c.ctr))];
  const colors = ['rgba(0,201,200,0.85)', ...competitors.map(() => 'rgba(0,102,255,0.7)')];
  const borders = ['#00C9C8', ...competitors.map(() => '#0066FF')];
  
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
  if (roasChartInstance) roasChartInstance.destroy();
  const ctx = document.getElementById('roasChart').getContext('2d');
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
  if (trendChartInstance) trendChartInstance.destroy();
  const ctx = document.getElementById('trendChart').getContext('2d');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  
  const palette = [
    { bg: 'rgba(0,201,200,0.15)', border: '#00C9C8' },
    { bg: 'rgba(0,102,255,0.12)', border: '#0066FF' },
    { bg: 'rgba(124,58,237,0.12)', border: '#7C3AED' },
    { bg: 'rgba(245,158,11,0.12)', border: '#F59E0B' },
    { bg: 'rgba(16,185,129,0.12)', border: '#10B981' }
  ];
  
  const datasets = competitors.slice(0, 5).map((c, i) => {
    const baseTraffic = parseFloat(c.traffic.replace(/[^0-9.]/g,''));
    const multiplier = c.traffic.includes('B') ? 1000 : c.traffic.includes('M') ? 1 : 0.001;
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

// ===== BUILD COMPETITORS =====
function buildCompetitors() {
  const { competitors } = analysisData;
  
  // Populate filter select
  const sel = document.getElementById('compFilterSel');
  sel.innerHTML = '<option value="all">All Competitors</option>' +
    competitors.map(c => `<option value="${c.url}">${c.name}</option>`).join('');
  
  renderCompetitorCards(competitors);
  
  sel.addEventListener('change', () => {
    const val = sel.value;
    if (val === 'all') renderCompetitorCards(competitors);
    else renderCompetitorCards(competitors.filter(c => c.url === val));
  });
}

function renderCompetitorCards(comps) {
  const wrap = document.getElementById('competitorCardsWrap');
  wrap.innerHTML = `<div class="comp-cards-grid">${comps.map(c => buildCompCard(c)).join('')}</div>`;
}

function buildCompCard(c) {
  const campaigns = (c.campaigns || []).map(camp => `
    <div class="campaign-item">
      <div class="ci-name">${camp.name}</div>
      <div class="ci-metrics">
        <span class="ci-metric">Channel: <strong>${camp.channel}</strong></span>
        <span class="ci-metric">CTR: <strong>${camp.ctr}</strong></span>
        <span class="ci-metric">ROAS: <strong>${camp.roas}×</strong></span>
        <span class="ci-metric">Budget: <strong>${camp.budget}</strong></span>
        <span class="ci-metric">Status: <strong style="color:${camp.status==='Active'?'#10B981':camp.status==='Paused'?'#F59E0B':'#94A3B8'}">${camp.status}</strong></span>
      </div>
    </div>
  `).join('');
  
  const suggestions = (c.suggestions || []).map(s => `
    <div class="suggestion-item">
      <div class="sug-icon">💡</div>
      <div class="sug-text">${s}</div>
    </div>
  `).join('');
  
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
          <div class="ckpi"><div class="ckpi-val">${c.ctr}</div><div class="ckpi-lbl">Avg CTR</div></div>
          <div class="ckpi"><div class="ckpi-val">${c.roas}×</div><div class="ckpi-lbl">ROAS</div></div>
          <div class="ckpi"><div class="ckpi-val">${c.traffic}</div><div class="ckpi-lbl">Mo. Traffic</div></div>
          <div class="ckpi"><div class="ckpi-val">${c.adSpend}</div><div class="ckpi-lbl">Ad Spend</div></div>
          <div class="ckpi"><span class="threat-badge threat-${c.threatLevel}">${cap(c.threatLevel)}</span></div>
        </div>
      </div>
      <div class="comp-card-body">
        <div class="comp-sections-grid">
          <div>
            <div class="comp-section-title">Active Campaigns</div>
            <div class="comp-campaigns">${campaigns}</div>
          </div>
          <div>
            <div class="comp-section-title">AI Improvement Suggestions</div>
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
        <div style="margin-top:16px; padding:14px 16px; background:rgba(0,201,200,.04); border:1px solid rgba(0,201,200,.2); border-radius:10px;">
          <span style="font-size:.75rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--teal);">InfoGenie ROI Opportunity: </span>
          <span style="font-size:.875rem; color:var(--gray-700);">${c.estimatedROI}</span>
        </div>
      </div>
    </div>
  `;
}

// ===== BUILD CAMPAIGNS =====
function buildCampaigns() {
  const { url, industry, websiteKPIs, competitors } = analysisData;
  const wrap = document.getElementById('campaignsWrap');
  
  const topComp = competitors[0];
  const avgROAS = avg(competitors.map(c => c.roas));
  const projROAS = (avgROAS * 1.3).toFixed(1);
  
  const campaignRecs = generateCampaignRecs(industry, competitors, url);
  
  const cards = campaignRecs.map((camp, idx) => `
    <div class="camp-card" id="campCard${idx}">
      <span class="camp-type-badge badge-${camp.badgeClass}">${camp.platform}</span>
      <div class="camp-card-title">${camp.name}</div>
      <div class="camp-card-body">${camp.description}</div>
      <div class="camp-card-tags">${camp.tags.map(t => `<span class="camp-tag">${t}</span>`).join('')}</div>
      <div class="camp-metrics-row">
        <div><div class="cm-val">${camp.estCTR}</div><div class="cm-lbl">Est. CTR</div></div>
        <div><div class="cm-val">${camp.estROAS}×</div><div class="cm-lbl">Est. ROAS</div></div>
        <div><div class="cm-val">${camp.estCPA}</div><div class="cm-lbl">Est. CPA</div></div>
        <div><div class="cm-val">${camp.budget}</div><div class="cm-lbl">Min. Budget</div></div>
      </div>
      <div class="camp-card-actions">
        <button class="btn-camp-launch" onclick="openCampModal('${camp.name.replace(/'/g,'')}','${camp.platform}','${camp.budget}',${idx})">🚀 Launch this Campaign</button>
        <button class="btn-camp-preview" onclick="previewCampaignCreative(${idx})">👁 Preview Creative</button>
      </div>
    </div>
  `).join('');
  
  wrap.innerHTML = `
    <div class="camp-hero">
      <div class="camp-hero-title">AI-Powered Campaign Strategy for ${url}</div>
      <div class="camp-hero-sub">Based on analysis of ${competitors.length} competitors in ${industry.name}. Recommendations ranked by projected ROI impact.</div>
      <div class="camp-kpis">
        <div><div class="camp-kpi-val" style="color:var(--teal)">${projROAS}×</div><div class="camp-kpi-lbl">Projected ROAS</div></div>
        <div><div class="camp-kpi-val" style="color:#10B981">-35%</div><div class="camp-kpi-lbl">CPA Reduction</div></div>
        <div><div class="camp-kpi-val" style="color:#F59E0B">+25%</div><div class="camp-kpi-lbl">Conversion Lift</div></div>
        <div><div class="camp-kpi-val" style="color:white">${campaignRecs.length}</div><div class="camp-kpi-lbl">Campaigns Ready</div></div>
      </div>
    </div>
    <div class="camp-grid">${cards}</div>
    
    <div class="data-table-card">
      <div class="dtc-header"><h3>Competitor Campaign Breakdown</h3><span class="atag">Live Intelligence</span></div>
      <div class="table-scroll">
        <table class="ig-table">
          <thead>
            <tr><th>Competitor</th><th>Campaign</th><th>Channel</th><th>CTR</th><th>ROAS</th><th>Budget</th><th>AI Suggestion</th></tr>
          </thead>
          <tbody>
            ${competitors.flatMap(c => (c.campaigns||[]).slice(0,2).map(camp => `
              <tr>
                <td><div class="comp-name-cell"><div class="comp-favicon">${c.logo}</div>${c.name}</div></td>
                <td><strong>${camp.name}</strong></td>
                <td>${camp.channel}</td>
                <td><strong>${camp.ctr}</strong></td>
                <td><strong>${camp.roas}×</strong></td>
                <td>${camp.budget}</td>
                <td style="font-size:.8125rem;color:var(--teal);max-width:240px">${c.suggestions[0]?.substring(0,80)}...</td>
              </tr>
            `)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function generateCampaignRecs(industry, competitors, url) {
  const topCTR = competitors.reduce((a,c) => parseFloat(c.ctr) > parseFloat(a.ctr) ? c : a);
  const topROAS = competitors.reduce((a,c) => c.roas > a.roas ? c : a);
  
  return [
    {
      platform: 'Google Ads',
      badgeClass: 'google',
      name: `Search Domination — ${industry.name} Keywords`,
      description: `Target the highest-intent keywords your competitors are bidding on. InfoGenie identified ${topCTR.topKeywords?.join(', ')} as high-opportunity terms where ${topCTR.name} achieves ${topCTR.ctr} CTR. Your improved copy can outperform by 20–35%.`,
      tags: topCTR.topKeywords?.slice(0,3) || ['high intent', 'competitor keywords', 'search'],
      estCTR: (parseFloat(topCTR.ctr) * 1.22).toFixed(1) + '%',
      estROAS: (topCTR.roas * 1.18).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 40 + 25),
      budget: '$2,000/mo'
    },
    {
      platform: 'Meta Ads',
      badgeClass: 'meta',
      name: `Lookalike Audience — High-Value Segments`,
      description: `Deploy Meta campaigns targeting lookalike audiences of ${topROAS.name}'s highest-converting segments. ${topROAS.name} achieves ${topROAS.roas}× ROAS — InfoGenie's improved creative strategy projects ${(topROAS.roas * 1.15).toFixed(1)}× for your campaigns.`,
      tags: ['Lookalike Audiences', 'Interest Targeting', 'Retargeting', 'Video Creative'],
      estCTR: (parseFloat(topROAS.ctr) * 1.15).toFixed(1) + '%',
      estROAS: (topROAS.roas * 1.15).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 35 + 20),
      budget: '$3,000/mo'
    },
    {
      platform: 'TikTok Ads',
      badgeClass: 'tiktok',
      name: `TikTok Competitor Gap — Untapped Reach`,
      description: `Most competitors in ${industry.name} have minimal TikTok presence despite high target audience overlap. InfoGenie identified a significant organic reach gap — short-form video campaigns here can achieve 3–5× better CPM than Google/Meta.`,
      tags: ['Short-form Video', 'UGC Style', 'Spark Ads', 'In-Feed Ads'],
      estCTR: '4.8%',
      estROAS: '3.9',
      estCPA: '$' + Math.floor(Math.random() * 28 + 15),
      budget: '$1,500/mo'
    },
    {
      platform: 'AI Optimised',
      badgeClass: 'ai',
      name: `Autonomous A/B Campaign — InfoGenie Engine`,
      description: `InfoGenie's reinforcement learning engine will continuously test and optimise your campaigns across all platforms. The AI automatically pauses underperformers, reallocates budget to winners, and generates new creatives every 72 hours.`,
      tags: ['Auto-optimise', 'Real-time RL', 'Multi-platform', 'Zero Manual Work'],
      estCTR: '5.2%',
      estROAS: (avg(competitors.map(c=>c.roas)) * 1.32).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 22 + 12),
      budget: '$5,000/mo'
    },
    {
      platform: 'Google Ads',
      badgeClass: 'google',
      name: `Performance Max — Full Funnel Automation`,
      description: `Google's Performance Max campaigns combined with InfoGenie's competitor keyword intelligence. Target all Google properties (Search, Display, YouTube, Gmail, Maps) with AI-optimised creative that outperforms the ${competitors[1]?.name} funnel by design.`,
      tags: ['PMax', 'All Google Properties', 'AI Bidding', 'Conversion Focus'],
      estCTR: '3.9%',
      estROAS: (avg(competitors.map(c=>c.roas)) * 1.22).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 38 + 22),
      budget: '$4,000/mo'
    },
    {
      platform: 'Meta Ads',
      badgeClass: 'meta',
      name: `Retargeting Funnel — Competitor Traffic Capture`,
      description: `Deploy cross-platform retargeting to capture users who visited competitor sites. InfoGenie's audience intelligence shows ${competitors[0]?.audiences?.[0]?.label} is your highest-converting competitor audience segment with ${competitors[0]?.audiences?.[0]?.pct}% engagement rate.`,
      tags: ['Retargeting', 'Custom Audiences', 'Competitor Targeting', 'Dynamic Ads'],
      estCTR: '4.1%',
      estROAS: (avg(competitors.map(c=>c.roas)) * 1.28).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 32 + 18),
      budget: '$2,500/mo'
    }
  ];
}

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
  
  const audienceSegments = Object.entries(audienceMap)
    .map(([label, d]) => ({ label, avgPct: Math.round(d.total / d.count), competitors: d.competitors, count: d.count }))
    .sort((a, b) => b.avgPct - a.avgPct)
    .slice(0, 8);
  
  const audienceCards = audienceSegments.map((seg, i) => {
    const score = Math.min(99, 60 + seg.avgPct + seg.count * 8);
    const ctr = (2.8 + i * 0.3 + Math.random() * 0.5).toFixed(1);
    const cpa = Math.floor(20 + i * 8 + Math.random() * 15);
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
          <div class="aud-score-badge">${score}/100</div>
        </div>
        <div class="aud-metrics">
          <div class="aud-metric-item">
            <div class="aud-metric-val">${ctr}%</div>
            <div class="aud-metric-lbl">Avg CTR</div>
          </div>
          <div class="aud-metric-item">
            <div class="aud-metric-val">$${cpa}</div>
            <div class="aud-metric-lbl">Avg CPA</div>
          </div>
          <div class="aud-metric-item">
            <div class="aud-metric-val">${seg.count} competitors</div>
            <div class="aud-metric-lbl">Competing here</div>
          </div>
          <div class="aud-metric-item">
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
        <button class="aud-target-btn" onclick="targetAudience('${seg.label}')">🎯 Auto-Target This Audience</button>
      </div>
    `;
  }).join('');
  
  const wrap = document.getElementById('audienceWrap');
  wrap.innerHTML = `
    <div class="chart-box full" style="margin-bottom:24px">
      <div class="chart-box-header">
        <h3>Audience Engagement Distribution <span class="chart-tag audience-tag">AUDIENCE</span></h3>
      </div>
      <canvas id="audienceChart" height="160"></canvas>
    </div>
    <div class="audience-grid">${audienceCards}</div>
  `;
  
  // Audience chart
  setTimeout(() => {
    const ctx = document.getElementById('audienceChart')?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: audienceSegments.slice(0,6).map(s => s.label),
        datasets: [{
          data: audienceSegments.slice(0,6).map(s => s.avgPct),
          backgroundColor: ['rgba(0,201,200,.8)','rgba(0,102,255,.8)','rgba(124,58,237,.8)','rgba(245,158,11,.8)','rgba(16,185,129,.8)','rgba(239,68,68,.8)'],
          borderWidth: 2,
          borderColor: 'white'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'right', labels: { font: { size: 12 }, padding: 16 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}% avg engagement` } }
        }
      }
    });
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
  const aiCards = generateCreatives(industry, competitors, domainName);

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
        <button class="pf-btn active" onclick="filterCreatives('all', this)">All Platforms</button>
        <button class="pf-btn" onclick="filterCreatives('google', this)">Google</button>
        <button class="pf-btn" onclick="filterCreatives('meta', this)">Meta</button>
        <button class="pf-btn" onclick="filterCreatives('tiktok', this)">TikTok</button>
        <button class="pf-btn" onclick="filterCreatives('linkedin', this)">LinkedIn</button>
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

  setTimeout(() => renderCreativeChart(aiCards), 100);
}

function buildCompetitorVsCards(industry, competitors, domainName) {
  const improvements = [
    { ctrBoost: '+1.4%', roasBoost: '+1.2×', cpaReduction: '-28%', audienceBoost: '+35%', reason: 'Hyper-specific value proposition outperforms generic brand messaging' },
    { ctrBoost: '+1.1%', roasBoost: '+0.9×', cpaReduction: '-22%', audienceBoost: '+28%', reason: 'Urgency-driven copy with social proof converts 2.3× better' },
    { ctrBoost: '+1.8%', roasBoost: '+1.4×', cpaReduction: '-31%', audienceBoost: '+42%', reason: 'Competitor weakness targeting drives significantly higher intent' },
    { ctrBoost: '+0.9%', roasBoost: '+0.7×', cpaReduction: '-19%', audienceBoost: '+24%', reason: 'Personalised audience segmentation beats broad targeting' },
    { ctrBoost: '+1.3%', roasBoost: '+1.1×', cpaReduction: '-26%', audienceBoost: '+33%', reason: 'Outcome-focused headlines outperform feature-based messaging' }
  ];

  const infoGenieHeadlines = [
    `Switch from ${competitors[0]?.name} — See Results in 14 Days or Free`,
    `What ${competitors[1]?.name} Won't Tell You About Their Ad Strategy`,
    `${competitors[2]?.name} Spends ${competitors[2]?.adSpend} Monthly — Here's How to Beat Them for Less`,
    `The ${industry.name} Secret That ${competitors[3]?.name} Doesn't Want You to Know`,
    `Outperform ${competitors[4]?.name} — AI-Powered Campaigns. Zero Guesswork.`
  ];

  const infoGenieCopies = [
    `While ${competitors[0]?.name} relies on broad keyword targeting, our AI pinpoints the exact audience segments their campaigns miss — delivering your message at the precise moment they're ready to convert. No wasted spend. No guesswork.`,
    `${competitors[1]?.name}'s generic creative gets lost in the feed. Our AI generates personalised ad variants tailored to each audience segment's language, pain points, and intent signals — driving 2.3× higher engagement at lower cost.`,
    `${competitors[2]?.name} is spending ${competitors[2]?.adSpend}/mo on ads — most of it wasted on the wrong audiences. Our competitor intelligence identifies exactly where their budget bleeds, then targets those gaps with precision campaigns that cost a fraction of the price.`,
    `${competitors[3]?.name}'s audiences are actively looking for a better alternative. Our AI identifies their dissatisfied customer segments and delivers your superior offer at the exact moment they're considering switching. Average CPA reduction: 31%.`,
    `Stop reacting to ${competitors[4]?.name}'s campaigns. Our autonomous AI monitors their every move — new creatives, budget shifts, audience changes — and automatically rebuilds your campaigns to stay one step ahead, 24/7.`
  ];

  return competitors.slice(0, 5).map((comp, i) => {
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

function generateCreatives(industry, competitors, domainName) {
  const topComp = competitors[0];
  const comp2 = competitors[1] || competitors[0];
  const industryName = industry.name.split(' & ')[0];
  const totalCamps = competitors.reduce((a, c) => a + (c.campaigns?.length || 0), 0);

  return [
    {
      type: 'Search Ad — Google',
      platform: 'Google',
      format: 'Responsive Search Ad',
      headline: `${topComp.name} Alternative — ${parseFloat(topComp.roas) > 4 ? '2× Better ROAS' : '40% Lower CPA'}`,
      copy: `Tired of ${topComp.name}'s rising costs and limited transparency? Our AI-powered platform delivers the same reach with ${parseFloat(topComp.ctr)}%+ CTR targeting — at a fraction of the budget. Free 14-day trial. No credit card.`,
      estCTR: (parseFloat(topComp.ctr) + 1.2).toFixed(1) + '%',
      estConv: '3.8%',
      estROAS: (topComp.roas + 1.1).toFixed(1) + '×',
      audiences: topComp.audiences || []
    },
    {
      type: 'Video Ad — Meta',
      platform: 'Meta',
      format: 'Video (15s Reel)',
      headline: `What ${comp2.name} Doesn't Want You to See`,
      copy: `${comp2.name} runs ${comp2.campaigns?.length || 3} active campaigns right now targeting your customers — and you can't see any of them. Until now. InfoGenie exposes every competitor campaign and automatically builds you a version that performs better. See it live.`,
      estCTR: (parseFloat(topComp.ctr) + 1.8).toFixed(1) + '%',
      estConv: '3.1%',
      estROAS: (topComp.roas + 0.8).toFixed(1) + '×',
      audiences: comp2.audiences || []
    },
    {
      type: 'Performance Max — Google',
      platform: 'Google',
      format: 'Performance Max',
      headline: `${industryName} Leaders Are Switching — Here's Why`,
      copy: `${totalCamps} active competitor campaigns are targeting your customers across Google right now. InfoGenie's Performance Max integration analyses all of them and auto-builds a superior campaign — with better creative, smarter bidding, and 35% lower CPA on average.`,
      estCTR: (parseFloat(topComp.ctr) + 0.9).toFixed(1) + '%',
      estConv: '4.2%',
      estROAS: (topComp.roas + 1.4).toFixed(1) + '×',
      audiences: (competitors[2] || competitors[0]).audiences || []
    },
    {
      type: 'Sponsored Content — LinkedIn',
      platform: 'LinkedIn',
      format: 'Sponsored Post + Lead Form',
      headline: `How ${industryName} Teams Cut CPA by 35% in 30 Days`,
      copy: `${comp2.name} achieves ${comp2.roas}× ROAS with a ${comp2.adSpend} monthly budget. Our analysis shows you can outperform that with precision B2B targeting, personalised ad sequences, and autonomous bidding — without their budget. Download the free strategy report.`,
      estCTR: '3.4%',
      estConv: '5.1%',
      estROAS: (topComp.roas + 0.6).toFixed(1) + '×',
      audiences: (competitors[3] || competitors[0]).audiences || []
    },
    {
      type: 'TikTok UGC Ad',
      platform: 'TikTok',
      format: 'In-Feed Video (30s)',
      headline: `POV: AI just exposed every ${comp2.name} campaign running right now`,
      copy: `We analysed ${topComp.name}, ${comp2.name}, and ${competitors[2]?.name || 'all top competitors'} — every ad they're running, every audience they're targeting, every budget they're spending. Then we built you a better version of all of it. Automatically. This is the unfair advantage.`,
      estCTR: (parseFloat(topComp.ctr) + 2.1).toFixed(1) + '%',
      estConv: '2.6%',
      estROAS: (topComp.roas + 0.5).toFixed(1) + '×',
      audiences: (competitors[4] || competitors[0]).audiences || []
    },
    {
      type: 'Retargeting — Meta',
      platform: 'Meta',
      format: 'Dynamic Carousel',
      headline: `You Visited ${topComp.name}. Here's What They're Not Telling You.`,
      copy: `You've seen ${topComp.name}'s campaigns. But what you haven't seen is that their average customer acquisition cost is ${topComp.campaigns?.[0]?.roas ? Math.round(100 / topComp.campaigns[0].roas) + '% higher' : '40% higher'} than alternatives. We can deliver the same results — with full transparency and autonomous AI optimisation — for a fraction of their budget.`,
      estCTR: (parseFloat(topComp.ctr) + 1.5).toFixed(1) + '%',
      estConv: '4.6%',
      estROAS: (topComp.roas + 1.3).toFixed(1) + '×',
      audiences: topComp.audiences || []
    }
  ];
}

function renderCreativeChart(creatives) {
  const ctx = document.getElementById('creativeChart')?.getContext('2d');
  if (!ctx) return;
  const labels = creatives.map(c => c.platform + ' · ' + c.format.split(' ')[0]);
  const ctrs = creatives.map(c => parseFloat(c.estCTR));
  const roas = creatives.map(c => parseFloat(c.estROAS));

  new Chart(ctx, {
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

function filterCreatives(platform, btn) {
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

// ===================================================
// INTEGRATIONS DATA
// ===================================================
const INTEGRATIONS = {
  platforms: {
    label: 'Ad Platforms',
    icon: '🚀',
    desc: 'Connect your advertising accounts to let InfoGenie autonomously create, launch, and optimise campaigns across every major platform.',
    badge: '7 Platforms',
    items: [
      {
        id: 'google-ads', logo: '🔵', name: 'Google Ads',
        tagline: 'Search, Display, YouTube, Shopping & Performance Max',
        authType: 'oauth',
        unlocks: [
          'Autonomous campaign creation & bidding on all Google properties',
          'Keyword intelligence synced from competitor analysis',
          'Real-time bid optimisation via InfoGenie RL engine',
          'Performance Max campaign auto-configuration'
        ],
        steps: [
          { text: 'Go to <a href="https://ads.google.com" target="_blank">ads.google.com</a> and sign in to your account' },
          { text: 'Navigate to <strong>Tools & Settings → API Centre</strong>' },
          { text: 'Click <strong>Apply for API Access</strong> and complete the form' },
          { text: 'Once approved, copy your <code>Developer Token</code>' },
          { text: 'Click <strong>Connect via OAuth</strong> below — InfoGenie handles the rest' }
        ]
      },
      {
        id: 'meta-ads', logo: '🔷', name: 'Meta Ads Manager',
        tagline: 'Facebook, Instagram, Messenger & Audience Network',
        authType: 'oauth',
        unlocks: [
          'Automated Facebook & Instagram campaign deployment',
          'Lookalike audience creation from competitor intelligence',
          'Dynamic creative testing across audience segments',
          'Real-time ROAS monitoring and budget reallocation'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create an App' },
          { text: 'Add the <strong>Marketing API</strong> product to your app' },
          { text: 'Generate a <strong>System User Access Token</strong> with <code>ads_management</code> permission' },
          { text: 'Note your <strong>Ad Account ID</strong> (format: act_123456789)' },
          { text: 'Click <strong>Connect via OAuth</strong> — InfoGenie will request permissions automatically' }
        ]
      },
      {
        id: 'tiktok-ads', logo: '⬛', name: 'TikTok Ads',
        tagline: 'In-Feed, TopView, Spark Ads & Brand Takeovers',
        authType: 'apikey',
        placeholder: 'TikTok Ads Access Token (Bearer xxxxx...)',
        unlocks: [
          'Short-form video campaign creation and deployment',
          'Spark Ads from organic content amplification',
          'TikTok audience intelligence and targeting',
          'Creative performance tracking and auto-optimisation'
        ],
        steps: [
          { text: 'Visit <a href="https://ads.tiktok.com/marketing_api" target="_blank">TikTok for Business Developers</a>' },
          { text: 'Create a developer account and register your app under <strong>My Apps</strong>' },
          { text: 'Complete the <strong>app review</strong> process (typically 1–3 business days)' },
          { text: 'Once approved, generate an <strong>Access Token</strong> from your app dashboard' },
          { text: 'Note your <strong>Advertiser ID</strong> from TikTok Ads Manager → Account → Advertiser Info' },
          { text: 'Paste your Access Token above and click <strong>Connect</strong>' }
        ]
      },
      {
        id: 'linkedin-ads', logo: '🔷', name: 'LinkedIn Campaign Manager',
        tagline: 'Sponsored Content, Message Ads & Lead Gen Forms',
        authType: 'oauth',
        unlocks: [
          'B2B audience targeting by job title, industry, and company size',
          'Sponsored content and InMail campaign automation',
          'Lead Gen Form integration with CRM sync',
          'LinkedIn Insight Tag conversion tracking'
        ],
        steps: [
          { text: 'Go to <a href="https://developer.linkedin.com" target="_blank">developer.linkedin.com</a> and create an app' },
          { text: 'Add the <strong>Marketing Developer Platform</strong> product' },
          { text: 'Request access to <code>r_ads</code> and <code>rw_ads</code> permissions' },
          { text: 'Generate OAuth 2.0 credentials (Client ID + Client Secret)' },
          { text: 'Click <strong>Connect via OAuth</strong> to authorise InfoGenie' }
        ]
      },
      {
        id: 'x-ads', logo: '🐦', name: 'X (Twitter) Ads',
        tagline: 'Promoted Tweets, Follower Campaigns & App Installs',
        authType: 'apikey',
        placeholder: 'X Ads API Access Token',
        unlocks: [
          'Promoted tweet campaigns targeting competitor followers',
          'Trend-based ad scheduling and real-time campaign pivots',
          'Keyword and hashtag audience targeting',
          'Conversation ads and app install campaigns'
        ],
        steps: [
          { text: 'Apply for <a href="https://developer.twitter.com" target="_blank">X Developer Access</a> at developer.twitter.com' },
          { text: 'Create a Project and App in the developer portal' },
          { text: 'Apply for <strong>Ads API access</strong> (requires a funded ads account)' },
          { text: 'Navigate to <strong>Keys & Tokens</strong> and generate Access Token + Secret' },
          { text: 'Paste your Access Token above and click <strong>Connect</strong>' }
        ]
      },
      {
        id: 'pinterest-ads', logo: '🔴', name: 'Pinterest Ads',
        tagline: 'Promoted Pins, Shopping Campaigns & Video Ads',
        authType: 'oauth',
        unlocks: [
          'Product catalogue and shopping campaign automation',
          'Visual audience discovery and interest targeting',
          'Seasonal campaign scheduling with AI creative generation',
          'Shopping spotlight and collection ads'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.pinterest.com" target="_blank">developers.pinterest.com</a>' },
          { text: 'Create a new app and request <strong>Ads API access</strong>' },
          { text: 'Set your <strong>Redirect URI</strong> to <code>https://app.infogenie.ai/oauth/pinterest</code>' },
          { text: 'Note your App ID and App Secret from the app settings' },
          { text: 'Click <strong>Connect via OAuth</strong> to link your Pinterest Business account' }
        ]
      },
      {
        id: 'amazon-ads', logo: '🟠', name: 'Amazon Ads',
        tagline: 'Sponsored Products, Brands, Display & DSP',
        authType: 'apikey',
        placeholder: 'Amazon Ads API Refresh Token',
        unlocks: [
          'Sponsored Products & Brands campaign automation',
          'Amazon DSP programmatic display campaigns',
          'Keyword harvesting from search term reports',
          'ASIN-level competitor targeting and product ads'
        ],
        steps: [
          { text: 'Sign in to <a href="https://advertising.amazon.com" target="_blank">advertising.amazon.com</a>' },
          { text: 'Navigate to <strong>Account Access → API Access</strong>' },
          { text: 'Create a Security Profile under <strong>Login with Amazon</strong>' },
          { text: 'Use Amazon\'s OAuth flow to generate a <strong>Refresh Token</strong>' },
          { text: 'Note your <strong>Profile IDs</strong> for each marketplace you want to manage' },
          { text: 'Paste your Refresh Token above and click <strong>Connect</strong>' }
        ]
      }
    ]
  },

  intelligence: {
    label: 'Intelligence APIs',
    icon: '🔍',
    desc: 'Power InfoGenie\'s competitor analysis engine with the industry\'s best intelligence data sources — traffic estimates, keyword data, ad libraries, and tech stack detection.',
    badge: '6 Sources',
    items: [
      {
        id: 'semrush', logo: '📊', name: 'Semrush API',
        tagline: 'Keyword rankings, PPC data, backlinks & competitor analysis',
        authType: 'apikey',
        placeholder: 'Semrush API Key (sk_xxxxxxxxxxxx)',
        unlocks: [
          'Competitor keyword rankings and estimated traffic',
          'PPC keyword data with CPC and competition scores',
          'Backlink analysis for domain authority comparison',
          'Display advertising and ad copy intelligence'
        ],
        steps: [
          { text: 'Sign in to <a href="https://semrush.com" target="_blank">semrush.com</a> and go to <strong>Account → API</strong>' },
          { text: 'Subscribe to the <strong>Semrush API</strong> — Business plan or above recommended' },
          { text: 'Copy your <strong>API Key</strong> from the API dashboard' },
          { text: 'Paste your API Key in the field above' },
          { text: 'Click <strong>Test Connection</strong> to verify — InfoGenie will confirm your data units balance' }
        ]
      },
      {
        id: 'similarweb', logo: '🌐', name: 'SimilarWeb API',
        tagline: 'Traffic intelligence, audience demographics & referral data',
        authType: 'apikey',
        placeholder: 'SimilarWeb API Key',
        unlocks: [
          'Competitor monthly traffic estimates with confidence levels',
          'Traffic source breakdown (organic, paid, social, referral)',
          'Audience demographics by country, device, and age',
          'Top referring domains and organic keywords'
        ],
        steps: [
          { text: 'Visit <a href="https://www.similarweb.com/corp/developer/digital-intelligence-api" target="_blank">SimilarWeb Developer Portal</a>' },
          { text: 'Request access to the <strong>Digital Intelligence API</strong>' },
          { text: 'Once approved, navigate to <strong>My Account → API Key</strong>' },
          { text: 'Copy your API Key and paste it in the field above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will verify your monthly unit allowance' }
        ]
      },
      {
        id: 'ahrefs', logo: '🔗', name: 'Ahrefs API',
        tagline: 'Backlink data, keyword explorer & content gap analysis',
        authType: 'apikey',
        placeholder: 'Ahrefs API Token (v3)',
        unlocks: [
          'Domain Rating and backlink profile comparison',
          'Keyword difficulty and organic traffic potential',
          'Content gap analysis vs. competitor pages',
          'Top-performing competitor content identification'
        ],
        steps: [
          { text: 'Sign in to <a href="https://ahrefs.com" target="_blank">ahrefs.com</a> (Business plan required for API)' },
          { text: 'Go to <strong>Account Settings → API</strong>' },
          { text: 'Generate a new <strong>API v3 Token</strong>' },
          { text: 'Set token permissions: <code>site_explorer</code>, <code>keywords_explorer</code>' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'builtwith', logo: '🔧', name: 'BuiltWith API',
        tagline: 'Competitor tech stack, ad pixels & tracking detection',
        authType: 'apikey',
        placeholder: 'BuiltWith API Key',
        unlocks: [
          'Competitor technology stack detection (CMS, cart, analytics)',
          'Ad pixel identification (Meta Pixel, Google Tag, etc.)',
          'Email platform and CRM detection',
          'Spend estimates based on tech usage patterns'
        ],
        steps: [
          { text: 'Sign up at <a href="https://builtwith.com/plans" target="_blank">builtwith.com/plans</a> (API requires paid plan)' },
          { text: 'Go to <strong>Account → API Access</strong>' },
          { text: 'Copy your <strong>API Key</strong>' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'spyfu', logo: '🕵️', name: 'SpyFu API',
        tagline: 'Google Ads history, competitor keywords & ad copy spy',
        authType: 'apikey',
        placeholder: 'SpyFu API Key',
        unlocks: [
          'Complete Google Ads history for any competitor domain',
          'Every keyword a competitor has ever bought on Google',
          'Historical ad copy and A/B test variations',
          'Estimated monthly Google Ads spend per competitor'
        ],
        steps: [
          { text: 'Sign up at <a href="https://www.spyfu.com" target="_blank">spyfu.com</a> (API plan required)' },
          { text: 'Navigate to <strong>Account → Integrations → API Key</strong>' },
          { text: 'Copy your API Key' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'moz', logo: '🎯', name: 'Moz API',
        tagline: 'Domain Authority, Page Authority & link metrics',
        authType: 'apikey',
        placeholder: 'Moz Access ID:Secret Key',
        unlocks: [
          'Domain Authority and Page Authority scores for competitors',
          'Spam score and link quality analysis',
          'Top competitor pages by authority',
          'Keyword ranking opportunity identification'
        ],
        steps: [
          { text: 'Sign up at <a href="https://moz.com/products/api" target="_blank">moz.com/products/api</a>' },
          { text: 'Navigate to <strong>API → Access Credentials</strong>' },
          { text: 'Copy your <strong>Access ID</strong> and <strong>Secret Key</strong>' },
          { text: 'Enter them in the format <code>AccessID:SecretKey</code> above' },
          { text: 'Click <strong>Test Connection</strong> to verify' }
        ]
      }
    ]
  },

  ai: {
    label: 'AI Models',
    icon: '🤖',
    desc: 'Connect leading AI models to power InfoGenie\'s ad copy generation, strategic analysis, image creation, and conversational intelligence engine.',
    badge: '6 Models',
    items: [
      {
        id: 'openai', logo: '🟢', name: 'OpenAI — GPT-4o',
        tagline: 'Ad copy generation, strategy analysis & conversational AI',
        authType: 'apikey',
        placeholder: 'OpenAI API Key (sk-proj-xxxx...)',
        unlocks: [
          'GPT-4o powers InfoGenie\'s ad copy and headline generation',
          'Strategic competitor analysis and campaign recommendations',
          'Conversational AI assistant for campaign building',
          'DALL-E 3 image generation for ad creatives'
        ],
        steps: [
          { text: 'Go to <a href="https://platform.openai.com" target="_blank">platform.openai.com</a> and sign in' },
          { text: 'Navigate to <strong>API Keys</strong> in the left sidebar' },
          { text: 'Click <strong>Create new secret key</strong> — give it a name like "InfoGenie"' },
          { text: '<strong>Important:</strong> Copy the key immediately — it\'s only shown once' },
          { text: 'Ensure you have a <strong>paid plan</strong> with GPT-4 access enabled' },
          { text: 'Paste your key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'anthropic', logo: '🟣', name: 'Anthropic — Claude 3.5',
        tagline: 'Deep competitive analysis, long-form strategy & reasoning',
        authType: 'apikey',
        placeholder: 'Anthropic API Key (sk-ant-xxxx...)',
        unlocks: [
          'Claude 3.5 Sonnet for nuanced competitor strategy reports',
          'Long-form campaign strategy documents and briefs',
          'Complex data analysis and market positioning insights',
          'High-accuracy ad compliance checking'
        ],
        steps: [
          { text: 'Go to <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> and sign in' },
          { text: 'Navigate to <strong>API Keys</strong> in the sidebar' },
          { text: 'Click <strong>Create Key</strong> and name it "InfoGenie"' },
          { text: 'Copy the key immediately (starts with <code>sk-ant-</code>)' },
          { text: 'Ensure your account has <strong>Claude 3.5 Sonnet</strong> access' },
          { text: 'Paste your key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'gemini', logo: '🔵', name: 'Google Gemini',
        tagline: 'Multimodal AI for visual ad analysis & video script generation',
        authType: 'apikey',
        placeholder: 'Google AI Studio API Key',
        unlocks: [
          'Gemini Pro Vision for competitor ad creative analysis',
          'Video script generation for YouTube and TikTok campaigns',
          'Multimodal competitor content analysis (text + images)',
          'Google Workspace integration for report generation'
        ],
        steps: [
          { text: 'Visit <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a>' },
          { text: 'Click <strong>Get API key</strong> in the top navigation' },
          { text: 'Create a new API key in a Google Cloud project' },
          { text: 'Copy your API key' },
          { text: 'Alternatively, enable Gemini API in <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a> for enterprise features' },
          { text: 'Paste your key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'stability', logo: '🎨', name: 'Stability AI',
        tagline: 'Stable Diffusion for AI-generated ad images & visuals',
        authType: 'apikey',
        placeholder: 'Stability AI API Key (sk-xxxx...)',
        unlocks: [
          'Stable Diffusion XL for high-quality ad image generation',
          'Image-to-image transformation for creative variations',
          'Brand-consistent visual asset generation at scale',
          'Competitor creative style analysis and improvement'
        ],
        steps: [
          { text: 'Sign up at <a href="https://platform.stability.ai" target="_blank">platform.stability.ai</a>' },
          { text: 'Navigate to <strong>Account → API Keys</strong>' },
          { text: 'Click <strong>Create API Key</strong>' },
          { text: 'Copy your API key (starts with <code>sk-</code>)' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'mistral', logo: '🌀', name: 'Mistral AI',
        tagline: 'Fast, cost-efficient AI for bulk copy generation & analysis',
        authType: 'apikey',
        placeholder: 'Mistral API Key',
        unlocks: [
          'Mistral Large for fast, cost-efficient ad copy at scale',
          'Batch campaign analysis across multiple competitors',
          'Multilingual ad copy for global campaigns',
          'Fast real-time campaign suggestion generation'
        ],
        steps: [
          { text: 'Go to <a href="https://console.mistral.ai" target="_blank">console.mistral.ai</a>' },
          { text: 'Navigate to <strong>API Keys</strong> in the dashboard' },
          { text: 'Click <strong>Create new key</strong>' },
          { text: 'Copy your key and paste it above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will use Mistral for high-volume tasks' }
        ]
      },
      {
        id: 'elevenlabs', logo: '🔊', name: 'ElevenLabs',
        tagline: 'AI voice generation for video ad voiceovers & audio content',
        authType: 'apikey',
        placeholder: 'ElevenLabs API Key',
        unlocks: [
          'AI voiceover generation for video and audio ads',
          'Multi-language voice localisation for global campaigns',
          'Brand voice cloning for consistent audio identity',
          'Podcast and audio ad creation from ad copy'
        ],
        steps: [
          { text: 'Sign up at <a href="https://elevenlabs.io" target="_blank">elevenlabs.io</a>' },
          { text: 'Go to <strong>Profile → API Key</strong>' },
          { text: 'Copy your API key' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  crm: {
    label: 'CRM & Automation',
    icon: '🔗',
    desc: 'Connect your CRM and automation platforms to route leads, sync contacts, and automate follow-up workflows triggered by InfoGenie campaign conversions.',
    badge: '7 Platforms',
    items: [
      {
        id: 'hubspot', logo: '🟠', name: 'HubSpot CRM',
        tagline: 'Contact sync, deal pipeline & campaign attribution',
        authType: 'oauth',
        unlocks: [
          'Auto-sync campaign leads directly into HubSpot contacts',
          'Deal creation and pipeline stage automation',
          'Campaign attribution reports in HubSpot Dashboards',
          'Retargeting lists built from CRM segments'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.hubspot.com" target="_blank">developers.hubspot.com</a> and create a Private App' },
          { text: 'Under <strong>Scopes</strong>, enable: <code>crm.objects.contacts.write</code>, <code>crm.objects.deals.write</code>' },
          { text: 'Generate your <strong>Private App Access Token</strong>' },
          { text: 'Alternatively, click <strong>Connect via OAuth</strong> for instant setup' },
          { text: 'InfoGenie will automatically create a custom property <code>infogenie_source</code> for attribution' }
        ]
      },
      {
        id: 'salesforce', logo: '🔵', name: 'Salesforce CRM',
        tagline: 'Lead routing, opportunity management & revenue attribution',
        authType: 'oauth',
        unlocks: [
          'Campaign lead auto-routing into Salesforce leads/contacts',
          'Opportunity creation from qualified ad conversions',
          'Revenue attribution via campaign UTM tracking',
          'AI-powered lead scoring from engagement signals'
        ],
        steps: [
          { text: 'Go to <strong>Setup → Apps → App Manager</strong> in Salesforce' },
          { text: 'Create a <strong>Connected App</strong> with OAuth enabled' },
          { text: 'Add scopes: <code>api</code>, <code>refresh_token</code>, <code>offline_access</code>' },
          { text: 'Set the callback URL to <code>https://app.infogenie.ai/oauth/salesforce</code>' },
          { text: 'Click <strong>Connect via OAuth</strong> below to authorise' }
        ]
      },
      {
        id: 'pipedrive', logo: '🟢', name: 'Pipedrive',
        tagline: 'Deal management, contact sync & pipeline automation',
        authType: 'apikey',
        placeholder: 'Pipedrive API Token',
        unlocks: [
          'Auto-create deals from InfoGenie campaign conversions',
          'Contact enrichment with campaign source and UTMs',
          'Pipeline stage triggers based on campaign performance',
          'Activity logging for all AI-generated touchpoints'
        ],
        steps: [
          { text: 'Sign in to Pipedrive and go to <strong>Personal Preferences → API</strong>' },
          { text: 'Copy your <strong>Personal API Token</strong>' },
          { text: 'Paste it in the field above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will map your pipeline stages automatically' }
        ]
      },
      {
        id: 'klaviyo', logo: '📧', name: 'Klaviyo',
        tagline: 'Email marketing automation & audience sync for e-commerce',
        authType: 'apikey',
        placeholder: 'Klaviyo Private API Key',
        unlocks: [
          'Sync InfoGenie campaign audiences into Klaviyo lists',
          'Trigger email flows from ad click and conversion events',
          'Revenue attribution across InfoGenie ads + email flows',
          'Suppression list sync to reduce ad spend waste'
        ],
        steps: [
          { text: 'Go to <a href="https://klaviyo.com" target="_blank">klaviyo.com</a> → <strong>Account → Settings → API Keys</strong>' },
          { text: 'Click <strong>Create Private API Key</strong>' },
          { text: 'Select scopes: <code>Lists: Full Access</code>, <code>Profiles: Full Access</code>, <code>Events: Full Access</code>' },
          { text: 'Copy the private key and paste it above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'marketo', logo: '🟣', name: 'Marketo (Adobe)',
        tagline: 'B2B marketing automation, lead scoring & nurture campaigns',
        authType: 'apikey',
        placeholder: 'Marketo Client ID:Client Secret',
        unlocks: [
          'B2B lead sync from InfoGenie LinkedIn campaigns',
          'Lead scoring enrichment from campaign engagement data',
          'Automated nurture programme triggers post-ad-click',
          'Revenue Cycle Analytics integration for full-funnel reporting'
        ],
        steps: [
          { text: 'In Marketo, go to <strong>Admin → Integration → LaunchPoint</strong>' },
          { text: 'Click <strong>New Service</strong> and choose <strong>Custom</strong>' },
          { text: 'Enter "InfoGenie" as the service name' },
          { text: 'Under <strong>Admin → Web Services</strong>, copy your <strong>REST API Endpoint</strong>' },
          { text: 'Go to <strong>Admin → LaunchPoint</strong>, find your service, and click <strong>View Details</strong> for Client ID and Secret' },
          { text: 'Enter them in format <code>ClientID:ClientSecret</code> above' }
        ]
      },
      {
        id: 'zapier', logo: '⚡', name: 'Zapier',
        tagline: 'Connect 6,000+ apps with no-code automation workflows',
        authType: 'apikey',
        placeholder: 'Zapier API Key',
        unlocks: [
          'Trigger any Zap from InfoGenie campaign events',
          'Route leads to any app in Zapier\'s 6,000+ ecosystem',
          'Multi-step automation across CRM, email, sheets, and Slack',
          'Custom webhook triggers from InfoGenie AI alerts'
        ],
        steps: [
          { text: 'Sign in to <a href="https://zapier.com" target="_blank">zapier.com</a> and go to <strong>Settings → API</strong>' },
          { text: 'Generate your <strong>API Key</strong>' },
          { text: 'In InfoGenie, copy your <strong>Webhook URL</strong> from the Zapier connection panel' },
          { text: 'Create a Zap with <strong>Webhooks by Zapier</strong> as the trigger using your webhook URL' },
          { text: 'Paste your Zapier API Key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'make', logo: '🔵', name: 'Make (Integromat)',
        tagline: 'Visual automation builder with advanced data transformation',
        authType: 'apikey',
        placeholder: 'Make API Token',
        unlocks: [
          'Visual workflow automation triggered by campaign events',
          'Complex data transformation between InfoGenie and other systems',
          'Advanced scheduling and conditional automation logic',
          'Real-time webhook processing from ad platform events'
        ],
        steps: [
          { text: 'Go to <a href="https://make.com" target="_blank">make.com</a> → <strong>Profile → API</strong>' },
          { text: 'Click <strong>Add token</strong> and name it "InfoGenie"' },
          { text: 'Copy the generated token' },
          { text: 'In Make, create a new Scenario using the <strong>Webhooks</strong> module as trigger' },
          { text: 'Copy the webhook URL and paste it into InfoGenie\'s Make settings panel' },
          { text: 'Enter your API token above and click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  analytics: {
    label: 'Analytics & Data',
    icon: '📈',
    desc: 'Connect analytics and data platforms to give InfoGenie complete visibility into your performance — enabling smarter competitor benchmarking and ROI attribution.',
    badge: '7 Platforms',
    items: [
      {
        id: 'ga4', logo: '📊', name: 'Google Analytics 4',
        tagline: 'Website traffic, user behaviour & conversion events',
        authType: 'oauth',
        unlocks: [
          'Real website conversion data fed into ROAS calculations',
          'Audience segment sync for better campaign targeting',
          'Attribution modelling across InfoGenie campaigns',
          'Funnel drop-off identification for landing page insights'
        ],
        steps: [
          { text: 'Go to <a href="https://analytics.google.com" target="_blank">analytics.google.com</a> → <strong>Admin → Property Settings</strong>' },
          { text: 'Note your <strong>Measurement ID</strong> (format: G-XXXXXXXXXX)' },
          { text: 'Under <strong>Admin → Service Accounts</strong>, create a service account with <strong>Viewer</strong> access' },
          { text: 'Download the <strong>JSON credentials file</strong>' },
          { text: 'Click <strong>Connect via OAuth</strong> for the simplified setup (recommended)' }
        ]
      },
      {
        id: 'gsc', logo: '🔍', name: 'Google Search Console',
        tagline: 'Organic search performance, impressions & CTR data',
        authType: 'oauth',
        unlocks: [
          'Organic keyword CTR benchmarked against paid campaign CTR',
          'Top search queries feeding into keyword targeting',
          'Page performance data for landing page optimisation',
          'Core Web Vitals insight for campaign quality scores'
        ],
        steps: [
          { text: 'Go to <a href="https://search.google.com/search-console" target="_blank">Google Search Console</a>' },
          { text: 'Verify ownership of your domain if not already done' },
          { text: 'Click <strong>Connect via OAuth</strong> below — InfoGenie requests read-only access' },
          { text: 'Select your property when prompted during OAuth flow' }
        ]
      },
      {
        id: 'adobe', logo: '🔴', name: 'Adobe Analytics',
        tagline: 'Enterprise-grade analytics with custom dimensions & segments',
        authType: 'apikey',
        placeholder: 'Adobe Analytics Client ID:Secret',
        unlocks: [
          'Enterprise segment sync for precision ad targeting',
          'Multi-channel attribution across all InfoGenie campaigns',
          'Custom metric integration for revenue and LTV reporting',
          'Real-time data feeds for autonomous campaign decisions'
        ],
        steps: [
          { text: 'Go to <a href="https://developer.adobe.com/console" target="_blank">Adobe Developer Console</a>' },
          { text: 'Create a new Project and add the <strong>Analytics API</strong> service' },
          { text: 'Generate <strong>OAuth Server-to-Server credentials</strong>' },
          { text: 'Note your <strong>Report Suite ID</strong> from Adobe Analytics Admin' },
          { text: 'Enter Client ID and Secret in format <code>ClientID:Secret</code> above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'mixpanel', logo: '🟣', name: 'Mixpanel',
        tagline: 'Product analytics, user events & cohort analysis',
        authType: 'apikey',
        placeholder: 'Mixpanel Service Account Secret',
        unlocks: [
          'User behaviour event data for audience segmentation',
          'Cohort analysis to identify best-converting user journeys',
          'Funnel performance feeding into campaign landing page scores',
          'Retention data for lifetime value optimisation'
        ],
        steps: [
          { text: 'Go to <a href="https://mixpanel.com" target="_blank">mixpanel.com</a> → <strong>Settings → Project Settings → Service Accounts</strong>' },
          { text: 'Click <strong>Add Service Account</strong> with <strong>Analyst</strong> role' },
          { text: 'Copy the <strong>Username</strong> and <strong>Secret</strong>' },
          { text: 'Note your <strong>Project Token</strong> from Project Settings' },
          { text: 'Enter the Service Account Secret above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'segment', logo: '🟢', name: 'Segment (Twilio)',
        tagline: 'Customer data platform — unify events across all touchpoints',
        authType: 'apikey',
        placeholder: 'Segment Write Key',
        unlocks: [
          'Unified customer event data from all touchpoints',
          'Audience sync to InfoGenie from Segment Personas',
          'Real-time event streaming for campaign trigger automation',
          'Identity resolution across devices and channels'
        ],
        steps: [
          { text: 'Sign in to <a href="https://segment.com" target="_blank">segment.com</a> → <strong>Sources → Add Source</strong>' },
          { text: 'Create a new source named "InfoGenie"' },
          { text: 'Copy the <strong>Write Key</strong> from source settings' },
          { text: 'Navigate to <strong>Destinations → Add Destination</strong> and add InfoGenie as a destination' },
          { text: 'Paste your Write Key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'hotjar', logo: '🔥', name: 'Hotjar',
        tagline: 'Heatmaps, session recordings & conversion funnel analysis',
        authType: 'apikey',
        placeholder: 'Hotjar Personal API Token',
        unlocks: [
          'Landing page heatmap data informing ad creative direction',
          'Session recording access for post-click UX analysis',
          'Funnel analysis identifying conversion drop-off points',
          'User feedback insights for ad messaging refinement'
        ],
        steps: [
          { text: 'Sign in to <a href="https://hotjar.com" target="_blank">hotjar.com</a> → <strong>Account → Personal API Tokens</strong>' },
          { text: 'Click <strong>Generate a personal API token</strong>' },
          { text: 'Give it the name "InfoGenie" and copy the token' },
          { text: 'Note your <strong>Site ID</strong> from the Hotjar dashboard' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'amplitude', logo: '📉', name: 'Amplitude',
        tagline: 'Product analytics, revenue insights & user journey mapping',
        authType: 'apikey',
        placeholder: 'Amplitude API Key:Secret Key',
        unlocks: [
          'User journey analysis from ad click to conversion',
          'Revenue event tracking and LTV modelling',
          'Behavioural cohort sync for precision retargeting',
          'Predictive audience scoring for campaign optimisation'
        ],
        steps: [
          { text: 'Go to <a href="https://app.amplitude.com" target="_blank">app.amplitude.com</a> → <strong>Settings → Projects</strong>' },
          { text: 'Select your project and navigate to <strong>General → API Keys</strong>' },
          { text: 'Copy both the <strong>API Key</strong> and <strong>Secret Key</strong>' },
          { text: 'Enter them in format <code>APIKey:SecretKey</code> above' },
          { text: 'Click <strong>Test Connection</strong>' }
        ]
      }
    ]
  },

  communication: {
    label: 'Communication',
    icon: '💬',
    desc: 'Connect messaging and communication platforms to receive real-time InfoGenie alerts, route campaign leads to chatbots, and automate customer engagement workflows.',
    badge: '6 Channels',
    items: [
      {
        id: 'slack', logo: '💬', name: 'Slack',
        tagline: 'Real-time campaign alerts, performance reports & AI insights',
        authType: 'oauth',
        unlocks: [
          'Real-time campaign performance alerts to any Slack channel',
          'Daily / weekly intelligence digest delivered to your team',
          'Instant competitor change notifications',
          'AI-generated action recommendations via Slack bot'
        ],
        steps: [
          { text: 'Go to <a href="https://api.slack.com/apps" target="_blank">api.slack.com/apps</a> and click <strong>Create New App</strong>' },
          { text: 'Choose <strong>From scratch</strong> and name it "InfoGenie Bot"' },
          { text: 'Under <strong>OAuth & Permissions</strong>, add scopes: <code>chat:write</code>, <code>channels:read</code>, <code>users:read</code>' },
          { text: 'Click <strong>Install to Workspace</strong>' },
          { text: 'Or simply click <strong>Connect via OAuth</strong> below for one-click setup' }
        ]
      },
      {
        id: 'whatsapp', logo: '📱', name: 'WhatsApp Business API',
        tagline: 'Lead qualification chatbot & conversational campaign follow-up',
        authType: 'apikey',
        placeholder: 'WhatsApp Business API Token',
        unlocks: [
          'Automated lead qualification chatbot via WhatsApp',
          'Campaign follow-up sequences triggered by ad conversions',
          'Product recommendation bot for e-commerce campaigns',
          'Appointment booking and demo scheduling automation'
        ],
        steps: [
          { text: 'Access the WhatsApp Business API via <a href="https://developers.facebook.com/docs/whatsapp" target="_blank">Meta for Developers</a>' },
          { text: 'Create a Meta Business Account and verify your business' },
          { text: 'Add the WhatsApp product to your Meta App' },
          { text: 'Navigate to <strong>WhatsApp → API Setup</strong> and generate a temporary Access Token' },
          { text: 'Add your <strong>Phone Number ID</strong> and <strong>WhatsApp Business Account ID</strong>' },
          { text: 'Paste your token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'telegram', logo: '✈️', name: 'Telegram Bot',
        tagline: 'Instant campaign alerts, competitor updates & AI notifications',
        authType: 'apikey',
        placeholder: 'Telegram Bot Token (123456:ABCdef...)',
        unlocks: [
          'Instant push notifications for campaign performance changes',
          'Competitor alert delivery to your Telegram channel',
          'Daily AI intelligence digest via Telegram',
          'Command-based campaign control via Telegram bot commands'
        ],
        steps: [
          { text: 'Open Telegram and start a chat with <strong>@BotFather</strong>' },
          { text: 'Send the command <code>/newbot</code> and follow the prompts' },
          { text: 'Choose a name (e.g. "InfoGenie Alerts") and a username (e.g. <code>infogenie_alerts_bot</code>)' },
          { text: 'BotFather will send you a <strong>Bot Token</strong> — copy it' },
          { text: 'Get your <strong>Chat ID</strong> by messaging <code>@userinfobot</code> on Telegram' },
          { text: 'Paste your Bot Token above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'sendgrid', logo: '📧', name: 'SendGrid (Twilio)',
        tagline: 'Transactional emails, campaign reports & lead notifications',
        authType: 'apikey',
        placeholder: 'SendGrid API Key (SG.xxxx...)',
        unlocks: [
          'Campaign performance reports delivered to your inbox',
          'Transactional emails for lead capture from campaigns',
          'Weekly competitor intelligence digest emails',
          'Custom email templates for InfoGenie notifications'
        ],
        steps: [
          { text: 'Sign in to <a href="https://sendgrid.com" target="_blank">sendgrid.com</a> and go to <strong>Settings → API Keys</strong>' },
          { text: 'Click <strong>Create API Key</strong>' },
          { text: 'Choose <strong>Full Access</strong> or <strong>Restricted Access</strong> with <code>Mail Send</code> enabled' },
          { text: 'Copy the key immediately (starts with <code>SG.</code>)' },
          { text: 'Verify your sender email domain under <strong>Settings → Sender Authentication</strong>' },
          { text: 'Paste your API key above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'teams', logo: '🔷', name: 'Microsoft Teams',
        tagline: 'Campaign alerts & AI reports delivered to Teams channels',
        authType: 'apikey',
        placeholder: 'Teams Webhook URL',
        unlocks: [
          'InfoGenie campaign alerts posted to Teams channels',
          'Daily marketing intelligence reports in Teams',
          'Competitor change notifications for your marketing team',
          'Approval workflows for autonomous campaign launches'
        ],
        steps: [
          { text: 'In Microsoft Teams, navigate to the channel where you want alerts' },
          { text: 'Click the <strong>⋯ (More Options)</strong> next to the channel name' },
          { text: 'Select <strong>Connectors → Incoming Webhook → Configure</strong>' },
          { text: 'Give the webhook a name ("InfoGenie") and upload the InfoGenie logo' },
          { text: 'Click <strong>Create</strong> and copy the webhook URL generated' },
          { text: 'Paste the webhook URL in the field above and click <strong>Test Connection</strong>' }
        ]
      },
      {
        id: 'intercom', logo: '🔵', name: 'Intercom',
        tagline: 'Lead chat qualification & customer engagement automation',
        authType: 'apikey',
        placeholder: 'Intercom Access Token',
        unlocks: [
          'Auto-create Intercom leads from InfoGenie campaign conversions',
          'Trigger Intercom chat proactively to high-intent visitors',
          'Sync campaign UTM data to Intercom contact attributes',
          'AI-suggested chat scripts based on competitor messaging'
        ],
        steps: [
          { text: 'Sign in to <a href="https://app.intercom.com" target="_blank">app.intercom.com</a> and go to <strong>Settings → Developers → Developer Hub</strong>' },
          { text: 'Click <strong>New App</strong> and create an app named "InfoGenie"' },
          { text: 'Under <strong>Authentication</strong>, copy the <strong>Access Token</strong>' },
          { text: 'Enable permissions: <code>Read/Write Users</code>, <code>Read/Write Conversations</code>' },
          { text: 'Paste your Access Token above and click <strong>Test Connection</strong>' }
        ]
      }
    ]
  }
};

// ===================================================
// BUILD INTELLIGENCE HUB
// ===================================================
function buildIntelligence() {
  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const intel = INTELLIGENCE_DB[industryKey] || INTELLIGENCE_DB['marketing'];
  const analysisDomain = analysisData ? analysisData.url : 'yourdomain.com';
  const wrap = document.getElementById('intelligenceWrap');
  if (!wrap) return;

  // ── Use real competitors from analysis to override intelligence display data ──
  const realComps = (analysisData && analysisData.competitors) ? analysisData.competitors : null;

  // Palette for generated SOV colors
  const sovPalette = ['#0066FF','#00C9C8','#6366F1','#F59E0B','#10B981','#EF4444','#E5E7EB'];

  function compLogo(c) { return c.logo || (c.name ? c.name[0].toUpperCase() : '?'); }

  // Build Share of Voice: use real competitor names when available
  let displaySov;
  if (realComps && realComps.length > 0) {
    const totalBase = realComps.reduce((a,c) => a + (c.trafficMo || 400000), 0);
    let usedPct = 0;
    const compRows = realComps.slice(0,5).map((c, i) => {
      const raw = Math.round((c.trafficMo || 400000) / totalBase * 72);
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
    displaySignals = realComps.slice(0, 4).map((c, i) => {
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
    displayWinLoss = realComps.slice(0, 3).map((c, i) => {
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
      <td><button class="btn-kwgap-attack" onclick="showToast('🎯 Launching attack campaign for: ${k.keyword.replace(/'/g, '')}')">⚡ Attack</button></td>
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
            ? `<button class="btn-signal-attack" onclick="showToast('⚡ Launching counter-strategy: ${s.action.replace(/'/g,'')}')">${s.action}</button>`
            : `<button class="btn-signal-counter" onclick="showToast('📋 Counter-strategy queued: ${s.action.replace(/'/g,'')}')">${s.action}</button>`
          }
        </div>
      </div>
    </div>
  `).join('');

  // ── Prediction cards ──
  const predCards = displayPredictions.map(p => `
    <div class="prediction-card">
      <div class="pred-logo">${p.logo}</div>
      <div class="pred-body">
        <div class="pred-top">
          <span class="pred-comp">${p.comp}</span>
          <span class="pred-timeframe">⏱ ${p.timeframe}</span>
          <div class="pred-confidence">
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
          <button class="pred-launch-btn" onclick="showToast('🚀 Pre-emptive campaign queued: ${p.action.replace(/'/g,'')}')">Launch Now</button>
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

  // ── Win/Loss cards ──
  const wlCards = displayWinLoss.map(w => `
    <div class="winloss-card">
      <div class="wl-top">
        <span class="wl-comp">${w.comp}</span>
        <span class="wl-channel">${w.channel}</span>
        <span class="wl-loss-rate">Lost ${w.lossRate} of deals</span>
      </div>
      <div class="wl-message">${w.message}</div>
      <div class="wl-weakness">💡 <strong>Exploitable Weakness:</strong> ${w.weakness}</div>
      <button class="btn-wl-counter" onclick="showToast('🎯 Counter-campaign against ${w.comp.replace(/'/g,'')} queued — launching creative generation')">Counter This Message</button>
    </div>
  `).join('');

  // ── Open attack windows ──
  const openWindows = displaySignals.filter(s => s.attackOpen).length;

  // ── Full HTML ──
  wrap.innerHTML = `
    <!-- Top KPI row -->
    <div class="intel-score-section">
      <div class="cat-dom-card">
        <div class="cat-dom-label">Category Domination Score</div>
        <div class="cat-dom-score">${intel.categoryScore}<span style="font-size:1.2rem;opacity:.5">/100</span></div>
        <div class="cat-dom-track"><div class="cat-dom-fill" style="width:${intel.categoryScore}%"></div></div>
        <div class="cat-dom-sub">You are in the bottom quartile — 90-day roadmap below will target 55+</div>
      </div>
      <div class="intel-kpi-card">
        <div class="ikc-icon">🔑</div>
        <div class="ikc-val">${intel.keywordGaps.length}</div>
        <div class="ikc-label">Keyword Gap Opportunities</div>
        <div class="ikc-urgency medium">Combined vol: ${intel.keywordGaps.reduce((a,k)=>a+parseInt(k.volume.replace(/,/g,'')),0).toLocaleString()}/mo</div>
      </div>
      <div class="intel-kpi-card">
        <div class="ikc-icon">⚡</div>
        <div class="ikc-val">${openWindows}</div>
        <div class="ikc-label">Attack Windows Open Right Now</div>
        <div class="ikc-urgency ${openWindows > 0 ? 'high' : 'low'}">${openWindows > 0 ? '🔴 Urgent — act within 72h' : '✅ Monitor for new windows'}</div>
      </div>
    </div>

    <!-- Share of Voice -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">📊 Share of Voice Analysis</div>
        <div class="intel-section-badge">Live Estimate</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="sov-wrap">
        <div class="sov-legend">
          ${intel.shareOfVoice.map(s => `
            <div class="sov-legend-item">
              <div class="sov-dot" style="background:${s.color}"></div>
              <span class="sov-leg-name">${s.name}</span>
              <span class="sov-leg-share">${s.share}%</span>
              ${s.trend ? `<span class="sov-leg-trend ${s.trend.startsWith('+') && s.trend !== '+0%' ? 'up' : s.trend.startsWith('-') ? 'down' : 'flat'}">${s.trend}</span>` : ''}
            </div>
          `).join('')}
        </div>
        <canvas id="sovChart" height="200"></canvas>
      </div>
    </div>

    <!-- Keyword Gap Table -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🔑 Keyword Gap Intelligence</div>
        <div class="intel-section-badge">${intel.keywordGaps.length} Opportunities Found</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div style="overflow-x:auto">
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
          <tbody>${kwRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Competitor Signal Feed -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">📡 Competitor Signal Feed</div>
        <div class="intel-section-badge">${intel.signals.length} Signals Detected</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="signal-grid">${signalCards}</div>
    </div>

    <!-- Predictive Intelligence -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🔮 Predictive Competitor Intelligence</div>
        <div class="intel-section-badge">AI-Powered</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="prediction-grid">${predCards}</div>
    </div>

    <!-- 90-Day Roadmap -->
    <div class="intel-section">
      <div class="intel-section-head">
        <div class="intel-section-title">🗺️ 90-Day Category Domination Roadmap</div>
        <div class="intel-section-badge">AI-Generated for Your Industry</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="roadmap-track">${roadmapItems}</div>
    </div>

    <!-- Win/Loss Intelligence -->
    <div class="intel-section" style="padding-bottom:48px">
      <div class="intel-section-head">
        <div class="intel-section-title">🏆 Win/Loss Intelligence</div>
        <div class="intel-section-badge">Competitor Messages That Beat You</div>
        <div class="intel-exclusive-badge">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="winloss-grid">${wlCards}</div>
    </div>
  `;

  // Build Share of Voice donut chart
  const sovCtx = document.getElementById('sovChart');
  if (sovCtx) {
    if (sovCtx._chartInstance) sovCtx._chartInstance.destroy();
    sovCtx._chartInstance = new Chart(sovCtx, {
      type: 'doughnut',
      data: {
        labels: sovLabels,
        datasets: [{ data: sovData, backgroundColor: sovColors, borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}% share of voice`
            }
          }
        },
        animation: { animateRotate: true, duration: 900 }
      }
    });
  }
}

function exportIntelligenceReport() {
  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const intel = INTELLIGENCE_DB[industryKey] || INTELLIGENCE_DB['marketing'];
  const domain = analysisData ? analysisData.url : 'demo.com';
  const industry = analysisData ? analysisData.industry.name : 'Marketing & Analytics';
  const date = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const realComps = analysisData ? analysisData.competitors : [];

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

// ===================================================
// BUILD SETTINGS
// ===================================================
function buildSettings() {
  const wrap = document.getElementById('settingsWrap');
  const cats = Object.entries(INTEGRATIONS);
  const firstKey = cats[0][0];

  const tabsHtml = cats.map(([key, cat], i) => `
    <button class="stab ${i === 0 ? 'active' : ''}" data-tab="${key}" onclick="switchSettingsTab('${key}')">
      <span class="stab-icon">${cat.icon}</span>
      ${cat.label}
      <span class="stab-count">${cat.items.length}</span>
    </button>
  `).join('');

  const panelsHtml = cats.map(([key, cat], i) => `
    <div class="integ-panel ${i === 0 ? 'active' : ''}" id="panel-${key}">
      <div class="integ-category-header">
        <div class="ich-icon">${cat.icon}</div>
        <div class="ich-text">
          <div class="ich-title">${cat.label}</div>
          <div class="ich-sub">${cat.desc}</div>
        </div>
        <div class="ich-badge">${cat.badge}</div>
      </div>
      <div class="integ-cards-grid">
        ${cat.items.map(item => buildIntegCard(item)).join('')}
      </div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="settings-page">
      <div class="integ-summary-bar">
        <div class="isb-item"><span class="isb-count" id="connectedCount">0</span> integrations connected</div>
        <div class="isb-divider"></div>
        <div class="isb-item">
          <span style="color:var(--green); font-size:1rem;">●</span>&nbsp;InfoGenie AI engine status: <strong style="color:var(--green)">Online</strong>
        </div>
        <div class="isb-divider"></div>
        <div class="isb-item">
          <span style="color:var(--gold);">⚡</span>&nbsp;Tip: Connect at least <strong>one Ad Platform</strong> + <strong>one AI Model</strong> to enable full autonomous operation
        </div>
        <div class="isb-cta">
          <button class="btn-primary" onclick="showDocsModal()">📖 Full Docs</button>
        </div>
      </div>

      <div class="settings-tab-bar">${tabsHtml}</div>

      ${panelsHtml}

      <div class="acct-settings-section">
        <div class="acct-settings-header">
          <div class="acct-settings-title">⚙️ InfoGenie Account Settings</div>
          <div class="acct-settings-sub">Configure your AI engine preferences, compliance settings, and notification rules</div>
        </div>
        <div class="settings-form">
          <div class="sf-row">
            <div class="sf-group">
              <label>Business Name</label>
              <input type="text" class="sf-input" placeholder="Your Company Name" id="sfBizName" />
            </div>
            <div class="sf-group">
              <label>Default Target Region</label>
              <select class="sf-select" id="sfRegion">
                <option value="global">🌍 Global</option>
                <option value="us">🇺🇸 United States</option>
                <option value="uk">🇬🇧 United Kingdom</option>
                <option value="au">🇦🇺 Australia</option>
                <option value="za">🇿🇦 South Africa</option>
                <option value="ae">🇦🇪 UAE</option>
                <option value="sg">🇸🇬 Singapore</option>
                <option value="de">🇩🇪 Germany</option>
                <option value="ca">🇨🇦 Canada</option>
                <option value="fr">🇫🇷 France</option>
              </select>
            </div>
          </div>
          <div class="sf-row">
            <div class="sf-group">
              <label>Monthly Ad Budget (USD)</label>
              <input type="number" class="sf-input" placeholder="e.g. 5000" id="sfBudget" />
            </div>
            <div class="sf-group">
              <label>Subscription Plan</label>
              <select class="sf-select" id="sfPlan">
                <option>Professional — $399/mo</option>
                <option>Starter — $99/mo</option>
                <option>Agency — $999/mo</option>
                <option>Enterprise — Custom</option>
              </select>
            </div>
          </div>
          <div class="sf-row">
            <div class="sf-group">
              <label>Primary AI Model</label>
              <select class="sf-select">
                <option>OpenAI GPT-4o (Recommended)</option>
                <option>Anthropic Claude 3.5 Sonnet</option>
                <option>Google Gemini Pro</option>
                <option>Mistral Large</option>
              </select>
            </div>
            <div class="sf-group">
              <label>Report Delivery Email</label>
              <input type="email" class="sf-input" placeholder="you@company.com" />
            </div>
          </div>
          <button class="sf-save" onclick="saveSettings()">Save Account Settings</button>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Autonomous Campaign Optimisation</div>
            <div class="toggle-desc">Allow InfoGenie AI to automatically pause underperformers and reallocate budget 24/7</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Real-time Competitor Monitoring</div>
            <div class="toggle-desc">Alert me instantly when competitors launch new campaigns or change their ad spend</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">AI Creative Auto-generation</div>
            <div class="toggle-desc">Automatically generate and test new creatives when performance drops below your ROAS threshold</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Weekly Intelligence Reports</div>
            <div class="toggle-desc">Receive a full competitor intelligence digest every Monday morning</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">GDPR / CCPA / POPIA Compliance Mode</div>
            <div class="toggle-desc">Enforce data privacy compliance on all campaigns, integrations, and audience targeting</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
        <div class="toggle-row">
          <div class="toggle-info">
            <div class="toggle-name">Multi-region Campaign Compliance Check</div>
            <div class="toggle-desc">Auto-validate campaigns against local advertising regulations before launch</div>
          </div>
          <label class="toggle-switch"><input type="checkbox" checked /><span class="toggle-slider"></span></label>
        </div>
      </div>
    </div>
  `;
}

function buildIntegCard(item) {
  const isApiKey = item.authType === 'apikey';
  const isOAuth = item.authType === 'oauth';
  const cardId = 'card-' + item.id;

  const unlocksList = item.unlocks.map(u => `
    <li><span class="ul-check">✓</span><span>${u}</span></li>
  `).join('');

  const stepsList = item.steps.map((s, i) => `
    <div class="step-item">
      <div class="step-num">${i + 1}</div>
      <div class="step-text">${s.text}</div>
    </div>
  `).join('');

  const connectSection = isApiKey ? `
    <div class="api-key-row">
      <input type="password" class="api-key-inp" placeholder="${item.placeholder || 'Paste your API Key here...'}" id="inp-${item.id}" />
      <button class="btn-test" onclick="testConnection('${item.id}')">Test</button>
    </div>
    <div class="integ-card-actions">
      <button class="btn-connect-card" id="btn-${item.id}" onclick="connectCard('${item.id}', '${item.name}')">Connect</button>
      <button class="btn-docs-card" onclick="showIntegrationDoc('${item.id}')">📖 View Docs</button>
    </div>
  ` : `
    <div class="integ-card-actions" style="flex-direction:column; gap:8px;">
      <button class="oauth-btn" id="btn-${item.id}" onclick="connectOAuth('${item.id}', '${item.name}')">
        <span>🔐</span> Connect via OAuth
      </button>
      <button class="btn-docs-card" style="width:100%; text-align:center;" onclick="showIntegrationDoc('${item.id}')">📖 View Integration Docs</button>
    </div>
  `;

  return `
    <div class="integ-card" id="${cardId}">
      <div class="integ-card-top">
        <div class="integ-logo">${item.logo}</div>
        <div class="integ-meta">
          <div class="integ-name">${item.name}</div>
          <div class="integ-tagline">${item.tagline}</div>
        </div>
        <div class="integ-conn-status ics-off" id="status-${item.id}">
          <span>○</span> Not connected
        </div>
      </div>
      <div class="integ-card-body">
        <div class="unlocks-title">✦ What it unlocks in InfoGenie</div>
        <ul class="unlocks-list">${unlocksList}</ul>
        <div class="steps-title">↳ How to integrate</div>
        <div class="steps-list">${stepsList}</div>
        ${connectSection}
      </div>
    </div>
  `;
}

// ===================================================
// PER-INTEGRATION DOCUMENTATION
// ===================================================

function _findIntegById(id) {
  for (const [catKey, cat] of Object.entries(INTEGRATIONS)) {
    const item = cat.items.find(i => i.id === id);
    if (item) return { item, catKey, catLabel: cat.label, catIcon: cat.icon };
  }
  return null;
}

function _getIntegApiDetails(item) {
  const isOAuth = item.authType === 'oauth';
  const apiDetails = {
    'google-ads':    { baseUrl: 'https://googleads.googleapis.com/v16', rateLimits: '10,000 req/day per customer', plans: 'Active Google Ads account + API access approval', errorCodes: [['UNAUTHENTICATED', 'OAuth token expired — re-authenticate'], ['INVALID_ARGUMENT', 'Check field names match Google Ads API spec'], ['RESOURCE_EXHAUSTED', 'Daily quota exceeded — reduce request volume'], ['NOT_FOUND', 'Customer ID or campaign ID does not exist']] },
    'meta-ads':      { baseUrl: 'https://graph.facebook.com/v19.0', rateLimits: '200 calls/hour per ad account', plans: 'Active Meta Business Manager + Marketing API access', errorCodes: [['190', 'Access token expired — reconnect via OAuth'], ['100', 'Invalid parameter — check field names'], ['17', 'API rate limit hit — wait 1 hour'], ['803', 'Ad account ID format must be act_XXXXXXX']] },
    'tiktok-ads':    { baseUrl: 'https://business-api.tiktok.com/open_api/v1.3', rateLimits: '1,000 req/min (campaign), 100 req/min (reporting)', plans: 'TikTok for Business account + approved API access', errorCodes: [['40100', 'Access token invalid — regenerate in developer portal'], ['40002', 'Missing required parameter'], ['50002', 'Service temporarily unavailable — retry with exponential back-off']] },
    'linkedin-ads':  { baseUrl: 'https://api.linkedin.com/v2', rateLimits: '100 req/day for free, varies by API product', plans: 'LinkedIn Marketing Developer Platform access required', errorCodes: [['401', 'OAuth token invalid or expired'], ['403', 'Insufficient permissions — check r_ads/rw_ads scope'], ['429', 'Rate limit exceeded'], ['404', 'Campaign or account ID not found']] },
    'x-ads':         { baseUrl: 'https://ads-api.twitter.com/12', rateLimits: '300 req/15 min window', plans: 'Funded X Ads account + Ads API access (approved)', errorCodes: [['32', 'Authentication required — check token'], ['88', 'Rate limit exceeded'], ['186', 'Tweet text too long'], ['261', 'Application cannot perform write actions']] },
    'pinterest-ads': { baseUrl: 'https://api.pinterest.com/v5', rateLimits: '1,000 req/min for campaigns', plans: 'Pinterest Business account + Ads API approval', errorCodes: [['401', 'Invalid access token'], ['403', 'Insufficient scope'], ['429', 'Rate limit exceeded'], ['400', 'Invalid request body']] },
    'amazon-ads':    { baseUrl: 'https://advertising-api.amazon.com', rateLimits: 'Varies by endpoint (50–1000 req/sec)', plans: 'Amazon Seller/Vendor Central account + advertising account', errorCodes: [['401', 'Refresh token expired — re-authenticate'], ['400', 'Invalid profile ID or body'], ['429', 'Throttled — implement exponential back-off'], ['403', 'Insufficient access to this profile']] },
    'semrush':       { baseUrl: 'https://api.semrush.com', rateLimits: 'Based on API units (Business: 3,000/day)', plans: 'Semrush API subscription (Business plan recommended)', errorCodes: [['ERROR 50 :: NOTHING FOUND', 'Domain has no indexed data in Semrush'], ['ERROR 80 :: NOT ENOUGH UNITS', 'API unit balance depleted — upgrade plan'], ['ERROR 120 :: WRONG KEY', 'Invalid API key — regenerate in account settings']] },
    'similarweb':    { baseUrl: 'https://api.similarweb.com/v1', rateLimits: 'Depends on plan (typically 1,000 req/month)', plans: 'SimilarWeb Digital Intelligence API subscription', errorCodes: [['401', 'Invalid API key'], ['402', 'Monthly quota exhausted'], ['404', 'Website not found in SimilarWeb database']] },
    'ahrefs':        { baseUrl: 'https://api.ahrefs.com/v3', rateLimits: '500 rows/request, 1,000 req/day (Business)', plans: 'Ahrefs Business plan or above', errorCodes: [['401', 'Invalid or revoked API token'], ['403', 'Feature not available on your plan'], ['429', 'Rate limit exceeded — reduce request frequency']] },
    'builtwith':     { baseUrl: 'https://api.builtwith.com/v21/api.json', rateLimits: '100 lookups/day (Basic), 2,000 (Pro)', plans: 'BuiltWith API paid plan required', errorCodes: [['400', 'Bad request — check API key format'], ['402', 'Quota exceeded for current billing period'], ['404', 'Domain not found in BuiltWith database']] },
    'spyfu':         { baseUrl: 'https://www.spyfu.com/apis/url_api', rateLimits: '10,000 results/day on Pro plan', plans: 'SpyFu API plan subscription', errorCodes: [['403', 'Invalid API credentials'], ['429', 'Daily rate limit exceeded'], ['404', 'Domain not indexed by SpyFu']] },
    'moz':           { baseUrl: 'https://lsapi.seomoz.com/v2', rateLimits: '10 queries per 10 seconds (free), higher on paid', plans: 'Moz Pro API access (paid plan)', errorCodes: [['401', 'Invalid Access ID or Secret Key'], ['429', 'Request rate exceeded'], ['400', 'Invalid URL or parameter']] },
    'openai':        { baseUrl: 'https://api.openai.com/v1', rateLimits: 'GPT-4o: 10,000 RPM, 10M TPM (Tier 3)', plans: 'OpenAI paid account with GPT-4 access enabled', errorCodes: [['401', 'Invalid API key — check sk-proj- prefix'], ['429', 'Rate limit or quota exceeded — add billing credits'], ['500', 'OpenAI server error — retry with back-off'], ['400', 'Invalid request body or model name']] },
    'anthropic':     { baseUrl: 'https://api.anthropic.com/v1', rateLimits: '1,000 RPM, 400K TPM (Claude 3.5 Sonnet)', plans: 'Anthropic API account with Claude 3.5 access', errorCodes: [['401', 'Invalid API key — starts with sk-ant-'], ['529', 'API overloaded — retry with exponential back-off'], ['400', 'Invalid request — check max_tokens and model name']] },
    'gemini':        { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', rateLimits: '60 req/min (free), higher on paid', plans: 'Google AI Studio account or Google Cloud project', errorCodes: [['401', 'Invalid or missing API key'], ['429', 'Quota exceeded — enable billing on Google Cloud'], ['400', 'Invalid request — check model name and content format']] },
    'midjourney':    { baseUrl: 'https://api.userapi.ai/midjourney/v2', rateLimits: 'Based on GPU credits purchased', plans: 'Midjourney Pro or Mega plan + API access', errorCodes: [['401', 'Invalid API token'], ['400', 'Malformed prompt or missing parameters'], ['429', 'GPU queue full — retry after delay']] },
    'stability':     { baseUrl: 'https://api.stability.ai/v1', rateLimits: '150 credits/month (free), purchase additional', plans: 'Stability AI API account with image credits', errorCodes: [['401', 'Invalid API key'], ['402', 'Insufficient credits to complete request'], ['400', 'Invalid aspect ratio or prompt format']] },
    'perplexity':    { baseUrl: 'https://api.perplexity.ai', rateLimits: '60 req/min (Pro plan)', plans: 'Perplexity API subscription', errorCodes: [['401', 'Invalid or expired API key'], ['429', 'Rate limit exceeded'], ['400', 'Model not available or invalid parameters']] },
    'hubspot':       { baseUrl: 'https://api.hubapi.com', rateLimits: '100 req/10s, 40,000 req/day', plans: 'HubSpot Marketing Hub (Starter or above recommended)', errorCodes: [['401', 'Invalid API key or OAuth token'], ['403', 'Scope not authorised — check OAuth permissions'], ['429', 'Rate limit exceeded'], ['404', 'Contact or list ID not found']] },
    'salesforce':    { baseUrl: 'https://{instance}.salesforce.com/services/data/v59.0', rateLimits: '100,000 API calls/24 hours (Enterprise)', plans: 'Salesforce Enterprise or Unlimited edition', errorCodes: [['INVALID_SESSION_ID', 'Session expired — refresh OAuth token'], ['REQUEST_LIMIT_EXCEEDED', 'Daily API limit reached'], ['FIELD_INTEGRITY_EXCEPTION', 'Required field missing or invalid']] },
    'zapier':        { baseUrl: 'https://hooks.zapier.com/hooks/catch', rateLimits: 'Depends on Zap plan (100–50,000 tasks/month)', plans: 'Zapier Professional plan or above for webhooks', errorCodes: [['410', 'Webhook URL disabled — re-create Zap'], ['400', 'Invalid JSON payload — check Content-Type header']] },
    'make':          { baseUrl: 'https://hook.eu1.make.com/{webhook-id}', rateLimits: 'Based on Make.com plan (ops/month)', plans: 'Make.com Core plan or above', errorCodes: [['400', 'Invalid payload structure'], ['404', 'Scenario not found or inactive']] },
    'klaviyo':       { baseUrl: 'https://a.klaviyo.com/api', rateLimits: '75 req/s burst, sustained at 10 req/s', plans: 'Klaviyo account with API key access', errorCodes: [['401', 'Invalid API key prefix — check pk_/sk_ format'], ['403', 'Insufficient scope for this endpoint'], ['429', 'Rate throttled — implement retry logic']] },
    'mailchimp':     { baseUrl: 'https://{dc}.api.mailchimp.com/3.0', rateLimits: '10 simultaneous connections per key', plans: 'Mailchimp Standard or Premium plan', errorCodes: [['401', 'Invalid API key or data centre prefix'], ['405', 'Method not allowed for this resource'], ['400', 'Invalid field in request body']] },
    'ga4':           { baseUrl: 'https://analyticsdata.googleapis.com/v1beta', rateLimits: '10,000 tokens/hour, 1 req/s per property', plans: 'Google Analytics 4 property + Google Cloud project', errorCodes: [['401', 'OAuth token expired — re-authenticate'], ['403', 'No access to this GA4 property'], ['429', 'Quota exceeded — reduce sampling rate']] },
    'segment':       { baseUrl: 'https://api.segment.io/v1', rateLimits: 'No hard limit on tracking; workspace-level throttle', plans: 'Segment Team plan or above for source access', errorCodes: [['401', 'Invalid write key'], ['400', 'Malformed event payload'], ['413', 'Payload too large — keep events under 32KB']] },
    'mixpanel':      { baseUrl: 'https://data.mixpanel.com/api/2.0', rateLimits: '400 queries/hour (Enterprise)', plans: 'Mixpanel Growth or Enterprise plan', errorCodes: [['403', 'Invalid project secret'], ['400', 'Invalid date range or property name'], ['429', 'Query rate limit exceeded']] },
    'hotjar':        { baseUrl: 'https://api.hotjar.com/v1', rateLimits: '100 req/min', plans: 'Hotjar Business plan for API access', errorCodes: [['401', 'Invalid personal API key'], ['404', 'Site ID not found'], ['429', 'Rate limit exceeded']] },
    'bigquery':      { baseUrl: 'https://bigquery.googleapis.com/bigquery/v2', rateLimits: '300 req/min per user, 3,000/min per project', plans: 'Google Cloud project with BigQuery enabled', errorCodes: [['403', 'BigQuery API not enabled in project'], ['400', 'Invalid SQL query syntax'], ['404', 'Dataset or table not found']] },
    'snowflake':     { baseUrl: 'https://{account}.snowflakecomputing.com/api/v2', rateLimits: 'Based on warehouse credits (compute usage)', plans: 'Snowflake Standard or above, SQL API enabled', errorCodes: [['002003', 'Object does not exist'], ['390100', 'Account not found'], ['250001', 'No active warehouse — resume warehouse first']] },
    'slack':         { baseUrl: 'https://slack.com/api', rateLimits: '1 req/sec for most methods', plans: 'Slack workspace + Bot Token with channels:write scope', errorCodes: [['invalid_auth', 'Invalid or revoked bot token'], ['channel_not_found', 'Bot not invited to the channel'], ['rate_limited', 'Slow down — implement Retry-After header']] },
    'teams':         { baseUrl: 'https://smba.trafficmanager.net/apis', rateLimits: '1,500 msgs/sec, 3,600/hour per app', plans: 'Microsoft 365 or Azure AD + Teams app registration', errorCodes: [['401', 'Invalid or expired access token'], ['403', 'Bot not added to team or channel'], ['429', 'Too many requests — respect Retry-After header']] },
    'twilio':        { baseUrl: 'https://api.twilio.com/2010-04-01', rateLimits: '100 msg/sec on short codes, 1/sec on long codes', plans: 'Twilio paid account with verified number', errorCodes: [['20003', 'Authentication failure — check Account SID and Auth Token'], ['21211', 'Invalid To phone number format'], ['21614', 'Number not SMS-capable'], ['30003', 'Unreachable destination handset']] }
  };
  return apiDetails[item.id] || {
    baseUrl: 'https://api.' + item.id.replace('-', '') + '.com/v1',
    rateLimits: 'Refer to provider documentation',
    plans: 'Paid account required',
    errorCodes: [['401', 'Invalid credentials'], ['429', 'Rate limit exceeded'], ['400', 'Invalid request parameters']]
  };
}

function _getCodeExample(item) {
  const api = _getIntegApiDetails(item);
  if (item.authType === 'oauth') {
    return {
      lang: 'JavaScript (fetch)',
      code: `<span class="c-comment">// InfoGenie — ${item.name} API request example</span>
<span class="c-kw">const</span> response = <span class="c-kw">await</span> fetch(
  <span class="c-str">'${api.baseUrl}/campaigns'</span>,
  {
    <span class="c-key">method</span>: <span class="c-str">'GET'</span>,
    <span class="c-key">headers</span>: {
      <span class="c-str">'Authorization'</span>: <span class="c-str">'Bearer YOUR_OAUTH_ACCESS_TOKEN'</span>,
      <span class="c-str">'Content-Type'</span>: <span class="c-str">'application/json'</span>
    }
  }
);
<span class="c-kw">const</span> data = <span class="c-kw">await</span> response.json();
console.log(data); <span class="c-comment">// InfoGenie uses this to sync campaign data</span>`
    };
  } else {
    const keyFormat = item.placeholder ? item.placeholder.split(' ')[0] : 'YOUR_API_KEY';
    return {
      lang: 'cURL',
      code: `<span class="c-comment"># InfoGenie — ${item.name} connection test</span>
curl -X GET <span class="c-str">'${api.baseUrl}'</span> \\
  -H <span class="c-str">'Authorization: Bearer ${keyFormat}'</span> \\
  -H <span class="c-str">'Content-Type: application/json'</span>

<span class="c-comment"># Expected: 200 OK with account/profile data</span>
<span class="c-comment"># If you see 401: your API key is invalid or has no permissions</span>`
    };
  }
}

function _getTroubleshooting(item) {
  const isOAuth = item.authType === 'oauth';
  return [
    {
      q: isOAuth ? 'OAuth authorisation fails or redirects to an error page' : 'My API key is valid but the Test Connection button fails',
      a: isOAuth
        ? 'Make sure you are signed in to the correct account in the browser before clicking Connect via OAuth. Also check that your app has the required permissions/scopes listed in Step 3 above.'
        : 'Ensure you\'ve copied the full key without leading/trailing spaces. Some keys are environment-specific (e.g. sandbox vs. production). Try pasting into a plain text editor first to check for hidden characters.'
    },
    {
      q: 'Connected successfully but InfoGenie shows no data',
      a: `Wait 2–5 minutes after first connecting — InfoGenie needs to complete an initial data sync. If data is still missing after 10 minutes, check that your ${item.name} account has at least one active campaign or dataset.`
    },
    {
      q: 'I see a rate limit error in the activity log',
      a: `${item.name} rate limits: ${_getIntegApiDetails(item).rateLimits}. InfoGenie automatically spaces out requests. If you see persistent rate limit errors, check that no other tools are simultaneously hitting the same API credentials.`
    },
    {
      q: 'How do I disconnect this integration?',
      a: 'Disconnecting from InfoGenie only removes the credentials from our system — it does not revoke access in your provider account. To fully revoke, also remove the InfoGenie app from your ' + item.name + ' account settings.'
    }
  ];
}

function showIntegrationDoc(id) {
  const found = _findIntegById(id);
  if (!found) { showToast('Integration not found'); return; }
  const { item, catLabel, catIcon } = found;

  const modal = document.getElementById('docsModal');
  const inner = document.getElementById('docsModalInner');
  const api = _getIntegApiDetails(item);
  const codeEx = _getCodeExample(item);
  const trouble = _getTroubleshooting(item);
  const authLabel = item.authType === 'oauth' ? 'OAuth 2.0' : 'API Key';
  const authClass = item.authType === 'oauth' ? 'oauth' : 'apikey';

  const unlocksHtml = item.unlocks.map(u => `
    <div class="docs-unlock-item">
      <span class="docs-unlock-check">✓</span>
      <span class="docs-unlock-text">${u}</span>
    </div>
  `).join('');

  const stepsHtml = item.steps.map((s, i) => `
    <div class="docs-doc-step">
      <div class="docs-doc-num">${i + 1}</div>
      <div class="docs-doc-text">${s.text}</div>
    </div>
  `).join('');

  const errorHtml = api.errorCodes.map(([code, msg]) => `
    <tr>
      <td><code>${code}</code></td>
      <td>${msg}</td>
    </tr>
  `).join('');

  const troubleHtml = trouble.map(t => `
    <div class="docs-trouble-item">
      <div class="docs-trouble-q">❓ ${t.q}</div>
      <div class="docs-trouble-a">${t.a}</div>
    </div>
  `).join('');

  inner.innerHTML = `
    <div class="integ-doc-page">
      <div class="integ-doc-hero">
        <div class="integ-doc-hero-top">
          <button class="integ-doc-back" onclick="showDocsModal()">← All Integrations</button>
          <div class="integ-doc-logo">${item.logo}</div>
          <div class="integ-doc-hero-text">
            <div class="integ-doc-name">${item.name}</div>
            <div class="integ-doc-tagline">${item.tagline}</div>
            <div class="integ-doc-badges">
              <span class="docs-badge">${catIcon} ${catLabel}</span>
              <span class="docs-badge ${authClass === 'oauth' ? 'green' : ''}">${authLabel}</span>
              <span class="docs-badge">InfoGenie Integration</span>
            </div>
          </div>
        </div>
      </div>

      <div class="integ-doc-body">

        <!-- WHAT IT UNLOCKS -->
        <div>
          <div class="docs-section-title">✦ What connecting ${item.name} unlocks in InfoGenie</div>
          <div class="docs-unlocks">${unlocksHtml}</div>
        </div>

        <!-- STEP BY STEP -->
        <div>
          <div class="docs-section-title">↳ Step-by-Step Integration Guide</div>
          <div class="docs-doc-steps">${stepsHtml}</div>
        </div>

        <!-- CODE EXAMPLE -->
        <div>
          <div class="docs-section-title">{'{'} Code Example — API Request</div>
          <div class="docs-code-block">
            <div class="docs-code-bar">
              <span class="docs-code-lang">${codeEx.lang}</span>
              <span>• ${item.name} Integration</span>
              <button class="docs-code-copy" onclick="navigator.clipboard.writeText(document.querySelector('.docs-code-content').innerText).then(()=>showToast('📋 Code copied'))">Copy</button>
            </div>
            <div class="docs-code-content">${codeEx.code}</div>
          </div>
        </div>

        <!-- API REFERENCE -->
        <div>
          <div class="docs-section-title">⚙ API Reference</div>
          <table class="docs-api-table">
            <thead><tr><th>Property</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Base URL</td><td><code>${api.baseUrl}</code></td></tr>
              <tr><td>Auth Method</td><td><code>${authLabel}</code></td></tr>
              <tr><td>Rate Limits</td><td>${api.rateLimits}</td></tr>
              <tr><td>Plan Required</td><td>${api.plans}</td></tr>
              <tr><td>InfoGenie Sync Interval</td><td>Every 15 minutes (campaigns), 1 hour (analytics)</td></tr>
            </tbody>
          </table>
        </div>

        <!-- ERROR CODES -->
        <div>
          <div class="docs-section-title">⚠ Common Error Codes</div>
          <table class="docs-api-table">
            <thead><tr><th>Code</th><th>Meaning & Fix</th></tr></thead>
            <tbody>${errorHtml}</tbody>
          </table>
        </div>

        <!-- TROUBLESHOOTING -->
        <div>
          <div class="docs-section-title">🔧 Troubleshooting</div>
          <div class="docs-trouble-list">${troubleHtml}</div>
        </div>

        <!-- BOTTOM ACTIONS -->
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn-auto-target" onclick="closeDocsModal(); switchSettingsTab('${found.catKey}'); setTimeout(()=>{ const el=document.getElementById('card-${item.id}'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); }, 200);">
            Go to ${item.name} Settings →
          </button>
          <button class="btn-vs-copy" onclick="showDocsModal()">← Back to All Integrations</button>
        </div>

      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  inner.scrollTop = 0;
}

// ===================================================
// DOCS MODAL
// ===================================================
function showDocsModal() {
  const modal = document.getElementById('docsModal');
  const inner = document.getElementById('docsModalInner');

  inner.innerHTML = `
    <div class="docs-header">
      <div class="docs-header-title">📖 InfoGenie Integration Documentation</div>
      <div class="docs-header-sub">Everything you need to connect InfoGenie to your ad platforms, analytics tools, AI models, and communication channels — and start running autonomous campaigns.</div>
      <div class="docs-header-badges">
        <span class="docs-badge green">● Platform Online</span>
        <span class="docs-badge">v2.4.1</span>
        <span class="docs-badge">33 Integrations Available</span>
        <span class="docs-badge">REST API + OAuth 2.0</span>
      </div>
    </div>

    <div class="docs-body">

      <!-- QUICK START -->
      <div>
        <div class="docs-section-title">🚀 Quick Start — Get live in 15 minutes</div>
        <div class="docs-steps">
          <div class="docs-step">
            <div class="docs-step-num">1</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Run your first analysis</div>
              <div class="docs-step-desc">Enter any competitor or your own website URL on the Home page and click <strong>Analyse Now</strong>. InfoGenie detects your industry and maps the competitive landscape automatically — no setup required.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">2</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Connect at least one Ad Platform</div>
              <div class="docs-step-desc">Go to <strong>Settings → Ad Platforms</strong> and connect Google Ads or Meta Ads via OAuth. This enables InfoGenie to autonomously deploy, pause, and optimise campaigns on your behalf. OAuth takes under 60 seconds.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">3</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Connect an AI Model</div>
              <div class="docs-step-desc">Go to <strong>Settings → AI Models</strong> and paste your OpenAI API key (starts with <code>sk-proj-</code>). This powers ad copy generation, strategic analysis, and creative recommendations. OpenAI GPT-4o is recommended for best results.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">4</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Add an Intelligence API (optional but powerful)</div>
              <div class="docs-step-desc">Connect Semrush or SimilarWeb under <strong>Settings → Intelligence APIs</strong> to enrich competitor data with real keyword rankings, traffic estimates, and ad spend data. Semrush Business plan or above required for API access.</div>
            </div>
          </div>
          <div class="docs-step">
            <div class="docs-step-num">5</div>
            <div class="docs-step-content">
              <div class="docs-step-title">Launch your first autonomous campaign</div>
              <div class="docs-step-desc">Navigate to <strong>Campaigns</strong>, choose a recommended campaign, and click <strong>Launch Campaign</strong>. InfoGenie will configure targeting, creative, bidding, and budget automatically based on competitor intelligence — then monitor and optimise 24/7.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- INTEGRATION CATEGORIES -->
      <div>
        <div class="docs-section-title">🔌 Integration Categories</div>
        <div class="docs-integ-grid">
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('platforms')">
            <div class="dit-header">
              <span class="dit-icon">🚀</span>
              <span class="dit-name">Ad Platforms</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">Google Ads, Meta, TikTok, LinkedIn, X, Pinterest, Amazon — deploy campaigns autonomously across all major platforms.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('intelligence')">
            <div class="dit-header">
              <span class="dit-icon">🔍</span>
              <span class="dit-name">Intelligence APIs</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">Semrush, SimilarWeb, Ahrefs, BuiltWith, SpyFu, Moz — power competitor analysis with real traffic and keyword data.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('ai')">
            <div class="dit-header">
              <span class="dit-icon">🤖</span>
              <span class="dit-name">AI Models</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">OpenAI, Claude, Gemini, Stability AI, Mistral, ElevenLabs — drive ad copy, creative generation, and strategic reasoning.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('crm')">
            <div class="dit-header">
              <span class="dit-icon">🔗</span>
              <span class="dit-name">CRM & Automation</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">HubSpot, Salesforce, Pipedrive, Klaviyo, Marketo, Zapier, Make — route leads and automate workflows from campaigns.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('analytics')">
            <div class="dit-header">
              <span class="dit-icon">📈</span>
              <span class="dit-name">Analytics & Data</span>
              <span class="dit-count">7</span>
            </div>
            <div class="dit-desc">GA4, Search Console, Adobe Analytics, Mixpanel, Segment, Hotjar, Amplitude — feed real performance data into InfoGenie.</div>
          </div>
          <div class="docs-integ-tile" onclick="closeDocsModal(); switchSettingsTab('communication')">
            <div class="dit-header">
              <span class="dit-icon">💬</span>
              <span class="dit-name">Communication</span>
              <span class="dit-count">6</span>
            </div>
            <div class="dit-desc">Slack, WhatsApp, Telegram, SendGrid, Microsoft Teams, Intercom — receive alerts and route leads via your preferred channels.</div>
          </div>
        </div>
      </div>

      <!-- INTEGRATION DIRECTORY -->
      <div>
        <div class="docs-section-title">📋 All Integrations — Click Any to View Full Docs</div>
        <div class="docs-dir-grid">
          ${Object.entries(INTEGRATIONS).flatMap(([catKey, cat]) =>
            cat.items.map(item => `
              <div class="docs-dir-item" onclick="showIntegrationDoc('${item.id}')">
                <div class="docs-dir-logo">${item.logo}</div>
                <div class="docs-dir-info">
                  <div class="docs-dir-name">${item.name}</div>
                  <div class="docs-dir-cat">${cat.icon} ${cat.label}</div>
                </div>
                <span class="docs-dir-auth ${item.authType}">${item.authType === 'oauth' ? 'OAuth' : 'API Key'}</span>
              </div>
            `)
          ).join('')}
        </div>
      </div>

      <!-- AUTH METHODS -->
      <div>
        <div class="docs-section-title">🔐 Authentication Methods</div>
        <table class="docs-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>How it works</th>
              <th>Used by</th>
              <th>Security</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="dt-badge dt-oauth">OAuth 2.0</span></td>
              <td>One-click connect — InfoGenie requests permissions and securely stores refresh tokens. You never share passwords.</td>
              <td>Google Ads, Meta, LinkedIn, Pinterest, HubSpot, Salesforce, Slack, GA4, GSC</td>
              <td>Industry standard. Revoke access anytime from the platform's security settings.</td>
            </tr>
            <tr>
              <td><span class="dt-badge dt-apikey">API Key</span></td>
              <td>Generate a key in the platform's developer console and paste it here. InfoGenie stores it encrypted using AES-256.</td>
              <td>OpenAI, Semrush, Ahrefs, TikTok, Klaviyo, SendGrid, Slack webhook, Hotjar, and more</td>
              <td>Keys are stored encrypted. Never share keys with third parties. Rotate keys periodically.</td>
            </tr>
            <tr>
              <td><span class="dt-badge dt-webhook">Webhook URL</span></td>
              <td>InfoGenie sends event payloads to a URL you provide. Used for one-way notification delivery.</td>
              <td>Slack, Microsoft Teams, Zapier, Make</td>
              <td>Webhook URLs are unique per connection. Rotate by generating a new webhook in the platform.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- PLANS -->
      <div>
        <div class="docs-section-title">💎 Plan & Integration Limits</div>
        <div class="docs-plan-grid">
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Starter</div>
              <div class="dpc-price">$99/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>2 ad platforms</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 AI model</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 intelligence API</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>1 communication channel</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>5 competitor analyses/mo</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Basic AI campaigns</div>
            </div>
          </div>
          <div class="docs-plan-card featured">
            <div class="dpc-header">
              <div class="dpc-name">Professional</div>
              <div class="dpc-price">$399/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All ad platforms</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>3 AI models</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>3 intelligence APIs</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All communication channels</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Unlimited analyses</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Autonomous optimisation</div>
            </div>
          </div>
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Agency</div>
              <div class="dpc-price">$999/mo</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Everything in Pro</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>All 33 integrations</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>CRM + Analytics sync</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Up to 25 client accounts</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>White-label reports</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Priority support</div>
            </div>
          </div>
          <div class="docs-plan-card">
            <div class="dpc-header">
              <div class="dpc-name">Enterprise</div>
              <div class="dpc-price">Custom</div>
            </div>
            <div class="dpc-body">
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Everything in Agency</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Custom AI model training</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Dedicated infrastructure</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Unlimited client accounts</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>SLA guarantee</div>
              <div class="dpc-feat"><span class="dpc-feat-check">✓</span>Custom integrations</div>
            </div>
          </div>
        </div>
      </div>

      <!-- SUPPORT -->
      <div>
        <div class="docs-section-title">🛟 Support & Resources</div>
        <div class="docs-support-grid">
          <div class="docs-support-card" onclick="showToast('📚 Opening API Reference at docs.infogenie.ai/api...')">
            <div class="dsc-icon">📚</div>
            <div class="dsc-title">API Reference</div>
            <div class="dsc-desc">Full REST API docs, endpoint specs, rate limits, and code examples in Python, JS, and cURL.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🎥 Opening video tutorials at learn.infogenie.ai...')">
            <div class="dsc-icon">🎥</div>
            <div class="dsc-title">Video Tutorials</div>
            <div class="dsc-desc">Step-by-step video walkthroughs for every integration and core InfoGenie workflow.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('💬 Opening live chat support...')">
            <div class="dsc-icon">💬</div>
            <div class="dsc-title">Live Chat Support</div>
            <div class="dsc-desc">Chat with our integration engineers Mon–Fri 9am–6pm GMT. Response under 2 minutes on Pro+ plans.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🐛 Opening issue tracker at github.com/infogenie...')">
            <div class="dsc-icon">🐛</div>
            <div class="dsc-title">Bug Reports</div>
            <div class="dsc-desc">Report integration issues on our public GitHub. P1 bugs fixed within 24 hours on Enterprise plans.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('🗺️ Opening public roadmap at roadmap.infogenie.ai...')">
            <div class="dsc-icon">🗺️</div>
            <div class="dsc-title">Product Roadmap</div>
            <div class="dsc-desc">Vote on upcoming integrations and features. Snapchat Ads, Reddit Ads, and BigQuery coming Q2 2026.</div>
          </div>
          <div class="docs-support-card" onclick="showToast('📧 Opening community at community.infogenie.ai...')">
            <div class="dsc-icon">🌐</div>
            <div class="dsc-title">Community Forum</div>
            <div class="dsc-desc">Connect with 8,000+ InfoGenie users, share integration configs, and get peer advice.</div>
          </div>
        </div>
      </div>

      <!-- SECURITY NOTE -->
      <div style="background:var(--gray-50); border:1px solid var(--border); border-radius:10px; padding:16px 20px; display:flex; gap:12px; align-items:flex-start;">
        <span style="font-size:1.25rem; flex-shrink:0;">🔒</span>
        <div>
          <div style="font-size:0.875rem; font-weight:700; color:var(--navy); margin-bottom:4px;">Security & Data Handling</div>
          <div style="font-size:0.8125rem; color:var(--gray-500); line-height:1.6;">All API keys and OAuth tokens are encrypted at rest using AES-256 and in transit using TLS 1.3. InfoGenie never stores raw credentials in plaintext. You can revoke all integration access at any time from this settings page. InfoGenie is SOC 2 Type II compliant and GDPR-ready. Your competitor analysis data is never shared with third parties or used to train our AI models.</div>
        </div>
      </div>

    </div>
  `;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeDocsModal() {
  const modal = document.getElementById('docsModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function closePlanModal() {
  const modal = document.getElementById('planModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

function switchSettingsTab(key) {
  document.querySelectorAll('.stab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  document.querySelectorAll('.integ-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + key));
}

function testConnection(id) {
  const inp = document.getElementById('inp-' + id);
  if (!inp || !inp.value.trim()) {
    showToast('⚠️ Please enter your API key first');
    return;
  }
  showToast('🔄 Testing connection to ' + id + '...');
  setTimeout(() => {
    showToast('✅ Connection successful — API key is valid!');
  }, 1800);
}

function connectCard(id, name) {
  const inp = document.getElementById('inp-' + id);
  if (!inp || !inp.value.trim()) {
    showToast('⚠️ Please enter your API key before connecting');
    return;
  }
  const btn = document.getElementById('btn-' + id);
  const status = document.getElementById('status-' + id);
  const card = document.getElementById('card-' + id);
  btn.textContent = '✓ Connected';
  btn.classList.add('btn-connected-card');
  status.className = 'integ-conn-status ics-live';
  status.innerHTML = '<span>●</span> Connected';
  card.classList.add('connected');
  updateConnectedCount(1);
  showToast(`✅ ${name} connected — InfoGenie is now using this integration`);
}

function connectOAuth(id, name) {
  const btn = document.getElementById('btn-' + id);
  const status = document.getElementById('status-' + id);
  const card = document.getElementById('card-' + id);
  btn.innerHTML = '<span>✓</span> Connected via OAuth';
  btn.classList.add('connected');
  status.className = 'integ-conn-status ics-live';
  status.innerHTML = '<span>●</span> Connected';
  card.classList.add('connected');
  updateConnectedCount(1);
  showToast(`✅ ${name} connected via OAuth — campaigns can now be deployed automatically`);
}

let _connectedCount = 0;
function updateConnectedCount(delta) {
  _connectedCount += delta;
  const el = document.getElementById('connectedCount');
  if (el) el.textContent = _connectedCount;
}

function saveSettings() {
  showToast('✅ Settings saved — InfoGenie AI engine updated');
}

// ===== HELPERS =====
function avg(arr) { return +(arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(2); }
function formatNum(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n/1000).toFixed(0) + 'K';
  return n;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function getCountryLabel(val) {
  const map = { global:'🌍 Global', us:'🇺🇸 US', uk:'🇬🇧 UK', au:'🇦🇺 Australia', ca:'🇨🇦 Canada', de:'🇩🇪 Germany', fr:'🇫🇷 France', sg:'🇸🇬 Singapore', ae:'🇦🇪 UAE', in:'🇮🇳 India', za:'🇿🇦 South Africa', br:'🇧🇷 Brazil', jp:'🇯🇵 Japan', nl:'🇳🇱 Netherlands', se:'🇸🇪 Sweden' };
  return map[val] || '🌍 Global';
}
function calcOpportunityScore(kpis, avgCTR, avgROAS) {
  const ctrScore = Math.min(30, (kpis.ctr / avgCTR) * 20);
  const roasScore = Math.min(30, (kpis.roas / avgROAS) * 20);
  const base = 40;
  return Math.round(base + ctrScore + roasScore + Math.random() * 10);
}
function getCreativeType(label) {
  if (label.toLowerCase().includes('female') || label.toLowerCase().includes('fashion')) return 'video UGC';
  if (label.toLowerCase().includes('tech') || label.toLowerCase().includes('trader')) return 'comparison';
  if (label.toLowerCase().includes('family')) return 'lifestyle';
  if (label.toLowerCase().includes('business') || label.toLowerCase().includes('professional')) return 'thought leadership';
  return 'educational carousel';
}
function getPeakTime(label) {
  if (label.toLowerCase().includes('student')) return 'Evenings 7–10pm weekdays';
  if (label.toLowerCase().includes('business') || label.toLowerCase().includes('manager')) return 'Weekdays 7–9am & 12–2pm';
  if (label.toLowerCase().includes('traveller') || label.toLowerCase().includes('nomad')) return 'Weekends 10am–2pm';
  return 'Evenings & weekends';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.style.display = 'none';
    toast.classList.add('hidden');
  }, 4000);
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  navigateTo('home');
  buildIntelligence(); // Pre-populate with demo data so it's accessible immediately
  
  // Nav logo — go home
  document.getElementById('navLogo').addEventListener('click', e => {
    e.preventDefault();
    navigateTo('home');
  });
  
  // Nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const view = link.dataset.view;
      const freeViews = ['intelligence', 'settings'];
      if (analysisData || freeViews.includes(view)) {
        navigateTo(view);
      } else {
        showToast('⚠️ Please enter your website URL and run an analysis first');
      }
    });
  });
  
  // Nav analyse button
  document.getElementById('navAnalyseBtn').addEventListener('click', () => {
    navigateTo('home');
  });
  
  // Main analyse button
  document.getElementById('analyseBtn').addEventListener('click', () => {
    const url = document.getElementById('websiteInput').value;
    const country = document.getElementById('targetCountry').value;
    runAnalysis(url, country);
  });
  
  // Enter key on input
  document.getElementById('websiteInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const url = document.getElementById('websiteInput').value;
      const country = document.getElementById('targetCountry').value;
      runAnalysis(url, country);
    }
  });
  
  // Example chips
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      document.getElementById('websiteInput').value = url;
      const country = document.getElementById('targetCountry').value;
      runAnalysis(url, country);
    });
  });
  
  // Re-run button
  document.getElementById('reRunBtn').addEventListener('click', () => {
    navigateTo('home');
  });
  
  // View all competitors
  document.getElementById('viewAllCompBtn').addEventListener('click', () => {
    navigateTo('competitors');
  });
  
  // Launch campaign button (header)
  document.getElementById('launchCampaignBtn').addEventListener('click', () => {
    const modal = document.getElementById('launchModal');
    modal.querySelector('.modal-title').textContent = 'Launch Campaign';
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  });
  
  // Auto-target audience
  document.getElementById('autoTargetBtn').addEventListener('click', () => {
    showToast('🎯 InfoGenie is targeting all high-performing audience segments automatically — campaigns launching...');
  });
  
  // Generate more creatives
  document.getElementById('generateMoreBtn').addEventListener('click', () => {
    showToast('✨ Generating 6 new AI creatives based on latest competitor data...');
    setTimeout(() => buildCreative(), 1500);
  });
  
  // Pro Plan badge — open upgrade modal
  document.getElementById('navPlanBadge').style.cursor = 'pointer';
  document.getElementById('navPlanBadge').addEventListener('click', () => {
    const modal = document.getElementById('planModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  });

  // Plan modal — close on backdrop click
  document.getElementById('planModal').addEventListener('click', e => {
    if (e.target === document.getElementById('planModal')) closePlanModal();
  });

  // Docs modal — close on backdrop click
  document.getElementById('docsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('docsModal')) closeDocsModal();
  });

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalConfirm').addEventListener('click', () => {
    const budget = document.getElementById('campBudget').value || '2,000';
    const platform = document.getElementById('campPlatform').value;
    const country = document.getElementById('campCountry').value;
    const campName = document.getElementById('launchModal').dataset.activeCamp || 'Your Campaign';
    const box = document.getElementById('launchModal').querySelector('.modal-box');
    box.dataset.successState = 'true';
    box.innerHTML = `
      <div style="text-align:center; padding: 8px 0">
        <div style="font-size:3rem; margin-bottom:16px">🎉</div>
        <h3 style="font-family:'Sora',sans-serif; font-size:1.25rem; font-weight:800; color:#0A1628; margin-bottom:8px">Campaign Launched!</h3>
        <p style="color:#6B7280; font-size:0.875rem; margin-bottom:20px; line-height:1.6">"${campName}" is now live and being optimised by InfoGenie's AI engine in real-time.</p>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px; text-align:center">
          <div style="background:#F0FDF4; border-radius:10px; padding:12px">
            <div style="font-size:1.1rem; font-weight:800; color:#059669">$${parseInt(budget.replace(/[^0-9]/g,'')).toLocaleString()}</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Monthly Budget</div>
          </div>
          <div style="background:#EFF6FF; border-radius:10px; padding:12px">
            <div style="font-size:0.85rem; font-weight:800; color:#1D4ED8">${platform.split(' ')[0]}</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Platform</div>
          </div>
          <div style="background:#F5F3FF; border-radius:10px; padding:12px">
            <div style="font-size:1.1rem; font-weight:800; color:#7C3AED">Live</div>
            <div style="font-size:0.7rem; color:#6B7280; margin-top:2px">Status</div>
          </div>
        </div>
        <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E); border-radius:12px; padding:14px 16px; margin-bottom:20px; text-align:left">
          <div style="font-size:0.7rem; font-weight:700; color:rgba(0,201,200,.8); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px">InfoGenie AI Engine is now:</div>
          <div style="font-size:0.8125rem; color:rgba(255,255,255,.8); display:flex; flex-direction:column; gap:4px">
            <span>✓ Generating AI ad copy every 72 hours</span>
            <span>✓ Monitoring competitor spend in real-time</span>
            <span>✓ Auto-reallocating budget to winning ads</span>
            <span>✓ A/B testing headlines, CTAs and audiences</span>
          </div>
        </div>
        <button onclick="closeModal(); navigateTo('intelligence')" style="width:100%; padding:12px; background:linear-gradient(135deg,#00C9C8,#0066FF); border:none; border-radius:10px; color:white; font-size:0.9375rem; font-weight:700; cursor:pointer; font-family:'Inter',sans-serif">
          ⚡ View Intelligence Dashboard →
        </button>
        <button onclick="closeModal()" style="width:100%; margin-top:8px; padding:10px; background:transparent; border:1.5px solid #E5E7EB; border-radius:10px; color:#6B7280; font-size:0.875rem; font-weight:600; cursor:pointer; font-family:'Inter',sans-serif">Done</button>
      </div>
    `;
  });
});

function closeModal() {
  const modal = document.getElementById('launchModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
  // Reset modal state
  const box = modal.querySelector('.modal-box');
  if (box && box.dataset.successState === 'true') {
    box.dataset.successState = '';
    box.innerHTML = _launchModalOriginalHTML || '';
  }
}

// Open the launch modal pre-filled for a specific campaign
function openCampModal(name, platform, budget, idx) {
  const modal = document.getElementById('launchModal');
  const budgetNum = parseInt((budget || '$2000').replace(/[^0-9]/g, '')) || 2000;
  const platformMap = { 'Google Ads': 'Google Ads', 'Meta Ads': 'Meta (Facebook / Instagram)', 'TikTok Ads': 'TikTok Ads', 'AI Optimised': 'All Platforms (Recommended)' };
  document.getElementById('campBudget').value = budgetNum;
  const sel = document.getElementById('campPlatform');
  const optionText = platformMap[platform] || platform;
  for (let o of sel.options) { if (o.text === optionText) { sel.value = o.value; break; } }
  modal.dataset.activeCamp = name;
  modal.dataset.activeCampIdx = idx;
  modal.querySelector('.modal-title').textContent = 'Launch: ' + (name.length > 38 ? name.substring(0,38) + '…' : name);
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

// Preview creative for a campaign card — navigate to AI Creative view
function previewCampaignCreative(idx) {
  navigateTo('creative');
  showToast('👁 Viewing AI-generated creative for this campaign — all ad formats generated below');
}

// Init view states
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view').forEach((v, i) => {
    if (i !== 0) v.style.display = 'none';
  });
});

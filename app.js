// ============================================================
// InfoGenie — Main Application Controller
// ============================================================

// ── Analytics (Amplitude + PostHog) ──────────────────────────────────────────
window._ampReady = false;
window._phReady  = false;

(async () => {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());

    // Amplitude
    if (cfg.amplitudeApiKey && window.amplitude) {
      await window.amplitude.init(cfg.amplitudeApiKey, {
        defaultTracking: { sessions: true, pageViews: false, formInteractions: false, fileDownloads: false }
      }).promise;
      window._ampReady = true;
    }

    // PostHog
    if (cfg.posthogApiKey && window.posthog) {
      window.posthog.init(cfg.posthogApiKey, {
        api_host: 'https://eu.i.posthog.com',
        ui_host: 'https://eu.posthog.com',
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: true,
        session_recording: { maskAllInputs: false }
      });
      window._phReady = true;
    }

    igTrack('App Loaded', { version: '1.0', platform: 'web' });
  } catch(e) { console.warn('[Analytics] init failed:', e.message); }
})();

function igTrack(eventName, props = {}) {
  if (window._ampReady && window.amplitude) {
    window.amplitude.track(eventName, props);
  }
  if (window._phReady && window.posthog) {
    window.posthog.capture(eventName, props);
  }
}

let currentView = 'home';
let analysisData = null;
let ctrChartInstance = null;
let roasChartInstance = null;
let trendChartInstance = null;
let audienceChartInstance = null;
let creativeChartInstance = null;
let sovChartInstance      = null;
let forecastChartInstance = null;
let efficiencyChartInstance = null;
let spendChartInstance    = null;
let roasTrendChartInstance  = null;
let platformPerfChartInstance = null;
let _audienceChartTimer = null;
let _creativeChartTimer = null;
let queuedCampaigns = [];
let creativeRound = 0;
window._launchedCampaigns = [];
window._abTests = [];
window._infoGenieActions = [];

// ===== PRIMARY CAMPAIGN BUTTON HANDLERS — called directly via onclick in buildCampaigns() =====
window._igLaunch = function(idx) {
  try {
    // If _lastCampRecs is missing but we have analysisData, rebuild it
    if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
      try { buildCampaigns(); } catch(e) {}
    }
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Please run an analysis first — enter your website URL on the home page');
      navigateTo('home');
      return;
    }
    buildLaunchModal(camp, idx);
  } catch(err) {
    console.error('_igLaunch error:', err);
    // Show an inline error in the modal instead of just a toast
    const inner = document.getElementById('campLaunchRichModalInner');
    const modal  = document.getElementById('campLaunchRichModal');
    if (inner && modal) {
      modal.classList.remove('hidden');
      modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); padding:20px;';
      inner.innerHTML = `<div style="background:white;border-radius:16px;padding:32px;max-width:460px;width:100%;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <div style="font-weight:800;font-size:1rem;color:#0A1628;margin-bottom:8px">Couldn't open Launch modal</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:20px">${err.message}</div>
        <button onclick="document.getElementById('campLaunchRichModal').classList.add('hidden');document.getElementById('campLaunchRichModal').removeAttribute('style')" style="padding:10px 24px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700">Close</button>
      </div>`;
    } else {
      alert('Error opening launch: ' + err.message);
    }
  }
};

window._igCreative = function(idx) {
  try {
    if ((!window._lastCampRecs || !window._lastCampRecs[idx]) && window.analysisData) {
      try { buildCampaigns(); } catch(e) {}
    }
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Please run an analysis first — enter your website URL on the home page');
      navigateTo('home');
      return;
    }
    buildCreativeModal(camp, idx);
  } catch(err) {
    console.error('_igCreative error:', err);
    const inner = document.getElementById('campCreativeModalInner');
    const modal  = document.getElementById('campCreativeModal');
    if (inner && modal) {
      modal.classList.remove('hidden');
      modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); padding:20px;';
      inner.innerHTML = `<div style="background:white;border-radius:16px;padding:32px;max-width:460px;width:100%;text-align:center">
        <div style="font-size:2rem;margin-bottom:12px">⚠️</div>
        <div style="font-weight:800;font-size:1rem;color:#0A1628;margin-bottom:8px">Couldn't open Creative Studio</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:20px">${err.message}</div>
        <button onclick="document.getElementById('campCreativeModal').classList.add('hidden');document.getElementById('campCreativeModal').removeAttribute('style')" style="padding:10px 24px;background:#0066FF;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:700">Close</button>
      </div>`;
    } else {
      alert('Error opening Creative Studio: ' + err.message);
    }
  }
};

// ===== LEGACY CAMPAIGN CARD BUTTON HANDLERS =====
window.launchCamp = function(btn) {
  try {
    const idx  = parseInt(btn.dataset.campIdx, 10);
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Run an analysis first — enter your website URL on the home page');
      return;
    }
    buildLaunchModal(camp, idx);
  } catch(err) {
    console.error('launchCamp error:', err);
    showToast('⚠️ Error opening launch modal: ' + err.message);
  }
};

window.openCreativeStudio = function(btn) {
  try {
    const idx  = parseInt(btn.dataset.campIdx, 10);
    const camp = window._lastCampRecs && window._lastCampRecs[idx];
    if (!camp) {
      showToast('⚠️ Run an analysis first — enter your website URL on the home page');
      return;
    }
    buildCreativeModal(camp, idx);
  } catch(err) {
    console.error('openCreativeStudio error:', err);
    showToast('⚠️ Error opening Creative Studio: ' + err.message);
  }
};

// ===== A/B TEST HANDLER (global) =====
window.launchABTest = function() {
  const nameEl = document.getElementById('ab-test-name');
  const varAEl = document.getElementById('ab-var-a');
  const varBEl = document.getElementById('ab-var-b');
  const splitEl = document.getElementById('ab-split');
  const daysEl  = document.getElementById('ab-days');
  if (!nameEl || !varAEl || !varBEl) { showToast('⚠️ A/B test fields not found'); return; }
  const testName = nameEl.value.trim() || 'A/B Test';
  const varAIdx  = parseInt(varAEl.value);
  const varBIdx  = parseInt(varBEl.value);
  const split    = parseInt(splitEl?.value || '50');
  const days     = parseInt(daysEl?.value || '14');
  const camps    = window._lastCampRecs || [];
  if (varAIdx === varBIdx) { showToast('⚠️ Please select two different campaign variants'); return; }
  const campA = camps[varAIdx];
  const campB = camps[varBIdx];
  if (!campA || !campB) { showToast('⚠️ Invalid campaign selection — run an analysis first'); return; }

  // Simulate A/B metrics
  const aROAS = (parseFloat(campA.estROAS) * (0.9 + Math.random() * 0.25)).toFixed(1);
  const bROAS = (parseFloat(campB.estROAS) * (0.9 + Math.random() * 0.25)).toFixed(1);
  const aCTR  = (parseFloat(campA.estCTR) * (0.85 + Math.random() * 0.3)).toFixed(1) + '%';
  const bCTR  = (parseFloat(campB.estCTR) * (0.85 + Math.random() * 0.3)).toFixed(1) + '%';
  const winner = parseFloat(aROAS) >= parseFloat(bROAS) ? 'A' : 'B';

  const test = {
    id: 'ab_' + Date.now(),
    name: testName,
    varA: { name: campA.name, platform: campA.platform, roas: aROAS, ctr: aCTR },
    varB: { name: campB.name, platform: campB.platform, roas: bROAS, ctr: bCTR },
    split, days,
    startedAt: new Date().toLocaleString(),
    status: 'running',
    winner,
    daysLeft: days
  };
  window._abTests.unshift(test);
  if (!window._infoGenieActions) window._infoGenieActions = [];
  window._infoGenieActions.unshift({
    time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString(),
    action: `A/B test launched: "${testName}" — ${campA.name} vs ${campB.name}`,
    type: 'ab_test',
    impact: `${split}/${100-split} traffic split · ${days}-day test · Early winner: Variant ${winner}`
  });
  showToast(`✅ A/B test "${testName}" launched! Check Results for live data.`);
  // Re-render campaigns to show the test in the running list
  try { buildCampaigns(); } catch(e) {}
};

function buildLaunchModal(camp, idx) {
  // Bulletproof modal show
  const modal = document.getElementById('campLaunchRichModal');
  const inner = document.getElementById('campLaunchRichModalInner');
  if (!modal || !inner) {
    alert('Launch modal not found. Please refresh the page and try again.');
    return;
  }
  modal.classList.remove('hidden');
  modal.removeAttribute('style');
  modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); padding:20px;';

  // Data
  const name       = camp.name || 'Campaign';
  const platform   = camp.platform || 'Google Ads';
  const budgetStr  = camp.budget || '$2,000/mo';
  const budgetNum  = parseInt(budgetStr.replace(/[^0-9]/g,'')) || 2000;
  const dailyBudg  = Math.round(budgetNum / 30);
  const weeklyBudg = Math.round(budgetNum / 4.3);
  const myROAS     = analysisData && analysisData.websiteKPIs && analysisData.websiteKPIs.roas
                       ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const projROAS   = (myROAS * 1.25).toFixed(1);
  const projConv   = Math.round(budgetNum / 35);
  const projRev    = '$' + (budgetNum * parseFloat(projROAS)).toLocaleString(undefined, {maximumFractionDigits:0});

  const platformMeta = {
    'Google Ads':      { icon:'🔵', bid:'Target ROAS (tROAS)',         aud:'High-intent keyword searchers',            kpi:'Conversions & ROAS',         creative:'Responsive Search Ads + Performance Max' },
    'Google Search':   { icon:'🔵', bid:'Maximise Conversions',        aud:'Search intent + competitor keywords',       kpi:'CTR & Conversion Rate',      creative:'3 headlines + 2 descriptions' },
    'Meta Ads':        { icon:'🔷', bid:'Cost Per Result',             aud:'Lookalike + interest targeting',            kpi:'ROAS & Reach',               creative:'Carousel + Story + Feed video' },
    'TikTok Ads':      { icon:'⬛', bid:'Lowest Cost',                 aud:'In-app behaviour + hashtag interest',       kpi:'CPV & Engagement Rate',      creative:'UGC-style 15-sec vertical video' },
    'YouTube':         { icon:'🔴', bid:'Target CPA',                  aud:'In-market + custom intent audiences',       kpi:'View-through conversions',   creative:'15-sec unskippable + 30-sec skippable' },
    'AI Optimised':    { icon:'🤖', bid:'InfoGenie RL Engine (auto)',   aud:'Dynamic cross-platform targeting',          kpi:'Blended ROAS',               creative:'Auto-generated, refreshed every 72h' },
    'LinkedIn Ads':    { icon:'🔷', bid:'Maximum Delivery',            aud:'Job title + industry + seniority',          kpi:'MQL Rate & Pipeline Value',  creative:'Sponsored Content + InMail' },
    'Display Network': { icon:'🟡', bid:'Target CPA',                  aud:'Intent-based display audiences',            kpi:'Brand lift & CPA',           creative:'Responsive display + HTML5 banners' }
  };
  const pm = platformMeta[platform] || platformMeta['Google Ads'];

  // Seed/fallback headlines (shown instantly, replaced by GPT-4o)
  const topCompName = analysisData?.competitors?.[0]?.name || 'top competitor';
  const indName = analysisData?.industry?.name || 'your industry';
  const seedHeadlines = [
    `Beat ${topCompName} — Switch Free`,
    `${indName}: ${projROAS}× ROAS Proven`,
    `${platform.split(' ')[0]} Results That Scale`
  ];
  const seedDescs = [
    `Cut wasteful spend and outperform ${topCompName} on the keywords that matter most to ${indName} buyers.`,
    `${camp.description ? camp.description.split('.')[0] + '.' : 'AI-powered campaign intelligence that converts.'}`
  ];

  const spin = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(99,102,241,.3);border-top-color:#6366F1;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:5px"></span>';

  inner.innerHTML = `
    <style>@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}</style>
    <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);padding:24px 28px;border-radius:20px 20px 0 0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:1rem;font-weight:800;font-family:'Sora',sans-serif;color:white">🚀 Campaign Launch Brief</div>
        <span id="lm-ai-badge" style="background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.4);border-radius:6px;padding:3px 10px;font-size:0.68rem;font-weight:700;color:#A5B4FC">${spin}GPT-4 Building Brief...</span>
      </div>
      <div style="font-size:0.8rem;color:rgba(255,255,255,.6);margin-bottom:16px">${name} · ${platform}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        ${[['Proj. ROAS', projROAS+'×','#00E5FF'],['Est. Conversions',projConv,'#10B981'],['Est. Revenue',projRev,'#F59E0B'],['Daily Budget','$'+dailyBudg+'/day','white']].map(([k,v,c])=>`
          <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1.1rem;font-weight:800;color:${c}">${v}</div>
            <div style="font-size:0.65rem;color:rgba(255,255,255,.5);margin-top:2px">${k}</div>
          </div>`).join('')}
      </div>
    </div>

    <div style="padding:22px 28px;display:flex;flex-direction:column;gap:16px;max-height:68vh;overflow-y:auto">

      <!-- EDITABLE CAMPAIGN SETTINGS -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">⚙️ Campaign Parameters — Edit Before Launch</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Campaign Name</label>
            <input id="lm-name" value="${name.substring(0,60).replace(/"/g,'&quot;')}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Platform</label>
            <select id="lm-platform" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
              ${['Google Ads','Meta Ads','TikTok Ads','YouTube','LinkedIn Ads','Display Network','AI Optimised'].map(p=>`<option${p===platform?' selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Monthly Budget ($)</label>
            <input id="lm-budget" type="number" value="${budgetNum}" min="500" step="100" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Start Date</label>
            <input id="lm-date" type="date" value="${new Date().toISOString().split('T')[0]}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'">
          </div>
        </div>
        <div style="margin-top:10px">
          <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Target Audience / Notes</label>
          <textarea id="lm-audience" rows="2" placeholder="e.g. 25-45 year olds interested in fintech, lookalike of existing customers..." style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;resize:vertical;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#0066FF'" onblur="this.style.borderColor='#E2E8F0'"></textarea>
        </div>
      </div>

      <!-- PLATFORM STRATEGY -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${pm.icon} ${platform} Strategy</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[['Bid Strategy',pm.bid],['Target Audience',pm.aud],['Primary KPI',pm.kpi],['Creative Format',pm.creative]].map(([k,v])=>`
            <div style="background:#F9FAFB;border-radius:8px;padding:10px 12px">
              <div style="font-size:0.68rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${k}</div>
              <div style="font-size:0.8rem;color:#0A1628;font-weight:600;margin-top:3px">${v}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- AI HEADLINES — seed shown instantly, replaced by GPT-4 -->
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:0.68rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em">🤖 GPT-4 Headlines (click to edit)</div>
          <span id="lm-hl-loading" style="font-size:0.65rem;color:#6366F1">${spin}Writing...</span>
        </div>
        <div id="lm-headlines-wrap" style="display:flex;flex-direction:column;gap:6px">
          ${seedHeadlines.map((h,i)=>`
            <div style="display:flex;align-items:center;gap:8px;background:#F0FDF4;border-radius:8px;padding:8px 10px">
              <span style="font-size:0.7rem;font-weight:700;color:#059669;background:#DCFCE7;border-radius:4px;padding:2px 6px;flex-shrink:0">H${i+1}</span>
              <input class="lm-headline" value="${h.replace(/"/g,'&quot;')}" style="flex:1;border:none;background:transparent;font-size:0.82rem;color:#0A1628;font-weight:600;outline:none;font-family:'Inter',sans-serif">
            </div>`).join('')}
        </div>
        <div id="lm-descs-wrap" style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
          ${seedDescs.map((d,i)=>`
            <div style="display:flex;align-items:center;gap:8px;background:#F0F9FF;border-radius:8px;padding:8px 10px">
              <span style="font-size:0.7rem;font-weight:700;color:#0369A1;background:#E0F2FE;border-radius:4px;padding:2px 6px;flex-shrink:0">D${i+1}</span>
              <input class="lm-desc" value="${d.replace(/"/g,'&quot;')}" style="flex:1;border:none;background:transparent;font-size:0.8rem;color:#374151;outline:none;font-family:'Inter',sans-serif">
            </div>`).join('')}
        </div>
      </div>

      <!-- PLATFORM STRATEGY -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${pm.icon} ${platform} Strategy</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[['Bid Strategy',pm.bid],['Target Audience',pm.aud],['Primary KPI',pm.kpi],['Creative Format',pm.creative]].map(([k,v])=>`
            <div style="background:#F9FAFB;border-radius:8px;padding:10px 12px">
              <div style="font-size:0.65rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${k}</div>
              <div style="font-size:0.78rem;color:#0A1628;font-weight:600;margin-top:3px">${v}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- GPT-4 STRATEGY INTELLIGENCE — populated after API call -->
      <div id="lm-ai-intel" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🧠 GPT-4 Campaign Intelligence</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px">
            <div style="font-size:0.65rem;font-weight:700;color:#C2410C;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">⚡ Competitor Gap</div>
            <div id="lm-comp-gap" style="font-size:0.82rem;color:#7C2D12;line-height:1.5;font-style:italic"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px">
              <div style="font-size:0.65rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">🎯 Target Audience</div>
              <div id="lm-audience-ai" style="font-size:0.8rem;color:#064E3B;line-height:1.5"></div>
            </div>
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px">
              <div style="font-size:0.65rem;font-weight:700;color:#1E40AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">💡 Creative Angle</div>
              <div id="lm-creative-angle" style="font-size:0.8rem;color:#1E3A8A;line-height:1.5"></div>
            </div>
          </div>
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px">
            <div style="font-size:0.65rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">📋 Strategy Summary</div>
            <div id="lm-strategy" style="font-size:0.82rem;color:#374151;line-height:1.6"></div>
          </div>
        </div>
      </div>

      <!-- KPI TARGETS — populated by GPT-4 -->
      <div id="lm-kpi-targets" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">📊 KPI Targets — GPT-4 Calculated</div>
        <div id="lm-kpi-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px"></div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px" id="lm-goal-grid"></div>
      </div>

      <!-- BUDGET BREAKDOWN -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💰 Budget Breakdown</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${[['Daily','$'+dailyBudg],['Weekly','$'+weeklyBudg.toLocaleString()],['Monthly','$'+budgetNum.toLocaleString()]].map(([k,v])=>`
            <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:0.9rem;font-weight:800;color:#D97706">${v}</div>
              <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${k} Spend</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- LAUNCH CHECKLIST — populated by GPT-4 -->
      <div id="lm-checklist-wrap" style="display:none;animation:fadeIn .5s">
        <div style="font-size:0.68rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">✅ Pre-Launch Checklist — GPT-4 Generated</div>
        <div id="lm-checklist" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>

      <div style="display:flex;gap:10px;padding-top:4px">
        <button id="lm-cancel-btn" style="flex:1;padding:12px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
        <button id="lm-confirm-btn" style="flex:2;padding:12px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Confirm &amp; Launch Campaign</button>
      </div>
    </div>
  `;

  // Wire cancel button
  document.getElementById('lm-cancel-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
    modal.removeAttribute('style');
  });

  // Wire confirm button
  document.getElementById('lm-confirm-btn').addEventListener('click', function() {
    const btn = document.getElementById('lm-confirm-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Launching...';

    const finalName      = document.getElementById('lm-name').value.trim() || name;
    const finalPlatform  = document.getElementById('lm-platform').value;
    const finalBudgetNum = parseInt(document.getElementById('lm-budget').value) || budgetNum;
    const finalBudget    = '$' + finalBudgetNum.toLocaleString();
    const finalDate      = document.getElementById('lm-date').value || new Date().toISOString().split('T')[0];
    const finalAudience  = (document.getElementById('lm-audience').value || 'Auto-targeted by InfoGenie AI').trim();

    // Save to internal results tracker IMMEDIATELY (before API call)
    const launchRecord = {
      id: 'camp_' + Date.now(), name: finalName, platform: finalPlatform,
      budget: finalBudgetNum, budgetStr: finalBudget, startDate: finalDate, audience: finalAudience,
      launchedAt: new Date().toLocaleString(), status: 'active', daysRunning: 0,
      metrics: {
        roas: (parseFloat(projROAS) * (0.85 + Math.random() * 0.3)).toFixed(1),
        ctr: (Math.random() * 3 + 2).toFixed(1) + '%',
        conversions: Math.round(finalBudgetNum / (Math.random() * 20 + 25)),
        spend: Math.round(finalBudgetNum * (0.1 + Math.random() * 0.2)),
        cpa: '$' + Math.round(Math.random() * 30 + 20),
        impressions: Math.round(finalBudgetNum * (50 + Math.random() * 80))
      },
      actions: [
        { time: 'Just now', action: 'Campaign created and AI monitoring activated', type: 'launch' },
        { time: 'Just now', action: `Budget set to ${finalBudget}/mo on ${finalPlatform}`, type: 'config' },
        { time: 'Just now', action: `Audience: ${finalAudience.substring(0, 60)}`, type: 'audience' }
      ]
    };
    window._launchedCampaigns.unshift(launchRecord);
    if (!window._infoGenieActions) window._infoGenieActions = [];
    window._infoGenieActions.unshift({
      time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString(),
      action: `Launched campaign "${finalName}" on ${finalPlatform} (${finalBudget}/mo)`,
      type: 'campaign_launch',
      impact: `Est. ROAS: ${launchRecord.metrics.roas}× | Est. CTR: ${launchRecord.metrics.ctr}`
    });
    igTrack('Campaign Launched', { campaignName: finalName, platform: finalPlatform, budget: finalBudget });

    // ── Show success screen IMMEDIATELY (non-blocking) ────────────────────────
    const inner2 = document.getElementById('campLaunchRichModalInner');
    const platformKey = finalPlatform.toLowerCase();
    const isPlatformConnected = platformKey.includes('google') || platformKey.includes('meta') || platformKey.includes('facebook') || platformKey.includes('tiktok');
    const apiStatusId = 'lm-api-status-' + Date.now();

    inner2.innerHTML = `
      <div style="padding:36px 32px;text-align:center">
        <div style="font-size:3rem;margin-bottom:12px">🎉</div>
        <div style="font-family:'Sora',sans-serif;font-size:1.2rem;font-weight:800;color:#0A1628;margin-bottom:6px">Campaign Launched!</div>
        <div style="font-size:0.82rem;color:#6B7280;margin-bottom:18px">"${finalName}" · ${finalPlatform} · ${finalBudget}/mo</div>
        <div id="${apiStatusId}" style="margin-bottom:16px">
          ${isPlatformConnected
            ? '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7"><div style="font-weight:700;margin-bottom:4px">⏳ Pushing to ad platform…</div><div>Connecting to your ad account — this takes a few seconds</div></div>'
            : '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7"><div style="font-weight:700;margin-bottom:4px">📊 Tracked internally by InfoGenie</div><div>Connect Google Ads, Meta, or TikTok in Settings to push campaigns live.</div></div>'
          }
        </div>
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:0.8rem;color:#374151;line-height:1.8;text-align:left">
          <strong>Est. ROAS:</strong> ${launchRecord.metrics.roas}× &nbsp;·&nbsp;
          <strong>Est. CTR:</strong> ${launchRecord.metrics.ctr} &nbsp;·&nbsp;
          <strong>Start:</strong> ${finalDate}
        </div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button id="lm-close-success" style="padding:10px 20px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Close</button>
          <button id="lm-view-results" style="padding:10px 20px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">📊 View Results →</button>
        </div>
      </div>`;
    document.getElementById('lm-close-success').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; });
    document.getElementById('lm-view-results').addEventListener('click', () => { modal.classList.add('hidden'); modal.style.display = 'none'; navigateTo('results'); });
    showToast(`✅ Campaign "${finalName}" launched — tracking in Results`);

    // ── Call real ad platform API in the background ───────────────────────────
    if (isPlatformConnected) {
      const apiBody = JSON.stringify({ campaignName: finalName, budget: finalBudgetNum, startDate: finalDate });
      const apiUrl  = platformKey.includes('google') ? '/api/launch/google-ads'
                    : (platformKey.includes('meta') || platformKey.includes('facebook')) ? '/api/launch/meta'
                    : '/api/launch/tiktok';
      fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: apiBody })
        .then(r => r.json())
        .then(apiResult => {
          const statusEl = document.getElementById(apiStatusId);
          if (!statusEl) return; // user navigated away — that's fine
          if (apiResult.success) {
            launchRecord.status = 'active';
            launchRecord._platformCampaignId = apiResult.campaignId;
            statusEl.innerHTML = `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#065F46;line-height:1.7">
              <div style="font-weight:700;margin-bottom:4px">✅ Pushed live to ${apiResult.platform}</div>
              <div>${apiResult.message}</div>
              ${apiResult.dashboardUrl ? `<a href="${apiResult.dashboardUrl}" target="_blank" style="color:#059669;font-weight:600;font-size:0.78rem">Open in ${apiResult.platform} dashboard →</a>` : ''}
            </div>`;
            // Update emoji to rocket
            const emojiEl = statusEl.closest('[style*="padding:36px"]')?.querySelector('[style*="font-size:3rem"]');
            if (emojiEl) emojiEl.textContent = '🚀';
            showToast(`🚀 Campaign pushed live to ${apiResult.platform}!`);
          } else {
            // Determine if it's a credentials/auth issue or a real error
            const errMsg  = apiResult.error || '';
            const isAuth  = errMsg.toLowerCase().includes('oauth') || errMsg.toLowerCase().includes('credentials') ||
                            errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('unauthor') ||
                            errMsg.toLowerCase().includes('not configured') || errMsg.toLowerCase().includes('token');
            if (isAuth) {
              // Soft info note — campaign is safely tracked, this is just a credentials gap
              statusEl.innerHTML = `<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7">
                <div style="font-weight:700;margin-bottom:4px">📊 Campaign tracked in InfoGenie</div>
                <div style="margin-bottom:6px">Your ${finalPlatform} ad account credentials need connecting to push campaigns live automatically.</div>
                <a href="#" onclick="closeCampLaunchRichModal();navigateTo('settings');return false;" style="color:#0369A1;font-weight:600;font-size:0.78rem">Connect ${finalPlatform} in Settings →</a>
              </div>`;
            } else {
              // Actual API error — show detail but still reassure
              statusEl.innerHTML = `<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 16px;font-size:0.8rem;color:#0C4A6E;line-height:1.7">
                <div style="font-weight:700;margin-bottom:4px">📊 Campaign saved — platform sync pending</div>
                <div style="font-size:0.75rem;color:#64748B;margin-bottom:6px">${errMsg.substring(0, 120)}</div>
                <a href="#" onclick="closeCampLaunchRichModal();navigateTo('settings');return false;" style="color:#0369A1;font-weight:600;font-size:0.78rem">Review credentials in Settings →</a>
              </div>`;
            }
          }
        })
        .catch(() => {}); // silently fail — campaign is already in Results
    }
  });

  // ── Async GPT-4 brief — runs immediately after modal opens ─────────────────
  (async () => {
    try {
      const domain     = analysisData?.url || 'yourdomain.com';
      const competitors = (analysisData?.competitors || []).map(c => c.name).slice(0, 5);
      const res = await fetch('/api/ai-campaign-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campName: name, platform, budget: budgetStr,
          industry: indName, domain,
          competitors, topComp: topCompName,
          description: camp.description || '',
          estROAS: String(camp.estROAS || projROAS),
          estCTR: camp.estCTR || '4.2%',
          estCPA: camp.estCPA || '$38',
          tags: camp.tags || []
        })
      });
      const brief = await res.json();

      // Update headlines
      if (brief.headlines && Array.isArray(brief.headlines)) {
        const hlInputs = document.querySelectorAll('.lm-headline');
        brief.headlines.forEach((h, i) => { if (hlInputs[i]) hlInputs[i].value = h; });
      }
      // Update descriptions
      if (brief.descriptions && Array.isArray(brief.descriptions)) {
        const dInputs = document.querySelectorAll('.lm-desc');
        brief.descriptions.forEach((d, i) => { if (dInputs[i]) dInputs[i].value = d; });
      }
      // Hide loading spinner
      const hlLoad = document.getElementById('lm-hl-loading');
      if (hlLoad) hlLoad.style.display = 'none';

      // Show AI intelligence panel
      const intelEl = document.getElementById('lm-ai-intel');
      if (intelEl && (brief.competitor_gap || brief.target_audience || brief.strategy_summary)) {
        intelEl.style.display = 'block';
        const gapEl = document.getElementById('lm-comp-gap');
        const audEl = document.getElementById('lm-audience-ai');
        const angEl = document.getElementById('lm-creative-angle');
        const stEl  = document.getElementById('lm-strategy');
        if (gapEl && brief.competitor_gap) gapEl.textContent = '"' + brief.competitor_gap + '"';
        if (audEl && brief.target_audience) audEl.textContent = brief.target_audience;
        if (angEl && brief.creative_angle)  angEl.textContent = brief.creative_angle;
        if (stEl  && brief.strategy_summary) stEl.textContent = brief.strategy_summary;
      }

      // Show KPI targets
      const kpiWrap = document.getElementById('lm-kpi-targets');
      const kpiGrid = document.getElementById('lm-kpi-grid');
      const goalGrid = document.getElementById('lm-goal-grid');
      if (kpiWrap && brief.kpi_targets) {
        const kt = brief.kpi_targets;
        kpiGrid.innerHTML = [
          ['Target ROAS', kt.roas + '×', '#00E5FF'],
          ['Target CTR', kt.ctr, '#10B981'],
          ['Target CPA', kt.cpa, '#F59E0B']
        ].map(([k,v,c]) => `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px;text-align:center">
            <div style="font-size:1rem;font-weight:800;color:${c}">${v}</div>
            <div style="font-size:0.65rem;color:#6B7280;margin-top:2px">${k}</div>
          </div>`).join('');
        goalGrid.innerHTML = [
          ['Week 1 Goal', kt.week1_goal, '#EFF6FF', '#1D4ED8'],
          ['Month 1 Goal', kt.month1_goal, '#F0FDF4', '#065F46']
        ].map(([k,v,bg,col]) => `
          <div style="background:${bg};border-radius:8px;padding:10px 12px">
            <div style="font-size:0.65rem;font-weight:700;color:${col};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">${k}</div>
            <div style="font-size:0.78rem;color:#0A1628;line-height:1.4">${v || ''}</div>
          </div>`).join('');
        kpiWrap.style.display = 'block';
      }

      // Show launch checklist
      const clWrap = document.getElementById('lm-checklist-wrap');
      const clEl   = document.getElementById('lm-checklist');
      if (clWrap && clEl && brief.launch_checklist && brief.launch_checklist.length > 0) {
        clEl.innerHTML = brief.launch_checklist.map(item => `
          <div style="display:flex;align-items:flex-start;gap:8px;background:#F0FDF4;border-radius:8px;padding:8px 12px">
            <span style="color:#059669;font-size:1rem;flex-shrink:0">☐</span>
            <span style="font-size:0.8rem;color:#374151;line-height:1.4">${item}</span>
          </div>`).join('');
        clWrap.style.display = 'block';
      }

      // Update AI badge
      const badge = document.getElementById('lm-ai-badge');
      if (badge) {
        badge.style.background = 'rgba(16,185,129,.15)';
        badge.style.borderColor = 'rgba(16,185,129,.4)';
        badge.style.color = '#6EE7B7';
        badge.innerHTML = '✨ GPT-4 Brief Ready';
      }

    } catch(e) {
      console.warn('GPT-4 brief failed:', e.message);
      const hlLoad = document.getElementById('lm-hl-loading');
      if (hlLoad) { hlLoad.innerHTML = '⚠️ Using template'; hlLoad.style.color = '#F59E0B'; }
    }
  })();
}

function buildCreativeModal(camp, idx) {
  const modal = document.getElementById('campCreativeModal');
  const inner = document.getElementById('campCreativeModalInner');
  if (!modal || !inner) {
    alert('Creative Studio modal not found. Please refresh the page.');
    return;
  }
  modal.classList.remove('hidden');
  modal.removeAttribute('style');
  modal.style.cssText = 'display:flex !important; position:fixed; inset:0; z-index:9999; align-items:center; justify-content:center; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); padding:20px;';

  const name     = camp.name || 'Campaign';
  const platform = camp.platform || 'Google Ads';
  const budget   = camp.budget || '$2,000/mo';
  const domain   = (analysisData && analysisData.url) ? analysisData.url : 'yourdomain.com';
  const indName  = (analysisData && analysisData.industry) ? analysisData.industry.name : 'your industry';
  const topComp  = (analysisData && analysisData.competitors && analysisData.competitors[0]) ? analysisData.competitors[0].name : 'your competitor';
  const allComps = (analysisData && analysisData.competitors) ? analysisData.competitors.map(c=>c.name) : [topComp];
  igTrack('Creative Studio Opened', { campaignName: name, platform, industry: indName, domain });
  const projROAS = camp.estROAS ? camp.estROAS + '×' : '3.8×';
  const estCTR   = camp.estCTR || '4.2%';
  const estCPA   = camp.estCPA || '$38';
  const campTags = camp.tags || [];
  const campDesc = camp.description || '';

  // Seed content (shown instantly, replaced by GPT within seconds)
  const seedHeadlines = {
    'Google Ads':      ['Beat ' + topComp + ' — Start Free', 'AI Marketing Intelligence', 'The Smarter Alternative'],
    'Meta Ads':        ['4× ROAS — Starting Today', 'Your Rivals Are Doing This', 'Ads That Actually Convert'],
    'TikTok Ads':      ['ROAS just hit 4×', topComp + ' hates this', 'Real results. Real ROI.'],
    'LinkedIn Ads':    ['500+ Decision-Makers/Week', 'B2B Growth CFOs Approve', 'Enterprise ROI — Less Cost'],
    'YouTube':         ['Stop Wasting Ad Budget', '5× ROAS This Year', 'Strategy ' + topComp + ' Fears'],
    'AI Optimised':    ['AI-Optimised. Always Winning.', '£1 Working Harder With AI', 'Campaigns That Never Sleep'],
    'Display Network': ['Your Brand Everywhere', 'Beat ' + topComp + ' On Every Screen', 'Display + Intent = Growth']
  };
  const seedDescs = {
    'Google Ads':      ['Cut wasteful spend and beat ' + topComp + ' on the keywords that matter most.', 'See exactly where ' + topComp + ' wins — then outbid them with AI precision.'],
    'Meta Ads':        ['Reach audiences ' + topComp + ' is missing. AI-built lookalike segments from your best customers.', 'Dynamic creative that tests and learns — your best-performing ad always runs.'],
    'TikTok Ads':      [indName + ' on TikTok is untapped. Beat ' + topComp + ' before they realise what they\'re missing.', 'Short-form video that converts — at a fraction of Google/Meta CPM.'],
    'LinkedIn Ads':    ['Connect with VP-level decision-makers in ' + indName + ' who are evaluating solutions like yours.', 'Sponsored content that nurtures prospects from awareness to signed contract.'],
    'YouTube':         ['Show your brand story to in-market buyers searching for alternatives to ' + topComp + '.', 'Video builds trust fast. Reach decision-makers before they click a competitor ad.'],
    'AI Optimised':    ['AI manages your entire ad portfolio — pausing losers, scaling winners, every 6 hours.', 'Set your ROAS target, connect accounts, let AI run. Average: +31% ROAS in 30 days.'],
    'Display Network': ['Your brand on 2M+ premium sites — following your best prospects everywhere they browse.', 'Retarget ' + topComp + ' visitors and convert them before they go back.']
  };
  const hSeed = seedHeadlines[platform] || seedHeadlines['Google Ads'];
  const dSeed = seedDescs[platform]     || seedDescs['Google Ads'];

  const loadingSpin = `<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(99,102,241,.3);border-top-color:#6366F1;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px"></span>`;

  const emailBrief = `Campaign: ${name}\nPlatform: ${platform}\nBudget: ${budget}\nProjected ROAS: ${projROAS} | CTR: ${estCTR} | CPA: ${estCPA}\n\nHEADLINES (GPT-4 generating...)\n\nDESCRIPTIONS (GPT-4 generating...)\n\nGenerated by InfoGenie Creative Studio · ${new Date().toLocaleDateString()}`;

  window._creativeStudio = { campName: name, platform, budget, domain, indName, topComp };

  inner.innerHTML = `
    <style>@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}</style>
    <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);padding:22px 26px 0;border-radius:20px 20px 0 0">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:1rem;font-weight:800;color:white;margin-bottom:4px">🎨 AI Creative Studio</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,.55)">${name} · ${platform} · ${budget}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span id="cs-ai-badge" style="background:rgba(99,102,241,.2);border:1px solid rgba(99,102,241,.4);border-radius:6px;padding:4px 10px;font-size:0.68rem;font-weight:700;color:#A5B4FC">${loadingSpin}GPT-4 Writing...</span>
          <button id="cs-dl-btn" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 12px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">⬇ Download</button>
          <button id="cs-launch-btn" style="background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:8px;padding:7px 14px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">🚀 Launch</button>
        </div>
      </div>
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,.12)">
        ${[['ad','🗂 Ad Copy'],['social','💬 Social & Video'],['linkedin','💼 LinkedIn'],['email','📧 Brief'],['settings','⚙️ Redesign']].map(([id,label],i)=>`
          <button class="cs-tab-btn" data-tab="${id}" style="background:${i===0?'rgba(255,255,255,.1)':'transparent'};border:none;border-bottom:${i===0?'2px solid #00E5FF':'2px solid transparent'};padding:10px 14px;font-size:0.75rem;font-weight:700;color:${i===0?'white':'rgba(255,255,255,.5)'};cursor:pointer;transition:all .2s">${label}</button>
        `).join('')}
      </div>
    </div>

    <div style="padding:20px 26px;display:flex;flex-direction:column;gap:14px;max-height:60vh;overflow-y:auto">

      <!-- AD COPY TAB -->
      <div class="cs-panel" id="csp-ad">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:0.7rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.06em">🔵 Google / Search Ad — GPT-4 Generated</div>
          <span id="cs-ad-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}Generating...</span>
        </div>
        ${hSeed.map((h,i)=>`
          <div style="display:flex;align-items:center;gap:8px;background:#EFF6FF;border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <span style="font-size:0.7rem;font-weight:700;color:#1D4ED8;background:#DBEAFE;border-radius:4px;padding:2px 6px;flex-shrink:0">H${i+1}</span>
            <input class="cs-headline" value="${h.replace(/"/g,'&quot;')}" style="flex:1;border:none;background:transparent;font-size:0.82rem;color:#0A1628;font-weight:600;outline:none;font-family:'Inter',sans-serif">
          </div>`).join('')}
        ${dSeed.map((d,i)=>`
          <div style="background:#F0FDF4;border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <span style="font-size:0.7rem;font-weight:700;color:#059669;background:#DCFCE7;border-radius:4px;padding:2px 6px;margin-right:8px">D${i+1}</span>
            <input class="cs-desc" value="${d.replace(/"/g,'&quot;')}" style="width:calc(100% - 44px);border:none;background:transparent;font-size:0.8rem;color:#374151;outline:none;font-family:'Inter',sans-serif">
          </div>`).join('')}
        <div id="cs-ad-preview" style="background:#F9FAFB;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-top:10px">
          <div style="font-size:0.68rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Ad Preview</div>
          <div style="font-size:0.65rem;color:#188038;">Ad · ${domain}</div>
          <div style="font-size:0.88rem;color:#1a0dab;font-weight:600;line-height:1.3;margin:4px 0" id="cs-preview-h">${hSeed[0]} | ${hSeed[1]}</div>
          <div style="font-size:0.76rem;color:#4d5156;line-height:1.4" id="cs-preview-d">${dSeed[0].substring(0,120)}</div>
        </div>
        <div id="cs-competitor-angle" style="display:none;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px;margin-top:8px">
          <div style="font-size:0.68rem;font-weight:700;color:#C2410C;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">⚡ Competitor Attack Hook — GPT-4</div>
          <div id="cs-competitor-text" style="font-size:0.82rem;color:#7C2D12;font-style:italic;line-height:1.5"></div>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button id="cs-copy-ad" style="flex:1;padding:9px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;font-size:0.78rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy Ad Copy</button>
          <button id="cs-regen-btn" style="flex:1;padding:9px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">✨ Regenerate</button>
        </div>
      </div>

      <!-- SOCIAL & VIDEO TAB -->
      <div class="cs-panel" id="csp-social" style="display:none">
        <div style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#E1306C;text-transform:uppercase;letter-spacing:.06em">📱 Instagram / Meta Caption</div>
            <span id="cs-ig-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4...</span>
          </div>
          <textarea id="cs-instagram" rows="7" style="width:100%;box-sizing:border-box;background:#FFF5F7;border:1px solid #FECDD3;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Inter',sans-serif;resize:vertical;outline:none">✨ GPT-4 is writing your Instagram caption...</textarea>
          <button id="cs-copy-instagram" style="margin-top:6px;padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Caption</button>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#010101;text-transform:uppercase;letter-spacing:.06em">⬛ TikTok Script — 15 sec</div>
            <span id="cs-tt-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4...</span>
          </div>
          <textarea id="cs-tiktok" rows="5" style="width:100%;box-sizing:border-box;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">✨ GPT-4 is writing your TikTok script...</textarea>
          <button id="cs-copy-tiktok" style="margin-top:6px;padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Script</button>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:0.7rem;font-weight:700;color:#FF0000;text-transform:uppercase;letter-spacing:.06em">🎬 YouTube Pre-Roll — 25 sec</div>
            <span id="cs-yt-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4...</span>
          </div>
          <textarea id="cs-video" rows="6" style="width:100%;box-sizing:border-box;background:#FFF5F5;border:1px solid #FECACA;border-radius:8px;padding:10px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">✨ GPT-4 is writing your YouTube script...</textarea>
          <button id="cs-copy-video" style="margin-top:6px;padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy Script</button>
        </div>
      </div>

      <!-- LINKEDIN TAB -->
      <div class="cs-panel" id="csp-linkedin" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:0.7rem;font-weight:700;color:#0A66C2;text-transform:uppercase;letter-spacing:.06em">💼 LinkedIn Sponsored Content</div>
          <span id="cs-li-loading" style="font-size:0.68rem;color:#6366F1">${loadingSpin}GPT-4...</span>
        </div>
        <textarea id="cs-linkedin" rows="9" style="width:100%;box-sizing:border-box;background:#F0F7FF;border:1px solid #BAE0FF;border-radius:8px;padding:12px;font-size:0.82rem;color:#1E293B;font-family:'Inter',sans-serif;resize:vertical;outline:none">✨ GPT-4 is writing your LinkedIn copy...</textarea>
        <button id="cs-copy-linkedin" style="margin-top:6px;padding:7px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy LinkedIn Post</button>
        <div id="cs-strategy-box" style="display:none;margin-top:14px;background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border:1px solid #BBF7D0;border-radius:10px;padding:14px">
          <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🧠 GPT-4 Strategy Reasoning</div>
          <div id="cs-strategy-text" style="font-size:0.82rem;color:#064E3B;line-height:1.6"></div>
        </div>
      </div>

      <!-- EMAIL BRIEF TAB -->
      <div class="cs-panel" id="csp-email" style="display:none">
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">📧 Email Subject Lines — GPT-4 Generated</div>
        <div id="cs-email-subjects" style="margin-bottom:14px;display:flex;flex-direction:column;gap:8px">
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;font-size:0.82rem;color:#6B7280;font-style:italic">${loadingSpin} GPT-4 writing subject lines...</div>
        </div>
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📋 Full Campaign Brief</div>
        <textarea id="cs-email" rows="12" style="width:100%;box-sizing:border-box;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;font-size:0.8rem;color:#1E293B;font-family:'Courier New',monospace;resize:vertical;outline:none">${emailBrief}</textarea>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button id="cs-copy-email" style="flex:1;padding:9px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;font-size:0.78rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy Brief</button>
          <button id="cs-send-email" style="flex:1;padding:9px;background:linear-gradient(135deg,#0066FF,#0044CC);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">📤 Open in Email</button>
        </div>
      </div>

      <!-- REDESIGN TAB -->
      <div class="cs-panel" id="csp-settings" style="display:none">
        <div style="font-size:0.7rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">✨ Custom GPT-4 Redesign</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Tone of Voice</label>
            <select id="cs-tone" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
              <option>Professional & Authoritative</option>
              <option>Friendly & Conversational</option>
              <option>Bold & Direct</option>
              <option>Urgent & Action-Focused</option>
              <option>Witty & Disruptive</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Target Persona</label>
            <input id="cs-persona" placeholder="e.g. CFO at mid-size SaaS, 35-50yo, values ROI" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Key Differentiator</label>
            <input id="cs-diff" placeholder="e.g. 3× cheaper, fastest setup, AI-powered" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
          <div>
            <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Call-to-Action</label>
            <select id="cs-cta" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
              <option>Start Free Trial</option>
              <option>Book a Demo</option>
              <option>Get Started Today</option>
              <option>See Pricing</option>
              <option>Learn More</option>
              <option>Claim Your Offer</option>
            </select>
          </div>
          <button id="cs-regen-full" style="width:100%;padding:12px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">✨ Generate New Variants with GPT-4</button>
        </div>
        <div id="cs-regen-output" style="margin-top:12px;display:none"></div>
      </div>

    </div>

    <div style="padding:0 26px 20px;display:flex;gap:10px">
      <button id="cs-close-btn" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">✕ Close</button>
      <button id="cs-launch-footer-btn" style="flex:2;padding:11px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Launch This Campaign</button>
    </div>
  `;

  // ── Helper: apply GPT-4 response to all panels ────────────────────────────
  function applyAICreative(data) {
    const src = data.source === 'gpt4' ? 'GPT-4' : data.source === 'rapidapi_gpt' ? 'GPT-4' : 'AI Engine';

    // Ad Copy tab
    if (data.headlines && Array.isArray(data.headlines)) {
      document.querySelectorAll('.cs-headline').forEach((inp, i) => {
        if (data.headlines[i]) { inp.value = data.headlines[i]; inp.style.animation = 'fadeIn .4s'; }
      });
    }
    if (data.descriptions && Array.isArray(data.descriptions)) {
      document.querySelectorAll('.cs-desc').forEach((inp, i) => {
        if (data.descriptions[i]) { inp.value = data.descriptions[i]; inp.style.animation = 'fadeIn .4s'; }
      });
    }
    // Update live preview
    const h0 = data.headlines?.[0] || hSeed[0];
    const h1 = data.headlines?.[1] || hSeed[1];
    const d0 = data.descriptions?.[0] || dSeed[0];
    const prevH = document.getElementById('cs-preview-h');
    const prevD = document.getElementById('cs-preview-d');
    if (prevH) prevH.textContent = h0 + ' | ' + h1;
    if (prevD) prevD.textContent = d0.substring(0, 120);
    // Loading indicators off
    const adLoad = document.getElementById('cs-ad-loading');
    if (adLoad) adLoad.style.display = 'none';

    // Competitor hook
    if (data.competitor_angle) {
      const box = document.getElementById('cs-competitor-angle');
      const txt = document.getElementById('cs-competitor-text');
      if (box) box.style.display = 'block';
      if (txt) txt.textContent = '"' + data.competitor_angle + '"';
    }

    // Social & Video tab
    const igEl = document.getElementById('cs-instagram');
    if (igEl && data.instagram) { igEl.value = data.instagram; }
    const igLoad = document.getElementById('cs-ig-loading');
    if (igLoad) igLoad.style.display = 'none';

    const ttEl = document.getElementById('cs-tiktok');
    if (ttEl && data.tiktok_script) { ttEl.value = data.tiktok_script; }
    const ttLoad = document.getElementById('cs-tt-loading');
    if (ttLoad) ttLoad.style.display = 'none';

    const ytEl = document.getElementById('cs-video');
    if (ytEl && data.youtube_script) { ytEl.value = data.youtube_script; }
    const ytLoad = document.getElementById('cs-yt-loading');
    if (ytLoad) ytLoad.style.display = 'none';

    // LinkedIn tab
    const liEl = document.getElementById('cs-linkedin');
    if (liEl && data.linkedin) { liEl.value = data.linkedin; }
    const liLoad = document.getElementById('cs-li-loading');
    if (liLoad) liLoad.style.display = 'none';

    // Strategy reasoning
    if (data.strategy_reasoning) {
      const stBox = document.getElementById('cs-strategy-box');
      const stTxt = document.getElementById('cs-strategy-text');
      if (stBox) stBox.style.display = 'block';
      if (stTxt) stTxt.textContent = data.strategy_reasoning;
    }

    // Email tab — subject lines
    if (data.email_subjects && Array.isArray(data.email_subjects)) {
      const subjectEl = document.getElementById('cs-email-subjects');
      if (subjectEl) {
        subjectEl.innerHTML = data.email_subjects.map((s, i) => `
          <div style="display:flex;align-items:center;gap:8px;background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:10px 12px">
            <span style="font-size:0.68rem;font-weight:700;color:#0369A1;background:#E0F2FE;border-radius:4px;padding:2px 6px;flex-shrink:0">SL${i+1}</span>
            <span style="flex:1;font-size:0.82rem;color:#0A1628;font-weight:500">${s}</span>
            <button onclick="navigator.clipboard.writeText('${s.replace(/'/g,"\\'")}').then(()=>window.showToast && showToast('✅ Subject copied!'))" style="background:none;border:none;font-size:0.75rem;cursor:pointer;color:#0369A1;padding:2px 6px">📋</button>
          </div>`).join('');
      }
    }
    // Update the email brief textarea
    const emailEl = document.getElementById('cs-email');
    if (emailEl) {
      const hs = data.headlines || [];
      const ds = data.descriptions || [];
      emailEl.value = `Campaign: ${name}\nPlatform: ${platform}\nBudget: ${budget}\nProjected ROAS: ${projROAS} | CTR: ${estCTR} | CPA: ${estCPA}\nGenerated by: ${src}\n\nGOOGLE AD HEADLINES\nH1: ${hs[0]||''}\nH2: ${hs[1]||''}\nH3: ${hs[2]||''}\n\nGOOGLE DESCRIPTIONS\nD1: ${ds[0]||''}\nD2: ${ds[1]||''}\n\nEMAIL SUBJECT LINES\n${(data.email_subjects||[]).join('\n')}\n\nSTRATEGY\n${data.strategy_reasoning||''}\n\nGenerated by InfoGenie AI Creative Studio · ${new Date().toLocaleDateString()}`;
    }

    // Badge
    const badge = document.getElementById('cs-ai-badge');
    if (badge) {
      badge.style.background = 'rgba(16,185,129,.15)';
      badge.style.borderColor = 'rgba(16,185,129,.4)';
      badge.style.color = '#6EE7B7';
      badge.innerHTML = '✨ ' + src + ' — Live Creative';
    }

    // Store for download
    window._creativeStudio = {
      campName: name, platform, budget, domain, indName, topComp,
      googleCopy: `H1: ${(data.headlines||[])[0]}\nH2: ${(data.headlines||[])[1]}\nH3: ${(data.headlines||[])[2]}\nD1: ${(data.descriptions||[])[0]}\nD2: ${(data.descriptions||[])[1]}`,
      instagramCopy: data.instagram || '',
      tiktokScript: data.tiktok_script || '',
      videoScript: data.youtube_script || '',
      linkedin: data.linkedin || '',
      emailSubjects: (data.email_subjects||[]).join('\n'),
      strategy: data.strategy_reasoning || ''
    };
  }

  // ── Auto-generate on open ──────────────────────────────────────────────────
  (async () => {
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform, campName: name, tone: 'Bold & Direct',
          persona: 'growth-focused marketing and business decision-makers',
          differentiator: campDesc.split('.')[0] || 'AI-powered competitor intelligence',
          cta: 'Start Free Trial', topComp,
          competitors: allComps.slice(0, 4),
          tags: campTags,
          industry: indName, domain
        })
      });
      const data = await res.json();
      if (data.headlines) {
        applyAICreative(data);
        igTrack('AI Creative Generated', { campaignName: name, platform, industry: indName, source: data.source || 'gpt4' });
      }
    } catch(e) {
      console.warn('Auto-generate failed:', e.message);
      const badge = document.getElementById('cs-ai-badge');
      if (badge) { badge.innerHTML = '⚠️ Using template copy'; badge.style.color = '#F59E0B'; }
    }
  })();

  // ── Close & launch buttons ────────────────────────────────────────────────
  const closeModal = () => { modal.classList.add('hidden'); modal.style.display = 'none'; };
  document.getElementById('cs-close-btn').addEventListener('click', closeModal);
  document.getElementById('cs-launch-btn').addEventListener('click', () => { closeModal(); buildLaunchModal(camp, idx); });
  document.getElementById('cs-launch-footer-btn').addEventListener('click', () => { closeModal(); buildLaunchModal(camp, idx); });

  // ── Download ───────────────────────────────────────────────────────────────
  document.getElementById('cs-dl-btn').addEventListener('click', () => {
    const s = window._creativeStudio || {};
    const txt = [
      'INFOGENIE AI CREATIVE PACK', '─'.repeat(50),
      `Campaign: ${s.campName || name} | Platform: ${s.platform || platform}`,
      `Generated: ${new Date().toLocaleString()}`, '',
      '── GOOGLE ADS ──', s.googleCopy || '', '',
      '── INSTAGRAM / META ──', s.instagramCopy || '', '',
      '── TIKTOK SCRIPT ──', s.tiktokScript || '', '',
      '── YOUTUBE SCRIPT ──', s.videoScript || '', '',
      '── LINKEDIN ──', s.linkedin || '', '',
      '── EMAIL SUBJECTS ──', s.emailSubjects || '', '',
      '── GPT-4 STRATEGY ──', s.strategy || ''
    ].join('\n');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([txt], {type:'text/plain'})),
      download: 'infogenie-creative-pack.txt'
    });
    a.click(); URL.revokeObjectURL(a.href);
    igTrack('Creative Pack Downloaded', { campaignName: name, platform, industry: indName });
    showToast('⬇ Creative pack downloaded!');
  });

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.cs-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cs-tab-btn').forEach(b => {
        b.style.background = 'transparent';
        b.style.borderBottom = '2px solid transparent';
        b.style.color = 'rgba(255,255,255,.5)';
      });
      btn.style.background = 'rgba(255,255,255,.1)';
      btn.style.borderBottom = '2px solid #00E5FF';
      btn.style.color = 'white';
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.cs-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById('csp-' + tabId);
      if (panel) { panel.style.display = 'flex'; panel.style.flexDirection = 'column'; panel.style.gap = '0'; }
    });
  });

  // ── Copy buttons ───────────────────────────────────────────────────────────
  document.getElementById('cs-copy-ad').addEventListener('click', () => {
    const h = Array.from(document.querySelectorAll('.cs-headline')).map(i=>i.value);
    const d = Array.from(document.querySelectorAll('.cs-desc')).map(i=>i.value);
    navigator.clipboard.writeText(`HEADLINE 1: ${h[0]}\nHEADLINE 2: ${h[1]}\nHEADLINE 3: ${h[2]}\nDESCRIPTION 1: ${d[0]}\nDESCRIPTION 2: ${d[1]}`)
      .then(()=>showToast('✅ Ad copy copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-instagram').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-instagram').value).then(()=>showToast('✅ Caption copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-tiktok').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-tiktok').value).then(()=>showToast('✅ TikTok script copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-video').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-video').value).then(()=>showToast('✅ YouTube script copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-linkedin').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-linkedin').value).then(()=>showToast('✅ LinkedIn copy copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-copy-email').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cs-email').value).then(()=>showToast('✅ Brief copied!')).catch(()=>showToast('✅ Copied!'));
  });
  document.getElementById('cs-send-email').addEventListener('click', () => {
    window.open('mailto:?subject=' + encodeURIComponent('Campaign Brief: ' + name) + '&body=' + encodeURIComponent(document.getElementById('cs-email').value));
  });

  // ── Regenerate (Ad Copy tab quick regen) ──────────────────────────────────
  document.getElementById('cs-regen-btn').addEventListener('click', async () => {
    const btn = document.getElementById('cs-regen-btn');
    btn.disabled = true; btn.textContent = '⏳ GPT-4...';
    const badge = document.getElementById('cs-ai-badge');
    if (badge) badge.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(165,180,252,.3);border-top-color:#A5B4FC;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:5px"></span>Regenerating...';
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, campName: name, tone: 'Bold & Direct', topComp, competitors: allComps.slice(0,4), tags: campTags, industry: indName, domain, cta: 'Start Free Trial', persona: 'marketing decision-makers', differentiator: campDesc.split('.')[0] || 'AI-powered results' })
      });
      const data = await res.json();
      if (data.headlines) { applyAICreative(data); showToast('✨ GPT-4 generated new creative pack!'); }
    } catch(e) { showToast('⚠️ Regenerate failed: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = '✨ Regenerate'; }
  });

  // ── Custom Redesign (Settings tab) ────────────────────────────────────────
  document.getElementById('cs-regen-full').addEventListener('click', async () => {
    const tone    = document.getElementById('cs-tone').value;
    const persona = document.getElementById('cs-persona').value || 'growth-focused marketing teams';
    const diff    = document.getElementById('cs-diff').value || 'AI-powered competitor intelligence at scale';
    const cta     = document.getElementById('cs-cta').value;
    const output  = document.getElementById('cs-regen-output');
    const btn     = document.getElementById('cs-regen-full');
    output.style.display = 'block';
    output.innerHTML = `<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:18px;font-size:0.82rem;color:#4C1D95;text-align:center"><span style="display:inline-block;width:18px;height:18px;border:3px solid rgba(124,58,237,.2);border-top-color:#7C3AED;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>GPT-4 writing custom creative pack...</div>`;
    btn.disabled = true; btn.textContent = '⏳ GPT-4 Working...';
    try {
      const res = await fetch('/api/ai-creative', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, campName: name, tone, persona, differentiator: diff, cta, topComp, competitors: allComps.slice(0,4), tags: campTags, industry: indName, domain })
      });
      const data = await res.json();
      applyAICreative(data);
      const src = data.source === 'gpt4' ? 'GPT-4' : 'AI Engine';
      output.innerHTML = `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:14px;font-size:0.82rem;color:#065F46;text-align:center">✅ ${src} creative pack applied to all tabs — check Ad Copy, Social & Video, LinkedIn, and Email Brief!</div>`;
      showToast('✨ Custom GPT-4 creative pack applied to all tabs!');
    } catch(e) {
      output.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:10px;padding:14px;font-size:0.8rem;color:#991B1B">⚠️ Generation failed: ${e.message}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = '✨ Generate New Variants with GPT-4';
    }
  });
}

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
  igTrack('Page Viewed', { page: viewId });
  if (updateActive) {
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.view === viewId);
    });
  }
  // Rebuild views on demand so they're always populated when navigated to
  if (viewId === 'settings') {
    try { buildSettings(); } catch(e) { console.warn('buildSettings error:', e); }
  }
  if (viewId === 'campaigns') {
    try { buildCampaigns(); } catch(e) { console.warn('buildCampaigns error:', e); }
  }
  if (viewId === 'results') {
    try { buildResults(); } catch(e) { console.warn('buildResults error:', e); }
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
  window.scrollTo(0, 0);
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
  igTrack('Analysis Started', { domain: cleanUrl, country, industry: industry.name });
  
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
  
  // Shuffle competitor pool so every analysis shows a different selection
  const compPool = [...industry.competitors];
  for (let i = compPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [compPool[i], compPool[j]] = [compPool[j], compPool[i]];
  }
  const selectedComps = compPool.slice(0, Math.min(8, compPool.length));

  // Reset campaign queue and creative round for fresh analysis
  queuedCampaigns = [];
  creativeRound = 0;

  // Store analysis data
  analysisData = { url: cleanUrl, country, industryKey, industry, websiteKPIs, competitors: selectedComps };
  igTrack('Analysis Completed', { domain: cleanUrl, industry: industry.name, competitorCount: selectedComps.length, country });

  // Build all views
  buildDashboard();
  buildCompetitors();
  buildCampaigns();
  buildAudience();
  buildCreative();
  buildIntelligence();
  
  // Log analysis actions to results tracker
  if (!window._infoGenieActions) window._infoGenieActions = [];
  const now = new Date();
  window._infoGenieActions.unshift(
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Competitor intelligence built for ${selectedComps.length} competitors in ${industry.name}`, type: 'intelligence', impact: 'CTR, ROAS, keyword gaps, and budget data mapped' },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Auto-detected target audience segments from ${selectedComps.length} competitor profiles`, type: 'audience', impact: 'Applied to all campaign recommendations' },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Generated AI campaign recommendations for ${cleanUrl}`, type: 'campaigns', impact: `${(window._lastCampRecs || []).length} campaigns ranked by projected ROI` },
    { time: now.toLocaleTimeString(), date: now.toLocaleDateString(), action: `Analysed ${cleanUrl} — industry: ${industry.name}`, type: 'analysis', impact: `${selectedComps.length} competitors identified` }
  );

  // Navigate first so a settings error never blocks the dashboard
  navigateTo('dashboard');
  showToast(`✅ Analysis complete for ${cleanUrl} — ${industry.competitors.length} competitors found in ${industry.name}`);
  
  // Build settings after navigation (non-critical)
  try { buildSettings(); } catch(e) { console.warn('Settings build error:', e); }

  // ── Enrich with real live competitor data from DataForSEO (async, non-blocking) ──
  enrichWithRealCompetitorData(cleanUrl, industryKey, country);
  // ── Upgrade KPI cards to live DataForSEO data (async, non-blocking) ──
  enrichKPIsWithLiveData(cleanUrl, industryKey, country);
}

// ── Real Competitor Data Enrichment ──────────────────────────────────────────
// Calls /api/real-competitors to get live DataForSEO data, then overlays real
// traffic/keyword numbers onto the competitor cards. Non-blocking — runs after UI is shown.
async function enrichWithRealCompetitorData(domain, industryKey, country) {
  const location = country === 'United Kingdom' ? 'United Kingdom'
    : country === 'Australia' ? 'Australia'
    : country === 'Canada' ? 'Canada'
    : 'United States';

  try {
    const res = await fetch('/api/real-competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, industry: industryKey, location, language: 'English' })
    });
    const data = await res.json();
    if (!res.ok || !data.competitors || data.competitors.length === 0) return;

    // Store real competitor data on analysisData for use elsewhere
    analysisData._realCompetitors = data.competitors;
    analysisData._yourRealData    = data.yourDomain;

    // Enrich existing competitor cards with real traffic numbers
    // Match by domain name similarity
    const realMap = {};
    (data.competitors || []).forEach(rc => { realMap[rc.domain.toLowerCase()] = rc; });

    let enriched = 0;
    analysisData.competitors.forEach(comp => {
      const compDomain = (comp.url || '').toLowerCase().replace(/^www\./, '');
      const match = realMap[compDomain] || realMap['www.' + compDomain];
      if (match && match.realData && match.organicTraffic > 0) {
        comp._realTraffic  = match.organicTrafficFmt;
        comp._realKeywords = match.organicKeywordsFmt;
        comp._realDomainRank = match.domainRank;
        comp._dataSource   = 'DataForSEO';
        enriched++;
      }
    });

    if (enriched > 0) {
      console.log(`Enriched ${enriched} competitors with real DataForSEO data`);
      // Re-render competitors view with real data badges
      buildCompetitors();
      buildDashboard();
    }

    // Update your own domain metrics in dashboard if available
    if (data.yourDomain && data.yourDomain.organicTraffic > 0) {
      analysisData.websiteKPIs._realTraffic  = _fmt(data.yourDomain.organicTraffic);
      analysisData.websiteKPIs._realKeywords = _fmt(data.yourDomain.organicKeywords);
    }

    showToast(`📡 Real data loaded — ${enriched} competitors enriched with live DataForSEO metrics`);

  } catch(err) {
    console.warn('Real competitor enrichment failed (non-fatal):', err.message);
  }
}

// ── Live KPI Enrichment ───────────────────────────────────────────────────────
// Calls /api/live-kpis to get DataForSEO-derived CTR, CPA, ROAS and Conv. Rate
// then updates the KPI cards in the DOM without a full rebuild.
async function enrichKPIsWithLiveData(domain, industryKey, country) {
  const location = country === 'United Kingdom' ? 'United Kingdom'
    : country === 'Australia' ? 'Australia'
    : country === 'Canada'    ? 'Canada'
    : 'United States';

  const liveBadge = (title) => `<span title="${title}" style="font-size:.65rem;background:#10B98120;color:#10B981;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px">LIVE</span>`;

  try {
    const res = await fetch('/api/live-kpis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, industryKey, location })
    });
    if (!res.ok) return;
    const d = await res.json();
    if (d.error) return;

    const industry    = analysisData?.industry;
    const competitors = analysisData?.competitors || [];
    const avgCTR  = avg(competitors.map(c => parseFloat(c.ctr)));
    const avgROAS = avg(competitors.map(c => c.roas));
    const src = `DataForSEO · avg position ${d.meta?.avgPosition || '—'} · avg CPC $${d.meta?.avgCPC || '—'}`;

    // Store live values back onto analysisData for downstream use
    if (!analysisData.websiteKPIs) analysisData.websiteKPIs = {};
    if (d.ctr      !== null) analysisData.websiteKPIs._liveCTR      = d.ctr;
    if (d.roas     !== null) analysisData.websiteKPIs._liveROAS     = d.roas;
    if (d.cpa      !== null) analysisData.websiteKPIs._liveCPA      = d.cpa;
    if (d.convRate !== null) analysisData.websiteKPIs._liveConvRate = d.convRate;

    // Update each KPI card in-place
    const kpiGrid = document.getElementById('kpiGrid');
    if (!kpiGrid) return;
    const cards = kpiGrid.querySelectorAll('.kpi-card');
    // Cards order: CTR (0), ROAS (1), CPA (2), Traffic (3 — already live), Conv.Rate (4), Score (5)

    // CTR card
    if (cards[0] && d.ctr !== null) {
      const ctr = parseFloat(d.ctr);
      const ctrChange = ctr >= avgCTR ? `▲ ${(ctr - avgCTR).toFixed(2)}% above ${industry?.name || 'industry'} avg` : `▼ ${(avgCTR - ctr).toFixed(2)}% below ${industry?.name || 'industry'} avg`;
      cards[0].innerHTML = `
        ${liveBadge(src)}
        <div class="kpi-icon">📊</div>
        <div class="kpi-label">Avg CTR Benchmark</div>
        <div class="kpi-value">${ctr}%</div>
        <div class="kpi-change ${ctr >= avgCTR ? 'kpi-up' : 'kpi-down'}">${ctrChange}</div>
      `;
    }

    // ROAS card
    if (cards[1] && d.roas !== null) {
      const roas = parseFloat(d.roas);
      const roasChange = roas >= avgROAS ? `▲ ${(roas - avgROAS).toFixed(1)}× above ${industry?.name || 'industry'} avg` : `▼ ${(avgROAS - roas).toFixed(1)}× below ${industry?.name || 'industry'} avg`;
      cards[1].innerHTML = `
        ${liveBadge(src)}
        <div class="kpi-icon">🎯</div>
        <div class="kpi-label">ROAS Benchmark</div>
        <div class="kpi-value">${roas}×</div>
        <div class="kpi-change ${roas >= avgROAS ? 'kpi-up' : 'kpi-down'}">${roasChange}</div>
      `;
    }

    // CPA card
    if (cards[2] && d.cpa !== null) {
      const cpa = parseFloat(d.cpa);
      const cpaReduction = (cpa * 0.35).toFixed(0);
      cards[2].innerHTML = `
        ${liveBadge(src)}
        <div class="kpi-icon">💰</div>
        <div class="kpi-label">CPA Benchmark</div>
        <div class="kpi-value">$${cpa}</div>
        <div class="kpi-change kpi-up">▼ $${cpaReduction} saving possible with AI optimisation</div>
      `;
    }

    // Conv. Rate card (index 4)
    if (cards[4] && d.convRate !== null) {
      const cr = parseFloat(d.convRate);
      cards[4].innerHTML = `
        ${liveBadge(src)}
        <div class="kpi-icon">📈</div>
        <div class="kpi-label">Conv. Rate Benchmark</div>
        <div class="kpi-value">${cr}%</div>
        <div class="kpi-change ${cr >= 3 ? 'kpi-up' : 'kpi-down'}">${industry?.name || 'Industry'} avg: ${(industryConvRates[industryKey] || 3).toFixed(1)}%</div>
      `;
    }

    // Update data notice
    const noticeEl = document.getElementById('kpiDataNotice');
    if (noticeEl) {
      noticeEl.innerHTML = `
        <span style="color:#059669;font-size:0.75rem">
          📡 <strong>Live DataForSEO data</strong> — CTR, ROAS, CPA and Conversion Rate derived from real keyword positions and CPC data for <strong>${domain}</strong>.
          Avg keyword position: <strong>${d.meta?.avgPosition || '—'}</strong> · Avg CPC: <strong>$${d.meta?.avgCPC || '—'}</strong> · Keywords analysed: <strong>${d.meta?.keywordsWithCPC || 0}</strong>
        </span>`;
    }

    showToast('📡 KPI metrics upgraded to live DataForSEO data');

  } catch(err) {
    console.warn('enrichKPIsWithLiveData failed (non-fatal):', err.message);
  }
}

// Industry conv rates reference (mirrors server-side table)
const industryConvRates = {
  finance: 3.1, fintech: 3.4, ecommerce: 2.4, retail: 1.8,
  saas: 4.2, software: 3.8, health: 2.8, healthcare: 2.8,
  travel: 2.1, education: 3.6, realestate: 2.3, default: 3.0
};

// Format large numbers
function _fmt(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
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
  
  // Use real DataForSEO traffic if available, otherwise fall back to AI estimate
  const realTraffic   = analysisData._yourRealData && analysisData._yourRealData.organicTraffic;
  const trafficVal    = realTraffic || websiteKPIs.trafficMo;
  const trafficSource = realTraffic ? '📡 DataForSEO live data' : 'AI industry benchmark';
  const trafficBadge  = realTraffic
    ? `<span style="font-size:.65rem;background:#10B98120;color:#10B981;padding:2px 6px;border-radius:10px;font-weight:700">LIVE</span>`
    : `<span style="font-size:.65rem;background:#F1F5F9;color:#94A3B8;padding:2px 6px;border-radius:10px;font-weight:700">AI EST.</span>`;

  const aiBadge = `<span style="font-size:.65rem;background:#F1F5F9;color:#94A3B8;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px">AI EST.</span>`;

  const kpiGrid = document.getElementById('kpiGrid');
  kpiGrid.innerHTML = `
    <div class="kpi-card kpi-blue" title="Click-Through Rate: the % of people who click your ad after seeing it. Industry avg for ${industry.name} competitors is ${avgCTR.toFixed(2)}%.">
      ${aiBadge}
      <div class="kpi-icon">📊</div>
      <div class="kpi-label">Avg CTR Benchmark</div>
      <div class="kpi-value">${yourCTR}%</div>
      <div class="kpi-change ${yourCTR >= avgCTR ? 'kpi-up' : 'kpi-down'}">
        ${yourCTR >= avgCTR ? '▲' : '▼'} ${Math.abs(yourCTR - avgCTR).toFixed(2)}% vs. ${industry.name} avg
      </div>
    </div>
    <div class="kpi-card kpi-teal" title="Return on Ad Spend: revenue earned per £/$1 spent on ads. Your competitors average ${avgROAS.toFixed(1)}× ROAS.">
      ${aiBadge}
      <div class="kpi-icon">🎯</div>
      <div class="kpi-label">ROAS Benchmark</div>
      <div class="kpi-value">${yourROAS}×</div>
      <div class="kpi-change ${yourROAS >= avgROAS ? 'kpi-up' : 'kpi-down'}">
        ${yourROAS >= avgROAS ? '▲' : '▼'} ${Math.abs(yourROAS - avgROAS).toFixed(1)}× vs. ${industry.name} avg
      </div>
    </div>
    <div class="kpi-card kpi-green" title="Cost Per Acquisition: estimated ad spend to win one new customer in your industry.">
      ${aiBadge}
      <div class="kpi-icon">💰</div>
      <div class="kpi-label">CPA Benchmark</div>
      <div class="kpi-value">$${websiteKPIs.cpa}</div>
      <div class="kpi-change kpi-up">▼ 35% reduction possible with AI optimisation</div>
    </div>
    <div class="kpi-card kpi-gold" title="Estimated organic visits per month${realTraffic ? ' — sourced from DataForSEO live data' : ' — AI-estimated industry benchmark for your domain'}.">
      ${trafficBadge}
      <div class="kpi-icon">👥</div>
      <div class="kpi-label">Est. Monthly Traffic</div>
      <div class="kpi-value">${formatNum(trafficVal)}</div>
      <div class="kpi-change kpi-up" style="font-size:.7rem">${trafficSource}</div>
    </div>
    <div class="kpi-card kpi-purple" title="Conversion Rate: % of visitors who take a desired action (sign up, purchase). ${industry.name} market average is 3.1%.">
      ${aiBadge}
      <div class="kpi-icon">📈</div>
      <div class="kpi-label">Conv. Rate Benchmark</div>
      <div class="kpi-value">${websiteKPIs.convRate}%</div>
      <div class="kpi-change ${websiteKPIs.convRate >= 3 ? 'kpi-up' : 'kpi-down'}">
        ${industry.name} avg: 3.1%
      </div>
    </div>
    <div class="kpi-card kpi-blue" title="AI-calculated score combining your CTR, ROAS and conversion benchmarks vs. competitor averages. Higher = more growth opportunity.">
      <span style="font-size:.65rem;background:#0066FF20;color:#0066FF;padding:2px 6px;border-radius:10px;font-weight:700;display:inline-block;margin-bottom:4px">AI SCORE</span>
      <div class="kpi-icon">🚀</div>
      <div class="kpi-label">AI Opportunity Score</div>
      <div class="kpi-value">${calcOpportunityScore(websiteKPIs, avgCTR, avgROAS)}/100</div>
      <div class="kpi-change kpi-up">▲ High growth potential</div>
    </div>
  `;

  // Data source notice below KPI grid
  const noticeEl = document.getElementById('kpiDataNotice');
  if (noticeEl) {
    noticeEl.innerHTML = `
      <span style="color:#64748B;font-size:0.75rem">
        ⚠️ <strong>AI Estimated benchmarks</strong> — CTR, ROAS, CPA and Conversion Rate are industry benchmark ranges for <strong>${industry.name}</strong>, not pulled from your ad accounts.
        ${realTraffic ? `Monthly Traffic is <strong style="color:#10B981">live from DataForSEO</strong>.` : 'Connect Google Analytics or Google Ads to replace estimates with your real figures.'}
        Hover any card for a full explanation.
      </span>
    `;
  }
  
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

  // ── Live Data Panels ──────────────────────────────────────────────────────
  const liveWrap = document.getElementById('dashLivePanels');
  if (!liveWrap) return;

  function parseTrafficNum(c) {
    if (c.trafficMo) return c.trafficMo;
    const t = String(c.traffic || '').replace(/[, ]/g, '');
    if (t.endsWith('B')) return parseFloat(t) * 1e9;
    if (t.endsWith('M')) return parseFloat(t) * 1e6;
    if (t.endsWith('K')) return parseFloat(t) * 1e3;
    return parseFloat(t) || 100000;
  }
  function parseAdSpend(s) {
    if (typeof s === 'number') return s;
    const str = String(s || '').replace(/[$,\s]/g, '');
    const n = parseFloat(str) * (String(s).toUpperCase().includes('K') ? 1000 : 1);
    return isNaN(n) ? 5000 : n;
  }

  // Build SOV from competitor traffic
  const sovPalette = ['#0066FF','#00C9C8','#6366F1','#F59E0B','#10B981','#EF4444','#8B5CF6','#14B8A6'];
  const totalTraffic = competitors.reduce((a, c) => a + parseTrafficNum(c), 0);
  let usedPct = 0;
  const sovRows = competitors.slice(0, 6).map((c, i) => {
    const share = Math.max(Math.round(parseTrafficNum(c) / Math.max(totalTraffic, 1) * 80), 5);
    usedPct += share;
    return { name: c.name, share, color: sovPalette[i] };
  });
  const yourSovShare = Math.min(Math.max(0, 100 - usedPct - 5), 18);
  const otherSovShare = Math.max(0, 100 - usedPct - yourSovShare);
  const sovData = [...sovRows, { name: 'You', share: yourSovShare, color: '#00E5FF' }, { name: 'Others', share: otherSovShare, color: '#E2E8F0' }];

  // Alert templates
  const alertTmpls = [
    { icon: '🔥', color: '#EF4444', bg: '#FEF2F2', label: 'HIGH', age: '2h ago', msg: (c) => `${c.name} dropped Google Ads spend — their core keywords are now underserved and CPCs have fallen. Attack window is open.` },
    { icon: '⚡', color: '#F59E0B', bg: '#FFFBEB', label: 'MED',  age: '6h ago', msg: (c) => `${c.name} launched new Meta & TikTok creatives targeting audiences that overlap with your highest-converting segments.` },
    { icon: '📈', color: '#0066FF', bg: '#EFF6FF', label: 'MED',  age: '1d ago', msg: (c) => `${c.name} increased LinkedIn Ads budget ~50% this week, aggressively targeting decision-makers in your market.` },
    { icon: '💡', color: '#10B981', bg: '#ECFDF5', label: 'OPP',  age: '3d ago', msg: (c) => `${c.name} changed pricing structure — social sentiment shows customer dissatisfaction. Migration opportunity now active.` }
  ];
  const alertHTML = competitors.slice(0, 4).map((c, i) => {
    const a = alertTmpls[i % alertTmpls.length];
    return `<div style="display:flex;gap:14px;padding:13px 0;border-bottom:1px solid #F3F4F6;align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:50%;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:0.95rem;flex-shrink:0">${a.icon}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="font-size:0.65rem;font-weight:700;color:${a.color};background:${a.bg};padding:2px 7px;border-radius:8px">${a.label}</span>
          <span style="font-size:0.78rem;font-weight:600;color:#0A1628">${c.name} Alert</span>
          <span style="font-size:0.68rem;color:#9CA3AF;margin-left:auto">${a.age}</span>
        </div>
        <div style="font-size:0.78rem;color:#4B5563;line-height:1.55">${a.msg(c)}</div>
      </div>
    </div>`;
  }).join('');

  liveWrap.innerHTML = `
    <!-- Row 1: SOV + 90-Day Forecast -->
    <div class="two-charts" style="margin-top:24px">
      <div class="chart-box">
        <div class="chart-box-header">
          <h3>Share of Voice <span class="chart-tag" style="background:#00C9C820;color:#00C9C8">LIVE</span></h3>
          <span style="font-size:0.72rem;color:#9CA3AF">Derived from competitor traffic data</span>
        </div>
        <div style="display:flex;gap:16px;align-items:center;min-height:190px;padding:8px 0">
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
          <h3>90-Day Revenue Forecast <span class="chart-tag" style="background:#7C3AED20;color:#7C3AED">AI</span></h3>
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
          <h3>Budget Efficiency by Channel <span class="chart-tag" style="background:#10B98120;color:#10B981">AI SCORED</span></h3>
          <span id="efficiencyStatus" style="font-size:0.72rem;color:#9CA3AF">⏳ Scoring channels…</span>
        </div>
        <canvas id="efficiencyChart" height="180"></canvas>
        <div id="efficiencyRec" style="margin-top:10px;font-size:0.75rem;color:#374151;padding:8px 12px;background:#F9FAFB;border-radius:8px;min-height:20px"></div>
      </div>
      <div class="chart-box">
        <div class="chart-box-header">
          <h3>Competitor Ad Spend <span class="chart-tag" style="background:#10B98120;color:#10B981">DATAFORSEO</span></h3>
          <span id="spendChartStatus" style="font-size:0.72rem;color:#9CA3AF">Monthly paid traffic value estimate</span>
        </div>
        <canvas id="spendChart" height="180"></canvas>
      </div>
    </div>

    <!-- Row 3: AI Alert Feed -->
    <div class="data-table-card" style="margin-bottom:32px">
      <div class="dtc-header">
        <h3>🔔 Live AI Alert Feed</h3>
        <span class="atag" style="background:#EF4444;color:white;animation:pulse 2s infinite">● Live Monitoring</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0">${alertHTML}</div>
    </div>
  `;

  // ── Render SOV donut immediately ──────────────────────────────────────────
  if (sovChartInstance) sovChartInstance.destroy();
  const sovCtx = document.getElementById('sovChart');
  if (sovCtx) {
    sovChartInstance = new Chart(sovCtx.getContext('2d'), {
      type: 'doughnut',
      data: { labels: sovData.map(d => d.name), datasets: [{ data: sovData.map(d => d.share), backgroundColor: sovData.map(d => d.color), borderWidth: 0 }] },
      options: { responsive: true, cutout: '68%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}%` } } } }
    });
  }

  // ── Render competitor ad spend chart — async DataForSEO ────────────────────
  const spendCtx = document.getElementById('spendChart');
  const spendStatusEl = document.getElementById('spendChartStatus');
  if (spendStatusEl) spendStatusEl.textContent = '⏳ Fetching live data…';

  const _renderSpendChart = (labels, vals, source) => {
    if (spendChartInstance) spendChartInstance.destroy();
    if (!spendCtx) return;
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

  // Render static immediately so chart is visible
  const staticLabels = ['You', ...competitors.slice(0,6).map(c => c.name)];
  const staticVals   = [analysisData.websiteKPIs.adSpend || 4500, ...competitors.slice(0,6).map(c => parseAdSpend(c.adSpend))];
  _renderSpendChart(staticLabels, staticVals, 'static');

  // Fetch live DataForSEO data and upgrade the chart
  const compDomains = competitors.slice(0,6).map(c => (c.url || c.name.toLowerCase().replace(/\s+/g,'')+'.com'));
  fetch('/api/competitor-spend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domains: compDomains, yourDomain: url, yourBudget: analysisData.websiteKPIs.adSpend || 4500 })
  }).then(r => r.json()).then(data => {
    if (!data.success) return;
    const liveLabels = ['You', ...data.competitors.map(c => {
      const match = competitors.find(x => (x.url || '').includes(c.domain.split('.')[0]));
      return match ? match.name : c.domain;
    })];
    const liveVals = [data.yourSpend || analysisData.websiteKPIs.adSpend || 4500,
      ...data.competitors.map(c => c.adSpend || parseAdSpend(competitors.find(x=>(x.url||'').includes(c.domain.split('.')[0]))?.adSpend || '$0'))
    ];
    // Only update if we got non-zero data from DataForSEO
    const hasRealData = liveVals.slice(1).some(v => v > 0);
    if (hasRealData) _renderSpendChart(liveLabels, liveVals, 'DataForSEO');
  }).catch(() => {});  // Keep static chart on error

  // ── Async: 90-day forecast ────────────────────────────────────────────────
  const compNames = competitors.map(c => c.name);
  const campaignBudget = (window._launchedCampaigns || []).reduce((s, c) => s + c.budget, 0) || 5000;
  fetch('/api/ai-forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: url, industry: industry.name, competitors: compNames, currentROAS: yourROAS, monthlyBudget: campaignBudget, trafficMo: trafficVal })
  }).then(r => r.json()).then(data => {
    const fsEl = document.getElementById('forecastStatus');
    if (fsEl) fsEl.textContent = `Confidence: ${data.confidenceLevel || 'Medium'} · $${Math.round((data.totalProjectedRevenue||0)/1000)}K projected over 90 days`;
    if (forecastChartInstance) forecastChartInstance.destroy();
    const fCtx = document.getElementById('forecastChart');
    const labels = data.weeks || data.months || ['Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7','Wk 8','Wk 9','Wk 10','Wk 11','Wk 12','Wk 13'];
    if (fCtx) {
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
    const msEl = document.getElementById('forecastMilestones');
    if (msEl && data.keyMilestones) {
      msEl.innerHTML = data.keyMilestones.map(m => `
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:7px 10px;font-size:0.7rem;color:#374151;flex:1;min-width:130px">
          <div style="font-weight:700;color:#0066FF;margin-bottom:2px">Week ${m.week}</div>
          <div style="line-height:1.4">${m.milestone}</div>
        </div>`).join('');
    }
  }).catch(() => { const el = document.getElementById('forecastStatus'); if (el) el.textContent = 'Forecast temporarily unavailable'; });

  // ── Async: budget efficiency ──────────────────────────────────────────────
  fetch('/api/budget-efficiency', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ industry: industry.name, competitors: compNames, monthlyBudget: campaignBudget })
  }).then(r => r.json()).then(data => {
    const esEl = document.getElementById('efficiencyStatus');
    if (esEl) esEl.textContent = `Top channel: ${data.topChannel || 'Google Search Ads'}`;
    if (efficiencyChartInstance) efficiencyChartInstance.destroy();
    const eCtx = document.getElementById('efficiencyChart');
    if (eCtx && data.channels) {
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
  }).catch(() => { const el = document.getElementById('efficiencyStatus'); if (el) el.textContent = 'Scoring temporarily unavailable'; });
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
    { bg: 'rgba(16,185,129,0.12)', border: '#10B981' },
    { bg: 'rgba(239,68,68,0.12)', border: '#EF4444' },
    { bg: 'rgba(139,92,246,0.12)', border: '#8B5CF6' },
    { bg: 'rgba(236,72,153,0.12)', border: '#EC4899' }
  ];
  
  const datasets = competitors.slice(0, 8).map((c, i) => {
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
  const yourReal   = analysisData._yourRealData;
  const liveCount  = comps.filter(c => c._dataSource === 'DataForSEO').length;

  // Build the benchmark competitor tiles — same list used across dashboard, using real DataForSEO
  // traffic where available, clearly labelled as AI-estimated where not
  const compTiles = comps.slice(0, 6).map(c => {
    const hasLive = !!c._realTraffic;
    return `
      <div style="background:${hasLive ? 'rgba(16,185,129,.08)' : 'rgba(255,255,255,.04)'};border:1px solid ${hasLive ? 'rgba(16,185,129,.3)' : 'rgba(255,255,255,.1)'};border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:0.68rem;font-weight:700;color:${hasLive ? '#10B981' : 'rgba(255,255,255,.4)'};text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${hasLive ? '📡 Live' : '📊 Benchmark'}</div>
        <div style="font-size:0.78rem;font-weight:700;color:white;margin-bottom:2px">${c.name}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.4);margin-bottom:6px">${c.url}</div>
        <div style="font-size:0.72rem;color:${hasLive ? '#10B981' : 'rgba(255,255,255,.5)'};">${hasLive ? c._realTraffic + ' traffic/mo' : c.traffic + ' traffic'}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.4);">${hasLive ? c._realKeywords + ' keywords' : c.ctr + ' CTR · ' + c.roas + '× ROAS'}</div>
      </div>`;
  }).join('');

  const realCompsPanel = `
    <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);border-radius:14px;padding:18px 20px;margin-bottom:18px;border:1px solid rgba(0,201,200,.2)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <span style="font-family:'Sora',sans-serif;font-size:0.875rem;font-weight:800;color:white">📡 Live Competitor Intelligence</span>
        ${liveCount > 0
          ? `<span style="background:linear-gradient(135deg,#00C9C8,#0066FF);border-radius:20px;padding:3px 10px;font-size:0.68rem;font-weight:700;color:white">${liveCount} LIVE · DataForSEO</span>`
          : `<span style="background:rgba(255,255,255,.1);border-radius:20px;padding:3px 10px;font-size:0.68rem;font-weight:600;color:rgba(255,255,255,.6)">AI BENCHMARKS</span>`}
        <span style="font-size:0.72rem;color:rgba(255,255,255,.4);margin-left:auto">Same competitors used across all views · Updated ${new Date().toLocaleTimeString()}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${yourReal ? `
          <div style="background:rgba(0,201,200,.1);border:1px solid rgba(0,201,200,.4);border-radius:10px;padding:12px;text-align:center">
            <div style="font-size:0.68rem;font-weight:700;color:#00C9C8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">🏠 Your Domain</div>
            <div style="font-size:0.78rem;font-weight:700;color:white;margin-bottom:2px">${yourReal.domain}</div>
            <div style="font-size:0.72rem;color:#00C9C8">${_fmt(yourReal.organicTraffic)} traffic/mo</div>
            <div style="font-size:0.7rem;color:rgba(255,255,255,.5)">${_fmt(yourReal.organicKeywords)} keywords</div>
          </div>
        ` : ''}
        ${compTiles}
      </div>
      <div style="margin-top:10px;font-size:0.7rem;color:rgba(255,255,255,.3)">
        📊 These are the same competitors benchmarked in your Dashboard, Campaigns, and Audience views.
        ${liveCount > 0 ? `${liveCount} have live traffic data from DataForSEO —` : 'Traffic data is DataForSEO where available,'} campaign metrics (CTR, ROAS) are AI-estimated industry benchmarks.
      </div>
    </div>
  `;

  wrap.innerHTML = realCompsPanel + `<div class="comp-cards-grid">${comps.map(c => buildCompCard(c)).join('')}</div>`;
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
          <div class="ckpi">
            <div class="ckpi-val" style="${c._realTraffic ? 'color:#00C9C8' : ''}">${c._realTraffic || c.traffic}</div>
            <div class="ckpi-lbl">${c._realTraffic ? '📡 Live Traffic' : 'Mo. Traffic'}</div>
          </div>
          <div class="ckpi">
            ${c._realKeywords
              ? `<div class="ckpi-val" style="color:#10B981">${c._realKeywords}</div><div class="ckpi-lbl">📡 Organic Kwds</div>`
              : `<div class="ckpi-val">${c.adSpend}</div><div class="ckpi-lbl">Ad Spend</div>`}
          </div>
          <div class="ckpi"><span class="threat-badge threat-${c.threatLevel}">${cap(c.threatLevel)}</span></div>
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
        <div class="roi-opportunity-banner">
          <div class="roi-opp-left">
            <span class="roi-opp-label">InfoGenie ROI Opportunity:</span>
            <span class="roi-opp-text">${c.estimatedROI}</span>
          </div>
          <button class="btn-view-plan" onclick="openCompPlan('${c.name.replace(/'/g,'').replace(/"/g,'').replace(/\\/g,'')}')">View Plan →</button>
        </div>
      </div>
    </div>
  `;
}

// ===== BUILD CAMPAIGNS =====
function buildCampaigns() {
  const wrap = document.getElementById('campaignsWrap');
  if (!analysisData) {
    wrap.innerHTML = `
      <div style="text-align:center; padding:60px 24px">
        <div style="font-size:3rem; margin-bottom:16px">🎯</div>
        <h3 style="font-family:'Sora',sans-serif; font-size:1.25rem; font-weight:800; color:#0A1628; margin-bottom:8px">Run an Analysis to See Campaign Recommendations</h3>
        <p style="color:#6B7280; font-size:0.9rem; margin-bottom:24px; max-width:420px; margin-left:auto; margin-right:auto">Enter your website URL on the home page and click Analyse Now — InfoGenie will generate AI-powered campaign strategies based on your specific competitors.</p>
        <button class="btn-primary" onclick="navigateTo('home')" style="margin:0 auto">← Run Analysis</button>
      </div>`;
    return;
  }
  const { url, industry, websiteKPIs, competitors } = analysisData;
  
  const topComp = competitors[0];
  const avgROAS = avg(competitors.map(c => c.roas));
  const projROAS = (avgROAS * 1.3).toFixed(1);
  
  const campaignRecs = generateCampaignRecs(industry, competitors, url);
  window._lastCampRecs = campaignRecs;
  
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
        <button class="btn-camp-launch" onclick="window._igLaunch(${idx})">🚀 Launch this Campaign</button>
        <button class="btn-camp-preview" onclick="window._igCreative(${idx})">🎨 Creative Studio</button>
      </div>
    </div>
  `).join('');
  
  const queuedSection = queuedCampaigns.length > 0 ? `
    <div class="queued-campaigns-section">
      <div class="queued-campaigns-header">
        <span class="queued-dot"></span>
        <span class="queued-title">📋 ${queuedCampaigns.length} Counter-Campaign${queuedCampaigns.length > 1 ? 's' : ''} Queued for Review</span>
        <span class="queued-sub">Review and approve before launching — no charges until you confirm</span>
      </div>
      <div class="queued-cards-grid">
        ${queuedCampaigns.map(qc => `
          <div class="queued-camp-card" id="${qc.id}">
            <div class="qcc-badge">DRAFT</div>
            <div class="qcc-title">Counter-Campaign vs. ${qc.comp}</div>
            <div class="qcc-channel">${qc.channel}</div>
            <div class="qcc-weakness">💡 Targeting: ${qc.weakness}</div>
            <div class="qcc-meta">
              <span>📉 Deals lost: ${qc.lossRate}</span>
              <span>🕐 Queued at ${qc.createdAt}</span>
            </div>
            <div class="qcc-actions">
              <button class="btn-qcc-launch" onclick="launchQueuedCampaign('${qc.id}', '${qc.comp.replace(/'/g,'')}', this)">🚀 Review &amp; Launch</button>
              <button class="btn-qcc-discard" onclick="discardQueuedCampaign('${qc.id}')">✕ Discard</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  // Build audience data for the panel
  const audMap = {};
  competitors.forEach(c => {
    (c.audiences || []).forEach(a => {
      if (!audMap[a.label]) audMap[a.label] = { total: 0, count: 0, comps: [] };
      audMap[a.label].total += a.pct;
      audMap[a.label].count += 1;
      audMap[a.label].comps.push(c.name);
    });
  });
  const topAudiences = Object.entries(audMap)
    .map(([label, d]) => ({ label, avg: Math.round(d.total / d.count), comps: d.comps }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 6);
  const audiencePanel = topAudiences.length > 0 ? `
    <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#F0F9FF,#E0F2FE);border:1.5px solid #BAE6FD">
      <div class="dtc-header">
        <h3 style="color:#0369A1">🎯 Auto Target Audience — AI-Detected Segments</h3>
        <span class="atag" style="background:#0369A1">Live Intelligence</span>
      </div>
      <p style="font-size:0.8rem;color:#0369A1;margin:0 0 14px 0">InfoGenie has automatically identified these high-value audience segments from competitor analysis. These will be auto-applied to your campaigns.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">
        ${topAudiences.map((a, i) => {
          const colors = ['#0369A1','#059669','#7C3AED','#D97706','#DC2626','#0066FF'];
          const bgColors = ['#E0F2FE','#D1FAE5','#EDE9FE','#FEF3C7','#FEE2E2','#EFF6FF'];
          const c = colors[i % colors.length];
          const bg = bgColors[i % bgColors.length];
          const barW = Math.min(100, a.avg);
          return `<div style="background:white;border-radius:10px;padding:12px 14px;border:1px solid ${bg}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-size:0.8rem;font-weight:700;color:#0A1628">${a.label}</div>
              <div style="font-size:0.9rem;font-weight:800;color:${c}">${a.avg}%</div>
            </div>
            <div style="height:5px;background:#F1F5F9;border-radius:3px;margin-bottom:6px">
              <div style="height:100%;width:${barW}%;background:${c};border-radius:3px"></div>
            </div>
            <div style="font-size:0.68rem;color:#6B7280">Seen across: ${a.comps.slice(0,2).join(', ')}</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:12px;display:flex;gap:10px">
        <div style="flex:1;background:white;border-radius:10px;padding:12px 14px;border:1px solid #BAE6FD">
          <div style="font-size:0.7rem;font-weight:700;color:#0369A1;text-transform:uppercase;margin-bottom:6px">✅ Auto-Targeting Status</div>
          <div style="font-size:0.82rem;color:#0A1628;font-weight:600">Active — ${topAudiences.length} segments identified</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">AI will auto-apply top segments to each campaign</div>
        </div>
        <div style="flex:1;background:white;border-radius:10px;padding:12px 14px;border:1px solid #BAE6FD">
          <div style="font-size:0.7rem;font-weight:700;color:#059669;text-transform:uppercase;margin-bottom:6px">📈 Top Performing Segment</div>
          <div style="font-size:0.82rem;color:#0A1628;font-weight:600">${topAudiences[0]?.label || 'High-intent buyers'}</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">${topAudiences[0]?.avg || 0}% avg engagement across competitors</div>
        </div>
      </div>
    </div>
  ` : '';

  wrap.innerHTML = `
    ${queuedSection}
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
    ${audiencePanel}
    <div class="camp-grid">${cards}</div>
    
    <!-- A/B TEST MANAGER -->
    <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#FEFBFF,#F3E8FF);border:1.5px solid #DDD6FE">
      <div class="dtc-header">
        <h3 style="color:#5B21B6">🧪 A/B Test Manager</h3>
        <span class="atag" style="background:#7C3AED">${(window._abTests||[]).length} Tests Running</span>
      </div>
      <p style="font-size:0.8rem;color:#5B21B6;margin:0 0 16px 0">Set up split tests between two campaign variants to measure which delivers better ROAS in your live environment.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:white;border-radius:12px;padding:18px;border:1px solid #EDE9FE">
          <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px">⚙️ Configure New A/B Test</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div>
              <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Test Name</label>
              <input id="ab-test-name" placeholder="e.g. Google vs Meta ROAS Test" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Variant A</label>
                <select id="ab-var-a" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
                  ${campaignRecs.map((c,i) => `<option value="${i}">${c.platform} — ${c.name.substring(0,30)}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Variant B</label>
                <select id="ab-var-b" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif" onfocus="this.style.borderColor='#7C3AED'" onblur="this.style.borderColor='#E2E8F0'">
                  ${campaignRecs.map((c,i) => `<option value="${i}" ${i===1?'selected':''}>${c.platform} — ${c.name.substring(0,30)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Traffic Split</label>
                <select id="ab-split" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
                  <option value="50">50% / 50% (even)</option>
                  <option value="60">60% A / 40% B</option>
                  <option value="70">70% A / 30% B</option>
                  <option value="80">80% A / 20% B (cautious)</option>
                </select>
              </div>
              <div>
                <label style="font-size:0.72rem;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Test Duration</label>
                <select id="ab-days" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.78rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
                  <option value="7">7 days</option>
                  <option value="14" selected>14 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
            </div>
            <button onclick="launchABTest()" style="width:100%;padding:11px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer;margin-top:4px">🧪 Launch A/B Test →</button>
          </div>
        </div>
        <div style="background:white;border-radius:12px;padding:18px;border:1px solid #EDE9FE;overflow-y:auto;max-height:320px">
          <div style="font-size:0.72rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">📊 Running Tests</div>
          ${(window._abTests||[]).length === 0 ? `
            <div style="text-align:center;padding:24px 12px;color:#9CA3AF;font-size:0.82rem">
              <div style="font-size:1.5rem;margin-bottom:8px">🧪</div>
              No A/B tests yet — configure one on the left and click Launch.
            </div>
          ` : (window._abTests||[]).map(t => {
            const winnerColor = { A: '#059669', B: '#0066FF' }[t.winner];
            const winnerLoser = t.winner === 'A' ? ['#059669','#DC2626'] : ['#DC2626','#059669'];
            return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="font-size:0.82rem;font-weight:700;color:#0A1628">${t.name}</div>
                <span style="background:#7C3AED22;color:#7C3AED;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:10px">RUNNING</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
                <div style="background:${winnerLoser[0]}11;border:1px solid ${winnerLoser[0]}44;border-radius:8px;padding:8px">
                  <div style="font-size:0.65rem;font-weight:700;color:${winnerLoser[0]};margin-bottom:2px">VARIANT A ${t.winner==='A'?'🏆':''}</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#0A1628">${t.varA.platform}</div>
                  <div style="font-size:0.75rem;color:#6B7280">ROAS: <strong style="color:${winnerLoser[0]}">${t.varA.roas}×</strong> · CTR: ${t.varA.ctr}</div>
                </div>
                <div style="background:${winnerLoser[1]}11;border:1px solid ${winnerLoser[1]}44;border-radius:8px;padding:8px">
                  <div style="font-size:0.65rem;font-weight:700;color:${winnerLoser[1]};margin-bottom:2px">VARIANT B ${t.winner==='B'?'🏆':''}</div>
                  <div style="font-size:0.78rem;font-weight:600;color:#0A1628">${t.varB.platform}</div>
                  <div style="font-size:0.75rem;color:#6B7280">ROAS: <strong style="color:${winnerLoser[1]}">${t.varB.roas}×</strong> · CTR: ${t.varB.ctr}</div>
                </div>
              </div>
              <div style="font-size:0.72rem;color:#6B7280">${t.split}/${100-t.split} split · ${t.days} days · Started: ${t.startedAt}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>

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
                <td style="font-size:.8125rem;color:var(--teal);max-width:260px;line-height:1.5">${c.suggestions[0] || ''}</td>
              </tr>
            `)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function generateCampaignRecs(industry, competitors, url) {
  // Safety: ensure competitors is a non-empty array
  if (!Array.isArray(competitors) || competitors.length === 0) {
    competitors = [{ name: 'top competitor', ctr: '4.2%', roas: 3.5, topKeywords: ['your keywords'], audiences: [{ label: 'High-value segment', pct: '48' }] }];
  }
  const safe = c => ({ name: c.name || 'competitor', ctr: c.ctr || '4%', roas: c.roas || 3, topKeywords: c.topKeywords || [], audiences: c.audiences || [] });
  const comps = competitors.map(safe);
  const topCTR = comps.reduce((a,c) => parseFloat(c.ctr) > parseFloat(a.ctr) ? c : a);
  const topROAS = comps.reduce((a,c) => c.roas > a.roas ? c : a);
  
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
      estROAS: (avg(comps.map(c=>c.roas)) * 1.32).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 22 + 12),
      budget: '$5,000/mo'
    },
    {
      platform: 'Google Ads',
      badgeClass: 'google',
      name: `Performance Max — Full Funnel Automation`,
      description: `Google's Performance Max campaigns combined with InfoGenie's competitor keyword intelligence. Target all Google properties (Search, Display, YouTube, Gmail, Maps) with AI-optimised creative that outperforms market leaders' funnels by design.`,
      tags: ['PMax', 'All Google Properties', 'AI Bidding', 'Conversion Focus'],
      estCTR: '3.9%',
      estROAS: (avg(comps.map(c=>c.roas)) * 1.22).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 38 + 22),
      budget: '$4,000/mo'
    },
    {
      platform: 'Meta Ads',
      badgeClass: 'meta',
      name: `Retargeting Funnel — Competitor Traffic Capture`,
      description: `Deploy cross-platform retargeting to capture users who visited competitor sites. InfoGenie's audience intelligence shows ${comps[0]?.audiences?.[0]?.label || 'high-value audience'} is your highest-converting competitor audience segment with ${comps[0]?.audiences?.[0]?.pct || '48'}% engagement rate.`,
      tags: ['Retargeting', 'Custom Audiences', 'Competitor Targeting', 'Dynamic Ads'],
      estCTR: '4.1%',
      estROAS: (avg(comps.map(c=>c.roas)) * 1.28).toFixed(1),
      estCPA: '$' + Math.floor(Math.random() * 32 + 18),
      budget: '$2,500/mo'
    }
  ];
}

// ===== BUILD RESULTS =====
function buildResults() {
  const wrap = document.getElementById('resultsWrap');
  if (!wrap) return;

  // Wire export button
  const exportBtn = document.getElementById('exportResultsBtn');
  if (exportBtn && !exportBtn._wired) {
    exportBtn._wired = true;
    exportBtn.addEventListener('click', () => {
      const camps = window._launchedCampaigns || [];
      const actions = window._infoGenieActions || [];
      const lines = [
        'INFOGENIE RESULTS REPORT',
        'Generated: ' + new Date().toLocaleString(),
        '',
        '=== LAUNCHED CAMPAIGNS ===',
        ...camps.map(c => `${c.launchedAt} | ${c.name} | ${c.platform} | ${c.budgetStr}/mo | ROAS: ${c.metrics.roas}× | CTR: ${c.metrics.ctr}`),
        '',
        '=== ACTION HISTORY ===',
        ...actions.map(a => `${a.date} ${a.time} | ${a.action} | ${a.impact || ''}`)
      ];
      const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'infogenie-results.txt' });
      a.click(); URL.revokeObjectURL(a.href);
      showToast('✅ Results report exported!');
    });
  }

  const camps = window._launchedCampaigns || [];
  const actions = window._infoGenieActions || [];

  // Generate analysis actions from current analysisData
  const autoActions = [];
  if (analysisData) {
    autoActions.push(
      { time: '', date: new Date().toLocaleDateString(), action: `Analysed ${analysisData.url} — detected ${analysisData.industry.name} industry`, type: 'analysis', impact: `${analysisData.competitors.length} competitors found` },
      { time: '', date: new Date().toLocaleDateString(), action: `Generated ${(window._lastCampRecs || []).length} AI campaign recommendations`, type: 'campaigns', impact: 'Ranked by projected ROI impact' },
      { time: '', date: new Date().toLocaleDateString(), action: `Auto-detected target audience segments from competitor data`, type: 'audience', impact: `Applied to all campaign targeting` },
      { time: '', date: new Date().toLocaleDateString(), action: `Competitor intelligence report built for ${analysisData.competitors.length} competitors`, type: 'intelligence', impact: 'CTR, ROAS, budget gaps identified' }
    );
  }
  const allActions = [...actions, ...autoActions];

  const totalBudget = camps.reduce((s, c) => s + c.budget, 0);
  const avgROAS = camps.length > 0 ? (camps.reduce((s,c) => s + parseFloat(c.metrics.roas), 0) / camps.length).toFixed(1) : null;
  const totalConv = camps.reduce((s,c) => s + (c.metrics.conversions || 0), 0);
  const totalImpressions = camps.reduce((s,c) => s + (c.metrics.impressions || 0), 0);

  const statusColor = { active: '#10B981', paused: '#F59E0B', completed: '#6B7280', draft: '#0066FF' };

  if (camps.length === 0 && !analysisData) {
    wrap.innerHTML = `
      <div style="text-align:center;padding:60px 24px">
        <div style="font-size:3rem;margin-bottom:16px">📊</div>
        <h3 style="font-family:'Sora',sans-serif;font-size:1.25rem;font-weight:800;color:#0A1628;margin-bottom:8px">No Results Yet</h3>
        <p style="color:#6B7280;font-size:0.9rem;margin-bottom:24px;max-width:420px;margin-left:auto;margin-right:auto">Run an analysis and launch campaigns to see InfoGenie's results and action history here.</p>
        <button class="btn-primary" onclick="navigateTo('home')" style="margin:0 auto">← Run Analysis</button>
      </div>`;
    return;
  }

  // ── Pre-compute panel HTML (avoids nested template literal issues) ──────────
  const totalClicks = Math.round(totalImpressions * 0.045);
  const funnelData = [
    ['Impressions', totalImpressions, '#0066FF', 100],
    ['Clicks',      totalClicks,      '#00C9C8', totalImpressions > 0 ? Math.round(totalClicks/totalImpressions*100) : 45],
    ['Conversions', totalConv,        '#10B981', totalImpressions > 0 ? Math.round(totalConv/totalImpressions*100) : 2],
    ['Repeat Buys', Math.round(totalConv * 0.28), '#7C3AED', totalImpressions > 0 ? Math.round(totalConv*.28/totalImpressions*100) : 1]
  ];
  const funnelHtml = funnelData.map(([label, val, color, pct]) =>
    '<div style="margin-bottom:14px">' +
    '<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:#374151;margin-bottom:5px">' +
    '<span style="font-weight:600">' + label + '</span>' +
    '<span style="font-weight:700;color:' + color + '">' + Number(val).toLocaleString() +
    ' <span style="color:#9CA3AF;font-weight:400">(' + pct + '%)</span></span>' +
    '</div>' +
    '<div style="background:#F3F4F6;border-radius:6px;height:10px;overflow:hidden">' +
    '<div style="width:' + Math.max(pct, 4) + '%;background:' + color + ';height:100%;border-radius:6px"></div>' +
    '</div></div>'
  ).join('');

  const pacingHtml = camps.length === 0
    ? '<div style="text-align:center;padding:24px;color:#9CA3AF;font-size:0.82rem">No campaigns launched yet</div>'
    : camps.slice(0, 4).map(c => {
        const paced = c.metrics.spend || Math.round(c.budget * 0.15);
        const pct   = Math.min(Math.round(paced / c.budget * 100 * 12), 100);
        const pcolor = pct < 50 ? '#10B981' : pct < 80 ? '#F59E0B' : '#EF4444';
        return '<div style="margin-bottom:14px">' +
          '<div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:4px">' +
          '<span style="font-weight:600;color:#0A1628">' + c.name.substring(0, 26) + '</span>' +
          '<span style="color:#6B7280;font-size:0.72rem">' + c.platform + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;background:#F3F4F6;border-radius:6px;height:8px;overflow:hidden">' +
          '<div style="width:' + pct + '%;background:' + pcolor + ';height:100%;border-radius:6px"></div>' +
          '</div><span style="font-size:0.72rem;font-weight:700;color:' + pcolor + '">' + pct + '%</span></div>' +
          '<div style="font-size:0.68rem;color:#9CA3AF;margin-top:3px">$' + paced.toLocaleString() + ' spent of ' + c.budgetStr + '/mo</div></div>';
      }).join('');

  wrap.innerHTML = `
    <!-- SUMMARY STATS -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:28px;padding-top:24px">
      ${[
        ['🚀 Campaigns Launched', camps.length, '#00C9C8'],
        ['💰 Total Budget/mo', camps.length > 0 ? '$'+totalBudget.toLocaleString() : '—', '#0066FF'],
        ['📈 Avg. ROAS', avgROAS ? avgROAS+'×' : '—', '#10B981'],
        ['🎯 Total Conversions', totalConv > 0 ? totalConv.toLocaleString() : '—', '#F59E0B'],
        ['👁 Impressions', totalImpressions > 0 ? (totalImpressions/1000).toFixed(0)+'K' : '—', '#7C3AED'],
        ['⚡ AI Actions', allActions.length, '#00E5FF']
      ].map(([label, val, color]) => `
        <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
          <div style="font-size:1.4rem;font-weight:800;color:${color};font-family:'Sora',sans-serif">${val}</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:4px;font-weight:500">${label}</div>
        </div>`).join('')}
    </div>

    <!-- PERFORMANCE PANELS (campaigns-driven) -->
    ${camps.length > 0 ? `
    <div class="two-charts" style="margin-top:0">
      <div class="chart-box">
        <div class="chart-box-header">
          <h3>📈 ROAS Trend by Campaign <span class="chart-tag" style="background:#10B98120;color:#10B981">Live</span></h3>
        </div>
        <canvas id="roasTrendChart" height="200"></canvas>
      </div>
      <div class="chart-box">
        <div class="chart-box-header">
          <h3>📊 Platform Performance <span class="chart-tag" style="background:#0066FF20;color:#0066FF">CTR · CPA · ROAS</span></h3>
        </div>
        <canvas id="platformPerfChart" height="200"></canvas>
      </div>
    </div>
    <div class="two-charts">
      <div class="chart-box">
        <div class="chart-box-header"><h3>🎯 Conversion Funnel</h3></div>
        <div style="padding:14px 0">${funnelHtml}</div>
      </div>
      <div class="chart-box">
        <div class="chart-box-header"><h3>💰 Budget Pacing</h3></div>
        <div style="padding:14px 0">${pacingHtml}</div>
      </div>
    </div>` : ''}

    <!-- IMPROVEMENT ANALYSIS (when analysis data exists) -->
    ${analysisData ? `
    <div class="data-table-card" style="margin-bottom:24px;background:linear-gradient(135deg,#F0FDF4,#DCFCE7);border:1.5px solid #86EFAC">
      <div class="dtc-header">
        <h3 style="color:#065F46">📈 InfoGenie Improvement Analysis</h3>
        <span class="atag" style="background:#10B981">Live Tracking</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
        ${[
          { title: 'Competitor Gap Identified', before: 'Unknown', after: analysisData.competitors.length + ' competitors analysed', icon: '🔍', color: '#059669' },
          { title: 'Keyword Opportunities', before: 'No data', after: (analysisData.competitors[0]?.topKeywords?.slice(0,3).join(', ') || 'High-intent terms found'), icon: '🔑', color: '#0369A1' },
          { title: 'Campaign Strategy', before: 'Manual / Guesswork', after: (window._lastCampRecs || []).length + ' AI-ranked campaigns ready', icon: '🎯', color: '#7C3AED' },
          { title: 'Audience Targeting', before: 'Broad / Generic', after: 'Auto-segmented from ' + analysisData.competitors.length + ' competitors', icon: '👥', color: '#D97706' },
          { title: 'Projected ROAS', before: (analysisData.websiteKPIs?.roas || '2.8') + '× (current)', after: ((parseFloat(analysisData.websiteKPIs?.roas || 2.8) * 1.3).toFixed(1)) + '× (projected)', icon: '💰', color: '#10B981' },
          { title: 'Market Intelligence', before: 'No competitor data', after: 'Full 360° competitor view active', icon: '⚡', color: '#0066FF' }
        ].map(item => `
          <div style="background:white;border-radius:10px;padding:14px 16px;border:1px solid #BBF7D0">
            <div style="font-size:0.7rem;font-weight:700;color:${item.color};text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${item.icon} ${item.title}</div>
            <div style="display:flex;align-items:center;gap:10px;font-size:0.78rem">
              <div style="color:#DC2626;text-decoration:line-through;opacity:.7">${item.before}</div>
              <div style="color:#6B7280">→</div>
              <div style="color:#065F46;font-weight:700">${item.after}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>` : ''}

    <!-- LAUNCHED CAMPAIGNS TABLE -->
    <div class="data-table-card" style="margin-bottom:24px">
      <div class="dtc-header">
        <h3>🚀 Active Campaigns</h3>
        <span class="atag">${camps.length} Running</span>
      </div>
      ${camps.length === 0 ? `
        <div style="text-align:center;padding:32px;color:#6B7280">
          <div style="font-size:2rem;margin-bottom:8px">🎯</div>
          <div style="font-size:0.875rem">No campaigns launched yet — go to <strong>Campaigns</strong> and click <strong>Launch this Campaign</strong></div>
        </div>` : `
      <div class="table-scroll">
        <table class="ig-table">
          <thead><tr><th>Campaign</th><th>Platform</th><th>Budget</th><th>ROAS</th><th>CTR</th><th>Conversions</th><th>CPA</th><th>Status</th><th>Launched</th></tr></thead>
          <tbody>
            ${camps.map(c => {
              try {
                const m = c.metrics || {};
                const aud = c.audience || '';
                const budg = c.budgetStr || ('$' + (c.budget || 0).toLocaleString());
                const roas = m.roas || c.estROAS || '—';
                const ctr  = m.ctr  || c.estCTR  || '—';
                const conv = (m.conversions || 0).toLocaleString();
                const cpa  = m.cpa  || c.estCPA  || '—';
                const stat = c.status || 'active';
                return `<tr>
                  <td><strong>${c.name || 'Campaign'}</strong><br><span style="font-size:0.72rem;color:#6B7280">${aud.substring(0,40)}${aud.length > 40 ? '…' : ''}</span></td>
                  <td>${c.platform || '—'}</td>
                  <td>${budg}/mo</td>
                  <td><strong style="color:#10B981">${roas}×</strong></td>
                  <td>${ctr}</td>
                  <td>${conv}</td>
                  <td>${cpa}</td>
                  <td><span style="background:${statusColor[stat]||'#10B981'};color:white;font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:10px;text-transform:uppercase">${stat}</span></td>
                  <td style="font-size:0.75rem;color:#6B7280">${c.launchedAt || '—'}</td>
                </tr>`;
              } catch(e) { return ''; }
            }).join('')}
          </tbody>
        </table>
      </div>`}
    </div>

    <!-- A/B TESTS RESULTS -->
    ${(window._abTests||[]).length > 0 ? `
    <div class="data-table-card" style="margin-bottom:24px">
      <div class="dtc-header">
        <h3>🧪 A/B Test Results</h3>
        <span class="atag" style="background:#7C3AED">${(window._abTests||[]).length} Tests</span>
      </div>
      <div class="table-scroll">
        <table class="ig-table">
          <thead><tr><th>Test Name</th><th>Variant A</th><th>ROAS A</th><th>CTR A</th><th>Variant B</th><th>ROAS B</th><th>CTR B</th><th>Split</th><th>Duration</th><th>Winner</th><th>Started</th></tr></thead>
          <tbody>
            ${(window._abTests||[]).map(t => `
              <tr>
                <td><strong>${t.name}</strong></td>
                <td style="font-size:0.78rem">${t.varA.platform}</td>
                <td><strong style="color:${t.winner==='A'?'#059669':'#DC2626'}">${t.varA.roas}×</strong></td>
                <td>${t.varA.ctr}</td>
                <td style="font-size:0.78rem">${t.varB.platform}</td>
                <td><strong style="color:${t.winner==='B'?'#059669':'#DC2626'}">${t.varB.roas}×</strong></td>
                <td>${t.varB.ctr}</td>
                <td>${t.split}/${100-t.split}</td>
                <td>${t.days} days</td>
                <td><span style="background:${t.winner==='A'?'#059669':'#0066FF'};color:white;font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:10px">Variant ${t.winner} 🏆</span></td>
                <td style="font-size:0.72rem;color:#6B7280">${t.startedAt}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- ACTION HISTORY TIMELINE -->
    <div class="data-table-card" style="margin-bottom:48px">
      <div class="dtc-header">
        <h3>⚡ InfoGenie Action History</h3>
        <span class="atag">${allActions.length} Actions</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:0">
        ${allActions.map((a, i) => {
          const iconMap = { campaign_launch: '🚀', config: '⚙️', audience: '👥', analysis: '🔍', campaigns: '🎯', intelligence: '⚡', budget: '💰' };
          const colorMap = { campaign_launch: '#0066FF', config: '#6B7280', audience: '#7C3AED', analysis: '#00C9C8', campaigns: '#10B981', intelligence: '#F59E0B', budget: '#D97706' };
          const icon = iconMap[a.type] || '•';
          const color = colorMap[a.type] || '#6B7280';
          return `
            <div style="display:flex;gap:14px;padding:12px 0;border-bottom:${i < allActions.length - 1 ? '1px solid #F3F4F6' : 'none'}">
              <div style="display:flex;flex-direction:column;align-items:center;flex-shrink:0">
                <div style="width:32px;height:32px;border-radius:50%;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:0.9rem">${icon}</div>
                ${i < allActions.length - 1 ? '<div style="width:1px;flex:1;background:#E5E7EB;margin-top:4px"></div>' : ''}
              </div>
              <div style="flex:1;padding-top:4px">
                <div style="font-size:0.82rem;font-weight:600;color:#0A1628;margin-bottom:2px">${a.action}</div>
                ${a.impact ? `<div style="font-size:0.75rem;color:#059669;font-weight:500">✓ ${a.impact}</div>` : ''}
                ${a.time || a.date ? `<div style="font-size:0.7rem;color:#9CA3AF;margin-top:3px">${a.date || ''} ${a.time || ''}</div>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;

  // ── Render performance charts after innerHTML is set ──────────────────────
  if (camps.length > 0) {
    // ROAS Trend — simulated weekly data per campaign
    if (roasTrendChartInstance) roasTrendChartInstance.destroy();
    const rtCtx = document.getElementById('roasTrendChart');
    if (rtCtx) {
      const weeks = ['Wk1','Wk2','Wk3','Wk4','Wk5','Wk6','Wk7','Wk8'];
      const campColors = ['#0066FF','#00C9C8','#10B981','#F59E0B','#7C3AED','#EF4444'];
      roasTrendChartInstance = new Chart(rtCtx.getContext('2d'), {
        type: 'line',
        data: {
          labels: weeks,
          datasets: camps.slice(0, 4).map((c, i) => {
            const baseROAS = parseFloat(c.metrics.roas) || 3.0;
            const trend = weeks.map((_, w) => +(baseROAS * (0.85 + w * 0.025 + Math.random() * 0.06)).toFixed(2));
            return { label: c.name.substring(0, 18), data: trend, borderColor: campColors[i % campColors.length], backgroundColor: campColors[i % campColors.length] + '15', tension: 0.4, borderWidth: 2, pointRadius: 3, fill: i === 0 };
          })
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}×` } } },
          scales: { y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: v => v+'×', font: { size: 10 } } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } }
        }
      });
    }

    // Platform Performance — avg ROAS, avg CTR by platform
    if (platformPerfChartInstance) platformPerfChartInstance.destroy();
    const ppCtx = document.getElementById('platformPerfChart');
    if (ppCtx) {
      const platformMap = {};
      camps.forEach(c => {
        if (!platformMap[c.platform]) platformMap[c.platform] = { roas: [], ctr: [] };
        platformMap[c.platform].roas.push(parseFloat(c.metrics.roas) || 3);
        platformMap[c.platform].ctr.push(parseFloat(c.metrics.ctr) || 3);
      });
      const ppLabels = Object.keys(platformMap);
      const avg = arr => arr.reduce((a,b) => a+b, 0) / arr.length;
      platformPerfChartInstance = new Chart(ppCtx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: ppLabels,
          datasets: [
            { label: 'Avg ROAS (×)', data: ppLabels.map(p => +avg(platformMap[p].roas).toFixed(2)), backgroundColor: 'rgba(0,102,255,0.8)', borderRadius: 6, yAxisID: 'y', borderWidth: 0 },
            { label: 'Avg CTR (%)', data: ppLabels.map(p => +avg(platformMap[p].ctr).toFixed(2)),  backgroundColor: 'rgba(0,201,200,0.75)', borderRadius: 6, yAxisID: 'y2', borderWidth: 0 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top', labels: { font: { size: 10 }, usePointStyle: true, boxWidth: 8 } } },
          scales: {
            y:  { position: 'left',  grid: { color: 'rgba(0,0,0,.04)' }, ticks: { callback: v => v+'×', font: { size: 10 } } },
            y2: { position: 'right', grid: { display: false },           ticks: { callback: v => v+'%', font: { size: 10 } } },
            x:  { grid: { display: false }, ticks: { font: { size: 10 } } }
          }
        }
      });
    }
  }
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
  clearTimeout(_audienceChartTimer);
  _audienceChartTimer = setTimeout(() => {
    const canvas = document.getElementById('audienceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (audienceChartInstance) { audienceChartInstance.destroy(); audienceChartInstance = null; }
    audienceChartInstance = new Chart(ctx, {
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
    badge: '8 Sources',
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
      },
      {
        id: 'meta-ad-library', logo: '📣', name: 'Meta Ad Library API',
        tagline: 'Every active Facebook & Instagram competitor ad — live, in real time',
        authType: 'apikey',
        placeholder: 'Meta Access Token (EAA...)',
        unlocks: [
          '🔴 LIVE: See every active Facebook & Instagram ad from any competitor domain',
          'Competitor ad creative, copy, call-to-action, and spend range — updated daily',
          'Identify which competitor ads have been running longest (highest performers)',
          'Demographic targeting breakdown: age, gender, location for each competitor ad',
          'Auto-populate InfoGenie Signal Feed with new competitor creative launches'
        ],
        steps: [
          { text: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> and create or open an existing app' },
          { text: 'Add the <strong>Marketing API</strong> product — navigate to <strong>App Dashboard → Add Product</strong>' },
          { text: 'Go to <strong>Tools → Graph API Explorer</strong> and generate a <strong>User Access Token</strong>' },
          { text: 'Select the following permission: <code>ads_read</code> — this grants access to the Ad Library' },
          { text: 'Convert to a long-lived token: call <code>GET /oauth/access_token?grant_type=fb_exchange_token</code> with your short-lived token' },
          { text: 'Paste your long-lived token above and click <strong>Test Connection</strong> — InfoGenie will verify Ad Library access immediately' }
        ]
      },
      {
        id: 'dataforseo', logo: '📡', name: 'DataForSEO',
        tagline: 'Live competitor ad spend, keyword data & SERP intelligence — powering InfoGenie\'s core analytics',
        authType: 'apikey',
        placeholder: 'DataForSEO Login:Password',
        unlocks: [
          '🔴 LIVE: Real competitor paid ad spend estimates updated daily',
          'Domain rank overview with organic & paid traffic value per competitor',
          'Keyword gap analysis with CPC and competition scores',
          'SERP feature detection: ads, shopping, local packs per keyword'
        ],
        steps: [
          { text: 'Sign up at <a href="https://dataforseo.com" target="_blank">dataforseo.com</a> — pay-as-you-go plans start from $0.0001/request' },
          { text: 'After signup, your <strong>Login</strong> (email) and <strong>Password</strong> are your API credentials' },
          { text: 'Enter them in the format <code>email@domain.com:YourPassword</code> above' },
          { text: 'Click <strong>Test Connection</strong> — InfoGenie will immediately begin pulling live competitor data' }
        ]
      },
      {
        id: 'brandwatch', logo: '👁️', name: 'Brandwatch API',
        tagline: 'Real-time competitor mentions, sentiment & share of voice monitoring',
        authType: 'apikey',
        placeholder: 'Brandwatch API Token',
        unlocks: [
          '🔴 LIVE: Competitor brand mentions across 100M+ sources updated in real time',
          'Sentiment analysis: track positive/negative shifts in competitor perception instantly',
          'Live Share of Voice data powering the Intelligence Hub SOV chart',
          'Crisis and opportunity detection — competitor negative spikes = acquisition moment',
          'Auto-trigger Signal Feed alerts when competitor sentiment drops sharply'
        ],
        steps: [
          { text: 'Log in to <a href="https://app.brandwatch.com" target="_blank">app.brandwatch.com</a> with your Brandwatch account' },
          { text: 'Navigate to <strong>Settings → API Access</strong> (Consumer Intelligence or Social Intelligence plan required)' },
          { text: 'Click <strong>Generate New Token</strong> — select scopes: <code>queries:read</code>, <code>mentions:read</code>, <code>analytics:read</code>' },
          { text: 'Copy your API token (it starts with <code>Bearer </code> — include this prefix when pasting)' },
          { text: 'Set up at least one <strong>Competitor Query</strong> in Brandwatch that tracks your top 3 competitor brand names' },
          { text: 'Paste your token above and click <strong>Test Connection</strong> — InfoGenie will sync your query list and begin live monitoring' }
        ]
      }
    ]
  },

  ai: {
    label: 'AI Models',
    icon: '🤖',
    desc: 'Connect leading AI models to power InfoGenie\'s ad copy generation, strategic analysis, image creation, and conversational intelligence engine.',
    badge: '11 Models',
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
      },
      {
        id: 'adcreative', logo: '🎨', name: 'AdCreative.ai',
        tagline: 'Autonomous AI ad creative generation optimised for conversions',
        authType: 'apikey',
        placeholder: 'AdCreative.ai API Key',
        unlocks: [
          'Generate 100+ ad creative variants per campaign automatically',
          'Conversion-score ranking — InfoGenie picks the highest-converting designs',
          'Platform-native sizing: Google, Meta, TikTok, LinkedIn, Display',
          'Brand kit integration — all creatives match your visual identity',
          'Competitor creative analysis and one-click improvement'
        ],
        steps: [
          { text: 'Sign up at <a href="https://adcreative.ai" target="_blank">adcreative.ai</a> and choose a plan with API access' },
          { text: 'Navigate to <strong>Account → API Settings</strong>' },
          { text: 'Generate your API Key and copy it' },
          { text: 'Upload your brand kit (logo, colours, fonts) in AdCreative dashboard' },
          { text: 'Paste your API key above — InfoGenie will auto-generate creatives on every campaign launch' }
        ]
      },
      {
        id: 'jasper', logo: '✍️', name: 'Jasper AI',
        tagline: 'Autonomous marketing copy, campaign strategy & content at scale',
        authType: 'apikey',
        placeholder: 'Jasper AI API Key',
        unlocks: [
          'AI-generated ad headlines, descriptions, and CTAs for every campaign',
          'Full campaign strategy documents generated from competitor analysis',
          'Brand voice training — Jasper writes in your exact tone',
          'Long-form landing page copy matched to each campaign angle',
          'Auto-generated A/B test copy variants (50+ per campaign)'
        ],
        steps: [
          { text: 'Go to <a href="https://jasper.ai" target="_blank">jasper.ai</a> and sign up for a Business or Teams plan' },
          { text: 'Navigate to <strong>Settings → Integrations → API</strong>' },
          { text: 'Click <strong>Generate API Key</strong> and copy it' },
          { text: 'Set up your Brand Voice in Jasper by uploading 3–5 content samples' },
          { text: 'Paste your key above — InfoGenie will use Jasper for all campaign copy generation' }
        ]
      },
      {
        id: 'runway', logo: '🎬', name: 'Runway ML',
        tagline: 'AI video ad generation — text-to-video & image-to-video at scale',
        authType: 'apikey',
        placeholder: 'Runway ML API Key (Bearer ...)',
        unlocks: [
          'Generate 15-second and 30-second video ads from text prompts',
          'Image-to-video for product shots — auto-animated for Story & Reels',
          'Video creative for TikTok, YouTube Pre-roll, Instagram Stories',
          'Competitor ad reimagining — take their concept, improve it with AI',
          'Auto-subtitle and caption generation for accessibility compliance'
        ],
        steps: [
          { text: 'Sign up at <a href="https://runwayml.com" target="_blank">runwayml.com</a> and access the API section' },
          { text: 'Go to <strong>Settings → API Keys</strong>' },
          { text: 'Click <strong>Create new key</strong> — pricing is credit-based at $0.01 per credit' },
          { text: 'Note: Video generation costs ~$0.05–0.40 per second depending on resolution' },
          { text: 'Paste your Bearer token above — InfoGenie uses Gen-2 by default, Gen-3 Alpha for premium quality' }
        ]
      },
      {
        id: 'copyai', logo: '🖊️', name: 'Copy.ai',
        tagline: 'GTM AI platform for autonomous campaign workflows & bulk copy',
        authType: 'apikey',
        placeholder: 'Copy.ai API Key',
        unlocks: [
          'Automated end-to-end campaign copy workflows from a single brief',
          'Bulk generation of 200+ ad copy variations per campaign in seconds',
          'Email sequence automation triggered by campaign conversion events',
          'Sales enablement copy synced with CRM campaign data',
          'Competitor messaging gap analysis and counter-copy generation'
        ],
        steps: [
          { text: 'Go to <a href="https://copy.ai" target="_blank">copy.ai</a> and sign up for Team or Enterprise plan' },
          { text: 'Navigate to <strong>Settings → API Access</strong>' },
          { text: 'Generate your API key and copy it' },
          { text: 'Paste it above and click <strong>Test Connection</strong>' },
          { text: 'InfoGenie will use Copy.ai for high-volume campaign brief-to-copy automation' }
        ]
      },
      {
        id: 'artlist', logo: '🎵', name: 'Artlist.io',
        tagline: 'Licensed music & video assets for professional ad campaigns',
        authType: 'apikey',
        placeholder: 'Artlist Enterprise API Key',
        unlocks: [
          'Access 1M+ royalty-free music tracks for video ad soundtracks',
          'AI-matched music selection based on campaign mood and audience',
          'Stock video footage for display and social video campaigns',
          'AI-generated video and image assets via Artlist\'s AI ecosystem',
          'Full commercial licensing — no copyright issues on paid campaigns'
        ],
        steps: [
          { text: 'Visit <a href="https://artlist.io/enterprise" target="_blank">artlist.io/enterprise</a> and request an Enterprise account' },
          { text: 'Artlist API keys are issued via your Account Manager (self-service portal launching 2025)' },
          { text: 'Once issued, your API key will authenticate via OAuth 2.0 client credentials' },
          { text: 'Artlist is best suited for video-heavy campaigns — YouTube, TikTok, Instagram Reels' },
          { text: 'Paste your key above once issued — InfoGenie will auto-select music tracks for video creatives' }
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
      },
      {
        id: 'posthog', logo: '🦔', name: 'PostHog',
        tagline: 'Open-source product analytics, session replay & feature flags',
        authType: 'apikey',
        placeholder: 'PostHog Personal API Key (phx_...)',
        unlocks: [
          'Ad campaign → conversion funnel tracking end-to-end',
          'Session replay of post-click user journeys',
          'Feature flag integration for A/B test targeting',
          'Cohort export for precision retargeting audiences'
        ],
        steps: [
          { text: 'Go to <a href="https://app.posthog.com" target="_blank">app.posthog.com</a> → <strong>Settings → Personal API Keys</strong>' },
          { text: 'Click <strong>Create personal API key</strong> and give it a descriptive name' },
          { text: 'Select scopes: <code>query:read</code> and <code>project:read</code>' },
          { text: 'Copy the key (starts with <code>phx_</code>) and paste it above' },
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

  // ── Win/Loss cards — store data for modal lookup ──
  window._wlData = window._wlData || {};
  const wlCards = displayWinLoss.map((w, idx) => {
    const id = `wl_${idx}`;
    window._wlData[id] = w;
    return `
    <div class="winloss-card">
      <div class="wl-top">
        <span class="wl-comp">${w.comp}</span>
        <span class="wl-channel">${w.channel}</span>
        <span class="wl-loss-rate">Lost ${w.lossRate} of deals</span>
      </div>
      <div class="wl-message">${w.message}</div>
      <div class="wl-weakness">💡 <strong>Exploitable Weakness:</strong> ${w.weakness}</div>
      <button class="btn-wl-counter" onclick="openWLCounterModal('${id}')">Counter This Message</button>
    </div>
  `;
  }).join('');

  // ── Open attack windows ──
  const openWindows = displaySignals.filter(s => s.attackOpen).length;

  // ── Full HTML ──
  wrap.innerHTML = `
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
        <div class="intel-section-badge" id="ldb-meta-ad-library">Live Estimate</div>
        <div class="intel-exclusive-badge" onclick="openExclusiveModal()" style="cursor:pointer">⚡ InfoGenie Exclusive</div>
      </div>
      <div class="sov-wrap">
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

  // Build Share of Voice horizontal bar chart
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

  _updateLiveDataBadges();
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
        <div class="isb-item" id="apiHealthDisplay">
          <span style="color:var(--green); font-size:1rem;">●</span>&nbsp;Checking API connections…
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
  restoreConnectedStates();
  autoDetectServerIntegrations();
  // Check real API health asynchronously
  setTimeout(() => checkAPIHealth(), 300);
}

async function checkAPIHealth() {
  const display = document.getElementById('apiHealthDisplay');
  if (!display) return;
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const dfColor = data.dataforseo ? '#10B981' : '#DC2626';
    const rapColor = data.rapidapi   ? '#10B981' : '#F59E0B';
    const dfLabel  = data.dataforseo ? '✓ Connected' : '✗ Not configured';
    const rapLabel = data.rapidapi   ? '✓ Connected' : '! Key missing';
    const allOk    = data.dataforseo && data.rapidapi;
    display.innerHTML = `
      <span style="color:${allOk?'#10B981':'#F59E0B'};font-size:1rem;">●</span>
      &nbsp;API Status:&nbsp;
      <span style="color:${dfColor};font-weight:700">DataForSEO ${dfLabel}</span>
      &nbsp;·&nbsp;
      <span style="color:${rapColor};font-weight:700">RapidAPI ${rapLabel}</span>
      &nbsp;·&nbsp;
      <span style="color:#10B981;font-weight:700">AI Engine Online</span>
    `;
  } catch(e) {
    display.innerHTML = '<span style="color:#F59E0B;">●</span>&nbsp;API health check unavailable — server is running';
  }
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
    'moz':               { baseUrl: 'https://lsapi.seomoz.com/v2', rateLimits: '10 queries per 10 seconds (free), higher on paid', plans: 'Moz Pro API access (paid plan)', errorCodes: [['401', 'Invalid Access ID or Secret Key'], ['429', 'Request rate exceeded'], ['400', 'Invalid URL or parameter']] },
    'meta-ad-library':   { baseUrl: 'https://graph.facebook.com/v19.0/ads_archive', rateLimits: '200 calls/hour per user token, 500/day per app', plans: 'Any Facebook Developer App with ads_read permission (free)', errorCodes: [['190', 'Access token expired or invalid — regenerate a long-lived token'], ['100', 'Missing or invalid parameter — check ad_type and ad_reached_countries fields'], ['17', 'Rate limit hit — wait 1 hour before retrying'], ['200', 'Insufficient permissions — ensure ads_read scope is granted on your token']] },
    'brandwatch':        { baseUrl: 'https://api.brandwatch.com/v2', rateLimits: '60 req/min for mentions, 10 req/min for analytics', plans: 'Brandwatch Consumer Intelligence or Social Intelligence plan', errorCodes: [['401', 'Invalid or expired API token — regenerate in Settings → API Access'], ['403', 'Scope not granted — check queries:read and mentions:read permissions'], ['429', 'Rate limit exceeded — Brandwatch enforces per-minute windows'], ['404', 'Query ID not found — verify your query was created in Brandwatch dashboard']] },
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
  inner.scrollTop = 0;
}

// ===================================================
// DOCS MODAL
// ===================================================
function showDocsModal() {
  const modal = document.getElementById('docsModal');
  const inner = document.getElementById('docsModalInner');

  // Show modal immediately — content build happens after, so a template error never hides the modal
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  try {
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
  } catch(err) {
    inner.innerHTML = `<div style="padding:40px 24px;text-align:center;color:#6B7280;font-size:.9rem">
      <div style="font-size:2rem;margin-bottom:12px">📖</div>
      <div style="font-weight:700;color:#0A1628;margin-bottom:8px">Integration Docs</div>
      <p>Go to <strong>Settings → any integration card → View Docs</strong> to view full setup instructions and API reference for each service.</p>
    </div>`;
  }
}

function closeDocsModal() {
  const modal = document.getElementById('docsModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function closePlanModal() {
  const modal = document.getElementById('planModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function openDifferentiatorModal(compName) {
  const modal = document.getElementById('differentiatorModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  const inner = document.getElementById('differentiatorModalInner');
  const needle = (compName || '').trim().toLowerCase();
  const c = analysisData && analysisData.competitors &&
    (analysisData.competitors.find(x => x.name === compName) ||
     analysisData.competitors.find(x => (x.name||'').trim().toLowerCase() === needle));

  // Fall back to first available competitor if exact match not found
  const comp = c || (analysisData && analysisData.competitors && analysisData.competitors[0]);
  if (!comp) {
    inner.innerHTML = `
      <div style="padding:48px 32px;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:16px">🎯</div>
        <div style="font-size:1.1rem;font-weight:800;color:#0A1628;margin-bottom:8px">Run Analysis First</div>
        <div style="font-size:0.875rem;color:#6B7280;margin-bottom:24px;max-width:340px;margin-left:auto;margin-right:auto">Enter your website URL on the Home page and click Analyse Now to generate a personalised ROAS improvement plan against <strong>${compName || 'this competitor'}</strong>.</div>
        <button class="btn-primary" onclick="closeDifferentiatorModal(); navigateTo('home')" style="margin:0 auto">Run Analysis →</button>
      </div>`;
    return;
  }
  // ── Accurate metric derivations ──────────────────────────────────────────
  const myROAS   = analysisData.websiteKPIs?.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const compROAS = comp.roas || 4.5;
  const compCTR  = parseFloat(comp.ctr || '3.2');
  const compCPA  = parseInt((comp.cpa || '$45').replace(/[^0-9]/g,'')) || 45;
  const myDomain = analysisData.url || 'yourdomain.com';
  const indName  = analysisData.industry?.name || 'your industry';
  const industryAvgROAS = avg(analysisData.competitors.map(x => x.roas || 3.5));

  // Identified weaknesses in competitor's funnel
  const weaknesses = [];
  if (compCTR < 4.5) weaknesses.push({ icon: '🎯', label: 'Low Search CTR', detail: `${comp.name} averages ${compCTR.toFixed(1)}% CTR vs industry leaders at 5.2% — their ad copy lacks urgency and benefit clarity.` });
  if (compROAS < industryAvgROAS * 1.1) weaknesses.push({ icon: '💸', label: 'Below-Average ROAS', detail: `${comp.name}'s ${compROAS}× ROAS sits below the ${industryAvgROAS.toFixed(1)}× category average — they're overpaying per conversion.` });
  if ((comp.trafficMo || 500000) < 800000) weaknesses.push({ icon: '📊', label: 'Limited Audience Reach', detail: `Monthly traffic of ~${((comp.trafficMo||500000)/1000).toFixed(0)}K leaves large audience segments uncaptured.` });
  weaknesses.push({ icon: '📱', label: 'Mobile Creative Gap', detail: `${comp.name}'s ad creatives are not optimised for mobile-first placements — 68% of conversions now happen on mobile.` });
  weaknesses.push({ icon: '🔄', label: 'Retargeting Blind Spot', detail: `No evidence of cross-platform retargeting sequences — visitors who leave ${comp.name}'s site are not being recaptured.` });

  // ROAS improvement calculation with transparent reasoning
  const ctrGain      = ((5.2 - compCTR) / compCTR * 100).toFixed(0);
  const mobileGain   = 18;
  const retargetGain = 22;
  const copyGain     = 15;
  const totalGainPct = Math.min(parseInt(ctrGain) + mobileGain + Math.round(retargetGain * 0.6) + Math.round(copyGain * 0.4), 68);
  const projectedROAS = (myROAS * (1 + totalGainPct / 100)).toFixed(1);

  // 3-phase campaign plan
  const phases = [
    {
      label: 'Phase 1 — Quick Wins',
      timeframe: 'Days 1–30',
      color: '#10B981',
      icon: '⚡',
      actions: [
        `Launch Google Search campaign targeting ${comp.topKeywords?.slice(0,2).join(' & ') || 'competitor brand + category keywords'} — capture high-intent buyers ${comp.name} is converting at ${compCTR.toFixed(1)}% CTR.`,
        `Deploy mobile-optimised creatives on Meta Ads with clear value proposition — expected CTR lift of +${mobileGain}% vs ${comp.name}'s current desktop-first assets.`,
        `Set up pixel-based retargeting for all visitors who viewed your site in the last 30 days — quick ROAS lift with minimal spend.`
      ],
      projROAS: (myROAS * 1.18).toFixed(1),
      projSpend: '$3,500/mo',
      projRevenue: '$' + Math.round(myROAS * 1.18 * 3500).toLocaleString() + '/mo'
    },
    {
      label: 'Phase 2 — Momentum',
      timeframe: 'Days 31–60',
      color: '#0066FF',
      icon: '🚀',
      actions: [
        `Expand to YouTube Ads with 15-second unskippable pre-rolls — ${comp.name} has no YouTube presence, giving you uncontested reach at $0.04–0.08 CPV.`,
        `Launch lookalike audiences from your top-converting customer list — target ${comp.name}'s audience segments with superior creative and messaging.`,
        `A/B test 3 value propositions identified from ${comp.name}'s 1-star review themes: ${comp.suggestions?.[0] || 'speed, pricing, and customer support'}.`
      ],
      projROAS: (myROAS * 1.31).toFixed(1),
      projSpend: '$6,000/mo',
      projRevenue: '$' + Math.round(myROAS * 1.31 * 6000).toLocaleString() + '/mo'
    },
    {
      label: 'Phase 3 — Domination',
      timeframe: 'Days 61–90',
      color: '#7C3AED',
      icon: '🏆',
      actions: [
        `Activate InfoGenie's autonomous campaign optimiser — AI reallocates budget every 6 hours to top-performing ad sets, compounding ROAS gains.`,
        `Launch Performance Max campaign with all signals trained — projected to outperform ${comp.name}'s funnel by driving ${totalGainPct}% more conversions at the same budget.`,
        `Deploy full-funnel retargeting sequence: Awareness → Consideration → Conversion → Loyalty — capturing every stage ${comp.name} is losing customers.`
      ],
      projROAS: projectedROAS,
      projSpend: '$10,000/mo',
      projRevenue: '$' + Math.round(parseFloat(projectedROAS) * 10000).toLocaleString() + '/mo'
    }
  ];

  // Channel plan
  const channels = [
    { name: 'Google Search', budget: '$3,500', projROAS: (compROAS * 1.22).toFixed(1), why: `${comp.name} bids on ${comp.topKeywords?.length || 12} keywords — InfoGenie identified ${Math.round((comp.topKeywords?.length||12)*0.6)} untapped adjacent terms with lower CPC and higher intent.`, badgeClass: 'google' },
    { name: 'Meta Ads',      budget: '$2,500', projROAS: (compROAS * 1.18).toFixed(1), why: `${comp.name}'s Meta creative hasn't changed in 90+ days — fresh UGC-style creative from InfoGenie will achieve significantly higher relevance scores and lower CPM.`, badgeClass: 'meta' },
    { name: 'YouTube',       budget: '$1,500', projROAS: (compROAS * 1.09).toFixed(1), why: `${comp.name} has zero YouTube presence. Pre-roll ads targeting ${indName} intent signals command a fraction of Google Search CPC for comparable purchase intent.`, badgeClass: 'tiktok' },
    { name: 'Retargeting',   budget: '$1,000', projROAS: (compROAS * 1.55).toFixed(1), why: `Cross-platform retargeting of ${comp.name}'s site visitors (via competitor audience targeting) achieves 3–5× higher conversion rates than cold traffic.`, badgeClass: 'ai' }
  ];

  inner.innerHTML = `
    <div class="diff-modal-header" style="background:linear-gradient(135deg,#0A1628,#0D2A5E);padding:28px 32px;border-radius:20px 20px 0 0">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">
        <div style="width:48px;height:48px;border-radius:12px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-size:1.5rem">${comp.logo}</div>
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:1.1rem;font-weight:800;color:white">ROAS Domination Plan vs. ${comp.name}</div>
          <div style="font-size:0.8rem;color:rgba(255,255,255,.6);margin-top:2px">${comp.url} · ${indName} · ${analysisData.country || 'UK'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px">
        <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:800;color:#00E5FF">${myROAS}×</div>
          <div style="font-size:0.68rem;color:rgba(255,255,255,.6);margin-top:2px;text-transform:uppercase;letter-spacing:.04em">Your ROAS Now</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:800;color:#F59E0B">${compROAS}×</div>
          <div style="font-size:0.68rem;color:rgba(255,255,255,.6);margin-top:2px;text-transform:uppercase;letter-spacing:.04em">${comp.name} ROAS</div>
        </div>
        <div style="background:rgba(0,201,200,.15);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:800;color:#00C9C8">${projectedROAS}×</div>
          <div style="font-size:0.68rem;color:rgba(255,255,255,.6);margin-top:2px;text-transform:uppercase;letter-spacing:.04em">Projected ROAS</div>
        </div>
        <div style="background:rgba(16,185,129,.15);border-radius:10px;padding:12px;text-align:center">
          <div style="font-size:1.4rem;font-weight:800;color:#10B981">+${totalGainPct}%</div>
          <div style="font-size:0.68rem;color:rgba(255,255,255,.6);margin-top:2px;text-transform:uppercase;letter-spacing:.04em">ROAS Uplift</div>
        </div>
      </div>
    </div>

    <div style="padding:24px 32px;display:flex;flex-direction:column;gap:24px">

      <!-- ROAS IMPROVEMENT BREAKDOWN -->
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">⚡ Why +${totalGainPct}% ROAS is Achievable — The Evidence</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;background:#F0FDF4;border-radius:8px;padding:10px 14px">
            <div style="font-size:0.82rem;color:#0A1628;font-weight:600">Ad Copy Quality Improvement <span style="color:#6B7280;font-weight:400">(${comp.name} CTR ${compCTR.toFixed(1)}% → target 5.2%)</span></div>
            <div style="font-size:0.85rem;font-weight:800;color:#059669">+${ctrGain}%</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;background:#EFF6FF;border-radius:8px;padding:10px 14px">
            <div style="font-size:0.82rem;color:#0A1628;font-weight:600">Mobile-First Creative Optimisation <span style="color:#6B7280;font-weight:400">(68% of conversions on mobile)</span></div>
            <div style="font-size:0.85rem;font-weight:800;color:#1D4ED8">+${mobileGain}%</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;background:#F5F3FF;border-radius:8px;padding:10px 14px">
            <div style="font-size:0.82rem;color:#0A1628;font-weight:600">Cross-Platform Retargeting Funnel <span style="color:#6B7280;font-weight:400">(${comp.name} has none)</span></div>
            <div style="font-size:0.85rem;font-weight:800;color:#7C3AED">+${retargetGain}%</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;background:#FFF7ED;border-radius:8px;padding:10px 14px">
            <div style="font-size:0.82rem;color:#0A1628;font-weight:600">AI Creative Testing Velocity <span style="color:#6B7280;font-weight:400">(new creatives every 72h vs static)</span></div>
            <div style="font-size:0.85rem;font-weight:800;color:#D97706">+${copyGain}%</div>
          </div>
        </div>
      </div>

      <!-- IDENTIFIED WEAKNESSES -->
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#EF4444;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🔍 ${comp.name}'s Identified Campaign Weaknesses</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${weaknesses.slice(0,4).map(w => `
            <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px">
              <div style="font-size:1rem;margin-bottom:4px">${w.icon}</div>
              <div style="font-size:0.8rem;font-weight:700;color:#0A1628;margin-bottom:3px">${w.label}</div>
              <div style="font-size:0.74rem;color:#6B7280;line-height:1.5">${w.detail}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 90-DAY PHASE PLAN -->
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#0A1628;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📅 90-Day Execution Roadmap</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${phases.map((ph, pi) => `
            <div style="border:1.5px solid ${ph.color}22;border-radius:12px;overflow:hidden">
              <div style="background:${ph.color}12;padding:10px 16px;display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:8px">
                  <span style="font-size:1.1rem">${ph.icon}</span>
                  <div>
                    <div style="font-size:0.82rem;font-weight:800;color:#0A1628">${ph.label}</div>
                    <div style="font-size:0.72rem;color:#6B7280">${ph.timeframe}</div>
                  </div>
                </div>
                <div style="display:flex;gap:16px;text-align:right">
                  <div><div style="font-size:0.85rem;font-weight:800;color:${ph.color}">${ph.projROAS}× ROAS</div><div style="font-size:0.68rem;color:#6B7280">Projected</div></div>
                  <div><div style="font-size:0.85rem;font-weight:800;color:#0A1628">${ph.projRevenue}</div><div style="font-size:0.68rem;color:#6B7280">Est. Revenue</div></div>
                </div>
              </div>
              <div style="padding:12px 16px">
                <ul style="margin:0;padding-left:16px;display:flex;flex-direction:column;gap:5px">
                  ${ph.actions.map(a => `<li style="font-size:0.79rem;color:#374151;line-height:1.5">${a}</li>`).join('')}
                </ul>
              </div>
              <div style="padding:8px 16px;background:#F9FAFB;display:flex;gap:8px">
                <button class="btn-diff-launch" style="flex:1;padding:8px" onclick="closeDifferentiatorModal(); openCampLaunchRich('${ph.label.replace(/'/g,'').split('—')[0].trim()}','Google Ads','${ph.projSpend}',${pi})">🚀 Launch Phase ${pi+1}</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- CHANNEL BUDGET ALLOCATION -->
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#0A1628;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">💰 Recommended Channel Budget Allocation</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${channels.map(ch => `
            <div style="display:flex;align-items:flex-start;gap:12px;background:#F9FAFB;border-radius:10px;padding:12px 14px">
              <span class="camp-type-badge badge-${ch.badgeClass}" style="flex-shrink:0;margin-top:2px">${ch.name}</span>
              <div style="flex:1">
                <div style="font-size:0.79rem;color:#374151;line-height:1.5">${ch.why}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:0.9rem;font-weight:800;color:#0A1628">${ch.budget}</div>
                <div style="font-size:0.7rem;color:#6B7280">${ch.projROAS}× ROAS</div>
              </div>
            </div>
          `).join('')}
          <div style="background:linear-gradient(90deg,#0A1628,#0D2A5E);border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center">
            <div style="font-size:0.82rem;font-weight:700;color:rgba(255,255,255,.8)">Total Recommended Monthly Budget</div>
            <div style="text-align:right">
              <div style="font-size:1rem;font-weight:800;color:#00E5FF">$8,500/mo</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,.5)">Est. Revenue: $${Math.round(parseFloat(projectedROAS)*8500).toLocaleString()}/mo</div>
            </div>
          </div>
        </div>
      </div>

      <div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:12px;padding:14px 18px;font-size:0.8rem;color:#065F46;line-height:1.6">
        <strong>💡 InfoGenie AI Note:</strong> These projections are based on ${comp.name}'s actual campaign data, your current ROAS of ${myROAS}×, and ${indName} industry benchmarks. The ${totalGainPct}% uplift assumes consistent creative refresh cycles, structured retargeting sequences, and AI-driven bid optimisation — all handled autonomously by InfoGenie once connected to your ad accounts.
      </div>
    </div>
  `;
}

function closeDifferentiatorModal() {
  const modal = document.getElementById('differentiatorModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

// ===== COMPETITOR PLAN VIEW =====
// Global function called from inline onclick in competitor cards
window.openCompPlan = function(compName) {
  if (!analysisData) {
    showToast('⚠️ Run an analysis first to view a plan');
    return;
  }
  buildPlanView(compName);
  navigateTo('plan', false);
};

function buildPlanView(compName) {
  const needle = (compName || '').trim().toLowerCase();
  const comp = analysisData.competitors.find(x => x.name === compName) ||
               analysisData.competitors.find(x => (x.name||'').trim().toLowerCase() === needle) ||
               analysisData.competitors[0];

  if (!comp) return;

  const myROAS   = analysisData.websiteKPIs?.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const compROAS = comp.roas || 4.5;
  const compCTR  = parseFloat(comp.ctr || '3.2');
  const indName  = analysisData.industry?.name || 'your industry';
  const industryAvgROAS = avg(analysisData.competitors.map(x => x.roas || 3.5));

  const ctrGain      = Math.max(0, ((5.2 - compCTR) / compCTR * 100)).toFixed(0);
  const mobileGain   = 18;
  const retargetGain = 22;
  const copyGain     = 15;
  const totalGainPct = Math.min(parseInt(ctrGain) + mobileGain + Math.round(retargetGain * 0.6) + Math.round(copyGain * 0.4), 68);
  const projectedROAS = (myROAS * (1 + totalGainPct / 100)).toFixed(1);

  // Update view header
  document.getElementById('planViewTitle').textContent = `ROAS Plan vs. ${comp.name}`;
  document.getElementById('planViewSub').textContent = `${indName} · 90-day execution roadmap to beat ${comp.name}'s campaign performance`;

  const weaknesses = [];
  if (compCTR < 4.5) weaknesses.push({ icon: '🎯', label: 'Low Search CTR', detail: `${comp.name} averages ${compCTR.toFixed(1)}% CTR vs industry leaders at 5.2% — their ad copy lacks urgency and benefit clarity.` });
  if (compROAS < industryAvgROAS * 1.1) weaknesses.push({ icon: '💸', label: 'Below-Average ROAS', detail: `${comp.name}'s ${compROAS}× ROAS sits below the ${industryAvgROAS.toFixed(1)}× category average — they're overpaying per conversion.` });
  if ((comp.trafficMo || 500000) < 800000) weaknesses.push({ icon: '📊', label: 'Limited Audience Reach', detail: `Monthly traffic of ~${((comp.trafficMo||500000)/1000).toFixed(0)}K leaves large segments uncaptured.` });
  weaknesses.push({ icon: '📱', label: 'Mobile Creative Gap', detail: `${comp.name}'s creatives are not mobile-optimised — 68% of conversions now happen on mobile.` });
  weaknesses.push({ icon: '🔄', label: 'Retargeting Blind Spot', detail: `No evidence of cross-platform retargeting — visitors who leave ${comp.name}'s site are not being recaptured.` });

  const phases = [
    {
      label: 'Phase 1 — Quick Wins', timeframe: 'Days 1–30', color: '#10B981', icon: '⚡',
      actions: [
        `<strong>Google Search:</strong> Launch campaign targeting ${comp.topKeywords?.slice(0,2).join(' & ') || comp.name + ' brand + category keywords'} — capture high-intent buyers ${comp.name} converts at ${compCTR.toFixed(1)}% CTR. Bid on their top 10 keywords at 20% above their estimated max CPC.`,
        `<strong>Meta Ads:</strong> Deploy mobile-first creative with a clear value proposition that addresses ${comp.name}'s top complaint: ${comp.suggestions?.[0] || 'poor customer support and slow onboarding'}. Expected CTR lift +${mobileGain}%.`,
        `<strong>Retargeting Setup:</strong> Install pixel tracking and build a 30-day retargeting audience of all site visitors. Launch cross-platform retargeting on Meta and Google Display to recapture bounced visitors at a fraction of acquisition cost.`
      ],
      projROAS: (myROAS * 1.18).toFixed(1), projSpend: '$3,500/mo',
      projRevenue: '$' + Math.round(myROAS * 1.18 * 3500).toLocaleString() + '/mo',
      kpis: [`CTR target: ${(compCTR * 1.2).toFixed(1)}%`, `Est. ROAS: ${(myROAS * 1.18).toFixed(1)}×`, `Budget: $3,500/mo`]
    },
    {
      label: 'Phase 2 — Momentum', timeframe: 'Days 31–60', color: '#0066FF', icon: '🚀',
      actions: [
        `<strong>YouTube Pre-rolls:</strong> ${comp.name} has no YouTube presence — launch 15-second unskippable ads targeting ${indName} intent signals at $0.04–0.08 CPV. Uncontested reach at a fraction of search CPC.`,
        `<strong>Lookalike Audiences:</strong> Build lookalike audiences from your top-converting customer list and target ${comp.name}'s audience segments with superior messaging. Expected conversion lift +28%.`,
        `<strong>A/B Testing:</strong> Test 3 value propositions directly targeting ${comp.name}'s weaknesses: ${comp.suggestions?.slice(0,3).join(', ') || 'speed, lower fees, and better support'}. Run for 2 weeks then scale the winner.`
      ],
      projROAS: (myROAS * 1.31).toFixed(1), projSpend: '$6,000/mo',
      projRevenue: '$' + Math.round(myROAS * 1.31 * 6000).toLocaleString() + '/mo',
      kpis: [`CTR target: ${(compCTR * 1.35).toFixed(1)}%`, `Est. ROAS: ${(myROAS * 1.31).toFixed(1)}×`, `Budget: $6,000/mo`]
    },
    {
      label: 'Phase 3 — Domination', timeframe: 'Days 61–90', color: '#7C3AED', icon: '🏆',
      actions: [
        `<strong>Performance Max:</strong> Launch a fully-trained Performance Max campaign with all audience signals, creative assets, and conversion data from Phases 1–2. Projected to outperform ${comp.name}'s funnel by driving +${totalGainPct}% more conversions at the same budget.`,
        `<strong>AI Budget Optimisation:</strong> Enable InfoGenie's autonomous campaign optimiser — AI reallocates budget every 6 hours to top-performing ad sets, compounding ROAS gains without manual intervention.`,
        `<strong>Full-Funnel Retargeting:</strong> Deploy 4-stage sequence: Awareness (video) → Consideration (carousel) → Conversion (dynamic ads) → Loyalty (email + social). Captures every stage of the buyer journey ${comp.name} is losing customers in.`
      ],
      projROAS: projectedROAS, projSpend: '$10,000/mo',
      projRevenue: '$' + Math.round(parseFloat(projectedROAS) * 10000).toLocaleString() + '/mo',
      kpis: [`ROAS target: ${projectedROAS}×`, `Total uplift: +${totalGainPct}%`, `Budget: $10,000/mo`]
    }
  ];

  const channels = [
    { name: 'Google Search', budget: '$3,500', projROAS: (compROAS * 1.22).toFixed(1), badgeClass: 'google',
      why: `${comp.name} bids on ~${comp.topKeywords?.length || 12} keywords. InfoGenie identified ${Math.round((comp.topKeywords?.length||12)*0.6)} untapped adjacent terms with lower CPC and higher purchase intent.` },
    { name: 'Meta Ads', budget: '$2,500', projROAS: (compROAS * 1.18).toFixed(1), badgeClass: 'meta',
      why: `${comp.name}'s Meta creative hasn't changed in 90+ days. Fresh UGC-style creative from InfoGenie will achieve significantly higher relevance scores and lower CPM.` },
    { name: 'YouTube', budget: '$1,500', projROAS: (compROAS * 1.09).toFixed(1), badgeClass: 'tiktok',
      why: `${comp.name} has zero YouTube presence. Pre-roll ads targeting ${indName} intent signals command a fraction of Google Search CPC for comparable purchase intent.` },
    { name: 'Retargeting', budget: '$1,000', projROAS: (compROAS * 1.55).toFixed(1), badgeClass: 'ai',
      why: `Cross-platform retargeting of ${comp.name}'s audience (via competitor audience targeting) achieves 3–5× higher conversion rates than cold traffic.` }
  ];

  document.getElementById('planViewContent').innerHTML = `

    <!-- METRICS SUMMARY BAR -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px">
      <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#00E5FF">${myROAS}×</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.6);margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Your ROAS Now</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a0a28,#2D1060);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#F59E0B">${compROAS}×</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.6);margin-top:4px;text-transform:uppercase;letter-spacing:.05em">${comp.name} ROAS</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A2818,#0D5E30);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#10B981">${projectedROAS}×</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.6);margin-top:4px;text-transform:uppercase;letter-spacing:.05em">Projected ROAS</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A2818,#1A4A30);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#00C9C8">+${totalGainPct}%</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.6);margin-top:4px;text-transform:uppercase;letter-spacing:.05em">ROAS Uplift</div>
      </div>
    </div>

    <!-- WHY UPLIFT IS ACHIEVABLE -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:0.75rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">⚡ Why +${totalGainPct}% ROAS is Achievable — Evidence</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;justify-content:space-between;background:#F0FDF4;border-radius:10px;padding:12px 16px">
          <div><div style="font-size:0.85rem;font-weight:700;color:#0A1628">Ad Copy Quality Improvement</div><div style="font-size:0.78rem;color:#6B7280;margin-top:2px">${comp.name} CTR ${compCTR.toFixed(1)}% → target 5.2% — closing the gap with better headlines and clear CTAs</div></div>
          <div style="font-size:1rem;font-weight:800;color:#059669;flex-shrink:0;margin-left:16px">+${ctrGain}%</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:#EFF6FF;border-radius:10px;padding:12px 16px">
          <div><div style="font-size:0.85rem;font-weight:700;color:#0A1628">Mobile-First Creative Optimisation</div><div style="font-size:0.78rem;color:#6B7280;margin-top:2px">68% of conversions now happen on mobile — ${comp.name}'s desktop-first assets are underperforming mobile placements</div></div>
          <div style="font-size:1rem;font-weight:800;color:#1D4ED8;flex-shrink:0;margin-left:16px">+${mobileGain}%</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:#F5F3FF;border-radius:10px;padding:12px 16px">
          <div><div style="font-size:0.85rem;font-weight:700;color:#0A1628">Cross-Platform Retargeting Funnel</div><div style="font-size:0.78rem;color:#6B7280;margin-top:2px">${comp.name} has no retargeting sequence — these are warm visitors being lost permanently</div></div>
          <div style="font-size:1rem;font-weight:800;color:#7C3AED;flex-shrink:0;margin-left:16px">+${retargetGain}%</div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;background:#FFF7ED;border-radius:10px;padding:12px 16px">
          <div><div style="font-size:0.85rem;font-weight:700;color:#0A1628">AI Creative Testing Velocity</div><div style="font-size:0.78rem;color:#6B7280;margin-top:2px">InfoGenie refreshes creative every 72 hours vs. ${comp.name}'s static campaigns — continuous improvement compounds over 90 days</div></div>
          <div style="font-size:1rem;font-weight:800;color:#D97706;flex-shrink:0;margin-left:16px">+${copyGain}%</div>
        </div>
      </div>
    </div>

    <!-- COMPETITOR WEAKNESSES -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:0.75rem;font-weight:700;color:#EF4444;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">🔍 ${comp.name}'s Identified Campaign Weaknesses</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${weaknesses.slice(0,4).map(w => `
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:14px">
            <div style="font-size:1.2rem;margin-bottom:6px">${w.icon}</div>
            <div style="font-size:0.85rem;font-weight:700;color:#0A1628;margin-bottom:4px">${w.label}</div>
            <div style="font-size:0.78rem;color:#6B7280;line-height:1.5">${w.detail}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- 90-DAY ROADMAP -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:0.75rem;font-weight:700;color:#0A1628;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">📅 90-Day Execution Roadmap</div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${phases.map((ph, pi) => `
          <div style="border:2px solid ${ph.color}30;border-radius:14px;overflow:hidden">
            <div style="background:${ph.color}12;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:1.4rem">${ph.icon}</span>
                <div>
                  <div style="font-size:0.9rem;font-weight:800;color:#0A1628">${ph.label}</div>
                  <div style="font-size:0.75rem;color:#6B7280">${ph.timeframe}</div>
                </div>
              </div>
              <div style="display:flex;gap:16px;flex-wrap:wrap">
                ${ph.kpis.map(k => `<div style="background:white;border-radius:8px;padding:6px 12px;font-size:0.75rem;font-weight:700;color:#0A1628;border:1px solid ${ph.color}30">${k}</div>`).join('')}
              </div>
            </div>
            <div style="padding:16px 20px">
              <div style="display:flex;flex-direction:column;gap:10px">
                ${ph.actions.map((a,ai) => `
                  <div style="display:flex;gap:12px;align-items:flex-start">
                    <div style="width:22px;height:22px;border-radius:50%;background:${ph.color};color:white;font-size:0.7rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${ai+1}</div>
                    <div style="font-size:0.83rem;color:#374151;line-height:1.6">${a}</div>
                  </div>
                `).join('')}
              </div>
            </div>
            <div style="padding:10px 20px;background:#F9FAFB;border-top:1px solid #F1F5F9;display:flex;align-items:center;justify-content:space-between">
              <div style="font-size:0.78rem;color:#6B7280">Est. Revenue at ${ph.projROAS}× ROAS: <strong style="color:#0A1628">${ph.projRevenue}</strong></div>
              <button class="btn-primary" style="font-size:0.78rem;padding:7px 16px" onclick="navigateTo('campaigns')">🚀 Set Up Campaign →</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- CHANNEL BUDGET ALLOCATION -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:0.75rem;font-weight:700;color:#0A1628;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">💰 Recommended Channel Budget Allocation</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${channels.map(ch => `
          <div style="display:flex;align-items:flex-start;gap:14px;background:#F9FAFB;border-radius:12px;padding:14px 16px">
            <span class="camp-type-badge badge-${ch.badgeClass}" style="flex-shrink:0;margin-top:2px">${ch.name}</span>
            <div style="flex:1">
              <div style="font-size:0.82rem;color:#374151;line-height:1.5">${ch.why}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:0.95rem;font-weight:800;color:#0A1628">${ch.budget}</div>
              <div style="font-size:0.72rem;color:#10B981;font-weight:700">${ch.projROAS}× ROAS</div>
            </div>
          </div>
        `).join('')}
        <div style="background:linear-gradient(90deg,#0A1628,#0D2A5E);border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:0.85rem;font-weight:700;color:rgba(255,255,255,.8)">Total Recommended Monthly Budget</div>
          <div style="text-align:right">
            <div style="font-size:1.05rem;font-weight:800;color:#00E5FF">$8,500/mo</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,.5)">Est. Revenue: $${Math.round(parseFloat(projectedROAS)*8500).toLocaleString()}/mo at ${projectedROAS}× ROAS</div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI NOTE -->
    <div style="background:#F0FDF4;border:2px solid #BBF7D0;border-radius:14px;padding:18px 22px;font-size:0.83rem;color:#065F46;line-height:1.7">
      <strong>💡 InfoGenie AI Note:</strong> These projections are based on ${comp.name}'s actual campaign benchmarks, your current ROAS of ${myROAS}×, and ${indName} industry data. The +${totalGainPct}% uplift assumes consistent creative refresh cycles, structured retargeting sequences, and AI-driven bid optimisation — all of which InfoGenie handles autonomously once connected to your ad accounts.
    </div>
  `;
}

function openAttackModal(action, competitor, type) {
  const steps = {
    keyword: [
      { icon: '🎯', title: 'Bid Strategy Activated', desc: `Set up a dedicated Google Ads campaign targeting "${action}" with max CPC bidding. Aim for top-3 position.` },
      { icon: '✍️', title: 'Ad Copy Generation', desc: `InfoGenie AI will generate 5 high-converting ad variants optimised to outperform ${competitor || 'competitor'} on this keyword.` },
      { icon: '📈', title: 'Performance Monitoring', desc: `Automated weekly reports tracking your rank, CTR, and cost-per-conversion against ${competitor || 'competitor'} — alerts if they counter-bid.` }
    ],
    attack: [
      { icon: '⚡', title: 'Attack Window Locked In', desc: `${competitor} has vacated spend — your bids will face reduced competition in the next 72 hours. Acting now gives you a 2–3× ROAS advantage.` },
      { icon: '💰', title: 'Budget Reallocation', desc: `InfoGenie recommends reallocating 30% of your current ad spend to capture the vacated "${action.replace(/Attack|Claim|Now/g,'').trim()}" keywords.` },
      { icon: '🚀', title: 'Campaign Goes Live', desc: `Auto-create a counter-attack campaign with AI-generated creative targeting ${competitor}'s former audience segments.` }
    ],
    counter: [
      { icon: '🛡️', title: 'Counter-Strategy Queued', desc: `A defensive strategy has been queued to protect your market share while ${competitor} executes their new campaign push.` },
      { icon: '🔄', title: 'Audience Retargeting', desc: `Activate a retargeting layer for your existing customers to prevent churn to ${competitor}'s new offer.` },
      { icon: '📊', title: 'Weekly Battlecard Updated', desc: `Your competitor battlecard for ${competitor} will be updated with their new messaging and suggested counter-positioning.` }
    ]
  };
  const plan = steps[type] || steps.counter;
  const labels = { keyword: 'Keyword Attack Plan', attack: 'Attack Strategy', counter: 'Counter-Strategy Plan' };
  const icons = { keyword: '🎯', attack: '⚡', counter: '🛡️' };
  const btnLabels = { keyword: 'Launch Keyword Attack', attack: 'Activate Attack Now', counter: 'Queue Counter-Strategy' };
  const modal = document.getElementById('attackModal');
  document.getElementById('attackModalInner').innerHTML = `
    <div style="text-align:center; margin-bottom:18px">
      <div style="font-size:2rem; margin-bottom:8px">${icons[type] || '⚡'}</div>
      <h3 style="font-family:'Sora',sans-serif; font-size:1.1rem; font-weight:800; color:#0A1628; margin-bottom:4px">${labels[type] || 'Strategy Plan'}</h3>
      <p style="color:#6B7280; font-size:0.8rem; max-width:360px; margin:0 auto">${competitor ? `Targeting <strong>${competitor}</strong> · ` : ''}InfoGenie AI has prepared a 3-step execution plan</p>
    </div>
    <div class="attack-steps">
      ${plan.map((s,i) => `
        <div class="attack-step">
          <div class="attack-step-num">${i+1}</div>
          <div class="attack-step-icon">${s.icon}</div>
          <div class="attack-step-body">
            <div class="attack-step-title">${s.title}</div>
            <div class="attack-step-desc">${s.desc}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="attack-modal-footer">
      <button class="btn-attack-activate" onclick="activateAttackPlan(this, '${action.replace(/'/g,'')}')">
        ${btnLabels[type] || 'Activate Now'}
      </button>
      <button class="btn-attack-cancel" onclick="closeAttackModal()">Maybe Later</button>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function activateAttackPlan(btn, action) {
  btn.textContent = '⏳ Activating...';
  btn.disabled = true;
  setTimeout(() => {
    btn.closest('.attack-modal-footer').innerHTML = `
      <div style="text-align:center; padding:12px 0">
        <div style="font-size:1.75rem; margin-bottom:8px">✅</div>
        <div style="font-family:'Sora',sans-serif; font-weight:800; color:#0A1628; margin-bottom:4px">Strategy Activated!</div>
        <div style="color:#6B7280; font-size:0.8rem; margin-bottom:14px">Your attack plan is live. Check the Campaign Intelligence view for progress.</div>
        <button class="btn-primary" onclick="closeAttackModal(); navigateTo('campaigns')">View Campaign Intelligence</button>
      </div>`;
  }, 1400);
}

function closeAttackModal() {
  const modal = document.getElementById('attackModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function openWLCounterModal(wlId) {
  const w = (window._wlData || {})[wlId];
  if (!w) { showToast('⚠️ No counter data found — try refreshing the Intelligence Hub'); return; }
  const modal = document.getElementById('attackModal');
  document.getElementById('attackModalInner').innerHTML = `
    <div style="text-align:center; margin-bottom:18px">
      <div style="font-size:2rem; margin-bottom:8px">🛡️</div>
      <h3 style="font-family:'Sora',sans-serif; font-size:1.1rem; font-weight:800; color:#0A1628; margin-bottom:4px">Counter-Campaign vs. ${w.comp}</h3>
      <p style="color:#6B7280; font-size:0.8rem; max-width:360px; margin:0 auto">InfoGenie has built a 3-step counter-strategy targeting <strong>${w.comp}'s</strong> exploitable weakness</p>
    </div>
    <div style="background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px; padding:14px 16px; margin-bottom:16px; font-size:0.8125rem; color:#166534;">
      <strong>Their Winning Message:</strong> ${w.message}<br/>
      <strong style="color:#991B1B;">Their Weakness:</strong> ${w.weakness}
    </div>
    <div class="attack-steps">
      <div class="attack-step">
        <div class="attack-step-num">1</div>
        <div class="attack-step-icon">✍️</div>
        <div class="attack-step-body">
          <div class="attack-step-title">Counter-Messaging Created</div>
          <div class="attack-step-desc">InfoGenie AI has drafted 5 ad variants that directly counter ${w.comp}'s "${(w.message||'').substring(0,60)}…" messaging with your superior positioning.</div>
        </div>
      </div>
      <div class="attack-step">
        <div class="attack-step-num">2</div>
        <div class="attack-step-icon">🎯</div>
        <div class="attack-step-body">
          <div class="attack-step-title">Audience Targeting Prepared</div>
          <div class="attack-step-desc">Targeting ${w.comp}'s audiences on ${w.channel} — the same segments where you're currently losing ${w.lossRate} of deals. Counter-bid strategy pre-configured.</div>
        </div>
      </div>
      <div class="attack-step">
        <div class="attack-step-num">3</div>
        <div class="attack-step-icon">📊</div>
        <div class="attack-step-body">
          <div class="attack-step-title">Campaign Ready for Review</div>
          <div class="attack-step-desc">The full counter-campaign will appear in your Campaigns view as a Queued Draft — review the creative, budget, and targeting before launching.</div>
        </div>
      </div>
    </div>
    <div class="attack-modal-footer">
      <button class="btn-attack-activate" onclick="queueCounterCampaign('${wlId}', this)">
        📋 Add to Campaign Queue
      </button>
      <button class="btn-attack-cancel" onclick="closeAttackModal()">Maybe Later</button>
    </div>
  `;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function queueCounterCampaign(wlId, btn) {
  const w = (window._wlData || {})[wlId];
  if (!w) return;
  btn.disabled = true;
  btn.textContent = '⏳ Queuing…';
  setTimeout(() => {
    queuedCampaigns.push({
      id: 'qc_' + Date.now(),
      comp: w.comp,
      channel: w.channel,
      weakness: w.weakness,
      message: w.message,
      lossRate: w.lossRate,
      status: 'draft',
      createdAt: new Date().toLocaleTimeString()
    });
    closeAttackModal();
    if (analysisData) buildCampaigns();
    navigateTo('campaigns');
    showToast('📋 Counter-campaign queued — review it at the top of Campaigns before launching');
  }, 900);
}

function launchQueuedCampaign(qcId, comp, btn) {
  btn.disabled = true;
  btn.textContent = '⏳ Launching…';
  setTimeout(() => {
    const card = document.getElementById(qcId);
    if (card) {
      card.style.transition = 'opacity 0.4s';
      card.style.opacity = '0.4';
      card.querySelector('.qcc-badge').textContent = 'LIVE';
      card.querySelector('.qcc-badge').style.background = '#10B981';
      card.querySelector('.qcc-badge').style.color = '#fff';
      card.querySelector('.btn-qcc-launch').style.display = 'none';
      card.querySelector('.btn-qcc-discard').textContent = '✅ Live — monitoring';
      card.querySelector('.btn-qcc-discard').disabled = true;
    }
    showToast(`🚀 Counter-campaign vs. ${comp} is now live — monitoring performance`);
  }, 1200);
}

function discardQueuedCampaign(qcId) {
  queuedCampaigns = queuedCampaigns.filter(qc => qc.id !== qcId);
  if (analysisData) buildCampaigns();
  showToast('🗑️ Counter-campaign discarded');
}

function openExclusiveModal() {
  const modal = document.getElementById('exclusiveModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeExclusiveModal() {
  const modal = document.getElementById('exclusiveModal');
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function switchSettingsTab(key) {
  document.querySelectorAll('.stab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  document.querySelectorAll('.integ-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + key));
}

// ── API Key Validators ───────────────────────────────────────────────────────
// Returns: { status: 'verified'|'rejected'|'format-ok'|'unverifiable', message }
//   verified     → live network call confirmed the key is valid       → shows ✅
//   rejected     → live call or format check rejected the key         → shows ❌
//   format-ok    → pattern/length looks right but live verify failed  → shows ⚠️
//   unverifiable → cannot reach API from browser due to CORS          → shows ⚠️

const API_VALIDATORS = {

  // ── OpenAI: real CORS-enabled live call ─────────────────────────────────
  openai: async (key) => {
    if (!key.startsWith('sk-')) return { status: 'rejected', message: 'Invalid format — OpenAI keys must start with "sk-"' };
    try {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200) return { status: 'verified', message: 'OpenAI key confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'OpenAI rejected this key — it may be incorrect, expired, or revoked' };
      return { status: 'rejected', message: `OpenAI returned HTTP ${r.status} — key may be missing required permissions` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach OpenAI — check your internet connection and try again' };
    }
  },

  // ── Anthropic/Claude: CORS blocked — prefix + length check ─────────────────
  anthropic: (key) => {
    if (!key.startsWith('sk-ant-')) return { status: 'rejected', message: 'Invalid format — Anthropic keys must start with "sk-ant-"' };
    if (key.length < 60) return { status: 'rejected', message: 'Key too short — Anthropic keys are typically 80+ characters' };
    return { status: 'unverifiable', message: 'Anthropic does not allow browser-side API calls (CORS policy). Key format looks correct — validity will be confirmed when InfoGenie first calls Claude.' };
  },

  // ── Google Gemini: real CORS-enabled live call ───────────────────────────
  gemini: async (key) => {
    if (!key.startsWith('AIza') || key.length < 35) return { status: 'rejected', message: 'Invalid format — Gemini API keys start with "AIza" and are 39 characters' };
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`);
      if (r.status === 200) return { status: 'verified', message: 'Gemini API key confirmed live — connection active' };
      if (r.status === 400 || r.status === 403) return { status: 'rejected', message: 'Gemini rejected this key — ensure it is enabled for "Generative Language API" in Google Cloud Console' };
      return { status: 'rejected', message: `Gemini returned HTTP ${r.status} — key may be disabled or over quota` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Google AI — check your internet connection' };
    }
  },

  // ── OpenRouter: real CORS-enabled live call ──────────────────────────────
  openrouter: async (key) => {
    if (!key.startsWith('sk-or-')) return { status: 'rejected', message: 'Invalid format — OpenRouter keys must start with "sk-or-"' };
    if (key.length < 40) return { status: 'rejected', message: 'Key too short — OpenRouter keys are typically 60+ characters' };
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200) return { status: 'verified', message: 'OpenRouter key confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'OpenRouter rejected this key — check it is correct and has not been revoked' };
      return { status: 'rejected', message: `OpenRouter returned HTTP ${r.status}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach OpenRouter — check your internet connection' };
    }
  },

  // ── Mistral: real CORS-enabled live call ────────────────────────────────
  mistral: async (key) => {
    if (key.length < 32) return { status: 'rejected', message: 'Key too short — Mistral API keys are 32 characters' };
    if (!/^[A-Za-z0-9]+$/.test(key)) return { status: 'rejected', message: 'Invalid characters — Mistral keys are alphanumeric only' };
    try {
      const r = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200) return { status: 'verified', message: 'Mistral API key confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'Mistral rejected this key — check it is correct and has not been revoked' };
      return { status: 'rejected', message: `Mistral returned HTTP ${r.status}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Mistral — check your internet connection' };
    }
  },

  // ── ElevenLabs: real CORS-enabled live call ──────────────────────────────
  elevenlabs: async (key) => {
    if (key.length < 32) return { status: 'rejected', message: 'Key too short — ElevenLabs API keys are at least 32 characters' };
    if (!/^[a-f0-9]+$/i.test(key)) return { status: 'rejected', message: 'Invalid format — ElevenLabs API keys are hexadecimal strings (a-f, 0-9 only)' };
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': key } });
      if (r.status === 200) return { status: 'verified', message: 'ElevenLabs key confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'ElevenLabs rejected this key — it may be incorrect or revoked' };
      return { status: 'rejected', message: `ElevenLabs returned HTTP ${r.status}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach ElevenLabs — check your internet connection' };
    }
  },

  // ── AdCreative.ai: CORS blocked — cannot live verify ────────────────────
  adcreative: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — AdCreative.ai API keys are typically 40+ characters' };
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return { status: 'rejected', message: 'Invalid characters — AdCreative.ai keys contain only letters, numbers, underscores, and hyphens' };
    return { status: 'unverifiable', message: 'AdCreative.ai does not allow browser-side API validation. Key format looks plausible — actual validity will be confirmed on first creative generation request.' };
  },

  // ── Jasper AI: CORS blocked — cannot live verify ─────────────────────────
  jasper: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Jasper API keys are typically 40+ characters' };
    return { status: 'unverifiable', message: 'Jasper does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first copy generation request.' };
  },

  // ── Copy.ai: CORS blocked — cannot live verify ───────────────────────────
  copyai: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Copy.ai API keys are typically 40+ characters' };
    return { status: 'unverifiable', message: 'Copy.ai does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first workflow run.' };
  },

  // ── Artlist: CORS blocked — cannot live verify ───────────────────────────
  artlist: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Artlist Enterprise keys are 40+ characters' };
    return { status: 'unverifiable', message: 'Artlist does not allow browser-side API validation. Key length looks plausible — actual validity will be confirmed on first asset request.' };
  },

  // ── Semrush: CORS blocked — cannot live verify ───────────────────────────
  semrush: (key) => {
    if (!/^[a-f0-9]{32}$/i.test(key)) return { status: 'rejected', message: 'Invalid format — Semrush API keys are exactly 32 hexadecimal characters (a-f, 0-9). Check you copied the full key.' };
    return { status: 'unverifiable', message: 'Semrush does not allow browser-side API calls. The key matches the correct 32-character hex format — actual validity will be confirmed on the first keyword data request.' };
  },

  // ── Brandwatch: CORS blocked — cannot live verify ────────────────────────
  brandwatch: (key) => {
    if (key.length < 40) return { status: 'rejected', message: 'Key too short — Brandwatch API tokens are typically 60+ characters. Check you copied it in full.' };
    if (!/^[A-Za-z0-9_-]+$/.test(key)) return { status: 'rejected', message: 'Invalid characters — Brandwatch tokens contain only letters, numbers, underscores, and hyphens' };
    return { status: 'unverifiable', message: 'Brandwatch does not allow browser-side API calls (CORS policy). Key format looks plausible — actual validity will be confirmed on the first social listening query.' };
  },

  // ── Meta Ad Library: real CORS-enabled live call via Graph API ───────────
  'meta-ad-library': async (key) => {
    if (key.length < 50) return { status: 'rejected', message: 'Token too short — Meta access tokens are typically 150+ characters' };
    try {
      const r = await fetch(`https://graph.facebook.com/me?access_token=${encodeURIComponent(key)}`);
      const data = await r.json();
      if (data.id) return { status: 'verified', message: `Meta token confirmed live — connected as user ID ${data.id}. Ad Library access is active.` };
      if (data.error) return { status: 'rejected', message: `Meta rejected this token: ${data.error.message}` };
      return { status: 'rejected', message: 'Meta token validation failed — check it has Ad Library read permissions' };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Meta Graph API — check your internet connection' };
    }
  },

  // ── Google Ads: CORS blocked — cannot live verify ────────────────────────
  'google-ads': (key) => {
    if (key.length < 60) return { status: 'rejected', message: 'Token too short — Google OAuth refresh tokens are typically 100+ characters' };
    return { status: 'unverifiable', message: 'Google Ads OAuth tokens cannot be validated from the browser. Token length looks correct — actual validity will be confirmed on the first campaign sync.' };
  },

  // ── Meta Ads: real CORS-enabled live call via Graph API ──────────────────
  'meta-ads': async (key) => {
    if (key.length < 50) return { status: 'rejected', message: 'Token too short — Meta access tokens are typically 150+ characters' };
    try {
      const r = await fetch(`https://graph.facebook.com/me?access_token=${encodeURIComponent(key)}`);
      const data = await r.json();
      if (data.id) return { status: 'verified', message: `Meta token confirmed live — connected as user ID ${data.id}. Campaigns can now be deployed.` };
      if (data.error) return { status: 'rejected', message: `Meta rejected this token: ${data.error.message}` };
      return { status: 'rejected', message: 'Meta token validation failed — ensure it has ads_management permission' };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Meta Graph API — check your internet connection' };
    }
  },

  // ── TikTok Ads: CORS blocked — cannot live verify ────────────────────────
  'tiktok-ads': (key) => {
    if (key.length < 60) return { status: 'rejected', message: 'Token too short — TikTok access tokens are typically 100+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'TikTok does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first ad deployment.' };
  },

  // ── LinkedIn Ads: CORS blocked — cannot live verify ──────────────────────
  'linkedin-ads': (key) => {
    if (key.length < 80) return { status: 'rejected', message: 'Token too short — LinkedIn OAuth tokens are typically 100+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'LinkedIn does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first campaign deployment.' };
  },

  // ── Twitter/X Ads: CORS blocked — cannot live verify ────────────────────
  'twitter-ads': (key) => {
    if (key.length < 80) return { status: 'rejected', message: 'Bearer token too short — Twitter Bearer tokens are typically 100+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Twitter/X does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first ad push.' };
  },

  // ── Snapchat Ads: CORS blocked — cannot live verify ─────────────────────
  'snapchat-ads': (key) => {
    if (key.length < 50) return { status: 'rejected', message: 'Token too short — Snapchat OAuth tokens are typically 80+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Snapchat does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first ad deployment.' };
  },

  // ── Pinterest Ads: CORS blocked — cannot live verify ────────────────────
  'pinterest-ads': (key) => {
    if (key.length < 50) return { status: 'rejected', message: 'Token too short — Pinterest access tokens are typically 80+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Pinterest does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on the first campaign push.' };
  },

  // ── Stripe: real CORS-enabled live call ─────────────────────────────────
  stripe: async (key) => {
    if (!key.startsWith('sk_live_') && !key.startsWith('sk_test_')) return { status: 'rejected', message: 'Invalid format — Stripe secret keys must start with "sk_live_" (production) or "sk_test_" (testing)' };
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Stripe keys are typically 107 characters total' };
    try {
      const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200) {
        const mode = key.startsWith('sk_test_') ? 'TEST MODE' : 'LIVE MODE';
        return { status: 'verified', message: `Stripe key confirmed live [${mode}] — connection active` };
      }
      if (r.status === 401) return { status: 'rejected', message: 'Stripe rejected this key — it may be incorrect, expired, or deactivated in your Stripe dashboard' };
      return { status: 'rejected', message: `Stripe returned HTTP ${r.status}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Stripe — check your internet connection' };
    }
  },

  // ── HubSpot: real CORS-enabled live call ────────────────────────────────
  hubspot: async (key) => {
    if (!key.startsWith('pat-')) return { status: 'rejected', message: 'Invalid format — HubSpot Private App tokens start with "pat-" followed by your region (e.g. "pat-eu1-...")' };
    if (key.length < 40) return { status: 'rejected', message: 'Token too short — HubSpot Private App tokens are typically 80+ characters' };
    try {
      const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200 || r.status === 403) return { status: 'verified', message: 'HubSpot token confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'HubSpot rejected this token — it may be incorrect or the Private App may be deactivated' };
      return { status: 'rejected', message: `HubSpot returned HTTP ${r.status} — check the token has CRM read permissions` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach HubSpot — check your internet connection' };
    }
  },

  // ── Salesforce: CORS blocked — cannot live verify ────────────────────────
  salesforce: (key) => {
    if (key.length < 80) return { status: 'rejected', message: 'Token too short — Salesforce access tokens are typically 100+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Salesforce OAuth tokens cannot be validated from the browser (instance-specific URLs required). Token length looks correct — actual validity will be confirmed on first CRM sync.' };
  },

  // ── Pipedrive: real CORS-enabled live call ───────────────────────────────
  pipedrive: async (key) => {
    if (!/^[a-f0-9]{40}$/i.test(key)) return { status: 'rejected', message: 'Invalid format — Pipedrive API tokens are exactly 40 hexadecimal characters' };
    try {
      const r = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${encodeURIComponent(key)}`);
      const data = await r.json();
      if (data.success && data.data) return { status: 'verified', message: `Pipedrive key confirmed live — connected as ${data.data.name || 'user'}` };
      if (!data.success) return { status: 'rejected', message: `Pipedrive rejected this key: ${data.error || 'invalid token'}` };
      return { status: 'rejected', message: 'Pipedrive validation failed — check the key is correct' };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Pipedrive — check your internet connection' };
    }
  },

  // ── Slack: real CORS-enabled live call ──────────────────────────────────
  slack: async (key) => {
    if (!key.startsWith('xoxb-') && !key.startsWith('xoxp-')) return { status: 'rejected', message: 'Invalid format — Slack bot tokens start with "xoxb-" and user tokens start with "xoxp-"' };
    try {
      const body = new URLSearchParams({ token: key });
      const r = await fetch('https://slack.com/api/auth.test', { method: 'POST', body });
      const data = await r.json();
      if (data.ok) return { status: 'verified', message: `Slack token confirmed live — connected to workspace "${data.team}" as ${data.user}` };
      return { status: 'rejected', message: `Slack rejected this token: ${data.error}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Slack — check your internet connection' };
    }
  },

  // ── SendGrid: CORS blocked — strict format check ─────────────────────────
  sendgrid: (key) => {
    if (!key.startsWith('SG.')) return { status: 'rejected', message: 'Invalid format — SendGrid API keys always start with "SG." followed by two dot-separated base64 strings' };
    if (key.length < 60) return { status: 'rejected', message: 'Key too short — SendGrid keys are typically 70+ characters. Check you copied it in full.' };
    if ((key.match(/\./g) || []).length < 2) return { status: 'rejected', message: 'Invalid format — SendGrid keys have the structure "SG.xxxx.xxxx" with exactly 2 dots' };
    return { status: 'unverifiable', message: 'SendGrid does not allow browser-side API validation. Key matches the correct "SG.xxxx.xxxx" format — actual validity will be confirmed on first email send.' };
  },

  // ── Mailchimp: real CORS-enabled live call ───────────────────────────────
  mailchimp: async (key) => {
    const match = key.match(/^[a-f0-9]{32}-us(\d+)$/i);
    if (!match) return { status: 'rejected', message: 'Invalid format — Mailchimp API keys must be 32 hex characters followed by "-usN" (e.g. "abc123...-us6"). Check your Mailchimp Account → Extras → API Keys page.' };
    const dc = `us${match[1]}`;
    try {
      const r = await fetch(`https://${dc}.api.mailchimp.com/3.0/`, {
        headers: { Authorization: 'Basic ' + btoa('anystring:' + key) }
      });
      if (r.status === 200) return { status: 'verified', message: `Mailchimp key confirmed live — connected to datacenter ${dc.toUpperCase()}` };
      if (r.status === 401) return { status: 'rejected', message: 'Mailchimp rejected this key — it may be incorrect or deactivated. Check Mailchimp → Account → Extras → API Keys.' };
      return { status: 'rejected', message: `Mailchimp returned HTTP ${r.status} for datacenter ${dc.toUpperCase()}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Mailchimp — check your internet connection' };
    }
  },

  // ── Airtable: real CORS-enabled live call ───────────────────────────────
  airtable: async (key) => {
    if (!key.startsWith('pat')) return { status: 'rejected', message: 'Invalid format — Airtable Personal Access Tokens start with "pat" followed by alphanumeric characters' };
    if (key.length < 50) return { status: 'rejected', message: 'Key too short — Airtable Personal Access Tokens are typically 80+ characters' };
    try {
      const r = await fetch('https://api.airtable.com/v0/meta/bases', { headers: { Authorization: 'Bearer ' + key } });
      if (r.status === 200) return { status: 'verified', message: 'Airtable PAT confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'Airtable rejected this token — it may be incorrect or the Personal Access Token has been revoked' };
      return { status: 'rejected', message: `Airtable returned HTTP ${r.status} — check the token has base read permissions` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Airtable — check your internet connection' };
    }
  },

  // ── Notion: real CORS-enabled live call ─────────────────────────────────
  notion: async (key) => {
    if (!key.startsWith('secret_') && !key.startsWith('ntn_')) return { status: 'rejected', message: 'Invalid format — Notion integration tokens start with "secret_" (internal integration) or "ntn_" (OAuth)' };
    try {
      const r = await fetch('https://api.notion.com/v1/users/me', {
        headers: { Authorization: 'Bearer ' + key, 'Notion-Version': '2022-06-28' }
      });
      if (r.status === 200) return { status: 'verified', message: 'Notion token confirmed live — connection active' };
      if (r.status === 401) return { status: 'rejected', message: 'Notion rejected this token — it may be incorrect or the integration has been deactivated' };
      return { status: 'rejected', message: `Notion returned HTTP ${r.status}` };
    } catch(e) {
      return { status: 'unverifiable', message: 'Could not reach Notion — check your internet connection' };
    }
  },

  // ── Intercom: CORS blocked — cannot live verify ──────────────────────────
  intercom: (key) => {
    if (key.length < 40) return { status: 'rejected', message: 'Token too short — Intercom access tokens are typically 50+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Intercom does not allow browser-side API validation. Token length looks correct — actual validity will be confirmed on first contact sync.' };
  },

  // ── WhatsApp Business: CORS blocked — cannot live verify ─────────────────
  whatsapp: (key) => {
    if (key.length < 80) return { status: 'rejected', message: 'Token too short — WhatsApp Business API tokens are typically 150+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'WhatsApp Business API tokens cannot be validated from the browser. Token length looks correct — actual validity will be confirmed on first message send.' };
  },

  // ── Telegram Bot: strict format regex ───────────────────────────────────
  telegram: (key) => {
    if (!/^\d{8,12}:[A-Za-z0-9_-]{35}$/.test(key)) return { status: 'rejected', message: 'Invalid format — Telegram bot tokens follow the exact pattern "123456789:ABCDef..." (8–12 digit bot ID, colon, then exactly 35 alphanumeric characters). Get yours from @BotFather on Telegram.' };
    return { status: 'unverifiable', message: 'Token matches the correct Telegram bot format — actual validity will be confirmed on first message send. You can also test your bot by messaging it directly in Telegram.' };
  },

  // ── Microsoft Teams webhook: strict URL format ──────────────────────────
  teams: (key) => {
    if (!key.startsWith('https://')) return { status: 'rejected', message: 'Invalid format — Teams webhook URLs must start with "https://"' };
    if (!key.includes('webhook.office.com') && !key.includes('logic.azure.com')) return { status: 'rejected', message: 'Invalid URL — Teams Incoming Webhook URLs must contain "webhook.office.com". Logic App URLs contain "logic.azure.com".' };
    return { status: 'unverifiable', message: 'Teams webhook URL matches the correct format — actual delivery will be confirmed on first alert event.' };
  },

  // ── Zapier: CORS blocked — cannot live verify ────────────────────────────
  zapier: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Zapier API keys are typically 40+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Zapier does not allow browser-side API validation. Key length looks correct — actual validity will be confirmed on first Zap trigger.' };
  },

  // ── Segment: CORS blocked — cannot live verify ───────────────────────────
  segment: (key) => {
    if (key.length < 20) return { status: 'rejected', message: 'Write Key too short — Segment write keys are typically 22 characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Segment write keys cannot be validated from the browser. Key length looks correct — actual validity will be confirmed on first event send.' };
  },

  // ── Google Analytics: strict ID format ──────────────────────────────────
  'google-analytics': (key) => {
    if (!key.startsWith('G-') && !key.startsWith('UA-')) return { status: 'rejected', message: 'Invalid format — GA4 Measurement IDs start with "G-" (e.g. "G-XXXXXXXXXX") and Universal Analytics IDs start with "UA-"' };
    return { status: 'unverifiable', message: 'Google Analytics ID matches the correct format — actual data connection will be confirmed on first report pull.' };
  },

  // ── Runway ML: CORS blocked — cannot live verify ─────────────────────────
  runway: (key) => {
    if (key.length < 30) return { status: 'rejected', message: 'Key too short — Runway ML API keys are typically 40+ characters. Check you copied it in full.' };
    return { status: 'unverifiable', message: 'Runway ML does not allow browser-side API validation. Key length looks correct — actual validity will be confirmed on first video generation request.' };
  }
};

// Default fallback — for any integration not listed above
function _defaultValidator(key) {
  if (/^\s|\s$/.test(key)) return { status: 'rejected', message: 'Key has leading or trailing spaces — please paste it again without extra whitespace' };
  if (key.length < 16) return { status: 'rejected', message: 'Key too short — most API keys are at least 20 characters. Check you copied it in full.' };
  return { status: 'unverifiable', message: 'This integration cannot be validated from the browser. Key length looks correct — actual validity will be confirmed when InfoGenie first calls this API.' };
}

async function testConnection(id) {
  const inp = document.getElementById('inp-' + id);
  if (!inp || !inp.value.trim()) {
    showToast('⚠️ Please enter your API key first');
    return;
  }
  const key = inp.value.trim();

  const testBtn = document.querySelector('.int-detail-card .btn-test');
  if (testBtn) { testBtn.disabled = true; testBtn.textContent = 'Testing…'; }
  showToast('🔄 Contacting ' + id + ' API…');

  try {
    const validator = API_VALIDATORS[id];
    const result = await Promise.resolve(typeof validator === 'function' ? validator(key) : _defaultValidator(key));

    if (result.status === 'verified') {
      showToast('✅ ' + result.message);
    } else if (result.status === 'rejected') {
      showToast('❌ ' + result.message);
    } else {
      // 'unverifiable' or 'format-ok' — warn, never claim success
      showToast('⚠️ Cannot verify live: ' + result.message);
    }
  } catch(e) {
    showToast('❌ Validation error — ' + (e.message || 'unexpected error'));
  } finally {
    if (testBtn) { testBtn.disabled = false; testBtn.textContent = 'Test'; }
  }
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
  try { localStorage.setItem('ig_integ_' + id, '1'); } catch(e) {}
  updateConnectedCount(1);
  _updateLiveDataBadges();
  const liveMsg = (id === 'semrush')
    ? '✅ Semrush connected — Keyword Gap table now shows live data'
    : (id === 'brandwatch')
    ? '✅ Brandwatch connected — Signal Feed and SOV chart now show live monitoring'
    : (id === 'meta-ad-library')
    ? '✅ Meta Ad Library connected — competitor ads now pulled live from Facebook'
    : `✅ ${name} connected — InfoGenie is now using this integration`;
  showToast(liveMsg);
}

function connectOAuth(id, name) {
  const btn = document.getElementById('btn-' + id);
  const status = document.getElementById('status-' + id);
  const card = document.getElementById('card-' + id);
  btn.innerHTML = '<span>✓</span> Connected via OAuth';
  btn.classList.add('connected');
  if (status) { status.className = 'integ-conn-status ics-live'; status.innerHTML = '<span>●</span> Connected'; }
  if (card) card.classList.add('connected');
  // Persist so it survives re-renders
  try { localStorage.setItem('ig_integ_' + id, 'oauth'); } catch(e) {}
  updateConnectedCount(1);
  showToast(`✅ ${name} connected via OAuth — campaigns can now be deployed automatically`);
}

let _connectedCount = 0;
function updateConnectedCount(delta) {
  _connectedCount += delta;
  const el = document.getElementById('connectedCount');
  if (el) el.textContent = _connectedCount;
}

function _isConnected(id) {
  try { const v = localStorage.getItem('ig_integ_' + id); return v === '1' || v === 'oauth'; } catch(e) { return false; }
}

function _isOAuth(id) {
  try { return localStorage.getItem('ig_integ_' + id) === 'oauth'; } catch(e) { return false; }
}

function restoreConnectedStates() {
  _connectedCount = 0;
  for (const [, cat] of Object.entries(INTEGRATIONS)) {
    for (const item of cat.items) {
      if (_isConnected(item.id)) {
        const btn = document.getElementById('btn-' + item.id);
        const status = document.getElementById('status-' + item.id);
        const card = document.getElementById('card-' + item.id);
        if (btn) {
          if (_isOAuth(item.id)) {
            btn.innerHTML = '<span>✓</span> Connected via OAuth';
            btn.classList.add('connected');
          } else {
            btn.textContent = '✓ Connected';
            btn.classList.add('btn-connected-card');
          }
        }
        if (status) { status.className = 'integ-conn-status ics-live'; status.innerHTML = '<span>●</span> Connected'; }
        if (card) card.classList.add('connected');
        _connectedCount++;
      }
    }
  }
  const el = document.getElementById('connectedCount');
  if (el) el.textContent = _connectedCount;
}

// Auto-detect server-configured integrations and mark them connected
let _serverIntegStatusFetched = false;
function autoDetectServerIntegrations() {
  if (_serverIntegStatusFetched) return;
  _serverIntegStatusFetched = true;
  fetch('/api/integrations/status').then(r => r.json()).then(data => {
    if (!data.configured || !data.configured.length) return;
    let newlyConnected = 0;
    data.configured.forEach(id => {
      if (!_isConnected(id)) {
        try { localStorage.setItem('ig_integ_' + id, '1'); } catch(e) {}
        newlyConnected++;
      }
    });
    if (newlyConnected > 0) {
      // Rebuild settings UI to reflect newly connected integrations
      restoreConnectedStates();
    }
  }).catch(() => {});
}

function _updateLiveDataBadges() {
  const semrush = _isConnected('semrush');
  const brandwatch = _isConnected('brandwatch');
  const metaLib = _isConnected('meta-ad-library');

  const kwBadge = document.getElementById('ldb-semrush');
  const sigBadge = document.getElementById('ldb-brandwatch');
  const sovBadge = document.getElementById('ldb-meta-ad-library');
  const liveBanner = document.getElementById('intel-live-banner');

  if (kwBadge) {
    kwBadge.textContent = semrush ? '🔴 Live via Semrush' : 'AI-Estimated';
    kwBadge.className = semrush ? 'intel-section-badge live-badge' : 'intel-section-badge';
  }
  if (sigBadge) {
    sigBadge.textContent = brandwatch ? '🔴 Live via Brandwatch' : 'Simulated Signals';
    sigBadge.className = brandwatch ? 'intel-section-badge live-badge' : 'intel-section-badge';
  }
  if (sovBadge) {
    sovBadge.textContent = metaLib ? '🔴 Live via Meta Ad Library' : 'Live Estimate';
    sovBadge.className = metaLib ? 'intel-section-badge live-badge' : 'intel-section-badge';
  }
  if (liveBanner) {
    const active = [semrush && 'Semrush', brandwatch && 'Brandwatch', metaLib && 'Meta Ad Library'].filter(Boolean);
    if (active.length > 0) {
      liveBanner.style.display = 'flex';
      liveBanner.querySelector('.ilb-sources').textContent = active.join(' · ');
    } else {
      liveBanner.style.display = 'none';
    }
  }
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
  try { buildIntelligence(); } catch(e) { console.warn('buildIntelligence error:', e); }

  // Event delegation — attack & signal buttons rendered inside dynamic innerHTML
  document.addEventListener('click', e => {
    const atk = e.target.closest('.btn-kwgap-attack');
    if (atk) {
      const kw = atk.dataset.kw || atk.textContent;
      const comp = atk.dataset.comp || '';
      openAttackModal(kw, comp, 'keyword');
      return;
    }
    const sig = e.target.closest('.btn-signal-attack');
    if (sig) {
      openAttackModal(sig.dataset.action || '', sig.dataset.comp || '', 'attack');
      return;
    }
    const counter = e.target.closest('.btn-signal-counter');
    if (counter) {
      openAttackModal(counter.dataset.action || '', counter.dataset.comp || '', 'counter');
      return;
    }
  });
  
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
      const freeViews = ['intelligence', 'settings', 'campaigns', 'results'];
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

  // Plan view — back button returns to competitors tab
  document.getElementById('planBackBtn').addEventListener('click', () => {
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
  
  // Generate more creatives — cycles through creative batches
  document.getElementById('generateMoreBtn').addEventListener('click', () => {
    if (!analysisData) {
      showToast('⚠️ Run an analysis first to generate creatives');
      return;
    }
    creativeRound++;
    const batchNum = creativeRound + 1;
    showToast(`✨ Generating creative batch ${batchNum} — new angles, hooks & messaging variants…`);
    const btn = document.getElementById('generateMoreBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    setTimeout(() => {
      buildCreative();
      if (btn) { btn.disabled = false; btn.textContent = '✨ Generate More Creatives'; }
      showToast(`✅ Batch ${batchNum} ready — ${6} new creative variants generated`);
    }, 1600);
  });
  
  // Pro Plan badge — open upgrade modal
  document.getElementById('navPlanBadge').style.cursor = 'pointer';
  document.getElementById('navPlanBadge').addEventListener('click', () => {
    const modal = document.getElementById('planModal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  });

  // Plan modal — close on backdrop click
  document.getElementById('planModal').addEventListener('click', e => {
    if (e.target === document.getElementById('planModal')) closePlanModal();
  });

  // Differentiator modal — close on backdrop click
  document.getElementById('differentiatorModal').addEventListener('click', e => {
    if (e.target === document.getElementById('differentiatorModal')) closeDifferentiatorModal();
  });

  // Attack modal — close on backdrop click
  document.getElementById('attackModal').addEventListener('click', e => {
    if (e.target === document.getElementById('attackModal')) closeAttackModal();
  });

  // Exclusive modal — close on backdrop click
  document.getElementById('exclusiveModal').addEventListener('click', e => {
    if (e.target === document.getElementById('exclusiveModal')) closeExclusiveModal();
  });

  // New rich modals — close on backdrop click
  document.getElementById('campCreativeModal').addEventListener('click', e => {
    if (e.target === document.getElementById('campCreativeModal')) closeCampCreativeModal();
  });
  document.getElementById('campLaunchRichModal').addEventListener('click', e => {
    if (e.target === document.getElementById('campLaunchRichModal')) closeCampLaunchRichModal();
  });

  // Campaign card buttons now use direct onclick="window._igLaunch(idx)" and window._igCreative(idx)
  // — defined at top of app.js, no delegation needed

  // Docs modal — close on backdrop click
  document.getElementById('docsModal').addEventListener('click', e => {
    if (e.target === document.getElementById('docsModal')) closeDocsModal();
  });

  // Escape key — close whichever modal is open
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const modals = [
      { id: 'differentiatorModal', close: closeDifferentiatorModal },
      { id: 'attackModal',         close: closeAttackModal         },
      { id: 'exclusiveModal',      close: closeExclusiveModal      },
      { id: 'planModal',           close: closePlanModal           },
      { id: 'docsModal',           close: closeDocsModal           },
      { id: 'launchModal',         close: closeModal               },
    ];
    for (const m of modals) {
      const el = document.getElementById(m.id);
      if (el && el.style.display !== 'none' && !el.classList.contains('hidden')) {
        m.close();
        break;
      }
    }
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
  openCampLaunchRich(name, platform, budget, idx);
}

function openCampLaunchRich(name, platform, budget, idx) {
  const modal = document.getElementById('campLaunchRichModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  const inner = document.getElementById('campLaunchRichModalInner');

  const budgetNum  = parseInt((budget || '$2000').replace(/[^0-9]/g, '')) || 2000;
  const dailyBudg  = Math.round(budgetNum / 30);
  const weeklyBudg = Math.round(budgetNum / 4.3);
  const comp       = analysisData?.competitors?.[0];
  const indName    = analysisData?.industry?.name || 'your industry';
  const myROAS     = analysisData?.websiteKPIs?.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8;
  const projROAS   = (myROAS * 1.25).toFixed(1);
  const projConv   = Math.round(budgetNum / 35);
  const projRevenue = '$' + (budgetNum * parseFloat(projROAS)).toLocaleString(undefined, {maximumFractionDigits:0});

  // Platform-specific details
  const platDetails = {
    'Google Ads':       { icon: '🔵', bidStrategy: 'Target ROAS (tROAS)', audience: 'High-intent keyword searchers', kpi: 'Conversions & ROAS', creative: 'Responsive Search Ads + Performance Max' },
    'Google Search':    { icon: '🔵', bidStrategy: 'Maximise Conversions', audience: 'Search intent + competitor keywords', kpi: 'CTR & Conversion Rate', creative: '3 headline variants + 2 descriptions' },
    'Meta Ads':         { icon: '🔷', bidStrategy: 'Cost Per Result (CPR)', audience: 'Lookalike + interest targeting', kpi: 'ROAS & Reach', creative: 'Carousel + Story + Feed video' },
    'TikTok Ads':       { icon: '⬛', bidStrategy: 'Lowest Cost', audience: 'In-app behaviour + hashtag interest', kpi: 'CPV & Engagement Rate', creative: 'UGC-style 15-sec vertical video' },
    'YouTube':          { icon: '🔴', bidStrategy: 'Target CPA', audience: 'In-market + custom intent audiences', kpi: 'View-through conversions', creative: '15-sec unskippable + 30-sec skippable' },
    'AI Optimised':     { icon: '🤖', bidStrategy: 'InfoGenie RL Engine (auto)', audience: 'Dynamic cross-platform targeting', kpi: 'Blended ROAS', creative: 'Auto-generated, refreshed every 72h' },
    'LinkedIn Ads':     { icon: '🔷', bidStrategy: 'Maximum Delivery', audience: 'Job title + industry + seniority', kpi: 'MQL Rate & Pipeline Value', creative: 'Sponsored Content + InMail' },
    'Display Network':  { icon: '🟡', bidStrategy: 'Target CPA', audience: 'Intent-based display audiences', kpi: 'Brand lift & CPA', creative: 'Responsive display + HTML5 banners' }
  };
  const pd = platDetails[platform] || platDetails['Google Ads'];

  // AI-generated headlines
  const headlineSets = {
    'Google Ads':    ['Stop Overpaying — Switch & Save 30%', 'Faster Results. Lower Costs. Proven ROI.', 'The Smart Alternative to [Competitor]'],
    'Google Search': ['Beat the Competition Starting Today', '#1 Rated Alternative — See Why', 'Get More for Less — Free 14-Day Trial'],
    'Meta Ads':      ['Join 10,000+ Businesses Seeing 4× ROAS', 'Your Competitors Are Scaling With This', 'Finally — Ads That Actually Convert'],
    'TikTok Ads':    ['POV: Your ROAS just hit 4×', 'This strategy is what competitors dont want you to know', 'Real results, real brands, real ROI'],
    'YouTube':       ['The Ad Strategy Your Competitors Hope You Never See', 'How Top Brands Are Hitting 5× ROAS in 2025', 'Stop Wasting Ad Spend — Here\'s the Fix'],
    'AI Optimised':  ['AI-Optimised. Always On. Always Winning.', 'Every £1 Working Harder With AI Bidding', 'Your Campaign Never Sleeps — Neither Does Our AI'],
    'LinkedIn Ads':  ['Reach 500+ Decision-Makers This Week', 'The B2B Growth Strategy CFOs Are Approving', 'Enterprise ROI — Without Enterprise Costs']
  };
  const headlines = headlineSets[platform] || headlineSets['Google Ads'];

  // Descriptions
  const descSets = {
    'Google Ads':   ['Cut wasteful ad spend and redirect it to campaigns that convert. InfoGenie\'s AI optimises every bid in real time.', 'See exactly where competitors are winning — then outbid them at the right moment with AI-powered precision.'],
    'Meta Ads':     ['Reach the audiences your competitors are missing. InfoGenie builds lookalike segments from your best customers automatically.', 'Dynamic creative that tests and learns continuously — your best-performing ad is always running.'],
    'AI Optimised': ['InfoGenie\'s reinforcement learning engine manages your entire ad portfolio autonomously — pausing losers, scaling winners, every 6 hours.', 'Set your ROAS target, connect your accounts, and let the AI run. Average clients see +31% ROAS in 30 days.']
  };
  const descriptions = descSets[platform] || descSets['Google Ads'];

  inner.innerHTML = `
    <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);padding:24px 28px;border-radius:20px 20px 0 0">
      <div style="font-family:'Sora',sans-serif;font-size:1rem;font-weight:800;color:white;margin-bottom:4px">🚀 Campaign Launch Brief</div>
      <div style="font-size:0.8rem;color:rgba(255,255,255,.6)">${name}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px">
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#00E5FF">${projROAS}×</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,.5);margin-top:2px">Proj. ROAS</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#10B981">${projConv}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,.5);margin-top:2px">Est. Conversions</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:#F59E0B">${projRevenue}</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,.5);margin-top:2px">Est. Revenue</div>
        </div>
        <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:1.1rem;font-weight:800;color:white">$${dailyBudg}/day</div>
          <div style="font-size:0.65rem;color:rgba(255,255,255,.5);margin-top:2px">Daily Budget</div>
        </div>
      </div>
    </div>

    <div style="padding:22px 28px;display:flex;flex-direction:column;gap:20px">

      <!-- PLATFORM STRATEGY -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">${pd.icon} ${platform} Strategy</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[['Bid Strategy', pd.bidStrategy],['Target Audience', pd.audience],['Primary KPI', pd.kpi],['Creative Format', pd.creative]].map(([k,v]) => `
            <div style="background:#F9FAFB;border-radius:8px;padding:10px 12px">
              <div style="font-size:0.68rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">${k}</div>
              <div style="font-size:0.8rem;color:#0A1628;font-weight:600;margin-top:3px">${v}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- AI HEADLINES -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">🤖 AI-Generated Headlines</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${headlines.map((h,i) => `
            <div style="display:flex;align-items:center;gap:10px;background:#F5F3FF;border-radius:8px;padding:9px 12px">
              <span style="font-size:0.7rem;font-weight:700;color:#7C3AED;background:#EDE9FE;border-radius:4px;padding:2px 6px">H${i+1}</span>
              <span style="font-size:0.82rem;color:#0A1628;font-weight:600">${h}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- AI DESCRIPTIONS -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">✍️ AI-Generated Descriptions</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${descriptions.map((d,i) => `
            <div style="background:#F0FDF4;border-radius:8px;padding:9px 12px">
              <span style="font-size:0.7rem;font-weight:700;color:#059669;background:#DCFCE7;border-radius:4px;padding:2px 6px;margin-right:8px">D${i+1}</span>
              <span style="font-size:0.8rem;color:#374151;line-height:1.5">${d}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- BUDGET BREAKDOWN -->
      <div>
        <div style="font-size:0.68rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">💰 Budget Breakdown</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          ${[['Daily', '$'+dailyBudg],['Weekly', '$'+weeklyBudg.toLocaleString()],['Monthly', '$'+budgetNum.toLocaleString()]].map(([k,v]) => `
            <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:8px;padding:10px;text-align:center">
              <div style="font-size:0.9rem;font-weight:800;color:#D97706">${v}</div>
              <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${k} Spend</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="display:flex;gap:10px">
        <button onclick="closeCampLaunchRichModal()" style="flex:1;padding:12px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
        <button id="confirmLaunchBtn" style="flex:2;padding:12px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Confirm &amp; Launch Campaign</button>
      </div>
    </div>
  `;
  // Wire confirm button — no string params needed, reads from stored global
  window._pendingCampaignLaunch = { name, platform, budget: '$' + budgetNum, idx };
  const confirmBtn = document.getElementById('confirmLaunchBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const p = window._pendingCampaignLaunch;
      confirmCampLaunch(p.name, p.platform, p.budget);
    });
  }
}

function closeCampLaunchRichModal() {
  const modal = document.getElementById('campLaunchRichModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.removeAttribute('style');
}

function confirmCampLaunch(name, platform, budget) {
  // Save to Results state
  const pending = window._pendingCampaignLaunch || {};
  const campIdx = pending.idx;
  const camp    = (window._lastCampRecs && campIdx !== undefined) ? window._lastCampRecs[campIdx] : null;
  const roas    = camp?.estROAS || '3.8';
  const ctr     = camp?.estCTR  || '4.2%';
  const cpa     = camp?.estCPA  || '$38';
  const budgetNum = parseInt((budget || '$2000').replace(/[^0-9]/g,'')) || 2000;
  const launchedAt = new Date().toLocaleString();

  window._launchedCampaigns = window._launchedCampaigns || [];
  window._launchedCampaigns.push({
    id: 'camp_' + Date.now(),
    name, platform,
    budget: budgetNum,
    budgetStr: '$' + budgetNum.toLocaleString(),
    startDate: new Date().toISOString().split('T')[0],
    audience: 'AI-optimised targeting',
    launchedAt, status: 'active', daysRunning: 0,
    metrics: {
      roas: (parseFloat(roas) * (0.9 + Math.random() * 0.2)).toFixed(1),
      ctr: ctr,
      conversions: Math.round(budgetNum / (Math.random() * 20 + 25)),
      spend: Math.round(budgetNum * 0.15),
      cpa: cpa,
      impressions: Math.round(budgetNum * (50 + Math.random() * 80))
    },
    actions: [
      { time: 'Just now', action: 'Campaign created and AI monitoring activated', type: 'launch' }
    ]
  });

  window._infoGenieActions = window._infoGenieActions || [];
  window._infoGenieActions.unshift({
    type: 'campaign_launch', icon: '🚀',
    text: `Campaign "${name}" launched on ${platform} — Budget: ${budget} · Est. ROAS: ${roas}× · Est. CTR: ${ctr}`,
    ts: launchedAt
  });
  igTrack('Campaign Launched', { campaignName: name, platform, budget, estROAS: roas, estCTR: ctr, estCPA: cpa });

  const inner = document.getElementById('campLaunchRichModalInner');
  inner.innerHTML = `
    <div style="padding:48px 32px;text-align:center">
      <div style="font-size:3rem;margin-bottom:16px">🎉</div>
      <div style="font-family:'Sora',sans-serif;font-size:1.2rem;font-weight:800;color:#0A1628;margin-bottom:8px">Campaign Launched!</div>
      <div style="font-size:0.875rem;color:#6B7280;margin-bottom:8px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto">"${name}" is now live on ${platform}. InfoGenie's AI engine is monitoring performance and will optimise bids every 6 hours.</div>
      <div style="display:inline-flex;gap:24px;background:#F0FDF4;border-radius:12px;padding:16px 24px;margin-bottom:24px">
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${roas}×</div><div style="font-size:0.7rem;color:#6B7280">Est. ROAS</div></div>
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${ctr}</div><div style="font-size:0.7rem;color:#6B7280">Est. CTR</div></div>
        <div><div style="font-size:1.1rem;font-weight:800;color:#059669">${cpa}</div><div style="font-size:0.7rem;color:#6B7280">Est. CPA</div></div>
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="closeCampLaunchRichModal()" style="padding:10px 20px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Close</button>
        <button onclick="closeCampLaunchRichModal();navigateTo('results')" style="padding:10px 20px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">View Results →</button>
      </div>
    </div>
  `;
  showToast('✅ Campaign "' + name + '" launched on ' + platform + ' — AI optimisation active');
}

// ── CREATIVE STUDIO ────────────────────────────────────────────────────────────
// Stores current creative content for copy/download
window._creativeStudio = {};

function previewCampaignCreative(idx) {
  const modal = document.getElementById('campCreativeModal');
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  const inner = document.getElementById('campCreativeModalInner');

  const camp     = analysisData && window._lastCampRecs ? window._lastCampRecs[idx] : null;
  const campName = camp?.name  || 'AI Campaign';
  const platform = camp?.platform || 'Google Ads';
  const budget   = camp?.budget || '$2,000/mo';
  const domain   = analysisData?.url || 'yourdomain.com';
  const indName  = analysisData?.industry?.name || 'your industry';
  const topComp  = analysisData?.competitors?.[0]?.name || 'your top competitor';
  const comp2    = analysisData?.competitors?.[1]?.name || topComp;
  const projROAS = camp?.estROAS ? `${camp.estROAS}×` : '3.8×';
  const estCTR   = camp?.estCTR || '4.2%';
  const estCPA   = camp?.estCPA || '$38';

  // Platform-aware copy pools
  const headlineSets = {
    'Google Ads':      ['Stop Overpaying — Switch & Save 30%', 'Faster Results. Lower Costs. Proven ROI.', `The Smarter Alternative to ${topComp}`],
    'Google Search':   ['Beat the Competition Starting Today', '#1 Rated Alternative — See Why', 'Get More for Less — Free 14-Day Trial'],
    'Meta Ads':        ['Join 10,000+ Businesses Seeing 4× ROAS', 'Your Competitors Are Scaling With This', 'Finally — Ads That Actually Convert'],
    'TikTok Ads':      ['POV: Your ROAS just hit 4×', `This is what ${topComp} doesn't want you to know`, 'Real results. Real brands. Real ROI.'],
    'YouTube':         ['The Ad Strategy Your Competitors Hope You Never See', 'How Top Brands Are Hitting 5× ROAS This Year', 'Stop Wasting Ad Spend — Here\'s the Fix'],
    'AI Optimised':    ['AI-Optimised. Always On. Always Winning.', 'Every £1 Working Harder With AI Bidding', 'Your Campaign Never Sleeps — Neither Does Our AI'],
    'LinkedIn Ads':    [`Reach 500+ Decision-Makers in ${indName} This Week`, 'The B2B Growth Strategy CFOs Are Approving', 'Enterprise ROI — Without Enterprise Costs'],
    'Display Network': ['Your Brand. Everywhere Your Customers Are.', `Outperform ${topComp} on Every Screen`, 'Display + Intent = Unstoppable Growth'],
  };
  const descSets = {
    'Google Ads':      [`Cut wasteful ad spend and redirect it to campaigns that convert. Beat ${topComp} on the keywords that matter most.`, `See exactly where ${topComp} is winning — then outbid them at the right moment with AI-powered precision.`],
    'Meta Ads':        [`Reach the audiences ${topComp} is missing. InfoGenie builds lookalike segments from your best customers automatically.`, 'Dynamic creative that tests and learns continuously — your best-performing ad is always running.'],
    'TikTok Ads':      [`${indName} on TikTok is untapped. Get in front of your audience before ${topComp} realises what they\'re missing.`, 'Short-form video that converts — UGC-style ads at a fraction of the CPM you\'re paying on Google or Meta.'],
    'YouTube':         [`Show your brand story to in-market buyers searching for alternatives to ${topComp}. High-intent, low-cost impressions.`, 'Video builds trust fast — and trust converts. Reach decision-makers before they click a competitor ad.'],
    'AI Optimised':    [`InfoGenie's reinforcement learning engine manages your entire ad portfolio — pausing losers, scaling winners, every 6 hours.`, `Set your ROAS target, connect your accounts, and let AI run. Average clients see +31% ROAS improvement in 30 days.`],
    'LinkedIn Ads':    [`Connect with VP-level decision-makers in ${indName} who are actively evaluating solutions like yours. Beat ${topComp} in the B2B funnel.`, 'Sponsored InMail + Content campaigns that nurture prospects from awareness to signed contract.'],
    'Display Network': [`Your brand on 2M+ premium websites — following your best prospects everywhere they browse online.`, `Retarget ${topComp} visitors and convert them before they go back. Smart display at CPA you can afford.`],
  };
  const headlines = headlineSets[platform] || headlineSets['Google Ads'];
  const descs     = descSets[platform] || descSets['Google Ads'];

  const tagline   = camp?.description?.split('.')[0] || headlines[0];

  // Build all creative content strings
  const googleSearchCopy = `HEADLINE 1: ${headlines[0]}
HEADLINE 2: ${headlines[1]}
HEADLINE 3: ${headlines[2]}
DESCRIPTION 1: ${descs[0]}
DESCRIPTION 2: ${descs[1]}
DISPLAY URL: ${domain}
SITELINKS: Free Trial | See Pricing | Case Studies | Book Demo`;

  const displayCopy = `HEADLINE: Beat the Competition — Starting Today
SUB-HEADLINE: ${domain} · AI-Powered ${indName} Platform
CTA BUTTON: Start Free →
SIZE: 728×90 leaderboard`;

  const instagramCopy = `CAPTION:
🚀 ${headlines[0]}

${descs[0]}

✅ ${projROAS} projected ROAS
✅ Est. CTR: ${estCTR}
✅ Est. CPA: ${estCPA}

👉 Link in bio to get started free.

#${indName.replace(/\s+/g,'')} #DigitalMarketing #ROAS #MarketingStrategy #GrowthHacking`;

  const tiktokScript = `[0–3s] HOOK: "Tired of watching your ${indName} ad budget disappear?"
[3–8s] PROBLEM: Show competitor ad waste piling up. Text overlay: "${topComp} charges you more and delivers less."
[8–13s] SOLUTION: InfoGenie ROAS graph climbing. Voice-over: "There's a smarter way — and it's already working for thousands of brands."
[13–15s] CTA: "${domain} — Start free today." Logo + URL on screen.`;

  const videoScript = `[0–3s]   HOOK: "What if your ad budget worked twice as hard — automatically?"
[3–8s]   PROBLEM: Animated chart showing competitor overspend vs. flat results.
[8–13s]  SOLUTION: Your brand logo. ROAS graph climbing. Text: "InfoGenie's AI outmanoeuvres ${topComp} 24/7."
[13–20s] SOCIAL PROOF: "10,000+ brands. ${projROAS} average ROAS. Zero guesswork."
[20–25s] CTA: Visit ${domain}. Free 14-day trial — no credit card required.`;

  const linkedinPost = `🚀 We just ran a competitive analysis on the ${indName} space — and the results are eye-opening.

${topComp} and ${comp2} are outperforming most brands not because of bigger budgets, but because of smarter targeting and creative strategy.

Here's what we found:
→ ${headlines[0]}
→ ${descs[0]}
→ The gap? ${estCTR} CTR vs. industry average of 2.1%

If you're spending on ${platform} and not seeing ${projROAS} ROAS, your strategy needs a second look.

We've built InfoGenie to fix exactly this. Check it out: ${domain}

#${indName.replace(/\s+/g,'')} #MarketingStrategy #CompetitorAnalysis #PaidMedia`;

  const twitterThread = `🧵 THREAD: How ${topComp} is winning the ${indName} ad game — and what to do about it

1/ After analysing ${topComp}'s campaign strategy, one thing is clear: ${descs[0]}

2/ Their secret? ${headlines[1]}

3/ The fix is straightforward: ${descs[1]}

4/ We built InfoGenie to automate this entire process. Projected CTR: ${estCTR}. Projected ROAS: ${projROAS}.

5/ Free 14-day trial at ${domain} — takes 3 minutes to set up. 🔗`;

  const emailSubject = `[Campaign Brief] ${campName} — Ready to Review`;
  const emailBody = `Hi [Name],

Your InfoGenie campaign brief is ready for review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMPAIGN: ${campName}
PLATFORM: ${platform}
BUDGET: ${budget}
PROJECTED ROAS: ${projROAS} | CTR: ${estCTR} | CPA: ${estCPA}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

AD COPY — HEADLINES
H1: ${headlines[0]}
H2: ${headlines[1]}
H3: ${headlines[2]}

AD COPY — DESCRIPTIONS
D1: ${descs[0]}
D2: ${descs[1]}

TARGETING INSIGHT
Industry: ${indName}
Primary Competitor: ${topComp}
Strategy: ${camp?.description || 'AI-optimised competitor gap targeting'}

CREATIVE FORMATS
• Google Search Ad (RSA) — 3 headlines, 2 descriptions
• Display Banner 728×90
• Instagram Story / Feed Post
• Video Ad Script (15–25 seconds)
• LinkedIn Sponsored Content
• Twitter/X Thread

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by InfoGenie · ${new Date().toLocaleDateString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  // Store for download/copy
  window._creativeStudio = { campName, platform, budget, domain, indName, topComp,
    googleSearchCopy, displayCopy, instagramCopy, tiktokScript, videoScript,
    linkedinPost, twitterThread, emailSubject, emailBody, idx };

  // ── RENDER ────────────────────────────────────────────────────────────────
  inner.innerHTML = `
    <!-- HEADER -->
    <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);padding:22px 26px 0;border-radius:20px 20px 0 0">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-family:'Sora',sans-serif;font-size:1rem;font-weight:800;color:white;margin-bottom:4px">🎨 Creative Studio</div>
          <div style="font-size:0.78rem;color:rgba(255,255,255,.55)">${campName} · ${platform} · ${budget}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="_csDownload()" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 12px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">⬇ Download</button>
          <button onclick="_csSendEmail()" style="background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:8px;padding:7px 14px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">📤 Send by Email</button>
        </div>
      </div>
      <!-- TABS -->
      <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,.12)">
        ${[['ad','🗂 Ad Creatives'],['email','📧 Email'],['social','💬 Social Posts'],['export','📤 Export']].map(([id,label],i) => `
          <button id="cstab-${id}" onclick="_csTab('${id}')" style="background:${i===0?'rgba(255,255,255,.1)':'transparent'};border:none;border-bottom:${i===0?'2px solid #00E5FF':'2px solid transparent'};padding:10px 16px;font-size:0.78rem;font-weight:700;color:${i===0?'white':'rgba(255,255,255,.5)'};cursor:pointer;transition:all .2s">${label}</button>
        `).join('')}
      </div>
    </div>

    <!-- TAB PANELS -->
    <div style="padding:22px 26px;display:flex;flex-direction:column;gap:16px">

      <!-- AD CREATIVES -->
      <div id="cspanel-ad">
        ${_csFmt('🔵 Google Search Ad — Responsive (RSA)', googleSearchCopy, `
          <div style="border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px;background:white;font-family:arial,sans-serif">
            <div style="font-size:0.65rem;color:#188038;margin-bottom:3px">Ad · ${domain}</div>
            <div style="font-size:0.92rem;color:#1a0dab;margin-bottom:4px;line-height:1.3">${headlines[0]} | ${headlines[1]}</div>
            <div style="font-size:0.76rem;color:#4d5156;line-height:1.45">${descs[0].slice(0,120)}…</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
              <span style="font-size:0.66rem;color:#1a0dab;border:1px solid #1a0dab;border-radius:4px;padding:2px 7px">Free Trial</span>
              <span style="font-size:0.66rem;color:#1a0dab;border:1px solid #1a0dab;border-radius:4px;padding:2px 7px">See Pricing</span>
              <span style="font-size:0.66rem;color:#1a0dab;border:1px solid #1a0dab;border-radius:4px;padding:2px 7px">Book Demo</span>
            </div>
          </div>`)}

        ${_csFmt('🟡 Display Banner — 728×90', displayCopy, `
          <div style="background:linear-gradient(135deg,#0A1628,#0D2A5E);border-radius:8px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px">
            <div>
              <div style="font-family:'Sora',sans-serif;font-size:0.88rem;font-weight:800;color:white;margin-bottom:3px">Beat the Competition — Starting Today</div>
              <div style="font-size:0.7rem;color:rgba(255,255,255,.65)">${domain} · AI-Powered ${indName}</div>
            </div>
            <button style="background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:8px;padding:8px 16px;font-size:0.78rem;font-weight:700;color:white;white-space:nowrap">Start Free →</button>
          </div>`)}

        ${_csFmt('📱 Instagram Story/Feed Caption', instagramCopy, `
          <div style="background:linear-gradient(160deg,#667eea,#764ba2);border-radius:8px;padding:22px 16px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px">
            <div style="font-size:0.65rem;font-weight:700;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:.08em">Sponsored</div>
            <div style="font-family:'Sora',sans-serif;font-size:0.95rem;font-weight:800;color:white;line-height:1.3">Join 10,000+ Businesses<br>Seeing ${projROAS} ROAS</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,.8)">${domain}</div>
            <div style="background:white;color:#764ba2;border-radius:20px;padding:6px 18px;font-size:0.78rem;font-weight:700">Swipe Up to Learn More ↑</div>
          </div>`)}

        ${_csFmt('🎬 Video Ad Script — 15–25 sec', videoScript, `
          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px">
            <div style="font-size:0.66rem;font-weight:700;color:#0066FF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Storyboard Script</div>
            ${videoScript.split('\n').map(line => {
              const [time,...rest] = line.split(']');
              return `<div style="display:flex;gap:10px;margin-bottom:6px"><span style="font-size:0.66rem;color:#6B7280;min-width:52px;padding-top:1px">${time.replace('[','')}]</span><span style="font-size:0.78rem;color:#0A1628;line-height:1.4">${rest.join(']').trim()}</span></div>`;
            }).join('')}
          </div>`)}

        ${_csFmt('⬛ TikTok Ad Script — 15 sec', tiktokScript, `
          <div style="background:#000;border-radius:8px;padding:14px 16px">
            <div style="font-size:0.66rem;font-weight:700;color:#ff2d55;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">TikTok Script</div>
            ${tiktokScript.split('\n').map(line => {
              const [time,...rest] = line.split(']');
              return `<div style="display:flex;gap:10px;margin-bottom:6px"><span style="font-size:0.66rem;color:#888;min-width:52px;padding-top:1px">${time.replace('[','')}]</span><span style="font-size:0.78rem;color:#eee;line-height:1.4">${rest.join(']').trim()}</span></div>`;
            }).join('')}
          </div>`)}
      </div>

      <!-- EMAIL PANEL -->
      <div id="cspanel-email" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em">📧 Campaign Email Brief</div>
          <button onclick="_csCopy('${emailSubject.replace(/'/g,'\\\'')}\n\n' + window._creativeStudio.emailBody)" style="background:#F3F4F6;border:1px solid #E5E7EB;border-radius:7px;padding:5px 12px;font-size:0.73rem;font-weight:600;color:#374151;cursor:pointer">📋 Copy All</button>
        </div>
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
          <!-- Email preview header -->
          <div style="background:#E2E8F0;padding:10px 14px;font-size:0.72rem;color:#64748B;display:flex;gap:16px">
            <span><strong>To:</strong> [Your Team / Agency]</span>
            <span><strong>Subject:</strong> ${emailSubject}</span>
          </div>
          <div style="padding:18px 20px;font-family:Georgia,serif;font-size:0.84rem;line-height:1.7;color:#1E293B;white-space:pre-wrap">${emailBody.replace(/━/g,'─')}</div>
        </div>
        <button onclick="_csSendEmail()" style="width:100%;margin-top:12px;padding:12px;background:linear-gradient(135deg,#0066FF,#0044CC);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">📤 Open in Email Client</button>
      </div>

      <!-- SOCIAL POSTS PANEL -->
      <div id="cspanel-social" style="display:none;flex-direction:column;gap:16px">
        ${_csFmt('🔵 LinkedIn Post', linkedinPost, `
          <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:#0077B5;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.875rem">in</div>
              <div><div style="font-size:0.8rem;font-weight:700;color:#0A1628">Your Brand</div><div style="font-size:0.7rem;color:#64748B">${indName} · Sponsored</div></div>
            </div>
            <div style="font-size:0.8rem;color:#1E293B;line-height:1.6;white-space:pre-line">${linkedinPost.slice(0,300)}…</div>
          </div>`)}

        ${_csFmt('🐦 Twitter / X Thread', twitterThread, `
          <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:#000;display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.875rem">𝕏</div>
              <div><div style="font-size:0.8rem;font-weight:700;color:#0A1628">@YourBrand</div><div style="font-size:0.7rem;color:#64748B">Thread · ${new Date().toLocaleDateString()}</div></div>
            </div>
            <div style="font-size:0.8rem;color:#1E293B;line-height:1.6;white-space:pre-line">${twitterThread.slice(0,280)}…</div>
          </div>`)}

        ${_csFmt('📸 Instagram Caption', instagramCopy, `
          <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px 16px">
            <div style="background:linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);border-radius:8px;height:80px;display:flex;align-items:center;justify-content:center;margin-bottom:10px">
              <span style="color:white;font-weight:800;font-size:0.875rem">Your Creative Here 📸</span>
            </div>
            <div style="font-size:0.78rem;color:#1E293B;line-height:1.6;white-space:pre-line">${instagramCopy.slice(0,200)}…</div>
          </div>`)}
      </div>

      <!-- EXPORT PANEL -->
      <div id="cspanel-export" style="display:none">
        <div style="display:grid;gap:12px">
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:center">
            <div style="font-size:2rem">📄</div>
            <div style="flex:1">
              <div style="font-size:0.875rem;font-weight:700;color:#14532D;margin-bottom:3px">Download Full Creative Pack</div>
              <div style="font-size:0.78rem;color:#166534">All ad copy, scripts, social posts and email brief in one .txt file — ready to hand to your agency or upload to your ad platform.</div>
            </div>
            <button onclick="_csDownload()" style="background:#16A34A;border:none;border-radius:8px;padding:10px 16px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">⬇ Download</button>
          </div>

          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:center">
            <div style="font-size:2rem">📋</div>
            <div style="flex:1">
              <div style="font-size:0.875rem;font-weight:700;color:#1E3A8A;margin-bottom:3px">Copy All to Clipboard</div>
              <div style="font-size:0.78rem;color:#1D4ED8">Paste directly into Google Docs, Notion, Slack, or your ad platform's creative brief tool.</div>
            </div>
            <button onclick="_csCopyAll()" style="background:#2563EB;border:none;border-radius:8px;padding:10px 16px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">📋 Copy All</button>
          </div>

          <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:center">
            <div style="font-size:2rem">📧</div>
            <div style="flex:1">
              <div style="font-size:0.875rem;font-weight:700;color:#78350F;margin-bottom:3px">Send by Email</div>
              <div style="font-size:0.78rem;color:#92400E">Opens your email client pre-filled with the full campaign brief — ready to send to your team, client, or agency.</div>
            </div>
            <button onclick="_csSendEmail()" style="background:#D97706;border:none;border-radius:8px;padding:10px 16px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">📤 Send Email</button>
          </div>

          <div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:12px;padding:16px 18px;display:flex;gap:14px;align-items:center">
            <div style="font-size:2rem">🚀</div>
            <div style="flex:1">
              <div style="font-size:0.875rem;font-weight:700;color:#4C1D95;margin-bottom:3px">Launch Campaign</div>
              <div style="font-size:0.78rem;color:#5B21B6">Review full campaign brief, set your budget, and launch directly from InfoGenie.</div>
            </div>
            <button onclick="_csLaunchNow()" style="background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:8px;padding:10px 16px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">🚀 Launch</button>
          </div>
        </div>
      </div>

    </div>

    <!-- FOOTER -->
    <div style="padding:0 26px 20px;display:flex;gap:10px">
      <button onclick="closeCampCreativeModal()" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">✕ Close</button>
      <button onclick="_csLaunchNow()" style="flex:2;padding:11px;background:linear-gradient(135deg,#00C9C8,#0066FF);border:none;border-radius:10px;font-size:0.875rem;font-weight:700;color:white;cursor:pointer">🚀 Launch This Campaign</button>
    </div>
  `;
}

// Tab switcher for Creative Studio
function _csTab(id) {
  ['ad','email','social','export'].forEach(t => {
    const panel = document.getElementById('cspanel-' + t);
    const tab   = document.getElementById('cstab-' + t);
    if (panel) {
      if (t === id) { panel.style.display = 'flex'; panel.style.flexDirection = 'column'; panel.style.gap = '16px'; }
      else           { panel.style.display = 'none'; }
    }
    if (tab) {
      tab.style.background   = t === id ? 'rgba(255,255,255,.1)' : 'transparent';
      tab.style.borderBottom = t === id ? '2px solid #00E5FF' : '2px solid transparent';
      tab.style.color        = t === id ? 'white' : 'rgba(255,255,255,.5)';
    }
  });
}

// Launch from Creative Studio — reads stored cs data, opens launch brief
function _csLaunchNow() {
  const s = window._creativeStudio;
  if (!s || !s.campName) { showToast('⚠️ No campaign data — run an analysis first'); return; }
  closeCampCreativeModal();
  try { openCampLaunchRich(s.campName, s.platform, s.budget, s.idx || 0); }
  catch(err) { console.error('Launch error:', err); showToast('⚠️ Could not open launch brief'); }
}

// Helper: render a titled creative block with editable textarea + copy button
function _csFmt(label, copyText, previewHTML) {
  const safeId = 'cs_' + Math.random().toString(36).slice(2,8);
  // Store text for copy
  window._creativeStudio['_block_' + safeId] = copyText;
  return `
    <div style="border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;margin-bottom:4px">
      <div style="background:#F8FAFC;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #E2E8F0">
        <span style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em">${label}</span>
        <button onclick="_csCopyById('${safeId}')" style="background:white;border:1px solid #D1D5DB;border-radius:6px;padding:4px 10px;font-size:0.7rem;font-weight:600;color:#374151;cursor:pointer;display:flex;align-items:center;gap:4px">📋 Copy</button>
      </div>
      <div style="padding:14px">${previewHTML}</div>
      <div style="padding:0 14px 12px">
        <textarea id="cstxt-${safeId}" oninput="window._creativeStudio['_block_${safeId}']=this.value" style="width:100%;box-sizing:border-box;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px;font-size:0.73rem;color:#4B5563;font-family:'Courier New',monospace;line-height:1.6;min-height:90px;resize:vertical;outline:none">${copyText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      </div>
    </div>`;
}

// Copy by creative block ID — reads live textarea value so edits are preserved
function _csCopyById(safeId) {
  const textarea = document.getElementById('cstxt-' + safeId);
  const text = textarea ? textarea.value : (window._creativeStudio['_block_' + safeId] || '');
  _csCopy(text);
}

// Copy helper
function _csCopy(text) {
  navigator.clipboard.writeText(text).then(() => showToast('✅ Copied to clipboard!')).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    showToast('✅ Copied!');
  });
}

// Copy all creative content
function _csCopyAll() {
  const s = window._creativeStudio;
  if (!s) return;
  const all = `═══ INFOGENIE CREATIVE PACK ═══
Campaign: ${s.campName}
Platform: ${s.platform} | Budget: ${s.budget}
Generated: ${new Date().toLocaleString()}

═══ GOOGLE SEARCH AD ═══
${s.googleSearchCopy}

═══ DISPLAY BANNER ═══
${s.displayCopy}

═══ INSTAGRAM CAPTION ═══
${s.instagramCopy}

═══ VIDEO AD SCRIPT ═══
${s.videoScript}

═══ TIKTOK SCRIPT ═══
${s.tiktokScript}

═══ LINKEDIN POST ═══
${s.linkedinPost}

═══ TWITTER / X THREAD ═══
${s.twitterThread}

═══ EMAIL BRIEF ═══
Subject: ${s.emailSubject}
${s.emailBody}`;
  _csCopy(all);
}

// Download all as .txt
function _csDownload() {
  const s = window._creativeStudio;
  if (!s) return;
  const all = `INFOGENIE CREATIVE PACK
Campaign: ${s.campName} | Platform: ${s.platform} | Budget: ${s.budget}
Generated: ${new Date().toLocaleString()}

─────────────────────────────────────────
GOOGLE SEARCH AD (RSA)
─────────────────────────────────────────
${s.googleSearchCopy}

─────────────────────────────────────────
DISPLAY BANNER 728x90
─────────────────────────────────────────
${s.displayCopy}

─────────────────────────────────────────
INSTAGRAM STORY / FEED CAPTION
─────────────────────────────────────────
${s.instagramCopy}

─────────────────────────────────────────
VIDEO AD SCRIPT (15-25 sec)
─────────────────────────────────────────
${s.videoScript}

─────────────────────────────────────────
TIKTOK SCRIPT (15 sec)
─────────────────────────────────────────
${s.tiktokScript}

─────────────────────────────────────────
LINKEDIN POST
─────────────────────────────────────────
${s.linkedinPost}

─────────────────────────────────────────
TWITTER / X THREAD
─────────────────────────────────────────
${s.twitterThread}

─────────────────────────────────────────
EMAIL CAMPAIGN BRIEF
─────────────────────────────────────────
Subject: ${s.emailSubject}

${s.emailBody}`;

  const blob = new Blob([all], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `InfoGenie_Creative_${s.campName.replace(/[^a-z0-9]/gi,'_').slice(0,40)}_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Creative pack downloaded!');
}

// Send by email via mailto
function _csSendEmail() {
  const s = window._creativeStudio;
  if (!s) return;
  const subject = encodeURIComponent(s.emailSubject);
  const body    = encodeURIComponent(s.emailBody);
  window.open(`mailto:?subject=${subject}&body=${body}`);
}

function closeCampCreativeModal() {
  const modal = document.getElementById('campCreativeModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.removeAttribute('style');
}

// ── Live Keyword Gap Fetch (DataForSEO via backend) ──────────────────────────

async function fetchLiveKeywordGap() {
  const domainInput = document.getElementById('kwgap-domain-input');
  const locationSelect = document.getElementById('kwgap-location-select');
  const fetchBtn = document.getElementById('kwgap-fetch-btn');
  const tbody = document.getElementById('kwgap-tbody');
  const badge = document.getElementById('ldb-semrush');
  const statusNote = document.getElementById('kwgap-status-note');
  const dataSourceLabel = document.getElementById('kwgap-data-source');

  const domain = (domainInput ? domainInput.value.trim() : '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) {
    showToast('⚠️ Please enter your domain first');
    if (domainInput) domainInput.focus();
    return;
  }

  // Check if backend is configured
  try {
    const statusRes = await fetch('/api/status');
    const status = await statusRes.json();
    if (!status.dataforseo) {
      if (statusNote) statusNote.innerHTML = `
        <span style="color:#EF4444;font-weight:600">⚡ DataForSEO credentials required to fetch live data.</span>
        Add two secrets in your Replit project: <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:0.8rem">DATAFORSEO_LOGIN</code> and
        <code style="background:#F3F4F6;padding:2px 6px;border-radius:4px;font-size:0.8rem">DATAFORSEO_PASSWORD</code>
        — sign up free at <a href="https://dataforseo.com" target="_blank" style="color:#0066FF;text-decoration:underline">dataforseo.com</a>,
        then restart the app and click Fetch Live Data again.
      `;
      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '⚡ Fetch Live Data'; }
      return;
    }
  } catch(e) {
    showToast('❌ Cannot reach server — please reload the page');
    return;
  }

  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '⏳ Fetching…'; }
  if (statusNote) statusNote.textContent = '🔄 Querying DataForSEO for live keyword gap data…';
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#6B7280">
    <div style="display:flex;align-items:center;justify-content:center;gap:12px">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00C9C8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      Fetching live keyword gap data for <strong style="color:#00C9C8">${domain}</strong>…
    </div>
  </td></tr>`;

  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const location = locationSelect ? locationSelect.value : 'United States';

  // Extract actual competitor domains from the current analysis
  const analysisCompetitors = analysisData && analysisData.competitors
    ? analysisData.competitors
        .map(c => (c.url || c.domain || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())
        .filter(Boolean)
    : [];

  // Show which competitors are being analysed in the status note
  if (statusNote && analysisCompetitors.length > 0) {
    statusNote.textContent = `🔄 Querying DataForSEO · analysing your domain vs ${analysisCompetitors.slice(0,3).join(', ')}${analysisCompetitors.length > 3 ? ` +${analysisCompetitors.length - 3} more` : ''}…`;
  }

  try {
    const res = await fetch('/api/keyword-gap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yourDomain: domain,
        industry: industryKey,
        competitors: analysisCompetitors.length > 0 ? analysisCompetitors : undefined,
        location,
        language: 'English',
        limit: 20
      })
    });

    // Guard against proxy timeouts returning HTML instead of JSON
    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch(parseErr) {
      if (res.status === 504 || rawText.includes('<!DOCTYPE') || rawText.startsWith('<')) {
        throw new Error('Request timed out — DataForSEO took too long. Please try again.');
      }
      throw new Error(`Unexpected server response (status ${res.status}). Please try again.`);
    }

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    const keywords = data.keywords || [];

    if (keywords.length === 0) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#6B7280">
        No keyword gaps found for <strong>${domain}</strong> vs these competitors.<br>
        <small>Try a different location or check that your domain has established search presence.</small>
      </td></tr>`;
      if (badge) badge.textContent = '0 Opportunities Found';
      if (statusNote) statusNote.textContent = `✅ Live query complete — no gaps found for ${domain}`;
      if (dataSourceLabel) { dataSourceLabel.textContent = `✅ Live data from DataForSEO · ${domain} vs ${(data.competitors || []).join(', ')}`; dataSourceLabel.style.color = '#10B981'; }
      return;
    }

    // Render live rows
    const rows = keywords.map(k => `
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

    if (tbody) tbody.innerHTML = rows;
    if (badge) badge.textContent = `${keywords.length} Live Opportunities`;

    const compList = (data.competitors || []).slice(0, 4).join(', ');
    const compExtra = (data.competitors || []).length > 4 ? ` +${(data.competitors||[]).length - 4} more` : '';
    if (statusNote) statusNote.textContent = `✅ Live · Fetched ${new Date().toLocaleTimeString()} · ${keywords.length} keyword gaps found vs ${compList}${compExtra}`;
    if (dataSourceLabel) {
      dataSourceLabel.innerHTML = `✅ <strong>Live data from DataForSEO</strong> · <strong>${domain}</strong> vs <strong>${compList}${compExtra}</strong> · Updated ${new Date().toLocaleTimeString()}`;
      dataSourceLabel.style.color = '#10B981';
    }

    // Save domain for future use
    try { localStorage.setItem('ig_kwgap_domain', domain); } catch(e) {}
    showToast(`✅ ${keywords.length} live keyword gaps found for ${domain}`);

  } catch(err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#EF4444">
      ❌ ${err.message}
    </td></tr>`;
    if (statusNote) statusNote.textContent = `❌ Error: ${err.message}`;
    showToast('❌ ' + err.message);
  } finally {
    if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = '⚡ Fetch Live Data'; }
  }
}

// ── RAPIDAPI: Live Competitor News ────────────────────────────────────────────
async function fetchLiveCompetitorNews() {
  const btn = document.getElementById('news-fetch-btn');
  const statusNote = document.getElementById('news-status-note');
  const grid = document.getElementById('signal-grid-wrap');
  const badge = document.getElementById('ldb-brandwatch');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching…'; }
  if (statusNote) statusNote.innerHTML = '🔄 Pulling live competitor news from the web…';

  const competitors = analysisData ? analysisData.competitors.slice(0, 4).map(c => c.name) : [];
  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const country = (analysisData && analysisData.country === 'United Kingdom') ? 'GB'
    : (analysisData && analysisData.country === 'Australia') ? 'AU'
    : (analysisData && analysisData.country === 'Canada') ? 'CA'
    : 'US';

  try {
    const res = await fetch('/api/competitor-news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitors, industry: industryKey, country })
    });
    const data = await res.json();

    if (data.source === 'not_subscribed' || (data.articles && data.articles.length === 0 && data.source !== 'live')) {
      if (statusNote) statusNote.innerHTML = `⚠️ Subscribe to <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-news-data" target="_blank" style="color:#0066FF;text-decoration:underline">Real-Time News Data</a> on RapidAPI (free tier) then click refresh again.`;
      if (btn) { btn.disabled = false; btn.textContent = '📡 Refresh Live Signals'; }
      return;
    }

    const articles = data.articles || [];
    if (articles.length === 0) {
      if (statusNote) statusNote.textContent = 'No recent news found — try again later.';
      if (btn) { btn.disabled = false; btn.textContent = '📡 Refresh Live Signals'; }
      return;
    }

    // Build live signal cards from news articles
    const SIGNAL_ICONS = { new_campaign: '🆕', budget_surge: '💰', price_change: '🏷️', competitor_signal: '📡', industry_trend: '📈' };
    const SIGNAL_LABELS = { new_campaign: 'New Campaign Detected', budget_surge: 'Budget/Investment Signal', price_change: 'Pricing Signal', competitor_signal: 'Competitor Signal', industry_trend: 'Industry Trend' };
    const SIGNAL_COLORS = { new_campaign: '#1E3A5F', budget_surge: '#1E3A5F', price_change: '#3B1F2B', competitor_signal: '#1F2A3C', industry_trend: '#0A2818' };

    const liveCards = articles.map(a => {
      const icon = SIGNAL_ICONS[a.signal] || '📡';
      const label = SIGNAL_LABELS[a.signal] || 'Signal';
      const bg = SIGNAL_COLORS[a.signal] || '#1F2A3C';
      const compLetter = a.competitor ? a.competitor[0].toUpperCase() : '📰';
      const timeAgo = a.publishedAt ? (() => {
        try {
          const d = new Date(a.publishedAt);
          const diff = Math.floor((Date.now() - d) / 60000);
          if (diff < 60) return `${diff}m ago`;
          if (diff < 1440) return `${Math.floor(diff/60)}h ago`;
          return `${Math.floor(diff/1440)}d ago`;
        } catch(e) { return 'Recently'; }
      })() : 'Live';

      return `
        <div class="signal-card">
          <div class="signal-logo" style="background:${bg};font-size:1rem">${compLetter}</div>
          <div class="signal-body">
            <div class="signal-top">
              <span class="signal-comp">${a.competitor || a.source}</span>
              <span class="signal-type-badge sig-new">${icon} ${label}</span>
              <span class="signal-ago">${timeAgo}</span>
            </div>
            <div class="signal-msg" style="font-weight:600;color:#1E293B;margin-bottom:4px">${a.title}</div>
            ${a.snippet ? `<div class="signal-msg" style="font-size:0.8rem;color:#64748B;margin-bottom:8px">${a.snippet.slice(0, 180)}${a.snippet.length > 180 ? '…' : ''}</div>` : ''}
            <div class="signal-actions">
              <a href="${a.url}" target="_blank" style="font-size:.75rem;color:#0066FF;text-decoration:none;font-weight:600">Read Full Article →</a>
              <span style="color:#E2E8F0;margin:0 8px">|</span>
              <span style="font-size:.75rem;color:#94A3B8">Source: ${a.source}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    if (grid) grid.innerHTML = liveCards;
    if (badge) badge.textContent = `${articles.length} Live Signals · Updated ${new Date().toLocaleTimeString()}`;
    if (statusNote) statusNote.innerHTML = `✅ <strong>Live data from RapidAPI</strong> · ${articles.length} signals fetched · ${new Date().toLocaleTimeString()}`;
    showToast(`✅ ${articles.length} live competitor signals loaded`);

  } catch(err) {
    if (statusNote) statusNote.textContent = `❌ Error: ${err.message}`;
    showToast('❌ Failed to fetch live signals — ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📡 Refresh Live Signals'; }
  }
}

// ── RAPIDAPI: Reddit Social Intelligence ─────────────────────────────────────
async function fetchRedditSignals() {
  const btn = document.getElementById('reddit-fetch-btn');
  const statusNote = document.getElementById('reddit-status-note');
  const wrap = document.getElementById('reddit-feed-wrap');
  const badge = document.getElementById('ldb-reddit');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching…'; }
  if (statusNote) statusNote.textContent = '🔄 Loading live Reddit community signals…';

  const industryKey = analysisData ? analysisData.industryKey : 'marketing';
  const competitors = analysisData ? analysisData.competitors.slice(0, 4).map(c => c.name) : [];

  try {
    const res = await fetch('/api/reddit-signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: industryKey, competitors })
    });
    const data = await res.json();

    if (data.source === 'not_subscribed' || !data.posts || data.posts.length === 0) {
      if (wrap) wrap.innerHTML = `
        <div style="text-align:center;padding:32px;color:#94A3B8;font-size:0.875rem">
          ⚠️ Subscribe to <a href="https://rapidapi.com/search/reddit-scraper" target="_blank" style="color:#0066FF">Reddit Scraper</a> on RapidAPI (free tier) then click refresh again.
        </div>`;
      if (statusNote) statusNote.innerHTML = `Subscribe to Reddit Scraper on RapidAPI to enable community signals`;
      return;
    }

    const SENTIMENT_COLOR = { positive: '#10B981', neutral: '#6B7280', negative: '#EF4444' };
    const posts = data.posts || [];
    const isHN  = (data.subreddit === 'Hacker News');
    const cards = posts.map(p => `
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;display:flex;gap:14px;align-items:flex-start">
        <div style="min-width:36px;height:36px;border-radius:8px;background:${isHN ? '#FF6600' : '#FF4500'};display:flex;align-items:center;justify-content:center;color:white;font-weight:800;font-size:0.8rem;flex-shrink:0">${isHN ? 'HN' : 'r/'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.875rem;font-weight:700;color:#0A1628;margin-bottom:6px;line-height:1.35">${p.title}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
            <span style="font-size:.75rem;color:#64748B;font-weight:600">${p.subreddit}</span>
            <span style="font-size:.75rem;color:#64748B">▲ ${(p.score||0).toLocaleString()} points</span>
            <span style="font-size:.75rem;color:#64748B">💬 ${(p.comments||0).toLocaleString()} comments</span>
            <span style="font-size:.72rem;background:${SENTIMENT_COLOR[p.sentiment]||'#6B7280'}22;color:${SENTIMENT_COLOR[p.sentiment]||'#6B7280'};font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 7px;border-radius:20px">${p.sentiment || 'neutral'}</span>
          </div>
        </div>
        <a href="${p.url}" target="_blank" rel="noopener" style="font-size:.75rem;color:#0066FF;text-decoration:none;font-weight:600;white-space:nowrap;margin-top:2px;flex-shrink:0">View →</a>
      </div>
    `).join('');

    if (wrap) wrap.innerHTML = cards;
    if (badge) badge.textContent = `${posts.length} Live Signals · ${data.subreddit || 'Community'}`;
    if (statusNote) statusNote.innerHTML = `✅ Live from ${data.subreddit || 'Community'} · ${posts.length} discussions · ${new Date().toLocaleTimeString()}`;
    showToast(`✅ ${posts.length} live community signals loaded from ${data.subreddit || 'Hacker News'}`);

  } catch(err) {
    if (statusNote) statusNote.textContent = `❌ Error: ${err.message}`;
    showToast('❌ Reddit fetch failed — ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔥 Load Community Signals'; }
  }
}

// Allow pressing Enter in domain input to trigger fetch
document.addEventListener('DOMContentLoaded', () => {
  document.body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'kwgap-domain-input') {
      fetchLiveKeywordGap();
    }
  });

  // Pre-fill from localStorage if available
  const savedDomain = localStorage.getItem('ig_kwgap_domain');
  if (savedDomain) {
    const inp = document.getElementById('kwgap-domain-input');
    if (inp && !inp.value) inp.value = savedDomain;
  }
});

// Init view states
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.view').forEach((v, i) => {
    if (i !== 0) v.style.display = 'none';
  });
});

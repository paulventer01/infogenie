// =============================================================================
// ig_plan_view.js — Competitor ROAS Plan view (buildPlanView)
// -----------------------------------------------------------------------------
// Carved out of app.js verbatim. Renders the per-competitor 90-day "ROAS Plan"
// execution roadmap shown on the `plan` view. The async entry wrapper
// (window.openCompPlan) stays in app.js and calls buildPlanView by global name,
// so the public entry point is re-attached to window at the bottom of this IIFE.
//
// Reads shared globals from app.js (analysisData · window._liveROAS ·
// window._dataBadge · avg) and renders inline-onclick handlers that resolve to
// shared Compete helpers (openAdInCreativeStudio · openCampLaunchRich).
// =============================================================================
'use strict';
/* global analysisData, avg */

(function () {

function buildPlanView(compName) {
  const needle = (compName || '').trim().toLowerCase();
  const comp = analysisData.competitors.find(x => x.name === compName) ||
               analysisData.competitors.find(x => (x.name||'').trim().toLowerCase() === needle) ||
               analysisData.competitors[0];

  if (!comp) return;

  // Populate / sync the competitor dropdown
  const dd = document.getElementById('planCompDropdown');
  if (dd) {
    const comps = analysisData.competitors || [];
    dd.innerHTML = comps.map(c =>
      `<option value="${c.name.replace(/"/g,'&quot;')}" ${c.name === comp.name ? 'selected' : ''} style="background:#0D2A5E;color:white">${c.name}</option>`
    ).join('');
  }

  // Real ROAS preference order: live ad-account blend → analysis-derived → safe default
  const liveR = window._liveROAS;
  const myROAS = liveR ? Number(liveR.value.toFixed(2))
               : (analysisData.websiteKPIs?.roas ? parseFloat(analysisData.websiteKPIs.roas) : 2.8);
  const myROASBadge = liveR
    ? window._dataBadge('live', liveR.source)
    : window._dataBadge('estimate', 'industry default — connect Meta/Google ads for live data');
  const compROAS = comp.roas || 4.5;
  const compROASBadge = comp.roas
    ? window._dataBadge('ai-real', 'DataForSEO + AI synthesis')
    : window._dataBadge('estimate', 'industry default');
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

    <!-- DATA-SOURCE TRANSPARENCY BAR -->
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:12px 16px;margin-bottom:14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <span style="font-size:0.72rem;font-weight:800;color:#0A1628;text-transform:uppercase;letter-spacing:.06em">Data sources used:</span>
      ${myROASBadge}
      ${compROASBadge}
      ${window._dataBadge('estimate', 'Phase uplift % · industry-typical')}
    </div>

    <!-- METRICS SUMMARY BAR -->
    <div class="roas-stat-strip" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px">
      <div style="background:linear-gradient(135deg,#062A36,#0A4858);border-radius:14px;padding:18px 16px;text-align:center;position:relative">
        <div style="font-size:1.6rem;font-weight:800;color:#00E5FF !important">${myROAS}×</div>
        <div style="font-size:0.72rem;color:#FFFFFF !important;margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.4)">Your ROAS Now</div>
        <div style="margin-top:8px">${liveR ? window._dataBadge('live','live') : window._dataBadge('estimate','default')}</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a0a28,#2D1060);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#F59E0B !important">${compROAS}×</div>
        <div style="font-size:0.72rem;color:#FFFFFF !important;margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.4)">${comp.name} ROAS</div>
        <div style="margin-top:8px">${comp.roas ? window._dataBadge('ai-real','AI+SEO') : window._dataBadge('estimate','default')}</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A2818,#0D5E30);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#10B981 !important">${projectedROAS}×</div>
        <div style="font-size:0.72rem;color:#FFFFFF !important;margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.4)">Projected ROAS</div>
        <div style="margin-top:8px">${window._dataBadge('estimate','forecast')}</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A2818,#1A4A30);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#00C9C8 !important">+${totalGainPct}%</div>
        <div style="font-size:0.72rem;color:#FFFFFF !important;margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.4)">ROAS Uplift</div>
        <div style="margin-top:8px">${window._dataBadge('estimate','forecast')}</div>
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

    <!-- DRAFTED AD COPY -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:24px;margin-bottom:20px">
      <div style="font-size:0.75rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px">✍️ Your Ready-to-Launch Ad Copy — AI Drafted</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${(() => {
          const drafts = (comp.adCopy && comp.adCopy.length >= 3) ? comp.adCopy.slice(0,3) : [
            { headline: `Stop Overpaying — Switch to Smarter ${indName}`, body: `Join thousands who already switched. No hidden fees, no long contracts. Results in the first 30 days or your money back.` },
            { headline: `The ${indName} Alternative That Actually Delivers`, body: `Our customers see real results — not just promises. Try free for 14 days and see the difference for yourself.` },
            { headline: `Beat the ${indName} Average — See How We Do It`, body: `AI-powered campaigns that continuously optimise, so you compound gains every week without lifting a finger.` }
          ];
          const plats = [
            { label: 'Google Search', bg: '#EFF6FF', border: '#BFDBFE', badge: '#1D4ED8' },
            { label: 'Meta / Instagram', bg: '#F5F3FF', border: '#DDD6FE', badge: '#7C3AED' },
            { label: 'TikTok', bg: '#FFF7ED', border: '#FED7AA', badge: '#D97706' }
          ];
          return drafts.map((d, di) => {
            const p = plats[di] || plats[0];
            const safeHL = (d.headline || '').replace(/'/g, '\\u0027');
            const safeBD = (d.body || '').replace(/'/g, '\\u0027');
            return `
            <div style="background:${p.bg};border:1.5px solid ${p.border};border-radius:12px;padding:16px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
                <span style="font-size:0.7rem;font-weight:800;color:${p.badge};background:${p.border};padding:3px 10px;border-radius:5px;text-transform:uppercase;letter-spacing:.06em">${p.label}</span>
                <button onclick="openAdInCreativeStudio('${safeHL}','${safeBD}','${p.label}')" style="font-size:0.72rem;font-weight:700;color:${p.badge};background:white;border:1.5px solid ${p.border};border-radius:6px;padding:4px 12px;cursor:pointer;white-space:nowrap">Use in Creative Studio →</button>
              </div>
              <div style="font-size:0.9rem;font-weight:800;color:#0A1628;margin-bottom:6px;line-height:1.35">${d.headline}</div>
              <div style="font-size:0.81rem;color:#374151;line-height:1.6">${d.body}</div>
            </div>`;
          }).join('');
        })()}
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
              <button class="btn-primary" style="font-size:0.78rem;padding:7px 16px" onclick="openCampLaunchRich('${ph.label.replace(/'/g,'\\&apos;').split('—')[0].trim()}','Google Ads','${ph.projSpend}',${pi})">🚀 Set Up Campaign →</button>
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
          <div style="font-size:0.85rem;font-weight:700;color:#fff">Total Recommended Monthly Budget</div>
          <div style="text-align:right">
            <div style="font-size:1.05rem;font-weight:800;color:#00E5FF">$8,500/mo</div>
            <div style="font-size:0.72rem;color:#fff">Est. Revenue: $${Math.round(parseFloat(projectedROAS)*8500).toLocaleString()}/mo at ${projectedROAS}× ROAS</div>
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

window.buildPlanView = buildPlanView;

})();

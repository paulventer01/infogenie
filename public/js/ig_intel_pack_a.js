// =============================================================================
// ig_intel_pack_a.js — standalone integration & intel view-builders (pack A)
// -----------------------------------------------------------------------------
// Carved out of app.js verbatim. Holds independent standalone window.buildX
// view-builders that each render their own view from /api/ data and only read
// (never mutate) window.analysisData. Public entry points stay on window;
// feature-private helpers are scoped to this file's IIFE.
//
// Builders: buildHubspotSync · buildMetaInsights · buildKeywordExplorer ·
//   buildGoogleAdsInsights · buildTiktokAdsInsights · buildSocialPublisher ·
//   buildEmailPersonalizer · buildYoutubeMonitor · buildWeeklyReport ·
//   buildRedditPulse · buildAdLibrary · buildNewsletterTracker ·
//   buildMeetingNotes · buildHeadlineTester · buildReviewAggregator ·
//   buildChurnScorer · buildTwitterPulse · buildJobBoardSpy · buildVideoScript ·
//   buildChatbotBuilder · buildGlassdoor · buildQuoraMining ·
//   buildSocialAnalytics · buildTiktokDownloader · buildVoiceover
//
// Shared globals (showToast, navigateTo, _esc, _escapeHtml, _safeUrl,
// analysisData, _dataBadge, Chart, …) come from app.js at call time.
// =============================================================================
(function () {
// ── Tier 12 #2: HubSpot Sync ────────────────────────────────────────────
window.buildHubspotSync = async function() {
  const el = document.getElementById('hsWrap'); if (!el) return;
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#FF7A59 0%,#FF5C35 100%);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <div><div style="font-weight:800;font-size:1.05rem">🔄 HubSpot CRM</div><div style="font-size:0.82rem;opacity:.92;margin-top:2px">Push prospects + influencers as contacts. Auto-dedups by email, syncs lifecycle stage = lead.</div></div>
      <button onclick="_hsTest()" style="padding:8px 16px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);color:#fff;-webkit-text-fill-color:#fff;border-radius:8px;font-weight:800;cursor:pointer;font-size:0.82rem">⚡ Test connection</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
        <div style="font-weight:800;color:#0A1628;margin-bottom:10px">📥 Sync from Lead Finder</div>
        <p style="margin:0 0 10px;color:#6B7280;font-size:0.82rem">Run a B2B Lead Finder search first, then click below to push the most recent run into HubSpot.</p>
        <button onclick="_hsBulkFromLeads()" style="padding:10px 16px;background:#F97316;border:2px solid #F97316;border-radius:8px;color:#fff;-webkit-text-fill-color:#fff;font-weight:800;cursor:pointer;font-size:0.84rem;width:100%;text-shadow:0 1px 2px rgba(0,0,0,.4)">→ Push last lead-finder run</button>
      </div>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
        <div style="font-weight:800;color:#0A1628;margin-bottom:10px">✏️ Push single contact</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input id="hsName" placeholder="Full name" style="padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem">
          <input id="hsEmail" placeholder="email@company.com" style="padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input id="hsTitle" placeholder="Job title" style="padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem">
          <input id="hsCompany" placeholder="Company" style="padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem">
        </div>
        <button onclick="_hsPushOne()" style="padding:9px 14px;background:#F97316;border:2px solid #F97316;border-radius:6px;color:#fff;-webkit-text-fill-color:#fff;font-weight:800;cursor:pointer;font-size:0.82rem;width:100%;text-shadow:0 1px 2px rgba(0,0,0,.4)">→ Push to HubSpot</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="margin:0;color:#0A1628;font-size:1.05rem">Recent HubSpot contacts</h3>
      <button onclick="_hsLoadRecent()" style="padding:7px 14px;background:#fff;border:1.5px solid #F97316;color:#F97316;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">↻ Refresh</button>
    </div>
    <div id="hsRecent"></div>`;
  _hsLoadRecent();
};
window._hsTest = async function() {
  showToast('⏳ Testing HubSpot…');
  const r = await fetch('/api/hubspot-sync/test', { method:'POST' }).then(x=>x.json());
  showToast(r.ok ? '✅ ' + r.message : '❌ ' + r.error);
};
window._hsPushOne = async function() {
  const lead = {
    name:  (document.getElementById('hsName')||{}).value,
    email: (document.getElementById('hsEmail')||{}).value,
    title: (document.getElementById('hsTitle')||{}).value,
    company: (document.getElementById('hsCompany')||{}).value,
  };
  if (!lead.name && !lead.email) return showToast('⚠️ Name or email required');
  const r = await fetch('/api/hubspot-sync/push-lead', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ lead }) }).then(x=>x.json());
  if (!r.ok) return showToast('❌ ' + r.error);
  showToast('✅ Contact ' + r.action + ' (id ' + r.contact_id + ')');
  ['hsName','hsEmail','hsTitle','hsCompany'].forEach(i => { const e = document.getElementById(i); if (e) e.value = ''; });
  _hsLoadRecent();
};
window._hsBulkFromLeads = async function() {
  const leads = window._lfLeads || [];
  if (!leads.length) return showToast('⚠️ No leads cached. Run a B2B Lead Finder search first.');
  showToast(`⏳ Pushing ${leads.length} leads…`);
  const r = await fetch('/api/hubspot-sync/push-bulk', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ leads: leads.map(l => ({ ...l, _source:'b2b_lead_finder' })) }) }).then(x=>x.json());
  if (!r.ok) return showToast('❌ ' + r.error);
  showToast(`✅ Pushed ${r.pushed}/${r.total_attempted} to HubSpot`);
  _hsLoadRecent();
};
window._hsLoadRecent = async function() {
  const out = document.getElementById('hsRecent'); if (!out) return;
  out.innerHTML = `<div style="color:#6B7280;padding:14px">⏳ Loading…</div>`;
  const r = await fetch('/api/hubspot-sync/recent-contacts?limit=15').then(x=>x.json()).catch(()=>({ok:false,error:'request failed'}));
  if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
  if (!r.contacts.length) { out.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:30px;text-align:center;color:#6B7280">No contacts in HubSpot yet.</div>`; return; }
  out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden">
    <table style="width:100%;border-collapse:collapse;font-size:0.84rem">
      <thead><tr style="background:#F9FAFB;text-align:left"><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Name</th><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Email</th><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Title</th><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Company</th><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Stage</th><th style="padding:9px 12px;font-size:0.7rem;color:#6B7280">Created</th></tr></thead>
      <tbody>${r.contacts.map(c=>`<tr style="border-top:1px solid #F3F4F6">
        <td style="padding:9px 12px;color:#0A1628;font-weight:600">${_escapeHtml((c.firstname||'')+' '+(c.lastname||''))}</td>
        <td style="padding:9px 12px;color:#374151;font-size:0.78rem">${_escapeHtml(c.email||'')}</td>
        <td style="padding:9px 12px;color:#6B7280;font-size:0.78rem">${_escapeHtml(c.jobtitle||'')}</td>
        <td style="padding:9px 12px;color:#6B7280;font-size:0.78rem">${_escapeHtml(c.company||'')}</td>
        <td style="padding:9px 12px"><span style="background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700">${_escapeHtml(c.lifecyclestage||'lead')}</span></td>
        <td style="padding:9px 12px;color:#9CA3AF;font-size:0.74rem">${c.createdate?new Date(c.createdate).toLocaleDateString():''}</td>
      </tr>`).join('')}</tbody></table></div>`;
};

// ── Tier 13 #1: Meta Ads Insights ────────────────────────────────────
window.buildMetaInsights = async function() {
  const el = document.getElementById('metaInsWrap'); if (!el) return;
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#1877F2 0%,#0D5FBF 100%);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><div style="font-weight:800;font-size:1.05rem">📘 Meta Marketing API</div><div style="font-size:0.82rem;opacity:.92;margin-top:2px">Live spend, ROAS, top campaigns and creatives — refreshes on every load.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="miRange" onchange="_miLoad()" style="padding:7px 12px;border-radius:6px;border:none;font-weight:700;font-size:0.82rem;color:#0A1628;cursor:pointer">
          <option value="last_7d">Last 7 days</option>
          <option value="last_14d">Last 14 days</option>
          <option value="last_30d" selected>Last 30 days</option>
          <option value="last_90d">Last 90 days</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
        </select>
        <button onclick="_miTest()" style="padding:8px 14px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);color:#fff;-webkit-text-fill-color:#fff;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.78rem">⚡ Test</button>
      </div>
    </div>
    <div id="miSummary"></div>
    <div id="miCamps" style="margin-top:16px"></div>
    <div id="miAds" style="margin-top:16px"></div>`;
  _miLoad();
};
window._miTest = async function() {
  showToast('⏳ Pinging Meta…');
  const r = await fetch('/api/meta-insights/test', { method:'POST' }).then(x=>x.json());
  showToast(r.ok ? `✅ Connected: ${r.account?.name||''} (${r.account?.currency||''})` : '❌ ' + r.error);
};
window._miFmt = function(n, kind) {
  if (n === null || n === undefined) return '—';
  if (kind === 'pct') return (parseFloat(n)).toFixed(2) + '%';
  if (kind === 'money') return '$' + (parseFloat(n)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  if (kind === 'roas') return (parseFloat(n)).toFixed(2) + '×';
  return parseInt(n,10).toLocaleString();
};
window._miLoad = async function() {
  const dp = (document.getElementById('miRange')||{}).value || 'last_30d';
  const sumEl = document.getElementById('miSummary'); if (sumEl) sumEl.innerHTML = `<div style="color:#6B7280;padding:14px">⏳ Loading account…</div>`;
  const [s, c, a] = await Promise.all([
    fetch(`/api/meta-insights/account-summary?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/meta-insights/campaigns?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/meta-insights/top-ads?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
  ]);

  if (sumEl) {
    if (s.source === 'placeholder') sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">⚠️ <strong>${_escapeHtml(s.note||'Meta Ads not connected.')}</strong> <a href="#" onclick="navigateTo('settings');return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>`;
    else if (s.note) sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">${_escapeHtml(s.note)}</div>`;
    else if (!s.ok) sumEl.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(s.error||'failed')}</div>`;
    else {
      const m = s.summary;
      const tile = (label, val, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${color};border-radius:10px;padding:14px"><div style="font-size:0.7rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:1.5rem;font-weight:800;color:#0A1628;margin-top:4px">${val}</div></div>`;
      sumEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px">
        ${tile('Spend',_miFmt(m.spend,'money'),'#8B5CF6')}
        ${tile('Revenue',_miFmt(m.revenue,'money'),'#15803D')}
        ${tile('ROAS', _miFmt(m.roas,'roas'), m.roas>=2?'#15803D':m.roas>=1?'#F59E0B':'#DC2626')}
        ${tile('Impressions',_miFmt(m.impressions),'#0EA5E9')}
        ${tile('Reach',_miFmt(m.reach),'#0EA5E9')}
        ${tile('Clicks',_miFmt(m.clicks),'#0EA5E9')}
        ${tile('CTR',_miFmt(m.ctr,'pct'),'#F59E0B')}
        ${tile('CPC',_miFmt(m.cpc,'money'),'#F59E0B')}
        ${tile('CPM',_miFmt(m.cpm,'money'),'#F59E0B')}
        ${tile('Frequency',m.frequency.toFixed(2),'#9CA3AF')}
        ${tile('Purchases',_miFmt(m.purchases),'#15803D')}
      </div>`;
    }
  }

  const ce = document.getElementById('miCamps');
  if (ce) {
    if (c.source === 'placeholder') ce.innerHTML = '';
    else if (!c.ok || c.note || !c.campaigns?.length) ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns</h3><div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">${_escapeHtml(c.note||'No campaign data for this period.')}</div>`;
    else ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns (${c.campaigns.length})</h3>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:780px">
        <thead><tr style="background:#F9FAFB;text-align:left">
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Campaign</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Spend</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Revenue</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">ROAS</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Impr.</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Clicks</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CTR</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CPC</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Buys</th>
        </tr></thead>
        <tbody>${c.campaigns.map(x=>{const rc = x.roas>=2?'#15803D':x.roas>=1?'#F59E0B':'#DC2626'; return `<tr style="border-top:1px solid #F3F4F6">
          <td style="padding:9px 12px;color:#0A1628;font-weight:600;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_miFmt(x.spend,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_miFmt(x.revenue,'money')}</td>
          <td style="padding:9px 12px;text-align:right"><span style="background:${rc};color:#fff;padding:2px 7px;border-radius:4px;font-weight:800;font-size:0.74rem">${_miFmt(x.roas,'roas')}</span></td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_miFmt(x.impressions)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_miFmt(x.clicks)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_miFmt(x.ctr,'pct')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_miFmt(x.cpc,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_miFmt(x.purchases)}</td>
        </tr>`;}).join('')}</tbody></table></div>`;
  }

  const ae = document.getElementById('miAds');
  if (ae) {
    if (!a.ok || a.note || !a.ads?.length) ae.innerHTML = '';
    else ae.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Top creatives by CTR</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${a.ads.map(x=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:13px">
        <div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</div>
        <div style="color:#6B7280;font-size:0.74rem;margin-bottom:8px">${_escapeHtml(x.campaign||'')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><span style="background:#F0FDF4;color:#15803D;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">CTR ${_miFmt(x.ctr,'pct')}</span><span style="background:#EFF6FF;color:#1E40AF;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_miFmt(x.clicks)} clicks</span><span style="background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_miFmt(x.spend,'money')}</span></div>
      </div>`).join('')}</div>`;
  }
};

// ── Tier 13 #2: Keyword Explorer ────────────────────────────────────
window.buildKeywordExplorer = async function() {
  const el = document.getElementById('keWrap'); if (!el) return;
  // Detect a good default country from analysisData if available
  const _ad = window.analysisData || {};
  const _defCty = (_ad.country_code || 'global').toLowerCase().slice(0,5);

  const KE_COUNTRIES = [
    ['global','🌍 Global (all countries)'],['us','🇺🇸 United States'],['gb','🇬🇧 United Kingdom'],
    ['au','🇦🇺 Australia'],['ca','🇨🇦 Canada'],['de','🇩🇪 Germany'],['fr','🇫🇷 France'],
    ['es','🇪🇸 Spain'],['it','🇮🇹 Italy'],['nl','🇳🇱 Netherlands'],['be','🇧🇪 Belgium'],
    ['ch','🇨🇭 Switzerland'],['at','🇦🇹 Austria'],['pt','🇵🇹 Portugal'],['se','🇸🇪 Sweden'],
    ['no','🇳🇴 Norway'],['dk','🇩🇰 Denmark'],['fi','🇫🇮 Finland'],['ie','🇮🇪 Ireland'],
    ['pl','🇵🇱 Poland'],['cz','🇨🇿 Czech Republic'],['ro','🇷🇴 Romania'],['hu','🇭🇺 Hungary'],
    ['gr','🇬🇷 Greece'],['ru','🇷🇺 Russia'],['tr','🇹🇷 Turkey'],['in','🇮🇳 India'],
    ['cn','🇨🇳 China'],['jp','🇯🇵 Japan'],['kr','🇰🇷 South Korea'],['sg','🇸🇬 Singapore'],
    ['hk','🇭🇰 Hong Kong'],['tw','🇹🇼 Taiwan'],['my','🇲🇾 Malaysia'],['id','🇮🇩 Indonesia'],
    ['th','🇹🇭 Thailand'],['ph','🇵🇭 Philippines'],['bd','🇧🇩 Bangladesh'],['pk','🇵🇰 Pakistan'],
    ['br','🇧🇷 Brazil'],['mx','🇲🇽 Mexico'],['ar','🇦🇷 Argentina'],['co','🇨🇴 Colombia'],
    ['cl','🇨🇱 Chile'],['nz','🇳🇿 New Zealand'],['za','🇿🇦 South Africa'],['ng','🇳🇬 Nigeria'],
    ['ke','🇰🇪 Kenya'],['gh','🇬🇭 Ghana'],['eg','🇪🇬 Egypt'],['sa','🇸🇦 Saudi Arabia'],
    ['ae','🇦🇪 UAE'],['il','🇮🇱 Israel'],
  ];
  const _initEntry = KE_COUNTRIES.find(([v]) => v === _defCty) || KE_COUNTRIES[0];

  el.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="display:grid;grid-template-columns:1fr 200px 110px auto;gap:10px;align-items:end">
        <div style="position:relative">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280">Seed keyword</label>
            <button onclick="_keAiSuggest(event)" id="keAiSuggestBtn" title="Show keywords from your analysis" style="padding:2px 9px;background:linear-gradient(135deg,#7C3AED,#A855F7);border:none;border-radius:6px;color:#fff;font-size:0.62rem;font-weight:700;cursor:pointer;line-height:1.6">✨ AI Suggest</button>
          </div>
          <input id="keSeed" placeholder="e.g. forex trading" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.86rem;box-sizing:border-box">
          <div id="keKwPicker" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);background:#fff;border:1.5px solid #7C3AED;border-radius:10px;box-shadow:0 8px 28px rgba(124,58,237,.22);z-index:9999;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <span style="font-size:0.65rem;font-weight:700;color:#7C3AED;text-transform:uppercase;letter-spacing:.06em">Keywords from your analysis — click to use</span>
              <span onclick="document.getElementById('keKwPicker').style.display='none'" style="cursor:pointer;color:#9CA3AF;font-size:0.85rem;line-height:1" title="Close">✕</span>
            </div>
            <div id="keKwPickerList" style="display:flex;flex-wrap:wrap;gap:6px"></div>
          </div>
        </div>
        <div style="position:relative">
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">Country</label>
          <div id="keCtyBtn" onclick="_keCtyToggle(event)" style="width:100%;padding:9px 10px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.84rem;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none;box-sizing:border-box;gap:4px">
            <span id="keCtyLabel">${_initEntry[1]}</span>
            <span style="color:#9CA3AF;font-size:0.6rem;flex-shrink:0">▼</span>
          </div>
          <input type="hidden" id="keCty" value="${_initEntry[0]}">
          <div id="keCtyMenu" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 3px);background:#fff;border:1.5px solid #D1D5DB;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.15);z-index:9999;max-height:300px;overflow-y:auto">
            ${KE_COUNTRIES.map(([v,l]) => `<div onclick="_keCtyPick('${v}','${l.replace(/'/g,"\\'")}')" style="padding:8px 12px;font-size:0.82rem;cursor:pointer${v===_initEntry[0]?';background:#F5F3FF;font-weight:700':''}" onmouseover="this.style.background='#F5F3FF'" onmouseout="this.style.background='${v===_initEntry[0]?'#F5F3FF':''}';">${l}</div>`).join('')}
          </div>
        </div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">Ideas</label><input id="keLim" type="number" value="25" min="5" max="50" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:0.86rem;box-sizing:border-box"></div>
        <button onclick="_keGo()" style="padding:10px 18px;background:#8B5CF6;border:2px solid #8B5CF6;border-radius:8px;font-size:0.82rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.4);white-space:nowrap">🔬 Explore</button>
      </div>
    </div>
    <div id="keOut"></div>`;

  // Close both menus on outside click (self-removes when keWrap is rebuilt)
  if (window._keOutsideHandler) document.removeEventListener('click', window._keOutsideHandler);
  window._keOutsideHandler = function(e) {
    const ctyBtn = document.getElementById('keCtyBtn');
    const ctyMenu = document.getElementById('keCtyMenu');
    const kwPicker = document.getElementById('keKwPicker');
    const kwBtn = document.getElementById('keAiSuggestBtn');
    if (!ctyBtn) { document.removeEventListener('click', window._keOutsideHandler); return; }
    if (ctyMenu && !ctyBtn.parentElement.contains(e.target)) ctyMenu.style.display = 'none';
    if (kwPicker && kwBtn && !kwBtn.contains(e.target) && !kwPicker.contains(e.target)) kwPicker.style.display = 'none';
  };
  document.addEventListener('click', window._keOutsideHandler);
};

// AI Suggest for Keyword Explorer — shows a picker with all analysis keywords
window._keAiSuggest = function(evt) {
  if (evt) evt.stopPropagation();
  const picker     = document.getElementById('keKwPicker');
  const pickerList = document.getElementById('keKwPickerList');
  if (!picker || !pickerList) return;

  // If already open, close it
  if (picker.style.display !== 'none') { picker.style.display = 'none'; return; }

  const ad = window.analysisData || {};
  const seen = new Set();
  const pool = [];

  // 1. analysisData.keywords — populated by enrichCompetitorKwAudiences (~5s after analysis)
  if (Array.isArray(ad.keywords) && ad.keywords.length) {
    ad.keywords.forEach(k => {
      const s = typeof k === 'string' ? k : (k && (k.keyword || k.term) || '');
      if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); pool.push(s); }
    });
  }
  // 2. competitor topKeywords (also populated by enrichment)
  if (Array.isArray(ad.competitors)) {
    ad.competitors.forEach(c => {
      if (Array.isArray(c.topKeywords)) c.topKeywords.forEach(k => {
        if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); pool.push(k); }
      });
    });
  }

  if (!pool.length) {
    // Fall back to domain/brand as single suggestion with explanatory message
    const domain = (ad.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0];
    const seed = domain || ad.brand_name || '';
    if (seed) {
      pool.push(seed);
      pickerList.innerHTML = `
        <div style="width:100%;font-size:0.75rem;color:#6B7280;margin-bottom:8px">
          No analysis keywords yet — run a website analysis to get real competitor keywords. Showing domain name as fallback:
        </div>
        <button onclick="document.getElementById('keSeed').value='${seed.replace(/'/g,"\\'")}';document.getElementById('keKwPicker').style.display='none';document.getElementById('keSeed').focus()" style="padding:5px 12px;background:#F5F3FF;border:1.5px solid #DDD6FE;border-radius:20px;font-size:0.76rem;font-weight:600;color:#5B21B6;cursor:pointer">${seed}</button>`;
      picker.style.display = 'block';
    } else {
      showToast('ℹ️ Run a website analysis first — AI Suggest will populate keywords from it');
    }
    return;
  }

  // Render clickable keyword chips — up to 24
  pickerList.innerHTML = pool.slice(0, 24).map(kw =>
    `<button onclick="document.getElementById('keSeed').value='${kw.replace(/'/g,"\\'")}';document.getElementById('keKwPicker').style.display='none';document.getElementById('keSeed').focus()" style="padding:5px 12px;background:#F5F3FF;border:1.5px solid #DDD6FE;border-radius:20px;font-size:0.76rem;font-weight:600;color:#5B21B6;cursor:pointer;white-space:nowrap" onmouseover="this.style.background='#EDE9FE';this.style.borderColor='#7C3AED'" onmouseout="this.style.background='#F5F3FF';this.style.borderColor='#DDD6FE'">${(window._escapeHtml||String)(kw)}</button>`
  ).join('');

  picker.style.display = 'block';
};

// Country dropdown helpers
window._keCtyToggle = function(evt) {
  if (evt) evt.stopPropagation();
  const menu = document.getElementById('keCtyMenu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
};
window._keCtyPick = function(val, label) {
  const hidden = document.getElementById('keCty');
  const lbl    = document.getElementById('keCtyLabel');
  const menu   = document.getElementById('keCtyMenu');
  if (hidden) hidden.value = val;
  if (lbl)    lbl.textContent = label;
  if (menu)   menu.style.display = 'none';
  // Highlight selected row
  if (menu) menu.querySelectorAll('div').forEach(d => {
    d.style.background = d.textContent.trim() === label ? '#F5F3FF' : '';
    d.style.fontWeight = d.textContent.trim() === label ? '700' : '';
  });
};
window._keKD = function(kd) {
  if (kd === null || kd === undefined) return { label:'—', color:'#9CA3AF' };
  if (kd <= 30) return { label: kd+' easy', color:'#15803D' };
  if (kd <= 60) return { label: kd+' med',  color:'#F59E0B' };
  return { label: kd+' hard', color:'#DC2626' };
};
window._keGo = async function() {
  const seed = (document.getElementById('keSeed')||{}).value || '';
  const country = (document.getElementById('keCty')||{}).value || 'us';
  const limit = parseInt((document.getElementById('keLim')||{}).value, 10) || 25;
  if (!seed.trim()) return showToast('⚠️ Seed keyword required');
  const out = document.getElementById('keOut'); if (!out) return;
  out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:30px;text-align:center;color:#6B7280">⏳ Querying DataForSEO Labs… (this can take 10-20s)</div>`;
  const r = await fetch('/api/keyword-explorer/explore', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ seed, country, limit }) }).then(x=>x.json());
  if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:18px;border-radius:10px">${_escapeHtml(r.error||'failed')}</div>`; return; }
  if (r.note) { out.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:18px;border-radius:10px;border:1px solid #FDE68A">${_escapeHtml(r.note)}</div>`; return; }
  const sm = r.seed_metrics, kd = _keKD(sm.keyword_difficulty);
  const tile = (label, val, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${color};border-radius:10px;padding:13px"><div style="font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:1.3rem;font-weight:800;color:#0A1628;margin-top:3px">${val}</div></div>`;
  out.innerHTML = `
    <div style="background:linear-gradient(135deg,#8B5CF6 0%,#6D28D9 100%);color:#fff;border-radius:12px;padding:16px 20px;margin-bottom:14px">
      <div style="font-weight:800;font-size:1.1rem">🔬 ${_escapeHtml(sm.keyword)}</div>
      <div style="font-size:0.78rem;opacity:.9;margin-top:2px">${country==='global'?'🌍 Global':((country||'us').toUpperCase())} · ${sm.intent ? sm.intent + ' intent' : 'no intent data'}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:18px">
      ${tile('Search volume', (sm.search_volume||0).toLocaleString()+'/mo','#0EA5E9')}
      ${tile('Difficulty', `<span style="background:${kd.color};color:#fff;padding:2px 8px;border-radius:4px;font-size:0.78rem">${kd.label}</span>`,'#F59E0B')}
      ${tile('CPC', '$'+(sm.cpc||0).toFixed(2),'#15803D')}
      ${tile('Competition', (sm.competition_level||'—'),'#9CA3AF')}
      ${tile('Top-of-page low', '$'+(sm.low_top_of_page_bid||0).toFixed(2),'#9CA3AF')}
      ${tile('Top-of-page high', '$'+(sm.high_top_of_page_bid||0).toFixed(2),'#9CA3AF')}
    </div>
    <h3 style="margin:0 0 10px;color:#0A1628">${r.ideas.length} keyword ideas</h3>
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.84rem;min-width:680px">
        <thead><tr style="background:#F9FAFB;text-align:left">
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Keyword</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Volume</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">KD</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CPC</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Comp</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Intent</th>
        </tr></thead>
        <tbody>${r.ideas.map(it=>{const ikd=_keKD(it.keyword_difficulty); return `<tr style="border-top:1px solid #F3F4F6">
          <td style="padding:9px 12px;color:#0A1628;font-weight:600">${_escapeHtml(it.keyword)}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628;font-weight:700">${(it.search_volume||0).toLocaleString()}</td>
          <td style="padding:9px 12px;text-align:right"><span style="background:${ikd.color};color:#fff;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${ikd.label}</span></td>
          <td style="padding:9px 12px;text-align:right;color:#15803D;font-weight:700">$${(it.cpc||0).toFixed(2)}</td>
          <td style="padding:9px 12px;color:#6B7280;font-size:0.78rem">${_escapeHtml(it.competition_level||'—')}</td>
          <td style="padding:9px 12px;color:#6B7280;font-size:0.78rem">${_escapeHtml(it.intent||'—')}</td>
        </tr>`;}).join('')}</tbody></table></div>
    <div style="margin-top:12px;text-align:right"><button id="keCsvBtn" style="padding:8px 14px;background:#fff;border:1.5px solid #8B5CF6;color:#8B5CF6;border-radius:6px;font-size:0.8rem;font-weight:700;cursor:pointer">📥 Export CSV</button></div>`;
  window._keLastResult = { ideas: r.ideas, seed: sm.keyword };
  try { _applyKeOutliers(); } catch(e) {}
  const btn = document.getElementById('keCsvBtn');
  if (btn) btn.addEventListener('click', () => _keCsv(window._keLastResult.ideas, window._keLastResult.seed));
};
window._keCsv = function(ideas, seed) {
  const rows = [['keyword','search_volume','keyword_difficulty','cpc','competition_level','intent']];
  ideas.forEach(i => rows.push([i.keyword,i.search_volume||0,i.keyword_difficulty||'',i.cpc||0,i.competition_level||'',i.intent||'']));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `keyword-ideas-${String(seed||'export').replace(/[^a-z0-9]+/gi,'-')}.csv`; a.click(); URL.revokeObjectURL(url);
};

// ── Tier 14 #1: Google Ads Insights ────────────────────────────────────
window.buildGoogleAdsInsights = async function() {
  const el = document.getElementById('gaiWrap'); if (!el) return;
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#4285F4 0%,#34A853 50%,#FBBC04 100%);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><div style="font-weight:800;font-size:1.05rem">🅖 Google Ads API</div><div style="font-size:0.82rem;opacity:.92;margin-top:2px">Live spend, ROAS, top campaigns and ads — refreshes on every load.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="gaiRange" style="padding:7px 12px;border-radius:6px;border:none;font-weight:700;font-size:0.82rem;color:#0A1628;cursor:pointer">
          <option value="last_7d">Last 7 days</option>
          <option value="last_14d">Last 14 days</option>
          <option value="last_30d" selected>Last 30 days</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
        </select>
        <button id="gaiTestBtn" style="padding:8px 14px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);color:#fff;-webkit-text-fill-color:#fff;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.78rem">⚡ Test</button>
      </div>
    </div>
    <div id="gaiSummary"></div>
    <div id="gaiCamps" style="margin-top:16px"></div>
    <div id="gaiAds" style="margin-top:16px"></div>`;
  document.getElementById('gaiRange').addEventListener('change', _gaiLoad);
  document.getElementById('gaiTestBtn').addEventListener('click', _gaiTest);
  _gaiLoad();
};
window._gaiTest = async function() {
  showToast('⏳ Pinging Google Ads…');
  const r = await fetch('/api/google-ads-insights/test', { method:'POST' }).then(x=>x.json());
  showToast(r.ok ? `✅ Connected: ${r.account?.name||''} (${r.account?.currency||''})` : '❌ ' + r.error);
};
window._gaiFmt = window._miFmt; // reuse formatter
window._gaiLoad = async function() {
  const dp = (document.getElementById('gaiRange')||{}).value || 'last_30d';
  const sumEl = document.getElementById('gaiSummary'); if (sumEl) sumEl.innerHTML = `<div style="color:#6B7280;padding:14px">⏳ Loading account…</div>`;
  const [s, c, a] = await Promise.all([
    fetch(`/api/google-ads-insights/account-summary?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/google-ads-insights/campaigns?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/google-ads-insights/top-ads?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
  ]);

  if (sumEl) {
    if (s.source === 'placeholder') sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">⚠️ <strong>${_escapeHtml(s.note||'Google Ads not connected.')}</strong> <a href="#" onclick="navigateTo('settings');return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>`;
    else if (s.note) sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">${_escapeHtml(s.note)}</div>`;
    else if (!s.ok) sumEl.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(s.error||'failed')}</div>`;
    else {
      const m = s.summary;
      const tile = (label, val, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${color};border-radius:10px;padding:14px"><div style="font-size:0.7rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:1.5rem;font-weight:800;color:#0A1628;margin-top:4px">${val}</div></div>`;
      sumEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px">
        ${tile('Spend',_gaiFmt(m.spend,'money'),'#4285F4')}
        ${tile('Revenue',_gaiFmt(m.revenue,'money'),'#15803D')}
        ${tile('ROAS', _gaiFmt(m.roas,'roas'), m.roas>=2?'#15803D':m.roas>=1?'#F59E0B':'#DC2626')}
        ${tile('Conversions', m.conversions.toFixed(2),'#15803D')}
        ${tile('Impressions',_gaiFmt(m.impressions),'#0EA5E9')}
        ${tile('Clicks',_gaiFmt(m.clicks),'#0EA5E9')}
        ${tile('CTR',_gaiFmt(m.ctr,'pct'),'#F59E0B')}
        ${tile('CPC',_gaiFmt(m.cpc,'money'),'#F59E0B')}
        ${tile('CPM',_gaiFmt(m.cpm,'money'),'#F59E0B')}
      </div>`;
    }
  }

  const ce = document.getElementById('gaiCamps');
  if (ce) {
    if (c.source === 'placeholder') ce.innerHTML = '';
    else if (!c.ok || c.note || !c.campaigns?.length) ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns</h3><div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">${_escapeHtml(c.note||'No campaign data for this period.')}</div>`;
    else ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns (${c.campaigns.length})</h3>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:780px">
        <thead><tr style="background:#F9FAFB;text-align:left">
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Campaign</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Spend</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Revenue</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">ROAS</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Impr.</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Clicks</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CTR</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CPC</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Conv.</th>
        </tr></thead>
        <tbody>${c.campaigns.map(x=>{const rc = x.roas>=2?'#15803D':x.roas>=1?'#F59E0B':'#DC2626'; return `<tr style="border-top:1px solid #F3F4F6">
          <td style="padding:9px 12px;color:#0A1628;font-weight:600;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_gaiFmt(x.spend,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_gaiFmt(x.revenue,'money')}</td>
          <td style="padding:9px 12px;text-align:right"><span style="background:${rc};color:#fff;padding:2px 7px;border-radius:4px;font-weight:800;font-size:0.74rem">${_gaiFmt(x.roas,'roas')}</span></td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_gaiFmt(x.impressions)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_gaiFmt(x.clicks)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_gaiFmt(x.ctr,'pct')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_gaiFmt(x.cpc,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${(x.conversions||0).toFixed(2)}</td>
        </tr>`;}).join('')}</tbody></table></div>`;
  }

  const ae = document.getElementById('gaiAds');
  if (ae) {
    if (!a.ok || a.note || !a.ads?.length) ae.innerHTML = '';
    else ae.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Top ads by CTR</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${a.ads.map(x=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:13px">
        <div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</div>
        <div style="color:#6B7280;font-size:0.74rem;margin-bottom:8px">${_escapeHtml(x.campaign||'')} · ${_escapeHtml(x.ad_group||'')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><span style="background:#F0FDF4;color:#15803D;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">CTR ${_gaiFmt(x.ctr,'pct')}</span><span style="background:#EFF6FF;color:#1E40AF;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_gaiFmt(x.clicks)} clicks</span><span style="background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_gaiFmt(x.spend,'money')}</span></div>
      </div>`).join('')}</div>`;
  }
};

// ── Tier 14 #2: TikTok Ads Insights ────────────────────────────────────
window.buildTiktokAdsInsights = async function() {
  const el = document.getElementById('ttiWrap'); if (!el) return;
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#000 0%,#25F4EE 50%,#FE2C55 100%);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><div style="font-weight:800;font-size:1.05rem">🎵 TikTok Marketing API</div><div style="font-size:0.82rem;opacity:.92;margin-top:2px">Live spend, ROAS, top campaigns and creatives — refreshes on every load.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="ttiRange" style="padding:7px 12px;border-radius:6px;border:none;font-weight:700;font-size:0.82rem;color:#0A1628;cursor:pointer">
          <option value="last_7d">Last 7 days</option>
          <option value="last_14d">Last 14 days</option>
          <option value="last_30d" selected>Last 30 days</option>
          <option value="last_90d">Last 90 days</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
        </select>
        <button id="ttiTestBtn" style="padding:8px 14px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.45);color:#fff;-webkit-text-fill-color:#fff;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.78rem">⚡ Test</button>
      </div>
    </div>
    <div id="ttiSummary"></div>
    <div id="ttiCamps" style="margin-top:16px"></div>
    <div id="ttiAds" style="margin-top:16px"></div>`;
  document.getElementById('ttiRange').addEventListener('change', _ttiLoad);
  document.getElementById('ttiTestBtn').addEventListener('click', _ttiTest);
  _ttiLoad();
};
window._ttiTest = async function() {
  showToast('⏳ Pinging TikTok…');
  const r = await fetch('/api/tiktok-ads-insights/test', { method:'POST' }).then(x=>x.json());
  showToast(r.ok ? `✅ Connected: ${r.account?.name||''} (${r.account?.currency||''})` : '❌ ' + r.error);
};
window._ttiFmt = window._miFmt; // reuse formatter
window._ttiLoad = async function() {
  const dp = (document.getElementById('ttiRange')||{}).value || 'last_30d';
  const sumEl = document.getElementById('ttiSummary'); if (sumEl) sumEl.innerHTML = `<div style="color:#6B7280;padding:14px">⏳ Loading account…</div>`;
  const [s, c, a] = await Promise.all([
    fetch(`/api/tiktok-ads-insights/account-summary?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/tiktok-ads-insights/campaigns?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/tiktok-ads-insights/top-ads?date_preset=${dp}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
  ]);

  if (sumEl) {
    if (s.note) sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">${_escapeHtml(s.note)}</div>`;
    else if (!s.ok) sumEl.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(s.error||'failed')}</div>`;
    else {
      const m = s.summary;
      const tile = (label, val, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${color};border-radius:10px;padding:14px"><div style="font-size:0.7rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:1.5rem;font-weight:800;color:#0A1628;margin-top:4px">${val}</div></div>`;
      sumEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px">
        ${tile('Spend',_ttiFmt(m.spend,'money'),'#FE2C55')}
        ${tile('Revenue',_ttiFmt(m.revenue,'money'),'#15803D')}
        ${tile('ROAS', _ttiFmt(m.roas,'roas'), m.roas>=2?'#15803D':m.roas>=1?'#F59E0B':'#DC2626')}
        ${tile('Impressions',_ttiFmt(m.impressions),'#25F4EE')}
        ${tile('Reach',_ttiFmt(m.reach),'#25F4EE')}
        ${tile('Clicks',_ttiFmt(m.clicks),'#25F4EE')}
        ${tile('CTR',_ttiFmt(m.ctr,'pct'),'#F59E0B')}
        ${tile('CPC',_ttiFmt(m.cpc,'money'),'#F59E0B')}
        ${tile('CPM',_ttiFmt(m.cpm,'money'),'#F59E0B')}
        ${tile('Frequency',(m.frequency||0).toFixed(2),'#9CA3AF')}
        ${tile('Conversions',_ttiFmt(m.conversions),'#15803D')}
      </div>`;
    }
  }

  const ce = document.getElementById('ttiCamps');
  if (ce) {
    if (!c.ok || c.note || !c.campaigns?.length) ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns</h3><div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">${_escapeHtml(c.note||'No campaign data for this period.')}</div>`;
    else ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns (${c.campaigns.length})</h3>
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem;min-width:780px">
        <thead><tr style="background:#F9FAFB;text-align:left">
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase">Campaign</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Spend</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Revenue</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">ROAS</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Impr.</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Clicks</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CTR</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">CPC</th>
          <th style="padding:9px 12px;font-size:0.68rem;color:#6B7280;font-weight:700;text-transform:uppercase;text-align:right">Conv.</th>
        </tr></thead>
        <tbody>${c.campaigns.map(x=>{const rc = x.roas>=2?'#15803D':x.roas>=1?'#F59E0B':'#DC2626'; return `<tr style="border-top:1px solid #F3F4F6">
          <td style="padding:9px 12px;color:#0A1628;font-weight:600;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_ttiFmt(x.spend,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_ttiFmt(x.revenue,'money')}</td>
          <td style="padding:9px 12px;text-align:right"><span style="background:${rc};color:#fff;padding:2px 7px;border-radius:4px;font-weight:800;font-size:0.74rem">${_ttiFmt(x.roas,'roas')}</span></td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_ttiFmt(x.impressions)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_ttiFmt(x.clicks)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_ttiFmt(x.ctr,'pct')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_ttiFmt(x.cpc,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_ttiFmt(x.conversions)}</td>
        </tr>`;}).join('')}</tbody></table></div>`;
  }

  const ae = document.getElementById('ttiAds');
  if (ae) {
    if (!a.ok || a.note || !a.ads?.length) ae.innerHTML = '';
    else ae.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Top creatives by CTR</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${a.ads.map(x=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:13px">
        <div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escapeHtml(x.name||'')}</div>
        <div style="color:#6B7280;font-size:0.74rem;margin-bottom:8px">${_escapeHtml(x.campaign||'')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><span style="background:#F0FDF4;color:#15803D;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">CTR ${_ttiFmt(x.ctr,'pct')}</span><span style="background:#EFF6FF;color:#1E40AF;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_ttiFmt(x.clicks)} clicks</span><span style="background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:4px;font-size:0.72rem;font-weight:700">${_ttiFmt(x.spend,'money')}</span></div>
      </div>`).join('')}</div>`;
  }
};

// ============================================================================
// TIER 15 — SOCIAL PUBLISHER (Zernio)
// ============================================================================
const _spPlatforms = [
  { id:'twitter',        label:'Twitter/X',       icon:'𝕏'  },
  { id:'instagram',      label:'Instagram',       icon:'📷' },
  { id:'facebook',       label:'Facebook',        icon:'📘' },
  { id:'linkedin',       label:'LinkedIn',        icon:'💼' },
  { id:'tiktok',         label:'TikTok',          icon:'🎵' },
  { id:'youtube',        label:'YouTube',         icon:'▶️' },
  { id:'pinterest',      label:'Pinterest',       icon:'📌' },
  { id:'reddit',         label:'Reddit',          icon:'👽' },
  { id:'bluesky',        label:'Bluesky',         icon:'🦋' },
  { id:'threads',        label:'Threads',         icon:'@'  },
  { id:'googlebusiness', label:'Google Business', icon:'🏢' },
  { id:'telegram',       label:'Telegram',        icon:'✈️' },
  { id:'snapchat',       label:'Snapchat',        icon:'👻' },
  { id:'whatsapp',       label:'WhatsApp',        icon:'💬' },
  { id:'discord',        label:'Discord',         icon:'🎮' },
];

window._spState = { profileId:null, profiles:[], accounts:[], selectedPlatforms:new Set() };

window.buildSocialPublisher = async function() {
  const wrap = document.getElementById('spWrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:0;overflow:hidden;margin-bottom:18px">
      <div style="background:linear-gradient(135deg,#FF5722 0%,#FF7043 100%);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:#fff">📤 Social Publisher</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,.85);margin-top:2px">Zernio · 15 platforms · post now or schedule</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="spProfileSel" style="padding:7px 10px;border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:#fff;border-radius:6px;font-size:0.78rem;font-weight:600;min-width:160px"><option value="">Loading profiles…</option></select>
          <button id="spNewProfile" style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">＋ New profile</button>
          <button id="spTest" style="background:#fff;color:#FF5722;border:none;padding:7px 14px;border-radius:6px;font-size:0.74rem;font-weight:800;cursor:pointer">⚡ Test connection</button>
        </div>
      </div>
      <div id="spStatus" style="padding:10px 20px;background:#FFF7ED;border-bottom:1px solid #FED7AA;color:#9A3412;font-size:0.78rem;display:none"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <h3 style="margin:0 0 10px;color:#0A1628;font-size:0.95rem;font-family:Sora,sans-serif">🔌 Connected accounts</h3>
        <div id="spAccounts" style="font-size:0.82rem;color:#6B7280">Pick a profile above to see connected accounts.</div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid #F1F5F9">
          <div style="font-size:0.78rem;color:#374151;font-weight:700;margin-bottom:8px">＋ Connect a new platform</div>
          <div id="spConnectBtns" style="display:flex;flex-wrap:wrap;gap:6px"></div>
        </div>
      </div>

      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
        <h3 style="margin:0 0 10px;color:#0A1628;font-size:0.95rem;font-family:Sora,sans-serif">✍️ Compose</h3>
        <textarea id="spText" rows="5" placeholder="What do you want to post? (or paste an AI draft from Reply Assistant, Press Release, Counter-Message, A/B Designer…)" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
        <div style="margin-top:10px">
          <div style="font-size:0.74rem;color:#6B7280;font-weight:700;margin-bottom:6px">PUBLISH TO:</div>
          <div id="spPlatformChips" style="display:flex;flex-wrap:wrap;gap:6px"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div>
            <div style="font-size:0.74rem;color:#6B7280;font-weight:700;margin-bottom:4px">📅 SCHEDULE FOR (optional)</div>
            <input type="datetime-local" id="spSchedule" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;box-sizing:border-box">
          </div>
          <div>
            <div style="font-size:0.74rem;color:#6B7280;font-weight:700;margin-bottom:4px">🖼 MEDIA URL (optional)</div>
            <input type="url" id="spMedia" placeholder="https://example.com/image.jpg" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;box-sizing:border-box">
          </div>
        </div>
        <button id="spPublish" style="margin-top:12px;width:100%;background:linear-gradient(135deg,#FF5722 0%,#FF7043 100%);color:#fff;border:none;padding:11px;border-radius:8px;font-size:0.86rem;font-weight:800;cursor:pointer">📤 Publish now</button>
        <div id="spResult" style="margin-top:10px;font-size:0.78rem"></div>
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h3 style="margin:0;color:#0A1628;font-size:0.95rem;font-family:Sora,sans-serif">📅 Scheduled & recent posts</h3>
        <button id="spRefreshPosts" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:5px 10px;border-radius:5px;font-size:0.72rem;font-weight:700;cursor:pointer">🔄 Refresh</button>
      </div>
      <div id="spPosts" style="font-size:0.82rem;color:#6B7280">Pick a profile above.</div>
    </div>
  `;

  // Render platform chips
  const chipsEl = document.getElementById('spPlatformChips');
  chipsEl.innerHTML = _spPlatforms.map(p =>
    `<button data-platform="${p.id}" class="sp-chip" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:6px 10px;border-radius:16px;font-size:0.72rem;font-weight:700;cursor:pointer">${p.icon} ${_escapeHtml(p.label)}</button>`
  ).join('');
  chipsEl.querySelectorAll('.sp-chip').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.platform;
    if (window._spState.selectedPlatforms.has(id)) { window._spState.selectedPlatforms.delete(id); b.style.background='#F3F4F6'; b.style.color='#374151'; b.style.borderColor='#E5E7EB'; }
    else { window._spState.selectedPlatforms.add(id); b.style.background='#FF5722'; b.style.color='#fff'; b.style.borderColor='#FF5722'; }
  }));

  // Render connect buttons
  document.getElementById('spConnectBtns').innerHTML = _spPlatforms.map(p =>
    `<button data-cp="${p.id}" class="sp-connect" style="background:#FFF;border:1px solid #E5E7EB;color:#374151;padding:6px 10px;border-radius:6px;font-size:0.72rem;font-weight:700;cursor:pointer" title="Connect ${p.label}">${p.icon} ${_escapeHtml(p.label)}</button>`
  ).join('');
  document.getElementById('spConnectBtns').querySelectorAll('.sp-connect').forEach(b =>
    b.addEventListener('click', () => _spConnect(b.dataset.cp))
  );

  document.getElementById('spTest').addEventListener('click', _spTest);
  document.getElementById('spNewProfile').addEventListener('click', _spNewProfile);
  document.getElementById('spProfileSel').addEventListener('change', e => { window._spState.profileId = e.target.value || null; _spLoadAccounts(); _spLoadPosts(); });
  document.getElementById('spPublish').addEventListener('click', _spPublish);
  document.getElementById('spRefreshPosts').addEventListener('click', _spLoadPosts);

  await _spLoadProfiles();
};

async function _spStatus(msg, kind) {
  const el = document.getElementById('spStatus');
  if (!el) return;
  if (!msg) { el.style.display='none'; return; }
  const colors = { ok:['#ECFDF5','#A7F3D0','#065F46'], err:['#FEF2F2','#FECACA','#991B1B'], info:['#FFF7ED','#FED7AA','#9A3412'] };
  const c = colors[kind || 'info'];
  el.style.background = c[0]; el.style.borderColor = c[1]; el.style.color = c[2];
  el.style.display = 'block'; el.textContent = msg;
}

async function _spTest() {
  _spStatus('Testing Zernio connection…', 'info');
  try {
    const r = await fetch('/api/social-publisher/test', { method:'POST' }).then(x => x.json());
    if (r.ok) _spStatus(`✅ Connected to Zernio · ${r.profile_count} profile(s) found`, 'ok');
    else _spStatus(`❌ ${r.error}`, 'err');
  } catch (e) { _spStatus(`❌ Network error: ${e.message}`, 'err'); }
}

async function _spLoadProfiles() {
  try {
    const r = await fetch('/api/social-publisher/profiles').then(x => x.json());
    const sel = document.getElementById('spProfileSel');
    if (!r.ok) { sel.innerHTML = `<option value="">⚠ ${_escapeHtml(r.error || 'failed')}</option>`; _spStatus(r.error, 'err'); return; }
    const profs = r.profiles || [];
    window._spState.profiles = profs;
    if (!profs.length) {
      sel.innerHTML = `<option value="">No profiles — click ＋ New profile</option>`;
      _spStatus('No profiles yet. Click "＋ New profile" to create one (e.g. "InfoGenie main").', 'info');
      return;
    }
    sel.innerHTML = profs.map(p => `<option value="${_escapeHtml(p._id || p.id)}">${_escapeHtml(p.name || p._id || p.id)}</option>`).join('');
    window._spState.profileId = sel.value;
    _spStatus('', null);
    await _spLoadAccounts();
    await _spLoadPosts();
  } catch (e) { _spStatus(`Network error: ${e.message}`, 'err'); }
}

async function _spNewProfile() {
  const name = prompt('Profile name (e.g. "InfoGenie main"):');
  if (!name || !name.trim()) return;
  _spStatus('Creating profile…', 'info');
  try {
    const r = await fetch('/api/social-publisher/profiles', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name: name.trim() })
    }).then(x => x.json());
    if (!r.ok) { _spStatus(`❌ ${r.error}`, 'err'); return; }
    _spStatus(`✅ Profile "${name}" created`, 'ok');
    await _spLoadProfiles();
  } catch (e) { _spStatus(`Network error: ${e.message}`, 'err'); }
}

async function _spLoadAccounts() {
  const el = document.getElementById('spAccounts');
  if (!el) return;
  if (!window._spState.profileId) { el.innerHTML = '<div style="color:#9CA3AF">Pick a profile above.</div>'; return; }
  el.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
  try {
    const r = await fetch(`/api/social-publisher/accounts?profileId=${encodeURIComponent(window._spState.profileId)}`).then(x => x.json());
    if (!r.ok) { el.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    const accs = r.accounts || [];
    window._spState.accounts = accs;
    if (!accs.length) { el.innerHTML = '<div style="color:#9CA3AF;font-style:italic">No accounts connected yet. Use "＋ Connect a new platform" below to authorize one.</div>'; return; }
    el.innerHTML = accs.map(a => {
      const plat = (a.platform || '').toLowerCase();
      const meta = _spPlatforms.find(p => p.id === plat) || { icon:'•', label: plat };
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:5px">
        <div><span style="font-size:0.95rem">${meta.icon}</span> <strong style="color:#0A1628">${_escapeHtml(meta.label)}</strong> · <span style="color:#6B7280;font-size:0.78rem">${_escapeHtml(a.username || a.handle || a.name || a._id || a.id || '')}</span></div>
        <span style="background:#ECFDF5;color:#065F46;padding:2px 7px;border-radius:4px;font-size:0.7rem;font-weight:700">connected</span>
      </div>`;
    }).join('');
  } catch (e) { el.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

async function _spConnect(platform) {
  if (!window._spState.profileId) { _spStatus('Pick a profile first.', 'err'); return; }
  _spStatus(`Getting OAuth URL for ${platform}…`, 'info');
  try {
    const r = await fetch('/api/social-publisher/connect-url', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ platform, profileId: window._spState.profileId })
    }).then(x => x.json());
    if (!r.ok) { _spStatus(`❌ ${r.error}`, 'err'); return; }
    const url = r.authUrl?.url || r.authUrl;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      _spStatus(`✅ Opening ${platform} authorization in a new tab…`, 'ok');
      window.open(url, '_blank', 'noopener');
    } else { _spStatus(`Got response but no auth URL: ${JSON.stringify(r.authUrl).slice(0,200)}`, 'err'); }
  } catch (e) { _spStatus(`Network error: ${e.message}`, 'err'); }
}

async function _spPublish() {
  const text = document.getElementById('spText').value.trim();
  const platforms = Array.from(window._spState.selectedPlatforms);
  const sched = document.getElementById('spSchedule').value;
  const media = document.getElementById('spMedia').value.trim();
  const result = document.getElementById('spResult');

  if (!window._spState.profileId) { result.innerHTML = '<div style="color:#991B1B">⚠ Pick a profile first.</div>'; return; }
  if (!text && !media) { result.innerHTML = '<div style="color:#991B1B">⚠ Enter text or a media URL.</div>'; return; }
  if (!platforms.length) { result.innerHTML = '<div style="color:#991B1B">⚠ Select at least one platform.</div>'; return; }

  result.innerHTML = '<div style="color:#6B7280">📤 Sending to Zernio…</div>';
  try {
    const body = { text, platforms, profileId: window._spState.profileId };
    if (sched) body.scheduledFor = new Date(sched).toISOString();
    if (media) body.mediaUrls = [media];
    const r = await fetch('/api/social-publisher/post', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
    }).then(x => x.json());
    if (!r.ok) { result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:10px;border-radius:6px">❌ ${_escapeHtml(r.error)}</div>`; return; }
    result.innerHTML = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:10px;border-radius:6px">✅ ${r.scheduled ? 'Scheduled' : 'Published'} to ${platforms.length} platform${platforms.length>1?'s':''}!</div>`;
    document.getElementById('spText').value = '';
    document.getElementById('spSchedule').value = '';
    document.getElementById('spMedia').value = '';
    setTimeout(_spLoadPosts, 700);
  } catch (e) { result.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

async function _spLoadPosts() {
  const el = document.getElementById('spPosts');
  if (!el) return;
  if (!window._spState.profileId) { el.innerHTML = '<div style="color:#9CA3AF">Pick a profile above.</div>'; return; }
  el.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
  try {
    const r = await fetch(`/api/social-publisher/posts?profileId=${encodeURIComponent(window._spState.profileId)}`).then(x => x.json());
    if (!r.ok) { el.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    const posts = r.posts || [];
    if (!posts.length) { el.innerHTML = '<div style="color:#9CA3AF;font-style:italic">No posts yet for this profile.</div>'; return; }
    el.innerHTML = `<div style="display:grid;gap:8px">${posts.slice(0, 30).map(p => {
      const id = p._id || p.id || '';
      const status = (p.status || 'unknown').toLowerCase();
      const statusColors = { scheduled:['#EFF6FF','#1E40AF'], posted:['#ECFDF5','#065F46'], published:['#ECFDF5','#065F46'], draft:['#F3F4F6','#374151'], failed:['#FEF2F2','#991B1B'], error:['#FEF2F2','#991B1B'] };
      const sc = statusColors[status] || ['#F3F4F6','#374151'];
      const when = p.scheduledFor || p.createdAt || p.created_at || '';
      const plats = Array.isArray(p.platforms) ? p.platforms : (p.platform ? [p.platform] : []);
      return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:11px">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:6px">
          <div style="flex:1;color:#0A1628;font-size:0.82rem;line-height:1.45">${_escapeHtml((p.text || '').slice(0, 200))}${(p.text||'').length>200?'…':''}</div>
          <span style="background:${sc[0]};color:${sc[1]};padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;flex-shrink:0">${_escapeHtml(status)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:0.72rem;color:#6B7280;flex-wrap:wrap">
          <div>${plats.map(pl => { const m = _spPlatforms.find(x=>x.id===String(pl).toLowerCase()); return m ? `${m.icon} ${_escapeHtml(m.label)}` : _escapeHtml(String(pl)); }).join(' · ')}${when ? ' · ' + _escapeHtml(new Date(when).toLocaleString()) : ''}</div>
          ${id && (status==='scheduled' || status==='draft') ? `<button onclick="_spDelete('${_escapeHtml(id)}')" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:3px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;cursor:pointer">🗑 Cancel</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch (e) { el.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

window._spDelete = async function(id) {
  if (!confirm('Cancel this scheduled post?')) return;
  try {
    const r = await fetch(`/api/social-publisher/posts/${encodeURIComponent(id)}`, { method:'DELETE' }).then(x => x.json());
    if (!r.ok) { alert('Failed: ' + r.error); return; }
    _spLoadPosts();
  } catch (e) { alert('Network error: ' + e.message); }
};

// ============================================================================
// TIER 15 — Reusable "Publish to Social" modal (used by Reply Assistant,
// Press Release, Counter-Message, etc). Opens an overlay, lets user pick
// platforms + optional schedule + media, then POSTs to /api/social-publisher.
// ============================================================================
window._spOpenPublishModal = async function(opts) {
  opts = opts || {};
  const initialText = String(opts.text || '').slice(0, 5000);
  const initialMedia = String(opts.mediaUrl || '');
  const sourceLabel = String(opts.sourceLabel || 'Publish to Social');

  let modal = document.getElementById('spPubModal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'spPubModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;width:100%;max-width:620px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.35)">
      <div style="background:linear-gradient(135deg,#FF5722 0%,#FF7043 100%);padding:14px 20px;display:flex;justify-content:space-between;align-items:center;color:#fff">
        <div>
          <div style="font-family:Sora,sans-serif;font-weight:800;font-size:1rem">📤 ${_escapeHtml(sourceLabel)}</div>
          <div style="font-size:0.72rem;opacity:.85;margin-top:2px">Pick platforms · post now or schedule · powered by Zernio</div>
        </div>
        <button id="spmClose" style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);color:#fff;padding:6px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">✕ Close</button>
      </div>
      <div style="padding:18px;overflow-y:auto;flex:1">
        <div id="spmStatus" style="display:none;padding:9px 12px;border-radius:6px;font-size:0.78rem;margin-bottom:12px"></div>
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">PROFILE</label>
          <select id="spmProfile" style="width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem"><option>Loading…</option></select>
        </div>
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">POST TEXT</label>
          <textarea id="spmText" rows="5" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
          <div style="font-size:0.68rem;color:#9CA3AF;margin-top:3px"><span id="spmCount">0</span> chars</div>
        </div>
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:6px">PUBLISH TO</label>
          <div id="spmChips" style="display:flex;flex-wrap:wrap;gap:6px"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px">
          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">📅 SCHEDULE (optional)</label>
            <input type="datetime-local" id="spmSched" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">🖼 MEDIA URL (optional)</label>
            <input type="url" id="spmMedia" placeholder="https://…" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;box-sizing:border-box">
          </div>
        </div>
      </div>
      <div style="padding:14px 18px;border-top:1px solid #E5E7EB;background:#F9FAFB;display:flex;justify-content:space-between;align-items:center;gap:10px">
        <a href="#" id="spmManage" style="font-size:0.74rem;color:#6B7280;text-decoration:underline">⚙ Manage profiles & connected accounts</a>
        <button id="spmPublish" style="background:linear-gradient(135deg,#FF5722 0%,#FF7043 100%);color:#fff;border:none;padding:10px 20px;border-radius:7px;font-size:0.86rem;font-weight:800;cursor:pointer">📤 Publish</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById('spmText').value = initialText;
  document.getElementById('spmMedia').value = initialMedia;
  document.getElementById('spmCount').textContent = initialText.length;
  document.getElementById('spmText').addEventListener('input', e => { document.getElementById('spmCount').textContent = e.target.value.length; });
  document.getElementById('spmClose').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.getElementById('spmManage').addEventListener('click', e => { e.preventDefault(); modal.remove(); if (typeof navigateTo === 'function') navigateTo('social-publisher'); });

  // Render platform chips (uses _spPlatforms from buildSocialPublisher)
  const plats = (window._spPlatforms || (typeof _spPlatforms !== 'undefined' ? _spPlatforms : [
    {id:'twitter',label:'Twitter/X',icon:'𝕏'},{id:'instagram',label:'Instagram',icon:'📷'},
    {id:'facebook',label:'Facebook',icon:'📘'},{id:'linkedin',label:'LinkedIn',icon:'💼'},
    {id:'tiktok',label:'TikTok',icon:'🎵'},{id:'youtube',label:'YouTube',icon:'▶️'},
    {id:'pinterest',label:'Pinterest',icon:'📌'},{id:'reddit',label:'Reddit',icon:'👽'},
    {id:'bluesky',label:'Bluesky',icon:'🦋'},{id:'threads',label:'Threads',icon:'@'},
    {id:'googlebusiness',label:'Google Business',icon:'🏢'},{id:'telegram',label:'Telegram',icon:'✈️'},
    {id:'snapchat',label:'Snapchat',icon:'👻'},{id:'whatsapp',label:'WhatsApp',icon:'💬'},
    {id:'discord',label:'Discord',icon:'🎮'}
  ]));
  window._spPlatforms = plats;
  const selected = new Set(opts.platforms || []);
  document.getElementById('spmChips').innerHTML = plats.map(p =>
    `<button data-p="${p.id}" class="spm-chip" style="background:${selected.has(p.id)?'#FF5722':'#F3F4F6'};color:${selected.has(p.id)?'#fff':'#374151'};border:1px solid ${selected.has(p.id)?'#FF5722':'#E5E7EB'};padding:6px 10px;border-radius:16px;font-size:0.72rem;font-weight:700;cursor:pointer">${p.icon} ${_escapeHtml(p.label)}</button>`
  ).join('');
  document.querySelectorAll('#spmChips .spm-chip').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.p;
    if (selected.has(id)) { selected.delete(id); b.style.background='#F3F4F6'; b.style.color='#374151'; b.style.borderColor='#E5E7EB'; }
    else { selected.add(id); b.style.background='#FF5722'; b.style.color='#fff'; b.style.borderColor='#FF5722'; }
  }));

  // Load profiles
  const profSel = document.getElementById('spmProfile');
  const status = document.getElementById('spmStatus');
  function setStatus(msg, kind) {
    if (!msg) { status.style.display='none'; return; }
    const colors = { ok:['#ECFDF5','#065F46'], err:['#FEF2F2','#991B1B'], info:['#FFF7ED','#9A3412'] };
    const c = colors[kind||'info']; status.style.background=c[0]; status.style.color=c[1]; status.style.display='block'; status.textContent=msg;
  }
  async function checkAccounts(profileId) {
    if (!profileId) return;
    try {
      const a = await fetch(`/api/social-publisher/accounts?profileId=${encodeURIComponent(profileId)}`).then(x => x.json());
      const accs = (a.ok && a.accounts) ? a.accounts : [];
      const banner = document.getElementById('spmNoAccts');
      if (!accs.length) {
        if (!banner) {
          const div = document.createElement('div');
          div.id = 'spmNoAccts';
          div.style.cssText = 'background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:11px 13px;border-radius:7px;font-size:0.78rem;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap';
          div.innerHTML = `<div><strong>⚠ No accounts connected</strong> — Zernio can't post until you authorize at least one platform (Twitter, LinkedIn, Instagram, etc.).</div>
            <button id="spmGoConnect" style="background:#FF5722;color:#fff;border:none;padding:6px 12px;border-radius:5px;font-size:0.74rem;font-weight:800;cursor:pointer;white-space:nowrap">→ Connect now</button>`;
          status.parentNode.insertBefore(div, status.nextSibling);
          document.getElementById('spmGoConnect').addEventListener('click', () => {
            modal.remove();
            if (typeof navigateTo === 'function') navigateTo('social-publisher');
          });
        }
      } else if (banner) banner.remove();
      // Show which platforms are connected as a subtle hint
      const connected = new Set(accs.map(x => String(x.platform || '').toLowerCase()));
      document.querySelectorAll('#spmChips .spm-chip').forEach(b => {
        if (!connected.has(b.dataset.p)) { b.style.opacity = '0.55'; b.title = 'Not connected — click "Connect now" to authorize'; }
        else { b.style.opacity = '1'; b.title = '✓ Connected'; }
      });
    } catch(_) {}
  }

  try {
    const r = await fetch('/api/social-publisher/profiles').then(x => x.json());
    if (!r.ok) { profSel.innerHTML = `<option value="">⚠ ${_escapeHtml(r.error)}</option>`; setStatus(r.error, 'err'); }
    else if (!r.profiles?.length) {
      profSel.innerHTML = `<option value="">No profiles yet — open Social Publisher to create one</option>`;
      setStatus('Create a Zernio profile first via Reach → Social Publisher.', 'info');
    } else {
      profSel.innerHTML = r.profiles.map(p => `<option value="${_escapeHtml(p._id || p.id)}">${_escapeHtml(p.name || p._id || p.id)}</option>`).join('');
      profSel.addEventListener('change', () => checkAccounts(profSel.value));
      await checkAccounts(profSel.value);
    }
  } catch (e) { profSel.innerHTML = `<option value="">Network error</option>`; setStatus('Network error: ' + e.message, 'err'); }

  document.getElementById('spmPublish').addEventListener('click', async () => {
    const profileId = profSel.value;
    const text = document.getElementById('spmText').value.trim();
    const media = document.getElementById('spmMedia').value.trim();
    const sched = document.getElementById('spmSched').value;
    const platforms = Array.from(selected);
    if (!profileId) return setStatus('Pick a profile first.', 'err');
    if (!text && !media) return setStatus('Enter text or a media URL.', 'err');
    if (!platforms.length) return setStatus('Select at least one platform.', 'err');
    setStatus('📤 Sending to Zernio…', 'info');
    try {
      const body = { text, platforms, profileId };
      if (sched) body.scheduledFor = new Date(sched).toISOString();
      if (media) body.mediaUrls = [media];
      const r = await fetch('/api/social-publisher/post', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(x => x.json());
      if (!r.ok) return setStatus('❌ ' + r.error, 'err');
      setStatus(`✅ ${r.scheduled ? 'Scheduled' : 'Published'} to ${platforms.length} platform${platforms.length>1?'s':''}!`, 'ok');
      setTimeout(() => modal.remove(), 1400);
    } catch (e) { setStatus('Network error: ' + e.message, 'err'); }
  });
};

// Helper used by Press Release / Counter-Message — extracts text from a DOM element
window._spPublishFromEl = function(elId, sourceLabel, platforms) {
  const el = document.getElementById(elId);
  if (!el) { showToast('⚠️ Source not found'); return; }
  const text = (el.innerText || el.textContent || '').trim();
  if (!text) { showToast('⚠️ No text to publish'); return; }
  window._spOpenPublishModal({ text, sourceLabel: sourceLabel || 'Publish to Social', platforms: platforms || [] });
};

// Bulk schedule all Content Calendar posts to Zernio
window._ccScheduleAll = async function() {
  const posts = window._ccLastPosts || [];
  if (!posts.length) { showToast('⚠️ Generate a calendar first'); return; }
  // Profile picker via prompt
  let profiles;
  try {
    const r = await fetch('/api/social-publisher/profiles').then(x => x.json());
    if (!r.ok) { showToast('❌ ' + r.error); return; }
    profiles = r.profiles || [];
  } catch (e) { showToast('Network error: ' + e.message); return; }
  if (!profiles.length) {
    if (confirm('No Zernio profiles yet. Open Social Publisher to create one?')) navigateTo('social-publisher');
    return;
  }
  const profileId = profiles.length === 1 ? (profiles[0]._id || profiles[0].id) :
    (function(){ const choice = prompt('Pick a profile by number:\n\n' + profiles.map((p,i)=>`${i+1}. ${p.name}`).join('\n'));
      const idx = parseInt(choice,10)-1;
      return (idx>=0 && profiles[idx]) ? (profiles[idx]._id || profiles[idx].id) : null;
    })();
  if (!profileId) return;

  // Map our channels → Zernio platform ids (x → twitter, blog/email → skipped)
  const platformMap = { instagram:'instagram', tiktok:'tiktok', linkedin:'linkedin', x:'twitter', twitter:'twitter', facebook:'facebook', youtube:'youtube' };
  const items = posts.map(p => {
    const channel = String(p.channel||'').toLowerCase();
    const mapped = platformMap[channel];
    if (!mapped) return null;
    const dateStr = p.date && p.best_time ? `${p.date} ${p.best_time}` : (p.date || null);
    let scheduledFor = null;
    if (dateStr) { const d = new Date(dateStr); if (!isNaN(d)) scheduledFor = d.toISOString(); }
    const text = [p.hook, p.copy, p.cta, Array.isArray(p.hashtags)?p.hashtags.join(' '):''].filter(Boolean).join('\n\n').trim();
    return { date: scheduledFor, channel: mapped, copy: text };
  }).filter(Boolean);

  if (!items.length) { showToast('⚠️ No posts mapped to Zernio platforms (blog/email skipped)'); return; }
  if (!confirm(`Schedule ${items.length} post(s) to Zernio across ${[...new Set(items.map(i=>i.channel))].join(', ')}?\n\n(Posts on blog/email channels are skipped — Zernio handles social only.)`)) return;

  const status = document.getElementById('ccOut');
  const banner = document.createElement('div');
  banner.style.cssText = 'background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;padding:12px;border-radius:8px;margin-bottom:12px;font-size:0.84rem';
  banner.textContent = `📤 Scheduling ${items.length} posts to Zernio…`;
  status.prepend(banner);

  try {
    const r = await fetch('/api/social-publisher/schedule-calendar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ profileId, items })
    }).then(x => x.json());
    if (!r.ok) { banner.style.background='#FEF2F2'; banner.style.borderColor='#FECACA'; banner.style.color='#991B1B'; banner.textContent = '❌ ' + r.error; return; }
    banner.style.background = r.failed ? '#FFF7ED' : '#ECFDF5';
    banner.style.borderColor = r.failed ? '#FED7AA' : '#A7F3D0';
    banner.style.color = r.failed ? '#9A3412' : '#065F46';
    banner.textContent = `✅ Scheduled ${r.scheduled}/${r.total}${r.failed?` · ${r.failed} failed (open Social Publisher to inspect)`:''}`;
  } catch (e) { banner.style.background='#FEF2F2'; banner.style.color='#991B1B'; banner.textContent = 'Network error: ' + e.message; }
};

// ============================================================================
// TIER 16-A — AI Sales Email Personalizer
// ============================================================================
window.buildEmailPersonalizer = function() {
  const wrap = document.getElementById('epWrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📝 Base Template</h3>
        <div style="display:flex;gap:6px">
          <button id="epPullLeads" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">⬇ Pull leads from B2B Lead Finder</button>
          <button id="epLoadSample" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">📋 Load sample</button>
        </div>
      </div>
      <textarea id="epTemplate" rows="6" placeholder="Hi [FIRST_NAME], I noticed [COMPANY] is doing X — wanted to ask about Y. Worth 15 min?" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
      <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">Tokens supported: [NAME] [FIRST_NAME] [COMPANY] [ROLE] [WEBSITE]. AI will replace + personalize using each lead's website.</div>
      <div style="display:grid;grid-template-columns:1fr 200px;gap:10px;margin-top:12px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:4px">TONE</label>
          <input id="epTone" placeholder="professional, warm, specific" value="professional, warm, specific" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;box-sizing:border-box">
        </div>
        <div style="display:flex;align-items:end">
          <label style="display:flex;gap:6px;align-items:center;font-size:0.78rem;color:#374151;font-weight:600;cursor:pointer">
            <input type="checkbox" id="epResearch" checked> Use website research (Firecrawl)
          </label>
        </div>
      </div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">👥 Leads (one per line, JSON)</h3>
      <textarea id="epLeads" rows="6" placeholder='{"name":"Jane Doe","role":"VP Marketing","company":"Acme Corp","website":"acme.com"}' style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;font-family:monospace;resize:vertical;box-sizing:border-box"></textarea>
      <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">Each line = one lead JSON. Max 25 per batch.</div>
      <button id="epGo" style="margin-top:14px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:0.86rem;font-weight:800;cursor:pointer">✨ Personalize All</button>
    </div>

    <div id="epOut"></div>
  `;

  document.getElementById('epLoadSample').addEventListener('click', () => {
    document.getElementById('epTemplate').value = `Hi [FIRST_NAME],

I noticed [COMPANY] is in the [ROLE]-led growth space. We help teams like yours cut campaign waste 30% with AI-driven optimization.

Would 15 min next week make sense to walk you through how we'd attack [COMPANY] specifically?

Best,
Paul`;
    document.getElementById('epLeads').value = `{"name":"Jane Doe","role":"VP Marketing","company":"Acme Corp","website":"acme.com"}
{"name":"John Smith","role":"Head of Growth","company":"Stripe","website":"stripe.com"}`;
  });

  document.getElementById('epPullLeads').addEventListener('click', () => {
    const cached = window._lfLeads;
    if (!cached || !cached.length) { showToast('⚠ No B2B Lead Finder cache. Run a search there first.'); return; }
    const lines = cached.slice(0, 25).map(l => JSON.stringify({
      name: l.name || l.contact_name || '',
      role: l.title || l.role || '',
      company: l.company || l.company_name || '',
      website: l.website || l.domain || '',
      linkedin: l.linkedin || ''
    })).join('\n');
    document.getElementById('epLeads').value = lines;
    showToast(`✅ Pulled ${Math.min(cached.length, 25)} lead(s)`);
  });

  document.getElementById('epGo').addEventListener('click', _epRun);
};

window._epRun = async function() {
  const template = document.getElementById('epTemplate').value.trim();
  const tone = document.getElementById('epTone').value.trim();
  const research = document.getElementById('epResearch').checked;
  const raw = document.getElementById('epLeads').value.trim();
  const out = document.getElementById('epOut');
  if (!template) { out.innerHTML = '<div style="color:#991B1B">⚠ Template required</div>'; return; }
  const leads = [];
  for (const line of raw.split('\n')) {
    const t = line.trim(); if (!t) continue;
    try { leads.push(JSON.parse(t)); } catch (e) { out.innerHTML = `<div style="color:#991B1B">⚠ Invalid JSON line: ${_escapeHtml(t.slice(0,80))}</div>`; return; }
  }
  if (!leads.length) { out.innerHTML = '<div style="color:#991B1B">⚠ Add at least one lead</div>'; return; }

  out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;color:#6B7280">⏳ Personalizing ${leads.length} email${leads.length>1?'s':''}…${research?' (researching websites — this takes 10-30s)':''}</div>`;
  try {
    const r = await fetch('/api/email-personalizer/bulk', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ template, leads, tone, research })
    }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
    out.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:800;color:#0A1628">✅ ${r.succeeded}/${r.total} personalized · ${r.ai_personalized} via AI · ${r.total - r.ai_personalized} via template</div>
        <button onclick="_epExportCsv()" style="padding:7px 14px;background:#fff;border:2px solid #D1D5DB;border-radius:6px;font-size:0.74rem;font-weight:700;color:#374151;cursor:pointer">📋 Export as CSV</button>
      </div>
      <div style="display:grid;gap:12px">${r.results.map((x,i) => {
        if (!x.ok) return `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:12px;border-radius:8px;font-size:0.82rem">❌ ${_escapeHtml(x.lead?.name||'Unknown')} (${_escapeHtml(x.lead?.company||'')}): ${_escapeHtml(x.error||'failed')}</div>`;
        const e = x.email || {}; const lead = x.lead || {};
        const sourcePill = x.source==='ai' ? 'AI' : 'TEMPLATE';
        const sourceColor = x.source==='ai' ? ['#EDE9FE','#5B21B6'] : ['#F3F4F6','#374151'];
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:3px solid #7C3AED;border-radius:10px;padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px;flex-wrap:wrap">
            <div style="font-weight:700;color:#0A1628;font-size:0.88rem">${_escapeHtml(lead.name||'?')} · <span style="color:#6B7280;font-weight:500">${_escapeHtml(lead.role||'')} @ ${_escapeHtml(lead.company||'')}</span></div>
            <div style="display:flex;gap:6px;align-items:center">
              <span style="background:${sourceColor[0]};color:${sourceColor[1]};padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:800">${sourcePill}${x.research_used?' + RESEARCH':''}</span>
              <button onclick="_epCopyEmail(${i})" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:4px 10px;border-radius:5px;font-size:0.7rem;font-weight:700;cursor:pointer">📋 Copy</button>
            </div>
          </div>
          <div id="epEmail-${i}">
            <div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:6px">Subject: ${_escapeHtml(e.subject||'')}</div>
            <div style="color:#374151;font-size:0.84rem;line-height:1.55;white-space:pre-wrap">${_escapeHtml(e.body||'')}</div>
          </div>
          ${e.reasoning?`<div style="margin-top:8px;font-size:0.7rem;color:#6B7280;font-style:italic">💡 ${_escapeHtml(e.reasoning)}</div>`:''}
        </div>`;
      }).join('')}</div>`;
    window._epLastResults = r.results;
  } catch (e) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">Network error: ${_escapeHtml(e.message)}</div>`; }
};

window._epCopyEmail = async function(i) {
  const el = document.getElementById('epEmail-' + i); if (!el) return;
  try { await navigator.clipboard.writeText(el.innerText || el.textContent); showToast('✅ Copied'); } catch (e) { showToast('❌ ' + e.message); }
};

window._epExportCsv = function() {
  const results = window._epLastResults || [];
  if (!results.length) return;
  const headers = ['name','role','company','website','source','subject','body'];
  const rows = results.filter(r => r.ok).map(r => [
    r.lead.name||'', r.lead.role||'', r.lead.company||'', r.lead.website||'', r.source||'',
    (r.email?.subject||''), (r.email?.body||'')
  ].map(v => '"' + String(v).replace(/"/g,'""') + '"').join(','));
  const csv = [headers.join(',')].concat(rows).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'personalized-emails.csv'; a.click();
};

// ============================================================================
// TIER 16-B — YouTube Channel Monitor
// ============================================================================
window.buildYoutubeMonitor = async function() {
  const wrap = document.getElementById('ymWrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">➕ Track a YouTube Channel</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1.4fr auto;gap:8px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND</label><input id="ymBrand" placeholder="e.g. Nike" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">CHANNEL NAME</label><input id="ymName" placeholder="e.g. MrBeast" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">CHANNEL URL</label><input id="ymUrl" placeholder="https://www.youtube.com/@MrBeast" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <button id="ymAdd" style="background:linear-gradient(135deg,#FF0000,#FF4444);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:0.78rem;font-weight:800;cursor:pointer">➕ Track</button>
      </div>
    </div>
    <div id="ymList"></div>
  `;
  document.getElementById('ymAdd').addEventListener('click', _ymAdd);
  await _ymLoad();
  // Delegated handler for "💬 Mine" buttons (rendered inside ymList)
  document.getElementById('ymList').addEventListener('click', e => {
    const btn = e.target.closest('.ym-mine-btn');
    if (!btn) return;
    window._ycmPresetChannelId = btn.getAttribute('data-mine-ch');
    const navLink = document.querySelector('[data-view="yt-comment-miner"]');
    if (navLink) navLink.click();
  });
};

async function _ymLoad() {
  const list = document.getElementById('ymList');
  list.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
  try {
    const r = await fetch('/api/youtube-monitor/channels').then(x => x.json());
    if (!r.ok) { list.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.channels.length) { list.innerHTML = '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280;font-size:0.88rem">No channels tracked yet. Add one above (e.g. <code>https://www.youtube.com/@MrBeast</code>).</div>'; return; }
    list.innerHTML = r.channels.map(c => `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px">
          <div>
            <div style="font-weight:800;color:#0A1628;font-size:1rem">▶️ ${_escapeHtml(c.channel_name)}</div>
            <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${_escapeHtml(c.brand)} · ${_safeUrl(c.channel_url) ? `<a href="${_safeUrl(c.channel_url)}" target="_blank" rel="noopener" style="color:#0066FF">${_escapeHtml(c.channel_url)}</a>` : _escapeHtml(c.channel_url)}</div>
            <div style="font-size:0.68rem;color:#9CA3AF;margin-top:2px">${c.last_scanned_at ? 'Last scanned ' + new Date(c.last_scanned_at).toLocaleString() : 'Never scanned'}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button onclick="_ymScan(${c.id})" style="background:linear-gradient(135deg,#FF0000,#FF4444);color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:0.74rem;font-weight:800;cursor:pointer">🔍 Scan now</button>
            <button onclick="_ymHistory(${c.id})" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">📜 History</button>
            <button data-mine-ch="${c.id}" class="ym-mine-btn" style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1D4ED8;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">💬 Mine</button>
            <button onclick="_ymDelete(${c.id})" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">🗑</button>
          </div>
        </div>
        <div id="ymRes-${c.id}" style="margin-top:10px;font-size:0.82rem;color:#9CA3AF"></div>
      </div>
    `).join('');
  } catch (e) { list.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

window._ymAdd = async function() {
  const brand = document.getElementById('ymBrand').value.trim();
  const channel_name = document.getElementById('ymName').value.trim();
  const channel_url = document.getElementById('ymUrl').value.trim();
  if (!brand || !channel_name || !channel_url) { showToast('⚠ All fields required'); return; }
  try {
    const r = await fetch('/api/youtube-monitor/channels', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ brand, channel_name, channel_url })
    }).then(x => x.json());
    if (!r.ok) { showToast('❌ ' + r.error); return; }
    document.getElementById('ymName').value = ''; document.getElementById('ymUrl').value = '';
    await _ymLoad();
    showToast('✅ Channel tracked');
  } catch (e) { showToast('Network error: ' + e.message); }
};

window._ymScan = async function(id) {
  const out = document.getElementById('ymRes-' + id);
  out.innerHTML = '⏳ Scanning via Perplexity…';
  try {
    const r = await fetch(`/api/youtube-monitor/scan/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.videos.length) { out.innerHTML = `<div style="color:#9CA3AF">${_escapeHtml(r.note||'No videos')}</div>`; return; }
    _ymRender(out, r.videos);
    await _ymLoad();
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
};

window._ymHistory = async function(id) {
  const out = document.getElementById('ymRes-' + id);
  out.innerHTML = '⏳ Loading history…';
  try {
    const r = await fetch(`/api/youtube-monitor/history/${id}`).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.snapshots.length) { out.innerHTML = '<div style="color:#9CA3AF">No history yet — click Scan now.</div>'; return; }
    _ymRender(out, r.snapshots.map(s => ({ title:s.video_title, url:s.video_url, published_at:s.published_at, view_count:s.view_count, like_count:s.like_count, comment_count:s.comment_count, sentiment:s.sentiment, summary:s.summary })));
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
};

function _ymRender(el, videos) {
  const sentColor = { positive:['#ECFDF5','#065F46'], neutral:['#F3F4F6','#374151'], negative:['#FEF2F2','#991B1B'] };
  el.innerHTML = `<div style="display:grid;gap:8px">${videos.map(v => {
    const sc = sentColor[(v.sentiment||'neutral').toLowerCase()] || sentColor.neutral;
    const views = v.view_count ? Number(v.view_count).toLocaleString() : '?';
    return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
        <div style="flex:1">
          <div style="font-weight:700;color:#0A1628;font-size:0.86rem;line-height:1.35">${v.url && _safeUrl(v.url) ? `<a href="${_safeUrl(v.url)}" target="_blank" rel="noopener" style="color:#0A1628;text-decoration:none">${_escapeHtml(v.title||'')}</a>` : _escapeHtml(v.title||'')}</div>
          <div style="font-size:0.74rem;color:#6B7280;margin-top:3px">${_escapeHtml(String(v.published_at||''))} · 👁 ${views}${v.like_count?` · 👍 ${Number(v.like_count).toLocaleString()}`:''}${v.comment_count?` · 💬 ${Number(v.comment_count).toLocaleString()}`:''}</div>
          ${v.summary?`<div style="font-size:0.78rem;color:#374151;margin-top:4px;line-height:1.45">${_escapeHtml(v.summary)}</div>`:''}
        </div>
        <span style="background:${sc[0]};color:${sc[1]};padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;flex-shrink:0;height:fit-content">${_escapeHtml(v.sentiment||'neutral')}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

window._ymDelete = async function(id) {
  if (!confirm('Stop tracking this channel? (history retained)')) return;
  try { await fetch(`/api/youtube-monitor/channels/${id}`, { method:'DELETE' }); await _ymLoad(); }
  catch (e) { showToast('Network error: ' + e.message); }
};

// ============================================================================
// TIER 16-C — Weekly Auto-PDF Report
// ============================================================================
window.buildWeeklyReport = async function() {
  const wrap = document.getElementById('wrWrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📑 Generate / Send Now</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:8px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND</label><input id="wrBrand" placeholder="e.g. Nike" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">EMAIL TO (for send)</label><input id="wrEmail" type="email" placeholder="you@example.com" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <button id="wrPreview" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:8px 14px;border-radius:6px;font-size:0.76rem;font-weight:700;cursor:pointer">👁 Preview</button>
        <button id="wrPdf" style="background:#1E1B4B;color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:0.76rem;font-weight:800;cursor:pointer">📥 Download PDF</button>
        <button id="wrSend" style="background:linear-gradient(135deg,#059669,#10B981);color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:0.76rem;font-weight:800;cursor:pointer">📨 Send now</button>
      </div>
      <div id="wrPreviewOut" style="margin-top:14px"></div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📬 Auto-send subscriptions (every 7 days)</h3>
        <button id="wrAddSub" style="background:#1E1B4B;color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:0.74rem;font-weight:800;cursor:pointer">＋ Add</button>
      </div>
      <div id="wrSubs" style="font-size:0.84rem;color:#9CA3AF">Loading…</div>
    </div>

    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📜 Recent runs</h3>
      <div id="wrRuns" style="font-size:0.84rem;color:#9CA3AF">Loading…</div>
    </div>
  `;
  document.getElementById('wrPreview').addEventListener('click', _wrPreview);
  document.getElementById('wrPdf').addEventListener('click', _wrPdf);
  document.getElementById('wrSend').addEventListener('click', _wrSend);
  document.getElementById('wrAddSub').addEventListener('click', _wrAddSub);
  await _wrLoadSubs();
  await _wrLoadRuns();
};

async function _wrPreview() {
  const brand = document.getElementById('wrBrand').value.trim();
  if (!brand) { showToast('⚠ Brand required'); return; }
  const out = document.getElementById('wrPreviewOut');
  out.innerHTML = '<div style="color:#9CA3AF">⏳ Building report from your last 7 days of data…</div>';
  try {
    const r = await fetch('/api/weekly-report/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand }) }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    out.innerHTML = `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px;font-size:0.84rem">
      <div style="font-weight:800;color:#0A1628;margin-bottom:8px">${_escapeHtml(r.report.title)} · ${r.report.sections.length} section(s)</div>
      ${r.report.sections.map(s => `<div style="margin:6px 0;padding:8px;background:#fff;border-radius:6px;border-left:3px solid #1E1B4B">
        <div style="font-weight:700;color:#0A1628">${_escapeHtml(s.title)}</div>
        ${s.kind==='table' ? `<div style="font-size:0.74rem;color:#6B7280;margin-top:3px">${s.rows.length} row(s)</div>` : `<div style="font-size:0.78rem;color:#374151;margin-top:3px">${_escapeHtml(s.body||'')}</div>`}
      </div>`).join('')}
    </div>`;
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

function _wrPdf() {
  const brand = document.getElementById('wrBrand').value.trim();
  if (!brand) { showToast('⚠ Brand required'); return; }
  window.open(`/api/weekly-report/pdf?brand=${encodeURIComponent(brand)}`, '_blank');
}

async function _wrSend() {
  const brand = document.getElementById('wrBrand').value.trim();
  const email = document.getElementById('wrEmail').value.trim();
  if (!brand || !email) { showToast('⚠ Brand + email required'); return; }
  const out = document.getElementById('wrPreviewOut');
  out.innerHTML = '<div style="color:#9CA3AF">⏳ Sending via Resend…</div>';
  try {
    const r = await fetch('/api/weekly-report/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, email }) }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    out.innerHTML = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46;padding:12px;border-radius:8px">✅ Sent to ${_escapeHtml(r.sent_to)} · ${r.sections} section(s). Download PDF: <a href="/api/weekly-report/pdf?brand=${encodeURIComponent(brand)}" target="_blank" style="color:#065F46;font-weight:700">here</a></div>`;
    await _wrLoadRuns();
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

async function _wrAddSub() {
  const brand = document.getElementById('wrBrand').value.trim();
  const email = document.getElementById('wrEmail').value.trim();
  if (!brand || !email) { showToast('⚠ Fill brand + email above first'); return; }
  try {
    const r = await fetch('/api/weekly-report/subs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, email }) }).then(x => x.json());
    if (!r.ok) { showToast('❌ ' + r.error); return; }
    showToast('✅ Subscription saved'); await _wrLoadSubs();
  } catch (e) { showToast('Network error: ' + e.message); }
}

async function _wrLoadSubs() {
  const el = document.getElementById('wrSubs');
  try {
    const r = await fetch('/api/weekly-report/subs').then(x => x.json());
    if (!r.ok) { el.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.subs.length) { el.innerHTML = '<div style="color:#9CA3AF;font-style:italic">No subscriptions yet. Add one above to get a weekly auto-emailed PDF.</div>'; return; }
    el.innerHTML = r.subs.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;margin-bottom:5px">
      <div><strong style="color:#0A1628">${_escapeHtml(s.brand)}</strong> → <span style="color:#6B7280">${_escapeHtml(s.email)}</span></div>
      <div style="font-size:0.7rem;color:#9CA3AF">${s.last_sent_at ? 'Last sent ' + new Date(s.last_sent_at).toLocaleDateString() : 'Never sent'} <button onclick="_wrDelSub(${s.id})" style="margin-left:10px;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700;cursor:pointer">🗑</button></div>
    </div>`).join('');
  } catch (e) { el.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

window._wrDelSub = async function(id) {
  if (!confirm('Cancel this subscription?')) return;
  await fetch(`/api/weekly-report/subs/${id}`, { method:'DELETE' });
  await _wrLoadSubs();
};

async function _wrLoadRuns() {
  const el = document.getElementById('wrRuns');
  try {
    const r = await fetch('/api/weekly-report/runs').then(x => x.json());
    if (!r.ok) { el.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.runs.length) { el.innerHTML = '<div style="color:#9CA3AF;font-style:italic">No runs yet.</div>'; return; }
    el.innerHTML = `<div style="display:grid;gap:5px">${r.runs.slice(0, 15).map(run => `<div style="display:flex;justify-content:space-between;padding:6px 10px;background:#F9FAFB;border-radius:5px;font-size:0.8rem">
      <div><strong>${_escapeHtml(run.brand)}</strong> · ${run.sections_count} sections</div>
      <div style="color:#6B7280">${run.sent_to ? '📧 ' + _escapeHtml(run.sent_to) : '📥 download only'} · ${new Date(run.generated_at).toLocaleString()}</div>
    </div>`).join('')}</div>`;
  } catch (e) { el.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

// ============================================================================
// TIER 17-A — Reddit & Community Pulse
// ============================================================================
window.buildRedditPulse = function() {
  const wrap = document.getElementById('rpWrap'); if (!wrap) return;
  const ownBrand = (window.analysisData && window.analysisData.brandName) || '';
  const compNames = (window.analysisData && Array.isArray(window.analysisData.competitors))
    ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 15)
    : [];
  const pickerOpts = [
    ownBrand ? `<option value="${_escapeHtml(ownBrand)}">${_escapeHtml(ownBrand)} (your brand)</option>` : '',
    ...compNames.map(n => `<option value="${_escapeHtml(n)}">${_escapeHtml(n)}</option>`)
  ].filter(Boolean).join('');
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">🔍 Scan Reddit</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND <span style="color:#15803D;font-weight:600">(auto-filled from your analysis)</span></label>
          ${pickerOpts
            ? `<select id="rpPick" onchange="window._rpPickChange()" style="width:100%;padding:6px 9px;border:1.5px solid #D1D5DB;border-radius:5px;font-size:0.76rem;background:#F9FAFB;margin-bottom:4px;box-sizing:border-box">
                 <option value="">— Pick from your analysis (or type below) —</option>
                 ${pickerOpts}
               </select>`
            : `<div style="font-size:0.68rem;color:#9CA3AF;margin-bottom:4px">💡 Run an analysis to unlock pickers.</div>`}
          <input id="rpBrand" value="${_escapeHtml(ownBrand)}" placeholder="e.g. Nike" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box;background:${ownBrand?'#F0FDF4':'#fff'}">
        </div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">SUBREDDITS (comma-sep, no r/)</label><input id="rpSubs" placeholder="all, marketing, sneakers" value="all" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
      </div>
      <div>
        <label style="display:flex;align-items:center;justify-content:space-between;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">
          <span>EXTRA KEYWORDS (optional, comma-sep)</span>
          <button type="button" onclick="window._rpKwSuggest()" title="Pull keywords from your last analysis" style="padding:3px 8px;background:linear-gradient(135deg,#7C3AED,#0EA5E9);border:none;border-radius:5px;color:#fff;-webkit-text-fill-color:#fff;font-size:0.6rem;font-weight:700;cursor:pointer;text-transform:none;letter-spacing:0">🤖 AI Suggest</button>
        </label>
        <input id="rpKw" placeholder="defaults to brand name" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
      </div>
      <button id="rpGo" style="margin-top:12px;background:linear-gradient(135deg,#FF4500,#FF8C42);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🔍 Scan now</button>
    </div>
    <div id="rpOut"></div>
  `;
  window._rpPickChange = function() {
    const s = document.getElementById('rpPick'), i = document.getElementById('rpBrand');
    if (s && i && s.value) i.value = s.value;
  };
  window._rpKwSuggest = async function() {
    const input = document.getElementById('rpKw'); if (!input) return;
    const fromAnalysis = (window.analysisData && Array.isArray(window.analysisData.keywords))
      ? window.analysisData.keywords.map(k => typeof k === 'string' ? k : (k.keyword || k.term || '')).filter(Boolean).slice(0, 10)
      : [];
    if (fromAnalysis.length) {
      input.value = fromAnalysis.join(', ');
      showToast(`✨ ${fromAnalysis.length} keywords pulled from your analysis`);
      return;
    }
    const brand = (document.getElementById('rpBrand')?.value || '').trim();
    const industry = (window.analysisData && window.analysisData.industry && window.analysisData.industry.name) || '';
    if (!brand) { showToast('⚠️ Enter a brand first or run an analysis'); return; }
    const orig = input.placeholder; input.placeholder = '⏳ Generating…';
    try {
      const r = await fetch('/api/ai-quick', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: `Return ONLY a comma-separated list of 6 short Reddit-search keywords (1-3 words each) for the brand "${brand}"${industry?` in the ${industry} industry`:''}. No numbering.`, max_tokens: 120 })
      }).then(x => x.text());
      let data; try { data = JSON.parse(r); } catch { data = null; }
      if (data && data.ok && data.text) {
        input.value = data.text.replace(/\n/g,', ').replace(/^[-•\d.\s]+/gm,'').replace(/\s*,\s*/g,', ').replace(/^,\s*|,\s*$/g,'').trim();
        showToast('✨ AI keywords generated');
      } else { showToast('⚠️ AI suggestion unavailable — type manually'); }
    } catch (e) { showToast('❌ ' + (e.message || 'Failed')); }
    finally { input.placeholder = orig; }
  };
  document.getElementById('rpGo').addEventListener('click', async () => {
    const brand = document.getElementById('rpBrand').value.trim();
    const subs = document.getElementById('rpSubs').value.split(',').map(s => s.trim()).filter(Boolean);
    const kws = document.getElementById('rpKw').value.split(',').map(s => s.trim()).filter(Boolean);
    const out = document.getElementById('rpOut');
    if (!brand) { out.innerHTML = '<div style="color:#991B1B">⚠ Brand required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Searching Reddit + classifying sentiment…</div>';
    try {
      const r = await fetch('/api/reddit-pulse/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, subreddits: subs, keywords: kws.length ? kws : undefined }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const sentColor = { positive:['#ECFDF5','#065F46'], neutral:['#F3F4F6','#374151'], negative:['#FEF2F2','#991B1B'] };
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px 18px;margin-bottom:14px;display:flex;justify-content:space-around;text-align:center;gap:10px;flex-wrap:wrap">
          <div><div style="font-size:1.5rem;font-weight:800;color:#0A1628">${r.total}</div><div style="font-size:0.74rem;color:#6B7280;font-weight:700">TOTAL POSTS</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#10B981">${r.counts.pos}</div><div style="font-size:0.74rem;color:#6B7280;font-weight:700">POSITIVE</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#6B7280">${r.counts.neu}</div><div style="font-size:0.74rem;color:#6B7280;font-weight:700">NEUTRAL</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#EF4444">${r.counts.neg}</div><div style="font-size:0.74rem;color:#6B7280;font-weight:700">NEGATIVE</div></div>
        </div>
        ${r.posts.length === 0 ? '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No posts found in the last 7 days. Try different subreddits or keywords.</div>' :
        '<div style="display:grid;gap:10px">' + r.posts.slice(0, 50).map((p, pi) => {
          const sc = sentColor[(p.sentiment||'neutral').toLowerCase()] || sentColor.neutral;
          const cardId = 'rpCard_' + pi;
          return `<div id="${cardId}" style="background:#fff;border:1px solid #E5E7EB;border-left:3px solid #FF4500;border-radius:8px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
              <div style="flex:1">
                <div style="font-weight:700;color:#0A1628;font-size:0.88rem;line-height:1.4">${p.url && _safeUrl(p.url) ? `<a href="${_safeUrl(p.url)}" target="_blank" rel="noopener" style="color:#0A1628;text-decoration:none">${_escapeHtml(p.title)}</a>` : _escapeHtml(p.title)}</div>
                <div style="font-size:0.72rem;color:#6B7280;margin-top:3px">r/${_escapeHtml(p.subreddit||'')} · u/${_escapeHtml(p.author||'')} · ⬆ ${p.upvotes} · 💬 ${p.comments} · ${p.created ? new Date(p.created).toLocaleDateString() : ''}</div>
                ${p.selftext ? `<div style="font-size:0.78rem;color:#374151;margin-top:5px;line-height:1.4">${_escapeHtml(p.selftext.slice(0, 200))}${p.selftext.length>200?'…':''}</div>` : ''}
              </div>
              <span style="background:${sc[0]};color:${sc[1]};padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;flex-shrink:0;height:fit-content">${_escapeHtml(p.sentiment||'neutral')}</span>
            </div>
            <div style="margin-top:10px;padding-top:9px;border-top:1px solid #F3F4F6;display:flex;align-items:center;gap:7px;flex-wrap:wrap">
              <span style="font-size:0.67rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em">Reply tone:</span>
              ${['Engaging','Direct','Balanced'].map(t => `<button class="rpTone_${pi}" data-tone="${t.toLowerCase()}" onclick="window._rpSetTone(${pi},'${t.toLowerCase()}')" style="padding:3px 9px;border-radius:4px;border:1.5px solid ${t==='Balanced'?'#7C3AED':'#D1D5DB'};background:${t==='Balanced'?'#EDE9FE':'#fff'};color:${t==='Balanced'?'#6D28D9':'#374151'};font-size:0.67rem;font-weight:700;cursor:pointer">${t}</button>`).join('')}
              <button onclick="window._rpGenerateReply(${pi},'${_escapeHtml((p.title||'').replace(/'/g,"\\'")).slice(0,120)}','${_escapeHtml((p.selftext||'').replace(/'/g,"\\'")).slice(0,200)}')" style="margin-left:auto;padding:4px 12px;background:linear-gradient(135deg,#FF4500,#FF8C42);border:none;border-radius:5px;color:#fff;font-size:0.72rem;font-weight:800;cursor:pointer">✍️ Generate Reply</button>
            </div>
            <div id="rpReply_${pi}" style="display:none;margin-top:8px"></div>
          </div>`;
        }).join('') + '</div>'}`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });

  // Tone selection state per post card
  window._rpTones = {};
  window._rpSetTone = function(pi, tone) {
    window._rpTones[pi] = tone;
    document.querySelectorAll('.rpTone_' + pi).forEach(btn => {
      const active = btn.dataset.tone === tone;
      btn.style.borderColor = active ? '#7C3AED' : '#D1D5DB';
      btn.style.background  = active ? '#EDE9FE' : '#fff';
      btn.style.color       = active ? '#6D28D9' : '#374151';
    });
  };

  window._rpGenerateReply = async function(pi, postTitle, postText) {
    const replyDiv = document.getElementById('rpReply_' + pi);
    if (!replyDiv) return;
    const brand = (document.getElementById('rpBrand')?.value || '').trim() || (window.analysisData?.brandName || 'our brand');
    const tone  = window._rpTones[pi] || 'balanced';
    const brandContext = window.analysisData ? [
      window.analysisData.industry?.name ? `Industry: ${window.analysisData.industry.name}` : '',
      window.analysisData.tagline || '',
    ].filter(Boolean).join('. ') : '';
    replyDiv.style.display = 'block';
    replyDiv.innerHTML = '<div style="color:#9CA3AF;font-size:0.78rem">⏳ Generating reply…</div>';
    try {
      const r = await fetch('/api/reddit-pulse/generate-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postTitle, postText, brand, tone, brandContext }),
      }).then(x => x.json());
      if (!r.ok) { replyDiv.innerHTML = `<div style="color:#991B1B;font-size:0.78rem">⚠ ${_escapeHtml(r.error)}</div>`; return; }
      replyDiv.innerHTML = `
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;padding:10px 13px;position:relative">
          <div style="font-size:0.67rem;font-weight:800;color:#7C3AED;text-transform:uppercase;margin-bottom:5px">AI Reply · ${_escapeHtml(tone)}</div>
          <div id="rpReplyTxt_${pi}" style="font-size:0.82rem;color:#1F2937;line-height:1.55;white-space:pre-wrap">${_escapeHtml(r.reply)}</div>
          <button onclick="navigator.clipboard?.writeText(document.getElementById('rpReplyTxt_${pi}')?.textContent||'').then(()=>showToast('✅ Reply copied!'))" style="margin-top:8px;padding:4px 10px;background:#EDE9FE;border:none;border-radius:5px;font-size:0.68rem;font-weight:700;color:#6D28D9;cursor:pointer">📋 Copy</button>
        </div>`;
    } catch(e) { replyDiv.innerHTML = `<div style="color:#991B1B;font-size:0.78rem">Network error: ${_escapeHtml(e.message)}</div>`; }
  };
};

// ============================================================================
// TIER 17-B — Ad Library Spy (Meta + TikTok)
// ============================================================================
// Full ISO-3166 country list (Meta Ad Library accepts any ISO-2 code; "ALL" = every country).
window._AL_COUNTRIES = [
  ['ALL','🌍 All countries'],
  ['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],['NZ','New Zealand'],['IE','Ireland'],
  ['ZA','South Africa'],['NG','Nigeria'],['KE','Kenya'],['EG','Egypt'],['MA','Morocco'],['GH','Ghana'],
  ['DE','Germany'],['FR','France'],['ES','Spain'],['IT','Italy'],['NL','Netherlands'],['BE','Belgium'],['PT','Portugal'],['CH','Switzerland'],['AT','Austria'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],['FI','Finland'],['IS','Iceland'],['PL','Poland'],['CZ','Czech Republic'],['SK','Slovakia'],['HU','Hungary'],['RO','Romania'],['BG','Bulgaria'],['GR','Greece'],['HR','Croatia'],['SI','Slovenia'],['EE','Estonia'],['LV','Latvia'],['LT','Lithuania'],['LU','Luxembourg'],['MT','Malta'],['CY','Cyprus'],['UA','Ukraine'],['RS','Serbia'],
  ['RU','Russia'],['TR','Turkey'],['IL','Israel'],['AE','United Arab Emirates'],['SA','Saudi Arabia'],['QA','Qatar'],['KW','Kuwait'],['BH','Bahrain'],['OM','Oman'],['JO','Jordan'],['LB','Lebanon'],
  ['IN','India'],['PK','Pakistan'],['BD','Bangladesh'],['LK','Sri Lanka'],['NP','Nepal'],
  ['CN','China'],['HK','Hong Kong'],['TW','Taiwan'],['JP','Japan'],['KR','South Korea'],['SG','Singapore'],['MY','Malaysia'],['TH','Thailand'],['VN','Vietnam'],['ID','Indonesia'],['PH','Philippines'],
  ['MX','Mexico'],['BR','Brazil'],['AR','Argentina'],['CL','Chile'],['CO','Colombia'],['PE','Peru'],['UY','Uruguay'],['VE','Venezuela'],['EC','Ecuador'],['BO','Bolivia'],['PY','Paraguay'],['CR','Costa Rica'],['PA','Panama'],['DO','Dominican Republic'],['GT','Guatemala'],['HN','Honduras'],['SV','El Salvador'],['NI','Nicaragua'],['PR','Puerto Rico'],['JM','Jamaica'],['TT','Trinidad and Tobago'],
];
function _alCountryOptions(selected) {
  return window._AL_COUNTRIES.map(([code, name]) =>
    `<option value="${code}"${code === selected ? ' selected' : ''}>${code === 'ALL' ? name : `${name} (${code})`}</option>`
  ).join('');
}
window.buildAdLibrary = function() {
  const wrap = document.getElementById('alWrap'); if (!wrap) return;
  const _t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  window.IGDiag && IGDiag.log('buildAdLibrary: start');
  // Pause field-enhancer during the innerHTML swap — without this, the
  // MutationObserver flushes hundreds of mutation records (~100 country
  // checkboxes + form inputs) and can spike the main thread on slower
  // machines. Same pattern used by the dashboard builder.
  try { window.IGFields && IGFields.pause && IGFields.pause(); } catch(_) {}
  try {
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">🔍 Search Ad Libraries</h3>
      <div style="display:grid;grid-template-columns:1fr 280px;gap:10px;margin-bottom:12px">
        <div>
          <label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:4px">BRAND / ADVERTISER</label>
          <div style="display:flex;gap:8px">
            <select id="alBrandPick" onchange="_alBrandPickChange()" style="padding:9px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;min-width:200px;background:#fff"></select>
            <input id="alBrand" placeholder="…or type any brand" style="flex:1;min-width:140px;padding:9px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;box-sizing:border-box">
          </div>
          <div id="alBrandHint" style="margin-top:4px;font-size:0.68rem;color:#9CA3AF"></div>
        </div>
        <div style="position:relative">
          <label style="display:block;font-size:0.72rem;font-weight:700;color:#6B7280;margin-bottom:4px">COUNTRY <span style="font-weight:600;color:#9CA3AF;font-size:0.66rem">(multi-select)</span></label>
          <button type="button" id="alCountryBtn" onclick="_alToggleCountryMenu(event)" style="width:100%;padding:9px 32px 9px 12px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;background:#fff;text-align:left;cursor:pointer;position:relative;font-weight:600;color:#0A1628">
            <span id="alCountryLabel">United States (US)</span>
            <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#6B7280;font-size:0.7rem;pointer-events:none">▼</span>
          </button>
          <input type="hidden" id="alCountry" value="US">
          <div id="alCountryMenu" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;background:#fff;border:1px solid #D1D5DB;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:1000;max-height:340px;overflow:hidden">
            <input id="alCountrySearch" type="text" placeholder="Search country…" oninput="_alFilterCountries(this.value)" style="width:100%;padding:8px 10px;border:none;border-bottom:1px solid #E5E7EB;font-size:0.82rem;outline:none;box-sizing:border-box">
            <div style="display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid #E5E7EB;background:#F9FAFB">
              <button type="button" onclick="_alSelectAllCountries(true)" style="flex:1;padding:5px;background:#0066FF;color:#fff;border:0;border-radius:4px;font-size:0.7rem;font-weight:800;cursor:pointer">✓ All countries</button>
              <button type="button" onclick="_alSelectAllCountries(false)" style="flex:1;padding:5px;background:#fff;color:#0066FF;border:1px solid #0066FF;border-radius:4px;font-size:0.7rem;font-weight:800;cursor:pointer">Clear</button>
              <button type="button" onclick="_alToggleCountryMenu(event)" style="padding:5px 10px;background:#0F172A;color:#fff;border:0;border-radius:4px;font-size:0.7rem;font-weight:800;cursor:pointer">Done</button>
            </div>
            <div id="alCountryList" style="max-height:230px;overflow-y:auto"></div>
          </div>
        </div>
      </div>
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:0.75rem;font-weight:800;color:#0A1628">PLATFORMS TO SEARCH</div>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:700;color:#0066FF;cursor:pointer;user-select:none">
            <input type="checkbox" id="alSelectAll" checked onchange="_alToggleAll(this.checked)" style="width:14px;height:14px;cursor:pointer;accent-color:#0066FF"> Select all
          </label>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
          ${[
            ['meta',     '📘 Meta Ad Library',                          '#1877F2'],
            ['google',   '🔍 Google Ads (Search · Display · YouTube)',  '#34A853'],
            ['tiktok',   '🎵 TikTok Ad Library',                        '#000000'],
            ['linkedin', '💼 LinkedIn Ad Library',                      '#0A66C2'],
            ['x',        '𝕏 X (Twitter) Ads Transparency',             '#0F172A'],
          ].map(([id,label,color]) => `
            <label style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;color:#0A1628">
              <input type="checkbox" class="al-plat" value="${id}" checked style="width:15px;height:15px;cursor:pointer;accent-color:${color};flex-shrink:0">
              <span>${label}</span>
            </label>`).join('')}
        </div>
      </div>
      <button id="alRun" style="width:100%;background:linear-gradient(135deg,#0066FF,#7C3AED);color:#fff;border:none;padding:13px;border-radius:8px;font-size:0.92rem;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(0,102,255,.25)">🚀 Run Ad Library Search</button>
      <div style="margin-top:8px;font-size:0.7rem;color:#6B7280;line-height:1.45">
        📘 Meta = live Graph API · the rest scrape each platform's public ad transparency archive (requires PERPLEXITY_API_KEY).
      </div>
    </div>
    <div id="alOut"></div>
  `;
  document.getElementById('alRun').addEventListener('click', _alRunMulti);
  // Default selection: United States. Preserve any prior selection so the
  // user's last picks survive a tab-revisit.
  if (!(window._alSelectedCountries instanceof Set) || !window._alSelectedCountries.size) {
    window._alSelectedCountries = new Set(['US']);
  }
  // Lazy-render the country list: defer painting ~98 checkbox rows until the
  // menu is actually opened. This was previously synchronous on view-init
  // and caused a perceived freeze on slower machines.
  _alUpdateCountryLabel();
  _alPopulateBrandPicker();
  // Idempotent global listener — without the guard, every re-entry to this
  // view re-added the handler; same fn reference dedupes on modern browsers
  // but we belt-and-brace it for older ones.
  if (!window.__alOutsideClickWired) {
    document.addEventListener('click', _alOutsideCountryClose);
    window.__alOutsideClickWired = true;
  }
  } finally {
    // Always resume the field-enhancer — even if the build threw — so a
    // transient error here can never leave AI Suggest decoration globally
    // disabled. Scan only this subtree (cheap) instead of the whole document.
    try {
      if (window.IGFields) {
        IGFields.resume && IGFields.resume({ scan: false });
        IGFields.scanRoot && IGFields.scanRoot(wrap);
      }
    } catch(_) {}
    const _dt = ((window.performance && performance.now) ? performance.now() : Date.now()) - _t0;
    window.IGDiag && IGDiag.log('buildAdLibrary: done', _dt.toFixed(0) + 'ms');
  }
};

window._alPopulateBrandPicker = function() {
  const sel = document.getElementById('alBrandPick'); if (!sel) return;
  const ad = window.analysisData || {};
  const norm = u => String(u||'').replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/.*$/,'').trim().toLowerCase();
  const domToBrand = d => { const core = (d||'').split('.')[0]; return core ? core.charAt(0).toUpperCase()+core.slice(1) : ''; };
  const ownDom = norm(ad.url || ad.domain || '');
  const ownBrand = ad.brandName || ad.companyName || domToBrand(ownDom);
  const comps = Array.isArray(ad.competitors) ? ad.competitors : [];
  const opts = [];
  if (ownBrand) opts.push(`<option value="${_escapeHtml(ownBrand)}" selected>🏠 Your brand — ${_escapeHtml(ownBrand)}</option>`);
  const compRows = comps.map(c => {
    const d = norm(c.domain || c.url || c.website || '');
    const name = c.name || domToBrand(d);
    return name ? { name } : null;
  }).filter(Boolean);
  if (compRows.length) {
    opts.push(`<optgroup label="Your analysed competitors">`);
    compRows.forEach(r => opts.push(`<option value="${_escapeHtml(r.name)}">${_escapeHtml(r.name)}</option>`));
    opts.push(`</optgroup>`);
  }
  opts.push(`<option value="__manual__">✏️ Type manually…</option>`);
  if (!ownBrand && !compRows.length) {
    sel.innerHTML = `<option value="__manual__" selected>✏️ Type a brand manually…</option>`;
  } else {
    sel.innerHTML = opts.join('');
  }
  const inp = document.getElementById('alBrand');
  if (inp && ownBrand && !inp.value) inp.value = ownBrand;
  const hint = document.getElementById('alBrandHint');
  if (hint) {
    if (ownBrand || compRows.length) {
      hint.style.color = '#15803D';
      hint.textContent = `✓ Pre-filled from your latest analysis. Pick another brand or type your own.`;
    } else {
      hint.style.color = '#9CA3AF';
      hint.innerHTML = `No analysis yet. <a href="#" onclick="if(window.navigateTo)window.navigateTo('home');return false;" style="color:#0066FF;font-weight:700;text-decoration:underline">→ Run + Analyse first</a> to auto-fill your brand &amp; competitors.`;
    }
  }
};
window._alBrandPickChange = function() {
  const sel = document.getElementById('alBrandPick');
  const inp = document.getElementById('alBrand');
  if (!sel || !inp) return;
  const v = sel.value || '';
  if (v && v !== '__manual__') inp.value = v;
  else if (v === '__manual__') { inp.value = ''; inp.focus(); }
};

window._alRenderCountryList = function(filter) {
  const f = (filter || '').toLowerCase().trim();
  const list = document.getElementById('alCountryList'); if (!list) return;
  const sel = window._alSelectedCountries || (window._alSelectedCountries = new Set(['US']));
  const items = (window._AL_COUNTRIES || []).filter(([code, name]) => code !== 'ALL' && (!f || name.toLowerCase().includes(f) || code.toLowerCase().includes(f)));
  list.innerHTML = items.map(([code, name]) => {
    const display = `${name} (${code})`;
    const checked = sel.has(code) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:0.85rem;color:#0A1628" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''"><input type="checkbox" value="${code}" ${checked} onchange="_alPickCountry('${code}', this.checked)" style="width:14px;height:14px;accent-color:#0066FF;cursor:pointer"> ${_escapeHtml(display)}</label>`;
  }).join('') || '<div style="padding:14px;text-align:center;color:#9CA3AF;font-size:0.8rem">No matches</div>';
};
window._alFilterCountries = function(v) { _alRenderCountryList(v); };
window._alPickCountry = function(value, checked) {
  const sel = window._alSelectedCountries || (window._alSelectedCountries = new Set());
  if (checked) sel.add(value); else sel.delete(value);
  _alUpdateCountryLabel();
};
window._alSelectAllCountries = function(all) {
  const sel = window._alSelectedCountries = new Set();
  if (all) {
    (window._AL_COUNTRIES || []).forEach(([code]) => { if (code !== 'ALL') sel.add(code); });
  }
  _alRenderCountryList(document.getElementById('alCountrySearch')?.value || '');
  _alUpdateCountryLabel();
};
window._alUpdateCountryLabel = function() {
  const sel = window._alSelectedCountries || new Set(['US']);
  const lbl = document.getElementById('alCountryLabel');
  const hidden = document.getElementById('alCountry');
  if (!lbl || !hidden) return;
  const total = (window._AL_COUNTRIES || []).filter(([c]) => c !== 'ALL').length;
  hidden.value = Array.from(sel).join(',');
  if (sel.size === 0) lbl.textContent = '— pick at least one —';
  else if (sel.size === total) lbl.textContent = `🌍 All countries (${total})`;
  else if (sel.size === 1) {
    const code = Array.from(sel)[0];
    const found = (window._AL_COUNTRIES || []).find(([c]) => c === code);
    lbl.textContent = found ? `${found[1]} (${code})` : code;
  } else lbl.textContent = `${sel.size} countries selected`;
};
window._alToggleCountryMenu = function(e) {
  if (e) { e.stopPropagation(); }
  const m = document.getElementById('alCountryMenu'); if (!m) return;
  const open = m.style.display === 'block';
  m.style.display = open ? 'none' : 'block';
  if (!open) { const s = document.getElementById('alCountrySearch'); if (s) { s.value=''; _alRenderCountryList(''); setTimeout(() => s.focus(), 50); } }
};
window._alOutsideCountryClose = function(e) {
  const m = document.getElementById('alCountryMenu'); const b = document.getElementById('alCountryBtn');
  if (!m || !b) return;
  if (m.style.display === 'block' && !m.contains(e.target) && !b.contains(e.target)) m.style.display = 'none';
};

window._alToggleAll = function(checked) {
  document.querySelectorAll('.al-plat').forEach(cb => { cb.checked = checked; });
};

// Bounded-concurrency async map. Runs `fn` over `items` at most `limit` at a
// time, preserving input order in the returned array. Used to throttle the
// per-country ad-library fan-out so we never fire hundreds of fetches at once.
window._alMapLimit = async function(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(n).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
};

// Single ad-card builder, extracted so _alAppendResult can render large
// result sets in rAF-yielding chunks instead of one blocking innerHTML pass.
window._alAdCardHtml = function(a, brand, platform) {
  const _cardId = 'alVis_' + Math.random().toString(36).slice(2,8);
  const _analyzePayload = JSON.stringify({
    brand_name: a.page_name || a.advertiser || brand,
    headline: a.title || '',
    ad_text: a.body || a.ad_text || '',
    image_url: a.snapshot_url || a.url || ''
  }).replace(/'/g,"&#39;");
  return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:11px"><div style="font-weight:700;color:#0A1628;font-size:0.82rem;margin-bottom:4px">${_escapeHtml(a.page_name || a.advertiser || brand)}</div>${a.title ? `<div style="font-weight:600;color:#1E1B4B;font-size:0.8rem;margin-bottom:3px">${_escapeHtml(a.title)}</div>` : ''}<div style="color:#374151;font-size:0.76rem;line-height:1.4;white-space:pre-wrap">${_escapeHtml((a.body || a.ad_text || '').slice(0, 240))}</div>${a.description ? `<div style="color:#6B7280;font-size:0.72rem;margin-top:4px;font-style:italic">${_escapeHtml(a.description.slice(0,140))}</div>` : ''}<div style="font-size:0.68rem;color:#9CA3AF;margin-top:7px;border-top:1px solid #E5E7EB;padding-top:6px">${a.created ? '📅 ' + new Date(a.created).toLocaleDateString() + ' · ' : ''}${a.first_seen ? '👁 ' + _escapeHtml(a.first_seen) + ' · ' : ''}${Array.isArray(a.platforms) ? a.platforms.map(p => _escapeHtml(String(p))).join(', ') : ''}${a.industry ? ' · ' + _escapeHtml(a.industry) : ''}${(a.snapshot_url || a.url) && _safeUrl(a.snapshot_url || a.url) ? ` · <a href="${_safeUrl(a.snapshot_url || a.url)}" target="_blank" rel="noopener" style="color:#0066FF;font-weight:700">View →</a>` : ''}</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px"><button onclick='window._alSaveSwipe(${JSON.stringify({source:platform, external_id:a.id||null, advertiser:a.page_name||a.advertiser||brand, headline:a.title||"", body:a.body||a.ad_text||"", cta:a.description||"", snapshot_url:a.snapshot_url||a.url||"", platforms:a.platforms||[]}).replace(/'/g,"&#39;")}, this)' style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:6px;border-radius:6px;font-size:0.72rem;font-weight:800;cursor:pointer">💾 Save to Swipe File</button><button onclick='window._alAnalyzeCreative(${_analyzePayload}, "${_cardId}", this)' style="background:#EEF2FF;border:1px solid #C7D2FE;color:#3730A3;padding:6px;border-radius:6px;font-size:0.72rem;font-weight:800;cursor:pointer">🔍 Analyze Creative</button></div><div id="${_cardId}" style="margin-top:8px"></div></div>`;
};

window._alAnalyzeCreative = async function(payload, cardId, btn) {
  const el = document.getElementById(cardId);
  if (!el) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }
  el.innerHTML = '<div style="font-size:0.76rem;color:#6B7280;padding:8px 0">Analysing with Gemini Vision…</div>';
  try {
    const r = await fetch('/api/ad-library/analyze-creative', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Re-analyze'; }
    if (!d.ok || !d.analysis) { el.innerHTML = `<div style="color:#991B1B;font-size:0.75rem;padding:8px 0">${_escapeHtml(d.error || 'Analysis failed')}</div>`; return; }
    const a = d.analysis;
    const scoreColor = a.quality_score >= 75 ? '#16a34a' : a.quality_score >= 50 ? '#d97706' : '#dc2626';
    const perfColor  = a.estimated_performance === 'high' ? '#16a34a' : a.estimated_performance === 'medium' ? '#d97706' : '#dc2626';
    el.innerHTML = `
<div style="border:1px solid #E0E7FF;border-radius:8px;background:#F5F7FF;padding:10px;font-size:0.74rem;margin-top:4px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
    <span style="font-weight:800;color:#1E1B4B;font-size:0.78rem">🔍 Creative Analysis <span style="font-weight:400;color:#6B7280">(${_escapeHtml(d.source||'ai')})</span></span>
    <div style="display:flex;gap:6px">
      <span style="background:${scoreColor};color:#fff;border-radius:4px;padding:2px 8px;font-weight:800;font-size:0.78rem">${a.quality_score||0}/100</span>
      <span style="background:${perfColor};color:#fff;border-radius:4px;padding:2px 8px;font-weight:700;font-size:0.72rem;text-transform:capitalize">${_escapeHtml(a.estimated_performance||'medium')}</span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:8px">
    ${[['Hook', a.hook_score + '/10'],['Hook Type', (a.hook_type||'').replace(/_/g,' ')],['Emotion', a.emotional_appeal||''],['CTA', a.cta_strength||''],['Clarity', a.copy_clarity||''],['Tone', a.tone||'']].map(([l,v])=>`<div style="background:#fff;border:1px solid #E5E7EB;border-radius:4px;padding:4px 6px"><div style="font-size:0.64rem;font-weight:700;color:#6B7280;text-transform:uppercase">${_escapeHtml(l)}</div><div style="font-weight:600;color:#0A1628;text-transform:capitalize">${_escapeHtml(String(v))}</div></div>`).join('')}
  </div>
  ${Array.isArray(a.persuasion_tactics) && a.persuasion_tactics.length ? `<div style="margin-bottom:6px"><span style="font-weight:700;color:#1E1B4B">Tactics: </span>${a.persuasion_tactics.map(t=>`<span style="background:#DBEAFE;color:#1E40AF;border-radius:3px;padding:1px 5px;font-size:0.7rem;margin-right:3px">${_escapeHtml(t)}</span>`).join('')}</div>` : ''}
  ${Array.isArray(a.strengths) && a.strengths.length ? `<div style="margin-bottom:4px"><span style="font-size:0.68rem;font-weight:700;color:#15803D">✓ </span>${a.strengths.map(s=>`<span style="font-size:0.72rem;color:#166534">${_escapeHtml(s)}</span>`).join(' · ')}</div>` : ''}
  ${Array.isArray(a.weaknesses) && a.weaknesses.length ? `<div style="margin-bottom:6px"><span style="font-size:0.68rem;font-weight:700;color:#B91C1C">✗ </span>${a.weaknesses.map(w=>`<span style="font-size:0.72rem;color:#991B1B">${_escapeHtml(w)}</span>`).join(' · ')}</div>` : ''}
  ${Array.isArray(a.improvement_suggestions) && a.improvement_suggestions.length ? `<div style="border-top:1px solid #E0E7FF;padding-top:6px;margin-top:4px"><div style="font-weight:700;color:#1E1B4B;margin-bottom:4px">💡 Improvements</div>${a.improvement_suggestions.map(i=>`<div style="color:#374151;margin-bottom:3px">• ${_escapeHtml(i)}</div>`).join('')}</div>` : ''}
  ${a.visual_notes ? `<div style="margin-top:6px;color:#6B7280;font-style:italic">${_escapeHtml(a.visual_notes)}</div>` : ''}
</div>`;
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Analyze Creative'; }
    el.innerHTML = `<div style="color:#991B1B;font-size:0.75rem;padding:8px 0">Error: ${_escapeHtml(e.message)}</div>`;
  }
};

window._alRunMulti = async function() {
  const brand = document.getElementById('alBrand').value.trim();
  const countriesRaw = document.getElementById('alCountry').value.trim();
  const allCodes = countriesRaw ? countriesRaw.split(',').filter(Boolean) : ['US'];
  const out = document.getElementById('alOut');
  if (!brand) { out.innerHTML = '<div style="background:#FEE2E2;color:#991B1B;padding:12px;border-radius:8px">⚠ Brand required</div>'; return; }
  if (!allCodes.length) { out.innerHTML = '<div style="background:#FEE2E2;color:#991B1B;padding:12px;border-radius:8px">⚠ Select at least one country</div>'; return; }
  const selected = Array.from(document.querySelectorAll('.al-plat:checked')).map(cb => cb.value);
  if (!selected.length) { out.innerHTML = '<div style="background:#FEF3C7;color:#92400E;padding:12px;border-radius:8px">⚠ Select at least one platform</div>'; return; }
  const labels = { meta:'Meta Ad Library', google:'Google Ads Transparency Center', tiktok:'TikTok Ad Library', linkedin:'LinkedIn Ad Library', x:'X (Twitter) Ads Transparency' };
  const btn = document.getElementById('alRun');
  const origBtn = btn.innerHTML;
  // When 10+ countries are selected, collapse to a single worldwide search (one request
  // per platform) instead of fanning out per country. The backend handles country:'ALL'
  // as "worldwide (all countries)" for all platforms.
  const useGlobal = allCodes.length >= 10;
  const countries = useGlobal ? ['ALL'] : allCodes;
  const countryLbl = useGlobal ? `All countries (${allCodes.length})` : allCodes.length === 1 ? allCodes[0] : `${allCodes.length} countries`;
  try { if (window.IGDiag) { IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('ad-search:fetch ' + selected.join('+') + ' × ' + countryLbl); IGDiag.mark && IGDiag.mark('ad-search: run', selected.length + ' plat × ' + countryLbl); } } catch(_) {}
  btn.disabled = true; btn.innerHTML = `⏳ Searching ${selected.length} platform${selected.length>1?'s':''} × ${countryLbl}…`; btn.style.opacity = '0.7'; btn.style.cursor = 'wait';
  out.innerHTML = `<div id="alProgress" style="display:grid;gap:8px;margin-bottom:14px">${selected.map(p => `<div id="alProg_${p}" style="display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;font-size:0.82rem"><span style="display:inline-block;width:14px;height:14px;border:2px solid #E5E7EB;border-top-color:#0066FF;border-radius:50%;animation:alSpin 0.8s linear infinite"></span><span style="font-weight:700;color:#0A1628">${_escapeHtml(labels[p] || p)}</span><span style="color:#6B7280;font-size:0.74rem">searching ${_escapeHtml(countryLbl)}…</span></div>`).join('')}<style>@keyframes alSpin{to{transform:rotate(360deg)}}</style></div><div id="alResults" style="display:grid;gap:18px"></div>`;
  await Promise.all(selected.map(async (platform) => {
    const progEl = document.getElementById('alProg_' + platform);
    try {
      // Fan out per country with BOUNDED concurrency, then merge + dedupe by
      // ad id. Without the limit, "All countries" (~98) × 5 platforms fires
      // ~490 simultaneous fetches that hammer the browser/server and stall
      // the UI; _alMapLimit caps it to a handful at a time per platform.
      const perCountry = await _alMapLimit(countries, 6, async (cc) => {
        try {
          const r = await fetch(`/api/ad-library/${platform}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, country: cc }) }).then(x => x.json());
          return { cc, r };
        } catch (e) { return { cc, r: { ok:false, error:e.message } }; }
      });
      const ok = perCountry.filter(x => x.r && x.r.ok);
      const errs = perCountry.filter(x => !x.r || !x.r.ok);
      const seen = new Set(); const merged = [];
      ok.forEach(({ cc, r }) => {
        (r.ads || []).forEach(a => {
          const id = a.id || `${a.page_name||a.advertiser||''}::${a.title||''}::${(a.body||a.ad_text||'').slice(0,80)}`;
          if (seen.has(id)) return; seen.add(id);
          merged.push(Object.assign({ _country: cc }, a));
        });
      });
      // Hard-cap the rendered set. The Meta backend pads results up to 300
      // ads PER country, so a multi-country search can yield thousands — far
      // more than anyone reviews, and enough to freeze the page when built
      // into one DOM pass. Cap, then note how many were withheld.
      const MAX_RENDER_ADS = 150;
      const totalFound = merged.length;
      if (merged.length > MAX_RENDER_ADS) merged.length = MAX_RENDER_ADS;
      const noteParts = [];
      if (errs.length) noteParts.push(`${errs.length} of ${countries.length} country lookup(s) failed.`);
      if (totalFound > MAX_RENDER_ADS) noteParts.push(`Showing first ${MAX_RENDER_ADS} of ${totalFound} ads.`);
      const finalRes = ok.length
        ? { ok:true, ads: merged, note: noteParts.length ? noteParts.join(' ') : null }
        : { ok:false, error: (errs[0] && errs[0].r && errs[0].r.error) || 'All country lookups failed' };
      if (progEl) progEl.remove();
      _alAppendResult(platform, labels[platform] || platform, brand, countryLbl, finalRes);
    } catch (e) {
      if (progEl) progEl.remove();
      _alAppendResult(platform, labels[platform] || platform, brand, countryLbl, { ok:false, error: 'Network error: ' + e.message });
    }
  }));
  btn.disabled = false; btn.innerHTML = origBtn; btn.style.opacity = ''; btn.style.cursor = 'pointer';
  const remaining = document.getElementById('alProgress');
  if (remaining && !remaining.children.length) remaining.remove();
};

window._alAppendResult = function(platform, label, brand, country, r) {
  const container = document.getElementById('alResults'); if (!container) return;
  const block = document.createElement('div');
  block.style.cssText = 'background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px';
  if (!r.ok) {
    block.innerHTML = `<div style="font-weight:800;color:#0A1628;margin-bottom:8px">${_escapeHtml(label)}</div><div style="background:#FEE2E2;color:#B91C1C;padding:10px;border-radius:6px;font-size:0.82rem">${_escapeHtml(r.error || 'Unknown error')}</div>`;
  } else if (!r.ads || !r.ads.length) {
    block.innerHTML = `<div style="font-weight:800;color:#0A1628;margin-bottom:8px">${_escapeHtml(label)}</div><div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:6px;padding:14px;text-align:center;color:#6B7280;font-size:0.8rem">${_escapeHtml(r.note || 'No active ads found.')}</div>`;
  } else {
    const noteHtml = r.note ? `<span style="font-size:0.7rem;color:#92400E;background:#FEF3C7;border:1px solid #FCD34D;border-radius:5px;padding:2px 7px;margin-left:8px">${_escapeHtml(r.note)}</span>` : '';
    block.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div style="font-weight:800;color:#0A1628">${_escapeHtml(label)}${noteHtml}</div><div style="font-size:0.74rem;color:#6B7280">✅ ${r.ads.length} ad(s) for ${_escapeHtml(brand)} (${_escapeHtml(country)})</div></div><div data-al-grid style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px"></div>`;
    container.appendChild(block);
    // Render ad cards in rAF-yielding chunks. Building all cards into one
    // innerHTML string and inserting them synchronously is what froze the page
    // on large result sets — each card carries a JSON.stringify'd button, so a
    // few hundred ads is a multi-second main-thread block. Chunking yields to
    // the browser between batches so the page stays responsive.
    const grid = block.querySelector('[data-al-grid]');
    const ads = r.ads || [];
    try { window.IGDiag && IGDiag.setBreadcrumb && IGDiag.setBreadcrumb('ad-search:render ' + platform + ' ' + ads.length + ' ads'); } catch(_) {}
    const CHUNK = 24;
    let i = 0;
    const renderChunk = () => {
      if (!grid.isConnected) return; // view was navigated away — stop
      const parts = [];
      const end = Math.min(i + CHUNK, ads.length);
      for (; i < end; i++) parts.push(window._alAdCardHtml(ads[i], brand, platform));
      grid.insertAdjacentHTML('beforeend', parts.join(''));
      if (i < ads.length) (window.requestAnimationFrame || setTimeout)(renderChunk, 16);
    };
    renderChunk();
    return;
  }
  container.appendChild(block);
};

window._alSaveSwipe = async function(payload, btn) {
  const hdrs = (window.apiHeaders ? window.apiHeaders() : { 'Content-Type':'application/json' });
  try {
    const r = await fetch('/api/ad-swipe/save', { method:'POST', headers: hdrs, body: JSON.stringify(payload) });
    const j = await r.json();
    if (j.ok) { btn.textContent = '✅ Saved'; btn.style.background = '#D1FAE5'; btn.style.borderColor = '#34D399'; btn.style.color = '#065F46'; btn.disabled = true; }
    else { btn.textContent = '⚠ ' + (j.error||'failed'); }
  } catch (e) { btn.textContent = '⚠ ' + e.message; }
};

window._alScan = async function(platform) {
  const brand = document.getElementById('alBrand').value.trim();
  const country = document.getElementById('alCountry').value.trim() || 'US';
  const out = document.getElementById('alOut');
  if (!brand) { out.innerHTML = '<div style="color:#991B1B">⚠ Brand required</div>'; return; }
  const _platLabels = { meta:'Meta Ad Library', tiktok:'TikTok Ad Library', google:'Google Ads Transparency Center', linkedin:'LinkedIn Ad Library', x:'X (Twitter) Ads Transparency' };
  const _platLabel = _platLabels[platform] || platform;
  out.innerHTML = `<div style="color:#9CA3AF">⏳ Searching ${_platLabel}…</div>`;
  try {
    const r = await fetch(`/api/ad-library/${platform}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, country }) }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
    if (!r.ads.length) { out.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">${_escapeHtml(r.note || 'No active ads found.')}</div>`; return; }
    out.innerHTML = `
      <div style="font-weight:700;color:#0A1628;margin-bottom:10px">✅ Found ${r.ads.length} ${_escapeHtml(_platLabel)} ad(s) for ${_escapeHtml(brand)} (${_escapeHtml(country)})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px">
        ${r.ads.map(a => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px">
          <div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:5px">${_escapeHtml(a.page_name || a.advertiser || brand)}</div>
          ${a.title ? `<div style="font-weight:600;color:#1E1B4B;font-size:0.84rem;margin-bottom:4px">${_escapeHtml(a.title)}</div>` : ''}
          <div style="color:#374151;font-size:0.8rem;line-height:1.45;white-space:pre-wrap">${_escapeHtml((a.body || a.ad_text || '').slice(0, 280))}</div>
          ${a.description ? `<div style="color:#6B7280;font-size:0.75rem;margin-top:5px;font-style:italic">${_escapeHtml(a.description.slice(0, 150))}</div>` : ''}
          <div style="font-size:0.7rem;color:#9CA3AF;margin-top:8px;border-top:1px solid #F3F4F6;padding-top:8px">
            ${a.created ? '📅 ' + new Date(a.created).toLocaleDateString() + ' · ' : ''}${a.first_seen ? '👁 ' + _escapeHtml(a.first_seen) + ' · ' : ''}${Array.isArray(a.platforms) ? a.platforms.map(p => _escapeHtml(String(p))).join(', ') : ''}${a.industry ? ' · ' + _escapeHtml(a.industry) : ''}
            ${(a.snapshot_url || a.url) && _safeUrl(a.snapshot_url || a.url) ? ` · <a href="${_safeUrl(a.snapshot_url || a.url)}" target="_blank" rel="noopener" style="color:#0066FF;font-weight:700">View →</a>` : ''}
          </div>
        </div>`).join('')}
      </div>`;
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
};

// ============================================================================
// TIER 17-C — Newsletter Tracker
// ============================================================================
window.buildNewsletterTracker = async function() {
  const wrap = document.getElementById('ntWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">➕ Track a Newsletter Archive</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1.6fr auto;gap:8px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND</label><input id="ntBrand" placeholder="e.g. Stripe" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">NEWSLETTER NAME</label><input id="ntName" placeholder="e.g. Stripe Weekly" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">ARCHIVE URL (Substack/Beehiiv/Mailchimp/etc)</label><input id="ntUrl" placeholder="https://example.substack.com/archive" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box"></div>
        <button id="ntAdd" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:0.78rem;font-weight:800;cursor:pointer">➕ Track</button>
      </div>
    </div>
    <div id="ntList"></div>
  `;
  document.getElementById('ntAdd').addEventListener('click', _ntAdd);
  await _ntLoad();
};

async function _ntLoad() {
  const list = document.getElementById('ntList');
  list.innerHTML = '<div style="color:#9CA3AF">Loading…</div>';
  try {
    const r = await fetch('/api/newsletter-tracker/targets').then(x => x.json());
    if (!r.ok) { list.innerHTML = `<div style="color:#991B1B">⚠ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.targets.length) { list.innerHTML = '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No newsletters tracked yet. Add an archive URL above.</div>'; return; }
    list.innerHTML = r.targets.map(t => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px">
        <div>
          <div style="font-weight:800;color:#0A1628;font-size:1rem">📧 ${_escapeHtml(t.newsletter_name)}</div>
          <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${_escapeHtml(t.brand)} · ${_safeUrl(t.archive_url) ? `<a href="${_safeUrl(t.archive_url)}" target="_blank" rel="noopener" style="color:#0066FF">${_escapeHtml(t.archive_url)}</a>` : _escapeHtml(t.archive_url)}</div>
          <div style="font-size:0.68rem;color:#9CA3AF;margin-top:2px">${t.last_scanned_at ? 'Last scanned ' + new Date(t.last_scanned_at).toLocaleString() : 'Never scanned'}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="_ntScan(${t.id})" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:0.74rem;font-weight:800;cursor:pointer">🔍 Scan</button>
          <button onclick="_ntHistory(${t.id})" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">📜 History</button>
          <button onclick="_ntDelete(${t.id})" style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:7px 12px;border-radius:6px;font-size:0.74rem;font-weight:700;cursor:pointer">🗑</button>
        </div>
      </div>
      <div id="ntRes-${t.id}" style="margin-top:10px;font-size:0.82rem;color:#9CA3AF"></div>
    </div>`).join('');
  } catch (e) { list.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
}

window._ntAdd = async function() {
  const brand = document.getElementById('ntBrand').value.trim();
  const newsletter_name = document.getElementById('ntName').value.trim();
  const archive_url = document.getElementById('ntUrl').value.trim();
  if (!brand || !newsletter_name || !archive_url) { showToast('⚠ All fields required'); return; }
  try {
    const r = await fetch('/api/newsletter-tracker/targets', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, newsletter_name, archive_url }) }).then(x => x.json());
    if (!r.ok) { showToast('❌ ' + r.error); return; }
    document.getElementById('ntName').value = ''; document.getElementById('ntUrl').value = '';
    await _ntLoad(); showToast('✅ Newsletter tracked');
  } catch (e) { showToast('Network error: ' + e.message); }
};

window._ntScan = async function(id) {
  const out = document.getElementById('ntRes-' + id);
  out.innerHTML = '⏳ Scraping + extracting issues (10-30s)…';
  try {
    const r = await fetch(`/api/newsletter-tracker/scan/${id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.issues.length) { out.innerHTML = '<div style="color:#9CA3AF">No issues extracted. Try a different archive URL.</div>'; return; }
    _ntRender(out, r.issues);
    await _ntLoad();
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
};

window._ntHistory = async function(id) {
  const out = document.getElementById('ntRes-' + id);
  out.innerHTML = '⏳ Loading…';
  try {
    const r = await fetch(`/api/newsletter-tracker/history/${id}`).then(x => x.json());
    if (!r.ok) { out.innerHTML = `<div style="color:#991B1B">❌ ${_escapeHtml(r.error)}</div>`; return; }
    if (!r.issues.length) { out.innerHTML = '<div style="color:#9CA3AF">No history yet — click Scan.</div>'; return; }
    _ntRender(out, r.issues.map(i => ({ subject: i.subject, sent_date: i.sent_date, preview: i.preview, url: i.url })));
  } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
};

function _ntRender(el, issues) {
  el.innerHTML = '<div style="display:grid;gap:6px">' + issues.map(i => `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:9px 12px">
    <div style="font-weight:700;color:#0A1628;font-size:0.86rem">${i.url && _safeUrl(i.url) ? `<a href="${_safeUrl(i.url)}" target="_blank" rel="noopener" style="color:#0A1628;text-decoration:none">${_escapeHtml(i.subject||'')}</a>` : _escapeHtml(i.subject||'')}</div>
    <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${_escapeHtml(i.sent_date||'')}${i.preview?` · ${_escapeHtml(i.preview)}`:''}</div>
  </div>`).join('') + '</div>';
}

window._ntDelete = async function(id) {
  if (!confirm('Stop tracking this newsletter? (history retained)')) return;
  await fetch(`/api/newsletter-tracker/targets/${id}`, { method:'DELETE' });
  await _ntLoad();
};

// ============================================================================
// TIER 17-D — AI Meeting Note Summarizer
// ============================================================================
window.buildMeetingNotes = function() {
  const wrap = document.getElementById('mnWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">🎙️ Sales-Call Transcript</h3>
      <textarea id="mnTranscript" rows="14" placeholder="Paste your sales-call transcript here (50+ chars)…&#10;&#10;Sales: Hi Jane, thanks for taking the call.&#10;Jane: Sure, happy to chat. We're evaluating tools right now…" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:10px">
        <input id="mnContactName" placeholder="Contact name (optional)" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
        <input id="mnContactCompany" placeholder="Company (optional)" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
        <input id="mnContactRole" placeholder="Role (optional)" style="padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
      </div>
      <button id="mnGo" style="margin-top:12px;background:linear-gradient(135deg,#1E1B4B,#312E81);color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:0.86rem;font-weight:800;cursor:pointer">🤖 Summarize + Score</button>
    </div>
    <div id="mnOut"></div>
  `;
  document.getElementById('mnGo').addEventListener('click', async () => {
    const transcript = document.getElementById('mnTranscript').value.trim();
    const contact = { name: document.getElementById('mnContactName').value.trim(), company: document.getElementById('mnContactCompany').value.trim(), role: document.getElementById('mnContactRole').value.trim() };
    const out = document.getElementById('mnOut');
    if (!transcript) { out.innerHTML = '<div style="color:#991B1B">⚠ Transcript required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Analyzing transcript…</div>';
    try {
      const r = await fetch('/api/meeting-notes/summarize', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ transcript, contact: contact.name || contact.company ? contact : null }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const s = r.summary; const bant = s.bant || {};
      const stageColor = { discovery:'#6B7280', qualification:'#3B82F6', proposal:'#8B5CF6', negotiation:'#F59E0B', closed_won:'#10B981', closed_lost:'#EF4444' };
      const sentColor = { positive:'#10B981', neutral:'#6B7280', negative:'#EF4444' };
      out.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px">
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:1.8rem;font-weight:800;color:#1E1B4B">${s.overall_score||0}</div>
            <div style="font-size:0.7rem;color:#6B7280;font-weight:700">DEAL SCORE / 100</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:0.9rem;font-weight:800;color:${stageColor[s.deal_stage]||'#6B7280'};text-transform:uppercase">${_escapeHtml(s.deal_stage||'?')}</div>
            <div style="font-size:0.7rem;color:#6B7280;font-weight:700;margin-top:4px">DEAL STAGE</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:0.9rem;font-weight:800;color:${sentColor[s.sentiment]||'#6B7280'};text-transform:uppercase">${_escapeHtml(s.sentiment||'?')}</div>
            <div style="font-size:0.7rem;color:#6B7280;font-weight:700;margin-top:4px">SENTIMENT</div>
          </div>
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px">
            <div style="font-size:0.74rem;font-weight:700;color:#6B7280">NEXT STEP</div>
            <div style="font-size:0.82rem;color:#0A1628;margin-top:2px;line-height:1.4">${_escapeHtml(s.next_step||'')}</div>
          </div>
        </div>

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
          <h3 style="margin:0 0 8px;color:#0A1628;font-size:0.96rem">📝 Summary</h3>
          <div style="color:#374151;font-size:0.86rem;line-height:1.55">${_escapeHtml(s.summary||'')}</div>
          ${s.key_points?.length ? `<div style="margin-top:10px"><strong style="font-size:0.82rem;color:#0A1628">Key points:</strong><ul style="margin:6px 0 0;padding-left:22px;color:#374151;font-size:0.82rem;line-height:1.6">${s.key_points.map(k => `<li>${_escapeHtml(k)}</li>`).join('')}</ul></div>` : ''}
        </div>

        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
          <h3 style="margin:0 0 10px;color:#0A1628;font-size:0.96rem">🎯 BANT Score</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            ${['budget','authority','need','timeline'].map(k => {
              const b = bant[k] || {};
              return `<div style="background:#F9FAFB;border-radius:8px;padding:10px">
                <div style="font-weight:800;color:#0A1628;font-size:0.78rem;text-transform:uppercase">${k}</div>
                <div style="font-size:1.4rem;font-weight:800;color:#1E1B4B;margin:4px 0">${b.score||0}<span style="font-size:0.7rem;color:#9CA3AF">/10</span></div>
                <div style="font-size:0.72rem;color:#6B7280;line-height:1.4">${_escapeHtml(b.evidence||'')}</div>
              </div>`;
            }).join('')}
          </div>
        </div>

        ${s.action_items?.length ? `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px">
          <h3 style="margin:0 0 10px;color:#0A1628;font-size:0.96rem">✅ Action Items</h3>
          <div style="display:grid;gap:6px">${s.action_items.map(a => `<div style="background:#F0FDF4;border-left:3px solid #10B981;padding:8px 12px;border-radius:6px;font-size:0.82rem">
            <strong style="color:#065F46">${_escapeHtml(a.owner||'?')}:</strong> ${_escapeHtml(a.task||'')} <span style="color:#6B7280;font-size:0.74rem">· ${_escapeHtml(a.due||'')}</span>
          </div>`).join('')}</div>
        </div>` : ''}

        ${s.objections_raised?.length || s.risks?.length ? `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          ${s.objections_raised?.length ? `<div style="margin-bottom:10px"><h4 style="margin:0 0 6px;color:#92400E;font-size:0.86rem">⚠ Objections raised</h4><ul style="margin:0;padding-left:22px;color:#374151;font-size:0.82rem;line-height:1.6">${s.objections_raised.map(o => `<li>${_escapeHtml(o)}</li>`).join('')}</ul></div>` : ''}
          ${s.risks?.length ? `<div><h4 style="margin:0 0 6px;color:#991B1B;font-size:0.86rem">🚨 Risks</h4><ul style="margin:0;padding-left:22px;color:#374151;font-size:0.82rem;line-height:1.6">${s.risks.map(r => `<li>${_escapeHtml(r)}</li>`).join('')}</ul></div>` : ''}
        </div>` : ''}
      `;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 17-E — Headline & Hook Tester
// ============================================================================
window.buildHeadlineTester = function() {
  const wrap = document.getElementById('htWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">🎯 Test a Headline</h3>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <label style="font-size:0.7rem;font-weight:700;color:#6B7280">HEADLINE</label>
          <button type="button" id="htHeadlineAI" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:3px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
        </div>
        <input id="htHeadline" placeholder='e.g. "Stop wasting ad budget — automate it"' style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.9rem;box-sizing:border-box">
      </div>
      <div style="display:grid;grid-template-columns:1.5fr 1fr 140px;gap:10px;margin-top:10px">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280">AUDIENCE</label>
            <button type="button" id="htAudienceAI" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:3px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
          </div>
          <input id="htAudience" placeholder="e.g. SaaS founders, Series A-B" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <label style="font-size:0.7rem;font-weight:700;color:#6B7280">CHANNEL</label>
            <button type="button" id="htChannelAI" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:3px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
          </div>
          <select id="htChannel" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
            <option value="landing_page">Landing page</option><option value="email">Email subject</option><option value="ad">Paid ad</option><option value="social">Social post</option><option value="blog">Blog post</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">VARIANTS</label>
          <div style="display:flex;gap:4px">
            <select id="htCountPick" style="flex:1;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box">
              <option value="3">3</option><option value="5">5</option><option value="8" selected>8</option><option value="10">10</option><option value="custom">Custom…</option>
            </select>
            <input id="htCount" type="number" min="1" max="20" value="8" style="width:54px;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.82rem;box-sizing:border-box;display:none">
          </div>
        </div>
      </div>
      <button id="htGo" style="margin-top:12px;background:linear-gradient(135deg,#DC2626,#EF4444);color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:0.86rem;font-weight:800;cursor:pointer">🎯 Score + Generate Variants</button>
    </div>
    <div id="htOut"></div>
  `;
  // ── Variants picker: presets 3/5/8/10 or Custom → reveal the manual input.
  // We keep htCount as the canonical source of truth so the submit handler
  // does not need to know which mode the user is in.
  const htCountPick = document.getElementById('htCountPick');
  const htCount = document.getElementById('htCount');
  htCountPick.addEventListener('change', () => {
    if (htCountPick.value === 'custom') {
      htCount.style.display = 'inline-block';
      htCount.focus();
    } else {
      htCount.style.display = 'none';
      htCount.value = htCountPick.value;
    }
  });

  // ── AI Suggest wiring. Shows "⏳ Thinking… [N.Ns]" live timer in the
  // target input, restores the previous value if the call fails. CHANNEL is
  // a <select> so we map the suggestion onto the closest valid option.
  const CHANNEL_KEYS = ['landing_page','email','ad','social','blog'];
  async function _htAISuggest(field, targetEl, ctxExtra) {
    const prev = targetEl.value;
    const isSelect = targetEl.tagName === 'SELECT';
    const t0 = performance.now();
    let placeholder;
    if (isSelect) {
      // Inject a temporary option so the user can see we are thinking.
      placeholder = document.createElement('option');
      placeholder.text = '⏳ Thinking… [0.0s]';
      placeholder.value = '__thinking__';
      placeholder.selected = true;
      targetEl.appendChild(placeholder);
    } else {
      targetEl.value = '⏳ Thinking… [0.0s]';
    }
    targetEl.disabled = true;
    const iv = setInterval(() => {
      const t = ((performance.now() - t0) / 1000).toFixed(1);
      if (isSelect) placeholder.text = '⏳ Thinking… [' + t + 's]';
      else targetEl.value = '⏳ Thinking… [' + t + 's]';
    }, 100);
    try {
      const ad = window.analysisData || {};
      const body = {
        field,
        // This codebase stores the analysed brand under `brandName`; some
        // older code paths used `brand`. Read both so the AI gets real
        // grounding regardless of which path populated analysisData.
        brand: ad.brandName || ad.brand || '',
        // Industry can be either an object ({ name: '…' }) or a plain string
        // depending on which analyser produced it — normalise both shapes.
        industry: (ad.industry && (ad.industry.name || ad.industry)) || '',
        currentValue: isSelect ? '' : prev,
        context: ctxExtra || ''
      };
      const r = await fetch('/api/studio/ai-suggest', {
        method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
      });
      const j = await r.json();
      const v = String(j?.value || '').trim();
      if (!v) throw new Error('AI returned an empty suggestion');
      if (isSelect) {
        // Map the suggestion onto the closest known channel key.
        const low = v.toLowerCase();
        const match = CHANNEL_KEYS.find(k => low.includes(k.replace('_',' ')) || low.includes(k))
          || (low.includes('landing') ? 'landing_page' : null)
          || (low.includes('email') || low.includes('subject') ? 'email' : null)
          || (low.includes('paid') || low.includes('ads') || low === 'ad' ? 'ad' : null)
          || (low.includes('social') || low.includes('linkedin') || low.includes('twitter') || low.includes('tweet') || low.includes('instagram') ? 'social' : null)
          || (low.includes('blog') || low.includes('article') ? 'blog' : null)
          || 'landing_page';
        placeholder.remove();
        targetEl.value = match;
      } else {
        targetEl.value = v;
      }
    } catch (e) {
      if (isSelect) { placeholder.remove(); targetEl.value = prev; }
      else { targetEl.value = prev; }
      (window.showToast || alert)('⚠ AI Suggest failed: ' + e.message);
    } finally {
      clearInterval(iv);
      targetEl.disabled = false;
    }
  }
  const htHeadlineEl = document.getElementById('htHeadline');
  const htAudienceEl = document.getElementById('htAudience');
  const htChannelEl  = document.getElementById('htChannel');
  document.getElementById('htHeadlineAI').addEventListener('click', () => _htAISuggest(
    'A high-converting marketing headline (one sentence, specific, no buzzwords)',
    htHeadlineEl,
    'Audience: ' + (htAudienceEl.value || 'unspecified') + '. Channel: ' + htChannelEl.value
  ));
  document.getElementById('htAudienceAI').addEventListener('click', () => _htAISuggest(
    'A specific target audience segment for this brand (job title + company stage or region — one short phrase)',
    htAudienceEl
  ));
  document.getElementById('htChannelAI').addEventListener('click', () => _htAISuggest(
    'The single best distribution channel for this headline. Reply with one of: landing_page, email, ad, social, blog',
    htChannelEl,
    'Headline: "' + (htHeadlineEl.value || '(none yet)') + '". Audience: ' + (htAudienceEl.value || 'unspecified')
  ));

  document.getElementById('htGo').addEventListener('click', async () => {
    const headline = document.getElementById('htHeadline').value.trim();
    const audience = document.getElementById('htAudience').value.trim();
    const channel = document.getElementById('htChannel').value;
    const count = parseInt(document.getElementById('htCount').value, 10);
    const out = document.getElementById('htOut');
    if (!headline) { out.innerHTML = '<div style="color:#991B1B">⚠ Headline required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Scoring + generating variants…</div>';
    try {
      const r = await fetch('/api/headline-tester/test-headline', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ headline, audience, channel, count }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const scoreColor = (s) => s >= 80 ? '#10B981' : s >= 60 ? '#F59E0B' : '#EF4444';
      const sortedV = (r.variants || []).slice().sort((a,b) => (b.score||0) - (a.score||0));
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:14px;border-left:4px solid #1E1B4B">
          <div style="font-size:0.74rem;font-weight:700;color:#6B7280;text-transform:uppercase">📌 Original</div>
          <div style="font-size:1.05rem;font-weight:700;color:#0A1628;margin:6px 0">${_escapeHtml(r.original?.text||headline)}</div>
          <div style="display:flex;align-items:center;gap:14px;margin-top:8px">
            <div style="background:${scoreColor(r.original?.score||0)};color:#fff;padding:4px 12px;border-radius:20px;font-weight:800;font-size:1rem">${r.original?.score||0}/100</div>
            <div style="font-size:0.78rem;color:#6B7280">${(r.original?.strengths||[]).map(x => `✓ ${_escapeHtml(x)}`).join(' · ')}</div>
          </div>
          ${(r.original?.weaknesses||[]).length ? `<div style="margin-top:6px;font-size:0.76rem;color:#991B1B">${r.original.weaknesses.map(x => `⚠ ${_escapeHtml(x)}`).join(' · ')}</div>` : ''}
        </div>
        <div style="font-weight:800;color:#0A1628;margin-bottom:8px">🔥 Variants (ranked best-first)</div>
        <div style="display:grid;gap:10px">${sortedV.map((v,i) => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px;border-left:3px solid ${scoreColor(v.score||0)}">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:5px">
            <div style="flex:1">
              <div style="font-weight:700;color:#0A1628;font-size:0.92rem;line-height:1.4">${_escapeHtml(v.text||'')}</div>
              <div style="font-size:0.72rem;color:#6B7280;margin-top:4px">${i===0?'🏆 ':''}<strong style="text-transform:uppercase">${_escapeHtml(v.kind||'')}</strong> · ${(v.patterns_hit||[]).map(p => _escapeHtml(p)).join(' · ')}</div>
              ${v.reasoning ? `<div style="font-size:0.74rem;color:#9CA3AF;margin-top:3px;font-style:italic">${_escapeHtml(v.reasoning)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
              <div style="background:${scoreColor(v.score||0)};color:#fff;padding:3px 10px;border-radius:14px;font-weight:800;font-size:0.86rem">${v.score||0}</div>
              <button data-ht-copy="${i}" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:3px 8px;border-radius:4px;font-size:0.66rem;font-weight:700;cursor:pointer">📋</button>
            </div>
          </div>
        </div>`).join('')}</div>`;
      out.querySelectorAll('button[data-ht-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-ht-copy'), 10);
          const text = (sortedV[idx] && sortedV[idx].text) || '';
          navigator.clipboard.writeText(text).then(() => showToast('✅ Copied')).catch(() => showToast('❌ Copy failed'));
        });
      });
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 18 — XSS-safe numeric coercion helpers (LLM output is untrusted)
// ============================================================================
function _n(x, d) { const v = Number(x); return Number.isFinite(v) ? Math.round(v) : (d || 0); }
function _f(x, d, p) { const v = Number(x); return Number.isFinite(v) ? v.toFixed(p == null ? 1 : p) : (d || '—'); }

// ============================================================================
// TIER 18-A — Review Aggregator
// ============================================================================
window.buildReviewAggregator = function() {
  const wrap = document.getElementById('raWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="ra-tab active" data-tab="single" style="padding:8px 16px;border-radius:6px;border:1px solid #1E1B4B;background:#1E1B4B;color:#fff;font-size:0.78rem;font-weight:700;cursor:pointer">Single Brand</button>
        <button class="ra-tab" data-tab="compare" style="padding:8px 16px;border-radius:6px;border:1px solid #E5E7EB;background:#fff;color:#374151;font-size:0.78rem;font-weight:700;cursor:pointer">Compare 2-4 Brands</button>
        <button class="ra-tab" data-tab="deleted" style="padding:8px 16px;border-radius:6px;border:1px solid #E5E7EB;background:#fff;color:#374151;font-size:0.78rem;font-weight:700;cursor:pointer">🗑️ Deleted <span id="raDeletedBadge" style="display:none;background:#EF4444;color:#fff;border-radius:9999px;font-size:0.65rem;padding:1px 6px;margin-left:4px;vertical-align:middle">0</span></button>
      </div>
      <div id="raSingle">
        ${(() => {
          const ownBrand = (window.analysisData && window.analysisData.brandName) || '';
          const compNames = (window.analysisData && Array.isArray(window.analysisData.competitors))
            ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 15)
            : [];
          const pickerOpts = [
            ownBrand ? `<option value="${_escapeHtml(ownBrand)}">${_escapeHtml(ownBrand)} (your brand)</option>` : '',
            ...compNames.map(n => `<option value="${_escapeHtml(n)}">${_escapeHtml(n)}</option>`)
          ].filter(Boolean).join('');
          return `
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-bottom:10px">
              <div>
                <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND <span style="color:#15803D;font-weight:600">(auto-filled from your analysis)</span></label>
                ${pickerOpts
                  ? `<select id="raPick" onchange="window._raPickChange()" style="width:100%;padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:5px;font-size:0.78rem;background:#F9FAFB;margin-bottom:5px;box-sizing:border-box">
                       <option value="">— Pick from your analysis (or type manually below) —</option>
                       ${pickerOpts}
                     </select>`
                  : `<div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:5px">💡 Run an analysis to unlock brand/competitor pickers.</div>`}
                <input id="raBrand" value="${_escapeHtml(ownBrand)}" placeholder="e.g. Stripe — or pick from list above" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;background:${ownBrand?'#F0FDF4':'#fff'}">
              </div>
              <div>
                <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">PLATFORM</label>
                <select id="raPlatform" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
                  <option value="trustpilot">Trustpilot</option><option value="g2">G2</option><option value="google">Google</option><option value="capterra">Capterra</option><option value="tripadvisor">TripAdvisor</option>
                </select>
              </div>
            </div>
            <button id="raGo" style="background:linear-gradient(135deg,#F59E0B,#FBBF24);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">⭐ Scan Reviews</button>`;
        })()}
      </div>
      <div id="raCompare" style="display:none">
        <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRANDS (comma-sep, 2-4)</label>
        <input id="raCompareBrands" placeholder="Stripe, Square, Adyen" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;margin-bottom:8px">
        <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">PLATFORM</label>
        <select id="raComparePlatform" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;margin-bottom:8px">
          <option value="trustpilot">Trustpilot</option><option value="g2">G2</option><option value="google">Google</option><option value="capterra">Capterra</option>
        </select>
        <button id="raCompareGo" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">⚖️ Compare</button>
      </div>
      <div id="raDeleted" style="display:none">
        <div style="color:#9CA3AF;padding:20px;text-align:center;font-size:0.82rem">Loading deleted reviews…</div>
      </div>
    </div>
    <div id="raOut"></div>
  `;
  window._raPickChange = function() {
    const s = document.getElementById('raPick'), i = document.getElementById('raBrand');
    if (s && i && s.value) i.value = s.value;
  };
  wrap.querySelectorAll('.ra-tab').forEach(b => b.addEventListener('click', () => {
    wrap.querySelectorAll('.ra-tab').forEach(x => { x.classList.remove('active'); x.style.background='#fff'; x.style.color='#374151'; x.style.borderColor='#E5E7EB'; });
    b.classList.add('active'); b.style.background='#1E1B4B'; b.style.color='#fff'; b.style.borderColor='#1E1B4B';
    document.getElementById('raSingle').style.display = b.dataset.tab === 'single' ? '' : 'none';
    document.getElementById('raCompare').style.display = b.dataset.tab === 'compare' ? '' : 'none';
    document.getElementById('raDeleted').style.display = b.dataset.tab === 'deleted' ? '' : 'none';
    if (b.dataset.tab === 'deleted') window._raLoadDeleted && window._raLoadDeleted();
  }));
  document.getElementById('raGo').addEventListener('click', async () => {
    const brand = document.getElementById('raBrand').value.trim();
    const platform = document.getElementById('raPlatform').value;
    const out = document.getElementById('raOut');
    if (!brand) { out.innerHTML = '<div style="color:#991B1B">⚠ Brand required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Scanning ' + platform + '…</div>';
    try {
      const r = await fetch('/api/review-aggregator/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, platform }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      if (!r.found) {
        const shortNameTip = brand.length <= 4 ? `<div style="margin-top:10px;font-size:0.78rem;color:#6B7280">💡 Tip: <strong>"${_escapeHtml(brand)}"</strong> may be too short to match. Try the full company name (e.g. "${_escapeHtml(brand)} Group" or "${_escapeHtml(brand)} Markets").</div>` : '';
        const altPlatform = platform === 'google' ? 'trustpilot' : platform === 'trustpilot' ? 'google' : 'trustpilot';
        out.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No reviews found for <strong>${_escapeHtml(brand)}</strong> on ${_escapeHtml(platform)}.${shortNameTip}<div style="margin-top:12px;font-size:0.78rem">Try switching the platform to <strong>${_escapeHtml(altPlatform)}</strong>, or enter a more specific company name above.</div></div>`;
        return;
      }
      const sentColor = { positive:['#ECFDF5','#065F46'], neutral:['#F3F4F6','#374151'], negative:['#FEF2F2','#991B1B'] };
      const stars = (n) => { const k = Math.max(0, Math.min(5, _n(n))); return '★'.repeat(k) + '☆'.repeat(5 - k); };
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px 20px;margin-bottom:14px;display:flex;gap:24px;flex-wrap:wrap;align-items:center">
          <div><div style="font-size:2rem;font-weight:800;color:#F59E0B">${_f(r.avg_rating)}</div><div style="color:#FBBF24;font-size:1.1rem;letter-spacing:2px">${stars(r.avg_rating)}</div><div style="font-size:0.7rem;color:#6B7280">${_n(r.total_reviews)} total reviews</div></div>
          <div style="display:flex;gap:14px">
            <div style="text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#10B981">${_n(r.counts && r.counts.pos)}</div><div style="font-size:0.66rem;color:#6B7280;font-weight:700">POSITIVE</div></div>
            <div style="text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#6B7280">${_n(r.counts && r.counts.neu)}</div><div style="font-size:0.66rem;color:#6B7280;font-weight:700">NEUTRAL</div></div>
            <div style="text-align:center"><div style="font-size:1.4rem;font-weight:800;color:#EF4444">${_n(r.counts && r.counts.neg)}</div><div style="font-size:0.66rem;color:#6B7280;font-weight:700">NEGATIVE</div></div>
          </div>
        </div>
        <div style="display:grid;gap:10px">${(r.reviews||[]).map(rv => {
          const sc = sentColor[(rv.sentiment||'neutral').toLowerCase()] || sentColor.neutral;
          return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:5px">
              <div><strong style="color:#0A1628;font-size:0.86rem">${_escapeHtml(rv.author||'Anonymous')}</strong> <span style="color:#FBBF24;letter-spacing:1px">${stars(rv.rating)}</span></div>
              <span style="background:${sc[0]};color:${sc[1]};padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700">${_escapeHtml(rv.sentiment||'neutral')}</span>
            </div>
            ${rv.title ? `<div style="font-weight:700;color:#0A1628;font-size:0.86rem;margin-bottom:4px">${_escapeHtml(rv.title)}</div>` : ''}
            <div style="color:#374151;font-size:0.82rem;line-height:1.5">${_escapeHtml(rv.body||'')}</div>
            <div style="font-size:0.7rem;color:#9CA3AF;margin-top:6px">${_escapeHtml(rv.date||'')}</div>
          </div>`;
        }).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
  document.getElementById('raCompareGo').addEventListener('click', async () => {
    const brands = document.getElementById('raCompareBrands').value.split(',').map(s => s.trim()).filter(Boolean);
    const platform = document.getElementById('raComparePlatform').value;
    const out = document.getElementById('raOut');
    if (brands.length < 2) { out.innerHTML = '<div style="color:#991B1B">⚠ Need at least 2 brands</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Comparing ' + brands.length + ' brands…</div>';
    try {
      const r = await fetch('/api/review-aggregator/compare', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brands, platform }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      out.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">${r.results.map(b => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:16px;text-align:center">
        <div style="font-weight:800;color:#0A1628;font-size:1rem">${_escapeHtml(b.brand)}</div>
        ${b.found ? `<div style="font-size:2rem;font-weight:800;color:#F59E0B;margin:8px 0">${_f(b.avg_rating)}</div>
          <div style="font-size:0.74rem;color:#6B7280">${_n(b.total_reviews)} reviews · ${_n(b.recent_count)} recent</div>` : '<div style="color:#9CA3AF;margin-top:14px;font-size:0.78rem">Not found</div>'}
      </div>`).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });

  window._raLoadDeleted = async function() {
    const el = document.getElementById('raDeleted'); if (!el) return;
    el.innerHTML = '<div style="color:#9CA3AF;padding:20px;text-align:center;font-size:0.82rem">⏳ Loading deleted reviews…</div>';
    try {
      const brand = (document.getElementById('raBrand') || {}).value || '';
      const platform = (document.getElementById('raPlatform') || {}).value || '';
      const qs = new URLSearchParams();
      if (brand) qs.set('brand', brand);
      if (platform) qs.set('platform', platform);
      const [dRes, sRes] = await Promise.all([
        fetch('/api/review-monitor/deleted?' + qs.toString()).then(x => x.json()),
        fetch('/api/review-monitor/stats?' + (brand ? new URLSearchParams({ brand }).toString() : '')).then(x => x.json())
      ]);
      // Update badge
      const total = sRes.ok ? (sRes.totalDeletedThisMonth || 0) : 0;
      const badge = document.getElementById('raDeletedBadge');
      if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'inline' : 'none'; }
      if (!dRes.ok) { el.innerHTML = `<div style="color:#991B1B;padding:14px">${_escapeHtml(dRes.error||'Error loading deleted reviews')}</div>`; return; }
      const rows = dRes.deleted || [];
      if (rows.length === 0) {
        el.innerHTML = `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:28px;text-align:center;color:#6B7280;font-size:0.84rem">
          <div style="font-size:1.5rem;margin-bottom:8px">✅</div>
          No deleted reviews detected yet.<br><span style="font-size:0.75rem;color:#9CA3AF">Deleted reviews appear here when a review present in a previous scan is missing from a new one.</span>
        </div>`;
        return;
      }
      const stars = (n) => { const k = Math.max(0, Math.min(5, Number(n)||0)); return '★'.repeat(k) + '☆'.repeat(5-k); };
      const _fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : ''; } catch(_) { return String(s||''); } };
      // Group by platform
      const byPlatform = {};
      rows.forEach(rv => { (byPlatform[rv.platform] = byPlatform[rv.platform] || []).push(rv); });
      const platformHtml = Object.entries(byPlatform).map(([plat, revs]) => `
        <div style="margin-bottom:18px">
          <div style="font-size:0.7rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
            ${_escapeHtml(plat.toUpperCase())}
            <span style="background:#FEE2E2;color:#991B1B;border-radius:4px;padding:1px 7px;font-size:0.65rem">${revs.length} removed</span>
          </div>
          <div style="display:grid;gap:8px">${revs.map(rv => `
            <div style="background:#fff;border:1px solid #FCA5A5;border-radius:8px;padding:12px 14px;border-left:4px solid #EF4444">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
                <div>
                  <strong style="color:#0A1628;font-size:0.86rem">${_escapeHtml(rv.author||'Anonymous')}</strong>
                  <span style="color:#FBBF24;letter-spacing:1px;margin-left:6px">${stars(rv.rating)}</span>
                  ${rv.title ? `<div style="font-weight:700;color:#374151;font-size:0.82rem;margin-top:2px">${_escapeHtml(rv.title)}</div>` : ''}
                </div>
                <div style="text-align:right;white-space:nowrap">
                  <span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:4px;font-size:0.66rem;font-weight:700">DELETED</span>
                </div>
              </div>
              ${rv.body ? `<div style="color:#4B5563;font-size:0.8rem;line-height:1.5;margin-top:6px">${_escapeHtml(String(rv.body).slice(0,300))}${rv.body.length>300?'…':''}</div>` : ''}
              <div style="display:flex;gap:14px;margin-top:8px;font-size:0.7rem;color:#9CA3AF;flex-wrap:wrap">
                ${rv.first_seen_at ? `<span>First seen: <strong>${_fmtDate(rv.first_seen_at)}</strong></span>` : ''}
                ${rv.deleted_at    ? `<span>Disappeared: <strong style="color:#DC2626">${_fmtDate(rv.deleted_at)}</strong></span>` : ''}
                <span style="margin-left:auto"><a href="https://${_escapeHtml(plat)}.com/review/${_escapeHtml(rv.brand||'')}" target="_blank" rel="noopener noreferrer" style="color:#6366F1;text-decoration:none;font-weight:700">⚠️ Report to platform ↗</a></span>
              </div>
            </div>`).join('')}
          </div>
        </div>`).join('');
      // Stats summary row
      const statsHtml = sRes.ok && sRes.stats && sRes.stats.length ? `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">${sRes.stats.map(s =>
          `<div style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;padding:8px 14px;text-align:center;min-width:80px">
            <div style="font-size:1.1rem;font-weight:800;color:#C2410C">${s.deleted_count}</div>
            <div style="font-size:0.65rem;font-weight:700;color:#9A3412;text-transform:uppercase">${_escapeHtml(s.platform)}</div>
            <div style="font-size:0.65rem;color:#9CA3AF">${s.active_count} tracked</div>
          </div>`).join('')}
        </div>` : '';
      el.innerHTML = `
        <div style="padding:4px 0">
          ${statsHtml}
          <div style="font-size:0.78rem;color:#6B7280;margin-bottom:12px">Showing up to 200 most recently removed reviews. Each scan compares against the previous snapshot and flags reviews that have disappeared.</div>
          ${platformHtml}
        </div>`;
    } catch (e) { el.innerHTML = `<div style="color:#991B1B;padding:14px">Network error: ${_escapeHtml(e.message)}</div>`; }
  };
};

// ============================================================================
// TIER 18-B — Predictive Churn Scorer
// ============================================================================
window.buildChurnScorer = function() {
  const wrap = document.getElementById('csWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <h3 style="margin:0 0 10px;color:#0A1628;font-family:Sora,sans-serif;font-size:1rem">📊 Score Contacts (paste JSON)</h3>
      <textarea id="csJson" rows="10" placeholder='[{"email":"jane@acme.com","name":"Jane Doe","logins_per_week":0.5,"days_since_last_login":21,"open_tickets":2,"days_since_last_purchase":120,"nps":4,"feature_adoption_pct":18,"tenure_days":340,"plan":"Pro","mrr":499}]' style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.82rem;font-family:monospace;resize:vertical;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="csGo" style="background:linear-gradient(135deg,#DC2626,#EF4444);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">⚠️ Score Contacts</button>
        <button id="csLoad" style="background:#F3F4F6;border:1px solid #E5E7EB;color:#374151;padding:10px 16px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">📜 Load Saved Scores</button>
      </div>
    </div>
    <div id="csOut"></div>
  `;
  document.getElementById('csGo').addEventListener('click', async () => {
    const out = document.getElementById('csOut');
    let parsed;
    try { parsed = JSON.parse(document.getElementById('csJson').value); }
    catch (e) { out.innerHTML = '<div style="color:#991B1B">⚠ Invalid JSON: ' + _escapeHtml(e.message) + '</div>'; return; }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Scoring ' + arr.length + ' contact(s)…</div>';
    try {
      const r = await fetch('/api/churn-scorer/bulk', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contacts: arr }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      _csRender(out, r.results);
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
  document.getElementById('csLoad').addEventListener('click', async () => {
    const out = document.getElementById('csOut');
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Loading…</div>';
    try {
      const r = await fetch('/api/churn-scorer/scores').then(x => x.json());
      if (!r.ok || !r.scores.length) { out.innerHTML = '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No scored contacts yet.</div>'; return; }
      _csRender(out, r.scores.map(s => ({ ok:true, email: s.contact_email, score: s.score, risk_level: s.risk_level, signals: s.signals, recommendation: s.recommendation })));
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};
function _csRender(out, results) {
  const riskColor = { critical:'#DC2626', high:'#EF4444', medium:'#F59E0B', low:'#10B981' };
  const sorted = results.slice().sort((a,b) => (b.score||0) - (a.score||0));
  out.innerHTML = `<div style="display:grid;gap:10px">${sorted.map(s => {
    if (!s.ok) return `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;color:#991B1B;font-size:0.82rem">${_escapeHtml(s.email||'?')}: ${_escapeHtml(s.error||'failed')}</div>`;
    const rc = riskColor[(s.risk_level||'medium').toLowerCase()] || '#F59E0B';
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${rc};border-radius:8px;padding:14px 16px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:6px">
        <div><strong style="color:#0A1628;font-size:0.92rem">${_escapeHtml(s.email||'')}</strong> <span style="background:${rc};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;text-transform:uppercase;margin-left:6px">${_escapeHtml(s.risk_level||'medium')}</span></div>
        <div style="font-size:1.6rem;font-weight:800;color:${rc}">${_n(s.score)}</div>
      </div>
      ${(s.signals||[]).length ? `<div style="font-size:0.78rem;color:#374151;line-height:1.5;margin-top:4px"><strong>Signals:</strong><ul style="margin:4px 0 0;padding-left:20px">${(s.signals||[]).map(x => `<li>${_escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
      ${s.recommendation ? `<div style="background:#F0FDF4;border-left:3px solid #10B981;padding:6px 10px;border-radius:4px;font-size:0.8rem;margin-top:8px;color:#065F46"><strong>💡 Action:</strong> ${_escapeHtml(s.recommendation)}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

// ============================================================================
// TIER 18-C — Twitter/X Pulse
// ============================================================================
window.buildTwitterPulse = function() {
  const wrap = document.getElementById('twWrap'); if (!wrap) return;
  const ownBrand = (window.analysisData && window.analysisData.brandName) || '';
  const compNames = (window.analysisData && Array.isArray(window.analysisData.competitors))
    ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 15)
    : [];
  const pickerOpts = [
    ownBrand ? `<option value="${_escapeHtml(ownBrand)}">${_escapeHtml(ownBrand)} (your brand)</option>` : '',
    ...compNames.map(n => `<option value="${_escapeHtml(n)}">${_escapeHtml(n)}</option>`)
  ].filter(Boolean).join('');
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:10px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND <span style="color:#15803D;font-weight:600">(auto-filled from your analysis)</span></label>
          ${pickerOpts
            ? `<select id="twPick" onchange="window._twPickChange()" style="width:100%;padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:5px;font-size:0.78rem;background:#F9FAFB;margin-bottom:5px;box-sizing:border-box">
                 <option value="">— Pick from your analysis —</option>
                 ${pickerOpts}
               </select>`
            : ''}
          <input id="twBrand" value="${_escapeHtml(ownBrand)}" placeholder="e.g. Tesla — or pick from list above" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;background:${ownBrand?'#F0FDF4':'#fff'}">
        </div>
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">EXTRA KEYWORDS (optional, comma-sep)
            <button type="button" id="twKwSuggestBtn" onclick="window._twKwSuggest()" style="margin-left:6px;background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:2px 8px;border-radius:8px;font-size:0.6rem;font-weight:800;cursor:pointer;vertical-align:middle">🤖 AI Suggest</button>
          </label>
          <input id="twKw" placeholder="cybertruck, FSD, autopilot" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
        </div>
      </div>
      <button id="twGo" style="background:linear-gradient(135deg,#1DA1F2,#0EA5E9);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🐦 Scan X</button>
    </div>
    <div id="twOut"></div>
  `;
  window._twPickChange = function() {
    const s = document.getElementById('twPick'), i = document.getElementById('twBrand');
    if (s && i && s.value) i.value = s.value;
  };
  window._twKwSuggest = async function() {
    const btn = document.getElementById('twKwSuggestBtn'); if (!btn) return;
    const orig = btn.innerHTML; btn.innerHTML = '⏳'; btn.disabled = true;
    try {
      // Step 1: pull from analysis keywords already identified
      const _ad = window.analysisData || {};
      const _im = window._intentMap;
      let directKws = [];
      if (Array.isArray(_ad.keywords) && _ad.keywords.length) {
        directKws = _ad.keywords.slice(0, 8).map(k => (typeof k === 'string' ? k : k.keyword || k.term || '').trim()).filter(Boolean);
      }
      if (!directKws.length && _im && Array.isArray(_im.keywords) && _im.keywords.length) {
        directKws = _im.keywords.slice(0, 8).map(k => (typeof k === 'string' ? k : k.keyword || k.term || '').trim()).filter(Boolean);
      }
      // Also add competitor names as monitoring keywords
      if (directKws.length < 4 && Array.isArray(_ad.competitors) && _ad.competitors.length) {
        const compKws = _ad.competitors.slice(0, 4).map(c => c.name || c.domain || '').filter(Boolean);
        directKws = [...new Set([...directKws, ...compKws])].slice(0, 8);
      }
      if (directKws.length) {
        const inp = document.getElementById('twKw');
        if (inp) inp.value = directKws.join(', ');
        showToast('✅ ' + directKws.length + ' keywords pulled from your analysis');
        return;
      }
      // Step 2: ask AI to suggest based on brand
      const brand = (document.getElementById('twBrand') || {}).value || _ad.brandName || '';
      if (!brand) { showToast('⚠ Enter a brand first'); return; }
      const r = await fetch('/api/ai-quick', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt: `Brand: ${brand}\n\nSuggest 5-6 short Twitter/X search keywords or hashtags to monitor brand mentions, product discussions, and competitor comparisons for this brand. Return them as a comma-separated list only, no explanation.` })
      });
      const txt = await r.text();
      let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
      const kws = ((j && (j.text || j.answer || j.result)) || '').toString().trim().replace(/^["']|["']$/g,'').split('\n')[0].slice(0, 200);
      if (kws) {
        const inp = document.getElementById('twKw');
        if (inp) inp.value = kws;
        showToast('✅ AI keyword suggestions loaded');
      } else {
        showToast('⚠ No keyword suggestions returned — type manually');
      }
    } catch (e) { showToast('❌ ' + e.message); }
    finally { btn.innerHTML = orig; btn.disabled = false; }
  };
  document.getElementById('twGo').addEventListener('click', async () => {
    const brand = document.getElementById('twBrand').value.trim();
    const keywords = document.getElementById('twKw').value.split(',').map(s => s.trim()).filter(Boolean);
    const out = document.getElementById('twOut');
    if (!brand) { out.innerHTML = '<div style="color:#991B1B">⚠ Brand required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Searching X (15-30s)…</div>';
    try {
      const r = await fetch('/api/twitter-pulse/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, keywords }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const sentColor = { positive:['#ECFDF5','#065F46'], neutral:['#F3F4F6','#374151'], negative:['#FEF2F2','#991B1B'] };
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px 18px;margin-bottom:14px;display:flex;justify-content:space-around;text-align:center;gap:10px;flex-wrap:wrap">
          <div><div style="font-size:1.5rem;font-weight:800;color:#0A1628">${_n(r.total)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700">TOTAL TWEETS</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#10B981">${_n(r.counts && r.counts.pos)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700">POSITIVE</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#6B7280">${_n(r.counts && r.counts.neu)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700">NEUTRAL</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#EF4444">${_n(r.counts && r.counts.neg)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700">NEGATIVE</div></div>
          <div><div style="font-size:1.5rem;font-weight:800;color:#7C3AED">🔥 ${_n(r.viral_count)}</div><div style="font-size:0.7rem;color:#6B7280;font-weight:700">VIRAL</div></div>
        </div>
        ${r.tweets.length === 0 ? '<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">No recent tweets found.</div>' :
        '<div style="display:grid;gap:10px">' + r.tweets.map(t => {
          const sc = sentColor[(t.sentiment||'neutral').toLowerCase()] || sentColor.neutral;
          return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:3px solid ${t.viral?'#7C3AED':'#1DA1F2'};border-radius:8px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:start">
              <div style="flex:1">
                <div style="font-weight:700;color:#0A1628;font-size:0.86rem">${_escapeHtml(t.handle||t.author||'@unknown')} ${t.viral ? '<span style="background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:3px;font-size:0.66rem;font-weight:700">🔥 VIRAL</span>' : ''}</div>
                <div style="color:#0A1628;font-size:0.86rem;margin-top:4px;line-height:1.5;white-space:pre-wrap">${_escapeHtml(t.text||'')}</div>
                <div style="font-size:0.72rem;color:#6B7280;margin-top:6px">❤️ ${_n(t.likes)} · 🔁 ${_n(t.retweets)} · 💬 ${_n(t.replies)} · ${_escapeHtml(t.date||'')} ${t.url && _safeUrl(t.url) ? `· <a href="${_safeUrl(t.url)}" target="_blank" rel="noopener" style="color:#1DA1F2;font-weight:700">View →</a>` : ''}</div>
              </div>
              <span style="background:${sc[0]};color:${sc[1]};padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:700;flex-shrink:0">${_escapeHtml(t.sentiment||'neutral')}</span>
            </div>
          </div>`;
        }).join('') + '</div>'}`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 18-D — Job Board Spy
// ============================================================================
window.buildJobBoardSpy = function() {
  const wrap = document.getElementById('jbWrap'); if (!wrap) return;
  const _t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  window.IGDiag && IGDiag.log('buildJobBoardSpy: start');
  try { window.IGFields && IGFields.pause && IGFields.pause(); } catch(_) {}
  try {
  const DEPTS = ['engineering','sales','marketing','product','design','ops','finance','hr','other'];
  const DEPT_COLORS = { engineering:'#0066FF', sales:'#10B981', marketing:'#F59E0B', product:'#7C3AED', design:'#EC4899', ops:'#6B7280', finance:'#059669', hr:'#DC2626', other:'#9CA3AF' };

  // ── Build company list from last analysis ──
  const ownBrand = (window.analysisData && (window.analysisData.brandName || window.analysisData.companyName)) || '';
  const compNames = (window.analysisData && Array.isArray(window.analysisData.competitors))
    ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 15)
    : [];
  const allKnown = [ownBrand ? ownBrand + ' (your brand)' : '', ...compNames.map(n => n)].filter(Boolean);
  // Store raw values separately
  const allKnownValues = [ownBrand, ...compNames].filter(Boolean);

  const checkboxRows = allKnownValues.map((v, i) =>
    `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:0.84rem;color:#0A1628" onmouseover="this.style.background='#F3F4F6'" onmouseout="this.style.background=''">
      <input type="checkbox" class="jb-cb" value="${_escapeHtml(v)}" style="width:15px;height:15px;accent-color:#0066FF;cursor:pointer" ${i === 0 ? 'checked' : ''}>
      <span>${_escapeHtml(allKnown[i])}</span>
    </label>`
  ).join('');

  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <label style="font-size:0.7rem;font-weight:700;color:#6B7280">COMPETITOR / COMPANY</label>
        ${allKnownValues.length > 1 ? `<button id="jbSelectAll" onclick="window._jbToggleAll()" style="background:#EEF2FF;border:1px solid #C7D2FE;color:#4F46E5;padding:4px 12px;border-radius:6px;font-size:0.72rem;font-weight:700;cursor:pointer">☑ Select All</button>` : ''}
      </div>
      ${checkboxRows
        ? `<div id="jbCbList" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px;margin-bottom:10px;max-height:180px;overflow-y:auto;border:1px solid #E5E7EB;border-radius:6px;padding:4px">${checkboxRows}</div>`
        : `<div style="font-size:0.72rem;color:#9CA3AF;margin-bottom:8px">💡 Run an analysis from the top-right <strong>+ Analyse</strong> button to unlock competitor pickers here.</div>`}
      <input id="jbCo" placeholder="Or type any company name and click Scan" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.88rem;box-sizing:border-box;margin-bottom:10px">
      <button id="jbGo" style="width:100%;background:linear-gradient(135deg,#0F172A,#1E293B);color:#fff;border:none;padding:11px 20px;border-radius:6px;font-size:0.86rem;font-weight:800;cursor:pointer">💼 Scan Open Roles</button>
    </div>
    <div id="jbOut"></div>
  `;

  // ── Select All / Deselect All toggle ──
  let _jbAllSelected = false;
  window._jbToggleAll = function() {
    _jbAllSelected = !_jbAllSelected;
    document.querySelectorAll('.jb-cb').forEach(cb => { cb.checked = _jbAllSelected; });
    const btn = document.getElementById('jbSelectAll');
    if (btn) btn.textContent = _jbAllSelected ? '☐ Deselect All' : '☑ Select All';
  };

  // ── Scan single company and return data ──
  async function _jbScanOne(company) {
    const r = await fetch('/api/job-board-spy/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company }) }).then(x => x.json());
    return r;
  }

  // ── Render matrix table for multiple results ──
  function _jbRenderMatrix(results) {
    // results = [{company, total_jobs, by_dept, strategic_signals, jobs, ok, error}]
    const rows = results.map(r => {
      if (!r.ok) return `<tr><td style="padding:8px 12px;font-weight:700;color:#0A1628;white-space:nowrap">${_escapeHtml(r.company)}</td><td colspan="${DEPTS.length + 1}" style="padding:8px 12px;color:#B91C1C;font-size:0.8rem">${_escapeHtml(r.error||'Failed')}</td></tr>`;
      const dept = r.by_dept || {};
      const total = r.total_jobs || 0;
      const topSignal = (r.strategic_signals||[])[0] || '—';
      return `<tr style="border-bottom:1px solid #F3F4F6" onmouseover="this.style.background='#F9FAFB'" onmouseout="this.style.background=''">
        <td style="padding:8px 12px;font-weight:700;color:#0A1628;white-space:nowrap;font-size:0.84rem">${_escapeHtml(r.company)}</td>
        <td style="padding:8px 12px;text-align:center;font-weight:800;font-size:1rem;color:#0A1628">${total}</td>
        ${DEPTS.map(d => {
          const v = parseInt(dept[d]||0);
          const pct = total > 0 ? Math.round((v/total)*100) : 0;
          return `<td style="padding:6px 10px;text-align:center">
            ${v > 0 ? `<span style="background:${DEPT_COLORS[d]};color:#fff;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">${v}</span>` : `<span style="color:#D1D5DB;font-size:0.72rem">—</span>`}
            ${v > 0 && total > 0 ? `<div style="font-size:0.6rem;color:#9CA3AF;margin-top:1px">${pct}%</div>` : ''}
          </td>`;
        }).join('')}
        <td style="padding:8px 12px;font-size:0.73rem;color:#6B7280;max-width:260px">${_escapeHtml(topSignal.slice(0,120))}${topSignal.length > 120 ? '…' : ''}</td>
      </tr>`;
    }).join('');
    return `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;margin-bottom:18px">
        <div style="padding:14px 16px;border-bottom:1px solid #E5E7EB;display:flex;align-items:center;gap:10px">
          <span style="font-weight:800;color:#0A1628;font-size:0.92rem">📊 Hiring Matrix</span>
          <span style="font-size:0.72rem;color:#6B7280">${results.length} companies · open roles by department</span>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:0.8rem">
            <thead>
              <tr style="background:#F9FAFB">
                <th style="padding:8px 12px;text-align:left;font-size:0.68rem;color:#6B7280;font-weight:700;white-space:nowrap">COMPANY</th>
                <th style="padding:8px 12px;text-align:center;font-size:0.68rem;color:#6B7280;font-weight:700">TOTAL</th>
                ${DEPTS.map(d => `<th style="padding:6px 10px;text-align:center;font-size:0.65rem;color:${DEPT_COLORS[d]};font-weight:700;text-transform:uppercase;white-space:nowrap">${d.slice(0,3).toUpperCase()}</th>`).join('')}
                <th style="padding:8px 12px;text-align:left;font-size:0.68rem;color:#6B7280;font-weight:700">TOP SIGNAL</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Render detail card for one company ──
  function _jbRenderCard(r) {
    if (!r.ok) return `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px;margin-bottom:12px"><strong>${_escapeHtml(r.company)}</strong>: ${_escapeHtml(r.error)}</div>`;
    const dept = r.by_dept || {};
    return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div><div style="font-size:1.5rem;font-weight:800;color:#0A1628">${_n(r.total_jobs)}</div><div style="font-size:0.72rem;color:#6B7280;font-weight:700">OPEN ROLES AT ${_escapeHtml((r.company||'').toUpperCase())}</div></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(dept).map(([k,v]) => v > 0 ? `<span style="background:${DEPT_COLORS[String(k).toLowerCase()]||'#9CA3AF'};color:#fff;padding:3px 9px;border-radius:14px;font-size:0.72rem;font-weight:700;text-transform:capitalize">${_escapeHtml(String(k))}: ${_n(v)}</span>` : '').join('')}</div>
      ${(r.strategic_signals||[]).length ? `<div style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);border:1px solid #F59E0B;border-radius:8px;padding:12px 16px;margin-top:12px">
        <div style="font-weight:800;color:#92400E;font-size:0.84rem;margin-bottom:6px">🎯 Strategic Signals</div>
        <ul style="margin:0;padding-left:18px;color:#78350F;font-size:0.8rem;line-height:1.6">${(r.strategic_signals||[]).map(s => `<li>${_escapeHtml(s)}</li>`).join('')}</ul>
      </div>` : ''}
      ${(r.jobs||[]).length ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-size:0.78rem;font-weight:700;color:#0066FF">▶ View ${(r.jobs||[]).length} open role(s)</summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;margin-top:8px">${(r.jobs||[]).map(j => `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px">
          <div style="font-weight:700;color:#0A1628;font-size:0.84rem">${j.url && _safeUrl(j.url) ? `<a href="${_safeUrl(j.url)}" target="_blank" rel="noopener" style="color:#0A1628;text-decoration:none">${_escapeHtml(j.title||'')}</a>` : _escapeHtml(j.title||'')}</div>
          <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">${[j.department, j.seniority, j.location, j.posted].filter(Boolean).map(s=>_escapeHtml(s)).join(' · ')}</div>
          ${j.summary ? `<div style="font-size:0.75rem;color:#374151;margin-top:4px;line-height:1.4">${_escapeHtml(j.summary)}</div>` : ''}
        </div>`).join('')}</div>
      </details>` : ''}
    </div>`;
  }

  document.getElementById('jbGo').addEventListener('click', async () => {
    const out = document.getElementById('jbOut');
    // Collect checked companies
    const checked = Array.from(document.querySelectorAll('.jb-cb:checked')).map(cb => cb.value.trim()).filter(Boolean);
    // Also include manual text field if filled
    const manual = (document.getElementById('jbCo').value || '').trim();
    const toScan = [...new Set([...checked, ...(manual ? [manual] : [])])];
    if (!toScan.length) { out.innerHTML = '<div style="background:#FEF3C7;color:#92400E;padding:12px;border-radius:8px">⚠ Select at least one company or type a name below.</div>'; return; }

    // Progress display
    const progRows = toScan.map(c => `<div id="jbProg_${_escapeHtml(c.replace(/\W/g,'_'))}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:0.82rem"><span style="display:inline-block;width:12px;height:12px;border:2px solid #E5E7EB;border-top-color:#0066FF;border-radius:50%;animation:jbSpin 0.8s linear infinite;flex-shrink:0"></span><span style="color:#0A1628;font-weight:600">${_escapeHtml(c)}</span><span style="color:#9CA3AF;font-size:0.72rem">scanning…</span></div>`).join('');
    out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:4px;margin-bottom:14px"><style>@keyframes jbSpin{to{transform:rotate(360deg)}}</style>${progRows}</div>`;

    const btn = document.getElementById('jbGo');
    btn.disabled = true; btn.textContent = '⏳ Scanning…';

    // Scan all in parallel (max 3 concurrent to avoid Perplexity rate-limits)
    const results = [];
    const queue = [...toScan];
    let qi = 0;
    const workers = new Array(Math.min(3, toScan.length)).fill(0).map(async () => {
      while (qi < toScan.length) {
        const idx = qi++;
        const company = toScan[idx];
        const progId = 'jbProg_' + company.replace(/\W/g,'_');
        try {
          const r = await _jbScanOne(company);
          results[idx] = { ...r, company };
          const el = document.getElementById(progId);
          if (el) el.innerHTML = `<span style="width:12px;height:12px;flex-shrink:0;text-align:center">✅</span><span style="color:#0A1628;font-weight:600">${_escapeHtml(company)}</span><span style="color:#15803D;font-size:0.72rem">${r.ok ? (r.total_jobs||0) + ' roles found' : _escapeHtml(r.error||'failed')}</span>`;
        } catch(e) {
          results[idx] = { ok:false, company, error: e.message };
          const el = document.getElementById(progId);
          if (el) el.innerHTML = `<span style="width:12px;height:12px;flex-shrink:0">❌</span><span style="color:#0A1628;font-weight:600">${_escapeHtml(company)}</span><span style="color:#B91C1C;font-size:0.72rem">${_escapeHtml(e.message)}</span>`;
        }
      }
    });
    await Promise.all(workers);

    btn.disabled = false; btn.textContent = '💼 Scan Open Roles';

    // Build output
    const succeeded = results.filter(r => r && r.ok);
    let html = '';
    if (results.length > 1) {
      // Matrix + individual cards
      html += _jbRenderMatrix(results.filter(Boolean));
      html += '<div style="margin-top:4px">' + results.filter(Boolean).map(r => _jbRenderCard(r)).join('') + '</div>';
    } else if (results.length === 1) {
      html = _jbRenderCard(results[0]);
    }
    out.innerHTML = html || '<div style="color:#9CA3AF">No results.</div>';
  });
  } finally {
    try {
      if (window.IGFields) {
        IGFields.resume && IGFields.resume({ scan: false });
        IGFields.scanRoot && IGFields.scanRoot(wrap);
      }
    } catch(_) {}
    const _dt = ((window.performance && performance.now) ? performance.now() : Date.now()) - _t0;
    window.IGDiag && IGDiag.log('buildJobBoardSpy: done', _dt.toFixed(0) + 'ms');
  }
};

// ============================================================================
// TIER 18-E — Video Script Generator
// ============================================================================
window.buildVideoScript = function() {
  const wrap = document.getElementById('vsWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">TOPIC / PRODUCT</label>
      <input id="vsTopic" placeholder='e.g. "5 hidden features of our analytics dashboard"' style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.88rem;box-sizing:border-box">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:10px">
        <div><label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:3px">PLATFORM</label><select id="vsPlatform" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;box-sizing:border-box">
          <option value="tiktok">TikTok</option><option value="reels">Reels</option><option value="shorts">YT Shorts</option><option value="linkedin">LinkedIn</option>
        </select></div>
        <div><label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:3px">TONE</label><select id="vsTone" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;box-sizing:border-box">
          <option value="energetic">Energetic</option><option value="educational">Educational</option><option value="funny">Funny</option><option value="dramatic">Dramatic</option><option value="authoritative">Authoritative</option><option value="conversational">Conversational</option>
        </select></div>
        <div><label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:3px">DURATION (s)</label><input id="vsDur" type="number" min="15" max="180" value="30" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.68rem;font-weight:700;color:#6B7280;margin-bottom:3px">VARIANTS</label><input id="vsCount" type="number" min="1" max="5" value="3" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.8rem;box-sizing:border-box"></div>
      </div>
      <button id="vsGo" style="margin-top:12px;background:linear-gradient(135deg,#EC4899,#F472B6);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🎬 Generate Scripts</button>
    </div>
    <div id="vsOut"></div>
  `;
  document.getElementById('vsGo').addEventListener('click', async () => {
    const topic = document.getElementById('vsTopic').value.trim();
    const platform = document.getElementById('vsPlatform').value;
    const tone = document.getElementById('vsTone').value;
    const duration = parseInt(document.getElementById('vsDur').value, 10);
    const count = parseInt(document.getElementById('vsCount').value, 10);
    const out = document.getElementById('vsOut');
    if (!topic) { out.innerHTML = '<div style="color:#991B1B">⚠ Topic required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Generating ' + count + ' script(s)…</div>';
    try {
      const r = await fetch('/api/video-script/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ topic, platform, tone, duration, count }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      out.innerHTML = `<div style="display:grid;gap:14px">${(r.scripts||[]).map((s, i) => `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;border-left:4px solid #EC4899">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:#0A1628;font-size:1rem">🎬 Variant ${i+1} <span style="background:#FCE7F3;color:#9F1239;padding:3px 10px;border-radius:14px;font-size:0.7rem;font-weight:700;margin-left:8px">${_escapeHtml(s.viral_pattern||'')}</span></h3>
          <span style="font-size:0.74rem;color:#6B7280;font-weight:700">${_n(s.estimated_duration_sec, duration)}s</span>
        </div>
        <div style="background:linear-gradient(135deg,#FCE7F3,#FBCFE8);border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="font-size:0.66rem;font-weight:800;color:#9F1239;text-transform:uppercase;margin-bottom:3px">⚡ HOOK (0-3s)</div>
          <div style="font-size:0.96rem;font-weight:700;color:#0A1628">"${_escapeHtml(s.hook||'')}"</div>
        </div>
        <div style="margin-bottom:10px">
          <div style="font-size:0.7rem;font-weight:800;color:#6B7280;text-transform:uppercase;margin-bottom:6px">📝 BODY</div>
          ${(s.body||[]).map((b, bi) => `<div style="display:grid;grid-template-columns:24px 1fr 1fr 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #F3F4F6;font-size:0.78rem">
            <div style="color:#9CA3AF;font-weight:700">${_n(bi+1)}.</div>
            <div><div style="font-size:0.66rem;color:#9CA3AF;font-weight:700">SPOKEN</div><div style="color:#0A1628">${_escapeHtml(b.line||'')}</div></div>
            <div><div style="font-size:0.66rem;color:#9CA3AF;font-weight:700">ON-SCREEN</div><div style="color:#1E1B4B;font-weight:700">${_escapeHtml(b.onscreen_text||'')}</div></div>
            <div><div style="font-size:0.66rem;color:#9CA3AF;font-weight:700">CUE</div><div style="color:#7C3AED;font-style:italic">${_escapeHtml(b.cue||'')}</div></div>
          </div>`).join('')}
        </div>
        <div style="background:linear-gradient(135deg,#10B981,#34D399);color:#fff;border-radius:8px;padding:10px 14px;margin-bottom:10px">
          <div style="font-size:0.66rem;font-weight:800;text-transform:uppercase;margin-bottom:3px">🎯 CTA</div>
          <div style="font-size:0.92rem;font-weight:700">"${_escapeHtml(s.cta||'')}"</div>
        </div>
        <div style="font-size:0.78rem;color:#6B7280">${(s.hashtags||[]).map(h => `<span style="background:#F3F4F6;padding:2px 8px;border-radius:10px;margin-right:4px;color:#0066FF;font-weight:700">${_escapeHtml(h)}</span>`).join('')}</div>
      </div>`).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 19-A — Chatbot Builder
// ============================================================================
window.buildChatbotBuilder = function() {
  const wrap = document.getElementById('cbWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">BRAND NAME *</label><input id="cbBrand" placeholder="e.g. Acme Inc" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">AUDIENCE</label><input id="cbAud" placeholder="e.g. small-business owners" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
      </div>
      <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">PRODUCT / SERVICE DESCRIPTION</label>
      <textarea id="cbDesc" rows="3" placeholder="e.g. We sell AI-powered marketing intelligence software starting at $99/month. Self-serve signup, 14-day free trial. Integrates with HubSpot and Salesforce." style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;margin-bottom:10px"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">TONE</label><select id="cbTone" style="width:100%;padding:7px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
          <option value="friendly">Friendly</option><option value="professional">Professional</option><option value="playful">Playful</option><option value="concise">Concise</option><option value="enthusiastic">Enthusiastic</option>
        </select></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">ACCENT COLOR</label><input id="cbAccent" type="color" value="#6366F1" style="width:100%;padding:3px;border:1px solid #D1D5DB;border-radius:5px;height:34px;box-sizing:border-box"></div>
      </div>
      <button id="cbGo" style="background:linear-gradient(135deg,#6366F1,#8B5CF6);color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">💬 Generate Chatbot</button>
    </div>
    <div id="cbOut"></div>
  `;
  document.getElementById('cbGo').addEventListener('click', async () => {
    const brand = document.getElementById('cbBrand').value.trim();
    const description = document.getElementById('cbDesc').value.trim();
    const audience = document.getElementById('cbAud').value.trim();
    const tone = document.getElementById('cbTone').value;
    const accent = document.getElementById('cbAccent').value;
    const out = document.getElementById('cbOut');
    if (!brand) { out.innerHTML = '<div style="color:#991B1B">⚠ Brand required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ GPT-4o-mini drafting greeting + FAQ + lead-capture (10-20s)…</div>';
    try {
      const r = await fetch('/api/chatbot/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ brand, description, audience, tone, accent }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const safeAccent = /^#[0-9a-f]{3,8}$/i.test(r.accent || '') ? r.accent : '#6366F1';
      const embedSnippet = `<!-- ${brand.replace(/[<>]/g,'')} chatbot -->
<div id="ig-chatbot-${_n(r.id) || 0}" data-brand="${brand.replace(/"/g,'&quot;')}"></div>
<script>
(function(){
  var cfg = ${JSON.stringify({id:_n(r.id), greeting:r.greeting, faq:r.faq, fallback:r.fallback, lead_fields:r.lead_fields, accent:safeAccent}, null, 2)};
  // TODO: wire cfg into your chatbot frontend (Tidio, Crisp, Intercom, or custom).
  console.log('${brand.replace(/'/g,"\\'")} chatbot config loaded:', cfg);
})();
<\/script>`;
      out.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <div>
            <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;border-left:4px solid ${safeAccent}">
              <div style="background:${safeAccent};color:#fff;padding:12px 16px;font-weight:800">💬 ${_escapeHtml(r.brand)} <span style="opacity:.8;font-weight:500;font-size:0.8rem">· Live preview</span></div>
              <div style="padding:14px 16px;background:#F9FAFB;font-size:0.85rem;color:#0A1628;border-bottom:1px solid #F3F4F6"><strong>Bot:</strong> ${_escapeHtml(r.greeting)}</div>
              <div style="padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid #F3F4F6">${(r.quick_replies||[]).map(q => `<span style="background:#fff;border:1px solid ${safeAccent};color:${safeAccent};padding:4px 10px;border-radius:14px;font-size:0.74rem;font-weight:700">${_escapeHtml(q)}</span>`).join('')}</div>
              <div style="max-height:340px;overflow-y:auto">${(r.faq||[]).map(f => `<div style="padding:10px 16px;border-bottom:1px solid #F3F4F6">
                <div style="font-size:0.72rem;color:#6B7280;font-weight:700;text-transform:uppercase;margin-bottom:3px">${_escapeHtml(f.kind)}</div>
                <div style="font-size:0.84rem;font-weight:700;color:#0A1628;margin-bottom:4px">Q: ${_escapeHtml(f.q)}</div>
                <div style="font-size:0.8rem;color:#374151;line-height:1.5">A: ${_escapeHtml(f.a)}</div>
              </div>`).join('')}</div>
              <div style="padding:12px 16px;background:#F9FAFB;font-size:0.78rem;color:#6B7280;font-style:italic">Fallback: ${_escapeHtml(r.fallback)}</div>
            </div>
          </div>
          <div>
            <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px;margin-bottom:14px">
              <h3 style="margin:0 0 8px;font-size:0.92rem;color:#0A1628">📝 Lead-capture fields</h3>
              ${(r.lead_fields||[]).map(lf => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:0.82rem"><span><strong>${_escapeHtml(lf.label)}</strong> <code style="background:#F3F4F6;padding:1px 6px;border-radius:4px;font-size:0.72rem;color:#6B7280">${_escapeHtml(lf.key)}</code></span>${lf.required ? '<span style="color:#DC2626;font-weight:700;font-size:0.72rem">REQUIRED</span>' : '<span style="color:#9CA3AF;font-size:0.72rem">optional</span>'}</div>`).join('')}
            </div>
            <div style="background:#0A1628;border-radius:12px;padding:14px;color:#E5E7EB">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0;font-size:0.92rem;color:#fff">📋 Embed snippet</h3><button id="cbCopy" style="background:${safeAccent};color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:0.74rem;font-weight:700;cursor:pointer">📋 Copy</button></div>
              <pre id="cbCode" style="background:#1F2937;padding:10px;border-radius:6px;font-size:0.7rem;color:#A7F3D0;overflow:auto;max-height:280px;margin:0;white-space:pre-wrap;word-break:break-word">${_escapeHtml(embedSnippet)}</pre>
            </div>
          </div>
        </div>`;
      const copyBtn = document.getElementById('cbCopy');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        const codeEl = document.getElementById('cbCode');
        if (codeEl && navigator.clipboard) navigator.clipboard.writeText(codeEl.textContent || '').then(() => { copyBtn.textContent = '✓ Copied'; setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1800); });
      });
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 19-B — Glassdoor Sentiment
// ============================================================================
window.buildGlassdoor = function() {
  const wrap = document.getElementById('gdWrap'); if (!wrap) return;
  const ownBrand = (window.analysisData && window.analysisData.brandName) || '';
  const compNames = (window.analysisData && Array.isArray(window.analysisData.competitors))
    ? window.analysisData.competitors.map(c => c.name || c.domain).filter(Boolean).slice(0, 15)
    : [];
  const pickerOpts = [
    ownBrand ? `<option value="${_escapeHtml(ownBrand)}">${_escapeHtml(ownBrand)} (your brand)</option>` : '',
    ...compNames.map(n => `<option value="${_escapeHtml(n)}">${_escapeHtml(n)}</option>`)
  ].filter(Boolean).join('');
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:3fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">COMPANY * <span style="color:#15803D;font-weight:600">(auto-filled from your analysis)</span></label>
          ${pickerOpts
            ? `<select id="gdPick" onchange="window._gdPickChange()" style="width:100%;padding:7px 10px;border:1.5px solid #D1D5DB;border-radius:5px;font-size:0.78rem;background:#F9FAFB;margin-bottom:5px;box-sizing:border-box">
                 <option value="">— Pick from your analysis (or type manually below) —</option>
                 ${pickerOpts}
               </select>`
            : `<div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:5px">💡 Run an analysis to unlock brand/competitor pickers.</div>`}
          <input id="gdCo" value="${_escapeHtml(ownBrand)}" placeholder="e.g. Salesforce — or pick from list above" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box;background:${ownBrand?'#F0FDF4':'#fff'}">
        </div>
        <div style="display:flex;align-items:flex-end"><button id="gdGo" style="width:100%;background:linear-gradient(135deg,#0E9F6E,#14B8A6);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🏢 Scan Glassdoor</button></div>
      </div>
    </div>
    <div id="gdOut"></div>
  `;
  window._gdPickChange = function() {
    const s = document.getElementById('gdPick'), i = document.getElementById('gdCo');
    if (s && i && s.value) i.value = s.value;
  };
  document.getElementById('gdGo').addEventListener('click', async () => {
    const company = document.getElementById('gdCo').value.trim();
    const out = document.getElementById('gdOut');
    if (!company) { out.innerHTML = '<div style="color:#991B1B">⚠ Company required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Searching Glassdoor (20-40s)…</div>';
    try {
      const r = await fetch('/api/glassdoor/scan', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ company }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const sentColor = { positive:['#ECFDF5','#065F46'], neutral:['#F3F4F6','#374151'], negative:['#FEF2F2','#991B1B'] };
      const ratingNum = Number.isFinite(Number(r.overall_rating)) ? Number(r.overall_rating) : null;
      const ratingPct = ratingNum ? Math.min(100, Math.max(0, (ratingNum/5)*100)) : 0;
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px 20px;margin-bottom:14px">
          <h3 style="margin:0 0 12px;color:#0A1628">🏢 ${_escapeHtml(r.company)}</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;text-align:center">
            <div><div style="font-size:1.6rem;font-weight:800;color:#0E9F6E">${ratingNum !== null ? ratingNum.toFixed(1) : '—'}</div><div style="font-size:0.72rem;color:#6B7280;font-weight:700">OVERALL ⭐</div><div style="background:#E5E7EB;height:5px;border-radius:3px;margin-top:6px;overflow:hidden"><div style="background:#0E9F6E;height:100%;width:${ratingPct}%"></div></div></div>
            <div><div style="font-size:1.6rem;font-weight:800;color:#0066FF">${_n(r.ceo_approval) || '—'}${r.ceo_approval != null ? '%' : ''}</div><div style="font-size:0.72rem;color:#6B7280;font-weight:700">CEO APPROVAL</div></div>
            <div><div style="font-size:1.6rem;font-weight:800;color:#7C3AED">${_n(r.recommend_pct) || '—'}${r.recommend_pct != null ? '%' : ''}</div><div style="font-size:0.72rem;color:#6B7280;font-weight:700">RECOMMEND</div></div>
            <div><div style="font-size:1.6rem;font-weight:800;color:#374151">${_n(r.total_reviews) || '—'}</div><div style="font-size:0.72rem;color:#6B7280;font-weight:700">REVIEWS</div></div>
          </div>
        </div>
        ${(r.culture_signals||[]).length ? `<div style="background:linear-gradient(135deg,#F3E8FF,#FAE8FF);border-radius:12px;padding:16px 20px;margin-bottom:14px;border-left:4px solid #7C3AED">
          <h3 style="margin:0 0 8px;color:#5B21B6;font-size:0.96rem">🎯 Culture Signals (Strategic)</h3>
          <ul style="margin:0;padding-left:22px;color:#0A1628;font-size:0.85rem;line-height:1.65">${(r.culture_signals||[]).map(s => `<li style="margin-bottom:4px">${_escapeHtml(s)}</li>`).join('')}</ul>
        </div>` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px"><h4 style="margin:0 0 8px;color:#065F46">👍 Top Praises</h4><ul style="margin:0;padding-left:20px;color:#065F46;font-size:0.82rem;line-height:1.6">${(r.top_praises||[]).map(t => `<li>${_escapeHtml(t)}</li>`).join('') || '<li><em>None</em></li>'}</ul></div>
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:14px"><h4 style="margin:0 0 8px;color:#991B1B">👎 Top Complaints</h4><ul style="margin:0;padding-left:20px;color:#991B1B;font-size:0.82rem;line-height:1.6">${(r.top_complaints||[]).map(t => `<li>${_escapeHtml(t)}</li>`).join('') || '<li><em>None</em></li>'}</ul></div>
        </div>
        <h3 style="color:#0A1628;font-size:1rem;margin:16px 0 10px">💬 Recent Reviews (${(r.reviews||[]).length})</h3>
        <div style="display:grid;gap:10px">${(r.reviews||[]).map(rev => {
          const sk = (rev.sentiment||'neutral').toLowerCase();
          const c = sentColor[sk] || sentColor.neutral;
          return `<div style="background:${c[0]};border:1px solid #E5E7EB;border-left:4px solid ${c[1]};border-radius:8px;padding:12px 14px">
            <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;align-items:start">
              <div><strong style="color:#0A1628;font-size:0.9rem">${_escapeHtml(rev.title||'(no title)')}</strong> <span style="color:#6B7280;font-size:0.74rem">· ${_escapeHtml(rev.role||'')} · ${_escapeHtml(rev.tenure||'')}</span></div>
              <div style="white-space:nowrap"><span style="font-weight:800;color:${c[1]}">${Number.isFinite(Number(rev.rating)) ? Number(rev.rating).toFixed(1)+'⭐' : ''}</span> <span style="color:#9CA3AF;font-size:0.72rem;margin-left:6px">${_escapeHtml(rev.date||'')}</span></div>
            </div>
            ${rev.pros ? `<div style="font-size:0.8rem;color:#065F46;margin-top:4px"><strong>Pros:</strong> ${_escapeHtml(rev.pros)}</div>` : ''}
            ${rev.cons ? `<div style="font-size:0.8rem;color:#991B1B;margin-top:4px"><strong>Cons:</strong> ${_escapeHtml(rev.cons)}</div>` : ''}
          </div>`;
        }).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIER 19-C — Quora Mining
// ============================================================================
window.buildQuoraMining = function() {
  const wrap = document.getElementById('qmWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">TOPIC *</label><input id="qmTopic" placeholder="e.g. CRM software for small business" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">YOUR BRAND (opt.)</label><input id="qmBrand" placeholder="e.g. HubSpot" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div style="display:flex;align-items:flex-end"><button id="qmGo" style="width:100%;background:linear-gradient(135deg,#B92B27,#DC2626);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">❓ Mine Quora</button></div>
      </div>
    </div>
    <div id="qmOut"></div>
  `;
  document.getElementById('qmGo').addEventListener('click', async () => {
    const topic = document.getElementById('qmTopic').value.trim();
    const brand = document.getElementById('qmBrand').value.trim();
    const out = document.getElementById('qmOut');
    if (!topic) { out.innerHTML = '<div style="color:#991B1B">⚠ Topic required</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Searching Quora (20-40s)…</div>';
    try {
      const r = await fetch('/api/quora-mining/mine', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ topic, brand }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const intentColor = { informational:'#0066FF', comparison:'#7C3AED', recommendation:'#EC4899', complaint:'#DC2626', 'how-to':'#0E9F6E', definition:'#F59E0B' };
      out.innerHTML = `
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px 18px;margin-bottom:14px">
          <strong style="color:#0A1628;font-size:0.96rem">${_n(r.total)} Quora questions about "${_escapeHtml(r.topic)}"</strong>
          <span style="color:#6B7280;font-size:0.8rem;margin-left:8px">Sorted by engagement (answers + views)</span>
        </div>
        <div style="display:grid;gap:12px">${(r.questions||[]).map((q, i) => {
          const c = intentColor[(q.intent||'informational').toLowerCase()] || '#6B7280';
          return `<div style="background:#fff;border:1px solid #E5E7EB;border-left:4px solid ${c};border-radius:10px;padding:14px 16px">
            <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:8px;align-items:start">
              <div style="flex:1"><strong style="color:#0A1628;font-size:0.92rem">${_n(i+1)}. ${_escapeHtml(q.question||'')}</strong></div>
              <span style="background:${c};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.68rem;font-weight:700;text-transform:uppercase;white-space:nowrap">${_escapeHtml(q.intent||'')}</span>
            </div>
            <div style="font-size:0.74rem;color:#6B7280;margin-bottom:6px">📝 ${_n(q.answer_count)} answers · 👁 ${_n(q.view_count).toLocaleString()} views ${q.url ? `· <a href="${_safeUrl(q.url)}" target="_blank" rel="noopener" style="color:#B92B27;text-decoration:none;font-weight:700">View on Quora ↗</a>` : ''}</div>
            ${q.top_answer_summary ? `<div style="background:#F9FAFB;padding:8px 12px;border-radius:6px;font-size:0.8rem;color:#374151;margin-bottom:8px"><strong>Top answer:</strong> ${_escapeHtml(q.top_answer_summary)}</div>` : ''}
            ${q.suggested_response_angle ? `<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:8px 12px;border-radius:4px;font-size:0.82rem;color:#78350F"><strong>💡 Your angle:</strong> ${_escapeHtml(q.suggested_response_angle)}</div>` : ''}
          </div>`;
        }).join('')}</div>`;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// SOCIAL ANALYTICS (Zernio per-account engagement)
// ============================================================================
window.buildSocialAnalytics = async function() {
  const wrap = document.getElementById('saWrap'); if (!wrap) return;
  wrap.innerHTML = '<div style="color:#9CA3AF">⏳ Loading Zernio profiles…</div>';
  let profiles = [];
  try {
    const pr = await fetch('/api/social-publisher/profiles').then(x => x.json());
    profiles = pr.profiles || [];
  } catch (e) { wrap.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; return; }
  if (!profiles.length) { wrap.innerHTML = `<div style="background:#FEF3C7;color:#78350F;padding:16px;border-radius:10px">No Zernio profile yet. <a href="#" id="saGoSP" style="font-weight:700;color:#B45309">Open Social Publisher to create one →</a></div>`; const g = document.getElementById('saGoSP'); if (g) g.addEventListener('click', e => { e.preventDefault(); navigateTo('social-publisher'); }); return; }

  const profOpts = profiles.map(p => `<option value="${_escapeHtml(p._id)}">${_escapeHtml(p.name)}${p.isDefault ? ' (default)' : ''}</option>`).join('');
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;align-items:end">
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">PROFILE</label><select id="saProf" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">${profOpts}</select></div>
        <div><label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:3px">RANGE</label><select id="saRange" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
          <option value="7d">Last 7 days</option><option value="30d" selected>Last 30 days</option><option value="90d">Last 90 days</option>
        </select></div>
        <div><button id="saGo" style="width:100%;background:linear-gradient(135deg,#0066FF,#7C3AED);color:#fff;border:none;padding:9px 16px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">📈 Load Analytics</button></div>
      </div>
    </div>
    <div id="saOut"></div>
  `;
  const platIcon = { twitter:'🐦', instagram:'📷', facebook:'📘', linkedin:'💼', tiktok:'🎵', youtube:'📺', pinterest:'📌', reddit:'🔥', bluesky:'🦋', threads:'🧵', googlebusiness:'🏪', telegram:'✈️', snapchat:'👻', whatsapp:'💚', discord:'🎮' };
  document.getElementById('saGo').addEventListener('click', async () => {
    const profileId = document.getElementById('saProf').value;
    const range = document.getElementById('saRange').value;
    const out = document.getElementById('saOut');
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Pulling per-account engagement from Zernio (10-30s)…</div>';
    try {
      const r = await fetch(`/api/social-publisher/analytics?profileId=${encodeURIComponent(profileId)}&range=${encodeURIComponent(range)}`).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      if (r.note) { out.innerHTML = `<div style="background:#FEF3C7;color:#78350F;padding:16px;border-radius:10px"><strong>${_escapeHtml(r.note)}</strong> <a href="#" id="saGoSP2" style="font-weight:700;color:#B45309;margin-left:8px">Open Social Publisher →</a></div>`; const g = document.getElementById('saGoSP2'); if (g) g.addEventListener('click', e => { e.preventDefault(); navigateTo('social-publisher'); }); return; }
      const t = r.totals || {};
      const totalsHtml = `
        <div style="background:linear-gradient(135deg,#0066FF,#7C3AED);color:#fff;border-radius:12px;padding:18px;margin-bottom:14px">
          <div style="font-size:0.74rem;font-weight:700;text-transform:uppercase;opacity:.85;margin-bottom:8px">📊 Totals across ${_n((r.accounts||[]).length)} account(s) · last ${_escapeHtml(r.range)}</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;text-align:center">
            <div><div style="font-size:1.5rem;font-weight:800">${_n(t.posts).toLocaleString()}</div><div style="font-size:0.68rem;opacity:.85;font-weight:700">POSTS</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">${_n(t.impressions).toLocaleString()}</div><div style="font-size:0.68rem;opacity:.85;font-weight:700">IMPRESSIONS</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">${_n(t.likes + t.comments + t.shares + t.clicks).toLocaleString()}</div><div style="font-size:0.68rem;opacity:.85;font-weight:700">ENGAGEMENT</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">${(_f(t.engagementRate) || 0).toFixed(2)}%</div><div style="font-size:0.68rem;opacity:.85;font-weight:700">ENG. RATE</div></div>
            <div><div style="font-size:1.5rem;font-weight:800">${_n(t.followers).toLocaleString()}</div><div style="font-size:0.68rem;opacity:.85;font-weight:700">FOLLOWERS</div></div>
          </div>
        </div>`;
      const accountsHtml = (r.accounts || []).length ? `<div style="display:grid;gap:14px">${r.accounts.map(a => {
        const s = a.stats || {};
        const icon = platIcon[String(a.platform||'').toLowerCase()] || '🌐';
        const sourceTag = a.analyticsSource === 'zernio_analytics_endpoint'
          ? '<span style="background:#D1FAE5;color:#065F46;padding:2px 8px;border-radius:10px;font-size:0.66rem;font-weight:700;margin-left:8px">LIVE</span>'
          : a.analyticsSource === 'derived_from_posts'
            ? '<span style="background:#FEF3C7;color:#78350F;padding:2px 8px;border-radius:10px;font-size:0.66rem;font-weight:700;margin-left:8px">DERIVED</span>'
            : '<span style="background:#F3F4F6;color:#6B7280;padding:2px 8px;border-radius:10px;font-size:0.66rem;font-weight:700;margin-left:8px">NO DATA</span>';
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="margin:0;color:#0A1628;font-size:1rem">${icon} ${_escapeHtml(a.username || a.platform)} <span style="color:#9CA3AF;font-size:0.78rem;font-weight:500;margin-left:6px">${_escapeHtml(a.platform)}</span>${sourceTag}</h3>
            ${s.followerGrowth ? `<span style="color:${s.followerGrowth > 0 ? '#0E9F6E' : '#DC2626'};font-weight:800;font-size:0.84rem">${s.followerGrowth > 0 ? '▲' : '▼'} ${Math.abs(s.followerGrowth)}</span>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;text-align:center;margin-bottom:${a.topPost ? '12px' : '0'}">
            <div><div style="font-size:1.1rem;font-weight:800;color:#0066FF">${_n(s.posts).toLocaleString()}</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">POSTS</div></div>
            <div><div style="font-size:1.1rem;font-weight:800;color:#7C3AED">${_n(s.impressions).toLocaleString()}</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">IMPRESS.</div></div>
            <div><div style="font-size:1.1rem;font-weight:800;color:#EC4899">${_n(s.likes).toLocaleString()}</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">LIKES</div></div>
            <div><div style="font-size:1.1rem;font-weight:800;color:#0E9F6E">${_n(s.comments).toLocaleString()}</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">COMMENTS</div></div>
            <div><div style="font-size:1.1rem;font-weight:800;color:#F59E0B">${_n(s.shares).toLocaleString()}</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">SHARES</div></div>
            <div><div style="font-size:1.1rem;font-weight:800;color:#374151">${(_f(s.engagementRate) || 0).toFixed(2)}%</div><div style="font-size:0.62rem;color:#6B7280;font-weight:700">ENG. RATE</div></div>
          </div>
          ${a.topPost ? `<div style="background:#F9FAFB;border-left:3px solid #FBBF24;padding:10px 14px;border-radius:6px;margin-top:8px">
            <div style="font-size:0.66rem;font-weight:800;color:#92400E;text-transform:uppercase;margin-bottom:4px">🏆 Top Post · ${_n(a.topPost.engagement).toLocaleString()} engagements</div>
            <div style="font-size:0.84rem;color:#0A1628;line-height:1.5">${_escapeHtml(a.topPost.text)}${a.topPost.url ? ` <a href="${_safeUrl(a.topPost.url)}" target="_blank" rel="noopener" style="color:#0066FF;font-weight:700;text-decoration:none;margin-left:6px">View ↗</a>` : ''}</div>
          </div>` : ''}
        </div>`;
      }).join('')}</div>` : '<div style="background:#F9FAFB;color:#6B7280;padding:20px;border-radius:10px;text-align:center">No accounts yet</div>';
      out.innerHTML = totalsHtml + accountsHtml;
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// TIKTOK DOWNLOADER (Tier 20) — bulk-paste TikTok URLs → no-watermark mp4 + meta
// ============================================================================
window.buildTiktokDownloader = function() {
  const wrap = document.getElementById('ttdlWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:6px">TIKTOK URLS (one per line · max 25)</label>
      <textarea id="ttdlUrls" rows="6" placeholder="https://www.tiktok.com/@username/video/1234567890&#10;https://vm.tiktok.com/abc123/" style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.84rem;font-family:ui-monospace,monospace;box-sizing:border-box;resize:vertical"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <div style="font-size:0.74rem;color:#6B7280">Supports tiktok.com, vm.tiktok.com, vt.tiktok.com — short links auto-resolve.</div>
        <button id="ttdlGo" style="background:linear-gradient(135deg,#FE2C55,#25F4EE);color:#000;border:none;padding:9px 18px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">⬇️ Pull videos</button>
      </div>
    </div>
    <div id="ttdlOut"></div>
  `;
  document.getElementById('ttdlGo').addEventListener('click', async () => {
    const urls = document.getElementById('ttdlUrls').value.trim();
    const out = document.getElementById('ttdlOut');
    if (!urls) { out.innerHTML = '<div style="color:#991B1B">⚠ Paste at least one TikTok URL</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Resolving (5-20s, depends on URL count)…</div>';
    try {
      const r = await fetch('/api/tiktok-downloader/parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const summary = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px 18px;margin-bottom:14px">
        <strong style="color:#0A1628;font-size:0.96rem">${_n(r.succeeded)} of ${_n(r.total)} resolved</strong>
        ${r.failed ? `<span style="color:#B91C1C;margin-left:10px;font-size:0.8rem">· ${_n(r.failed)} failed</span>` : ''}
      </div>`;
      const cards = (r.results || []).map(v => {
        const tags = (v.hashtags || []).slice(0, 8).map(h => `<span style="background:#F3F4F6;color:#374151;padding:2px 8px;border-radius:10px;font-size:0.7rem;margin-right:4px">${_escapeHtml(h)}</span>`).join('');
        const proxyUrl = '/api/tiktok-downloader/proxy?url=' + encodeURIComponent(v.videoUrl || '');
        return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:0;overflow:hidden;display:grid;grid-template-columns:200px 1fr;gap:0">
          <div style="background:#000;display:flex;align-items:center;justify-content:center">
            ${v.coverUrl ? `<img src="${_safeUrl(v.coverUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;max-height:280px">` : '<div style="color:#fff;font-size:0.7rem;padding:40px 0">no cover</div>'}
          </div>
          <div style="padding:14px 16px">
            <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:8px">
              <div style="flex:1">
                <strong style="color:#0A1628;font-size:0.92rem">@${_escapeHtml(v.author || 'unknown')}</strong>
                ${v.authorName ? `<span style="color:#6B7280;font-size:0.78rem;margin-left:6px">${_escapeHtml(v.authorName)}</span>` : ''}
              </div>
              <a href="${_safeUrl(v.url)}" target="_blank" rel="noopener" style="color:#6B7280;font-size:0.72rem;text-decoration:none">View on TikTok ↗</a>
            </div>
            <div style="font-size:0.84rem;color:#0A1628;line-height:1.5;margin-bottom:8px">${_escapeHtml((v.caption || '').slice(0, 240))}${(v.caption || '').length > 240 ? '…' : ''}</div>
            ${tags ? `<div style="margin-bottom:10px">${tags}</div>` : ''}
            <div style="display:flex;gap:14px;font-size:0.74rem;color:#6B7280;margin-bottom:10px">
              <span>👁 ${_n(v.views).toLocaleString()}</span>
              <span>❤️ ${_n(v.likes).toLocaleString()}</span>
              <span>💬 ${_n(v.comments).toLocaleString()}</span>
              <span>↗ ${_n(v.shares).toLocaleString()}</span>
              <span>⏱ ${_n(v.duration)}s</span>
            </div>
            ${v.music ? `<div style="font-size:0.74rem;color:#6B7280;margin-bottom:10px">🎵 ${_escapeHtml(v.music)}${v.musicAuthor ? ` · ${_escapeHtml(v.musicAuthor)}` : ''}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${v.videoUrl ? `<a href="${proxyUrl}" download style="background:#0066FF;color:#fff;padding:6px 14px;border-radius:6px;font-size:0.78rem;font-weight:700;text-decoration:none">⬇ Download mp4 (no watermark)</a>` : '<span style="color:#9CA3AF;font-size:0.78rem">no mp4 available</span>'}
              <button data-cap="${_escapeHtml(v.caption || '')}" class="ttdlCopyCap" style="background:#fff;border:1px solid #D1D5DB;color:#374151;padding:6px 12px;border-radius:6px;font-size:0.78rem;font-weight:700;cursor:pointer">📋 Copy caption</button>
            </div>
          </div>
        </div>`;
      }).join('');
      const errs = (r.errors || []).length ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;margin-top:14px">
        <strong style="color:#92400E;font-size:0.84rem">⚠ ${_n(r.errors.length)} URL(s) failed</strong>
        <div style="margin-top:6px;font-size:0.76rem;color:#78350F">${r.errors.map(e => `<div style="margin-top:3px">• <code style="font-size:0.72rem">${_escapeHtml(e.url)}</code> — ${_escapeHtml(e.error || 'unknown')}</div>`).join('')}</div>
      </div>` : '';
      out.innerHTML = summary + `<div style="display:grid;gap:14px">${cards}</div>` + errs;
      out.querySelectorAll('.ttdlCopyCap').forEach(b => b.addEventListener('click', e => {
        const cap = e.currentTarget.getAttribute('data-cap') || '';
        navigator.clipboard.writeText(cap).then(() => {
          const orig = e.currentTarget.textContent;
          e.currentTarget.textContent = '✓ Copied';
          setTimeout(() => { e.currentTarget.textContent = orig; }, 1500);
        });
      }));
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });
};

// ============================================================================
// VOICEOVER (Tier 21) — OpenAI TTS, 6 voices, mp3 output
// ============================================================================
window.buildVoiceover = function() {
  const wrap = document.getElementById('voWrap'); if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:18px">
      <label style="display:block;font-size:0.7rem;font-weight:700;color:#6B7280;margin-bottom:6px">SCRIPT (max 4000 chars)</label>
      <textarea id="voText" rows="7" placeholder="Paste your video script, ad copy, or any text you want narrated..." style="width:100%;padding:10px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.86rem;font-family:inherit;box-sizing:border-box;resize:vertical"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:12px;align-items:end">
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:4px">VOICE</label>
          <select id="voVoice" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
            <option value="alloy">Alloy (neutral)</option><option value="echo">Echo (male, calm)</option><option value="fable">Fable (British, warm)</option><option value="onyx">Onyx (male, deep)</option><option value="nova">Nova (female, bright)</option><option value="shimmer">Shimmer (female, soft)</option>
          </select></div>
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:4px">QUALITY</label>
          <select id="voModel" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box">
            <option value="tts-1">Standard (fast & cheap)</option><option value="tts-1-hd">HD (richer, ~3x slower)</option>
          </select></div>
        <div><label style="display:block;font-size:0.66rem;font-weight:700;color:#6B7280;margin-bottom:4px">LABEL (opt.)</label>
          <input id="voLabel" placeholder="e.g. Q4 launch hero" style="width:100%;padding:8px;border:1px solid #D1D5DB;border-radius:5px;font-size:0.84rem;box-sizing:border-box"></div>
        <div><button id="voGo" style="width:100%;background:linear-gradient(135deg,#0066FF,#7C3AED);color:#fff;border:none;padding:9px 16px;border-radius:6px;font-size:0.84rem;font-weight:800;cursor:pointer">🔊 Generate</button></div>
      </div>
      <div id="voCount" style="margin-top:6px;font-size:0.7rem;color:#9CA3AF">0 chars</div>
    </div>
    <div id="voOut"></div>
    <div id="voHistory" style="margin-top:24px"></div>
  `;
  const txt = document.getElementById('voText');
  const cnt = document.getElementById('voCount');
  txt.addEventListener('input', () => { cnt.textContent = txt.value.length + ' / 4000 chars'; cnt.style.color = txt.value.length > 4000 ? '#B91C1C' : '#9CA3AF'; });

  document.getElementById('voGo').addEventListener('click', async () => {
    const text = txt.value.trim();
    const voice = document.getElementById('voVoice').value;
    const model = document.getElementById('voModel').value;
    const label = document.getElementById('voLabel').value.trim();
    const out = document.getElementById('voOut');
    if (!text) { out.innerHTML = '<div style="color:#991B1B">⚠ Paste some text to narrate</div>'; return; }
    if (text.length > 4000) { out.innerHTML = '<div style="color:#991B1B">⚠ Text exceeds 4000 character limit. Split into multiple voiceovers.</div>'; return; }
    out.innerHTML = '<div style="color:#9CA3AF">⏳ Generating audio (3-15s)…</div>';
    try {
      const r = await fetch('/api/voiceover/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text, voice, model, label }) }).then(x => x.json());
      if (!r.ok) { out.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(r.error)}</div>`; return; }
      const sizeKb = Math.round((r.sizeBytes || 0) / 1024);
      out.innerHTML = `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="color:#0A1628">🔊 ${_escapeHtml(voice)} · ${_escapeHtml(model)}</strong>
          <span style="color:#6B7280;font-size:0.78rem">${_n(r.charCount)} chars · ${_n(sizeKb)} KB</span>
        </div>
        <audio src="${_safeUrl(r.mp3Url)}" controls style="width:100%"></audio>
        <div style="margin-top:10px"><a href="${_safeUrl(r.mp3Url)}" download style="display:inline-block;background:#0066FF;color:#fff;padding:8px 16px;border-radius:6px;font-size:0.84rem;font-weight:700;text-decoration:none">⬇ Download mp3</a></div>
      </div>`;
      _voLoadHistory();
    } catch (e) { out.innerHTML = `<div style="color:#991B1B">Network error: ${_escapeHtml(e.message)}</div>`; }
  });

  function _voLoadHistory() {
    fetch('/api/voiceover/list').then(x => x.json()).then(j => {
      if (!j.ok || !j.items.length) { document.getElementById('voHistory').innerHTML = ''; return; }
      document.getElementById('voHistory').innerHTML = `<h3 style="font-size:0.94rem;color:#374151;margin-bottom:10px">Recent voiceovers</h3>
        <div style="display:grid;gap:10px">${j.items.slice(0, 10).map(it => `
          <div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:0.84rem;color:#0A1628">${_escapeHtml(it.label || '(no label)')} <span style="color:#9CA3AF;font-weight:500;margin-left:6px">${_escapeHtml(it.voice)} · ${_escapeHtml(it.model)} · ${_n(it.char_count)} chars</span></div>
              <div style="font-size:0.7rem;color:#6B7280">${new Date(it.created_at).toLocaleString()}</div>
            </div>
            <audio src="${_safeUrl(it.mp3_url)}" controls style="height:32px;flex-shrink:0"></audio>
          </div>`).join('')}</div>`;
    }).catch(() => {});
  }
  _voLoadHistory();
};


// ─── REDDIT DISCOVER QUESTIONS ──────────────────────────────────────────────
// Pairs with T38 — paste a business type, get the questions real customers
// are asking on Reddit right now. Inject a button onto the Reddit Pulse view.
(function() {
  const _origRP = window.buildRedditPulse;
  if (!_origRP || _origRP._discoverPatched) return;
  window.buildRedditPulse = function() {
    _origRP.apply(this, arguments);
    setTimeout(_rpInjectDiscover, 0);
  };
  window.buildRedditPulse._discoverPatched = true;
})();

function _rpInjectDiscover() {
  const wrap = document.getElementById('rpWrap');
  if (!wrap || document.getElementById('rpDiscoverPanel')) return;
  const panel = document.createElement('div');
  panel.id = 'rpDiscoverPanel';
  panel.style.cssText = 'background:linear-gradient(135deg,#7C3AED 0%,#5B21B6 100%);color:#fff;-webkit-text-fill-color:#fff;border-radius:12px;padding:18px;margin-bottom:18px';
  panel.innerHTML = `
    <div style="font-weight:800;margin-bottom:6px;color:#fff;-webkit-text-fill-color:#fff;font-size:1rem;text-shadow:0 1px 2px rgba(0,0,0,.25)">💡 Discover Questions Customers Ask</div>
    <div style="font-size:0.82rem;color:#fff;-webkit-text-fill-color:#fff;margin-bottom:12px;text-shadow:0 1px 2px rgba(0,0,0,.2)">Enter what you sell — get the real questions strangers ask about it on Reddit right now. Perfect for blog topics, FAQ pages, and your next carousel.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="rpDqInput" placeholder='What do you sell? e.g. "roof repair", "wedding photography"' style="flex:1;min-width:240px;padding:10px;border:none;border-radius:8px;font-size:0.88rem;color:#0F172A">
      <button onclick="_rpDiscover()" id="rpDqBtn" style="background:white;color:#7C3AED;border:none;padding:10px 18px;border-radius:8px;font-weight:800;cursor:pointer">🔍 Find Questions</button>
    </div>
    <div id="rpDqOut" style="margin-top:14px"></div>
  `;
  wrap.insertBefore(panel, wrap.firstChild);
}

async function _rpDiscover() {
  const inp = document.getElementById('rpDqInput');
  const btn = document.getElementById('rpDqBtn');
  const out = document.getElementById('rpDqOut');
  const businessType = (inp.value||'').trim();
  if (!businessType) { (window.showToast||alert)('⚠️ Tell me what you sell'); return; }
  btn.disabled = true; btn.textContent = '⏳ Searching…';
  out.innerHTML = '<div style="opacity:.8">Searching Reddit for "'+_esc(businessType)+'" questions…</div>';
  try {
    const r = await fetch('/api/reddit-pulse/discover-questions', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ businessType }) }).then(x=>x.json());
    if (!r.ok) throw new Error(r.error||'failed');
    if (!r.questions.length) { out.innerHTML = '<div style="opacity:.8">No question-style posts found in the last week. Try a broader term.</div>'; return; }
    out.innerHTML = `
      <div style="background:rgba(255,255,255,.1);border-radius:8px;padding:12px;margin-bottom:10px;font-size:0.84rem">
        Found <b>${r.total}</b> question-style posts. Showing top ${r.questions.length} by engagement. Pick one as your next carousel topic.
      </div>
      <div style="background:white;border-radius:10px;padding:8px;max-height:380px;overflow-y:auto">
        ${r.questions.map(q => `
          <div style="padding:10px 12px;border-bottom:1px solid #F1F5F9;color:#0F172A">
            <div style="font-size:0.86rem;font-weight:700;line-height:1.35;margin-bottom:4px">${_esc(q.title)}</div>
            <div style="font-size:0.72rem;color:#64748B;display:flex;gap:10px;flex-wrap:wrap">
              <span>r/${_esc(q.subreddit||'')}</span>
              <span>▲ ${q.upvotes||0}</span>
              <span>💬 ${q.comments||0}</span>
              ${q.url ? `<a href="${_esc(q.url)}" target="_blank" rel="noopener" style="color:#7C3AED;font-weight:700">View on Reddit ↗</a>` : ''}
              <button onclick="_rpToCarousel(${JSON.stringify(q.title).replace(/"/g,'&quot;')})" style="margin-left:auto;background:#F1F5F9;color:#0F172A;border:1px solid #CBD5E1;padding:3px 10px;border-radius:6px;font-size:0.7rem;font-weight:700;cursor:pointer">→ Make Carousel</button>
            </div>
          </div>`).join('')}
      </div>
    `;
  } catch (e) {
    out.innerHTML = '<div style="background:rgba(239,68,68,.2);border-radius:8px;padding:10px">⚠️ ' + _esc(e.message||e) + '</div>';
  } finally {
    btn.disabled = false; btn.textContent = '🔍 Find Questions';
  }
}

function _rpToCarousel(title) {
  navigateTo('carousel');
  setTimeout(() => {
    const t = document.getElementById('cgTopic');
    if (t) { t.value = title; t.focus(); }
  }, 300);
}

// Re-expose onclick entry points (these were global function declarations in app.js)
window._rpDiscover = _rpDiscover;
window._rpToCarousel = _rpToCarousel;

})();

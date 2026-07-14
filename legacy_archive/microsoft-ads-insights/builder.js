// ── Tier 14 #3: Microsoft Ads Insights ────────────────────────────────────
window.buildMicrosoftAdsInsights = async function() {
  const el = document.getElementById('msaiWrap'); if (!el) return;
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,#00A4EF 0%,#0078D4 100%);color:#fff;border-radius:12px;padding:18px 22px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div><div style="font-weight:800;font-size:1.05rem">🪟 Microsoft Advertising API</div><div style="font-size:0.82rem;opacity:.92;margin-top:2px">Live spend, ROAS and top campaigns — refreshes on every load.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="msaiRange" style="padding:7px 12px;border-radius:6px;border:none;font-weight:700;font-size:0.82rem;color:#0A1628;cursor:pointer">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button id="msaiTestBtn" style="padding:8px 14px;background:rgba(255,255,255,.18);border:2px solid rgba(255,255,255,.35);color:#fff;-webkit-text-fill-color:#fff;border-radius:6px;font-weight:800;cursor:pointer;font-size:0.78rem">⚡ Test</button>
      </div>
    </div>
    <div id="msaiSummary"></div>
    <div id="msaiCamps" style="margin-top:16px"></div>`;
  document.getElementById('msaiRange').addEventListener('change', _msaiLoad);
  document.getElementById('msaiTestBtn').addEventListener('click', _msaiTest);
  _msaiLoad();
};
window._msaiTest = async function() {
  showToast('⏳ Pinging Microsoft Ads…');
  const r = await fetch('/api/microsoft-ads-insights/test', { method:'POST' }).then(x=>x.json());
  showToast(r.ok ? `✅ Connected: customer ${r.account?.customerId||''}` : '❌ ' + r.error);
};
window._msaiFmt = window._miFmt;
window._msaiLoad = async function() {
  const days = (document.getElementById('msaiRange')||{}).value || '30';
  const sumEl = document.getElementById('msaiSummary'); if (sumEl) sumEl.innerHTML = `<div style="color:#6B7280;padding:14px">⏳ Loading account…</div>`;
  const [s, c] = await Promise.all([
    fetch(`/api/microsoft-ads-insights/account-summary?days=${days}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
    fetch(`/api/microsoft-ads-insights/campaigns?days=${days}`).then(x=>x.json()).catch(()=>({ok:false,error:'fetch failed'})),
  ]);

  if (sumEl) {
    if (s.source === 'placeholder') sumEl.innerHTML = `<div style="background:#FEF3C7;color:#92400E;padding:14px;border-radius:10px;border:1px solid #FDE68A">⚠️ <strong>${_escapeHtml(s.note||'Microsoft Ads not connected.')}</strong> <a href="#" onclick="navigateTo('settings');return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>`;
    else if (!s.ok) sumEl.innerHTML = `<div style="background:#FEE2E2;color:#B91C1C;padding:14px;border-radius:10px">${_escapeHtml(s.error||'failed')}</div>`;
    else {
      const m = s.summary;
      const tile = (label, val, color) => `<div style="background:#fff;border:1px solid #E5E7EB;border-top:3px solid ${color};border-radius:10px;padding:14px"><div style="font-size:0.7rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:1.5rem;font-weight:800;color:#0A1628;margin-top:4px">${val}</div></div>`;
      sumEl.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px">
        ${tile('Spend',_msaiFmt(m.spend,'money'),'#00A4EF')}
        ${tile('Revenue',_msaiFmt(m.revenue,'money'),'#15803D')}
        ${tile('ROAS', _msaiFmt(m.roas,'roas'), m.roas>=2?'#15803D':m.roas>=1?'#F59E0B':'#DC2626')}
        ${tile('Conversions',_msaiFmt(m.conversions),'#15803D')}
        ${tile('Impressions',_msaiFmt(m.impressions),'#0EA5E9')}
        ${tile('Clicks',_msaiFmt(m.clicks),'#0EA5E9')}
        ${tile('CTR',_msaiFmt(m.ctr,'pct'),'#F59E0B')}
        ${tile('CPC',_msaiFmt(m.cpc,'money'),'#F59E0B')}
        ${tile('CPM',_msaiFmt(m.cpm,'money'),'#F59E0B')}
      </div>`;
    }
  }

  const ce = document.getElementById('msaiCamps');
  if (ce) {
    if (c.source === 'placeholder') ce.innerHTML = '';
    else if (!c.ok || !c.campaigns?.length) ce.innerHTML = `<h3 style="margin:18px 0 10px;color:#0A1628">Campaigns</h3><div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:10px;padding:24px;text-align:center;color:#6B7280">${_escapeHtml(c.note||'No campaign data for this period.')}</div>`;
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
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_msaiFmt(x.spend,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#0A1628">${_msaiFmt(x.revenue,'money')}</td>
          <td style="padding:9px 12px;text-align:right"><span style="background:${rc};color:#fff;padding:2px 7px;border-radius:4px;font-weight:800;font-size:0.74rem">${_msaiFmt(x.roas,'roas')}</span></td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_msaiFmt(x.impressions)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_msaiFmt(x.clicks)}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_msaiFmt(x.ctr,'pct')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_msaiFmt(x.cpc,'money')}</td>
          <td style="padding:9px 12px;text-align:right;color:#374151">${_msaiFmt(x.conversions)}</td>
        </tr>`;}).join('')}</tbody></table></div>`;
  }
};

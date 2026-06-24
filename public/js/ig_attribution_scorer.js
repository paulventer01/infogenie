/* ============================================================================
   * ig_attribution_scorer.js — Blended Performance · Global Command Bar · Lead
   * Qualifier · Attribution & ROI · Lookalike Audience Builder · Content Scorer.
   * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
   * loaded after app.js in index.html. Wrapped in one IIFE; public entry points are
   * re-attached to window at the bottom (these were all top-level globals before).
   * Shared helpers (_escapeHtml, _esc, _safeUrl, showToast, navigateTo,
   * _getDomain/_getBrand/_getCompetitorsFromAnalysis, _igMultiselect*) remain in
   * app.js and resolve via the global scope chain at call time.
   * ========================================================================== */
  (function(){
  function buildBlendedPerf() { loadBlendedPerf(); }
async function loadBlendedPerf() {
  const wrap = document.getElementById('blendedPerfBody');
  if (!wrap) return;
  const days = parseInt(document.getElementById('blendedDays')?.value || '30', 10);
  wrap.innerHTML = '<div style="text-align:center;padding:48px;color:#64748B">⏳ Pulling spend from Meta + Google + TikTok and conversions from Amplitude…</div>';
  try {
    const r = await fetch('/api/blended-roas?days=' + days);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    wrap.innerHTML = _blendedHtml(j);
    _hydrateTrueRoasInline(days);
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load</b><div style="font-size:0.85rem;margin-top:6px">${safe}</div></div>`;
  }
}

// T36 — fetch True ROAS and inject into the inline span on the Blended hero.
async function _hydrateTrueRoasInline(days) {
  try {
    const r = await fetch('/api/true-roas/summary?days=' + (days || 30));
    const t = await r.json();
    const el = document.getElementById('trueRoasInline');
    if (!el || !t.ok) return;
    if (t.trueRoas == null && (!t.offline || t.offline.revenue === 0)) {
      el.innerHTML = '<a href="#" onclick="navigateTo(\'true-roas\');return false" style="color:#A7F3D0;text-decoration:underline">💡 Add offline revenue → unlock True ROAS</a>';
      return;
    }
    const uplift = (t.reportedRoas && t.trueRoas) ? +(((t.trueRoas / t.reportedRoas) - 1) * 100).toFixed(1) : null;
    el.innerHTML = '<b style="color:#34D399">True ROAS:</b> ' +
      (t.trueRoas != null ? t.trueRoas.toFixed(2) + '×' : '—') +
      ' <span style="opacity:.7">(+$' + Math.round(t.offline.revenue || 0).toLocaleString() + ' offline' +
      (uplift != null && uplift > 0 ? ', +' + uplift + '% vs reported' : '') + ')</span>';
  } catch (_) {}
}
function _blendedHtml(j) {
  // Escape every interpolated upstream string. Channel error strings + Amplitude
  // notes/error/event names all originate from third-party APIs and must be sanitised.
  const esc = (typeof _escapeHtml === 'function')
    ? _escapeHtml
    : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const fmtNum   = (n) => Number(n || 0).toLocaleString();
  const channels = [
    { key:'meta',   name:'Meta Ads',     color:'#1877F2', icon:'📘', data: j.channels.meta   },
    { key:'google', name:'Google Ads',   color:'#4285F4', icon:'🔵', data: j.channels.google },
    { key:'tiktok', name:'TikTok Ads',   color:'#000000', icon:'⚫', data: j.channels.tiktok },
  ];
  const okCount = channels.filter(c => c.data.ok).length;
  const totalChannels = channels.length;
  let connectionBanner = '';
  if (okCount === 0) {
    connectionBanner = `
      <a href="#" onclick="navigateTo&&navigateTo('settings');return false;" style="display:flex;align-items:center;gap:12px;background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;padding:13px 18px;margin-bottom:18px;color:#991B1B;text-decoration:none;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='#FEF2F2'">
        <span style="font-size:1.15rem;flex-shrink:0">⚠️</span>
        <div style="flex:1">
          <span style="font-weight:800;font-size:0.9rem">0 of ${totalChannels} ad platforms connected</span>
          <span style="font-size:0.8rem;opacity:.85;margin-left:8px">No live data — connect platforms to see blended performance.</span>
        </div>
        <span style="font-size:0.78rem;font-weight:700;white-space:nowrap;text-decoration:underline">Settings → Integrations →</span>
      </a>`;
  } else if (okCount < totalChannels) {
    const missingNames = channels.filter(c => !c.data.ok).map(c => c.name).join(', ');
    connectionBanner = `
      <a href="#" onclick="navigateTo&&navigateTo('settings');return false;" style="display:flex;align-items:center;gap:12px;background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:13px 18px;margin-bottom:18px;color:#92400E;text-decoration:none;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#FEF3C7'" onmouseout="this.style.background='#FFFBEB'">
        <span style="font-size:1.15rem;flex-shrink:0">🟡</span>
        <div style="flex:1">
          <span style="font-weight:800;font-size:0.9rem">${okCount} of ${totalChannels} ad platforms connected</span>
          <span style="font-size:0.8rem;opacity:.85;margin-left:8px">Missing: ${missingNames}</span>
        </div>
        <span style="font-size:0.78rem;font-weight:700;white-space:nowrap;text-decoration:underline">Settings → Integrations →</span>
      </a>`;
  }
  return `
    <!-- T34 — Madgicx-style Blended Summary hero. Platform pills above; the
         four CFO-glance metrics (Total Spend · MER · LTV/CAC · Net Sales)
         dominate; per-channel detail follows below. -->
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1E293B 50%,#312E81 100%);border-radius:18px;padding:28px 32px;color:white;margin-bottom:22px;box-shadow:0 8px 28px rgba(15,23,42,.35)">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px"><span style="font-size:1.15rem">📊</span><div style="font-size:1.05rem;font-weight:800">Blended Summary</div></div>
        <div style="display:flex;gap:6px">
          ${channels.map(c => `<span title="${esc(c.name)} · ${c.data.ok ? 'live' : 'not connected'}" style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;font-size:0.85rem;background:${c.data.ok ? c.color : '#475569'};opacity:${c.data.ok ? '1' : '0.4'}">${c.icon}</span>`).join('')}
        </div>
        <div style="margin-left:auto;font-size:0.74rem;opacity:.7">Last ${Number(j.days) || 0} days · ${okCount}/3 channels live</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px">
        <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:18px">
          <div style="font-size:0.7rem;color:rgba(255,255,255,.85);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Total Ad Spend</div>
          <div style="font-size:1.95rem;font-weight:800;line-height:1.1;color:#ffffff">${fmtMoney(j.totalSpend)}</div>
        </div>
        <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:18px">
          <div style="font-size:0.7rem;color:rgba(255,255,255,.85);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">MER</div>
          <div style="font-size:1.95rem;font-weight:800;line-height:1.1;color:#ffffff">${j.mer != null ? j.mer.toFixed(1) + '%' : '—'}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.7);margin-top:4px">Revenue ÷ Spend</div>
        </div>
        <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:18px">
          <div style="font-size:0.7rem;color:rgba(255,255,255,.85);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">LTV/CAC</div>
          <div style="font-size:1.95rem;font-weight:800;line-height:1.1;color:#ffffff">${j.ltvCac != null ? j.ltvCac.toFixed(2) : '—'}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.7);margin-top:4px">${j.cac != null ? 'CAC ' + fmtMoney(j.cac) : 'No CAC yet'}${j.ltvAssumed != null ? ' · LTV assumed ' + fmtMoney(j.ltvAssumed) : ''}</div>
        </div>
        <div style="background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:18px">
          <div style="font-size:0.7rem;color:rgba(255,255,255,.85);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">Net Sales</div>
          <div style="font-size:1.95rem;font-weight:800;line-height:1.1;color:#ffffff">${j.netSales != null ? fmtMoney(j.netSales) : '—'}</div>
          <div style="font-size:0.66rem;color:rgba(255,255,255,.7);margin-top:4px">Revenue minus ad spend</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:14px;font-size:0.72rem;color:rgba(255,255,255,.85)">
        <span><b>Customers:</b> ${fmtNum(j.customers)} <span style="color:rgba(255,255,255,.65)">(${esc(j.customerSource)})</span></span>
        <span><b>Total Revenue:</b> ${j.totalRevenue ? fmtMoney(j.totalRevenue) : '—'}</span>
        <span><b>Reported ROAS:</b> ${j.roas != null ? j.roas.toFixed(2) + '×' : '—'}</span>
        <span id="trueRoasInline" data-days="${Number(j.days)||30}" style="color:#A7F3D0">⏳ Loading True ROAS…</span>
      </div>
    </div>

    ${connectionBanner}
    <!-- Per-channel breakdown -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:22px">
      ${channels.map(c => {
        const d = c.data;
        if (!d.ok) {
          // Map raw API errors to plain-English "what to do" guidance
          const errStr = String(d.error || '').toLowerCase();
          let headline, fixHint, fixSecrets;
          if (d.error === 'not-configured') {
            headline = 'Not connected';
            fixHint  = 'Connect this platform to pull live spend and ROAS data.';
          } else if (c.key === 'meta' && (errStr.includes('oauth') || errStr.includes('access token') || errStr.includes('parse'))) {
            headline = 'Meta access token invalid or expired';
            fixHint  = 'Generate a fresh long-lived token in Meta Business Manager → System Users, then re-paste it. Make sure there are no quotes or trailing spaces.';
          } else if (c.key === 'google' && (errStr.includes('oauth') || errStr.includes('refresh') || errStr.includes('invalid_grant'))) {
            headline = 'Google Ads OAuth failed';
            fixHint  = 'Your refresh token has expired or the client ID/secret pair is wrong. Re-authorise in the Google OAuth playground and update the refresh token.';
          } else if (c.key === 'tiktok' && errStr.includes('advertiser')) {
            headline = 'TikTok advertiser ID rejected';
            fixHint  = 'The TIKTOK_ADVERTISER_ID secret must be the numeric advertiser ID only (no dashes, no quotes). Find it in TikTok Ads Manager → top-right account picker.';
          } else {
            headline = 'Could not connect';
            fixHint  = d.error || 'Unknown error from the platform';
          }
          fixSecrets = c.key === 'meta'   ? ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID']
                     : c.key === 'google' ? ['GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID']
                     : c.key === 'tiktok' ? ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID']
                     : c.key === 'microsoft' ? ['MICROSOFT_ADS_DEVELOPER_TOKEN','MICROSOFT_ADS_CLIENT_ID','MICROSOFT_ADS_CLIENT_SECRET','MICROSOFT_ADS_REFRESH_TOKEN','MICROSOFT_ADS_CUSTOMER_ID','MICROSOFT_ADS_ACCOUNT_ID']
                     : [];
          return `
            <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:20px">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                <span style="font-size:1.2rem">${c.icon}</span>
                <div style="font-weight:700;color:#0F172A">${esc(c.name)}</div>
                <span style="margin-left:auto;font-size:0.66rem;font-weight:700;padding:3px 9px;border-radius:999px;background:#FEF2F2;color:#991B1B;border:1px solid #FECACA">NOT LIVE</span>
              </div>
              <div style="font-size:0.82rem;color:#92400E;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-bottom:10px">
                <div style="font-weight:700;margin-bottom:4px">⚠️ ${esc(headline)}</div>
                <div style="font-size:0.78rem;line-height:1.45">${esc(fixHint)}<br><a href="#" onclick="navigateTo&&navigateTo('settings');return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>
              </div>
              ${fixSecrets.length ? `
                <div style="font-size:0.7rem;color:#64748B;margin-bottom:6px"><strong>Secrets to update:</strong> ${fixSecrets.map(s => `<code style="background:#F1F5F9;padding:1px 6px;border-radius:4px;font-size:0.72rem">${esc(s)}</code>`).join(' ')}</div>
              ` : ''}
              <button type="button" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));showToast&&showToast('Open Secrets to update ${esc(c.name)} credentials, then click Refresh')" style="margin-top:6px;background:white;color:#0EA5E9;border:1.5px solid #0EA5E9;padding:7px 14px;border-radius:8px;font-size:0.76rem;font-weight:700;cursor:pointer">⚙️ Open Settings</button>
              <button type="button" onclick="loadBlendedPerf&&loadBlendedPerf()" style="margin-top:6px;margin-left:6px;background:#F0F9FF;color:#0369A1;border:1px solid #BAE6FD;padding:7px 14px;border-radius:8px;font-size:0.76rem;font-weight:700;cursor:pointer">🔄 Retry</button>
            </div>`;
        }
        // T34 — per-channel card now surfaces Revenue, ROAS, CPM (when ingested
        // by the optimizer). Gracefully shows '—' when revenue source isn't wired.
        const hasRev = Number(d.revenue || 0) > 0;
        return `
          <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:20px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="font-size:1.2rem;display:inline-flex;width:26px;height:26px;border-radius:8px;align-items:center;justify-content:center;background:${c.color};color:white">${c.icon}</span><div style="font-weight:700;color:#0F172A">${esc(c.name)}</div><span style="margin-left:auto;font-size:0.7rem;font-weight:700;padding:3px 9px;border-radius:999px;background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0">LIVE</span></div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Ad Spend</div><div style="font-size:1.15rem;font-weight:700;color:#0F172A">${fmtMoney(d.spend)}</div></div>
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Revenue</div><div style="font-size:1.15rem;font-weight:700;color:${hasRev?'#059669':'#94A3B8'}">${hasRev ? fmtMoney(d.revenue) : '—'}</div></div>
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">ROAS</div><div style="font-size:1.15rem;font-weight:700;color:${d.roas!=null?'#0F172A':'#94A3B8'}">${d.roas != null ? d.roas.toFixed(2) + '×' : '—'}</div></div>
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">CPM</div><div style="font-size:1.15rem;font-weight:700;color:${d.cpm!=null?'#0F172A':'#94A3B8'}">${d.cpm != null ? fmtMoney(d.cpm) : '—'}</div></div>
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Conversions</div><div style="font-size:1rem;font-weight:600;color:#475569">${fmtNum(d.conversions)}</div></div>
              <div><div style="font-size:0.68rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px">Clicks</div><div style="font-size:1rem;font-weight:600;color:#475569">${fmtNum(d.clicks)}</div></div>
            </div>
            ${!hasRev ? `<div style="margin-top:10px;font-size:0.68rem;color:#94A3B8">Wire this campaign into the AI Optimizer to populate revenue + ROAS + CPM.</div>` : ''}
          </div>`;
      }).join('')}
    </div>

    <!-- Amplitude conversion source detail -->
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:20px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span style="font-size:1.2rem">📊</span><div style="font-weight:700;color:#0F172A">Amplitude conversion source</div></div>
      ${j.amplitude.ok ? (
        j.amplitude.conversions > 0 ?
          `<div style="font-size:0.85rem;color:#475569;margin-bottom:10px">Counted <b style="color:#0F172A">${fmtNum(j.amplitude.conversions)}</b> conversions across these events:</div>
           <div style="display:flex;flex-wrap:wrap;gap:6px">${(j.amplitude.conversionEvents||[]).map(e=>`<span style="font-size:0.78rem;padding:5px 10px;background:#F1F5F9;border-radius:999px;color:#0F172A"><b>${esc(e.event)}</b>: ${fmtNum(e.count)}</span>`).join('')}</div>` :
          `<div style="font-size:0.85rem;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:11px">${esc(j.amplitude.note || 'No conversion-pattern events found.')} Falling back to <b>ad-platform-reported conversions</b> for blended CAC.</div>`
      ) : `<div style="font-size:0.85rem;color:#991B1B;background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:11px">⚠️ Amplitude error: ${esc(j.amplitude.error || 'unknown')}. CAC computed from ad-platform-reported conversions instead.</div>`}
    </div>

    <div style="margin-top:18px;font-size:0.78rem;color:#64748B;line-height:1.5"><b>Note on ROAS:</b> ${esc(j.roasNote)}</div>`;
}

/* =============================================================================
   GLOBAL COMMAND BAR (⌘K / Ctrl+K)
   ============================================================================= */
function openCommandBar() {
  const bd = document.getElementById('commandBarBackdrop');
  if (!bd) return;
  bd.style.display = 'flex';
  // Robust focus: belt-and-braces because some browsers race the display:flex
  // with the focus call. Three staggered attempts + a click-to-focus handler
  // on the input itself ensures the user can always type.
  const focusInput = () => {
    const inp = document.getElementById('commandBarInput');
    if (!inp) return;
    try { inp.removeAttribute('disabled'); inp.removeAttribute('readonly'); } catch(_){}
    try { inp.focus({ preventScroll: true }); } catch(_) { try { inp.focus(); } catch(__){} }
    // If focus didn't stick (e.g. another modal stole it), try again.
    if (document.activeElement !== inp) {
      try { inp.focus(); } catch(_){}
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focusInput);
  setTimeout(focusInput, 80);
  setTimeout(focusInput, 200);
  // One-time guard: if the user clicks anywhere inside the input row but
  // focus is still elsewhere (e.g. body), force-focus the input.
  const inp = document.getElementById('commandBarInput');
  if (inp && !inp._cmdBarClickWired) {
    inp._cmdBarClickWired = true;
    inp.addEventListener('click', () => { try { inp.focus(); } catch(_){} });
  }
}
function closeCommandBar(e) {
  const bd = document.getElementById('commandBarBackdrop');
  if (!bd) return;
  if (e && e.target !== bd) return;
  bd.style.display = 'none';
}
function prefillCommand(text) {
  const inp = document.getElementById('commandBarInput');
  if (inp) { inp.value = text; try { inp.focus(); } catch(_){} }
}
async function runCommandBar(commandOverride, confirm) {
  const inp = document.getElementById('commandBarInput');
  const out = document.getElementById('commandBarResult');
  const command = commandOverride != null ? commandOverride : (inp?.value || '').trim();
  if (!command) { out.innerHTML = '<div style="color:#64748B;font-size:0.85rem">Type a command first.</div>'; return; }
  out.innerHTML = '<div style="display:flex;align-items:center;gap:10px;color:#64748B;font-size:0.88rem"><div class="cmdSpinner"></div>InfoGenie is figuring out which action to run…</div>';
  try {
    const r = await fetch('/api/assistant/command', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ command, confirm: !!confirm }),
    });
    const j = await r.json();
    if (!j.ok) { out.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:9px;padding:12px;color:#991B1B;font-size:0.85rem">⚠️ ${_escapeHtml(j.error || 'Failed')}${j.message ? ': ' + _escapeHtml(j.message) : ''}</div>`; return; }
    if (j.type === 'text') {
      out.innerHTML = `<div style="font-size:0.9rem;color:#0F172A;line-height:1.55;white-space:pre-wrap">${_escapeHtml(j.text)}</div>`;
    } else if (j.type === 'needs-confirmation') {
      out.innerHTML = `
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="font-weight:700;color:#92400E;margin-bottom:6px;font-size:0.88rem">⚠️ Confirm this action</div>
          <div style="font-size:0.85rem;color:#78350F;line-height:1.55">${_escapeHtml(j.preview)}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button onclick="document.getElementById('commandBarResult').innerHTML=''" style="padding:9px 14px;background:white;border:1px solid #CBD5E1;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600">Cancel</button>
          <button onclick="runCommandBar(${JSON.stringify(command).replace(/"/g,'&quot;')}, true)" style="padding:9px 16px;background:#DC2626;color:white;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:700">Yes, do it</button>
        </div>`;
    } else if (j.type === 'tool-executed') {
      out.innerHTML = `
        <div style="font-size:0.7rem;color:#0EA5E9;text-transform:uppercase;letter-spacing:.4px;font-weight:700;margin-bottom:6px">✅ Ran: ${_escapeHtml(j.toolName)}</div>
        <div style="font-size:0.9rem;color:#0F172A;line-height:1.55;margin-bottom:12px;white-space:pre-wrap">${_escapeHtml(j.summary)}</div>
        <details style="margin-top:8px"><summary style="font-size:0.78rem;color:#64748B;cursor:pointer">Show raw result</summary><pre style="background:#0F172A;color:#A7F3D0;padding:12px;border-radius:8px;font-size:0.74rem;overflow:auto;max-height:200px;margin-top:8px">${_escapeHtml(JSON.stringify(j.toolResult, null, 2))}</pre></details>`;
    }
  } catch (e) {
    out.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:9px;padding:12px;color:#991B1B;font-size:0.85rem">⚠️ ${_escapeHtml(e.message)}</div>`;
  }
}

// Global keyboard shortcut: ⌘K / Ctrl+K opens, Esc closes, Enter inside input runs.
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl+K
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandBar();
    return;
  }
  // Esc closes the bar
  if (e.key === 'Escape') {
    const bd = document.getElementById('commandBarBackdrop');
    if (bd && bd.style.display === 'flex') { bd.style.display = 'none'; }
    return;
  }
  // Enter inside the input runs the command
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'commandBarInput') {
    e.preventDefault();
    runCommandBar();
  }
});

// Spinner CSS (injected once)
(function injectCmdSpinnerCSS(){
  if (document.getElementById('cmdSpinnerCSS')) return;
  const s = document.createElement('style');
  s.id = 'cmdSpinnerCSS';
  s.textContent = '.cmdSpinner{width:14px;height:14px;border:2px solid #CBD5E1;border-top-color:#7C3AED;border-radius:50%;animation:cmdSpin .7s linear infinite}@keyframes cmdSpin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
})();

/* =============================================================================
   LEAD QUALIFIER — qualify inbound leads with GPT-4o (BANT + score + actions)
   ============================================================================= */
function refreshLeadQualifier() { buildLeadQualifier(); }
async function buildLeadQualifier() {
  const wrap = document.getElementById('leadQualifierBody');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:48px;color:#64748B">⏳ Loading qualified leads…</div>';
  try {
    const r = await fetch('/api/leads/qualified');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    wrap.innerHTML = _leadQualifierHtml(j.leads || []);
  } catch (e) {
    const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load</b><div style="font-size:0.85rem;margin-top:6px">${esc(e.message)}</div></div>`;
  }
}
function _leadQualifierHtml(leads) {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
      <!-- Left: qualify form -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:22px;box-shadow:0 1px 2px rgba(0,0,0,.04)">
        <div style="font-size:1rem;font-weight:800;color:#0F172A;margin-bottom:4px">Qualify a new lead</div>
        <div style="font-size:0.8rem;color:#64748B;margin-bottom:16px">GPT-4o scores fit + intent and gives you the best next move.</div>
        <div style="display:grid;gap:10px">
          <input id="leadName"     placeholder="Name (optional)"            style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem">
          <input id="leadEmail"    placeholder="Email * (required)"          style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem">
          <input id="leadCompany"  placeholder="Company (optional)"          style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem">
          <input id="leadSource"   placeholder="Source — webform, demo, referral…"  style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem">
          <textarea id="leadNotes" placeholder="Notes — anything you know (role, budget, timing, pain)…"  rows="3" style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem;resize:vertical;font-family:inherit"></textarea>
          <textarea id="leadBehaviour" placeholder="Recent behaviour (optional) — e.g. visited pricing 3x, downloaded CAC ebook"  rows="2" style="padding:10px 12px;border:1px solid #E5E7EB;border-radius:8px;font-size:0.88rem;resize:vertical;font-family:inherit"></textarea>
          <button onclick="submitLeadQualification()" id="leadQualifyBtn" style="margin-top:6px;padding:11px 18px;background:linear-gradient(135deg,#0369A1,#0EA5E9);color:white;border:none;border-radius:9px;font-weight:700;font-size:0.88rem;cursor:pointer">🧲 Qualify Lead</button>
        </div>
        <div id="leadQualifyResult" style="margin-top:14px"></div>
      </div>
      <!-- Right: history list -->
      <div>
        <div style="font-size:1rem;font-weight:800;color:#0F172A;margin-bottom:10px">Recent qualifications <span style="font-weight:500;color:#94A3B8">(${leads.length})</span></div>
        ${leads.length === 0
          ? `<div style="background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:14px;padding:32px;text-align:center;color:#64748B"><div style="font-size:2rem;margin-bottom:8px">🧲</div><div style="font-weight:600;color:#475569">No leads qualified yet</div><div style="font-size:0.82rem;margin-top:4px">Qualify your first lead with the form on the left, or ask the ✨ command bar: <i>"qualify jane@acme.com, CMO at Acme, downloaded our CAC ebook"</i>.</div></div>`
          : leads.map(_leadCard).join('')}
      </div>
    </div>`;
}
function _leadCard(lead) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const q = lead.qualification || {};
  const tier = String(q.tier || 'cold').toLowerCase();
  const tierStyle = tier === 'hot'  ? { bg:'#FEE2E2', border:'#FCA5A5', text:'#991B1B', label:'🔥 HOT'  }
                   : tier === 'warm' ? { bg:'#FFEDD5', border:'#FDBA74', text:'#9A3412', label:'☀️ WARM' }
                                     : { bg:'#E0F2FE', border:'#7DD3FC', text:'#075985', label:'❄️ COLD' };
  const score = Number(q.score || 0);
  const bant = q.bant || {};
  const actions = Array.isArray(q.suggestedActions) ? q.suggestedActions : [];
  const safeId = String(lead.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const bantRow = (k, v) => {
    const verdict = String((v && v.verdict) || 'unknown').toLowerCase();
    const vc = verdict === 'strong' ? '#065F46' : verdict === 'weak' ? '#991B1B' : '#475569';
    const vbg = verdict === 'strong' ? '#ECFDF5' : verdict === 'weak' ? '#FEF2F2' : '#F1F5F9';
    return `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid #F1F5F9">
      <div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#64748B;width:72px;flex-shrink:0">${esc(k)}</div>
      <div style="flex:1">
        <span style="display:inline-block;font-size:0.68rem;font-weight:700;padding:2px 7px;border-radius:999px;background:${vbg};color:${vc};margin-right:6px">${esc(verdict.toUpperCase())}</span>
        <span style="font-size:0.78rem;color:#475569">${esc((v && v.why) || '—')}</span>
      </div>
    </div>`;
  };
  return `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.04)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:#0F172A;font-size:0.95rem">${esc(lead.name || '(no name)')} <span style="color:#94A3B8;font-weight:500;font-size:0.82rem">· ${esc(lead.email)}</span></div>
          <div style="font-size:0.78rem;color:#64748B;margin-top:2px">${esc(lead.company || '—')}${lead.source ? ' · via ' + esc(lead.source) : ''}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:0.7rem;font-weight:800;padding:4px 10px;border-radius:999px;background:${tierStyle.bg};color:${tierStyle.text};border:1px solid ${tierStyle.border}">${tierStyle.label}</span>
          <span style="font-size:0.72rem;color:#64748B"><b style="color:#0F172A">${score}</b>/100</span>
        </div>
      </div>
      ${q.reasoning ? `<div style="font-size:0.82rem;color:#475569;background:#F8FAFC;border-left:3px solid #0EA5E9;padding:8px 12px;border-radius:0 8px 8px 0;margin:8px 0">${esc(q.reasoning)}</div>` : ''}
      <div style="margin-top:6px">
        ${bantRow('Budget',    bant.budget)}
        ${bantRow('Authority', bant.authority)}
        ${bantRow('Need',      bant.need)}
        ${bantRow('Timeline',  bant.timeline)}
      </div>
      ${actions.length ? `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #F1F5F9">
        <div style="font-size:0.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#0F172A;margin-bottom:6px">Suggested next moves</div>
        ${actions.map(a => `<div style="font-size:0.82rem;color:#0F172A;padding:4px 0">→ ${esc(a)}</div>`).join('')}
      </div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
        <button type="button" data-lead-action="intel" data-lead-email="${esc(lead.email)}" title="Enrich this lead's company via Apollo + BuiltWith" style="padding:7px 12px;background:#F1F5F9;color:#0369A1;border:1px solid #CBD5E1;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer">🔍 Intel</button>
        ${tier === 'hot' ? `<button type="button" data-lead-action="enroll-hot" data-lead-email="${esc(lead.email)}" style="padding:7px 12px;background:#0369A1;color:white;border:none;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer">→ Enrol in nurture</button>` : ''}
        <button type="button" data-lead-action="delete" data-lead-id="${safeId}" style="padding:7px 12px;background:#FEE2E2;color:#991B1B;border:none;border-radius:7px;font-size:0.78rem;font-weight:700;cursor:pointer">Delete</button>
      </div>
    </div>`;
}
async function submitLeadQualification() {
  const btn = document.getElementById('leadQualifyBtn');
  const result = document.getElementById('leadQualifyResult');
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const payload = {
    name:      document.getElementById('leadName').value.trim(),
    email:     document.getElementById('leadEmail').value.trim(),
    company:   document.getElementById('leadCompany').value.trim(),
    source:    document.getElementById('leadSource').value.trim(),
    notes:     document.getElementById('leadNotes').value.trim(),
    behaviour: document.getElementById('leadBehaviour').value.trim(),
  };
  if (!payload.email) { result.innerHTML = '<div style="color:#991B1B;font-size:0.82rem">⚠️ Email is required.</div>'; return; }
  btn.disabled = true; btn.textContent = '⏳ Qualifying…';
  result.innerHTML = '';
  try {
    const r = await fetch('/api/leads/qualify', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed');
    result.innerHTML = `<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:10px 12px;font-size:0.82rem;color:#065F46">✓ Lead qualified — see the panel on the right.</div>`;
    ['leadName','leadEmail','leadCompany','leadSource','leadNotes','leadBehaviour'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    setTimeout(() => buildLeadQualifier(), 600);
  } catch (e) {
    result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 12px;font-size:0.82rem;color:#991B1B">⚠️ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '🧲 Qualify Lead';
  }
}
async function deleteQualifiedLead(id) {
  if (!confirm('Delete this qualified lead?')) return;
  try {
    await fetch('/api/leads/qualified/' + encodeURIComponent(id), { method:'DELETE' });
    buildLeadQualifier();
  } catch (_) {}
}
function enrollHotLead(email) {
  if (!email) return;
  if (typeof openCommandBar === 'function') {
    openCommandBar();
    setTimeout(() => {
      const inp = document.getElementById('commandBarInput');
      if (inp) { inp.value = `Enrol ${email} into the default 3-touch drip`; inp.focus(); }
    }, 80);
  } else { alert('Command bar not available — open it with ⌘K and ask to enrol ' + email); }
}

/* =============================================================================
   ATTRIBUTION & ROI DASHBOARD — unifies Meta+Google+TikTok spend with
   Amplitude conversions, applies the chosen attribution model, and computes
   ROAS / CAC / ROI per channel + blended.
   ============================================================================= */
function buildAttribution() { loadAttribution(); }
async function loadAttribution() {
  const wrap = document.getElementById('attributionWrap');
  if (!wrap) return;
  const days  = parseInt(document.getElementById('attrDays')?.value  || '30', 10);
  const model = document.getElementById('attrModel')?.value || 'last-click';
  const aov   = parseFloat(document.getElementById('attrAOV')?.value || '0') || 0;
  wrap.innerHTML = '<div style="text-align:center;padding:64px;color:#64748B;font-weight:600">⏳ Pulling spend from Meta + Google + TikTok and conversions from Amplitude…</div>';
  try {
    const r = await fetch(`/api/attribution/overview?days=${days}&model=${encodeURIComponent(model)}&aov=${aov}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to load');
    wrap.innerHTML = _attributionHtml(j);
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message);
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load</b><div style="font-size:0.85rem;margin-top:6px">${safe}</div></div>`;
  }
}
function _attributionHtml(j) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s)=>String(s==null?'':s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtMoney = (n) => n == null ? '—' : '$' + Number(n).toLocaleString(undefined,{maximumFractionDigits:2});
  const fmtNum   = (n) => n == null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const fmtPct   = (n) => n == null ? '—' : Number(n).toFixed(1) + '%';
  const channelDefs = [
    { key:'meta',   name:'Meta Ads',   color:'#1877F2', bg:'#EFF6FF', icon:'📘' },
    { key:'google', name:'Google Ads', color:'#4285F4', bg:'#F0F7FF', icon:'🔵' },
    { key:'tiktok', name:'TikTok Ads', color:'#0F172A', bg:'#F1F5F9', icon:'⚫' },
  ];
  const t = j.totals || {};
  const okCount = channelDefs.filter(d => j.channels?.[d.key]?.ok).length;
  const modelLabel = { 'last-click':'Last-Click', linear:'Linear', 'time-decay':'Time-Decay', 'position-based':'Position-Based' }[j.attributionModel] || 'Last-Click';
  const insight = j.insight || {};
  // Hero
  const hero = `
    <div style="background:linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%);border-radius:18px;padding:30px;color:white;margin-bottom:22px;box-shadow:0 8px 28px rgba(67,56,202,.28)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:14px;margin-bottom:18px">
        <div>
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.6px;opacity:.85;font-weight:700">Attribution model · ${esc(modelLabel)} · last ${j.days} days · ${okCount}/3 channels live</div>
          <div style="font-size:0.78rem;opacity:.78;margin-top:4px">Conversions sourced from <b>${j.conversionSource === 'amplitude' ? 'Amplitude (ground truth)' : 'ad-platform reported'}</b>${j.aov > 0 ? ` · AOV $${j.aov}` : ''}</div>
        </div>
        ${insight.winner ? `<div style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 14px;font-size:0.82rem"><b style="text-transform:capitalize">🏆 ${esc(insight.winner.channel)}</b> is your top ROAS at <b>${insight.winner.roas != null ? insight.winner.roas + 'x' : '—'}</b></div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px">
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Total Spend</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px">${fmtMoney(t.spend)}</div></div>
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Conversions</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px">${fmtNum(t.conversions)}</div></div>
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Revenue</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px">${fmtMoney(t.revenue)}</div></div>
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Blended ROAS</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px;color:${(t.blendedROAS||0)>=1?'#A7F3D0':'#FECACA'}">${t.blendedROAS != null ? t.blendedROAS + 'x' : '—'}</div></div>
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">Blended CAC</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px">${fmtMoney(t.blendedCAC)}</div></div>
        <div><div style="font-size:0.7rem;opacity:.75;text-transform:uppercase;letter-spacing:.5px;font-weight:700">ROI</div><div style="font-size:1.85rem;font-weight:900;margin-top:4px;color:${(t.blendedROI||0)>=0?'#A7F3D0':'#FECACA'}">${t.blendedROI != null ? t.blendedROI + '%' : '—'}</div></div>
      </div>
    </div>`;
  // Channel cards
  const channelCards = channelDefs.map(d => {
    const c = j.channels?.[d.key] || {};
    if (!c.ok) {
      const noticeText = c.error === 'not-configured'
        ? `${esc(d.name)} is not connected — add credentials to see ROI data for this channel.`
        : esc(c.error || `${d.name} is not connected.`);
      return `
        <div style="background:white;border:1.5px dashed #E5E7EB;border-radius:14px;padding:22px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div style="width:36px;height:36px;border-radius:9px;background:${d.bg};display:flex;align-items:center;justify-content:center;font-size:1.2rem">${d.icon}</div>
            <div style="font-weight:800;color:#0A1628;font-size:1rem">${esc(d.name)}</div>
            <span style="margin-left:auto;font-size:0.66rem;font-weight:700;padding:3px 9px;border-radius:999px;background:#F1F5F9;color:#64748B;border:1px solid #E5E7EB">NOT CONNECTED</span>
          </div>
          <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;font-size:0.78rem;color:#92400E;line-height:1.5">
            ⚠️ <strong>${noticeText}</strong><br>
            <a href="#" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a>
          </div>
        </div>`;
    }
    const spendShare = (t.spend > 0) ? ((c.spend || 0) / t.spend * 100) : 0;
    const roasColor = c.roas == null ? '#94A3B8' : (c.roas >= 2 ? '#10B981' : c.roas >= 1 ? '#F59E0B' : '#EF4444');
    return `
      <div style="background:white;border:1.5px solid ${d.color}33;border-radius:14px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.04)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="width:36px;height:36px;border-radius:9px;background:${d.bg};display:flex;align-items:center;justify-content:center;font-size:1.2rem">${d.icon}</div>
          <div style="flex:1">
            <div style="font-weight:800;color:#0A1628;font-size:1rem">${esc(d.name)}</div>
            <div style="font-size:0.7rem;color:#64748B">${spendShare.toFixed(1)}% of spend${c.weight != null ? ` · ${c.weight}% of conversions` : ''}${c.modelAdjusted ? ' · model-adjusted' : ''}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:0.65rem;color:#64748B;text-transform:uppercase;letter-spacing:.5px;font-weight:700">ROAS</div>
            <div style="font-size:1.4rem;font-weight:900;color:${roasColor}">${c.roas != null ? c.roas + 'x' : '—'}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px 14px;font-size:0.8rem">
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">Spend</div><div style="font-weight:700;color:#0A1628">${fmtMoney(c.spend)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">Revenue</div><div style="font-weight:700;color:#0A1628">${fmtMoney(c.revenue)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">Impressions</div><div style="font-weight:700;color:#0A1628">${fmtNum(c.impressions)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">Clicks</div><div style="font-weight:700;color:#0A1628">${fmtNum(c.clicks)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">Conversions</div><div style="font-weight:700;color:#0A1628">${fmtNum(c.conversions)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">CPA</div><div style="font-weight:700;color:#0A1628">${fmtMoney(c.cpa)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">CTR</div><div style="font-weight:700;color:#0A1628">${fmtPct(c.ctr)}</div></div>
          <div><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">CPC</div><div style="font-weight:700;color:#0A1628">${fmtMoney(c.cpc)}</div></div>
          <div style="grid-column:1/-1;padding-top:8px;margin-top:4px;border-top:1px dashed #E5E7EB"><div style="color:#64748B;font-size:0.68rem;text-transform:uppercase;font-weight:700">ROI</div><div style="font-weight:800;color:${(c.roi||0)>=0?'#10B981':'#EF4444'};font-size:1rem">${c.roi != null ? c.roi + '%' : '—'}</div></div>
        </div>
      </div>`;
  }).join('');
  // Spend allocation bar
  let allocBar = '';
  if (t.spend > 0) {
    const segs = channelDefs.filter(d => j.channels?.[d.key]?.ok).map(d => {
      const c = j.channels[d.key];
      const pct = (c.spend || 0) / t.spend * 100;
      return `<div style="background:${d.color};height:100%;width:${pct}%" title="${esc(d.name)} · ${pct.toFixed(1)}%"></div>`;
    }).join('');
    const legend = channelDefs.filter(d => j.channels?.[d.key]?.ok).map(d => {
      const c = j.channels[d.key];
      const pct = (c.spend || 0) / t.spend * 100;
      return `<div style="display:flex;align-items:center;gap:6px;font-size:0.78rem"><div style="width:10px;height:10px;border-radius:2px;background:${d.color}"></div><b style="color:#0A1628">${esc(d.name)}</b><span style="color:#64748B">${pct.toFixed(1)}%</span></div>`;
    }).join('');
    allocBar = `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;margin-top:18px">
        <div style="font-weight:800;color:#0A1628;font-size:0.95rem;margin-bottom:10px">📊 Spend allocation</div>
        <div style="display:flex;height:14px;border-radius:8px;overflow:hidden;background:#F1F5F9">${segs}</div>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px">${legend}</div>
      </div>`;
  }
  // Recommendation
  let rec = '';
  if (insight.winner && insight.loser && insight.winner.channel !== insight.loser.channel) {
    rec = `
      <div style="background:linear-gradient(135deg,#ECFDF5 0%,#D1FAE5 100%);border:1px solid #6EE7B7;border-radius:14px;padding:18px;margin-top:18px">
        <div style="font-weight:800;color:#065F46;font-size:0.95rem;margin-bottom:6px">💡 Reallocation recommendation</div>
        <div style="font-size:0.86rem;color:#047857;line-height:1.5">Based on the <b>${esc(modelLabel)}</b> attribution model over ${j.days} days, <b style="text-transform:capitalize">${esc(insight.winner.channel)}</b> is returning <b>${insight.winner.roas}x ROAS</b> (${insight.winner.roi}% ROI), while <b style="text-transform:capitalize">${esc(insight.loser.channel)}</b> is at <b>${insight.loser.roas}x</b> (${insight.loser.roi}% ROI). Consider shifting 10–20% of <b style="text-transform:capitalize">${esc(insight.loser.channel)}</b> spend into <b style="text-transform:capitalize">${esc(insight.winner.channel)}</b> and re-measuring next week.</div>
      </div>`;
  }
  // Configuration warnings
  let warnings = '';
  const missing = channelDefs.filter(d => !j.channels?.[d.key]?.ok);
  if (missing.length || j.aov === 0 && t.revenue === 0) {
    const items = [];
    if (missing.length) items.push(`<li>${missing.map(m => esc(m.name)).join(', ')} not connected — settings → integrations to wire them up.</li>`);
    if (j.aov === 0 && t.revenue === 0) items.push(`<li>No revenue detected from Meta action_values. Enter your <b>average order value</b> in the toolbar to estimate ROAS from conversions.</li>`);
    if (j.conversionSource !== 'amplitude') items.push(`<li>Using ad-platform-reported conversions. Configure <b>Amplitude</b> conversion events for ground-truth measurement.</li>`);
    warnings = `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:16px;margin-top:18px"><div style="font-weight:800;color:#92400E;font-size:0.9rem;margin-bottom:8px">⚙️ Setup checks</div><ul style="margin:0;padding-left:18px;color:#78350F;font-size:0.82rem;line-height:1.7">${items.join('')}</ul></div>`;
  }
  const totalChannels = channelDefs.length;
  let connectionBanner = '';
  if (okCount === 0) {
    connectionBanner = `
      <a href="#" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));return false;" style="display:flex;align-items:center;gap:12px;background:#FEF2F2;border:1.5px solid #FECACA;border-radius:12px;padding:13px 18px;margin-bottom:18px;color:#991B1B;text-decoration:none;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='#FEF2F2'">
        <span style="font-size:1.15rem;flex-shrink:0">⚠️</span>
        <div style="flex:1">
          <span style="font-weight:800;font-size:0.9rem">0 of ${totalChannels} ad platforms connected</span>
          <span style="font-size:0.8rem;opacity:.85;margin-left:8px">No live data — connect platforms to see attribution &amp; ROI.</span>
        </div>
        <span style="font-size:0.78rem;font-weight:700;white-space:nowrap;text-decoration:underline">Settings → Integrations →</span>
      </a>`;
  } else if (okCount < totalChannels) {
    const missingNames = channelDefs.filter(d => !j.channels?.[d.key]?.ok).map(d => d.name).join(', ');
    connectionBanner = `
      <a href="#" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));return false;" style="display:flex;align-items:center;gap:12px;background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:13px 18px;margin-bottom:18px;color:#92400E;text-decoration:none;cursor:pointer;transition:background .15s" onmouseover="this.style.background='#FEF3C7'" onmouseout="this.style.background='#FFFBEB'">
        <span style="font-size:1.15rem;flex-shrink:0">🟡</span>
        <div style="flex:1">
          <span style="font-weight:800;font-size:0.9rem">${okCount} of ${totalChannels} ad platforms connected</span>
          <span style="font-size:0.8rem;opacity:.85;margin-left:8px">Missing: ${missingNames}</span>
        </div>
        <span style="font-size:0.78rem;font-weight:700;white-space:nowrap;text-decoration:underline">Settings → Integrations →</span>
      </a>`;
  }
  return `
    ${hero}
    ${connectionBanner}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">${channelCards}</div>
    ${allocBar}
    ${rec}
    ${warnings}
    <div style="text-align:center;font-size:0.7rem;color:#94A3B8;margin-top:14px">Generated ${new Date(j.generatedAt).toLocaleString()}</div>`;
}

/* =============================================================================
   LOOKALIKE AUDIENCE BUILDER — generate Meta LLA / Google CM / TikTok LLA
   audience specs from competitor signals or seed descriptions, with CSV export.
   ============================================================================= */
window._lookalikeLastSpec = null;
function buildLookalike() {
  const wrap = document.getElementById('lookalikeWrap');
  if (!wrap) return;
  if (wrap.dataset.built === '1') return;
  wrap.dataset.built = '1';
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr;gap:18px">
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,.04)">
        <div style="font-weight:800;color:#0A1628;font-size:1.05rem;margin-bottom:4px">1 · Define your seed</div>
        <div style="font-size:0.82rem;color:#64748B;margin-bottom:18px">Pick the source InfoGenie should use to model the lookalike audience.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:18px" id="laSeedTypeGrid">
          ${[
            {v:'competitor', t:'🏆 Competitor domain', d:'Pull SERP signals from a competitor URL'},
            {v:'description', t:'✍️ Audience description', d:'Free-text persona / customer description'},
            {v:'customer-profile', t:'🧬 Customer profile', d:'Paste an existing customer/buyer profile'},
          ].map((o, i) => `
            <button type="button" data-la-seed="${o.v}" onclick="_laSelectSeed('${o.v}')" style="text-align:left;padding:14px;background:${i===0?'#EEF2FF':'#F8FAFC'};border:1.5px solid ${i===0?'#6366F1':'#E5E7EB'};border-radius:12px;cursor:pointer;transition:all .15s">
              <div style="font-weight:700;color:#0A1628;font-size:0.88rem">${o.t}</div>
              <div style="font-size:0.72rem;color:#64748B;margin-top:3px">${o.d}</div>
            </button>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
          <label style="display:block">
            <div style="font-size:0.74rem;font-weight:700;color:#0A1628;margin-bottom:5px">Country</div>
            <select id="laCountry" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.86rem">
              <option value="US" selected>United States</option><option value="GB">United Kingdom</option><option value="CA">Canada</option><option value="AU">Australia</option><option value="DE">Germany</option><option value="FR">France</option><option value="ES">Spain</option><option value="IT">Italy</option><option value="NL">Netherlands</option><option value="BR">Brazil</option><option value="MX">Mexico</option><option value="JP">Japan</option><option value="IN">India</option>
            </select>
          </label>
          <label style="display:block">
            <div style="font-size:0.74rem;font-weight:700;color:#0A1628;margin-bottom:5px">Meta lookalike size</div>
            <select id="laSize" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.86rem">
              <option value="1%" selected>1% (most similar, smallest)</option><option value="2%">2%</option><option value="3%">3%</option><option value="5%">5%</option><option value="10%">10% (broadest)</option>
            </select>
          </label>
        </div>
        <label style="display:block;margin-bottom:14px">
          <div style="font-size:0.74rem;font-weight:700;color:#0A1628;margin-bottom:5px"><span id="laSeedLabel">Competitor domain</span></div>
          <input id="laSeedValue" type="text" placeholder="e.g. competitor.com" style="width:100%;padding:11px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.9rem">
        </label>
        <label style="display:block;margin-bottom:18px">
          <div style="font-size:0.74rem;font-weight:700;color:#0A1628;margin-bottom:5px">Additional context (optional)</div>
          <textarea id="laContext" placeholder="e.g. We sell premium B2B SaaS, ACV $12k, primarily targeting Heads of Marketing at Series B+ companies." style="width:100%;min-height:64px;padding:11px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.86rem;font-family:inherit;resize:vertical"></textarea>
        </label>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-bottom:18px">
          <div style="font-size:0.78rem;font-weight:700;color:#0A1628">Target platforms:</div>
          ${[
            {v:'meta', l:'📘 Meta LLA', c:'#1877F2'},
            {v:'google', l:'🔵 Google CM', c:'#4285F4'},
            {v:'tiktok', l:'⬛ TikTok LLA', c:'#0F172A'},
          ].map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:0.84rem;color:#0A1628;cursor:pointer"><input type="checkbox" class="la-platform" value="${p.v}" checked> <span>${p.l}</span></label>`).join('')}
          <label style="display:flex;align-items:center;gap:6px;font-size:0.84rem;color:#0A1628;cursor:pointer;margin-left:auto"><input type="checkbox" id="laExclude" checked> <span>Exclude existing customers</span></label>
        </div>
        <button onclick="generateLookalike()" id="laGenBtn" style="width:100%;padding:14px;background:linear-gradient(135deg,#1E40AF 0%,#0EA5E9 100%);color:white;border:none;border-radius:12px;font-weight:800;font-size:0.95rem;cursor:pointer;box-shadow:0 4px 14px rgba(14,165,233,.3)">⚡ Generate Lookalike Audiences</button>
      </div>
      <div id="laResult"></div>
    </div>`;
}
window._laSelectSeed = function(v) {
  document.querySelectorAll('#laSeedTypeGrid button[data-la-seed]').forEach(b => {
    const sel = b.getAttribute('data-la-seed') === v;
    b.style.background = sel ? '#EEF2FF' : '#F8FAFC';
    b.style.borderColor = sel ? '#6366F1' : '#E5E7EB';
  });
  const lbl = document.getElementById('laSeedLabel');
  const inp = document.getElementById('laSeedValue');
  if (v === 'competitor') { lbl.textContent = 'Competitor domain'; inp.placeholder = 'e.g. competitor.com'; }
  else if (v === 'description') { lbl.textContent = 'Audience description'; inp.placeholder = 'e.g. Marketing leaders at SaaS companies who buy attribution tools'; }
  else { lbl.textContent = 'Customer profile'; inp.placeholder = 'e.g. CMOs / VPs of Marketing at $10M-100M ARR B2B SaaS, urban US/CA/UK'; }
  inp.dataset.seedType = v;
};
async function generateLookalike() {
  const seedType = document.querySelector('#laSeedTypeGrid button[data-la-seed][style*="EEF2FF"]')?.getAttribute('data-la-seed') || 'competitor';
  const seedValue = document.getElementById('laSeedValue').value.trim();
  if (!seedValue) { alert('Please enter a seed value first.'); return; }
  const country = document.getElementById('laCountry').value;
  const lookalikeSize = document.getElementById('laSize').value;
  const additionalContext = document.getElementById('laContext').value.trim();
  const excludeExistingCustomers = document.getElementById('laExclude').checked;
  const platforms = Array.from(document.querySelectorAll('input.la-platform:checked')).map(c => c.value);
  if (!platforms.length) { alert('Select at least one target platform.'); return; }
  const btn = document.getElementById('laGenBtn');
  const resBox = document.getElementById('laResult');
  btn.disabled = true; btn.style.opacity = '0.6'; btn.textContent = '⏳ Generating audiences (this can take 20-40s)…';
  resBox.innerHTML = '<div style="background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:14px;padding:32px;text-align:center;color:#64748B;font-weight:600">⏳ Pulling competitor signals and composing audience specs…</div>';
  try {
    const r = await fetch('/api/lookalike/generate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ seedType, seedValue, platforms, country, lookalikeSize, excludeExistingCustomers, additionalContext }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to generate');
    window._lookalikeLastSpec = j.spec;
    resBox.innerHTML = _lookalikeResultHtml(j);
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message);
    resBox.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Generation failed</b><div style="font-size:0.85rem;margin-top:6px">${safe}</div></div>`;
  } finally {
    btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '⚡ Generate Lookalike Audiences';
  }
}
function _lookalikeResultHtml(j) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s)=>String(s==null?'':s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const s = j.spec || {};
  const fmtRange = (rng) => rng ? `${(rng.low/1e6).toFixed(1)}M – ${(rng.high/1e6).toFixed(1)}M` : '—';
  const tag = (txt, color) => `<span style="display:inline-block;background:${color}15;color:${color};padding:4px 10px;border-radius:99px;font-size:0.74rem;font-weight:600;margin:3px 4px 3px 0">${esc(txt)}</span>`;
  const list = (arr, color) => (arr||[]).slice(0, 24).map(t => tag(t, color)).join('');
  const platforms = s.platforms || {};
  const platformBlocks = [];
  if (platforms.meta) {
    const mp = platforms.meta;
    platformBlocks.push(`
      <div style="background:white;border:1.5px solid #1877F233;border-radius:14px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:800;color:#0A1628;font-size:1rem">📘 Meta Lookalike Audience</div>
          <button onclick="exportLookalikeCSV('meta')" style="padding:7px 12px;background:#1877F2;color:white;border:none;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer">⬇ Download CSV template</button>
        </div>
        <div style="font-size:0.85rem;color:#0A1628;margin-bottom:8px"><b>${esc(mp.audienceName || 'Meta LLA')}</b> · Size: <b>${esc(mp.lookalikeSize || '1%')}</b> · Est reach: <b>${mp.estReachM ? mp.estReachM + 'M' : '—'}</b></div>
        <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px">Source: ${esc(mp.sourceAudienceSuggestion || 'Pixel: Purchasers (180d)')}</div>
        ${mp.detailedTargeting?.interests ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Detailed targeting · interests</div>${list(mp.detailedTargeting.interests, '#1877F2')}</div>` : ''}
        ${mp.detailedTargeting?.behaviors ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Behaviors</div>${list(mp.detailedTargeting.behaviors, '#1877F2')}</div>` : ''}
        ${mp.exclusions?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Exclusions</div>${list(mp.exclusions, '#EF4444')}</div>` : ''}
        ${mp.uploadInstructions ? `<div style="margin-top:12px;padding:10px 12px;background:#EFF6FF;border-left:3px solid #1877F2;border-radius:6px;font-size:0.78rem;color:#1E3A8A;white-space:pre-wrap;line-height:1.5">${esc(mp.uploadInstructions)}</div>` : ''}
      </div>`);
  }
  if (platforms.google) {
    const gp = platforms.google;
    platformBlocks.push(`
      <div style="background:white;border:1.5px solid #4285F433;border-radius:14px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:800;color:#0A1628;font-size:1rem">🔵 Google Customer Match</div>
          <button onclick="exportLookalikeCSV('google')" style="padding:7px 12px;background:#4285F4;color:white;border:none;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer">⬇ Download CSV template</button>
        </div>
        <div style="font-size:0.85rem;color:#0A1628;margin-bottom:8px"><b>${esc(gp.audienceName || 'Customer Match list')}</b> · Type: <b>${esc(gp.matchType || 'Customer Match')}</b></div>
        <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px">Upload format: ${esc(gp.uploadFormat || 'CSV with SHA-256 hashed identifiers')}</div>
        ${gp.similarAudienceTopics?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Similar-audience topics</div>${list(gp.similarAudienceTopics, '#4285F4')}</div>` : ''}
        ${gp.inMarketSegments?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">In-market segments</div>${list(gp.inMarketSegments, '#0F9D58')}</div>` : ''}
        ${gp.uploadInstructions ? `<div style="margin-top:12px;padding:10px 12px;background:#F0F7FF;border-left:3px solid #4285F4;border-radius:6px;font-size:0.78rem;color:#1E3A8A;white-space:pre-wrap;line-height:1.5">${esc(gp.uploadInstructions)}</div>` : ''}
      </div>`);
  }
  if (platforms.tiktok) {
    const tp = platforms.tiktok;
    platformBlocks.push(`
      <div style="background:white;border:1.5px solid #0F172A33;border-radius:14px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:800;color:#0A1628;font-size:1rem">⬛ TikTok Lookalike Audience</div>
          <button onclick="exportLookalikeCSV('tiktok')" style="padding:7px 12px;background:#0F172A;color:white;border:none;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer">⬇ Download CSV template</button>
        </div>
        <div style="font-size:0.85rem;color:#0A1628;margin-bottom:8px"><b>${esc(tp.audienceName || 'TikTok LLA')}</b> · Mode: <b>${esc(tp.lookalikeMode || 'Balanced')}</b></div>
        <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px">Seed: ${esc(tp.seedAudienceSuggestion || 'Past-180-day purchasers')}</div>
        ${tp.interestCategories?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Interest categories</div>${list(tp.interestCategories, '#0F172A')}</div>` : ''}
        ${tp.behaviors?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Behaviors</div>${list(tp.behaviors, '#FF2D55')}</div>` : ''}
        ${tp.creators?.length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Creator categories</div>${list(tp.creators, '#10B981')}</div>` : ''}
        ${tp.uploadInstructions ? `<div style="margin-top:12px;padding:10px 12px;background:#F1F5F9;border-left:3px solid #0F172A;border-radius:6px;font-size:0.78rem;color:#0F172A;white-space:pre-wrap;line-height:1.5">${esc(tp.uploadInstructions)}</div>` : ''}
      </div>`);
  }
  const seeds = (s.seedExamples || []).map(p => `
    <div style="border:1px solid #E5E7EB;border-radius:10px;padding:12px;background:white">
      <div style="font-weight:800;color:#0A1628;font-size:0.86rem;margin-bottom:4px">${esc(p.persona || '—')}</div>
      <div style="font-size:0.74rem;color:#64748B;margin-bottom:6px">${esc(p.demographics || '')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${(p.channels || []).map(c => tag(c, '#6366F1')).join('')}</div>
      <div style="font-size:0.74rem;color:#0A1628"><b>Trigger:</b> ${esc(p.buyingTrigger || '')}</div>
    </div>`).join('');
  return `
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1E40AF 100%);border-radius:16px;padding:24px;color:white;margin-bottom:18px">
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.6px;opacity:.78;font-weight:700;margin-bottom:6px">Lookalike audience persona</div>
      <div style="font-size:1.1rem;line-height:1.5;font-weight:600">${esc(s.summary || '')}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-top:18px">
        <div><div style="font-size:0.65rem;opacity:.72;font-weight:700;text-transform:uppercase">Age</div><div style="font-weight:800;margin-top:3px">${esc(s.demographics?.ageRange || '—')}</div></div>
        <div><div style="font-size:0.65rem;opacity:.72;font-weight:700;text-transform:uppercase">Income</div><div style="font-weight:800;margin-top:3px">${esc(s.demographics?.incomeBand || '—')}</div></div>
        <div><div style="font-size:0.65rem;opacity:.72;font-weight:700;text-transform:uppercase">Geo</div><div style="font-weight:800;margin-top:3px">${esc(s.geo?.primaryCountry || '—')}</div></div>
        <div><div style="font-size:0.65rem;opacity:.72;font-weight:700;text-transform:uppercase">Est. size</div><div style="font-weight:800;margin-top:3px">${fmtRange(s.estimatedSize)}</div></div>
      </div>
    </div>
    ${platformBlocks.length ? `<div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:18px">${platformBlocks.join('')}</div>` : ''}
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;margin-bottom:18px">
      <div style="font-weight:800;color:#0A1628;font-size:0.95rem;margin-bottom:10px">🎯 Targeting signals</div>
      ${s.interests?.length ? `<div style="margin-bottom:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Interests</div>${list(s.interests, '#6366F1')}</div>` : ''}
      ${s.behaviors?.length ? `<div style="margin-bottom:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Behaviors</div>${list(s.behaviors, '#0EA5E9')}</div>` : ''}
      ${s.jobTitles?.length ? `<div style="margin-bottom:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Job titles</div>${list(s.jobTitles, '#10B981')}</div>` : ''}
      ${s.industries?.length ? `<div style="margin-bottom:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Industries</div>${list(s.industries, '#F59E0B')}</div>` : ''}
      ${s.intentKeywords?.length ? `<div style="margin-bottom:10px"><div style="font-size:0.7rem;color:#64748B;font-weight:700;text-transform:uppercase;margin-bottom:4px">Intent keywords</div>${list(s.intentKeywords, '#EF4444')}</div>` : ''}
    </div>
    ${seeds ? `<div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;margin-bottom:18px"><div style="font-weight:800;color:#0A1628;font-size:0.95rem;margin-bottom:10px">🧬 Seed personas</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${seeds}</div></div>` : ''}
    ${s.warnings?.length ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:14px"><div style="font-weight:800;color:#92400E;font-size:0.86rem;margin-bottom:6px">⚠️ Compliance &amp; quality notes</div><ul style="margin:0;padding-left:18px;color:#78350F;font-size:0.8rem;line-height:1.6">${s.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}`;
}
async function exportLookalikeCSV(platform) {
  if (!window._lookalikeLastSpec) { alert('Generate an audience first.'); return; }
  try {
    const r = await fetch('/api/lookalike/export', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ spec: window._lookalikeLastSpec, platform }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Export failed');
    const blob = new Blob([j.csv], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = j.filename || `lookalike-${platform}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Could not export: ' + e.message);
  }
}

(function wireNewViews(){
  const orig = window.buildAmplitudeAgents;  // sentinel — confirms script loaded
  document.addEventListener('click', (e) => {
    // 1) Sidebar nav links → re-render the matching view
    const a = e.target.closest && e.target.closest('a.nav-link[data-view]');
    if (a) {
      const v = a.getAttribute('data-view');
      // Force-close the parent nav-dropdown after the click so it doesn't stay
      // pinned open by :focus-within / mouse-still-over-panel and overlay the page.
      const wrap = a.closest('.nav-group-wrap');
      if (wrap) {
        try { if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur(); } catch(_) {}
        wrap.classList.add('nav-dropdown-suppress');
        setTimeout(() => wrap.classList.remove('nav-dropdown-suppress'), 600);
      }
      setTimeout(() => {
        if (v === 'goals')          { try { buildGoals(); }          catch(_){} }
        if (v === 'blended-perf')   { try { buildBlendedPerf(); }    catch(_){} }
        if (v === 'lead-qualifier') { try { buildLeadQualifier(); }  catch(_){} }
        if (v === 'reengage')       { try { buildReengage(); }       catch(_){} }
        if (v === 'attribution')    { try { buildAttribution(); }    catch(_){} }
        if (v === 'lookalike')      { try { buildLookalike(); }      catch(_){} }
        if (v === 'contentscorer')  { try { buildContentScorer(); }  catch(_){} }
      }, 60);
      return;
    }
    // 2) Lead-card delegated buttons (read from data-* — never via inline JS)
    const leadBtn = e.target.closest && e.target.closest('button[data-lead-action]');
    if (leadBtn) {
      const action = leadBtn.getAttribute('data-lead-action');
      if (action === 'enroll-hot') {
        const email = leadBtn.getAttribute('data-lead-email') || '';
        if (email) enrollHotLead(email);
      } else if (action === 'delete') {
        const id = leadBtn.getAttribute('data-lead-id') || '';
        if (id) deleteQualifiedLead(id);
      } else if (action === 'intel') {
        const email = leadBtn.getAttribute('data-lead-email') || '';
        if (email && typeof showCompanyIntel === 'function') showCompanyIntel(email);
      }
    }
  });
})();

/* =============================================================================
   ATTRIBUTION TABS — Channels (existing) / Cohorts / Forecast
   ============================================================================= */
window._attrCurrentTab = 'channels';
function switchAttributionTab(tab) {
  window._attrCurrentTab = tab;
  document.querySelectorAll('.attr-tab').forEach(b => {
    b.classList.toggle('attr-tab-active', b.getAttribute('data-attr-tab') === tab);
  });
  // Hide model dropdown when not on Channels tab (it doesn't apply elsewhere)
  const modelSel = document.getElementById('attrModel');
  if (modelSel) modelSel.style.display = (tab === 'channels') ? '' : 'none';
  if (tab === 'channels')      loadAttribution();
  else if (tab === 'cohorts')  loadAttributionCohorts();
  else if (tab === 'forecast') loadAttributionForecast();
}
// Patch existing dropdown change handlers to refresh whichever tab is active
(function patchAttrControls(){
  const ids = ['attrDays','attrModel','attrAOV'];
  ids.forEach(id => {
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === id) {
        const t = window._attrCurrentTab || 'channels';
        if (t === 'channels')      loadAttribution();
        else if (t === 'cohorts')  loadAttributionCohorts();
        else if (t === 'forecast') loadAttributionForecast();
      }
    });
  });
})();

async function loadAttributionCohorts() {
  const wrap = document.getElementById('attributionWrap');
  if (!wrap) return;
  const days = Math.max(28, parseInt(document.getElementById('attrDays')?.value || '30', 10) * 3); // expand range — cohorts need a few weeks
  const aov  = parseFloat(document.getElementById('attrAOV')?.value || '0') || 0;
  wrap.innerHTML = '<div style="text-align:center;padding:64px;color:#64748B;font-weight:600">⏳ Pulling daily breakdown from Meta + Google + TikTok and bucketing into weekly cohorts…</div>';
  try {
    const r = await fetch(`/api/attribution/cohorts?days=${Math.min(120, days)}&aov=${aov}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to load');
    wrap.innerHTML = _cohortHtml(j);
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message);
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load cohorts</b><div style="font-size:.85rem;margin-top:6px">${safe}</div></div>`;
  }
}
function _cohortHtml(j) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s)=>String(s==null?'':s);
  const fmt$ = (n) => n == null ? '—' : '$' + Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  if (!j.weeks?.length) {
    const offline = Object.entries(j.channelStatus || {}).filter(([,v]) => !v).map(([k]) => k);
    return `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:32px;text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">🗓️</div>
      <div style="font-weight:800;color:#92400E;font-size:1.05rem;margin-bottom:6px">No cohort data yet</div>
      <div style="font-size:.85rem;color:#78350F">No spend or conversions detected in the last ${j.days} days${offline.length ? ` — ${offline.join(', ')} not connected.` : '.'} Once your ad accounts have daily traffic, weekly cohorts will appear here.</div>
    </div>`;
  }
  const maxSpend = Math.max(...j.weeks.map(w => w.spend));
  const channelDefs = [
    { key:'meta',   color:'#1877F2', name:'Meta' },
    { key:'google', color:'#4285F4', name:'Google' },
    { key:'tiktok', color:'#0F172A', name:'TikTok' },
  ];
  const trendBadge = (val, suffix='', invert=false) => {
    if (val == null) return '';
    const up = invert ? val < 0 : val > 0;
    const cls = val === 0 ? 'cohort-trend-flat' : (up ? 'cohort-trend-up' : 'cohort-trend-down');
    const sym = val === 0 ? '→' : (val > 0 ? '▲' : '▼');
    return `<span class="${cls}">${sym} ${Math.abs(val).toFixed(1)}${suffix}</span>`;
  };
  const headerTrend = j.trend ? `
    <div style="display:flex;flex-wrap:wrap;gap:18px;font-size:.82rem;color:#475569">
      <div title="Week-over-week change in total ad spend">Spend WoW: ${trendBadge(j.trend.spendDelta, '%')}</div>
      <div title="Week-over-week change in conversions (${esc(j.conversionSource)})">Conversions WoW: ${trendBadge(j.trend.conversionsDelta, '%')}</div>
      ${j.trend.roasDelta != null ? `<div title="Week-over-week change in ROAS multiple">ROAS WoW: ${trendBadge(j.trend.roasDelta, 'x')}</div>` : ''}
      ${j.trend.cacDelta  != null ? `<div title="Week-over-week change in CAC (lower is better)">CAC WoW: ${trendBadge(j.trend.cacDelta,  '$', true)}</div>` : ''}
    </div>` : '';
  const rows = j.weeks.slice().reverse().map(w => {
    const barPct = maxSpend > 0 ? (w.spend / maxSpend) * 100 : 0;
    const chMix = channelDefs.map(d => {
      const c = w.channels[d.key];
      const pct = w.spend > 0 ? (c.spend / w.spend) * 100 : 0;
      if (pct < 1) return '';
      return `<span title="${d.name} · ${fmt$(c.spend)} · ${pct.toFixed(0)}%" style="display:inline-block;width:${pct}%;height:6px;background:${d.color}"></span>`;
    }).join('');
    return `<tr>
      <td><b style="color:#0A1628">${esc(w.weekStart)}</b><div style="font-size:.66rem;color:#94A3B8;font-weight:600">${esc(w.week)}</div></td>
      <td>${fmt$(w.spend)}<div style="margin-top:4px;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;display:flex">${chMix || `<span class="cohort-bar" style="width:${barPct}%"></span>`}</div></td>
      <td>${fmtN(w.conversions)}</td>
      <td>${fmt$(w.revenue)}</td>
      <td>${w.roas != null ? `<b>${w.roas}x</b>` : '—'}</td>
      <td>${w.cac  != null ? fmt$(w.cac) : '—'}</td>
    </tr>`;
  }).join('');
  const cohortDisconnected = [
    { key:'meta',   name:'Meta Ads',   icon:'📘' },
    { key:'google', name:'Google Ads', icon:'🔵' },
    { key:'tiktok', name:'TikTok Ads', icon:'⚫' },
  ].filter(d => j.channelStatus && j.channelStatus[d.key] === false);
  const cohortNotices = cohortDisconnected.length ? cohortDisconnected.map(d =>
    `<div style="display:flex;align-items:flex-start;gap:10px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;font-size:0.78rem;color:#92400E;line-height:1.5">
      <span style="font-size:1rem">${d.icon}</span>
      <div>⚠️ <strong>${esc(d.name)} is not connected</strong> — cohort data for this channel will be missing.<br>
      <a href="#" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>
    </div>`
  ).join('') : '';
  return `
    <div style="background:linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%);border-radius:18px;padding:24px;color:white;margin-bottom:18px">
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;opacity:.85;font-weight:700">Weekly Cohorts · last ${j.days} days · ${j.weeks.length} cohorts · conversions from <b>${esc(j.conversionSource === 'amplitude' ? 'Amplitude (ground truth)' : 'ad-platform reported')}</b></div>
      <div style="font-size:1.4rem;font-weight:900;margin-top:6px">Acquisition cohort decay</div>
      <div style="font-size:.85rem;opacity:.85;margin-top:4px">Each row = a Monday-starting week. Spend bar shows the channel split. Compare weeks side-by-side to spot rising or falling efficiency.</div>
    </div>
    ${cohortNotices ? `<div style="display:grid;gap:8px;margin-bottom:14px">${cohortNotices}</div>` : ''}
    ${headerTrend ? `<div style="background:white;border:1.5px solid #E5E7EB;border-radius:14px;padding:14px 18px;margin-bottom:14px">${headerTrend}</div>` : ''}
    <div style="background:white;border:1.5px solid #E5E7EB;border-radius:14px;padding:6px 8px;overflow-x:auto">
      <table class="cohort-table">
        <thead><tr>
          <th title="ISO week starting Monday — the cohort acquisition period.">Week</th>
          <th title="Total ad spend across all live channels for that week. Coloured bar shows channel split.">Spend</th>
          <th title="Conversions for that week — sourced from ${esc(j.conversionSource)}.">Conversions</th>
          <th title="Revenue from that week's conversions (uses Meta action_values where available, otherwise conversions × AOV).">Revenue</th>
          <th title="Return on Ad Spend = Revenue ÷ Spend. Higher is better.">ROAS</th>
          <th title="Customer Acquisition Cost = Spend ÷ Conversions. Lower is better.">CAC</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:14px;margin-top:10px;font-size:.74rem;color:#64748B">
      ${channelDefs.map(d => `<span><span style="display:inline-block;width:10px;height:10px;background:${d.color};border-radius:2px;vertical-align:middle"></span> ${d.name}</span>`).join('')}
    </div>
    <div style="text-align:center;font-size:.68rem;color:#94A3B8;margin-top:14px">Generated ${new Date(j.generatedAt).toLocaleString()}</div>`;
}

async function loadAttributionForecast() {
  const wrap = document.getElementById('attributionWrap');
  if (!wrap) return;
  const days = parseInt(document.getElementById('attrDays')?.value || '30', 10);
  const aov  = parseFloat(document.getElementById('attrAOV')?.value || '0') || 0;
  wrap.innerHTML = '<div style="text-align:center;padding:64px;color:#64748B;font-weight:600">⏳ Building forecast from trailing daily data…</div>';
  try {
    const r = await fetch(`/api/attribution/forecast?days=${Math.max(14,days)}&horizon=30&aov=${aov}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Failed to load');
    wrap.innerHTML = _forecastHtml(j);
  } catch (e) {
    const safe = (typeof _escapeHtml === 'function') ? _escapeHtml(e.message) : String(e.message);
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B"><b>⚠️ Could not load forecast</b><div style="font-size:.85rem;margin-top:6px">${safe}</div></div>`;
  }
}
function _forecastHtml(j) {
  const esc = (typeof _escapeHtml === 'function') ? _escapeHtml : (s)=>String(s==null?'':s);
  const fmt$ = (n) => n == null ? '—' : '$' + Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  if (j.warning) {
    return `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:32px;text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">🔮</div>
      <div style="font-weight:800;color:#92400E;font-size:1.05rem;margin-bottom:6px">Not enough history yet</div>
      <div style="font-size:.85rem;color:#78350F">${esc(j.warning)}</div>
    </div>`;
  }
  const s = j.summary || {};
  const trendArrow = (dir) => dir === 'up' ? '<span style="color:#10B981">▲ Rising</span>' : (dir === 'down' ? '<span style="color:#DC2626">▼ Falling</span>' : '<span style="color:#94A3B8">→ Flat</span>');
  // SVG sparkline of actual + forecast for spend & conversions
  const spark = (actualVals, forecastVals, label, color, fmt) => {
    const all = [...actualVals, ...forecastVals];
    const max = Math.max(...all, 1);
    const min = 0;
    const W = 700, H = 120, pad = 8;
    const totalN = all.length;
    const x = (i) => pad + (i / Math.max(1, totalN - 1)) * (W - pad*2);
    const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad*2);
    const actualPath = actualVals.map((v,i) => `${i===0?'M':'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const fcPath = forecastVals.map((v,i) => {
      const idx = actualVals.length - 1 + i; // start from last actual point
      return `${i===0?'M'+x(actualVals.length-1).toFixed(1)+','+y(actualVals[actualVals.length-1]).toFixed(1)+' L':'L'}${x(idx+1).toFixed(1)},${y(v).toFixed(1)}`;
    }).join(' ');
    const splitX = x(actualVals.length - 1);
    return `
      <div style="background:white;border:1.5px solid #E5E7EB;border-radius:14px;padding:18px;margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:800;color:#0A1628;font-size:.95rem">${label}</div>
          <div style="font-size:.72rem;color:#64748B">
            <span style="display:inline-block;width:18px;height:2px;background:${color};vertical-align:middle"></span> Actual ·
            <span style="display:inline-block;width:18px;height:2px;background:${color};opacity:.5;border-top:1px dashed ${color};vertical-align:middle"></span> Forecast
          </div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:140px;display:block">
          <line x1="${splitX}" x2="${splitX}" y1="${pad}" y2="${H-pad}" stroke="#CBD5E1" stroke-dasharray="3,3" stroke-width="1"/>
          <text x="${splitX+4}" y="${pad+10}" font-size="10" fill="#94A3B8" font-weight="700">Today</text>
          <path d="${actualPath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="${fcPath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="5,4" stroke-linecap="round" stroke-linejoin="round" opacity=".65"/>
        </svg>
        <div style="display:flex;justify-content:space-between;font-size:.7rem;color:#94A3B8;margin-top:4px">
          <span>${esc(actualVals.length ? j.actual[0].date : '')}</span>
          <span>Today</span>
          <span>${esc(j.forecast.length ? j.forecast[j.forecast.length-1].date : '')}</span>
        </div>
      </div>`;
  };
  const fcDisconnected = [
    { key:'meta',   name:'Meta Ads',   icon:'📘' },
    { key:'google', name:'Google Ads', icon:'🔵' },
    { key:'tiktok', name:'TikTok Ads', icon:'⚫' },
  ].filter(d => j.channelStatus && j.channelStatus[d.key] === false);
  const fcNotices = fcDisconnected.length ? fcDisconnected.map(d =>
    `<div style="display:flex;align-items:flex-start;gap:10px;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;font-size:0.78rem;color:#92400E;line-height:1.5">
      <span style="font-size:1rem">${d.icon}</span>
      <div>⚠️ <strong>${esc(d.name)} is not connected</strong> — its spend is excluded from this forecast.<br>
      <a href="#" onclick="navigateTo&&(window._pendingSettingsTab='platforms',navigateTo('settings'));return false;" style="color:#92400E;font-weight:700;text-decoration:underline">Go to Settings → Integrations →</a></div>
    </div>`
  ).join('') : '';
  return `
    <div style="background:linear-gradient(135deg,#1E1B4B 0%,#312E81 50%,#4338CA 100%);border-radius:18px;padding:24px;color:white;margin-bottom:18px">
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;opacity:.85;font-weight:700">30-Day Forecast · trailing ${j.days} days of daily data · conversions from <b>${esc(j.conversionSource === 'amplitude' ? 'Amplitude' : 'ad platforms')}</b></div>
      <div style="font-size:1.4rem;font-weight:900;margin-top:6px">Where you're heading</div>
      <div style="font-size:.85rem;opacity:.85;margin-top:4px">Linear trend + EMA smoothing on your daily spend & conversions, projected forward 30 days. Use it to size next month's budget and spot where you'll land before you commit.</div>
    </div>
    ${fcNotices ? `<div style="display:grid;gap:8px;margin-bottom:14px">${fcNotices}</div>` : ''}
    <div class="fc-summary">
      <div class="fc-card"><div class="fc-card-label">Avg daily spend (last ${j.days}d)</div><div class="fc-card-value">${fmt$(s.avgDailySpend)}</div><div class="fc-card-sub">Trend ${trendArrow(s.trendDirection)}</div></div>
      <div class="fc-card"><div class="fc-card-label">Avg daily conversions</div><div class="fc-card-value">${fmtN(s.avgDailyConversions)}</div><div class="fc-card-sub">Trend ${trendArrow(s.conversionsTrend)}</div></div>
      <div class="fc-card"><div class="fc-card-label">Projected spend (next 30d)</div><div class="fc-card-value">${fmt$(s.projSpend)}</div><div class="fc-card-sub">Forecast horizon</div></div>
      <div class="fc-card"><div class="fc-card-label">Projected conversions</div><div class="fc-card-value">${fmtN(s.projConversions)}</div><div class="fc-card-sub">${j.aov > 0 || s.projRevenue > 0 ? 'Rev ' + fmt$(s.projRevenue) : 'Add AOV for revenue'}</div></div>
      <div class="fc-card"><div class="fc-card-label">Projected ROAS</div><div class="fc-card-value">${s.projROAS != null ? s.projROAS + 'x' : '—'}</div><div class="fc-card-sub">${j.aov > 0 ? 'using AOV $' + j.aov : 'reported revenue only'}</div></div>
      <div class="fc-card"><div class="fc-card-label">Projected CAC</div><div class="fc-card-value">${s.projCAC != null ? fmt$(s.projCAC) : '—'}</div><div class="fc-card-sub">Cost per conversion</div></div>
    </div>
    ${spark(j.actual.map(d => d.spend), j.forecast.map(d => d.spend), 'Daily Spend', '#4338CA')}
    ${spark(j.actual.map(d => d.conversions), j.forecast.map(d => d.conversions), 'Daily Conversions', '#059669')}
    <div style="text-align:center;font-size:.68rem;color:#94A3B8;margin-top:14px">Generated ${new Date(j.generatedAt).toLocaleString()} · forecast is a directional estimate, not a guarantee</div>`;
}

/* =============================================================================
   CONTENT OPTIMISATION SCORER — pulls live top-10 SERP for a keyword, scrapes
   competing pages, scores the user's page 0–100, returns concrete recs.
   100% outward-facing: only public SERPs + the user's own page/draft.
   ============================================================================= */
// Module-level state for the multi-select country picker + related keyword chips.
window._csCountryList = window._csCountryList || []; // [{code, name}]
window._csSelectedCountries = window._csSelectedCountries || ['US'];
const CS_MAX_COUNTRIES = 6;

function buildContentScorer() {
  const wrap = document.getElementById('contentScorerWrap');
  if (!wrap) return;
  if (wrap.dataset.built === '1') return;
  wrap.dataset.built = '1';
  wrap.innerHTML = `
    <div class="cs-card">
      <div class="cs-form">
        <div class="cs-field">
          <label>Target keyword</label>
          <input type="text" id="csKeyword" placeholder="e.g. ai marketing automation tools" oninput="_csOnKeywordChange()" />
          <div class="cs-related-row">
            <button type="button" class="cs-related-btn" id="csSuggestBtn" onclick="loadRelatedKeywords()" title="Type a target keyword above first, then click for related keyword ideas with search volume.">✨ Suggest related</button>
            <div class="cs-related-chips" id="csRelatedChips"></div>
          </div>
        </div>
        <div class="cs-field">
          <label>Country <span style="opacity:.6;font-weight:400" id="csCountryHint">(1 selected — click to add more)</span></label>
          <div class="cs-multi" id="csCountryPicker">
            <button type="button" class="cs-multi-toggle" id="csCountryToggle" aria-expanded="false" aria-haspopup="listbox" onclick="_csToggleCountryPanel()">
              <span id="csCountryLabel">United States</span>
              <span class="cs-multi-caret">▾</span>
            </button>
            <div class="cs-multi-panel" id="csCountryPanel" hidden>
              <div class="cs-multi-actions">
                <input type="text" class="cs-multi-search" id="csCountrySearch" placeholder="Search countries…" oninput="_csFilterCountries()" />
                <button type="button" class="cs-multi-link" onclick="_csSelectAllCountries()">Select all</button>
                <button type="button" class="cs-multi-link" onclick="_csClearCountries()">Clear</button>
              </div>
              <div class="cs-multi-list" id="csCountryListEl">Loading…</div>
              <div class="cs-multi-foot">Pick any number — the scorer runs the top ${CS_MAX_COUNTRIES} (by market priority) per submission.</div>
            </div>
          </div>
        </div>
        <div class="cs-field cs-field-wide">
          <label>Your page URL <span style="opacity:.6;font-weight:400">(or paste draft below)</span></label>
          <input type="text" id="csUrl" placeholder="https://yoursite.com/your-page" />
        </div>
        <div class="cs-field cs-field-full">
          <label>Or paste your draft content <span style="opacity:.6;font-weight:400">(optional — used if URL is empty)</span></label>
          <textarea id="csDraft" rows="4" placeholder="Paste your article draft here for scoring before publishing…"></textarea>
        </div>
        <div class="cs-field cs-field-full" style="display:flex;gap:10px;align-items:center">
          <button class="cs-go" id="csRunBtn" onclick="runContentScorer()">Score my content</button>
          <span style="font-size:.85rem;opacity:.7" id="csRunHint">Live SERP fetch + page scrape — usually 8–15 seconds.</span>
        </div>
      </div>
    </div>
    <div id="csResult" style="margin-top:24px"></div>
  `;
  // Click-outside closes the multi-select panel (one-time binding).
  if (!window._csOutsideBound) {
    window._csOutsideBound = true;
    document.addEventListener('click', _csOutsideClick, true);
  }
  // Auto-prefill the page URL with the domain the user analysed on the home page,
  // so they don't have to retype it. They can still edit / replace it.
  try {
    const dom = _lsDomain();
    const urlInput = document.getElementById('csUrl');
    if (dom && urlInput && !urlInput.value) {
      urlInput.value = `https://${dom}`;
    }
    // Auto-prefill the target keyword from prior analyses so the user doesn't
    // have to retype what InfoGenie already discovered. They can edit / clear it.
    const kwInput = document.getElementById('csKeyword');
    const priorKws = _lsKeywords();
    if (kwInput && !kwInput.value && priorKws.length) {
      kwInput.value = priorKws[0];
      _csOnKeywordChange();
    }
  } catch (_) {}
  // Load country list from server (single source of truth).
  _csLoadCountries();
}

async function _csLoadCountries() {
  if (window._csCountryList.length) { _csRenderCountryList(); _csUpdateCountryLabel(); return; }
  try {
    const r = await fetch('/api/content-scorer/countries');
    const j = await r.json();
    if (j.ok && Array.isArray(j.countries)) window._csCountryList = j.countries;
  } catch (_) {}
  if (!window._csCountryList.length) {
    // Fallback list if endpoint fails — keeps UI usable.
    window._csCountryList = [{code:'US', name:'United States'}, {code:'GB', name:'United Kingdom'}, {code:'CA', name:'Canada'}, {code:'AU', name:'Australia'}];
  }
  _csRenderCountryList();
  _csUpdateCountryLabel();
}

function _csRenderCountryList(filter = '') {
  const list = document.getElementById('csCountryListEl');
  if (!list) return;
  const f = (filter || '').toLowerCase().trim();
  const items = window._csCountryList.filter(c => !f || c.name.toLowerCase().includes(f) || c.code.toLowerCase().includes(f));
  if (!items.length) { list.innerHTML = '<div style="opacity:.6;padding:12px;font-size:.85rem">No countries match.</div>'; return; }
  list.innerHTML = items.map(c => {
    const sel = window._csSelectedCountries.includes(c.code);
    return `<label class="cs-multi-item ${sel ? 'cs-multi-item-sel' : ''}">
      <input type="checkbox" ${sel ? 'checked' : ''} onchange="_csToggleCountry('${c.code}', this.checked)" />
      <span class="cs-multi-code">${_escapeHtml(c.code)}</span>
      <span class="cs-multi-name">${_escapeHtml(c.name)}</span>
    </label>`;
  }).join('');
}

function _csFilterCountries() {
  const v = (document.getElementById('csCountrySearch')?.value || '');
  _csRenderCountryList(v);
}

// Priority order used when more than CS_MAX_COUNTRIES are selected — the run-time
// trim picks markets in this order; everything else is processed afterwards.
const CS_COUNTRY_PRIORITY = ['US','GB','CA','AU','DE','FR','IN','JP','BR','MX','ES','IT','NL','IE','SG','AE','ZA','SA','TR','PL','SE','NO','DK','FI','CH','AT','BE','PT','GR','CZ','RO','HU','UA','RU','HK','TW','MY','TH','ID','PH','VN','PK','BD','EG','NG','KE','MA','AR','CL','CO','PE','NZ'];

function _csToggleCountry(code, checked) {
  const sel = new Set(window._csSelectedCountries);
  if (checked) sel.add(code); else sel.delete(code);
  window._csSelectedCountries = Array.from(sel);
  _csUpdateCountryLabel();
  _csRenderCountryList(document.getElementById('csCountrySearch')?.value || '');
}

function _csSelectAllCountries() {
  // Really selects every country. Run-time cap is enforced at submit (top CS_MAX_COUNTRIES by priority).
  if (!window._csCountryList.length) { _flashHint('Country list still loading — try again in a moment.'); return; }
  window._csSelectedCountries = window._csCountryList.map(c => c.code);
  _csUpdateCountryLabel();
  _csRenderCountryList(document.getElementById('csCountrySearch')?.value || '');
  const n = window._csSelectedCountries.length;
  _flashHint(`Selected all ${n} countries · only the top ${CS_MAX_COUNTRIES} (by market priority) will actually be scored per run.`);
}

// Picks the top CS_MAX_COUNTRIES from a selection using CS_COUNTRY_PRIORITY ordering.
function _csTrimToCap(codes) {
  if (codes.length <= CS_MAX_COUNTRIES) return { kept: codes.slice(), dropped: [] };
  const sorted = codes.slice().sort((a, b) => {
    const ia = CS_COUNTRY_PRIORITY.indexOf(a); const ib = CS_COUNTRY_PRIORITY.indexOf(b);
    const ra = ia === -1 ? 999 : ia; const rb = ib === -1 ? 999 : ib;
    return ra - rb;
  });
  return { kept: sorted.slice(0, CS_MAX_COUNTRIES), dropped: sorted.slice(CS_MAX_COUNTRIES) };
}

function _csClearCountries() {
  window._csSelectedCountries = [];
  _csUpdateCountryLabel();
  _csRenderCountryList(document.getElementById('csCountrySearch')?.value || '');
}

function _csUpdateCountryLabel() {
  const lbl  = document.getElementById('csCountryLabel');
  const hint = document.getElementById('csCountryHint');
  const sel  = window._csSelectedCountries;
  if (!lbl || !hint) return;
  if (!sel.length) { lbl.textContent = 'No country selected'; hint.textContent = '(pick at least one)'; return; }
  if (sel.length === 1) {
    const found = window._csCountryList.find(c => c.code === sel[0]);
    lbl.textContent = found ? found.name : sel[0];
    hint.textContent = '(1 selected — click to add more)';
  } else if (sel.length <= CS_MAX_COUNTRIES) {
    lbl.textContent = `${sel[0]} + ${sel.length - 1} more`;
    hint.textContent = `(${sel.length} selected — runs in parallel)`;
  } else {
    lbl.textContent = `${sel.length} countries selected`;
    hint.textContent = `(${sel.length} selected — only top ${CS_MAX_COUNTRIES} will be scored)`;
  }
}

// Plain, predictable click-only dropdown.
//   - Closed by default (the HTML uses `hidden`).
//   - Click the toggle button to open.
//   - Click the toggle button again, click anywhere outside, or press Esc to close.
//   - No hover behavior at all.
let _csEscBound = false;
function _csClosePanel() {
  const p = document.getElementById('csCountryPanel');
  const t = document.getElementById('csCountryToggle');
  if (p) p.hidden = true;
  if (t) t.setAttribute('aria-expanded', 'false');
}
function _csOpenPanel() {
  const p = document.getElementById('csCountryPanel');
  const t = document.getElementById('csCountryToggle');
  if (p) p.hidden = false;
  if (t) t.setAttribute('aria-expanded', 'true');
  if (!_csEscBound) {
    _csEscBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') _csClosePanel();
    });
  }
}
function _csToggleCountryPanel() {
  const p = document.getElementById('csCountryPanel');
  if (!p) return;
  if (p.hidden) _csOpenPanel(); else _csClosePanel();
}

function _csOutsideClick(e) {
  const p = document.getElementById('csCountryPanel');
  const w = document.getElementById('csCountryPicker');
  if (!p || !w || p.hidden) return;
  // Click inside the picker (toggle or panel) — let the toggle handler manage state.
  if (w.contains(e.target)) return;
  // Click anywhere else closes the panel; the click still propagates to its target,
  // so the user only needs ONE click to both close the panel and activate the next control.
  _csClosePanel();
}

function _csOnKeywordChange() {
  // Keep the button enabled at all times so a click always provides feedback.
  // Clear stale chips when keyword changes.
  const kw = (document.getElementById('csKeyword')?.value || '').trim();
  const chips = document.getElementById('csRelatedChips');
  if (chips && chips.dataset.forKw && chips.dataset.forKw !== kw.toLowerCase()) chips.innerHTML = '';
}

function _csFocusAndFlash(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.focus();
  try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
  const orig = el.style.boxShadow;
  el.style.boxShadow = '0 0 0 3px rgba(239,68,68,.45)';
  setTimeout(() => { el.style.boxShadow = orig; }, 1600);
  if (msg) _flashHint(msg);
}

async function loadRelatedKeywords() {
  const kwInput = document.getElementById('csKeyword');
  let kw = (kwInput?.value || '').trim();
  const chips = document.getElementById('csRelatedChips');
  const btn = document.getElementById('csSuggestBtn');
  if (!chips) return;
  // First — pull keywords already discovered by previous analyses (smart-detect,
  // intent map, keyword map, content gaps). These are surfaced FIRST so the user
  // sees their own analysis context before remote DataForSEO suggestions.
  const priorKws = _lsKeywords();
  // If the keyword field is empty but we have prior analysis keywords, auto-fill
  // the input with the top one so the user can immediately scan related ideas.
  if ((!kw || kw.length < 2) && priorKws.length) {
    kw = String(priorKws[0]).trim();
    if (kwInput) { kwInput.value = kw; _csOnKeywordChange(); }
  }
  // ── Fallback: derive a seed from the URL field if user pasted a URL but no
  // keyword and no prior analyses (common when first opening Content Scorer
  // with just a URL like https://fxpro.com).
  if (!kw || kw.length < 2) {
    const urlVal = (document.getElementById('csUrl')?.value || '').trim();
    if (urlVal) {
      try {
        const host = urlVal.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
        // Strip leading "www." and the TLD, keep the brand stem (e.g. "fxpro").
        const stem = host.replace(/^www\./, '').split('.')[0];
        if (stem && stem.length >= 2) {
          kw = stem;
          if (kwInput) { kwInput.value = kw; _csOnKeywordChange(); }
          _flashHint(`💡 No keyword set — using brand seed "${stem}" from your URL.`);
        }
      } catch (_) { /* ignore parse errors */ }
    }
  }
  if (!kw || kw.length < 2) {
    _csFocusAndFlash('csKeyword', '⚠️ Type a keyword above (or paste a URL in the URL field) — we need a seed to suggest related ideas.');
    return;
  }
  // Use the first selected country (or US) for regional volume context.
  const country = (window._csSelectedCountries && window._csSelectedCountries[0]) || 'US';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
  // Build "From your analyses" section IMMEDIATELY so the user sees something
  // even before DataForSEO responds (or if it fails entirely).
  const renderChips = (priorList, remoteList, remoteError) => {
    const seen = new Set();
    const dedupe = (list) => list.filter(k => {
      const key = String(k.keyword || k).toLowerCase();
      if (seen.has(key) || key === kw.toLowerCase()) return false;
      seen.add(key);
      return true;
    });
    const priorClean = dedupe(priorList.map(k => ({ keyword: k, source: 'analysis' })));
    const remoteClean = dedupe((remoteList || []).map(k => ({ ...k, source: 'serp' })));
    let html = '';
    if (priorClean.length) {
      html += `<div class="cs-rel-section"><span class="cs-rel-section-label">From your analyses</span>` +
        priorClean.map(k => `<button type="button" class="cs-rel-chip cs-rel-chip-analysis" onclick="_csUseKeyword(this.dataset.kw)" data-kw="${_escapeHtml(k.keyword)}" title="From a prior InfoGenie analysis — click to use">${_escapeHtml(k.keyword)}<span class="cs-chip-vol cs-chip-vol-local">your data</span></button>`).join('') +
        `</div>`;
    }
    if (remoteClean.length) {
      html += `<div class="cs-rel-section"><span class="cs-rel-section-label">Live SERP related (DataForSEO)</span>` +
        remoteClean.map(k => {
          const vol = k.searchVolume != null ? `<span class="cs-chip-vol">${Number(k.searchVolume).toLocaleString()}/mo</span>` : '';
          return `<button type="button" class="cs-rel-chip" onclick="_csUseKeyword(this.dataset.kw)" data-kw="${_escapeHtml(k.keyword)}" title="Click to use this keyword">${_escapeHtml(k.keyword)}${vol}</button>`;
        }).join('') +
        `</div>`;
    }
    if (!html) {
      html = `<span style="opacity:.6;font-size:.8rem">No related keywords found${remoteError ? ' — ' + _escapeHtml(remoteError) : ''}.</span>`;
    }
    chips.dataset.forKw = kw.toLowerCase();
    chips.innerHTML = html;
  };
  // Show prior keywords immediately while DataForSEO is loading
  renderChips(priorKws, [], null);
  if (priorKws.length) {
    // Append a loading hint
    chips.insertAdjacentHTML('beforeend', `<span id="csRelLoading" style="opacity:.6;font-size:.8rem;margin-left:8px">+ live SERP related…</span>`);
  } else {
    chips.innerHTML = '<span style="opacity:.6;font-size:.8rem">Fetching related keywords…</span>';
  }
  try {
    const r = await fetch(`/api/content-scorer/related?keyword=${encodeURIComponent(kw)}&country=${encodeURIComponent(country)}`);
    const j = await r.json();
    renderChips(priorKws, (j.ok && Array.isArray(j.keywords)) ? j.keywords : [], j.error);
  } catch (e) {
    renderChips(priorKws, [], e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Suggest related'; }
  }
}

function _csUseKeyword(kw) {
  const input = document.getElementById('csKeyword');
  if (!input) return;
  input.value = kw;
  _csOnKeywordChange();
  input.focus();
}

function _flashHint(msg) {
  const hint = document.getElementById('csRunHint');
  if (!hint) return;
  const orig = hint.textContent;
  hint.textContent = msg;
  hint.style.color = '#F59E0B';
  setTimeout(() => { hint.textContent = orig; hint.style.color = ''; }, 3500);
}

async function runContentScorer() {
  const kw    = (document.getElementById('csKeyword')?.value || '').trim();
  const url   = (document.getElementById('csUrl')?.value || '').trim();
  const draft = (document.getElementById('csDraft')?.value || '').trim();
  const out   = document.getElementById('csResult');
  const btn   = document.getElementById('csRunBtn');
  const allSelected = (window._csSelectedCountries || []).slice();
  if (!kw) {
    out.innerHTML = `<div class="cs-warn">⚠️ Enter a target keyword first.</div>`;
    _csFocusAndFlash('csKeyword', '⚠️ Enter a target keyword first.');
    return;
  }
  if (!allSelected.length) {
    out.innerHTML = `<div class="cs-warn">⚠️ Pick at least one country.</div>`;
    _flashHint('⚠️ Pick at least one country.');
    try { document.getElementById('csCountryToggle')?.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(_){}
    return;
  }
  if (!url && !draft) {
    out.innerHTML = `<div class="cs-warn">⚠️ Enter your page URL or paste a draft.</div>`;
    _csFocusAndFlash('csUrl', '⚠️ Enter your page URL or paste a draft below.');
    return;
  }
  // Trim oversize selections to the top CS_MAX_COUNTRIES by market priority.
  const { kept: countries, dropped } = _csTrimToCap(allSelected);
  let trimNotice = '';
  if (dropped.length) {
    const keptStr    = countries.map(_escapeHtml).join(', ');
    const droppedStr = dropped.map(_escapeHtml).join(', ');
    trimNotice = `<div class="cs-trim-notice">
      <strong>Trimmed for this run:</strong> you selected ${allSelected.length} countries; the scorer caps at ${CS_MAX_COUNTRIES} per run to stay fast and stay within data-provider limits.
      <div style="margin-top:6px"><strong>Scoring:</strong> ${keptStr}</div>
      <div style="margin-top:4px"><strong>Skipped:</strong> ${droppedStr} <span style="opacity:.65">— re-submit with these selected to score them.</span></div>
    </div>`;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Scoring…'; }
  const noun = countries.length === 1 ? 'country' : `${countries.length} countries`;
  out.innerHTML = trimNotice + `
    <div class="cs-loading">
      <div class="cs-spinner"></div>
      <div>
        <div style="font-weight:700;font-size:1.05rem">Analysing the SERP for "${_escapeHtml(kw)}" across ${noun}…</div>
        <div style="opacity:.75;font-size:.9rem;margin-top:4px">Fetching the top 10 results · scraping each page · extracting LSI terms · scoring your content</div>
      </div>
    </div>`;
  try {
    const body = { keyword: kw, countries };
    if (url)   body.targetUrl = url;
    if (draft) body.targetText = draft;
    const r = await fetch('/api/content-scorer/analyze', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      out.innerHTML = trimNotice + `<div class="cs-warn">Scoring failed: ${_escapeHtml(j?.error || 'unknown error')}</div>`;
      return;
    }
    out.innerHTML = trimNotice + _contentScorerHtml(j);
  } catch (e) {
    out.innerHTML = trimNotice + `<div class="cs-warn">Network error: ${_escapeHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Score my content'; }
  }
}

// Top-level renderer. Accepts the new envelope: { ok, multi, countries, target, results, generatedAt, keyword }
function _contentScorerHtml(j) {
  const esc = _escapeHtml;
  // New envelope path
  if (Array.isArray(j.results)) {
    const ok = j.results.filter(r => r && r.ok && r.score != null);
    const failed = j.results.filter(r => !r || !r.ok || r.score == null);
    if (!ok.length) {
      const msgs = failed.map(r => `<li><strong>${esc(r.country || '?')}</strong>: ${esc(r.error || r.warning || 'no SERP results')}</li>`).join('');
      return `<div class="cs-warn"><div style="font-weight:700;margin-bottom:6px">No countries returned scoreable results.</div><ul style="margin:0;padding-left:18px">${msgs}</ul></div>`;
    }
    const isMulti = ok.length > 1;
    // Country comparison summary card (only when multi)
    let summary = '';
    if (isMulti) {
      const sorted = ok.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      summary = `
        <div class="cs-card cs-multi-summary">
          <h4 class="cs-h">Cross-country comparison · "${esc(j.keyword)}"</h4>
          <p class="cs-h-sub">Same page, scored against the live top-10 SERP in each country. Higher = your page is closer to what's already winning there.</p>
          <div class="cs-multi-grid">
            ${sorted.map(r => {
              const sc = Number(r.score || 0);
              const col = sc >= 80 ? '#10B981' : sc >= 60 ? '#F59E0B' : sc >= 40 ? '#F97316' : '#EF4444';
              return `<div class="cs-multi-card">
                <div class="cs-multi-circle" style="background:conic-gradient(${col} ${sc*3.6}deg, #1E293B 0deg)">
                  <div class="cs-multi-circle-inner"><div style="color:${col};font-weight:800;font-size:1.4rem">${sc}</div><div style="opacity:.6;font-size:.7rem">/100</div></div>
                </div>
                <div class="cs-multi-cc">${esc(r.country)}</div>
              </div>`;
            }).join('')}
          </div>
          ${failed.length ? `<div style="margin-top:12px;font-size:.82rem;opacity:.7">Note: ${failed.length} country${failed.length>1?'ies':''} failed — ${failed.map(r => esc(r.country) + ' (' + esc(r.error || r.warning || 'unknown') + ')').join(', ')}</div>` : ''}
        </div>`;
    }
    // Per-country tabs (or single full card)
    const tabsHtml = isMulti ? `
      <div class="cs-tabs">
        ${ok.map((r, i) => `<button class="cs-tab ${i===0?'cs-tab-active':''}" onclick="_csSwitchTab(this, ${i})" data-tab="${i}">${esc(r.country)} · ${r.score}</button>`).join('')}
      </div>` : '';
    const panelsHtml = ok.map((r, i) => `
      <div class="cs-tab-panel" data-panel="${i}" ${i===0 ? '' : 'hidden'}>
        ${_csCountryHtml(r, j.target, j.generatedAt, isMulti)}
      </div>`).join('');
    return summary + tabsHtml + panelsHtml;
  }
  // Legacy single-country path (kept for back-compat in case anything else calls it)
  return _csCountryHtml(j, j.target, j.generatedAt, false);
}

function _csSwitchTab(btn, idx) {
  // Toggle active tab + show matching panel
  const tabsRow = btn.parentElement;
  Array.from(tabsRow.children).forEach(b => b.classList.toggle('cs-tab-active', Number(b.dataset.tab) === idx));
  const root = tabsRow.parentElement;
  Array.from(root.querySelectorAll('.cs-tab-panel')).forEach(p => { p.hidden = Number(p.dataset.panel) !== idx; });
}

// Renders one country's full result (score circle, breakdown, LSI, recs, competitors).
function _csCountryHtml(j, targetSummary, generatedAt, isMulti) {
  const esc = _escapeHtml;
  const score = Number(j.score || 0);
  const scoreColor = score >= 80 ? '#10B981' : score >= 60 ? '#F59E0B' : score >= 40 ? '#F97316' : '#EF4444';
  const scoreLabel = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Needs work' : 'Underperforming';
  const b = j.breakdown || {};
  const target = targetSummary || j.target || {};
  const country = j.country || '';
  const barRows = [
    { key:'wordCount',   label:'Word count',          desc:`Yours ${b.wordCount?.target||0} · SERP median ${b.wordCount?.median||0}` },
    { key:'headings',    label:'Heading structure',   desc:`H1 ${b.headings?.h1||0} · H2 ${b.headings?.h2||0} · H3 ${b.headings?.h3||0} · SERP avg H2 ${b.headings?.avgH2InSerp||0}` },
    { key:'lsiCoverage', label:'Topic / LSI coverage',desc:`${b.lsiCoverage?.covered||0} of ${b.lsiCoverage?.total||0} key terms covered` },
    { key:'faq',         label:'FAQ section',         desc:b.faq?.hasSchema?'FAQPage schema present':b.faq?.hasHeuristic?'FAQ-style headings detected':'No FAQ detected' },
    { key:'schema',      label:'Schema markup',       desc:(b.schema?.types||[]).length?`Types: ${(b.schema.types||[]).join(', ')}`:'No JSON-LD detected' },
    { key:'titleMeta',   label:'Title & meta',        desc:`Title ${b.titleMeta?.titleLen||0} chars · Meta ${b.titleMeta?.metaDescLen||0} chars` },
  ];
  const bars = barRows.map(row => {
    const item = b[row.key] || { score:0, max:0 };
    const pct = item.max ? Math.round((item.score / item.max) * 100) : 0;
    const barColor = pct >= 80 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
    return `
      <div class="cs-bar-row">
        <div class="cs-bar-label">
          <div class="cs-bar-name">${esc(row.label)}</div>
          <div class="cs-bar-desc">${esc(row.desc)}</div>
        </div>
        <div class="cs-bar-track"><div class="cs-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div class="cs-bar-score">${item.score}<span style="opacity:.5;font-weight:500">/${item.max}</span></div>
      </div>`;
  }).join('');

  // Recommendations
  const recsHtml = (j.recommendations || []).length ? (j.recommendations || []).map(r => {
    const pri = (r.priority || 'medium').toLowerCase();
    const priColor = pri==='high' ? '#EF4444' : pri==='low' ? '#94A3B8' : '#F59E0B';
    return `
      <div class="cs-rec">
        <div class="cs-rec-head">
          <span class="cs-rec-pri" style="background:${priColor}">${esc(pri.toUpperCase())}</span>
          <span class="cs-rec-cat">${esc(r.category || 'Improvement')}</span>
        </div>
        <div class="cs-rec-action">${esc(r.action || '')}</div>
        ${r.why ? `<div class="cs-rec-why">${esc(r.why)}</div>` : ''}
      </div>`;
  }).join('') : `<div style="opacity:.7;padding:12px">No additional recommendations — your page already covers the basics for this keyword.</div>`;

  // LSI terms
  const lsiCovered = b.lsiCoverage?.coveredTerms || [];
  const lsiMissing = b.lsiCoverage?.missingTerms || [];
  const lsiHtml = `
    <div class="cs-lsi-grid">
      <div>
        <div class="cs-lsi-title" style="color:#10B981">✓ Already covered (${lsiCovered.length})</div>
        <div class="cs-lsi-tags">${lsiCovered.map(t => `<span class="cs-lsi-tag cs-lsi-ok">${esc(t)}</span>`).join('') || '<span style="opacity:.5;font-size:.85rem">None yet</span>'}</div>
      </div>
      <div>
        <div class="cs-lsi-title" style="color:#EF4444">✗ Missing — add these (${lsiMissing.length})</div>
        <div class="cs-lsi-tags">${lsiMissing.map(t => `<span class="cs-lsi-tag cs-lsi-miss">${esc(t)}</span>`).join('') || '<span style="opacity:.5;font-size:.85rem">All key terms covered 🎉</span>'}</div>
      </div>
    </div>`;

  // Competitor table
  const compRows = (j.competitorSummary || []).map(c => `
    <tr>
      <td style="text-align:center;font-weight:700;color:#7C3AED">${c.rank}</td>
      <td><div style="font-weight:600;font-size:.88rem">${esc(c.domain)}</div><div style="opacity:.6;font-size:.78rem">${esc((c.title || '').slice(0, 80))}</div></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${c.ok ? c.wordCount.toLocaleString() : '—'}</td>
      <td style="text-align:center">${c.ok ? c.h2 : '—'}</td>
      <td style="text-align:center">${c.ok ? (c.hasFAQ?'<span style="color:#10B981">✓</span>':'<span style="opacity:.3">—</span>') : '—'}</td>
      <td style="text-align:center">${c.ok ? (c.hasSchema?'<span style="color:#10B981">✓</span>':'<span style="opacity:.3">—</span>') : '—'}</td>
      <td style="text-align:center;font-size:.78rem">${c.ok ? '<span style="color:#10B981">scraped</span>' : (() => {
        // Map raw error strings to friendlier labels — many top-domain
        // competitors (Trustpilot, Facebook, LinkedIn, Reddit, G2…) actively
        // block automated crawlers via WAF, returning 403/400/429. These
        // aren't InfoGenie failures, they're expected and should be shown as
        // an informational badge rather than a scary red HTTP code.
        const raw = String(c.error || 'failed');
        const m403 = /\b(403|forbidden)\b/i.test(raw);
        const m400 = /\b400\b/i.test(raw) && !/\b40[1-9]\b/i.test(raw);
        const m429 = /\b429\b/i.test(raw);
        const m5xx = /\b5\d{2}\b/i.test(raw);
        const mTimeout = /timeout|timed out|aborted/i.test(raw);
        let label, color, tip;
        if (m403)        { label = 'Bot-blocked'; color = '#94A3B8'; tip = 'This site uses anti-bot protection (Cloudflare/Akamai/etc.) and returned HTTP 403. The page exists — InfoGenie just can\u2019t crawl it from outside.'; }
        else if (m429)   { label = 'Rate-limited'; color = '#94A3B8'; tip = 'This site rate-limited our crawler (HTTP 429). Re-run the audit in a few minutes.'; }
        else if (m400)   { label = 'Blocked'; color = '#94A3B8'; tip = 'This site rejected our crawler (HTTP 400). Many sites \u2014 e.g. Facebook, LinkedIn \u2014 require login to view content.'; }
        else if (m5xx)   { label = 'Server error'; color = '#F59E0B'; tip = `Origin server returned an error: ${raw}`; }
        else if (mTimeout) { label = 'Timed out'; color = '#F59E0B'; tip = 'The site took too long to respond. Re-run to retry.'; }
        else             { label = 'Failed'; color = '#EF4444'; tip = raw; }
        return `<span style="color:${color};font-weight:600" title="${esc(tip)}">${esc(label)}</span>`;
      })()}</td>
    </tr>`).join('');

  return `
    <div class="cs-result-grid">
      <!-- Score card -->
      <div class="cs-card cs-score-card">
        <div class="cs-score-circle" style="background:conic-gradient(${scoreColor} ${score*3.6}deg, #1E293B 0deg)">
          <div class="cs-score-inner">
            <div class="cs-score-num" style="color:${scoreColor}">${score}</div>
            <div class="cs-score-of">/100</div>
          </div>
        </div>
        <div style="text-align:center;margin-top:14px">
          <div style="font-weight:800;font-size:1.15rem;color:${scoreColor}">${esc(scoreLabel)}</div>
          <div style="opacity:.75;font-size:.85rem;margin-top:4px">vs SERP-winning average for "${esc(j.keyword)}"</div>
        </div>
        <div style="margin-top:18px;font-size:.85rem;opacity:.85;line-height:1.5">
          <div><strong>Your page:</strong> ${esc(target?.url || '(draft)')}</div>
          <div style="margin-top:6px"><strong>Country:</strong> ${esc(country)} · <strong>Generated:</strong> ${generatedAt ? new Date(generatedAt).toLocaleString() : '—'}</div>
        </div>
      </div>
      <!-- Breakdown bars -->
      <div class="cs-card">
        <h4 class="cs-h">Score breakdown</h4>
        <div class="cs-bars">${bars}</div>
      </div>
    </div>
    <div class="cs-card" style="margin-top:24px">
      <h4 class="cs-h">Topic coverage — semantic terms competitors use</h4>
      <p class="cs-h-sub">Extracted from the live top-10 SERP. Adding the missing terms is the single biggest content lever.</p>
      ${lsiHtml}
    </div>
    <div class="cs-card" style="margin-top:24px">
      <h4 class="cs-h">Concrete recommendations</h4>
      <p class="cs-h-sub">Prioritised actions to close the gap with what's already winning.</p>
      <div class="cs-recs">${recsHtml}</div>
    </div>
    <div class="cs-card" style="margin-top:24px">
      <h4 class="cs-h">SERP top 10 — what you're up against</h4>
      <div style="overflow-x:auto">
      <table class="cs-comp-table">
        <thead><tr><th>#</th><th>Domain &amp; title</th><th style="text-align:right">Words</th><th>H2s</th><th>FAQ</th><th>Schema</th><th>Status</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
      </div>
    </div>`;
}

    // ---- Public entry points (formerly top-level globals in app.js) ----
    Object.assign(window, {
      buildBlendedPerf,
    loadBlendedPerf,
    _hydrateTrueRoasInline,
    _blendedHtml,
    openCommandBar,
    closeCommandBar,
    prefillCommand,
    runCommandBar,
    refreshLeadQualifier,
    buildLeadQualifier,
    _leadQualifierHtml,
    _leadCard,
    submitLeadQualification,
    deleteQualifiedLead,
    enrollHotLead,
    buildAttribution,
    loadAttribution,
    _attributionHtml,
    buildLookalike,
    generateLookalike,
    _lookalikeResultHtml,
    exportLookalikeCSV,
    switchAttributionTab,
    loadAttributionCohorts,
    _cohortHtml,
    loadAttributionForecast,
    _forecastHtml,
    buildContentScorer,
    _csLoadCountries,
    _csRenderCountryList,
    _csFilterCountries,
    _csToggleCountry,
    _csSelectAllCountries,
    _csTrimToCap,
    _csClearCountries,
    _csUpdateCountryLabel,
    _csClosePanel,
    _csOpenPanel,
    _csToggleCountryPanel,
    _csOutsideClick,
    _csOnKeywordChange,
    _csFocusAndFlash,
    loadRelatedKeywords,
    _csUseKeyword,
    _flashHint,
    runContentScorer,
    _contentScorerHtml,
    _csSwitchTab,
    _csCountryHtml,
    });
  })();
  
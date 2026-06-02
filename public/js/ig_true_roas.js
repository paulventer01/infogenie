/* ============================================================================
 * ig_true_roas.js — T36 True ROAS view (Conversions · Revenue Lag · Settings)
 * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
 * loaded after app.js in index.html. Public entry: window.buildTrueRoas / window._trState.
 * ========================================================================== */

// =============================================================================
// T36 — TRUE ROAS view (Conversions · Revenue Lag · Settings)
// =============================================================================
window._trState = { tab: 'conversions', summary: null, conversions: [], lag: null, settings: null };

async function buildTrueRoas() {
  const wrap = document.getElementById('trueRoasWrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:48px;text-align:center;color:#64748B">⏳ Loading True ROAS…</div>';
  try {
    const [sumR, settingsR, convR, lagR] = await Promise.all([
      fetch('/api/true-roas/summary?days=30').then(r=>r.json()),
      fetch('/api/true-roas/settings').then(r=>r.json()),
      fetch('/api/true-roas/conversions?limit=100').then(r=>r.json()),
      fetch('/api/true-roas/revenue-lag?days=90').then(r=>r.json()),
    ]);
    window._trState.summary = sumR;
    window._trState.settings = settingsR.settings;
    window._trState.hubspotConfigured = !!settingsR.hubspotConfigured;
    window._trState.conversions = convR.conversions || [];
    window._trState.lag = lagR;
    _trRender();
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:24px;color:#991B1B">⚠️ Could not load: ${_esc(e.message)}</div>`;
  }
}

function _trRender() {
  const wrap = document.getElementById('trueRoasWrap');
  if (!wrap) return;
  const tab = window._trState.tab || 'conversions';
  const tabBtn = (id, label) => `<button class="cg-btn-tab ${tab===id?'is-active':''}" onclick="_trTab('${id}')" style="padding:10px 18px;border:none;background:${tab===id?'#0066FF':'#E2E8F0'};color:${tab===id?'white':'#0F172A'};font-weight:700;border-radius:10px;cursor:pointer;margin-right:8px">${label}</button>`;
  wrap.innerHTML = `
    ${_trHeroHtml()}
    <div style="margin:24px 0 16px">
      ${tabBtn('conversions','📥 Conversions')}
      ${tabBtn('lag','⏱️ Revenue Lag')}
      ${tabBtn('settings','⚙️ Settings')}
    </div>
    <div id="trTabBody"></div>
  `;
  const body = document.getElementById('trTabBody');
  if (tab === 'conversions') body.innerHTML = _trConversionsHtml();
  else if (tab === 'lag')    body.innerHTML = _trLagHtml();
  else                       body.innerHTML = _trSettingsHtml();
}

function _trTab(id) { window._trState.tab = id; _trRender(); }

function _trHeroHtml() {
  const s = window._trState.summary || {};
  const fmt = n => '$' + Math.round(Number(n||0)).toLocaleString();
  const tile = (label, value, sub, color) => `
    <div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px">
      <div style="font-size:0.7rem;opacity:.7;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">${label}</div>
      <div style="font-size:1.95rem;font-weight:800;line-height:1.1;color:${color||'white'}">${value}</div>
      ${sub ? `<div style="font-size:0.66rem;opacity:.6;margin-top:4px">${sub}</div>` : ''}
    </div>`;
  const uplift = (s.reportedRoas && s.trueRoas) ? +(((s.trueRoas/s.reportedRoas)-1)*100).toFixed(1) : null;
  return `
    <div style="background:linear-gradient(135deg,#064E3B 0%,#065F46 50%,#047857 100%);border-radius:18px;padding:28px 32px;color:white;box-shadow:0 8px 28px rgba(6,78,59,.35)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <span style="font-size:1.4rem">💰</span>
        <div style="font-size:1.05rem;font-weight:800">True ROAS — last 30 days</div>
        <span style="margin-left:auto;font-size:0.74rem;opacity:.7">${(s.offline?.conversions||0)} offline conversions tracked${s.offline?.mixedCurrency ? ` · <span style="background:#FCD34D;color:#78350F;padding:2px 8px;border-radius:6px;font-weight:700">⚠️ mixed currencies: ${(s.offline.currencies||[]).map(c=>_esc(c.currency)).join(', ')}</span>` : ''}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px">
        ${tile('True ROAS', s.trueRoas != null ? s.trueRoas.toFixed(2)+'×' : '—', uplift != null && uplift > 0 ? `+${uplift}% vs reported` : 'Online + offline ÷ spend', '#34D399')}
        ${tile('Reported ROAS', s.reportedRoas != null ? s.reportedRoas.toFixed(2)+'×' : '—', 'What ad platforms see')}
        ${tile('Online Revenue', fmt(s.online?.revenue), 'From ad platforms')}
        ${tile('Offline Revenue', fmt(s.offline?.revenue), 'From CRM / CSV', '#FCD34D')}
        ${tile('Total Spend', fmt(s.spend), 'Last 30d ad spend')}
      </div>
    </div>`;
}

function _trConversionsHtml() {
  const list = window._trState.conversions || [];
  const fmt = n => '$' + Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const dt = s => s ? new Date(s).toLocaleDateString() : '—';
  const platBadge = p => {
    const c = { meta:'#1877F2', google:'#4285F4', tiktok:'#000', linkedin:'#0A66C2', unknown:'#94A3B8' }[p] || '#64748B';
    return `<span style="background:${c};color:white;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:700">${_esc(p||'unknown')}</span>`;
  };
  const sourceBadge = s => `<span style="background:${s==='hubspot'?'#FF7A59':s==='csv'?'#0F766E':'#64748B'};color:white;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:700">${_esc(s)}</span>`;
  const rows = list.map(c => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0">${dt(c.closed_at)}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0">${sourceBadge(c.source)}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0">${platBadge(c.platform)}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0">${_esc(c.email||'—')}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700">${fmt(c.revenue)} <span style="opacity:.5;font-weight:400;font-size:.75rem">${_esc(c.currency||'')}</span></td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0;text-align:right"><button onclick="_trDelete(${Number(c.id)})" style="background:transparent;border:1px solid #FCA5A5;color:#B91C1C;padding:4px 10px;border-radius:6px;font-size:0.72rem;cursor:pointer">Delete</button></td>
    </tr>`).join('');
  const empty = list.length === 0
    ? `<div style="padding:48px;text-align:center;color:#64748B;background:#F8FAFC;border-radius:12px">No offline conversions yet. Upload a CSV or sync HubSpot below.</div>`
    : '';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">
      <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:20px">
        <h3 style="margin:0 0 10px;font-size:1rem">📤 Upload CSV</h3>
        <p style="margin:0 0 12px;font-size:0.82rem;color:#64748B">Columns auto-detected: <code>deal_id</code>, <code>email</code>, <code>revenue</code>/<code>amount</code>, <code>currency</code>, <code>fbclid</code>/<code>gclid</code>/<code>ttclid</code>, <code>platform</code>, <code>closed_at</code>, <code>lead_created_at</code>.</p>
        <input type="file" id="trCsvFile" accept=".csv" style="margin-bottom:10px;font-size:0.85rem">
        <button onclick="_trUpload()" style="background:linear-gradient(135deg,#0066FF,#00C9C8);color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">📤 Upload</button>
        <div id="trUploadStatus" style="margin-top:10px;font-size:0.82rem"></div>
      </div>
      <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:20px">
        <h3 style="margin:0 0 10px;font-size:1rem">🔄 Sync HubSpot</h3>
        <p style="margin:0 0 12px;font-size:0.82rem;color:#64748B">Pulls closed-won deals from the last ${(window._trState.settings?.hubspotLookbackDays)||90} days. ${window._trState.hubspotConfigured ? '<b style="color:#059669">✓ Token configured</b>' : '<b style="color:#B91C1C">⚠️ HUBSPOT_PRIVATE_APP_TOKEN missing</b>'}.</p>
        <button onclick="_trSync()" ${!window._trState.hubspotConfigured?'disabled':''} style="background:#FF7A59;color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer;opacity:${window._trState.hubspotConfigured?1:0.5}">🔄 Sync now</button>
        <div id="trSyncStatus" style="margin-top:10px;font-size:0.82rem"></div>
      </div>
    </div>
    <h3 style="margin:18px 0 10px;font-size:1rem">📋 Recent conversions (${list.length})</h3>
    ${empty}
    ${list.length ? `<div style="background:white;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead><tr style="background:#F8FAFC;text-align:left">
          <th style="padding:10px">Closed</th><th style="padding:10px">Source</th><th style="padding:10px">Platform</th>
          <th style="padding:10px">Email</th><th style="padding:10px;text-align:right">Revenue</th><th style="padding:10px;text-align:right">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : ''}
  `;
}

function _trLagHtml() {
  const lag = window._trState.lag || {};
  const buckets = lag.buckets || [];
  const fmt = n => '$' + Math.round(Number(n||0)).toLocaleString();
  const wkRows = buckets.map(b => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0">${new Date(b.week).toLocaleDateString()}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0;text-align:right">${b.deals}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0;text-align:right;font-weight:700">${fmt(b.revenue)}</td>
      <td style="padding:10px;border-bottom:1px solid #E2E8F0;text-align:right">${b.avgDaysToClose}d</td>
    </tr>`).join('');
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px">
      <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:18px">
        <div style="font-size:0.72rem;color:#64748B;font-weight:700;text-transform:uppercase">Avg days to close</div>
        <div style="font-size:1.8rem;font-weight:800;margin-top:4px">${(lag.avgDaysToClose||0).toFixed(1)}d</div>
      </div>
      <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:18px">
        <div style="font-size:0.72rem;color:#64748B;font-weight:700;text-transform:uppercase">Total deals (90d)</div>
        <div style="font-size:1.8rem;font-weight:800;margin-top:4px">${lag.totalDeals||0}</div>
      </div>
      <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:18px">
        <div style="font-size:0.72rem;color:#64748B;font-weight:700;text-transform:uppercase">Total revenue (90d)</div>
        <div style="font-size:1.8rem;font-weight:800;margin-top:4px;color:#059669">${fmt(lag.totalRevenue)}</div>
      </div>
    </div>
    <h3 style="margin:18px 0 10px;font-size:1rem">📅 Weekly cohorts (lead-creation week)</h3>
    ${buckets.length ? `<div style="background:white;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
        <thead><tr style="background:#F8FAFC;text-align:left">
          <th style="padding:10px">Week of</th><th style="padding:10px;text-align:right">Deals closed</th>
          <th style="padding:10px;text-align:right">Revenue</th><th style="padding:10px;text-align:right">Avg time-to-close</th>
        </tr></thead>
        <tbody>${wkRows}</tbody>
      </table></div>`
    : '<div style="padding:48px;text-align:center;color:#64748B;background:#F8FAFC;border-radius:12px">No lag data yet. Upload conversions with <code>lead_created_at</code> populated to see how long deals take to close.</div>'}
  `;
}

function _trSettingsHtml() {
  const s = window._trState.settings || {};
  return `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:24px;max-width:680px">
      <h3 style="margin:0 0 18px;font-size:1.05rem">⚙️ True ROAS Settings</h3>
      <div style="display:flex;flex-direction:column;gap:16px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="trsHsEnabled" ${s.hubspotSyncEnabled?'checked':''} style="width:18px;height:18px">
          <div><b>Auto-sync HubSpot</b><div style="font-size:0.78rem;color:#64748B">Pull closed deals every 6 hours</div></div>
        </label>
        <div>
          <label style="display:block;font-weight:700;font-size:0.85rem;margin-bottom:6px">HubSpot lookback (days)</label>
          <input type="number" id="trsHsLookback" value="${s.hubspotLookbackDays||90}" min="1" max="365" style="width:120px;padding:8px;border:1px solid #CBD5E1;border-radius:6px">
        </div>
        <div>
          <label style="display:block;font-weight:700;font-size:0.85rem;margin-bottom:6px">HubSpot pipeline stages (comma-separated)</label>
          <input type="text" id="trsHsStages" value="${_esc((s.hubspotPipelineStages||['closedwon']).join(','))}" style="width:100%;padding:8px;border:1px solid #CBD5E1;border-radius:6px">
          <div style="font-size:0.75rem;color:#64748B;margin-top:4px">Default: <code>closedwon</code>. Use HubSpot stage IDs.</div>
        </div>
        <hr style="border:none;border-top:1px solid #E2E8F0;margin:8px 0">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="trsBudgetEnabled" ${s.budgetCapEnabled?'checked':''} style="width:18px;height:18px">
          <div><b>Profit-aware budget recommendations</b><div style="font-size:0.78rem;color:#64748B">Optimizer suggests budget cuts/scales based on True ROAS (recommendation-only, never auto-applied).</div></div>
        </label>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div>
            <label style="display:block;font-weight:700;font-size:0.85rem;margin-bottom:6px">Cut threshold (True ROAS &lt;)</label>
            <input type="number" id="trsMinThr" value="${s.minTrueRoasThreshold||1.5}" step="0.1" min="0" style="width:120px;padding:8px;border:1px solid #CBD5E1;border-radius:6px">
          </div>
          <div>
            <label style="display:block;font-weight:700;font-size:0.85rem;margin-bottom:6px">Scale threshold (True ROAS ≥)</label>
            <input type="number" id="trsScaleThr" value="${s.scaleTrueRoasThreshold||4.0}" step="0.1" min="0" style="width:120px;padding:8px;border:1px solid #CBD5E1;border-radius:6px">
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px">
          <button onclick="_trSaveSettings()" style="background:linear-gradient(135deg,#0066FF,#00C9C8);color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">💾 Save settings</button>
          <button onclick="_trRunBudgetRecs()" style="background:#7C3AED;color:white;border:none;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">🤖 Run budget recommendations now</button>
        </div>
        <div id="trSettingsStatus" style="font-size:0.85rem;margin-top:6px"></div>
      </div>
    </div>`;
}

async function _trUpload() {
  const f = document.getElementById('trCsvFile')?.files?.[0];
  const status = document.getElementById('trUploadStatus');
  if (!f) { status.innerHTML = '<span style="color:#B91C1C">⚠️ Pick a CSV file first</span>'; return; }
  status.innerHTML = '⏳ Uploading…';
  const fd = new FormData(); fd.append('file', f);
  try {
    const r = await fetch('/api/true-roas/upload', { method:'POST', body: fd });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'upload failed');
    status.innerHTML = `<span style="color:#059669">✓ Parsed ${j.parsed}, inserted ${j.inserted}, updated ${j.skipped}</span>`;
    setTimeout(buildTrueRoas, 600);
  } catch (e) { status.innerHTML = `<span style="color:#B91C1C">⚠️ ${_esc(e.message)}</span>`; }
}

async function _trSync() {
  const status = document.getElementById('trSyncStatus');
  status.innerHTML = '⏳ Syncing HubSpot deals…';
  try {
    const r = await fetch('/api/true-roas/sync-hubspot', { method:'POST' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'sync failed');
    status.innerHTML = `<span style="color:#059669">✓ Scanned ${j.scanned}, inserted ${j.inserted}, updated ${j.skipped}</span>`;
    setTimeout(buildTrueRoas, 600);
  } catch (e) { status.innerHTML = `<span style="color:#B91C1C">⚠️ ${_esc(e.message)}</span>`; }
}

async function _trDelete(id) {
  if (!confirm('Delete this conversion?')) return;
  await fetch('/api/true-roas/conversions/' + id, { method:'DELETE' });
  buildTrueRoas();
}

async function _trSaveSettings() {
  const status = document.getElementById('trSettingsStatus');
  status.innerHTML = '⏳ Saving…';
  const body = {
    hubspotSyncEnabled: document.getElementById('trsHsEnabled').checked,
    hubspotLookbackDays: parseInt(document.getElementById('trsHsLookback').value, 10) || 90,
    hubspotPipelineStages: document.getElementById('trsHsStages').value.split(',').map(s=>s.trim()).filter(Boolean),
    budgetCapEnabled: document.getElementById('trsBudgetEnabled').checked,
    minTrueRoasThreshold: parseFloat(document.getElementById('trsMinThr').value) || 1.5,
    scaleTrueRoasThreshold: parseFloat(document.getElementById('trsScaleThr').value) || 4.0,
  };
  try {
    const r = await fetch('/api/true-roas/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'save failed');
    status.innerHTML = '<span style="color:#059669">✓ Settings saved</span>';
    window._trState.settings = j.settings;
  } catch (e) { status.innerHTML = `<span style="color:#B91C1C">⚠️ ${_esc(e.message)}</span>`; }
}

async function _trRunBudgetRecs() {
  const status = document.getElementById('trSettingsStatus');
  status.innerHTML = '⏳ Generating budget recommendations…';
  try {
    const r = await fetch('/api/true-roas/budget-recommendations/run', { method:'POST' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'failed');
    if (j.skipped === 'disabled') { status.innerHTML = '<span style="color:#B45309">⚠️ Enable "Profit-aware budget recommendations" first, then save.</span>'; return; }
    status.innerHTML = `<span style="color:#059669">✓ Generated ${j.generated} recommendation${j.generated===1?'':'s'} (visible in Optimizer Decision Log)</span>`;
  } catch (e) { status.innerHTML = `<span style="color:#B91C1C">⚠️ ${_esc(e.message)}</span>`; }
}

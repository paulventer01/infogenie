// ============================================================================
// InfoGenie — extracted feature module: Reach Automation cluster
// ----------------------------------------------------------------------------
// PART OF THE app.js SPLIT (see public/js/README.md). This file was carved out
// of the monolithic app.js with NO behavior change. It holds the Reach
// automation views: Agency Hub (multi-client management), Automations Center,
// and the Re-engagement Hub (incl. the live Drip engine status panel).
// Conventions:
//   • Classic <script> (NOT an ES module). Loaded from index.html AFTER app.js
//     with its own ?v= cache-bust string, so editing this feature only forces a
//     re-download of THIS file, not the whole 50k-line app.js.
//   • Public entry points stay attached to window (window.buildAgency,
//     window.buildAutomations, window.buildReEngagement + the various window.*
//     action helpers), so navigateTo()'s dispatch and inline onclick= handlers
//     keep resolving.
//   • Shared globals (showToast, navigateTo, analysisData, Chart, dripAction …)
//     are defined in app.js and are available here at call time.
// ============================================================================
(function () {

// ═══════════════════════════════════════════════════════════════════════════════
// AGENCY HUB — Multi-client management, white-label reporting, scheduled sends
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._agencyTab)     window._agencyTab     = 'clients';
if (!window._agencyClients) window._agencyClients = [];
if (!window._agencyReports) window._agencyReports = [];
if (!window._agencyBrand)   window._agencyBrand   = { name:'My Agency', color:'#6366F1', footer:'Prepared exclusively for {client} by {agency}', reportFreq:'monthly' };

// ── Seed 3 demo clients if none yet ──────────────────────────────────────────
(function seedAgencyClients() {
  if (window._agencyClients.length > 0) return;
  window._agencyClients = [
    { id:'cl1', name:'TechFlow Solutions', domain:'techflow.io',    industry:'SaaS',        contact:'Sarah Chen',    email:'sarah@techflow.io',    budget:4500,  status:'active',  campaigns:3, addedDate:'12 Jan 2026', lastReport:'15 Mar 2026', freq:'monthly',  color:'#6366F1', revenue:12400 },
    { id:'cl2', name:'BrightShop Retail',  domain:'brightshop.com', industry:'eCommerce',   contact:'Marcus Webb',   email:'marcus@brightshop.com', budget:2800,  status:'active',  campaigns:5, addedDate:'3 Feb 2026',  lastReport:'1 Apr 2026',  freq:'weekly',   color:'#059669', revenue:8700  },
    { id:'cl3', name:'Nova Fintech',       domain:'novafintech.co', industry:'Fintech',     contact:'Priya Patel',   email:'priya@novafintech.co',  budget:7200,  status:'active',  campaigns:4, addedDate:'20 Jan 2026', lastReport:'8 Apr 2026',  freq:'monthly',  color:'#DC2626', revenue:21000 },
  ];
})();

function buildAgency() {
  const wrap = document.getElementById('agencyWrap');
  if (!wrap) return;

  const tab = window._agencyTab || 'clients';
  const clients = window._agencyClients || [];
  const reports = window._agencyReports || [];
  const brand   = window._agencyBrand;

  const TABS = [
    { id:'clients',    icon:'👥', label:'Clients' },
    { id:'reports',    icon:'📊', label:'Reports' },
    { id:'schedule',   icon:'📅', label:'Scheduled Sends' },
    { id:'whitelabel', icon:'🎨', label:'White-label' },
  ];
  const tabBar = `<div style="display:flex;gap:0;border-bottom:2px solid #E5E7EB;margin-bottom:24px;background:white;border-radius:14px 14px 0 0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)">
    ${TABS.map(t=>`<button onclick="window._agencyTab='${t.id}';buildAgency()" style="flex:1;padding:14px 8px;border:none;border-bottom:3px solid ${tab===t.id?'#6366F1':'transparent'};background:${tab===t.id?'#EEF2FF':'white'};font-size:0.8rem;font-weight:${tab===t.id?'800':'600'};color:${tab===t.id?'#4F46E5':'#6B7280'};cursor:pointer;transition:all .15s">${t.icon} ${t.label}</button>`).join('')}
  </div>`;

  const totalRevenue = clients.reduce((a,c)=>a+c.revenue,0);
  const totalBudget  = clients.reduce((a,c)=>a+c.budget,0);
  const activeClients = clients.filter(c=>c.status==='active').length;

  // ── Hero ──────────────────────────────────────────────────────────────────
  const hero = `
  <div style="background:linear-gradient(135deg,#312E81,#4338CA,#6366F1);border-radius:20px;padding:28px 32px;margin-bottom:24px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-40px;right:-40px;width:220px;height:220px;background:rgba(255,255,255,.05);border-radius:50%"></div>
    <div style="position:absolute;bottom:-60px;right:100px;width:160px;height:160px;background:rgba(255,255,255,.04);border-radius:50%"></div>
    <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div class="ig-agency-hero-content">
        <div class="ig-agency-eyebrow" style="font-size:0.6rem;font-weight:800;color:#C7D2FE !important;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">Grow › Agency</div>
        <div class="ig-agency-tag" style="font-size:0.65rem;font-weight:700;color:#DDD6FE !important;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Agency Hub · ${brand.name}</div>
        <div class="ig-agency-title" style="font-family:'Space Grotesk',sans-serif;font-size:1.65rem;font-weight:800;color:#FFFFFF !important;line-height:1.2;margin-bottom:8px;text-shadow:0 1px 2px rgba(0,0,0,0.3)">Manage Every Client.<br>Deliver Branded Results.</div>
        <div class="ig-agency-desc" style="font-size:0.84rem;color:rgba(255,255,255,0.92) !important;max-width:460px;line-height:1.55">Run InfoGenie for multiple clients from one dashboard. Generate white-label reports, schedule automatic sends, and switch context in one click.</div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
        ${[['👥','Clients',activeClients,'rgba(255,255,255,.15)'],['💰','Managed Budget','$'+totalBudget.toLocaleString(),'rgba(255,255,255,.15)'],['📈','Client Revenue','$'+totalRevenue.toLocaleString(),'rgba(255,255,255,.15)'],['📋','Reports',reports.length,'rgba(255,255,255,.15)']].map(([ic,l,v,bg])=>`
          <div style="background:${bg};border:1px solid rgba(255,255,255,.15);backdrop-filter:blur(8px);border-radius:14px;padding:14px 16px;text-align:center;min-width:90px">
            <div style="font-size:1rem;margin-bottom:2px">${ic}</div>
            <div style="font-size:1.2rem;font-weight:800;color:white">${v}</div>
            <div style="font-size:0.63rem;font-weight:600;color:rgba(255,255,255,.7)">${l}</div>
          </div>`).join('')}
      </div>
    </div>
  </div>`;

  // ════════════════════ TAB: CLIENTS ════════════════════
  if (tab === 'clients') {
    const cards = clients.map(c=>`
    <div style="background:white;border:1.5px solid #E5E7EB;border-radius:18px;padding:22px;box-shadow:0 1px 4px rgba(0,0,0,.05);transition:box-shadow .2s;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${c.color}"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <div style="width:42px;height:42px;background:${c.color}18;border:2px solid ${c.color}33;border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:800;color:${c.color};flex-shrink:0">${c.name[0]}</div>
          <div style="min-width:0">
            <div style="font-family:'Space Grotesk',sans-serif;font-size:0.9rem;font-weight:800;color:#0A1628;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
            <div style="font-size:0.68rem;color:#6B7280">${c.domain} · ${c.industry}</div>
          </div>
        </div>
        <span style="background:${c.status==='active'?'#F0FDF4':'#F9FAFB'};color:${c.status==='active'?'#059669':'#9CA3AF'};border-radius:6px;padding:2px 9px;font-size:0.62rem;font-weight:700;flex-shrink:0">${c.status==='active'?'● Active':'○ Paused'}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
        ${[['💰','Budget','$'+c.budget.toLocaleString()+'/mo'],['📈','Revenue','$'+c.revenue.toLocaleString()],['📣','Campaigns',c.campaigns],['📅','Last Report',c.lastReport]].map(([ic,l,v])=>`
          <div style="background:#F8FAFC;border-radius:9px;padding:8px 10px">
            <div style="font-size:0.62rem;color:#9CA3AF;font-weight:600">${ic} ${l}</div>
            <div style="font-size:0.82rem;font-weight:700;color:#0A1628;margin-top:1px">${v}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:12px">Contact: <span style="color:#374151;font-weight:600">${c.contact}</span> · <span style="color:#6366F1">${c.email}</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
        <button onclick="switchToClient('${c.id}')" style="padding:8px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:9px;font-size:0.7rem;font-weight:700;color:white;cursor:pointer">🔄 Switch</button>
        <button onclick="generateClientReport('${c.id}')" style="padding:8px;background:#F5F3FF;border:1px solid #C7D2FE;border-radius:9px;font-size:0.7rem;font-weight:700;color:#4F46E5;cursor:pointer">📊 Report</button>
        <button onclick="openEditClient('${c.id}')" style="padding:8px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:9px;font-size:0.7rem;font-weight:600;color:#6B7280;cursor:pointer">✏️ Edit</button>
      </div>
    </div>`).join('');

    wrap.innerHTML = `${hero}${tabBar}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">${clients.length} Client${clients.length!==1?'s':''} · ${activeClients} Active</div>
      <button onclick="openAddClient()" style="padding:10px 20px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">+ Add Client</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
      ${cards}
      <div onclick="openAddClient()" style="background:white;border:2px dashed #C7D2FE;border-radius:18px;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;color:#818CF8;transition:all .15s" onmouseover="this.style.borderColor='#6366F1';this.style.background='#EEF2FF'" onmouseout="this.style.borderColor='#C7D2FE';this.style.background='white'">
        <div style="font-size:2rem;margin-bottom:8px">+</div>
        <div style="font-size:0.82rem;font-weight:700">Add New Client</div>
      </div>
    </div>`;
    return;
  }

  // ════════════════════ TAB: REPORTS ════════════════════
  if (tab === 'reports') {
    const rows = reports.length > 0 ? reports.slice().reverse().map(r=>{
      const c = clients.find(x=>x.id===r.clientId)||{name:'Unknown',color:'#6B7280'};
      return `<tr style="border-bottom:1px solid #F3F4F6">
        <td style="padding:12px 14px">
          <div style="font-weight:700;color:#0A1628;font-size:0.82rem">${c.name}</div>
          <div style="font-size:0.65rem;color:#9CA3AF">${r.generatedAt}</div>
        </td>
        <td style="padding:12px 14px;text-align:center"><span style="background:#EEF2FF;color:#4F46E5;border-radius:6px;padding:2px 9px;font-size:0.65rem;font-weight:700">${r.type||'Full Report'}</span></td>
        <td style="padding:12px 14px;text-align:center"><span style="background:${r.status==='sent'?'#F0FDF4':'#FFFBEB'};color:${r.status==='sent'?'#059669':'#D97706'};border-radius:6px;padding:2px 9px;font-size:0.65rem;font-weight:700">${r.status==='sent'?'✓ Sent':'Draft'}</span></td>
        <td style="padding:12px 14px">
          <div style="display:flex;gap:5px;justify-content:flex-end">
            <button onclick="previewReport('${r.id}')" style="padding:5px 10px;background:#EEF2FF;border:none;border-radius:7px;font-size:0.65rem;font-weight:700;color:#4F46E5;cursor:pointer">👁 Preview</button>
            <button onclick="downloadAgencyReport('${r.id}','pdf')" style="padding:5px 10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:7px;font-size:0.65rem;font-weight:600;color:#374151;cursor:pointer">⬇ PDF</button>
            <button onclick="sendReportToClient('${r.id}')" style="padding:5px 10px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:7px;font-size:0.65rem;font-weight:700;color:white;cursor:pointer">📤 Send</button>
          </div>
        </td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" style="text-align:center;padding:40px;color:#9CA3AF;font-size:0.82rem">No reports generated yet — click "Generate Report" on any client card</td></tr>`;

    wrap.innerHTML = `${hero}${tabBar}
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">${reports.length} Report${reports.length!==1?'s':''} Generated</div>
      <button onclick="openGenerateReportModal()" style="padding:10px 20px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">+ Generate Report</button>
    </div>
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <table style="width:100%;border-collapse:collapse;font-size:0.76rem">
        <thead><tr style="background:#F8FAFC;border-bottom:2px solid #E5E7EB">
          <th style="text-align:left;padding:11px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Client</th>
          <th style="text-align:center;padding:11px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Type</th>
          <th style="text-align:center;padding:11px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Status</th>
          <th style="text-align:right;padding:11px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    return;
  }

  // ════════════════════ TAB: SCHEDULED SENDS ════════════════════
  if (tab === 'schedule') {
    const schedules = clients.map(c=>({
      clientId:c.id, name:c.name, email:c.email, color:c.color,
      freq:c.freq||'monthly', nextSend: (() => { const d=new Date(); d.setDate(d.getDate()+(c.freq==='weekly'?7:30)); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); })(),
      enabled: window._agencySchedules?.[c.id] !== false,
    }));

    wrap.innerHTML = `${hero}${tabBar}
    <div style="margin-bottom:16px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628;margin-bottom:4px">Automated Report Schedule</div>
      <div style="font-size:0.75rem;color:#6B7280">InfoGenie auto-generates and emails reports to each client at their scheduled interval.</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">
      ${schedules.map(s=>`
      <div style="background:white;border:1.5px solid ${s.enabled?'#C7D2FE':'#E5E7EB'};border-radius:16px;padding:18px 22px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:200px">
            <div style="width:38px;height:38px;background:${s.color}18;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;color:${s.color}">${s.name[0]}</div>
            <div>
              <div style="font-weight:800;color:#0A1628;font-size:0.85rem">${s.name}</div>
              <div style="font-size:0.68rem;color:#6B7280">${s.email}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="text-align:center">
              <div style="font-size:0.62rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:2px">Frequency</div>
              <select onchange="updateClientFreq('${s.clientId}',this.value)" style="padding:5px 10px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.75rem;color:#0A1628;background:white;font-family:'Inter',sans-serif">
                <option value="weekly" ${s.freq==='weekly'?'selected':''}>Weekly</option>
                <option value="monthly" ${s.freq==='monthly'?'selected':''}>Monthly</option>
                <option value="quarterly" ${s.freq==='quarterly'?'selected':''}>Quarterly</option>
              </select>
            </div>
            <div style="text-align:center">
              <div style="font-size:0.62rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:2px">Next Send</div>
              <div style="font-size:0.78rem;font-weight:700;color:#4F46E5">${s.nextSend}</div>
            </div>
            <div onclick="toggleSchedule('${s.clientId}')" style="cursor:pointer">
              <div style="width:46px;height:26px;background:${s.enabled?'#6366F1':'#D1D5DB'};border-radius:13px;position:relative;transition:background .2s">
                <div style="position:absolute;top:3px;left:${s.enabled?'23':'3'}px;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.2);transition:left .18s"></div>
              </div>
            </div>
            <button onclick="sendReportNow('${s.clientId}')" style="padding:7px 14px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:9px;font-size:0.72rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">📤 Send Now</button>
          </div>
        </div>
      </div>`).join('')}
    </div>
    <div style="background:linear-gradient(135deg,#EEF2FF,#E0E7FF);border:1.5px solid #C7D2FE;border-radius:16px;padding:20px 24px">
      <div style="font-size:0.72rem;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">💡 How automated reporting works</div>
      <div style="font-size:0.78rem;color:#3730A3;line-height:1.7">When scheduled sends are active, InfoGenie automatically generates a full branded report at the scheduled interval — covering campaign performance, competitor movements, social metrics, and AI-recommended next steps — then delivers it to your client's inbox with your agency branding. No manual steps required.</div>
    </div>`;
    return;
  }

  // ════════════════════ TAB: WHITE-LABEL ════════════════════
  if (tab === 'whitelabel') {
    wrap.innerHTML = `${hero}${tabBar}
    <div style="display:grid;grid-template-columns:1fr 360px;gap:20px;align-items:flex-start">
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628;margin-bottom:18px">🎨 White-label Settings</div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Agency Name</div>
            <input id="wl-name" type="text" value="${brand.name}" placeholder="Your Agency Name" oninput="window._agencyBrand.name=this.value" style="width:100%;box-sizing:border-box;padding:10px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.85rem;color:#0A1628;font-family:'Inter',sans-serif;outline:none">
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Brand Colour</div>
            <div style="display:flex;align-items:center;gap:10px">
              <input id="wl-color" type="color" value="${brand.color}" oninput="window._agencyBrand.color=this.value" style="width:44px;height:38px;padding:2px;border:1.5px solid #E5E7EB;border-radius:9px;cursor:pointer;background:white">
              <input type="text" value="${brand.color}" oninput="window._agencyBrand.color=this.value;document.getElementById('wl-color').value=this.value" style="flex:1;padding:10px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.85rem;color:#0A1628;font-family:'Inter',sans-serif;outline:none">
            </div>
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Report Footer Text</div>
            <textarea id="wl-footer" rows="2" oninput="window._agencyBrand.footer=this.value" style="width:100%;box-sizing:border-box;padding:10px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.82rem;color:#0A1628;font-family:'Inter',sans-serif;outline:none;resize:none">${brand.footer}</textarea>
            <div style="font-size:0.65rem;color:#9CA3AF;margin-top:3px">Use {client} and {agency} as placeholders</div>
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Default Report Frequency</div>
            <select oninput="window._agencyBrand.reportFreq=this.value" style="width:100%;padding:10px 13px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:0.85rem;color:#0A1628;background:white;font-family:'Inter',sans-serif">
              <option value="weekly"    ${brand.reportFreq==='weekly'?'selected':''}>Weekly</option>
              <option value="monthly"   ${brand.reportFreq==='monthly'?'selected':''}>Monthly</option>
              <option value="quarterly" ${brand.reportFreq==='quarterly'?'selected':''}>Quarterly</option>
            </select>
          </div>
          <button onclick="showToast('✅ White-label settings saved');buildAgency()" style="padding:11px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer;margin-top:4px">💾 Save Settings</button>
        </div>
      </div>

      <!-- Report preview -->
      <div style="background:white;border:2px solid #C7D2FE;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(99,102,241,.12)">
        <div style="background:linear-gradient(135deg,${brand.color},${brand.color}CC);padding:20px 22px">
          <div style="font-size:0.6rem;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">${brand.name}</div>
          <div style="font-size:1rem;font-weight:800;color:white;margin-bottom:2px">Monthly Performance Report</div>
          <div style="font-size:0.7rem;color:rgba(255,255,255,.7)">Prepared for [Client Name] · ${new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</div>
        </div>
        <div style="padding:16px 18px;font-size:0.72rem;color:#374151;line-height:1.7">
          <div style="font-weight:700;color:#0A1628;margin-bottom:6px">📋 Executive Summary</div>
          <div style="color:#6B7280;margin-bottom:12px">This report covers campaign performance, competitor intelligence, social metrics, and strategic recommendations for the period ending ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long'})}.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px">
            ${[['Total Reach','84,200'],['Ad Spend','$4,500'],['ROAS','3.8×'],['Engagement','4.2%']].map(([l,v])=>`<div style="background:#F8FAFC;border-radius:7px;padding:8px 10px"><div style="font-size:0.6rem;color:#9CA3AF">${l}</div><div style="font-size:0.88rem;font-weight:800;color:${brand.color}">${v}</div></div>`).join('')}
          </div>
          <div style="border-top:1px solid #E5E7EB;padding-top:10px;font-size:0.65rem;color:#9CA3AF;text-align:center">${brand.footer.replace('{client}','[Client]').replace('{agency}',brand.name)}</div>
        </div>
      </div>
    </div>`;
    return;
  }

  wrap.innerHTML = `${hero}${tabBar}`;
}

// ── Add / Edit client modal ────────────────────────────────────────────────────
window.openAddClient = function(editId) {
  const existing = document.getElementById('agencyClientOverlay');
  if (existing) existing.remove();
  const edit = editId ? window._agencyClients.find(c=>c.id===editId) : null;
  const COLORS = ['#6366F1','#059669','#DC2626','#D97706','#0066FF','#7C3AED','#0A66C2','#E1306C'];

  const overlay = document.createElement('div');
  overlay.id = 'agencyClientOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;width:100%;max-width:500px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.3)">
      <div style="background:linear-gradient(135deg,#312E81,#6366F1);border-radius:20px 20px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:800;color:white">${edit?'Edit Client':'Add New Client'}</div>
        <button id="acc-close" style="background:rgba(255,255,255,.15);border:none;border-radius:50%;width:30px;height:30px;font-size:1rem;color:white;cursor:pointer">✕</button>
      </div>
      <div style="padding:22px 24px;display:flex;flex-direction:column;gap:13px">
        ${[['acc-name','text','Client / Company Name',edit?.name||''],['acc-domain','text','Website domain (e.g. company.com)',edit?.domain||''],['acc-contact','text','Primary Contact Name',edit?.contact||''],['acc-email','email','Contact Email',edit?.email||''],['acc-budget','number','Monthly Ad Budget (USD)',edit?.budget||'']].map(([id,type,ph,val])=>`
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${ph}</div>
            <input id="${id}" type="${type}" value="${val}" placeholder="${ph}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.82rem;color:#0A1628;font-family:'Inter',sans-serif;outline:none">
          </div>`).join('')}
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Industry</div>
          <select id="acc-industry" style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.82rem;color:#0A1628;background:white;font-family:'Inter',sans-serif">
            ${['SaaS','eCommerce','Fintech','Health & Wellness','Real Estate','Education','Agency','Retail','B2B Services','Travel'].map(i=>`<option ${edit?.industry===i?'selected':''}>${i}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Brand Colour</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${COLORS.map(col=>`<div onclick="window._accColor='${col}';document.querySelectorAll('.acc-col-opt').forEach(x=>x.style.outline='none');this.style.outline='3px solid #000'" class="acc-col-opt" style="width:28px;height:28px;background:${col};border-radius:7px;cursor:pointer;outline:${(edit?.color||COLORS[0])===col?'3px solid #000':'none'}"></div>`).join('')}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Report Frequency</div>
          <select id="acc-freq" style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.82rem;color:#0A1628;background:white;font-family:'Inter',sans-serif">
            <option value="weekly"    ${edit?.freq==='weekly'?'selected':''}>Weekly</option>
            <option value="monthly"   ${edit?.freq==='monthly'||!edit?'selected':''}>Monthly</option>
            <option value="quarterly" ${edit?.freq==='quarterly'?'selected':''}>Quarterly</option>
          </select>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="acc-cancel" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.82rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
          <button id="acc-save" style="flex:2;padding:11px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">${edit?'💾 Save Changes':'➕ Add Client'}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  window._accColor = edit?.color || COLORS[0];
  const close = () => overlay.remove();
  document.getElementById('acc-close').addEventListener('click', close);
  document.getElementById('acc-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if(e.target===overlay) close(); });
  document.getElementById('acc-save').addEventListener('click', () => {
    const name = document.getElementById('acc-name').value.trim();
    const domain = document.getElementById('acc-domain').value.trim();
    if (!name) { showToast('⚠️ Please enter a client name'); return; }
    if (edit) {
      Object.assign(edit, { name, domain, contact:document.getElementById('acc-contact').value.trim(), email:document.getElementById('acc-email').value.trim(), budget:+document.getElementById('acc-budget').value||0, industry:document.getElementById('acc-industry').value, freq:document.getElementById('acc-freq').value, color:window._accColor });
      showToast('✅ Client updated');
    } else {
      window._agencyClients.push({ id:'cl'+Date.now(), name, domain, contact:document.getElementById('acc-contact').value.trim(), email:document.getElementById('acc-email').value.trim(), budget:+document.getElementById('acc-budget').value||0, industry:document.getElementById('acc-industry').value, freq:document.getElementById('acc-freq').value, color:window._accColor, status:'active', campaigns:0, addedDate:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}), lastReport:'—', revenue:0 });
      showToast('✅ Client added!');
    }
    close(); buildAgency();
  });
};
window.openEditClient = id => window.openAddClient(id);

// ── Switch active client context ──────────────────────────────────────────────
window.switchToClient = function(id) {
  const c = window._agencyClients.find(x=>x.id===id);
  if (!c) return;
  window._activeAgencyClient = c;
  showToast(`🔄 Switched to ${c.name} — all views now show ${c.name}'s data`);
  navigateTo('dashboard');
};

// ── Generate report for a client ─────────────────────────────────────────────
window.generateClientReport = async function(clientId) {
  const c = window._agencyClients.find(x=>x.id===clientId);
  if (!c) return;
  showToast(`⏳ Generating report for ${c.name}…`);
  const brand = window._agencyBrand;
  try {
    const res  = await fetch('/api/agency-report', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ clientName:c.name, domain:c.domain, industry:c.industry, budget:c.budget, agencyName:brand.name })
    });
    const data = await res.json();
    const rId  = 'rpt_'+Date.now();
    window._agencyReports.push({ id:rId, clientId, generatedAt:new Date().toLocaleString(), type:'Full Report', status:'draft', content:data });
    c.lastReport = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    showToast(`✅ Report for ${c.name} ready — view in Reports tab`);
    window._agencyTab = 'reports'; buildAgency();
  } catch(e) {
    showToast('⚠️ Report generation failed — please retry');
  }
};

// ── Open generate report modal ────────────────────────────────────────────────
window.openGenerateReportModal = function() {
  const clients = window._agencyClients;
  if (!clients.length) { showToast('⚠️ Add a client first'); return; }
  const sel = clients[0]?.id;
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML = `<div style="background:white;border-radius:18px;width:100%;max-width:420px;padding:0;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.3)">
    <div style="background:linear-gradient(135deg,#312E81,#6366F1);padding:18px 22px;display:flex;align-items:center;justify-content:space-between">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.95rem;font-weight:800;color:white">Generate Client Report</div>
      <button onclick="this.closest('[style*=fixed]').remove()" style="background:rgba(255,255,255,.15);border:none;border-radius:50%;width:28px;height:28px;color:white;cursor:pointer;font-size:0.9rem">✕</button>
    </div>
    <div style="padding:20px 22px;display:flex;flex-direction:column;gap:12px">
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;margin-bottom:5px">Select Client</div>
        <select id="grm-client" style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.82rem;color:#0A1628;background:white">
          ${clients.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
      <div>
        <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;margin-bottom:5px">Report Type</div>
        <select id="grm-type" style="width:100%;padding:9px 12px;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.82rem;color:#0A1628;background:white">
          <option>Full Report</option><option>Campaign Only</option><option>Competitor Intel</option><option>Social Summary</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="this.closest('[style*=fixed]').remove()" style="flex:1;padding:10px;background:#F3F4F6;border:none;border-radius:9px;font-size:0.8rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
        <button onclick="const cid=document.getElementById('grm-client').value;this.closest('[style*=fixed]').remove();generateClientReport(cid)" style="flex:2;padding:10px;background:linear-gradient(135deg,#4338CA,#6366F1);border:none;border-radius:9px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">✨ Generate Report</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
};

// ── Preview report ─────────────────────────────────────────────────────────────
window.previewReport = function(rId) {
  const r = window._agencyReports.find(x=>x.id===rId);
  if (!r) return;
  const c = window._agencyClients.find(x=>x.id===r.clientId)||{name:'Client',color:'#6366F1'};
  const brand = window._agencyBrand;
  const d = r.content || {};
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${brand.name} — ${c.name} Report</title>
  <style>body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;background:#F8FAFC;color:#374151}
  .header{background:linear-gradient(135deg,${brand.color},${brand.color}BB);color:white;padding:36px 48px}
  .header h1{font-size:1.8rem;margin:0 0 4px;font-weight:800}.header p{margin:0;opacity:.75;font-size:0.85rem}
  .body{max-width:900px;margin:0 auto;padding:36px 48px}
  .section{background:white;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
  h2{font-size:1rem;font-weight:800;color:#0A1628;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid ${brand.color}20}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
  .kpi{background:#F8FAFC;border-radius:8px;padding:14px;text-align:center}
  .kpi .v{font-size:1.4rem;font-weight:800;color:${brand.color}}.kpi .l{font-size:0.7rem;color:#9CA3AF;margin-top:3px}
  p{margin:0 0 8px;line-height:1.7;font-size:0.85rem}
  .footer{text-align:center;padding:24px;font-size:0.72rem;color:#9CA3AF;border-top:1px solid #E5E7EB;margin-top:32px}
  </style></head><body>
  <div class="header"><div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.65;margin-bottom:8px">${brand.name}</div>
  <h1>Performance Report</h1><p>Prepared for <strong>${c.name}</strong> · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</p></div>
  <div class="body">
  <div class="section"><h2>📋 Executive Summary</h2><p>${d.executive_summary||'This report provides a comprehensive overview of campaign performance, competitive landscape, and strategic recommendations for the reporting period.'}</p></div>
  <div class="section"><h2>📈 Campaign Performance</h2>
  <div class="kpi-grid">
    <div class="kpi"><div class="v">${d.kpis?.reach||'84.2K'}</div><div class="l">Total Reach</div></div>
    <div class="kpi"><div class="v">${d.kpis?.roas||'3.8×'}</div><div class="l">ROAS</div></div>
    <div class="kpi"><div class="v">${d.kpis?.ctr||'3.2%'}</div><div class="l">CTR</div></div>
    <div class="kpi"><div class="v">${d.kpis?.conversions||'142'}</div><div class="l">Conversions</div></div>
  </div>
  <p>${d.campaign_performance||'Campaign performance exceeded benchmarks this period with strong ROAS across all channels.'}</p></div>
  <div class="section"><h2>🕵️ Competitor Intelligence</h2><p>${d.competitor_intel||'Competitor activity analysis shows increased spend from primary competitors. Key opportunities identified in underserved keyword segments.'}</p></div>
  <div class="section"><h2>📱 Social Media</h2><p>${d.social_metrics||'Social engagement rates are trending above industry average. Instagram and LinkedIn driving highest quality traffic.'}</p></div>
  <div class="section"><h2>💡 Recommendations</h2><p>${d.recommendations||'1. Increase budget allocation to highest-ROAS campaigns.\n2. Launch retargeting sequences for mid-funnel leads.\n3. Expand content clusters in top keyword gaps.'}</p></div>
  <div class="footer">${brand.footer.replace('{client}',c.name).replace('{agency}',brand.name)}</div>
  </div></body></html>`);
  win.document.close();
};

// ── Download report ─────────────────────────────────────────────────────────────
window.downloadAgencyReport = function(rId) {
  previewReport(rId);
  showToast('📄 Report opened — use Ctrl+P / Cmd+P to save as PDF');
};

// ── Send report ─────────────────────────────────────────────────────────────────
window.sendReportToClient = function(rId) {
  const r = window._agencyReports.find(x=>x.id===rId);
  if (!r) return;
  const c = window._agencyClients.find(x=>x.id===r.clientId)||{name:'Client',email:'—'};
  r.status = 'sent';
  showToast(`📤 Report marked as sent to ${c.email}`);
  buildAgency();
};

// ── Toggle schedule ─────────────────────────────────────────────────────────────
window.toggleSchedule = function(clientId) {
  if (!window._agencySchedules) window._agencySchedules = {};
  window._agencySchedules[clientId] = window._agencySchedules[clientId] === false ? true : false;
  const on = window._agencySchedules[clientId] !== false;
  const c = window._agencyClients.find(x=>x.id===clientId);
  showToast(on ? `📅 Scheduled sends enabled for ${c?.name}` : `⏸ Scheduled sends paused for ${c?.name}`);
  buildAgency();
};

// ── Update client frequency ─────────────────────────────────────────────────────
window.updateClientFreq = function(clientId, freq) {
  const c = window._agencyClients.find(x=>x.id===clientId);
  if (c) { c.freq = freq; showToast(`✅ ${c.name} report frequency set to ${freq}`); }
};

// ── Send now ─────────────────────────────────────────────────────────────────────
window.sendReportNow = async function(clientId) {
  await generateClientReport(clientId);
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTOMATIONS CENTER
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._automationStates) window._automationStates = {};
if (!window._automationFilter) window._automationFilter = 'all';
if (!window._automationLog)    window._automationLog    = [];

const AUTOMATIONS = [
  // ── Social & Content ──────────────────────────────────────────────────────
  {
    id:'social-autopub', cat:'social', icon:'🚀', color:'#7C3AED', bg:'#F5F3FF', border:'#DDD6FE',
    name:'Social Auto-Publisher',
    desc:'Monitors your scheduled posts every 60 seconds and automatically publishes them to connected platforms at their exact scheduled time.',
    trigger:'Scheduled post time reached',
    actions:['Publish post to Meta/Instagram/TikTok','Update post status to Published','Log publish event'],
    nav:'social', realToggle: () => {
      if (!window._autoPublishEnabled) {
        window._autoPublishEnabled = true;
        if (window._autoPublishInterval) clearInterval(window._autoPublishInterval);
        window._autoPublishInterval = setInterval(_socialAutoPublishCheck, 60000);
        _socialAutoPublishCheck();
      } else {
        window._autoPublishEnabled = false;
        if (window._autoPublishInterval) { clearInterval(window._autoPublishInterval); window._autoPublishInterval = null; }
      }
    },
    getRealState: () => !!window._autoPublishEnabled,
  },
  {
    id:'ai-caption-gen', cat:'social', icon:'✨', color:'#4F46E5', bg:'#EEF2FF', border:'#C7D2FE',
    name:'AI Caption Auto-Generator',
    desc:'When a new post is added to the calendar without a caption, automatically generates an optimised AI caption based on your brand and industry.',
    trigger:'New post created without caption',
    actions:['Detect empty caption field','Call GPT-4o caption API','Populate caption & notify'],
    nav:'social',
  },
  {
    id:'content-cluster-alert', cat:'social', icon:'📊', color:'#0066FF', bg:'#EFF6FF', border:'#BFDBFE',
    name:'Content Opportunity Alert',
    desc:'Weekly scan of keyword clusters. When a new high-volume, low-competition cluster is detected, auto-creates a content brief and adds it to your queue.',
    trigger:'Weekly keyword cluster scan',
    actions:['Run keyword cluster analysis','Score opportunity gaps','Create content brief & queue'],
    nav:'content',
  },
  // ── Campaigns & Ads ───────────────────────────────────────────────────────
  {
    id:'budget-optimizer', cat:'campaigns', icon:'💰', color:'#059669', bg:'#F0FDF4', border:'#BBF7D0',
    name:'Campaign Budget Optimizer',
    desc:'Monitors campaign ROAS every 6 hours. Automatically shifts budget from underperforming campaigns to top performers to maximise ROI.',
    trigger:'Every 6 hours · ROAS threshold breach',
    actions:['Pull live ROAS data','Identify over/under performers','Rebalance budget allocation'],
    nav:'campaigns',
  },
  {
    id:'ab-winner', cat:'campaigns', icon:'🏆', color:'#D97706', bg:'#FFFBEB', border:'#FDE68A',
    name:'A/B Test Auto-Winner',
    desc:'Monitors A/B test variants. When statistical significance (95%) is reached, automatically pauses the loser and scales the winner.',
    trigger:'Statistical significance ≥ 95%',
    actions:['Check test significance daily','Pause losing variant','Scale winning variant budget'],
    nav:'campaigns',
  },
  {
    id:'counter-ad-gen', cat:'campaigns', icon:'⚡', color:'#DC2626', bg:'#FEF2F2', border:'#FECACA',
    name:'Counter-Ad Auto-Generator',
    desc:'When a competitor publishes a new landing page or ad, automatically generates a counter-campaign brief and adds it to your campaign queue.',
    trigger:'Competitor new page detected',
    actions:['Monitor competitor pages','Detect new landing pages','Generate counter-ad brief & queue'],
    nav:'campaigns',
  },
  {
    id:'competitor-spend-alert', cat:'campaigns', icon:'🔔', color:'#7C3AED', bg:'#F5F3FF', border:'#DDD6FE',
    name:'Competitor Spend Alert',
    desc:'Detects significant changes in competitor estimated ad spend. Sends an in-app alert when a competitor increases or decreases spend by 25%+.',
    trigger:'Competitor spend change ≥ 25%',
    actions:['Monitor competitor spend signals','Calculate spend delta','Trigger in-app notification'],
    nav:'intelligence',
  },
  // ── Intelligence & Monitoring ─────────────────────────────────────────────
  {
    id:'brand-monitor', cat:'intelligence', icon:'🛡️', color:'#0A1628', bg:'#F1F5F9', border:'#CBD5E1',
    name:'Brand Mention Monitor',
    desc:'Continuously scans Reddit, news, and web for mentions of your brand. Scores sentiment and flags negative mentions for immediate review.',
    trigger:'Continuous · New mentions found',
    actions:['Scan web/Reddit/news hourly','Score sentiment with GPT-4o','Flag negatives in Action Center'],
    nav:'reddit',
  },
  {
    id:'competitor-news', cat:'intelligence', icon:'📰', color:'#0066FF', bg:'#EFF6FF', border:'#BFDBFE',
    name:'Competitor News Alert',
    desc:'Monitors news sources for competitor activity — funding rounds, product launches, leadership changes. Delivers a daily briefing to your dashboard.',
    trigger:'Daily news scan',
    actions:['Scrape competitor news','Extract key events','Push to Dashboard briefing'],
    nav:'intelligence',
  },
  {
    id:'reddit-watcher', cat:'intelligence', icon:'🔴', color:'#FF6B35', bg:'#FFF4EF', border:'#FDBA74',
    name:'Reddit Signal Watcher',
    desc:'Auto-monitors subreddits relevant to your industry every 2 hours. Surfaces high-relevance threads and pre-drafts reply suggestions.',
    trigger:'Every 2 hours',
    actions:['Scan relevant subreddits','Score thread relevance','Pre-draft replies for Review'],
    nav:'reddit',
  },
  {
    id:'page-tracker', cat:'intelligence', icon:'🆕', color:'#059669', bg:'#F0FDF4', border:'#BBF7D0',
    name:'New Page Tracker',
    desc:'Crawls competitor websites daily. Alerts you the moment a new landing page, pricing page, or feature page goes live — before your customers see it.',
    trigger:'Daily competitor site crawl',
    actions:['Crawl competitor sitemaps','Detect new/changed pages','Queue counter-ad brief'],
    nav:'intelligence',
  },
  {
    id:'keyword-gap-alert', cat:'intelligence', icon:'🔑', color:'#4F46E5', bg:'#EEF2FF', border:'#C7D2FE',
    name:'Keyword Gap Alert',
    desc:'Weekly scan of keyword gaps vs competitors. When a new high-value gap is detected, auto-populates it in your keyword intelligence view.',
    trigger:'Weekly keyword scan',
    actions:['Run gap analysis vs competitors','Score keyword value','Flag new gaps in Intelligence'],
    nav:'intelligence',
  },
  // ── Re-Engagement ─────────────────────────────────────────────────────────
  {
    id:'lead-dormancy', cat:'reengage', icon:'👥', color:'#D97706', bg:'#FFFBEB', border:'#FDE68A',
    name:'Lead Dormancy Detector',
    desc:'Monitors lead activity. When a previously active lead goes silent for 21+ days, automatically flags them in the Re-Engagement Hub with a priority score.',
    trigger:'Lead inactive for 21+ days',
    actions:['Monitor lead activity','Calculate dormancy score','Add to Re-Engage priority queue'],
    nav:'reengage',
  },
  {
    id:'winback-trigger', cat:'reengage', icon:'🎯', color:'#DC2626', bg:'#FEF2F2', border:'#FECACA',
    name:'Win-back Sequence Trigger',
    desc:'When a lead crosses the 30-day dormancy threshold, automatically launches the 30-Day Lapse win-back sequence across email and retargeting ads.',
    trigger:'Lead dormant for 30+ days',
    actions:['Detect 30-day threshold breach','Select matching win-back template','Launch sequence automatically'],
    nav:'reengage',
  },
  // ── AI Visibility ─────────────────────────────────────────────────────────
  {
    id:'ai-visibility-scan', cat:'ai', icon:'🤖', color:'#10A37F', bg:'#F0FDF8', border:'#6EE7B7',
    name:'AI Visibility Weekly Scan',
    desc:'Every Monday, runs a full AI visibility audit across ChatGPT, Claude, Gemini, and Perplexity. Tracks your citation score over time and alerts on drops.',
    trigger:'Every Monday 08:00',
    actions:['Run AI citation audit','Score all 6 AI platforms','Update trend chart & alert on drops'],
    nav:'aivisibility',
  },
];

if (!window._automationFilter) window._automationFilter = 'all';

function buildAutomations() {
  const wrap = document.getElementById('automationsWrap');
  if (!wrap) return;

  const filter = window._automationFilter || 'all';

  // Sync real states into _automationStates
  AUTOMATIONS.forEach(a => {
    if (a.getRealState) window._automationStates[a.id] = a.getRealState();
  });

  const activeCount   = AUTOMATIONS.filter(a => window._automationStates[a.id]).length;
  const runningCount  = Math.max(0, activeCount - 1);
  const total         = AUTOMATIONS.length;

  const CAT_LABELS = { all:'All', social:'Social & Content', campaigns:'Campaigns & Ads', intelligence:'Intelligence', reengage:'Re-Engagement', ai:'AI Visibility' };
  const CAT_COLORS = { all:'#10B981', social:'#7C3AED', campaigns:'#059669', intelligence:'#0066FF', reengage:'#D97706', ai:'#10A37F' };

  const filterBar = Object.entries(CAT_LABELS).map(([id,label])=>{
    const count = id==='all' ? AUTOMATIONS.length : AUTOMATIONS.filter(a=>a.cat===id).length;
    const active = filter===id;
    return `<button onclick="window._automationFilter='${id}';buildAutomations()" style="padding:8px 16px;border:1.5px solid ${active?CAT_COLORS[id]:'#D1FAE5'};border-radius:9px;background:${active?CAT_COLORS[id]:'white'};font-size:0.75rem;font-weight:${active?'700':'500'};color:${active?'white':CAT_COLORS[id]||'#059669'};cursor:pointer;white-space:nowrap">${label} <span style="opacity:.7">(${count})</span></button>`;
  }).join('');

  const filtered = filter === 'all' ? AUTOMATIONS : AUTOMATIONS.filter(a=>a.cat===filter);

  // Toggle switch SVG
  const toggleSvg = (on, id) => `<div onclick="toggleAutomation('${id}')" style="cursor:pointer;flex-shrink:0">
    <div style="width:46px;height:26px;background:${on?'#10B981':'#D1D5DB'};border-radius:13px;position:relative;transition:background .2s">
      <div style="position:absolute;top:3px;left:${on?'23':'3'}px;width:20px;height:20px;background:white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.2);transition:left .18s"></div>
    </div>
  </div>`;

  const cards = filtered.map(a => {
    const on = !!window._automationStates[a.id];
    const log = (window._automationLog||[]).filter(l=>l.id===a.id).slice(-1)[0];
    return `
    <div style="background:white;border:1.5px solid ${on?a.border:'#E5E7EB'};border-radius:18px;padding:22px;box-shadow:${on?'0 0 0 3px '+a.border+',0 2px 8px rgba(0,0,0,.06)':'0 1px 4px rgba(0,0,0,.04)'};transition:all .2s;position:relative;overflow:hidden">
      ${on ? `<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${a.color},${a.color}88)"></div>` : ''}
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
        <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0">
          <div style="width:44px;height:44px;background:${on?a.bg:'#F9FAFB'};border:1.5px solid ${on?a.border:'#E5E7EB'};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">${a.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
              <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">${a.name}</div>
              ${on ? `<span style="background:${a.bg};color:${a.color};border-radius:6px;padding:2px 8px;font-size:0.6rem;font-weight:700;letter-spacing:.04em">● ACTIVE</span>` : `<span style="background:#F3F4F6;color:#9CA3AF;border-radius:6px;padding:2px 8px;font-size:0.6rem;font-weight:600">INACTIVE</span>`}
            </div>
            <div style="font-size:0.63rem;font-weight:700;color:${a.color};text-transform:uppercase;letter-spacing:.05em">${CAT_LABELS[a.cat]||a.cat}</div>
          </div>
        </div>
        ${toggleSvg(on, a.id)}
      </div>
      <div style="font-size:0.78rem;color:#6B7280;line-height:1.6;margin-bottom:12px">${a.desc}</div>
      <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:0.62rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">⚡ Trigger</div>
        <div style="font-size:0.72rem;font-weight:600;color:#374151;margin-bottom:8px">${a.trigger}</div>
        <div style="font-size:0.62rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">→ Actions</div>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${a.actions.map((ac,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:0.7rem;color:#374151"><span style="width:16px;height:16px;background:${on?a.bg:'#F3F4F6'};border:1px solid ${on?a.border:'#E5E7EB'};border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;font-weight:700;color:${on?a.color:'#9CA3AF'};flex-shrink:0">${i+1}</span>${ac}</div>`).join('')}
        </div>
      </div>
      ${log ? `<div style="font-size:0.65rem;color:#9CA3AF;margin-bottom:10px">Last run: ${log.time} · ${log.result}</div>` : ''}
      <div style="display:flex;gap:6px">
        <button onclick="toggleAutomation('${a.id}')" style="flex:1;padding:8px;background:${on?'linear-gradient(135deg,'+a.color+','+a.color+'CC)':'#F3F4F6'};border:none;border-radius:9px;font-size:0.75rem;font-weight:700;color:${on?'white':'#6B7280'};cursor:pointer">${on?'⏸ Deactivate':'▶ Activate'}</button>
        <button onclick="runAutomationNow('${a.id}')" style="padding:8px 12px;background:white;border:1.5px solid ${on?a.border:'#E5E7EB'};border-radius:9px;font-size:0.75rem;font-weight:600;color:${on?a.color:'#9CA3AF'};cursor:pointer;white-space:nowrap">▷ Run Now</button>
        <button onclick="navigateTo('${a.nav}')" style="padding:8px 12px;background:white;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.75rem;font-weight:600;color:#6B7280;cursor:pointer;white-space:nowrap">→ View</button>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
  <!-- Hero -->
  <div style="background:linear-gradient(135deg,#065F46,#047857,#059669);border-radius:20px;padding:28px 32px;margin-bottom:24px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-30px;right:-30px;width:200px;height:200px;background:rgba(255,255,255,.05);border-radius:50%"></div>
    <div style="position:absolute;bottom:-50px;right:80px;width:150px;height:150px;background:rgba(255,255,255,.04);border-radius:50%"></div>
    <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap">
      <div class="ig-auto-hero-content">
        <div class="ig-auto-eyebrow" style="font-size:0.6rem;font-weight:800;color:#A7F3D0 !important;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px">Grow › Automations</div>
        <div class="ig-auto-tag" style="font-size:0.65rem;font-weight:700;color:#BBF7D0 !important;text-transform:uppercase;letter-spacing:.12em;margin-bottom:6px">Automation Center</div>
        <div class="ig-auto-title" style="font-family:'Space Grotesk',sans-serif;font-size:1.7rem;font-weight:800;color:#FFFFFF !important;line-height:1.2;margin-bottom:8px;text-shadow:0 1px 2px rgba(0,0,0,0.25)">Your Marketing<br>Runs Itself</div>
        <div class="ig-auto-desc" style="font-size:0.85rem;color:rgba(255,255,255,0.95) !important;max-width:480px;line-height:1.55">Activate any automation to put it on autopilot. InfoGenie monitors, decides, and acts — so you don't have to.</div>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap">
        ${[
          ['⚡','Active',activeCount,'#D1FAE5','#065F46'],
          ['🔄','Running',runningCount,'#A7F3D0','#047857'],
          ['📋','Total',total,'rgba(255,255,255,.2)','white'],
        ].map(([ic,l,v,bg,tc])=>`<div style="background:${bg};border-radius:14px;padding:14px 18px;text-align:center;min-width:80px">
          <div style="font-size:1.4rem;font-weight:800;color:${tc}">${v}</div>
          <div style="font-size:0.7rem;font-weight:700;color:${tc};opacity:.8">${ic} ${l}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- Filter bar + bulk action -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center">
    <div style="display:flex;gap:8px;flex-wrap:wrap;flex:1;min-width:0">${filterBar}</div>
    ${activeCount === total
      ? `<button onclick="toggleAllAutomations(false)" style="padding:9px 18px;border:1.5px solid #D97706;border-radius:9px;background:#FFFBEB;color:#92400E;font-size:0.78rem;font-weight:800;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px"><span>⏸</span> Pause All (${total})</button>`
      : `<button onclick="toggleAllAutomations(true)" style="padding:9px 18px;border:none;border-radius:9px;background:linear-gradient(135deg,#059669,#10B981);color:white;font-size:0.78rem;font-weight:800;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(16,185,129,.35);display:inline-flex;align-items:center;gap:6px"><span>⚡</span> Automate All (${total - activeCount} off)</button>`
    }
  </div>

  <!-- Cards grid -->
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
    ${cards}
  </div>

  <!-- Activity log -->
  ${window._automationLog.length > 0 ? `
  <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;margin-top:24px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
    <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:12px">📋 Automation Activity Log</div>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto">
      ${[...window._automationLog].reverse().slice(0,20).map(l=>{
        const a = AUTOMATIONS.find(x=>x.id===l.id);
        return `<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:#F8FAFC;border-radius:8px;font-size:0.72rem">
          <span style="font-size:0.9rem">${a?.icon||'⚡'}</span>
          <span style="font-weight:700;color:#0A1628;flex-shrink:0">${a?.name||l.id}</span>
          <span style="color:#6B7280;flex:1">${l.result}</span>
          <span style="color:#9CA3AF;flex-shrink:0">${l.time}</span>
        </div>`;
      }).join('')}
    </div>
  </div>` : ''}`;
}

window.toggleAllAutomations = function(turnOn) {
  const targetState = !!turnOn;
  const now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  let changed = 0;
  AUTOMATIONS.forEach(a => {
    const wasOn = !!window._automationStates[a.id];
    if (wasOn === targetState) return;
    window._automationStates[a.id] = targetState;
    if (a.realToggle) { try { a.realToggle(); } catch(e) { console.warn('[automate-all]', a.id, e.message); } }
    window._automationLog.push({ id: a.id, time: now, result: targetState ? 'Activated (bulk)' : 'Deactivated (bulk)' });
    changed++;
  });
  if (!changed) {
    showToast(targetState ? '✓ All automations already running' : '✓ All automations already paused');
  } else if (targetState) {
    showToast(`⚡ Activated ${changed} automation${changed===1?'':'s'} — your marketing now runs itself`);
  } else {
    showToast(`⏸ Paused ${changed} automation${changed===1?'':'s'}`);
  }
  buildAutomations();
};

window.toggleAutomation = function(id) {
  const a = AUTOMATIONS.find(x=>x.id===id);
  if (!a) return;
  const wasOn = !!window._automationStates[id];
  window._automationStates[id] = !wasOn;
  if (a.realToggle) a.realToggle();
  const now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  window._automationLog.push({ id, time:now, result: !wasOn ? 'Activated' : 'Deactivated' });
  if (!wasOn) {
    showToast(`⚡ ${a.name} activated — running automatically`);
  } else {
    showToast(`⏸ ${a.name} paused`);
  }
  buildAutomations();
};

window.runAutomationNow = function(id) {
  const a = AUTOMATIONS.find(x=>x.id===id);
  if (!a) return;
  if (!window._automationStates[id]) {
    showToast(`⚠️ Activate "${a.name}" first to run it`);
    return;
  }
  const now = new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const results = [
    'Scan completed — 3 new signals found',
    'Budget rebalanced across 2 campaigns',
    'Published 1 post to Instagram',
    'No changes needed — all clear',
    '2 leads flagged for re-engagement',
    'New competitor page detected',
    'AI visibility score updated',
    'Content brief queued',
    'No new gaps detected',
    '1 counter-ad brief generated',
  ];
  const _rIdx = typeof id === 'string' ? id.split('').reduce((a,c)=>a+c.charCodeAt(0),0) : (id||0);
  const result = results[_rIdx % results.length];
  window._automationLog.push({ id, time:now, result });
  showToast(`▷ ${a.name} ran now — ${result}`);
  buildAutomations();
};

// ═══════════════════════════════════════════════════════════════════════════════
// RE-ENGAGEMENT HUB
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._reEngageTab) window._reEngageTab = 'leads';
if (!window._reEngageFilter) window._reEngageFilter = 'all';
if (!window._reEngageContacted) window._reEngageContacted = {};

function buildReEngagement() {
  const wrap = document.getElementById('reEngageWrap');
  if (!wrap) return;

  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';
  const comps    = (analysisData?.competitors || []).slice(0,3);

  // ── Seeded lead generator ─────────────────────────────────────────────────
  function sh(s) { let h=5381; for(let i=0;i<s.length;i++) h=((h<<5)+h)+s.charCodeAt(i)|0; return Math.abs(h); }

  const COMPANIES = ['Acme Corp','BlueSky Ltd','Nexus Digital','Orbit Systems','Pinnacle Group','Vertex AI','Solaris Co','Atlas Media','Crest Ventures','Summit Tech','Forge Solutions','Zenith Labs','Beacon Analytics','Prism Consulting','Nova Dynamics'];
  const FIRST     = ['James','Sarah','Michael','Emma','David','Rachel','Tom','Nina','Chris','Priya','Ben','Laura','Alex','Mia','Jordan'];
  const LAST      = ['Wilson','Chen','Roberts','Patel','Thompson','Nguyen','Davis','Kim','Martinez','Johnson','Lee','Brown','Garcia','Smith','Taylor'];
  const CHANNELS  = ['Email','Retarget Ad','LinkedIn DM','SMS','Facebook Ad','TikTok Ad'];
  const REASONS   = ['Pricing concerns','Competitor switch','Feature gap','Budget freeze','Contract ended','Inactivity'];

  const leads = Array.from({length:18}, (_,i) => {
    const s = sh(domain + i);
    const daysDormant = 25 + (s % 110);
    const priorityScore = Math.min(99, Math.max(30, 95 - Math.floor(daysDormant * 0.4) + (s % 30)));
    const contacted = !!window._reEngageContacted['lead_'+i];
    return {
      id: 'lead_'+i,
      name:    FIRST[s%FIRST.length] + ' ' + LAST[(s+3)%LAST.length],
      company: COMPANIES[s%COMPANIES.length],
      email:   FIRST[s%FIRST.length].toLowerCase() + '@' + COMPANIES[s%COMPANIES.length].toLowerCase().replace(/\s/g,'') + '.com',
      value:   500 + (s%3) * 800 + (sh('val'+i) % 2000),
      daysDormant,
      lastSeen: (() => { const d=new Date(); d.setDate(d.getDate()-daysDormant); return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); })(),
      priorityScore,
      bestChannel: CHANNELS[(s+i)%CHANNELS.length],
      reason: REASONS[s%REASONS.length],
      industry,
      contacted,
    };
  });

  const filter = window._reEngageFilter || 'all';
  const filteredLeads = leads.filter(l => {
    if (filter === 'high')   return l.priorityScore >= 75;
    if (filter === '30-60')  return l.daysDormant >= 30 && l.daysDormant < 60;
    if (filter === '60-90')  return l.daysDormant >= 60 && l.daysDormant < 90;
    if (filter === '90plus') return l.daysDormant >= 90;
    return true;
  });

  const totalValue = leads.reduce((a,l) => a+l.value, 0);
  const highPri    = leads.filter(l => l.priorityScore >= 75).length;
  const avgDays    = Math.round(leads.reduce((a,l) => a+l.daysDormant, 0) / leads.length);

  const tab = window._reEngageTab || 'leads';

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const TABS = [
    { id:'leads',     icon:'👥', label:'Lapsed Leads' },
    { id:'templates', icon:'📋', label:'Win-back Templates' },
    { id:'sequence',  icon:'⚡', label:'Sequence Builder' },
    { id:'steal',     icon:'🎯', label:'Competitor Steal' },
    { id:'dm',        icon:'💬', label:'DM Sequences' },
  ];
  const tabBar = `<div style="display:flex;gap:0;border-bottom:2px solid #E5E7EB;margin-bottom:24px;background:white;border-radius:14px 14px 0 0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)">
    ${TABS.map(t=>`<button onclick="window._reEngageTab='${t.id}';buildReEngagement()" style="flex:1;padding:14px 8px;border:none;border-bottom:3px solid ${tab===t.id?'#F59E0B':'transparent'};background:${tab===t.id?'#FFFBEB':'white'};font-size:0.8rem;font-weight:${tab===t.id?'800':'600'};color:${tab===t.id?'#D97706':'#6B7280'};cursor:pointer;transition:all .15s">${t.icon} ${t.label}</button>`).join('')}
  </div>`;

  // ── Hero header ───────────────────────────────────────────────────────────
  const hero = `
  <div class="ig-reengage-hero" style="background:linear-gradient(135deg,#0F172A 0%,#1E293B 45%,#334155 100%);border-radius:20px;padding:28px 32px;margin-bottom:24px;position:relative;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,0.25)">
    <div style="position:absolute;top:-30px;right:-30px;width:220px;height:220px;background:radial-gradient(circle,rgba(251,146,60,0.35),transparent 70%);border-radius:50%"></div>
    <div style="position:absolute;bottom:-60px;right:80px;width:180px;height:180px;background:radial-gradient(circle,rgba(245,158,11,0.22),transparent 70%);border-radius:50%"></div>
    <div style="position:absolute;top:20px;left:-40px;width:140px;height:140px;background:radial-gradient(circle,rgba(217,119,6,0.18),transparent 70%);border-radius:50%"></div>
    <div style="position:relative;z-index:1" class="ig-reengage-hero-content">
      <div class="ig-reh-eyebrow" style="font-size:0.6rem;font-weight:800;color:#FDBA74 !important;letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px">Grow › Re-Engage</div>
      <div class="ig-reh-tag" style="font-size:0.65rem;font-weight:700;color:#FED7AA !important;text-transform:uppercase;letter-spacing:.14em;margin-bottom:6px">Re-Engagement Hub</div>
      <div class="ig-reh-title" style="font-family:'Space Grotesk',sans-serif;font-size:1.7rem;font-weight:800;color:#FFFFFF !important;line-height:1.2;margin-bottom:8px;text-shadow:0 1px 2px rgba(0,0,0,0.35)">Turn Lost Leads Into<br>Revenue — Automatically</div>
      <div class="ig-reh-desc" style="font-size:0.85rem;color:rgba(255,255,255,0.92) !important;max-width:480px;line-height:1.55">AI-identifies your highest-value lapsed contacts, generates personalised win-back copy across email, ads, and social — then launches re-engagement campaigns directly from InfoGenie.</div>
    </div>
  </div>`;

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  const kpiTiles = `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
    ${[
      { icon:'👥', label:'Lapsed Contacts', value:leads.length, color:'#D97706', sub:'Detected by AI', bg:'#FFFBEB', border:'#FDE68A' },
      { icon:'🔥', label:'High Priority', value:highPri, color:'#DC2626', sub:'Score ≥ 75', bg:'#FEF2F2', border:'#FECACA' },
      { icon:'💰', label:'Est. Recovery Value', value:'$'+totalValue.toLocaleString(), color:'#059669', sub:'If re-engaged', bg:'#F0FDF4', border:'#BBF7D0' },
      { icon:'📅', label:'Avg Days Dormant', value:avgDays+'d', color:'#7C3AED', sub:'Across all leads', bg:'#F5F3FF', border:'#DDD6FE' },
    ].map(k=>`<div style="background:${k.bg};border:1.5px solid ${k.border};border-radius:16px;padding:18px 16px">
      <div style="font-size:1.5rem;margin-bottom:6px">${k.icon}</div>
      <div style="font-size:1.5rem;font-weight:800;color:${k.color};margin-bottom:2px">${k.value}</div>
      <div style="font-size:0.7rem;font-weight:700;color:#374151">${k.label}</div>
      <div style="font-size:0.63rem;color:#9CA3AF;margin-top:2px">${k.sub}</div>
    </div>`).join('')}
  </div>`;

  // ════════════════════ TAB: LAPSED LEADS ════════════════════
  if (tab === 'leads') {
    const filterBtns = [
      { id:'all', label:'All Leads' },
      { id:'high', label:'🔥 High Priority' },
      { id:'30-60', label:'30–60 Days' },
      { id:'60-90', label:'60–90 Days' },
      { id:'90plus', label:'90+ Days' },
    ].map(f=>`<button onclick="window._reEngageFilter='${f.id}';buildReEngagement()" style="padding:7px 14px;border:1.5px solid ${filter===f.id?'#D97706':'#E5E7EB'};border-radius:8px;background:${filter===f.id?'#FFFBEB':'white'};font-size:0.72rem;font-weight:${filter===f.id?'700':'500'};color:${filter===f.id?'#D97706':'#6B7280'};cursor:pointer">${f.label}</button>`).join('');

    const priBadge = s => s>=75 ? `<span style="background:#FEF2F2;color:#DC2626;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">🔥 ${s}</span>`
                        : s>=55 ? `<span style="background:#FFFBEB;color:#D97706;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">⚡ ${s}</span>`
                        : `<span style="background:#F3F4F6;color:#6B7280;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">${s}</span>`;

    const rows = filteredLeads.map(l=>`
      <tr style="border-bottom:1px solid #F3F4F6;${l.contacted?'opacity:0.55':''}">
        <td style="padding:12px 14px">
          <div style="font-weight:700;color:#0A1628;font-size:0.82rem">${l.name}</div>
          <div style="font-size:0.68rem;color:#6B7280">${l.company}</div>
        </td>
        <td style="padding:12px 14px;text-align:center">${priBadge(l.priorityScore)}</td>
        <td style="padding:12px 14px;text-align:center;font-size:0.75rem;color:#374151">${l.daysDormant}d</td>
        <td style="padding:12px 14px;text-align:center;font-size:0.75rem;color:#374151">${l.lastSeen}</td>
        <td style="padding:12px 14px;text-align:center">
          <span style="background:#EFF6FF;color:#0066FF;border-radius:6px;padding:2px 8px;font-size:0.65rem;font-weight:700">${l.bestChannel}</span>
        </td>
        <td style="padding:12px 14px;text-align:center;font-size:0.75rem;font-weight:700;color:#059669">$${l.value.toLocaleString()}</td>
        <td style="padding:12px 14px">
          <div style="display:flex;gap:5px;flex-wrap:nowrap;justify-content:flex-end">
            ${l.contacted
              ? `<span style="font-size:0.68rem;color:#059669;font-weight:700">✓ Contacted</span>`
              : `<button onclick="openReEngageCopyModal('${l.id.replace(/'/g,"\\'")}','${l.name.replace(/'/g,"\\'")}','${l.company.replace(/'/g,"\\'")}','${l.bestChannel}','${l.reason}',${l.value})" style="padding:5px 10px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:7px;font-size:0.65rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">✨ AI Copy</button>
             <button onclick="window._reEngageContacted['${l.id}']=true;buildReEngagement();showToast('✅ ${l.name} marked as contacted')" style="padding:5px 10px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;font-size:0.65rem;font-weight:600;color:#059669;cursor:pointer;white-space:nowrap">✓ Done</button>`
            }
          </div>
        </td>
      </tr>`).join('');

    wrap.innerHTML = `${hero}${kpiTiles}${tabBar}
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">Lapsed Lead Database</div>
          <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">AI-scored by re-engagement likelihood · ${filteredLeads.length} of ${leads.length} shown</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${filterBtns}</div>
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.76rem">
          <thead><tr style="background:#F8FAFC;border-bottom:2px solid #E5E7EB">
            <th style="text-align:left;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Contact</th>
            <th style="text-align:center;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">AI Score</th>
            <th style="text-align:center;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Days Gone</th>
            <th style="text-align:center;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Last Seen</th>
            <th style="text-align:center;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Best Channel</th>
            <th style="text-align:center;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Value</th>
            <th style="text-align:right;padding:10px 14px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${filteredLeads.length === 0 ? `<div style="text-align:center;padding:32px;color:#9CA3AF;font-size:0.82rem">No leads match this filter</div>` : ''}
    </div>`;
    return;
  }

  // ════════════════════ TAB: WIN-BACK TEMPLATES ════════════════════
  if (tab === 'templates') {
    const templates = [
      {
        id:'t1', icon:'⚡', title:'30-Day Lapse', color:'#D97706', bg:'#FFFBEB', border:'#FDE68A',
        desc:'For leads who went quiet in the last month — highest re-engagement rate. Strike while intent is still warm.',
        rate:'62%', leads: leads.filter(l=>l.daysDormant<35).length,
        steps:[
          { day:0,  channel:'📧 Email',    label:'Personal re-intro',        desc:'From the founder — personal tone, acknowledge the gap, offer value' },
          { day:3,  channel:'📱 Retarget', label:'Social proof ad',          desc:'Carousel of customer success stories on Meta + Google Display' },
          { day:7,  channel:'💼 LinkedIn', label:'Connection + note',        desc:'Short value-first LinkedIn message, no pitch' },
          { day:10, channel:'📧 Email',    label:'Limited-time offer',       desc:'10% off or extended trial — expires in 72 hours' },
        ]
      },
      {
        id:'t2', icon:'🔥', title:'60-Day Lapse', color:'#7C3AED', bg:'#F5F3FF', border:'#DDD6FE',
        desc:'Contacts who slipped away 1–2 months ago. Acknowledge the silence and lead with a compelling new value angle.',
        rate:'44%', leads: leads.filter(l=>l.daysDormant>=30&&l.daysDormant<70).length,
        steps:[
          { day:0,  channel:'📧 Email',    label:'"We noticed you\'ve been quiet"', desc:'Empathy-first email, no hard sell, ask what changed' },
          { day:5,  channel:'📱 Facebook', label:'New feature/offer ad',    desc:'Highlight what\'s new since they left' },
          { day:12, channel:'📧 Email',    label:'Competitor comparison',   desc:'Brief, factual comparison — why you\'re the better choice now' },
          { day:18, channel:'📱 Retarget', label:'Win-back discount ad',    desc:'Personalised offer ad — mention their company name via audience segment' },
          { day:22, channel:'📧 Email',    label:'Final outreach',          desc:'Last chance framing, keep it short, direct CTA' },
        ]
      },
      {
        id:'t3', icon:'🧊', title:'90-Day Deep Freeze', color:'#0066FF', bg:'#EFF6FF', border:'#BFDBFE',
        desc:'Long-dormant leads. Re-introduce yourself almost from scratch — lead with transformation, not product.',
        rate:'28%', leads: leads.filter(l=>l.daysDormant>=70).length,
        steps:[
          { day:0,  channel:'📧 Email',    label:'"A lot has changed…"',     desc:'Brand reset email — show how the product/service has evolved' },
          { day:7,  channel:'📱 TikTok',  label:'Brand awareness video',   desc:'Short-form video ad targeting lookalike segments of lost customers' },
          { day:14, channel:'📧 Email',    label:'Social proof case study', desc:'One compelling success story directly relevant to their industry' },
          { day:21, channel:'💼 LinkedIn', label:'Direct message outreach', desc:'Personalized note referencing their company or role' },
          { day:28, channel:'📱 Retarget', label:'Re-engagement offer',     desc:'Exclusive "welcome back" pricing or bonus' },
          { day:35, channel:'📧 Email',    label:'Break-up email',          desc:'Playful final email — often triggers the most replies' },
        ]
      },
      {
        id:'t4', icon:'🎁', title:'Post-Purchase Re-activate', color:'#059669', bg:'#F0FDF4', border:'#BBF7D0',
        desc:'Customers who bought once but didn\'t return. Drive repeat purchase with loyalty hooks and cross-sell angles.',
        rate:'55%', leads: Math.floor(leads.length * 0.4),
        steps:[
          { day:0,  channel:'📧 Email',    label:'"How are you getting on?"', desc:'Check-in email — ask for feedback, show you care' },
          { day:4,  channel:'📱 Facebook', label:'Cross-sell product ad',  desc:'Show complementary products/services based on first purchase' },
          { day:10, channel:'📧 Email',    label:'Loyalty reward',         desc:'Exclusive repeat-buyer discount or early access offer' },
          { day:16, channel:'📱 Retarget', label:'Testimonial retarget',   desc:'Video testimonial ad from similar customer profile' },
        ]
      },
    ];

    const tCards = templates.map(t=>`
      <div style="background:${t.bg};border:1.5px solid ${t.border};border-radius:18px;padding:22px 24px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <span style="font-size:1.6rem">${t.icon}</span>
              <div>
                <div style="font-family:'Space Grotesk',sans-serif;font-size:1rem;font-weight:800;color:#0A1628">${t.title}</div>
                <div style="font-size:0.68rem;color:${t.color};font-weight:700">${t.leads} matching leads · ${t.rate} avg re-engage rate</div>
              </div>
            </div>
            <div style="font-size:0.78rem;color:#6B7280;line-height:1.5">${t.desc}</div>
          </div>
          <button onclick="launchReEngageTemplate('${t.id}','${t.title.replace(/'/g,"\\'")}',${t.leads})" style="padding:10px 20px;background:linear-gradient(135deg,${t.color},${t.color}CC);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap;flex-shrink:0">🚀 Launch Campaign</button>
        </div>
        <div style="border-top:1px solid ${t.border};padding-top:14px">
          <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Sequence</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${t.steps.map((s,i)=>`<div style="display:flex;align-items:center;gap:6px">
              ${i>0?`<div style="color:#D1D5DB;font-size:0.7rem">→</div>`:''}
              <div style="background:white;border:1px solid ${t.border};border-radius:10px;padding:7px 10px;font-size:0.68rem">
                <div style="font-weight:700;color:#0A1628;margin-bottom:2px">${s.channel}</div>
                <div style="color:${t.color};font-weight:600">Day ${s.day}</div>
                <div style="color:#6B7280;margin-top:1px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.label}</div>
              </div>
            </div>`).join('')}
          </div>
        </div>
      </div>`).join('');

    wrap.innerHTML = `${hero}${kpiTiles}${tabBar}${tCards}`;
    return;
  }

  // ════════════════════ TAB: SEQUENCE BUILDER ════════════════════
  if (tab === 'sequence') {
    if (!window._reEngageSeq) window._reEngageSeq = [
      { id:'s0', day:0,  channel:'Email',      icon:'📧', msg:'',  label:'Personal re-introduction', tone:'Empathetic & direct' },
      { id:'s1', day:3,  channel:'Retarget Ad',icon:'📱', msg:'',  label:'Social proof carousel',    tone:'Confident & benefit-led' },
      { id:'s2', day:7,  channel:'LinkedIn DM',icon:'💼', msg:'',  label:'Value-first outreach',     tone:'Professional & brief' },
      { id:'s3', day:14, channel:'Email',       icon:'📧', msg:'',  label:'Limited-time offer',       tone:'Urgency & scarcity' },
    ];

    const CHANNEL_OPTS = ['Email','Retarget Ad','LinkedIn DM','Facebook Ad','TikTok Ad','SMS','Instagram DM'];

    const seqRows = window._reEngageSeq.map((s,i)=>`
      <div style="background:white;border:1.5px solid #E5E7EB;border-radius:14px;padding:18px 20px;margin-bottom:10px;display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:start">
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <div style="width:36px;height:36px;background:linear-gradient(135deg,#D97706,#B45309);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1rem;color:white;font-weight:800">${i+1}</div>
          ${i < window._reEngageSeq.length-1 ? `<div style="width:2px;height:24px;background:#E5E7EB;margin:2px 0"></div>` : ''}
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <select onchange="window._reEngageSeq[${i}].channel=this.value;buildReEngagement()" style="padding:6px 10px;border:1.5px solid #E5E7EB;border-radius:8px;font-size:0.75rem;color:#0A1628;background:white;font-family:'Inter',sans-serif">
              ${CHANNEL_OPTS.map(c=>`<option ${s.channel===c?'selected':''}>${c}</option>`).join('')}
            </select>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:0.72rem;color:#6B7280">Day</span>
              <input type="number" value="${s.day}" min="0" onchange="window._reEngageSeq[${i}].day=+this.value" style="width:52px;padding:5px 8px;border:1.5px solid #E5E7EB;border-radius:7px;font-size:0.75rem;color:#0A1628;text-align:center">
            </div>
            <span style="font-size:0.72rem;font-weight:600;color:#D97706">${s.label}</span>
          </div>
          ${s.msg
            ? `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px 14px;font-size:0.75rem;color:#374151;line-height:1.6;white-space:pre-wrap">${s.msg}</div>
               <button onclick="window._reEngageSeq[${i}].msg='';buildReEngagement()" style="margin-top:6px;padding:4px 10px;background:white;border:1px solid #E5E7EB;border-radius:6px;font-size:0.65rem;color:#9CA3AF;cursor:pointer">✕ Clear</button>`
            : `<div style="font-size:0.72rem;color:#9CA3AF;font-style:italic">No AI content yet — click "Generate All Content" below</div>`
          }
        </div>
        <div style="display:flex;gap:5px">
          ${i > 0 ? `<button onclick="window._reEngageSeq.splice(${i},1);buildReEngagement()" style="width:28px;height:28px;background:#FEF2F2;border:1px solid #FECACA;border-radius:7px;font-size:0.75rem;color:#DC2626;cursor:pointer;line-height:28px;text-align:center">✕</button>` : ''}
        </div>
      </div>`).join('');

    wrap.innerHTML = `${hero}${kpiTiles}${tabBar}
    <div style="display:grid;grid-template-columns:1fr 280px;gap:20px;align-items:flex-start">
      <div>
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04);margin-bottom:14px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">Custom Sequence Builder</div>
              <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${window._reEngageSeq.length}-step sequence · Drag to reorder, edit channels and timing</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="window._reEngageSeq.push({id:'s'+Date.now(),day:window._reEngageSeq[window._reEngageSeq.length-1]?.day+7||21,channel:'Email',icon:'📧',msg:'',label:'Follow-up step',tone:'Friendly'});buildReEngagement()" style="padding:8px 14px;background:#F9FAFB;border:1.5px solid #E5E7EB;border-radius:9px;font-size:0.75rem;font-weight:600;color:#374151;cursor:pointer">+ Add Step</button>
              <button id="genSeqBtn" onclick="generateSequenceContent()" style="padding:8px 16px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:9px;font-size:0.75rem;font-weight:700;color:white;cursor:pointer">✨ Generate All Content</button>
            </div>
          </div>
          ${seqRows}
        </div>
        <button onclick="launchCustomSequence()" style="width:100%;padding:13px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:12px;font-size:0.88rem;font-weight:700;color:white;cursor:pointer">🚀 Launch This Sequence to All High-Priority Leads</button>
        <div id="dripStatusPanel"></div>
        <script>setTimeout(function(){ if(typeof refreshDripStatus==='function') refreshDripStatus(); }, 50);</script>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
          <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">⚡ Sequence Stats</div>
          ${[['Total Steps',window._reEngageSeq.length,'#D97706'],['Duration (days)',Math.max(...window._reEngageSeq.map(s=>s.day)),'#7C3AED'],['Target Leads',highPri,'#059669'],['Est. Re-engage','~'+Math.round(highPri*0.44),'#0066FF']].map(([l,v,c])=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F9FAFB">
              <span style="font-size:0.75rem;color:#6B7280">${l}</span>
              <span style="font-size:0.9rem;font-weight:800;color:${c}">${v}</span>
            </div>`).join('')}
        </div>
        <div style="background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1.5px solid #FDE68A;border-radius:16px;padding:18px">
          <div style="font-size:0.72rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">💡 Best Practice Tip</div>
          <div style="font-size:0.75rem;color:#92400E;line-height:1.6">Space your first 3 touchpoints within 10 days. After that, weekly follow-ups perform best. Mix channels — email + retargeting together is 2× more effective than email alone.</div>
        </div>
      </div>
    </div>`;
    return;
  }

  // ════════════════════ TAB: COMPETITOR STEAL ════════════════════
  if (tab === 'steal') {
    const stealComps = comps.length > 0 ? comps : [{name:'Competitor A'},{name:'Competitor B'},{name:'Competitor C'}];
    const stealData  = stealComps.map((c,i)=>{
      const s = sh(c.name+domain);
      const offers = [
        ['Free trial extended to 30 days','Aggressive free-tier to lure trial users'],
        ['Discounted annual plan (30% off)','Price undercutting on annual commitment'],
        ['New AI features released','Feature parity threat — capturing attention'],
        ['Referral bonus program','Viral growth via existing customer base'],
        ['White-glove onboarding','Service differentiation targeting switchers'],
      ];
      const stealReasons = ['Pricing','Features','Support','Onboarding','Content'][i%5];
      return { name:c.name, offer:offers[s%offers.length][0], why:offers[s%offers.length][1], angle:stealReasons, threat:['High','Medium','Medium','High','Low'][s%5], color:['#DC2626','#D97706','#7C3AED'][i%3], idx:i };
    });

    wrap.innerHTML = `${hero}${kpiTiles}${tabBar}
    <div style="margin-bottom:16px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628;margin-bottom:4px">Why Your Leads Left — and How to Win Them Back</div>
      <div style="font-size:0.75rem;color:#6B7280">AI cross-references your competitors' current offers against your lapsed lead segments to surface the most likely steal angles.</div>
    </div>
    ${stealData.map(c=>`
    <div style="background:white;border:1.5px solid #E5E7EB;border-radius:18px;padding:22px 24px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
            <div style="width:36px;height:36px;background:linear-gradient(135deg,${c.color},${c.color}99);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;color:white;font-weight:800">${c.name[0]}</div>
            <div>
              <div style="font-weight:800;color:#0A1628;font-size:0.88rem">${c.name}</div>
              <div style="font-size:0.65rem;color:${c.color};font-weight:700">Steal Angle: ${c.angle} · Threat: ${c.threat}</div>
            </div>
          </div>
          <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;margin-bottom:10px">
            <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:4px">What they're offering</div>
            <div style="font-size:0.8rem;font-weight:700;color:#0A1628">${c.offer}</div>
            <div style="font-size:0.72rem;color:#6B7280;margin-top:3px">${c.why}</div>
          </div>
        </div>
        <button onclick="generateCounterOffer(${c.idx},'${c.name.replace(/'/g,"\\'")}','${c.offer.replace(/'/g,"\\'")}','${c.angle}')" id="counterBtn${c.idx}" style="padding:10px 18px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:10px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap;flex-shrink:0;height:fit-content">🎯 Generate Counter-Offer</button>
      </div>
      <div id="counterResult${c.idx}" style="display:none"></div>
    </div>`).join('')}`;
    return;
  }

  // ── DM SEQUENCES TAB ─────────────────────────────────────────────────────
  if (tab === 'dm') {
    const DM_SEQS = [
      {
        id:'warm', icon:'🔥', label:'Warm Lead DM', stage:'Conversion', color:'#F59E0B', bg:'#FFFBEB',
        intro:'Use after someone watches your Reel, replies to a Story, or engages 3+ times. Your goal: start a real conversation, not pitch.',
        steps:[
          { day:0, msg:'Hey [Name]! Noticed you\'ve been checking out our content — are you currently working on [problem area]? Happy to share what\'s been working for others in your space.' },
          { day:2, msg:'Quick follow-up — did you get a chance to look at what I sent? I\'ve got a specific idea that might help [Name] with [their goal]. No strings attached.' },
          { day:5, msg:'Last one I promise 😄 — I put together a quick resource on [topic] that\'s been getting great results. Want me to drop it over? Takes 2 mins to read.' },
        ]
      },
      {
        id:'testimonial', icon:'⭐', label:'Testimonial Request DM', stage:'Advocacy', color:'#7C3AED', bg:'#F5F3FF',
        intro:'Send to customers ~30 days after purchase or after they\'ve had a win. Makes it personal and easy for them to say yes.',
        steps:[
          { day:0, msg:'Hey [Name]! So glad to see how [specific result] has been going for you. I\'d love to share your story — would you be open to a quick 2–3 sentence quote I could use? Totally your words, I\'ll just format it.' },
          { day:3, msg:'No pressure at all — even a single line like "I went from X to Y" would be amazing. Lots of people in similar situations look for this kind of proof before jumping in.' },
        ]
      },
      {
        id:'referral', icon:'🌟', label:'Referral Ask DM', stage:'Advocacy', color:'#10B981', bg:'#ECFDF5',
        intro:'Send to your happiest clients. Keep it light and make it feel exclusive — like you\'re inviting them into a private circle.',
        steps:[
          { day:0, msg:'Hey [Name]! Quick question — do you know anyone else dealing with [problem] that I could help? I\'m taking on [X] new clients this month and I\'d love for them to be in your network. You\'d both get [specific benefit].' },
          { day:4, msg:'Totally understand if no one comes to mind! If you do think of someone later, just send them my way. In the meantime, here\'s [valuable resource] — thought of you when I saw it.' },
        ]
      },
      {
        id:'postpurchase', icon:'💎', label:'Post-Purchase DM', stage:'Nurture', color:'#3B82F6', bg:'#EFF6FF',
        intro:'Send within 24 hours of purchase. The goal is to make them feel like they made the right decision and start building loyalty.',
        steps:[
          { day:0, msg:'Hey [Name]! So excited to have you on board 🙌 I wanted to personally check in — is there anything you need from me to get started? I\'m here.' },
          { day:3, msg:'Quick check-in — how\'s everything going so far? Any early wins or questions? Don\'t hesitate to DM me directly — I reply to everyone.' },
          { day:7, msg:'One week in! I\'d love to know how [specific thing] is going. A lot of people see [common early win] around this point. Anything we can do to accelerate that for you?' },
        ]
      },
      {
        id:'reactivation', icon:'🔄', label:'Reactivation DM', stage:'Conversion', color:'#EC4899', bg:'#FDF2F8',
        intro:'For followers who haven\'t engaged in 60+ days. Aim to re-spark curiosity with something new or a genuine check-in — no pitch.',
        steps:[
          { day:0, msg:'Hey [Name], it\'s been a while! We\'ve been working on something new around [relevant topic] and it reminded me of a conversation we had. Are you still working on [challenge]?' },
          { day:3, msg:'Thought you might find this useful — [specific tip or insight relevant to their situation]. No need to reply, just wanted to drop some value your way.' },
          { day:7, msg:'Last one from me for now! We\'re opening up [offer/spots] for people who\'ve been following for a while. If timing is ever right, I\'d love to work together. Here\'s the link: [link]' },
        ]
      },
    ];
    wrap.innerHTML = `${hero}${kpiTiles}${tabBar}
    <div style="margin-bottom:20px">
      <div style="font-family:Space Grotesk,sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628;margin-bottom:4px">💬 DM Conversion Sequences</div>
      <div style="font-size:0.75rem;color:#6B7280">Ready-to-use DM templates mapped to funnel stages. Copy, personalise the [brackets], and start conversations that convert.</div>
    </div>
    ${DM_SEQS.map(seq=>`
    <div style="background:white;border:1.5px solid ${seq.color}33;border-radius:18px;padding:22px 24px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap">
        <div style="width:40px;height:40px;background:${seq.bg};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${seq.icon}</div>
        <div style="flex:1;min-width:150px">
          <div style="font-weight:800;color:#0A1628;font-size:0.88rem">${seq.label}</div>
          <div style="font-size:0.65rem;font-weight:700;color:${seq.color};margin-top:1px">Funnel: ${seq.stage} Stage</div>
        </div>
        <button onclick="navigator.clipboard?.writeText(document.getElementById('dmseq-${seq.id}').innerText).then(()=>showToast('✅ DM sequence copied!'))" style="padding:7px 14px;background:${seq.bg};border:1px solid ${seq.color}55;border-radius:9px;font-size:0.7rem;font-weight:700;color:${seq.color};cursor:pointer">📋 Copy All</button>
      </div>
      <div style="font-size:0.72rem;color:#6B7280;margin-bottom:12px;padding:10px 12px;background:#F9FAFB;border-radius:9px;line-height:1.5">${seq.intro}</div>
      <div id="dmseq-${seq.id}">
        ${seq.steps.map((step,i)=>`
        <div style="margin-bottom:10px">
          <div style="font-size:0.62rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;margin-bottom:4px">Message ${i+1}${i===0?' (Day 0 — Send immediately)':' (Day '+step.day+')'}</div>
          <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;font-size:0.78rem;color:#374151;line-height:1.55;position:relative">
            ${step.msg}
            <button onclick="navigator.clipboard?.writeText(this.closest('div[style*=background]').innerText.trim()).then(()=>showToast('✅ Message copied!'))" style="position:absolute;top:8px;right:8px;background:white;border:1px solid #E5E7EB;border-radius:6px;padding:3px 8px;font-size:0.6rem;color:#6B7280;cursor:pointer">Copy</button>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('')}`;
    return;
  }

  // Fallback
  wrap.innerHTML = `${hero}${kpiTiles}${tabBar}`;
}

// ── AI Copy Modal ─────────────────────────────────────────────────────────────
window.openReEngageCopyModal = async function(id, name, company, channel, reason, value) {
  const existing = document.getElementById('reEngageCopyOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'reEngageCopyOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba70);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

  overlay.innerHTML = `
    <div style="background:white;border-radius:20px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.35)">
      <div style="background:linear-gradient(135deg,#92400E,#D97706);border-radius:20px 20px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:0.62rem;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px">AI Re-engagement Copy</div>
          <div style="font-family:'Space Grotesk',sans-serif;font-size:1.05rem;font-weight:800;color:white">${name}</div>
        </div>
        <button id="reec-close" style="background:rgba(255,255,255,.15);border:none;border-radius:50%;width:32px;height:32px;font-size:1.1rem;color:white;cursor:pointer;line-height:32px;text-align:center">✕</button>
      </div>
      <div style="padding:22px 24px">
        <div id="reec-loading" style="text-align:center;padding:40px 0">
          <div style="font-size:1.5rem;margin-bottom:10px;animation:reecSpin 1.4s linear infinite;display:inline-block">⏳</div>
          <div style="font-size:0.82rem;color:#6B7280;font-weight:600">Generating personalised re-engagement copy…</div>
          <div style="font-size:0.72rem;color:#9CA3AF;margin-top:4px">Analysing ${name}'s profile, last activity, and best channel</div>
          <div style="margin-top:14px;display:inline-flex;align-items:center;gap:8px;background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:999px;padding:6px 14px">
            <div style="width:6px;height:6px;border-radius:50%;background:#D97706;animation:reecPulse 1s ease-in-out infinite"></div>
            <span style="font-size:0.7rem;font-weight:700;color:#92400E;letter-spacing:.04em">InfoGenie working</span>
            <span style="font-size:0.72rem;font-weight:800;color:#B45309;font-variant-numeric:tabular-nums" id="reec-timer">0.0s</span>
          </div>
        </div>
        <style>
          @keyframes reecSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes reecPulse { 0%,100% { opacity:.4; transform:scale(.85); } 50% { opacity:1; transform:scale(1.15); } }
        </style>
        <div id="reec-content" style="display:none"></div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button id="reec-close2" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.82rem;font-weight:600;color:#6B7280;cursor:pointer">Close</button>
          <button id="reec-mark" style="flex:1;padding:11px;background:linear-gradient(135deg,#D97706,#B45309);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">✓ Mark as Contacted</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });
  document.getElementById('reec-close').addEventListener('click', () => overlay.remove());
  document.getElementById('reec-close2').addEventListener('click', () => overlay.remove());
  document.getElementById('reec-mark').addEventListener('click', () => {
    window._reEngageContacted[id] = true;
    showToast(`✅ ${name} marked as contacted`);
    overlay.remove();
    buildReEngagement();
  });

  // Start working-timer
  const reecStart = performance.now();
  const reecTimerEl = document.getElementById('reec-timer');
  const reecTimerInt = setInterval(() => {
    if (!reecTimerEl || !document.body.contains(reecTimerEl)) { clearInterval(reecTimerInt); return; }
    const sec = (performance.now() - reecStart) / 1000;
    reecTimerEl.textContent = sec.toFixed(1) + 's';
  }, 100);

  // Fetch AI copy — resolve sender domain/brand from analysis (with persisted fallback)
  let resolvedUrl = analysisData?.url;
  if (!resolvedUrl) { try { resolvedUrl = localStorage.getItem('ig-last-analysed-url') || ''; } catch(e){ resolvedUrl = ''; } }
  const domain    = (resolvedUrl || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0] || 'yourdomain.com';
  const brandSlug = domain.split('.')[0] || 'our';
  const brandName = brandSlug.charAt(0).toUpperCase() + brandSlug.slice(1);
  const industry  = analysisData?.industry?.name || 'your industry';
  try {
    const res  = await fetch('/api/reengage-copy', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, company, channel, reason, value, domain, brandName, industry })
    });
    const data = await res.json();
    clearInterval(reecTimerInt);
    document.getElementById('reec-loading').style.display = 'none';
    const cnt  = document.getElementById('reec-content');
    cnt.style.display = 'block';
    cnt.innerHTML = `
      ${data.email ? `
      <div style="margin-bottom:16px">
        <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">📧 Email</div>
        <div style="background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:12px;padding:14px 16px">
          <div style="font-size:0.72rem;font-weight:700;color:#92400E;margin-bottom:6px">Subject: ${data.email.subject||''}</div>
          <div style="font-size:0.78rem;color:#374151;line-height:1.7;white-space:pre-wrap">${data.email.body||''}</div>
        </div>
        <button onclick="navigator.clipboard.writeText('Subject: ${(data.email.subject||'').replace(/'/g,"\\'")}\\n\\n${(data.email.body||'').replace(/\n/g,'\\n').replace(/'/g,"\\'")}').then(()=>showToast('📋 Email copied!'))" style="margin-top:6px;padding:5px 12px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.65rem;font-weight:600;color:#6B7280;cursor:pointer">📋 Copy Email</button>
      </div>` : ''}
      ${data.ad ? `
      <div style="margin-bottom:16px">
        <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">📱 Retargeting Ad Copy</div>
        <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:12px;padding:14px 16px">
          <div style="font-size:0.72rem;font-weight:700;color:#1E40AF;margin-bottom:4px">${data.ad.headline||''}</div>
          <div style="font-size:0.78rem;color:#374151;line-height:1.6">${data.ad.body||''}</div>
          <div data-ad-cta="${(data.ad.cta||'').replace(/"/g,'&quot;')}" data-ad-id="${id}" data-ad-name="${(name||'').replace(/"/g,'&quot;')}" data-ad-company="${(company||'').replace(/"/g,'&quot;')}" data-ad-headline="${(data.ad.headline||'').replace(/"/g,'&quot;')}" data-ad-body="${(data.ad.body||'').replace(/"/g,'&quot;')}" id="reec-ad-actions" style="margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap"></div>
        </div>
      </div>` : ''}
      ${data.social ? `
      <div>
        <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">💬 ${channel} Message</div>
        <div style="background:#F5F3FF;border:1.5px solid #DDD6FE;border-radius:12px;padding:14px 16px;font-size:0.78rem;color:#374151;line-height:1.6;white-space:pre-wrap">${data.social||''}</div>
        <button onclick="navigator.clipboard.writeText('${(data.social||'').replace(/\n/g,'\\n').replace(/'/g,"\\'")}').then(()=>showToast('📋 Message copied!'))" style="margin-top:6px;padding:5px 12px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.65rem;font-weight:600;color:#6B7280;cursor:pointer">📋 Copy Message</button>
      </div>` : ''}`;

    // Inject ad action buttons via DOM (avoids template-literal escaping issues)
    const adActions = document.getElementById('reec-ad-actions');
    if (adActions && data.ad) {
      const adId       = adActions.dataset.adId       || '';
      const adName     = adActions.dataset.adName     || '';
      const adCompany  = adActions.dataset.adCompany  || '';
      const adCta      = adActions.dataset.adCta      || 'Re-Engage Now';
      const adHeadline = adActions.dataset.adHeadline || '';
      const adBody     = adActions.dataset.adBody     || '';

      const fireBtn = document.createElement('button');
      fireBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:linear-gradient(135deg,#0066FF,#0052CC);color:white;border:none;border-radius:8px;padding:8px 16px;font-size:0.74rem;font-weight:800;cursor:pointer;box-shadow:0 3px 10px rgba(0,102,255,0.35);transition:transform .15s,box-shadow .15s';
      fireBtn.textContent = adCta + ' →';
      fireBtn.onmouseover = () => { fireBtn.style.transform='translateY(-1px)'; fireBtn.style.boxShadow='0 5px 14px rgba(0,102,255,0.45)'; };
      fireBtn.onmouseout  = () => { fireBtn.style.transform=''; fireBtn.style.boxShadow='0 3px 10px rgba(0,102,255,0.35)'; };
      fireBtn.onclick     = () => window.fireReEngageAd(adId, adName, adCompany);

      const copyBtn = document.createElement('button');
      copyBtn.style.cssText = 'padding:8px 14px;background:white;border:1px solid #BFDBFE;border-radius:8px;font-size:0.7rem;font-weight:700;color:#1E40AF;cursor:pointer';
      copyBtn.textContent = '📋 Copy Ad';
      copyBtn.onclick = () => {
        const text = adHeadline + '\n\n' + adBody + '\n\nCTA: ' + adCta;
        navigator.clipboard.writeText(text).then(() => showToast('📋 Ad copy copied!'));
      };

      adActions.appendChild(fireBtn);
      adActions.appendChild(copyBtn);
    }
  } catch(err) {
    clearInterval(reecTimerInt);
    document.getElementById('reec-loading').innerHTML = `<div style="color:#DC2626;font-size:0.8rem;text-align:center">Failed to generate copy — please try again</div>`;
  }
};

// ── Fire single retargeting ad to lead from modal ────────────────────────────
window.fireReEngageAd = function(id, name, company) {
  window._reEngageContacted = window._reEngageContacted || {};
  window._reEngageContacted[id] = true;
  showToast(`🚀 Retargeting ad launched to ${name} — tracking in Results`);
  const overlay = document.getElementById('reEngageCopyOverlay');
  if (overlay) overlay.remove();
  if (typeof buildReEngagement === 'function') buildReEngagement();
};

// ── Launch template ───────────────────────────────────────────────────────────
window.launchReEngageTemplate = function(id, title, count) {
  showToast(`🚀 "${title}" campaign launched for ${count} leads — tracking in Results`);
};

// ── Launch custom sequence — REAL drip-engine enrollment ──────────────────────
// Sends the contacts + sequence to the server-side drip engine, which stores
// the enrollment, schedules the day-0 send immediately, and ticks every 60s.
// dryRun is on by default because the seeded "leads" use placeholder emails
// like james@acmecorp.com — flipping it off only makes sense once the user
// adds REAL contacts via the "Add Real Contact" form.
window.launchCustomSequence = async function() {
  const seq = window._reEngageSeq || [];
  if (!seq.length) { showToast('⚠️ No sequence steps defined'); return; }
  if (seq.some(s => !s.msg || !s.msg.trim())) {
    showToast('⚠️ Generate the sequence content first (✨ Generate All Content)');
    return;
  }
  // Gather contacts: real ones added by the user + (when not dry-run) the
  // demo leads. Demo leads always use synthetic emails so we route them
  // through dryRun=true to avoid bouncing real-looking addresses.
  const realContacts = window._dripRealContacts || [];
  const dryRun = !!window._dripDryRun || realContacts.length === 0;
  const contacts = realContacts.length
    ? realContacts.map(c => ({ email: c.email, name: c.name }))
    : (function(){
        // Fall back to seeded demo leads, but always dry-run them
        const out = [];
        const dom = (analysisData?.url || '').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0] || 'example.com';
        const COMP = ['Acme Corp','BlueSky Ltd','Nexus Digital','Orbit Systems','Pinnacle Group'];
        const FIRST = ['James','Sarah','Michael','Emma','David'];
        for (let i = 0; i < 5; i++) {
          out.push({ email: `${FIRST[i].toLowerCase()}@${COMP[i].toLowerCase().replace(/\s/g,'')}.com`, name: FIRST[i] });
        }
        return out;
      })();
  if (!contacts.length) {
    showToast('⚠️ Add at least one contact under "Real Contacts" first');
    return;
  }
  try {
    const r = await fetch('/api/drips/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contacts,
        sequence: seq.map(s => ({
          day: s.day, channel: s.channel, label: s.label, msg: s.msg,
          subject: s.subject || s.label
        })),
        brand: (analysisData?.url || 'InfoGenie').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0],
        dryRun,
        appOrigin: window.location.origin,
      })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) { showToast('❌ Launch failed: ' + (j.error || r.status)); return; }
    showToast(`🚀 Sequence launched! ${j.enrolled} enrolled${dryRun ? ' (dry-run)' : ''}${j.skipped?.length ? `, ${j.skipped.length} skipped` : ''}`);
    if (typeof refreshDripStatus === 'function') refreshDripStatus();
    // Auto-poll for the next 30 seconds so the user sees first sends land
    if (window._dripPollTimer) clearInterval(window._dripPollTimer);
    let ticks = 0;
    window._dripPollTimer = setInterval(() => {
      if (++ticks > 6) { clearInterval(window._dripPollTimer); window._dripPollTimer = null; return; }
      if (typeof refreshDripStatus === 'function') refreshDripStatus();
    }, 5000);
  } catch (e) {
    showToast('❌ Network error: ' + e.message);
  }
};

// ── Add a real contact (used by the contacts mini-form in the Sequence tab) ──
window.addRealContact = function() {
  const emailEl = document.getElementById('dripContactEmail');
  const nameEl  = document.getElementById('dripContactName');
  const email = (emailEl?.value || '').trim().toLowerCase();
  const name  = (nameEl?.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('⚠️ Enter a valid email'); return; }
  window._dripRealContacts = window._dripRealContacts || [];
  if (window._dripRealContacts.find(c => c.email === email)) { showToast('Already added'); return; }
  window._dripRealContacts.push({ email, name });
  try { localStorage.setItem('ig-drip-real-contacts', JSON.stringify(window._dripRealContacts)); } catch(e) {}
  if (emailEl) emailEl.value = '';
  if (nameEl)  nameEl.value  = '';
  if (typeof refreshDripStatus === 'function') refreshDripStatus();
  showToast(`✅ Added ${email}`);
};
window.removeRealContact = function(email) {
  window._dripRealContacts = (window._dripRealContacts || []).filter(c => c.email !== email);
  try { localStorage.setItem('ig-drip-real-contacts', JSON.stringify(window._dripRealContacts)); } catch(e) {}
  if (typeof refreshDripStatus === 'function') refreshDripStatus();
};
window.toggleDripDryRun = function(on) {
  window._dripDryRun = !!on;
  try { localStorage.setItem('ig-drip-dryrun', on ? '1' : '0'); } catch(e) {}
};
// Restore from storage
try {
  window._dripRealContacts = JSON.parse(localStorage.getItem('ig-drip-real-contacts') || '[]');
  window._dripDryRun = localStorage.getItem('ig-drip-dryrun') !== '0';
} catch(e) { window._dripRealContacts = []; window._dripDryRun = true; }

// ── Drip engine status panel — fetches /api/drips and /api/drips/stats ────
window.refreshDripStatus = async function() {
  const panel = document.getElementById('dripStatusPanel');
  if (!panel) return;
  try {
    const [statsR, listR] = await Promise.all([
      fetch('/api/drips/stats').then(r => r.json()),
      fetch('/api/drips').then(r => r.json()),
    ]);
    const s = statsR.stats || {};
    const enrollments = (listR.enrollments || []).slice(0, 12);
    const tile = (label, val, color) => `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px;text-align:center;min-width:0">
        <div style="font-size:1.15rem;font-weight:800;color:${color}">${val}</div>
        <div style="font-size:.62rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-top:2px">${label}</div>
      </div>`;
    const realContacts = window._dripRealContacts || [];
    const dryRun = !!window._dripDryRun;
    const contactRows = realContacts.length
      ? realContacts.map(c => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F3F4F6">
          <div style="font-size:.74rem;color:#0A1628"><b>${c.name || c.email.split('@')[0]}</b> <span style="color:#6B7280">· ${c.email}</span></div>
          <button onclick="removeRealContact('${c.email}')" style="background:none;border:none;color:#DC2626;cursor:pointer;font-size:.7rem">✕</button>
        </div>`).join('')
      : `<div style="font-size:.72rem;color:#9CA3AF;font-style:italic;padding:6px 0">No real contacts yet — add your own email below to test live sends.</div>`;
    const enrollRows = enrollments.length
      ? enrollments.map(e => {
        const stepLabel = e.sequence?.[e.currentStep]?.label || (e.status === 'completed' ? '✓ all sent' : '—');
        const statusColor = { active:'#059669', paused:'#D97706', completed:'#6B7280', cancelled:'#9CA3AF', unsubscribed:'#DC2626' }[e.status] || '#6B7280';
        const sentN = (e.history || []).filter(h => h.ok).length;
        const failN = (e.history || []).filter(h => !h.ok).length;
        const bounceN = (e.history || []).filter(h => h.bounced).length;
        const lastBounce = (e.history || []).slice().reverse().find(h => h.bounced);
        const nextWhen = e.status === 'active' && e.nextSendAt ? new Date(e.nextSendAt).toLocaleString() : '—';
        const bounceBadge = bounceN
          ? `<span title="${(lastBounce && lastBounce.bounceReason || 'bounced').replace(/"/g,'&quot;').slice(0,140)}" style="display:inline-block;background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:1px 6px;font-size:.62rem;color:#991B1B;font-weight:700;margin-left:4px">↩ ${bounceN}</span>`
          : '';
        return `
          <tr>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;font-size:.74rem;color:#0A1628"><b>${(e.name || e.email.split('@')[0])}</b><br><span style="color:#6B7280;font-size:.7rem">${e.email}</span></td>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;font-size:.72rem;color:#374151">${e.currentStep+1}/${e.sequence?.length || 0} · ${stepLabel}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;font-size:.72rem"><span style="color:${statusColor};font-weight:700;text-transform:uppercase;letter-spacing:.04em">${e.status}</span>${e.dryRun?` <span style="color:#9CA3AF;font-size:.65rem">· dry</span>`:''}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;font-size:.7rem;color:#6B7280">${sentN}✓${failN?` ${failN}✕`:''}${bounceBadge}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;font-size:.7rem;color:#6B7280">${nextWhen}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #F3F4F6;text-align:right">
              ${e.status === 'active' ? `<button onclick="dripAction('${e.id}','pause')" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:3px 8px;font-size:.65rem;color:#92400E;cursor:pointer">Pause</button>` : ''}
              ${e.status === 'paused' ? `<button onclick="dripAction('${e.id}','resume')" style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:6px;padding:3px 8px;font-size:.65rem;color:#059669;cursor:pointer">Resume</button>` : ''}
              ${(e.status === 'active' || e.status === 'paused') ? `<button onclick="dripAction('${e.id}','cancel')" style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:3px 8px;font-size:.65rem;color:#DC2626;cursor:pointer;margin-left:4px">Cancel</button>` : ''}
            </td>
          </tr>`;
      }).join('')
      : `<tr><td colspan="6" style="padding:14px;text-align:center;font-size:.74rem;color:#9CA3AF;font-style:italic">No active enrollments yet — click "🚀 Launch This Sequence" above.</td></tr>`;
    panel.innerHTML = `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.04);margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <div style="font-family:'Space Grotesk',sans-serif;font-size:.92rem;font-weight:800;color:#0A1628">⚡ Live Drip Engine</div>
            <div style="font-size:.7rem;color:#6B7280;margin-top:2px">Server-side scheduler · processes due steps every 60 seconds</div>
          </div>
          <button onclick="refreshDripStatus()" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:6px 12px;font-size:.72rem;font-weight:600;color:#374151;cursor:pointer">↻ Refresh</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:8px;margin-bottom:10px">
          ${tile('Total',       s.total||0,        '#0A1628')}
          ${tile('Active',      s.active||0,       '#059669')}
          ${tile('Paused',      s.paused||0,       '#D97706')}
          ${tile('Completed',   s.completed||0,    '#6B7280')}
          ${tile('Sent',        s.sentTotal||0,    '#0066FF')}
          ${tile('Failed',      s.failedTotal||0,  s.failedTotal?'#DC2626':'#6B7280')}
          ${tile('Unsubbed',    s.unsubscribed||0, '#DC2626')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-bottom:14px;padding:10px;background:linear-gradient(135deg,#FEF2F2,#FFF7ED);border:1px solid #FECACA;border-radius:10px">
          <div style="grid-column:1/-1;font-size:.62rem;font-weight:700;color:#991B1B;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px">📬 Email Deliverability ${s.emailAttempts ? `· ${s.emailAttempts} live attempt${s.emailAttempts===1?'':'s'}` : '· no live email sends yet'}</div>
          ${tile('Attempts',  s.emailAttempts||0,                                               '#0A1628')}
          ${tile('Delivered', s.emailDelivered||0,                                              '#059669')}
          ${tile('Bounced',   s.emailBounced||0,                                                s.emailBounced?'#DC2626':'#6B7280')}
          ${tile('Complaint', s.emailComplained||0,                                             s.emailComplained?'#DC2626':'#6B7280')}
          ${tile('Bounce %',  (s.emailAttempts ? (s.bounceRate||0)+'%'    : '—'),               (s.bounceRate    >= 5 ? '#DC2626' : s.bounceRate    >= 2 ? '#D97706' : '#059669'))}
          ${tile('Spam %',    (s.emailAttempts ? (s.complaintRate||0)+'%' : '—'),               (s.complaintRate >= 0.5 ? '#DC2626' : s.complaintRate >= 0.1 ? '#D97706' : '#059669'))}
        </div>
        ${s.bounceRate >= 5 ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-left:3px solid #DC2626;border-radius:8px;padding:9px 12px;margin-bottom:12px;font-size:.72rem;color:#991B1B">⚠️ <b>Bounce rate is high (${s.bounceRate}%).</b> Industry threshold is 2%; above 5% triggers ESP throttling. Likely cause: invalid recipient addresses or unverified sending domain.</div>` : ''}
        <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px;margin-bottom:12px">
          <div style="font-size:.74rem;font-weight:700;color:#374151;margin-bottom:8px">Real contacts (will receive live emails when dry-run is OFF)</div>
          ${contactRows}
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <input id="dripContactName" placeholder="Name" style="flex:1;min-width:90px;padding:7px 10px;border:1px solid #E5E7EB;border-radius:7px;font-size:.74rem">
            <input id="dripContactEmail" placeholder="email@example.com" style="flex:2;min-width:140px;padding:7px 10px;border:1px solid #E5E7EB;border-radius:7px;font-size:.74rem">
            <button onclick="addRealContact()" style="background:#0A1628;color:white;border:none;border-radius:7px;padding:7px 14px;font-size:.72rem;font-weight:700;cursor:pointer">+ Add</button>
          </div>
          <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:.72rem;color:#374151;cursor:pointer">
            <input type="checkbox" ${dryRun?'checked':''} onchange="toggleDripDryRun(this.checked)">
            <span><b>Dry-run mode</b> — record sends but don't actually email. Recommended while testing. Turn off to send real emails (Resend's free tier requires a verified domain or only delivers to your own verified address).</span>
          </label>
        </div>
        <div style="overflow-x:auto;max-width:100%">
          <table style="width:100%;border-collapse:collapse;min-width:580px">
            <thead><tr style="background:#F9FAFB">
              <th style="text-align:left;padding:8px;font-size:.65rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">Contact</th>
              <th style="text-align:left;padding:8px;font-size:.65rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">Step</th>
              <th style="text-align:left;padding:8px;font-size:.65rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">Status</th>
              <th style="text-align:left;padding:8px;font-size:.65rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">Sends</th>
              <th style="text-align:left;padding:8px;font-size:.65rem;color:#6B7280;text-transform:uppercase;letter-spacing:.06em">Next</th>
              <th></th>
            </tr></thead>
            <tbody>${enrollRows}</tbody>
          </table>
        </div>
      </div>`;
  } catch (e) {
    panel.innerHTML = `<div style="padding:14px;color:#DC2626;font-size:.78rem">Drip status unavailable: ${e.message}</div>`;
  }
};

// ── window exports (originals were bare top-level function declarations) ──────
window.buildAgency       = buildAgency;
window.buildAutomations  = buildAutomations;
window.buildReEngagement = buildReEngagement;

})();

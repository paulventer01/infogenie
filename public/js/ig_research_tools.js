// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ ig_research_tools.js — Audience & Keyword Research view-builders          ║
// ║                                                                          ║
// ║ Extracted verbatim from app.js (no behaviour change). Holds four         ║
// ║ self-contained research tools:                                           ║
// ║   • ICP Studio        — buildICPStudio + _icp* helpers                   ║
// ║   • Search Intent Map — buildIntentMap + _im* helpers                    ║
// ║   • Keyword–Page Map  — buildKeywordMap + _km* helpers                   ║
// ║   • Amplitude AI Agents — _AMP_AGENTS + buildAmplitudeAgents + _amp*     ║
// ║                                                                          ║
// ║ Wrapped in one IIFE per the public/js/ convention. Entry points and any  ║
// ║ helper referenced by an inline onclick= are re-attached to window at the ║
// ║ bottom. Reads shared globals (analysisData, navigateTo, showToast,       ║
// ║ showTileInfo/hideTileInfo, generateCampaignRecs, Chart) from app.js.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
(function () {
'use strict';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 🎯 ICP STUDIO — Ideal Customer Profile + Voice-of-Customer + Activation  ║
// ╚══════════════════════════════════════════════════════════════════════════╝

if (!window._icpProfile) window._icpProfile = null; // { ageRange, role, intent, painPoints[], desires[], budget }
if (!window._icpVoC)     window._icpVoC     = null; // { triggers[], objections[], emotionalDrivers[] }

// Local HTML-escape helper used by ICP Studio for any dynamic / AI-supplied string
function _icpEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function buildICPStudio() {
  const wrap = document.getElementById('icpStudioWrap');
  if (!wrap) return;

  const icp = window._icpProfile || {};
  const voc = window._icpVoC || {};
  const hasICP = !!(icp.role || icp.ageRange);
  const hasVoC = !!((voc.triggers && voc.triggers.length) || (voc.objections && voc.objections.length));
  const redditCount = (window._redditPosts || []).length;
  const compCount   = (analysisData?.competitors || []).length;
  const domain   = _icpEsc(analysisData?.url || 'your brand');
  const industry = _icpEsc(analysisData?.industry?.name || 'your industry');

  // Field rendering helper — all dynamic values escaped via _icpEsc for defense-in-depth
  const fld = (id, label, value, placeholder, isList=false) => {
    if (isList) {
      const items = Array.isArray(value) ? value : [];
      const rows = [0,1,2].map(i => `<input type="text" id="${id}-${i}" data-icp-list="${id}" value="${_icpEsc(items[i])}" placeholder="${_icpEsc(placeholder)}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif;margin-bottom:6px">`).join('');
      return `<div><div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${label}</div>${rows}</div>`;
    }
    return `<div>
      <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">${label}</div>
      <input type="text" id="${id}" value="${_icpEsc(value)}" placeholder="${_icpEsc(placeholder)}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
    </div>`;
  };

  // ── Panel A: ICP Builder ──────────────────────────────────────────────────
  const builderHtml = `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:18px;padding:22px 26px;margin-bottom:18px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">🧬</span><div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">ICP Builder</div></div>
          <div style="font-size:0.74rem;color:#6B7280;margin-top:2px">6 fields define who you're really selling to. Edit anything — AI will auto-draft if you leave it blank.</div>
        </div>
        <button id="icpDraftBtn2" style="padding:9px 18px;background:linear-gradient(135deg,#7C3AED,#EC4899);border:none;border-radius:10px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">✨ Auto-Draft from Brand Intel</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px">
        ${fld('icp-age',    'Age Range',    icp.ageRange, 'e.g. 28–45')}
        ${fld('icp-role',   'Role / Stage', icp.role,     'e.g. Solo trader / SMB founder')}
        ${fld('icp-intent', 'Intent Stage', icp.intent,   'e.g. Actively comparing alternatives')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        ${fld('icp-pain',    'Top 3 Pain Points', icp.painPoints, 'Pain point…', true)}
        ${fld('icp-desire',  'Top 3 Desires',     icp.desires,    'Desire…',     true)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${fld('icp-budget','Budget Band', icp.budget, 'e.g. £500–£2,000/mo')}
        <div style="display:flex;flex-direction:column;justify-content:flex-end;gap:8px">
          <button id="icpScanRedditBtn" ${redditCount>0?'disabled':''} style="width:100%;padding:10px;background:${redditCount>0?'#E5E7EB':'#FF4500'};border:none;border-radius:10px;font-size:0.78rem;font-weight:700;color:${redditCount>0?'#6B7280':'white'};cursor:${redditCount>0?'default':'pointer'}">${redditCount>0?`✅ Reddit scanned (${redditCount})`:'🔍 Scan Reddit now'}</button>
          <button id="icpSaveBtn" style="width:100%;padding:11px;background:#0A1628;border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">💾 Save ICP</button>
        </div>
      </div>
      <div id="icpDraftStatus" style="margin-top:10px;font-size:0.74rem;color:#7C3AED;display:none">⏳ AI is drafting your ICP from ${domain} brand intelligence…</div>
    </div>`;

  // ── Panel B: Voice-of-Customer Mining ─────────────────────────────────────
  const vocItem = (item, color, bg) => `
    <div style="background:${bg};border:1px solid ${color}33;border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="font-size:0.78rem;font-weight:700;color:${color};line-height:1.35">${_icpEsc(item.text)}</div>
      ${item.evidence ? `<div style="font-size:0.66rem;color:#6B7280;margin-top:4px;font-style:italic;line-height:1.4">↳ ${_icpEsc(item.evidence)}</div>` : ''}
    </div>`;
  const vocCol = (title, icon, color, bg, items, emptyText) => `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:16px 18px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px">
        <span style="font-size:1.1rem">${icon}</span>
        <div style="font-family:Sora,sans-serif;font-size:0.85rem;font-weight:800;color:${color}">${title}</div>
      </div>
      ${items && items.length ? items.map(it => vocItem(it, color, bg)).join('') : `<div style="font-size:0.74rem;color:#9CA3AF;text-align:center;padding:18px 0">${emptyText}</div>`}
    </div>`;

  const vocHtml = `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:18px;padding:22px 26px;margin-bottom:18px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">🎤</span><div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">Voice-of-Customer Mining</div></div>
          <div style="font-size:0.74rem;color:#6B7280;margin-top:2px">Pulls from <strong>${redditCount}</strong> Reddit threads · <strong>${compCount}</strong> competitors · brand context — extracts buying psychology.</div>
        </div>
        <button id="icpMineBtn" style="padding:9px 18px;background:linear-gradient(135deg,#EC4899,#F59E0B);border:none;border-radius:10px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🔍 Mine My Data</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        ${vocCol('Top 5 Buying Triggers',    '⚡', '#059669', '#ECFDF5', voc.triggers,         'Click "Mine My Data" — surfaces what makes them buy.')}
        ${vocCol('Top 5 Objections',         '🛡️', '#DC2626', '#FEF2F2', voc.objections,       'Click "Mine My Data" — surfaces why they hesitate.')}
        ${vocCol('Top 5 Emotional Drivers',  '❤️', '#7C3AED', '#F5F3FF', voc.emotionalDrivers, 'Click "Mine My Data" — surfaces what they want to feel.')}
      </div>
      <div id="icpMineStatus" style="margin-top:12px;font-size:0.74rem;color:#EC4899;display:none">⏳ Mining ${redditCount} Reddit threads + competitor signals with GPT-4o…</div>
    </div>`;

  // ── Panel C: Activation ───────────────────────────────────────────────────
  const actDisabled = !hasICP;
  const actDis2 = !hasVoC || !(voc.objections && voc.objections.length);
  const actDis3 = !hasVoC || !(voc.triggers && voc.triggers.length);
  const actBtn = (icon, title, desc, color, bg, id, disabled, disabledReason, infoTip) => {
    const baseBorder = disabled ? '#E5E7EB' : color+'55';
    // Tooltip strategy — when an enabled tile already shows a rich infoBubble
    // on hover, suppress the native browser title attribute so the user
    // doesn't see TWO tooltips stacked (the rich one + the plain OS one).
    // Disabled tiles have no infoBubble, so we keep title="" to surface the
    // disabled-reason text on hover.
    const tipAttr = disabled
      ? `title="${(disabledReason || '').replace(/&amp;/g, '&').replace(/"/g, '&quot;')}"`
      : '';
    const hoverHandlers = disabled ? '' : `
      onmouseenter="this.style.borderColor='${color}';this.style.boxShadow='0 6px 18px ${color}22';this.style.transform='translateY(-2px)';showTileInfo(this, '${id}-info');"
      onmouseleave="this.style.borderColor='${baseBorder}';this.style.boxShadow='none';this.style.transform='none';hideTileInfo('${id}-info');"
      onfocus="this.style.borderColor='${color}';this.style.boxShadow='0 0 0 3px ${color}33';showTileInfo(this, '${id}-info');"
      onblur="this.style.borderColor='${baseBorder}';this.style.boxShadow='none';hideTileInfo('${id}-info');"`;
    const infoBubble = !disabled && infoTip ? `
      <div id="${id}-info" role="tooltip" style="position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%) translateY(4px);min-width:220px;max-width:300px;padding:10px 14px;background:#0A1628;color:white;font-family:'Inter',sans-serif;font-size:0.75rem;line-height:1.5;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;pointer-events:none;transition:opacity .18s ease, transform .18s ease;z-index:50">
        <div style="font-weight:700;margin-bottom:4px;color:#${color.replace('#','')};font-family:Sora,sans-serif">${title}</div>
        <div style="color:#E2E8F0">${infoTip}</div>
        <div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:7px solid #0A1628"></div>
      </div>` : '';
    return `
    <div style="position:relative">
      ${infoBubble}
      <button id="${id}" ${disabled?'disabled':''} ${tipAttr} ${hoverHandlers} style="text-align:left;padding:18px 20px;background:${disabled?'#F9FAFB':'white'};border:1.5px solid ${baseBorder};border-radius:14px;cursor:${disabled?'not-allowed':'pointer'};opacity:${disabled?'.55':'1'};transition:border-color .2s,box-shadow .2s,transform .2s;font-family:'Inter',sans-serif;display:flex;flex-direction:column;gap:6px;outline:none;appearance:none;-webkit-tap-highlight-color:transparent;-webkit-appearance:none;width:100%">
        <div style="display:flex;align-items:center;gap:8px;pointer-events:none">
          <div style="width:36px;height:36px;background:${bg};border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem">${icon}</div>
          <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:${disabled?'#9CA3AF':'#0A1628'}">${title}</div>
        </div>
        <div style="font-size:0.72rem;color:#6B7280;line-height:1.45;pointer-events:none">${desc}</div>
        ${disabled ? `<div style="font-size:0.65rem;color:#9CA3AF;font-style:italic;margin-top:2px;pointer-events:none">${disabledReason}</div>` : `<div style="font-size:0.7rem;color:${color};font-weight:700;margin-top:2px;pointer-events:none">→ Activate</div>`}
      </button>
    </div>`;
  };

  const activationHtml = `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:18px;padding:22px 26px;box-shadow:0 1px 6px rgba(0,0,0,.05)">
      <div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">🚀</span><div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">Activation</div></div>
        <div style="font-size:0.74rem;color:#6B7280;margin-top:2px">One-click flows that pipe your ICP &amp; VoC into other modules.</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
        ${actBtn('🎨','Use as Creative Studio Target','Pre-fills your next ad with this ICP as the target persona.','#7C3AED','#F5F3FF','icpAct1',actDisabled,'Build &amp; save your ICP first.','Loads this ICP — its demographics, jobs-to-be-done and pain points — into the Creative Studio. The next ad you generate will be written to speak directly to this exact persona, no manual targeting required.')}
        ${actBtn('✊','Counter-Objection Caption Pack','Generates 5 social posts — one per objection — auto-tagged Nurture stage.','#DC2626','#FEF2F2','icpAct2',actDis2,'Mine your VoC first — needs at least 1 objection.','Turns each top objection mined from your Voice-of-Customer data into a short social caption that pre-empts the hesitation. Captions land in your Content Calendar tagged for the Nurture stage so they keep wavering buyers in the funnel.')}
        ${actBtn('📧','Email Sequence for Top Trigger','3-email warm-up that leans into your strongest buying trigger.','#0891B2','#ECFEFF','icpAct3',actDis3,'Mine your VoC first — needs at least 1 trigger.','Builds a 3-email drip that opens with your strongest VoC buying trigger, then layers proof and a soft CTA. Designed to warm cold list contacts into MQLs over 7 days — drops straight into your email queue.')}
      </div>
      <div id="icpActStatus" style="margin-top:12px;font-size:0.76rem;color:#0A1628;display:none"></div>
    </div>`;

  // ── Top context bar ───────────────────────────────────────────────────────
  const redditCell = redditCount > 0
    ? `<strong>Reddit threads available:</strong> ${redditCount}`
    : `<strong>Reddit threads available:</strong> 0`;
  const ctxBar = `
    <div style="background:linear-gradient(135deg,#F5F3FF,#FDF2F8);border:1px solid #E9D5FF;border-radius:14px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="font-size:0.8rem;color:#6B21A8"><strong>Brand:</strong> ${domain} · <strong>Industry:</strong> ${industry} · ${redditCell} · <strong>Competitors:</strong> ${compCount}</div>
      <div style="font-size:0.7rem;color:#9333EA">${hasICP?'✅ ICP saved':'⚪ ICP not built yet'} · ${hasVoC?'✅ VoC mined':'⚪ VoC not mined yet'}</div>
    </div>`;

  wrap.innerHTML = `<div style="padding:8px 0">${ctxBar}${builderHtml}${vocHtml}${activationHtml}</div>`;

  // ── Wire events ───────────────────────────────────────────────────────────
  const draftBtn1 = document.getElementById('icpDraftBtn');
  const draftBtn2 = document.getElementById('icpDraftBtn2');
  [draftBtn1, draftBtn2].forEach(b => { if (b) b.onclick = _icpAutoDraft; });
  document.getElementById('icpSaveBtn').onclick = _icpSaveForm;
  document.getElementById('icpMineBtn').onclick = _icpMineVoC;
  document.getElementById('icpAct1').onclick = _icpActCreativeTarget;
  document.getElementById('icpAct2').onclick = _icpActObjectionPack;
  document.getElementById('icpAct3').onclick = _icpActEmailSequence;
  const scanBtn = document.getElementById('icpScanRedditBtn');
  if (scanBtn) scanBtn.onclick = _icpScanRedditFromStudio;
}

async function _icpScanRedditFromStudio() {
  if (window._icpRedditScanInFlight) return;
  const btn = document.getElementById('icpScanRedditBtn');
  if (btn?.disabled) return;
  window._icpRedditScanInFlight = true;
  const brand = (analysisData?.url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const industry = analysisData?.industry?.name || 'marketing';
  const competitors = (analysisData?.competitors || [])
    .slice(0, 5)
    .map(c => (c?.name || c?.domain || '')).filter(Boolean);
  const keywords = competitors.length ? [] : [industry];

  if (!brand && competitors.length === 0) {
    window._icpRedditScanInFlight = false;
    showToast('⚠️ Run a site analysis first');
    return;
  }
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Scanning…'; btn.style.opacity = '.7'; btn.style.cursor = 'wait'; }
  try {
    const resp = await fetch('/api/reddit-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, keywords, competitors, industry })
    });
    const rawText = await resp.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`Server returned non-JSON (HTTP ${resp.status})`); }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    const posts = data.posts || [];
    window._redditPosts = posts;
    if (posts.length === 0) {
      showToast('🕳️ No threads found — try the full Reddit Monitor with custom keywords');
      if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Try again'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
      return;
    }
    showToast(`✅ Found ${posts.length} Reddit signals — refreshing ICP Studio`);
    buildICPStudio();
  } catch (err) {
    showToast('⚠️ Reddit scan failed: ' + (err.message || err));
    if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Try again'; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
  } finally {
    window._icpRedditScanInFlight = false;
  }
}

function _icpReadForm() {
  const v = id => (document.getElementById(id)?.value || '').trim();
  const list = id => [0,1,2].map(i => v(`${id}-${i}`)).filter(Boolean);
  return {
    ageRange:   v('icp-age'),
    role:       v('icp-role'),
    intent:     v('icp-intent'),
    painPoints: list('icp-pain'),
    desires:    list('icp-desire'),
    budget:     v('icp-budget'),
  };
}

function _icpSaveForm() {
  const icp = _icpReadForm();
  if (!icp.role && !icp.ageRange && icp.painPoints.length === 0) { showToast('⚠️ Add at least one field before saving'); return; }
  window._icpProfile = icp;
  showToast('✅ ICP saved — now mine your VoC or activate it');
  buildICPStudio();
}

async function _icpAutoDraft() {
  if (window._icpAutoDraftInFlight) return;
  window._icpAutoDraftInFlight = true;
  const status = document.getElementById('icpDraftStatus');
  const btn1 = document.getElementById('icpDraftBtn');
  const btn2 = document.getElementById('icpDraftBtn2');
  [btn1, btn2].forEach(b => { if (b) { b.disabled = true; b.style.opacity = '.6'; b.style.cursor = 'wait'; } });
  if (status) { status.style.display = 'block'; }
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 45000);
  try {
    const res = await fetch('/api/icp-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain:      analysisData?.url || 'yourdomain.com',
        industry:    analysisData?.industry?.name || 'your industry',
        country:     analysisData?.country || 'Global',
        competitors: (analysisData?.competitors || []).slice(0, 6),
      }),
      signal: ac.signal
    });
    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`Server returned non-JSON (HTTP ${res.status})`); }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data.icp && (data.icp.role || data.icp.ageRange)) {
      window._icpProfile = {
        ageRange:   data.icp.ageRange   || '',
        role:       data.icp.role       || '',
        intent:     data.icp.intent     || '',
        painPoints: Array.isArray(data.icp.painPoints) ? data.icp.painPoints.slice(0,3) : [],
        desires:    Array.isArray(data.icp.desires)    ? data.icp.desires.slice(0,3)    : [],
        budget:     data.icp.budget     || '',
      };
      showToast('✨ ICP drafted — review & edit, then save');
      buildICPStudio();
    } else {
      throw new Error(data.error || 'Empty draft returned');
    }
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'AI draft timed out after 45s — try again' : (err.message || 'unknown error');
    showToast('⚠️ Draft failed: ' + msg);
    if (status) status.style.display = 'none';
  } finally {
    clearTimeout(timeoutId);
    window._icpAutoDraftInFlight = false;
    // Re-enable any draft buttons currently in the DOM (handles both pre- and post-rerender cases)
    document.querySelectorAll('#icpDraftBtn, #icpDraftBtn2').forEach(b => {
      b.disabled = false;
      b.style.opacity = '1';
      b.style.cursor = 'pointer';
    });
  }
}

async function _icpMineVoC() {
  const icp = _icpReadForm();
  if (!icp.role && !icp.ageRange) { showToast('⚠️ Build & save your ICP first (or auto-draft it)'); return; }
  // Persist current form state as the working ICP
  window._icpProfile = icp;
  const status = document.getElementById('icpMineStatus');
  const btn = document.getElementById('icpMineBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = '⏳ Mining…'; }
  if (status) status.style.display = 'block';
  try {
    const res = await fetch('/api/icp-voc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icp,
        redditPosts:  (window._redditPosts || []).slice(0, 12),
        competitors:  (analysisData?.competitors || []).slice(0, 6),
        industry:     analysisData?.industry?.name || 'your industry',
        domain:       analysisData?.url || 'yourdomain.com',
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    window._icpVoC = {
      triggers:         data.triggers || [],
      objections:       data.objections || [],
      emotionalDrivers: data.emotionalDrivers || [],
    };
    showToast('🎤 Voice-of-Customer mined — activate it on the right →');
    buildICPStudio();
  } catch (err) {
    showToast('⚠️ Mining failed: ' + (err.message || 'unknown error'));
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '🔍 Mine My Data'; }
    if (status) status.style.display = 'none';
  }
}

// ── Activation 1: Send ICP to Creative Studio as target ─────────────────────
function _icpActCreativeTarget() {
  const icp = window._icpProfile;
  if (!icp) { showToast('⚠️ Save your ICP first'); return; }
  // Build a counter-target object Creative Studio will use as persona/audience seed
  window._counterTarget = {
    name: `ICP: ${icp.role || 'Ideal Customer'}`,
    persona: `${icp.ageRange || ''} ${icp.role || ''} (${icp.intent || ''})`.trim(),
    pains:   icp.painPoints || [],
    desires: icp.desires    || [],
    budget:  icp.budget     || '',
    source:  'icp-studio',
    expiresAt: Date.now() + 30*60*1000,
  };
  showToast('🎯 ICP set as Creative Studio target — opening Campaigns…');
  setTimeout(() => navigateTo('campaigns'), 600);
}

// ── Activation 2: Counter-Objection Caption Pack ─────────────────────────────
async function _icpActObjectionPack() {
  const icp = window._icpProfile;
  const voc = window._icpVoC;
  if (!icp || !voc?.objections?.length) { showToast('⚠️ Need ICP + at least 1 objection'); return; }
  const status = document.getElementById('icpActStatus');
  const btn = document.getElementById('icpAct2');
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  if (status) { status.style.display = 'block'; status.textContent = '⏳ Generating 5 counter-objection captions with GPT-4o…'; }

  const domain   = analysisData?.url || 'your brand';
  const industry = analysisData?.industry?.name || 'your industry';
  const objections = voc.objections.slice(0, 5);

  const userPrompt = `Brand: ${domain}
Industry: ${industry}
ICP: ${icp.ageRange||''} ${icp.role||''} · ${icp.intent||''}
Their pains: ${(icp.painPoints||[]).join(' / ')}
Their desires: ${(icp.desires||[]).join(' / ')}

Write exactly ${objections.length} short social-media post captions — one per objection. Each caption flips that objection into a confident, empathetic answer (objection-handling format). 60-90 words each. Plain text. Add 2-3 relevant emojis. End with a soft CTA.

Objections:
${objections.map((o,i)=>`${i+1}. ${o.text}`).join('\n')}

Return JSON: { "captions": [ { "objection": "...", "caption": "..." }, ... ] }`;

  try {
    const res = await fetch('/api/openai', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'gpt-4o',
        messages:[
          {role:'system', content:'You are a senior social media copywriter who specialises in objection-handling content. Return JSON only.'},
          {role:'user',   content:userPrompt}
        ],
        max_tokens: 1200,
        response_format:{type:'json_object'}
      })
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const captions = (parsed.captions || []).filter(c => c.caption);
    if (captions.length === 0) throw new Error('No captions returned');

    if (!window._socialPosts) window._socialPosts = [];
    const today = new Date();
    captions.forEach((c, i) => {
      const d = new Date(today); d.setDate(d.getDate() + i + 1);
      window._socialPosts.push({
        id: 'post_icp_'+Date.now()+'_'+i,
        platform: 'Instagram',
        caption: c.caption,
        scheduledDate: d.toISOString().split('T')[0],
        scheduledTime: '09:00',
        status: 'draft',
        funnelStage: 'nurture',
        archetypeId: 'objection_handle',
        archetypeTitle: 'Objection Handling',
        sourceObjection: c.objection || objections[i]?.text,
        sourceModule: 'icp-studio',
        createdAt: new Date().toLocaleString(),
      });
    });

    showToast(`✊ ${captions.length} counter-objection drafts added to Social Calendar (Drafts)`);
    if (status) { status.innerHTML = `✅ <strong>${captions.length} drafts</strong> added to Social Calendar &nbsp; <a href="#" onclick="navigateTo('social');return false;" style="color:#7C3AED;font-weight:700;text-decoration:underline">Open Calendar →</a>`; }
  } catch (err) {
    showToast('⚠️ Generation failed: ' + (err.message || 'unknown'));
    if (status) status.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

// ── Activation 3: Email sequence for top trigger ─────────────────────────────
async function _icpActEmailSequence() {
  const icp = window._icpProfile;
  const voc = window._icpVoC;
  if (!icp || !voc?.triggers?.length) { showToast('⚠️ Need ICP + at least 1 trigger'); return; }
  const status = document.getElementById('icpActStatus');
  const btn = document.getElementById('icpAct3');
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  if (status) { status.style.display = 'block'; status.textContent = '⏳ Drafting 3-email warm-up sequence with GPT-4o…'; }

  const domain   = analysisData?.url || 'your brand';
  const industry = analysisData?.industry?.name || 'your industry';
  const topTrigger = voc.triggers[0];

  const userPrompt = `Brand: ${domain}
Industry: ${industry}
ICP: ${icp.ageRange||''} ${icp.role||''} · ${icp.intent||''}
Top buying trigger: ${topTrigger.text}
Trigger evidence: ${topTrigger.evidence||''}

Write a 3-email warm-up sequence that leans into this trigger. The reader is the ICP above; this trigger is what makes them buy. Each email should escalate from awareness → consideration → invitation.

Return JSON: {
  "sequence": [
    { "subject": "...", "body": "..." },
    { "subject": "...", "body": "..." },
    { "subject": "...", "body": "..." }
  ]
}

Rules:
- Subject: under 8 words, curiosity-driven, no clickbait clichés.
- Body: 110-150 words, plain text, line breaks between paragraphs.
- Email 1: name the situation that triggers buying, no pitch.
- Email 2: show how ${domain} solves it (1 specific example).
- Email 3: clear soft CTA + 1-line PS.`;

  try {
    const res = await fetch('/api/openai', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        model:'gpt-4o',
        messages:[
          {role:'system', content:'You are a senior B2C/B2B email copywriter. Return JSON only.'},
          {role:'user',   content:userPrompt}
        ],
        max_tokens: 1400,
        response_format:{type:'json_object'}
      })
    });
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(raw);
    const seq = parsed.sequence || [];
    if (seq.length === 0) throw new Error('No sequence returned');
    _icpShowEmailSequenceModal(topTrigger, seq);
    if (status) status.style.display = 'none';
  } catch (err) {
    showToast('⚠️ Generation failed: ' + (err.message || 'unknown'));
    if (status) status.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

function _icpShowEmailSequenceModal(trigger, seq) {
  document.getElementById('icp-email-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'icp-email-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,30,61,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const seqHtml = seq.map((e, i) => `
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px 18px;margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:28px;height:28px;background:linear-gradient(135deg,#0891B2,#7C3AED);color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.78rem">${i+1}</div>
          <div style="font-family:Sora,sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628">${_icpEsc(e.subject)}</div>
        </div>
        <button class="icp-email-copy-btn" data-idx="${i}" style="padding:5px 12px;background:white;border:1px solid #E5E7EB;border-radius:7px;font-size:0.7rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy</button>
      </div>
      <div style="font-size:0.8rem;color:#374151;line-height:1.6;white-space:pre-wrap">${_icpEsc(e.body)}</div>
    </div>`).join('');
  overlay.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:680px;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.3)">
      <div style="background:linear-gradient(135deg,#0891B2,#7C3AED);border-radius:18px 18px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:0.65rem;font-weight:700;color:#A5F3FC;-webkit-text-fill-color:#A5F3FC;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">3-Email Warm-Up Sequence</div>
          <div style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:#fff;-webkit-text-fill-color:#fff;line-height:1.3;text-shadow:0 1px 2px rgba(0,0,0,.35)">⚡ Trigger: ${_icpEsc(trigger.text)}</div>
        </div>
        <button id="icp-email-close" style="background:rgba(255,255,255,.18);border:none;border-radius:50%;width:32px;height:32px;font-size:1.1rem;color:white;cursor:pointer">✕</button>
      </div>
      <div style="padding:20px 22px">
        ${seqHtml}
        <div style="display:flex;gap:10px;margin-top:8px">
          <button id="icp-email-copyall" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:#374151;cursor:pointer">📋 Copy All 3 Emails</button>
          <button id="icp-email-toreengage" style="flex:1;padding:11px;background:linear-gradient(135deg,#7C3AED,#EC4899);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">→ Open Re-Engage Hub</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('icp-email-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  // Per-email copy buttons (no inline onclick — body content is bound from JS, never injected as HTML)
  overlay.querySelectorAll('.icp-email-copy-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const item = seq[idx];
      if (!item) return;
      navigator.clipboard.writeText(item.body || '');
      btn.textContent = '✅ Copied';
    };
  });
  document.getElementById('icp-email-copyall').onclick = () => {
    const text = seq.map((e,i) => `EMAIL ${i+1}\nSubject: ${e.subject || ''}\n\n${e.body || ''}\n\n────────────────\n`).join('\n');
    navigator.clipboard.writeText(text);
    document.getElementById('icp-email-copyall').textContent = '✅ All 3 copied';
  };
  document.getElementById('icp-email-toreengage').onclick = () => { overlay.remove(); navigateTo('reengage'); };
}

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH INTENT MAP — classify keywords by intent + page-fit + competitor gap
// ═══════════════════════════════════════════════════════════════════════════
window._intentMap = window._intentMap || null; // { keywords: [...], summary: {...} }

function _imEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _imSeedKeywords() {
  // Pull a sensible default seed from analysisData: competitor topKeywords + brand-anchored navigationals
  const seeds = new Set();
  const ad = window.analysisData || {};
  (ad.competitors || []).forEach(c => {
    (c.topKeywords || []).slice(0, 3).forEach(k => seeds.add(String(k).toLowerCase()));
  });
  // Brand-anchored navigational candidates (use the actual brand/domain)
  const rawDomain = String(ad.url || '').replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/^www\./, '');
  const brandRoot = rawDomain.split('.')[0];
  if (brandRoot) {
    seeds.add(`${brandRoot} reviews`);
    seeds.add(`${brandRoot} login`);
    seeds.add(`is ${brandRoot} legit`);
  }
  // Top competitor brand-vs-brand comparison if both exist
  const topComp = (ad.competitors || []).map(c => c.name).filter(Boolean)[0];
  if (brandRoot && topComp) seeds.add(`${brandRoot} vs ${topComp}`);
  // Industry-anchored commercial seeds as fallback
  if (ad.industry?.name) {
    seeds.add(`best ${ad.industry.name} platform`);
    seeds.add(`how to choose a ${ad.industry.name} provider`);
  }
  return Array.from(seeds).slice(0, 12).join(', ');
}

function buildIntentMap() {
  const wrap = document.getElementById('intentMapWrap');
  if (!wrap) return;

  const ad       = window.analysisData || {};
  const brand    = _imEsc(ad.url || 'your brand');
  const url      = _imEsc(ad.url || '');
  const industry = _imEsc(ad.industry?.name || 'your industry');
  const compsArr = (ad.competitors || []).map(c => c.name).filter(Boolean);
  const compsCsv = _imEsc(compsArr.join(', '));
  const seedCsv  = _imEsc(_imSeedKeywords());
  const map      = window._intentMap;

  wrap.innerHTML = `
    <!-- CONFIG PANEL -->
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:22px 24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
        <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#0066FF,#7C3AED);display:flex;align-items:center;justify-content:center;font-size:1.1rem">⚙️</div>
        <div>
          <div style="font-size:0.95rem;font-weight:800;color:#0A1628">Intent Map Settings</div>
          <div style="font-size:0.75rem;color:#64748B">Keywords are classified by GPT-4o into 4 intent buckets and matched to the right page type.</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div>
          <label style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;display:block">Your brand / domain</label>
          <input id="im-brand" type="text" value="${brand}" placeholder="yourdomain.com" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.85rem;color:#0A1628;outline:none">
        </div>
        <div>
          <label style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;display:block">Competitors (comma-separated)</label>
          <input id="im-comps" type="text" value="${compsCsv}" placeholder="OANDA, Plus500, FXCM" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.85rem;color:#0A1628;outline:none">
        </div>
      </div>
      <div>
        <label style="font-size:0.7rem;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;display:block">Keywords to classify (comma-separated · up to 40)</label>
        <textarea id="im-keywords" rows="3" placeholder="forex trading, CFD broker reviews, best forex platform, open trading account, Plus500 vs OANDA" style="width:100%;box-sizing:border-box;padding:10px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.85rem;color:#0A1628;outline:none;font-family:inherit;resize:vertical">${seedCsv}</textarea>
        <div style="font-size:0.7rem;color:#94A3B8;margin-top:6px">Auto-seeded from your competitor analysis. Edit freely.</div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button id="im-gen-btn" onclick="generateIntentMap()" style="padding:10px 22px;background:linear-gradient(135deg,#0066FF,#7C3AED);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer;min-width:200px;display:inline-flex;align-items:center;justify-content:center;gap:6px"><span id="im-gen-btn-label">⚡ Generate Intent Map</span></button>
      </div>
    </div>

    <div id="im-results">${map ? _imRender(map) : _imEmptyState()}</div>
  `;

  // Wire the header button to the same handler
  const hdrBtn = document.getElementById('intentRunBtn');
  if (hdrBtn) hdrBtn.onclick = () => generateIntentMap();
}

function _imEmptyState() {
  return `
    <div style="background:white;border:1px dashed #CBD5E1;border-radius:16px;padding:60px 24px;text-align:center">
      <div style="font-size:3rem;margin-bottom:14px">🧭</div>
      <div style="font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">Ready to map your search intent</div>
      <div style="font-size:0.85rem;color:#64748B;max-width:520px;margin:0 auto;line-height:1.5">Enter your keywords above and click <strong style="color:#0066FF">Generate Intent Map</strong>. GPT-4o will classify each one into Informational, Commercial, Transactional or Navigational, recommend the right page type, and flag gaps your competitors are exploiting.</div>
    </div>`;
}

async function generateIntentMap() {
  // Defensive busy guard — blocks concurrent calls from ANY entry point
  // (in-card #im-gen-btn, header #intentRunBtn, programmatic calls, etc.)
  if (window._imBusy) { showToast('⏳ Already generating — please wait for the current map to finish'); return; }

  const brand    = (document.getElementById('im-brand')?.value || '').trim();
  const compsCsv = (document.getElementById('im-comps')?.value || '').trim();
  const kwCsv    = (document.getElementById('im-keywords')?.value || '').trim();

  const keywords    = kwCsv.split(',').map(s => s.trim()).filter(Boolean);
  const competitors = compsCsv.split(',').map(s => s.trim()).filter(Boolean);

  if (keywords.length === 0) { showToast('⚠️ Enter at least one keyword to classify'); return; }
  if (keywords.length > 40)  { showToast('ℹ️ Capping at the first 40 keywords'); }
  window._imBusy = true;

  const ad       = window.analysisData || {};
  const url      = ad.url || brand;
  const industry = ad.industry?.name || 'marketing';

  const out = document.getElementById('im-results');
  if (out) out.innerHTML = `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:16px;padding:60px 24px;text-align:center">
      <div style="width:48px;height:48px;border:4px solid rgba(0,102,255,.2);border-top-color:#0066FF;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px"></div>
      <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:700;color:#0A1628;margin-bottom:6px">Classifying ${keywords.length} keyword${keywords.length===1?'':'s'}… <span id="im-timer" style="color:#0066FF">0s</span></div>
      <div style="font-size:0.78rem;color:#64748B;margin-bottom:8px">GPT-4o is mapping intent, page-type fit, and competitor gaps</div>
      <div style="font-size:0.72rem;color:#94A3B8">⏱ Usually takes 8–18 seconds</div>
    </div>`;

  // Disable button + start live counter (mirrored on button label and inside loader)
  const btn      = document.getElementById('im-gen-btn');
  const btnLabel = document.getElementById('im-gen-btn-label');
  const origText = btnLabel ? btnLabel.textContent : '⚡ Generate Intent Map';
  if (btn) { btn.disabled = true; btn.style.opacity = '0.75'; btn.style.cursor = 'wait'; }
  let _imSec = 0;
  if (btnLabel) btnLabel.textContent = '⏱ 0s · Generating…';
  const _imTick = setInterval(() => {
    _imSec++;
    const tEl = document.getElementById('im-timer');
    if (tEl) tEl.textContent = _imSec + 's';
    if (btnLabel) btnLabel.textContent = '⏱ ' + _imSec + 's · Generating…';
  }, 1000);
  const _imRestoreBtn = () => {
    clearInterval(_imTick);
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
    if (btnLabel) btnLabel.textContent = origText;
    window._imBusy = false;
  };

  try {
    const resp = await fetch('/api/intent-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, url, industry, keywords, competitors })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

    window._intentMap = data;
    if (out) out.innerHTML = _imRender(data);
    showToast(`✅ Mapped ${data.summary.total} keywords in ${_imSec}s · ${data.summary.gaps} competitor gap${data.summary.gaps===1?'':'s'} · ${data.summary.mustDoCount} must-do`);
  } catch(err) {
    if (out) out.innerHTML = `
      <div style="background:white;border:1px solid #FECACA;border-radius:16px;padding:40px 24px;text-align:center">
        <div style="font-size:2rem;margin-bottom:10px">⚠️</div>
        <div style="font-size:0.9rem;font-weight:700;color:#DC2626;margin-bottom:8px">Intent mapping failed</div>
        <div style="font-size:0.8rem;color:#64748B;margin-bottom:14px;max-width:480px;margin-left:auto;margin-right:auto">${_imEsc(err.message)}</div>
        <button onclick="generateIntentMap()" style="padding:9px 20px;background:#0066FF;color:white;border:none;border-radius:8px;font-size:0.78rem;cursor:pointer;font-weight:700">🔄 Try Again</button>
      </div>`;
  } finally {
    _imRestoreBtn();
  }
}

function _imRender(data) {
  const { keywords, summary } = data;
  const buckets = [
    { key: 'informational', label: 'Informational', icon: '📚', color: '#0066FF', bg: '#EFF6FF', desc: 'User wants to learn' },
    { key: 'commercial',    label: 'Commercial',    icon: '⚖️', color: '#7C3AED', bg: '#F5F3FF', desc: 'User comparing options' },
    { key: 'transactional', label: 'Transactional', icon: '💳', color: '#10B981', bg: '#ECFDF5', desc: 'User ready to buy' },
    { key: 'navigational',  label: 'Navigational',  icon: '🧭', color: '#F59E0B', bg: '#FEF3C7', desc: 'User searching a brand' }
  ];

  // SUMMARY BAR — 5 tiles
  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
      <div style="background:linear-gradient(135deg,#062A36,#0A4858);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#00E5FF">${summary.total}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.95);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Keywords Mapped</div>
      </div>
      <div style="background:linear-gradient(135deg,#1a0a28,#2D1060);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#A78BFA">${summary.byIntent.commercial + summary.byIntent.transactional}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.95);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">High-Intent</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A2818,#0D5E30);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#10B981">${summary.avgIntentMatch}%</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.95);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Avg Page-Fit</div>
      </div>
      <div style="background:linear-gradient(135deg,#3a1a0a,#7C2D12);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#FB923C">${summary.gaps}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.95);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Competitor Gaps</div>
      </div>
      <div style="background:linear-gradient(135deg,#28080a,#7C0E20);border-radius:14px;padding:18px 16px;text-align:center">
        <div style="font-size:1.6rem;font-weight:800;color:#F87171">${summary.mustDoCount}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,.95);margin-top:6px;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Must-Do</div>
      </div>
    </div>`;

  // ACTIONS BAR
  const actionsHtml = `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div style="font-size:0.82rem;color:#0A1628"><strong>📋 Send must-do keywords to your Battle Plan</strong> — automatically queues high-priority gaps for your 90-day plan.</div>
      <div style="display:flex;gap:8px">
        <button onclick="_imExportCsv()" style="padding:8px 16px;background:white;border:1.5px solid #CBD5E1;border-radius:8px;font-size:0.78rem;font-weight:700;color:#475569;cursor:pointer">⬇️ Export CSV</button>
        <button onclick="_imSendToBattlePlan()" style="padding:8px 16px;background:linear-gradient(135deg,#0066FF,#7C3AED);border:none;border-radius:8px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">⚔️ Send to Battle Plan</button>
      </div>
    </div>`;

  // 4-COLUMN BUCKETS
  const colsHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
      ${buckets.map(b => {
        const items = keywords.filter(k => k.intent === b.key);
        return `
          <div style="background:white;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;display:flex;flex-direction:column">
            <div style="background:${b.bg};border-bottom:1px solid ${b.color}33;padding:14px 16px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                <div style="display:flex;align-items:center;gap:8px"><span style="font-size:1.1rem">${b.icon}</span><span style="font-size:0.9rem;font-weight:800;color:${b.color}">${b.label}</span></div>
                <span style="background:${b.color};color:white;font-size:0.72rem;font-weight:700;padding:3px 9px;border-radius:999px">${items.length}</span>
              </div>
              <div style="font-size:0.7rem;color:${b.color}AA;font-weight:600">${b.desc}</div>
            </div>
            <div style="padding:12px;display:flex;flex-direction:column;gap:10px;min-height:120px">
              ${items.length === 0
                ? `<div style="text-align:center;padding:24px 8px;color:#94A3B8;font-size:0.78rem">No keywords in this bucket</div>`
                : items.map(k => _imCard(k, b.color)).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  return summaryHtml + actionsHtml + colsHtml;
}

function _imCard(k, accent) {
  const priorityBadge = {
    'must-do':       `<span style="background:#FEE2E2;color:#B91C1C;font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:6px">🔥 MUST-DO</span>`,
    'nice-to-have':  `<span style="background:#FEF3C7;color:#A16207;font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:6px">★ NICE-TO-HAVE</span>`,
    'skip':          `<span style="background:#F1F5F9;color:#64748B;font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:6px">SKIP</span>`
  }[k.priority] || '';

  const gapBadge = k.competitorGap
    ? `<span style="background:#FEE2E2;color:#B91C1C;font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:6px">⚠️ GAP</span>`
    : '';

  const cpcColor = { low:'#10B981', medium:'#F59E0B', high:'#EF4444' }[k.estimatedCPC] || '#64748B';

  // Page-fit progress bar
  const fitColor = k.intentMatchScore >= 70 ? '#10B981' : k.intentMatchScore >= 40 ? '#F59E0B' : '#EF4444';

  return `
    <div style="border:1px solid #E2E8F0;border-radius:10px;padding:11px 12px;background:#FAFBFC">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="font-size:0.83rem;font-weight:700;color:#0A1628;line-height:1.3;flex:1">${_imEsc(k.keyword)}</div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
        ${priorityBadge}
        ${gapBadge}
        <span style="background:white;border:1px solid #CBD5E1;color:${cpcColor};font-size:0.65rem;font-weight:700;padding:2px 7px;border-radius:6px">${k.estimatedCPC.toUpperCase()} CPC</span>
      </div>
      <div style="font-size:0.72rem;color:#475569;margin-bottom:6px"><strong style="color:${accent}">→ ${_imEsc(k.recommendedPageType)}</strong></div>
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;font-size:0.66rem;color:#64748B;margin-bottom:3px"><span>Intent confidence</span><span style="color:${accent};font-weight:700">${k.confidence}%</span></div>
        <div style="height:4px;background:#E2E8F0;border-radius:3px;overflow:hidden"><div style="width:${k.confidence}%;height:100%;background:${accent}"></div></div>
      </div>
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:0.66rem;color:#64748B;margin-bottom:3px"><span>Page-fit</span><span style="color:${fitColor};font-weight:700">${k.intentMatchScore}%</span></div>
        <div style="height:5px;background:#E2E8F0;border-radius:3px;overflow:hidden"><div style="width:${k.intentMatchScore}%;height:100%;background:${fitColor}"></div></div>
        ${k.matchReason ? `<div style="font-size:0.66rem;color:#64748B;line-height:1.35;margin-top:4px;font-style:italic">${_imEsc(k.matchReason)}</div>` : ''}
      </div>
      <div style="font-size:0.72rem;color:#475569;line-height:1.4;border-top:1px solid #F1F5F9;padding-top:7px">💡 ${_imEsc(k.opportunity)}</div>
      ${k.competitorGap && k.gapReason ? `<div style="font-size:0.7rem;color:#B91C1C;line-height:1.4;margin-top:5px">⚠️ ${_imEsc(k.gapReason)}</div>` : ''}
    </div>`;
}

function _imExportCsv() {
  const map = window._intentMap;
  if (!map?.keywords?.length) { showToast('⚠️ Generate the intent map first'); return; }
  const rows = [['Keyword','Intent','Confidence','Recommended Page Type','Page-Fit Score','Page-Fit Reason','Competitor Gap','Gap Reason','Priority','Estimated CPC','Opportunity']];
  map.keywords.forEach(k => rows.push([
    k.keyword, k.intent, k.confidence, k.recommendedPageType, k.intentMatchScore,
    k.matchReason || '', k.competitorGap ? 'YES' : 'no', k.gapReason || '', k.priority, k.estimatedCPC, k.opportunity
  ]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `intent-map-${Date.now()}.csv`;
  a.click();
  showToast('✅ CSV downloaded');
}

function _imSendToBattlePlan() {
  const map = window._intentMap;
  if (!map?.keywords?.length) { showToast('⚠️ Generate the intent map first'); return; }
  const mustDos = map.keywords.filter(k => k.priority === 'must-do');
  if (mustDos.length === 0) { showToast('ℹ️ No must-do keywords to send'); return; }
  // Persist for the Battle Plan to consume
  window._intentMustDos = mustDos;
  try { localStorage.setItem('infogenie_intent_mustdos', JSON.stringify(mustDos)); } catch {}
  showToast(`⚔️ Queued ${mustDos.length} must-do keyword${mustDos.length===1?'':'s'} for Battle Plan`);
  setTimeout(() => navigateTo('battleplan'), 600);
}

// ─── KEYWORD–PAGE MAP ────────────────────────────────────────────────
function _kmEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _kmNormaliseUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s.replace(/\/$/, '');
}

function _kmYourSite() {
  const ad = window.analysisData || {};
  return _kmNormaliseUrl(ad.url || '');
}

function _kmSeedPages() {
  // Default to just the user's homepage; subpaths are opt-in via quick-add chips
  const base = _kmYourSite();
  return base ? base : '';
}

function _kmAddPage(url) {
  const ta = document.getElementById('kmPagesInput');
  if (!ta || !url) return;
  const clean = _kmNormaliseUrl(url);
  const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
  // Avoid duplicates (compare on URL part before any | title)
  const exists = lines.some(l => l.split('|')[0].trim().replace(/\/$/, '') === clean);
  if (exists) { showToast('ℹ️ Already in the list'); return; }
  ta.value = lines.concat([clean]).join('\n');
  showToast('➕ Page added');
}

function _kmAddCommonPaths() {
  const base = _kmYourSite();
  if (!base) { showToast('⚠️ Run a brand analysis first to auto-add pages'); return; }
  ['/about','/pricing','/blog','/contact','/features'].forEach(p => _kmAddPage(base + p));
}

function _kmAddCompetitor() {
  const sel = document.getElementById('kmCompSelect');
  if (!sel || !sel.value) { showToast('ℹ️ Pick a competitor first'); return; }
  if (sel.value === '__km_select_all__') {
    // Batch-add every competitor URL silently, then show one summary toast
    const ta = document.getElementById('kmPagesInput');
    if (!ta) return;
    const urls = Array.from(sel.options)
      .map(o => o.value)
      .filter(v => v && v !== '__km_select_all__');
    if (!urls.length) { showToast('ℹ️ No competitors to add'); return; }
    const existing = new Set(
      ta.value.split('\n').map(l => l.split('|')[0].trim().replace(/\/$/,'')).filter(Boolean)
    );
    const toAdd = [];
    urls.forEach(u => {
      const clean = _kmNormaliseUrl(u);
      if (!existing.has(clean)) { toAdd.push(clean); existing.add(clean); }
    });
    if (toAdd.length) {
      const lines = ta.value.split('\n').map(l => l.trim()).filter(Boolean);
      ta.value = lines.concat(toAdd).join('\n');
    }
    showToast(toAdd.length ? `✅ Added all ${toAdd.length} competitor${toAdd.length===1?'':'s'}` : 'ℹ️ All competitors already in the list');
    sel.value = '';
    return;
  }
  _kmAddPage(sel.value);
  sel.value = '';
}

// Refresh keyword pool from Intent Map (used by both the action-row button
// and the inline refresh icon next to the keyword pool label). Strictly
// gated on Intent Map availability so the toast copy is always accurate.
function _kmRefreshKeywordsFromIntent() {
  const ta = document.getElementById('kmKwInput');
  if (!ta) return;
  const im = window._intentMap;
  if (!im || !Array.isArray(im.keywords) || !im.keywords.length) {
    showToast('ℹ️ No Intent Map data yet — run Intent Map first to seed keywords');
    return;
  }
  const fresh = _kmSeedKeywords();
  if (!fresh) {
    showToast('ℹ️ Intent Map is empty — nothing to refresh');
    return;
  }
  ta.value = fresh;
  showToast('🔄 Refreshed keywords from Intent Map');
}
try { window._kmRefreshKeywordsFromIntent = _kmRefreshKeywordsFromIntent; } catch(e) {}

function _kmSeedKeywords() {
  // Pull from Intent Map first, then competitor topKeywords
  const seeds = new Set();
  const im = window._intentMap;
  if (im?.keywords?.length) {
    im.keywords.forEach(k => seeds.add(String(k.keyword || '').toLowerCase()));
  }
  const ad = window.analysisData || {};
  (ad.competitors || []).forEach(c => {
    (c.topKeywords || []).slice(0, 4).forEach(k => seeds.add(String(k).toLowerCase()));
  });
  return Array.from(seeds).filter(Boolean).slice(0, 40).join(', ');
}

function buildKeywordMap() {
  const wrap = document.getElementById('keywordMapWrap');
  if (!wrap) return;
  const ad = window.analysisData || {};
  const yourSite = _kmYourSite();
  const competitors = (ad.competitors || []).filter(c => c && (c.url || c.name));
  const seedPages = _kmSeedPages();
  const seedKws = _kmSeedKeywords();
  const noAnalysis = !yourSite;

  // Build competitor dropdown options (with "Select All" when ≥2 competitors)
  const compOptions = competitors.length
    ? (competitors.length >= 2
        ? `<option value="__km_select_all__">⭐ Select all competitors (${competitors.length})</option>`
        : '') +
      competitors.map(c => {
        const url = _kmNormaliseUrl(c.url || '');
        const label = `${c.name || url}${url ? ' (' + url.replace(/^https?:\/\//,'') + ')' : ''}`;
        return `<option value="${_kmEsc(url || c.name || '')}">${_kmEsc(label)}</option>`;
      }).join('')
    : '<option value="" disabled>No competitors found — run a brand analysis first</option>';

  wrap.innerHTML = `
    ${noAnalysis ? `
      <div style="background:#FFFBEB;border:1.5px solid #FCD34D;border-radius:12px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:1.3rem">💡</span>
        <div style="flex:1">
          <div style="font-weight:700;color:#92400E;font-size:0.88rem;margin-bottom:2px">Run a brand analysis first for the best experience</div>
          <div style="font-size:0.75rem;color:#78350F">Without it your URL and competitors won't auto-fill — but you can still type a URL manually below.</div>
        </div>
      </div>` : ''}

    <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 10px rgba(0,0,0,.05);margin-bottom:20px">

      <!-- Your site banner -->
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:linear-gradient(135deg,#EFF6FF,#F0F9FF);border:1.5px solid #BAE6FD;border-radius:12px;margin-bottom:16px">
        <span style="font-size:1.2rem">🌐</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:0.66rem;color:#0369A1;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Your site</div>
          <div style="font-size:0.88rem;font-weight:800;color:#0F172A;word-break:break-all">${yourSite ? _kmEsc(yourSite) : '<em style="color:#94A3B8">Not set — type a URL in the page list below</em>'}</div>
        </div>
        ${yourSite ? `<button onclick="_kmAddPage('${_kmEsc(yourSite)}')" style="background:white;color:#0EA5E9;border:1.5px solid #0EA5E9;padding:6px 12px;border-radius:8px;font-size:0.74rem;font-weight:700;cursor:pointer;white-space:nowrap">+ Add homepage</button>` : ''}
      </div>

      <!-- Quick-add row: competitor dropdown + common paths -->
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-bottom:14px;align-items:end">
        <div>
          <label style="display:block;font-size:0.72rem;font-weight:700;color:#475569;margin-bottom:5px">⚔️ Add a competitor's site to compare</label>
          <div style="display:flex;gap:8px">
            <select id="kmCompSelect" style="flex:1;padding:9px 11px;border:1.5px solid #CBD5E1;border-radius:8px;font-size:0.82rem;background:white;cursor:pointer">
              <option value="">Choose a competitor…</option>
              ${compOptions}
            </select>
            <button onclick="_kmAddCompetitor()" style="background:#7C3AED;color:white;border:none;padding:9px 16px;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap">➕ Add</button>
          </div>
        </div>
        <div>
          <label style="display:block;font-size:0.72rem;font-weight:700;color:#475569;margin-bottom:5px">⚡ Quick-add</label>
          <button onclick="_kmAddCommonPaths()" style="background:white;color:#0EA5E9;border:1.5px solid #0EA5E9;padding:9px 14px;border-radius:8px;font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap" ${yourSite?'':'disabled'}>+ Common pages (about, pricing, blog…)</button>
        </div>
      </div>

      <!-- Pages + keyword pool side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        <div>
          <label style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:6px">📄 Pages to map (one per line)</label>
          <textarea id="kmPagesInput" rows="7" style="width:100%;padding:10px 12px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.82rem;font-family:inherit;resize:vertical" placeholder="https://yourdomain.com&#10;https://yourdomain.com/pricing">${_kmEsc(seedPages)}</textarea>
          <div style="font-size:0.68rem;color:#64748B;margin-top:4px">Optional: append <code>| Page Title</code> for better mapping. Up to 30 pages.</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
            <label style="display:block;font-size:0.78rem;font-weight:700;color:#0F172A;margin:0">🔑 Keyword pool (comma-separated)</label>
            <button type="button" onclick="_kmRefreshKeywordsFromIntent()" title="Refresh keyword pool from your latest Intent Map data" style="display:inline-flex;align-items:center;gap:5px;background:#F0F9FF;color:#0369A1;border:1px solid #BAE6FD;padding:4px 10px;border-radius:7px;font-size:0.7rem;font-weight:700;cursor:pointer;white-space:nowrap">🔄 Refresh</button>
          </div>
          <textarea id="kmKwInput" rows="7" style="width:100%;padding:10px 12px;border:1.5px solid #CBD5E1;border-radius:10px;font-size:0.82rem;font-family:inherit;resize:vertical" placeholder="forex broker, best forex broker, mt4 platform…">${_kmEsc(seedKws)}</textarea>
          <div style="font-size:0.68rem;color:#64748B;margin-top:4px">Pre-filled from your Intent Map ${window._intentMap ? '✅' : '— run Intent Map first or paste your own'}. Up to 80 keywords.</div>
        </div>
      </div>

      <!-- Action row -->
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <button onclick="generateKeywordMap()" style="background:linear-gradient(135deg,#0EA5E9,#6366F1);color:white;border:none;padding:11px 22px;border-radius:10px;font-weight:700;font-size:0.9rem;cursor:pointer;box-shadow:0 4px 12px rgba(14,165,233,.3)">⚡ Generate Map</button>
        <button onclick="_kmRefreshKeywordsFromIntent()" style="background:white;color:#0EA5E9;border:1.5px solid #0EA5E9;padding:11px 18px;border-radius:10px;font-weight:700;font-size:0.85rem;cursor:pointer">🔄 Refresh keywords from Intent Map</button>
      </div>
    </div>
    <div id="kmResult"></div>
  `;
  // Wire header button
  const headerBtn = document.getElementById('kmRunBtn');
  if (headerBtn) headerBtn.onclick = () => generateKeywordMap();

  // Auto-render previous result if present
  if (window._keywordMap) _kmRender();

  // ── Auto-pull from Intent Map on every view-open ──────────────────────────
  // If the Intent Map exists and has keywords, refresh the keyword pool so the
  // user always sees the latest intent data without having to click the button.
  // Show a subtle confirmation toast (only once per session per intent-map version).
  try {
    const im = window._intentMap;
    const kwInput = document.getElementById('kmKwInput');
    if (im?.keywords?.length && kwInput) {
      const fresh = _kmSeedKeywords();
      if (fresh && fresh !== kwInput.value) {
        kwInput.value = fresh;
      }
      // Toast once per Intent Map "version" (first kw + count) per page session
      const stamp = `${im.keywords.length}:${(im.keywords[0]?.keyword || '').slice(0,40)}`;
      if (window._kmAutoToastStamp !== stamp) {
        window._kmAutoToastStamp = stamp;
        setTimeout(() => showToast(`🔄 Auto-pulled ${im.keywords.length} keywords from Intent Map`), 250);
      }
    }
  } catch(e) { console.warn('Keyword Map auto-pull skipped:', e); }
}

async function generateKeywordMap() {
  const result = document.getElementById('kmResult');
  if (!result) return;
  const pagesRaw = (document.getElementById('kmPagesInput')?.value || '').split('\n').map(l => l.trim()).filter(Boolean);
  const kwRaw = (document.getElementById('kmKwInput')?.value || '').split(',').map(k => k.trim()).filter(Boolean);
  if (!pagesRaw.length) { showToast('⚠️ Add at least one page URL'); return; }
  if (!kwRaw.length) { showToast('⚠️ Add at least one keyword'); return; }

  const pages = pagesRaw.map(line => {
    const [urlPart, titlePart] = line.split('|').map(s => s.trim());
    return { url: urlPart, title: titlePart || '' };
  }).filter(p => p.url);

  result.innerHTML = `
    <div style="background:white;border-radius:16px;padding:50px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05)">
      <div style="display:inline-block;width:46px;height:46px;border:4px solid #E2E8F0;border-top-color:#0EA5E9;border-radius:50%;animation:spin 0.8s linear infinite"></div>
      <div style="margin-top:18px;font-size:0.95rem;color:#475569;font-weight:600">Mapping ${pages.length} page${pages.length===1?'':'s'} against ${kwRaw.length} keyword${kwRaw.length===1?'':'s'}…</div>
      <div style="margin-top:6px;font-size:0.78rem;color:#94A3B8">GPT-4o is choosing the best primary keyword for each page and detecting cannibalisation.</div>
    </div>`;

  const ad = window.analysisData || {};
  try {
    const resp = await fetch('/api/keyword-page-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: ad.url || '',
        industry: ad.industry?.name || '',
        pages,
        keywords: kwRaw
      })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      result.innerHTML = `
        <div style="background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:14px;padding:22px;text-align:center">
          <div style="font-size:1.4rem;margin-bottom:8px">⚠️</div>
          <div style="font-weight:700;color:#991B1B;margin-bottom:6px">Couldn't generate the map</div>
          <div style="font-size:0.85rem;color:#7F1D1D;margin-bottom:14px">${_kmEsc(data.error || ('HTTP '+resp.status))}</div>
          <button onclick="generateKeywordMap()" style="background:#DC2626;color:white;border:none;padding:9px 18px;border-radius:8px;font-weight:700;cursor:pointer">🔄 Try Again</button>
        </div>`;
      return;
    }
    window._keywordMap = data;
    _kmRender();
  } catch(err) {
    console.error('generateKeywordMap error:', err);
    result.innerHTML = `
      <div style="background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:14px;padding:22px;text-align:center">
        <div style="font-size:1.4rem;margin-bottom:8px">⚠️</div>
        <div style="font-weight:700;color:#991B1B;margin-bottom:6px">Network error</div>
        <div style="font-size:0.85rem;color:#7F1D1D;margin-bottom:14px">${_kmEsc(err.message || 'Unknown error')}</div>
        <button onclick="generateKeywordMap()" style="background:#DC2626;color:white;border:none;padding:9px 18px;border-radius:8px;font-weight:700;cursor:pointer">🔄 Try Again</button>
      </div>`;
  }
}

function _kmRender() {
  const result = document.getElementById('kmResult');
  if (!result) return;
  const map = window._keywordMap;
  if (!map?.pages?.length) { result.innerHTML = ''; return; }
  const s = map.summary || {};

  // Summary tiles (dark gradient — matches Intent Map / ROAS pattern)
  const tile = (label, value, accent) => `
    <div style="background:linear-gradient(135deg,#062A36,#0A4858);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px;color:#FFFFFF">
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.08em;color:#E2E8F0;font-weight:800;margin-bottom:8px;text-shadow:0 1px 2px rgba(0,0,0,.4)">${_kmEsc(label)}</div>
      <div style="font-size:1.85rem;font-weight:900;color:${accent};text-shadow:0 1px 2px rgba(0,0,0,.35);line-height:1.1">${_kmEsc(value)}</div>
    </div>`;
  const tiles = `
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:18px">
      ${tile('Pages mapped', s.totalPages || 0, '#00E5FF')}
      ${tile('Unique primaries', s.uniquePrimaries || 0, '#34D399')}
      ${tile('Avg page strength', (s.avgPageStrength || 0) + '%', '#FBBF24')}
      ${tile('Cannibal. keywords', s.cannibalisedKeywords || 0, s.cannibalisedKeywords > 0 ? '#F87171' : '#94A3B8')}
      ${tile('Cannibal. pages', s.cannibalisedPages || 0, s.cannibalisedPages > 0 ? '#F87171' : '#94A3B8')}
    </div>`;

  // Cannibalisation alert section
  let cannibalAlert = '';
  if (Array.isArray(map.cannibalGroups) && map.cannibalGroups.length) {
    cannibalAlert = `
      <div style="background:linear-gradient(135deg,#FEF2F2,#FFF1F2);border:2px solid #FCA5A5;border-radius:14px;padding:18px;margin-bottom:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:1.4rem">⚠️</span>
          <div style="font-weight:800;color:#991B1B;font-size:1rem">Cannibalisation detected — ${map.cannibalGroups.length} keyword${map.cannibalGroups.length===1?'':'s'} targeted by multiple pages</div>
        </div>
        <div style="font-size:0.78rem;color:#7F1D1D;margin-bottom:12px">When two pages chase the same primary keyword, they split authority and Google often ranks the wrong one. Pick a single winner per keyword and re-target the others.</div>
        ${map.cannibalGroups.map(g => `
          <div style="background:white;border:1px solid #FECACA;border-radius:10px;padding:12px;margin-bottom:8px">
            <div style="font-weight:700;color:#0F172A;margin-bottom:6px">"${_kmEsc(g.keyword)}" — ${g.count} pages competing</div>
            <ul style="margin:0;padding-left:18px;font-size:0.78rem;color:#475569">
              ${g.urls.map(u => `<li style="margin-bottom:2px"><code style="background:#F1F5F9;padding:1px 5px;border-radius:4px;font-size:0.74rem">${_kmEsc(u)}</code></li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>`;
  } else {
    cannibalAlert = `
      <div style="background:#F0FDF4;border:1.5px solid #86EFAC;border-radius:12px;padding:14px;margin-bottom:18px;display:flex;align-items:center;gap:10px">
        <span style="font-size:1.2rem">✅</span>
        <div style="font-weight:700;color:#166534;font-size:0.9rem">No cannibalisation — every page targets a unique primary keyword.</div>
      </div>`;
  }

  // Page rows
  const rows = map.pages.map(p => {
    const strength = p.pageStrengthScore || 0;
    const sColor = strength >= 75 ? '#10B981' : strength >= 50 ? '#F59E0B' : '#EF4444';
    const cColor = p.primaryConfidence >= 75 ? '#10B981' : p.primaryConfidence >= 50 ? '#F59E0B' : '#EF4444';
    const statusBadge = p.cannibalised
      ? `<span style="background:#FEE2E2;color:#991B1B;font-size:0.65rem;font-weight:800;padding:3px 8px;border-radius:6px">⚠️ CANNIBALISED</span>`
      : `<span style="background:#DCFCE7;color:#166534;font-size:0.65rem;font-weight:800;padding:3px 8px;border-radius:6px">✅ UNIQUE</span>`;
    return `
      <div style="background:white;border-radius:12px;padding:16px;border:1.5px solid ${p.cannibalised?'#FCA5A5':'#E2E8F0'};margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
          <div style="flex:1;min-width:0">
            <div style="font-size:0.7rem;color:#64748B;font-weight:600;margin-bottom:3px">URL</div>
            <code style="font-size:0.78rem;color:#0F172A;font-weight:600;word-break:break-all">${_kmEsc(p.url)}</code>
          </div>
          ${statusBadge}
        </div>
        <div style="display:grid;grid-template-columns:1.4fr 2fr;gap:14px;margin-bottom:10px">
          <div>
            <div style="font-size:0.65rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">🎯 Primary Keyword</div>
            <div style="font-size:0.95rem;font-weight:800;color:#0EA5E9;margin-bottom:4px">${_kmEsc(p.primaryKeyword)}</div>
            <div style="display:flex;align-items:center;gap:6px;font-size:0.7rem;color:#64748B">
              <span>Confidence:</span>
              <strong style="color:${cColor}">${p.primaryConfidence}%</strong>
            </div>
          </div>
          <div>
            <div style="font-size:0.65rem;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">🔗 Supporting Keywords (${p.supportingKeywords.length})</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px">
              ${p.supportingKeywords.length ? p.supportingKeywords.map(k => `<span style="background:#EFF6FF;color:#1E40AF;font-size:0.7rem;padding:3px 8px;border-radius:6px;font-weight:600">${_kmEsc(k)}</span>`).join('') : '<span style="font-size:0.72rem;color:#94A3B8;font-style:italic">none assigned</span>'}
            </div>
          </div>
        </div>
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:0.66rem;color:#64748B;margin-bottom:3px"><span>Page strength for this primary</span><span style="color:${sColor};font-weight:700">${strength}%</span></div>
          <div style="height:5px;background:#E2E8F0;border-radius:3px;overflow:hidden"><div style="width:${strength}%;height:100%;background:${sColor}"></div></div>
        </div>
        ${p.rationale ? `<div style="font-size:0.72rem;color:#475569;line-height:1.4;background:#F8FAFC;padding:8px 10px;border-radius:8px;margin-bottom:6px">💭 <em>${_kmEsc(p.rationale)}</em></div>` : ''}
        ${p.recommendation ? `<div style="font-size:0.72rem;color:#0F172A;line-height:1.4;background:#FEF3C7;padding:8px 10px;border-radius:8px"><strong>👉 Action:</strong> ${_kmEsc(p.recommendation)}</div>` : ''}
        ${p.cannibalised && p.cannibalisedWith?.length ? `<div style="font-size:0.7rem;color:#B91C1C;margin-top:6px">⚠️ Also targeted by: ${p.cannibalisedWith.map(u => `<code style="background:#FEE2E2;padding:1px 5px;border-radius:4px;font-size:0.66rem">${_kmEsc(u)}</code>`).join(' ')}</div>` : ''}
      </div>`;
  }).join('');

  result.innerHTML = `
    ${tiles}
    ${cannibalAlert}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h3 style="margin:0;font-size:1rem;font-weight:800;color:#0F172A">Page-by-page assignments</h3>
      <div style="display:flex;gap:8px">
        <button onclick="_kmExportCsv()" style="background:white;color:#0EA5E9;border:1.5px solid #0EA5E9;padding:8px 14px;border-radius:8px;font-weight:700;font-size:0.78rem;cursor:pointer">⬇️ Export CSV</button>
        <button onclick="_kmSendToBattlePlan()" style="background:linear-gradient(135deg,#7C3AED,#EC4899);color:white;border:none;padding:8px 14px;border-radius:8px;font-weight:700;font-size:0.78rem;cursor:pointer">⚔️ Send Cannibal Fixes to Battle Plan</button>
      </div>
    </div>
    ${rows}
  `;
}

function _kmExportCsv() {
  const map = window._keywordMap;
  if (!map?.pages?.length) { showToast('⚠️ Generate the map first'); return; }
  const rows = [['URL','Primary Keyword','Primary Confidence','Supporting Keywords','Page Strength','Status','Cannibalised With','Rationale','Recommendation']];
  map.pages.forEach(p => rows.push([
    p.url, p.primaryKeyword, p.primaryConfidence,
    (p.supportingKeywords || []).join('; '),
    p.pageStrengthScore,
    p.cannibalised ? 'CANNIBALISED' : 'UNIQUE',
    (p.cannibalisedWith || []).join('; '),
    p.rationale || '', p.recommendation || ''
  ]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'keyword-page-map.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('⬇️ Keyword map exported');
}

function _kmSendToBattlePlan() {
  const map = window._keywordMap;
  if (!map?.cannibalGroups?.length) { showToast('ℹ️ No cannibalisation issues to fix'); return; }
  const fixes = map.cannibalGroups.map(g => ({
    keyword: g.keyword,
    issue: 'cannibalisation',
    pages: g.urls,
    action: `Choose ONE winner page for "${g.keyword}" and re-target the other ${g.count - 1} page${g.count - 1 === 1 ? '' : 's'} to a related long-tail variant.`
  }));
  window._keywordMapFixes = fixes;
  try { localStorage.setItem('infogenie_keyword_fixes', JSON.stringify(fixes)); } catch {}
  showToast(`⚔️ Queued ${fixes.length} cannibalisation fix${fixes.length===1?'':'es'} for Battle Plan`);
  setTimeout(() => navigateTo('battleplan'), 600);
}

// ── AMPLITUDE AI AGENTS ────────────────────────────────────────────────────
// Three on-demand product-analytics agents, each backed by a real
// /api/amplitude/* endpoint that hits the Amplitude Dashboard REST API and
// pipes results through GPT-4o.

const _AMP_AGENTS = [
  {
    id: 'dashboard',
    icon: '📊',
    iconBg: '#DBEAFE',
    iconColor: '#1D4ED8',
    title: 'Dashboard Agent',
    desc: 'Analyse dashboards to surface trends, identify root causes and generate hypotheses behind important metric changes.',
    bullets: [
      'Auto-generate insights from your tracked events',
      'Deep-dive interesting trends and anomalies',
      'Schedule proactive and automated monitoring',
    ],
    btn: 'Run Dashboard Agent',
    endpoint: '/api/amplitude/dashboard-agent',
  },
  {
    id: 'replay',
    icon: '▶️',
    iconBg: '#E5E7EB',
    iconColor: '#374151',
    title: 'Session Replay Agent',
    desc: 'Specify an event or funnel then analyse large samples of session replays to identify user frictions, drop-offs, and navigational patterns.',
    bullets: [
      'Continuously scan and explore new sessions / replays',
      'Identify exactly where and why users struggle or abandon',
      'Create playlists that back insight with evidence',
    ],
    btn: 'Run Session Replay Agent',
    endpoint: '/api/amplitude/replay-agent',
  },
  {
    id: 'feedback',
    icon: '💬',
    iconBg: '#FCE7F3',
    iconColor: '#BE185D',
    title: 'Customer Feedback Agent',
    desc: 'Automatically surface top customer requests, bugs, complaints, and praises from feedback, surveys, support tickets, and sales calls.',
    bullets: [
      'Continuously analyse incoming customer feedback',
      'Surface top requests, bugs, complaints, and praises',
      'Generate recommendations on improvements to ship',
    ],
    btn: 'Run Customer Feedback Agent',
    endpoint: '/api/amplitude/feedback-agent',
  },
];

function buildAmplitudeAgents() {
  const grid = document.getElementById('ampAgentsCards');
  if (!grid) return;
  grid.innerHTML = _AMP_AGENTS.map(a => `
    <div class="amp-agent-card" style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:38px;height:38px;border-radius:10px;background:${a.iconBg};display:flex;align-items:center;justify-content:center;font-size:1.15rem;color:${a.iconColor}">${a.icon}</div>
        <div style="font-size:1.05rem;font-weight:700;color:#0F172A">${a.title}</div>
      </div>
      <div style="font-size:0.86rem;color:#475569;line-height:1.5">${a.desc}</div>
      <div>
        <div style="font-size:0.78rem;font-weight:700;color:#0F172A;margin-bottom:8px">This agent will</div>
        <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">
          ${a.bullets.map(b => `<li style="display:flex;gap:8px;align-items:flex-start;font-size:0.82rem;color:#475569;line-height:1.45"><span style="color:#0EA5E9;flex-shrink:0">✓</span><span>${b}</span></li>`).join('')}
        </ul>
      </div>
      <div style="margin-top:auto;padding-top:8px">
        <button onclick="runAmplitudeAgent('${a.id}')" id="ampAgentBtn-${a.id}" style="width:100%;padding:11px 14px;background:white;border:1px solid #CBD5E1;border-radius:9px;font-size:0.85rem;font-weight:600;color:#0F172A;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='#0EA5E9';this.style.color='#0EA5E9'" onmouseout="this.style.borderColor='#CBD5E1';this.style.color='#0F172A'">${a.btn}</button>
      </div>
    </div>
  `).join('');
  // Probe connection once so the badge reflects reality
  _ampProbeConnection();
}

async function _ampProbeConnection() {
  const badge = document.getElementById('ampAgentsConnBadge');
  if (!badge) return;
  try {
    // Lightweight GET probe — no GPT call, single Amplitude HEAD-style ping
    const r = await fetch('/api/amplitude/status');
    const j = await r.json();
    const setBadge = (text, bg, border, hint) => {
      badge.innerHTML = text;
      badge.style.background = bg;
      badge.style.borderColor = border;
      if (hint) { badge.title = hint; badge.style.cursor = 'help'; }
    };
    if (j.connected === false) {
      setBadge('🟡 Amplitude not connected — ' + (j.missing || j.message || 'check secrets'),
        'rgba(234,179,8,0.18)', 'rgba(234,179,8,0.4)');
    } else if (j.connected === 'unknown') {
      setBadge('🔴 Network error reaching Amplitude', 'rgba(239,68,68,0.18)', 'rgba(239,68,68,0.4)', j.error);
    } else if (j.dashboardApiAccess === false && j.status === 403) {
      setBadge('🟡 Credentials accepted · Dashboard REST API blocked (403)',
        'rgba(234,179,8,0.18)', 'rgba(234,179,8,0.4)',
        'Amplitude returned 403 on the Dashboard API. Requires org-level API Key + Secret (Settings → Projects → Show API Key) on Growth/Enterprise. Project tracking keys cannot read data.');
    } else if (j.dashboardApiAccess === false) {
      setBadge('🟡 Amplitude returned ' + (j.status || '?'),
        'rgba(234,179,8,0.18)', 'rgba(234,179,8,0.4)', j.message);
    } else {
      setBadge('🟢 Amplitude Dashboard API connected', 'rgba(34,197,94,0.18)', 'rgba(34,197,94,0.4)');
    }
  } catch (e) {
    badge.innerHTML = '🔴 Connection check failed';
    badge.style.background = 'rgba(239,68,68,0.18)';
    badge.style.borderColor = 'rgba(239,68,68,0.4)';
  }
}

async function runAmplitudeAgent(agentId) {
  const agent = _AMP_AGENTS.find(a => a.id === agentId);
  const btn = document.getElementById('ampAgentBtn-' + agentId);
  const result = document.getElementById('ampAgentResult');
  if (!agent || !btn || !result) return;
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Running…'; btn.style.opacity = '.7';
  result.innerHTML = `<div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:24px;text-align:center;color:#475569">⏳ ${agent.title} is pulling data from Amplitude and asking GPT-4o to analyse it…</div>`;
  try {
    const r = await fetch(agent.endpoint, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    if (j.connected === false) {
      result.innerHTML = _ampNotConnectedHtml(j);
    } else if (j.planLimited && agentId === 'replay') {
      result.innerHTML = _ampReplayManualPickerHtml(j);
    } else if (j.planLimited && j.error) {
      result.innerHTML = `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:20px"><div style="font-weight:700;color:#92400E;margin-bottom:6px">🔒 Amplitude plan limit reached</div><div style="font-size:0.85rem;color:#78350F;line-height:1.55">${j.message}</div></div>`;
    } else if (j.error) {
      result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:20px;color:#991B1B"><div style="font-weight:700;margin-bottom:6px">⚠️ ${agent.title} could not run</div><div style="font-size:0.85rem">${j.message || j.error}</div></div>`;
    } else {
      result.innerHTML = _ampRenderResult(agentId, j);
    }
    igTrack('Amplitude Agent Run', { agent: agentId, ok: true });
  } catch (e) {
    result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:20px;color:#991B1B"><div style="font-weight:700;margin-bottom:6px">⚠️ Request failed</div><div style="font-size:0.85rem">${e.message}</div></div>`;
    igTrack('Amplitude Agent Run', { agent: agentId, ok: false, error: e.message });
  } finally {
    btn.disabled = false; btn.textContent = originalLabel; btn.style.opacity = '1';
    result.scrollIntoView({ behavior:'smooth', block:'start' });
  }
}

function _ampReplayManualPickerHtml(j) {
  return `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:24px">
      <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px;margin-bottom:18px">
        <div style="font-size:0.9rem;font-weight:700;color:#92400E;margin-bottom:6px">🔒 Auto-discovery unavailable on this Amplitude plan</div>
        <div style="font-size:0.82rem;color:#78350F;line-height:1.55">${j.message}</div>
      </div>
      <div style="font-size:0.92rem;font-weight:700;color:#0F172A;margin-bottom:6px">Specify your funnel manually</div>
      <div style="font-size:0.82rem;color:#64748B;margin-bottom:12px">Enter 2–6 event names from your Amplitude project, in funnel order, separated by commas.</div>
      <input id="ampReplayEvents" type="text" placeholder="sign_up, onboarding_complete, first_value, upgrade" style="width:100%;padding:11px 14px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.88rem;font-family:inherit;margin-bottom:12px" />
      <button onclick="runAmplitudeReplayWithEvents()" style="padding:11px 20px;background:#0EA5E9;color:white;border:none;border-radius:8px;font-size:0.85rem;font-weight:700;cursor:pointer">Build funnel & run agent</button>
    </div>`;
}

async function runAmplitudeReplayWithEvents() {
  const inp = document.getElementById('ampReplayEvents');
  if (!inp) return;
  const events = (inp.value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (events.length < 2) { showToast('⚠️ Enter at least 2 event names'); return; }
  const result = document.getElementById('ampAgentResult');
  result.innerHTML = `<div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:24px;text-align:center;color:#475569">⏳ Building funnel from ${events.length} events and analysing with GPT-4o…</div>`;
  try {
    const r = await fetch('/api/amplitude/replay-agent', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ events }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    if (j.error) {
      result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:20px;color:#991B1B"><div style="font-weight:700;margin-bottom:6px">⚠️ Could not build funnel</div><div style="font-size:0.85rem">${j.message || j.error}</div></div>`;
    } else {
      result.innerHTML = _ampRenderReplay(j);
    }
  } catch (e) {
    result.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:14px;padding:20px;color:#991B1B"><div style="font-weight:700;margin-bottom:6px">⚠️ Request failed</div><div style="font-size:0.85rem">${e.message}</div></div>`;
  }
  result.scrollIntoView({ behavior:'smooth', block:'start' });
}

function _ampNotConnectedHtml(j) {
  return `
    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:22px">
      <div style="font-size:1rem;font-weight:700;color:#92400E;margin-bottom:8px">🔌 Amplitude not fully connected</div>
      <div style="font-size:0.88rem;color:#78350F;line-height:1.55;margin-bottom:14px">${j.note || ''}</div>
      <div style="font-size:0.8rem;color:#78350F"><strong>Missing secret:</strong> <code style="background:#FEF3C7;padding:2px 6px;border-radius:4px">${j.missing || 'unknown'}</code></div>
      <div style="margin-top:12px;font-size:0.78rem;color:#92400E">Add it in Replit Secrets, then refresh this page.</div>
    </div>`;
}

function _ampRenderResult(agentId, j) {
  if (agentId === 'dashboard') return _ampRenderDashboard(j);
  if (agentId === 'replay')    return _ampRenderReplay(j);
  if (agentId === 'feedback')  return _ampRenderFeedback(j);
  return '<div>Unknown agent</div>';
}

function _ampShellOpen(title, subtitle) {
  return `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:24px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:18px">
        <div>
          <div style="font-size:1.05rem;font-weight:700;color:#0F172A">${title}</div>
          <div style="font-size:0.82rem;color:#64748B;margin-top:4px">${subtitle}</div>
        </div>
        <div style="font-size:0.72rem;color:#94A3B8">Generated ${new Date().toLocaleString()}</div>
      </div>`;
}
function _ampShellClose() { return '</div>'; }

function _ampSummary(text) {
  return text ? `<div style="background:#F0F9FF;border-left:3px solid #0EA5E9;padding:12px 14px;border-radius:8px;font-size:0.88rem;color:#0C4A6E;line-height:1.55;margin-bottom:18px">${text}</div>` : '';
}

function _ampRenderDashboard(j) {
  const t = j.totals || {};
  const planNote = j.planLimited ? `<div style="background:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin-bottom:14px;font-size:0.78rem;color:#92400E">🔒 <strong>Plan-limited mode:</strong> ${j.planNote || 'Falling back to sessions API.'}</div>` : '';
  const arrow = (n) => n > 0 ? `<span style="color:#16A34A">▲ ${n}%</span>` : n < 0 ? `<span style="color:#DC2626">▼ ${Math.abs(n)}%</span>` : `<span style="color:#64748B">─ 0%</span>`;
  const events = (j.events || []).map(e => `
    <tr>
      <td style="padding:8px 10px;font-size:0.82rem;color:#0F172A;font-weight:600">${e.event}</td>
      <td style="padding:8px 10px;font-size:0.82rem;color:#475569;text-align:right">${(e.total||0).toLocaleString()}</td>
      <td style="padding:8px 10px;font-size:0.82rem;color:#475569;text-align:right">${(e.last7||0).toLocaleString()}</td>
      <td style="padding:8px 10px;font-size:0.82rem;color:#475569;text-align:right">${(e.prev7||0).toLocaleString()}</td>
      <td style="padding:8px 10px;font-size:0.82rem;text-align:right">${arrow(e.wowPct||0)}</td>
    </tr>`).join('');
  const trends = (j.insights?.trends || []).map(t => `
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px">
        <div style="font-size:0.84rem;font-weight:700;color:#0F172A">${t.event}</div>
        <div style="font-size:0.78rem">${arrow(t.wowPct||0)}</div>
      </div>
      <div style="font-size:0.8rem;color:#475569;line-height:1.5">${t.note || ''}</div>
    </div>`).join('') || '<div style="color:#94A3B8;font-size:0.84rem">No notable trends.</div>';
  const anomalies = (j.insights?.anomalies || []).map(a => {
    const sev = a.severity === 'high' ? '#DC2626' : a.severity === 'medium' ? '#D97706' : '#0EA5E9';
    return `
      <div style="background:white;border-left:3px solid ${sev};border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:4px"><div style="font-size:0.84rem;font-weight:700;color:#0F172A">${a.event}</div><div style="font-size:0.7rem;font-weight:700;color:${sev};text-transform:uppercase">${a.severity || 'low'}</div></div>
        <div style="font-size:0.8rem;color:#475569;line-height:1.5">${a.note || ''}</div>
      </div>`;
  }).join('') || '<div style="color:#94A3B8;font-size:0.84rem">No anomalies detected.</div>';
  const hyp = (j.insights?.hypotheses || []).map(h => `
    <div style="background:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font-size:0.86rem;font-weight:700;color:#713F12;margin-bottom:4px">💡 ${h.title}</div>
      <div style="font-size:0.8rem;color:#78350F;line-height:1.5;margin-bottom:6px">${h.reasoning || ''}</div>
      <div style="font-size:0.78rem;color:#92400E"><strong>Test:</strong> ${h.test || ''}</div>
    </div>`).join('') || '';
  return _ampShellOpen('📊 Dashboard Agent — Results', `Top ${t.events || 0} events · last 14 days · last 7d vs prior 7d (${arrow(t.wowPct||0)})`)
    + planNote
    + _ampSummary(j.insights?.summary)
    + `<div style="overflow-x:auto;margin-bottom:22px"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#F8FAFC"><th style="padding:8px 10px;text-align:left;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">Event</th><th style="padding:8px 10px;text-align:right;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">Total 14d</th><th style="padding:8px 10px;text-align:right;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">Last 7d</th><th style="padding:8px 10px;text-align:right;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">Prev 7d</th><th style="padding:8px 10px;text-align:right;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">WoW Δ</th></tr></thead><tbody>${events}</tbody></table></div>`
    + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px"><div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">📈 Trends</div>${trends}</div><div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">⚠️ Anomalies</div>${anomalies}</div></div>`
    + (hyp ? `<div style="margin-top:22px"><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">💡 Root-Cause Hypotheses</div>${hyp}</div>` : '')
    + _ampShellClose();
}

function _ampRenderReplay(j) {
  // Compare by stable field — `s === j.worst` always fails after JSON.parse
  const worstIdx = j.worst && typeof j.worst.stepIndex === 'number' ? j.worst.stepIndex : -1;
  const steps = (j.steps || []).map((s, i) => `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:${s.stepIndex === worstIdx ? '#FEF2F2' : '#F8FAFC'};border:1px solid ${s.stepIndex === worstIdx ? '#FECACA' : '#E2E8F0'};border-radius:8px;margin-bottom:8px">
      <div style="width:28px;height:28px;border-radius:50%;background:${s.stepIndex === worstIdx ? '#DC2626' : '#0EA5E9'};color:white;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:700;flex-shrink:0">${i+1}</div>
      <div style="flex:1"><div style="font-size:0.86rem;font-weight:700;color:#0F172A">${s.event}</div><div style="font-size:0.75rem;color:#64748B">${(s.users||0).toLocaleString()} users</div></div>
      ${i > 0 ? `<div style="font-size:0.78rem;font-weight:700;color:${s.dropPct >= 30 ? '#DC2626' : s.dropPct >= 10 ? '#D97706' : '#16A34A'}">${s.dropPct}% drop</div>` : ''}
    </div>`).join('');
  const hyps = (j.insights?.frictionHypotheses || []).map(h => `
    <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font-size:0.86rem;font-weight:700;color:#713F12;margin-bottom:4px">💡 ${h.hypothesis}</div>
      <div style="font-size:0.8rem;color:#78350F;line-height:1.5;margin-bottom:6px">${h.evidence || ''}</div>
      <div style="font-size:0.78rem;color:#92400E"><strong>Replay query:</strong> <em>${h.replayQuery || ''}</em></div>
    </div>`).join('') || '';
  const playlists = (j.insights?.playlistIdeas || []).map(p => `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font-size:0.86rem;font-weight:700;color:#0F172A;margin-bottom:4px">▶ ${p.name}</div>
      <div style="font-size:0.78rem;color:#64748B;margin-bottom:6px"><strong>Filter:</strong> ${p.filter || ''}</div>
      <div style="font-size:0.8rem;color:#475569;line-height:1.5">${p.whyItMatters || ''}</div>
    </div>`).join('') || '';
  const worst = j.worst ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:14px;margin-bottom:18px"><div style="font-size:0.85rem;font-weight:700;color:#991B1B;margin-bottom:4px">🚨 Biggest drop-off: <code>${j.worst.event}</code> (${j.worst.dropPct}% loss)</div><div style="font-size:0.82rem;color:#7F1D1D">${j.insights?.biggestDropOff?.interpretation || ''}</div></div>` : '';
  return _ampShellOpen('▶️ Session Replay Agent — Results', `Funnel of ${j.steps?.length || 0} steps · last ${j.windowDays}d · ${j.overallConversion}% end-to-end conversion`)
    + _ampSummary(j.insights?.summary)
    + worst
    + `<div style="margin-bottom:22px"><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">🔻 Funnel</div>${steps}</div>`
    + (hyps ? `<div style="margin-bottom:22px"><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">💡 Friction Hypotheses</div>${hyps}</div>` : '')
    + (playlists ? `<div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">📼 Suggested Replay Playlists</div>${playlists}</div>` : '')
    + _ampShellClose();
}

function _ampRenderFeedback(j) {
  const sevColor = (s) => s === 'high' ? '#DC2626' : s === 'medium' ? '#D97706' : '#0EA5E9';
  const evRows = (j.matchedEvents || []).map(e => `
    <tr>
      <td style="padding:8px 10px;font-size:0.82rem;color:#0F172A;font-weight:600">${e.event}</td>
      <td style="padding:8px 10px;font-size:0.82rem;color:#475569;text-align:right">${(e.volume30d||0).toLocaleString()}</td>
    </tr>`).join('');
  const card = (item, color) => `
    <div style="background:white;border-left:3px solid ${color};border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:4px"><div style="font-size:0.86rem;font-weight:700;color:#0F172A">${item.title}</div>${item.severity ? `<div style="font-size:0.7rem;font-weight:700;color:${sevColor(item.severity)};text-transform:uppercase">${item.severity}</div>` : item.volume ? `<div style="font-size:0.7rem;font-weight:700;color:${sevColor(item.volume)};text-transform:uppercase">${item.volume}</div>` : ''}</div>
      <div style="font-size:0.8rem;color:#475569;line-height:1.5">${item.rationale || ''}</div>
    </div>`;
  const requests = (j.insights?.requests || []).map(r => card(r, '#0EA5E9')).join('') || '<div style="color:#94A3B8;font-size:0.84rem">None.</div>';
  const bugs = (j.insights?.bugs || []).map(b => card(b, '#DC2626')).join('') || '<div style="color:#94A3B8;font-size:0.84rem">None.</div>';
  const praises = (j.insights?.praises || []).map(p => card(p, '#16A34A')).join('') || '<div style="color:#94A3B8;font-size:0.84rem">None.</div>';
  const recs = (j.insights?.recommendations || []).map(r => `
    <div style="background:#FEFCE8;border:1px solid #FDE68A;border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:4px"><div style="font-size:0.86rem;font-weight:700;color:#713F12">🚀 ${r.title}</div><div style="font-size:0.7rem;color:#92400E">Impact: ${r.impact} · Effort: ${r.effort}</div></div>
      <div style="font-size:0.8rem;color:#78350F"><strong>Next step:</strong> ${r.next_step || ''}</div>
    </div>`).join('') || '';
  return _ampShellOpen('💬 Customer Feedback Agent — Results', `${j.matchedEvents?.length || 0} feedback-shaped events · ${j.totalVolume?.toLocaleString() || 0} total events in last ${j.windowDays}d`)
    + _ampSummary(j.insights?.summary)
    + (evRows ? `<div style="overflow-x:auto;margin-bottom:22px"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#F8FAFC"><th style="padding:8px 10px;text-align:left;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">Matched Event</th><th style="padding:8px 10px;text-align:right;font-size:0.74rem;font-weight:700;color:#475569;text-transform:uppercase">30d Volume</th></tr></thead><tbody>${evRows}</tbody></table></div>` : '')
    + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-bottom:22px"><div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">📥 Top Requests</div>${requests}</div><div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">🐛 Bugs / Complaints</div>${bugs}</div><div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">🌟 Praises</div>${praises}</div></div>`
    + (recs ? `<div><div style="font-size:0.85rem;font-weight:700;color:#0F172A;margin-bottom:10px">🚀 Recommendations</div>${recs}</div>` : '')
    + _ampShellClose();
}

// ── Re-attach entry points + inline-onclick helpers to window ───────────────
Object.assign(window, {
  // Entry points (nav dispatch + cross-file sentinel)
  buildICPStudio, buildIntentMap, buildKeywordMap, buildAmplitudeAgents,
  // ICP Studio (wired via .onclick / cross-module activation targets)
  _icpActCreativeTarget,
  // Search Intent Map (inline onclick=)
  generateIntentMap, _imExportCsv, _imSendToBattlePlan,
  // Keyword–Page Map (inline onclick=)
  generateKeywordMap, _kmAddPage, _kmAddCommonPaths, _kmAddCompetitor,
  _kmRefreshKeywordsFromIntent, _kmExportCsv, _kmSendToBattlePlan,
  // Amplitude AI Agents (inline onclick=)
  runAmplitudeAgent, runAmplitudeReplayWithEvents,
});

})();

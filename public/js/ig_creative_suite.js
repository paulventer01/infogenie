/**
 * ig_creative_suite.js  v20260604CS1
 * T51 — AI Ad Creative Generator
 * T52 — URL Brand Scanner (button injected into Brand Foundation)
 * T53 — Content Angles Library
 * T54 — Daily Idea Swipe Feed
 * T55 — Multi-language generation (dropdown component)
 */

/* ─────────────────────────────────────────────────────────────────────────────
   SHARED HELPERS
───────────────────────────────────────────────────────────────────────────── */
function _csEsc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _csFetch(path, opts) {
  return fetch(path, { headers:{ 'Content-Type':'application/json' }, ...opts })
    .then(r => r.json()).catch(() => ({ ok:false, error:'network_error' }));
}
function _csPost(path, body) { return _csFetch(path, { method:'POST', body: JSON.stringify(body) }); }

const CS_LANGUAGES = [
  'English','Spanish','French','German','Portuguese','Italian','Dutch','Polish',
  'Russian','Turkish','Arabic','Japanese','Korean','Chinese (Simplified)',
  'Chinese (Traditional)','Hindi','Indonesian','Thai','Vietnamese','Swedish',
  'Norwegian','Danish','Finnish','Czech','Romanian','Hungarian','Greek',
  'Hebrew','Ukrainian','Malay',
];

function _csLangSelector(id, defaultVal) {
  const opts = CS_LANGUAGES.map(l =>
    `<option value="${_csEsc(l)}"${l === (defaultVal||'English') ? ' selected' : ''}>${_csEsc(l)}</option>`).join('');
  return `<select id="${id}" style="padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem;background:#fff;cursor:pointer">${opts}</select>`;
}

/* ─────────────────────────────────────────────────────────────────────────────
   T51 — AD CREATIVE GENERATOR
───────────────────────────────────────────────────────────────────────────── */
window.buildAdCreative = function() {
  const wrap = document.getElementById('adCreativeWrap');
  if (!wrap) return;

  const PLATFORMS = [
    { id:'facebook_ad',       label:'Facebook Ad',       icon:'📘' },
    { id:'instagram_post',    label:'Instagram Post',    icon:'📸' },
    { id:'instagram_story',   label:'IG Story',          icon:'⭕' },
    { id:'google_display',    label:'Google Display',    icon:'🔷' },
    { id:'twitter_x',         label:'Twitter/X',         icon:'🐦' },
    { id:'linkedin',          label:'LinkedIn',          icon:'💼' },
    { id:'tiktok',            label:'TikTok Thumb',      icon:'🎵' },
    { id:'youtube_thumbnail', label:'YT Thumbnail',      icon:'▶️' },
    { id:'email_banner',      label:'Email Banner',      icon:'📧' },
    { id:'pinterest',         label:'Pinterest',         icon:'📌' },
  ];
  const STYLES = [
    { id:'photorealistic', label:'Photo' }, { id:'illustration', label:'Illustration' },
    { id:'minimalist', label:'Minimal' }, { id:'bold_graphic', label:'Bold' },
    { id:'corporate', label:'Corporate' }, { id:'playful', label:'Playful' },
    { id:'editorial', label:'Editorial' }, { id:'flat_design', label:'Flat' },
  ];

  wrap.innerHTML = `
<div style="display:grid;grid-template-columns:340px 1fr;gap:24px;align-items:start">
  <!-- LEFT: form -->
  <div style="background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:24px;position:sticky;top:80px">
    <h3 style="font-size:1rem;font-weight:700;color:#1E293B;margin:0 0 18px">🎨 Generate Ad Creative</h3>

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:6px">PLATFORM</label>
    <div id="acPlatforms" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
      ${PLATFORMS.map(p => `<button onclick="window._acSelPlatform('${p.id}',this)" data-p="${p.id}" style="padding:6px 10px;border:1.5px solid ${p.id==='facebook_ad'?'#6366F1':'#E2E8F0'};border-radius:8px;font-size:0.72rem;font-weight:600;background:${p.id==='facebook_ad'?'#EEF2FF':'#fff'};color:${p.id==='facebook_ad'?'#6366F1':'#475569'};cursor:pointer;white-space:nowrap">${p.icon} ${p.label}</button>`).join('')}
    </div>

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:6px">FORMAT</label>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      ${['square','landscape','portrait'].map((f,i) => `<button onclick="window._acSelFormat('${f}',this)" data-f="${f}" style="flex:1;padding:7px;border:1.5px solid ${i===0?'#6366F1':'#E2E8F0'};border-radius:8px;font-size:0.72rem;font-weight:600;background:${i===0?'#EEF2FF':'#fff'};color:${i===0?'#6366F1':'#475569'};cursor:pointer;text-transform:capitalize">${f}</button>`).join('')}
    </div>

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:6px">STYLE</label>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">
      ${STYLES.map((s,i) => `<button onclick="window._acSelStyle('${s.id}',this)" data-s="${s.id}" style="padding:5px 9px;border:1.5px solid ${i===0?'#6366F1':'#E2E8F0'};border-radius:7px;font-size:0.7rem;font-weight:600;background:${i===0?'#EEF2FF':'#fff'};color:${i===0?'#6366F1':'#475569'};cursor:pointer">${s.label}</button>`).join('')}
    </div>

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">HEADLINE</label>
    <input id="acHeadline" placeholder="e.g. Stop overpaying for marketing tools" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.8rem;margin-bottom:12px">

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">BODY COPY (optional)</label>
    <textarea id="acBodyCopy" rows="2" placeholder="Supporting message or offer details…" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.8rem;resize:vertical;margin-bottom:12px"></textarea>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">BRAND NAME</label>
        <input id="acBrandName" placeholder="e.g. InfoGenie" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem">
      </div>
      <div>
        <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">CTA TEXT</label>
        <input id="acCTA" placeholder="e.g. Get Started Free" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem">
      </div>
    </div>

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">BRAND COLORS (optional)</label>
    <input id="acColors" placeholder="e.g. #6366F1, #0EA5E9, white" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.8rem;margin-bottom:12px">

    <label style="font-size:0.75rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">EXTRA DIRECTION (optional)</label>
    <input id="acExtra" placeholder="e.g. Show a happy professional at a laptop" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.8rem;margin-bottom:18px">

    <button id="acGenBtn" onclick="window._acGenerate()" style="width:100%;padding:12px;background:linear-gradient(135deg,#6366F1,#8B5CF6);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:#fff;cursor:pointer">✨ Generate Creative</button>
  </div>

  <!-- RIGHT: output + history -->
  <div>
    <div id="acResult" style="margin-bottom:24px"></div>
    <div id="acHistory"></div>
  </div>
</div>`;

  window._acState = { platform:'facebook_ad', format:'square', style:'photorealistic' };

  window._acSelPlatform = (id, btn) => {
    window._acState.platform = id;
    document.querySelectorAll('#acPlatforms button').forEach(b => {
      b.style.borderColor = '#E2E8F0'; b.style.background = '#fff'; b.style.color = '#475569';
    });
    btn.style.borderColor = '#6366F1'; btn.style.background = '#EEF2FF'; btn.style.color = '#6366F1';
  };
  window._acSelFormat = (id, btn) => {
    window._acState.format = id;
    document.querySelectorAll('[data-f]').forEach(b => {
      b.style.borderColor = '#E2E8F0'; b.style.background = '#fff'; b.style.color = '#475569';
    });
    btn.style.borderColor = '#6366F1'; btn.style.background = '#EEF2FF'; btn.style.color = '#6366F1';
  };
  window._acSelStyle = (id, btn) => {
    window._acState.style = id;
    document.querySelectorAll('[data-s]').forEach(b => {
      b.style.borderColor = '#E2E8F0'; b.style.background = '#fff'; b.style.color = '#475569';
    });
    btn.style.borderColor = '#6366F1'; btn.style.background = '#EEF2FF'; btn.style.color = '#6366F1';
  };

  window._acGenerate = async () => {
    const btn = document.getElementById('acGenBtn');
    const headline = document.getElementById('acHeadline').value.trim();
    const result = document.getElementById('acResult');
    if (!headline) { result.innerHTML = '<p style="color:#EF4444;font-size:0.8rem">Please enter a headline first.</p>'; return; }
    btn.disabled = true; btn.textContent = '⏳ Generating…';
    result.innerHTML = `<div style="background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:32px;text-align:center">
      <div style="font-size:2rem;margin-bottom:12px">🎨</div>
      <p style="color:#6366F1;font-weight:600;font-size:0.9rem">DALL-E 3 is designing your creative…</p>
      <p style="color:#94A3B8;font-size:0.78rem;margin-top:6px">This usually takes 10-20 seconds</p>
    </div>`;
    const r = await _csPost('/api/ad-creative/generate', {
      platform: window._acState.platform,
      format: window._acState.format,
      style: window._acState.style,
      headline,
      body_copy: document.getElementById('acBodyCopy').value.trim(),
      brand_name: document.getElementById('acBrandName').value.trim(),
      cta_text: document.getElementById('acCTA').value.trim(),
      brand_colors: document.getElementById('acColors').value.trim(),
      extra_context: document.getElementById('acExtra').value.trim(),
    });
    btn.disabled = false; btn.textContent = '✨ Generate Creative';
    if (!r.ok) { result.innerHTML = `<p style="color:#EF4444;font-size:0.8rem">Error: ${_csEsc(r.error||'generation failed')}</p>`; return; }
    const isPlaceholder = r.source === 'placeholder';
    result.innerHTML = `
<div style="background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:24px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <h3 style="font-size:0.95rem;font-weight:700;color:#1E293B;margin:0">✅ Creative Generated</h3>
    <span style="font-size:0.7rem;padding:3px 8px;background:${isPlaceholder?'#FEF3C7':'#D1FAE5'};color:${isPlaceholder?'#92400E':'#065F46'};border-radius:20px;font-weight:600">${isPlaceholder?'⚠️ Placeholder (add OpenAI key)':'✨ DALL-E 3'}</span>
  </div>
  <img src="${_csEsc(r.image_url)}" alt="Generated Ad Creative" style="width:100%;max-width:600px;display:block;border-radius:12px;border:1px solid #E2E8F0;margin:0 auto 16px">
  <div style="display:flex;gap:10px;flex-wrap:wrap">
    <a href="${_csEsc(r.image_url)}" download="ad-creative-${Date.now()}.png" style="padding:9px 16px;background:#6366F1;border-radius:9px;font-size:0.78rem;font-weight:700;color:#fff;text-decoration:none">⬇ Download</a>
    <button onclick="navigator.clipboard.writeText('${_csEsc(r.image_url)}')" style="padding:9px 16px;background:#F1F5F9;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.78rem;font-weight:700;color:#475569;cursor:pointer">📋 Copy URL</button>
    <button onclick="window._acGenerate()" style="padding:9px 16px;background:#F1F5F9;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.78rem;font-weight:700;color:#475569;cursor:pointer">🔄 Regenerate</button>
  </div>
  <details style="margin-top:12px"><summary style="font-size:0.75rem;color:#94A3B8;cursor:pointer">View AI prompt</summary>
    <p style="font-size:0.72rem;color:#64748B;margin-top:8px;line-height:1.5;background:#F8FAFC;padding:10px;border-radius:8px">${_csEsc(r.prompt)}</p>
  </details>
</div>`;
    window._acLoadHistory();
  };

  window._acLoadHistory = async () => {
    const r = await _csFetch('/api/ad-creative/history');
    const hist = document.getElementById('acHistory');
    if (!r.ok || !r.items?.length) { hist.innerHTML = ''; return; }
    hist.innerHTML = `<h3 style="font-size:0.9rem;font-weight:700;color:#1E293B;margin:0 0 14px">Recent Creatives</h3>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
${r.items.map(it => `
<div style="background:#fff;border-radius:12px;border:1.5px solid #E2E8F0;overflow:hidden">
  <img src="${_csEsc(it.image_url)}" alt="${_csEsc(it.headline||'')}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">
  <div style="padding:10px">
    <div style="font-size:0.72rem;font-weight:600;color:#1E293B;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_csEsc(it.headline||'(no headline)')}</div>
    <div style="font-size:0.65rem;color:#94A3B8">${_csEsc(it.platform)} · ${_csEsc(it.style)}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <a href="${_csEsc(it.image_url)}" download style="font-size:0.65rem;color:#6366F1;font-weight:600;text-decoration:none">⬇ DL</a>
      <button onclick="window._acDelete(${it.id},this)" style="font-size:0.65rem;color:#EF4444;background:none;border:none;cursor:pointer;padding:0;font-weight:600">🗑</button>
    </div>
  </div>
</div>`).join('')}
</div>`;
  };

  window._acDelete = async (id, btn) => {
    btn.disabled = true;
    await _csFetch(`/api/ad-creative/${id}`, { method:'DELETE' });
    window._acLoadHistory();
  };

  window._acLoadHistory();
};

/* ─────────────────────────────────────────────────────────────────────────────
   T52 — URL BRAND SCANNER  (injected into Brand Foundation view)
───────────────────────────────────────────────────────────────────────────── */
window._injectBrandScanner = function() {
  const wrap = document.getElementById('brandFoundationWrap');
  if (!wrap || document.getElementById('bfScannerBar')) return;

  const bar = document.createElement('div');
  bar.id = 'bfScannerBar';
  bar.style.cssText = 'background:linear-gradient(135deg,#EEF2FF,#F0F9FF);border:1.5px solid #C7D2FE;border-radius:14px;padding:18px 20px;margin-bottom:24px';
  bar.innerHTML = `
<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
  <div style="flex:1;min-width:220px">
    <div style="font-size:0.85rem;font-weight:700;color:#3730A3;margin-bottom:4px">🔍 Scan from URL — instant brand setup</div>
    <div style="font-size:0.75rem;color:#6366F1">Paste your website URL and AI will extract your brand identity in seconds.</div>
  </div>
  <div style="display:flex;gap:8px;flex:1;min-width:260px">
    <input id="bfScanUrl" placeholder="https://yourbrand.com" style="flex:1;padding:9px 12px;border:1.5px solid #C7D2FE;border-radius:9px;font-size:0.8rem;background:#fff">
    <button id="bfScanBtn" onclick="window._bfScanUrl()" style="padding:9px 18px;background:#6366F1;border:none;border-radius:9px;font-size:0.8rem;font-weight:700;color:#fff;cursor:pointer;white-space:nowrap">🔍 Scan</button>
  </div>
</div>
<div id="bfScanResult" style="margin-top:0"></div>`;
  wrap.insertBefore(bar, wrap.firstChild);
};

window._bfScanUrl = async () => {
  const urlEl = document.getElementById('bfScanUrl');
  const btn   = document.getElementById('bfScanBtn');
  const res   = document.getElementById('bfScanResult');
  if (!urlEl.value.trim()) return;
  btn.disabled = true; btn.textContent = '⏳ Scanning…';
  res.style.marginTop = '14px';
  res.innerHTML = '<p style="color:#6366F1;font-size:0.78rem">Scanning page and extracting brand identity…</p>';

  const r = await _csPost('/api/brand-foundation/scan-url', { url: urlEl.value.trim() });
  btn.disabled = false; btn.textContent = '🔍 Scan';

  if (!r.ok) {
    res.innerHTML = `<p style="color:#EF4444;font-size:0.78rem">⚠️ ${_csEsc(r.error||'scan failed')}</p>`;
    return;
  }

  const e = r.extracted;
  const fields = [
    ['brand_name',          '🏷 Brand Name',          e.brand_name],
    ['purpose_why',         '💡 Purpose / Why',        e.purpose_why],
    ['purpose_beyond_money','🌟 Mission Beyond Profit', e.purpose_beyond_money],
    ['icp_name',            '👤 ICP Name',             e.icp_name],
    ['icp_role',            '💼 ICP Role',             e.icp_role],
    ['icp_pain',            '😤 ICP Pain',             e.icp_pain],
    ['icp_dream_outcome',   '🎯 Dream Outcome',        e.icp_dream_outcome],
    ['positioning_statement','📣 Positioning',         e.positioning_statement],
  ].filter(([,, v]) => v);

  if (!fields.length) {
    res.innerHTML = '<p style="color:#94A3B8;font-size:0.78rem">Scanned but could not extract enough brand information — try a more detailed page URL.</p>';
    return;
  }

  res.innerHTML = `
<div style="background:#fff;border-radius:12px;border:1.5px solid #C7D2FE;padding:16px;margin-top:4px">
  <div style="font-size:0.82rem;font-weight:700;color:#1E293B;margin-bottom:12px">✅ Extracted from ${_csEsc(r.url)} — review and apply</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-bottom:14px">
    ${fields.map(([key, label, val]) => `
    <div style="background:#F8FAFC;border-radius:9px;padding:10px">
      <div style="font-size:0.68rem;font-weight:700;color:#64748B;margin-bottom:3px">${_csEsc(label)}</div>
      <div style="font-size:0.78rem;color:#1E293B;line-height:1.4">${_csEsc(val)}</div>
    </div>`).join('')}
  </div>
  ${e.brand_colors ? `<div style="font-size:0.72rem;color:#64748B;margin-bottom:12px">Detected colors: <strong>${_csEsc(e.brand_colors)}</strong></div>` : ''}
  <div style="display:flex;gap:8px">
    <button onclick="window._bfApplyScan(${JSON.stringify(e).replace(/"/g,'&quot;')})" style="padding:9px 18px;background:#10B981;border:none;border-radius:9px;font-size:0.8rem;font-weight:700;color:#fff;cursor:pointer">✅ Apply to Brand Foundation</button>
    <button onclick="document.getElementById('bfScanResult').innerHTML=''" style="padding:9px 14px;background:#F1F5F9;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.8rem;color:#64748B;cursor:pointer;font-weight:600">Dismiss</button>
  </div>
</div>`;
};

window._bfApplyScan = async (extracted) => {
  const r = await _csPost('/api/brand-foundation/save', {
    purpose_why:         extracted.purpose_why         || '',
    purpose_beyond_money:extracted.purpose_beyond_money || '',
    icp_name:            extracted.icp_name            || '',
    icp_role:            extracted.icp_role            || '',
    icp_pain:            extracted.icp_pain            || '',
    icp_dream_outcome:   extracted.icp_dream_outcome   || '',
    positioning_statement: extracted.positioning_statement || '',
    voice_tone_warm:     extracted.voice_tone_warm || 5,
    voice_tone_witty:    extracted.voice_tone_witty || 5,
    voice_tone_bold:     extracted.voice_tone_bold || 5,
  });
  if (r.ok) {
    document.getElementById('bfScanResult').innerHTML = `<p style="color:#10B981;font-size:0.78rem;font-weight:600;margin-top:10px">✅ Brand Foundation updated! Refreshing…</p>`;
    setTimeout(() => { if (window.buildBrandFoundation) window.buildBrandFoundation(); }, 1200);
  } else {
    document.getElementById('bfScanResult').innerHTML = `<p style="color:#EF4444;font-size:0.78rem">Save failed: ${_csEsc(r.error||'unknown')}</p>`;
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   T53/T54 — CONTENT ANGLES LIBRARY + DAILY IDEA SWIPE FEED
───────────────────────────────────────────────────────────────────────────── */
window.buildIdeaFeed = function() {
  const wrap = document.getElementById('ideaFeedWrap');
  if (!wrap) return;

  wrap.innerHTML = `
<div style="display:grid;grid-template-columns:300px 1fr;gap:24px;align-items:start">
  <!-- LEFT: controls -->
  <div style="background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:22px;position:sticky;top:80px">
    <h3 style="font-size:0.95rem;font-weight:700;color:#1E293B;margin:0 0 14px">💡 Daily Idea Feed</h3>
    <label style="font-size:0.72rem;font-weight:600;color:#64748B;display:block;margin-bottom:5px">BRAND NAME</label>
    <input id="ifBrand" placeholder="e.g. InfoGenie" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:0.8rem;margin-bottom:12px">
    <button onclick="window._ifLoadIdeas(true)" style="width:100%;padding:11px;background:linear-gradient(135deg,#6366F1,#8B5CF6);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:#fff;cursor:pointer;margin-bottom:8px">✨ Generate Fresh Ideas</button>
    <button onclick="window._ifShowSaved()" style="width:100%;padding:10px;background:#F1F5F9;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.8rem;font-weight:700;color:#475569;cursor:pointer;margin-bottom:18px">⭐ Saved Ideas</button>

    <div style="border-top:1px solid #F1F5F9;padding-top:14px">
      <div style="font-size:0.75rem;font-weight:700;color:#64748B;margin-bottom:10px">📚 CONTENT ANGLES LIBRARY</div>
      <div id="ifAnglesLib" style="max-height:380px;overflow-y:auto"></div>
    </div>
  </div>

  <!-- RIGHT: swipe feed -->
  <div>
    <div id="ifFeedStatus" style="margin-bottom:10px"></div>
    <div id="ifCardStack" style="position:relative;min-height:200px"></div>
    <div id="ifSavedList" style="display:none"></div>
  </div>
</div>`;

  window._ifState = { ideas:[], currentIndex:0 };

  window._ifLoadAngles = async () => {
    const r = await _csFetch('/api/idea-feed/angles');
    const lib = document.getElementById('ifAnglesLib');
    if (!r.ok) return;
    lib.innerHTML = r.angles.map(a => `
<div onclick="window._ifUseAngle('${_csEsc(a.angle)}')" style="padding:8px 10px;border-radius:8px;cursor:pointer;border:1.5px solid #F1F5F9;margin-bottom:6px;background:#FAFAFA;transition:all .15s" onmouseover="this.style.borderColor='#6366F1';this.style.background='#EEF2FF'" onmouseout="this.style.borderColor='#F1F5F9';this.style.background='#FAFAFA'">
  <div style="font-size:0.77rem;font-weight:700;color:#1E293B">${_csEsc(a.icon)} ${_csEsc(a.angle)}</div>
  <div style="font-size:0.68rem;color:#64748B;margin-top:2px;line-height:1.3">${_csEsc(a.desc)}</div>
</div>`).join('');
  };

  window._ifUseAngle = (angle) => {
    const idx = (window._ifState.ideas||[]).findIndex(i => i.angle === angle && i.status === 'pending');
    if (idx >= 0) {
      window._ifState.currentIndex = idx;
      window._ifRenderCard();
    }
  };

  window._ifLoadIdeas = async (force) => {
    const brand = document.getElementById('ifBrand')?.value.trim() || '';
    const status = document.getElementById('ifFeedStatus');
    status.innerHTML = '<p style="color:#6366F1;font-size:0.8rem">✨ Generating fresh content ideas…</p>';
    const r = await _csFetch(`/api/idea-feed/ideas?brand=${encodeURIComponent(brand)}&force=${force?1:0}`);
    if (!r.ok) { status.innerHTML = '<p style="color:#EF4444;font-size:0.8rem">Failed to load ideas.</p>'; return; }
    window._ifState.ideas = r.ideas;
    window._ifState.currentIndex = 0;
    const pending = r.ideas.filter(i => i.status === 'pending');
    status.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <span style="font-size:0.8rem;color:#64748B"><strong>${pending.length}</strong> ideas ready · swipe or use buttons</span>
      <span style="font-size:0.68rem;padding:3px 8px;background:${r.source==='openai'?'#D1FAE5':'#FEF3C7'};color:${r.source==='openai'?'#065F46':'#92400E'};border-radius:20px;font-weight:600">${r.source==='cached'?'📦 Cached':r.source==='openai'?'✨ AI Generated':'📋 Template'}</span>
    </div>`;
    window._ifRenderCard();
  };

  window._ifRenderCard = () => {
    const stack = document.getElementById('ifCardStack');
    const ideas = (window._ifState.ideas||[]).filter(i => i.status === 'pending');
    if (!ideas.length) {
      stack.innerHTML = `<div style="background:#fff;border-radius:16px;border:1.5px solid #E2E8F0;padding:40px;text-align:center">
        <div style="font-size:2.5rem;margin-bottom:12px">🎉</div>
        <div style="font-size:0.9rem;font-weight:700;color:#1E293B;margin-bottom:6px">All ideas reviewed!</div>
        <div style="font-size:0.78rem;color:#64748B;margin-bottom:16px">Generate a fresh batch whenever you're ready.</div>
        <button onclick="window._ifLoadIdeas(true)" style="padding:10px 20px;background:linear-gradient(135deg,#6366F1,#8B5CF6);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:#fff;cursor:pointer">✨ Fresh Batch</button>
      </div>`;
      return;
    }
    const idea = ideas[Math.min(window._ifState.currentIndex, ideas.length - 1)];
    if (!idea) return;

    const CHANNEL_COLORS = { instagram:'#E1306C', tiktok:'#010101', linkedin:'#0A66C2', x:'#1DA1F2', facebook:'#1877F2', youtube:'#FF0000', blog:'#6366F1', email:'#10B981' };
    const chColor = CHANNEL_COLORS[idea.channel] || '#6366F1';
    const tags = Array.isArray(idea.hashtags) ? idea.hashtags : (typeof idea.hashtags === 'string' ? JSON.parse(idea.hashtags||'[]') : []);

    stack.innerHTML = `
<div style="background:#fff;border-radius:18px;border:1.5px solid #E2E8F0;padding:28px;box-shadow:0 4px 20px rgba(0,0,0,0.06);max-width:600px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
    <span style="background:#EEF2FF;color:#6366F1;padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700">${_csEsc(idea.angle||'Idea')}</span>
    <span style="background:${chColor}1A;color:${chColor};padding:4px 10px;border-radius:20px;font-size:0.72rem;font-weight:700;text-transform:capitalize">${_csEsc(idea.channel)}</span>
  </div>
  <h3 style="font-size:1.05rem;font-weight:800;color:#1E293B;margin:0 0 12px;line-height:1.3">${_csEsc(idea.headline)}</h3>
  <p style="font-size:0.82rem;color:#475569;line-height:1.6;margin:0 0 14px">${_csEsc(idea.copy)}</p>
  ${idea.cta ? `<div style="font-size:0.78rem;font-weight:600;color:#6366F1;margin-bottom:10px">CTA: ${_csEsc(idea.cta)}</div>` : ''}
  ${tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px">${tags.map(t => `<span style="background:#F1F5F9;color:#64748B;padding:3px 8px;border-radius:12px;font-size:0.68rem;font-weight:600">${_csEsc(t)}</span>`).join('')}</div>` : ''}
  ${idea.visual_concept ? `<div style="background:#F8FAFC;border-radius:9px;padding:10px;margin-bottom:16px"><div style="font-size:0.68rem;font-weight:700;color:#94A3B8;margin-bottom:3px">🎬 VISUAL DIRECTION</div><div style="font-size:0.75rem;color:#475569;line-height:1.4">${_csEsc(idea.visual_concept)}</div></div>` : ''}
  <div style="display:flex;gap:10px;margin-top:4px">
    <button onclick="window._ifDismiss(${idea.id})" style="flex:1;padding:11px;background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:10px;font-size:0.8rem;font-weight:700;color:#EF4444;cursor:pointer">✕ Skip</button>
    <button onclick="window._ifSave(${idea.id},${JSON.stringify(idea).replace(/"/g,'&quot;')})" style="flex:2;padding:11px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:#fff;cursor:pointer">⭐ Save Idea</button>
    <button onclick="window._ifToCalendar(${idea.id},${JSON.stringify(idea).replace(/"/g,'&quot;')})" style="flex:2;padding:11px;background:linear-gradient(135deg,#6366F1,#8B5CF6);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:#fff;cursor:pointer">📅 Add to Calendar</button>
  </div>
  <div style="text-align:center;margin-top:10px;font-size:0.7rem;color:#CBD5E1">${ideas.indexOf(idea)+1} of ${ideas.length} pending ideas</div>
</div>`;
  };

  window._ifDismiss = async (id) => {
    await _csPost(`/api/idea-feed/dismiss/${id}`, {});
    const ideas = window._ifState.ideas;
    const item = ideas.find(i => i.id === id);
    if (item) item.status = 'dismissed';
    window._ifRenderCard();
  };

  window._ifSave = async (id, idea) => {
    await _csPost(`/api/idea-feed/save/${id}`, {});
    const item = window._ifState.ideas.find(i => i.id === id);
    if (item) item.status = 'saved';
    window._ifRenderCard();
    const tags = Array.isArray(idea.hashtags) ? idea.hashtags : (typeof idea.hashtags === 'string' ? JSON.parse(idea.hashtags||'[]') : []);
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#10B981;color:#fff;padding:10px 18px;border-radius:10px;font-size:0.8rem;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(16,185,129,.3)';
    notif.textContent = '⭐ Idea saved!';
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
  };

  window._ifToCalendar = async (id, idea) => {
    const brand = document.getElementById('ifBrand')?.value.trim() || 'Brand';
    const tags = Array.isArray(idea.hashtags) ? idea.hashtags : (typeof idea.hashtags === 'string' ? JSON.parse(idea.hashtags||'[]') : []);
    const r = await _csPost('/api/content-calendar/add', {
      brand, channel: idea.channel, headline: idea.headline,
      copy: idea.copy + (tags.length ? '\n\n' + tags.join(' ') : ''),
      cta: idea.cta || '', note: `Angle: ${idea.angle} | Visual: ${idea.visual_concept||''}`,
    });
    await _csPost(`/api/idea-feed/save/${id}`, {});
    const item = window._ifState.ideas.find(i => i.id === id);
    if (item) item.status = 'saved';
    window._ifRenderCard();
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#6366F1;color:#fff;padding:10px 18px;border-radius:10px;font-size:0.8rem;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(99,102,241,.3);cursor:pointer';
    notif.innerHTML = r.ok ? '📅 Added to Content Calendar! <span style="opacity:.7">→ view</span>' : '⚠️ Calendar add failed';
    notif.onclick = () => { if (window.navigateTo) window.navigateTo('content-calendar'); notif.remove(); };
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4000);
  };

  window._ifShowSaved = async () => {
    const savedList = document.getElementById('ifSavedList');
    const stack = document.getElementById('ifCardStack');
    savedList.style.display = 'block';
    stack.style.display = 'none';
    const r = await _csFetch('/api/idea-feed/saved');
    if (!r.ok || !r.ideas?.length) {
      savedList.innerHTML = '<p style="color:#94A3B8;font-size:0.8rem">No saved ideas yet — swipe right on ideas to save them.</p>';
      return;
    }
    savedList.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
  <h3 style="font-size:0.9rem;font-weight:700;color:#1E293B;margin:0">⭐ Saved Ideas (${r.ideas.length})</h3>
  <button onclick="document.getElementById('ifSavedList').style.display='none';document.getElementById('ifCardStack').style.display='block'" style="font-size:0.75rem;color:#6366F1;background:none;border:none;cursor:pointer;font-weight:600">← Back to feed</button>
</div>
<div style="display:flex;flex-direction:column;gap:10px">
${r.ideas.map(idea => {
  const tags = Array.isArray(idea.hashtags) ? idea.hashtags : (typeof idea.hashtags === 'string' ? JSON.parse(idea.hashtags||'[]') : []);
  return `<div style="background:#fff;border-radius:12px;border:1.5px solid #E2E8F0;padding:16px">
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
    <div>
      <span style="font-size:0.68rem;font-weight:700;background:#EEF2FF;color:#6366F1;padding:2px 7px;border-radius:12px;margin-right:6px">${_csEsc(idea.angle||'')}</span>
      <span style="font-size:0.68rem;font-weight:700;background:#F1F5F9;color:#64748B;padding:2px 7px;border-radius:12px">${_csEsc(idea.channel)}</span>
      <div style="font-size:0.82rem;font-weight:700;color:#1E293B;margin-top:6px">${_csEsc(idea.headline)}</div>
      <div style="font-size:0.75rem;color:#64748B;margin-top:4px;line-height:1.4">${_csEsc(idea.copy.slice(0,120))}…</div>
      ${tags.length ? `<div style="margin-top:6px">${tags.map(t=>`<span style="font-size:0.65rem;color:#94A3B8">${_csEsc(t)} </span>`).join('')}</div>` : ''}
    </div>
    <button onclick="window._ifToCalendar(${idea.id},${JSON.stringify(idea).replace(/"/g,'&quot;')})" style="flex-shrink:0;padding:7px 12px;background:#EEF2FF;border:none;border-radius:8px;font-size:0.72rem;font-weight:700;color:#6366F1;cursor:pointer;white-space:nowrap">📅 Add</button>
  </div>
</div>`;}).join('')}
</div>`;
  };

  window._ifLoadAngles();
  window._ifLoadIdeas(false);
};

/* ─────────────────────────────────────────────────────────────────────────────
   T55 — LANGUAGE SELECTOR INJECTION (Content Calendar + Content Modes)
   Injected via MutationObserver when the relevant forms render
───────────────────────────────────────────────────────────────────────────── */
window._csInjectLanguageSelectors = function() {
  // Content Calendar: inject after tone input
  const ccTone = document.getElementById('ccTone');
  if (ccTone && !document.getElementById('ccLanguage')) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    wrap.innerHTML = `<label style="font-size:0.75rem;font-weight:600;color:#64748B">Language</label>${_csLangSelector('ccLanguage','English')}`;
    ccTone.closest('div,td,label')?.parentNode?.insertBefore(wrap, ccTone.closest('div,td,label')?.nextSibling);
  }
  // Content Modes: inject after tone input
  const cmTone = document.getElementById('cmTone');
  if (cmTone && !document.getElementById('cmLanguage')) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    wrap.innerHTML = `<label style="font-size:0.75rem;font-weight:600;color:#64748B">Language</label>${_csLangSelector('cmLanguage','English')}`;
    cmTone.closest('div,td,label')?.parentNode?.insertBefore(wrap, cmTone.closest('div,td,label')?.nextSibling);
  }
};

// Patch _ccGo to pass language
// ⚠ LOAD ORDER: reads window._ccGo (defined in app.js) at load time. app.js
// MUST load before this module. Enforced by scripts/check-script-tags.js
// (LOAD_ORDER_CONSTRAINTS) + test/script-tag-wiring.test.js. If app.js loads
// later, this wrap silently no-ops with no console error.
(function() {
  const _origCcGo = window._ccGo;
  if (!_origCcGo) return;
  window._ccGo = async function() {
    const langEl = document.getElementById('ccLanguage');
    if (langEl) window._ccPendingLanguage = langEl.value;
    return _origCcGo.apply(this, arguments);
  };
})();

// Observer to inject selectors when forms appear
if (window._csLangObserver) window._csLangObserver.disconnect();
window._csLangObserver = new MutationObserver(() => window._csInjectLanguageSelectors());
window._csLangObserver.observe(document.body, { childList:true, subtree:true });

/* ─────────────────────────────────────────────────────────────────────────────
   BRAND SCANNER OBSERVER — inject into Brand Foundation whenever it renders
───────────────────────────────────────────────────────────────────────────── */
if (window._csBfObserver) window._csBfObserver.disconnect();
window._csBfObserver = new MutationObserver(() => {
  if (document.getElementById('brandFoundationWrap')?.children.length) {
    window._injectBrandScanner();
  }
});
window._csBfObserver.observe(document.body, { childList:true, subtree:true });

// Inject immediately if Brand Foundation is already rendered
if (document.getElementById('brandFoundationWrap')?.children.length) {
  window._injectBrandScanner();
}

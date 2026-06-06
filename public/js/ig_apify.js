// ─────────────────────────────────────────────────────────────────────────────
// T65 · Organic Social Monitor — TikTok organic search via Apify
// T66 · Local Lead Finder       — Google Maps business leads via Apify
// ─────────────────────────────────────────────────────────────────────────────

(function () {
function _apEsc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function _apFmt(n) {
  n = parseInt(n) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function _apSpinner(msg) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0">
    <div style="width:16px;height:16px;border:2px solid var(--ig-primary,#667eea);border-top-color:transparent;border-radius:50%;animation:_apSpin 0.8s linear infinite;flex-shrink:0"></div>
    <span style="font-size:0.85rem;color:var(--text-muted)">${_apEsc(msg)}</span>
  </div><style>@keyframes _apSpin{to{transform:rotate(360deg)}}</style>`;
}
function _apAlert(msg, type) {
  const colors = { error:'#FEE2E2:#991B1B', success:'#D1FAE5:#065F46', info:'#EFF6FF:#1E40AF' };
  const [bg, fg] = (colors[type] || colors.info).split(':');
  return `<div style="background:${bg};color:${fg};padding:10px 14px;border-radius:8px;font-size:0.84rem">${_apEsc(msg)}</div>`;
}

// ── No-key banner ─────────────────────────────────────────────────────────
function _apNoKeyBanner(feature) {
  return `<div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1px solid #C7D2FE;border-radius:12px;padding:24px;text-align:center;margin:16px 0">
    <div style="font-size:2rem;margin-bottom:8px">🔑</div>
    <div style="font-weight:700;font-size:1rem;color:#1E1B4B;margin-bottom:6px">APIFY_API_KEY required</div>
    <div style="font-size:0.85rem;color:#6B7280;max-width:400px;margin:0 auto 16px">
      ${_apEsc(feature)} uses Apify's web scraping platform. Add your free Apify API key to unlock it.
    </div>
    <a href="https://console.apify.com/sign-up" target="_blank" rel="noopener"
       style="display:inline-block;padding:10px 22px;background:#667eea;color:#fff;border-radius:8px;font-weight:700;font-size:0.85rem;text-decoration:none">
      Get Free Apify Key →
    </a>
    <div style="font-size:0.75rem;color:#9CA3AF;margin-top:10px">Then add it in <strong>Settings → Integrations → Apify</strong></div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  T65 · ORGANIC SOCIAL MONITOR
// ═══════════════════════════════════════════════════════════════════════════

window.buildOrganic = function() {
  const wrap = document.getElementById('organicWrap');
  if (!wrap || wrap._built) return;
  wrap._built = true;
  wrap.innerHTML = `
<div class="ig-page-header" style="padding-bottom:0">
  <h1 style="margin-bottom:4px">📱 Organic Social Monitor</h1>
  <p style="color:var(--text-muted)">Track any brand or keyword's organic TikTok content — views, engagement, top creators. Powered by Apify.</p>
</div>
<div class="ig-card" style="margin-bottom:20px">
  <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end">
    <div>
      <label class="ig-label">Brand · Keyword · Hashtag</label>
      <input id="orgKeyword" class="ig-input" placeholder="e.g. Nike, #CleanTok, Stanley Cup">
    </div>
    <div>
      <label class="ig-label">Results</label>
      <select id="orgLimit" class="ig-select">
        <option value="10">10 videos</option>
        <option value="20" selected>20 videos</option>
        <option value="30">30 videos</option>
      </select>
    </div>
    <button id="orgRunBtn" class="btn btn-primary" onclick="window._orgRun()">🔍 Search TikTok</button>
  </div>
  <div id="orgStatus" style="margin-top:10px"></div>
</div>
<div id="orgResults"></div>`;
};

window._orgRun = async function() {
  const keyword  = (document.getElementById('orgKeyword')||{}).value?.trim();
  const limit    = parseInt((document.getElementById('orgLimit')||{}).value) || 20;
  const statusEl = document.getElementById('orgStatus');
  const resEl    = document.getElementById('orgResults');
  const btn      = document.getElementById('orgRunBtn');
  if (!keyword) { if (statusEl) statusEl.innerHTML = _apAlert('Enter a keyword or hashtag', 'error'); return; }
  if (statusEl) statusEl.innerHTML = _apSpinner('Starting Apify TikTok Scraper…');
  if (resEl)    resEl.innerHTML = '';
  if (btn)      { btn.disabled = true; btn.textContent = '⏳ Starting…'; }
  try {
    const d = await fetch('/api/apify/tiktok-organic', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, limit })
    }).then(r => r.json());
    if (!d.ok) {
      if (statusEl) statusEl.innerHTML = d.error?.includes('APIFY_API_KEY')
        ? _apNoKeyBanner('Organic Social Monitor')
        : _apAlert(d.error || 'Failed to start', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Search TikTok'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('TikTok scrape running… checking every 8s (usually 30-90s)');
    window._apPoll(d.run_id, d.dataset_id, 'organic', btn, statusEl, resEl, 0, keyword, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Search TikTok'; }
  }
};

function _renderOrganic(items, keyword) {
  const el = document.getElementById('orgResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No videos found — try a different keyword or hashtag', 'info'); return; }
  window._orgLastItems   = items;
  window._orgLastKeyword = keyword;
  const totalViews = items.reduce((a, v) => a + (parseInt(v.playCount) || 0), 0);
  const avgLikes   = Math.round(items.reduce((a, v) => a + (parseInt(v.diggCount) || 0), 0) / items.length);
  const topVideo   = items.reduce((best, v) => (parseInt(v.playCount)||0) > (parseInt(best.playCount)||0) ? v : best, items[0]);
  const cards = items.map((v, i) => {
    const views    = parseInt(v.playCount)    || 0;
    const likes    = parseInt(v.diggCount)    || 0;
    const comments = parseInt(v.commentCount) || 0;
    const shares   = parseInt(v.shareCount)   || 0;
    const author   = v.authorMeta?.name || v.author?.nickname || v.authorNickname || 'unknown';
    const desc     = (v.text || v.description || '').slice(0, 220);
    const url      = v.webVideoUrl || v.videoUrl || '';
    const er       = views > 0 ? ((likes / views) * 100).toFixed(2) + '%' : '—';
    const isTop    = i === 0 && views > 0;
    return `<div style="background:var(--bg-card,#fff);border:1px solid ${isTop?'#667eea':'#E5E7EB'};border-radius:10px;padding:14px;position:relative">
      ${isTop?'<div style="position:absolute;top:10px;right:10px;background:#667eea;color:#fff;font-size:0.65rem;font-weight:800;padding:2px 7px;border-radius:10px">👑 TOP</div>':''}
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:32px;height:32px;background:linear-gradient(135deg,#E21221,#FF0050);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;font-weight:700;flex-shrink:0">${_apEsc(author.slice(0,2).toUpperCase())}</div>
        <div style="font-weight:700;font-size:0.85rem;color:#1E1B4B">@${_apEsc(author)}</div>
        ${url ? `<a href="${_apEsc(url)}" target="_blank" rel="noopener" style="margin-left:auto;font-size:0.72rem;color:#FF0050;font-weight:700;text-decoration:none;white-space:nowrap">▶ Watch →</a>` : ''}
      </div>
      <div style="font-size:0.79rem;color:#374151;line-height:1.5;margin-bottom:10px;min-height:36px">${_apEsc(desc)}</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;font-size:0.7rem;text-align:center">
        ${[['👁',_apFmt(views),'Views'],['❤️',_apFmt(likes),'Likes'],['💬',_apFmt(comments),'Comments'],['📤',_apFmt(shares),'Shares']].map(([ic,val,lbl])=>
          `<div style="background:#F9FAFB;border-radius:6px;padding:5px 3px"><div style="font-size:0.95rem">${ic}</div><div style="font-weight:700;color:#0A1628;font-size:0.78rem">${val}</div><div style="color:#9CA3AF">${lbl}</div></div>`
        ).join('')}
      </div>
      <div style="margin-top:8px;font-size:0.72rem;color:#6B7280">ER: <strong style="color:${parseFloat(er)>2?'#16a34a':parseFloat(er)>0.5?'#d97706':'#dc2626'}">${er}</strong></div>
    </div>`;
  }).join('');
  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
  ${[['📹',items.length + ' Videos','Found'],['👁',_apFmt(totalViews),'Total Views'],['❤️',_apFmt(avgLikes)+' avg','Likes/Video']].map(([ic,v,l])=>
    `<div style="background:var(--bg-card,#fff);border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.4rem">${ic}</div><div style="font-weight:800;font-size:1.1rem;color:#0A1628">${v}</div><div style="font-size:0.72rem;color:#9CA3AF">${l}</div></div>`
  ).join('')}
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
  <div style="font-weight:700;color:#0A1628">TikTok results for "<span style="color:#667eea">${_apEsc(keyword)}</span>"</div>
  <button onclick="window._orgExport()" class="btn btn-secondary" style="font-size:0.78rem">⬇ Export CSV</button>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px">${cards}</div>`;
}

window._orgExport = function() {
  const items = window._orgLastItems || [];
  const rows  = [['Author', 'Description', 'Views', 'Likes', 'Comments', 'Shares', 'EngagementRate%', 'URL']];
  items.forEach(v => {
    const views = parseInt(v.playCount)||0;
    const likes = parseInt(v.diggCount)||0;
    const er = views > 0 ? ((likes/views)*100).toFixed(2) : '0';
    rows.push([
      v.authorMeta?.name || v.author?.nickname || '',
      '"' + (v.text||v.description||'').replace(/"/g,'""').replace(/\n/g,' ') + '"',
      views, likes, parseInt(v.commentCount)||0, parseInt(v.shareCount)||0, er,
      v.webVideoUrl || v.videoUrl || ''
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'tiktok_organic_' + (window._orgLastKeyword||'export').replace(/\W+/g,'_') + '.csv';
  a.click();
};

// ═══════════════════════════════════════════════════════════════════════════
//  T66 · LOCAL LEAD FINDER
// ═══════════════════════════════════════════════════════════════════════════

window.buildLocalLeads = function() {
  const wrap = document.getElementById('localLeadsWrap');
  if (!wrap || wrap._built) return;
  wrap._built = true;
  wrap.innerHTML = `
<div class="ig-page-header" style="padding-bottom:0">
  <h1 style="margin-bottom:4px">📍 Local Lead Finder</h1>
  <p style="color:var(--text-muted)">Pull live business leads from Google Maps — name, address, phone, website, rating, hours. Export to CSV or push to HubSpot.</p>
</div>
<div class="ig-card" style="margin-bottom:20px">
  <div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:10px;align-items:end">
    <div>
      <label class="ig-label">Business Category</label>
      <input id="llCat" class="ig-input" placeholder="e.g. dentists, gyms, coffee shops">
    </div>
    <div>
      <label class="ig-label">Location</label>
      <input id="llLoc" class="ig-input" placeholder="e.g. Miami FL, London UK, Toronto">
    </div>
    <div>
      <label class="ig-label">Limit</label>
      <select id="llLimit" class="ig-select">
        <option value="10">10</option>
        <option value="20" selected>20</option>
        <option value="30">30</option>
      </select>
    </div>
    <button id="llRunBtn" class="btn btn-primary" onclick="window._llRun()">🗺 Find Leads</button>
  </div>
  <div id="llStatus" style="margin-top:10px"></div>
</div>
<div id="llResults"></div>`;
};

window._llRun = async function() {
  const cat   = (document.getElementById('llCat')||{}).value?.trim();
  const loc   = (document.getElementById('llLoc')||{}).value?.trim();
  const limit = parseInt((document.getElementById('llLimit')||{}).value) || 20;
  const statusEl = document.getElementById('llStatus');
  const resEl    = document.getElementById('llResults');
  const btn      = document.getElementById('llRunBtn');
  if (!cat || !loc) { if (statusEl) statusEl.innerHTML = _apAlert('Category and location are both required', 'error'); return; }
  const query = `${cat} in ${loc}`;
  if (statusEl) statusEl.innerHTML = _apSpinner(`Starting Google Maps scrape for "${query}"…`);
  if (resEl)    resEl.innerHTML = '';
  if (btn)      { btn.disabled = true; btn.textContent = '⏳ Starting…'; }
  try {
    const d = await fetch('/api/apify/maps-leads', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit })
    }).then(r => r.json());
    if (!d.ok) {
      if (statusEl) statusEl.innerHTML = d.error?.includes('APIFY_API_KEY')
        ? _apNoKeyBanner('Local Lead Finder')
        : _apAlert(d.error || 'Failed to start', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🗺 Find Leads'; }
      return;
    }
    if (statusEl) statusEl.innerHTML = _apSpinner('Maps scrape running… checking every 8s (usually 45-120s)');
    window._apPoll(d.run_id, d.dataset_id, 'leads', btn, statusEl, resEl, 0, query, limit);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = _apAlert('Request failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗺 Find Leads'; }
  }
};

function _llStars(r) {
  const full = Math.round(r || 0);
  return '★'.repeat(full) + '☆'.repeat(Math.max(0, 5 - full));
}

function _renderLeads(items, query) {
  const el = document.getElementById('llResults');
  if (!el) return;
  if (!items.length) { el.innerHTML = _apAlert('No businesses found — try a broader category or different location', 'info'); return; }
  window._llLastItems = items;
  window._llLastQuery = query;
  const withPhone   = items.filter(b => b.phone || b.phoneUnformatted).length;
  const withWebsite = items.filter(b => b.website).length;
  const avgRating   = items.reduce((a, b) => a + (parseFloat(b.totalScore) || 0), 0) / items.length;
  const cards = items.map(b => {
    const name    = b.title || b.name || '';
    const addr    = b.address || b.vicinity || '';
    const phone   = b.phone || b.phoneUnformatted || '';
    const website = b.website || '';
    const rating  = parseFloat(b.totalScore || b.rating) || 0;
    const reviews = parseInt(b.reviewsCount || b.userRatingsTotal) || 0;
    const cat     = (Array.isArray(b.categories) ? b.categories[0] : b.categoryName) || '';
    const hours   = b.openingHours?.join(', ') || '';
    const mapUrl  = b.url || '';
    return `<div style="background:var(--bg-card,#fff);border:1px solid #E5E7EB;border-radius:10px;padding:14px">
      <div style="font-weight:700;font-size:0.9rem;color:#1E1B4B;margin-bottom:2px">${_apEsc(name)}</div>
      ${cat ? `<div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:6px;text-transform:capitalize">${_apEsc(cat)}</div>` : ''}
      ${rating ? `<div style="color:#F59E0B;font-size:0.82rem;margin-bottom:5px" title="${rating.toFixed(1)} stars, ${reviews} reviews">${_llStars(rating)} <span style="color:#6B7280;font-size:0.72rem">${rating.toFixed(1)} (${_apFmt(reviews)})</span></div>` : ''}
      ${addr    ? `<div style="font-size:0.78rem;color:#374151;margin-bottom:3px">📍 ${_apEsc(addr)}</div>` : ''}
      ${phone   ? `<div style="font-size:0.78rem;color:#374151;margin-bottom:3px">📞 <a href="tel:${_apEsc(phone)}" style="color:#0066FF">${_apEsc(phone)}</a></div>` : ''}
      ${website ? `<div style="font-size:0.78rem;margin-bottom:6px">🌐 <a href="${_apEsc(website)}" target="_blank" rel="noopener" style="color:#0066FF">${_apEsc(website.replace(/^https?:\/\//,'').slice(0,38))}</a></div>` : ''}
      ${hours   ? `<div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:8px" title="${_apEsc(hours)}">🕐 ${_apEsc(hours.slice(0,60))}${hours.length>60?'…':''}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${mapUrl  ? `<a href="${_apEsc(mapUrl)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px">🗺 Maps</a>` : ''}
        ${website ? `<a href="${_apEsc(website)}" target="_blank" rel="noopener" class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px">🌐 Site</a>` : ''}
        <button onclick='window._llCopyLead(${JSON.stringify({name,addr,phone,website}).replace(/'/g,"&#39;")})' class="btn btn-secondary" style="font-size:0.7rem;padding:4px 10px">📋 Copy</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
  ${[['📍',items.length + ' Businesses','Found'],['📞',withPhone + ' / ' + items.length,'With Phone'],['🌐',withWebsite + ' / ' + items.length,'With Website']].map(([ic,v,l])=>
    `<div style="background:var(--bg-card,#fff);border:1px solid #E5E7EB;border-radius:10px;padding:14px;text-align:center"><div style="font-size:1.4rem">${ic}</div><div style="font-weight:800;font-size:1.05rem;color:#0A1628">${v}</div><div style="font-size:0.72rem;color:#9CA3AF">${l}</div></div>`
  ).join('')}
</div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
  <div style="font-weight:700;color:#0A1628">Results for "<span style="color:#667eea">${_apEsc(query)}</span>"</div>
  <div style="display:flex;gap:8px">
    <button onclick="window._llExport()" class="btn btn-secondary" style="font-size:0.78rem">⬇ Export CSV</button>
    <button onclick="window._llPushHubSpot()" class="btn btn-secondary" style="font-size:0.78rem">→ HubSpot</button>
  </div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(255px,1fr));gap:12px">${cards}</div>`;
}

window._llCopyLead = function(lead) {
  const text = [lead.name, lead.addr, lead.phone, lead.website].filter(Boolean).join('\n');
  navigator.clipboard?.writeText(text).catch(() => {});
};

window._llExport = function() {
  const items = window._llLastItems || [];
  const rows  = [['Name','Category','Address','Phone','Website','Rating','Reviews']];
  items.forEach(b => rows.push([
    '"' + (b.title||b.name||'').replace(/"/g,'""') + '"',
    '"' + ((Array.isArray(b.categories)?b.categories[0]:b.categoryName)||'').replace(/"/g,'""') + '"',
    '"' + (b.address||b.vicinity||'').replace(/"/g,'""') + '"',
    b.phone||b.phoneUnformatted||'',
    b.website||'',
    b.totalScore||b.rating||'',
    b.reviewsCount||b.userRatingsTotal||''
  ]));
  const csv = rows.map(r => r.join(',')).join('\n');
  const a   = document.createElement('a');
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'local_leads_' + (window._llLastQuery||'export').replace(/\W+/g,'_') + '.csv';
  a.click();
};

window._llPushHubSpot = async function() {
  const items = window._llLastItems || [];
  if (!items.length) return;
  const btn = document.querySelector('[onclick="window._llPushHubSpot()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Pushing…'; }
  let ok = 0; let fail = 0;
  for (const b of items.slice(0, 20)) {
    const name = b.title || b.name || 'Unknown';
    try {
      const r = await fetch('/api/hubspot/create-company', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          domain: b.website ? b.website.replace(/^https?:\/\//,'').split('/')[0] : '',
          phone: b.phone || b.phoneUnformatted || '',
          address: b.address || '',
          city: b.city || '',
          country: b.countryCode || ''
        })
      }).then(x => x.json());
      if (r.ok) ok++; else fail++;
    } catch (_) { fail++; }
  }
  if (btn) { btn.disabled = false; btn.textContent = '→ HubSpot'; }
  const statusEl = document.getElementById('llStatus');
  if (statusEl) statusEl.innerHTML = _apAlert(`Pushed to HubSpot: ${ok} companies created${fail?' · '+fail+' failed':''}`, ok > 0 ? 'success' : 'error');
};

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED APIFY POLLER
// ═══════════════════════════════════════════════════════════════════════════

window._apPoll = function(runId, datasetId, mode, btn, statusEl, resEl, attempts, query, limit) {
  const MAX      = 40; // 40 × 8s = ~5.5 min
  const btnLabel = mode === 'organic' ? '🔍 Search TikTok' : '🗺 Find Leads';
  if (attempts >= MAX) {
    if (statusEl) statusEl.innerHTML = _apAlert('Apify timed out — the scraper took too long. Try a smaller result count.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    return;
  }
  setTimeout(async () => {
    try {
      const url = `/api/apify/run-status?run_id=${encodeURIComponent(runId)}&dataset_id=${encodeURIComponent(datasetId||'')}&limit=${limit||25}`;
      const d   = await fetch(url, { credentials: 'same-origin' }).then(r => r.json());
      if (d.error) {
        if (statusEl) statusEl.innerHTML = _apAlert(d.error, 'error');
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        return;
      }
      if (d.status === 'failed') {
        if (statusEl) statusEl.innerHTML = _apAlert('Scrape failed: ' + (d.error || 'unknown'), 'error');
        if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
        return;
      }
      if (d.status === 'pending') {
        if (statusEl) statusEl.innerHTML = _apSpinner(`Still running… attempt ${attempts + 1}/${MAX} (${(attempts+1)*8}s elapsed)`);
        window._apPoll(runId, datasetId, mode, btn, statusEl, resEl, attempts + 1, query, limit);
        return;
      }
      // Complete
      if (statusEl) statusEl.innerHTML = _apAlert(`✓ Scraped ${(d.items||[]).length} results`, 'success');
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
      if (mode === 'organic') _renderOrganic(d.items || [], query || '');
      else                    _renderLeads(d.items || [], query || '');
    } catch (e) {
      if (statusEl) statusEl.innerHTML = _apAlert('Poll error: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    }
  }, 8000);
};

})();

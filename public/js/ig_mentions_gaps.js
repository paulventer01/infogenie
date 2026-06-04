/* ============================================================================
 * ig_mentions_gaps.js — Mention Tracker · Real-time Alerts · Content Gaps ·
 *   Cross-Channel Report · Stakeholder digests · Webhook channels ·
 *   Launch Calendar · Company Intel · Ad-Platform Connections · AI Optimizer
 *   dashboard (incl. creative-refresh / bandit / fatigue panels).
 * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
 * loaded after app.js in index.html. Wrapped in one IIFE; public entry points
 * and onclick targets re-exported to window at the bottom.
 *
 * Shared from app.js (NOT moved — read at call time via the global scope):
 *   _esc, _escapeHtml, _safeUrl, showToast, navigateTo, analysisData,
 *   currentCampaign, and the window._* state globals these views own
 *   (window._mentionsState, _gapsState, _cgSelectedComps, _ccrState,
 *   _alertsState, …).
 * ========================================================================== */

(function () {
/* =============================================================================
   FEATURE 1: MENTION TRACKER + SENTIMENT
   ============================================================================= */
window._mentionsState = { brand:'', competitors:[], country:'US', days:30, data:null, loading:false };
window._mtSelectedComps = window._mtSelectedComps || [];
window._mtSelectedCountries = window._mtSelectedCountries || [];

function buildMentionTracker() {
  const wrap = document.getElementById('mentionsWrap');
  if (!wrap) return;
  // ── Auto-derive from analysisData (set by the home-page "enter a website
  // or sector" analysis). Falls back to currentCampaign for legacy state.
  const camp = window.currentCampaign || {};
  const analysisBrand = _getBrandFromAnalysis();
  const brand = window._mentionsState.brand || analysisBrand || camp.brand || camp.businessName || '';

  const detectedCompetitors = _getCompetitorsFromAnalysis();
  const competitorOptions = detectedCompetitors.map(c => ({ value: c.name, label: c.name }));
  // First time visiting after an analysis: pre-select every detected competitor
  // (matches what the user expects when they see the dropdown auto-populated).
  if (window._mtSelectedComps.length === 0 && competitorOptions.length > 0 && !window._mtSelectedCompsTouched) {
    window._mtSelectedComps = competitorOptions.map(o => o.value).slice(0, 4);
  }

  // Country list — broad coverage with a GLOBAL option that omits the
  // location filter on the server. Synced with server _COUNTRY_TO_DFS_LOC.
  const COUNTRIES = [
    ['GLOBAL','🌍 Global (worldwide)'],
    ['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],['NZ','New Zealand'],['IE','Ireland'],
    ['DE','Germany'],['FR','France'],['ES','Spain'],['IT','Italy'],['NL','Netherlands'],['BE','Belgium'],['CH','Switzerland'],['AT','Austria'],['PT','Portugal'],
    ['SE','Sweden'],['NO','Norway'],['DK','Denmark'],['FI','Finland'],['PL','Poland'],['CZ','Czech Republic'],['HU','Hungary'],['RO','Romania'],['GR','Greece'],['UA','Ukraine'],['RU','Russia'],
    ['JP','Japan'],['KR','South Korea'],['IN','India'],['SG','Singapore'],['MY','Malaysia'],['TH','Thailand'],['ID','Indonesia'],['PH','Philippines'],['VN','Vietnam'],
    ['BR','Brazil'],['MX','Mexico'],['AR','Argentina'],['CL','Chile'],['CO','Colombia'],
    ['ZA','South Africa'],['NG','Nigeria'],['KE','Kenya'],['EG','Egypt'],
    ['AE','UAE'],['SA','Saudi Arabia'],['IL','Israel'],['TR','Turkey']
  ];
  const countryOptions = COUNTRIES.map(([code, label]) => ({ value: code, label }));
  // Default: "Global" so users without prior preference get worldwide coverage.
  // Safety reset: if a previous session left a runaway selection (e.g. user
  // hit "Select All" by accident), clamp back to GLOBAL so the next Pull
  // doesn't fan out to dozens of slow per-region Google News calls.
  if (window._mtSelectedCountries.length > 10) {
    console.warn('[mt] resetting runaway country selection (' + window._mtSelectedCountries.length + ') back to GLOBAL');
    window._mtSelectedCountries = ['GLOBAL'];
    window._mtSelectedCountriesTouched = false;
  }
  if (window._mtSelectedCountries.length === 0 && !window._mtSelectedCountriesTouched) {
    const initialCountry = window._mentionsState.country || 'GLOBAL';
    window._mtSelectedCountries = [initialCountry];
  }

  // Register multiselect metadata so the toggle/all/flip helpers can find them.
  _igMultiselectInit({
    id: 'mtComps', options: competitorOptions, stateKey: '_mtSelectedComps',
    emptyLabel: detectedCompetitors.length ? 'Select competitors' : 'No competitors detected yet',
    onChange: () => { window._mtSelectedCompsTouched = true; },
  });
  _igMultiselectInit({
    id: 'mtCountry', options: countryOptions, stateKey: '_mtSelectedCountries',
    emptyLabel: 'Select country / region',
    onChange: () => { window._mtSelectedCountriesTouched = true; },
  });

  window._mentionsState.brand = brand;

  wrap.innerHTML = `
    <div class="mt-controls">
      <div class="mt-control">
        <label class="mt-lbl">Your brand</label>
        <input id="mtBrand" type="text" class="mt-input" placeholder="Acme Inc" value="${_esc(brand)}" maxlength="80" title="${analysisBrand ? `Auto-filled from your home-page analysis (${_esc(analysisBrand)})` : 'Type your brand name'}" />
      </div>
      <div class="mt-control" style="flex:2">
        <label class="mt-lbl">Competitors ${detectedCompetitors.length ? `· <span style="font-weight:400;color:#64748B">${detectedCompetitors.length} detected from your analysis</span>` : ''}</label>
        ${_igMultiselect({ id:'mtComps', options:competitorOptions, stateKey:'_mtSelectedComps', emptyLabel: detectedCompetitors.length ? 'Select competitors' : 'No competitors detected yet' })}
      </div>
      <div class="mt-control" style="flex:0 0 220px">
        <label class="mt-lbl">Country / region</label>
        ${_igMultiselect({ id:'mtCountry', options:countryOptions, stateKey:'_mtSelectedCountries', emptyLabel:'Select country / region' })}
      </div>
      <div class="mt-control" style="flex:0 0 110px">
        <label class="mt-lbl">Window</label>
        <select id="mtDays" class="mt-input">
          <option value="7" ${window._mentionsState.days===7?'selected':''}>7 days</option>
          <option value="14" ${window._mentionsState.days===14?'selected':''}>14 days</option>
          <option value="30" ${window._mentionsState.days===30?'selected':''}>30 days</option>
          <option value="60" ${window._mentionsState.days===60?'selected':''}>60 days</option>
          <option value="90" ${window._mentionsState.days===90?'selected':''}>90 days</option>
        </select>
      </div>
      <div class="mt-control" style="flex:0 0 auto;justify-content:flex-end;display:flex;align-items:flex-end">
        <button class="mt-btn-run" id="mtRun" onclick="runMentionTracker()">🔍 Pull mentions</button>
      </div>
    </div>
    <div id="mtResults" style="margin-top:24px"></div>
  `;
  if (brand) {
    document.getElementById('mtResults').innerHTML = `<div class="mt-empty">Click <strong>Pull mentions</strong> to analyse coverage for <strong>${_esc(brand)}</strong>${competitorOptions.length ? ` and ${window._mtSelectedComps.length} competitor${window._mtSelectedComps.length===1?'':'s'}` : ''}.</div>`;
  } else {
    document.getElementById('mtResults').innerHTML = `<div class="mt-empty">Run an analysis on the home page first, or type your brand name above and click <strong>Pull mentions</strong>.</div>`;
  }
}

async function runMentionTracker() {
  const brand = (document.getElementById('mtBrand')?.value || '').trim();
  const competitors = (window._mtSelectedComps || []).slice(0, 4);
  // Country selection is now multi-select. The /api/mentions endpoint accepts
  // a single country code per call, so we run one call per selected country
  // and merge the results client-side. "GLOBAL" alone is the default.
  let countries = (window._mtSelectedCountries || []).slice();
  if (!countries.length) countries = ['GLOBAL'];
  // If user picked GLOBAL alongside specific countries, GLOBAL alone subsumes
  // the others — just use GLOBAL to avoid duplicate news being merged.
  if (countries.includes('GLOBAL')) countries = ['GLOBAL'];
  // Soft cap: pulling Google News for many regions × many brands is genuinely
  // slow (each region = one DataForSEO call per brand, 8s timeout each).
  // Warn the user and offer to switch to GLOBAL when they pick > 10 regions.
  if (countries.length > 10) {
    const ok = confirm(`You picked ${countries.length} regions × ${1+competitors.length} brand${competitors.length?'s':''} = up to ${countries.length*(1+competitors.length)} Google News pulls. This will take 1-3 minutes.\n\nClick OK to continue, or Cancel to switch to a single fast worldwide pull (recommended).`);
    if (!ok) {
      window._mtSelectedCountries = ['GLOBAL'];
      countries = ['GLOBAL'];
      // Re-render the form so the user sees the new selection.
      try { if (typeof buildMentions === 'function') buildMentions(); } catch(_) {}
    }
  }
  const days = parseInt(document.getElementById('mtDays')?.value || '30', 10) || 30;
  if (!brand) { showToast('⚠️ Enter your brand name'); return; }

  window._mentionsState = { brand, competitors, country: countries[0], days, data:null, loading:true };
  const btn = document.getElementById('mtRun');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Pulling…'; }
  const results = document.getElementById('mtResults');
  const totalRegions = countries.length;
  const startedAt = Date.now();
  let done = 0;
  const renderProgress = () => {
    if (!results) return;
    const elapsed = Math.floor((Date.now() - startedAt)/1000);
    const mm = String(Math.floor(elapsed/60)).padStart(2,'0');
    const ss = String(elapsed%60).padStart(2,'0');
    results.innerHTML = `<div class="mt-loading" style="text-align:center;padding:24px">
      <div style="font-size:0.95rem;font-weight:700;color:#0F172A;margin-bottom:6px">⏳ Pulling Google News for ${[brand, ...competitors].length} brand${competitors.length?'s':''}</div>
      <div style="font-size:0.82rem;color:#475569;margin-bottom:10px">${done} of ${totalRegions} ${totalRegions===1?'region':'regions'} complete · then classifying sentiment</div>
      <div style="font-size:1.5rem;font-family:'Sora',sans-serif;font-weight:800;color:#0066FF">⏱ ${mm}:${ss}</div>
      <div style="background:#E2E8F0;border-radius:99px;height:8px;margin-top:12px;max-width:320px;margin-left:auto;margin-right:auto;overflow:hidden">
        <div style="background:linear-gradient(90deg,#0066FF,#00C9C8);height:100%;width:${Math.max(4,(done/Math.max(1,totalRegions))*100)}%;transition:width .3s"></div>
      </div>
    </div>`;
  };
  renderProgress();
  const tickHandle = setInterval(renderProgress, 1000);

  try {
    // Throttle to 12 concurrent region fetches — DataForSEO comfortably
    // handles this and it cuts wall-clock time roughly in half versus 6.
    const CONCURRENCY = 12;
    const responses = new Array(countries.length);
    let cursor = 0;
    async function worker() {
      while (cursor < countries.length) {
        const myIdx = cursor++;
        const country = countries[myIdx];
        try {
          const r = await fetch('/api/mentions', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ brand, competitors, country, days }),
          });
          const txt = await r.text();
          try { responses[myIdx] = JSON.parse(txt); }
          catch(_) { responses[myIdx] = { ok:false, error:`Server returned non-JSON (HTTP ${r.status})` }; }
        } catch (e) {
          responses[myIdx] = { ok:false, error: e.message };
        }
        done++;
        renderProgress();
      }
    }
    await Promise.all(Array.from({length: Math.min(CONCURRENCY, countries.length)}, worker));
    clearInterval(tickHandle);
    const ok = responses.find(r => r.ok);
    if (!ok) throw new Error((responses.find(r => !r.ok) || {}).error || 'Failed to fetch mentions');
    let merged;
    if (responses.length === 1) {
      merged = responses[0];
    } else {
      // Multi-country merge. Dedupe by **brand + normalized url** so the same
      // article appearing under two different brand queries (or the same
      // brand in two regions) is only counted once for that brand. Output
      // matches the server's response shape exactly so renderMentionResults
      // works unchanged: `sov` is a daily timeline `[{date, byBrand}]`.
      const seen = new Set();
      const allMentions = [];
      const byBrand = {};
      const byBrandSent = {};
      const sentiment = { positive:0, neutral:0, negative:0 };
      const sourceCount = {};
      const allBrands = [brand, ...competitors];
      allBrands.forEach(b => {
        byBrand[b] = 0;
        byBrandSent[b] = { positive:0, neutral:0, negative:0 };
      });
      responses.filter(r => r.ok).forEach(r => {
        (r.mentions || []).forEach(m => {
          const urlKey = String(m.url || '').toLowerCase().replace(/[?#].*$/, '');
          const key = `${m.brand}::${urlKey}`;
          if (seen.has(key)) return;
          seen.add(key);
          allMentions.push(m);
          if (m.brand) {
            byBrand[m.brand] = (byBrand[m.brand] || 0) + 1;
            byBrandSent[m.brand] = byBrandSent[m.brand] || { positive:0, neutral:0, negative:0 };
            const s = (m.sentiment || 'neutral');
            byBrandSent[m.brand][s] = (byBrandSent[m.brand][s] || 0) + 1;
            sentiment[s] = (sentiment[s] || 0) + 1;
          }
          if (m.source) sourceCount[m.source] = (sourceCount[m.source] || 0) + 1;
        });
      });
      // Sort newest-first to match server behaviour
      allMentions.sort((a, b) => {
        const ta = a.date ? Date.parse(a.date) : 0;
        const tb = b.date ? Date.parse(b.date) : 0;
        return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
      });
      // Build daily SoV buckets in the same shape the renderer expects
      const today = new Date(); today.setUTCHours(0,0,0,0);
      const sov = [];
      for (let d = days - 1; d >= 0; d--) {
        const dt = new Date(today.getTime() - d * 86400000);
        const bucket = { date: dt.toISOString().slice(0, 10), byBrand: {} };
        allBrands.forEach(b => { bucket.byBrand[b] = 0; });
        sov.push(bucket);
      }
      allMentions.forEach(m => {
        if (!m.date) return;
        const t = Date.parse(m.date);
        if (isNaN(t)) return;
        const dt = new Date(t); dt.setUTCHours(0,0,0,0);
        const key = dt.toISOString().slice(0, 10);
        const bucket = sov.find(b => b.date === key);
        if (bucket && m.brand) bucket.byBrand[m.brand] = (bucket.byBrand[m.brand] || 0) + 1;
      });
      const topSources = Object.entries(sourceCount)
        .map(([source, count]) => ({ source, count }))
        .sort((a,b) => b.count - a.count)
        .slice(0, 12);
      merged = {
        ok: true, brand, competitors, country: countries.join('+'), days,
        mentions: allMentions, byBrand, byBrandSent, sentiment, sov, topSources,
        total: allMentions.length,
        dataOrigin: `DataForSEO Google News (${countries.length} regions merged, ${allMentions.length} mentions) + AI sentiment`,
        dataSource: 'DataForSEO + AI-verified',
        confidence: allMentions.length >= 10 ? 'high' : allMentions.length >= 3 ? 'medium' : 'low',
      };
    }
    window._mentionsState.data = merged;
    renderMentionResults(merged);
  } catch (e) {
    if (results) results.innerHTML = `<div class="mt-error">⚠️ ${_esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Pull mentions'; }
    window._mentionsState.loading = false;
  }
}

function renderMentionResults(d) {
  const wrap = document.getElementById('mtResults');
  if (!wrap) return;
  const total = d.total || 0;
  if (!total) {
    wrap.innerHTML = `<div class="mt-empty">No mentions found in the last ${d.days} days. Try a longer window or check the brand spelling.</div>`;
    return;
  }
  const allBrands = [d.brand, ...(d.competitors || [])];
  const brandColors = ['#0066FF','#10B981','#F59E0B','#EC4899','#8B5CF6'];

  const sentBadge = (s) => {
    const styles = { positive:{bg:'#DCFCE7',color:'#166534',icon:'😊'}, neutral:{bg:'#F1F5F9',color:'#475569',icon:'😐'}, negative:{bg:'#FEE2E2',color:'#991B1B',icon:'☹️'} };
    const cfg = styles[s] || styles.neutral;
    return `<span class="mt-sent-chip" style="background:${cfg.bg};color:${cfg.color}">${cfg.icon} ${s}</span>`;
  };

  const total_sent = d.sentiment.positive + d.sentiment.neutral + d.sentiment.negative;
  const sentPct = (k) => total_sent > 0 ? Math.round((d.sentiment[k] / total_sent) * 100) : 0;

  const sentBarHtml = `
    <div class="mt-sent-bar">
      <div class="mt-sent-seg" style="width:${sentPct('positive')}%;background:#10B981" title="Positive: ${d.sentiment.positive}"></div>
      <div class="mt-sent-seg" style="width:${sentPct('neutral')}%;background:#94A3B8" title="Neutral: ${d.sentiment.neutral}"></div>
      <div class="mt-sent-seg" style="width:${sentPct('negative')}%;background:#EF4444" title="Negative: ${d.sentiment.negative}"></div>
    </div>
    <div class="mt-sent-legend">
      <span><span class="mt-dot" style="background:#10B981"></span> Positive ${d.sentiment.positive} (${sentPct('positive')}%)</span>
      <span><span class="mt-dot" style="background:#94A3B8"></span> Neutral ${d.sentiment.neutral} (${sentPct('neutral')}%)</span>
      <span><span class="mt-dot" style="background:#EF4444"></span> Negative ${d.sentiment.negative} (${sentPct('negative')}%)</span>
    </div>
  `;

  const brandRows = allBrands.map((b, i) => {
    const c = d.byBrand[b] || 0;
    const sb = d.byBrandSent[b] || { positive:0, neutral:0, negative:0 };
    const color = brandColors[i % brandColors.length];
    const total = sb.positive + sb.neutral + sb.negative;
    const pp = total ? (sb.positive/total)*100 : 0;
    const pn = total ? (sb.neutral/total)*100  : 0;
    const pg = total ? (sb.negative/total)*100 : 0;
    return `<tr>
      <td style="font-weight:700"><span class="mt-brand-dot" style="background:${color}"></span>${_esc(b)}</td>
      <td style="text-align:right;font-weight:700">${c}</td>
      <td><div class="mt-mini-bar"><span style="background:#10B981;width:${pp}%"></span><span style="background:#94A3B8;width:${pn}%"></span><span style="background:#EF4444;width:${pg}%"></span></div></td>
      <td style="text-align:right;color:#64748b;font-size:.78rem">${sb.positive}/${sb.neutral}/${sb.negative}</td>
    </tr>`;
  }).join('');

  const sourceRows = (d.topSources || []).map(s => `
    <tr><td>${_esc(s.source)}</td><td style="text-align:right;font-weight:700">${s.count}</td></tr>
  `).join('');

  const mentionCards = d.mentions.slice(0, 60).map(m => {
    let dateStr = '';
    if (m.date) {
      const t = Date.parse(m.date);
      if (!isNaN(t)) {
        const ago = Math.floor((Date.now() - t) / 86400000);
        dateStr = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago}d ago`;
      }
    }
    return `<div class="mt-mention">
      <div class="mt-mention-head">
        <span class="mt-mention-brand">${_esc(m.brand)}</span>
        ${sentBadge(m.sentiment)}
        <span class="mt-mention-source">${_esc(m.source || '')}</span>
        ${dateStr ? `<span class="mt-mention-date">· ${_esc(dateStr)}</span>` : ''}
      </div>
      <a class="mt-mention-title" href="${_esc(m.url)}" target="_blank" rel="noopener noreferrer">${_esc(m.title)}</a>
      ${m.snippet ? `<div class="mt-mention-snip">${_esc(m.snippet)}</div>` : ''}
      ${m.sentimentReason ? `<div class="mt-mention-why">💭 ${_esc(m.sentimentReason)}</div>` : ''}
    </div>`;
  }).join('');

  const ribbon = `<div class="mt-ribbon"><span class="mt-ribbon-dot" style="background:#10B981"></span><span>📊 ${_esc(d.dataSource || 'DataForSEO')}</span><span style="opacity:.5">·</span><span style="text-transform:uppercase;letter-spacing:.04em;font-size:.65rem">${_esc(d.confidence || 'medium')} confidence</span><span style="opacity:.5">·</span><span style="font-weight:500;opacity:.85">${_esc(d.dataOrigin || '')}</span></div>`;

  wrap.innerHTML = `
    ${ribbon}
    <div class="mt-grid">
      <div class="mt-card mt-card-wide">
        <h4 class="mt-h">Sentiment breakdown</h4>
        ${sentBarHtml}
      </div>
      <div class="mt-card">
        <h4 class="mt-h">Mentions by brand</h4>
        <table class="mt-table">
          <thead><tr><th>Brand</th><th style="text-align:right">Total</th><th>Sentiment mix</th><th style="text-align:right">P/N/Ng</th></tr></thead>
          <tbody>${brandRows}</tbody>
        </table>
      </div>
      <div class="mt-card">
        <h4 class="mt-h">Top sources</h4>
        <table class="mt-table">
          <thead><tr><th>Source</th><th style="text-align:right">Mentions</th></tr></thead>
          <tbody>${sourceRows || '<tr><td colspan="2" style="color:#94a3b8;text-align:center">No source data</td></tr>'}</tbody>
        </table>
      </div>
      <div class="mt-card mt-card-wide">
        <h4 class="mt-h">Daily share-of-voice — last ${d.days} days</h4>
        <div style="position:relative;height:280px;width:100%">
          <canvas id="mtSovChart"></canvas>
        </div>
      </div>
      <div class="mt-card mt-card-wide">
        <h4 class="mt-h">Recent mentions (${d.mentions.length})</h4>
        <div class="mt-mentions-list">${mentionCards}</div>
      </div>
    </div>
  `;

  // Render SOV chart
  setTimeout(() => {
    const canvas = document.getElementById('mtSovChart');
    if (!canvas || !window.Chart) return;
    const labels = d.sov.map(b => b.date.slice(5));
    const datasets = allBrands.map((b, i) => ({
      label: b,
      data: d.sov.map(s => s.byBrand[b] || 0),
      borderColor: brandColors[i % brandColors.length],
      backgroundColor: brandColors[i % brandColors.length] + '20',
      tension: 0.3, fill: false, borderWidth: 2, pointRadius: 2
    }));
    if (window._mtSovChart) try { window._mtSovChart.destroy(); } catch {}
    window._mtSovChart = new Chart(canvas, {
      type:'line',
      data:{ labels, datasets },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'bottom', labels:{ font:{size:11}, boxWidth:10 } } },
        scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1, font:{size:10} } }, x:{ ticks:{ font:{size:10}, maxRotation:0, autoSkip:true, maxTicksLimit:10 } } }
      }
    });
  }, 50);
}

/* =============================================================================
   FEATURE 2: REAL-TIME ALERTS — bell, panel, polling
   ============================================================================= */
window._alertsState = { open:false, alerts:[], unread:0, lastChecked:0, polling:false };

async function loadAlertsList() {
  try {
    const r = await fetch('/api/alerts/list?limit=30');
    const j = await r.json();
    if (!j.ok) return;
    window._alertsState.alerts = j.alerts || [];
    window._alertsState.unread = j.unread || 0;
    updateAlertsBellBadge();
    if (window._alertsState.open) renderAlertsPanel();
  } catch (e) { console.warn('alerts list failed:', e.message); }
}

function updateAlertsBellBadge() {
  const badge = document.getElementById('alertsBellBadge');
  if (!badge) return;
  const n = window._alertsState.unread;
  if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = ''; }
  else { badge.style.display = 'none'; }
}

function toggleAlertsPanel() {
  const panel = document.getElementById('alertsPanel');
  if (!panel) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  window._alertsState.open = opening;
  if (opening) {
    renderAlertsPanel();
    loadAlertsList();
  }
}

function renderAlertsPanel() {
  const body = document.getElementById('alertsPanelBody');
  const last = document.getElementById('alertsLastChecked');
  if (!body) return;
  if (last) {
    last.textContent = window._alertsState.lastChecked
      ? `Last checked ${_relativeTimeShort(window._alertsState.lastChecked)}`
      : 'Never checked — click Check now';
  }
  const arr = window._alertsState.alerts || [];
  if (!arr.length) {
    body.innerHTML = `<div style="padding:32px;text-align:center;color:#64748b;font-size:.85rem">No alerts yet. Click <strong>Check now</strong> to scan for mention surges and rank drops.</div>`;
    return;
  }
  body.innerHTML = arr.map(a => {
    const sevColor = a.severity === 'high' ? '#EF4444' : a.severity === 'medium' ? '#F59E0B' : '#3B82F6';
    return `<div class="alert-item ${a.read ? 'alert-read' : 'alert-unread'}">
      <div class="alert-bar" style="background:${sevColor}"></div>
      <div class="alert-content">
        <div class="alert-title">${_esc(a.title)}</div>
        <div class="alert-body">${_esc(a.body)}</div>
        <div class="alert-meta">${_relativeTimeShort(a.timestamp)} · ${_esc(a.type.replace(/_/g,' '))}</div>
      </div>
    </div>`;
  }).join('');
}

function _relativeTimeShort(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

async function checkAlertsNow() {
  const camp = window.currentCampaign || {};
  const brand  = camp.brand || camp.businessName || '';
  const domain = (camp.domain || camp.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
  const country = camp.country || 'US';
  if (!brand && !domain) {
    showToast('⚠️ Run an analysis first so alerts know what to monitor');
    return;
  }
  const body = document.getElementById('alertsPanelBody');
  if (body) body.innerHTML = `<div style="padding:32px;text-align:center;color:#64748b;font-size:.85rem">⏳ Checking…</div>`;
  try {
    const r = await fetch('/api/alerts/check', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ brand, domain, country })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Check failed');
    window._alertsState.lastChecked = j.lastChecked || Date.now();
    if (j.newCount > 0) showToast(`🔔 ${j.newCount} new alert${j.newCount>1?'s':''}`);
    await loadAlertsList();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:32px;text-align:center;color:#EF4444;font-size:.85rem">⚠️ ${_esc(e.message)}</div>`;
  }
}

async function markAllAlertsRead() {
  try {
    await fetch('/api/alerts/ack', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id:'all' }) });
    await loadAlertsList();
  } catch (e) { console.warn('mark read failed:', e.message); }
}

async function checkCreditsNow() {
  const body = document.getElementById('alertsPanelBody');
  if (body) body.innerHTML = `<div style="padding:32px;text-align:center;color:#64748b;font-size:.85rem">⏳ Checking API credits &amp; subscriptions…</div>`;
  try {
    const r = await fetch('/api/alerts/check-credits').then(x => x.json());
    if (!r.ok) throw new Error(r.error || 'check failed');
    if ((r.emitted || []).length) showToast(`🔔 ${r.emitted.length} new credit alert${r.emitted.length>1?'s':''}`);
    else showToast('✓ All credits & subscriptions healthy');
    await loadAlertsList();
  } catch (e) {
    if (body) body.innerHTML = `<div style="padding:32px;text-align:center;color:#EF4444;font-size:.85rem">⚠️ ${_esc(e.message)}</div>`;
  }
}
window.checkCreditsNow = checkCreditsNow;

// Auto-load alert count on app boot
setTimeout(loadAlertsList, 1500);
// Run a credit-check sweep on boot (server also runs it, but this ensures the
// badge reflects current balance state without waiting for the next 5-min poll).
setTimeout(() => { fetch('/api/alerts/check-credits').then(() => loadAlertsList()).catch(()=>{}); }, 3000);
// Refresh every 5 minutes when tab is visible
setInterval(() => { if (document.visibilityState === 'visible') loadAlertsList(); }, 5 * 60 * 1000);
// Re-check credits every 30 minutes (server caps to 6h itself; this just
// surfaces server-side cron emissions faster)
setInterval(() => { if (document.visibilityState === 'visible') fetch('/api/alerts/check-credits').then(() => loadAlertsList()).catch(()=>{}); }, 30 * 60 * 1000);

/* =============================================================================
   FEATURE 3: AI CONTENT-GAP IDEATION
   ============================================================================= */
window._gapsState = { domain:'', competitors:[], data:null };
window._cgSelectedComps = window._cgSelectedComps || [];

function buildContentGaps() {
  const wrap = document.getElementById('contentGapsWrap');
  if (!wrap) return;
  // ── Auto-derive from analysisData (set on the home page) so "Your domain"
  // and the competitor dropdown show real values immediately.
  const analysisDomain = _getDomainFromAnalysis();
  const camp = window.currentCampaign || {};
  const domain = window._gapsState.domain
    || analysisDomain
    || (camp.domain || camp.url || '').replace(/^https?:\/\//,'').replace(/\/$/,'').split('/')[0]
    || '';

  const detectedCompetitors = _getCompetitorsFromAnalysis().filter(c => c.domain);
  const competitorOptions = detectedCompetitors.map(c => ({ value: c.domain, label: c.domain }));
  if (window._cgSelectedComps.length === 0 && competitorOptions.length > 0 && !window._cgSelectedCompsTouched) {
    window._cgSelectedComps = competitorOptions.map(o => o.value).slice(0, 4);
  }
  _igMultiselectInit({
    id: 'cgComps', options: competitorOptions, stateKey: '_cgSelectedComps',
    emptyLabel: detectedCompetitors.length ? 'Select competitor domains' : 'No competitors detected yet',
    onChange: () => { window._cgSelectedCompsTouched = true; },
  });

  window._gapsState.domain = domain;

  wrap.innerHTML = `
    <div class="cg-controls">
      <div class="cg-control">
        <label class="cg-lbl">Your domain</label>
        <input id="cgDomain" type="text" class="cg-input" placeholder="example.com" value="${_esc(domain)}" maxlength="120" title="${analysisDomain ? `Auto-filled from your home-page analysis (${_esc(analysisDomain)})` : 'Type a domain'}" />
      </div>
      <div class="cg-control" style="flex:2">
        <label class="cg-lbl">Competitor domains ${detectedCompetitors.length ? `· <span style="font-weight:400;color:#64748B">${detectedCompetitors.length} detected from your analysis</span>` : ''}</label>
        ${_igMultiselect({ id:'cgComps', options:competitorOptions, stateKey:'_cgSelectedComps', emptyLabel: detectedCompetitors.length ? 'Select competitor domains' : 'No competitors detected yet' })}
      </div>
      <div class="cg-control" style="flex:0 0 auto;display:flex;align-items:flex-end">
        <button class="cg-btn-run" id="cgRun" onclick="runContentGaps()">🧩 Find gaps</button>
      </div>
    </div>
    <div id="cgResults" style="margin-top:24px"></div>
  `;
  if (domain && (window._cgSelectedComps.length || competitorOptions.length)) {
    const n = window._cgSelectedComps.length;
    document.getElementById('cgResults').innerHTML = `<div class="cg-empty">Click <strong>Find gaps</strong> to compare <strong>${_esc(domain)}</strong>${n ? ` vs ${n} competitor${n>1?'s':''}` : ''}.</div>`;
  } else {
    document.getElementById('cgResults').innerHTML = `<div class="cg-empty">Run an analysis on the home page first, or enter your domain and pick at least one competitor, then click <strong>Find gaps</strong>.</div>`;
  }
}

async function runContentGaps() {
  const domain = (document.getElementById('cgDomain')?.value || '').trim();
  const competitors = (window._cgSelectedComps || []).slice(0, 8);
  if (!domain) { showToast('⚠️ Enter your domain'); return; }
  if (!competitors.length) { showToast('⚠️ Pick at least one competitor from the dropdown'); return; }
  window._gapsState = { domain, competitors, data:null };

  const btn = document.getElementById('cgRun');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }
  const results = document.getElementById('cgResults');
  const startedAt = Date.now();
  const renderProgress = (stage) => {
    if (!results) return;
    const elapsed = Math.floor((Date.now() - startedAt)/1000);
    const mm = String(Math.floor(elapsed/60)).padStart(2,'0');
    const ss = String(elapsed%60).padStart(2,'0');
    results.innerHTML = `<div class="cg-loading" style="text-align:center;padding:24px">
      <div style="font-size:0.95rem;font-weight:700;color:#0F172A;margin-bottom:6px">⏳ ${stage}</div>
      <div style="font-size:0.82rem;color:#475569;margin-bottom:10px">${competitors.length+1} domains · sitemap fetch + AI gap analysis (typical: 10-25s)</div>
      <div style="font-size:1.5rem;font-family:'Sora',sans-serif;font-weight:800;color:#0066FF">⏱ ${mm}:${ss}</div>
    </div>`;
  };
  renderProgress('Reading sitemaps and asking AI to spot the topic gaps…');
  const tickHandle = setInterval(() => renderProgress('Reading sitemaps and asking AI to spot the topic gaps…'), 1000);

  try {
    const r = await fetch('/api/content-gaps', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ domain, competitors })
    });
    clearInterval(tickHandle);
    // Robust parse: read the body as text first so a non-JSON / empty
    // response (proxy timeout, 502, HTML error page) gives a clear error
    // instead of "Unexpected end of JSON input".
    const raw = await r.text();
    let j;
    try { j = raw ? JSON.parse(raw) : {}; }
    catch (parseErr) {
      results.innerHTML = `<div class="cg-error">⚠️ Server returned a non-JSON response (HTTP ${r.status}). The request may have timed out at the proxy. Please try again with fewer competitors, or one at a time.</div>`;
      return;
    }
    if (!j.ok) {
      if (j.error === 'sitemap-unavailable') {
        const found = (j.competitorsWithSitemap || []).join(', ') || 'none';
        const blocked = (j.blockedDomains || []).join(', ') || '—';
        results.innerHTML = `<div class="cg-error" style="text-align:left;line-height:1.55">
          <div style="font-weight:800;margin-bottom:8px">⚠️ Sitemap unavailable for one or more domains</div>
          <div style="font-size:0.85rem;margin-bottom:6px">${_esc(j.detail || '')}</div>
          <div style="font-size:0.8rem;color:#475569;margin-top:10px">
            <div>• Blocked / no sitemap: <strong>${_esc(blocked)}</strong></div>
            <div>• Sitemaps successfully read: <strong>${_esc(found)}</strong></div>
            <div style="margin-top:8px;color:#0066FF">💡 Fix: remove the blocked domains from the picker above and run again. Many big sites (Cloudflare-protected) block automated sitemap fetches.</div>
          </div>
        </div>`;
      } else {
        const errMsg = j.error || j.detail || j.message || `HTTP ${r.status} — server returned no error message`;
        results.innerHTML = `<div class="cg-error" style="text-align:left;line-height:1.55">
          <div style="font-weight:800;margin-bottom:6px">⚠️ Content-gap analysis failed</div>
          <div style="font-size:0.85rem;color:#475569">${_esc(errMsg)}</div>
          <div style="font-size:0.78rem;color:#64748B;margin-top:8px">HTTP status: ${r.status}. Try with fewer competitors or one at a time.</div>
        </div>`;
      }
      return;
    }
    window._gapsState.data = j;
    renderContentGaps(j);
  } catch (e) {
    clearInterval(tickHandle);
    if (results) results.innerHTML = `<div class="cg-error">⚠️ ${_esc(e.message)}</div>`;
  } finally {
    clearInterval(tickHandle);
    if (btn) { btn.disabled = false; btn.textContent = '🧩 Find gaps'; }
  }
}

function renderContentGaps(d) {
  const wrap = document.getElementById('cgResults');
  if (!wrap) return;
  if (!d.gaps || !d.gaps.length) {
    wrap.innerHTML = `<div class="cg-empty">No clear gaps found — your content coverage matches or exceeds the competitors analysed.</div>`;
    return;
  }
  const ribbon = `<div class="mt-ribbon"><span class="mt-ribbon-dot" style="background:#9333EA"></span><span>📊 ${_esc(d.dataSource || 'AI-verified')}</span><span style="opacity:.5">·</span><span style="text-transform:uppercase;letter-spacing:.04em;font-size:.65rem">${_esc(d.confidence || 'medium')} confidence</span><span style="opacity:.5">·</span><span style="font-weight:500;opacity:.85">${_esc(d.dataOrigin || '')} · ${d.yourPagesAnalyzed} of your pages vs ${d.competitorPagesAnalyzed} competitor pages</span></div>`;
  const cards = d.gaps.map(g => {
    const pri = g.priority || 5;
    const priColor = pri >= 8 ? '#EF4444' : pri >= 6 ? '#F59E0B' : '#10B981';
    const compTags = (g.competitors_covering || []).map(c => `<span class="cg-comp-tag">${_esc(c)}</span>`).join('');
    return `<div class="cg-card">
      <div class="cg-card-head">
        <div class="cg-priority" style="background:${priColor}">P${pri}</div>
        <div class="cg-card-topic">${_esc(g.topic)}</div>
      </div>
      <div class="cg-card-rationale">${_esc(g.rationale)}</div>
      ${g.suggested_angle ? `<div class="cg-card-angle"><strong>Suggested angle:</strong> ${_esc(g.suggested_angle)}</div>` : ''}
      ${compTags ? `<div class="cg-card-comps">Covered by: ${compTags}</div>` : ''}
    </div>`;
  }).join('');
  wrap.innerHTML = `${ribbon}<div class="cg-grid">${cards}</div>`;
}

/* =============================================================================
   FEATURE 4: CROSS-CHANNEL REPORTING
   ============================================================================= */
window._ccrState = { days:30, data:null };

function buildCrossChannel() {
  const wrap = document.getElementById('crossChannelWrap');
  if (!wrap) return;
  const days = window._ccrState.days || 30;
  wrap.innerHTML = `
    <div id="ccrConnections" style="margin-bottom:18px"></div>
    <div class="ccr-controls">
      <div class="ccr-control" style="flex:0 0 130px">
        <label class="cg-lbl">Time window</label>
        <select id="ccrDays" class="cg-input" onchange="runCrossChannel()">
          <option value="7"  ${days===7?'selected':''}>Last 7 days</option>
          <option value="14" ${days===14?'selected':''}>Last 14 days</option>
          <option value="30" ${days===30?'selected':''}>Last 30 days</option>
          <option value="60" ${days===60?'selected':''}>Last 60 days</option>
          <option value="90" ${days===90?'selected':''}>Last 90 days</option>
        </select>
      </div>
      <div class="ccr-control" style="flex:0 0 auto;display:flex;align-items:flex-end">
        <button class="cg-btn-run" id="ccrRun" onclick="runCrossChannel()">🌐 Generate report</button>
      </div>
    </div>
    <div id="ccrResults" style="margin-top:24px"><div class="cg-empty">Click <strong>Generate report</strong> to pull live data from all connected channels.</div></div>
  `;
  renderAdPlatformConnections();
}

async function runCrossChannel() {
  const days = parseInt(document.getElementById('ccrDays')?.value || '30', 10) || 30;
  window._ccrState.days = days;
  const camp = window.currentCampaign || {};
  const domain = (camp.domain || camp.url || '').replace(/^https?:\/\//,'').replace(/\/$/,'').split('/')[0] || '';
  const brand  = camp.brand || camp.businessName || '';

  const btn = document.getElementById('ccrRun');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Pulling…'; }
  const results = document.getElementById('ccrResults');
  if (results) results.innerHTML = `<div class="cg-loading">⏳ Pulling live data from Meta, Google Ads, TikTok${domain?', organic SERP':''}${brand?', earned media':''}…</div>`;

  try {
    const params = new URLSearchParams({ days:String(days) });
    if (domain) params.set('domain', domain);
    if (brand)  params.set('brand', brand);
    const r = await fetch('/api/cross-channel-report?' + params.toString());
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Report failed');
    window._ccrState.data = j;
    renderCrossChannel(j);
  } catch (e) {
    if (results) results.innerHTML = `<div class="cg-error">⚠️ ${_esc(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🌐 Generate report'; }
  }
}

function renderCrossChannel(d) {
  const wrap = document.getElementById('ccrResults');
  if (!wrap) return;
  const t = d.paid?.totals || {};
  const fmtMoney = (n) => '$' + (n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtNum = (n) => (n || 0).toLocaleString('en-US');

  const channelCards = (d.paid?.channels || []).map(c => {
    if (!c.ok) {
      const platformKey = /meta|facebook/i.test(c.name) ? 'meta'
                        : /google/i.test(c.name) ? 'google'
                        : /tiktok/i.test(c.name) ? 'tiktok' : '';
      const connectBtn = platformKey
        ? `<button onclick="showAdPlatformSetup('${platformKey}')" style="margin-top:8px;padding:7px 14px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:8px;font-size:0.72rem;font-weight:700;color:white;cursor:pointer;width:100%">🔌 Connect now</button>`
        : '';
      return `<div class="ccr-channel ccr-channel-off">
        <div class="ccr-ch-head"><span class="ccr-ch-icon">${_esc(c.icon || '')}</span><span>${_esc(c.name)}</span></div>
        <div class="ccr-ch-status">Not connected</div>
        ${connectBtn}
      </div>`;
    }
    const cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
    const cpa = c.conversions > 0 ? c.spend / c.conversions : 0;
    return `<div class="ccr-channel">
      <div class="ccr-ch-head"><span class="ccr-ch-icon">${_esc(c.icon || '')}</span><span>${_esc(c.name)}</span><span class="ccr-ch-live">LIVE</span></div>
      <div class="ccr-ch-stats">
        <div><div class="ccr-stat-l">Spend</div><div class="ccr-stat-v">${fmtMoney(c.spend)}</div></div>
        <div><div class="ccr-stat-l">Clicks</div><div class="ccr-stat-v">${fmtNum(c.clicks)}</div></div>
        <div><div class="ccr-stat-l">Conv.</div><div class="ccr-stat-v">${fmtNum(c.conversions)}</div></div>
        <div><div class="ccr-stat-l">CPC</div><div class="ccr-stat-v">$${cpc.toFixed(2)}</div></div>
        <div><div class="ccr-stat-l">CPA</div><div class="ccr-stat-v">${cpa>0?'$'+cpa.toFixed(2):'—'}</div></div>
      </div>
    </div>`;
  }).join('');

  const organicHtml = d.organic?.ok ? `
    <div class="ccr-card">
      <h4 class="mt-h">🔎 Organic visibility</h4>
      <div class="ccr-org-stats">
        <div><div class="ccr-stat-l">Organic traffic (est.)</div><div class="ccr-stat-v">${fmtNum(d.organic.organicTraffic)}/mo</div></div>
        <div><div class="ccr-stat-l">Ranking keywords</div><div class="ccr-stat-v">${fmtNum(d.organic.organicKeywords)}</div></div>
        <div><div class="ccr-stat-l">Paid traffic (est.)</div><div class="ccr-stat-v">${fmtNum(d.organic.paidTraffic)}/mo</div></div>
        <div><div class="ccr-stat-l">Paid keywords</div><div class="ccr-stat-v">${fmtNum(d.organic.paidKeywords)}</div></div>
      </div>
    </div>` : '';

  const earnedHtml = d.earned?.ok ? `
    <div class="ccr-card">
      <h4 class="mt-h">📰 Earned media (last ${d.days} days)</h4>
      <div class="ccr-org-stats">
        <div><div class="ccr-stat-l">Mentions in window</div><div class="ccr-stat-v">${fmtNum(d.earned.mentions)}</div></div>
        <div><div class="ccr-stat-l">Mentions all-time (in SERP)</div><div class="ccr-stat-v">${fmtNum(d.earned.total)}</div></div>
      </div>
    </div>` : '';

  const ribbon = `<div class="mt-ribbon"><span class="mt-ribbon-dot" style="background:#0891B2"></span><span>📊 ${_esc(d.dataSource || '')}</span><span style="opacity:.5">·</span><span style="text-transform:uppercase;letter-spacing:.04em;font-size:.65rem">${_esc(d.confidence || 'medium')} confidence</span><span style="opacity:.5">·</span><span style="font-weight:500;opacity:.85">${_esc(d.dataOrigin || '')}</span></div>`;

  wrap.innerHTML = `
    ${ribbon}
    <div class="ccr-summary-card">
      <div class="ccr-summary-h">📋 Executive summary</div>
      <div class="ccr-summary-body">${_esc(d.summary || '')}</div>
    </div>
    <div class="ccr-totals">
      <div class="ccr-total"><div class="ccr-total-l">Total paid spend</div><div class="ccr-total-v">${fmtMoney(t.spend)}</div></div>
      <div class="ccr-total"><div class="ccr-total-l">Total clicks</div><div class="ccr-total-v">${fmtNum(t.clicks)}</div></div>
      <div class="ccr-total"><div class="ccr-total-l">Total conversions</div><div class="ccr-total-v">${fmtNum(t.conversions)}</div></div>
      <div class="ccr-total"><div class="ccr-total-l">Blended CPC</div><div class="ccr-total-v">$${(t.cpc||0).toFixed(2)}</div></div>
      <div class="ccr-total"><div class="ccr-total-l">Blended CPA</div><div class="ccr-total-v">${t.cpa>0?'$'+t.cpa.toFixed(2):'—'}</div></div>
    </div>
    <div class="ccr-channels">${channelCards}</div>
    ${organicHtml}
    ${earnedHtml}
  `;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAKEHOLDERS (per-account email digest list)
// ═══════════════════════════════════════════════════════════════════════════
window._stakeholdersData = null;

async function buildStakeholders() {
  const wrap = document.getElementById('stakeholdersWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:32px;text-align:center;color:#64748B">Loading stakeholders…</div>`;
  try {
    const r = await fetch('/api/stakeholders/list');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'load failed');
    window._stakeholdersData = j;
    _renderStakeholders();
  } catch (e) {
    wrap.innerHTML = `<div style="background:white;border:1px solid #FECACA;border-radius:10px;padding:18px;color:#B91C1C">Failed to load: ${_esc(e.message)}</div>`;
  }
}

function _renderStakeholders() {
  const wrap = document.getElementById('stakeholdersWrap');
  const d = window._stakeholdersData;
  if (!wrap || !d) return;
  const last = d.lastEmailSentAt ? new Date(d.lastEmailSentAt).toLocaleString() : '—';
  const cfg = d.emailConfigured;
  const rows = (d.stakeholders || []).map(s => `
    <tr style="border-bottom:1px solid #F1F5F9">
      <td style="padding:10px 12px;color:#1E293B;font-weight:600">${_esc(s.name)}</td>
      <td style="padding:10px 12px;color:#475569"><a href="mailto:${_esc(s.email)}" style="color:#0D9488;text-decoration:none">${_esc(s.email)}</a></td>
      <td style="padding:10px 12px;color:#94A3B8;font-size:11px">${new Date(s.addedAt).toLocaleDateString()}</td>
      <td style="padding:10px 12px;text-align:right">
        <button onclick="removeStakeholder('${_esc(s.id)}')" style="background:#FEF2F2;color:#B91C1C;border:1px solid #FECACA;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">Remove</button>
      </td>
    </tr>`).join('');
  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:18px">
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:10px">Add stakeholder</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <input id="stkName" type="text" placeholder="Full name" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px" />
          <input id="stkEmail" type="email" placeholder="email@company.com" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px" />
          <button onclick="addStakeholder()" style="background:#0D9488;color:white;border:none;border-radius:6px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer">+ Add to alert list</button>
          <div id="stkMsg" style="font-size:11px;min-height:14px"></div>
        </div>
      </div>
      <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:18px">
        <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:10px">When emails fire</div>
        <ul style="margin:0 0 12px 18px;padding:0;color:#475569;font-size:12px;line-height:1.6">
          <li>Any new alert with <strong>severity ≥ high</strong> from <code>/api/alerts/check</code></li>
          <li>Launch reminders fired by the calendar (24h, 1h, live)</li>
          <li>Throttled to <strong>one digest every 30 minutes</strong> to avoid noise</li>
        </ul>
        <div style="font-size:11px;color:#64748B;margin-bottom:8px">Last digest sent: <strong>${_esc(last)}</strong></div>
        <div style="font-size:11px;color:${cfg?'#059669':'#B91C1C'};margin-bottom:10px">Resend ${cfg?'configured ✓':'NOT configured — set RESEND_API_KEY to enable'}</div>
        <button onclick="testStakeholderEmail()" ${cfg?'':'disabled'} style="background:${cfg?'#1E293B':'#94A3B8'};color:white;border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:700;cursor:${cfg?'pointer':'not-allowed'}">Send test email now</button>
        <button onclick="testSlackWebhook()" style="background:#4A154B;color:white;border:none;border-radius:6px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;margin-left:6px">💬 Test Slack/Discord</button>
        <div id="stkTestMsg" style="font-size:11px;margin-top:8px;min-height:14px"></div>
        <div id="slackTestMsg" style="font-size:11px;margin-top:4px;min-height:14px"></div>
      </div>
    </div>
    <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden">
      <div style="padding:12px 16px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:700;color:#475569;display:flex;justify-content:space-between;align-items:center">
        <span>${(d.stakeholders||[]).length} stakeholder${(d.stakeholders||[]).length===1?'':'s'} on the list</span>
        <span style="font-size:10px;color:#94A3B8">Source: ${_esc(d.dataSource)} · ${_esc(d.confidence)} confidence</span>
      </div>
      ${(d.stakeholders||[]).length ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#F8FAFC;color:#64748B;font-size:11px;text-transform:uppercase;letter-spacing:.05em"><th style="text-align:left;padding:9px 12px">Name</th><th style="text-align:left;padding:9px 12px">Email</th><th style="text-align:left;padding:9px 12px">Added</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : `<div style="padding:32px;text-align:center;color:#94A3B8">No stakeholders yet — add one above to start receiving digests.</div>`}
    </div>
    <div id="webhooksWrap"></div>`;
  // Load + render webhooks panel below the stakeholders table
  _loadWebhooks().then(_renderWebhooks);
}

async function addStakeholder() {
  const msg  = document.getElementById('stkMsg');
  const name = (document.getElementById('stkName').value || '').trim();
  const email= (document.getElementById('stkEmail').value || '').trim();
  if (!name || !email) { msg.style.color='#B91C1C'; msg.textContent='Name and email are required.'; return; }
  msg.style.color='#64748B'; msg.textContent='Adding…';
  try {
    const r = await fetch('/api/stakeholders/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name,email}) });
    const j = await r.json();
    if (!j.ok) { msg.style.color='#B91C1C'; msg.textContent = j.error || 'Failed to add'; return; }
    document.getElementById('stkName').value = '';
    document.getElementById('stkEmail').value = '';
    msg.style.color='#059669'; msg.textContent = `Added ${j.stakeholder.email}`;
    buildStakeholders();
  } catch (e) { msg.style.color='#B91C1C'; msg.textContent = e.message; }
}

async function removeStakeholder(id) {
  if (!confirm('Remove this stakeholder from the alert list?')) return;
  try {
    const r = await fetch('/api/stakeholders/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    const j = await r.json();
    if (j.ok) buildStakeholders();
  } catch (e) { alert('Failed to remove: ' + e.message); }
}

async function testStakeholderEmail() {
  const msg = document.getElementById('stkTestMsg');
  msg.style.color='#64748B'; msg.textContent='Sending…';
  try {
    const r = await fetch('/api/stakeholders/test-email', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const j = await r.json();
    if (j.ok) { msg.style.color='#059669'; msg.textContent = `Sent to ${j.sentCount} of ${j.totalStakeholders}.`; }
    else { msg.style.color='#B91C1C'; msg.textContent = j.error || `Failed (${j.failures && j.failures.length} errors)`; }
  } catch (e) { msg.style.color='#B91C1C'; msg.textContent = e.message; }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK CHANNELS (Slack / Teams / Telegram / generic — real-time alert delivery)
// ═══════════════════════════════════════════════════════════════════════════
window._webhooksData = null;

async function _loadWebhooks() {
  try {
    const r = await fetch('/api/webhooks/list');
    const j = await r.json();
    window._webhooksData = j.ok ? j : { ok:false, error: j.error || 'load failed', webhooks:[], types:['slack','teams','telegram','generic'] };
  } catch (e) {
    window._webhooksData = { ok:false, error:e.message, webhooks:[], types:['slack','teams','telegram','generic'] };
  }
}

function _webhookTypeMeta(type) {
  const m = {
    slack:    { label:'Slack',    emoji:'💬', placeholder:'https://hooks.slack.com/services/T0/B0/xxxxxxxx', help:'In Slack: Apps → Incoming Webhooks → Add to channel → copy the webhook URL.' },
    teams:    { label:'Teams',    emoji:'👥', placeholder:'https://outlook.office.com/webhook/...',          help:'In Teams: channel ⋯ → Connectors → Incoming Webhook → create → copy URL.' },
    telegram: { label:'Telegram', emoji:'✈️', placeholder:'https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>', help:'Create a bot via @BotFather (get TOKEN). Get your chat_id from @userinfobot. Paste the full URL.' },
    generic:  { label:'Generic',  emoji:'🔗', placeholder:'https://hook.example.com/...',                    help:'Any HTTPS endpoint — for n8n, Zapier, Make, Pipedream, IFTTT, or your own backend. Receives JSON: { source, alerts:[...] }.' },
  };
  return m[type] || m.generic;
}

function _renderWebhooks() {
  const wrap = document.getElementById('webhooksWrap');
  const data = window._webhooksData;
  if (!wrap) return;
  if (!data) { wrap.innerHTML = ''; return; }
  if (data.ok === false && (!data.webhooks || !data.webhooks.length)) {
    wrap.innerHTML = `<div style="background:white;border:1px solid #FECACA;border-radius:10px;padding:14px;color:#B91C1C;margin-top:16px;font-size:12px">Failed to load webhooks${data.error ? ': ' + _esc(data.error) : ''}</div>`;
    return;
  }
  const types = data.types || ['slack','teams','telegram','generic'];
  const typeOpts = types.map(t => {
    const m = _webhookTypeMeta(t);
    return `<option value="${_esc(t)}">${_esc(m.emoji + ' ' + m.label)}</option>`;
  }).join('');
  const helpByType = types.map(t => {
    const m = _webhookTypeMeta(t);
    return `<div data-type="${_esc(t)}" class="whk-help" style="display:none;font-size:11px;color:#64748B;margin-top:8px;background:#F8FAFC;border:1px solid #E2E8F0;padding:8px 10px;border-radius:6px">${_esc(m.help)}</div>`;
  }).join('');
  const rows = (data.webhooks || []).map(w => {
    const m = _webhookTypeMeta(w.type);
    const lastErr = w.lastError ? `<div style="font-size:10px;color:#B91C1C;margin-top:3px">⚠ Last error: ${_esc(w.lastError)} (${new Date(w.lastErrorAt).toLocaleString()})</div>` : '';
    const lastOk  = w.lastOkAt ? `<div style="font-size:10px;color:#059669;margin-top:3px">✓ Last sent OK: ${new Date(w.lastOkAt).toLocaleString()}</div>` : '';
    return `<tr style="border-bottom:1px solid #F1F5F9">
      <td style="padding:10px 12px;color:#1E293B">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="background:#F1F5F9;padding:3px 8px;border-radius:99px;font-size:11px;font-weight:700;color:#475569">${_esc(m.emoji + ' ' + m.label)}</span>
          <strong style="font-size:13px">${_esc(w.label)}</strong>
          ${w.active ? '' : '<span style="background:#F1F5F9;color:#94A3B8;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">paused</span>'}
        </div>
        <div style="font-family:monospace;font-size:10px;color:#94A3B8;margin-top:4px">${_esc(w.urlMasked || '')}</div>
        ${lastOk}${lastErr}
      </td>
      <td style="padding:10px 12px;text-align:right;white-space:nowrap;vertical-align:middle">
        <label style="font-size:11px;color:#475569;margin-right:8px;cursor:pointer;user-select:none">
          <input type="checkbox" ${w.active ? 'checked' : ''} onchange="toggleWebhook('${_esc(w.id)}')" style="vertical-align:middle" /> Active
        </label>
        <button onclick="testWebhook('${_esc(w.id)}')" style="background:#EEF2FF;color:#4338CA;border:1px solid #C7D2FE;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-right:6px">Test</button>
        <button onclick="removeWebhook('${_esc(w.id)}')" style="background:#FEF2F2;color:#B91C1C;border:1px solid #FECACA;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer">Remove</button>
      </td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:18px;margin-top:16px">
      <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:4px">📡 Webhook channels — real-time alerts to chat</div>
      <div style="font-size:11px;color:#64748B;margin-bottom:12px">Same alerts as the email digest, delivered instantly to Slack, Teams, Telegram, or any generic HTTPS endpoint. No API keys from us — paste your own webhook URL.</div>
      <div style="display:grid;grid-template-columns:150px 1.4fr 2.6fr auto;gap:8px;align-items:start">
        <select id="whkType" onchange="_whkTypeChanged()" style="padding:9px 10px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;background:white">${typeOpts}</select>
        <input id="whkLabel" type="text" placeholder="Label (e.g. #marketing)" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px" />
        <input id="whkUrl" type="text" placeholder="${_esc(_webhookTypeMeta(types[0]).placeholder)}" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:12px;font-family:monospace" />
        <button onclick="addWebhook()" style="background:#0D9488;color:white;border:none;border-radius:6px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">+ Add</button>
      </div>
      <div id="whkHelpBox">${helpByType}</div>
      <div id="whkMsg" style="font-size:11px;margin-top:8px;min-height:14px"></div>
    </div>
    <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;margin-top:12px">
      <div style="padding:12px 16px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;font-size:12px;font-weight:700;color:#475569;display:flex;justify-content:space-between;align-items:center">
        <span>${(data.webhooks||[]).length} webhook${(data.webhooks||[]).length===1?'':'s'} configured</span>
        <span style="font-size:10px;color:#94A3B8">Last dispatch: ${data.lastDispatchAt ? new Date(data.lastDispatchAt).toLocaleString() : '—'}</span>
      </div>
      ${(data.webhooks||[]).length ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><tbody>${rows}</tbody></table>` : `<div style="padding:24px;text-align:center;color:#94A3B8;font-size:12px">No webhooks yet — add one above to start streaming alerts to chat.</div>`}
    </div>`;
  _whkTypeChanged();
}

function _whkTypeChanged() {
  const sel = document.getElementById('whkType');
  const inp = document.getElementById('whkUrl');
  if (!sel || !inp) return;
  const m = _webhookTypeMeta(sel.value);
  inp.placeholder = m.placeholder;
  document.querySelectorAll('.whk-help').forEach(el => { el.style.display = (el.dataset.type === sel.value ? 'block' : 'none'); });
}

async function addWebhook() {
  const msg = document.getElementById('whkMsg');
  const type = document.getElementById('whkType').value;
  const label = (document.getElementById('whkLabel').value || '').trim();
  const url = (document.getElementById('whkUrl').value || '').trim();
  if (!label || !url) { msg.style.color='#B91C1C'; msg.textContent='Label and URL are required.'; return; }
  msg.style.color='#64748B'; msg.textContent='Adding…';
  try {
    const r = await fetch('/api/webhooks/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({type,label,url}) });
    const j = await r.json();
    if (!j.ok) { msg.style.color='#B91C1C'; msg.textContent = j.error || 'Failed to add'; return; }
    document.getElementById('whkLabel').value = '';
    document.getElementById('whkUrl').value = '';
    msg.style.color='#059669'; msg.textContent = '✅ Added — click Test to verify it works.';
    await _loadWebhooks(); _renderWebhooks();
  } catch (e) { msg.style.color='#B91C1C'; msg.textContent = e.message; }
}

async function removeWebhook(id) {
  if (!confirm('Remove this webhook channel?')) return;
  try {
    await fetch('/api/webhooks/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    await _loadWebhooks(); _renderWebhooks();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function toggleWebhook(id) {
  try {
    await fetch('/api/webhooks/toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    await _loadWebhooks(); _renderWebhooks();
  } catch (e) { alert('Failed: ' + e.message); }
}

async function testWebhook(id) {
  const msg = document.getElementById('whkMsg');
  if (msg) { msg.style.color='#64748B'; msg.textContent='Sending test message…'; }
  try {
    const r = await fetch('/api/webhooks/test', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    const j = await r.json();
    if (j.ok) {
      if (msg) { msg.style.color='#059669'; msg.textContent = '✅ Test message delivered — check your channel.'; }
    } else {
      if (msg) { msg.style.color='#B91C1C'; msg.textContent = '❌ Test failed: ' + (j.error || 'unknown'); }
    }
    await _loadWebhooks(); _renderWebhooks();
  } catch (e) {
    if (msg) { msg.style.color='#B91C1C'; msg.textContent = e.message; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LAUNCH CALENDAR (campaign go-live tracker + 24h/1h reminders)
// ═══════════════════════════════════════════════════════════════════════════
window._launchesData = null;

async function buildLaunches() {
  const wrap = document.getElementById('launchesWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:32px;text-align:center;color:#64748B">Loading launches…</div>`;
  try {
    const r = await fetch('/api/launches/list');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'load failed');
    window._launchesData = j;
    _renderLaunches();
  } catch (e) {
    wrap.innerHTML = `<div style="background:white;border:1px solid #FECACA;border-radius:10px;padding:18px;color:#B91C1C">Failed to load: ${_esc(e.message)}</div>`;
  }
}

function _formatCountdown(ms) {
  if (ms <= 0) return 'live now';
  const m = Math.floor(ms/60000) % 60;
  const h = Math.floor(ms/3600000) % 24;
  const d = Math.floor(ms/86400000);
  if (d > 0) return `in ${d}d ${h}h ${m}m`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function _renderLaunches() {
  const wrap = document.getElementById('launchesWrap');
  const data = window._launchesData;
  if (!wrap || !data) return;
  const now = Date.now();
  const groups = { today: [], week: [], later: [], past: [] };
  data.launches.forEach(l => {
    const ts = Date.parse(l.datetimeISO);
    const ms = ts - now;
    if (ms < 0) groups.past.push({ l, ms, ts });
    else if (ms < 24*60*60*1000) groups.today.push({ l, ms, ts });
    else if (ms < 7*24*60*60*1000) groups.week.push({ l, ms, ts });
    else groups.later.push({ l, ms, ts });
  });
  const channels = data.channels || ['Email','Social','Paid Ad','PR','Mixed','Other'];
  const channelOpts = channels.map(c => `<option value="${_esc(c)}">${_esc(c)}</option>`).join('');
  const minDateAttr = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  const card = (entry, group) => {
    const { l, ms } = entry;
    const remPills = [
      l.reminders.h24 ? '<span style="background:#DCFCE7;color:#166534;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">24h ✓</span>' : '<span style="background:#F1F5F9;color:#94A3B8;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">24h pending</span>',
      l.reminders.h1  ? '<span style="background:#DCFCE7;color:#166534;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">1h ✓</span>'  : '<span style="background:#F1F5F9;color:#94A3B8;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">1h pending</span>',
      l.reminders.live ? '<span style="background:#FEE2E2;color:#991B1B;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px">LIVE 🚀</span>' : ''
    ].filter(Boolean).join(' ');
    const cdColor = group === 'past' ? '#94A3B8' : group === 'today' ? '#DC2626' : group === 'week' ? '#D97706' : '#0F766E';
    return `<div style="background:white;border:1px solid #E2E8F0;border-radius:10px;padding:14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:8px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap">
          <span style="background:#EEF2FF;color:#4338CA;font-size:10px;font-weight:800;padding:2px 8px;border-radius:99px;letter-spacing:.04em">${_esc(l.channel.toUpperCase())}</span>
          <span style="color:${cdColor};font-size:11px;font-weight:800">${_esc(_formatCountdown(ms))}</span>
        </div>
        <div style="font-weight:700;color:#0F172A;font-size:14px;margin-bottom:3px">${_esc(l.name)}</div>
        <div style="color:#64748B;font-size:11px;margin-bottom:6px">${new Date(l.datetimeISO).toLocaleString()} · status: <strong>${_esc(l.status)}</strong></div>
        ${l.notes ? `<div style="color:#475569;font-size:12px;margin-bottom:8px;line-height:1.4">${_esc(l.notes)}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap">${remPills}</div>
      </div>
      <button onclick="removeLaunch('${_esc(l.id)}')" style="background:#FEF2F2;color:#B91C1C;border:1px solid #FECACA;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0">Remove</button>
    </div>`;
  };
  const section = (title, arr, group, emoji) => arr.length ? `
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:800;color:#64748B;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">${emoji} ${title} (${arr.length})</div>
      ${arr.map(e => card(e, group)).join('')}
    </div>` : '';
  wrap.innerHTML = `
    <div style="background:white;border:1px solid #E2E8F0;border-radius:12px;padding:18px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:12px">📅 Schedule a launch</div>
      <div style="display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:8px;margin-bottom:8px">
        <input id="lnchName" type="text" placeholder="Launch name (e.g. Q2 product launch)" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px" />
        <input id="lnchDt" type="datetime-local" min="${_esc(minDateAttr)}" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px" />
        <select id="lnchChannel" style="padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;background:white">${channelOpts}</select>
      </div>
      <textarea id="lnchNotes" rows="2" placeholder="Optional notes — what's launching, owner, success metric…" style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:6px;font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:8px"></textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:11px;color:#64748B">Reminders fire automatically: 24h before, 1h before, and at go-live. Stakeholders get an email at every reminder.</div>
        <button onclick="addLaunch()" style="background:#7C3AED;color:white;border:none;border-radius:6px;padding:9px 18px;font-size:13px;font-weight:700;cursor:pointer">+ Schedule launch</button>
      </div>
      <div id="lnchMsg" style="font-size:11px;margin-top:8px;min-height:14px"></div>
    </div>
    ${section('Today &amp; next 24h', groups.today, 'today', '🔥')}
    ${section('This week', groups.week, 'week', '📅')}
    ${section('Later', groups.later, 'later', '🗓️')}
    ${section('Past launches', groups.past, 'past', '✅')}
    ${data.launches.length === 0 ? `<div style="background:white;border:1px dashed #CBD5E1;border-radius:10px;padding:32px;text-align:center;color:#94A3B8">No launches scheduled yet — schedule your first one above.</div>` : ''}
    <div style="margin-top:14px;padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;color:#64748B">Source: ${_esc(data.dataSource)} · ${_esc(data.confidence)} confidence · ${_esc(data.dataOrigin)}</div>`;
}

async function addLaunch() {
  const msg = document.getElementById('lnchMsg');
  const name = (document.getElementById('lnchName').value || '').trim();
  const dtLocal = (document.getElementById('lnchDt').value || '').trim();
  const channel = document.getElementById('lnchChannel').value;
  const notes = (document.getElementById('lnchNotes').value || '').trim();
  if (!name || !dtLocal) { msg.style.color='#B91C1C'; msg.textContent='Name and date/time are required.'; return; }
  // datetime-local is naive local — convert to ISO with offset
  const datetimeISO = new Date(dtLocal).toISOString();
  msg.style.color='#64748B'; msg.textContent='Scheduling…';
  try {
    const r = await fetch('/api/launches/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name,datetimeISO,channel,notes}) });
    const j = await r.json();
    if (!j.ok) { msg.style.color='#B91C1C'; msg.textContent = j.error || 'Failed'; return; }
    document.getElementById('lnchName').value = '';
    document.getElementById('lnchDt').value = '';
    document.getElementById('lnchNotes').value = '';
    msg.style.color='#059669'; msg.textContent = `Scheduled — ${new Date(j.launch.datetimeISO).toLocaleString()}`;
    buildLaunches();
  } catch (e) { msg.style.color='#B91C1C'; msg.textContent = e.message; }
}

async function removeLaunch(id) {
  if (!confirm('Remove this launch from the calendar?')) return;
  try {
    const r = await fetch('/api/launches/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) });
    const j = await r.json();
    if (j.ok) buildLaunches();
  } catch (e) { alert('Failed to remove: ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY INTEL MODAL — wraps /api/apollo/enrich + /api/builtwith/lookup.
// Used by competitor cards, lead rows, and ad-hoc lookups.
// ═══════════════════════════════════════════════════════════════════════════
function showCompanyIntel(prefill) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  // strip protocol/path/email; accept "Shopify Inc." too (best-effort guess)
  let seed = String(prefill || '').trim().toLowerCase();
  if (seed.includes('@')) seed = seed.split('@')[1];
  seed = seed.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'');
  if (seed && !seed.includes('.')) seed = seed.replace(/[^a-z0-9-]/g,'') + '.com';

  // build / reuse a single overlay
  let host = document.getElementById('intelModalHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'intelModalHost';
    document.body.appendChild(host);
  }
  host.innerHTML = `
    <div id="intelOverlay" style="position:fixed;inset:0;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:60px 20px;overflow-y:auto" onclick="if(event.target===this)document.getElementById('intelModalHost').innerHTML=''">
      <div style="background:white;border-radius:14px;width:100%;max-width:760px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden">
        <div style="padding:18px 22px;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#0369A1,#0EA5E9);color:white">
          <div>
            <div style="font-size:1.05rem;font-weight:800;font-family:Sora,sans-serif">🔍 Company Intel</div>
            <div style="font-size:0.78rem;opacity:.9;margin-top:2px">Apollo profile + BuiltWith tech footprint</div>
          </div>
          <button onclick="document.getElementById('intelModalHost').innerHTML=''" style="background:rgba(255,255,255,.2);color:white;border:none;border-radius:8px;width:32px;height:32px;font-size:1rem;cursor:pointer">✕</button>
        </div>
        <div style="padding:18px 22px">
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <input id="intelDomain" type="text" placeholder="example.com" value="${esc(seed)}" style="flex:1;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:0.9rem" onkeydown="if(event.key==='Enter')runCompanyIntel()" />
            <button onclick="runCompanyIntel()" id="intelGoBtn" style="padding:10px 18px;background:#0369A1;color:white;border:none;border-radius:8px;font-weight:700;font-size:0.86rem;cursor:pointer">Look up</button>
          </div>
          <div id="intelResult"></div>
        </div>
      </div>
    </div>`;
  if (seed) runCompanyIntel();
  setTimeout(() => { const i = document.getElementById('intelDomain'); if (i && !seed) i.focus(); }, 50);
}
async function runCompanyIntel() {
  const out = document.getElementById('intelResult');
  const btn = document.getElementById('intelGoBtn');
  const domain = (document.getElementById('intelDomain').value || '').trim();
  if (!domain) { out.innerHTML = '<div style="color:#B91C1C;font-size:0.85rem">⚠️ Enter a domain.</div>'; return; }
  btn.disabled = true; btn.textContent = '⏳…';
  out.innerHTML = '<div style="text-align:center;padding:32px;color:#64748B">⏳ Fetching Apollo + BuiltWith…</div>';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  try {
    const [aRes, bRes] = await Promise.all([
      fetch('/api/apollo/enrich',   { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({domain}) }).then(r=>r.json()).catch(e=>({ok:false,error:e.message})),
      fetch('/api/builtwith/lookup',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({domain}) }).then(r=>r.json()).catch(e=>({ok:false,error:e.message})),
    ]);
    // Apollo card
    const co = aRes.ok ? (aRes.company || {}) : null;
    const apolloHtml = aRes.ok && co && co.name
      ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            ${co.logo ? `<img src="${esc(co.logo)}" style="width:40px;height:40px;border-radius:8px;background:white;object-fit:contain" onerror="this.style.display='none'"/>` : ''}
            <div style="flex:1">
              <div style="font-weight:800;color:#0F172A;font-size:1rem">${esc(co.name)}</div>
              <div style="font-size:0.78rem;color:#64748B">${esc(co.industry||'')} ${co.size?'· '+co.size+' employees':''} ${co.founded?'· founded '+co.founded:''}</div>
            </div>
          </div>
          ${co.description ? `<div style="font-size:0.82rem;color:#475569;margin-bottom:10px;line-height:1.5">${esc(co.description)}</div>` : ''}
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;font-size:0.78rem;color:#475569">
            ${co.annualRevenue ? `<div><b>Revenue:</b> ${esc(co.annualRevenue)}</div>` : ''}
            ${co.address ? `<div><b>Location:</b> ${esc(co.address)}</div>` : ''}
            ${co.phone ? `<div><b>Phone:</b> ${esc(co.phone)}</div>` : ''}
            ${co.linkedIn ? `<div><b>LinkedIn:</b> <a href="${esc(co.linkedIn)}" target="_blank" rel="noopener" style="color:#0369A1">view</a></div>` : ''}
            ${co.twitter ? `<div><b>Twitter:</b> <a href="${esc(co.twitter)}" target="_blank" rel="noopener" style="color:#0369A1">view</a></div>` : ''}
          </div>
          ${(co.keywords||[]).length ? `<div style="margin-top:10px"><div style="font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#64748B;margin-bottom:6px">Keywords</div><div style="display:flex;flex-wrap:wrap;gap:4px">${co.keywords.slice(0,18).map(k=>`<span style="background:#E0F2FE;color:#075985;padding:2px 8px;border-radius:999px;font-size:0.7rem">${esc(k)}</span>`).join('')}</div></div>` : ''}
        </div>`
      : `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px;margin-bottom:12px;font-size:0.82rem;color:#92400E">⚠️ Apollo: ${esc((aRes.error||'no data for this domain'))}</div>`;
    // BuiltWith card
    const buHtml = bRes.ok && (bRes.categoryCount||0) > 0
      ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-weight:800;color:#0F172A;font-size:0.95rem">🛠 Tech footprint</div>
            <div style="font-size:0.74rem;color:#64748B">${bRes.totalLiveTechnologies||0} live techs · ${bRes.categoryCount} categories${bRes.firstSeen?` · since ${esc(bRes.firstSeen)}`:''}</div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;max-height:240px;overflow-y:auto">
            ${bRes.categories.slice(0,40).map(c=>`<div style="display:flex;justify-content:space-between;background:white;border:1px solid #E5E7EB;border-radius:6px;padding:6px 10px;font-size:0.76rem"><span style="color:#475569;truncate">${esc(c.category)}</span><b style="color:#0369A1">${c.live}</b></div>`).join('')}
          </div>
          ${bRes.note ? `<div style="margin-top:10px;font-size:0.7rem;color:#94A3B8;font-style:italic">${esc(bRes.note)}</div>` : ''}
        </div>`
      : `<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px;font-size:0.82rem;color:#92400E">⚠️ BuiltWith: ${esc((bRes.error||'no tech data found'))}</div>`;
    out.innerHTML = apolloHtml + buHtml;
  } catch (e) {
    out.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px;color:#991B1B;font-size:0.85rem">⚠️ ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Look up';
  }
}
window.showCompanyIntel = showCompanyIntel;
window.runCompanyIntel  = runCompanyIntel;

// Test the configured Slack/Discord webhook from the Stakeholders page.
async function testSlackWebhook() {
  const msg = document.getElementById('slackTestMsg');
  if (msg) { msg.style.color='#64748B'; msg.textContent='Sending…'; }
  try {
    const r = await fetch('/api/slack/send', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text:'🧞 InfoGenie test alert — your webhook is wired correctly.'}) });
    const j = await r.json();
    if (j.ok) { msg.style.color='#059669'; msg.textContent = `✓ Sent to ${j.kind} — check your channel.`; }
    else      { msg.style.color='#B91C1C'; msg.textContent = '✗ ' + (j.error || 'Failed'); }
  } catch (e) { if (msg) { msg.style.color='#B91C1C'; msg.textContent = e.message; } }
}
window.testSlackWebhook = testSlackWebhook;

// ═══════════════════════════════════════════════════════════════════════════
// AD PLATFORM CONNECTIONS — UI for Meta / Google Ads / TikTok credentials
// Backend already exposes /api/ad-platforms/status and the live fetchers.
// This file only builds the user-facing strip + setup-instructions modal.
// SETUP REQUIRES CREDENTIALS — see modal copy and replit.md for the env vars.
// ═══════════════════════════════════════════════════════════════════════════

window._adPlatformDefs = {
  meta: {
    name: 'Meta Ads (Facebook + Instagram)',
    icon: '📘',
    color: '#1877F2',
    envVars: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'],
    steps: [
      'Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener" style="color:#0066FF">developers.facebook.com/apps</a> and create a new app (type: Business).',
      'Add the <strong>Marketing API</strong> product to your app.',
      'Generate a long-lived <strong>System User access token</strong> with the <code>ads_read</code> and <code>ads_management</code> permissions.',
      'Copy your Ad Account ID from <a href="https://business.facebook.com/adsmanager" target="_blank" rel="noopener" style="color:#0066FF">Ads Manager</a> (the number after <code>act=</code> in the URL).',
      'Add both values as Replit secrets: <code>META_ACCESS_TOKEN</code> and <code>META_AD_ACCOUNT_ID</code>.',
    ],
    timeline: 'Same day — no Meta review needed for personal use.',
  },
  google: {
    name: 'Google Ads',
    icon: '🔵',
    color: '#4285F4',
    envVars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
    steps: [
      'Apply for a <strong>Google Ads Developer Token</strong> from your MCC manager account at <a href="https://ads.google.com/aw/apicenter" target="_blank" rel="noopener" style="color:#0066FF">ads.google.com/aw/apicenter</a>. Approval takes 1–3 business days.',
      'Create an OAuth 2.0 Client ID in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" style="color:#0066FF">Google Cloud Console → Credentials</a> (type: Desktop app).',
      'Generate a <strong>refresh token</strong> using Google\'s OAuth 2.0 Playground or the <code>oauth2l</code> CLI with scope <code>https://www.googleapis.com/auth/adwords</code>.',
      'Find your Customer ID in the top-right of any Google Ads page (format: 123-456-7890).',
      'Add all five values as Replit secrets.',
    ],
    timeline: '1–3 business days for the developer token approval.',
  },
  tiktok: {
    name: 'TikTok Ads',
    icon: '⬛',
    color: '#010101',
    envVars: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'],
    steps: [
      'Sign up for <a href="https://ads.tiktok.com/marketing_api" target="_blank" rel="noopener" style="color:#0066FF">TikTok for Business — Marketing API</a> and create a developer app.',
      'Submit the app for basic-tier approval (usually granted within 24 hours).',
      'After approval, generate an <strong>access token</strong> from the app dashboard.',
      'Copy your Advertiser ID from <a href="https://ads.tiktok.com" target="_blank" rel="noopener" style="color:#0066FF">TikTok Ads Manager</a> (top-right of any campaigns page).',
      'Add both values as Replit secrets: <code>TIKTOK_ACCESS_TOKEN</code> and <code>TIKTOK_ADVERTISER_ID</code>.',
    ],
    timeline: 'Approx. 24 hours for app approval.',
  },
  microsoft: {
    name: 'Microsoft Ads (Bing)',
    icon: '🅱️',
    color: '#00A4EF',
    envVars: ['MICROSOFT_ADS_DEVELOPER_TOKEN', 'MICROSOFT_ADS_CLIENT_ID', 'MICROSOFT_ADS_CLIENT_SECRET', 'MICROSOFT_ADS_REFRESH_TOKEN', 'MICROSOFT_ADS_CUSTOMER_ID', 'MICROSOFT_ADS_ACCOUNT_ID'],
    steps: [
      'Apply for a <strong>Microsoft Advertising Developer Token</strong> at <a href="https://developers.ads.microsoft.com/Account" target="_blank" rel="noopener" style="color:#0066FF">developers.ads.microsoft.com/Account</a>. Sandbox tokens are instant; production tokens take ~3 business days.',
      'Register an Azure AD app at <a href="https://portal.azure.com" target="_blank" rel="noopener" style="color:#0066FF">portal.azure.com</a> → App registrations → New registration. Set redirect URI to <code>https://login.microsoftonline.com/common/oauth2/nativeclient</code> and add API permissions for <strong>Microsoft Advertising</strong> with the <code>ads.manage</code> scope.',
      'Copy the <strong>Application (client) ID</strong> and create a client secret under Certificates &amp; secrets — copy the <em>Value</em>, not the ID.',
      'Generate a <strong>refresh token</strong> by visiting the auth URL with your client_id (Microsoft\'s OAuth docs have a one-page walkthrough), then exchanging the code for tokens.',
      'Find your <strong>Customer ID</strong> and <strong>Account ID</strong> in Microsoft Advertising under Tools → Accounts &amp; Billing (top-right shows both numbers).',
      'Add all six values as Replit secrets.',
    ],
    timeline: 'Approx. 1–3 business days for production developer token.',
  },
};

async function renderAdPlatformConnections() {
  const wrap = document.getElementById('ccrConnections');
  if (!wrap) return;
  wrap.innerHTML = `<div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:14px 18px;font-size:0.78rem;color:#6B7280">⏳ Checking ad platform connections…</div>`;
  let status = { meta:false, googleAds:false, tiktok:false, microsoft:false };
  try {
    const r = await fetch('/api/ad-platforms/status');
    if (r.ok) status = await r.json();
  } catch (e) { /* render with all-disconnected fallback */ }

  const map = [
    { key:'meta',      on: !!status.meta },
    { key:'google',    on: !!status.googleAds },
    { key:'microsoft', on: !!status.microsoft },
    { key:'tiktok',    on: !!status.tiktok },
  ];
  const allOn  = map.every(m => m.on);
  const noneOn = map.every(m => !m.on);

  const bannerStyle = allOn
    ? 'background:linear-gradient(135deg,rgba(5,150,105,.08),rgba(5,150,105,.02));border:1px solid rgba(5,150,105,.25);color:#065F46'
    : noneOn
      ? 'background:linear-gradient(135deg,rgba(217,119,6,.08),rgba(217,119,6,.02));border:1px solid rgba(217,119,6,.25);color:#92400E'
      : 'background:linear-gradient(135deg,rgba(0,102,255,.06),rgba(0,201,200,.04));border:1px solid rgba(0,102,255,.2);color:#0C4A6E';
  const bannerText = allOn
    ? '✅ All ad platforms connected — your Cross-Channel Report is pulling live data.'
    : noneOn
      ? '⚠️ No ad platforms connected — click <strong>Connect now</strong> on any channel below to see the setup steps. Each requires credentials from that platform.'
      : `🟡 ${map.filter(m=>m.on).length} of ${map.length} ad platforms connected — connect the rest for a full unified report.`;

  wrap.innerHTML = `
    <div style="${bannerStyle};font-weight:700;font-size:0.78rem;padding:12px 16px;border-radius:12px 12px 0 0">${bannerText}</div>
    <div style="background:white;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 14px 14px;padding:14px 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <span style="font-size:0.7rem;color:#6B7280;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Channels</span>
      ${map.map(m => {
        const def = window._adPlatformDefs[m.key];
        const dot = m.on ? '#10B981' : '#9CA3AF';
        const label = m.on ? 'Connected' : 'Not connected';
        return `<button onclick="showAdPlatformSetup('${m.key}')" style="display:inline-flex;align-items:center;gap:8px;background:${m.on?'#F0FDF4':'#F9FAFB'};border:1px solid ${m.on?'#BBF7D0':'#E5E7EB'};border-radius:999px;padding:6px 12px;font-size:0.74rem;font-weight:600;color:#0F172A;cursor:pointer">
          <span style="width:7px;height:7px;border-radius:50%;background:${dot}"></span>
          <span>${def.icon} ${_esc(def.name.split(' (')[0])}</span>
          <span style="color:${m.on?'#059669':'#9CA3AF'};font-weight:700">${label}</span>
        </button>`;
      }).join('')}
    </div>
  `;
}

function showAdPlatformSetup(key) {
  const def = window._adPlatformDefs[key];
  if (!def) return;
  let modal = document.getElementById('adPlatformSetupModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adPlatformSetupModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }
  const stepsHtml = def.steps.map((s, i) => `
    <li style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #F1F5F9">
      <div style="flex-shrink:0;width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#0066FF,#00C9C8);color:white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:0.78rem">${i+1}</div>
      <div style="flex:1;font-size:0.84rem;color:#0F172A;line-height:1.55">${s}</div>
    </li>`).join('');
  const envHtml = def.envVars.map(v => `<code style="display:inline-block;background:#0F172A;color:#67E8F9;padding:3px 9px;border-radius:6px;font-size:0.74rem;font-family:'JetBrains Mono',monospace;margin:2px 4px 2px 0">${v}</code>`).join('');
  modal.innerHTML = `
    <div style="background:white;border-radius:18px;max-width:640px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 25px 80px rgba(0,0,0,.4)">
      <div style="background:linear-gradient(135deg,${def.color},#0066FF);padding:22px 26px;border-radius:18px 18px 0 0;color:white">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <div style="font-family:Sora,sans-serif;font-size:1.1rem;font-weight:800">🔌 Connect ${_esc(def.name)}</div>
            <div style="font-size:0.78rem;opacity:.85;margin-top:4px">${_esc(def.timeline)}</div>
          </div>
          <button onclick="document.getElementById('adPlatformSetupModal').remove()" style="background:rgba(255,255,255,.15);border:none;color:white;width:32px;height:32px;border-radius:50%;font-size:1rem;cursor:pointer">✕</button>
        </div>
      </div>
      <div style="padding:22px 26px">
        <div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:0.8rem;color:#78350F;line-height:1.55">
          <strong>⚠️ Setup requires credentials from the platform.</strong> InfoGenie cannot fetch live data until you complete these steps and add the credentials as Replit secrets. Once added, refresh this page and the channel will show <strong style="color:#059669">Connected</strong>.
        </div>
        <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Required Replit secrets</div>
        <div style="margin-bottom:18px">${envHtml}</div>
        <div style="font-size:0.7rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Setup steps</div>
        <ol style="list-style:none;padding:0;margin:0">${stepsHtml}</ol>
      </div>
      <div style="padding:14px 26px;border-top:1px solid #F1F5F9;display:flex;justify-content:flex-end;gap:10px;background:#FAFBFC;border-radius:0 0 18px 18px">
        <button onclick="document.getElementById('adPlatformSetupModal').remove()" style="padding:10px 20px;background:white;border:1px solid #E5E7EB;border-radius:9px;font-size:0.82rem;font-weight:700;color:#374151;cursor:pointer">Close</button>
        <button onclick="document.getElementById('adPlatformSetupModal').remove();renderAdPlatformConnections();showToast('🔄 Re-checking connection status…')" style="padding:10px 20px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:9px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer">↻ Re-check status</button>
      </div>
    </div>
  `;
}

// ========================================================================
// AI OPTIMIZER DASHBOARD — Phase 1 (ingest + rule-based)
// ========================================================================
async function renderOptimizerDashboard() {
  const wrap = document.getElementById('optimizerWrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="text-align:center;padding:60px;color:#6B7280">Loading optimizer status…</div>`;
  try {
    const [statusR, campsR, actionsR] = await Promise.all([
      fetch('/api/optimizer/status').then(r => r.json()),
      fetch('/api/optimizer/campaigns').then(r => r.json()),
      fetch('/api/optimizer/actions?limit=50').then(r => r.json()),
    ]);
    if (!statusR.ok) {
      wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:18px;border-radius:12px"><strong>Optimizer unavailable.</strong> ${statusR.error || 'Database not configured.'}</div>`;
      return;
    }
    const camps   = campsR.campaigns || [];
    const actions = actionsR.actions || [];
    const dryBadge = statusR.dryRun
      ? `<span style="background:#FEF3C7;color:#92400E;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">DRY-RUN — logging only</span>`
      : `<span style="background:#D1FAE5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">LIVE — applying to ad platforms</span>`;

    const platChip = (n, on) => `<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:14px;font-size:0.74rem;font-weight:700;background:${on?'#D1FAE5':'#F3F4F6'};color:${on?'#065F46':'#6B7280'}">${on?'●':'○'} ${n}</span>`;

    wrap.innerHTML = `
      <!-- Status strip -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between">
        <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center">
          <div><div style="font-size:0.72rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Mode</div><div style="margin-top:4px">${dryBadge}</div></div>
          <div><div style="font-size:0.72rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Tracked</div><div style="font-size:1.25rem;font-weight:800;color:#0A1628;margin-top:2px">${statusR.campaigns?.n || 0}</div></div>
          <div><div style="font-size:0.72rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Optimizer ON</div><div style="font-size:1.25rem;font-weight:800;color:#0A1628;margin-top:2px">${statusR.campaigns?.enabled || 0}</div></div>
          <div><div style="font-size:0.72rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Decisions 24h</div><div style="font-size:1.25rem;font-weight:800;color:#0A1628;margin-top:2px">${statusR.actionsLast24h || 0}</div></div>
          <div><div style="font-size:0.72rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.04em">Platforms</div><div style="margin-top:4px;display:flex;gap:6px">${platChip('Meta', statusR.platforms.meta)}${platChip('Google', statusR.platforms.google)}${platChip('TikTok', statusR.platforms.tiktok)}</div></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="optimizerToggleDryRun(${!statusR.dryRun})" style="padding:9px 16px;background:${statusR.dryRun?'linear-gradient(135deg,#10B981,#059669)':'#FFFFFF'};color:${statusR.dryRun?'white':'#374151'};border:1px solid ${statusR.dryRun?'transparent':'#D1D5DB'};border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">${statusR.dryRun?'⚡ Switch to LIVE':'🛑 Back to dry-run'}</button>
          <button onclick="optimizerRunNow()" style="padding:9px 16px;background:linear-gradient(135deg,#0066FF,#00C9C8);color:white;border:none;border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">▶ Run optimizer now</button>
        </div>
      </div>

      <!-- Tracked campaigns -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-bottom:18px">
        <h3 style="margin:0 0 14px;font-size:1.05rem;color:#0A1628">📡 Tracked Campaigns (${camps.length})</h3>
        ${camps.length === 0
          ? `<div style="padding:36px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No campaigns yet. Launch a campaign from the <a href="#" onclick="navigateTo('campaigns');return false;" style="color:#0066FF;font-weight:600">Create</a> page (with Meta/Google/TikTok credentials connected) and it will appear here automatically.</div>`
          : `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">
              <thead><tr style="border-bottom:2px solid #E5E7EB;color:#6B7280;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em">
                <th style="text-align:left;padding:10px 8px">Campaign</th><th style="text-align:left;padding:10px 8px">Platform</th>
                <th style="text-align:right;padding:10px 8px">7d Spend</th><th style="text-align:right;padding:10px 8px">7d ROAS</th>
                <th style="text-align:right;padding:10px 8px">Target ROAS</th><th style="text-align:right;padding:10px 8px">Daily Budget</th>
                <th style="text-align:center;padding:10px 8px">Optimizer</th><th></th>
              </tr></thead>
              <tbody>${camps.map(c => {
                const p = c.perf7d || {};
                const spend = parseFloat(p.spend || 0), rev = parseFloat(p.revenue || 0);
                const roas  = spend > 0 ? (rev/spend).toFixed(2) : '—';
                const roasColor = (roas !== '—' && parseFloat(roas) >= parseFloat(c.target_roas)) ? '#059669' : (roas === '—' ? '#9CA3AF' : '#DC2626');
                return `<tr style="border-bottom:1px solid #F3F4F6">
                  <td style="padding:11px 8px;font-weight:600;color:#0A1628">${c.name}</td>
                  <td style="padding:11px 8px;color:#6B7280;text-transform:capitalize">${c.platform}</td>
                  <td style="padding:11px 8px;text-align:right;color:#0A1628;font-weight:600">$${spend.toFixed(2)}</td>
                  <td style="padding:11px 8px;text-align:right;font-weight:800;color:${roasColor}">${roas}${roas!=='—'?'×':''}</td>
                  <td style="padding:11px 8px;text-align:right">
                    <input type="number" step="0.1" value="${c.target_roas}" onchange="optimizerSetTarget(${c.id}, this.value)"
                      style="width:64px;padding:4px 6px;border:1px solid #D1D5DB;border-radius:6px;font-size:0.78rem;text-align:right">×
                  </td>
                  <td style="padding:11px 8px;text-align:right;color:#0A1628">$${parseFloat(c.daily_budget || 0).toFixed(2)}</td>
                  <td style="padding:11px 8px;text-align:center">
                    <label style="display:inline-flex;align-items:center;cursor:pointer">
                      <input type="checkbox" ${c.optimizer_enabled?'checked':''} onchange="optimizerToggle(${c.id}, this.checked)" style="cursor:pointer;width:16px;height:16px">
                    </label>
                  </td>
                  <td style="padding:11px 8px;text-align:right">
                    <button onclick="optimizerDeleteCampaign(${c.id}, '${(c.name||'').replace(/'/g,'')}')" title="Stop tracking" style="background:transparent;border:none;color:#9CA3AF;cursor:pointer;font-size:0.95rem">🗑</button>
                  </td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>`}
      </div>

      <!-- Decisions log -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px">
        <h3 style="margin:0 0 14px;font-size:1.05rem;color:#0A1628">📜 Optimizer Decisions Log</h3>
        ${actions.length === 0
          ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No decisions yet. The optimizer runs every 6 hours, or click "Run optimizer now" above.</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${actions.map(a => {
              const color = a.action_type==='pause' ? '#DC2626' : a.action_type==='scale_budget' ? '#059669' : a.action_type==='hold' ? '#6B7280' : '#F59E0B';
              const icon  = a.action_type==='pause' ? '⏸' : a.action_type==='scale_budget' ? '📈' : a.action_type==='hold' ? '✓' : '⚠';
              const when  = new Date(a.created_at).toLocaleString();
              const tag   = a.applied ? '<span style="color:#059669;font-size:0.7rem;font-weight:700;margin-left:8px">APPLIED</span>' : '<span style="color:#92400E;font-size:0.7rem;font-weight:700;margin-left:8px">LOGGED</span>';
              return `<div style="display:flex;gap:12px;padding:11px 14px;border-left:3px solid ${color};background:#FAFBFC;border-radius:6px">
                <div style="font-size:1.2rem">${icon}</div>
                <div style="flex:1">
                  <div style="font-size:0.82rem;color:#0A1628"><strong>${a.action_type.replace(/_/g,' ')}</strong> · ${a.campaign_name || '?'} <span style="color:#6B7280;font-size:0.74rem">(${a.platform || '?'})</span>${tag}</div>
                  <div style="font-size:0.78rem;color:#4B5563;margin-top:3px">${a.reason || ''}</div>
                  ${a.apply_error ? `<div style="font-size:0.74rem;color:#DC2626;margin-top:3px">⚠ ${a.apply_error}</div>` : ''}
                  <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">${when}</div>
                </div>
              </div>`;
            }).join('')}</div>`}
      </div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:18px;border-radius:12px"><strong>Failed to load optimizer.</strong> ${e.message}</div>`;
  }
}

window.renderOptimizerDashboard = renderOptimizerDashboard;
window.optimizerToggle = async function(id, enabled) {
  await fetch('/api/optimizer/enable', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id, enabled}) });
  showToast(enabled ? '✅ Optimizer enabled for this campaign' : '⏸ Optimizer disabled');
  renderOptimizerDashboard();
};
window.optimizerSetTarget = async function(id, target_roas) {
  await fetch('/api/optimizer/target', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id, target_roas: parseFloat(target_roas)}) });
  showToast('✅ Target ROAS updated');
};
window.optimizerToggleDryRun = async function(toLive) {
  if (toLive && !confirm('Switch to LIVE mode? The optimizer will start calling Meta/Google/TikTok APIs to PAUSE campaigns and CHANGE BUDGETS based on its rules. This affects real ad spend.')) return;
  await fetch('/api/optimizer/dry-run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({dryRun: !toLive}) });
  showToast(toLive ? '⚡ Optimizer is now LIVE' : '🛑 Optimizer back in dry-run');
  renderOptimizerDashboard();
};
window.optimizerRunNow = async function() {
  showToast('⏳ Running optimizer — may take a few seconds…');
  const r = await fetch('/api/optimizer/run-now', { method:'POST' }).then(x=>x.json());
  showToast(`✅ Done — evaluated ${r.optimizer?.evaluated || 0} campaign(s)`);
  renderOptimizerDashboard();
};
window.optimizerDeleteCampaign = async function(id, name) {
  if (!confirm(`Stop tracking "${name}"? This removes it from the optimizer (does not affect the platform).`)) return;
  await fetch('/api/optimizer/campaigns/' + id, { method:'DELETE' });
  showToast('🗑 Removed from optimizer');
  renderOptimizerDashboard();
};

// ========================================================================
// Phase 8 — Creative Auto-Refresh UI section
// Wraps the existing renderOptimizerDashboard to also append the Creative
// Refresh card + decisions log without touching its internals.
// ========================================================================
(function () {
  const _origRender = window.renderOptimizerDashboard;
  if (!_origRender) return;
  window.renderOptimizerDashboard = async function () {
    await _origRender();
    const wrap = document.getElementById('optimizerWrap');
    if (!wrap) return;
    const section = document.createElement('div');
    section.id = 'creativeRefreshSection';
    section.innerHTML = `<div style="text-align:center;padding:30px;color:#6B7280">Loading creative refresh status…</div>`;
    wrap.appendChild(section);
    try {
      const [stR, rfR] = await Promise.all([
        fetch('/api/optimizer/creative-refresh/status').then(r => r.json()),
        fetch('/api/optimizer/creative-refreshes?limit=20').then(r => r.json()),
      ]);
      const refreshes = rfR.refreshes || [];
      const dryBadge = stR.dryRun
        ? `<span style="background:#FEF3C7;color:#92400E;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">DRY-RUN — generating only</span>`
        : `<span style="background:#D1FAE5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">LIVE — uploading new ads (PAUSED) to Meta</span>`;
      const enBadge = stR.enabled
        ? `<span style="background:#D1FAE5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">● Enabled</span>`
        : `<span style="background:#F3F4F6;color:#6B7280;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">○ Disabled</span>`;
      section.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-top:18px">
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0 0 4px;font-size:1.05rem;color:#0A1628">🎨 72-Hour Creative Auto-Refresh <span style="font-size:0.72rem;color:#6B7280;font-weight:500">— Meta only</span></h3>
              <div style="display:flex;gap:8px;margin-top:4px">${enBadge}${dryBadge}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="creativeRefreshToggleEnabled(${!stR.enabled})" style="padding:9px 14px;background:${stR.enabled?'#FFFFFF':'linear-gradient(135deg,#10B981,#059669)'};color:${stR.enabled?'#374151':'white'};border:1px solid ${stR.enabled?'#D1D5DB':'transparent'};border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">${stR.enabled?'⏸ Disable':'▶ Enable'}</button>
              <button onclick="creativeRefreshToggleDryRun(${!stR.dryRun})" style="padding:9px 14px;background:${stR.dryRun?'linear-gradient(135deg,#0066FF,#00C9C8)':'#FFFFFF'};color:${stR.dryRun?'white':'#374151'};border:1px solid ${stR.dryRun?'transparent':'#D1D5DB'};border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">${stR.dryRun?'⚡ Switch to LIVE':'🛑 Back to dry-run'}</button>
              <button onclick="creativeRefreshRunNow()" style="padding:9px 14px;background:linear-gradient(135deg,#7C3AED,#EC4899);color:white;border:none;border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">🔄 Run refresh now</button>
            </div>
          </div>
          <p style="margin:0 0 14px;color:#6B7280;font-size:0.82rem;line-height:1.55">
            Every 24h, scans active ads under enabled Meta campaigns. Any ad >72h old that has spent ≥$25 with CTR &lt;0.5% or ROAS &lt;50% of target gets a <strong>fresh GPT-4o headline + body + new gpt-image-1 visual</strong>, uploaded to Meta as a <strong>PAUSED</strong> ad in the same ad set (so you approve before it spends). The old ad is paused. New ads stay paused regardless of mode — humans always approve before activation.
          </p>
          ${refreshes.length === 0
            ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No refreshes yet. The cron runs every 24h, or click "Run refresh now" above. Needs at least one Meta campaign with the optimizer ON and ads >72h old that are underperforming.</div>`
            : `<div style="display:flex;flex-direction:column;gap:10px">${refreshes.map(r => {
                const tag   = r.applied ? '<span style="color:#059669;font-size:0.7rem;font-weight:700;margin-left:8px">UPLOADED</span>' : (r.apply_error ? '<span style="color:#DC2626;font-size:0.7rem;font-weight:700;margin-left:8px">FAILED</span>' : '<span style="color:#92400E;font-size:0.7rem;font-weight:700;margin-left:8px">GENERATED ONLY</span>');
                const color = r.applied ? '#7C3AED' : (r.apply_error ? '#DC2626' : '#F59E0B');
                const when  = new Date(r.created_at).toLocaleString();
                const perf  = r.perf_snapshot || {};
                const imgPreview = (r.new_image_url && !r.new_image_url.startsWith('data:'))
                  ? `<img src="${r.new_image_url}" style="width:80px;height:80px;border-radius:8px;object-fit:cover;border:1px solid #E5E7EB">`
                  : `<div style="width:80px;height:80px;border-radius:8px;background:#F3F4F6;display:flex;align-items:center;justify-content:center;font-size:1.6rem">🎨</div>`;
                return `<div style="display:flex;gap:14px;padding:14px;border-left:3px solid ${color};background:#FAFBFC;border-radius:8px">
                  ${imgPreview}
                  <div style="flex:1;min-width:0">
                    <div style="font-size:0.85rem;color:#0A1628"><strong>${r.campaign_name || 'Campaign'}</strong> <span style="color:#6B7280;font-size:0.74rem">(${r.platform || 'meta'})</span>${tag}</div>
                    <div style="font-size:0.78rem;color:#4B5563;margin-top:6px"><strong>New headline:</strong> ${r.new_headline || '(none)'}</div>
                    <div style="font-size:0.78rem;color:#4B5563;margin-top:2px"><strong>New body:</strong> ${r.new_body || '(none)'}</div>
                    ${r.old_headline ? `<div style="font-size:0.74rem;color:#9CA3AF;margin-top:4px;text-decoration:line-through">Old: ${r.old_headline}</div>` : ''}
                    <div style="font-size:0.74rem;color:#6B7280;margin-top:4px">${r.reason || ''}</div>
                    ${(perf.spend || perf.ctr) ? `<div style="font-size:0.72rem;color:#9CA3AF;margin-top:3px">Old ad 72h: $${(perf.spend||0).toFixed(2)} spend · CTR ${((perf.ctr||0)*100).toFixed(2)}% · ROAS ${(perf.roas||0).toFixed(2)}×</div>` : ''}
                    ${r.apply_error ? `<div style="font-size:0.74rem;color:#DC2626;margin-top:4px">⚠ ${r.apply_error}</div>` : ''}
                    <div style="font-size:0.7rem;color:#9CA3AF;margin-top:6px">${when}</div>
                  </div>
                </div>`;
              }).join('')}</div>`}
        </div>
      `;
    } catch (e) {
      section.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:14px;border-radius:10px;margin-top:18px">Failed to load creative refresh: ${e.message}</div>`;
    }
  };
})();

window.creativeRefreshToggleEnabled = async function(enabled) {
  await fetch('/api/optimizer/creative-refresh/toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({enabled}) });
  showToast(enabled ? '✅ Creative auto-refresh enabled' : '⏸ Creative auto-refresh disabled');
  renderOptimizerDashboard();
};
window.creativeRefreshToggleDryRun = async function(toLive) {
  if (toLive && !confirm('Switch creative refresh to LIVE? Generated copy + images will be uploaded to your Meta ad account as NEW ads (always created PAUSED so you approve before they spend), and the old underperforming ads will be paused. You can review every new ad in Meta Ads Manager before unpausing.')) return;
  await fetch('/api/optimizer/creative-refresh/dry-run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({dryRun: !toLive}) });
  showToast(toLive ? '⚡ Creative refresh is now LIVE (new ads still created paused)' : '🛑 Creative refresh back in dry-run');
  renderOptimizerDashboard();
};
window.creativeRefreshRunNow = async function() {
  showToast('⏳ Scanning ads + generating fresh creative — this may take 30-60 seconds…');
  const r = await fetch('/api/optimizer/creative-refresh/run-now', { method:'POST', headers:{'Content-Type':'application/json'}, body: '{}' }).then(x=>x.json());
  const s = r.run || {};
  showToast(`✅ Done — scanned ${s.scanned||0}, refreshed ${s.refreshed||0}, errors ${s.errors||0}`);
  renderOptimizerDashboard();
};

// ========================================================================
// Phase 7 — Multi-Armed Bandit UI section
// Wraps renderOptimizerDashboard to also append the bandit card + log.
// ========================================================================
(function () {
  const _prevRender = window.renderOptimizerDashboard;
  if (!_prevRender) return;
  window.renderOptimizerDashboard = async function () {
    await _prevRender();
    const wrap = document.getElementById('optimizerWrap');
    if (!wrap) return;
    const section = document.createElement('div');
    section.id = 'banditSection';
    section.innerHTML = `<div style="text-align:center;padding:30px;color:#6B7280">Loading bandit status…</div>`;
    wrap.appendChild(section);
    try {
      const [stR, alR] = await Promise.all([
        fetch('/api/optimizer/bandit/status').then(r => r.json()),
        fetch('/api/optimizer/bandit/allocations?limit=30').then(r => r.json()),
      ]);
      const allocs = alR.allocations || [];
      const dryBadge = stR.dryRun
        ? `<span style="background:#FEF3C7;color:#92400E;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">DRY-RUN — sampling only</span>`
        : `<span style="background:#D1FAE5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">LIVE — reallocating Meta budgets</span>`;
      const enBadge = stR.enabled
        ? `<span style="background:#D1FAE5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">● Enabled</span>`
        : `<span style="background:#F3F4F6;color:#6B7280;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">○ Disabled (off by default)</span>`;
      // Group allocations by run_id so the user sees one row per run with all arms
      const byRun = {};
      allocs.forEach(a => { (byRun[a.run_id] = byRun[a.run_id] || []).push(a); });
      const runs = Object.entries(byRun).slice(0, 10);
      section.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-top:18px">
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0 0 4px;font-size:1.05rem;color:#0A1628">🎰 Multi-Armed Bandit — Ad-Set Budget Allocator <span style="font-size:0.72rem;color:#6B7280;font-weight:500">— Meta only</span></h3>
              <div style="display:flex;gap:8px;margin-top:4px">${enBadge}${dryBadge}</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="banditToggleEnabled(${!stR.enabled})" style="padding:9px 14px;background:${stR.enabled?'#FFFFFF':'linear-gradient(135deg,#10B981,#059669)'};color:${stR.enabled?'#374151':'white'};border:1px solid ${stR.enabled?'#D1D5DB':'transparent'};border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">${stR.enabled?'⏸ Disable':'▶ Enable'}</button>
              <button onclick="banditToggleDryRun(${!stR.dryRun})" style="padding:9px 14px;background:${stR.dryRun?'linear-gradient(135deg,#0066FF,#00C9C8)':'#FFFFFF'};color:${stR.dryRun?'white':'#374151'};border:1px solid ${stR.dryRun?'transparent':'#D1D5DB'};border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">${stR.dryRun?'⚡ Switch to LIVE':'🛑 Back to dry-run'}</button>
              <button onclick="banditRunNow()" style="padding:9px 14px;background:linear-gradient(135deg,#F59E0B,#DC2626);color:white;border:none;border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">🎲 Run bandit now</button>
            </div>
          </div>
          <p style="margin:0 0 14px;color:#6B7280;font-size:0.82rem;line-height:1.55">
            Every 12h, for each enabled Meta campaign with ≥2 active ad sets, draws a Thompson sample from <code>Beta(conversions+1, clicks-conv+1)</code> per ad set, multiplies by AOV, and reallocates the campaign's existing budget pool. Floors at 10% per arm (preserves exploration), ceilings at 60% (no winner-takes-all). Only changes >$1 / >10% are pushed to Meta. Total campaign budget is preserved — money just moves between ad sets.
          </p>
          ${runs.length === 0
            ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No bandit runs yet. Needs at least one Meta campaign with ≥2 active ad sets and the optimizer ON. Click "Run bandit now" above.</div>`
            : `<div style="display:flex;flex-direction:column;gap:14px">${runs.map(([rid, arms]) => {
                const when = new Date(arms[0].created_at).toLocaleString();
                const camp = arms[0].campaign_name || 'Campaign';
                const totalNew = arms.reduce((s,a) => s + parseFloat(a.new_budget || 0), 0);
                const anyApplied = arms.some(a => a.applied);
                const tag = anyApplied ? '<span style="color:#059669;font-size:0.7rem;font-weight:700;margin-left:8px">APPLIED</span>' : '<span style="color:#92400E;font-size:0.7rem;font-weight:700;margin-left:8px">SAMPLED ONLY</span>';
                return `<div style="border-left:3px solid #F59E0B;background:#FAFBFC;border-radius:8px;padding:12px 14px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-size:0.85rem;color:#0A1628"><strong>${camp}</strong>${tag}<span style="color:#6B7280;font-size:0.74rem;margin-left:8px">${arms.length} arm(s) · total $${totalNew.toFixed(2)}/day</span></div>
                    <div style="font-size:0.7rem;color:#9CA3AF">${when}</div>
                  </div>
                  <table style="width:100%;border-collapse:collapse;font-size:0.78rem">
                    <thead><tr style="color:#6B7280;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em">
                      <th style="text-align:left;padding:4px 6px">Ad Set</th>
                      <th style="text-align:right;padding:4px 6px">Sample</th>
                      <th style="text-align:right;padding:4px 6px">AOV</th>
                      <th style="text-align:right;padding:4px 6px">Old $/d</th>
                      <th style="text-align:right;padding:4px 6px">New $/d</th>
                      <th style="text-align:right;padding:4px 6px">Share</th>
                      <th></th>
                    </tr></thead>
                    <tbody>${arms.map(a => {
                      const oldB = parseFloat(a.old_budget||0), newB = parseFloat(a.new_budget||0);
                      const diff = newB - oldB;
                      const arrow = diff > 0.01 ? `<span style="color:#059669">▲ $${diff.toFixed(2)}</span>` : (diff < -0.01 ? `<span style="color:#DC2626">▼ $${Math.abs(diff).toFixed(2)}</span>` : '<span style="color:#9CA3AF">—</span>');
                      return `<tr style="border-top:1px solid #F3F4F6">
                        <td style="padding:6px;color:#0A1628">${a.adset_name || a.platform_adset_id || '?'}</td>
                        <td style="padding:6px;text-align:right;color:#4B5563">${parseFloat(a.sampled_score||0).toFixed(4)}</td>
                        <td style="padding:6px;text-align:right;color:#4B5563">$${parseFloat(a.avg_value||0).toFixed(2)}</td>
                        <td style="padding:6px;text-align:right;color:#6B7280">$${oldB.toFixed(2)}</td>
                        <td style="padding:6px;text-align:right;color:#0A1628;font-weight:600">$${newB.toFixed(2)}</td>
                        <td style="padding:6px;text-align:right;color:#4B5563">${(parseFloat(a.share||0)*100).toFixed(1)}%</td>
                        <td style="padding:6px;text-align:right">${arrow}${a.apply_error?`<div style="color:#DC2626;font-size:0.7rem">⚠ ${a.apply_error}</div>`:''}</td>
                      </tr>`;
                    }).join('')}</tbody>
                  </table>
                </div>`;
              }).join('')}</div>`}
        </div>
      `;
    } catch (e) {
      section.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:14px;border-radius:10px;margin-top:18px">Failed to load bandit: ${e.message}</div>`;
    }
  };
})();

window.banditToggleEnabled = async function(enabled) {
  await fetch('/api/optimizer/bandit/toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({enabled}) });
  showToast(enabled ? '✅ Bandit enabled' : '⏸ Bandit disabled');
  renderOptimizerDashboard();
};
window.banditToggleDryRun = async function(toLive) {
  if (toLive && !confirm('Switch the bandit to LIVE? Every 12h it will reallocate your Meta ad-set budgets based on Thompson sampling. The TOTAL campaign budget stays the same — money just moves between ad sets within the campaign. Only changes >$1 / >10% are pushed.')) return;
  await fetch('/api/optimizer/bandit/dry-run', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({dryRun: !toLive}) });
  showToast(toLive ? '⚡ Bandit is now LIVE' : '🛑 Bandit back in dry-run');
  renderOptimizerDashboard();
};
window.banditRunNow = async function() {
  showToast('🎲 Sampling and reallocating — this may take 15-30 seconds…');
  const r = await fetch('/api/optimizer/bandit/run-now', { method:'POST', headers:{'Content-Type':'application/json'}, body: '{}' }).then(x=>x.json());
  const s = r.run || {};
  showToast(`✅ Done — ${s.campaigns||0} campaigns, ${s.scanned||0} arms, ${s.applied||0} reallocations`);
  renderOptimizerDashboard();
};

// ========================================================================
// T34 — "Why did the AI do this?" Decision Log
// Pulls /api/optimizer/decisions which joins optimizer_actions with the
// campaign so the user gets a plain-English audit trail of every move.
// ========================================================================
(function () {
  const _prevRender = window.renderOptimizerDashboard;
  if (!_prevRender) return;
  window.renderOptimizerDashboard = async function () {
    await _prevRender();
    const wrap = document.getElementById('optimizerWrap');
    if (!wrap) return;
    const section = document.createElement('div');
    section.id = 't34DecisionSection';
    section.innerHTML = `<div style="text-align:center;padding:30px;color:#6B7280">Loading decision log…</div>`;
    wrap.appendChild(section);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    try {
      const j = await fetch('/api/optimizer/decisions?limit=50').then(r => r.json());
      const decisions = j.decisions || [];
      const grouped = decisions.reduce((m, d) => { const k = d.action_type || 'other'; (m[k] = m[k] || []).push(d); return m; }, {});
      const counts = Object.entries(grouped).map(([k, v]) => `<span style="background:#F1F5F9;padding:4px 10px;border-radius:999px;font-size:0.72rem;font-weight:700;color:#0F172A">${esc(k.replace(/_/g,' '))}: ${v.length}</span>`).join(' ');
      section.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-top:18px">
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0 0 4px;font-size:1.05rem;color:#0A1628">🧠 Why did the AI do this? <span style="font-size:0.72rem;color:#6B7280;font-weight:500">— full decision audit log</span></h3>
              <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${counts || '<span style="color:#94A3B8;font-size:0.72rem">No decisions yet</span>'}</div>
            </div>
          </div>
          <p style="margin:0 0 14px;color:#6B7280;font-size:0.82rem;line-height:1.55">Every PAUSE / SCALE BUDGET / HOLD / CREATIVE REFRESH / BANDIT REALLOCATION the optimizer made — with the exact rule that fired and the before/after values. Read this if a campaign behaves unexpectedly.</p>
          ${decisions.length === 0
            ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No decisions logged yet. The optimizer runs every 6 hours; click "Run optimizer now" above to force a run.</div>`
            : `<div style="display:flex;flex-direction:column;gap:8px;max-height:600px;overflow-y:auto">${decisions.map(d => {
                const color = d.action_type === 'pause' ? '#DC2626' : d.action_type === 'scale_budget' ? '#059669' : d.action_type === 'hold' ? '#6B7280' : d.action_type === 'creative_refresh' ? '#7C3AED' : '#F59E0B';
                const icon  = d.action_type === 'pause' ? '⏸' : d.action_type === 'scale_budget' ? '📈' : d.action_type === 'hold' ? '✓' : d.action_type === 'creative_refresh' ? '🎨' : '🎲';
                const when  = new Date(d.created_at).toLocaleString();
                const tag   = d.applied ? '<span style="color:#059669;font-size:0.7rem;font-weight:700;margin-left:8px">APPLIED</span>' : '<span style="color:#92400E;font-size:0.7rem;font-weight:700;margin-left:8px">LOGGED</span>';
                let beforeAfter = '';
                if (d.before_value || d.after_value) {
                  try {
                    const bv = typeof d.before_value === 'string' ? JSON.parse(d.before_value) : d.before_value;
                    const av = typeof d.after_value  === 'string' ? JSON.parse(d.after_value)  : d.after_value;
                    if (bv && av) beforeAfter = `<div style="font-size:0.72rem;color:#475569;margin-top:4px;font-family:ui-monospace,monospace">before: ${esc(JSON.stringify(bv))} → after: ${esc(JSON.stringify(av))}</div>`;
                  } catch (_) {}
                }
                return `<div style="display:flex;gap:12px;padding:11px 14px;border-left:3px solid ${color};background:#FAFBFC;border-radius:6px">
                  <div style="font-size:1.2rem">${icon}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:0.82rem;color:#0A1628"><strong>${esc((d.action_type||'').replace(/_/g,' '))}</strong> · ${esc(d.campaign_name || '?')} <span style="color:#6B7280;font-size:0.74rem">(${esc(d.platform || '?')})</span>${tag}</div>
                    <div style="font-size:0.78rem;color:#4B5563;margin-top:3px">${esc(d.reason || '')}</div>
                    ${beforeAfter}
                    ${d.apply_error ? `<div style="font-size:0.74rem;color:#DC2626;margin-top:3px">⚠ ${esc(d.apply_error)}</div>` : ''}
                    <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">${when}${d.run_id ? ` · run ${esc(d.run_id)}` : ''}</div>
                  </div>
                </div>`;
              }).join('')}</div>`}
        </div>
      `;
    } catch (e) {
      section.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:14px;border-radius:10px;margin-top:18px">Failed to load decision log: ${esc(e.message)}</div>`;
    }
  };
})();

// ========================================================================
// T34 — Day-part / Hour-of-day Budget Shifting
// Renders a 24-hour bar chart per campaign with best/worst hour callouts
// and the recommendation string. Pure inline-SVG bars (no Chart.js dep).
// ========================================================================
(function () {
  const _prevRender = window.renderOptimizerDashboard;
  if (!_prevRender) return;
  window.renderOptimizerDashboard = async function () {
    await _prevRender();
    const wrap = document.getElementById('optimizerWrap');
    if (!wrap) return;
    const section = document.createElement('div');
    section.id = 't34DaypartingSection';
    section.innerHTML = `<div style="text-align:center;padding:30px;color:#6B7280">Loading dayparting analysis…</div>`;
    wrap.appendChild(section);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    const fmtHour = (h) => { const ap = h < 12 ? 'a' : 'p'; const h12 = (h % 12) || 12; return h12 + ap; };
    try {
      const j = await fetch('/api/optimizer/dayparting?limit=50').then(r => r.json());
      const items = j.items || [];
      section.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-top:18px">
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0 0 4px;font-size:1.05rem;color:#0A1628">🕐 Day-part Budget Shifting <span style="font-size:0.72rem;color:#6B7280;font-weight:500">— hour-of-day performance</span></h3>
              <div style="font-size:0.72rem;color:#6B7280">14-day rolling window · scored by ROAS → CPA → CTR (in that order) · UTC hours</div>
            </div>
            <button onclick="t34DaypartRunNow()" style="padding:9px 14px;background:linear-gradient(135deg,#0EA5E9,#6366F1);color:white;border:none;border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">🔄 Re-analyse now</button>
          </div>
          <p style="margin:0 0 14px;color:#6B7280;font-size:0.82rem;line-height:1.55">Recommendation only — surfaces the top 4 and bottom 4 hour-of-day windows so you can apply a day-parting schedule in your ad platform.</p>
          ${items.length === 0
            ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No dayparting analysis yet. Click "Re-analyse now" — needs at least one optimizer-enabled campaign with ≥$25 spend in the last 14 days.</div>`
            : `<div style="display:flex;flex-direction:column;gap:18px">${items.map(it => {
                let hours = it.hours_json; if (typeof hours === 'string') { try { hours = JSON.parse(hours); } catch (_) { hours = []; } }
                hours = hours || [];
                const scores = hours.map(h => h.score).filter(s => s !== null && s !== undefined);
                const min = scores.length ? Math.min(...scores) : 0;
                const max = scores.length ? Math.max(...scores) : 1;
                const range = (max - min) || 1;
                const bars = hours.map(h => {
                  const has = h.score !== null && h.score !== undefined;
                  const pct = has ? Math.max(2, Math.round(((h.score - min) / range) * 100)) : 2;
                  const color = !has ? '#E5E7EB' : (h.score >= max - range * 0.25 ? '#10B981' : h.score <= min + range * 0.25 ? '#EF4444' : '#94A3B8');
                  const tt = `${fmtHour(h.hour)} · spend ${(h.spend||0).toFixed(2)} · ${h.roas != null ? 'ROAS ' + h.roas + '×' : (h.cpa != null ? 'CPA $' + h.cpa : 'CTR ' + ((h.ctr||0)*100).toFixed(2) + '%')}`;
                  return `<div title="${esc(tt)}" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px"><div style="width:100%;height:${pct}px;background:${color};border-radius:3px 3px 0 0;min-height:2px"></div><div style="font-size:0.55rem;color:#94A3B8">${h.hour}</div></div>`;
                }).join('');
                return `<div style="border:1px solid #E5E7EB;border-radius:10px;padding:14px">
                  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">
                    <div>
                      <div style="font-size:0.9rem;font-weight:700;color:#0A1628">${esc(it.campaign_name || 'Campaign #' + it.campaign_id)} <span style="color:#6B7280;font-size:0.74rem;font-weight:500">(${esc(it.platform || '?')})</span></div>
                      <div style="font-size:0.7rem;color:#94A3B8;margin-top:2px">Window ${it.window_days}d · spend $${Number(it.total_spend||0).toFixed(2)} · conv ${Number(it.total_conv||0).toFixed(0)}</div>
                    </div>
                    <div style="font-size:0.66rem;color:#94A3B8">${new Date(it.created_at).toLocaleString()}</div>
                  </div>
                  <div style="display:flex;align-items:flex-end;gap:2px;height:110px;background:#F9FAFB;border-radius:6px;padding:8px;margin-bottom:10px">${bars}</div>
                  <div style="font-size:0.78rem;color:#4B5563;line-height:1.55">${esc(it.recommendation || '')}</div>
                </div>`;
              }).join('')}</div>`}
        </div>`;
    } catch (e) {
      section.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:14px;border-radius:10px;margin-top:18px">Failed to load dayparting: ${esc(e.message)}</div>`;
    }
  };
})();
window.t34DaypartRunNow = async function () {
  showToast('⏳ Re-analysing hour-of-day performance…');
  const r = await fetch('/api/optimizer/dayparting/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
  const s = r.run || {};
  showToast(`✅ Done — analysed ${s.evaluated || 0} campaign(s)`);
  renderOptimizerDashboard();
};

// ========================================================================
// T34 — Predictive Creative Fatigue
// Surfaces creatives whose CTR trend predicts they'll cross the 0.5% floor
// within 3 days. Pairs with the existing 72-hour Creative Auto-Refresh —
// this is the early-warning layer that catches fatigue BEFORE it hits.
// ========================================================================
(function () {
  const _prevRender = window.renderOptimizerDashboard;
  if (!_prevRender) return;
  window.renderOptimizerDashboard = async function () {
    await _prevRender();
    const wrap = document.getElementById('optimizerWrap');
    if (!wrap) return;
    const section = document.createElement('div');
    section.id = 't34FatigueSection';
    section.innerHTML = `<div style="text-align:center;padding:30px;color:#6B7280">Loading fatigue forecast…</div>`;
    wrap.appendChild(section);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    try {
      const j = await fetch('/api/optimizer/fatigue-forecast?limit=100').then(r => r.json());
      const items = j.items || [];
      const flagged = items.filter(x => x.predicted_fatigue);
      const stable  = items.filter(x => !x.predicted_fatigue);
      section.innerHTML = `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px 22px;margin-top:18px;margin-bottom:24px">
          <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;margin-bottom:14px">
            <div>
              <h3 style="margin:0 0 4px;font-size:1.05rem;color:#0A1628">📉 Predictive Creative Fatigue <span style="font-size:0.72rem;color:#6B7280;font-weight:500">— refresh BEFORE performance craters</span></h3>
              <div style="display:flex;gap:8px;margin-top:4px">
                <span style="background:${flagged.length ? '#FEE2E2' : '#F3F4F6'};color:${flagged.length ? '#991B1B' : '#6B7280'};padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">${flagged.length} predicted fatigue</span>
                <span style="background:#ECFDF5;color:#065F46;padding:4px 11px;border-radius:14px;font-size:0.72rem;font-weight:700">${stable.length} stable / improving</span>
              </div>
            </div>
            <button onclick="t34FatigueRunNow()" style="padding:9px 14px;background:linear-gradient(135deg,#F59E0B,#EF4444);color:white;border:none;border-radius:9px;font-size:0.78rem;font-weight:700;cursor:pointer">🔄 Re-forecast now</button>
          </div>
          <p style="margin:0 0 14px;color:#6B7280;font-size:0.82rem;line-height:1.55">Linear regression on each creative's daily CTR over 14 days. If the slope is negative AND projected CTR drops below 0.5% within 3 days → flagged so you (or the 72-hour Creative Auto-Refresh) can swap it out before performance actually craters.</p>
          ${items.length === 0
            ? `<div style="padding:30px;text-align:center;color:#6B7280;background:#F9FAFB;border-radius:10px">No forecasts yet. Click "Re-forecast now" — needs active creatives under optimizer-enabled campaigns with ≥5 days of impressions data.</div>`
            : `<div style="display:flex;flex-direction:column;gap:8px">${[...flagged, ...stable].slice(0, 30).map(it => {
                const color = it.predicted_fatigue ? '#DC2626' : (it.slope_per_day < 0 ? '#F59E0B' : '#10B981');
                const icon  = it.predicted_fatigue ? '🔥' : (it.slope_per_day < 0 ? '⚠️' : '✓');
                const when  = new Date(it.created_at).toLocaleString();
                const ctrNow  = it.current_ctr  != null ? (Number(it.current_ctr)  * 100).toFixed(2) + '%' : '—';
                const ctrProj = it.projected_ctr_3d != null ? (Number(it.projected_ctr_3d) * 100).toFixed(2) + '%' : '—';
                const slope = it.slope_per_day != null ? (Number(it.slope_per_day) * 1000).toFixed(2) + '‰/day' : '—';
                return `<div style="display:flex;gap:12px;padding:12px 14px;border-left:3px solid ${color};background:#FAFBFC;border-radius:6px">
                  <div style="font-size:1.3rem">${icon}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:0.84rem;color:#0A1628"><strong>${esc(it.headline || it.platform_ad_id || ('Creative #' + it.creative_id))}</strong> <span style="color:#6B7280;font-size:0.74rem">${esc(it.campaign_name || '?')} (${esc(it.platform || '?')})</span></div>
                    <div style="font-size:0.78rem;color:#4B5563;margin-top:3px">${esc(it.reason || '')}</div>
                    <div style="font-size:0.72rem;color:#64748B;margin-top:4px">CTR now <b>${ctrNow}</b> → projected <b>${ctrProj}</b> in 3d · slope ${slope} · ${it.samples} day(s) of data${it.days_until_floor != null ? ' · floor in ~' + Number(it.days_until_floor).toFixed(1) + 'd' : ''}</div>
                    <div style="font-size:0.7rem;color:#9CA3AF;margin-top:4px">${when}</div>
                  </div>
                </div>`;
              }).join('')}</div>`}
        </div>`;
    } catch (e) {
      section.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;padding:14px;border-radius:10px;margin-top:18px">Failed to load fatigue forecast: ${esc(e.message)}</div>`;
    }
  };
})();
window.t34FatigueRunNow = async function () {
  showToast('⏳ Forecasting CTR trends — may take 10-30 seconds…');
  const r = await fetch('/api/optimizer/fatigue-forecast/run-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(x => x.json());
  const s = r.run || {};
  showToast(`✅ Done — evaluated ${s.evaluated || 0} creative(s), flagged ${s.flagged || 0}`);
  renderOptimizerDashboard();
};

  // ── Public entry points + inline-onclick targets re-exported to window ─────
  // (These were top-level function declarations in app.js, i.e. implicitly
  //  global; the IIFE now scopes them, so re-export to preserve behaviour.)
  Object.assign(window, {
    buildMentionTracker, runMentionTracker, renderMentionResults,
    loadAlertsList, updateAlertsBellBadge, toggleAlertsPanel, renderAlertsPanel,
    _relativeTimeShort, checkAlertsNow, markAllAlertsRead, checkCreditsNow,
    buildContentGaps, runContentGaps, renderContentGaps,
    buildCrossChannel, runCrossChannel, renderCrossChannel,
    buildStakeholders, _renderStakeholders, addStakeholder, removeStakeholder,
    testStakeholderEmail,
    _loadWebhooks, _webhookTypeMeta, _renderWebhooks, _whkTypeChanged,
    addWebhook, removeWebhook, toggleWebhook, testWebhook,
    buildLaunches, _formatCountdown, _renderLaunches, addLaunch, removeLaunch,
    showCompanyIntel, runCompanyIntel, testSlackWebhook,
    renderAdPlatformConnections, showAdPlatformSetup, renderOptimizerDashboard,
  });
})();

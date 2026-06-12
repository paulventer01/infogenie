/* ig_intelligence_tools.js — T73-T80: Change Monitor, Web Extractor, Recipe Scraper,
   Dataset Market, Resilient Tracker, Conversion Recovery, Lead Aggregator, Model Compare */

// ─── Shared helpers ───────────────────────────────────────────────────────────
function _igItEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _igItApi(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(path, opts).then(r => r.json());
}

function _igItSpinner(msg) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:32px 0;color:#6B7280">
    <div style="width:20px;height:20px;border:2px solid #E5E7EB;border-top-color:#6366F1;border-radius:50%;animation:spin 0.8s linear infinite"></div>
    <span>${_igItEsc(msg)}</span>
  </div>`;
}

function _igItCard(content, extra) {
  return `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:24px;margin-bottom:16px${extra ? ';'+extra : ''}">${content}</div>`;
}

function _igItTable(columns, rows) {
  if (!rows || !rows.length) return '<p style="color:#6B7280;font-size:14px">No data found.</p>';
  const hdrs = columns.map(c => `<th style="padding:10px 12px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;text-align:left;font-size:12px;text-transform:uppercase;color:#6B7280;white-space:nowrap">${_igItEsc(c)}</th>`).join('');
  const rws = rows.map(r => {
    const cells = columns.map(c => `<td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;font-size:13px;color:#111827;max-width:280px;word-break:break-word">${_igItEsc(r[c] ?? '')}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<div style="overflow-x:auto;border-radius:8px;border:1px solid #E5E7EB"><table style="width:100%;border-collapse:collapse"><thead><tr>${hdrs}</tr></thead><tbody>${rws}</tbody></table></div>`;
}

function _igItBadge(label, color) {
  const map = { green:'#D1FAE5;color:#065F46', blue:'#DBEAFE;color:#1E40AF', orange:'#FEF3C7;color:#92400E', red:'#FEE2E2;color:#991B1B', purple:'#EDE9FE;color:#5B21B6', gray:'#F3F4F6;color:#374151' };
  const style = map[color] || map.gray;
  return `<span style="background:${style.split(';')[0].replace('background:','')};${style.split(';')[1]};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">${_igItEsc(label)}</span>`;
}

// ─── T73: Change Monitor ───────────────────────────────────────────────────────
window.buildChangeMonitor = function() {
  const wrap = document.getElementById('changeMonitorWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Competitor URL to Watch</label>
        <input id="cmUrl" type="url" placeholder="https://competitor.com/pricing" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Label</label>
        <input id="cmLabel" placeholder="Competitor Pricing Page" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
    </div>
    <div style="display:flex;gap:12px;margin-bottom:28px;align-items:center">
      <label style="font-size:13px;color:#374151"><input type="checkbox" id="cmEmail" checked style="margin-right:6px">Email alerts</label>
      <label style="font-size:13px;color:#374151"><input type="checkbox" id="cmSlack" style="margin-right:6px">Slack alerts</label>
      <select id="cmInterval" style="padding:8px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px">
        <option value="1">Check every hour</option>
        <option value="6" selected>Check every 6 hours</option>
        <option value="12">Check every 12 hours</option>
        <option value="24">Check every 24 hours</option>
      </select>
      <button onclick="window._cmAddWatch()" style="padding:10px 20px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">+ Add Watch</button>
    </div>
    <div id="cmList"></div>`;

  window._cmLoad = async function() {
    const el = document.getElementById('cmList');
    el.innerHTML = _igItSpinner('Loading watches…');
    const d = await _igItApi('GET', '/api/change-monitor/watches');
    if (!d.ok || !d.watches.length) { el.innerHTML = _igItCard('<p style="color:#6B7280;text-align:center;margin:0">No watches yet. Add a competitor URL above to get started.</p>'); return; }
    el.innerHTML = d.watches.map(w => {
      const statusColor = w.status === 'active' ? 'green' : 'gray';
      const since = w.last_changed ? new Date(w.last_changed).toLocaleDateString() : 'Never';
      return _igItCard(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              ${_igItBadge(w.status, statusColor)}
              <strong style="font-size:15px;color:#111827">${_igItEsc(w.label||w.url)}</strong>
            </div>
            <div style="font-size:12px;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_igItEsc(w.url)}</div>
            <div style="font-size:12px;color:#9CA3AF;margin-top:4px">
              ${w.diff_count > 0 ? `<strong style="color:#EF4444">${w.diff_count} change${w.diff_count>1?'s':''} detected</strong> · ` : 'No changes detected · '}
              Last changed: ${since} · Checked every ${w.check_interval_hours}h
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button onclick="window._cmCheck(${w.id})" style="padding:7px 14px;background:#F0FDF4;color:#166534;border:1px solid #BBF7D0;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">▶ Check Now</button>
            <button onclick="window._cmDiffs(${w.id},'${_igItEsc(w.label||w.url)}')" style="padding:7px 14px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">📋 Diffs</button>
            <button onclick="window._cmPause(${w.id},'${w.status}')" style="padding:7px 14px;background:#F9FAFB;color:#374151;border:1px solid #E5E7EB;border-radius:7px;font-size:12px;cursor:pointer">${w.status==='active'?'⏸ Pause':'▶ Resume'}</button>
            <button onclick="window._cmDelete(${w.id})" style="padding:7px 14px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:7px;font-size:12px;cursor:pointer">🗑</button>
          </div>
        </div>
        <div id="cmResult-${w.id}" style="margin-top:12px"></div>`);
    }).join('');
  };

  window._cmAddWatch = async function() {
    const url = document.getElementById('cmUrl').value.trim();
    const label = document.getElementById('cmLabel').value.trim();
    const hrs = document.getElementById('cmInterval').value;
    const email = document.getElementById('cmEmail').checked;
    const slack = document.getElementById('cmSlack').checked;
    if (!url) return alert('Please enter a URL');
    const d = await _igItApi('POST', '/api/change-monitor/watches', { url, label, check_interval_hours: Number(hrs), alert_email: email, alert_slack: slack });
    if (!d.ok) return alert(d.error || 'Failed to add watch');
    document.getElementById('cmUrl').value = '';
    document.getElementById('cmLabel').value = '';
    window._cmLoad();
  };

  window._cmCheck = async function(id) {
    const el = document.getElementById('cmResult-'+id);
    if (el) el.innerHTML = _igItSpinner('Fetching page and comparing…');
    const d = await _igItApi('POST', `/api/change-monitor/check/${id}`);
    if (!d.ok) { if (el) el.innerHTML = `<div style="color:#DC2626;font-size:13px;padding:8px;background:#FEF2F2;border-radius:6px">${_igItEsc(d.error||'Check failed')}</div>`; return; }
    if (d.first_check) {
      if (el) el.innerHTML = `<div style="color:#065F46;font-size:13px;padding:8px;background:#D1FAE5;border-radius:6px">✅ Baseline captured. Future checks will detect changes from this snapshot.</div>`;
    } else if (d.changed && d.diff) {
      const sev = { high:'red', medium:'orange', low:'green' }[d.diff.severity] || 'gray';
      if (el) el.innerHTML = `<div style="background:#FEF3C7;border-radius:8px;padding:14px;border-left:3px solid #F59E0B">
        <div style="display:flex;gap:8px;margin-bottom:8px">${_igItBadge('CHANGED','orange')} ${_igItBadge(d.diff.severity+' severity',sev)} ${_igItBadge(d.diff.change_type||'other','blue')}</div>
        <div style="font-size:13px;color:#111827;margin-bottom:6px"><strong>What changed:</strong> ${_igItEsc(d.diff.diff_summary)}</div>
        <div style="font-size:13px;color:#374151"><strong>Strategic insight:</strong> ${_igItEsc(d.diff.strategic_insight)}</div>
      </div>`;
    } else {
      if (el) el.innerHTML = `<div style="color:#374151;font-size:13px;padding:8px;background:#F9FAFB;border-radius:6px">✓ No significant changes detected (${d.pct_change||0}% word delta).</div>`;
    }
    window._cmLoad();
  };

  window._cmPause = async function(id) {
    await _igItApi('POST', `/api/change-monitor/watches/${id}/pause`);
    window._cmLoad();
  };

  window._cmDelete = async function(id) {
    if (!confirm('Remove this watch?')) return;
    await _igItApi('DELETE', `/api/change-monitor/watches/${id}`);
    window._cmLoad();
  };

  window._cmDiffs = async function(id, label) {
    const d = await _igItApi('GET', `/api/change-monitor/diffs/${id}`);
    const modal = document.createElement('div');
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px';
    const items = (!d.ok || !d.diffs.length) ? '<p style="color:#6B7280">No changes detected yet.</p>' : d.diffs.map(df => `<div style="border:1px solid #E5E7EB;border-radius:8px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;color:#9CA3AF;margin-bottom:6px">${new Date(df.detected_at).toLocaleString()}</div>
      <div style="font-size:13px;color:#111827;margin-bottom:4px"><strong>Change:</strong> ${_igItEsc(df.diff_summary)}</div>
      <div style="font-size:13px;color:#374151"><strong>Insight:</strong> ${_igItEsc(df.strategic_insight)}</div>
    </div>`).join('');
    modal.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px;max-width:700px;width:100%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="margin:0;font-size:18px">Change History — ${_igItEsc(label)}</h3>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:#F3F4F6;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:18px">×</button>
      </div>${items}</div>`;
    document.body.appendChild(modal);
  };

  window._cmLoad();
};

// ─── T75: AI Web Extractor ────────────────────────────────────────────────────
window.buildWebExtractor = function() {
  const wrap = document.getElementById('webExtractorWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';

  const examples = ['Extract all product names, prices, and descriptions', 'Get the names and LinkedIn URLs of all team members', 'Extract every FAQ question and answer', 'List all integration partners with their logos and links', 'Get all customer testimonials with name, company, and quote'];

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Target URL</label>
        <input id="wxUrl" type="url" placeholder="https://example.com/pricing" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">What to Extract (plain English)</label>
        <input id="wxInstruction" placeholder="Extract all pricing tiers with their names and prices" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
    </div>
    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:#6B7280;margin-bottom:8px">EXAMPLE PROMPTS</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${examples.map(e=>`<button onclick="document.getElementById('wxInstruction').value='${e}'" style="padding:6px 12px;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:20px;font-size:12px;cursor:pointer;color:#374151">${e}</button>`).join('')}
      </div>
    </div>
    <button onclick="window._wxRun()" style="padding:11px 28px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:24px">🧲 Extract Data</button>
    <div id="wxResult"></div>`;

  window._wxRun = async function() {
    const url = document.getElementById('wxUrl').value.trim();
    const inst = document.getElementById('wxInstruction').value.trim();
    const el = document.getElementById('wxResult');
    if (!url || !inst) return alert('Please enter a URL and extraction instruction');
    el.innerHTML = _igItSpinner('Fetching page and extracting data with AI…');
    const d = await _igItApi('POST', '/api/web-extractor/extract', { url, instruction: inst });
    if (!d.ok) { el.innerHTML = _igItCard(`<p style="color:#DC2626;margin:0">⚠️ ${_igItEsc(d.error||'Extraction failed')}</p>`); return; }
    el.innerHTML = _igItCard(`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:4px">Extraction Results</div>
          <div style="font-size:13px;color:#6B7280">${_igItEsc(d.summary)}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${_igItBadge(`${d.total_found} rows found`, 'green')}
          ${_igItBadge(d.source==='openai'?'AI':'Template','blue')}
        </div>
      </div>
      ${_igItTable(d.columns||[], d.rows||[])}`);
  };
};

// ─── T76: Recipe Scraper Library ─────────────────────────────────────────────
window.buildRecipeScraper = function() {
  const wrap = document.getElementById('recipeScraperWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = _igItSpinner('Loading recipes…');

  _igItApi('GET', '/api/recipe-scraper/recipes').then(d => {
    if (!d.ok) { wrap.innerHTML = _igItCard('<p style="color:#DC2626">Failed to load recipes</p>'); return; }
    const cards = d.recipes.map(r => `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:12px">
        <div>
          <div style="font-size:24px;margin-bottom:8px">${r.icon}</div>
          <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px">${_igItEsc(r.label)}</div>
          <div style="font-size:12px;color:#6B7280;margin-bottom:8px">${_igItEsc(r.description)}</div>
          <div style="font-size:11px;color:#9CA3AF">Source: ${_igItEsc(r.source)}</div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:600;color:#6B7280;margin-bottom:6px">EXTRACTED FIELDS</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${(r.fields||[]).map(f=>`<span style="background:#F3F4F6;color:#374151;padding:2px 7px;border-radius:10px;font-size:11px">${_igItEsc(f)}</span>`).join('')}</div>
        </div>
        <div style="margin-top:auto">
          <input id="rsUrl-${r.id}" placeholder="Paste target URL here…" style="width:100%;padding:8px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box;margin-bottom:8px">
          <button onclick="window._rsRun('${r.id}')" style="width:100%;padding:9px;background:#6366F1;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Run Recipe →</button>
          <div id="rsResult-${r.id}" style="margin-top:10px"></div>
        </div>
      </div>`).join('');
    wrap.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">${cards}</div>`;
  });

  window._rsRun = async function(id) {
    const urlEl = document.getElementById('rsUrl-'+id);
    const el = document.getElementById('rsResult-'+id);
    const url = urlEl?.value.trim();
    if (!url) return alert('Please paste a target URL');
    el.innerHTML = _igItSpinner('Fetching and extracting…');
    const d = await _igItApi('POST', '/api/recipe-scraper/run', { recipe_id: id, target_url: url });
    if (!d.ok) { el.innerHTML = `<div style="color:#DC2626;font-size:13px">${_igItEsc(d.error||'Extraction failed')}</div>`; return; }
    el.innerHTML = `<div style="font-size:12px;color:#6B7280;margin-bottom:8px">${_igItEsc(d.summary)} · ${d.total_found} rows</div>${_igItTable(d.columns||[],d.rows||[])}`;
  };
};

// ─── T78: Dataset Marketplace ─────────────────────────────────────────────────
window.buildDatasetMarket = function() {
  const wrap = document.getElementById('datasetMarketWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = _igItSpinner('Loading dataset packs…');

  _igItApi('GET', '/api/dataset-market/packs').then(d => {
    if (!d.ok) { wrap.innerHTML = _igItCard('<p style="color:#DC2626">Failed to load packs</p>'); return; }

    const controls = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Industry</label>
        <input id="dmIndustry" placeholder="e.g. SaaS, FinTech, eCommerce" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Region</label>
        <input id="dmRegion" placeholder="e.g. Global, US, Europe" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Key Competitors (comma-sep)</label>
        <input id="dmCompetitors" placeholder="Salesforce, HubSpot, Pipedrive" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
    </div>`;

    const cards = d.packs.map(p => `
      <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px">
        <div style="font-size:28px;margin-bottom:10px">${p.icon}</div>
        <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px">${_igItEsc(p.label)}</div>
        <div style="font-size:13px;color:#6B7280;margin-bottom:12px">${_igItEsc(p.description)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:14px">${(p.fields||[]).map(f=>`<span style="background:#EDE9FE;color:#5B21B6;padding:2px 7px;border-radius:10px;font-size:11px">${_igItEsc(f)}</span>`).join('')}</div>
        <button onclick="window._dmGenerate('${p.id}')" style="width:100%;padding:9px;background:#6366F1;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer">Generate Dataset →</button>
        <div id="dmResult-${p.id}" style="margin-top:12px"></div>
      </div>`).join('');

    wrap.innerHTML = controls + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">${cards}</div>`;
  });

  window._dmGenerate = async function(packId) {
    const industry = document.getElementById('dmIndustry')?.value.trim() || 'SaaS';
    const region = document.getElementById('dmRegion')?.value.trim() || 'Global';
    const compStr = document.getElementById('dmCompetitors')?.value.trim() || '';
    const competitors = compStr ? compStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const el = document.getElementById('dmResult-'+packId);
    el.innerHTML = _igItSpinner('Generating dataset with AI — this takes 20-30s…');
    const d = await _igItApi('POST', '/api/dataset-market/generate', { pack_id: packId, industry, region, competitors });
    if (!d.ok) { el.innerHTML = `<div style="color:#DC2626;font-size:13px">${_igItEsc(d.error||'Generation failed')}</div>`; return; }
    const takeaways = (d.key_takeaways||[]).map(t=>`<li style="font-size:13px;color:#374151;margin-bottom:4px">${_igItEsc(t)}</li>`).join('');
    el.innerHTML = `<div style="margin-bottom:12px">
      <div style="font-weight:700;font-size:14px;color:#111827;margin-bottom:2px">${_igItEsc(d.title||'')}</div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:10px">${_igItEsc(d.subtitle||'')} · ${d.rows?.length||0} rows</div>
      ${takeaways ? `<ul style="margin:0 0 12px 0;padding-left:18px">${takeaways}</ul>` : ''}
    </div>${_igItTable(d.columns||[], d.rows||[])}
    <div style="font-size:11px;color:#9CA3AF;margin-top:8px">${_igItEsc(d.disclaimer||'')}</div>`;
  };
};

// ─── T80: Resilient Tracker ───────────────────────────────────────────────────
window.buildResilientTracker = function() {
  const wrap = document.getElementById('resilientTrackerWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">URL to Track</label>
        <input id="rtUrl" type="url" placeholder="https://competitor.com/pricing" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
      <div>
        <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Label</label>
        <input id="rtLabel" placeholder="Competitor Pricing" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:14px;box-sizing:border-box">
      </div>
    </div>
    <div style="margin-bottom:16px">
      <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Data Points to Track (one per line: key|description)</label>
      <textarea id="rtDataPoints" rows="4" placeholder="starter_price|The monthly price of the Starter plan\nteam_size|Number of employees on the About page\ncta_text|The main hero CTA button text" style="width:100%;padding:10px 14px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px;box-sizing:border-box;font-family:monospace"></textarea>
    </div>
    <button onclick="window._rtAdd()" style="padding:10px 20px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:24px">+ Add Tracker</button>
    <div id="rtList"></div>`;

  window._rtLoad = async function() {
    const el = document.getElementById('rtList');
    el.innerHTML = _igItSpinner('Loading trackers…');
    const d = await _igItApi('GET', '/api/resilient-tracker/trackers');
    if (!d.ok || !d.trackers.length) { el.innerHTML = _igItCard('<p style="color:#6B7280;text-align:center;margin:0">No trackers yet. Add a URL and data points above.</p>'); return; }
    el.innerHTML = d.trackers.map(t => {
      const dp = Array.isArray(t.data_points) ? t.data_points : (typeof t.data_points==='string'?JSON.parse(t.data_points||'[]'):[]);
      const lastData = typeof t.last_data==='string' ? JSON.parse(t.last_data||'{}') : (t.last_data||{});
      const dataRows = dp.length ? dp.map(p=>`<tr><td style="padding:6px 10px;font-size:13px;font-weight:600;color:#374151;border-bottom:1px solid #F3F4F6">${_igItEsc(p.key)}</td><td style="padding:6px 10px;font-size:13px;color:#111827;border-bottom:1px solid #F3F4F6">${_igItEsc(lastData[p.key]||'—')}</td><td style="padding:6px 10px;font-size:12px;color:#6B7280;border-bottom:1px solid #F3F4F6">${_igItEsc(p.description)}</td></tr>`).join('') : '';
      return _igItCard(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div>
            <strong style="font-size:15px;color:#111827">${_igItEsc(t.label||t.url)}</strong>
            <div style="font-size:12px;color:#6B7280">${_igItEsc(t.url)} · Method: ${_igItEsc(t.last_method||'not checked yet')} · Failures: ${t.consecutive_failures||0}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button onclick="window._rtCheck(${t.id})" style="padding:7px 14px;background:#F0FDF4;color:#166534;border:1px solid #BBF7D0;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer">▶ Check Now</button>
            <button onclick="window._rtSnapshots(${t.id},'${_igItEsc(t.label||t.url)}')" style="padding:7px 14px;background:#EFF6FF;color:#1D4ED8;border:1px solid #BFDBFE;border-radius:7px;font-size:12px;cursor:pointer">📊 History</button>
            <button onclick="window._rtDelete(${t.id})" style="padding:7px 14px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:7px;font-size:12px;cursor:pointer">🗑</button>
          </div>
        </div>
        ${dp.length ? `<table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
          <thead><tr><th style="padding:7px 10px;background:#F9FAFB;text-align:left;font-size:11px;color:#6B7280;border-bottom:1px solid #E5E7EB">KEY</th><th style="padding:7px 10px;background:#F9FAFB;text-align:left;font-size:11px;color:#6B7280;border-bottom:1px solid #E5E7EB">LAST VALUE</th><th style="padding:7px 10px;background:#F9FAFB;text-align:left;font-size:11px;color:#6B7280;border-bottom:1px solid #E5E7EB">DESCRIPTION</th></tr></thead>
          <tbody>${dataRows}</tbody></table>` : '<p style="font-size:13px;color:#9CA3AF;margin:0">No data points configured.</p>'}
        <div id="rtResult-${t.id}" style="margin-top:10px"></div>`);
    }).join('');
  };

  window._rtAdd = async function() {
    const url = document.getElementById('rtUrl').value.trim();
    const label = document.getElementById('rtLabel').value.trim();
    const raw = document.getElementById('rtDataPoints').value.trim();
    if (!url) return alert('Please enter a URL');
    const data_points = raw ? raw.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const [key,...rest]=l.split('|'); return { key:(key||'').trim(), description:(rest.join('|')||'').trim() }; }).filter(p=>p.key) : [];
    const d = await _igItApi('POST', '/api/resilient-tracker/trackers', { url, label, data_points });
    if (!d.ok) return alert(d.error||'Failed to add tracker');
    document.getElementById('rtUrl').value = '';
    document.getElementById('rtLabel').value = '';
    document.getElementById('rtDataPoints').value = '';
    window._rtLoad();
  };

  window._rtCheck = async function(id) {
    const el = document.getElementById('rtResult-'+id);
    if (el) el.innerHTML = _igItSpinner('Running resilient extraction (auto-heals if primary method fails)…');
    const d = await _igItApi('POST', `/api/resilient-tracker/check/${id}`);
    if (!d.ok) { if (el) el.innerHTML = `<div style="color:#DC2626;font-size:13px;padding:8px;background:#FEF2F2;border-radius:6px">${_igItEsc(d.error||'Check failed')}</div>`; return; }
    if (el) el.innerHTML = `<div style="color:#065F46;font-size:13px;padding:8px;background:#D1FAE5;border-radius:6px">✅ Data updated via <strong>${_igItEsc(d.method)}</strong></div>`;
    setTimeout(()=>window._rtLoad(), 800);
  };

  window._rtDelete = async function(id) {
    if (!confirm('Remove this tracker?')) return;
    await _igItApi('DELETE', `/api/resilient-tracker/trackers/${id}`);
    window._rtLoad();
  };

  window._rtSnapshots = async function(id, label) {
    const d = await _igItApi('GET', `/api/resilient-tracker/snapshots/${id}`);
    const modal = document.createElement('div');
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px';
    const items = (!d.ok||!d.snapshots.length) ? '<p style="color:#6B7280">No snapshots yet.</p>' : d.snapshots.map(s=>{
      const data = typeof s.data==='string'?JSON.parse(s.data||'{}'):(s.data||{});
      const rows = Object.entries(data).map(([k,v])=>`<tr><td style="padding:5px 10px;font-size:13px;font-weight:600;color:#374151;border-bottom:1px solid #F3F4F6">${_igItEsc(k)}</td><td style="padding:5px 10px;font-size:13px;color:#111827;border-bottom:1px solid #F3F4F6">${_igItEsc(String(v))}</td></tr>`).join('');
      return `<div style="border:1px solid #E5E7EB;border-radius:8px;margin-bottom:12px;overflow:hidden">
        <div style="background:#F9FAFB;padding:8px 12px;font-size:12px;color:#6B7280;display:flex;justify-content:space-between">
          <span>${new Date(s.created_at).toLocaleString()}</span>
          <span>Method: ${_igItEsc(s.method||'unknown')}</span>
        </div>
        <table style="width:100%;border-collapse:collapse"><tbody>${rows||'<tr><td style="padding:10px;color:#9CA3AF;font-size:13px">No data</td></tr>'}</tbody></table>
      </div>`;
    }).join('');
    modal.innerHTML = `<div style="background:#fff;border-radius:16px;padding:28px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="margin:0">Snapshot History — ${_igItEsc(label)}</h3>
        <button onclick="this.closest('div[style*=fixed]').remove()" style="background:#F3F4F6;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:18px">×</button>
      </div>${items}</div>`;
    document.body.appendChild(modal);
  };

  window._rtLoad();
};

// ─── T74: Conversion Recovery ─────────────────────────────────────────────────
window.buildConversionRecovery = function() {
  const wrap = document.getElementById('convRecoveryWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px">
      ${_igItCard(`
        <h3 style="margin:0 0 16px;font-size:16px">📊 Recovery Score Calculator</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Primary Ad Platform</label>
            <select id="crPlatform" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="meta">Meta (Facebook / Instagram)</option>
              <option value="google">Google Ads</option>
              <option value="tiktok">TikTok Ads</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Current Pixel Type</label>
            <select id="crPixelType" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="client_side">Client-side pixel only</option>
              <option value="server_side">Server-side (CAPI/API) only</option>
              <option value="both">Both client + server</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Monthly Ad Spend ($)</label>
            <input id="crSpend" type="number" placeholder="10000" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Geo Targeting?</label>
            <select id="crBrowser" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="false">No browser targeting</option>
              <option value="true">Yes, browser/OS targeting</option>
            </select>
          </div>
        </div>
        <button onclick="window._crScore()" style="width:100%;padding:10px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Calculate Recovery Score</button>
        <div id="crScoreResult" style="margin-top:16px"></div>`)}
      ${_igItCard(`
        <h3 style="margin:0 0 16px;font-size:16px">🛠️ Server-Side Setup Guide</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Platform</label>
            <select id="crGuidePlatform" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="meta">Meta Conversions API</option>
              <option value="google">Google Enhanced Conversions</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Conversion Goal</label>
            <select id="crGoal" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="purchase">Purchase</option>
              <option value="lead">Lead / Form Submit</option>
              <option value="signup">Sign Up</option>
              <option value="add_to_cart">Add to Cart</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Your Platform</label>
            <select id="crBizPlatform" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="shopify">Shopify</option>
              <option value="woocommerce">WooCommerce</option>
              <option value="custom">Custom / Other</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Server Language</label>
            <select id="crLang" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              <option value="node">Node.js</option>
              <option value="python">Python</option>
              <option value="php">PHP</option>
            </select>
          </div>
        </div>
        <button onclick="window._crGuide()" style="width:100%;padding:10px;background:#059669;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Generate Setup Guide</button>
        <div id="crGuideResult" style="margin-top:16px"></div>`)}
    </div>`;

  window._crScore = async function() {
    const el = document.getElementById('crScoreResult');
    el.innerHTML = _igItSpinner('Calculating…');
    const d = await _igItApi('POST', '/api/conversion-recovery/score', {
      platform: document.getElementById('crPlatform').value,
      pixel_type: document.getElementById('crPixelType').value,
      monthly_ad_spend: Number(document.getElementById('crSpend').value)||0,
      browser_targeting: document.getElementById('crBrowser').value==='true'
    });
    if (!d.ok) { el.innerHTML = `<p style="color:#DC2626">${_igItEsc(d.error||'Failed')}</p>`; return; }
    const scoreColor = d.score>=80?'#059669':d.score>=60?'#D97706':'#DC2626';
    const breakdown = Object.entries(d.breakdown||{}).map(([k,v])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F3F4F6;font-size:13px"><span style="color:#6B7280">${k.replace(/_/g,' ')}</span><span style="color:#DC2626;font-weight:600">-${v}%</span></div>`).join('');
    el.innerHTML = `<div style="text-align:center;margin-bottom:16px">
      <div style="font-size:48px;font-weight:800;color:${scoreColor}">${d.score}</div>
      <div style="font-size:13px;color:#6B7280">Recovery Score (out of 100)</div>
    </div>
    <div style="background:#FEF3C7;border-radius:8px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#92400E">You're losing ~${d.total_loss_pct}% of conversions</div>
      <div style="font-size:13px;color:#92400E">~${d.recoverable_pct}% is recoverable with server-side tracking${d.monthly_missed_value?` (≈$${d.monthly_missed_value.toLocaleString()}/mo)`:''}</div>
    </div>
    ${breakdown}`;
  };

  window._crGuide = async function() {
    const el = document.getElementById('crGuideResult');
    el.innerHTML = _igItSpinner('Generating setup guide with AI — 15-30s…');
    const d = await _igItApi('POST', '/api/conversion-recovery/setup-guide', {
      platform: document.getElementById('crGuidePlatform').value,
      goal: document.getElementById('crGoal').value,
      business_platform: document.getElementById('crBizPlatform').value,
      server_lang: document.getElementById('crLang').value
    });
    if (!d.ok) { el.innerHTML = `<p style="color:#DC2626">${_igItEsc(d.error||'Failed')}</p>`; return; }
    const steps = (d.steps||[]).map(s=>`<div style="border:1px solid #E5E7EB;border-radius:8px;margin-bottom:10px;overflow:hidden">
      <div style="background:#F9FAFB;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <strong style="font-size:13px;color:#111827">Step ${s.step}: ${_igItEsc(s.title)}</strong>
        <span style="font-size:12px;color:#6B7280">${_igItEsc(s.time_estimate)}</span>
      </div>
      <div style="padding:12px 14px">
        <p style="margin:0 0 10px;font-size:13px;color:#374151">${_igItEsc(s.description)}</p>
        ${s.code?`<pre style="background:#1F2937;color:#F9FAFB;padding:14px;border-radius:7px;font-size:12px;overflow-x:auto;white-space:pre-wrap;margin:0">${_igItEsc(s.code)}</pre>`:''}
      </div>
    </div>`).join('');
    el.innerHTML = `<div style="font-size:13px;color:#374151;margin-bottom:12px">${_igItEsc(d.overview||'')}</div>
    ${steps}
    ${d.expected_recovery_pct?`<div style="background:#D1FAE5;border-radius:8px;padding:10px 14px;font-size:13px;color:#065F46"><strong>Expected recovery:</strong> ${d.expected_recovery_pct}% of lost conversions</div>`:''}
    ${d.docs_url?`<a href="${_igItEsc(d.docs_url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:10px;font-size:13px;color:#6366F1">📖 Official Docs →</a>`:''}`;
  };
};

// ─── T77: Lead Aggregator ─────────────────────────────────────────────────────
window.buildLeadAggregator = function() {
  const wrap = document.getElementById('leadAggregatorWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';

  wrap.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Industry</label>
        <input id="laIndustry" placeholder="SaaS, FinTech…" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Target Role</label>
        <input id="laRole" placeholder="VP Marketing, CMO…" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Location</label>
        <input id="laLocation" placeholder="United States, London…" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box"></div>
      <div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:5px">Company Size</label>
        <select id="laSize" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
          <option value="">Any</option>
          <option value="1-10">1-10</option>
          <option value="11-50">11-50</option>
          <option value="51-200">51-200</option>
          <option value="201-1000">201-1000</option>
          <option value="1000+">1000+</option>
        </select></div>
    </div>
    <div id="laSources" style="margin-bottom:16px"></div>
    <button onclick="window._laSweep()" style="padding:11px 28px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:24px">🌐 Sweep All Sources</button>
    <div id="laResult"></div>`;

  _igItApi('GET', '/api/lead-aggregator/sources').then(d => {
    if (!d.ok) return;
    document.getElementById('laSources').innerHTML = `<div style="font-size:12px;font-weight:600;color:#6B7280;margin-bottom:8px">ACTIVE SOURCES</div><div style="display:flex;gap:8px">${d.sources.map(s=>`<span style="padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;background:${s.available?'#D1FAE5':'#F3F4F6'};color:${s.available?'#065F46':'#9CA3AF'}">${s.available?'✓':'-'} ${_igItEsc(s.label)}</span>`).join('')}</div>`;
  });

  window._laSweep = async function() {
    const el = document.getElementById('laResult');
    el.innerHTML = _igItSpinner('Sweeping all sources — this takes 20-40 seconds…');
    const d = await _igItApi('POST', '/api/lead-aggregator/sweep', {
      industry: document.getElementById('laIndustry').value.trim(),
      role: document.getElementById('laRole').value.trim(),
      location: document.getElementById('laLocation').value.trim(),
      company_size: document.getElementById('laSize').value
    });
    if (!d.ok) { el.innerHTML = _igItCard(`<p style="color:#DC2626;margin:0">${_igItEsc(d.error||'Sweep failed')}</p>`); return; }
    const srcBadges = Object.entries(d.source_counts||{}).map(([s,c])=>`${_igItBadge(`${s}: ${c}`, 'blue')}`).join(' ');
    el.innerHTML = `<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
      ${_igItBadge(`${d.total} leads found`,'green')}
      ${_igItBadge(`${d.with_email} with email`,'purple')}
      ${_igItBadge(`${d.with_linkedin} with LinkedIn`,'blue')}
      ${srcBadges}
    </div>` + _igItTable(['name','title','company','location','email','linkedin_url','score','source'], d.leads||[]);
  };
};

// ─── T79: Model Compare ───────────────────────────────────────────────────────
window.buildModelCompare = function() {
  const wrap = document.getElementById('modelCompareWrap');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = _igItSpinner('Loading available models…');

  _igItApi('GET', '/api/model-compare/models').then(d => {
    if (!d.ok) { wrap.innerHTML = _igItCard('<p style="color:#DC2626">Failed to load models</p>'); return; }
    const available = d.models.filter(m=>m.available);
    const modelCheckboxes = d.models.map(m=>`
      <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid ${m.available?'#E5E7EB':'#F3F4F6'};border-radius:8px;cursor:${m.available?'pointer':'default'};background:${m.available?'#fff':'#F9FAFB'}">
        <input type="checkbox" name="mcModel" value="${m.id}" ${available.slice(0,3).some(a=>a.id===m.id)?'checked':''} ${m.available?'':'disabled'} style="width:15px;height:15px">
        <span style="flex:1">
          <span style="display:block;font-size:13px;font-weight:600;color:${m.available?'#111827':'#9CA3AF'}">${_igItEsc(m.label)}</span>
          <span style="font-size:11px;color:#9CA3AF">${_igItEsc(m.provider)}</span>
        </span>
        ${_igItBadge(m.available?'Available':'Not configured', m.available?'green':'gray')}
      </label>`).join('');

    const taskTypes = ['general','marketing copy','technical explanation','creative writing','analysis','customer email'];

    wrap.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div>
          <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px">Select Models to Compare</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${modelCheckboxes}</div>
        </div>
        <div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Task Type</label>
            <select id="mcTaskType" style="width:100%;padding:9px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px">
              ${taskTypes.map(t=>`<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">System Prompt (optional)</label>
            <textarea id="mcSystem" rows="2" placeholder="You are a helpful marketing expert." style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <div>
            <label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px">Prompt</label>
            <textarea id="mcPrompt" rows="5" placeholder="Write a cold email subject line for a B2B SaaS product targeting CMOs…" style="width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:7px;font-size:13px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <button onclick="window._mcRun()" style="margin-top:12px;width:100%;padding:11px;background:#6366F1;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">⚖️ Compare Models</button>
        </div>
      </div>
      <div id="mcResult"></div>`;
  });

  window._mcRun = async function() {
    const el = document.getElementById('mcResult');
    const selected = [...document.querySelectorAll('input[name="mcModel"]:checked')].map(cb=>cb.value);
    if (!selected.length) return alert('Please select at least one model');
    const prompt = document.getElementById('mcPrompt').value.trim();
    if (!prompt) return alert('Please enter a prompt');
    const system_prompt = document.getElementById('mcSystem').value.trim();
    const task_type = document.getElementById('mcTaskType').value;
    el.innerHTML = _igItSpinner(`Running prompt on ${selected.length} model${selected.length>1?'s':''}…`);
    const d = await _igItApi('POST', '/api/model-compare/run', { prompt, system_prompt, task_type, models: selected, max_tokens: 600 });
    if (!d.ok) { el.innerHTML = _igItCard(`<p style="color:#DC2626;margin:0">${_igItEsc(d.error||'Failed')}</p>`); return; }

    const judgeHtml = d.judgment ? `<div style="background:#EDE9FE;border-radius:10px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;font-weight:700;color:#5B21B6;margin-bottom:8px">🏆 AI Judge: ${_igItEsc(d.judgment.winner||'')} wins</div>
      <div style="font-size:13px;color:#374151;margin-bottom:12px">${_igItEsc(d.judgment.rationale||'')}</div>
      ${d.judgment.scores ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${(d.judgment.scores||[]).map(s=>`<div style="background:#fff;border-radius:8px;padding:8px 14px;min-width:120px">
        <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:4px">${_igItEsc(s.model)}</div>
        ${['quality','creativity','accuracy','conciseness'].map(k=>`<div style="font-size:11px;color:#6B7280;display:flex;justify-content:space-between"><span>${k}</span><strong>${s[k]}/10</strong></div>`).join('')}
        <div style="font-size:13px;font-weight:700;color:#5B21B6;margin-top:4px;border-top:1px solid #E5E7EB;padding-top:4px">Overall: ${s.overall}/10</div>
      </div>`).join('')}</div>` : ''}
    </div>` : '';

    const cols = d.results.map(r => {
      const status = r.error ? _igItBadge(r.error==='unavailable_or_not_configured'?'Not configured':'Error','red') : _igItBadge(`${r.latency_ms}ms · ${r.tokens} tok`,'green');
      return `<div style="flex:1;min-width:260px;border:1px solid #E5E7EB;border-radius:10px;overflow:hidden">
        <div style="padding:12px 14px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:14px;font-weight:700;color:#111827">${_igItEsc(r.label)}</div>
            <div style="font-size:11px;color:#9CA3AF">${_igItEsc(r.provider)}</div>
          </div>
          ${status}
        </div>
        <div style="padding:14px;font-size:13px;color:#374151;line-height:1.6;min-height:120px;white-space:pre-wrap">${r.output ? _igItEsc(r.output) : '<span style="color:#9CA3AF;font-style:italic">No output — check API key configuration.</span>'}</div>
      </div>`;
    }).join('');

    el.innerHTML = judgeHtml + `<div style="display:flex;gap:14px;flex-wrap:wrap">${cols}</div>`;
  };
};

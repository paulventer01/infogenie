// ── AI Search Visibility — Live LLM Scan (DataForSEO AI Optimization) ────
// Uses viewId 'llm-scan' and writes into #llmScanWrap (separate from the older
// buildAiVisibility/aiVisWrap tracker which uses simulated platform scores).
window._aivState = { lastResult: null, history: [] };

window.buildLlmScan = function() {
  const main = document.getElementById('llmScanWrap');
  if (!main) return;
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const brand = (window.analysisData && window.analysisData.url)
              || (window._brandKit && window._brandKit.name)
              || '';
  const comps = ((window.analysisData && Array.isArray(window.analysisData.competitors))
                ? window.analysisData.competitors : [])
              .map(c => (c && (c.name || c.brand)) || '').filter(Boolean).slice(0, 10);

  const defaultPrompts = [
    'What are the best companies for ' + (brand ? 'the industry of ' + brand : 'small businesses') + '?',
    'Who are the top alternatives to ' + (brand || 'leading providers') + '?',
    'Compare the top providers in this space and recommend one.'
  ];

  main.innerHTML = `
    <div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px">
          <div>
            <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Your brand</label>
            <input id="aivBrand" type="text" value="${e(brand)}" placeholder="e.g. InfoGenie"
              style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem"/>
          </div>
          <div>
            <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Competitors (comma-separated, up to 10)</label>
            <input id="aivComps" type="text" value="${e(comps.join(', '))}" placeholder="e.g. HubSpot, Mailchimp, Klaviyo"
              style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem"/>
          </div>
        </div>

        <label style="font-weight:700;font-size:.82rem;color:#0F172A;display:block;margin-bottom:4px">Prompts (one per line, up to 6)</label>
        <textarea id="aivPrompts" rows="4" placeholder="One question per line"
          style="width:100%;padding:9px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:.92rem;font-family:inherit;resize:vertical">${e(defaultPrompts.join('\n'))}</textarea>

        <div style="margin-top:12px">
          <div style="font-weight:700;font-size:.82rem;color:#0F172A;margin-bottom:6px">LLM providers</div>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            ${['chatgpt','perplexity','gemini','claude'].map(p => `
              <label style="display:flex;align-items:center;gap:6px;font-size:.88rem;color:#0F172A;cursor:pointer">
                <input type="checkbox" class="aivProv" value="${p}" ${p==='chatgpt'||p==='perplexity'?'checked':''}/>
                ${p === 'chatgpt' ? 'ChatGPT' : p[0].toUpperCase()+p.slice(1)}
              </label>
            `).join('')}
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:10px;flex-wrap:wrap">
          <div style="font-size:.78rem;color:#64748B">
            Each (provider × prompt) is one paid LLM call on your DataForSEO AI Optimization plan.
          </div>
          <div style="display:flex;gap:8px">
            <button id="aivHistBtn" style="padding:9px 16px;border:1px solid #CBD5E1;background:#FFF;border-radius:8px;font-weight:600;cursor:pointer;color:#0F172A">📜 History</button>
            <button id="aivRunBtn" style="padding:9px 18px;border:0;background:#4338CA;color:#FFF;border-radius:8px;font-weight:700;cursor:pointer">▶ Run Visibility Scan</button>
          </div>
        </div>
      </div>

      <div id="aivResult"></div>
    </div>
  `;

  document.getElementById('aivRunBtn').onclick = window._aivRun;
  document.getElementById('aivHistBtn').onclick = window._aivLoadHistory;
};

window._aivRun = async function() {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const brand = document.getElementById('aivBrand').value.trim();
  const competitors = document.getElementById('aivComps').value.split(',').map(s => s.trim()).filter(Boolean);
  const prompts = document.getElementById('aivPrompts').value.split('\n').map(s => s.trim()).filter(Boolean);
  const providers = Array.from(document.querySelectorAll('.aivProv:checked')).map(c => c.value);
  const out = document.getElementById('aivResult');
  if (!brand) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Brand name is required.</div>`; return; }
  if (prompts.length === 0) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">At least one prompt is required.</div>`; return; }
  if (providers.length === 0) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Pick at least one LLM provider.</div>`; return; }

  const total = providers.length * prompts.length;
  out.innerHTML = `<div style="padding:18px;background:#EEF2FF;border-radius:12px;color:#3730A3;font-weight:600;text-align:center">⏳ Querying ${providers.length} LLM${providers.length>1?'s':''} × ${prompts.length} prompt${prompts.length>1?'s':''} = ${total} live LLM call${total>1?'s':''}… this can take 30-90 seconds.</div>`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
    const r = await fetch('/api/ai-visibility/run', {
      method: 'POST', headers,
      body: JSON.stringify({ brand, competitors, prompts, providers })
    });
    const data = await r.json();
    if (!data.ok) {
      out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">${e(data.error || 'Scan failed')}</div>`;
      return;
    }
    window._aivState.lastResult = data;
    window._aivRender(data);
  } catch (err) {
    out.innerHTML = `<div style="padding:14px;background:#FEF2F2;border-left:4px solid #B91C1C;border-radius:8px;color:#991B1B">Network error: ${e(err.message)}</div>`;
  }
};

window._aivRender = function(data) {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const out = document.getElementById('aivResult');
  if (!out) return;
  const summary = data.summary || {};
  const sov = summary.sov || [];
  const youShare = Math.round((summary.youShare || 0) * 100);
  const ranked = sov.slice().sort((a,b)=>b.mentions-a.mentions);
  const youRank = ranked.findIndex(s => s.brand === data.brand) + 1;
  const maxMentions = Math.max(1, ...sov.map(s => s.mentions));

  const sovBars = sov.map(s => {
    const w = Math.max(2, Math.round((s.mentions / maxMentions) * 100));
    const isYou = s.brand === data.brand;
    const pct = Math.round((s.share || 0) * 100);
    return `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:.85rem">
          <span style="font-weight:${isYou?'800':'600'};color:${isYou?'#4338CA':'#0F172A'}">${e(s.brand)}${isYou?' (you)':''}</span>
          <span style="color:#64748B">${s.mentions} mentions · ${pct}% SoV · cited first ${s.firstCites}x</span>
        </div>
        <div style="height:10px;background:#F1F5F9;border-radius:6px;overflow:hidden">
          <div style="width:${w}%;height:100%;background:${isYou?'#4338CA':'#94A3B8'}"></div>
        </div>
      </div>`;
  }).join('');

  const cells = [];
  for (const provider of data.providers) {
    for (const prompt of data.prompts) {
      const c = (data.results[provider] || {})[prompt] || {};
      const ms = c.mentions || {};
      const allBrands = [data.brand, ...(data.competitors || [])];
      const mentionsRow = allBrands.map(b => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${b===data.brand?'#EEF2FF':'#F1F5F9'};color:${b===data.brand?'#4338CA':'#475569'};font-size:.72rem;margin:2px 4px 2px 0;font-weight:${b===data.brand?'700':'500'}">${e(b)}: ${ms[b]||0}</span>`).join('');
      cells.push(`
        <details style="background:#FFF;border:1px solid #E2E8F0;border-radius:10px;margin-bottom:8px">
          <summary style="padding:10px 14px;cursor:pointer;font-size:.86rem">
            <strong style="color:#4338CA">${e(provider)}</strong>
            <span style="color:#64748B"> · ${e(prompt.slice(0, 90))}${prompt.length>90?'…':''}</span>
            ${c.error ? `<span style="color:#B91C1C;font-size:.75rem;margin-left:6px">⚠ ${e(c.error)}</span>` : ''}
          </summary>
          <div style="padding:0 14px 14px">
            <div style="margin-bottom:8px">${mentionsRow}</div>
            <div style="background:#F8FAFC;padding:10px;border-radius:8px;font-size:.84rem;color:#0F172A;white-space:pre-wrap;line-height:1.5;max-height:280px;overflow:auto">${e(c.text || '(no response)')}</div>
          </div>
        </details>`);
    }
  }

  out.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Your share of voice</div>
        <div style="font-size:2rem;font-weight:800;color:#4338CA">${youShare}%</div>
        <div style="font-size:.78rem;color:#64748B">${summary.youMentions || 0} mentions across ${summary.answeredRuns || 0}/${summary.totalRuns || 0} LLM responses</div>
      </div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Your rank</div>
        <div style="font-size:2rem;font-weight:800;color:${youRank===1?'#10B981':youRank<=3?'#0EA5E9':'#B91C1C'}">${youRank || '—'}${youRank?' / '+ranked.length:''}</div>
        <div style="font-size:.78rem;color:#64748B">Position by total mentions</div>
      </div>
      <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px">
        <div style="font-size:.78rem;color:#64748B;font-weight:600">Strongest LLM for you</div>
        <div style="font-size:1.4rem;font-weight:800;color:#0F172A">${summary.topProvider ? e(summary.topProvider.provider) : '—'}</div>
        <div style="font-size:.78rem;color:#64748B">${summary.topProvider ? summary.topProvider.mentions + ' mentions of you' : 'No data'} · cost $${(data.cost_usd||0).toFixed(4)}</div>
      </div>
    </div>

    <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:16px">
      <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.1rem">Share of voice across all LLM answers</h3>
      ${sovBars || '<div style="color:#64748B">No mentions detected.</div>'}
    </div>

    <div style="background:#FFF;border:1px solid #E2E8F0;border-radius:14px;padding:18px">
      <h3 style="margin:0 0 12px;color:#0F172A;font-size:1.1rem">Per-prompt LLM responses</h3>
      ${cells.join('') || '<div style="color:#64748B">No responses.</div>'}
    </div>
  `;
};

window._aivLoadHistory = async function() {
  const e = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const out = document.getElementById('aivResult');
  out.innerHTML = `<div style="padding:14px;background:#EEF2FF;border-radius:8px;color:#3730A3">⏳ Loading history…</div>`;
  try {
    const headers = {};
    if (window.API_KEY) headers['x-api-key'] = window.API_KEY;
    const r = await fetch('/api/ai-visibility/runs', { headers });
    const data = await r.json();
    if (!data.ok) { out.innerHTML = `<div style="padding:14px;background:#FEF2F2;color:#991B1B;border-radius:8px">${e(data.error||'Failed')}</div>`; return; }
    if (!data.runs.length) { out.innerHTML = `<div style="padding:14px;background:#F1F5F9;color:#475569;border-radius:8px">No past runs yet. Run a scan above to start tracking.</div>`; return; }
    const rows = data.runs.map(r => {
      const s = r.summary || {};
      const youShare = Math.round((s.youShare || 0) * 100);
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #F1F5F9">
          <div>
            <div style="font-weight:700;color:#0F172A">${e(r.brand)}</div>
            <div style="font-size:.76rem;color:#64748B">${new Date(r.created_at).toLocaleString()} · ${(r.providers||[]).length} provider(s) · ${(r.prompts||[]).length} prompt(s)</div>
          </div>
          <div style="display:flex;gap:14px;align-items:center">
            <div style="font-size:.92rem;font-weight:700;color:#4338CA">${youShare}% SoV</div>
            <div style="font-size:.76rem;color:#64748B">$${Number(r.cost_usd||0).toFixed(4)}</div>
          </div>
        </div>`;
    }).join('');
    out.innerHTML = `<div style="background:#FFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden"><div style="padding:12px 14px;background:#F8FAFC;font-weight:700;color:#0F172A">Past AI Visibility runs</div>${rows}</div>`;
  } catch (err) {
    out.innerHTML = `<div style="padding:14px;background:#FEF2F2;color:#991B1B;border-radius:8px">Network error: ${e(err.message)}</div>`;
  }
};

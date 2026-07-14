  // ═══════════════════════════════════════════════════════════════════════════
  // T104 — CROSS-PLATFORM BUDGET ARBITRAGE
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildBudgetArbitrage = async function () {
    const el = document.getElementById('view-budget-arbitrage');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>⚖️ Cross-Platform Budget Arbitrage</h1><p>Predictive AI shifts budgets between platforms in real time based on live ROAS, CPA, and CVR — maximising total return.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="ba-analyse">Analyse & Shift</button><button class="ig-tab" data-tab="ba-rules">Allocation Rules</button><button class="ig-tab" data-tab="ba-history">History</button></div>
<div id="ba-analyse" class="ig-tab-panel">
  <div class="ig-form-card" style="max-width:720px">
    <h3>Enter Live Platform Metrics</h3>
    <p style="font-size:.87rem;color:#666">Enter current spend and performance for each platform. AI will recommend budget shifts.</p>
    <div id="ba-platform-rows">
      ${['Meta','Google','TikTok'].map(p => `<div class="ba-row" style="display:grid;grid-template-columns:120px 1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;align-items:end">
        <strong style="padding-top:24px">${p}</strong>
        <label>Daily Budget ($)<input type="number" class="ig-input ba-budget" data-plat="${p.toLowerCase()}" placeholder="500"></label>
        <label>ROAS<input type="number" class="ig-input ba-roas" data-plat="${p.toLowerCase()}" placeholder="2.4" step="0.1"></label>
        <label>CPA ($)<input type="number" class="ig-input ba-cpa" data-plat="${p.toLowerCase()}" placeholder="32"></label>
        <label>CVR (%)<input type="number" class="ig-input ba-cvr" data-plat="${p.toLowerCase()}" placeholder="3.2" step="0.1"></label>
      </div>`).join('')}
    </div>
    <label>Max Budget Shift per Platform (%)<input type="number" id="ba-max-shift" class="ig-input" value="30" min="5" max="80"></label>
    <button class="btn btn-primary" id="ba-analyse-btn">🤖 Analyse & Recommend</button>
  </div>
  <div id="ba-result" style="margin-top:20px"></div>
</div>
<div id="ba-rules" class="ig-tab-panel hidden">
  <div class="ig-toolbar"><button class="btn btn-primary" id="ba-new-rule">+ New Rule</button></div>
  <div id="ba-rules-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="ba-history" class="ig-tab-panel hidden">
  <div id="ba-history-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'ba-rules') loadRules();
      if (t.dataset.tab === 'ba-history') loadHistory();
    }));

    el.querySelector('#ba-analyse-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#ba-analyse-btn');
      btn.disabled = true; btn.textContent = '⏳ Analysing…';
      const metrics = ['meta', 'google', 'tiktok'].map(p => ({
        platform: p,
        current_budget: +(el.querySelector(`.ba-budget[data-plat="${p}"]`).value || 0),
        roas: +(el.querySelector(`.ba-roas[data-plat="${p}"]`).value || 0),
        cpa: +(el.querySelector(`.ba-cpa[data-plat="${p}"]`).value || 0),
        cvr: +(el.querySelector(`.ba-cvr[data-plat="${p}"]`).value || 0)
      })).filter(m => m.current_budget > 0);
      const d = await _api('/api/budget-arbitrage/analyse', { method: 'POST', body: JSON.stringify({ platform_metrics: metrics, max_shift_pct: +el.querySelector('#ba-max-shift').value }) });
      btn.disabled = false; btn.textContent = '🤖 Analyse & Recommend';
      const res = el.querySelector('#ba-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const a = d.analysis;
      res.innerHTML = `<div class="ig-form-card">
        <div class="ig-stats-row">
          <div class="ig-stat"><div class="ig-stat-val">$${(a.total_shifted || 0).toFixed(0)}</div><div class="ig-stat-label">Total Shifted</div></div>
          <div class="ig-stat"><div class="ig-stat-val">+${a.projected_roas_uplift_pct || 0}%</div><div class="ig-stat-label">Projected ROAS Uplift</div></div>
          <div class="ig-stat"><div class="ig-stat-val">${_esc(a.urgency || '—')}</div><div class="ig-stat-label">Urgency</div></div>
          <div class="ig-stat"><div class="ig-stat-val">${_esc(a.risk_level || '—')}</div><div class="ig-stat-label">Risk Level</div></div>
        </div>
        <p style="font-size:.9rem;margin:12px 0">${_esc(a.rationale || '')}</p>
        <table class="ig-table"><thead><tr><th>Platform</th><th>Current</th><th>Recommended</th><th>Shift</th><th>Direction</th><th>Reason</th></tr></thead><tbody>
          ${(a.platform_analysis || []).map(p => `<tr><td><strong>${_esc(p.platform)}</strong></td><td>$${p.current_budget}</td><td>$${(p.recommended_budget || 0).toFixed(0)}</td><td class="${p.shift_amount > 0 ? 'text-success' : p.shift_amount < 0 ? 'text-danger' : ''}">$${Math.abs(p.shift_amount || 0).toFixed(0)}</td><td>${_badge(p.shift_direction === 'increase' ? 'active' : p.shift_direction === 'decrease' ? 'detected' : 'queued', STATUS_MAP)}</td><td style="font-size:.82rem">${_esc(p.reason || '')}</td></tr>`).join('')}
        </tbody></table>
        <button class="btn btn-success" data-exec="${d.history_id}">✅ Apply These Shifts</button>
      </div>`;
      res.querySelector('[data-exec]').addEventListener('click', async b => {
        await _api('/api/budget-arbitrage/execute/' + b.target.dataset.exec, { method: 'POST' });
        b.target.textContent = '✅ Applied!'; b.target.disabled = true;
      });
    });

    async function loadRules() {
      const d = await _api('/api/budget-arbitrage/rules');
      const c = el.querySelector('#ba-rules-list');
      if (!d.ok || !d.rules.length) { c.innerHTML = '<div class="ig-empty">No allocation rules yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Platforms</th><th>Total Budget</th><th>Logic</th><th>Max Shift</th><th></th></tr></thead><tbody>` +
        d.rules.map(r => `<tr><td>${_esc(r.name)}</td><td>${_esc(r.platforms)}</td><td>$${r.total_daily_budget}/day</td><td>${_esc(r.reallocation_logic)}</td><td>${r.max_shift_pct}%</td><td><button class="btn btn-sm btn-danger" data-del="${r.id}">Delete</button></td></tr>`).join('') +
        '</tbody></table>';
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await _api('/api/budget-arbitrage/rules/' + b.dataset.del, { method: 'DELETE' }); loadRules(); }));
    }

    async function loadHistory() {
      const d = await _api('/api/budget-arbitrage/history');
      const c = el.querySelector('#ba-history-list');
      if (!d.ok || !d.history.length) { c.innerHTML = '<div class="ig-empty">No analysis history yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Rule</th><th>Shifted</th><th>ROAS Uplift</th><th>Executed</th><th>Date</th></tr></thead><tbody>` +
        d.history.map(h => `<tr><td>${_esc(h.rule_name || 'Ad-hoc')}</td><td>$${h.total_shifted || 0}</td><td>+${h.projected_roas_uplift || 0}%</td><td>${h.is_executed ? '✅' : '—'}</td><td>${_ts(h.created_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }

    el.querySelector('#ba-new-rule').addEventListener('click', () => {
      const name = prompt('Rule name:'); if (!name) return;
      const budget = +prompt('Total daily budget ($):');
      _api('/api/budget-arbitrage/rules', { method: 'POST', body: JSON.stringify({ name, platforms: 'meta,google,tiktok', total_daily_budget: budget }) }).then(loadRules);
    });
  };


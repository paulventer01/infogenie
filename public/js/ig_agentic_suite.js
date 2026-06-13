(function () {
  'use strict';

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _api(path, opts) { return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => r.json()); }
  function _badge(val, map) { const e = map[val] || map['default'] || { label: val, cls: 'neutral' }; return `<span class="badge badge-${e.cls}">${_esc(e.label || val)}</span>`; }
  function _ts(d) { return d ? new Date(d).toLocaleString() : '—'; }

  const STATUS_MAP = { running: { label: 'Running', cls: 'info' }, completed: { label: 'Completed', cls: 'success' }, success: { label: 'Success', cls: 'success' }, failed: { label: 'Failed', cls: 'danger' }, partial: { label: 'Partial', cls: 'warning' }, draft: { label: 'Draft', cls: 'neutral' }, active: { label: 'Active', cls: 'success' }, paused: { label: 'Paused', cls: 'warning' }, detected: { label: 'Detected', cls: 'danger' }, healing: { label: 'Healing', cls: 'warning' }, resubmitted: { label: 'Resubmitted', cls: 'info' }, resolved: { label: 'Resolved', cls: 'success' }, sent: { label: 'Sent', cls: 'success' }, queued: { label: 'Queued', cls: 'neutral' }, default: { label: 'Unknown', cls: 'neutral' } };

  // ═══════════════════════════════════════════════════════════════════════════
  // T102 — MULTI-AGENT SWARM
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildAgentSwarm = async function () {
    const el = document.getElementById('view-agent-swarm');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🐝 Multi-Agent Swarm</h1><p>Agents that communicate and act in coordinated chains — detect → respond → approve → publish.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="sw-configs">Swarm Configs</button><button class="ig-tab" data-tab="sw-runs">Run History</button><button class="ig-tab" data-tab="sw-trigger">Fire Event</button></div>
<div id="sw-configs" class="ig-tab-panel">
  <div class="ig-toolbar"><button class="btn btn-primary" id="sw-new-btn">+ New Swarm Config</button></div>
  <div id="sw-config-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="sw-runs" class="ig-tab-panel hidden">
  <div id="sw-run-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="sw-trigger" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:560px">
    <h3>Fire a Swarm Event</h3>
    <label>Trigger Event<select id="sw-event-type" class="ig-select"><option value="competitor_change">Competitor change detected</option><option value="ad_rejected">Ad rejected</option><option value="roas_drop">ROAS drop alert</option><option value="budget_pacing">Budget pacing issue</option><option value="manual">Manual (test run)</option></select></label>
    <label>Event Context (JSON or description)<textarea id="sw-event-data" class="ig-textarea" rows="3" placeholder='{"competitor":"AcmeCo","product":"new SKU launched"}'></textarea></label>
    <button class="btn btn-primary" id="sw-fire-btn">🚀 Fire Swarm</button>
    <div id="sw-fire-result" style="margin-top:16px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'sw-runs') loadRuns();
    }));

    async function loadConfigs() {
      const d = await _api('/api/swarm/configs');
      const c = el.querySelector('#sw-config-list');
      if (!d.ok || !d.configs.length) { c.innerHTML = '<div class="ig-empty">No swarm configs yet. Create one to automate agent chains.</div>'; return; }
      c.innerHTML = d.configs.map(cfg => `<div class="ig-card">
        <div class="ig-card-header"><strong>${_esc(cfg.name)}</strong>${_badge(cfg.is_active ? 'active' : 'paused', STATUS_MAP)}</div>
        <div class="ig-card-meta">Trigger: <code>${_esc(cfg.trigger_event)}</code> · Runs: ${cfg.run_count} · Last: ${_ts(cfg.last_run_at)}</div>
        <p style="margin:8px 0;font-size:.88rem">${_esc(cfg.description || '')}</p>
        <div class="ig-card-actions">
          <button class="btn btn-sm btn-secondary" data-toggle="${cfg.id}" data-active="${cfg.is_active}">${cfg.is_active ? 'Pause' : 'Activate'}</button>
          <button class="btn btn-sm btn-danger" data-del="${cfg.id}">Delete</button>
        </div>
      </div>`).join('');
      c.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => {
        await _api('/api/swarm/configs/' + b.dataset.toggle, { method: 'PUT', body: JSON.stringify({ is_active: b.dataset.active === 'true' ? false : true }) });
        loadConfigs();
      }));
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Delete swarm config?')) return;
        await _api('/api/swarm/configs/' + b.dataset.del, { method: 'DELETE' });
        loadConfigs();
      }));
    }

    async function loadRuns() {
      const d = await _api('/api/swarm/runs');
      const r = el.querySelector('#sw-run-list');
      if (!d.ok || !d.runs.length) { r.innerHTML = '<div class="ig-empty">No swarm runs yet. Fire an event to start.</div>'; return; }
      r.innerHTML = `<table class="ig-table"><thead><tr><th>Event</th><th>Config</th><th>Status</th><th>Steps</th><th>Started</th><th>Summary</th></tr></thead><tbody>` +
        d.runs.map(run => `<tr><td><code>${_esc(run.trigger_event)}</code></td><td>${_esc(run.config_name || '—')}</td><td>${_badge(run.status, STATUS_MAP)}</td><td>${run.steps_completed}/${run.steps_total}</td><td>${_ts(run.started_at)}</td><td style="font-size:.82rem;max-width:260px">${_esc(run.summary || '—')}</td></tr>`).join('') +
        '</tbody></table>';
    }

    el.querySelector('#sw-new-btn').addEventListener('click', () => {
      const name = prompt('Swarm config name:'); if (!name) return;
      const trigger = prompt('Trigger event (competitor_change / ad_rejected / roas_drop / manual):') || 'manual';
      const chain = JSON.stringify([
        { agent_type: 'competitor_spy', step_name: 'Gather intelligence' },
        { agent_type: 'copywriter', step_name: 'Draft response copy' },
        { agent_type: 'approval_gate', step_name: 'Push to approval queue' }
      ]);
      _api('/api/swarm/configs', { method: 'POST', body: JSON.stringify({ name, trigger_event: trigger, agent_chain: chain }) }).then(loadConfigs);
    });

    el.querySelector('#sw-fire-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#sw-fire-btn');
      btn.disabled = true; btn.textContent = '⏳ Running swarm…';
      let data = {};
      try { data = JSON.parse(el.querySelector('#sw-event-data').value || '{}'); } catch (e) { data = { description: el.querySelector('#sw-event-data').value }; }
      const d = await _api('/api/swarm/trigger', { method: 'POST', body: JSON.stringify({ event_type: el.querySelector('#sw-event-type').value, event_data: data }) });
      btn.disabled = false; btn.textContent = '🚀 Fire Swarm';
      const res = el.querySelector('#sw-fire-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">Error: ${_esc(d.error)}</div>`; return; }
      res.innerHTML = `<div class="ig-alert ig-alert-success"><strong>Swarm completed — ${d.steps.length} agent steps</strong><br>${_esc(d.summary)}</div>
        <div style="margin-top:12px">${d.steps.map((s, i) => `<div class="ig-step-row"><span class="ig-step-num">${i+1}</span><span class="ig-step-label"><strong>${_esc(s.agent)}</strong>: ${_esc(s.step)}</span><span style="font-size:.8rem;color:#555">${_esc((s.result && s.result.output || '').slice(0, 120))}</span></div>`).join('')}</div>`;
    });

    loadConfigs();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T103 — SELF-HEALING AD ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildSelfHealing = async function () {
    const el = document.getElementById('view-self-healing');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🩹 Self-Healing Ad Accounts</h1><p>AI detects rejected ads, rewrites them to meet platform policies, and prepares them for instant resubmission.</p></div>
<div class="ig-toolbar">
  <button class="btn btn-primary" id="sh-report-btn">+ Report Rejection</button>
</div>
<div id="sh-list"><div class="ig-spinner">Loading…</div></div>
<div id="sh-heal-panel" class="hidden" style="margin-top:20px"></div>`;

    async function loadHistory() {
      const d = await _api('/api/self-healing/history');
      const c = el.querySelector('#sh-list');
      if (!d.ok || !d.rejections.length) { c.innerHTML = '<div class="ig-empty">No rejected ads logged yet. Report a rejection to start AI healing.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Platform</th><th>Ad Name</th><th>Rejection Reason</th><th>Status</th><th>Confidence</th><th>Detected</th><th>Actions</th></tr></thead><tbody>` +
        d.rejections.map(r => `<tr>
          <td><span class="badge badge-info">${_esc(r.platform)}</span></td>
          <td>${_esc(r.ad_name || r.ad_id || '—')}</td>
          <td style="max-width:200px;font-size:.83rem">${_esc(r.rejection_reason.slice(0,100))}</td>
          <td>${_badge(r.status, STATUS_MAP)}</td>
          <td>${r.latest_confidence ? r.latest_confidence + '%' : '—'}</td>
          <td>${_ts(r.detected_at)}</td>
          <td>
            ${r.status === 'detected' || r.status === 'healing' ? `<button class="btn btn-sm btn-primary" data-heal="${r.id}">🤖 AI Heal</button>` : ''}
            ${r.status === 'healing' ? `<button class="btn btn-sm btn-success" data-resubmit="${r.id}">✓ Mark Resubmitted</button>` : ''}
            ${r.status !== 'resolved' ? `<button class="btn btn-sm btn-secondary" data-resolve="${r.id}">Resolve</button>` : ''}
          </td>
        </tr>`).join('') + '</tbody></table>';

      c.querySelectorAll('[data-heal]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳ Healing…';
        const d2 = await _api('/api/self-healing/heal/' + b.dataset.heal, { method: 'POST' });
        if (d2.ok) {
          const h = el.querySelector('#sh-heal-panel');
          h.classList.remove('hidden');
          h.innerHTML = `<div class="ig-form-card"><h3>✅ AI-Healed Copy — Confidence: ${d2.healed.confidence_pct}%</h3>
            <div class="ig-two-col">
              <div><label>Healed Headline</label><div class="ig-copybox">${_esc(d2.healed.healed_headline)}</div></div>
              <div><label>Strategy</label><div class="ig-copybox" style="font-size:.84rem">${_esc(d2.healed.heal_strategy)}</div></div>
            </div>
            <label>Healed Ad Copy</label><div class="ig-copybox">${_esc(d2.healed.healed_copy)}</div>
            <label>Policy Fixes</label><ul>${(d2.healed.policy_fixes || []).map(f => `<li>${_esc(f)}</li>`).join('')}</ul>
            <button class="btn btn-sm btn-success" data-resubmit="${b.dataset.heal}">✓ Mark as Resubmitted</button>
          </div>`;
          h.querySelector('[data-resubmit]').addEventListener('click', async () => {
            await _api('/api/self-healing/resubmit/' + b.dataset.heal, { method: 'POST' }); loadHistory(); h.classList.add('hidden');
          });
        }
        loadHistory();
      }));
      c.querySelectorAll('[data-resubmit]').forEach(b => b.addEventListener('click', async () => { await _api('/api/self-healing/resubmit/' + b.dataset.resubmit, { method: 'POST' }); loadHistory(); }));
      c.querySelectorAll('[data-resolve]').forEach(b => b.addEventListener('click', async () => { await _api('/api/self-healing/resolve/' + b.dataset.resolve, { method: 'POST' }); loadHistory(); }));
    }

    el.querySelector('#sh-report-btn').addEventListener('click', () => {
      const platform = prompt('Platform (meta / google / tiktok / linkedin):') || 'meta';
      const ad_name = prompt('Ad name or ID:') || 'Unknown Ad';
      const rejection_reason = prompt('Paste the rejection reason from the platform:');
      if (!rejection_reason) return;
      const original_copy = prompt('Paste the original ad copy:') || '';
      _api('/api/self-healing/check', { method: 'POST', body: JSON.stringify({ platform, ad_name, rejection_reason, original_copy }) }).then(loadHistory);
    });

    loadHistory();
  };

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

  // ═══════════════════════════════════════════════════════════════════════════
  // T105 — SERVER-SIDE EVENT MANAGER
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildSsEvents = async function () {
    const el = document.getElementById('view-ss-events');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>📡 Server-Side Event Manager</h1><p>Collect and attribute conversion events from any source — web, mobile, phone calls, offline sales — without browser restrictions.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="sse-report">Attribution Report</button><button class="ig-tab" data-tab="sse-sources">Event Sources</button><button class="ig-tab" data-tab="sse-ingest">Ingest Event</button></div>
<div id="sse-report" class="ig-tab-panel"><div id="sse-report-content"><div class="ig-spinner">Loading…</div></div></div>
<div id="sse-sources" class="ig-tab-panel hidden">
  <div class="ig-toolbar"><button class="btn btn-primary" id="sse-add-src">+ Add Event Source</button></div>
  <div id="sse-src-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="sse-ingest" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:500px">
    <h3>Manual Event Ingest</h3>
    <label>Event Name<input type="text" id="sse-ev-name" class="ig-input" placeholder="purchase / phone_call / demo_request"></label>
    <label>Value ($)<input type="number" id="sse-ev-value" class="ig-input" placeholder="250"></label>
    <label>Email (will be hashed)<input type="email" id="sse-ev-email" class="ig-input" placeholder="customer@example.com"></label>
    <label>Click ID (fbclid / gclid)<input type="text" id="sse-ev-clid" class="ig-input" placeholder="optional"></label>
    <button class="btn btn-primary" id="sse-ingest-btn">Ingest Event</button>
    <div id="sse-ingest-result" style="margin-top:10px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'sse-sources') loadSources();
    }));

    async function loadReport() {
      const d = await _api('/api/ss-events/report?days=30');
      const c = el.querySelector('#sse-report-content');
      if (!d.ok) { c.innerHTML = '<div class="ig-empty">No events yet. Add an event source and start ingesting.</div>'; return; }
      c.innerHTML = `<div class="ig-stats-row">
        <div class="ig-stat"><div class="ig-stat-val">${(d.totals.events || 0).toLocaleString()}</div><div class="ig-stat-label">Total Events (30d)</div></div>
        <div class="ig-stat"><div class="ig-stat-val">$${(d.totals.revenue || 0).toLocaleString()}</div><div class="ig-stat-label">Revenue Tracked</div></div>
        <div class="ig-stat"><div class="ig-stat-val">${d.by_source.length}</div><div class="ig-stat-label">Active Sources</div></div>
      </div>
      <div class="ig-two-col" style="margin-top:20px">
        <div><h4>By Event Type</h4><table class="ig-table"><thead><tr><th>Event</th><th>Count</th><th>Revenue</th></tr></thead><tbody>
          ${(d.by_event || []).map(e => `<tr><td><code>${_esc(e.event_name)}</code></td><td>${e.n}</td><td>${e.revenue ? '$' + (+e.revenue).toFixed(2) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div><h4>By Source</h4><table class="ig-table"><thead><tr><th>Source</th><th>Events</th></tr></thead><tbody>
          ${(d.by_source || []).map(s => `<tr><td>${_esc(s.source_name)}</td><td>${s.n}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`;
    }

    async function loadSources() {
      const d = await _api('/api/ss-events/sources');
      const c = el.querySelector('#sse-src-list');
      if (!d.ok || !d.sources.length) { c.innerHTML = '<div class="ig-empty">No event sources yet. Add one to get an ingest URL.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Type</th><th>Events</th><th>Ingest URL</th><th>Last Event</th><th></th></tr></thead><tbody>` +
        d.sources.map(s => `<tr><td>${_esc(s.source_name)}</td><td><span class="badge badge-info">${_esc(s.source_type)}</span></td><td>${s.event_count}</td><td><code style="font-size:.78rem">/api/ss-events/ingest/${_esc(s.ingest_token)}</code></td><td>${_ts(s.last_event_at)}</td><td><button class="btn btn-sm btn-danger" data-del="${s.id}">Del</button></td></tr>`).join('') +
        '</tbody></table>';
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await _api('/api/ss-events/sources/' + b.dataset.del, { method: 'DELETE' }); loadSources(); }));
    }

    el.querySelector('#sse-add-src').addEventListener('click', () => {
      const name = prompt('Source name (e.g. "Shopify checkout"):'); if (!name) return;
      const type = prompt('Source type (web / mobile / offline / crm / phone / pos):') || 'web';
      _api('/api/ss-events/sources/add', { method: 'POST', body: JSON.stringify({ source_name: name, source_type: type }) }).then(d => {
        if (d.ok) { alert(`Source created!\nIngest URL: /api/ss-events/ingest/${d.source.ingest_token}\nPOST JSON events to this URL.`); loadSources(); }
      });
    });

    el.querySelector('#sse-ingest-btn').addEventListener('click', async () => {
      const d = await _api('/api/ss-events/ingest', { method: 'POST', body: JSON.stringify({ events: [{ event_name: el.querySelector('#sse-ev-name').value, value: +el.querySelector('#sse-ev-value').value || null, email: el.querySelector('#sse-ev-email').value, fbclid: el.querySelector('#sse-ev-clid').value || null }] }) });
      el.querySelector('#sse-ingest-result').innerHTML = d.ok ? `<div class="ig-alert ig-alert-success">✅ ${d.ingested} event ingested</div>` : `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`;
      if (d.ok) loadReport();
    });

    loadReport();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T106 — CTV & STREAMING AUDIO
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildCtv = async function () {
    const el = document.getElementById('view-ctv');
    if (!el) return;
    const cfg = await _api('/api/ctv/config');
    const platforms = cfg.platforms || [];
    el.innerHTML = `<div class="view-header"><h1>📺 Connected TV &amp; Streaming Audio</h1><p>Plan, brief, and manage campaigns on Roku, Hulu, Amazon Fire TV, Spotify, Pandora, and Apple Podcast Ads — with AI creative briefs.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="ctv-campaigns">Campaigns</button><button class="ig-tab" data-tab="ctv-create">New Campaign</button></div>
<div id="ctv-campaigns" class="ig-tab-panel"><div id="ctv-list"><div class="ig-spinner">Loading…</div></div></div>
<div id="ctv-create" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:600px">
    <h3>New CTV / Streaming Audio Campaign</h3>
    <label>Campaign Name<input type="text" id="ctv-name" class="ig-input" placeholder="Q3 Brand Awareness — Roku"></label>
    <label>Platform<select id="ctv-platform" class="ig-select">
      ${platforms.map(p => `<option value="${p.id}">[${p.type === 'streaming_audio' ? '🎵' : '📺'}] ${p.name} — min $${p.min_budget.toLocaleString()}</option>`).join('')}
    </select></label>
    <label>Objective<select id="ctv-objective" class="ig-select">
      ${(cfg.objectives || []).map(o => `<option value="${o}">${o.replace(/_/g,' ')}</option>`).join('')}
    </select></label>
    <label>Total Budget ($)<input type="number" id="ctv-budget" class="ig-input" placeholder="5000"></label>
    <label>Daily Budget ($)<input type="number" id="ctv-daily" class="ig-input" placeholder="167"></label>
    <label>Start Date<input type="date" id="ctv-start" class="ig-input"></label>
    <label>End Date<input type="date" id="ctv-end" class="ig-input"></label>
    <div style="display:flex;gap:10px;margin-top:4px">
      <button class="btn btn-primary" id="ctv-create-btn">Create Campaign</button>
    </div>
    <div id="ctv-create-result" style="margin-top:10px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'ctv-campaigns') loadCampaigns();
    }));

    async function loadCampaigns() {
      const d = await _api('/api/ctv/campaigns');
      const c = el.querySelector('#ctv-list');
      if (!d.ok || !d.campaigns.length) { c.innerHTML = '<div class="ig-empty">No CTV/audio campaigns yet. Create one to get started.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Platform</th><th>Type</th><th>Budget</th><th>Projected Reach</th><th>CPM</th><th>Status</th><th>Actions</th></tr></thead><tbody>` +
        d.campaigns.map(c2 => `<tr>
          <td><strong>${_esc(c2.name)}</strong></td>
          <td>${_esc(c2.platform)}</td>
          <td><span class="badge ${c2.campaign_type === 'streaming_audio' ? 'badge-info' : 'badge-success'}">${_esc(c2.campaign_type)}</span></td>
          <td>$${c2.budget}</td>
          <td>${c2.projected_reach ? c2.projected_reach.toLocaleString() : '—'}</td>
          <td>$${c2.projected_cpm || '—'}</td>
          <td>${_badge(c2.status, STATUS_MAP)}</td>
          <td><button class="btn btn-sm btn-primary" data-brief="${c2.id}">✍️ AI Brief</button>
              <button class="btn btn-sm btn-success" data-activate="${c2.id}">Activate</button></td>
        </tr>`).join('') + '</tbody></table>';
      c.querySelectorAll('[data-brief]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳';
        const brand = prompt('Your brand name:') || '';
        const audience = prompt('Target audience:') || '';
        const d2 = await _api('/api/ctv/campaigns/' + b.dataset.brief + '/ai-brief', { method: 'POST', body: JSON.stringify({ brand_name: brand, target_audience: audience }) });
        b.disabled = false; b.textContent = '✍️ AI Brief';
        if (d2.ok) alert(`✅ AI Creative Brief\n\nHeadline: ${d2.brief.headline}\n\nScript:\n${d2.brief.script}\n\nCTA: ${d2.brief.cta}\n\nProduction Notes: ${d2.brief.production_notes}`);
      }));
      c.querySelectorAll('[data-activate]').forEach(b => b.addEventListener('click', async () => { await _api('/api/ctv/campaigns/' + b.dataset.activate + '/status', { method: 'PUT', body: JSON.stringify({ status: 'active' }) }); loadCampaigns(); }));
    }

    el.querySelector('#ctv-create-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#ctv-create-btn');
      btn.disabled = true;
      const d = await _api('/api/ctv/campaigns/create', { method: 'POST', body: JSON.stringify({ name: el.querySelector('#ctv-name').value, platform: el.querySelector('#ctv-platform').value, objective: el.querySelector('#ctv-objective').value, budget: el.querySelector('#ctv-budget').value, daily_budget: el.querySelector('#ctv-daily').value, start_date: el.querySelector('#ctv-start').value, end_date: el.querySelector('#ctv-end').value }) });
      btn.disabled = false;
      const res = el.querySelector('#ctv-create-result');
      if (d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-success">✅ Campaign created! Projected reach: ${(d.campaign.projected_reach || 0).toLocaleString()} · CPM: $${d.campaign.projected_cpm}</div>`; }
      else { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; }
    });

    loadCampaigns();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T107 — RCS & APPLE MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildRcs = async function () {
    const el = document.getElementById('view-rcs');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>💬 RCS &amp; Apple Messages</h1><p>Rich Communication Services and Apple Messages for Business — interactive rich cards, CTA buttons, carousels, and AI-generated campaigns.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="rcs-list">Campaigns</button><button class="ig-tab" data-tab="rcs-ai">AI Generate</button></div>
<div id="rcs-list" class="ig-tab-panel">
  <div class="ig-toolbar"><button class="btn btn-primary" id="rcs-new">+ New Campaign</button></div>
  <div id="rcs-campaigns"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="rcs-ai" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:540px">
    <h3>🤖 AI Rich Message Generator</h3>
    <label>Channel<select id="rcs-channel" class="ig-select"><option value="rcs">RCS (Android)</option><option value="apple_messages">Apple Messages for Business</option></select></label>
    <label>Campaign Goal<input type="text" id="rcs-goal" class="ig-input" placeholder="Drive Black Friday sales / Book a demo / Recover abandoned cart"></label>
    <label>Brand Name<input type="text" id="rcs-brand" class="ig-input" placeholder="Acme Co."></label>
    <label>Offer / Key Message<input type="text" id="rcs-offer" class="ig-input" placeholder="30% off for 24 hours"></label>
    <label>CTA Label<input type="text" id="rcs-cta-label" class="ig-input" placeholder="Claim Offer"></label>
    <label>CTA URL<input type="url" id="rcs-cta-url" class="ig-input" placeholder="https://yoursite.com/offer"></label>
    <button class="btn btn-primary" id="rcs-gen-btn">✨ Generate Rich Campaign</button>
    <div id="rcs-gen-result" style="margin-top:16px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
    }));

    async function loadCampaigns() {
      const d = await _api('/api/rcs/campaigns');
      const c = el.querySelector('#rcs-campaigns');
      if (!d.ok || !d.campaigns.length) { c.innerHTML = '<div class="ig-empty">No RCS campaigns yet. Create one above or use the AI generator.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Channel</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Status</th><th>Created</th></tr></thead><tbody>` +
        d.campaigns.map(c2 => `<tr><td>${_esc(c2.name)}</td><td><span class="badge badge-info">${_esc(c2.channel)}</span></td><td>${c2.sent_count}</td><td>${c2.delivered_count}</td><td>${c2.read_count}</td><td>${_badge(c2.status, STATUS_MAP)}</td><td>${_ts(c2.created_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }

    el.querySelector('#rcs-new').addEventListener('click', () => {
      const name = prompt('Campaign name:'); if (!name) return;
      const body = prompt('Message body text:'); if (!body) return;
      _api('/api/rcs/campaigns/create', { method: 'POST', body: JSON.stringify({ name, message_body: body }) }).then(loadCampaigns);
    });

    el.querySelector('#rcs-gen-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#rcs-gen-btn');
      btn.disabled = true; btn.textContent = '⏳ Generating…';
      const d = await _api('/api/rcs/campaigns/0/ai-generate', { method: 'POST', body: JSON.stringify({ channel: el.querySelector('#rcs-channel').value, goal: el.querySelector('#rcs-goal').value, brand_name: el.querySelector('#rcs-brand').value, offer: el.querySelector('#rcs-offer').value, cta_label: el.querySelector('#rcs-cta-label').value, cta_url: el.querySelector('#rcs-cta-url').value }) });
      btn.disabled = false; btn.textContent = '✨ Generate Rich Campaign';
      const res = el.querySelector('#rcs-gen-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const g = d.generated;
      res.innerHTML = `<div class="ig-form-card">
        <h4>Generated Campaign — ${_esc(g.campaign_name)}</h4>
        <div class="ig-two-col">
          <div><label>Message Body (plain text fallback)</label><div class="ig-copybox">${_esc(g.message_body)}</div></div>
          <div><label>Rich Card</label><div class="ig-copybox" style="font-size:.83rem">${_esc(JSON.stringify(g.rich_card, null, 2))}</div></div>
        </div>
        <label>CTA Buttons</label><div class="ig-copybox" style="font-size:.83rem">${_esc(JSON.stringify(g.cta_buttons, null, 2))}</div>
        <label>Suggested Replies</label><div>${(g.suggested_replies || []).map(r => `<span class="badge badge-neutral" style="margin:2px">${_esc(r)}</span>`).join('')}</div>
        <label>Best Send Time</label><div class="ig-copybox">${_esc(g.best_send_time)}</div>
        <button class="btn btn-success" id="rcs-save-gen">Save as Campaign</button>
      </div>`;
      res.querySelector('#rcs-save-gen').addEventListener('click', async () => {
        const d2 = await _api('/api/rcs/campaigns/create', { method: 'POST', body: JSON.stringify({ name: g.campaign_name, channel: el.querySelector('#rcs-channel').value, message_body: g.message_body, rich_card: g.rich_card, cta_buttons: g.cta_buttons, sender_name: g.sender_name }) });
        if (d2.ok) { alert('Campaign saved!'); loadCampaigns(); }
      });
    });

    loadCampaigns();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T108 — AUTO-SUBMIT LLM KNOWLEDGE BASES
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildLlmKb = async function () {
    const el = document.getElementById('view-llm-kb');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🧬 LLM Knowledge Base</h1><p>Generate and submit structured knowledge bases that maximise your brand's citation rate in ChatGPT, Claude, and Perplexity responses.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="kb-entries">Knowledge Entries</button><button class="ig-tab" data-tab="kb-generate">AI Generate</button><button class="ig-tab" data-tab="kb-submit">Submit & Schema</button></div>
<div id="kb-entries" class="ig-tab-panel">
  <div class="ig-toolbar"><button class="btn btn-primary" id="kb-add-btn">+ Add Entry</button></div>
  <div id="kb-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="kb-generate" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:580px">
    <h3>🤖 AI Knowledge Base Generator</h3>
    <label>Brand Name<input type="text" id="kb-brand" class="ig-input" placeholder="InfoGenie"></label>
    <label>Brand Description<textarea id="kb-desc" class="ig-textarea" rows="2" placeholder="AI-powered marketing intelligence platform…"></textarea></label>
    <label>Industry<input type="text" id="kb-industry" class="ig-input" placeholder="SaaS / Marketing Technology"></label>
    <label>Target Audience<input type="text" id="kb-audience" class="ig-input" placeholder="Marketing teams at SMBs and agencies"></label>
    <label>Key Products / Services<textarea id="kb-products" class="ig-textarea" rows="2" placeholder="Competitor analysis, ad campaign management, SEO tools…"></textarea></label>
    <label>Main Competitors<input type="text" id="kb-comps" class="ig-input" placeholder="Semrush, HubSpot, Sprout Social"></label>
    <label>Brand Domain<input type="text" id="kb-domain" class="ig-input" placeholder="infogenie.io"></label>
    <button class="btn btn-primary" id="kb-gen-btn">✨ Generate Knowledge Base</button>
    <div id="kb-gen-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="kb-submit" class="ig-tab-panel hidden">
  <div id="kb-submit-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'kb-entries') loadEntries();
      if (t.dataset.tab === 'kb-submit') loadSubmit();
    }));

    async function loadEntries() {
      const d = await _api('/api/llm-kb/entries');
      const c = el.querySelector('#kb-list');
      if (!d.ok || !d.entries.length) { c.innerHTML = '<div class="ig-empty">No knowledge base entries yet. Use AI Generate to create a full KB in one click.</div>'; return; }
      const grouped = {};
      d.entries.forEach(e => { (grouped[e.entry_type] = grouped[e.entry_type] || []).push(e); });
      c.innerHTML = Object.entries(grouped).map(([type, entries]) => `<div style="margin-bottom:20px"><h4 style="text-transform:capitalize;margin-bottom:8px">${type.replace(/_/g,' ')}</h4>
        ${entries.map(e => `<div class="ig-card" style="margin-bottom:8px">
          <div class="ig-card-header"><strong>${_esc(e.title)}</strong>${e.llm_optimized ? '<span class="badge badge-success" style="margin-left:8px">LLM Optimized</span>' : ''}</div>
          <div style="font-size:.85rem;color:#555;margin-top:6px">${_esc(e.content.slice(0, 180))}${e.content.length > 180 ? '…' : ''}</div>
          <div class="ig-card-actions"><button class="btn btn-sm btn-primary" data-schema="${e.id}">📋 Get Schema</button><button class="btn btn-sm btn-danger" data-del="${e.id}">Del</button></div>
        </div>`).join('')}
      </div>`).join('');
      c.querySelectorAll('[data-schema]').forEach(b => b.addEventListener('click', async () => {
        const d2 = await _api('/api/llm-kb/schema/' + b.dataset.schema);
        if (d2.ok) alert(`JSON-LD Schema:\n\n${JSON.stringify(d2.schema_json_ld, null, 2)}\n\nEmbed instructions:\n${d2.embed_instructions.html}\n\nRobots.txt:\n${d2.embed_instructions.robots_txt}`);
      }));
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await _api('/api/llm-kb/entries/' + b.dataset.del, { method: 'DELETE' }); loadEntries(); }));
    }

    async function loadSubmit() {
      const d = await _api('/api/llm-kb/entries');
      const c = el.querySelector('#kb-submit-list');
      if (!d.ok || !d.entries.length) { c.innerHTML = '<div class="ig-empty">Add entries first.</div>'; return; }
      c.innerHTML = `<div class="ig-form-card"><h3>Submit Your KB to LLMs</h3>
        <p style="font-size:.88rem">Follow these steps to maximise LLM citation of your brand:</p>
        <ol style="font-size:.88rem;line-height:1.7">
          <li><strong>Add JSON-LD to your site:</strong> For each entry, click "Get Schema" and embed the &lt;script&gt; tag in your page &lt;head&gt;</li>
          <li><strong>Create /llms.txt:</strong> <a href="/api/llm-kb/llms-txt" target="_blank">Download your llms.txt →</a> and host it at yourdomain.com/llms.txt</li>
          <li><strong>Update robots.txt:</strong> Allow GPTBot, ClaudeBot, PerplexityBot (see schema output)</li>
          <li><strong>Submit to Google Search Console:</strong> Ensure all KB pages are indexed via sitemap</li>
          <li><strong>Create a Wikipedia / Wikidata entry</strong> — LLMs heavily favour Wikipedia as a citation source</li>
          <li><strong>Publish on authoritative sources:</strong> Press releases, Crunchbase, LinkedIn company page — LLMs cite these</li>
        </ol>
        <a class="btn btn-primary" href="/api/llm-kb/llms-txt" target="_blank">📄 Download llms.txt (${d.entries.length} entries)</a>
      </div>`;
    }

    el.querySelector('#kb-gen-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#kb-gen-btn');
      btn.disabled = true; btn.textContent = '⏳ Generating…';
      const d = await _api('/api/llm-kb/generate', { method: 'POST', body: JSON.stringify({ brand_name: el.querySelector('#kb-brand').value, brand_description: el.querySelector('#kb-desc').value, industry: el.querySelector('#kb-industry').value, target_audience: el.querySelector('#kb-audience').value, key_products: el.querySelector('#kb-products').value, competitors: el.querySelector('#kb-comps').value, brand_domain: el.querySelector('#kb-domain').value }) });
      btn.disabled = false; btn.textContent = '✨ Generate Knowledge Base';
      const res = el.querySelector('#kb-gen-result');
      if (d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-success">✅ Generated and saved ${d.generated} knowledge base entries. Switch to "Knowledge Entries" to view them.</div>`; }
      else { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; }
    });

    el.querySelector('#kb-add-btn').addEventListener('click', () => {
      const type = prompt('Entry type (faq / how_to / about_brand / product_service / comparison):') || 'faq';
      const title = prompt('Title / question:'); if (!title) return;
      const content = prompt('Content / answer:'); if (!content) return;
      _api('/api/llm-kb/entries/add', { method: 'POST', body: JSON.stringify({ entry_type: type, title, content }) }).then(loadEntries);
    });

    loadEntries();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T109 — GLOBAL PRIVACY AUTO-COMPLIANCE
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildPrivacyCompliance = async function () {
    const el = document.getElementById('view-privacy-compliance');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🔐 Privacy Auto-Compliance</h1><p>Auto-scrub PII from lists, check Do-Not-Call registries, validate consent for GDPR/CCPA/TCPA, and run full compliance audits.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="pc-tools">Compliance Tools</button><button class="ig-tab" data-tab="pc-audit">AI Audit</button><button class="ig-tab" data-tab="pc-history">History</button></div>
<div id="pc-tools" class="ig-tab-panel">
  <div class="ig-three-col" style="gap:16px">
    <div class="ig-form-card">
      <h3>🧹 PII Scrubber</h3>
      <p style="font-size:.85rem">Paste contact JSON or CSV rows. AI detects SSNs, credit card numbers, passport numbers, and other PII.</p>
      <textarea id="pc-contacts" class="ig-textarea" rows="5" placeholder='[{"email":"john@x.com","name":"John"},{"email":"jane@y.com","ssn":"123-45-6789"}]'></textarea>
      <button class="btn btn-primary" id="pc-scrub-btn" style="margin-top:8px">🧹 Scrub PII</button>
      <div id="pc-scrub-result" style="margin-top:10px"></div>
    </div>
    <div class="ig-form-card">
      <h3>📵 DNC Checker</h3>
      <p style="font-size:.85rem">Paste phone numbers to check against Do-Not-Call registries (TCPA compliance).</p>
      <textarea id="pc-phones" class="ig-textarea" rows="5" placeholder="One phone number per line:\n+18005551234\n+12125559876"></textarea>
      <button class="btn btn-primary" id="pc-dnc-btn" style="margin-top:8px">📵 Check DNC</button>
      <div id="pc-dnc-result" style="margin-top:10px"></div>
    </div>
    <div class="ig-form-card">
      <h3>✅ Consent Validator</h3>
      <p style="font-size:.85rem">Validate consent records against GDPR, CCPA, and CAN-SPAM requirements.</p>
      <textarea id="pc-consent" class="ig-textarea" rows="5" placeholder='[{"email":"a@b.com","consent_date":"2024-01-01","consent_source":"web_form","consent_explicit":true}]'></textarea>
      <select id="pc-jurisdictions" class="ig-select"><option value="EU_GDPR">EU GDPR</option><option value="US_CCPA">US CCPA</option><option value="CAN_SPAM">CAN-SPAM</option></select>
      <button class="btn btn-primary" id="pc-consent-btn" style="margin-top:8px">✅ Validate</button>
      <div id="pc-consent-result" style="margin-top:10px"></div>
    </div>
  </div>
</div>
<div id="pc-audit" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:520px">
    <h3>🔍 Full Compliance Audit</h3>
    <label>List Type<input type="text" id="pc-list-type" class="ig-input" placeholder="email marketing list / SMS subscribers / lead database"></label>
    <label>Channels<input type="text" id="pc-channels" class="ig-input" placeholder="email, sms, phone"></label>
    <label>Jurisdictions (comma-separated)<input type="text" id="pc-jur" class="ig-input" value="EU_GDPR, US_CCPA, CAN_SPAM, TCPA"></label>
    <button class="btn btn-primary" id="pc-audit-btn">🔍 Run AI Audit</button>
    <div id="pc-audit-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="pc-history" class="ig-tab-panel hidden">
  <div id="pc-history-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'pc-history') loadHistory();
    }));

    function riskBadge(r) { return `<span class="badge badge-${r === 'high' || r === 'critical' ? 'danger' : r === 'medium' ? 'warning' : 'success'}">${r}</span>`; }

    el.querySelector('#pc-scrub-btn').addEventListener('click', async () => {
      let contacts;
      try { contacts = JSON.parse(el.querySelector('#pc-contacts').value); } catch { contacts = []; }
      if (!contacts.length) { el.querySelector('#pc-scrub-result').innerHTML = `<div class="ig-alert ig-alert-danger">Paste valid JSON array of contacts</div>`; return; }
      const d = await _api('/api/privacy-compliance/scrub', { method: 'POST', body: JSON.stringify({ contacts }) });
      const res = el.querySelector('#pc-scrub-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.risk_level === 'low' ? 'success' : 'warning'}">Scanned ${d.input_count} contacts — ${d.flagged_count} flagged · Risk: ${riskBadge(d.risk_level)}<br>Issues found: ${d.issues.join(', ') || 'none'}</div>`;
    });

    el.querySelector('#pc-dnc-btn').addEventListener('click', async () => {
      const phones = el.querySelector('#pc-phones').value.split('\n').map(s => s.trim()).filter(Boolean);
      if (!phones.length) return;
      const d = await _api('/api/privacy-compliance/check-dnc', { method: 'POST', body: JSON.stringify({ phone_numbers: phones }) });
      const res = el.querySelector('#pc-dnc-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.flagged === 0 ? 'success' : 'warning'}">Checked ${d.checked} numbers — ${d.flagged} DNC-flagged · ${d.safe} safe to contact</div>
        ${d.results.filter(r => r.status === 'do_not_contact').map(r => `<div style="font-size:.82rem;color:#c00">⛔ ${_esc(r.phone)} — ${_esc(r.reason || 'DNC flagged')}</div>`).join('')}`;
    });

    el.querySelector('#pc-consent-btn').addEventListener('click', async () => {
      let contacts;
      try { contacts = JSON.parse(el.querySelector('#pc-consent').value); } catch { contacts = []; }
      if (!contacts.length) return;
      const j = el.querySelector('#pc-jurisdictions').value;
      const d = await _api('/api/privacy-compliance/validate-consent', { method: 'POST', body: JSON.stringify({ contacts, jurisdictions: [j] }) });
      const res = el.querySelector('#pc-consent-result');
      if (d.ok) res.innerHTML = `<div class="ig-alert ig-alert-${d.non_compliant === 0 ? 'success' : 'warning'}">✅ ${d.compliant} compliant · ⚠️ ${d.non_compliant} non-compliant for ${j}</div>`;
    });

    el.querySelector('#pc-audit-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#pc-audit-btn');
      btn.disabled = true; btn.textContent = '⏳ Auditing…';
      const d = await _api('/api/privacy-compliance/audit', { method: 'POST', body: JSON.stringify({ list_type: el.querySelector('#pc-list-type').value, channels: el.querySelector('#pc-channels').value.split(',').map(s => s.trim()), jurisdictions: el.querySelector('#pc-jur').value.split(',').map(s => s.trim()) }) });
      btn.disabled = false; btn.textContent = '🔍 Run AI Audit';
      const res = el.querySelector('#pc-audit-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const a = d.audit;
      res.innerHTML = `<div class="ig-form-card">
        <div class="ig-stats-row"><div class="ig-stat"><div class="ig-stat-val">${a.estimated_compliance_score || 0}/100</div><div class="ig-stat-label">Compliance Score</div></div><div class="ig-stat"><div class="ig-stat-val">${riskBadge(a.overall_risk)}</div><div class="ig-stat-label">Overall Risk</div></div></div>
        <p style="font-size:.9rem;margin:12px 0">${_esc(a.summary)}</p>
        <h4>Required Actions</h4>
        ${(a.required_actions || []).map(act => `<div class="ig-card" style="margin-bottom:8px;border-left:4px solid ${act.urgency === 'immediate' ? '#ef4444' : '#f59e0b'}">
          <div><strong>${_esc(act.action)}</strong> · <span class="badge badge-info">${_esc(act.jurisdiction)}</span> · <span class="badge badge-${act.urgency === 'immediate' ? 'danger' : 'warning'}">${_esc(act.urgency)}</span></div>
          <div style="font-size:.85rem;margin-top:4px">${_esc(act.description)}</div>
        </div>`).join('')}
      </div>`;
    });

    async function loadHistory() {
      const d = await _api('/api/privacy-compliance/history');
      const c = el.querySelector('#pc-history-list');
      if (!d.ok || !d.history.length) { c.innerHTML = '<div class="ig-empty">No compliance checks yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Type</th><th>Jurisdiction</th><th>Input</th><th>Flagged</th><th>Risk</th><th>Date</th></tr></thead><tbody>` +
        d.history.map(h => `<tr><td>${_esc(h.check_type)}</td><td>${_esc(h.jurisdiction || '—')}</td><td>${h.input_count || 0}</td><td>${h.flagged_count || 0}</td><td>${riskBadge(h.risk_level || 'low')}</td><td>${_ts(h.created_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T110 — BRAND DNA / BYOM
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildBrandDna = async function () {
    const el = document.getElementById('view-brand-dna');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🧬 Brand DNA &amp; Custom AI Training</h1><p>Train InfoGenie on your best-performing ads, emails, and brand guidelines — generating a Brand DNA profile that powers all future AI outputs in your exact voice.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="dna-profile">Brand Profile</button><button class="ig-tab" data-tab="dna-assets">Training Assets</button><button class="ig-tab" data-tab="dna-generate">AI Generate</button><button class="ig-tab" data-tab="dna-score">Score Content</button></div>
<div id="dna-profile" class="ig-tab-panel"><div id="dna-profile-content"><div class="ig-spinner">Loading…</div></div></div>
<div id="dna-assets" class="ig-tab-panel hidden">
  <div class="ig-toolbar"><button class="btn btn-primary" id="dna-add-asset">+ Add Training Asset</button></div>
  <div id="dna-asset-list"><div class="ig-spinner">Loading…</div></div>
</div>
<div id="dna-generate" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:520px">
    <h3>Generate On-Brand Content</h3>
    <label>Content Type<select id="dna-ct" class="ig-select"><option value="ad_headline">Ad Headline</option><option value="ad_copy">Ad Copy</option><option value="email_subject">Email Subject</option><option value="email_body">Email Body</option><option value="social_post">Social Post</option><option value="landing_page_hero">Landing Page Hero</option><option value="cta">CTA Button</option><option value="video_script">Video Script</option></select></label>
    <label>Topic<input type="text" id="dna-topic" class="ig-input" placeholder="Black Friday sale / Product launch / Q4 campaign"></label>
    <label>Length<select id="dna-length" class="ig-select"><option value="short">Short (&lt;50 words)</option><option value="medium" selected>Medium (50–150 words)</option><option value="long">Long (150+ words)</option></select></label>
    <label>Variants<input type="number" id="dna-variants" class="ig-input" value="3" min="1" max="5"></label>
    <button class="btn btn-primary" id="dna-gen-btn">✨ Generate in My Brand Voice</button>
    <div id="dna-gen-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="dna-score" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:520px">
    <h3>Score Content Against Brand DNA</h3>
    <textarea id="dna-score-content" class="ig-textarea" rows="5" placeholder="Paste any ad copy, email, or social post to score it against your Brand DNA…"></textarea>
    <button class="btn btn-primary" id="dna-score-btn">📊 Score This Content</button>
    <div id="dna-score-result" style="margin-top:12px"></div>
  </div>
</div>`;

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dna-assets') loadAssets();
    }));

    async function loadProfile() {
      const d = await _api('/api/brand-dna/profile');
      const c = el.querySelector('#dna-profile-content');
      if (!d.ok || !d.profile) {
        const assets = await _api('/api/brand-dna/assets');
        c.innerHTML = `<div class="ig-empty">
          <p>No Brand DNA profile yet.</p>
          ${(assets.assets || []).length > 0 ? '<button class="btn btn-primary" id="dna-build-btn">🧬 Build Brand DNA Profile Now</button>' : '<p>First, add training assets (your best ads, emails, brand guidelines) on the "Training Assets" tab.</p>'}
        </div>`;
        if (c.querySelector('#dna-build-btn')) {
          c.querySelector('#dna-build-btn').addEventListener('click', async () => {
            c.innerHTML = '<div class="ig-spinner">Analysing your brand assets with GPT-4o…</div>';
            const d2 = await _api('/api/brand-dna/profile/build', { method: 'POST' });
            if (d2.ok) loadProfile(); else c.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d2.error)}</div>`;
          });
        }
        return;
      }
      const p = d.profile;
      const parseJ = s => { try { return JSON.parse(s); } catch { return s ? [s] : []; } };
      c.innerHTML = `<div class="ig-form-card">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <h3>🧬 Your Brand DNA</h3>
          <div><button class="btn btn-sm btn-secondary" id="dna-rebuild">Rebuild Profile</button><div style="font-size:.78rem;color:#888;margin-top:2px">Built from ${p.asset_count} assets · ${_ts(p.generated_at)}</div></div>
        </div>
        <div class="ig-stats-row">
          <div class="ig-stat"><div class="ig-stat-val" style="font-size:1rem">${_esc(p.brand_voice)}</div><div class="ig-stat-label">Brand Voice</div></div>
          <div class="ig-stat"><div class="ig-stat-val" style="font-size:1rem">${_esc(p.sentence_length)}</div><div class="ig-stat-label">Sentence Length</div></div>
          <div class="ig-stat"><div class="ig-stat-val" style="font-size:.9rem">${_esc(p.colour_of_language || '—').slice(0,40)}</div><div class="ig-stat-label">Language Colour</div></div>
        </div>
        <div class="ig-two-col" style="margin-top:16px">
          <div>
            <label>Tone Descriptors</label>
            <div>${parseJ(p.tone_descriptors).map(t => `<span class="badge badge-info" style="margin:2px">${_esc(t)}</span>`).join('')}</div>
            <label style="margin-top:12px">Banned Phrases</label>
            <div>${parseJ(p.banned_phrases).map(t => `<span class="badge badge-danger" style="margin:2px">✗ ${_esc(t)}</span>`).join('')}</div>
          </div>
          <div>
            <label>Example Headlines</label>
            <ul style="font-size:.85rem;padding-left:16px">${parseJ(p.example_headlines).map(h => `<li>${_esc(h)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="ig-two-col" style="margin-top:12px">
          <div><label>Example Hooks</label><ul style="font-size:.85rem;padding-left:16px">${parseJ(p.example_hooks).map(h => `<li>${_esc(h)}</li>`).join('')}</ul></div>
          <div><label>Example CTAs</label><ul style="font-size:.85rem;padding-left:16px">${parseJ(p.example_ctas).map(c2 => `<li>${_esc(c2)}</li>`).join('')}</ul></div>
        </div>
        <label style="margin-top:12px">Writing Style</label>
        <div class="ig-copybox" style="font-size:.85rem">${_esc(p.writing_style)}</div>
      </div>`;
      c.querySelector('#dna-rebuild').addEventListener('click', async () => {
        c.innerHTML = '<div class="ig-spinner">Rebuilding…</div>';
        await _api('/api/brand-dna/profile/build', { method: 'POST' });
        loadProfile();
      });
    }

    async function loadAssets() {
      const d = await _api('/api/brand-dna/assets');
      const c = el.querySelector('#dna-asset-list');
      if (!d.ok || !d.assets.length) { c.innerHTML = '<div class="ig-empty">No training assets yet. Add your best-performing ads, emails, and brand guidelines.</div>'; return; }
      const grouped = {};
      d.assets.forEach(a => { (grouped[a.asset_type] = grouped[a.asset_type] || []).push(a); });
      c.innerHTML = Object.entries(grouped).map(([type, assets]) => `<div style="margin-bottom:16px"><h4 style="text-transform:capitalize">${type.replace(/_/g,' ')}</h4>
        ${assets.map(a => `<div class="ig-card" style="margin-bottom:6px">
          <div class="ig-card-header"><strong>${_esc(a.title)}</strong>${a.performance_metric ? `<span style="font-size:.8rem;color:#666;margin-left:8px">${_esc(a.performance_metric)}: ${a.performance_value || ''}` : ''}</span></div>
          <div style="font-size:.83rem;color:#555">${_esc(a.content.slice(0,150))}…</div>
          <button class="btn btn-sm btn-danger" style="margin-top:6px" data-del="${a.id}">Delete</button>
        </div>`).join('')}
      </div>`).join('');
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await _api('/api/brand-dna/assets/' + b.dataset.del, { method: 'DELETE' }); loadAssets(); }));
    }

    el.querySelector('#dna-add-asset').addEventListener('click', () => {
      const type = prompt('Asset type (winning_ad / top_email / brand_guideline / tone_sample / social_post / video_script):') || 'winning_ad';
      const title = prompt('Title (e.g. "Q3 Meta ad — 4.2x ROAS"):'); if (!title) return;
      const content = prompt('Paste the full content / copy:'); if (!content) return;
      const metric = prompt('Performance metric (e.g. ROAS, open rate) — optional:') || null;
      const value = metric ? prompt('Metric value (e.g. 4.2):') : null;
      _api('/api/brand-dna/assets/add', { method: 'POST', body: JSON.stringify({ asset_type: type, title, content, performance_metric: metric, performance_value: value }) }).then(loadAssets);
    });

    el.querySelector('#dna-gen-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#dna-gen-btn');
      btn.disabled = true; btn.textContent = '⏳ Generating…';
      const d = await _api('/api/brand-dna/generate', { method: 'POST', body: JSON.stringify({ content_type: el.querySelector('#dna-ct').value, topic: el.querySelector('#dna-topic').value, length: el.querySelector('#dna-length').value, variants: +el.querySelector('#dna-variants').value }) });
      btn.disabled = false; btn.textContent = '✨ Generate in My Brand Voice';
      const res = el.querySelector('#dna-gen-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      res.innerHTML = `<div>${d.variants.map((v, i) => `<div class="ig-card" style="margin-bottom:12px"><div class="ig-card-header"><strong>Variant ${i+1}</strong>${d.brand_dna_applied ? '<span class="badge badge-success" style="margin-left:8px">Brand DNA Applied</span>' : ''}</div>
        ${v.headline ? `<div><strong>Headline:</strong> ${_esc(v.headline)}</div>` : ''}
        ${v.hook ? `<div style="font-size:.85rem;color:#666"><strong>Hook:</strong> ${_esc(v.hook)}</div>` : ''}
        <div class="ig-copybox" style="margin:8px 0">${_esc(v.content)}</div>
        ${v.cta ? `<div><strong>CTA:</strong> ${_esc(v.cta)}</div>` : ''}
      </div>`).join('')}</div>`;
    });

    el.querySelector('#dna-score-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#dna-score-btn');
      btn.disabled = true; btn.textContent = '⏳ Scoring…';
      const d = await _api('/api/brand-dna/score', { method: 'POST', body: JSON.stringify({ content: el.querySelector('#dna-score-content').value }) });
      btn.disabled = false; btn.textContent = '📊 Score This Content';
      const res = el.querySelector('#dna-score-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const s = d.scoring;
      const gradeColour = { A: '#16a34a', B: '#65a30d', C: '#ca8a04', D: '#ea580c', F: '#dc2626' };
      res.innerHTML = `<div class="ig-form-card">
        <div class="ig-stats-row">
          <div class="ig-stat"><div class="ig-stat-val" style="color:${gradeColour[s.grade] || '#000'}">${s.grade}</div><div class="ig-stat-label">Brand DNA Grade</div></div>
          <div class="ig-stat"><div class="ig-stat-val">${s.score}/100</div><div class="ig-stat-label">On-Brand Score</div></div>
        </div>
        ${s.banned_phrases_found && s.banned_phrases_found.length ? `<div class="ig-alert ig-alert-danger" style="margin-top:10px">⛔ Banned phrases found: ${s.banned_phrases_found.map(p => `"${_esc(p)}"`).join(', ')}</div>` : ''}
        ${s.off_brand_elements && s.off_brand_elements.length ? `<div style="margin-top:8px"><label>Off-Brand Elements</label><ul>${s.off_brand_elements.map(e => `<li style="font-size:.85rem">${_esc(e)}</li>`).join('')}</ul></div>` : ''}
        <label>Suggested Rewrite</label><div class="ig-copybox">${_esc(s.rewritten_version || '')}</div>
      </div>`;
    });

    loadProfile();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // T111 — VISUAL NO-CODE WORKFLOW BUILDER
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildWorkflowBuilder = async function () {
    const el = document.getElementById('view-workflow-builder');
    if (!el) return;
    el.innerHTML = `<div class="view-header"><h1>🔧 Workflow Automation Builder</h1><p>Visual no-code automation — connect any InfoGenie event to any action (email, Slack, HTTP, AI generate, CRM update) with branching logic and delays. Like Make.com, but inside InfoGenie.</p></div>
<div class="ig-tabs"><button class="ig-tab active" data-tab="wf-list">My Workflows</button><button class="ig-tab" data-tab="wf-create">Create</button><button class="ig-tab" data-tab="wf-ai">AI Builder</button><button class="ig-tab" data-tab="wf-runs">Run History</button></div>
<div id="wf-list" class="ig-tab-panel"><div id="wf-workflows"><div class="ig-spinner">Loading…</div></div></div>
<div id="wf-create" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:660px">
    <h3>New Workflow</h3>
    <label>Workflow Name<input type="text" id="wf-name" class="ig-input" placeholder="e.g. ROAS Drop → Alert + Rebalance Budget"></label>
    <label>Description<textarea id="wf-desc" class="ig-textarea" rows="2" placeholder="What this workflow does…"></textarea></label>
    <label>Trigger<select id="wf-trigger" class="ig-select">
      <option value="manual">Manual trigger</option>
      <option value="schedule">Schedule (cron)</option>
      <option value="webhook">Inbound webhook</option>
      <option value="event_lead_created">Event: Lead created</option>
      <option value="event_ad_rejected">Event: Ad rejected</option>
      <option value="event_roas_drop">Event: ROAS drop</option>
      <option value="event_competitor_change">Event: Competitor change</option>
    </select></label>
    <div id="wf-nodes-editor" style="margin:16px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h4 style="margin:0">Workflow Steps</h4><button class="btn btn-sm btn-secondary" id="wf-add-node">+ Add Step</button></div>
      <div id="wf-node-list" style="min-height:40px;border:1px dashed #d1d5db;border-radius:8px;padding:12px"></div>
    </div>
    <button class="btn btn-primary" id="wf-save-btn">💾 Save Workflow</button>
    <div id="wf-save-result" style="margin-top:10px"></div>
  </div>
</div>
<div id="wf-ai" class="ig-tab-panel hidden">
  <div class="ig-form-card" style="max-width:560px">
    <h3>🤖 AI Workflow Builder</h3>
    <p style="font-size:.87rem;color:#666">Describe what you want to automate in plain English. AI will build the workflow for you.</p>
    <textarea id="wf-ai-desc" class="ig-textarea" rows="4" placeholder="When a new lead is created, wait 5 minutes, then send them a welcome email, post to Slack, and if their score is > 80, also create a HubSpot deal…"></textarea>
    <button class="btn btn-primary" id="wf-ai-btn">✨ Build Workflow with AI</button>
    <div id="wf-ai-result" style="margin-top:12px"></div>
  </div>
</div>
<div id="wf-runs" class="ig-tab-panel hidden">
  <div id="wf-run-list"><div class="ig-spinner">Loading…</div></div>
</div>`;

    const wfNodes = [];

    el.querySelectorAll('.ig-tab').forEach(t => t.addEventListener('click', () => {
      el.querySelectorAll('.ig-tab').forEach(x => x.classList.remove('active'));
      el.querySelectorAll('.ig-tab-panel').forEach(x => x.classList.add('hidden'));
      t.classList.add('active');
      el.querySelector('#' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'wf-list') loadWorkflows();
      if (t.dataset.tab === 'wf-runs') loadRuns();
    }));

    function renderNodes() {
      const c = el.querySelector('#wf-node-list');
      if (!wfNodes.length) { c.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:.87rem;padding:8px">No steps yet — add a step above</div>'; return; }
      c.innerHTML = wfNodes.map((n, i) => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
        <span style="font-weight:700;color:#6366f1;min-width:24px">${i+1}</span>
        <span style="flex:1"><strong>${_esc(n.label || n.type)}</strong> <span style="font-size:.8rem;color:#6b7280">(${_esc(n.type)})</span></span>
        <button class="btn btn-sm btn-danger" data-rm="${i}">✕</button>
      </div>`).join('');
      c.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { wfNodes.splice(+b.dataset.rm, 1); renderNodes(); }));
    }

    el.querySelector('#wf-add-node').addEventListener('click', () => {
      const types = ['action_send_email', 'action_post_slack', 'action_http_webhook', 'action_ai_generate', 'action_tag_contact', 'action_create_campaign', 'condition_if', 'delay_wait', 'split_ab'];
      const type = prompt(`Step type:\n${types.join('\n')}`); if (!type || !types.includes(type)) return;
      const label = prompt('Step label (short description):') || type;
      const node = { type, label, config: {} };
      if (type === 'action_send_email') { node.config.to = prompt('To email:') || ''; node.config.subject = prompt('Subject:') || ''; }
      if (type === 'action_post_slack') { node.config.message = prompt('Slack message:') || ''; }
      if (type === 'action_http_webhook') { node.config.url = prompt('Webhook URL:') || ''; node.config.method = 'POST'; }
      if (type === 'action_ai_generate') { node.config.prompt = prompt('AI prompt:') || ''; }
      if (type === 'delay_wait') { node.config.duration = prompt('Duration (e.g. 5m, 1h, 1d):') || '5m'; }
      if (type === 'condition_if') { node.config.condition = prompt('Condition (e.g. lead.score > 80):') || ''; }
      wfNodes.push(node);
      renderNodes();
    });

    el.querySelector('#wf-save-btn').addEventListener('click', async () => {
      const name = el.querySelector('#wf-name').value;
      if (!name) { el.querySelector('#wf-save-result').innerHTML = `<div class="ig-alert ig-alert-danger">Workflow name is required</div>`; return; }
      const d = await _api('/api/workflow-builder/create', { method: 'POST', body: JSON.stringify({ name, description: el.querySelector('#wf-desc').value, trigger_type: el.querySelector('#wf-trigger').value, nodes: wfNodes }) });
      const res = el.querySelector('#wf-save-result');
      if (d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-success">✅ Workflow saved!</div>`; wfNodes.length = 0; renderNodes(); loadWorkflows(); }
      else { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; }
    });

    el.querySelector('#wf-ai-btn').addEventListener('click', async () => {
      const btn = el.querySelector('#wf-ai-btn');
      btn.disabled = true; btn.textContent = '⏳ Building…';
      const d = await _api('/api/workflow-builder/ai-build', { method: 'POST', body: JSON.stringify({ description: el.querySelector('#wf-ai-desc').value }) });
      btn.disabled = false; btn.textContent = '✨ Build Workflow with AI';
      const res = el.querySelector('#wf-ai-result');
      if (!d.ok) { res.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }
      const w = d.workflow;
      res.innerHTML = `<div class="ig-form-card">
        <h4>${_esc(w.name)}</h4>
        <div class="ig-card-meta">Trigger: <code>${_esc(w.trigger_type)}</code> · Est. time: ${_esc(w.estimated_time_to_complete)}</div>
        <div style="margin:10px 0">${(w.nodes || []).map((n, i) => `<div class="ig-step-row"><span class="ig-step-num">${i+1}</span><strong>${_esc(n.label)}</strong> <span style="font-size:.8rem;color:#6b7280">(${_esc(n.type)})</span></div>`).join('')}</div>
        <button class="btn btn-success" id="wf-ai-save">Save This Workflow</button>
      </div>`;
      res.querySelector('#wf-ai-save').addEventListener('click', async () => {
        const d2 = await _api('/api/workflow-builder/create', { method: 'POST', body: JSON.stringify(w) });
        if (d2.ok) { alert('Workflow saved!'); loadWorkflows(); }
      });
    });

    async function loadWorkflows() {
      const d = await _api('/api/workflow-builder/list');
      const c = el.querySelector('#wf-workflows');
      if (!d.ok || !d.workflows.length) { c.innerHTML = '<div class="ig-empty">No workflows yet. Create one above or use the AI builder.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Name</th><th>Trigger</th><th>Active</th><th>Runs</th><th>Success</th><th>Last Run</th><th>Actions</th></tr></thead><tbody>` +
        d.workflows.map(w => `<tr>
          <td><strong>${_esc(w.name)}</strong>${w.description ? `<div style="font-size:.8rem;color:#666">${_esc(w.description)}</div>` : ''}</td>
          <td><code style="font-size:.8rem">${_esc(w.trigger_type)}</code></td>
          <td>${w.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-neutral">Off</span>'}</td>
          <td>${w.run_count}</td>
          <td>${w.success_count}</td>
          <td>${_ts(w.last_run_at)}</td>
          <td>
            <button class="btn btn-sm btn-primary" data-run="${w.id}">▶ Run</button>
            <button class="btn btn-sm btn-secondary" data-toggle="${w.id}">${w.is_active ? 'Pause' : 'Activate'}</button>
            <button class="btn btn-sm btn-danger" data-del="${w.id}">Del</button>
          </td>
        </tr>`).join('') + '</tbody></table>';
      c.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '⏳';
        const d2 = await _api('/api/workflow-builder/' + b.dataset.run + '/run', { method: 'POST' });
        b.disabled = false; b.textContent = '▶ Run';
        alert(`Workflow run: ${d2.status} · ${d2.steps ? d2.steps.length : 0} steps executed`);
        loadWorkflows();
      }));
      c.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', async () => { await _api('/api/workflow-builder/' + b.dataset.toggle + '/toggle', { method: 'POST' }); loadWorkflows(); }));
      c.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Delete workflow?')) return; await _api('/api/workflow-builder/' + b.dataset.del, { method: 'DELETE' }); loadWorkflows(); }));
    }

    async function loadRuns() {
      const d = await _api('/api/workflow-builder/runs/all');
      const c = el.querySelector('#wf-run-list');
      if (!d.ok || !d.runs.length) { c.innerHTML = '<div class="ig-empty">No workflow runs yet.</div>'; return; }
      c.innerHTML = `<table class="ig-table"><thead><tr><th>Workflow</th><th>Status</th><th>Started</th><th>Completed</th></tr></thead><tbody>` +
        d.runs.map(r => `<tr><td>${_esc(r.workflow_name)}</td><td>${_badge(r.status, STATUS_MAP)}</td><td>${_ts(r.started_at)}</td><td>${_ts(r.completed_at)}</td></tr>`).join('') +
        '</tbody></table>';
    }

    renderNodes();
    loadWorkflows();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ROI LEDGER — Autonomous AI ROI Proof Dashboard
  // ═══════════════════════════════════════════════════════════════════════════
  window.buildRoiLedger = async function () {
    const el = document.getElementById('view-roi-ledger');
    if (!el) return;

    el.innerHTML = `<div class="view-header" style="border-bottom:none;padding-bottom:0">
      <h1 style="font-size:1.6rem">💰 AI ROI Ledger</h1>
      <p style="color:#6b7280;max-width:560px">Every dollar the AI earned or saved while you weren't watching — budget shifts, ad heals, content published, journeys fired. Your digital employee's payslip.</p>
    </div>
    <div id="rl-days-bar" style="display:flex;gap:8px;margin:16px 0 0">
      ${[7,14,30,90].map(d => `<button class="btn btn-sm ${d===30?'btn-primary':'btn-secondary'}" data-days="${d}">${d}d</button>`).join('')}
      <button class="btn btn-sm btn-secondary" id="rl-seed-btn" style="margin-left:auto">🌱 Load demo data</button>
      <button class="btn btn-sm btn-secondary" id="rl-log-btn">+ Log action</button>
    </div>
    <div id="rl-body"><div class="ig-spinner" style="margin:40px auto"></div></div>`;

    let currentDays = 30;
    let currentModule = null;

    async function load() {
      const d = await _api(`/api/roi-ledger/dashboard?days=${currentDays}`);
      const body = el.querySelector('#rl-body');
      if (!d.ok) { body.innerHTML = `<div class="ig-alert ig-alert-danger">${_esc(d.error)}</div>`; return; }

      const tot = d.totals;
      const earned = parseFloat(tot.estimated_total) || 0;
      const actions = parseInt(tot.action_count) || 0;
      const mods    = parseInt(tot.modules_active) || 0;

      // If empty, show friendly empty state
      if (actions === 0) {
        body.innerHTML = `<div style="text-align:center;padding:60px 20px">
          <div style="font-size:4rem;margin-bottom:12px">🤖</div>
          <h2 style="color:#1e293b">No AI actions yet</h2>
          <p style="color:#6b7280;max-width:400px;margin:0 auto 20px">The ledger auto-fills as the AI Optimizer, Budget Arbitrage, Self-Healing Ads, Agent Swarm, and Journeys take action.</p>
          <button class="btn btn-primary" id="rl-seed-empty">🌱 Load 30 days of demo data</button>
        </div>`;
        body.querySelector('#rl-seed-empty').addEventListener('click', async () => {
          await _api('/api/roi-ledger/seed', { method: 'POST' });
          load();
        });
        return;
      }

      // ── Hero row ──────────────────────────────────────────────────────────
      body.innerHTML = `
        <div id="rl-hero" style="background:linear-gradient(135deg,#1e1b4b,#312e81,#4c1d95);border-radius:16px;padding:28px 32px;margin:16px 0;color:#fff;display:flex;align-items:center;gap:32px;flex-wrap:wrap">
          <div>
            <div style="font-size:.85rem;opacity:.75;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">AI earned &amp; saved you (${currentDays}d)</div>
            <div style="font-size:3rem;font-weight:900;line-height:1;letter-spacing:-.02em">$${Math.round(earned).toLocaleString()}</div>
            <div style="font-size:.85rem;opacity:.7;margin-top:6px">estimated value across ${actions.toLocaleString()} autonomous actions</div>
          </div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;margin-left:auto">
            <div style="text-align:center"><div style="font-size:1.8rem;font-weight:800">${actions}</div><div style="font-size:.78rem;opacity:.7">AI Actions</div></div>
            <div style="text-align:center"><div style="font-size:1.8rem;font-weight:800">${mods}</div><div style="font-size:.78rem;opacity:.7">Modules Active</div></div>
            <div style="text-align:center"><div style="font-size:1.8rem;font-weight:800">$${actions > 0 ? Math.round(earned / actions) : 0}</div><div style="font-size:.78rem;opacity:.7">Avg per Action</div></div>
            <div style="text-align:center"><div style="font-size:1.8rem;font-weight:800">${Math.round((earned / Math.max(currentDays,1)) * 365).toLocaleString()}</div><div style="font-size:.78rem;opacity:.7">Projected / Year</div></div>
          </div>
        </div>

        <div class="ig-two-col" style="gap:16px;margin:0 0 16px">
          <div class="ig-form-card" style="padding:20px">
            <h4 style="margin:0 0 14px;font-size:.9rem;text-transform:uppercase;letter-spacing:.06em;color:#6366f1">Value by AI Module</h4>
            <div id="rl-module-bars"></div>
          </div>
          <div class="ig-form-card" style="padding:20px">
            <h4 style="margin:0 0 14px;font-size:.9rem;text-transform:uppercase;letter-spacing:.06em;color:#6366f1">Daily AI Actions (${currentDays}d)</h4>
            <canvas id="rl-chart" height="160"></canvas>
          </div>
        </div>

        <div class="ig-form-card" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;gap:8px;padding:14px 20px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap">
            <h4 style="margin:0;font-size:.9rem;font-weight:700">AI Action Feed</h4>
            <div style="display:flex;gap:6px;margin-left:8px;flex-wrap:wrap" id="rl-module-tabs">
              <button class="btn btn-sm ${!currentModule?'btn-primary':'btn-secondary'}" data-mod="">All</button>
              ${d.by_module.map(m => `<button class="btn btn-sm ${currentModule===m.module?'btn-primary':'btn-secondary'}" data-mod="${_esc(m.module)}">${m.meta.icon} ${m.meta.label}</button>`).join('')}
            </div>
          </div>
          <div id="rl-feed"></div>
        </div>`;

      // ── Module bars ───────────────────────────────────────────────────────
      const mbContainer = body.querySelector('#rl-module-bars');
      const maxVal = Math.max(...d.by_module.map(m => parseFloat(m.value_sum) || 0), 1);
      mbContainer.innerHTML = d.by_module.map(m => {
        const pct = Math.round((parseFloat(m.value_sum) / maxVal) * 100);
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-bottom:3px">
            <span>${m.meta.icon} ${m.meta.label}</span>
            <span style="font-weight:700">$${Math.round(parseFloat(m.value_sum)).toLocaleString()} · ${m.n} actions</span>
          </div>
          <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${m.meta.colour};border-radius:4px;transition:width .5s ease"></div>
          </div>
        </div>`;
      }).join('');

      // ── Day chart ─────────────────────────────────────────────────────────
      const canvas = body.querySelector('#rl-chart');
      if (canvas && window.Chart) {
        const labels = d.by_day.map(r => new Date(r.day).toLocaleDateString('en', { month:'short', day:'numeric' }));
        const vals   = d.by_day.map(r => parseFloat(r.value_sum) || 0);
        if (canvas._chartInst) canvas._chartInst.destroy();
        canvas._chartInst = new Chart(canvas, {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              data: vals,
              backgroundColor: 'rgba(99,102,241,0.25)',
              borderColor: '#6366f1',
              borderWidth: 1.5,
              borderRadius: 3,
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `$${Math.round(ctx.raw).toLocaleString()} AI value` } } },
            scales: {
              x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
              y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: v => '$' + Math.round(v) } },
            }
          }
        });
      }

      // ── Module tab filter ─────────────────────────────────────────────────
      body.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => {
        currentModule = b.dataset.mod || null;
        body.querySelectorAll('[data-mod]').forEach(x => x.classList.replace('btn-primary', 'btn-secondary'));
        b.classList.replace('btn-secondary', 'btn-primary');
        renderFeed(d.recent);
      }));

      renderFeed(d.recent);

      function renderFeed(actions) {
        const feed = body.querySelector('#rl-feed');
        const filtered = currentModule ? actions.filter(a => a.module === currentModule) : actions;
        if (!filtered.length) { feed.innerHTML = '<div class="ig-empty">No actions in this filter.</div>'; return; }
        feed.innerHTML = filtered.map(a => {
          const meta = d.module_meta[a.module] || d.module_meta.other;
          const val  = parseFloat(a.estimated_value) || 0;
          return `<div style="display:flex;align-items:flex-start;gap:14px;padding:14px 20px;border-bottom:1px solid #f8fafc">
            <div style="width:38px;height:38px;border-radius:50%;background:${meta.colour}18;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${meta.icon}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:.9rem;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(a.title)}</div>
              ${a.description ? `<div style="font-size:.82rem;color:#64748b;margin-top:2px;line-height:1.4">${_esc(a.description.slice(0,160))}${a.description.length>160?'…':''}</div>` : ''}
              <div style="font-size:.76rem;color:#94a3b8;margin-top:4px">${meta.label} · ${_ts(a.created_at)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:1.05rem;font-weight:800;color:#16a34a">+$${Math.round(val).toLocaleString()}</div>
              ${a.actual_value ? `<div style="font-size:.75rem;color:#0ea5e9;margin-top:2px">Verified: $${Math.round(a.actual_value).toLocaleString()}</div>` : `<button class="btn btn-sm btn-secondary" style="margin-top:4px;font-size:.72rem;padding:2px 8px" data-verify="${a.id}">✓ Verify</button>`}
            </div>
          </div>`;
        }).join('');
        feed.querySelectorAll('[data-verify]').forEach(b => b.addEventListener('click', () => {
          const val = prompt('Actual value this action delivered ($):'); if (!val) return;
          _api('/api/roi-ledger/resolve/' + b.dataset.verify, { method: 'POST', body: JSON.stringify({ actual_value: +val, status: 'verified' }) }).then(load);
        }));
      }
    }

    // ── Day filter buttons ────────────────────────────────────────────────────
    el.querySelectorAll('[data-days]').forEach(b => b.addEventListener('click', () => {
      el.querySelectorAll('[data-days]').forEach(x => x.classList.replace('btn-primary','btn-secondary'));
      b.classList.replace('btn-secondary','btn-primary');
      currentDays = +b.dataset.days;
      el.querySelector('#rl-body').innerHTML = '<div class="ig-spinner" style="margin:40px auto"></div>';
      load();
    }));

    el.querySelector('#rl-seed-btn').addEventListener('click', async () => {
      const b = el.querySelector('#rl-seed-btn');
      b.disabled = true; b.textContent = '⏳ Loading…';
      await _api('/api/roi-ledger/seed', { method: 'POST' });
      b.disabled = false; b.textContent = '🌱 Load demo data';
      load();
    });

    el.querySelector('#rl-log-btn').addEventListener('click', () => {
      const module    = prompt('Module (optimizer / budget_arbitrage / self_healing / agent_swarm / autoseo / journey / workflow):') || 'other';
      const title     = prompt('Action title:'); if (!title) return;
      const desc      = prompt('Description (optional):') || '';
      const val       = +prompt('Estimated value ($):') || 0;
      _api('/api/roi-ledger/log', { method: 'POST', body: JSON.stringify({ action_type: 'manual', module, title, description: desc, estimated_value: val }) }).then(load);
    });

    load();
  };

  // ── navigateTo hooks ───────────────────────────────────────────────────────
  const _origNav = window.navigateTo;
  window.navigateTo = function (view) {
    if (_origNav) _origNav(view);
    const builders = {
      'agent-swarm':        window.buildAgentSwarm,
      'self-healing':       window.buildSelfHealing,
      'budget-arbitrage':   window.buildBudgetArbitrage,
      'ss-events':          window.buildSsEvents,
      'ctv':                window.buildCtv,
      'rcs':                window.buildRcs,
      'llm-kb':             window.buildLlmKb,
      'privacy-compliance': window.buildPrivacyCompliance,
      'brand-dna':          window.buildBrandDna,
      'workflow-builder':   window.buildWorkflowBuilder,
      'roi-ledger':         window.buildRoiLedger,
    };
    if (builders[view]) builders[view]();
  };
})();

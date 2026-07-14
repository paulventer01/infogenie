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


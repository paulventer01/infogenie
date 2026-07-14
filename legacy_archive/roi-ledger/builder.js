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


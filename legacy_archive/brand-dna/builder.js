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


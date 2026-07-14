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


// ============================================================================
// InfoGenie — extracted feature module: Creator Studio + Engagement + Commerce
// ----------------------------------------------------------------------------
// PART OF THE app.js SPLIT (see public/js/README.md). This file was carved out
// of the monolithic app.js with NO behavior change. Conventions:
//   • Classic <script> (NOT an ES module). Loaded from index.html AFTER app.js
//     with its own ?v= cache-bust string, so editing this feature only forces a
//     re-download of THIS file, not the whole 50k-line app.js.
//   • Every public entry point stays attached to window (e.g. window.buildX),
//     exactly as before, so navigateTo()'s dispatch and inline onclick= handlers
//     keep resolving. Feature-private helpers stay inside the IIFE.
//   • Shared globals (showToast, navigateTo, _esc, _safeUrl, analysisData, …)
//     are defined in app.js and are available here at call time.
// ============================================================================

// ════════════════════════════════════════════════════════════════════════════
// CREATOR STUDIO + ENGAGEMENT + COMMERCE — frontend builders
// (Brand Identity · Image Toolkit · AI Video · Presentations · Email Signature
//  WhatsApp · AI Voice Caller · Bookings · Site Builder · Link-in-Bio)
// ════════════════════════════════════════════════════════════════════════════

(function studioPack(){
  // ── Shared helpers ────────────────────────────────────────────────────────
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function _h(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }
  function _shell(viewId, title, subtitle, body){
    const v=document.getElementById('view-'+viewId);
    v.innerHTML = `<div class="view-header"><div class="container"><div class="vh-inner">
      <div><h1 style="margin:0;font-size:28px;font-weight:800">${title}</h1>
      <p style="margin:6px 0 0;color:#64748B">${subtitle}</p></div></div></div></div>
      <div class="container" style="padding:24px 0 64px">${body}</div>`;
    return v;
  }
  function _toast(msg, kind='ok'){
    const el=_h(`<div style="position:fixed;bottom:24px;right:24px;background:${kind==='err'?'#DC2626':'#0F766E'};color:white;padding:12px 20px;border-radius:10px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:99999">${_esc(msg)}</div>`);
    document.body.appendChild(el); setTimeout(()=>el.remove(),3200);
  }
  function _modal(title, bodyHtml, opts={}){
    const wrap=_h(`<div style="position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto" id="_studio_modal">
      <div style="background:white;border-radius:16px;max-width:${opts.width||640}px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
          <h2 style="margin:0;font-size:20px;font-weight:800">${_esc(title)}</h2>
          <button onclick="document.getElementById('_studio_modal').remove()" style="background:none;border:0;font-size:24px;cursor:pointer;color:#64748B">×</button>
        </div>
        <div id="_studio_modal_body">${bodyHtml}</div>
      </div></div>`);
    document.body.appendChild(wrap);
    wrap.addEventListener('click',e=>{ if(e.target===wrap) wrap.remove(); });
    return wrap;
  }
  async function _api(path, opts={}){
    const r=await fetch(path,{ headers:{'Content-Type':'application/json'}, ...opts, body: opts.body?JSON.stringify(opts.body):undefined });
    const j=await r.json().catch(()=>({ok:false,error:'Bad JSON'}));
    if(!j.ok && j.error) throw new Error(j.error);
    return j;
  }

  // ── 1. STUDIO HUB (10 tiles) ──────────────────────────────────────────────
  const TILES = [
    { id:'brand',     icon:'🎨', title:'Brand Identity',   desc:'Logo brief, palette, business names, slogans — all AI-generated.', action:()=>openBrandStudio() },
    { id:'image',     icon:'🖼️', title:'Image Toolkit',     desc:'Background remove, upscale, sketch→image, product photos.',       action:()=>openImageStudio() },
    { id:'video',     icon:'🎬', title:'AI Video',          desc:'Storyboard a 15-second ad video for Meta / TikTok / YouTube.',    action:()=>openVideoStudio() },
    { id:'pres',      icon:'📑', title:'AI Presentation',   desc:'Pitch decks and slide decks generated from a topic.',             action:()=>openPresentationStudio() },
    { id:'sig',       icon:'✍️', title:'Email Signature',   desc:'Branded HTML signature with open + click tracking.',              action:()=>openSignatureStudio() },
    { id:'case',      icon:'📰', title:'Case Study Builder', desc:'Turn a customer story into a polished case study + share page.', action:()=>openCaseStudyStudio() },
    { id:'insights',  icon:'📊', title:'Page Insights',     desc:'How far visitors scroll on your landing & bio pages — and what they search for.', action:()=>openPageInsightsStudio() },
    { id:'annot',     icon:'📌', title:'SEO Change Log',    desc:'Log content / technical / on-page changes and overlay them on every chart.', action:()=>openSeoAnnotationsStudio() },
    { id:'whatsapp',  icon:'💬', title:'WhatsApp Channel',  desc:'Send WhatsApp messages and reply to inbound chats.',              action:()=>navigateTo('whatsapp') },
    { id:'voice',     icon:'📞', title:'AI Voice Caller',   desc:'Outbound voice agent that calls leads and books meetings.',       action:()=>navigateTo('voice-caller') },
    { id:'bookings',  icon:'📅', title:'Bookings',          desc:'Public booking page with email confirmation.',                    action:()=>navigateTo('bookings') },
    { id:'site',      icon:'🧱', title:'Site Builder',      desc:'No-code landing pages — generate full pages from a brief.',       action:()=>navigateTo('site-builder') },
    { id:'linksell',  icon:'🔗', title:'Link-in-Bio + Sell', desc:'Public bio page with links, lead opt-in, and Stripe checkout.',  action:()=>navigateTo('linksell') },
  ];
  window.buildStudio = function(){
    const tiles = TILES.map(t=>`
      <button class="studio-tile" data-id="${t.id}" style="text-align:left;background:white;border:1.5px solid #E5E7EB;border-radius:14px;padding:24px;cursor:pointer;transition:all .15s;font-family:inherit">
        <div style="font-size:36px;margin-bottom:12px">${t.icon}</div>
        <div style="font-weight:800;font-size:17px;color:#0F172A;margin-bottom:6px">${_esc(t.title)}</div>
        <div style="color:#64748B;font-size:13px;line-height:1.5">${_esc(t.desc)}</div>
      </button>`).join('');
    _shell('studio','🎨 Creator Studio','Brand kit, content & engagement tools — all AI-powered.',`
      <style>.studio-tile:hover{border-color:#0066FF;transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,102,255,.08)}</style>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${tiles}</div>`);
    document.querySelectorAll('.studio-tile').forEach(b=>b.addEventListener('click',()=>{
      const t=TILES.find(x=>x.id===b.dataset.id); t&&t.action();
    }));
  };

  // ── Shared AI Suggest helpers (uses last analysed brand + competitors) ────
  function _studioCtx(){
    const ad = window.analysisData || {};
    const _domainToBrand = u => { try { const h = String(u||'').replace(/^https?:\/\//,'').split('/')[0].split('.'); const core = (h.length>=2?h[h.length-2]:h[0])||''; return core.charAt(0).toUpperCase()+core.slice(1); } catch { return ''; } };
    const mainBrand = _domainToBrand(ad.url);
    const competitors = (Array.isArray(ad.competitors)?ad.competitors:[]).filter(c=>c&&(c.name||c.domain)).map(c=>({ name:c.name||_domainToBrand(c.domain), domain:c.domain||'' }));
    return { ad, mainBrand, industry: ad.industry||'', competitors, _domainToBrand };
  }
  // Real, grounded AI suggester for any input field. NEVER returns a
  // hardcoded / placeholder / random string. Throws when the backend can't
  // reach any working LLM — the UI must surface that error verbatim.
  async function _aiSuggestField(field, opts = {}){
    const ctx = _studioCtx();
    const body = {
      field,
      brand: opts.brand ?? ctx.mainBrand ?? '',
      industry: opts.industry ?? ctx.industry ?? '',
      competitors: opts.competitors ?? ctx.competitors ?? [],
      currentValue: opts.currentValue ?? '',
      context: opts.context ?? ''
    };
    const j = await _api('/api/studio/ai-suggest', { method:'POST', body });
    const v = String(j?.value || '').trim();
    if (!v) throw new Error('AI returned an empty suggestion');
    return v;
  }
  function _aiBtn(id, label){
    return `<button type="button" id="${id}" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">🧠 ${label||'AI Suggest'}</button>`;
  }
  function _useBrandBtn(id, label){
    return label ? `<button type="button" id="${id}" style="background:#EEF2FF;color:#4F46E5;border:1px solid #C7D2FE;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">📊 Use "${_esc(label)}"</button>` : '';
  }
  function _labelRow(text, ...btns){
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:8px"><span style="font-weight:600;font-size:13px">${text}</span><span style="display:flex;gap:6px">${btns.filter(Boolean).join('')}</span></div>`;
  }
  // _wireAI(buttonId, inputEl, suggesterFn) — runs the suggester, shows
  // "⏳ Thinking… [N.Ns]" live timer in the input while it runs, and on
  // failure restores the previous text + shows a red inline error AND a
  // toast. We NEVER fill the input with hardcoded fallback content.
  async function _wireAI(btnId, inputEl, suggester){
    const b = document.getElementById(btnId); if (!b) return;
    b.addEventListener('click', async () => {
      const prev = inputEl.value;
      const t0 = performance.now();
      inputEl.value = '⏳ Thinking… [0.0s]';
      inputEl.disabled = true;
      const iv = setInterval(() => {
        if (!inputEl.disabled) return;
        inputEl.value = '⏳ Thinking… [' + ((performance.now()-t0)/1000).toFixed(1) + 's]';
      }, 100);
      try {
        const v = await suggester();
        clearInterval(iv);
        if (!v || !String(v).trim()) throw new Error('AI returned empty value');
        inputEl.value = String(v).trim();
      } catch (e) {
        clearInterval(iv);
        inputEl.value = prev;
        try { if (typeof window.showToast === 'function') window.showToast('AI unavailable: ' + (e && e.message || e), 'error'); } catch {}
        // Inline visible error next to the button so the user immediately
        // sees WHY no value was filled — no silent dummy fallback.
        try {
          let warn = b.nextElementSibling;
          if (!warn || !warn.classList || !warn.classList.contains('_ai_err')){
            warn = document.createElement('div');
            warn.className = '_ai_err';
            warn.style.cssText = 'color:#DC2626;font-size:11px;margin-top:4px;flex-basis:100%';
            b.parentNode.appendChild(warn);
          }
          warn.textContent = '⚠ ' + (e && e.message || 'AI unavailable. Connect an API key in Settings.');
          setTimeout(() => { try { warn.remove(); } catch {} }, 8000);
        } catch {}
      } finally { inputEl.disabled = false; inputEl.focus(); }
    });
  }

  // ── Brand Identity modal ──────────────────────────────────────────────────
  function openBrandStudio(){
    const body = `
      <div style="display:flex;gap:8px;margin-bottom:18px;border-bottom:1px solid #E5E7EB">
        ${['Logo Brief','Palette','Names','Slogans'].map((t,i)=>`<button class="brand-tab" data-i="${i}" style="background:none;border:0;padding:10px 14px;font-weight:600;cursor:pointer;border-bottom:2px solid ${i===0?'#0066FF':'transparent'};color:${i===0?'#0066FF':'#64748B'}">${t}</button>`).join('')}
      </div>
      <div id="brand-pane"></div>`;
    _modal('🎨 Brand Identity Studio', body, { width: 720 });
    const ctx = _studioCtx();
    const fld = (id, val='', ph='') => `<input id="${id}" value="${_esc(val)}" placeholder="${_esc(ph)}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;box-sizing:border-box">`;
    const PANES = [
      `${_labelRow('Brand name', _useBrandBtn('bnUse', ctx.mainBrand), _aiBtn('bnAI'))}${fld('bn', ctx.mainBrand, 'e.g. Acme')}
       ${_labelRow('Industry', _aiBtn('biAI'))}${fld('bi', ctx.industry, 'e.g. SaaS for SMBs')}
       ${_labelRow('Vibe', _aiBtn('bvAI'))}${fld('bv', 'modern minimalist')}
       <button id="go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate logo brief</button>
       <div id="out" style="margin-top:18px"></div>`,
      `${_labelRow('Brand name', _useBrandBtn('pnUse', ctx.mainBrand), _aiBtn('pnAI'))}${fld('pn', ctx.mainBrand)}
       ${_labelRow('Mood', _aiBtn('pmAI'))}${fld('pm', 'energetic professional')}
       <button id="go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate palette</button>
       <div id="out" style="margin-top:18px"></div>`,
      `${_labelRow('Describe the business (1 paragraph)', _aiBtn('ndAI'))}<textarea id="nd" rows="3" placeholder="${_esc(ctx.industry?('A '+ctx.industry+' brand that…'):'A brand that…')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;font-family:inherit;box-sizing:border-box"></textarea>
       ${_labelRow('Style', _aiBtn('nsAI'))}${fld('ns', 'modern')}
       <button id="go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate names</button>
       <div id="out" style="margin-top:18px"></div>`,
      `${_labelRow('Brand name', _useBrandBtn('snUse', ctx.mainBrand), _aiBtn('snAI'))}${fld('sn', ctx.mainBrand)}
       ${_labelRow('Value prop', _aiBtn('svAI'))}<textarea id="sv" rows="2" placeholder="${_esc(ctx.industry?('What '+(ctx.mainBrand||'we')+' delivers in '+ctx.industry+'…'):'What you deliver…')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 16px;font-family:inherit;box-sizing:border-box"></textarea>
       <button id="go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate slogans</button>
       <div id="out" style="margin-top:18px"></div>`,
    ];
    function showPane(i){
      document.querySelectorAll('.brand-tab').forEach((b,bi)=>{ b.style.borderBottomColor=bi===i?'#0066FF':'transparent'; b.style.color=bi===i?'#0066FF':'#64748B'; });
      document.getElementById('brand-pane').innerHTML = PANES[i];
      // Wire AI Suggest buttons per pane
      const aiName        = async (seedEl) => {
        const j = await _api('/api/studio/brand/names',{method:'POST',body:{
          description: `A brand like ${seedEl.value||ctx.mainBrand||'this business'} operating in the ${ctx.industry||'consumer'} space`,
          style: 'modern', count: 6,
          industry: ctx.industry, competitors: ctx.competitors
        }});
        const pick = (j.names||[])[0]?.name;
        if (!pick) throw new Error('AI did not return any brand name candidates');
        return pick;
      };
      const aiIndustry    = async () => _aiSuggestField('Industry / vertical', { currentValue: bi && bi.value });
      const aiVibe        = async () => _aiSuggestField('Brand visual vibe (3-5 words, e.g. "warm editorial premium")', { currentValue: bv && bv.value });
      const aiMood        = async () => _aiSuggestField('Brand mood for a colour palette (2-4 words)', { currentValue: pm && pm.value });
      const aiDescription = async () => _aiSuggestField('One-paragraph description of this business for a naming brief', { currentValue: nd && nd.value, context: 'Write 2-3 sentences. Mention the real audience and the real category — no clichés.' });
      const aiStyle       = async () => _aiSuggestField('Naming style (single word, e.g. "modern", "editorial", "playful")', { currentValue: ns && ns.value });
      const aiSlogan      = async (brandEl) => {
        const brand = (brandEl && brandEl.value) || ctx.mainBrand;
        if (!brand) throw new Error('Fill in Brand name first');
        const j = await _api('/api/studio/brand/slogans',{method:'POST',body:{
          brandName: brand, valueProp: (sv && sv.value) || '',
          industry: ctx.industry, competitors: ctx.competitors, count: 6
        }});
        const pick = (j.slogans||[])[0]?.text;
        if (!pick) throw new Error('AI did not return any slogan candidates');
        return pick;
      };
      if (i===0) {
        const bnUse=document.getElementById('bnUse'); if(bnUse) bnUse.addEventListener('click',()=>{bn.value=ctx.mainBrand;});
        _wireAI('bnAI', bn, ()=>aiName(bn));
        _wireAI('biAI', bi, aiIndustry);
        _wireAI('bvAI', bv, aiVibe);
      } else if (i===1) {
        const pnUse=document.getElementById('pnUse'); if(pnUse) pnUse.addEventListener('click',()=>{pn.value=ctx.mainBrand;});
        _wireAI('pnAI', pn, ()=>aiName(pn));
        _wireAI('pmAI', pm, aiMood);
      } else if (i===2) {
        _wireAI('ndAI', nd, aiDescription);
        _wireAI('nsAI', ns, aiStyle);
      } else {
        const snUse=document.getElementById('snUse'); if(snUse) snUse.addEventListener('click',()=>{sn.value=ctx.mainBrand;});
        _wireAI('snAI', sn, ()=>aiName(sn));
        _wireAI('svAI', sv, ()=>aiSlogan(sn));
      }
      document.getElementById('go').addEventListener('click', async ()=>{
        const out=document.getElementById('out'); out.innerHTML='⏳ Generating…';
        try{
          if(i===0){ const j=await _api('/api/studio/brand/logo-brief',{method:'POST',body:{brandName:bn.value,industry:bi.value,vibe:bv.value}}); const b=j.brief||{};
            out.innerHTML=`<div style="background:#F8FAFC;padding:16px;border-radius:10px"><strong>Concept:</strong> ${_esc(b.concept||'')}<br><br><strong>Symbol:</strong> ${_esc(b.symbol||'')}<br><br><strong>Wordmark:</strong> ${_esc(b.wordmarkStyle||'')}<br><br><div style="display:flex;gap:8px;margin:8px 0"><div style="background:${_esc(b.primaryColor)};width:60px;height:60px;border-radius:8px"></div><div style="background:${_esc(b.secondaryColor)};width:60px;height:60px;border-radius:8px"></div></div><strong>Don't:</strong><ul>${(b.doNotDo||[]).map(x=>`<li>${_esc(x)}</li>`).join('')}</ul><strong>AI image prompt:</strong><br><code style="background:white;padding:8px;display:block;border-radius:6px;font-size:12px">${_esc(b.midjourneyPrompt||'')}</code></div>`;
          } else if(i===1){ const j=await _api('/api/studio/brand/palette',{method:'POST',body:{brandName:pn.value,mood:pm.value}});
            out.innerHTML=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${(j.palette||[]).map(p=>`<div style="background:${_esc(p.hex)};color:white;padding:18px;border-radius:10px;text-shadow:0 1px 2px rgba(0,0,0,.4)"><div style="font-weight:700">${_esc(p.name)}</div><div style="font-family:monospace;font-size:12px">${_esc(p.hex)}</div><div style="font-size:11px;opacity:.85;margin-top:4px">${_esc(p.usage)}</div></div>`).join('')}</div><p style="color:#64748B;font-size:13px;margin-top:12px">${_esc(j.rationale||'')}</p>`;
          } else if(i===2){ const j=await _api('/api/studio/brand/names',{method:'POST',body:{description:nd.value,style:ns.value}});
            out.innerHTML=`<div style="display:grid;grid-template-columns:1fr;gap:8px">${(j.names||[]).map(n=>`<div style="background:#F8FAFC;padding:12px 14px;border-radius:8px;display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:700">${_esc(n.name)}</div><div style="font-size:12px;color:#64748B">${_esc(n.rationale)}</div></div><div style="background:#0066FF;color:white;padding:4px 10px;border-radius:6px;font-weight:700;font-size:13px">${n.score||'-'}/10</div></div>`).join('')}</div>`;
          } else { const j=await _api('/api/studio/brand/slogans',{method:'POST',body:{brandName:sn.value,valueProp:sv.value}});
            out.innerHTML=`<div style="display:grid;grid-template-columns:1fr;gap:8px">${(j.slogans||[]).map(s=>`<div style="background:#F8FAFC;padding:12px 14px;border-radius:8px"><div style="font-weight:600">"${_esc(s.text)}"</div><div style="font-size:11px;color:#64748B;margin-top:2px">${_esc(s.style)} · ${s.wordCount||'?'} words</div></div>`).join('')}</div>`;
          }
        }catch(e){ out.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
      });
    }
    document.querySelectorAll('.brand-tab').forEach((b,i)=>b.addEventListener('click',()=>showPane(i)));
    showPane(0);
  }

  // ── Image Toolkit modal ───────────────────────────────────────────────────
  function openImageStudio(){
    const ctx = _studioCtx();
    _modal('🖼️ Image Toolkit', `
      <p style="color:#64748B;margin:0 0 18px">Generate product shots, sketches and concept images via Cloudflare Workers AI.</p>
      ${_labelRow('What do you want?', _aiBtn('impAI'))}
      <textarea id="imp" rows="3" placeholder="e.g. A luxury skincare bottle on marble, soft window light, photo-real" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;font-family:inherit;box-sizing:border-box"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="b1" style="background:#0066FF;color:white;border:0;padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer">Generate concept</button>
        <button id="b2" style="background:#0F766E;color:white;border:0;padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer">Product photo</button>
        <button id="b3" style="background:#7C3AED;color:white;border:0;padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer">High-fidelity render</button>
      </div>
      <div id="iout"></div>`, { width: 640 });
    const out=document.getElementById('iout');
    async function gen(endpoint, body){
      out.innerHTML='⏳ Generating image (8-15 sec)…';
      try{ const j=await _api(endpoint,{method:'POST',body}); out.innerHTML=`<img src="${j.image}" style="max-width:100%;border-radius:10px;border:1px solid #E5E7EB"><a href="${j.image}" download="image.png" style="display:inline-block;margin-top:8px;background:#0F172A;color:white;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px">⬇ Download</a>`; }
      catch(e){ out.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    }
    b1.addEventListener('click',()=>gen('/api/studio/image/sketch-to-image',{prompt: imp.value || 'a clean modern design concept'}));
    b2.addEventListener('click',()=>gen('/api/studio/image/product-shot',   {product: imp.value || 'product'}));
    b3.addEventListener('click',()=>gen('/api/studio/image/upscale-prompt', {prompt: imp.value || 'a high resolution detailed image'}));
    _wireAI('impAI', imp, async () => _aiSuggestField(
      'Image generation prompt — one cinematic sentence describing a real, on-brand product or lifestyle scene',
      { currentValue: imp.value, context: 'The prompt will be sent to an image model. Include subject, setting, lighting, camera/lens cue, mood. No clichés. Match the brand + industry exactly.' }
    ));
  }

  // ── Video Storyboard modal ────────────────────────────────────────────────
  function openVideoStudio(){
    const ad = window.analysisData || {};
    const _domainToBrand = u => { try { const h = String(u||'').replace(/^https?:\/\//,'').split('/')[0].split('.'); const core = (h.length>=2?h[h.length-2]:h[0])||''; return core.charAt(0).toUpperCase()+core.slice(1); } catch { return ''; } };
    const mainBrand = _domainToBrand(ad.url);
    const competitors = Array.isArray(ad.competitors) ? ad.competitors.filter(c=>c&&(c.name||c.domain)) : [];
    const compOpts = competitors.map(c=>{ const lbl=_esc(c.name||_domainToBrand(c.domain)); return `<option value="${lbl}">${lbl}</option>`;}).join('');
    const industry = _esc(ad.industry || '');
    _modal('🎬 AI Video Storyboard', `
      <label style="display:flex;justify-content:space-between;align-items:center">
        <span>Brand name</span>
        <span style="display:flex;gap:6px">
          ${mainBrand ? `<button id="vbAnalysed" type="button" style="background:#EEF2FF;color:#4F46E5;border:1px solid #C7D2FE;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">📊 Use "${_esc(mainBrand)}"</button>` : ''}
          <button id="vbSuggest" type="button" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
        </span>
      </label>
      <input id="vb" placeholder="e.g. ${_esc(mainBrand||'Acme')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 6px;box-sizing:border-box">
      ${compOpts ? `<div style="margin:0 0 12px"><label style="display:block;font-size:11px;color:#6B7280;margin-bottom:4px">…or pick an analysed competitor</label><select id="vbComp" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;background:#fff"><option value="">— select competitor —</option>${compOpts}</select></div>` : `<div style="font-size:11px;color:#9CA3AF;margin:0 0 12px">Run an analysis first to pull competitors here.</div>`}

      <label style="display:flex;justify-content:space-between;align-items:center">
        <span>Value prop</span>
        <button id="vvSuggest" type="button" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">🧠 AI Suggest</button>
      </label>
      <input id="vv" placeholder="What you want viewers to take away in 15 seconds" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;box-sizing:border-box">

      <label>Duration (seconds)<input id="vd" type="number" value="15" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 16px;box-sizing:border-box"></label>
      <button id="vgo" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate storyboard</button>
      <div id="vout" style="margin-top:18px"></div>`, { width: 720 });

    const vbEl = document.getElementById('vb');
    const vvEl = document.getElementById('vv');
    const vbAnalysed = document.getElementById('vbAnalysed');
    const vbComp = document.getElementById('vbComp');
    if (vbAnalysed && mainBrand) vbAnalysed.addEventListener('click', () => { vbEl.value = mainBrand; vbEl.focus(); });
    if (vbComp) vbComp.addEventListener('change', () => { if (vbComp.value) { vbEl.value = vbComp.value; vbEl.focus(); } });
    document.getElementById('vbSuggest').addEventListener('click', async () => {
      const prev = vbEl.value;
      const t0 = performance.now();
      vbEl.value = '⏳ Thinking… [0.0s]'; vbEl.disabled = true;
      const iv = setInterval(() => { if (vbEl.disabled) vbEl.value = '⏳ Thinking… [' + ((performance.now()-t0)/1000).toFixed(1) + 's]'; }, 100);
      try {
        const seed = mainBrand || prev;
        if (!seed) throw new Error('Run an analysis or type something first so AI has context');
        const j = await _api('/api/studio/brand/names', { method:'POST', body:{
          description: `A brand similar to ${seed} in the ${industry||'consumer'} space — short, memorable, web-friendly`,
          style:'modern', count: 6,
          industry, competitors
        }});
        const pick = (j.names||[])[0];
        clearInterval(iv);
        if (!pick || !pick.name) throw new Error('AI did not return any brand name candidates');
        vbEl.value = pick.name;
      } catch (e) {
        clearInterval(iv);
        vbEl.value = prev;
        try { if (typeof window.showToast === 'function') window.showToast('AI unavailable: ' + (e && e.message || e), 'error'); } catch {}
      } finally { vbEl.disabled = false; vbEl.focus(); }
    });
    document.getElementById('vvSuggest').addEventListener('click', async () => {
      const brand = vbEl.value.trim() || mainBrand;
      if (!brand) { vvEl.placeholder = '⚠️ Fill in Brand name first'; return; }
      const prev = vvEl.value;
      const t0 = performance.now();
      vvEl.value = '⏳ Thinking… [0.0s]'; vvEl.disabled = true;
      const iv = setInterval(() => { if (vvEl.disabled) vvEl.value = '⏳ Thinking… [' + ((performance.now()-t0)/1000).toFixed(1) + 's]'; }, 100);
      try {
        const competitors = (Array.isArray((window.analysisData||{}).competitors)?window.analysisData.competitors:[]).filter(c=>c&&(c.name||c.domain));
        const j = await _api('/api/studio/brand/slogans', { method:'POST', body:{ brandName: brand, valueProp: '', industry, competitors, count: 6 } });
        const pick = (j.slogans||[])[0];
        clearInterval(iv);
        if (!pick || !pick.text) throw new Error('AI did not return any slogan candidates');
        vvEl.value = pick.text;
      } catch (e) {
        clearInterval(iv);
        vvEl.value = prev;
        try { if (typeof window.showToast === 'function') window.showToast('AI unavailable: ' + (e && e.message || e), 'error'); } catch {}
      } finally { vvEl.disabled = false; vvEl.focus(); }
    });

    vgo.addEventListener('click', async ()=>{
      vout.innerHTML='⏳ Storyboarding…';
      try{ const j=await _api('/api/studio/video/storyboard',{method:'POST',body:{brandName:vb.value,valueProp:vv.value,duration:Number(vd.value)||15}});
        const s=j.storyboard||{};
        vout.innerHTML=`<div style="background:#F8FAFC;padding:16px;border-radius:10px"><h3 style="margin:0 0 4px">${_esc(s.title||'')}</h3><p style="font-style:italic;color:#475569;margin:0 0 16px">"${_esc(s.voiceoverScript||'')}"</p>
          <strong>Scenes:</strong>${(s.scenes||[]).map(sc=>`<div style="background:white;padding:10px;border-radius:8px;margin:8px 0;border-left:3px solid #0066FF"><div style="font-weight:700;font-size:13px">${sc.tStart}s → ${sc.tEnd}s</div><div style="font-size:13px;color:#475569">${_esc(sc.visual)}</div>${sc.textOverlay?`<div style="font-size:12px;color:#0066FF;margin-top:4px">📝 "${_esc(sc.textOverlay)}"</div>`:''}</div>`).join('')}
          <p style="margin:12px 0 4px"><strong>🎵 Music:</strong> ${_esc(s.music||'')}</p>
          <p style="margin:4px 0"><strong>🎬 End frame:</strong> ${_esc(s.endFrame||'')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
            <button id="vrf"  data-id="${_esc(j.id||'')}" style="background:linear-gradient(135deg,#7C3AED,#A855F7);color:#fff;border:0;padding:10px 18px;border-radius:7px;font-weight:800;cursor:pointer">🖼️ Render Key Frames</button>
            <button id="vrvo" data-id="${_esc(j.id||'')}" style="background:linear-gradient(135deg,#0EA5E9,#06B6D4);color:#fff;border:0;padding:10px 18px;border-radius:7px;font-weight:800;cursor:pointer">🎙️ Generate Voice-Over</button>
            <button id="vrmp" data-id="${_esc(j.id||'')}" style="background:linear-gradient(135deg,#16A34A,#10B981);color:#fff;border:0;padding:10px 18px;border-radius:7px;font-weight:800;cursor:pointer">🎬 Stitch to MP4</button>
          </div>
          <div id="vframes" style="margin-top:14px"></div>
          <div id="vaudio"  style="margin-top:14px"></div>
          <div id="vmp4"    style="margin-top:14px"></div></div>`;
        const vrvo = document.getElementById('vrvo');
        if (vrvo) vrvo.addEventListener('click', async () => {
          const aout = document.getElementById('vaudio');
          aout.innerHTML = '⏳ Generating voice-over via OpenAI TTS…';
          try {
            const aj = await _api('/api/studio/video/voiceover', { method:'POST', body:{ id: vrvo.dataset.id, voice: 'alloy' } });
            aout.innerHTML = `<div style="background:#F0F9FF;border:1px solid #BAE6FD;padding:12px;border-radius:8px"><div style="font-weight:800;color:#075985;margin-bottom:6px">🎙️ Voice-over ready (${aj.chars} chars)</div><audio controls src="${aj.mp3Url}" style="width:100%"></audio></div>`;
          } catch(e) { aout.innerHTML = `<div style="color:#DC2626">${_esc(e.message)}</div>`; }
        });
        const vrmp = document.getElementById('vrmp');
        if (vrmp) vrmp.addEventListener('click', async () => {
          const mout = document.getElementById('vmp4');
          mout.innerHTML = '⏳ Stitching MP4 (needs Render Key Frames first — voice-over auto-attached if generated)…';
          try {
            const mj = await _api('/api/studio/video/render-mp4', { method:'POST', body:{ id: vrmp.dataset.id } });
            mout.innerHTML = `<div style="background:#ECFDF5;border:1px solid #6EE7B7;padding:12px;border-radius:8px"><div style="font-weight:800;color:#065F46;margin-bottom:6px">🎬 MP4 ready — ${mj.scenes} scene(s), ${mj.hasAudio ? 'with voice-over' : 'video-only'}</div><video controls src="${mj.mp4Url}" style="width:100%;border-radius:6px;background:#000"></video><div style="margin-top:6px"><a href="${mj.mp4Url}" download style="color:#065F46;font-weight:700;text-decoration:underline">⬇ Download MP4</a></div></div>`;
          } catch(e) { mout.innerHTML = `<div style="color:#DC2626">${_esc(e.message)}</div>`; }
        });
        const rfBtn = document.getElementById('vrf');
        if (rfBtn) rfBtn.addEventListener('click', async () => {
          const fout = document.getElementById('vframes');
          fout.innerHTML = '⏳ Rendering frames via Cloudflare SDXL (may take 30-60s)…';
          try {
            const fj = await _api('/api/studio/video/render-frames', { method:'POST', body:{ id: rfBtn.dataset.id } });
            fout.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">${(fj.frames||[]).map(f => f.image ? `<div style="background:#fff;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden"><img src="${f.image}" style="width:100%;display:block"><div style="padding:6px;font-size:0.72rem;color:#64748B">${f.tStart}s–${f.tEnd}s</div></div>` : `<div style="background:#FEE2E2;color:#B91C1C;padding:8px;font-size:0.72rem;border-radius:6px">${f.tStart}s: ${_esc(f.error||'failed')}</div>`).join('')}</div><div style="margin-top:10px;font-size:0.78rem;color:#64748B">${_esc(fj.note||'')}</div>`;
          } catch(e) { fout.innerHTML = `<div style="color:#DC2626">${_esc(e.message)}</div>`; }
        });
      }catch(e){ vout.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    });
  }

  // ── Presentation modal ────────────────────────────────────────────────────
  function openPresentationStudio(){
    const ctx = _studioCtx();
    _modal('📑 AI Presentation Generator', `
      ${_labelRow('Topic', _aiBtn('ptAI'))}
      <input id="pt" placeholder="e.g. Why ${_esc(ctx.mainBrand||'our SaaS')} will win the ${_esc(ctx.industry||'SMB')} market" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;box-sizing:border-box">
      ${_labelRow('Audience', _aiBtn('paAI'))}
      <input id="pa" value="investors" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px;box-sizing:border-box">
      <label>Slide count<input id="pc" type="number" value="10" min="5" max="20" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 16px;box-sizing:border-box"></label>
      <button id="pgo" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate deck</button>
      <div id="pout" style="margin-top:18px"></div>`, { width: 760 });
    _wireAI('ptAI', pt, async () => _aiSuggestField(
      'Presentation topic / title — one concrete sentence specific to this brand and industry',
      { currentValue: pt.value, context: 'No buzzwords like "redefine" or "category-defining". Reference a real angle a real exec would actually pitch.' }
    ));
    _wireAI('paAI', pa, async () => _aiSuggestField(
      'Target audience for this presentation (e.g. "Series-B SaaS CFOs", "regional Shopify store owners")',
      { currentValue: pa.value }
    ));
    // Render the deck preview + action toolbar. Extracted so we can re-render
    // after Add images finishes without re-calling /generate.
    function _renderDeck(deckId, d){
      const hasImages = (d.slides||[]).some(s => s.image);
      pout.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px">
          <button id="pAddImg" style="background:${hasImages?'#E2E8F0':'#7C3AED'};color:${hasImages?'#475569':'white'};border:0;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer">🎨 ${hasImages?'Regenerate images':'Add images to slides'}</button>
          <button id="pPptx" style="background:#0F172A;color:white;border:0;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer">⬇ PowerPoint</button>
          <span id="pStatus" style="align-self:center;color:#64748B;font-size:12px"></span>
        </div>
        <div style="background:#F8FAFC;padding:16px;border-radius:10px">
          <h2 style="margin:0">${_esc(d.title)}</h2>
          <p style="color:#475569;margin:4px 0 14px">${_esc(d.subtitle||'')}</p>
          ${(d.slides||[]).map(s=>`
            <div style="background:white;padding:14px;border-radius:8px;margin:8px 0;border-left:3px solid #0066FF;display:grid;grid-template-columns:${s.image?'1fr 180px':'1fr'};gap:14px;align-items:start">
              <div>
                <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;font-weight:700">Slide ${s.n} · ${_esc(s.type)}</div>
                <div style="font-weight:700;margin-top:4px">${_esc(s.heading||'')}</div>
                ${s.subheading?`<div style="color:#64748B;font-size:13px">${_esc(s.subheading)}</div>`:''}
                ${(s.bullets||[]).length?`<ul style="margin:8px 0 0;font-size:13px;color:#0F172A">${s.bullets.map(b=>`<li>${_esc(b)}</li>`).join('')}</ul>`:''}
                ${s.speakerNotes?`<div style="margin-top:8px;padding:8px;background:#FEF3C7;border-radius:6px;font-size:12px;color:#78350F">📝 ${_esc(s.speakerNotes)}</div>`:''}
                ${s.imageError?`<div style="margin-top:8px;padding:6px 8px;background:#FEE2E2;border-radius:6px;font-size:11px;color:#991B1B">Image failed: ${_esc(s.imageError)}</div>`:''}
              </div>
              ${s.image?`<img src="${s.image}" alt="" style="width:180px;height:135px;object-fit:cover;border-radius:6px;background:#F1F5F9">`:''}
            </div>`).join('')}
        </div>`;
      const status = document.getElementById('pStatus');
      document.getElementById('pPptx').addEventListener('click', ()=>{
        status.textContent = 'Building .pptx…';
        // Use a hidden anchor so the browser handles the download with the
        // server-supplied filename; this also dodges popup-blockers.
        const a = document.createElement('a');
        a.href = '/api/studio/presentation/' + encodeURIComponent(deckId) + '/pptx';
        a.download = (d.title || 'presentation') + '.pptx';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>{ status.textContent = 'Download started.'; }, 800);
      });
      document.getElementById('pAddImg').addEventListener('click', async ()=>{
        const btn = document.getElementById('pAddImg');
        btn.disabled = true;
        const t0 = Date.now();
        const tick = setInterval(()=>{ status.textContent = '⏳ Generating images… ' + Math.floor((Date.now()-t0)/1000) + 's (≈10s per slide)'; }, 500);
        try {
          const j = await _api('/api/studio/presentation/' + encodeURIComponent(deckId) + '/images', { method:'POST', body:{} });
          clearInterval(tick);
          _renderDeck(deckId, j.deck || d);
        } catch (e) {
          clearInterval(tick);
          status.textContent = '';
          status.innerHTML = `<span style="color:#DC2626">${_esc(e.message)}</span>`;
          btn.disabled = false;
        }
      });
    }

    pgo.addEventListener('click', async ()=>{
      const t0 = Date.now();
      const tick = setInterval(()=>{ pout.innerHTML = '⏳ Generating ('+pc.value+' slides)… ' + Math.floor((Date.now()-t0)/1000) + 's'; }, 500);
      pout.innerHTML='⏳ Generating ('+pc.value+' slides)… 0s';
      try{ const j=await _api('/api/studio/presentation/generate',{method:'POST',body:{topic:pt.value,audience:pa.value,slideCount:Number(pc.value)||10}});
        clearInterval(tick);
        _renderDeck(j.id, j.deck || {});
      }catch(e){ clearInterval(tick); pout.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    });
  }

  // ── Email Signature modal ─────────────────────────────────────────────────
  function openSignatureStudio(){
    const ctx = _studioCtx();
    const websiteDefault = (ctx.ad && ctx.ad.url) ? String(ctx.ad.url).replace(/^https?:\/\//,'').replace(/\/$/,'') : '';
    _modal('✍️ Email Signature Designer', `
      ${ctx.mainBrand ? `<div style="background:#EEF2FF;border:1px solid #C7D2FE;color:#3730A3;padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;display:flex;justify-content:space-between;align-items:center"><span>📊 Auto-fill Company + Website from <strong>${_esc(ctx.mainBrand)}</strong>?</span><button id="sgn_autofill" type="button" style="background:#4F46E5;color:#fff;border:0;padding:5px 12px;border-radius:6px;font-weight:700;cursor:pointer;font-size:12px">Fill</button></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label>Name<input id="sgn_n" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>${_labelRow('Title', _aiBtn('sgn_tAI'))}<input id="sgn_t" placeholder="e.g. Head of Growth" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>${_labelRow('Company', _useBrandBtn('sgn_cUse', ctx.mainBrand))}<input id="sgn_c" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Email<input id="sgn_e" type="email" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Phone<input id="sgn_p" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Website<input id="sgn_w" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>LinkedIn URL<input id="sgn_l" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Logo URL<input id="sgn_lo" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label style="grid-column:1/-1">${_labelRow('Tagline', _aiBtn('sgn_tagAI'))}<input id="sgn_tag" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Primary color<input id="sgn_co" type="color" value="#0066FF" style="width:100%;padding:6px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0;height:40px"></label>
      </div>
      <label style="margin-top:8px;display:block"><input id="sgn_tr" type="checkbox" checked> Enable open + click tracking</label>
      <button id="sgo" style="margin-top:12px;background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Generate signature</button>
      <div id="sout" style="margin-top:18px"></div>`, { width: 720 });
    const autofillBtn = document.getElementById('sgn_autofill');
    if (autofillBtn) autofillBtn.addEventListener('click', () => {
      if (!sgn_c.value) sgn_c.value = ctx.mainBrand;
      if (!sgn_w.value && websiteDefault) sgn_w.value = 'https://'+websiteDefault;
    });
    const cUse = document.getElementById('sgn_cUse');
    if (cUse) cUse.addEventListener('click', () => { sgn_c.value = ctx.mainBrand; });
    _wireAI('sgn_tAI', sgn_t, async () => _aiSuggestField(
      'Job title for an email signature — a realistic title for someone at this company in this industry',
      { brand: sgn_c.value || ctx.mainBrand, currentValue: sgn_t.value }
    ));
    _wireAI('sgn_tagAI', sgn_tag, async () => {
      const brand = sgn_c.value || ctx.mainBrand;
      if (!brand) throw new Error('Fill in Company first');
      const j = await _api('/api/studio/brand/slogans',{method:'POST',body:{
        brandName: brand, valueProp: '', industry: ctx.industry, competitors: ctx.competitors, count: 6
      }});
      const pick = (j.slogans||[])[0]?.text;
      if (!pick) throw new Error('AI did not return any slogan candidates');
      return pick;
    });
    sgo.addEventListener('click', async ()=>{
      sout.innerHTML='⏳ Generating…';
      try{ const j=await _api('/api/studio/signature/generate',{method:'POST',body:{
        name:sgn_n.value,title:sgn_t.value,company:sgn_c.value,email:sgn_e.value,phone:sgn_p.value,
        website:sgn_w.value,linkedin:sgn_l.value,logoUrl:sgn_lo.value,tagline:sgn_tag.value,
        primaryColor:sgn_co.value,enableTracking:sgn_tr.checked
      }});
        sout.innerHTML=`<h3 style="margin:0 0 8px;font-size:14px;color:#64748B;text-transform:uppercase">Preview</h3><div style="border:1px dashed #CBD5E1;padding:18px;border-radius:8px;background:white">${j.html}</div><h3 style="margin:18px 0 8px;font-size:14px;color:#64748B;text-transform:uppercase">HTML (paste into Gmail/Outlook signature settings)</h3><textarea readonly style="width:100%;height:120px;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:monospace;font-size:11px">${_esc(j.html)}</textarea><button onclick="navigator.clipboard.writeText(this.previousElementSibling.value);this.textContent='✓ Copied'" style="margin-top:8px;background:#0F172A;color:white;border:0;padding:8px 14px;border-radius:6px;cursor:pointer">Copy HTML</button>`;
      }catch(e){ sout.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    });
  }

  // ── Case Study Builder modal ──────────────────────────────────────────────
  function openCaseStudyStudio(){
    const ctx = _studioCtx();
    const compOpts = ctx.competitors.map(c=>`<option value="${_esc(c.name)}">${_esc(c.name)}</option>`).join('');
    _modal('📰 AI Case Study Builder', `
      <p style="color:#64748B;margin:0 0 16px">Describe a customer story in 3 lines. We'll write the headline, pull quote, challenge → solution → result, metrics and a share-ready landing page.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label style="grid-column:1/2">${_labelRow('Customer name', _aiBtn('cs_cnAI'))}<input id="cs_cn" placeholder="Acme Logistics" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label style="grid-column:2/3">${_labelRow('Industry', _aiBtn('cs_inAI'))}<input id="cs_in" value="${_esc(ctx.industry||'')}" placeholder="Logistics" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
      </div>
      ${compOpts ? `<label style="display:block;font-size:12px;color:#6B7280;margin:6px 0">…or pick an analysed competitor as the customer<select id="cs_pickComp" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;background:#fff;margin-top:4px"><option value="">— select competitor —</option>${compOpts}</select></label>` : ''}
      <label>${_labelRow('Your brand (optional)', _useBrandBtn('cs_bnUse', ctx.mainBrand))}<input id="cs_bn" value="${_esc(ctx.mainBrand||'')}" placeholder="InfoGenie" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px"></label>
      <label>${_labelRow('Challenge they faced', _aiBtn('cs_chAI'))}<textarea id="cs_ch" rows="2" placeholder="Their conversion rate was stuck at 1.1%, ad spend was ballooning…" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0"></textarea></label>
      <label>${_labelRow('Solution you delivered', _aiBtn('cs_soAI'))}<textarea id="cs_so" rows="2" placeholder="We rebuilt the funnel with our X tool, ran a 30-day creative test…" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0"></textarea></label>
      <label>${_labelRow("Result / outcome (optional — we'll infer if blank)", _aiBtn('cs_reAI'))}<textarea id="cs_re" rows="2" placeholder="3.2% conversion in 60 days, CAC down 40%…" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0 16px"></textarea></label>
      <button id="cs_go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">✨ Generate case study</button>
      <div id="cs_out" style="margin-top:18px"></div>`, { width: 760 });
    const pickComp = document.getElementById('cs_pickComp');
    if (pickComp) pickComp.addEventListener('change', () => { if (pickComp.value) cs_cn.value = pickComp.value; });
    const bnUse = document.getElementById('cs_bnUse');
    if (bnUse) bnUse.addEventListener('click', () => { cs_bn.value = ctx.mainBrand; });
    _wireAI('cs_cnAI', cs_cn, async () => _aiSuggestField(
      'Realistic customer name for a case study — a plausible real-world company in this industry (NOT Acme/Nexus/Apex/Vega)',
      { industry: cs_in.value || ctx.industry, currentValue: cs_cn.value }
    ));
    _wireAI('cs_inAI', cs_in, async () => _aiSuggestField(
      'Industry / vertical the customer operates in',
      { currentValue: cs_in.value || ctx.industry }
    ));
    _wireAI('cs_chAI', cs_ch, async () => _aiSuggestField(
      'The challenge the customer faced before working with us — 2-3 sentences, concrete numbers, industry-specific pain',
      { brand: cs_bn.value || ctx.mainBrand, industry: cs_in.value || ctx.industry, currentValue: cs_ch.value, context: `Customer: ${cs_cn.value || 'unspecified'}. Real, plausible metrics only — never the same 1.1% conversion / 40% CAC template.` }
    ));
    _wireAI('cs_soAI', cs_so, async () => _aiSuggestField(
      'The solution we delivered — 2-3 sentences, specific tactics that map to the stated challenge',
      { brand: cs_bn.value || ctx.mainBrand, industry: cs_in.value || ctx.industry, currentValue: cs_so.value, context: `Customer: ${cs_cn.value || 'unspecified'}. Challenge: ${cs_ch.value || 'unspecified'}.` }
    ));
    _wireAI('cs_reAI', cs_re, async () => _aiSuggestField(
      'The result / outcome — 2-3 sentences, plausible metrics directly tied to the solution and industry',
      { brand: cs_bn.value || ctx.mainBrand, industry: cs_in.value || ctx.industry, currentValue: cs_re.value, context: `Customer: ${cs_cn.value || 'unspecified'}. Solution: ${cs_so.value || 'unspecified'}.` }
    ));
    document.getElementById('cs_go').addEventListener('click', async ()=>{
      const out=document.getElementById('cs_out'); out.innerHTML='⏳ Generating (15-25 sec)…';
      try{
        const j=await _api('/api/studio/case-study/generate',{method:'POST',body:{
          customerName:cs_cn.value, industry:cs_in.value, brandName:cs_bn.value,
          challenge:cs_ch.value, solution:cs_so.value, result:cs_re.value
        }});
        const s=j.study||{};
        const metricsHtml = (s.metrics||[]).map(m=>`<div style="background:white;padding:12px;border-radius:8px;text-align:center;border:1px solid #E5E7EB"><div style="font-size:22px;font-weight:800;color:#0066FF">${_esc(m.value)}</div><div style="font-size:12px;font-weight:600">${_esc(m.label)}</div><div style="font-size:11px;color:#64748B">${_esc(m.context)}</div></div>`).join('');
        out.innerHTML=`<div style="background:#F8FAFC;padding:18px;border-radius:12px">
          <div style="color:#64748B;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase">Headline</div>
          <h2 style="margin:4px 0 6px;font-size:22px;line-height:1.25">${_esc(s.headline||'')}</h2>
          <p style="color:#475569;margin:0 0 14px">${_esc(s.subheadline||'')}</p>
          ${metricsHtml?`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px">${metricsHtml}</div>`:''}
          ${s.pullQuote?.text?`<div style="background:linear-gradient(135deg,#0066FF,#7C3AED);color:white;padding:18px;border-radius:10px;margin-bottom:14px"><div style="font-size:15px;line-height:1.5">"${_esc(s.pullQuote.text)}"</div><div style="font-size:12px;opacity:.85;margin-top:8px">— ${_esc(s.pullQuote.attribution||'')}</div></div>`:''}
          <details open style="margin-bottom:8px"><summary style="font-weight:700;cursor:pointer;padding:6px 0">${_esc(s.challenge?.title||'The Challenge')}</summary><div style="font-size:13px;color:#475569;white-space:pre-line;padding:6px 0">${_esc(s.challenge?.body||'')}</div></details>
          <details style="margin-bottom:8px"><summary style="font-weight:700;cursor:pointer;padding:6px 0">${_esc(s.solution?.title||'The Solution')}</summary><div style="font-size:13px;color:#475569;white-space:pre-line;padding:6px 0">${_esc(s.solution?.body||'')}</div></details>
          <details><summary style="font-weight:700;cursor:pointer;padding:6px 0">${_esc(s.result?.title||'The Result')}</summary><div style="font-size:13px;color:#475569;white-space:pre-line;padding:6px 0">${_esc(s.result?.body||'')}</div></details>
          <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
            <a href="/api/studio/case-study/${_esc(j.id)}/page" target="_blank" style="background:#0F172A;color:white;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">🔗 Open share page</a>
            <button onclick="navigator.clipboard.writeText('${location.origin}/api/studio/case-study/${_esc(j.id)}/page');this.textContent='✓ Copied'" style="background:#0F766E;color:white;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px">📋 Copy share URL</button>
          </div>
        </div>`;
      }catch(e){ out.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    });
  }

  // ── Page Insights modal (scroll depth + site search) ─────────────────────
  function openPageInsightsStudio(){
    _modal('📊 Page Insights', `
      <p style="color:#64748B;margin:0 0 12px;font-size:13px">Every public Site Builder (<code>/lp/…</code>) and Link-in-Bio (<code>/bio/…</code>) page now silently tracks scroll depth + internal-search queries. Pages need a few visitors before numbers stabilise.</p>
      <div id="pi_summary">Loading leaderboard…</div>
      <hr style="border:0;border-top:1px solid #E5E7EB;margin:16px 0">
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;align-items:end">
        <label style="font-size:13px">Drill into a specific page<select id="pi_pick" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"><option value="">— pick a page —</option></select></label>
        <button id="pi_load" style="background:#0066FF;color:white;border:0;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer">Load</button>
      </div>
      <div id="pi_detail" style="margin-top:12px"></div>`, { width: 720 });
    (async()=>{
      try{
        const j=await _api('/api/scroll-tracker/summary');
        const sel = document.getElementById('pi_pick');
        document.getElementById('pi_summary').innerHTML = j.pages.length
          ? `<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#F8FAFC;text-align:left"><th style="padding:8px">Page</th><th style="padding:8px">Sessions</th><th style="padding:8px">Read 50%</th><th style="padding:8px">Read 100%</th></tr></thead><tbody>${j.pages.map(p=>`<tr style="border-bottom:1px solid #F1F5F9"><td style="padding:8px"><code>/${_esc(p.type)}/${_esc(p.slug)}</code></td><td style="padding:8px">${p.sessions}</td><td style="padding:8px"><span style="color:${p.midReadPct>=50?'#059669':'#DC2626'};font-weight:600">${p.midReadPct}%</span></td><td style="padding:8px"><span style="color:${p.fullReadPct>=20?'#059669':'#DC2626'};font-weight:600">${p.fullReadPct}%</span></td></tr>`).join('')}</tbody></table>`
          : '<p style="color:#94A3B8;font-size:13px">No tracked sessions yet — share one of your pages and the data will appear here within a few minutes.</p>';
        j.pages.forEach(p=>{ const o=document.createElement('option'); o.value=p.type+'|'+p.slug; o.textContent=`${p.type}/${p.slug} (${p.sessions} sessions)`; sel.appendChild(o); });
      }catch(e){ document.getElementById('pi_summary').innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    })();
    document.getElementById('pi_load').addEventListener('click', async ()=>{
      const v=document.getElementById('pi_pick').value; if(!v) return;
      const [type,slug]=v.split('|');
      const out=document.getElementById('pi_detail'); out.innerHTML='⏳ Loading…';
      try{
        const sd=await _api(`/api/scroll-tracker/page/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`);
        const ss=type==='lp' ? await _api(`/api/site-search/insights/${encodeURIComponent(slug)}`).catch(()=>({total:0,top:[],zeroResults:[]})) : null;
        const bar=(label,pct)=>`<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:12px"><span>${label}</span><span style="font-weight:700">${pct}%</span></div><div style="background:#F1F5F9;border-radius:4px;height:8px;overflow:hidden"><div style="background:linear-gradient(90deg,#0066FF,#7C3AED);height:100%;width:${pct}%"></div></div></div>`;
        let html=`<div style="background:#F8FAFC;padding:14px;border-radius:10px"><h3 style="margin:0 0 8px;font-size:15px">📜 Scroll-depth funnel — ${sd.sessions} sessions</h3>${bar('25% read', sd.readRate.p25)}${bar('50% read', sd.readRate.p50)}${bar('75% read', sd.readRate.p75)}${bar('100% read', sd.readRate.p100)}${sd.hint?`<div style="color:#78350F;background:#FEF3C7;padding:8px 10px;border-radius:6px;font-size:12px;margin-top:10px">${_esc(sd.hint)}</div>`:''}</div>`;
        if(ss){
          html+=`<div style="background:white;border:1px solid #E5E7EB;padding:14px;border-radius:10px;margin-top:10px"><h3 style="margin:0 0 8px;font-size:15px">🔍 Site-search insights — ${ss.total} searches</h3>`;
          if(ss.top.length){
            html+=`<div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;margin-top:8px">Top queries</div><div style="font-size:13px">${ss.top.slice(0,10).map(q=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #F1F5F9"><span>${_esc(q.query)}</span><span style="color:#64748B">${q.searches}× ${q.zeroHits?'· <span style="color:#DC2626">'+q.zeroHits+' zero-result</span>':''}</span></div>`).join('')}</div>`;
          }
          if(ss.zeroResults.length){
            html+=`<div style="font-size:12px;font-weight:700;color:#DC2626;text-transform:uppercase;margin-top:12px">⚠ Content gaps (zero-result queries)</div><div style="font-size:13px;color:#475569">${ss.zeroResults.slice(0,10).map(q=>`<div style="padding:3px 0">"${_esc(q.query)}" (${q.searches}×)</div>`).join('')}</div><div style="font-size:11px;color:#64748B;margin-top:6px;font-style:italic">→ Each of these is a blog post or product you should consider creating.</div>`;
          }
          if(!ss.total) html+='<p style="color:#94A3B8;font-size:13px;margin:6px 0">No searches yet (page has no search block, or no one has searched).</p>';
          html+='</div>';
        }
        out.innerHTML=html;
      }catch(e){ out.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    });
  }

  // ── SEO Change Log modal ──────────────────────────────────────────────────
  function openSeoAnnotationsStudio(){
    _modal('📌 SEO Change Log', `
      <p style="color:#64748B;margin:0 0 12px;font-size:13px">Log "what we did" so future-you can answer <em>"did our last edit help?"</em>. Annotations are available for overlay on any chart via <code>/api/seo-annotations/list</code>.</p>
      <div style="background:#F8FAFC;padding:14px;border-radius:10px;margin-bottom:14px">
        <h3 style="margin:0 0 8px;font-size:14px">+ Log a change</h3>
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">
          <label style="font-size:12px">Title<input id="an_t" placeholder="Rewrote homepage hero" style="width:100%;padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;margin:3px 0"></label>
          <label style="font-size:12px">Tag<select id="an_tag" style="width:100%;padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;margin:3px 0"><option>content</option><option>technical</option><option>onpage</option><option>backlink</option><option>redesign</option><option>launch</option><option>outage</option><option>other</option></select></label>
          <label style="font-size:12px">When<input id="an_when" type="date" style="width:100%;padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;margin:3px 0"></label>
        </div>
        <label style="font-size:12px">Notes<textarea id="an_d" rows="2" placeholder="Replaced 'Marketing software' with 'AI marketing OS for SMBs'." style="width:100%;padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;font-family:inherit;margin:3px 0"></textarea></label>
        <label style="font-size:12px">Affected URLs (one per line, optional)<textarea id="an_u" rows="2" placeholder="https://example.com/&#10;https://example.com/pricing" style="width:100%;padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;font-family:monospace;font-size:11px;margin:3px 0 8px"></textarea></label>
        <button id="an_save" style="background:#0066FF;color:white;border:0;padding:9px 18px;border-radius:8px;font-weight:700;cursor:pointer">📌 Log change</button>
      </div>
      <h3 style="margin:0 0 8px;font-size:14px">Timeline</h3>
      <div id="an_list">Loading…</div>`, { width: 700 });
    document.getElementById('an_when').valueAsDate = new Date();
    const TAG_COLOR = { content:'#0066FF', technical:'#7C3AED', onpage:'#0F766E', backlink:'#DB2777', redesign:'#F59E0B', launch:'#059669', outage:'#DC2626', other:'#64748B' };
    async function reload(){
      try{ const j=await _api('/api/seo-annotations/list');
        document.getElementById('an_list').innerHTML = j.annotations.length
          ? j.annotations.map(a=>{ const c=TAG_COLOR[a.tag]||'#64748B'; return `<div style="border-left:3px solid ${c};padding:8px 0 8px 12px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><span style="background:${c}15;color:${c};font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700;text-transform:uppercase;margin-right:6px">${_esc(a.tag)}</span><strong>${_esc(a.title)}</strong> <span style="color:#94A3B8;font-size:12px">· ${new Date(a.occurredAt).toLocaleDateString()}</span></div><button data-del-an="${a.id}" style="background:#FEE2E2;color:#991B1B;border:0;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px">Delete</button></div>${a.description?`<div style="font-size:13px;color:#475569;margin-top:4px">${_esc(a.description)}</div>`:''}${(a.urls||[]).length?`<div style="font-size:11px;color:#64748B;margin-top:4px">${a.urls.map(u=>`<code style="background:#F1F5F9;padding:1px 6px;border-radius:4px;margin-right:4px">${_esc(u)}</code>`).join('')}</div>`:''}</div>`; }).join('')
          : '<p style="color:#94A3B8;font-size:13px">No changes logged yet.</p>';
        document.querySelectorAll('[data-del-an]').forEach(b=>b.addEventListener('click', async ()=>{ if(!confirm('Delete this annotation?'))return; await _api('/api/seo-annotations/'+b.dataset.delAn,{method:'DELETE'}); reload(); }));
      }catch(e){ document.getElementById('an_list').innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    }
    reload();
    document.getElementById('an_save').addEventListener('click', async ()=>{
      try{
        const urls = an_u.value.split('\n').map(s=>s.trim()).filter(Boolean);
        await _api('/api/seo-annotations/log',{method:'POST',body:{
          title:an_t.value, description:an_d.value, tag:an_tag.value,
          urls, occurredAt: an_when.value ? new Date(an_when.value).toISOString() : undefined
        }});
        _toast('Logged ✓'); an_t.value=an_d.value=an_u.value=''; reload();
      }catch(e){ _toast(e.message,'err'); }
    });
  }

  // ── 6. WHATSAPP CHANNEL view ──────────────────────────────────────────────
  window.buildWhatsApp = async function(){
    const v=_shell('whatsapp','💬 WhatsApp Channel','Send and receive WhatsApp messages via Meta Cloud API.',`
      <div id="wa-status" style="margin-bottom:16px"></div>
      <div style="display:grid;grid-template-columns:300px 1fr;gap:16px;min-height:500px">
        <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:14px;overflow-y:auto">
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;gap:6px;flex-wrap:wrap"><strong style="align-self:center">Threads</strong><div style="display:flex;gap:4px"><button id="wa-tpls" style="background:#0066FF;color:white;border:0;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer">📋 Templates</button><button id="wa-bulk" style="background:#7C3AED;color:white;border:0;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer">🚀 Bulk Send</button><button id="wa-new" style="background:#25D366;color:white;border:0;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer">+ New</button></div></div>
          <div id="wa-threads">Loading…</div>
        </div>
        <div id="wa-thread" style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <p style="color:#94A3B8;text-align:center;margin:60px 0">Select a thread or click + New to start a conversation.</p>
        </div>
      </div>`);
    try{
      const st=await _api('/api/whatsapp/status');
      document.getElementById('wa-status').innerHTML = st.configured
        ? `<div style="background:#ECFDF5;color:#065F46;padding:10px 14px;border-radius:8px;font-size:13px">✓ WhatsApp configured (phone ${st.phoneNumberId}). Webhook URL: <code>${location.origin}/api/whatsapp/webhook</code></div>`
        : `<div style="background:#FEF3C7;color:#78350F;padding:12px 14px;border-radius:8px;font-size:13px">⚠ WhatsApp not configured. Add <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_ACCESS_TOKEN</code> and <code>WHATSAPP_VERIFY_TOKEN</code> in Secrets, then point your Meta webhook to <code>${location.origin}/api/whatsapp/webhook</code>.</div>`;
      const t=await _api('/api/whatsapp/threads');
      document.getElementById('wa-threads').innerHTML = t.threads.length
        ? t.threads.map(th=>`<div class="wa-thread-row" data-wa="${_esc(th.wa_id)}" style="padding:10px;border-radius:8px;cursor:pointer;border-bottom:1px solid #F1F5F9"><div style="font-weight:600;font-size:14px">${_esc(th.name||th.wa_id)}</div><div style="font-size:12px;color:#64748B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(th.preview||'')}</div></div>`).join('')
        : '<p style="color:#94A3B8;font-size:13px">No threads yet.</p>';
      document.querySelectorAll('.wa-thread-row').forEach(r=>r.addEventListener('click',()=>openThread(r.dataset.wa)));
    }catch(e){ _toast(e.message,'err'); }

    // ── Templates manager ───────────────────────────────────────────────────
    document.getElementById('wa-tpls').addEventListener('click', async ()=>{
      _modal('📋 WhatsApp Templates', `<div id="tpl_list">Loading…</div>
        <hr style="border:0;border-top:1px solid #E5E7EB;margin:16px 0">
        <h3 style="margin:0 0 10px;font-size:15px">Save / update template</h3>
        <p style="font-size:12px;color:#64748B;margin:0 0 10px">Use <code>{{1}}</code>, <code>{{2}}</code> for variables. Tick "Meta-approved" only after Meta has approved this exact template name in your WhatsApp Business Manager — otherwise sends use plain text (24-hour window only).</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <label>Name (lowercase, no spaces)<input id="tpl_n" placeholder="welcome_offer" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
          <label>Language<input id="tpl_l" value="en_US" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
        </div>
        <label>Body<textarea id="tpl_b" rows="3" placeholder="Hi {{1}}, your order {{2}} is on its way!" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:4px 0 8px"></textarea></label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:10px"><input type="checkbox" id="tpl_a"> Already approved by Meta</label>
        <button id="tpl_save" style="background:#0066FF;color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">Save template</button>`, { width: 640 });
      async function reloadTpls(){
        try{ const j=await _api('/api/whatsapp/templates');
          document.getElementById('tpl_list').innerHTML = j.templates.length
            ? j.templates.map(t=>`<div style="border:1px solid #E5E7EB;border-radius:8px;padding:10px;margin-bottom:6px"><div style="display:flex;justify-content:space-between;align-items:start"><div><div style="font-weight:700">${_esc(t.name)} ${t.is_meta_approved?'<span style="background:#ECFDF5;color:#065F46;font-size:10px;padding:2px 6px;border-radius:99px;margin-left:4px">META ✓</span>':'<span style="background:#FEF3C7;color:#78350F;font-size:10px;padding:2px 6px;border-radius:99px;margin-left:4px">TEXT</span>'}</div><div style="font-size:12px;color:#64748B">${_esc(t.language)} · ${t.var_count} vars</div></div><button data-del="${t.id}" style="background:#FEE2E2;color:#991B1B;border:0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px">Delete</button></div><div style="font-size:13px;color:#475569;margin-top:6px;white-space:pre-wrap">${_esc(t.body)}</div></div>`).join('')
            : '<p style="color:#94A3B8;font-size:13px">No templates yet — save one below.</p>';
          document.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{ if(!confirm('Delete this template?')) return; await _api('/api/whatsapp/templates/'+b.dataset.del,{method:'DELETE'}); reloadTpls(); }));
        }catch(e){ document.getElementById('tpl_list').innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
      }
      reloadTpls();
      document.getElementById('tpl_save').addEventListener('click', async ()=>{
        try{ await _api('/api/whatsapp/templates',{method:'POST',body:{name:tpl_n.value,language:tpl_l.value,body:tpl_b.value,isMetaApproved:tpl_a.checked}}); _toast('Saved ✓'); tpl_n.value=tpl_b.value=''; tpl_a.checked=false; reloadTpls(); }
        catch(e){ _toast(e.message,'err'); }
      });
    });

    // ── Bulk sender ─────────────────────────────────────────────────────────
    document.getElementById('wa-bulk').addEventListener('click', async ()=>{
      const tplsResp = await _api('/api/whatsapp/templates').catch(()=>({templates:[]}));
      const tplOpts = tplsResp.templates.map(t=>`<option value="${t.id}" data-vc="${t.var_count}">${_esc(t.name)} (${t.var_count} vars${t.is_meta_approved?' · META':' · TEXT'})</option>`).join('');
      _modal('🚀 Bulk Send WhatsApp', `
        <p style="font-size:13px;color:#64748B;margin:0 0 14px">Pick a template, then paste recipients — one per line. Format: <code>phone, var1, var2, …</code> (phone with country code, no <code>+</code>).</p>
        <label>Campaign name<input id="bk_name" value="Campaign ${new Date().toLocaleDateString()}" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0 10px"></label>
        <label>Template<select id="bk_tpl" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0 10px">${tplOpts || '<option value="">— No templates yet — create one first —</option>'}</select></label>
        <label>Recipients (one per line)<textarea id="bk_rec" rows="8" placeholder="27821234567, Alice, ORDER-123&#10;27827654321, Bob, ORDER-124" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:monospace;font-size:12px;margin:4px 0 12px"></textarea></label>
        <button id="bk_go" style="background:#7C3AED;color:white;border:0;padding:11px 22px;border-radius:8px;font-weight:700;cursor:pointer">🚀 Launch send</button>
        <div id="bk_out" style="margin-top:12px"></div>
        <hr style="border:0;border-top:1px solid #E5E7EB;margin:18px 0 12px">
        <h3 style="margin:0 0 8px;font-size:14px">Recent campaigns</h3>
        <div id="bk_camps">Loading…</div>`, { width: 640 });
      async function reloadCamps(){
        const j=await _api('/api/whatsapp/campaigns').catch(()=>({campaigns:[]}));
        document.getElementById('bk_camps').innerHTML = j.campaigns.length
          ? j.campaigns.map(c=>`<div style="border-bottom:1px solid #F1F5F9;padding:8px 0;font-size:13px;display:flex;justify-content:space-between"><div><div style="font-weight:600">${_esc(c.name)}</div><div style="color:#64748B;font-size:12px">${_esc(c.template_name||'')} · ${c.sent}/${c.total} sent ${c.failed?'· '+c.failed+' failed':''}</div></div><span style="background:${c.status==='done'?'#ECFDF5':'#FEF3C7'};color:${c.status==='done'?'#065F46':'#78350F'};padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;align-self:center">${_esc(c.status)}</span></div>`).join('')
          : '<p style="color:#94A3B8;font-size:13px">No campaigns yet.</p>';
      }
      reloadCamps();
      document.getElementById('bk_go').addEventListener('click', async ()=>{
        const sel = document.getElementById('bk_tpl');
        const tplId = sel.value;
        if(!tplId){ _toast('Create a template first','err'); return; }
        const lines = bk_rec.value.split('\n').map(l=>l.trim()).filter(Boolean);
        const recipients = lines.map(line=>{
          const parts = line.split(',').map(s=>s.trim());
          const to = parts.shift();
          const vars = {};
          parts.forEach((v,i)=>{ vars[i+1] = v; });
          return { to, vars };
        });
        if(!recipients.length){ _toast('Add at least one recipient','err'); return; }
        document.getElementById('bk_out').innerHTML='⏳ Launching…';
        try{
          const j=await _api('/api/whatsapp/send-bulk',{method:'POST',body:{templateId:Number(tplId), name:bk_name.value, recipients}});
          document.getElementById('bk_out').innerHTML=`<div style="background:#ECFDF5;color:#065F46;padding:10px 14px;border-radius:8px;font-size:13px">✓ Campaign #${j.campaignId} queued — ${j.total} recipients. It runs in the background; refresh this list in a moment.</div>`;
          setTimeout(reloadCamps, 1500);
        }catch(e){ document.getElementById('bk_out').innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
      });
    });

    document.getElementById('wa-new').addEventListener('click',()=>{
      _modal('Send WhatsApp', `
        <label>To (phone with country code, no +)<input id="wa_to" placeholder="27821234567" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 12px"></label>
        <label>Message<textarea id="wa_msg" rows="4" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit"></textarea></label>
        <p style="font-size:12px;color:#64748B">Note: outside the 24-hour window you must use a pre-approved template instead. Set the template name in the body field.</p>
        <button id="wa_send" style="margin-top:8px;background:#25D366;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">Send</button>`);
      document.getElementById('wa_send').addEventListener('click', async ()=>{
        try{ await _api('/api/whatsapp/send',{method:'POST',body:{to:wa_to.value,text:wa_msg.value}}); _toast('Sent ✓'); document.getElementById('_studio_modal').remove(); buildWhatsApp(); }
        catch(e){ _toast(e.message,'err'); }
      });
    });

    async function openThread(wa){
      const tpane=document.getElementById('wa-thread');
      tpane.innerHTML='Loading…';
      try{
        const j=await _api('/api/whatsapp/thread/'+encodeURIComponent(wa));
        tpane.innerHTML = `<div style="display:flex;flex-direction:column;height:500px"><div style="font-weight:700;padding-bottom:10px;border-bottom:1px solid #F1F5F9">+${_esc(wa)}</div><div style="flex:1;overflow-y:auto;padding:12px 0">${j.messages.map(m=>`<div style="margin:8px 0;display:flex;${m.direction==='out'?'justify-content:flex-end':''}"><div style="max-width:70%;background:${m.direction==='out'?'#DCF8C6':'#F1F5F9'};padding:8px 12px;border-radius:12px;font-size:14px">${_esc(m.body||'')}<div style="font-size:10px;color:#64748B;margin-top:2px">${new Date(m.created_at).toLocaleString()}${m.status?' · '+_esc(m.status):''}</div></div></div>`).join('')}</div><div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid #F1F5F9"><input id="wa_reply" placeholder="Reply…" style="flex:1;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px"><button id="wa_reply_btn" style="background:#25D366;color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">Send</button></div></div>`;
        document.getElementById('wa_reply_btn').addEventListener('click', async ()=>{
          try{ await _api('/api/whatsapp/send',{method:'POST',body:{to:wa,text:wa_reply.value}}); openThread(wa); }
          catch(e){ _toast(e.message,'err'); }
        });
      }catch(e){ tpane.innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    }
  };

  // ── 7. AI VOICE CALLER view ───────────────────────────────────────────────
  window.buildVoiceCaller = async function(){
    _shell('voice-caller','📞 AI Voice Caller','Outbound voice agent + inbound AI receptionist, powered by Vapi.ai.',`
      <div id="vc-status" style="margin-bottom:16px"></div>
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0">📥 Inbound Receptionist</h3><button id="vc_in_save" style="background:#0F766E;color:white;border:0;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px">💾 Save inbound config</button></div>
        <p style="font-size:12px;color:#64748B;margin:0 0 12px">When enabled, calls to your Vapi number are answered by an AI receptionist. In Vapi → Phone Numbers, set <strong>Server URL</strong> to <code>${location.origin}/api/voice-caller/webhook</code> so Vapi asks us for the assistant on each inbound call.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600"><input type="checkbox" id="vc_in_en"> Enabled (answer inbound calls)</label>
          <label>Voice<select id="vc_in_voice" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"><option>jennifer</option><option>cole</option><option>mark</option><option>sarah</option><option>elliot</option></select></label>
        </div>
        <label>Greeting (first thing the AI says)<input id="vc_in_greet" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 8px"></label>
        <label>System prompt (how the AI should behave)<textarea id="vc_in_sys" rows="3" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:4px 0 8px"></textarea></label>
        <label>Knowledge / FAQ (paste your "About" page or any facts the AI should know)<textarea id="vc_in_kn" rows="4" placeholder="Hours: Mon-Fri 9-5. Pricing: Starter $29/mo… etc." style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:4px 0 8px"></textarea></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Notify on call (email)<input id="vc_in_em" placeholder="ops@yourdomain.com" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
          <label>Forward-to number (optional, E.164)<input id="vc_in_fw" placeholder="+27821234567" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px">📤 Place an outbound call</h3>
          <label>To (E.164, e.g. +27821234567)<input id="vc_to" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
          <label>Lead name (optional)<input id="vc_name" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
          <label>Goal
            <select id="vc_goal" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px">
              <option value="qualify">Qualify lead</option>
              <option value="book-meeting">Book a meeting</option>
              <option value="win-back">Win back churned customer</option>
              <option value="follow-up">Follow up after demo</option>
            </select></label>
          <label>Script / context<textarea id="vc_script" rows="6" placeholder="Hi, I'm calling on behalf of [your company]. We help [target] do [outcome]. Goal: confirm whether they have [problem] right now and book a 15-min call." style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0 12px"></textarea></label>
          <button id="vc_go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer">📞 Place call</button>
        </div>
        <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px">Recent calls</h3>
          <div id="vc_list">Loading…</div>
        </div>
      </div>`);
    try{
      const st=await _api('/api/voice-caller/status');
      document.getElementById('vc-status').innerHTML = st.configured
        ? `<div style="background:#ECFDF5;color:#065F46;padding:10px 14px;border-radius:8px;font-size:13px">✓ Vapi configured. Webhook URL: <code>${location.origin}/api/voice-caller/webhook</code></div>`
        : `<div style="background:#FEF3C7;color:#78350F;padding:12px 14px;border-radius:8px;font-size:13px">⚠ Vapi not configured. Add <code>VAPI_API_KEY</code> and <code>VAPI_PHONE_NUMBER_ID</code> in Secrets, then set Vapi server URL to <code>${location.origin}/api/voice-caller/webhook</code>.</div>`;
    }catch(e){}
    // Load existing inbound config
    try{
      const ic = await _api('/api/voice-caller/inbound-config');
      const c = ic.config || {};
      vc_in_en.checked = !!c.enabled;
      vc_in_voice.value = c.voice || 'jennifer';
      vc_in_greet.value = c.greeting || 'Hi, thanks for calling. How can I help you today?';
      vc_in_sys.value = c.systemPrompt || 'You are a friendly receptionist. Keep replies under 2 sentences. If the caller wants to book a meeting, take their name, email and preferred time, then confirm.';
      vc_in_kn.value = c.knowledge || '';
      vc_in_em.value = c.notifyEmail || '';
      vc_in_fw.value = c.forwardTo || '';
    }catch(e){}
    document.getElementById('vc_in_save').addEventListener('click', async ()=>{
      try{
        await _api('/api/voice-caller/inbound-config',{method:'POST',body:{
          enabled: vc_in_en.checked, voice: vc_in_voice.value, greeting: vc_in_greet.value,
          systemPrompt: vc_in_sys.value, knowledge: vc_in_kn.value,
          notifyEmail: vc_in_em.value, forwardTo: vc_in_fw.value
        }});
        _toast('Inbound config saved ✓');
      }catch(e){ _toast(e.message,'err'); }
    });
    async function reload(){
      try{ const j=await _api('/api/voice-caller/calls');
        document.getElementById('vc_list').innerHTML = j.calls.length
          ? j.calls.map(c=>`<div style="border-bottom:1px solid #F1F5F9;padding:10px 0;font-size:13px"><div style="font-weight:600">${_esc(c.lead_name||'')} ${_esc(c.to_number)}</div><div style="color:#64748B">${_esc(c.goal||'')} · ${_esc(c.status||'')} ${c.outcome?'· '+_esc(c.outcome):''} ${c.duration_sec?'· '+c.duration_sec+'s':''}</div>${c.summary?`<div style="margin-top:4px;color:#475569;font-style:italic">${_esc(c.summary).slice(0,200)}</div>`:''}${c.recording_url?`<a href="${_esc(c.recording_url)}" target="_blank" style="font-size:12px;color:#0066FF">▶ Recording</a>`:''}</div>`).join('')
          : '<p style="color:#94A3B8;font-size:13px">No calls yet.</p>';
      }catch(e){ document.getElementById('vc_list').innerHTML=`<div style="color:#DC2626">${_esc(e.message)}</div>`; }
    }
    reload();
    document.getElementById('vc_go').addEventListener('click', async ()=>{
      try{ await _api('/api/voice-caller/call',{method:'POST',body:{to:vc_to.value,leadName:vc_name.value,goal:vc_goal.value,script:vc_script.value}}); _toast('Call queued ✓'); reload(); }
      catch(e){ _toast(e.message,'err'); }
    });
  };

  // ── 8. BOOKINGS view ──────────────────────────────────────────────────────
  window.buildBookings = async function(){
    const slug='default';
    _shell('bookings','📅 Bookings','Configure your availability and share a public booking page.',`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px">Your schedule</h3>
          <div id="bk_form">Loading…</div>
        </div>
        <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
          <h3 style="margin:0 0 12px">Recent bookings</h3>
          <div style="background:#F0F9FF;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px">Public link: <a href="/book/${slug}" target="_blank" style="color:#0066FF;font-weight:600">${location.origin}/book/${slug}</a></div>
          <div id="bk_list">Loading…</div>
        </div>
      </div>`);
    const sched = (await _api('/api/bookings/schedule/'+slug)).schedule;
    document.getElementById('bk_form').innerHTML=`
      <label>Title<input id="bk_t" value="${_esc(sched.title)}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
      <label>Description<textarea id="bk_d" rows="2" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0 10px">${_esc(sched.description)}</textarea></label>
      <label>Duration (min)<input id="bk_dur" type="number" value="${sched.durationMin}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
      <label>Notify on booking (email)<input id="bk_n" value="${_esc(sched.notifyEmail||'')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
      <label>Weekly availability (Mon-Fri, comma-separated HH:MM)<input id="bk_w" value="${_esc((sched.weekly?.['1']||['09:00','10:00','11:00','14:00','15:00']).join(','))}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0 10px"></label>
      <button id="bk_save" style="background:#0066FF;color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">Save schedule</button>`;
    document.getElementById('bk_save').addEventListener('click', async ()=>{
      const times = bk_w.value.split(',').map(s=>s.trim()).filter(Boolean);
      const weekly = { '1':times,'2':times,'3':times,'4':times,'5':times };
      try{ await _api('/api/bookings/schedule/'+slug,{method:'POST',body:{title:bk_t.value,description:bk_d.value,durationMin:Number(bk_dur.value)||30,notifyEmail:bk_n.value,weekly}}); _toast('Saved ✓'); }
      catch(e){ _toast(e.message,'err'); }
    });
    const list=(await _api('/api/bookings/list/'+slug)).bookings;
    document.getElementById('bk_list').innerHTML = list.length
      ? list.map(b=>`<div style="border-bottom:1px solid #F1F5F9;padding:10px 0;font-size:13px"><div style="font-weight:600">${_esc(b.name)} · ${new Date(b.starts_at).toLocaleString()}</div><div style="color:#64748B">${_esc(b.email)}${b.phone?' · '+_esc(b.phone):''}</div>${b.notes?`<div style="font-size:12px;color:#475569;margin-top:4px">${_esc(b.notes)}</div>`:''}</div>`).join('')
      : '<p style="color:#94A3B8;font-size:13px">No bookings yet.</p>';
  };

  // ── 9. SITE BUILDER view ──────────────────────────────────────────────────
  window.buildSiteBuilder = async function(){
    _shell('site-builder','🧱 Landing Page Builder','Generate full landing pages from a brief — published instantly.',`
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
        <h3 style="margin:0 0 12px">Generate a new page</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Brand<input id="sb_b" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
          <label>Audience<input id="sb_a" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        </div>
        <label>Value proposition<textarea id="sb_v" rows="2" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:inherit;margin:6px 0"></textarea></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Slug (URL part)<input id="sb_s" placeholder="my-launch" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
          <label>Primary color<input id="sb_c" type="color" value="#0066FF" style="width:100%;padding:6px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0;height:40px"></label>
        </div>
        <button id="sb_go" style="background:#0066FF;color:white;border:0;padding:12px 24px;border-radius:8px;font-weight:700;cursor:pointer;margin-top:8px">✨ Generate page</button>
      </div>
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px">
        <h3 style="margin:0 0 12px">Your pages</h3>
        <div id="sb_list">Loading…</div>
      </div>`);
    async function reload(){
      const j=await _api('/api/site-builder/pages');
      document.getElementById('sb_list').innerHTML = j.pages.length
        ? j.pages.map(p=>`<div style="border-bottom:1px solid #F1F5F9;padding:10px 0;display:flex;justify-content:space-between;align-items:center;gap:8px"><div><div style="font-weight:600">${_esc(p.title||p.slug)}</div><div style="font-size:12px;color:#64748B">${p.blockCount} blocks · /${p.slug}</div></div><div style="display:flex;gap:6px"><button data-add-search="${_esc(p.slug)}" style="background:#7C3AED;color:white;border:0;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:12px">+ Search block</button><a href="/lp/${_esc(p.slug)}" target="_blank" style="background:#0F172A;color:white;padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px">🔗 View</a></div></div>`).join('')
        : '<p style="color:#94A3B8;font-size:13px">No pages yet — generate one above.</p>';
      document.querySelectorAll('[data-add-search]').forEach(b=>b.addEventListener('click', ()=>addSearchBlock(b.dataset.addSearch)));
    }
    async function addSearchBlock(slug){
      _modal('+ Add searchable list block', `
        <p style="font-size:13px;color:#64748B;margin:0 0 10px">Adds a search bar + filterable card grid to <code>/lp/${_esc(slug)}</code>. Internal-search queries (and zero-result ones) are captured under Page Insights.</p>
        <label>Section heading<input id="sx_h" placeholder="Browse our resources" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
        <label>Subheading<input id="sx_s" placeholder="Search by topic, keyword or product name" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;margin:4px 0"></label>
        <label>Items (one per line — <code>title | body | url</code>)<textarea id="sx_i" rows="6" placeholder="Pricing | See plans starting at $29 | https://example.com/pricing&#10;Onboarding guide | 5-min walkthrough for new users | https://example.com/start" style="width:100%;padding:9px;border:1.5px solid #E5E7EB;border-radius:8px;font-family:monospace;font-size:12px;margin:4px 0 10px"></textarea></label>
        <button id="sx_save" style="background:#7C3AED;color:white;border:0;padding:10px 18px;border-radius:8px;font-weight:700;cursor:pointer">Add block</button>`, { width: 600 });
      document.getElementById('sx_save').addEventListener('click', async ()=>{
        try{
          const items = sx_i.value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{
            const [title='', body='', url=''] = l.split('|').map(s=>s.trim());
            return { title, body, url };
          });
          const page = (await _api('/api/site-builder/page/'+encodeURIComponent(slug))).page;
          const blocks = (page.blocks || []).filter(b=>b.type!=='search');
          blocks.push({ type:'search', heading:sx_h.value, subheading:sx_s.value, placeholder:'Search…', items });
          await _api('/api/site-builder/page/'+encodeURIComponent(slug),{method:'POST',body:{...page,blocks}});
          _toast('Search block added ✓'); document.getElementById('_studio_modal').remove(); reload();
        }catch(e){ _toast(e.message,'err'); }
      });
    }
    reload();
    document.getElementById('sb_go').addEventListener('click', async ()=>{
      try{ const j=await _api('/api/site-builder/ai-generate',{method:'POST',body:{brand:sb_b.value,valueProp:sb_v.value,audience:sb_a.value,primaryColor:sb_c.value,slug:sb_s.value||undefined}});
        _toast('Page published ✓'); window.open('/lp/'+j.slug,'_blank'); reload();
      }catch(e){ _toast(e.message,'err'); }
    });
  };

  // ── 10. LINK-IN-BIO view ──────────────────────────────────────────────────
  window.buildLinksell = async function(){
    const slug='me';
    _shell('linksell','🔗 Link-in-Bio + Checkout','Public bio page with links, lead opt-in and Stripe checkout.',`
      <div style="background:#F0F9FF;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px">Public link: <a href="/bio/${slug}" target="_blank" style="color:#0066FF;font-weight:600">${location.origin}/bio/${slug}</a></div>
      <div id="ls_form">Loading…</div>`);
    const page = (await _api('/api/linksell/page/'+slug)).page;
    document.getElementById('ls_form').innerHTML = `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
        <h3 style="margin:0 0 12px">Page</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label>Title<input id="ls_t" value="${_esc(page.title)}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
          <label>Avatar URL<input id="ls_av" value="${_esc(page.avatarUrl||'')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        </div>
        <label>Bio<input id="ls_bio" value="${_esc(page.bio||'')}" style="width:100%;padding:10px;border:1.5px solid #E5E7EB;border-radius:8px;margin:6px 0"></label>
        <label>Primary color<input id="ls_co" type="color" value="${_esc(page.primaryColor||'#0066FF')}" style="padding:6px;border:1.5px solid #E5E7EB;border-radius:8px;height:40px;margin:6px 0;display:block"></label>
      </div>
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
        <h3 style="margin:0 0 12px">Links <button id="ls_addlink" style="float:right;background:#0F766E;color:white;border:0;padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer">+ Add link</button></h3>
        <div id="ls_links"></div>
      </div>
      <div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:18px;margin-bottom:16px">
        <h3 style="margin:0 0 12px">Products (Stripe checkout) <button id="ls_addprod" style="float:right;background:#7C3AED;color:white;border:0;padding:6px 12px;border-radius:6px;font-size:13px;cursor:pointer">+ Add product</button></h3>
        <div id="ls_prods"></div>
      </div>
      <button id="ls_save" style="background:#0066FF;color:white;border:0;padding:12px 28px;border-radius:8px;font-weight:700;cursor:pointer">💾 Save page</button>`;
    let links = page.links || [], prods = page.products || [];
    function renderLinks(){ document.getElementById('ls_links').innerHTML = links.map((l,i)=>`<div style="display:flex;gap:6px;margin-bottom:6px"><input value="${_esc(l.icon||'🔗')}" data-k="icon" data-i="${i}" style="width:50px;padding:8px;border:1px solid #E5E7EB;border-radius:6px;text-align:center"><input value="${_esc(l.label||'')}" data-k="label" data-i="${i}" placeholder="Label" style="flex:1;padding:8px;border:1px solid #E5E7EB;border-radius:6px"><input value="${_esc(l.url||'')}" data-k="url" data-i="${i}" placeholder="https://" style="flex:2;padding:8px;border:1px solid #E5E7EB;border-radius:6px"><button data-rm-link="${i}" style="background:#FEE2E2;color:#991B1B;border:0;padding:8px 12px;border-radius:6px;cursor:pointer">×</button></div>`).join(''); document.querySelectorAll('[data-rm-link]').forEach(b=>b.addEventListener('click',()=>{links.splice(+b.dataset.rmLink,1);renderLinks();})); document.querySelectorAll('#ls_links input').forEach(i=>i.addEventListener('input',()=>{links[+i.dataset.i][i.dataset.k]=i.value;})); }
    function renderProds(){ document.getElementById('ls_prods').innerHTML = prods.map((p,i)=>`<div style="border:1px solid #E5E7EB;border-radius:8px;padding:10px;margin-bottom:8px"><div style="display:grid;grid-template-columns:1fr 100px 80px 30px;gap:6px"><input value="${_esc(p.name||'')}" data-k="name" data-i="${i}" placeholder="Product name" style="padding:8px;border:1px solid #E5E7EB;border-radius:6px"><input value="${p.priceCents/100||''}" data-k="price" data-i="${i}" placeholder="9.99" type="number" step="0.01" style="padding:8px;border:1px solid #E5E7EB;border-radius:6px"><input value="${_esc(p.currency||'usd')}" data-k="currency" data-i="${i}" style="padding:8px;border:1px solid #E5E7EB;border-radius:6px"><button data-rm-prod="${i}" style="background:#FEE2E2;color:#991B1B;border:0;border-radius:6px;cursor:pointer">×</button></div><input value="${_esc(p.description||'')}" data-k="description" data-i="${i}" placeholder="Description" style="width:100%;padding:8px;border:1px solid #E5E7EB;border-radius:6px;margin-top:6px;box-sizing:border-box"></div>`).join(''); document.querySelectorAll('[data-rm-prod]').forEach(b=>b.addEventListener('click',()=>{prods.splice(+b.dataset.rmProd,1);renderProds();})); document.querySelectorAll('#ls_prods input').forEach(i=>i.addEventListener('input',()=>{const p=prods[+i.dataset.i]; if(i.dataset.k==='price') p.priceCents=Math.round(Number(i.value||0)*100); else p[i.dataset.k]=i.value;})); }
    renderLinks(); renderProds();
    document.getElementById('ls_addlink').addEventListener('click',()=>{links.push({icon:'🔗',label:'',url:''});renderLinks();});
    document.getElementById('ls_addprod').addEventListener('click',()=>{prods.push({id:'p_'+Date.now().toString(36),name:'',priceCents:999,currency:'usd',description:''});renderProds();});
    document.getElementById('ls_save').addEventListener('click', async ()=>{
      try{ await _api('/api/linksell/page/'+slug,{method:'POST',body:{title:ls_t.value,bio:ls_bio.value,avatarUrl:ls_av.value,primaryColor:ls_co.value,links,products:prods}}); _toast('Saved ✓'); }
      catch(e){ _toast(e.message,'err'); }
    });
  };
})();

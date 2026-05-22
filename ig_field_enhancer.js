// ============================================================================
// InfoGenie — Global Field Enhancer
// ----------------------------------------------------------------------------
// Single MutationObserver-based pass that decorates every visible input/textarea
// the SPA renders with:
//
//   • 🧠 AI Suggest button — grounded in the analysed brand/industry/competitors
//   • For Brand-like fields: 📊 Use my brand pill + 📊 Pick competitor dropdown
//   • For Competitor-like fields: ⚔ Pick competitor dropdown
//
// This avoids touching the 47k-line app.js per-form; any new view rendered by
// any future feature gets the treatment for free. Fields whose surrounding
// container already contains an "AI Suggest" button are skipped so the
// hand-wired Headline Tester / Presentation modal don't double-decorate.
// ============================================================================
(function igFieldEnhancer(){
  if (window.__IG_FIELD_ENHANCER__) return;
  window.__IG_FIELD_ENHANCER__ = true;

  // Skip technical / structured input types entirely — these aren't free-text
  // suggestions and trying to "AI guess" them would be wrong. `search` is in
  // here because users type live queries, not AI-suggested values.
  const SKIP_TYPES = new Set([
    'hidden','file','checkbox','radio','color','range',
    'date','datetime-local','month','week','time',
    'password','number','search'
  ]);

  // Skip fields that clearly hold secrets/auth tokens or live list-search
  // queries. Word-boundary match so labels like "Search campaigns",
  // "Filter by channel", "API token" all hit. We keep "email/phone/url"
  // enabled — those benefit from a realistic AI-suggested example.
  const SKIP_KEYWORDS = /\b(api[_-]?key|access[_-]?token|bearer|token|secret|otp|2fa|verification[_-]?code|recaptcha|csrf|search|searching|filter|filtering|query|sort)\b/i;

  // Heuristics for the two "magic" field types that get auto-populate + picker.
  const BRAND_RE = /(^|\b)(brand|company|business[ _-]?name|your[ _-]?brand|brand[ _-]?name|company[ _-]?name|main[ _-]?brand|account[ _-]?name)(\b|$)/i;
  const COMP_RE  = /(competitor|rival|vs\.?\s|versus\s|compete[ _-]?with)/i;

  // ──────────────────────────────────────────────────────────────────────────
  // Live readers — never cache, so when window.analysisData updates after the
  // analyse-now flow finishes, the next click already sees the new values.
  // ──────────────────────────────────────────────────────────────────────────
  function ad(){ return window.analysisData || {}; }
  function getBrand(){ const a = ad(); return a.brandName || a.brand || ''; }
  function getIndustry(){ const a = ad(); return (a.industry && (a.industry.name || a.industry)) || ''; }
  function getCompetitors(){
    const a = ad();
    return (a.competitors || [])
      .map(c => (typeof c === 'string' ? c : (c && (c.name || c.brand)) || ''))
      .filter(Boolean);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Label discovery — tries several strategies in order so we get a useful
  // prompt for the AI even when forms use ad-hoc markup (no <label for=…>).
  // ──────────────────────────────────────────────────────────────────────────
  function findLabel(el){
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.id) {
      try {
        const lab = document.querySelector('label[for="' + (CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
        if (lab) return cleanLabel(lab.textContent);
      } catch(_) {}
    }
    // Wrapping <label>
    let p = el.parentElement;
    for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
      if (p.tagName === 'LABEL') {
        const t = (p.textContent || '').replace(el.value || '', '');
        return cleanLabel(t);
      }
    }
    // Preceding label-ish sibling (<label>, or short <div> used as label)
    let prev = el.previousElementSibling;
    let hops = 0;
    while (prev && hops++ < 3) {
      if (prev.tagName === 'LABEL') return cleanLabel(prev.textContent);
      const t = (prev.textContent || '').trim();
      if (t && t.length < 60 && /^[A-Za-z][\w \-\(\)\/&,'?:]+$/.test(t)) return cleanLabel(t);
      prev = prev.previousElementSibling;
    }
    // Parent's first child if it's a short label-looking node
    const parent = el.parentElement;
    if (parent && parent.firstElementChild && parent.firstElementChild !== el) {
      const t = (parent.firstElementChild.textContent || '').trim();
      if (t && t.length < 60) return cleanLabel(t);
    }
    return el.placeholder || el.name || el.id || '';
  }
  function cleanLabel(s){ return String(s || '').replace(/\s+/g, ' ').replace(/\*$/,'').trim(); }

  // ──────────────────────────────────────────────────────────────────────────
  function alreadyHandled(el){
    if (el.dataset.igEnhanced) return true;
    // Skip if THIS field already has an AI Suggest button next to it (the
    // hand-wired flows like Headline Tester / Creator Studio). We only look
    // at the immediate label or the direct parent — NOT the whole <form>,
    // because as soon as one field in a form gets decorated, the form's
    // innerHTML would contain "AI Suggest" and every other field would
    // wrongly be considered already handled.
    const lab = el.closest('label');
    if (lab && /AI\s*Suggest|🧠/i.test(lab.innerHTML || '')) return true;
    const parent = el.parentElement;
    if (parent && /AI\s*Suggest|🧠/i.test(parent.innerHTML || '')) return true;
    return false;
  }

  function isEligible(el){
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || 'text').toLowerCase())) return false;
    if (el.tagName === 'SELECT') return false; // selects get skipped globally
    // Skip fields explicitly opted out via data-ig-skip attribute
    if (el.dataset.igSkip !== undefined) return false;
    // Skip the auth wall (login / signup / forgot-password): those fields are
    // personal credentials with no brand context yet — AI Suggest would be
    // both useless and confusing. Covers password reset page too.
    if (el.closest('#igAuthWall, #igForgotForm, #ig-reset-form, [data-auth-form]')) return false;
    // Skip the Analyse Now hero inputs — URL/industry/competitor fields are
    // user-typed structured values, not AI-fillable free-text.
    if (el.closest('.url-card')) return false;
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  function btn(text, opts){
    opts = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText =
      'background:' + (opts.bg || 'linear-gradient(135deg,#7C3AED,#A855F7)') + ';' +
      'color:' + (opts.color || '#fff') + ';' +
      'border:1px solid ' + (opts.border || 'transparent') + ';' +
      'padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;' +
      'white-space:nowrap;line-height:1.4;font-family:inherit';
    return b;
  }

  function fireInput(el){
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // AI Suggest — calls /api/studio/ai-suggest with rich context and shows a
  // live ⏳ Thinking… [N.Ns] timer in the field. On failure, restores the
  // previous value and surfaces the error via showToast so the user knows
  // why nothing happened (per project rule: NO silent dummy fallback).
  // ──────────────────────────────────────────────────────────────────────────
  async function runAISuggest(el, labelText){
    const prev = el.value;
    const isArea = el.tagName === 'TEXTAREA';
    const t0 = performance.now();
    el.value = '⏳ Thinking… [0.0s]';
    el.disabled = true;
    const iv = setInterval(() => {
      el.value = '⏳ Thinking… [' + ((performance.now() - t0) / 1000).toFixed(1) + 's]';
    }, 100);
    try {
      const label = (labelText || '').replace(/\(optional\)/ig, '').trim() || 'this form field';
      const sectionHeading = (document.querySelector('.view.active h1, .view.active h2, .view.active h3') ||
                              document.querySelector('h1, h2, h3'));
      const sectionTitle = sectionHeading ? (sectionHeading.textContent || '').trim().slice(0, 120) : '';
      const prompt = 'Generate a realistic value for the form field labelled "' + label + '"' +
        (sectionTitle ? ' inside the "' + sectionTitle + '" section' : '') + '. ' +
        (isArea
          ? 'Reply with 1-3 concise sentences appropriate for this field. No preamble, no quotes, no markdown.'
          : 'Reply with ONE short value only — no preamble, no quotes, no markdown.');
      const r = await fetch('/api/studio/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: prompt,
          brand: getBrand(),
          industry: getIndustry(),
          competitors: getCompetitors(),
          currentValue: prev,
          context: 'Section: ' + (sectionTitle || 'unknown') + '. Placeholder: ' + (el.placeholder || '(none)')
        })
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
      const v = String(j.value || '').trim();
      if (!v) throw new Error('AI returned empty');
      el.value = v;
      fireInput(el);
    } catch (e) {
      el.value = prev;
      (window.showToast || function(m){ console.warn(m); })('⚠ AI Suggest failed: ' + e.message);
    } finally {
      clearInterval(iv);
      el.disabled = false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Per-field decoration. Builds a thin toolbar and inserts it directly above
  // the input. We use insertBefore on the parent so we don't disturb sibling
  // layout (grids etc.). Auto-populates Brand fields on the spot.
  // ──────────────────────────────────────────────────────────────────────────
  function decorate(el){
    if (alreadyHandled(el)) return;
    if (!isEligible(el)) return;
    const labelText = findLabel(el);
    const haystack = (labelText + ' ' + (el.placeholder || '') + ' ' + (el.id || '') + ' ' + (el.name || '')).trim();
    if (!haystack) return;
    if (SKIP_KEYWORDS.test(haystack)) return;

    el.dataset.igEnhanced = '1';

    // Classify by the human label only — using the placeholder or id/name as
    // signal causes false positives (e.g. an Email field with placeholder
    // "you@company.com" would otherwise be tagged as a Brand field).
    const classifySrc = (labelText || '').trim();
    const isBrand = !!classifySrc && BRAND_RE.test(classifySrc) && !COMP_RE.test(classifySrc);
    const isComp  = !!classifySrc && COMP_RE.test(classifySrc);

    // Auto-populate brand fields on creation when empty.
    if (isBrand && !el.value) {
      const b = getBrand();
      if (b) { el.value = b; fireInput(el); }
    }

    const bar = document.createElement('div');
    bar.dataset.igBar = '1';
    bar.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin:0 0 4px';

    if (isBrand) {
      const useBtn = btn('📊 Use my brand', { bg:'#EEF2FF', color:'#4F46E5', border:'#C7D2FE' });
      useBtn.addEventListener('click', () => {
        const b = getBrand();
        if (!b) return (window.showToast || alert)('⚠ Run Analyse first to set your brand');
        el.value = b; fireInput(el);
      });
      bar.appendChild(useBtn);

      const sel = buildCompetitorSelect(el, '📊 Pick competitor…');
      if (sel) bar.appendChild(sel);
    } else if (isComp) {
      const sel = buildCompetitorSelect(el, '⚔ Pick competitor…', { bg:'#FFF7ED', color:'#9A3412', border:'#FED7AA' });
      if (sel) bar.appendChild(sel);
    }

    // Every eligible field gets AI Suggest.
    const ai = btn('🧠 AI Suggest');
    ai.addEventListener('click', () => runAISuggest(el, labelText));
    bar.appendChild(ai);

    // Insert toolbar directly above the input.
    if (el.parentNode) el.parentNode.insertBefore(bar, el);
  }

  function buildCompetitorSelect(el, placeholder, style){
    style = style || { bg:'#EEF2FF', color:'#4F46E5', border:'#C7D2FE' };
    const comps = getCompetitors();
    const sel = document.createElement('select');
    sel.dataset.igCompPicker = '1';
    sel.style.cssText = 'background:' + style.bg + ';color:' + style.color + ';border:1px solid ' + style.border + ';' +
      'padding:2px 6px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit';
    function rebuild(){
      const list = getCompetitors();
      sel.innerHTML = '<option value="">' + placeholder + '</option>' +
        list.map(c => '<option>' + escapeHtml(c) + '</option>').join('');
      sel.style.display = list.length ? '' : 'none';
    }
    rebuild();
    sel.addEventListener('change', () => {
      if (sel.value) { el.value = sel.value; fireInput(el); sel.selectedIndex = 0; }
    });
    // Re-fetch competitors whenever analysis updates.
    window.addEventListener('ig:analysis-updated', rebuild);
    return sel;
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Selector for every input/textarea worth considering. `input[type="search"]`
  // is intentionally omitted — those are live-query fields the user types into
  // (handled separately in isEligible).
  const SCAN_SEL = 'input[type="text"],input[type="email"],input[type="url"],' +
                   'input[type="tel"],input:not([type]),textarea';

  function scan(root){
    (root || document).querySelectorAll(SCAN_SEL).forEach(decorate);
  }

  // Only freshly-inserted subtrees are scanned — never the whole document.
  // Hard cap on how many input/textarea elements we decorate per animation
  // frame. When buildIntelligence (or any other heavy builder) dumps a big
  // subtree containing 100+ inputs at once, decorating them all in a single
  // rAF would block the main thread for seconds and trigger the browser's
  // "page unresponsive" warning. We process up to MAX_PER_FRAME, then yield
  // and resume in the next frame.
  const MAX_PER_FRAME = 25;
  const pendingRoots  = new Set();
  const pendingInputs = []; // expanded queue of individual elements
  let rafScheduled = false;

  function expandRoots(){
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const node of roots) {
      if (!node || !node.isConnected) continue;
      if (node.matches && node.matches(SCAN_SEL)) pendingInputs.push(node);
      if (node.querySelectorAll) {
        node.querySelectorAll(SCAN_SEL).forEach(el => pendingInputs.push(el));
      }
    }
  }

  function flushPending(){
    rafScheduled = false;
    const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    expandRoots();
    const total = pendingInputs.length;
    let processed = 0;
    while (pendingInputs.length && processed < MAX_PER_FRAME) {
      const el = pendingInputs.shift();
      if (el && el.isConnected) decorate(el);
      processed++;
    }
    if (window.IGDiag && total > MAX_PER_FRAME) {
      const dt = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
      window.IGDiag.log('field-enhancer: chunked', processed + '/' + total + ' inputs in ' + dt.toFixed(0) + 'ms — ' + pendingInputs.length + ' deferred');
    }
    // More to do — schedule next chunk in the next frame
    if (pendingInputs.length || pendingRoots.size) {
      rafScheduled = true;
      (window.requestAnimationFrame || setTimeout)(flushPending, 16);
    }
  }
  function queueRoot(node){
    if (!node || node.nodeType !== 1) return;
    // PAUSE switch — set window.__IG_FIELDS_PAUSED__ = true to suppress all
    // decoration work (e.g. during analyse-flow renders that dump huge
    // subtrees). Drained automatically when the flag is cleared.
    if (window.__IG_FIELDS_PAUSED__) return;
    pendingRoots.add(node);
    if (rafScheduled) return;
    rafScheduled = true;
    (window.requestAnimationFrame || setTimeout)(flushPending, 16);
  }

  function start(){
    scan(document);
    const mo = new MutationObserver(muts => {
      if (window.__IG_FIELDS_PAUSED__) return; // hard short-circuit
      for (const m of muts) {
        if (!m.addedNodes) continue;
        for (let i = 0; i < m.addedNodes.length; i++) queueRoot(m.addedNodes[i]);
      }
    });
    mo.observe(document.body, { childList:true, subtree:true });
    // Public hook so any view that swaps innerHTML can request a re-scan.
    window.IGFields = {
      rescan: () => scan(document),
      refresh: () => scan(document),
      pause:  () => { window.__IG_FIELDS_PAUSED__ = true; window.IGDiag && IGDiag.mark('field-enhancer: paused'); },
      resume: () => {
        window.__IG_FIELDS_PAUSED__ = false;
        window.IGDiag && IGDiag.mark('field-enhancer: resumed — scanning whole doc');
        // Drain whatever was missed during the pause.
        setTimeout(() => { try { scan(document); } catch(_) {} }, 0);
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

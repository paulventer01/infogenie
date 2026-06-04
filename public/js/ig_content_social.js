/* ============================================================================
 * ig_content_social.js — Content Calendar · Social Calendar · AI Visibility
 * Extracted verbatim from app.js (per public/js/README.md). Plain global script,
 * loaded after app.js in index.html. Wrapped in one IIFE; public entry points
 * re-exported to window at the bottom.
 *
 * Public entries: window.buildContent, window.buildSocialCalendar,
 *   window.buildAiVisibility (+ window._socialAutoPublishCheck, used by the
 *   reach-automation auto-publish interval). Numerous window.* action helpers
 *   (runLighthouse, generateCluster, openCreatePost, socialPublishNow, …) stay
 *   global via their existing window.X = function assignments.
 *
 * Shared from app.js (NOT moved — read at call time via the global scope):
 *   SOCIAL_PLATFORMS, FUNNEL_STAGES, POST_ARCHETYPES, _escapeHtml, _safeUrl,
 *   showToast, navigateTo, analysisData, and the window._social / _content
 *   state globals.
 * ========================================================================== */

(function () {

function buildContent() {
  const wrap = document.getElementById('contentWrap');
  if (!wrap) return;
  const tab = window._contentTab;
  const domain = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';

  // Simulate traffic + visibility data derived from analysisData
  const trafficHealth = analysisData ? 78 : 65;
  const aiVisibility  = analysisData ? 61 : 44;
  const contentScore  = analysisData ? 72 : 55;
  const gapCount      = analysisData ? 23 : 18;

  const tabs = [
    { id:'overview', label:'📊 Overview' },
    { id:'clusters', label:'🧩 Topical Clusters' },
    { id:'gaps',     label:'🔍 Content Gaps' },
    { id:'audit',    label:'🛠️ Page Audit' },
    { id:'funnel',   label:'🎯 Funnel Planner' },
  ];

  const tabBar = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px">
    ${tabs.map(t=>`<button onclick="window._contentTab='${t.id}';buildContent()" style="padding:9px 18px;border-radius:9px;font-size:0.8rem;font-weight:700;cursor:pointer;border:1.5px solid ${tab===t.id?'#059669':'#E5E7EB'};background:${tab===t.id?'#065F46':'white'};color:${tab===t.id?'white':'#374151'}">${t.label}</button>`).join('')}
  </div>`;

  // ── OVERVIEW ───────────────────────────────────────────────────────────────
  const overviewHtml = (() => {
    const _kShiftBase = (analysisData?.competitors || []).slice(0,4);
    const kShifts = _kShiftBase.length ? _kShiftBase.map((c,i) => ({
      term: `${c.name||'competitor'} ${['vs','alternatives','pricing','review'][i%4]}`,
      change: ['+34%','+19%','-12%','+47%'][i%4],
      dir: [true,true,false,true][i%4],
    })) : [
      { term:'best marketing platform', change:'+41%', dir:true },
      { term:'ai marketing tools 2025', change:'+67%', dir:true },
      { term:'marketing software review', change:'-8%', dir:false },
      { term:'marketing automation free', change:'+29%', dir:true },
    ];

    const llmGaps = [
      { topic:'What is the best tool for '+industry.split(' ')[0].toLowerCase()+' automation?', cited: false, opportunity:'High' },
      { topic:'How does '+domain+' compare to alternatives?', cited: false, opportunity:'Critical' },
      { topic:'Best practices for '+industry.split(' ')[0].toLowerCase()+' in 2025', cited: false, opportunity:'High' },
      { topic:domain+' pricing and plans breakdown', cited: true, opportunity:'Existing' },
      { topic:'AI-powered '+industry.split(' ')[0].toLowerCase()+' tools comparison', cited: false, opportunity:'Critical' },
    ];

    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
        ${[
          ['Traffic Health', trafficHealth+'%', trafficHealth>70?'#10B981':trafficHealth>50?'#F59E0B':'#DC2626','📈', 'Traffic Health — how well your site\'s organic, referral and paid traffic is performing. Green = 70%+, Amber = 50–70%, Red = below 50%.'],
          ['Content Score', contentScore+'/100', contentScore>70?'#10B981':contentScore>50?'#F59E0B':'#DC2626','📝', 'Content Score — overall quality and depth rating of your published content. 100 = exceptional, 70+ = good, below 50 = needs significant improvement.'],
          ['AI Visibility', aiVisibility+'%', aiVisibility>70?'#10B981':aiVisibility>50?'#F59E0B':'#DC2626','🤖', 'AI Visibility — percentage of key industry queries where AI assistants (ChatGPT, Gemini, Perplexity) cite or recommend your brand. Higher = better LLM presence.'],
          ['Content Gaps', gapCount+' found', '#7C3AED','🔍', 'Content Gaps — number of topics your competitors rank for where you currently have no content. Each gap is a missed traffic opportunity.'],
        ].map(([l,v,c,ic,tip])=>`
          <div title="${tip}" style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04);cursor:help">
            <div style="font-size:1.8rem;margin-bottom:4px">${ic}</div>
            <div style="font-size:1.5rem;font-weight:800;color:${c}">${v}</div>
            <div style="font-size:0.65rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">${l}</div>
          </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <!-- Keyword Shifts -->
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:14px">📉 Keyword Shift Monitor</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-bottom:12px">Trending shifts in your industry — act before traffic drops.</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${kShifts.map(k=>`
              <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:${k.dir?'#F0FDF4':'#FFF5F5'};border:1px solid ${k.dir?'#BBF7D0':'#FCA5A5'};border-radius:9px">
                <div style="font-size:0.78rem;font-weight:600;color:#374151;flex:1">${k.term}</div>
                <div style="font-size:0.78rem;font-weight:800;color:${k.dir?'#059669':'#DC2626'};margin-left:10px">${k.change}</div>
                <button onclick="window._contentTab='clusters';window._clusterSeedPrefill='${k.term.replace(/'/g,"\\'")}';buildContent()" style="margin-left:10px;padding:3px 9px;background:${k.dir?'#059669':'#DC2626'};border:none;border-radius:6px;font-size:0.62rem;font-weight:700;color:white;cursor:pointer">${k.dir?'Capitalise':'Defend'}</button>
              </div>`).join('')}
          </div>
        </div>
        <!-- LLM Citation Gaps -->
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:6px">🤖 AI Visibility Gaps</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-bottom:12px">Topics where ChatGPT, Gemini & Perplexity are NOT citing your site — fix these to capture LLM traffic.</div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${llmGaps.map(g=>`
              <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:${g.cited?'#F0FDF4':'#FFF5F5'};border:1px solid ${g.cited?'#BBF7D0':'#FECACA'};border-radius:9px">
                <div style="flex:1">
                  <div style="font-size:0.75rem;font-weight:600;color:#0A1628;margin-bottom:2px">${g.topic}</div>
                  <div style="font-size:0.62rem;font-weight:700;color:${g.cited?'#059669':g.opportunity==='Critical'?'#DC2626':'#D97706'}">${g.cited?'✅ Cited':'⚠️ Not Cited'} · ${g.opportunity} Opportunity</div>
                </div>
                ${!g.cited?`<button onclick="window._contentTab='clusters';window._clusterSeedPrefill='${g.topic.replace(/'/g,"\\'")}';buildContent()" style="margin-left:8px;padding:4px 10px;background:#7C3AED;border:none;border-radius:6px;font-size:0.62rem;font-weight:700;color:white;cursor:pointer;flex-shrink:0">Fix Gap</button>`:''}
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  })();

  // ── TOPICAL CLUSTERS ───────────────────────────────────────────────────────
  const clustersHtml = (() => {
    const prefill = window._clusterSeedPrefill || '';
    if (prefill) { window._clusterSeedPrefill = ''; }

    const existingClusters = (window._contentClusters||[]).map((cl, ci) => `
      <div style="background:white;border:1.5px solid #E5E7EB;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 1px 6px rgba(0,0,0,0.05)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:0.65rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Topical Cluster</div>
            <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">${cl.pillar}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${cl._dualAI ? `<span title="Synthesised from GPT-4o + Claude Sonnet" style="font-size:0.6rem;font-weight:700;padding:3px 9px;border-radius:6px;background:linear-gradient(135deg,#EFF6FF,#F3E8FF);color:#6D28D9;border:1px solid #C4B5FD">✨ GPT-4o + Claude</span>` : ''}
            <span title="Number of subtopic pages in this cluster" style="font-size:0.65rem;font-weight:700;padding:3px 9px;border-radius:6px;background:#EFF6FF;color:#0066FF">${cl.topics?.length||0} Topics</span>
            <span title="Number of user questions to target for AI citation" style="font-size:0.65rem;font-weight:700;padding:3px 9px;border-radius:6px;background:#F3E8FF;color:#7C3AED">${cl.questions?.length||0} Questions</span>
            <button onclick="window._contentClusters.splice(${ci},1);buildContent()" style="font-size:0.65rem;font-weight:700;padding:3px 9px;background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px;color:#DC2626;cursor:pointer">Remove</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div>
            <div style="font-size:0.68rem;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📄 Subtopics & Pages</div>
            <div style="display:flex;flex-direction:column;gap:5px">
              ${(cl.topics||[]).map(t=>`<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;font-size:0.75rem;color:#065F46;font-weight:500"><div style="width:6px;height:6px;background:#10B981;border-radius:50%;flex-shrink:0"></div>${t}</div>`).join('')}
            </div>
          </div>
          <div>
            <div style="font-size:0.68rem;font-weight:700;color:#6D28D9;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">❓ Real User Questions</div>
            <div style="display:flex;flex-direction:column;gap:5px">
              ${(cl.questions||[]).map(q=>`<div style="display:flex;align-items:flex-start;gap:6px;padding:7px 10px;background:#F3E8FF;border:1px solid #DDD6FE;border-radius:7px;font-size:0.74rem;color:#5B21B6;font-weight:500;line-height:1.4"><div style="margin-top:2px;flex-shrink:0">❓</div>${q}</div>`).join('')}
            </div>
          </div>
        </div>
        ${cl.aiNote ? `<div style="margin-top:12px;padding:10px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;font-size:0.75rem;color:#92400E;line-height:1.5"><strong>💡 LLM Tip:</strong> ${cl.aiNote}</div>` : ''}
      </div>`).join('');

    return `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:6px">🧩 AI Topical Cluster Builder</div>
        <div style="font-size:0.78rem;color:#6B7280;margin-bottom:14px">Enter your own seed topic, or click ✨ Suggest Topics for InfoGenie to draft 5 ideas tailored to your brand.</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input id="cluster-seed" placeholder="e.g. email marketing automation, AI SEO tools, SaaS pricing strategies…" value="${prefill}" style="flex:1;min-width:200px;padding:11px 14px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          <button id="cluster-suggest-btn" onclick="suggestSeedTopic()" style="padding:11px 16px;background:white;border:1.5px solid #059669;border-radius:10px;font-size:0.82rem;font-weight:700;color:#059669;cursor:pointer;white-space:nowrap">✨ Suggest Topics</button>
          <button id="cluster-gen-btn" onclick="generateCluster()" style="padding:11px 22px;background:linear-gradient(135deg,#065F46,#059669);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">🧩 Build Cluster</button>
        </div>
        <div id="cluster-seed-suggestions" style="display:none;margin-top:12px;flex-wrap:wrap;gap:7px"></div>
        <div id="cluster-gen-status" style="display:none;margin-top:10px;font-size:0.78rem;color:#059669;font-weight:600">⏳ Building topical cluster with GPT-4o + Claude Sonnet…</div>
      </div>
      <div id="clusters-output">
        ${existingClusters || `<div style="text-align:center;padding:40px 16px;color:#9CA3AF"><div style="font-size:2.5rem;margin-bottom:10px">🧩</div><div style="font-size:0.88rem;font-weight:600">No clusters yet — build your first topical cluster above</div><div style="font-size:0.75rem;margin-top:6px">Try: "marketing automation", "competitor analysis", or "AI content creation"</div></div>`}
      </div>`;
  })();

  // ── CONTENT GAPS ──────────────────────────────────────────────────────────
  const gapsHtml = (() => {
    const gaps = window._contentGapList || [
      { type:'Missing Page',   topic:'What is '+industry.split(' ')[0]+' automation?',       intent:'Informational', volume:'8.2K/mo',  priority:'Critical', llm:true },
      { type:'Thin Content',   topic:domain+' vs alternatives comparison',                    intent:'Comparison',    volume:'4.1K/mo',  priority:'Critical', llm:true },
      { type:'Missing Page',   topic:'Best '+industry.split(' ')[0].toLowerCase()+' tools 2025', intent:'Commercial', volume:'11.5K/mo', priority:'High',     llm:true },
      { type:'Outdated',       topic:'Getting started with '+domain,                          intent:'Navigational',  volume:'2.8K/mo',  priority:'Medium',   llm:false },
      { type:'Missing Page',   topic:industry.split(' ')[0]+' ROI calculator',                intent:'Tool',          volume:'3.4K/mo',  priority:'High',     llm:false },
      { type:'Thin Content',   topic:domain+' case studies and success stories',              intent:'Trust',         volume:'1.9K/mo',  priority:'Medium',   llm:true },
      { type:'Missing Page',   topic:'How to choose a '+industry.split(' ')[0].toLowerCase()+' platform', intent:'Educational', volume:'6.7K/mo', priority:'High', llm:true },
      { type:'Outdated',       topic:domain+' pricing guide',                                 intent:'Commercial',    volume:'5.3K/mo',  priority:'High',     llm:false },
    ];
    window._contentGapList = gaps;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">🔍 Content Gap Analysis</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px">Pages your competitors rank for and AI engines cite — but you're missing or underperforming on</div>
        </div>
        <button onclick="window._contentTab='clusters';buildContent()" style="padding:9px 18px;background:linear-gradient(135deg,#065F46,#059669);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">🧩 Generate Clusters for All Gaps</button>
      </div>
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;padding:10px 16px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;font-size:0.65rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">
          <div>Topic / Page</div><div>Intent</div><div>Volume</div><div>Priority</div><div>Action</div>
        </div>
        ${gaps.map(g=>`
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;padding:12px 16px;border-bottom:1px solid #F3F4F6;align-items:center;gap:8px">
            <div>
              <div style="font-size:0.8rem;font-weight:600;color:#0A1628;margin-bottom:2px">${g.topic}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:0.62rem;font-weight:700;padding:2px 7px;background:${g.type==='Missing Page'?'#FEF2F2':g.type==='Outdated'?'#FFFBEB':'#EFF6FF'};color:${g.type==='Missing Page'?'#DC2626':g.type==='Outdated'?'#D97706':'#0066FF'};border-radius:4px">${g.type}</span>
                ${g.llm?`<span style="font-size:0.6rem;font-weight:700;padding:2px 7px;background:#F3E8FF;color:#7C3AED;border-radius:4px">🤖 LLM Gap</span>`:''}
              </div>
            </div>
            <div style="font-size:0.75rem;color:#6B7280;font-weight:500">${g.intent}</div>
            <div style="font-size:0.78rem;font-weight:700;color:#0A1628">${g.volume}</div>
            <div><span style="font-size:0.65rem;font-weight:700;padding:3px 8px;border-radius:6px;background:${g.priority==='Critical'?'#FEF2F2':g.priority==='High'?'#FFFBEB':'#F0FDF4'};color:${g.priority==='Critical'?'#DC2626':g.priority==='High'?'#D97706':'#059669'}">${g.priority}</span></div>
            <div><button onclick="openBuildContentModal('${g.topic.replace(/'/g,"\\'")}','${g.intent}')" style="padding:5px 11px;background:#059669;border:none;border-radius:7px;font-size:0.68rem;font-weight:700;color:white;cursor:pointer">✍️ Build Content</button></div>
          </div>`).join('')}
      </div>`;
  })();

  // ── PAGE AUDIT ────────────────────────────────────────────────────────────
  const auditHtml = (() => {
    const pages = window._pageAuditList || [
      { url:'/blog/getting-started',      title:'Getting Started Guide',           issue:'Outdated — last updated 18 months ago', crawl:62, fix:'Refresh with 2025 data and add FAQ schema' },
      { url:'/pricing',                   title:'Pricing Page',                    issue:'Thin content — no comparison table',    crawl:74, fix:'Add competitor pricing comparison + schema' },
      { url:'/features',                  title:'Features Overview',               issue:'Missing H2 structure, no internal links', crawl:55, fix:'Add subheadings, internal links, FAQ block' },
      { url:'/blog/ai-tools-comparison',  title:'AI Tools Comparison (2023)',      issue:'Outdated year in title and body content', crawl:48, fix:'Update to 2025, add new tools, refresh stats' },
      { url:'/about',                     title:'About Us',                        issue:'No structured data or social proof',    crawl:80, fix:'Add LocalBusiness schema + team profiles' },
      { url:'/blog/roi-guide',            title:'Marketing ROI Guide',             issue:'No internal links pointing here',       crawl:66, fix:'Add internal links from 5 related blog posts' },
    ];
    window._pageAuditList = pages;
    const noticeBanner = window._pageAuditNotice
      ? `<div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:12px;padding:14px 16px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px"><div style="font-size:1.25rem;line-height:1">⛔</div><div><div style="font-size:0.82rem;font-weight:700;color:#92400E;margin-bottom:3px">Site blocks automated crawlers</div><div style="font-size:0.75rem;color:#78350F;line-height:1.55">${_escapeHtml(window._pageAuditNotice)}</div></div></div>`
      : '';
    return `
      ${noticeBanner}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">🛠️ Page Crawlability & Content Audit</div>
          <div style="font-size:0.78rem;color:#6B7280;margin-top:3px">Find pages with crawl issues, thin content, and missing structured data — ranked by fix impact.</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="lighthouseRunBtn" onclick="runLighthouse('mobile')" style="padding:9px 16px;background:linear-gradient(135deg,#0F766E,#14B8A6);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">⚡ Lighthouse (mobile)</button>
          <button id="pageAuditRunBtn" onclick="runRealPageAudit()" style="padding:9px 18px;background:linear-gradient(135deg,#065F46,#059669);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">⚡ Run Full Audit</button>
        </div>
      </div>
      <div id="lighthousePanel" style="margin-bottom:14px"></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${pages.map(p=>{
          const score = p.crawl;
          const sc = score>=75?'#10B981':score>=55?'#F59E0B':'#DC2626';
          return `
            <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.04);display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center">
              <div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                  <div style="font-size:0.85rem;font-weight:700;color:#0A1628">${_escapeHtml(p.title || '')}</div>
                  <code style="font-size:0.68rem;color:#6B7280;background:#F3F4F6;padding:1px 7px;border-radius:4px">${_escapeHtml(p.url || '')}</code>
                </div>
                <div style="font-size:0.75rem;color:#DC2626;font-weight:600;margin-bottom:4px">⚠️ ${_escapeHtml(p.issue || '')}</div>
                <div style="font-size:0.74rem;color:#059669;line-height:1.4"><strong>AI Fix:</strong> ${_escapeHtml(p.fix || '')}</div>
              </div>
              <div style="text-align:center;flex-shrink:0">
                <div style="width:52px;height:52px;border-radius:50%;background:conic-gradient(${sc} ${score*3.6}deg,#E5E7EB ${score*3.6}deg);display:flex;align-items:center;justify-content:center;position:relative;margin:0 auto 4px">
                  <div style="width:36px;height:36px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.78rem;font-weight:800;color:${sc}">${score}</div>
                </div>
                <div style="font-size:0.62rem;color:#6B7280;font-weight:600">Crawl Score</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  })();

  // ── FUNNEL PLANNER ────────────────────────────────────────────────────────
  const funnelHtml = (() => {
    const _fc = {}; FUNNEL_STAGES.forEach(s=>{_fc[s.id]=0;}); (window._socialPosts||[]).forEach(p=>{if(p.funnelStage&&_fc[p.funnelStage]!=null)_fc[p.funnelStage]++;});
    const FORMAT_EXAMPLES = {
      awareness:  [['Story-driven Reel','Hook with a relatable pain point in the first 2s, educate with one tip, end with a soft CTA'],['Micro-education post','Teach one high-value concept fast — carousel or short Reel'],['Trend adaptation','Take a trending format and add your unique niche perspective']],
      interest:   [['Framework carousel','Visual step-by-step blueprint people will save & share'],['Before / After post','Show the problem vs the shift — use real data or client results'],['Expert tutorial','Position yourself as the authority — "What most people get wrong about X"']],
      nurture:    [['Process story','Share behind-the-scenes of how you deliver results'],['Belief-breaker story','Myth-busting content that shifts audience perception'],['Interactive story','Poll, quiz, or question box — builds micro-commitment']],
      conversion: [['Personalised DM follow-up','Use a story or post to prompt followers to DM you a keyword, then deliver value + offer'],['Testimonial / Win post','Screenshot or video of a real result — builds social proof'],['Limited-spots offer','Urgency with a specific number — not fake scarcity, real capacity']],
      advocacy:   [['Client feature post','Celebrate a client win publicly — they share it too'],['UGC reshare','Repost customer content — lowers your effort, boosts trust'],['Referral challenge','Private challenge or bonus for clients who bring a friend']],
    };
    const stagePanels = FUNNEL_STAGES.map(s => {
      const examples = FORMAT_EXAMPLES[s.id] || [];
      return `
      <div style="background:white;border:1.5px solid ${s.color}33;border-radius:18px;padding:22px 24px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:14px;flex-wrap:wrap">
          <div style="width:46px;height:46px;background:${s.bg};border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0">${s.icon}</div>
          <div style="flex:1;min-width:180px">
            <div style="font-family:Sora,sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">${s.label} Stage</div>
            <div style="font-size:0.72rem;color:${s.color};font-weight:700;margin-top:2px">Best format: ${s.fmt}</div>
            <div style="font-size:0.72rem;color:#6B7280;margin-top:4px;line-height:1.5">${s.tip}</div>
          </div>
          <span style="font-size:0.65rem;font-weight:700;padding:3px 10px;background:${s.bg};color:${s.color};border-radius:7px;white-space:nowrap;height:fit-content">${_fc[s.id]||0} posts tagged</span>
        </div>
        <div style="border-top:1px solid #F3F4F6;padding-top:12px">
          <div style="font-size:0.65rem;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px">Content Ideas</div>
          ${examples.map(([title,desc])=>`
          <div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #F9FAFB">
            <div style="width:6px;height:6px;background:${s.color};border-radius:50%;margin-top:6px;flex-shrink:0"></div>
            <div>
              <div style="font-size:0.78rem;font-weight:700;color:#111827">${title}</div>
              <div style="font-size:0.68rem;color:#6B7280;margin-top:1px;line-height:1.45">${desc}</div>
            </div>
            <button data-stage="${s.id}" data-title="${title.replace(/"/g,'&quot;')}" onclick="window._socialTab='calendar';window._prefillFunnelStage=this.dataset.stage;navigateTo('social');showToast('✅ Opening Social Calendar — create a ${s.fmt} for ${s.label} stage!')" style="margin-left:auto;flex-shrink:0;padding:5px 12px;background:${s.bg};border:1px solid ${s.color}44;border-radius:8px;font-size:0.65rem;font-weight:700;color:${s.color};cursor:pointer;white-space:nowrap">+ Create Post</button>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('');
    return `
    <div style="background:linear-gradient(135deg,#064E3B,#065F46);border-radius:20px;padding:24px 28px;margin-bottom:24px">
      <div style="font-family:Sora,sans-serif;font-size:1.15rem;font-weight:800;color:#FFFFFF;margin-bottom:6px">🎯 Viral Content Funnel Planner</div>
      <div style="font-size:0.85rem;color:#D1FAE5;line-height:1.5">5-stage Instagram growth framework — map every post to a stage and build a funnel that converts strangers into brand evangelists</div>
    </div>
    ${stagePanels}`;
  })();

  const tabContent = { overview: overviewHtml, clusters: clustersHtml, gaps: gapsHtml, audit: auditHtml, funnel: funnelHtml };

  wrap.innerHTML = `
    <div style="padding:28px 0">
      ${tabBar}
      ${tabContent[tab] || overviewHtml}
    </div>`;

  // Wire header button
  const ab = document.getElementById('contentAnalyseBtn');
  if (ab) ab.onclick = () => {
    window._contentTab = 'gaps';
    window._contentGapList = null;
    window._pageAuditList = null;
    window._pageAuditNotice = null;
    buildContent();
    showToast('⚡ Content analysis refreshed!');
  };
}

// ── Real Page Audit ──────────────────────────────────────────────────────
// Calls /api/page-audit/run with the user's analysed domain, shows a live
// elapsed-time counter on the Run Full Audit button while it works, then
// re-renders the audit list with REAL crawled signals (replacing the mock
// fallback list). All scores come from server-side on-page extraction.
// ── Lighthouse (Google PageSpeed Insights) ─────────────────────────────────
// Calls /api/pagespeed/run with the user's analysed domain and renders real
// Core Web Vitals (LCP/FCP/CLS/TBT/SI/TTI) + top performance opportunities.
window.runLighthouse = async function(strategy) {
  if (window._lighthouseRunning) return;
  window._lighthouseRunning = true;
  const btn = document.getElementById('lighthouseRunBtn');
  const panel = document.getElementById('lighthousePanel');
  const stopTimer = window.startButtonTimer ? window.startButtonTimer(btn, 'Running PSI') : (() => {});
  const domain = (analysisData?.url || '').replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) {
    stopTimer('⚡ Lighthouse (mobile)');
    window._lighthouseRunning = false;
    showToast("⚠️ Analyse a website on the home page first — we'll run Lighthouse on that domain.");
    return;
  }
  const stratNorm = (strategy === 'desktop') ? 'desktop' : 'mobile';
  if (panel) panel.innerHTML = `<div style="background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px;padding:12px 16px;color:#0F766E;font-size:0.78rem">⏳ Running Google Lighthouse on https://${_escapeHtml(domain)} (${stratNorm}) — this can take 30–60s for heavy sites…</div>`;
  try {
    const r = await fetch('/api/pagespeed/run', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url: domain, strategy: stratNorm })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'PSI failed');
    const sc = j.score >= 90 ? '#10B981' : j.score >= 50 ? '#F59E0B' : '#DC2626';
    const m = j.metrics || {};
    const cell = (label, val, hint) => `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px;text-align:center">
        <div style="font-size:0.62rem;color:#6B7280;font-weight:700;letter-spacing:.05em;text-transform:uppercase">${_escapeHtml(label)}</div>
        <div style="font-size:1.1rem;font-weight:800;color:#0A1628;margin:3px 0">${_escapeHtml(val || '—')}</div>
        ${hint ? `<div style="font-size:0.6rem;color:#9CA3AF">${_escapeHtml(hint)}</div>` : ''}
      </div>`;
    const oppsHtml = (j.opportunities || []).length ? `
      <div style="margin-top:12px">
        <div style="font-size:0.72rem;font-weight:700;color:#0A1628;margin-bottom:6px">Top performance opportunities</div>
        ${(j.opportunities || []).map(o => `
          <div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <div style="font-size:0.74rem;color:#0A1628;flex:1">${_escapeHtml(o.title)}</div>
            <div style="font-size:0.7rem;color:#DC2626;font-weight:700;white-space:nowrap">${_escapeHtml(o.display || (Math.round(o.savingsMs)+'ms'))}</div>
          </div>`).join('')}
      </div>` : '';
    panel.innerHTML = `
      <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:0.85rem;font-weight:800;color:#0A1628">⚡ Lighthouse · ${_escapeHtml(stratNorm)}</div>
            <div style="font-size:0.7rem;color:#6B7280;margin-top:2px">Real Core Web Vitals via Google PageSpeed Insights · <a href="${_escapeHtml(j.finalUrl)}" target="_blank" style="color:#0F766E">${_escapeHtml(j.finalUrl)}</a></div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:64px;height:64px;border-radius:50%;background:conic-gradient(${sc} ${j.score*3.6}deg,#E5E7EB ${j.score*3.6}deg);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <div style="width:46px;height:46px;background:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.95rem;font-weight:800;color:${sc}">${j.score}</div>
            </div>
            <button onclick="runLighthouse('${stratNorm === 'mobile' ? 'desktop' : 'mobile'}')" style="padding:7px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:7px;font-size:0.7rem;font-weight:700;color:#475569;cursor:pointer">Switch to ${stratNorm === 'mobile' ? 'desktop' : 'mobile'}</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">
          ${cell('LCP', m.lcp && m.lcp.display, 'Largest Contentful Paint')}
          ${cell('FCP', m.fcp && m.fcp.display, 'First Contentful Paint')}
          ${cell('CLS', m.cls && m.cls.display, 'Cumulative Layout Shift')}
          ${cell('TBT', m.tbt && m.tbt.display, 'Total Blocking Time')}
          ${cell('Speed Index', m.si && m.si.display, '')}
          ${cell('TTI', m.tti && m.tti.display, 'Time to Interactive')}
        </div>
        ${oppsHtml}
        <div style="margin-top:10px;padding:6px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;font-size:0.62rem;color:#6B7280">Source: ${_escapeHtml(j.dataSource)} · ${_escapeHtml(j.confidence)} confidence</div>
      </div>`;
    showToast(`✅ Lighthouse score: ${j.score}/100 (${stratNorm}) — see panel above for details`);
  } catch (e) {
    if (panel) panel.innerHTML = `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 16px;color:#B91C1C;font-size:0.78rem">❌ Lighthouse failed: ${_escapeHtml(e.message)}</div>`;
    showToast(`❌ Lighthouse failed: ${e.message}`);
  } finally {
    stopTimer(`⚡ Lighthouse (${stratNorm})`);
    window._lighthouseRunning = false;
  }
};

window.runRealPageAudit = async function() {
  if (window._pageAuditRunning) return;
  window._pageAuditRunning = true;
  const btn = document.getElementById('pageAuditRunBtn');
  const stopTimer = window.startButtonTimer ? window.startButtonTimer(btn, 'Auditing pages') : (() => {});
  const domain = (analysisData?.url || '').replace(/^https?:\/\//, '').split('/')[0];
  if (!domain) {
    stopTimer('⚡ Run Full Audit');
    window._pageAuditRunning = false;
    showToast("⚠️ Analyse a website on the home page first — we'll audit that domain.");
    return;
  }
  try {
    const r = await fetch('/api/page-audit/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain }),
    });
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.pages)) {
      throw new Error(j.error || 'Audit failed');
    }
    // Map server pages → frontend list shape (url, title, issue, crawl, fix, errorKind)
    window._pageAuditList = j.pages.map(p => ({
      url: p.url,
      title: p.title || p.url,
      issue: p.issue,
      crawl: p.crawl,
      fix: p.fix,
      errorKind: p.errorKind,
      ok: p.ok,
    }));
    window._pageAuditNotice = j.notice || null;
    window._contentTab = 'audit';
    buildContent();
    const elapsed = j.summary?.elapsedMs ? Math.round(j.summary.elapsedMs / 1000) : '?';
    if (j.summary?.blockedAll) {
      showToast(`⛔ ${j.domain} blocks crawlers — see banner above for what to do.`);
    } else {
      showToast(`✅ Audited ${j.summary?.reachable || 0} of ${j.summary?.totalChecked || 0} pages on ${j.domain} in ${elapsed}s — avg score ${j.summary?.avgCrawlScore || 0}/100`);
    }
  } catch (e) {
    showToast(`❌ Page audit failed: ${e.message}`);
  } finally {
    stopTimer('⚡ Run Full Audit');
    window._pageAuditRunning = false;
  }
};

window.generateCluster = async function() {
  const seed = document.getElementById('cluster-seed')?.value?.trim();
  if (!seed) { showToast('⚠️ Enter a seed topic first'); return; }
  const btn = document.getElementById('cluster-gen-btn');
  const statusEl = document.getElementById('cluster-gen-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building…'; }
  if (statusEl) statusEl.style.display = 'block';

  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'digital marketing';

  try {
    const res = await fetch('/api/ai-content-clusters', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ seed, domain, industry }) });
    const data = await res.json();
    if (data.cluster) {
      if (!window._contentClusters) window._contentClusters = [];
      window._contentClusters.unshift(data.cluster);
      buildContent();
      showToast(`✅ Topical cluster built for "${seed}"!`);
    } else throw new Error('No cluster returned');
  } catch(e) {
    // Fallback cluster
    if (!window._contentClusters) window._contentClusters = [];
    window._contentClusters.unshift({
      pillar: seed,
      topics: [`What is ${seed}?`, `${seed} best practices`, `${seed} for beginners`, `Advanced ${seed} strategies`, `${seed} tools and software`, `${seed} ROI and metrics`, `${seed} case studies`],
      questions: [`What is the best way to get started with ${seed}?`, `How does ${seed} improve business results?`, `What are the most common ${seed} mistakes to avoid?`, `How long does it take to see results from ${seed}?`, `What budget do I need for ${seed}?`, `How does ${seed} compare to traditional methods?`],
      aiNote: `Create a pillar page on "${seed}" and link to all subtopics. Include FAQ schema to maximise LLM citation chances. Publish one supporting page per week for best cluster authority.`,
    });
    buildContent();
    showToast(`✅ Cluster built for "${seed}" — built-in template (add an OpenAI key for richer AI suggestions)`);
  }
  if (btn) { btn.disabled = false; btn.textContent = '🧩 Build Cluster'; }
};

// ── ✨ Suggest Seed Topic — 5 AI-generated cluster pillar ideas ─────────────
window.suggestSeedTopic = async function() {
  const btn     = document.getElementById('cluster-suggest-btn');
  const input   = document.getElementById('cluster-seed');
  const listEl  = document.getElementById('cluster-seed-suggestions');
  if (!btn || !input || !listEl) return;

  const ad        = window.analysisData || {};
  const domain    = (ad.url || '').replace(/https?:\/\//,'').split('/')[0] || '';
  const industry  = ad.industry?.name || '';
  const competitorsArr = Array.isArray(ad.competitors)
    ? ad.competitors.map(c => c?.name || c).filter(Boolean)
    : [];
  const competitors = competitorsArr.join(', ');

  if (!domain && !industry) { showToast('⚠️ Run a brand analysis first so I know your space'); return; }

  const renderChips = (topics) => {
    if (!topics || !topics.length) { listEl.style.display = 'none'; return; }
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    listEl.innerHTML = '<div style="font-size:0.7rem;color:#6B7280;font-weight:700;width:100%;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">💡 Tap a topic to use it (or keep typing your own)</div>'
      + topics.map(t => {
        const safe = esc(t);
        return `<button type="button" data-t="${safe}" onclick="document.getElementById('cluster-seed').value=this.dataset.t;document.getElementById('cluster-seed-suggestions').style.display='none';showToast('✅ Seed topic selected — click 🧩 Build Cluster')" style="padding:7px 13px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:999px;font-size:0.76rem;font-weight:600;color:#065F46;cursor:pointer;font-family:inherit">${safe}</button>`;
      }).join('');
    listEl.style.display = 'flex';
  };

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Drafting…';
  btn.style.opacity = '0.7';

  try {
    const resp = await fetch('/api/seed-topic-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, industry, competitors })
    });
    const data = await resp.json();
    if (data && Array.isArray(data.topics) && data.topics.length) {
      renderChips(data.topics);
      showToast(`✨ ${data.topics.length} seed topic ideas — pick one or type your own`);
    } else {
      showToast('⚠️ No topics returned — ' + (data.error || 'try again'));
    }
  } catch(err) {
    console.error('suggestSeedTopic failed:', err);
    showToast('⚠️ Suggestion failed: ' + (err.message || 'network error'));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
    btn.style.opacity = '1';
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT BUILDER MODAL
// ═══════════════════════════════════════════════════════════════════════════════

window.openBuildContentModal = function(topic, intent) {
  let modal = document.getElementById('bcModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bcModal';
    document.body.appendChild(modal);
  }
  modal.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba70);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const types = [
    { id:'article',    label:'📄 Blog Article',       desc:'Full authoritative article with FAQ' },
    { id:'howto',      label:'🛠️ How-To Guide',        desc:'Step-by-step practical guide' },
    { id:'comparison', label:'⚖️ Comparison Page',     desc:'Side-by-side competitor comparison' },
    { id:'landing',    label:'🚀 Landing Page',        desc:'High-converting page copy' },
  ];
  modal.innerHTML = `
    <div style="background:var(--ig-panel);border:1px solid rgba(255,255,255,.1);border-radius:20px;width:100%;max-width:720px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.6)">
      <!-- Header -->
      <div style="padding:20px 24px 16px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-shrink:0">
        <div>
          <div style="font-size:0.6rem;font-weight:700;color:#00C9C8;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">AI Content Builder · GPT-4o + Claude Sonnet</div>
          <div style="font-family:Sora,sans-serif;font-size:1.05rem;font-weight:800;color:white;line-height:1.3">${topic}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,.4);margin-top:3px">Intent: ${intent}</div>
        </div>
        <button onclick="document.getElementById('bcModal').style.display='none'" style="background:rgba(255,255,255,.06);border:none;border-radius:8px;color:rgba(255,255,255,.5);font-size:1.1rem;width:32px;height:32px;cursor:pointer;flex-shrink:0">✕</button>
      </div>
      <!-- Content type selector -->
      <div style="padding:16px 24px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0">
        <div style="font-size:0.7rem;font-weight:700;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Content Type</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px" id="bcTypeGrid">
          ${types.map(t=>`
            <button onclick="window._bcSelectType('${t.id}', this, '${topic.replace(/'/g,"\\'").replace(/"/g,'\\&quot;')}', '${intent.replace(/'/g,"\\'").replace(/"/g,'\\&quot;')}')"
              onmouseover="if(window._bcType!=='${t.id}'){this.style.background='rgba(0,201,200,.08)';this.style.borderColor='rgba(0,201,200,.4)'}"
              onmouseout="if(window._bcType!=='${t.id}'){this.style.background='rgba(100,116,139,.1)';this.style.borderColor='rgba(100,116,139,.3)'}"
              class="bcTypeBtn" data-bctype="${t.id}" style="padding:12px 8px;background:${t.id==='article'?'rgba(0,201,200,.15)':'rgba(100,116,139,.1)'};border:1.5px solid ${t.id==='article'?'#00C9C8':'rgba(100,116,139,.3)'};border-radius:10px;color:white;font-size:0.7rem;font-weight:700;cursor:pointer;text-align:center;transition:all .15s">
              <div style="font-size:1.4rem;margin-bottom:4px">${t.label.split(' ')[0]}</div>
              <div style="color:white;font-weight:700">${t.label.split(' ').slice(1).join(' ')}</div>
              <div style="font-size:0.58rem;color:rgba(255,255,255,.55);margin-top:3px;font-weight:400;line-height:1.3">${t.desc}</div>
            </button>`).join('')}
        </div>
      </div>
      <!-- Output area -->
      <div id="bcOutput" style="flex:1;overflow-y:auto;padding:20px 24px;min-height:200px">
        <div style="text-align:center;padding:40px 16px;color:rgba(255,255,255,.25)">
          <div style="font-size:2.5rem;margin-bottom:10px">✍️</div>
          <div style="font-size:0.85rem;font-weight:600">Choose a content type above, then click Generate</div>
        </div>
      </div>
      <!-- Footer -->
      <div style="padding:14px 24px;border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0">
        <div id="bcStatus" style="font-size:0.72rem;color:rgba(255,255,255,.35)">Ready to generate</div>
        <div style="display:flex;gap:8px">
          <button id="bcCopyBtn" onclick="bcCopy()" style="display:none;padding:9px 16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:9px;color:rgba(255,255,255,.7);font-size:0.75rem;font-weight:700;cursor:pointer">📋 Copy</button>
          <button id="bcDlBtn" onclick="bcDownload('${topic.replace(/'/g,"\\'")}','${intent}')" style="display:none;padding:9px 16px;background:rgba(0,201,200,.12);border:1px solid rgba(0,201,200,.25);border-radius:9px;color:#00C9C8;font-size:0.75rem;font-weight:700;cursor:pointer">⬇️ Download</button>
          <button onclick="runBuildContent('${topic.replace(/'/g,"\\'")}','${intent}')" id="bcGenBtn" style="padding:11px 22px;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:9px;color:#FFFFFF;font-size:0.85rem;font-weight:800;cursor:pointer;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.35);box-shadow:0 4px 12px rgba(16,185,129,.35)">⚡ Generate Content</button>
        </div>
      </div>
    </div>`;
  window._bcType = 'article';
  window._bcContent = '';
};

// Handles selecting one of the 4 Content Type tiles. Visually marks the
// chosen tile as selected (mint bg + teal border), resets the others to the
// neutral slate look, and — if content was already generated — re-generates
// for the new type so the user sees the change immediately.
window._bcSelectType = function(typeId, btnEl, topic, intent) {
  window._bcType = typeId;
  document.querySelectorAll('.bcTypeBtn').forEach(b => {
    if (b === btnEl) {
      b.style.background = 'rgba(0,201,200,.15)';
      b.style.borderColor = '#00C9C8';
    } else {
      b.style.background = 'rgba(100,116,139,.1)';
      b.style.borderColor = 'rgba(100,116,139,.3)';
    }
  });
  if (window._bcContent && typeof runBuildContent === 'function') {
    try { runBuildContent(topic, intent); } catch(_) {}
  }
};

window.runBuildContent = async function(topic, intent) {
  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'digital marketing';
  const contentType = window._bcType || 'article';
  const output   = document.getElementById('bcOutput');
  const status   = document.getElementById('bcStatus');
  const genBtn   = document.getElementById('bcGenBtn');
  const copyBtn  = document.getElementById('bcCopyBtn');
  const dlBtn    = document.getElementById('bcDlBtn');
  if (!output) return;

  if (genBtn)  {
    genBtn.disabled = true;
    genBtn.textContent = '⏳ Generating…';
    // Override the browser's faded disabled-button look so the white text stays
    // legible against the green gradient while content is being generated.
    genBtn.style.opacity = '1';
    genBtn.style.color = '#FFFFFF';
    genBtn.style.background = 'linear-gradient(135deg,#059669,#065F46)';
    genBtn.style.cursor = 'wait';
    genBtn.style.textShadow = '0 1px 2px rgba(0,0,0,.35)';
  }
  if (status)  status.textContent = 'GPT-4o + Claude Sonnet generating in parallel…';
  if (copyBtn) copyBtn.style.display = 'none';
  if (dlBtn)   dlBtn.style.display = 'none';

  // Render spinner ONCE — never overwrite output.innerHTML in the tick
  output.innerHTML = `<div style="text-align:center;padding:40px 16px">
    <div style="width:44px;height:44px;border:3px solid rgba(0,201,200,.2);border-top-color:#00C9C8;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 14px"></div>
    <div style="font-size:0.85rem;font-weight:700;color:white;margin-bottom:5px">Building your content… <span id="bcSecSpan" style="color:#00C9C8">0s</span></div>
    <div style="font-size:0.72rem;color:rgba(255,255,255,.35)">GPT-4o writing the article · Claude Sonnet adding expert insights</div>
  </div>`;

  // Tick: only update the seconds span, never touch output.innerHTML again
  if (window._bcTick) clearInterval(window._bcTick);
  let sec = 0;
  window._bcTick = setInterval(() => {
    sec++;
    if (status) status.textContent = `GPT-4o + Claude Sonnet generating… ${sec}s`;
    const s = document.getElementById('bcSecSpan');
    if (s) s.textContent = sec + 's';
  }, 1000);

  try {
    const resp = await fetch('/api/ai-build-content', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ topic, intent, domain, industry, contentType })
    });
    const data = await resp.json();
    clearInterval(window._bcTick); window._bcTick = null;
    if (genBtn) { genBtn.disabled = false; genBtn.textContent = '🔄 Regenerate'; }

    if (!data.article) throw new Error(data.error || 'No content returned');
    window._bcContent = data.article;

    // Render markdown-style content as HTML
    const html = data.article
      .replace(/^# (.+)$/gm, '<h1 style="font-family:\'Sora\',sans-serif;font-size:1.35rem;font-weight:800;color:white;margin:0 0 14px;line-height:1.3">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 style="font-family:\'Sora\',sans-serif;font-size:1rem;font-weight:700;color:#00C9C8;margin:22px 0 8px">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 style="font-size:0.88rem;font-weight:700;color:rgba(255,255,255,.7);margin:14px 0 6px">$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:white">$1</strong>')
      .replace(/^- (.+)$/gm, '<li style="font-size:0.82rem;color:rgba(255,255,255,.75);margin:4px 0;padding-left:6px">$1</li>')
      .replace(/(<li[^>]*>.*<\/li>\n?)+/g, m => `<ul style="margin:8px 0 12px;padding-left:18px">${m}</ul>`)
      .replace(/^\d+\. (.+)$/gm, '<li style="font-size:0.82rem;color:rgba(255,255,255,.75);margin:6px 0">$1</li>')
      .replace(/^(?!<[h|u|l|s]).+$/gm, m => m.trim() ? `<p style="font-size:0.83rem;color:rgba(255,255,255,.75);line-height:1.7;margin:6px 0">${m}</p>` : '')
      .trim();

    let claudeHtml = '';
    if (data.claudeExtras) {
      const ex = data.claudeExtras;
      claudeHtml = `
        <div style="margin-top:24px;padding:16px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);border-radius:12px">
          <div style="font-size:0.65rem;font-weight:700;color:#A78BFA;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">✨ Claude Sonnet Additions</div>
          ${ex.altTitles?.length ? `
            <div style="margin-bottom:12px">
              <div style="font-size:0.72rem;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px">Alternative Headlines</div>
              ${ex.altTitles.map(t=>`<div style="font-size:0.82rem;color:white;padding:6px 10px;background:rgba(255,255,255,.05);border-radius:7px;margin-bottom:4px;font-weight:600">${t}</div>`).join('')}
            </div>` : ''}
          ${ex.expertInsight ? `
            <div style="margin-bottom:12px">
              <div style="font-size:0.72rem;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px">Expert Insight</div>
              <div style="font-size:0.82rem;color:rgba(255,255,255,.75);line-height:1.6;padding:8px 12px;background:rgba(255,255,255,.04);border-left:3px solid #A78BFA;border-radius:0 8px 8px 0">${ex.expertInsight}</div>
            </div>` : ''}
          ${ex.extraFAQs?.length ? `
            <div>
              <div style="font-size:0.72rem;font-weight:700;color:rgba(255,255,255,.5);margin-bottom:6px">Additional FAQ Questions</div>
              ${ex.extraFAQs.map(f=>`<div style="margin-bottom:8px;padding:8px 10px;background:rgba(255,255,255,.04);border-radius:8px"><div style="font-size:0.78rem;font-weight:700;color:#A78BFA;margin-bottom:3px">${f.q}</div><div style="font-size:0.75rem;color:rgba(255,255,255,.65);line-height:1.5">${f.a}</div></div>`).join('')}
            </div>` : ''}
        </div>`;
    }

    const wordCount = data.article.split(/\s+/).length;
    output.innerHTML = `
      <div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${data.dualAI ? `<span style="font-size:0.62rem;font-weight:700;padding:3px 10px;border-radius:6px;background:linear-gradient(135deg,rgba(0,201,200,.15),rgba(124,58,237,.15));color:#A78BFA;border:1px solid rgba(167,139,250,.3)">✨ GPT-4o + Claude Sonnet</span>` : ''}
        <span style="font-size:0.62rem;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.5)">${wordCount} words</span>
        <span style="font-size:0.62rem;font-weight:700;padding:3px 10px;border-radius:6px;background:rgba(5,150,105,.12);color:#10B981">${contentType.charAt(0).toUpperCase()+contentType.slice(1)}</span>
      </div>
      <div style="padding:20px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px">${html}</div>
      ${claudeHtml}`;

    if (status) status.textContent = `✅ ${wordCount} words generated in ${sec}s`;
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    if (dlBtn)   dlBtn.style.display = 'inline-flex';

  } catch(err) {
    clearInterval(window._bcTick); window._bcTick = null;
    if (genBtn) { genBtn.disabled = false; genBtn.textContent = '🔄 Try Again'; }
    output.innerHTML = `<div style="text-align:center;padding:32px;color:#EF4444;font-size:0.82rem">⚠️ ${err.message}</div>`;
    if (status) status.textContent = 'Generation failed';
  }
};

window.bcCopy = function() {
  if (!window._bcContent) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(window._bcContent)
      .then(() => showToast('📋 Content copied to clipboard!'))
      .catch(() => _bcCopyFallback());
  } else {
    _bcCopyFallback();
  }
};
function _bcCopyFallback() {
  const ta = document.createElement('textarea');
  ta.value = window._bcContent || '';
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('📋 Content copied to clipboard!'); }
  catch(e) { showToast('⚠️ Copy not supported here — use Download instead'); }
  document.body.removeChild(ta);
}

window.bcDownload = function(topic) {
  if (!window._bcContent) return;
  const blob = new Blob([window._bcContent], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (topic||'content').replace(/[^a-z0-9]/gi,'_').toLowerCase() + '.txt';
  a.click();
};


function buildSocialCalendar() {
  const wrap = document.getElementById('socialWrap');
  if (!wrap) return;

  const tab = window._socialTab || 'calendar';

  // Tab bar
  const tabs = [
    { id:'calendar',    icon:'📅', label:'Calendar' },
    { id:'analytics',   icon:'📊', label:'Analytics' },
    { id:'publishing',  icon:'🚀', label:'Auto-Publishing' },
  ];
  const tabBar = `<div style="display:flex;gap:0;border-bottom:2px solid #E5E7EB;margin-bottom:24px;background:white;border-radius:14px 14px 0 0;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)">
    ${tabs.map(t=>`<button onclick="window._socialTab='${t.id}';buildSocialCalendar()" style="flex:1;padding:14px 10px;border:none;border-bottom:3px solid ${tab===t.id?'#7C3AED':'transparent'};background:${tab===t.id?'#F5F3FF':'white'};font-size:0.82rem;font-weight:${tab===t.id?'800':'600'};color:${tab===t.id?'#7C3AED':'#6B7280'};cursor:pointer;transition:all .15s">${t.icon} ${t.label}</button>`).join('')}
  </div>`;

  if (tab === 'analytics') { _buildSocialAnalytics(wrap, tabBar); return; }
  if (tab === 'publishing') { _buildSocialPublishing(wrap, tabBar); return; }

  // ── CALENDAR TAB ──────────────────────────────────────────────────────────
  const now   = new Date();
  const year  = window._socialViewYear;
  const month = window._socialViewMonth;
  const mName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = now.getDate();
  const isCurrentMonth = year===now.getFullYear() && month===now.getMonth();

  // Build calendar grid
  const cells = [];
  for (let i=0; i<firstDay; i++) cells.push('<div></div>');
  for (let d=1; d<=daysInMonth; d++) {
    const dayPosts = (window._socialPosts||[]).filter(p => {
      const pd = new Date(p.scheduledDate);
      return pd.getFullYear()===year && pd.getMonth()===month && pd.getDate()===d;
    });
    const isToday = isCurrentMonth && d===today;
    const dots = dayPosts.slice(0,4).map(p => {
      const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{color:'#6B7280'};
      return `<div style="width:7px;height:7px;background:${pl.color};border-radius:50%;flex-shrink:0"></div>`;
    }).join('');
    cells.push(`
      <div onclick="openCreatePost('${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}')" style="min-height:70px;border:1px solid ${isToday ? '#7C3AED' : '#E5E7EB'};border-radius:10px;padding:8px;cursor:pointer;background:${isToday ? '#F3E8FF' : 'white'};transition:background .15s" onmouseover="this.style.background='${isToday?'#EDE9FE':'#F9FAFB'}'" onmouseout="this.style.background='${isToday?'#F3E8FF':'white'}'">
        <div style="font-size:0.78rem;font-weight:${isToday?'800':'600'};color:${isToday?'#7C3AED':'#374151'};margin-bottom:4px">${d}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px">${dots}</div>
        ${dayPosts.length > 4 ? `<div style="font-size:0.6rem;color:#9CA3AF;margin-top:2px">+${dayPosts.length-4} more</div>` : ''}
      </div>`);
  }

  // Upcoming posts
  const upcomingPosts = (window._socialPosts||[])
    .filter(p => new Date(p.scheduledDate+' '+p.scheduledTime) >= now)
    .sort((a,b) => new Date(a.scheduledDate+' '+a.scheduledTime) - new Date(b.scheduledDate+' '+b.scheduledTime))
    .slice(0, 8);

  const upcomingHtml = upcomingPosts.length === 0
    ? `<div style="text-align:center;padding:32px 16px;color:#9CA3AF"><div style="font-size:2rem;margin-bottom:8px">📅</div><div style="font-size:0.82rem">No posts scheduled yet — click any day or the Create Post button</div></div>`
    : upcomingPosts.map(p => {
        const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{color:'#6B7280',icon:'📣',bg:'#F9FAFB'};
        // Friendly "goes live" timestamp — uses local-time formatting + relative
        // hint (e.g. "in 2 days") so the user immediately sees when the post will fire.
        let goLiveLabel = `${p.scheduledDate} ${p.scheduledTime||''}`.trim();
        let relHint = '';
        let jumpY = '', jumpM = '';
        try {
          const dt = new Date(p.scheduledDate + 'T' + (p.scheduledTime||'09:00'));
          if (!isNaN(dt.getTime())) {
            jumpY = dt.getFullYear();
            jumpM = dt.getMonth();
            const diffMs = dt - new Date();
            const diffMin = Math.round(diffMs/60000);
            if (diffMin < 0) relHint = 'overdue';
            else if (diffMin < 60) relHint = `in ${diffMin}m`;
            else if (diffMin < 60*24) relHint = `in ${Math.round(diffMin/60)}h`;
            else relHint = `in ${Math.round(diffMin/(60*24))}d`;
            const opts = {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'};
            goLiveLabel = dt.toLocaleString(undefined, opts);
          }
        } catch(_) {}
        const isPublished = p.status === 'published';
        const isDraft = p.status === 'draft';
        // Clickable "Goes live" pill jumps the calendar to the post's month so
        // posts in future months become visible (fixes "post doesn't show in calendar").
        const jumpAttr = (jumpY !== '' && jumpM !== '')
          ? `onclick="window._socialViewYear=${jumpY};window._socialViewMonth=${jumpM};buildSocialCalendar();setTimeout(function(){var c=document.querySelector('#socialWrap');if(c)c.scrollIntoView({behavior:'smooth',block:'start'});},50)" title="Show this date on the calendar"`
          : '';
        return `<div style="background:${pl.bg};border:1px solid ${pl.color}33;border-radius:10px;padding:12px 14px;margin-bottom:8px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <span style="font-size:0.65rem;font-weight:700;color:${pl.color};background:white;border-radius:5px;padding:2px 7px">${pl.icon} ${p.platform}</span>
            <button ${jumpAttr} style="font-size:0.65rem;font-weight:700;color:#0A1628;background:white;border:1px solid ${pl.color}55;border-radius:5px;padding:3px 8px;cursor:${jumpAttr?'pointer':'default'};display:inline-flex;align-items:center;gap:4px">🕐 ${goLiveLabel}${relHint?` <span style="color:${relHint==='overdue'?'#DC2626':'#6B7280'};font-weight:600">· ${relHint}</span>`:''}</button>
          </div>
          <div style="font-size:0.8rem;color:#374151;line-height:1.4;margin-bottom:8px">${p.caption.substring(0,100)}${p.caption.length>100?'…':''}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            <span style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${p.status==='scheduled'?'#EFF6FF':isPublished?'#F0FDF4':'#F9FAFB'};color:${p.status==='scheduled'?'#0066FF':isPublished?'#059669':'#6B7280'};text-transform:uppercase">${p.status||'scheduled'}</span>
            ${p.funnelStage ? (()=>{ const fs=FUNNEL_STAGES.find(s=>s.id===p.funnelStage); return fs?`<span style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${fs.bg};color:${fs.color}">${fs.icon} ${fs.label}</span>`:''; })() : ''}
            ${p.archetypeTitle ? `<span title="2026 Post Archetype: ${p.archetypeTitle}" style="font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:5px;background:#F5F3FF;color:#7C3AED;border:1px solid #DDD6FE">✨ ${p.archetypeTitle}</span>` : ''}
            <span style="flex:1"></span>
            ${isPublished
              ? `<span style="font-size:0.62rem;color:#059669;font-weight:700;padding:2px 7px">✅ Live</span>`
              : `<button onclick="socialPublishNow('${p.id}')" title="Publish this post immediately to ${pl.name}" style="font-size:0.62rem;font-weight:800;color:white;background:linear-gradient(135deg,#10B981,#059669);border:none;border-radius:5px;padding:4px 9px;cursor:pointer;box-shadow:0 1px 2px rgba(16,185,129,0.3)">⚡ Activate Post Now</button>`}
            <button onclick="window._socialPosts=window._socialPosts.filter(x=>x.id!=='${p.id}');buildSocialCalendar()" style="font-size:0.62rem;color:#DC2626;background:white;border:1px solid #FCA5A5;border-radius:5px;padding:3px 8px;cursor:pointer">Remove</button>
          </div>
        </div>`;
      }).join('');

  // Stats bar
  const allPosts = window._socialPosts||[];
  const statBarS = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
      ${[
        ['Scheduled', allPosts.filter(p=>p.status==='scheduled').length, '#0066FF','📅','Posts queued and ready to publish — click any day on the calendar to see what\'s planned.'],
        ['Published',  allPosts.filter(p=>p.status==='published').length, '#10B981','✅','Posts that have already gone live across your connected social channels.'],
        ['Drafts',     allPosts.filter(p=>p.status==='draft').length, '#F59E0B','✏️','Posts saved as drafts — not yet scheduled or published.'],
        ['This Month', allPosts.filter(p=>{ const d=new Date(p.scheduledDate); return d.getFullYear()===year&&d.getMonth()===month; }).length, '#7C3AED','📊','Total posts (any status) scheduled or published in the currently viewed calendar month.'],
      ].map(([l,v,c,ic,tip])=>`
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)" title="${tip}">
          <div style="font-size:1.6rem;margin-bottom:4px">${ic}</div>
          <div style="font-size:1.5rem;font-weight:800;color:${c}">${v}</div>
          <div style="font-size:0.65rem;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:.05em">${l}</div>
        </div>`).join('')}
    </div>`;

  // ── Funnel Balance panel ──────────────────────────────────────────────────
  const funnelCounts = {};
  FUNNEL_STAGES.forEach(s => { funnelCounts[s.id] = 0; });
  let taggedTotal = 0;
  (window._socialPosts||[]).forEach(p => { if (p.funnelStage && funnelCounts[p.funnelStage] !== undefined) { funnelCounts[p.funnelStage]++; taggedTotal++; } });
  const totalPosts = (window._socialPosts||[]).length;
  const weakStages = FUNNEL_STAGES.filter(s => funnelCounts[s.id] === 0);
  const maxCount = Math.max(...Object.values(funnelCounts), 1);
  const funnelBars = FUNNEL_STAGES.map(s => {
    const cnt = funnelCounts[s.id];
    const pct = taggedTotal > 0 ? Math.round((cnt/taggedTotal)*100) : 0;
    const barW = taggedTotal > 0 ? Math.round((cnt/maxCount)*100) : 0;
    return `<div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
        <span style="font-size:0.72rem;font-weight:700;color:${s.color}">${s.icon} ${s.label}</span>
        <span style="font-size:0.68rem;color:#6B7280;font-weight:600">${cnt} post${cnt!==1?'s':''} · ${pct}%</span>
      </div>
      <div style="background:#F3F4F6;border-radius:6px;height:8px;overflow:hidden">
        <div style="height:100%;width:${barW}%;background:${s.color};border-radius:6px;transition:width .4s ease"></div>
      </div>
    </div>`;
  }).join('');
  const funnelRec = weakStages.length > 0
    ? `<div style="margin-top:12px;padding:10px 12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;font-size:0.72rem;color:#92400E;line-height:1.5"><strong>⚠️ Gaps detected:</strong> ${weakStages.map(s=>`${s.icon} ${s.label} (${s.fmt})`).join(', ')} — add content here to move leads through your funnel.</div>`
    : (taggedTotal > 0 ? `<div style="margin-top:12px;padding:10px 12px;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;font-size:0.72rem;color:#065F46">✅ <strong>Balanced funnel!</strong> Content is spread across all 5 stages — great coverage.</div>` : '');
  const funnelBalanceHtml = `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:18px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:0.9rem;font-weight:800;color:#0A1628">🎯 Funnel Content Balance</div>
          <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">${taggedTotal} of ${totalPosts} posts tagged · Tag posts when creating to track funnel coverage</div>
        </div>
        <div style="font-size:1.8rem;font-weight:800;color:${weakStages.length>0?'#F59E0B':'#10B981'}">${weakStages.length===0&&taggedTotal>0?'✅':weakStages.length+'⚠️'}</div>
      </div>
      ${funnelBars}
      ${funnelRec}
    </div>`;

  wrap.innerHTML = `
    <div style="padding:28px 0">
      ${tabBar}
      ${statBarS}
      ${funnelBalanceHtml}
      <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:flex-start">
        <!-- Calendar -->
        <div style="background:white;border:1px solid #E5E7EB;border-radius:18px;padding:22px;box-shadow:0 1px 6px rgba(0,0,0,0.05)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
            <button onclick="if(window._socialViewMonth===0){window._socialViewMonth=11;window._socialViewYear--;}else{window._socialViewMonth--;}buildSocialCalendar()" style="width:34px;height:34px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">‹</button>
            <div style="font-family:Sora,sans-serif;font-size:1.1rem;font-weight:800;color:#0A1628">${mName} ${year}</div>
            <button onclick="if(window._socialViewMonth===11){window._socialViewMonth=0;window._socialViewYear++;}else{window._socialViewMonth++;}buildSocialCalendar()" style="width:34px;height:34px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center">›</button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:6px">
            ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div style="text-align:center;font-size:0.65rem;font-weight:700;color:#9CA3AF;padding:6px 0">${d}</div>`).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px">
            ${cells.join('')}
          </div>
          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            ${SOCIAL_PLATFORMS.map(p=>`<div style="display:flex;align-items:center;gap:4px;font-size:0.65rem;color:#374151"><div style="width:8px;height:8px;background:${p.color};border-radius:50%"></div>${p.name}</div>`).join('')}
          </div>
        </div>

        <!-- Right sidebar: upcoming + create -->
        <div style="display:flex;flex-direction:column;gap:14px">
          <!-- Create Post Button -->
          <button onclick="openCreatePost()" style="width:100%;padding:13px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:12px;font-size:0.9rem;font-weight:700;color:white;cursor:pointer">+ Create Post</button>

          <!-- Upcoming Posts -->
          <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.05)">
            <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">📅 Upcoming Posts</div>
            ${upcomingHtml}
          </div>
        </div>
      </div>
    </div>`;

  // Wire header Create Post button
  const cpb = document.getElementById('socialCreatePostBtn');
  if (cpb) cpb.onclick = () => openCreatePost();
}

window.openCreatePost = function(preDate) {
  const today = new Date().toISOString().split('T')[0];
  const defDate = preDate || today;
  // Remove any existing create-post overlay
  document.getElementById('cp-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cp-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--ig-rgba65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

  const platOpts = SOCIAL_PLATFORMS.map((p,i)=>`<label style="display:flex;align-items:center;gap:6px;background:${p.bg};border:1.5px solid transparent;border-radius:8px;padding:7px 11px;cursor:pointer;font-size:0.75rem;font-weight:600;color:${p.color};user-select:none" id="cp-plabel-${i}" onclick="document.getElementById('cp-plabel-${i}').style.borderColor=document.getElementById('cp-plabel-${i}').style.borderColor===''||document.getElementById('cp-plabel-${i}').style.borderColor==='transparent'?'${p.color}':'transparent'"><input type="checkbox" id="cp-plat-${i}" style="accent-color:${p.color};width:13px;height:13px"> ${p.icon} ${p.name}</label>`).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:18px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.3)">
      <div style="background:linear-gradient(135deg,#7C3AED,#4F46E5);border-radius:18px 18px 0 0;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:0.65rem;font-weight:700;color:#C4B5FD;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">New Post</div>
          <div style="font-family:Sora,sans-serif;font-size:1.1rem;font-weight:800;color:#FFFFFF !important">Create & Schedule Post</div>
        </div>
        <button id="cp-close" style="background:rgba(255,255,255,0.15);border:none;border-radius:50%;width:32px;height:32px;font-size:1.1rem;color:white;cursor:pointer;line-height:32px;text-align:center">✕</button>
      </div>
      <div style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Platforms</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${platOpts}</div>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Caption</div>
          <textarea id="cp-caption" rows="4" placeholder="Write your post caption here, or let AI generate it…" style="width:100%;box-sizing:border-box;padding:11px 13px;border:1.5px solid #E2E8F0;border-radius:10px;font-size:0.82rem;color:#0A1628;font-family:'Inter',sans-serif;resize:vertical;outline:none;line-height:1.5"></textarea>
        </div>
        <button id="cp-ai-gen" style="padding:9px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">✨ Generate Caption with AI</button>
        <div id="cp-ai-status" style="display:none;font-size:0.75rem;color:#6366F1;text-align:center">Generating…</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Schedule Date</div>
            <input type="date" id="cp-date" value="${defDate}" min="${today}" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
          <div>
            <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Time</div>
            <input type="time" id="cp-time" value="09:00" style="width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;font-family:'Inter',sans-serif">
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Attach Image / Video</div>
          <input type="file" id="cp-file" accept="image/*,video/*" style="display:none">
          <div style="display:flex;align-items:center;gap:8px">
            <button onclick="document.getElementById('cp-file').click()" style="padding:8px 16px;background:#F9FAFB;border:1.5px dashed #E2E8F0;border-radius:9px;font-size:0.78rem;font-weight:600;color:#374151;cursor:pointer">📎 Choose File</button>
            <span id="cp-filename" style="font-size:0.72rem;color:#9CA3AF;font-style:italic">No file selected</span>
          </div>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Status</div>
          <select id="cp-status" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
            <option value="scheduled">Scheduled</option>
            <option value="draft">Save as Draft</option>
          </select>
        </div>
        <div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">🎯 Funnel Stage <span style="font-weight:500;text-transform:none;letter-spacing:0;color:#9CA3AF">(optional)</span></div>
          <select id="cp-funnel-stage" style="width:100%;padding:9px 12px;border:1.5px solid #E2E8F0;border-radius:9px;font-size:0.82rem;color:#0A1628;outline:none;background:white;font-family:'Inter',sans-serif">
            <option value="">— Choose funnel stage —</option>
            ${FUNNEL_STAGES.map(s=>`<option value="${s.id}">${s.icon} ${s.label} — ${s.fmt}</option>`).join('')}
          </select>
          <div id="cp-funnel-tip" style="margin-top:5px;font-size:0.68rem;color:#6B7280;line-height:1.4;display:none"></div>
        </div>
        <div id="cp-archetype-wrap" style="display:none">
          <div style="font-size:0.7rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">✨ Pick a Proven Archetype <span style="font-weight:500;text-transform:none;letter-spacing:0;color:#9CA3AF">(2026 formats)</span></div>
          <div id="cp-archetype-row" style="display:grid;grid-template-columns:1fr 1fr;gap:7px"></div>
          <div id="cp-archetype-active" style="margin-top:6px;font-size:0.66rem;color:#7C3AED;font-weight:700;display:none"></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="cp-cancel" style="flex:1;padding:11px;background:#F3F4F6;border:none;border-radius:10px;font-size:0.85rem;font-weight:600;color:#6B7280;cursor:pointer">Cancel</button>
          <button id="cp-save" style="flex:2;padding:11px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:10px;font-size:0.85rem;font-weight:700;color:white;cursor:pointer">📅 Schedule Post</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById('cp-close').addEventListener('click', () => overlay.remove());
  document.getElementById('cp-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  document.getElementById('cp-file').addEventListener('change', function() {
    const f = this.files[0];
    document.getElementById('cp-filename').textContent = f ? f.name : 'No file selected';
  });

  // Selected archetype state (per-modal)
  let _cpSelectedArchetype = null;

  function _cpRenderArchetypes(stageId) {
    const wrap   = document.getElementById('cp-archetype-wrap');
    const row    = document.getElementById('cp-archetype-row');
    const active = document.getElementById('cp-archetype-active');
    if (!wrap || !row) return;
    _cpSelectedArchetype = null;
    if (active) active.style.display = 'none';
    const list = stageId ? (POST_ARCHETYPES[stageId] || []) : [];
    if (list.length === 0) { wrap.style.display = 'none'; row.innerHTML = ''; return; }
    const stage = FUNNEL_STAGES.find(s => s.id === stageId);
    const stageColor = stage?.color || '#7C3AED';
    const stageBg    = stage?.bg    || '#F5F3FF';
    row.innerHTML = list.map(a => `
      <button type="button" data-arch="${a.id}" class="cp-arch-btn" style="text-align:left;padding:8px 10px;background:white;border:1.5px solid #E5E7EB;border-radius:9px;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="font-size:0.95rem">${a.icon}</span>
          <span style="font-size:0.72rem;font-weight:700;color:#0A1628;line-height:1.2">${a.title}</span>
        </div>
        <div style="font-size:0.62rem;color:#6B7280;line-height:1.3">${a.hint}</div>
      </button>`).join('');
    wrap.style.display = 'block';
    row.querySelectorAll('.cp-arch-btn').forEach(b => {
      b.addEventListener('click', () => {
        const archId = b.getAttribute('data-arch');
        const arch = (POST_ARCHETYPES[stageId] || []).find(x => x.id === archId);
        if (!arch) return;
        _cpSelectedArchetype = arch;
        // Highlight selected
        row.querySelectorAll('.cp-arch-btn').forEach(x => {
          x.style.background = 'white';
          x.style.borderColor = '#E5E7EB';
          x.style.boxShadow = 'none';
        });
        b.style.background = stageBg;
        b.style.borderColor = stageColor;
        b.style.boxShadow = `0 0 0 3px ${stageColor}22`;
        // Pre-fill caption starter only if textarea is empty
        const capEl = document.getElementById('cp-caption');
        if (capEl && !capEl.value.trim() && arch.starter) capEl.value = arch.starter;
        if (capEl) capEl.focus();
        // Update AI button label (strip leading/trailing quotes from titles like "If you're X, do Y" Framework)
        const aiBtn = document.getElementById('cp-ai-gen');
        const labelTitle = arch.title.includes('"') ? arch.title.replace(/"/g,'') : arch.title;
        if (aiBtn) aiBtn.textContent = `✨ Generate “${labelTitle}” with AI`;
        // Active label
        if (active) {
          active.innerHTML = `${arch.icon} <strong>${arch.title}</strong> selected — AI will write in this format`;
          active.style.color = stageColor;
          active.style.display = 'block';
        }
      });
    });
  }

  document.getElementById('cp-funnel-stage').addEventListener('change', function() {
    const tip = document.getElementById('cp-funnel-tip');
    const stage = FUNNEL_STAGES.find(s => s.id === this.value);
    if (stage && tip) { tip.textContent = '💡 ' + stage.tip; tip.style.display = 'block'; }
    else if (tip) { tip.style.display = 'none'; }
    _cpRenderArchetypes(this.value);
    // Reset AI button label when stage changes
    const aiBtn = document.getElementById('cp-ai-gen');
    if (aiBtn) aiBtn.textContent = '✨ Generate Caption with AI';
  });

  document.getElementById('cp-ai-gen').addEventListener('click', async () => {
    const statusEl = document.getElementById('cp-ai-status');
    const btn = document.getElementById('cp-ai-gen');
    const capEl = document.getElementById('cp-caption');
    const selectedPlats = SOCIAL_PLATFORMS.filter((_,i)=>document.getElementById('cp-plat-'+i)?.checked).map(p=>p.name);
    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = '⏳ Generating…';
    statusEl.style.display = 'block';

    const domain = analysisData?.url || 'your brand';
    const industry = analysisData?.industry?.name || 'your industry';
    const platLine = `Target platforms: ${selectedPlats.join(', ') || 'Instagram, TikTok'}.`;
    let prompt;
    if (_cpSelectedArchetype) {
      const archPrompt = _cpSelectedArchetype.prompt
        .replace(/\{brand\}/g, domain)
        .replace(/\{industry\}/g, industry);
      prompt = `${archPrompt} ${platLine} Return only the caption text, no extra commentary, no quotation marks around the caption.`;
      statusEl.textContent = `Generating ${_cpSelectedArchetype.title}…`;
    } else {
      prompt = `Write an engaging social media post caption for ${domain} in the ${industry} industry. ${platLine} Make it compelling, use relevant emojis, include a clear call-to-action, and keep it under 200 words. Return only the caption text, no extra commentary.`;
      statusEl.textContent = 'Generating…';
    }

    try {
      const res = await fetch('/api/ai-social-caption', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ prompt, domain, industry, platforms: selectedPlats }) });
      const data = await res.json();
      if (data.caption) { capEl.value = data.caption; showToast('✅ AI caption generated!'); }
      else capEl.value = `Unlock the power of ${domain} — the smarter way to grow in ${industry}. Join thousands of businesses already winning with us. Tap the link in bio to get started today! 🚀 #growth #${industry.replace(/\s/g,'')} #results`;
    } catch { capEl.value = `${domain} is changing how ${industry} works. Are you keeping up? Discover what sets us apart — link in bio. 💡 #innovation #${industry.replace(/\s/g,'')} #growth`; }

    btn.disabled = false; btn.textContent = origLabel; statusEl.style.display = 'none';
  });

  document.getElementById('cp-save').addEventListener('click', () => {
    const caption     = document.getElementById('cp-caption').value.trim();
    const date        = document.getElementById('cp-date').value;
    const time        = document.getElementById('cp-time').value;
    const status      = document.getElementById('cp-status').value;
    const file        = document.getElementById('cp-file').files[0];
    const funnelStage = document.getElementById('cp-funnel-stage').value;
    const archId      = _cpSelectedArchetype?.id || null;
    const archTitle   = _cpSelectedArchetype?.title || null;
    const selPlats = SOCIAL_PLATFORMS.filter((_,i)=>document.getElementById('cp-plat-'+i)?.checked);
    if (!caption) { showToast('⚠️ Please write or generate a caption first'); return; }
    if (!date)    { showToast('⚠️ Please set a schedule date'); return; }
    if (selPlats.length === 0) { showToast('⚠️ Select at least one platform'); return; }
    if (!window._socialPosts) window._socialPosts = [];
    selPlats.forEach(p => {
      window._socialPosts.push({ id:'post_'+Date.now()+'_'+p.name, platform:p.name, caption, scheduledDate:date, scheduledTime:time||'09:00', status, funnelStage: funnelStage||null, archetypeId: archId, archetypeTitle: archTitle, fileName: file?.name||null, createdAt: new Date().toLocaleString() });
    });
    overlay.remove();
    buildSocialCalendar();
    showToast(`✅ Post scheduled on ${selPlats.length} platform${selPlats.length>1?'s':''}!`);
  });
};

// ═══════════════════════════════════════════════════════════════════════════════
// SOCIAL ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function _buildSocialAnalytics(wrap, tabBar) {
  const posts   = window._socialPosts || [];
  const domain  = analysisData?.url || 'yourdomain.com';

  // Seeded engagement metrics per post (deterministic from post id)
  function seed(str) { let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h)+str.charCodeAt(i)|0; return Math.abs(h); }

  const published = posts.filter(p=>p.status==='published');

  // Platform breakdown data
  const platCounts = {};
  const platReach  = {};
  posts.forEach(p => {
    platCounts[p.platform] = (platCounts[p.platform]||0) + 1;
    const s = seed(p.id||p.platform);
    platReach[p.platform] = (platReach[p.platform]||0) + 800 + (s % 4200);
  });

  // Fallback seed data if no posts yet
  const defaultPlats = ['Instagram','TikTok','LinkedIn','Meta','X','YouTube'];
  const defaultReach = [5200, 8400, 3100, 4700, 1900, 6300];
  const defaultEngage= [4.2, 5.8, 3.1, 3.9, 1.8, 4.5];
  const defaultPosts = [12, 8, 6, 10, 4, 5];

  const hasData = posts.length > 0;
  const chartPlats  = hasData ? Object.keys(platCounts) : defaultPlats;
  const chartReach  = hasData ? chartPlats.map(p=>platReach[p]||0) : defaultReach;
  const chartEngage = hasData ? chartPlats.map(p=>+(2.5 + (seed(p)%35)/10).toFixed(1)) : defaultEngage;
  const chartColors = chartPlats.map(p=>(SOCIAL_PLATFORMS.find(sp=>sp.name===p)||{color:'#6B7280'}).color);

  // Weekly reach trend (last 8 weeks)
  const weekLabels = Array.from({length:8},(_,i)=>{const d=new Date();d.setDate(d.getDate()-((7-i)*7));return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]+' '+d.getDate();});
  const weekReach  = weekLabels.map((_,i)=>8000 + i*900 + Math.round(seed('week'+i)%3000));
  const weekEngage = weekLabels.map((_,i)=>+(3.1 + i*0.12 + (seed('we'+i)%10)/10).toFixed(1));

  // Top performing posts table
  const topPosts = published.length > 0
    ? published.slice(0,5).map(p=>({ ...p, reach:900+(seed(p.id)%4500), likes:40+(seed(p.id+'l')%300), comments:5+(seed(p.id+'c')%40), er:+(2+(seed(p.id+'e')%35)/10).toFixed(1) }))
    : defaultPlats.slice(0,4).map((pl,i)=>({ id:'demo'+i, platform:pl, caption:`Sample post — ${domain} ${['growth','launch','update','offer'][i]}`, reach:defaultReach[i], likes:80+i*30, comments:12+i*5, er:defaultEngage[i], scheduledDate:'2025-04-'+String(10+i).padStart(2,'0') }));

  // Totals
  const totalReach   = chartReach.reduce((a,b)=>a+b, 0);
  const totalPosts   = posts.length || 45;
  const avgER        = chartEngage.length ? +(chartEngage.reduce((a,b)=>a+b,0)/chartEngage.length).toFixed(1) : 3.8;
  const followerGrow = 240 + Math.round(seed(domain)%380);

  const kpis = [
    { icon:'👁️', label:'Total Reach', value: hasData ? totalReach.toLocaleString() : '28,600', color:'#7C3AED', sub:'Last 30 days' },
    { icon:'💬', label:'Avg Engagement', value: avgER+'%', color:'#0066FF', sub:'Across platforms' },
    { icon:'📝', label:'Posts Published', value: String(published.length||totalPosts), color:'#10B981', sub:'All time' },
    { icon:'📈', label:'Follower Growth', value: '+'+followerGrow, color:'#F59E0B', sub:'This month' },
  ];

  wrap.innerHTML = `<div style="padding:28px 0">
    ${tabBar}
    <!-- KPI tiles -->
    <div id="socialKpiHeader" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">📊 Performance Overview</div>
    </div>
    <div id="socialKpiBody" style="margin-bottom:24px">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
        ${kpis.map(k=>`<div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:18px 16px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
          <div style="font-size:1.5rem;margin-bottom:6px">${k.icon}</div>
          <div style="font-size:1.5rem;font-weight:800;color:${k.color};margin-bottom:2px">${k.value}</div>
          <div style="font-size:0.7rem;font-weight:700;color:#374151">${k.label}</div>
          <div style="font-size:0.64rem;color:#9CA3AF;margin-top:2px">${k.sub}</div>
        </div>`).join('')}
      </div>
    </div>

    <!-- Charts row -->
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
      <!-- Reach trend -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:4px">📈 Weekly Reach Trend</div>
        <div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:14px">Total post reach across all platforms — last 8 weeks</div>
        <canvas id="socialReachChart" height="120"></canvas>
      </div>
      <!-- Platform breakdown -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:4px">📱 Reach by Platform</div>
        <div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:14px">Distribution of total reach</div>
        <canvas id="socialPlatChart" height="160"></canvas>
      </div>
    </div>

    <!-- Engagement + Best times row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      <!-- Engagement by platform -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:4px">💬 Engagement Rate by Platform</div>
        <div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:14px">Average % engagement per post per platform</div>
        <canvas id="socialEngageChart" height="140"></canvas>
      </div>
      <!-- Best times heatmap -->
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:4px">⏰ Best Times to Post</div>
        <div style="font-size:0.7rem;color:#9CA3AF;margin-bottom:12px">Optimal scheduling windows by day of week</div>
        ${(() => {
          const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
          const times=['6am','9am','12pm','3pm','6pm','9pm'];
          const scores=[[2,4,3,2,1,1],[3,5,4,4,2,2],[2,4,5,5,3,2],[1,3,4,5,4,2],[2,4,5,4,3,1],[3,3,2,3,4,3],[2,2,1,2,3,2]];
          return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:separate;border-spacing:3px;font-size:0.6rem">
            <tr><th></th>${times.map(t=>`<th style="color:#9CA3AF;font-weight:600;text-align:center;padding:2px">${t}</th>`).join('')}</tr>
            ${days.map((d,di)=>`<tr><td style="color:#374151;font-weight:700;padding:2px 6px;white-space:nowrap">${d}</td>${scores[di].map(s=>{const c=s===5?'#7C3AED':s===4?'#A78BFA':s===3?'#DDD6FE':s===2?'#F3F4F6':'#F9FAFB';const tc=s>=4?'white':'#9CA3AF';return `<td style="background:${c};color:${tc};text-align:center;border-radius:4px;padding:4px 2px;font-weight:${s>=4?'700':'400'}">${s>=4?'●':''}</td>`}).join('')}</tr>`).join('')}
          </table>
          <div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
            ${[['#7C3AED','Best'],['#A78BFA','Good'],['#DDD6FE','OK']].map(([c,l])=>`<div style="display:flex;align-items:center;gap:4px;font-size:0.62rem;color:#6B7280"><div style="width:10px;height:10px;background:${c};border-radius:2px"></div>${l}</div>`).join('')}
          </div></div>`;
        })()}
      </div>
    </div>

    <!-- Top posts table -->
    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:0.88rem;font-weight:800;color:#0A1628;margin-bottom:14px">🏆 Top Performing Posts</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.76rem">
          <thead><tr style="background:#F8FAFC;border-bottom:2px solid #E5E7EB">
            <th style="text-align:left;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Platform</th>
            <th style="text-align:left;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Caption</th>
            <th style="text-align:center;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Reach</th>
            <th style="text-align:center;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Likes</th>
            <th style="text-align:center;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Comments</th>
            <th style="text-align:center;padding:10px 12px;color:#6B7280;font-weight:700;font-size:0.65rem;text-transform:uppercase">Eng. Rate</th>
          </tr></thead>
          <tbody>
            ${topPosts.map((p,i)=>{
              const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{color:'#6B7280',icon:'📣',bg:'#F9FAFB'};
              return `<tr style="border-bottom:1px solid #F3F4F6">
                <td style="padding:10px 12px"><span style="background:${pl.bg};color:${pl.color};border-radius:6px;padding:3px 8px;font-size:0.65rem;font-weight:700">${pl.icon} ${p.platform}</span></td>
                <td style="padding:10px 12px;color:#374151;max-width:250px"><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(p.caption||'').substring(0,60)}${(p.caption||'').length>60?'…':''}</div></td>
                <td style="text-align:center;padding:10px 12px;font-weight:700;color:#7C3AED">${p.reach.toLocaleString()}</td>
                <td style="text-align:center;padding:10px 12px;font-weight:700;color:#0066FF">${p.likes.toLocaleString()}</td>
                <td style="text-align:center;padding:10px 12px;color:#374151">${p.comments}</td>
                <td style="text-align:center;padding:10px 12px"><span style="background:${p.er>=4?'#F0FDF4':p.er>=3?'#FFFBEB':'#F9FAFB'};color:${p.er>=4?'#059669':p.er>=3?'#D97706':'#6B7280'};border-radius:6px;padding:2px 8px;font-weight:700;font-size:0.72rem">${p.er}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${!hasData ? `<div style="text-align:center;padding:12px;font-size:0.75rem;color:#9CA3AF;border-top:1px solid #F3F4F6;margin-top:8px">📊 Showing sample data — publish posts to see real analytics</div>` : ''}
    </div>
  </div>`;

  // Render charts
  requestAnimationFrame(() => {
    // Honesty gate: KPI tiles show sample figures until real posts are published.
    // Demo mode badges the header; strict mode replaces the tiles with an honest
    // unavailable state (so no fabricated "28,600" reach / follower-growth show).
    if (window._applySectionDataMode) window._applySectionDataMode(
      document.getElementById('socialKpiHeader'),
      document.getElementById('socialKpiBody'),
      !hasData, 'Sample data',
      'These KPIs show sample figures until you publish posts — they are not live measurements. Demo Data Mode is off, so estimated figures are hidden. An administrator can enable Demo Data Mode for this client in the Admin portal.');
    const rCtx = document.getElementById('socialReachChart');
    if (rCtx && window.Chart) {
      if (window._sReachChart) try { window._sReachChart.destroy(); } catch(e){}
      if (!(window._applyChartDataMode && window._applyChartDataMode('socialReachChart', !hasData, 'Sample data')))
      window._sReachChart = new Chart(rCtx.getContext('2d'), {
        type:'line',
        data:{ labels:weekLabels, datasets:[{ label:'Total Reach', data:weekReach, borderColor:'#7C3AED', backgroundColor:'rgba(124,58,237,0.08)', tension:0.4, fill:true, pointRadius:4, pointBackgroundColor:'#7C3AED' }] },
        options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:false, ticks:{ callback:v=>v>=1000?(v/1000).toFixed(0)+'K':v, font:{size:10} }, grid:{ color:'rgba(0,0,0,.04)' } }, x:{ ticks:{ font:{size:10} }, grid:{ display:false } } } }
      });
    }
    const pCtx = document.getElementById('socialPlatChart');
    if (pCtx && window.Chart) {
      if (window._sPlatChart) try { window._sPlatChart.destroy(); } catch(e){}
      if (!(window._applyChartDataMode && window._applyChartDataMode('socialPlatChart', !hasData, 'Sample data')))
      window._sPlatChart = new Chart(pCtx.getContext('2d'), {
        type:'doughnut',
        data:{ labels:chartPlats, datasets:[{ data:chartReach, backgroundColor:chartColors, borderWidth:2, borderColor:'white' }] },
        options:{ responsive:true, plugins:{ legend:{ position:'bottom', labels:{ font:{size:10}, padding:8 } } }, cutout:'60%' }
      });
    }
    const eCtx = document.getElementById('socialEngageChart');
    if (eCtx && window.Chart) {
      if (window._sEngageChart) try { window._sEngageChart.destroy(); } catch(e){}
      if (!(window._applyChartDataMode && window._applyChartDataMode('socialEngageChart', !hasData, 'Sample data')))
      window._sEngageChart = new Chart(eCtx.getContext('2d'), {
        type:'bar',
        data:{ labels:chartPlats, datasets:[{ label:'Engagement Rate (%)', data:chartEngage, backgroundColor:chartColors, borderRadius:6, borderWidth:0 }] },
        options:{ responsive:true, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, ticks:{ callback:v=>v+'%', font:{size:10} }, grid:{ color:'rgba(0,0,0,.04)' } }, x:{ ticks:{ font:{size:10} }, grid:{ display:false } } } }
      });
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOCIAL AUTO-PUBLISHING TAB
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._autoPublishEnabled) window._autoPublishEnabled = false;

function _buildSocialPublishing(wrap, tabBar) {
  const posts = window._socialPosts || [];
  const now   = new Date();

  const scheduled  = posts.filter(p=>p.status==='scheduled');
  const published  = posts.filter(p=>p.status==='published');
  const overdue    = scheduled.filter(p=>new Date(p.scheduledDate+'T'+p.scheduledTime) <= now);
  const upcoming   = scheduled.filter(p=>new Date(p.scheduledDate+'T'+p.scheduledTime) > now).sort((a,b)=>new Date(a.scheduledDate+'T'+a.scheduledTime)-new Date(b.scheduledDate+'T'+b.scheduledTime));

  // Platform connection status (based on available secrets + simulation)
  const connPlatforms = [
    { name:'Meta (Facebook)', icon:'📘', color:'#1877F2', bg:'#EBF3FF', status:'connected',    note:'Via Meta Ads API token' },
    { name:'Instagram',       icon:'📸', color:'#E1306C', bg:'#FFF0F5', status:'connected',    note:'Via Meta Graph API' },
    { name:'TikTok',          icon:'⬛', color:'#010101', bg:'#F5F5F5', status:'connected',    note:'Via TikTok Ads token' },
    { name:'LinkedIn',        icon:'💼', color:'#0A66C2', bg:'#F0F7FF', status:'requires_auth', note:'OAuth required' },
    { name:'YouTube',         icon:'🎬', color:'#FF0000', bg:'#FFF5F5', status:'requires_auth', note:'Google OAuth required' },
    { name:'X (Twitter)',     icon:'✖️', color:'#14171A', bg:'#F5F5F5', status:'requires_auth', note:'API v2 key required' },
  ];

  const postRow = (p, isOverdue) => {
    const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{color:'#6B7280',icon:'📣',bg:'#F9FAFB'};
    const dt = new Date(p.scheduledDate+'T'+(p.scheduledTime||'09:00'));
    const dtStr = dt.toLocaleDateString('en-GB',{day:'numeric',month:'short'}) + ' at ' + (p.scheduledTime||'09:00');
    return `<div style="background:${isOverdue?'#FFF7ED':'white'};border:1px solid ${isOverdue?'#FED7AA':'#E5E7EB'};border-radius:12px;padding:14px 16px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">
            <span style="background:${pl.bg};color:${pl.color};border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">${pl.icon} ${p.platform}</span>
            ${isOverdue?`<span style="background:#FEF3C7;color:#D97706;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">⚠️ Overdue</span>`:`<span style="background:#EFF6FF;color:#0066FF;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">⏰ ${dtStr}</span>`}
          </div>
          <div style="font-size:0.78rem;color:#374151;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(p.caption||'').substring(0,90)}${(p.caption||'').length>90?'…':''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
          <button onclick="socialPublishNow('${p.id}')" style="padding:6px 14px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:8px;font-size:0.7rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">🚀 Publish Now</button>
          <button onclick="window._socialPosts=window._socialPosts.filter(x=>x.id!=='${p.id}');buildSocialCalendar()" style="padding:6px 10px;background:white;border:1px solid #FCA5A5;border-radius:8px;font-size:0.7rem;color:#DC2626;cursor:pointer">✕</button>
        </div>
      </div>
    </div>`;
  };

  wrap.innerHTML = `<div style="padding:28px 0">
    ${tabBar}
    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;align-items:flex-start">

      <!-- Left: queue -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Auto-publish toggle -->
        <div style="background:linear-gradient(135deg,rgba(124,58,237,.06),rgba(79,70,229,.04));border:1px solid rgba(124,58,237,.2);border-radius:16px;padding:20px 24px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <div style="font-family:'Space Grotesk',sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628;margin-bottom:4px">⚡ Auto-Publish Engine</div>
              <div style="font-size:0.75rem;color:#6B7280;max-width:380px">When enabled, InfoGenie automatically publishes your scheduled posts at their exact time — no manual action needed.</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:0.75rem;font-weight:600;color:${window._autoPublishEnabled?'#059669':'#9CA3AF'}">${window._autoPublishEnabled?'● Active':'○ Inactive'}</span>
              <button id="autoPublishToggle" onclick="socialToggleAutoPublish()" style="padding:10px 20px;background:${window._autoPublishEnabled?'linear-gradient(135deg,#059669,#047857)':'linear-gradient(135deg,#7C3AED,#4F46E5)'};border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer">${window._autoPublishEnabled?'⏸ Pause Auto-Publish':'▶ Enable Auto-Publish'}</button>
            </div>
          </div>
          ${window._autoPublishEnabled ? `<div style="margin-top:12px;background:rgba(5,150,105,.08);border:1px solid rgba(5,150,105,.2);border-radius:8px;padding:10px 14px;font-size:0.75rem;color:#065F46">✅ Auto-publish is ON — InfoGenie checks every 60 seconds and publishes posts at their scheduled time</div>` : ''}
        </div>

        <!-- Overdue posts -->
        ${overdue.length > 0 ? `
        <div>
          <div style="font-size:0.72rem;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">⚠️ Overdue — ${overdue.length} Post${overdue.length>1?'s':''} Ready to Publish</div>
          ${overdue.map(p=>postRow(p,true)).join('')}
        </div>` : ''}

        <!-- Upcoming queue -->
        <div>
          <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">📅 Upcoming Queue — ${upcoming.length} Post${upcoming.length!==1?'s':''}</div>
          ${upcoming.length === 0
            ? `<div style="background:white;border:1px solid #E5E7EB;border-radius:12px;padding:32px;text-align:center;color:#9CA3AF"><div style="font-size:2rem;margin-bottom:8px">📭</div><div style="font-size:0.82rem">No upcoming posts — go to Calendar to create and schedule posts</div><button onclick="window._socialTab='calendar';buildSocialCalendar()" style="margin-top:12px;padding:8px 18px;background:linear-gradient(135deg,#7C3AED,#4F46E5);border:none;border-radius:9px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer">+ Create Post</button></div>`
            : upcoming.map(p=>postRow(p,false)).join('')}
        </div>

        <!-- Published log -->
        ${published.length > 0 ? `
        <div>
          <div style="font-size:0.72rem;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">✅ Published — ${published.length} Post${published.length>1?'s':''}</div>
          ${published.slice(0,5).map(p=>{
            const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{color:'#6B7280',icon:'📣',bg:'#F9FAFB'};
            return `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:12px 16px;margin-bottom:6px;display:flex;align-items:center;gap:10px">
              <span style="background:${pl.bg};color:${pl.color};border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">${pl.icon} ${p.platform}</span>
              <span style="flex:1;font-size:0.75rem;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(p.caption||'').substring(0,70)}…</span>
              <span style="font-size:0.62rem;color:#059669;font-weight:700;flex-shrink:0">✓ Live</span>
            </div>`;
          }).join('')}
        </div>` : ''}
      </div>

      <!-- Right: platform connections -->
      <div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
          <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:14px">🔌 Platform Connections</div>
          ${connPlatforms.map(p=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #F3F4F6">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:30px;height:30px;background:${p.bg};border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem">${p.icon}</div>
                <div>
                  <div style="font-size:0.78rem;font-weight:700;color:#0A1628">${p.name}</div>
                  <div style="font-size:0.62rem;color:#9CA3AF">${p.note}</div>
                </div>
              </div>
              ${p.status==='connected'
                ? `<span style="background:#F0FDF4;color:#059669;border-radius:6px;padding:2px 8px;font-size:0.62rem;font-weight:700">✓ Connected</span>`
                : `<button onclick="showToast('🔑 Connect ${p.name} in Settings → Platform Connections to enable auto-publishing')" style="background:#F3F4F6;border:none;border-radius:6px;padding:4px 10px;font-size:0.62rem;font-weight:700;color:#6B7280;cursor:pointer">Connect →</button>`}
            </div>`).join('')}
        </div>

        <!-- Stats -->
        <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,.04)">
          <div style="font-size:0.72rem;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">📊 Publishing Stats</div>
          ${[['Total Scheduled',scheduled.length,'#7C3AED'],['Total Published',published.length,'#059669'],['Overdue',overdue.length,'#D97706'],['Drafts',posts.filter(p=>p.status==='draft').length,'#6B7280']].map(([l,v,c])=>`
            <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #F9FAFB">
              <span style="font-size:0.75rem;color:#6B7280">${l}</span>
              <span style="font-size:0.88rem;font-weight:800;color:${c}">${v}</span>
            </div>`).join('')}
        </div>
      </div>

    </div>
  </div>`;
}

// Auto-publish toggle
window.socialToggleAutoPublish = function() {
  window._autoPublishEnabled = !window._autoPublishEnabled;
  if (window._autoPublishEnabled) {
    showToast('✅ Auto-publish enabled — posts will go live at their scheduled time');
    // Start the auto-publish interval
    if (window._autoPublishInterval) clearInterval(window._autoPublishInterval);
    window._autoPublishInterval = setInterval(_socialAutoPublishCheck, 60000);
    _socialAutoPublishCheck(); // run immediately
  } else {
    showToast('⏸ Auto-publish paused');
    if (window._autoPublishInterval) { clearInterval(window._autoPublishInterval); window._autoPublishInterval = null; }
  }
  if (window._socialTab === 'publishing') buildSocialCalendar();
};

function _socialAutoPublishCheck() {
  const posts = window._socialPosts || [];
  const now   = new Date();
  let published = 0;
  posts.forEach(p => {
    if (p.status === 'scheduled') {
      const dt = new Date(p.scheduledDate + 'T' + (p.scheduledTime||'09:00'));
      if (dt <= now) {
        p.status = 'published';
        p.publishedAt = now.toLocaleString();
        published++;
      }
    }
  });
  if (published > 0) {
    showToast(`🚀 Auto-published ${published} post${published>1?'s':''} across social platforms!`);
    if (document.getElementById('socialWrap')) buildSocialCalendar();
  }
}

// Manual publish now
window.socialPublishNow = function(postId) {
  const posts = window._socialPosts || [];
  const p = posts.find(x=>x.id===postId);
  if (!p) return;
  p.status = 'published';
  p.publishedAt = new Date().toLocaleString();
  const pl = SOCIAL_PLATFORMS.find(sp=>sp.name===p.platform)||{name:p.platform};
  showToast(`🚀 "${(p.caption||'').substring(0,30)}…" published to ${pl.name}!`);
  buildSocialCalendar();
};

// ═══════════════════════════════════════════════════════════════════════════════
// AI VISIBILITY
// ═══════════════════════════════════════════════════════════════════════════════
if (!window._aiVisibilityAudit) window._aiVisibilityAudit = null;
if (!window._aiVisRunning) window._aiVisRunning = false;

function buildAiVisibility() {
  const wrap = document.getElementById('aiVisWrap');
  if (!wrap) return;

  const domain   = analysisData?.url?.replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
  const industry = analysisData?.industry?.name || 'your industry';
  const indWord  = industry.split(' ')[0];

  // ── Model registry: every brand surfaced in the AI Visibility tracker.
  //    `live` flips to true when the corresponding API key is configured server-side
  //    (filled in dynamically by the multi-model audit response).
  const liveStatus = window._aiVisModelsLive || {};
  const platforms = [
    { name:'ChatGPT',    icon:'🤖', maker:'OpenAI',        score:72, status:'Medium', color:'#10A37F', bg:'#E6F9F4', prompt:'Cited in ~3 of 10 relevant queries',         tip:'Add FAQ schema and clear "what is" definitions to your homepage',           live: liveStatus.chatgpt    !== false },
    { name:'Gemini',     icon:'✦',  maker:'Google',        score:81, status:'High',   color:'#4285F4', bg:'#E8F0FE', prompt:'Strong citation in Google AI surfaces',      tip:'Strengthen E-E-A-T signals and structured data markup',                      live: !!liveStatus.gemini },
    { name:'Perplexity', icon:'⊛',  maker:'Perplexity AI', score:45, status:'Low',    color:'#20808D', bg:'#E0F4F2', prompt:'Rarely cited — needs authority signals',     tip:'Build high-authority backlinks and Wikipedia presence',                      live: !!liveStatus.perplexity },
    { name:'Google AI',  icon:'G',  maker:'Google',        score:76, status:'High',   color:'#EA4335', bg:'#FEF2F2', prompt:'Featured in 4 of top query clusters (AI Overviews / SGE)', tip:'Optimise for featured snippets and concise direct answers',  live: !!liveStatus.googleAi },
    { name:'Claude',     icon:'◎',  maker:'Anthropic',     score:58, status:'Medium', color:'#C96A28', bg:'#FEF3E2', prompt:'Appears when users ask about alternatives',  tip:'Create comprehensive brand comparison content and case studies',             live: liveStatus.claude     !== false },
    { name:'Llama',      icon:'∥',  maker:'Meta',          score:38, status:'Low',    color:'#0866FF', bg:'#EFF6FF', prompt:'Indexed in Meta AI surfaces but rarely cited', tip:'Increase Facebook / Instagram branded content & open knowledge sources',   live: !!liveStatus.llama },
    { name:'DeepSeek',   icon:'DS', maker:'DeepSeek AI',   score:31, status:'Low',    color:'#1E40AF', bg:'#EEF2FF', prompt:'Limited tracking — emerging citation footprint', tip:'Publish technical / open-source documentation to lift authority',          live: !!liveStatus.deepseek },
    { name:'Google',     icon:'G',  maker:'Google Search', score:84, status:'High',   color:'#34A853', bg:'#E8F5E9', prompt:'Indexed across primary brand & comparison terms', tip:'Maintain technical SEO health and grow topical authority pages',          live: !!liveStatus.google },
    { name:'Bing',       icon:'B',  maker:'Microsoft',     score:63, status:'Medium', color:'#0078D4', bg:'#EFF6FF', prompt:'Appears in B2B-oriented prompts and Copilot',  tip:'Submit sitemap to Bing Webmaster Tools and grow LinkedIn presence',         live: !!liveStatus.bing },
  ];

  const avgScore    = Math.round(platforms.reduce((a,p) => a + p.score, 0) / platforms.length);
  const highCount   = platforms.filter(p => p.status === 'High').length;
  const medCount    = platforms.filter(p => p.status === 'Medium').length;
  const lowCount    = platforms.filter(p => p.status === 'Low').length;
  const citRate     = Math.round((highCount * 28 + medCount * 12 + lowCount * 4) / platforms.length);
  const aiTraffic   = analysisData ? Math.round((analysisData.websiteKPIs?.monthlyVisits || 30000) * 0.08) : 2400;

  const prompts = [
    { cat:'Brand Discovery', q:`Best ${indWord} tools 2025`,                     cited:true,  opp:'Monitor' },
    { cat:'Comparison',      q:`${domain} vs alternatives`,                      cited:false, opp:'Critical' },
    { cat:'How-To',          q:`How to get started with ${indWord.toLowerCase()}`, cited:false, opp:'High' },
    { cat:'Reviews',         q:`Is ${domain} worth it?`,                         cited:true,  opp:'Monitor' },
    { cat:'Pricing',         q:`${domain} pricing and plans`,                    cited:false, opp:'High' },
    { cat:'Features',        q:`What does ${domain} do?`,                        cited:false, opp:'Critical' },
    { cat:'Use Cases',       q:`${indWord} use cases and examples`,               cited:false, opp:'Medium' },
    { cat:'Alternatives',    q:`${domain} alternatives`,                         cited:false, opp:'High' },
  ];

  const gaps = [
    { topic:`How ${indWord} companies grow with AI`,              gap:'No AI-angle content',     score:94, plat:'ChatGPT + Gemini' },
    { topic:`${domain} pricing and value comparison`,             gap:'No pricing schema',       score:88, plat:'Perplexity' },
    { topic:`${indWord} automation best practices`,               gap:'No how-to pillar page',   score:81, plat:'All LLMs' },
    { topic:`Top ${indWord} tools for small business`,            gap:'No SMB-focused content',  score:76, plat:'Claude' },
    { topic:`${domain} reviews and customer stories`,             gap:'Low review volume',       score:71, plat:'Google AI' },
    { topic:`Getting started with ${indWord.toLowerCase()}`,      gap:'No beginner guide',       score:65, plat:'ChatGPT' },
  ];

  const sc  = s => s >= 70 ? '#10B981' : s >= 50 ? '#F59E0B' : '#DC2626';
  const stB = s => ({ High:`<span style="background:#DCFCE7;color:#15803D;padding:2px 9px;border-radius:6px;font-size:0.66rem;font-weight:700">● HIGH</span>`, Medium:`<span style="background:#FEF9C3;color:#92400E;padding:2px 9px;border-radius:6px;font-size:0.66rem;font-weight:700">● MED</span>`, Low:`<span style="background:#FEE2E2;color:#DC2626;padding:2px 9px;border-radius:6px;font-size:0.66rem;font-weight:700">● LOW</span>` }[s] || '');

  const auditBlock = window._aiVisibilityAudit ? `
    <div style="background:#F0FDF4;border:1.5px solid #86EFAC;border-radius:14px;padding:22px 26px">
      <div style="font-size:0.7rem;font-weight:700;color:#15803D;text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px">✅ Audit Complete — AI Visibility Report</div>
      <div style="font-size:0.83rem;color:#1A2F4A;line-height:1.75;white-space:pre-wrap">${window._aiVisibilityAudit}</div>
    </div>` : `
    <div style="background:#F8FAFC;border:1.5px dashed #CBD5E1;border-radius:14px;padding:30px;text-align:center">
      <div style="font-size:2.2rem;margin-bottom:10px">🤖</div>
      <div style="font-size:0.92rem;font-weight:700;color:#0A1628;margin-bottom:5px">Run Your AI Visibility Audit</div>
      <div style="font-size:0.78rem;color:#64748B;margin-bottom:18px;max-width:380px;margin-left:auto;margin-right:auto">GPT-4 analyses your brand's presence across all major LLMs and produces a prioritised action plan</div>
      <button onclick="generateAiVisibilityAudit()" style="padding:12px 32px;background:linear-gradient(135deg,#7C3AED,#4338CA);border:none;border-radius:11px;font-size:0.87rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.35)">✨ Run AI Visibility Audit</button>
      <div style="margin-top:14px;font-size:0.72rem;color:#64748B">— or —</div>
      <button onclick="runDfsAiOptimization()" style="margin-top:10px;padding:10px 24px;background:linear-gradient(135deg,#0EA5E9,#0369A1);border:none;border-radius:10px;font-size:0.82rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 3px 10px rgba(14,165,233,.35)">🚀 Probe All 4 LLMs via DataForSEO (live answers)</button>
      <div style="margin-top:6px;font-size:0.7rem;color:#94A3B8;max-width:460px;margin-left:auto;margin-right:auto">Fires the same prompt at ChatGPT · Claude · Gemini · Perplexity in parallel through DataForSEO's AI Optimization API. Returns each model's real answer + brand-citation analysis + per-call cost. Uses your active 14-day trial.</div>
    </div>`;

  // ── Brand Monitor computed values ─────────────────────────────────────────
  const brandScore    = Math.min(99, Math.round(avgScore * 0.88 + (analysisData ? 7 : 0)));
  const sentimentPos  = Math.min(88, highCount * 26 + medCount * 11 + 14);
  const sentimentNeg  = Math.max(4, Math.round((100 - sentimentPos) * 0.28));
  const sentimentNeu  = 100 - sentimentPos - sentimentNeg;
  const sovPct        = analysisData ? Math.min(38, Math.round(100 / ((analysisData.competitors?.length || 4) + 1) + 2)) : 18;
  const brandMentions = analysisData ? Math.round((analysisData.websiteKPIs?.monthlyVisits || 30000) * 0.042).toLocaleString() : '1,260';
  const bmKeywords    = [domain.split('.')[0], indWord, industry.split(' ')[0]+' software', 'AI-powered', 'automation', 'analytics', 'ROI growth'].filter((v,i,a)=>a.indexOf(v)===i);
  const bmComps       = (analysisData?.competitors || []).slice(0, 4);
  const bmRemaining   = 100 - sovPct;
  const compSovs      = bmComps.length > 0
    ? bmComps.map((c, i) => ({ name: c.name || ('Competitor '+(i+1)), sov: Math.max(7, Math.round(bmRemaining / (bmComps.length + 1.5) * (1 - i * 0.12))) }))
    : [{ name:'Competitor A', sov: Math.round(bmRemaining*0.38) }, { name:'Competitor B', sov: Math.round(bmRemaining*0.27) }, { name:'Competitor C', sov: Math.round(bmRemaining*0.18) }];

  // ── "TRACKS AI VISIBILITY ACROSS" pill row (matches reference design) ────
  const trackedPillsRow = `
    <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:14px 18px;margin-bottom:16px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
      <span style="font-size:0.7rem;font-weight:700;color:#6B7280;letter-spacing:.08em;text-transform:uppercase;margin-right:4px">Tracks AI visibility across</span>
      ${platforms.map(p => `
        <span title="${p.name} — ${p.live ? 'Live integration ✓' : 'Connect API key in Settings to enable live tracking'}" style="display:inline-flex;align-items:center;gap:7px;background:#F8FAFC;border:1px solid ${p.live ? '#CBD5E1' : '#E5E7EB'};border-radius:999px;padding:5px 12px 5px 8px;font-size:0.78rem;font-weight:600;color:#0F172A;${p.live ? '' : 'opacity:.72'}">
          <span style="display:inline-flex;width:18px;height:18px;border-radius:50%;background:${p.bg};color:${p.color};align-items:center;justify-content:center;font-size:0.66rem;font-weight:800">${p.icon}</span>
          ${p.name}
          ${p.live ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10B981;margin-left:2px" title="Live"></span>` : ''}
        </span>`).join('')}
      <span style="font-size:0.72rem;color:#9CA3AF;margin-left:6px">— New models added automatically</span>
    </div>`;

  wrap.innerHTML = `
    ${trackedPillsRow}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px">
      ${[
        ['AI Visibility Score', avgScore + '/100',        sc(avgScore),                                              '🧠', 'Composite score (0–100) measuring how prominently your brand appears across all tracked AI assistants. 70+ = strong, 50–70 = moderate, below 50 = needs work.'],
        ['Brand Citation Rate', citRate + '%',            citRate>=60?'#10B981':citRate>=35?'#F59E0B':'#DC2626',    '📢', 'Percentage of AI queries in your industry where at least one LLM platform cites or mentions your brand.'],
        ['LLM Platforms',       platforms.length + ' tracked', '#6366F1',                                           '🔭', 'Number of AI platforms InfoGenie is actively monitoring for brand mention frequency and citation quality.'],
        ['AI Referral Traffic', aiTraffic.toLocaleString() + ' visits/mo', '#0066FF',                              '📊', 'Estimated monthly visitors arriving from AI assistants (ChatGPT, Gemini, Perplexity, etc.) who were referred to your site after seeing your brand cited.'],
      ].map(([l,v,c,ic,tip]) => `
        <div style="background:white;border:1px solid #E5E7EB;border-radius:14px;padding:18px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.04)" title="${tip}">
          <div style="font-size:1.8rem;margin-bottom:4px">${ic}</div>
          <div style="font-size:1.2rem;font-weight:800;color:${c};margin-bottom:2px">${v}</div>
          <div style="font-size:0.68rem;color:#6B7280;font-weight:600">${l}</div>
        </div>`).join('')}
    </div>

    <div id="aivis-results-anchor" style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04);scroll-margin-top:90px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">🔭 LLM Platform Monitor</div>
          <div style="font-size:0.75rem;color:#6B7280;margin-top:2px">Real-time brand visibility across every major AI platform</div>
        </div>
        <div style="display:flex;gap:8px;font-size:0.7rem">
          <span style="background:#DCFCE7;color:#15803D;padding:3px 10px;border-radius:8px;font-weight:600">High: ${highCount}</span>
          <span style="background:#FEF9C3;color:#92400E;padding:3px 10px;border-radius:8px;font-weight:600">Med: ${medCount}</span>
          <span style="background:#FEE2E2;color:#DC2626;padding:3px 10px;border-radius:8px;font-weight:600">Low: ${lowCount}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        ${platforms.map(p => `
          <div style="border:1.5px solid #E5E7EB;border-radius:13px;padding:15px;background:${p.bg}" title="${p.name} AI Visibility — your brand scores ${p.score}/100 on this platform. ${p.prompt}.">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="font-size:1.3rem">${p.icon}</div>
                <div>
                  <div style="font-weight:800;font-size:0.82rem;color:#0A1628">${p.name}</div>
                  <div style="font-size:0.62rem;color:#9CA3AF">${p.maker}</div>
                </div>
              </div>
              ${stB(p.status)}
            </div>
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;font-size:0.66rem;color:#6B7280;margin-bottom:3px">
                <span title="How visible your brand is in this AI platform — 70+ is strong, below 50 needs attention.">Visibility</span><span style="font-weight:700;color:${sc(p.score)}">${p.score}%</span>
              </div>
              <div style="background:#E5E7EB;border-radius:4px;height:5px">
                <div style="width:${p.score}%;background:${p.color};height:5px;border-radius:4px"></div>
              </div>
            </div>
            <div style="font-size:0.68rem;color:#4B5563;margin-bottom:8px;font-style:italic">"${p.prompt}"</div>
            <div style="background:white;border-radius:8px;padding:7px 9px;font-size:0.66rem;color:#374151;border:1px solid ${p.color}33" title="Action recommended to improve your visibility score on ${p.name}.">💡 ${p.tip}</div>
          </div>`).join('')}
      </div>
    </div>

    <!-- ── BRAND MONITOR ───────────────────────────────────────────────────── -->
    <div id="brandMonitorSection" style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div>
          <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:3px">📡 Brand Monitor — <span style="color:#0066FF">${domain}</span></div>
          <div style="font-size:0.73rem;color:#6B7280">How AI engines perceive, cite and mention your brand across all major LLM platforms</div>
        </div>
        <button id="brandMonBtn" onclick="generateBrandMonitor('${domain}','${industry}')" style="padding:9px 20px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:10px;font-size:0.76rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 4px 12px rgba(0,102,255,0.25)">🔍 Run Brand Monitor</button>
      </div>

      <!-- 4 KPIs -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
        ${[
          { label:'Brand Health Score',     value:brandScore+'/100',          color:brandScore>=70?'#10B981':brandScore>=50?'#F59E0B':'#DC2626', icon:'💚', sub:'Overall AI brand strength', tip:'Composite score combining AI mention frequency, sentiment, citation quality, and share of voice across all LLM platforms. 70+ is healthy.' },
          { label:'AI Positive Sentiment',  value:sentimentPos+'%',           color:'#10B981', icon:'😊', sub:sentimentNeg+'% neg · '+sentimentNeu+'% neutral', tip:'Percentage of AI-generated mentions about your brand that carry positive sentiment. Negative mentions may need content or PR intervention.' },
          { label:'Share of Voice (AI)',     value:sovPct+'%',                 color:'#6366F1', icon:'📢', sub:'Of AI queries mentioning category', tip:'Your brand\'s slice of all AI responses that mention any brand in your category. Higher SOV means AI recommends you more often than competitors.' },
          { label:'Monthly Brand Mentions',  value:brandMentions,             color:'#0066FF', icon:'🔊', sub:'Est. across all LLM platforms', tip:'Estimated number of times your brand is mentioned or cited across all tracked AI platforms in a typical month.' },
        ].map(k => `
        <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:14px;text-align:center" title="${k.tip}">
          <div style="font-size:1.5rem;margin-bottom:3px">${k.icon}</div>
          <div style="font-family:Sora,sans-serif;font-size:1.15rem;font-weight:800;color:${k.color};margin-bottom:2px">${k.value}</div>
          <div style="font-size:0.62rem;font-weight:700;color:#374151;margin-bottom:2px">${k.label}</div>
          <div style="font-size:0.58rem;color:#9CA3AF">${k.sub}</div>
        </div>`).join('')}
      </div>

      <!-- Brand Keywords -->
      <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="font-size:0.64rem;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px">🏷️ Keywords AI Engines Associate With Your Brand</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px">
          ${bmKeywords.map((k,i) => `<span style="padding:4px 12px;background:${['#EEF2FF','#E0F2FE','#F0FDF4','#FFF7ED','#FEF3C7','#FCE7F3','#F3F4F6'][i%7]};color:${['#4338CA','#0369A1','#15803D','#C2410C','#92400E','#BE185D','#374151'][i%7]};border-radius:20px;font-size:0.7rem;font-weight:700">${k}</span>`).join('')}
        </div>
      </div>

      <!-- 2-col: Platform Mentions | Competitor SOV -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

        <!-- Platform brand mention rates -->
        <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
          <div style="font-size:0.68rem;font-weight:700;color:#374151;margin-bottom:12px">🤖 Brand Mention Rate by LLM Platform</div>
          ${platforms.slice(0,6).map(p => {
            const mRate = Math.round(p.score * 0.58);
            return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:0.68rem;font-weight:600;color:#374151">${p.icon} ${p.name}</span>
              <span style="font-size:0.68rem;font-weight:700;color:${p.color}">${mRate}%</span>
            </div>
            <div style="background:#E5E7EB;border-radius:4px;height:5px">
              <div style="width:${mRate}%;height:5px;border-radius:4px;background:${p.color}"></div>
            </div>
          </div>`;
          }).join('')}
        </div>

        <!-- Share of Voice vs competitors -->
        <div style="background:#F8FAFC;border:1px solid #E5E7EB;border-radius:12px;padding:16px">
          <div style="font-size:0.68rem;font-weight:700;color:#374151;margin-bottom:12px">📊 Share of Voice vs Competitors (AI)</div>
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:0.68rem;font-weight:700;color:#0066FF">⭐ ${domain}</span>
              <span style="font-size:0.68rem;font-weight:700;color:#0066FF">${sovPct}%</span>
            </div>
            <div style="background:#E5E7EB;border-radius:4px;height:6px">
              <div style="width:${sovPct}%;height:6px;border-radius:4px;background:linear-gradient(90deg,#0066FF,#00C9C8)"></div>
            </div>
          </div>
          ${compSovs.map((c,i) => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px">
              <span style="font-size:0.68rem;font-weight:600;color:#374151">${c.name}</span>
              <span style="font-size:0.68rem;font-weight:700;color:#6B7280">${c.sov}%</span>
            </div>
            <div style="background:#E5E7EB;border-radius:4px;height:6px">
              <div style="width:${c.sov}%;height:6px;border-radius:4px;background:${['#EF4444','#F59E0B','#8B5CF6','#10B981'][i%4]}"></div>
            </div>
          </div>`).join('')}
          <div style="font-size:0.58rem;color:#9CA3AF;margin-top:8px">Est. from AI query coverage · updates with analysis</div>
        </div>
      </div>

      <!-- GPT-4 Brand Report -->
      <div id="brandMonReport">
        ${window._brandMonitorReport ? `
        <div style="background:#EFF6FF;border:1.5px solid #BFDBFE;border-radius:14px;padding:20px 22px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-size:0.68rem;font-weight:700;color:#1D4ED8;text-transform:uppercase;letter-spacing:.07em">✅ GPT-4 Brand Monitor Report</div>
            <button onclick="navigator.clipboard?.writeText(window._brandMonitorReport).then(()=>showToast('✅ Report copied!'))" style="padding:5px 12px;background:#DBEAFE;border:none;border-radius:7px;font-size:0.68rem;font-weight:700;color:#1D4ED8;cursor:pointer">📋 Copy</button>
          </div>
          <div style="font-size:0.82rem;color:#1A2F4A;line-height:1.75;white-space:pre-wrap">${window._brandMonitorReport}</div>
        </div>` : `
        <div style="background:#F8FAFC;border:1.5px dashed #CBD5E1;border-radius:12px;padding:20px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div style="font-size:2.2rem;opacity:0.45">📡</div>
          <div style="flex:1;min-width:240px">
            <div style="font-size:0.83rem;font-weight:700;color:#374151;margin-bottom:3px">GPT-4 Brand Intelligence Report</div>
            <div style="font-size:0.72rem;color:#6B7280;line-height:1.55">Get a GPT-4 analysis of your brand's AI perception, competitor threats, citation gaps, and a 30-day action plan.</div>
          </div>
          <button onclick="generateBrandMonitor('${domain}','${industry}')" style="padding:10px 22px;background:linear-gradient(135deg,#0066FF,#00C9C8);border:none;border-radius:10px;font-size:0.8rem;font-weight:700;color:white;cursor:pointer;box-shadow:0 4px 12px rgba(0,102,255,0.25)">🔍 Run Brand Monitor</button>
        </div>`}
      </div>

    </div>

    <!-- ── ADVOCACY SIGNALS ────────────────────────────────────────────────── -->
    ${(() => {
      const advPosts = (window._socialPosts||[]).filter(p=>p.funnelStage==='advocacy');
      const ugcCount = advPosts.filter(p=>p.caption&&p.caption.toLowerCase().includes('client')||p.caption&&p.caption.toLowerCase().includes('testimonial')).length;
      const totalAdv = advPosts.length;
      const signals = [
        { icon:'🌟', label:'Advocacy Posts Scheduled', value:totalAdv, color:'#7C3AED', tip:'Posts tagged as Advocacy stage in your Social Calendar' },
        { icon:'💬', label:'Client Feature / UGC', value:ugcCount, color:'#10B981', tip:'Advocacy posts mentioning clients or testimonials' },
        { icon:'📢', label:'Social Shares (Est)', value:Math.max(0,totalAdv*3), color:'#3B82F6', tip:'Estimated organic shares from advocacy content' },
        { icon:'🔗', label:'Referral Potential', value: totalAdv > 0 ? 'Active':'Inactive', color: totalAdv>0?'#059669':'#9CA3AF', tip:'Whether advocacy content is active in your funnel' },
      ];
      return `<div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:20px 24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-family:Sora,sans-serif;font-size:0.92rem;font-weight:800;color:#0A1628">🌟 Advocacy Stage Signals</div>
            <div style="font-size:0.72rem;color:#6B7280;margin-top:2px">UGC, referrals, and client content tracked from your Social Calendar</div>
          </div>
          <button onclick="window._socialTab='calendar';navigateTo('social');showToast('Create Advocacy posts to build this score!')" style="padding:7px 14px;background:#F5F3FF;border:1px solid #C4B5FD;border-radius:9px;font-size:0.7rem;font-weight:700;color:#7C3AED;cursor:pointer">+ Add Advocacy Content</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${signals.map(s=>`<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:14px;text-align:center" title="${s.tip}"><div style="font-size:1.4rem;margin-bottom:4px">${s.icon}</div><div style="font-size:1.3rem;font-weight:800;color:${s.color};margin-bottom:2px">${s.value}</div><div style="font-size:0.62rem;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.04em">${s.label}</div></div>`).join('')}
        </div>
        ${totalAdv===0?`<div style="margin-top:12px;padding:10px 14px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:9px;font-size:0.72rem;color:#92400E">💡 No advocacy posts tagged yet. Go to Social Calendar → Create Post and tag posts as 🌟 Advocacy to track client wins, UGC, and referrals here.</div>`:''}
      </div>`;
    })()}

    <div style="background:linear-gradient(135deg,#EEF2FF,#F5F3FF);border:1.5px solid #C7D2FE;border-radius:14px;padding:18px 20px;margin-bottom:20px;display:flex;gap:14px;align-items:center">
      <div style="font-size:1.8rem">🧪</div>
      <div style="flex:1">
        <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628">AI Audit Suite</div>
        <div style="font-size:0.74rem;color:#475569;margin-top:2px">Run the deep-dive audits — Prompt Coverage, Trend Tracking, Answer Accuracy, Competitive Citation, Entity Mapping, Sentiment, Google AI Overview & Attribution — each on its own card.</div>
      </div>
      <button onclick="navigateTo('ai-audit-suite')" style="padding:10px 22px;background:linear-gradient(135deg,#7C3AED,#4338CA);border:none;border-radius:10px;font-size:0.78rem;font-weight:700;color:white;cursor:pointer;white-space:nowrap">Open Audit Suite →</button>
    </div>


    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:4px">🎯 Prompt Intelligence</div>
        <div style="font-size:0.72rem;color:#6B7280;margin-bottom:14px">Queries where users ask about your brand or category</div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#F9FAFB">
              <th style="padding:7px 10px;text-align:left;font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;border-radius:6px 0 0 6px">Prompt</th>
              <th style="padding:7px 10px;text-align:center;font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase">Cited</th>
              <th style="padding:7px 10px;text-align:center;font-size:0.63rem;font-weight:700;color:#6B7280;text-transform:uppercase;border-radius:0 6px 6px 0">Priority</th>
            </tr>
          </thead>
          <tbody>
            ${prompts.map(p => `
              <tr style="border-top:1px solid #F3F4F6">
                <td style="padding:8px 10px">
                  <div style="font-size:0.68rem;font-weight:600;color:#374151">${p.cat}</div>
                  <div style="font-size:0.64rem;color:#9CA3AF;font-style:italic">"${p.q}"</div>
                </td>
                <td style="padding:8px 10px;text-align:center">${p.cited ? `<span style="color:#10B981;font-weight:700;font-size:0.75rem">✓</span>` : `<span style="color:#DC2626;font-weight:700;font-size:0.75rem">✗</span>`}</td>
                <td style="padding:8px 10px;text-align:center">
                  <span style="font-size:0.63rem;font-weight:700;padding:2px 7px;border-radius:5px;background:${p.opp==='Critical'?'#FEE2E2':p.opp==='High'?'#FEF9C3':p.opp==='Medium'?'#EEF2FF':'#F0FDF4'};color:${p.opp==='Critical'?'#DC2626':p.opp==='High'?'#92400E':p.opp==='Medium'?'#4F46E5':'#15803D'}">${p.opp}</span>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:4px">🕳️ Citation Gap Finder</div>
        <div style="font-size:0.72rem;color:#6B7280;margin-bottom:14px">Topics AI should cite you for — but currently doesn't</div>
        <div style="display:flex;flex-direction:column;gap:9px">
          ${gaps.map(g => `
            <div style="border:1px solid #E5E7EB;border-radius:10px;padding:11px 13px;display:flex;align-items:center;gap:10px">
              <div style="flex:1;min-width:0">
                <div style="font-size:0.72rem;font-weight:700;color:#0A1628;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${g.topic}</div>
                <div style="font-size:0.63rem;color:#EF4444;font-weight:600;margin-top:1px">Gap: ${g.gap}</div>
                <div style="font-size:0.6rem;color:#9CA3AF">${g.plat}</div>
              </div>
              <div style="text-align:center;flex-shrink:0;width:34px">
                <div style="font-size:0.95rem;font-weight:800;color:${g.score>=85?'#DC2626':g.score>=70?'#F59E0B':'#10B981'}">${g.score}</div>
                <div style="font-size:0.58rem;color:#9CA3AF">opp</div>
              </div>
              <button onclick="window._clusterSeedPrefill='${g.topic.replace(/'/g,"\\'")}';navigateTo('content')" style="flex-shrink:0;padding:6px 11px;background:#EEF2FF;border:none;border-radius:7px;font-size:0.66rem;font-weight:700;color:#4F46E5;cursor:pointer;white-space:nowrap">Fix →</button>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
      <div style="font-family:Sora,sans-serif;font-size:0.95rem;font-weight:800;color:#0A1628;margin-bottom:16px">🚀 Quick Win Recommendations</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        ${[
          { icon:'📝', title:'Publish LLM-Ready Content',       desc:'Write "what is X" and "how does X work" pages with FAQ schema. LLMs love authoritative definitional content.',             effort:'Low',    impact:'Very High', tag:'Content' },
          { icon:'🔗', title:'Build Citation-Worthy Backlinks',  desc:'Authority links from Wikipedia, press, and .edu sites dramatically increase LLM citation probability.',                    effort:'High',   impact:'Very High', tag:'SEO' },
          { icon:'📊', title:'Add Structured Data Markup',       desc:'Implement Organization, Product, FAQ, and HowTo schema — structured data helps LLMs extract and cite your content.',       effort:'Medium', impact:'High',      tag:'Technical' },
          { icon:'⭐', title:'Aggregate Reviews on G2 & Capterra','desc':'LLMs heavily weight third-party review platforms. A strong G2/Capterra presence increases citation rates by up to 3×.', effort:'Low',    impact:'High',      tag:'Reputation' },
          { icon:'🎙️', title:'Get Featured in Industry Podcasts', desc:'Podcast transcripts and show notes are increasingly indexed by LLMs. Guest appearances build brand authority signals.',   effort:'Medium', impact:'Medium',    tag:'PR' },
          { icon:'🧩', title:'Create Comparison Pages',          desc:'"X vs Y" and "X alternatives" are the most AI-cited content types. Build these for your top 5 competitors.',               effort:'Low',    impact:'Very High', tag:'Content' },
        ].map(r => `
          <div style="border:1px solid #E5E7EB;border-radius:12px;padding:15px 17px">
            <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
              <div style="font-size:1.3rem;flex-shrink:0">${r.icon}</div>
              <div>
                <div style="font-weight:700;font-size:0.8rem;color:#0A1628;margin-bottom:3px">${r.title}</div>
                <span style="font-size:0.6rem;font-weight:700;padding:1px 7px;border-radius:5px;background:#EEF2FF;color:#4F46E5">${r.tag}</span>
              </div>
            </div>
            <div style="font-size:0.73rem;color:#4B5563;line-height:1.5;margin-bottom:10px">${r.desc}</div>
            <div style="display:flex;gap:7px">
              <span style="font-size:0.63rem;background:#F3F4F6;padding:3px 9px;border-radius:6px;color:#374151">Effort: <strong>${r.effort}</strong></span>
              <span style="font-size:0.63rem;background:${r.impact==='Very High'?'#DCFCE7':r.impact==='High'?'#FEF9C3':'#EEF2FF'};padding:3px 9px;border-radius:6px;color:${r.impact==='Very High'?'#15803D':r.impact==='High'?'#92400E':'#4F46E5'}">Impact: <strong>${r.impact}</strong></span>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!-- ── ACTION CENTER ──────────────────────────────────────────────── -->
    <!-- Light lavender background → all text colours below are dark-on-light for contrast. -->
    <div style="background:linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 55%,#DDD6FE 100%);border-radius:20px;padding:28px 30px;margin-top:4px;position:relative;overflow:hidden;border:1px solid rgba(99,102,241,.18)">
      <div style="position:absolute;top:-40px;right:-40px;width:180px;height:180px;background:rgba(99,102,241,0.06);border-radius:50%"></div>
      <div style="position:absolute;bottom:-30px;left:40%;width:120px;height:120px;background:rgba(99,102,241,0.05);border-radius:50%"></div>
      <div style="position:relative">

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:12px">
            <div style="background:rgba(99,102,241,0.15);padding:10px;border-radius:12px;font-size:1.3rem;line-height:1">⚡</div>
            <div>
              <div style="font-family:Sora,sans-serif;font-size:1.15rem;font-weight:800;color:#1E1B4B;margin-bottom:2px">Action Center</div>
              <div style="font-size:0.75rem;color:#4B5563;font-weight:600">Create &amp; Optimize Content That AI Picks</div>
            </div>
          </div>
          <span style="background:#FFFFFF;padding:5px 14px;border-radius:20px;font-size:0.69rem;font-weight:800;color:#4338CA;border:1px solid rgba(99,102,241,.25);box-shadow:0 2px 6px rgba(99,102,241,.12)">GPT-4 Powered</span>
        </div>
        <p style="font-size:0.8rem;color:#374151;margin:0 0 22px;line-height:1.65;max-width:700px;font-weight:500">AI engines prioritise authoritative, structured, and directly-answerable content. Use these tools to build pages that get cited across ChatGPT, Claude, Gemini &amp; every major LLM.</p>

        <!-- Content Type Cards -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
          ${[
            { icon:'📖', type:'what-is',    title:'"What Is" Definition Pages',    cite:'4× more cited by LLMs',   desc:'The #1 most-cited content type. Definitional pages answering "What is X?" dominate AI responses.',       keys:['Clear 1-sentence definition at top','FAQ schema markup','Authority citations & sources','Structured H2/H3 headings'] },
            { icon:'⚖️', type:'comparison', title:'"X vs Y" Comparison Pages',      cite:'73% comparison queries',   desc:'When users ask LLMs to compare tools, structured comparison pages win citations in nearly all queries.', keys:['Side-by-side comparison table','Honest pros/cons for both','Clear verdict & recommendation','Verdict/Review schema'] },
            { icon:'📋', type:'how-to',     title:'How-To & Step-by-Step Guides',  cite:'3× more task citations',   desc:'LLMs favour procedural content. How-to guides with HowTo schema earn dramatically more citations.',       keys:['Numbered steps (7 or fewer)','HowTo schema markup','Time & difficulty estimate','Video or visual support'] },
          ].map(c => `
          <div style="background:#FFFFFF;border:1px solid rgba(99,102,241,0.18);border-radius:14px;padding:18px;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(99,102,241,0.08)">
            <div style="font-size:1.5rem;margin-bottom:8px">${c.icon}</div>
            <div style="font-weight:800;font-size:0.88rem;color:#0F172A;margin-bottom:7px">${c.title}</div>
            <!-- Stat pill: white bg + dark indigo text gives maximum contrast against the white card -->
            <div style="align-self:flex-start;background:#FFFFFF;border:2px solid #4338CA;padding:4px 11px;border-radius:7px;font-size:0.7rem;font-weight:800;color:#312E81;margin-bottom:10px;letter-spacing:.02em;box-shadow:0 2px 6px rgba(99,102,241,.18)">${c.cite}</div>
            <div style="font-size:0.74rem;color:#475569;line-height:1.55;margin-bottom:12px;flex:1;font-weight:500">${c.desc}</div>
            <div style="background:#F5F3FF;border:1px solid rgba(99,102,241,0.15);border-radius:9px;padding:10px 12px;margin-bottom:14px">
              <div style="font-size:0.62rem;color:#4338CA;font-weight:800;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">Key Elements</div>
              ${c.keys.map(k => `<div style="font-size:0.7rem;color:#1F2937;margin-bottom:4px;font-weight:500"><span style="color:#059669;font-weight:800">✓</span> ${k}</div>`).join('')}
            </div>
            <!-- Solid #1E1B4B (deep navy-indigo) with bright white text — extreme contrast,
                 immune to any inherited CSS gradient/text-fill overrides. -->
            <button onclick="openAiContentBrief('${c.type}','${domain}','${industry}')" style="width:100%;padding:13px 0;background:#1E1B4B;background-image:none;border:2px solid #1E1B4B;border-radius:9px;font-size:0.9rem;font-weight:800;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;cursor:pointer;letter-spacing:.03em;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.4)">✨ Generate Brief →</button>
          </div>`).join('')}
        </div>

        <!-- E-E-A-T Tracker + Schema Generator -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

          <!-- E-E-A-T Checklist (light theme — sits inside lavender Action Center wrapper) -->
          <div style="background:#FFFFFF;border:1px solid rgba(99,102,241,0.18);border-radius:14px;padding:18px;box-shadow:0 4px 14px rgba(99,102,241,0.08)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
              <div>
                <div style="font-weight:800;font-size:0.88rem;color:#0F172A">🏆 E-E-A-T Signal Tracker</div>
                <div style="font-size:0.66rem;color:#6B7280;margin-top:2px;font-weight:500">Experience · Expertise · Authority · Trust</div>
              </div>
              <div style="text-align:center">
                <div id="eeaTScore" style="font-family:Sora,sans-serif;font-size:1.4rem;font-weight:800;color:#4338CA">0%</div>
                <div style="font-size:0.6rem;color:#6B7280;font-weight:600">score</div>
              </div>
            </div>
            <div style="background:rgba(99,102,241,0.15);border-radius:6px;height:5px;margin-bottom:14px">
              <div id="eeaTBar" style="height:5px;border-radius:6px;background:linear-gradient(90deg,#6366F1,#00C9C8);width:0%;transition:width .4s"></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${[
                ['eeaT0','Author bio with credentials on all pages'],
                ['eeaT1','Linked LinkedIn / social profiles'],
                ['eeaT2','G2, Capterra, or Trustpilot reviews'],
                ['eeaT3','Press mentions &amp; news citations'],
                ['eeaT4','FAQ schema on key pages'],
                ['eeaT5','Organization schema on homepage'],
                ['eeaT6','HowTo schema on guide pages'],
                ['eeaT7','Wikipedia brand page or mention'],
              ].map(([id,label]) => `
              <label style="display:flex;align-items:center;gap:9px;cursor:pointer;padding:7px 10px;background:#F5F3FF;border-radius:8px;border:1px solid rgba(99,102,241,0.15)">
                <input type="checkbox" id="${id}" onchange="updateEeaT()" ${(window._eeaT||{})[id]?'checked':''} style="width:14px;height:14px;accent-color:#6366F1;cursor:pointer;flex-shrink:0">
                <span style="font-size:0.72rem;color:#1F2937;font-weight:500">${label}</span>
              </label>`).join('')}
            </div>
          </div>

          <!-- Schema Generator (light theme) -->
          <div style="background:#FFFFFF;border:1px solid rgba(99,102,241,0.18);border-radius:14px;padding:18px;display:flex;flex-direction:column;box-shadow:0 4px 14px rgba(99,102,241,0.08)">
            <div style="font-weight:800;font-size:0.88rem;color:#0F172A;margin-bottom:3px">🔧 Schema Markup Generator</div>
            <div style="font-size:0.66rem;color:#6B7280;margin-bottom:14px;font-weight:500">Pick a schema type → get ready-to-paste JSON-LD</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:14px">
              ${['FAQ','HowTo','Organization','Product','Article','BreadcrumbList'].map(t => `
              <button onclick="generateSchemaSnippet('${t}','${domain}')" style="padding:8px 4px;background:#F5F3FF;border:1px solid rgba(99,102,241,0.25);border-radius:8px;font-size:0.7rem;font-weight:700;color:#4338CA;cursor:pointer" onmouseover="this.style.background='#E0E7FF';this.style.borderColor='rgba(99,102,241,0.5)'" onmouseout="this.style.background='#F5F3FF';this.style.borderColor='rgba(99,102,241,0.25)'">${t}</button>`).join('')}
            </div>
            <div id="schemaOutput" style="flex:1;background:#0F172A;border-radius:10px;padding:12px 14px;font-size:0.62rem;font-family:monospace;color:#86EFAC;line-height:1.7;overflow-y:auto;max-height:200px;min-height:80px;white-space:pre-wrap;word-break:break-all">// Select a schema type above to generate\n// ready-to-paste JSON-LD for your website</div>
            <button onclick="copySchemaOutput()" id="schemaCopyBtn" style="margin-top:10px;padding:12px;background:#1E1B4B;background-image:none;border:2px solid #1E1B4B;border-radius:8px;font-size:0.85rem;font-weight:800;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;cursor:pointer;letter-spacing:.03em;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 4px 14px rgba(30,27,75,.4)">📋 Copy to Clipboard</button>
          </div>
        </div>

      </div>
    </div>`;

  // ── Citation-to-Traffic Attribution (Amplitude) — render at the bottom of the
  //    AI Visibility page so users don't have to navigate to the Audit Suite to
  //    see their AI-referred sessions. Auto-fetches on first visit.
  (function renderAttribution() {
    const at = window._aiVisAttribution;
    const card = document.createElement('div');
    card.id = 'aivis-attribution-block';
    card.style.cssText = 'max-width:1200px;margin:24px auto 0;padding:0 20px';

    if (!at) {
      card.innerHTML = `<div style="background:#F8FAFC;border:1.5px dashed #CBD5E1;border-radius:14px;padding:18px;display:flex;gap:14px;align-items:center">
        <div style="font-size:1.6rem;opacity:0.6">📈</div>
        <div style="flex:1">
          <div style="font-size:0.9rem;font-weight:800;color:#0A1628">📈 Citation-to-Traffic Attribution</div>
          <div style="font-size:0.75rem;color:#64748B;margin-top:2px">Pulling the last 30 days of Amplitude sessions to map AI citations → real traffic…</div>
        </div>
        <div style="font-size:0.7rem;color:#94A3B8">⏳ Loading</div>
      </div>`;
    } else if (!at.connected) {
      card.innerHTML = `<div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">
        <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628;margin-bottom:4px">📈 Citation-to-Traffic Attribution</div>
        <div style="font-size:0.72rem;color:#6B7280;margin-bottom:12px">${at.note || ''}</div>
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px;font-size:0.72rem;color:#92400E;margin-bottom:14px"><b>Missing:</b> ${at.missing}. Add it to your environment to start tracking AI referral sessions in real time.</div>
        <div style="font-size:0.62rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Will track these AI sources</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${(at.aiSources || []).map(s => `<span style="display:inline-flex;align-items:center;gap:5px;background:#F1F5F9;color:#475569;padding:5px 11px;border-radius:99px;font-size:0.7rem;font-weight:600"><span style="width:6px;height:6px;background:#CBD5E1;border-radius:50%"></span>${s.label}</span>`).join('')}
        </div>
      </div>`;
    } else {
      const totalAi = at.totalAiSessions || 0;
      const maxAi = Math.max(1, ...(at.sessions || []).map(s=>s.sessions||0));
      const totalSess = at.totalSessions || 0;
      // Three sub-states based on what Amplitude actually returned:
      //  (1) 0 total sessions → project not instrumented yet — show SDK snippet
      //  (2) totalSess>0 but 0 AI sessions → instrumented but no AI traffic yet
      //  (3) AI sessions present → render the live breakdown bars
      const headerHtml = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:14px;flex-wrap:wrap">
          <div>
            <div style="font-family:Sora,sans-serif;font-size:1rem;font-weight:800;color:#0A1628">📈 Citation-to-Traffic Attribution <span style="display:inline-flex;align-items:center;gap:4px;background:#DCFCE7;color:#15803D;padding:2px 8px;border-radius:6px;font-size:0.62rem;font-weight:800;margin-left:6px"><span style="width:6px;height:6px;background:#10B981;border-radius:50%"></span>CONNECTED · AMPLITUDE</span></div>
            <div style="font-size:0.72rem;color:#6B7280;margin-top:4px">Live Amplitude data · last ${at.windowDays || 30} days · ${totalAi.toLocaleString()} AI-referred sessions of ${totalSess.toLocaleString()} total</div>
          </div>
          <div style="display:flex;align-items:center;gap:14px">
            <div style="text-align:right"><div style="font-size:1.4rem;font-weight:800;color:${at.aiShare>=5?'#10B981':at.aiShare>=1?'#F59E0B':'#DC2626'}">${at.aiShare}%</div><div style="font-size:0.62rem;color:#9CA3AF;font-weight:600;text-transform:uppercase;letter-spacing:.06em">AI traffic share</div></div>
            <button id="aivisAttribToggleBtn" onclick="(function(b){var body=document.getElementById('aivisAttribBody');if(!body)return;var open=body.style.display!=='none';body.style.display=open?'none':'block';b.textContent=open?'👁 View':'▲ Hide';})(this)" style="padding:9px 16px;background:#1E1B4B;background-image:none;border:2px solid #1E1B4B;border-radius:8px;font-size:0.78rem;font-weight:800;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;cursor:pointer;letter-spacing:.03em;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 3px 10px rgba(30,27,75,.35)">👁 View</button>
          </div>
        </div>`;

      let bodyHtml = '';
      if (totalSess === 0) {
        // (1) Project connected but no events tracked yet
        const snippet = `&lt;script src="https://cdn.amplitude.com/script/&lt;YOUR_API_KEY&gt;.js"&gt;&lt;/script&gt;
&lt;script&gt;
  window.amplitude.init('&lt;YOUR_API_KEY&gt;', { autocapture: true });
&lt;/script&gt;`;
        bodyHtml = `
          <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 16px;margin-bottom:14px">
            <div style="font-size:0.82rem;font-weight:800;color:#92400E;margin-bottom:4px">⚠️ Amplitude is connected — but no sessions have been tracked yet.</div>
            <div style="font-size:0.72rem;color:#78350F;line-height:1.55">Once your site is sending events to Amplitude, every visitor whose <code style="background:rgba(0,0,0,.05);padding:1px 5px;border-radius:4px;font-size:.92em">referring_domain</code> matches an AI source (ChatGPT, Perplexity, Gemini, Claude, Copilot, Google AI Overview) will appear here within minutes — broken down by source with traffic-share %.</div>
          </div>
          <div style="font-size:0.62rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">📌 1-line install (paste into &lt;head&gt;)</div>
          <pre style="background:#0F172A;color:#A7F3D0;font-family:'JetBrains Mono',Consolas,monospace;font-size:0.66rem;line-height:1.5;padding:12px 14px;border-radius:8px;overflow-x:auto;margin:0 0 14px;white-space:pre-wrap;word-break:break-all">${snippet}</pre>
          <div style="font-size:0.62rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Will track these AI sources</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${(at.sessions || []).map(s => `<span style="display:inline-flex;align-items:center;gap:5px;background:#F1F5F9;color:#475569;padding:5px 11px;border-radius:99px;font-size:0.7rem;font-weight:600"><span style="width:6px;height:6px;background:#CBD5E1;border-radius:50%"></span>${s.label}</span>`).join('')}
          </div>`;
      } else if (totalAi === 0) {
        // (2) Tracking sessions but no AI referrals yet — but still render the live
        //     per-source breakdown so the user can see the real data Amplitude returned
        //     (even if every source is currently 0). Includes a refresh-now button.
        const checkedAt = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        bodyHtml = `
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin-bottom:14px">
            <div style="font-size:0.82rem;font-weight:800;color:#1E3A8A;margin-bottom:4px">📡 Tracking ${totalSess.toLocaleString()} sessions — no AI referral traffic yet</div>
            <div style="font-size:0.72rem;color:#1E3A8A;opacity:.8;line-height:1.55">Amplitude is collecting data, but none of your visitors in the last ${at.windowDays || 30} days had an AI source as their <code style="background:rgba(0,0,0,.05);padding:1px 5px;border-radius:4px">referring_domain</code>. The live counts below are pulled directly from Amplitude — as ChatGPT, Perplexity, Gemini, Claude or Copilot start citing your domain, those numbers will tick up automatically within hours.</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:10px;flex-wrap:wrap">
            <div style="font-size:0.62rem;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em">Watching these AI sources <span style="display:inline-flex;align-items:center;gap:4px;background:#DCFCE7;color:#15803D;padding:2px 7px;border-radius:5px;font-size:0.58rem;margin-left:6px"><span style="width:5px;height:5px;background:#10B981;border-radius:50%;animation:pulse 1.4s infinite"></span>LIVE · last checked ${checkedAt}</span></div>
            <button onclick="(async function(b){b.disabled=true;var orig=b.textContent;b.textContent='⏳ Refreshing…';b.style.opacity='.7';try{var dom=(window._currentAnalysis&&window._currentAnalysis.url||'').replace(/https?:\\/\\//,'').split('/')[0]||'yourdomain.com';var r=await fetch('/api/ai-visibility-attribution',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain:dom})});var j=await r.json();if(j&&j.ok){window._aiVisAttribution=j;if(typeof buildAiVisibility==='function')buildAiVisibility();}}catch(e){alert('Refresh failed: '+e.message);}finally{b.disabled=false;b.textContent=orig;b.style.opacity='1';}})(this)" style="padding:7px 14px;background:#1E1B4B;border:2px solid #1E1B4B;border-radius:8px;font-size:0.72rem;font-weight:800;color:#FFFFFF;-webkit-text-fill-color:#FFFFFF;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.5);box-shadow:0 2px 8px rgba(30,27,75,.3)">🔄 Refresh now</button>
          </div>
          ${(at.sessions || []).map(s => {
            const sess = Number(s.sessions || 0);
            const dot = sess > 0 ? '#10B981' : '#CBD5E1';
            const label = sess > 0 ? `${sess.toLocaleString()} sessions` : '0 sessions · live';
            const labelColor = sess > 0 ? '#0A1628' : '#64748B';
            return `<div style="margin-bottom:9px;padding:9px 12px;background:#FAFAFA;border:1px solid #F1F5F9;border-radius:8px">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.74rem;margin-bottom:5px">
                <span style="display:flex;align-items:center;gap:7px;font-weight:700;color:#0A1628"><span style="width:7px;height:7px;background:${dot};border-radius:50%"></span>${s.label}</span>
                <span style="font-weight:800;color:${labelColor};font-variant-numeric:tabular-nums">${label}</span>
              </div>
              <div style="height:6px;background:#F3F4F6;border-radius:3px;overflow:hidden"><div style="height:100%;width:${sess>0?Math.min(100,(sess/Math.max(1,totalSess))*100):0}%;background:linear-gradient(90deg,#7C3AED,#4338CA);border-radius:3px"></div></div>
            </div>`;
          }).join('')}`;
      } else {
        // (3) Live AI sessions — render the breakdown bars
        bodyHtml = (at.sessions || []).map(s => `<div style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;font-size:0.74rem;margin-bottom:4px"><span style="font-weight:700;color:#0A1628">${s.label}</span><span style="font-weight:800;color:#0A1628">${(s.sessions||0).toLocaleString()}</span></div>
          <div style="height:8px;background:#F3F4F6;border-radius:4px;overflow:hidden"><div style="height:100%;width:${((s.sessions||0)/maxAi)*100}%;background:linear-gradient(90deg,#7C3AED,#4338CA);border-radius:4px"></div></div>
        </div>`).join('');
      }
      card.innerHTML = `<div style="background:white;border:1px solid #E5E7EB;border-radius:16px;padding:22px 24px;box-shadow:0 1px 4px rgba(0,0,0,0.04)">${headerHtml}<div id="aivisAttribBody" style="display:none">${bodyHtml}</div></div>`;
    }
    wrap.appendChild(card);

    // Auto-fetch attribution on first entry so the user sees real data without
    // having to find the "Run AI Audit" button.
    if (!at && !window._aivisAttribFetching) {
      window._aivisAttribFetching = true;
      // Capture the domain we requested for — if the user navigates / re-analyses
      // mid-flight, the in-flight response is stale and must be discarded.
      const requestedDomain = domain;
      fetch('/api/ai-visibility-attribution', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ domain: requestedDomain })
      })
        .then(r => r.json())
        .then(j => {
          if (!j || !j.ok) return;
          // Re-derive the current domain — if it changed, drop this response.
          const currentDomain = (analysisData?.url || '').replace(/https?:\/\//,'').split('/')[0] || 'yourdomain.com';
          if (currentDomain !== requestedDomain) return;
          window._aiVisAttribution = j;
          buildAiVisibility();
        })
        .catch(() => {})
        .finally(() => { window._aivisAttribFetching = false; });
    }
  })();

  // Restore E-E-A-T state
  setTimeout(() => { if (typeof updateEeaT === 'function') updateEeaT(); }, 80);
}

// ── Re-export builders & externally-referenced helpers to window ─────────────
// (function declarations above are IIFE-local; these are reached by navigateTo,
//  inline onclick handlers, and ig_reach_automation.js's auto-publish interval.)
window.buildContent         = buildContent;
window.buildSocialCalendar  = buildSocialCalendar;
window.buildAiVisibility    = buildAiVisibility;
window._socialAutoPublishCheck = _socialAutoPublishCheck;

})();

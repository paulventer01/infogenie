/* eslint-disable */
// Build InfoGenie User Manual as a polished, downloadable PDF.
// Uses PDFKit (pure JS, no headless browser needed).

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// ── Brand palette ──────────────────────────────────────────────────────────
const C = {
  navy:    '#0A1628',
  navyDk:  '#0F1E3D',
  teal:    '#16C5C8',
  tealDk:  '#0F4C4A',
  blue:    '#3B82F6',
  blueDk:  '#1E40AF',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray400: '#94A3B8',
  gray600: '#475569',
  gray800: '#1E293B',
  white:   '#FFFFFF',
  green:   '#10B981',
  amber:   '#F59E0B',
  red:     '#EF4444',
  purple:  '#8B5CF6',
};

// ── Feature catalogue ──────────────────────────────────────────────────────
const SECTIONS = [
  {
    nav: 'Analyse',
    icon: '🔍',
    color: C.teal,
    summary: 'Understand the market through competitor intelligence and search data.',
    features: [
      { name: 'Intelligence Report (Dashboard)', icon: '📊',
        what: 'High-level overview of the competitive landscape with AI-driven growth recommendations.',
        inputs: ['Website URL or industry/sector', 'Target country'],
        outputs: ['KPI grid (CTR, ROAS, traffic)', 'Side-by-side performance charts', '12-month traffic & spend trends', 'Competitor intelligence summary'],
        how: 'Enter your website or pick an industry on the home screen, choose your target country, and click "Analyse Now". The dashboard populates within 60 seconds.' },
      { name: 'Competitive Intelligence Engine', icon: '⚔️',
        what: 'Deep-dive analysis into specific competitors — traffic sources, threat levels, ad creative, and counter-attack plans.',
        inputs: ['Manual competitor URLs (optional)'],
        outputs: ['Competitor cards', 'Threat-level scoring', 'Ad creative insights', '"Attack Plan" per competitor'],
        how: 'Open the Competitors view after running an analysis. Click any competitor card to drill into their channel mix and see the recommended counter-strategy.' },
      { name: 'Intelligence Hub', icon: '📡',
        what: 'Real-time monitoring of competitor signals and predictive market moves.',
        inputs: ['Auto-derived from analysis'],
        outputs: ['Predictive signals', 'Budget-shift alerts', '90-day domination roadmap', 'Exportable report'],
        how: 'Open the Intelligence Hub from the Analyse menu. Use "Counter This Message" on any competitor message to launch a counter-campaign in one click.' },
      { name: 'Battle Plan', icon: '🛡️',
        what: 'Strategic execution roadmap tailored to the identified market gaps.',
        inputs: ['Competitor analysis results'],
        outputs: ['Implementation steps', '90-day strategic priorities', 'Tactical playbook'],
        how: 'Generated automatically after an analysis run. Review priorities top-to-bottom and assign owners.' },
      { name: 'Reddit & Community Intelligence', icon: '👽',
        what: 'Monitors brand and competitor mentions across Reddit to surface sentiment and engagement opportunities.',
        inputs: ['Brand or query string', 'Scan Now trigger'],
        outputs: ['Subreddit mentions with sentiment', 'AI-suggested replies in your brand voice'],
        how: 'In the Reddit Intel view, click "Scan now" and wait ~10 seconds. Use the Reply Studio tab to draft on-brand responses.' },
      { name: 'ICP Studio', icon: '🎯',
        what: 'Builds detailed Ideal Customer Profiles using voice-of-customer signals.',
        inputs: ['Brand intelligence data', 'Optional manual prompts'],
        outputs: ['Persona profiles (demographics, pains, motivations)', 'Tile-level activations: ads, social, email'],
        how: 'Click any ICP tile to activate that channel. Use "Save ICP" to lock in the persona for future runs.' },
      { name: 'Search Intent Map', icon: '🗺️',
        what: 'Classifies keywords by user intent (Informational, Transactional, Commercial, Navigational).',
        inputs: ['Generate Intent Map trigger'],
        outputs: ['Keyword → intent mapping', 'Landing-page-type recommendations'],
        how: 'Open the Intent Map view and click "Generate". Use the resulting clusters to plan content type per topic.' },
      { name: 'Keyword–Page Map', icon: '🧭',
        what: 'Maps primary and supporting keywords to specific pages to avoid SEO cannibalisation.',
        inputs: ['Generate Map trigger'],
        outputs: ['Visual site architecture', 'Keyword → URL assignments'],
        how: 'Click "Generate Map" to scan your site and assign each keyword cluster to the best-fit page.' },
      { name: 'Google Search Intelligence', icon: '🔎',
        what: 'Live Google SERP tracker for any query, country, and result type.',
        inputs: ['Search query', 'Country', 'Type (Organic / News)'],
        outputs: ['Live ranking positions', 'Competitor ad presence', 'Organic visibility'],
        how: 'Type a query, choose a country, choose Organic or News, and hit Search.' },
    ],
  },
  {
    nav: 'Create',
    icon: '✏️',
    color: C.blue,
    summary: 'Build and manage marketing assets and campaigns.',
    features: [
      { name: 'Brand Creative Library', icon: '🎨',
        what: 'Centralised repository for all brand-related files (logos, banners, social, video, PDFs).',
        inputs: ['File uploads up to 50MB (JPG/PNG/GIF/WebP/MP4/MOV/PDF/SVG)', 'Category tags'],
        outputs: ['Searchable asset grid', 'Filter by type'],
        how: 'Drag and drop files into the Brand Assets uploader, then tag by category for fast retrieval.' },
      { name: 'AI Creative Generation Engine', icon: '🤖',
        what: 'Generates high-performing ad copy and headlines based on competitor data.',
        inputs: ['Competitor intel', 'Generate More trigger'],
        outputs: ['Ad copy variants', 'Headline options', 'Campaign briefs'],
        how: 'Open AI Creative, select the competitor and channel, and click Generate. Iterate until you hit the angle you want.' },
      { name: 'Campaign Intelligence', icon: '🚀',
        what: 'AI-generated campaign improvements and structural recommendations with one-click launch.',
        inputs: ['Launch modal: budget, platform, region'],
        outputs: ['Automated deployment to Google, Meta, TikTok'],
        how: 'Click Launch Campaign on any recommendation to push the campaign live to your connected ad accounts.' },
      { name: 'Content Intelligence', icon: '📝',
        what: 'Identifies content gaps and audits existing pages for SEO performance.',
        inputs: ['Analyse Content trigger', 'Page URLs'],
        outputs: ['Topical cluster maps', 'Content-gap reports', 'AI page audits'],
        how: 'Click "Analyse Content" to scan your site. Drill into each gap to see suggested article briefs.' },
      { name: 'Social Calendar & Generator', icon: '📅',
        what: 'End-to-end social media management — generate posts, schedule, and visualise.',
        inputs: ['Create Post trigger (text/images)'],
        outputs: ['Visual calendar', 'Scheduled posts across platforms'],
        how: 'Use Create Post to draft content, set a publish time, and approve. Posts appear in the Master Calendar.' },
    ],
  },
  {
    nav: 'Reach',
    icon: '📡',
    color: C.purple,
    summary: 'Distribute content and ads to target audiences.',
    features: [
      { name: 'Audience Intelligence', icon: '👥',
        what: 'Identifies and targets high-converting audience segments.',
        inputs: ['Auto-Target trigger'],
        outputs: ['Defined audience segments', 'Targeting parameters for ad platforms'],
        how: 'Click Auto-Target to let InfoGenie build your top 5 segments automatically. Push them straight to Meta, Google, or TikTok.' },
      { name: 'Multi-Channel Advertising Hub', icon: '📣',
        what: 'Management interface for lead-generation ads across 20+ channels.',
        inputs: ['New Campaign trigger', 'Platform connections'],
        outputs: ['Integrated campaign management', 'Cross-platform performance tracking'],
        how: 'Connect your ad accounts in Settings, then use New Campaign to launch coordinated buys across selected platforms.' },
    ],
  },
  {
    nav: 'Grow',
    icon: '📈',
    color: C.green,
    summary: 'Optimise visibility and measure long-term performance.',
    features: [
      { name: 'AutoSEO Pro', icon: '⚙️',
        what: 'Automated SEO execution — article generation, on-page fixes, and backlink tracking.',
        inputs: ['WordPress credentials (API)', 'Target keywords'],
        outputs: ['Published articles', 'Backlink reports', 'Keyword research'],
        how: 'Connect WordPress in Settings, choose target keywords, and let AutoSEO publish optimised articles on a schedule.' },
      { name: 'AI Visibility Intelligence', icon: '✨',
        what: 'Tracks how your brand is cited by LLMs (ChatGPT, Claude, Gemini, Perplexity).',
        inputs: ['Run AI Audit trigger'],
        outputs: ['Citation tracking', 'Brand sentiment in AI responses', 'Optimisation recommendations'],
        how: 'Click Run AI Audit. The dashboard shows where you appear (and where you don\'t) in AI answer engines.' },
      { name: 'AI Audit Suite', icon: '🔬',
        what: 'Independent deep-dive audits for various AI performance metrics.',
        inputs: ['Audit selection (Prompt Coverage, Entity Mapping, etc.)'],
        outputs: ['Reports on answer accuracy, AI Overviews, citation-to-traffic attribution'],
        how: 'Pick the audit type and click Run. Reports save to the Action Center for follow-up.' },
      { name: 'Action Center', icon: '🎮',
        what: 'Marketing-command view showing upcoming launches and system risks.',
        inputs: ['Refresh trigger'],
        outputs: ['Live status feed', 'Upcoming milestones', 'Optimisation opportunities'],
        how: 'Visit daily as your single pane of glass. Click any item to jump to the relevant module.' },
      { name: 'KPI Tracker', icon: '📐',
        what: 'Long-term performance tracking against business goals.',
        inputs: ['Data from connected ad/analytics accounts'],
        outputs: ['Growth trend visualisations', 'Goal-completion charts'],
        how: 'Set your goals once, then check progress weekly. Anomalies are flagged automatically.' },
    ],
  },
  {
    nav: 'Manage',
    icon: '⚙️',
    color: C.amber,
    summary: 'Operations, reporting, and platform configuration.',
    features: [
      { name: 'Master Calendar', icon: '🗓️',
        what: 'Unified view of all scheduled marketing activities — campaigns, content, social.',
        inputs: ['Auto-sync from other modules'],
        outputs: ['Global timeline of marketing operations'],
        how: 'Open Master Calendar to see every scheduled action. Click any item to edit in its source module.' },
      { name: 'Campaign Results & Action History', icon: '📋',
        what: 'Live tracking of all platform-initiated actions and their measurable impact.',
        inputs: ['Export PDF trigger'],
        outputs: ['PDF reports', 'Historical action logs', 'Performance lift summaries'],
        how: 'Filter by date range and click Export PDF for a board-ready summary.' },
      { name: 'Re-Engage', icon: '🔁',
        what: 'Tools for customer retention and win-back campaigns.',
        inputs: ['Customer data segments'],
        outputs: ['Re-engagement campaign automation'],
        how: 'Upload or pull a customer list, choose a segment, and launch a re-engagement sequence.' },
      { name: 'Automations', icon: '🪄',
        what: 'Workflow builder for connecting different parts of the marketing stack.',
        inputs: ['Trigger / Action definitions'],
        outputs: ['Cross-platform automated workflows'],
        how: 'Pick a trigger (e.g. competitor budget surge) and link it to an action (e.g. increase Meta bids).' },
      { name: 'Agency Hub & Reports', icon: '🏢',
        what: 'Multi-client management and white-label reporting interface.',
        inputs: ['Client account configurations'],
        outputs: ['Branded client reports', 'Multi-tenant dashboard'],
        how: 'Add clients in Settings, then switch context using the client dropdown to manage their campaigns separately.' },
      { name: 'C-Suite Executive Reports', icon: '💼',
        what: 'Role-specific board-ready dashboards (CEO, CMO, CFO, COO).',
        inputs: ['Role selection'],
        outputs: ['Executive PDF reports', 'High-level business impact summaries'],
        how: 'Pick the role lens, click Generate, and download the board-ready PDF.' },
      { name: 'Technical Suite', icon: '🛠️',
        what: 'Technical SEO and site health audits.',
        inputs: ['Run All Audits trigger'],
        outputs: ['Crawlability scores', 'Index-readiness report', 'Technical health grade'],
        how: 'Click Run All Audits to execute the full technical sweep. Each finding includes a fix.' },
      { name: 'Integrations & Settings', icon: '🔌',
        what: 'Configuration panel for the entire platform.',
        inputs: ['API keys, AI model selection, account permissions'],
        outputs: ['Connected platform status', 'Global system configuration'],
        how: 'Connect Google Ads, Meta, TikTok, RapidAPI, OpenAI/Anthropic, and other integrations from one screen.' },
    ],
  },
];

// ── PDF helpers ────────────────────────────────────────────────────────────
function newDoc() {
  return new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: 56, right: 56 },
    info: {
      Title: 'InfoGenie — User Manual',
      Author: 'InfoGenie',
      Subject: 'Complete user guide to the InfoGenie autonomous marketing intelligence platform',
      Keywords: 'InfoGenie, marketing, AI, competitor intelligence, user manual',
    },
  });
}

function pageW(doc) { return doc.page.width; }
function pageH(doc) { return doc.page.height; }
function contentW(doc) { return doc.page.width - doc.page.margins.left - doc.page.margins.right; }

function h1(doc, text, color = C.navy) {
  doc.fillColor(color).font('Helvetica-Bold').fontSize(26).text(text, { paragraphGap: 4 });
  doc.moveDown(0.3);
}
function h2(doc, text, color = C.navy) {
  doc.fillColor(color).font('Helvetica-Bold').fontSize(16).text(text);
  doc.moveDown(0.4);
}
function h3(doc, text, color = C.navy) {
  doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(text);
  doc.moveDown(0.2);
}
function p(doc, text, opts = {}) {
  doc.fillColor(opts.color || C.gray800).font('Helvetica').fontSize(opts.size || 10.5)
    .text(text, { paragraphGap: 4, lineGap: 2, ...opts });
}
function small(doc, text, color = C.gray600) {
  doc.fillColor(color).font('Helvetica').fontSize(8.5).text(text);
}

function hr(doc, color = C.gray200) {
  const y = doc.y + 4;
  doc.save().strokeColor(color).lineWidth(0.5)
    .moveTo(doc.page.margins.left, y).lineTo(pageW(doc) - doc.page.margins.right, y).stroke().restore();
  doc.moveDown(0.6);
}

// Coloured pill / badge
function pill(doc, x, y, label, bg, fg = C.white) {
  doc.font('Helvetica-Bold').fontSize(8);
  const w = doc.widthOfString(label) + 14;
  const h = 16;
  doc.save().roundedRect(x, y, w, h, 8).fill(bg);
  doc.fillColor(fg).text(label, x + 7, y + 4, { width: w - 14, align: 'center' });
  doc.restore();
  return w;
}

// Coloured banner block (full content width)
function banner(doc, label, color, sub) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const w = contentW(doc);
  const h = sub ? 56 : 40;
  doc.save();
  // Gradient simulated with two rectangles
  doc.rect(x, y, w, h).fill(color);
  doc.rect(x, y, 6, h).fill(C.navy);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(16).text(label, x + 18, y + (sub ? 10 : 12));
  if (sub) {
    doc.fillColor(C.white).font('Helvetica').fontSize(9.5).text(sub, x + 18, y + 30, { width: w - 36 });
  }
  doc.restore();
  doc.y = y + h + 12;
}

function ensureSpace(doc, needed) {
  const limit = pageH(doc) - doc.page.margins.bottom;
  if (doc.y + needed > limit) doc.addPage();
}

// Footer + page number on each page
function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = pageH(doc) - 36;
    doc.save();
    doc.strokeColor(C.gray200).lineWidth(0.5)
      .moveTo(doc.page.margins.left, y).lineTo(pageW(doc) - doc.page.margins.right, y).stroke();
    doc.fillColor(C.gray400).font('Helvetica').fontSize(8)
      .text('InfoGenie — User Manual', doc.page.margins.left, y + 8, { width: 200 });
    doc.fillColor(C.gray400).text(`Page ${i + 1} of ${range.count}`,
      pageW(doc) - doc.page.margins.right - 100, y + 8, { width: 100, align: 'right' });
    doc.restore();
  }
}

// ── Cover page ─────────────────────────────────────────────────────────────
function drawCover(doc) {
  const w = pageW(doc), h = pageH(doc);
  // Navy background
  doc.rect(0, 0, w, h).fill(C.navy);
  // Diagonal teal accent
  doc.save();
  doc.polygon([0, h], [0, h * 0.55], [w, h * 0.35], [w, h]).fillOpacity(0.10).fill(C.teal);
  doc.restore();
  // Logo bubble
  doc.save();
  doc.circle(80, 90, 22).fill(C.teal);
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(20).text('IG', 70, 80);
  doc.restore();
  // Brand name
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(20).text('InfoGenie', 112, 80);
  doc.fillColor(C.teal).font('Helvetica').fontSize(10).text('Autonomous Marketing Intelligence', 112, 102);

  // Big title
  const titleY = h * 0.32;
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(46)
    .text('User Manual', 56, titleY, { width: w - 112 });
  doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(46)
    .text('Every Feature.', 56, titleY + 56, { width: w - 112 });
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(46)
    .text('Explained.', 56, titleY + 112, { width: w - 112 });

  // Subtitle
  doc.fillColor('#CBD5E1').font('Helvetica').fontSize(13)
    .text('A complete guide to the 30+ tools that turn competitor intel into autonomous growth.',
      56, titleY + 192, { width: w - 112, lineGap: 3 });

  // Stats row
  const statY = h - 220;
  const stats = [
    { n: '5', l: 'Workflow stages' },
    { n: '30+', l: 'Tools & modules' },
    { n: '20+', l: 'Ad channels' },
    { n: '60s', l: 'To first insight' },
  ];
  const colW = (w - 112) / stats.length;
  stats.forEach((s, i) => {
    const x = 56 + i * colW;
    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(28).text(s.n, x, statY, { width: colW - 12 });
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(10).text(s.l, x, statY + 36, { width: colW - 12 });
  });

  // Footer band
  doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(10)
    .text('Version 2026.04 · April 2026', 56, h - 80);
  doc.fillColor('#64748B').font('Helvetica').fontSize(9)
    .text('Read this manual front-to-back, or jump to any module via the table of contents.',
      56, h - 60, { width: w - 112 });
}

// ── Workflow infographic (Analyse → Create → Reach → Grow → Manage) ────────
function drawWorkflowInfographic(doc) {
  ensureSpace(doc, 220);
  const x0 = doc.page.margins.left;
  const y0 = doc.y;
  const w = contentW(doc);
  // Background card
  doc.save().roundedRect(x0, y0, w, 200, 12).fill(C.gray100).restore();
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(13)
    .text('The InfoGenie Loop', x0 + 16, y0 + 14);
  doc.fillColor(C.gray600).font('Helvetica').fontSize(9)
    .text('Five stages that compound: each cycle sharpens the next.', x0 + 16, y0 + 32);

  const stages = [
    { name: 'ANALYSE', icon: '🔍', color: C.teal,   desc: 'Map the market' },
    { name: 'CREATE',  icon: '✏️', color: C.blue,   desc: 'Build assets' },
    { name: 'REACH',   icon: '📡', color: C.purple, desc: 'Distribute' },
    { name: 'GROW',    icon: '📈', color: C.green,  desc: 'Optimise' },
    { name: 'MANAGE',  icon: '⚙️', color: C.amber,  desc: 'Report & operate' },
  ];

  const startY = y0 + 70;
  const nodeW = 78;
  const gap = (w - (nodeW * stages.length) - 32) / (stages.length - 1);

  stages.forEach((s, i) => {
    const cx = x0 + 16 + i * (nodeW + gap);
    // Connector line (after every node except last)
    if (i < stages.length - 1) {
      doc.save().strokeColor(C.gray400).lineWidth(1.2).dash(2, { space: 2 })
        .moveTo(cx + nodeW, startY + 30).lineTo(cx + nodeW + gap, startY + 30).stroke().undash().restore();
    }
    // Node circle
    doc.save().circle(cx + nodeW / 2, startY + 30, 26).fill(s.color);
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11)
      .text(s.name, cx, startY + 25, { width: nodeW, align: 'center' });
    doc.restore();
    // Label below
    doc.fillColor(C.gray800).font('Helvetica-Bold').fontSize(9)
      .text(s.desc, cx, startY + 70, { width: nodeW, align: 'center' });
  });
  doc.y = y0 + 220;
}

// ── Quick start steps infographic ──────────────────────────────────────────
function drawQuickStartInfographic(doc) {
  ensureSpace(doc, 240);
  const x0 = doc.page.margins.left;
  const y0 = doc.y;
  const w = contentW(doc);
  doc.save().roundedRect(x0, y0, w, 220, 12).fill(C.navy).restore();
  doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(13)
    .text('Get to your first insight in 60 seconds', x0 + 16, y0 + 14);

  const steps = [
    { n: '1', t: 'Enter URL', d: 'Type your website (or pick an industry).' },
    { n: '2', t: 'Choose country', d: 'Pick the market that matters for you.' },
    { n: '3', t: 'Click Analyse Now', d: 'InfoGenie maps the market, finds 5+ real competitors and generates a full battle plan.' },
    { n: '4', t: 'Review the dashboard', d: 'KPIs, competitor cards, traffic mix, and the 90-day roadmap appear automatically.' },
    { n: '5', t: 'Take action', d: 'Click any "Counter This Message", launch a campaign, or push an audience to your ad accounts.' },
  ];

  let y = y0 + 46;
  steps.forEach(s => {
    // Number bubble
    doc.save().circle(x0 + 28, y + 14, 12).fill(C.teal);
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11)
      .text(s.n, x0 + 22, y + 8, { width: 12, align: 'center' });
    doc.restore();
    // Title
    doc.fillColor(C.white).font('Helvetica-Bold').fontSize(11)
      .text(s.t, x0 + 50, y + 4);
    // Description
    doc.fillColor('#CBD5E1').font('Helvetica').fontSize(9)
      .text(s.d, x0 + 50, y + 18, { width: w - 70 });
    y += 34;
  });
  doc.y = y0 + 240;
}

// ── Section divider page ───────────────────────────────────────────────────
function drawSectionDivider(doc, section) {
  doc.addPage();
  const w = pageW(doc), h = pageH(doc);
  // Side bar
  doc.rect(0, 0, 12, h).fill(section.color);
  // Big chapter label
  doc.fillColor(C.gray400).font('Helvetica-Bold').fontSize(10)
    .text('NAVIGATION SECTION', 56, 90, { characterSpacing: 1 });
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(48)
    .text(section.nav, 56, 110);
  doc.fillColor(section.color).font('Helvetica-Bold').fontSize(14)
    .text(section.summary, 56, 178, { width: w - 112, lineGap: 3 });

  // Feature count badge
  pill(doc, 56, 220, `${section.features.length} TOOLS`, section.color);
  // Horizontal divider
  doc.save().strokeColor(section.color).lineWidth(1.5)
    .moveTo(56, 260).lineTo(w - 56, 260).stroke().restore();

  // Mini infographic: feature dots
  let cy = 290;
  section.features.forEach((f, idx) => {
    doc.save().circle(72, cy + 8, 5).fill(section.color).restore();
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11)
      .text(f.name, 90, cy, { width: w - 150 });
    doc.fillColor(C.gray600).font('Helvetica').fontSize(9)
      .text(f.what, 90, cy + 14, { width: w - 150 });
    cy += 38;
    if (cy > h - 100) return;
  });
}

// ── Feature card ───────────────────────────────────────────────────────────
function drawFeatureCard(doc, section, feature) {
  ensureSpace(doc, 260);
  const x0 = doc.page.margins.left;
  const y0 = doc.y;
  const w = contentW(doc);

  // Header bar with feature name + section pill
  doc.save();
  doc.roundedRect(x0, y0, w, 36, 8).fill(section.color);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
    .text(feature.name, x0 + 14, y0 + 11, { width: w - 100 });
  doc.fillColor(C.white).font('Helvetica').fontSize(9)
    .text(section.nav.toUpperCase(), x0 + w - 80, y0 + 13, { width: 70, align: 'right' });
  doc.restore();

  doc.y = y0 + 48;

  // What it does
  h3(doc, 'What it does', section.color);
  p(doc, feature.what);
  doc.moveDown(0.3);

  // Two-column inputs / outputs
  const colY = doc.y;
  const colW = (w - 16) / 2;
  // Left: inputs
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10).text('Inputs', x0, colY);
  let lx = x0;
  let ly = colY + 14;
  feature.inputs.forEach(item => {
    doc.fillColor(section.color).circle(lx + 3, ly + 4, 1.8).fill();
    doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
      .text(item, lx + 10, ly, { width: colW - 14 });
    ly = doc.y + 2;
  });
  const leftBottom = ly;
  // Right: outputs
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10).text('Outputs', x0 + colW + 16, colY);
  let rx = x0 + colW + 16;
  let ry = colY + 14;
  feature.outputs.forEach(item => {
    doc.fillColor(section.color).circle(rx + 3, ry + 4, 1.8).fill();
    doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
      .text(item, rx + 10, ry, { width: colW - 14 });
    ry = doc.y + 2;
  });
  const rightBottom = ry;
  doc.y = Math.max(leftBottom, rightBottom) + 6;

  // How to use box
  ensureSpace(doc, 70);
  const howY = doc.y;
  doc.save().roundedRect(x0, howY, w, 0, 6).fill(C.gray100).restore();
  // Compute height by drawing text first (we'll re-draw the rect at correct height)
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10)
    .text('How to use it', x0 + 12, howY + 10);
  doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
    .text(feature.how, x0 + 12, howY + 26, { width: w - 24, lineGap: 2 });
  const howEnd = doc.y + 8;
  // Re-draw rect background under the text
  doc.save();
  doc.roundedRect(x0, howY, w, howEnd - howY, 6).fillOpacity(0.6).fill(C.gray100);
  doc.restore();
  // Re-render text on top of background (since fill covered it)
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10)
    .text('How to use it', x0 + 12, howY + 10);
  doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
    .text(feature.how, x0 + 12, howY + 26, { width: w - 24, lineGap: 2 });
  doc.y = howEnd + 14;

  // Card divider
  hr(doc);
}

// ── TOC ────────────────────────────────────────────────────────────────────
function drawTOC(doc) {
  doc.addPage();
  h1(doc, 'Table of contents');
  doc.moveDown(0.4);

  const items = [];
  items.push({ label: 'Welcome to InfoGenie', level: 1 });
  items.push({ label: 'How the platform works (the InfoGenie Loop)', level: 1 });
  items.push({ label: 'Quick start — your first 60 seconds', level: 1 });
  SECTIONS.forEach(s => {
    items.push({ label: `${s.nav} — ${s.summary}`, level: 1, color: s.color });
    s.features.forEach(f => items.push({ label: f.name, level: 2 }));
  });
  items.push({ label: 'Glossary', level: 1 });
  items.push({ label: 'Tips, troubleshooting & support', level: 1 });

  items.forEach(it => {
    if (it.level === 1) {
      ensureSpace(doc, 22);
      doc.fillColor(it.color || C.navy).font('Helvetica-Bold').fontSize(11)
        .text('• ' + it.label, { paragraphGap: 2 });
    } else {
      ensureSpace(doc, 16);
      doc.fillColor(C.gray600).font('Helvetica').fontSize(9.5)
        .text('     – ' + it.label, { paragraphGap: 1 });
    }
  });
}

// ── Glossary ───────────────────────────────────────────────────────────────
const GLOSSARY = [
  ['ICP', 'Ideal Customer Profile — the persona representing your most valuable buyer.'],
  ['SERP', 'Search Engine Results Page — what Google returns for a query.'],
  ['SoV', 'Share of Voice — your visibility relative to competitors in a channel.'],
  ['CTR', 'Click-Through Rate — clicks divided by impressions.'],
  ['ROAS', 'Return on Ad Spend — revenue generated per unit of ad spend.'],
  ['CPC', 'Cost Per Click — average cost paid for each ad click.'],
  ['CPA', 'Cost Per Acquisition — average cost to acquire a customer.'],
  ['VoC', 'Voice of Customer — direct quotes and language from real users (often Reddit/reviews).'],
  ['Win/Loss', 'Analysis of which competitor messages beat yours and why.'],
  ['AI Citations', 'Mentions of your brand in answers from ChatGPT, Claude, Gemini, Perplexity etc.'],
  ['Battle Plan', 'The 90-day prioritised execution roadmap InfoGenie generates after analysis.'],
  ['Auto-Draft', 'AI-generated reply suggestion that matches your saved brand persona.'],
];

function drawGlossary(doc) {
  doc.addPage();
  h1(doc, 'Glossary');
  doc.moveDown(0.4);
  GLOSSARY.forEach(([term, def]) => {
    ensureSpace(doc, 30);
    doc.fillColor(C.teal).font('Helvetica-Bold').fontSize(11).text(term);
    doc.fillColor(C.gray800).font('Helvetica').fontSize(10).text(def, { paragraphGap: 6 });
  });
}

// ── Tips & support ─────────────────────────────────────────────────────────
const TIPS = [
  { title: 'Always start with a fresh analysis', body: 'For best results, re-run the analysis whenever you change the target country or notice a major market shift. The dashboard, Battle Plan and competitor cards all derive from this single run.' },
  { title: 'Use ICP Studio before Reply Studio', body: 'Saving a brand persona in ICP Studio means every Reddit reply, ad and email draft will sound like your brand — not generic AI text.' },
  { title: 'Mix the Tone dropdown carefully', body: 'In Reply Studio, picking "Helpful Expert" wins on Reddit; "Bold & Punchy" wins on Twitter/X; "Empathetic" wins on community forums.' },
  { title: 'Counter This Message ≠ a one-shot', body: 'When you click Counter This Message, InfoGenie creates a 3-step counter-strategy. Each step can be edited or rejected before launch.' },
  { title: 'Hard refresh after platform updates', body: 'If buttons appear unresponsive after we ship an update, do a hard refresh (Ctrl/Cmd + Shift + R). The cache buster forces a fresh JS load.' },
  { title: 'Check Settings → Integrations weekly', body: 'API tokens for Google Ads, Meta, TikTok and RapidAPI can rotate or expire. The Settings panel shows the live status of each connection.' },
];

function drawTips(doc) {
  doc.addPage();
  h1(doc, 'Tips, troubleshooting & support');
  doc.moveDown(0.3);
  p(doc, 'Six rules of thumb that consistently get the best results from InfoGenie. Read them once and revisit when something feels off.');
  doc.moveDown(0.6);

  TIPS.forEach(t => {
    ensureSpace(doc, 60);
    const x0 = doc.page.margins.left;
    const w = contentW(doc);
    const startY = doc.y;
    // Side teal bar
    doc.save().rect(x0, startY, 4, 0).fill(C.teal).restore();
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(11)
      .text(t.title, x0 + 12, startY, { width: w - 12 });
    doc.fillColor(C.gray800).font('Helvetica').fontSize(10)
      .text(t.body, x0 + 12, doc.y + 2, { width: w - 12, paragraphGap: 6, lineGap: 2 });
    const endY = doc.y;
    doc.save().rect(x0, startY, 4, endY - startY).fill(C.teal).restore();
    doc.moveDown(0.5);
  });

  // Support footer
  ensureSpace(doc, 80);
  doc.moveDown(0.6);
  banner(doc, 'Need help?', C.navy, 'Raise an issue from inside the app — the platform sends diagnostic context automatically so we can resolve it faster.');
}

// ── Build ──────────────────────────────────────────────────────────────────
function build(outPath) {
  const doc = newDoc();
  doc.pipe(fs.createWriteStream(outPath));

  // 1. Cover
  drawCover(doc);

  // 2. TOC
  drawTOC(doc);

  // 3. Welcome
  doc.addPage();
  h1(doc, 'Welcome to InfoGenie');
  p(doc, 'InfoGenie is an autonomous marketing intelligence platform. Give it a website or an industry and within 60 seconds it maps the competitive landscape, identifies your real competitors, surfaces the messages winning against you, and ships a 90-day execution plan you can act on the same day.');
  doc.moveDown(0.5);
  p(doc, 'This manual covers every tool in the platform. Each module follows the same pattern: what it does, what to feed it, what you get back, and how to use it well. Read end-to-end the first time, then jump in via the table of contents.');
  doc.moveDown(0.8);

  // 4. The Loop
  h2(doc, 'How the platform works');
  p(doc, 'Five stages compound on each other. Skipping one weakens the rest.');
  doc.moveDown(0.4);
  drawWorkflowInfographic(doc);

  doc.moveDown(0.8);
  h2(doc, 'Quick start — your first 60 seconds');
  drawQuickStartInfographic(doc);

  // 5. Sections
  SECTIONS.forEach(section => {
    drawSectionDivider(doc, section);
    doc.addPage();
    banner(doc, `${section.nav} — features in detail`, section.color, section.summary);
    section.features.forEach(f => drawFeatureCard(doc, section, f));
  });

  // 6. Glossary
  drawGlossary(doc);

  // 7. Tips
  drawTips(doc);

  // Footers (require buffered pages)
  // Note: PDFKit needs `bufferPages: true` for switchToPage. Re-create with that flag.
  doc.end();
}

// Re-build with bufferPages enabled so we can add footers
function buildWithFooters(outPath) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: {
      Title: 'InfoGenie — User Manual',
      Author: 'InfoGenie',
      Subject: 'Complete user guide to the InfoGenie autonomous marketing intelligence platform',
      Keywords: 'InfoGenie, marketing, AI, competitor intelligence, user manual',
    },
  });
  doc.pipe(fs.createWriteStream(outPath));

  drawCover(doc);
  drawTOC(doc);

  doc.addPage();
  h1(doc, 'Welcome to InfoGenie');
  p(doc, 'InfoGenie is an autonomous marketing intelligence platform. Give it a website or an industry and within 60 seconds it maps the competitive landscape, identifies your real competitors, surfaces the messages winning against you, and ships a 90-day execution plan you can act on the same day.');
  doc.moveDown(0.5);
  p(doc, 'This manual covers every tool in the platform. Each module follows the same pattern: what it does, what to feed it, what you get back, and how to use it well. Read end-to-end the first time, then jump in via the table of contents.');
  doc.moveDown(0.8);

  h2(doc, 'How the platform works');
  p(doc, 'Five stages compound on each other. Skipping one weakens the rest.');
  doc.moveDown(0.4);
  drawWorkflowInfographic(doc);

  doc.moveDown(0.8);
  h2(doc, 'Quick start — your first 60 seconds');
  drawQuickStartInfographic(doc);

  SECTIONS.forEach(section => {
    drawSectionDivider(doc, section);
    doc.addPage();
    banner(doc, `${section.nav} — features in detail`, section.color, section.summary);
    section.features.forEach(f => drawFeatureCard(doc, section, f));
  });

  drawGlossary(doc);
  drawTips(doc);

  addFooters(doc);
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
}

const out = path.join(__dirname, '..', 'attached_assets', 'InfoGenie_User_Manual.pdf');
buildWithFooters(out).then(() => {
  console.log('PDF written:', out);
}).catch(err => { console.error(err); process.exit(1); });

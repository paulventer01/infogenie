/* eslint-disable */
// Build InfoGenie User Manual as a polished, downloadable PDF.
// Uses PDFKit (pure JS, no headless browser needed).

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { SECTIONS: CATALOGUE_SECTIONS } = require('./manual_data');
const WHY_LINES = (() => { try { return require('./manual_why'); } catch (_) { return {}; } })();
// Inject the "why it matters" tagline into each feature record so
// drawFeatureCard can render it without changing the data file.
CATALOGUE_SECTIONS.forEach(s => (s.features || []).forEach(f => {
  if (!f.why && WHY_LINES[f.id]) f.why = WHY_LINES[f.id];
}));

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

// ── Screenshot directory ──────────────────────────────────────────────────
const SHOT_DIR = path.join(__dirname, '..', 'attached_assets', 'manual_screenshots');
function shotPath(file) {
  const full = path.join(SHOT_DIR, file);
  return fs.existsSync(full) ? full : null;
}

const SECTIONS = CATALOGUE_SECTIONS;

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

// Footer + page number on each page.
// We temporarily zero the page's bottom margin so PDFKit doesn't think the
// footer text is overflowing and auto-create extra blank pages.
function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const origBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = pageH(doc) - 36;
    doc.save();
    doc.strokeColor(C.gray200).lineWidth(0.5)
      .moveTo(doc.page.margins.left, y).lineTo(pageW(doc) - doc.page.margins.right, y).stroke();
    doc.fillColor(C.gray400).font('Helvetica').fontSize(8)
      .text('InfoGenie — User Manual', doc.page.margins.left, y + 8, { width: 200 });
    doc.fillColor(C.gray400).text(`Page ${i + 1} of ${range.count}`,
      pageW(doc) - doc.page.margins.right - 100, y + 8, { width: 100, align: 'right' });
    doc.restore();
    doc.page.margins.bottom = origBottom;
  }
}

// ── Cover page ─────────────────────────────────────────────────────────────
function drawCover(doc) {
  // Zero margins on the cover page so absolute-positioned text near the page
  // edges doesn't trigger PDFKit's auto-pagination.
  const orig = { ...doc.page.margins };
  doc.page.margins.top = 0;
  doc.page.margins.bottom = 0;
  doc.page.margins.left = 0;
  doc.page.margins.right = 0;

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
    .text('A complete guide to every page, sub-page and tool — illustrated with live screenshots.',
      56, titleY + 192, { width: w - 112, lineGap: 3 });

  // Stats row
  const statY = h - 220;
  const stats = [
    { n: '5', l: 'Workflow stages' },
    { n: '120+', l: 'Tools & modules' },
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
    .text('Version 2026.05 · May 2026', 56, h - 80, { lineBreak: false });
  doc.fillColor('#64748B').font('Helvetica').fontSize(9)
    .text('Read this manual front-to-back, or jump to any module via the table of contents.',
      56, h - 60, { width: w - 112, lineBreak: false });

  // Restore original margins for the rest of the document.
  doc.page.margins.top = orig.top;
  doc.page.margins.bottom = orig.bottom;
  doc.page.margins.left = orig.left;
  doc.page.margins.right = orig.right;
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
  // Same trick as drawFeatureCard: zero the bottom margin so the section's
  // feature-dot list can't auto-paginate into orphan one-line pages when a
  // section has many features (Analyse alone has 16+).
  const origBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
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

  // Mini infographic: feature dots — adapt row spacing to fit all features
  // on the single divider page. With many features (e.g. Analyse has 16+),
  // a fixed 38px row exceeds the page; compute spacing from available height.
  const listTop = 290;
  const listBottom = h - 80;
  const available = listBottom - listTop;
  const rowH = Math.max(20, Math.min(38, Math.floor(available / Math.max(1, section.features.length))));
  let cy = listTop;
  section.features.forEach((f) => {
    if (cy + rowH > listBottom) return; // safety: stop if we'd overflow
    doc.save().circle(72, cy + 8, 5).fill(section.color).restore();
    doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(rowH >= 32 ? 11 : 10)
      .text(f.name, 90, cy, { width: w - 150, height: 12, ellipsis: true, lineBreak: false });
    if (rowH >= 28) {
      doc.fillColor(C.gray600).font('Helvetica').fontSize(rowH >= 32 ? 9 : 8.5)
        .text(f.what, 90, cy + 14, { width: w - 150, height: rowH - 14, ellipsis: true, lineBreak: false });
    }
    cy += rowH;
  });

  // Restore the original bottom margin for downstream pages.
  doc.page.margins.bottom = origBottom;
}

// ── Feature card (one feature per page, screenshot embedded) ────────────────
function drawFeatureCard(doc, section, feature) {
  // Always start each feature on a fresh page so layout is consistent and aligned.
  doc.addPage();

  // Disable auto-pagination for the entire card by zeroing the bottom margin.
  // PDFKit auto-creates a new page (often containing 1 word/sentence of overflow)
  // any time text() with an explicit y crosses page.margins.bottom — which happens
  // on Analyse-section features that have long inputs/outputs or "how to use it"
  // copy. Zeroing the bottom margin keeps everything on the single feature page.
  const origBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const x0 = doc.page.margins.left;
  const y0 = doc.page.margins.top;
  const w = contentW(doc);

  // ── 1. Header bar (feature name + section tag) ──────────────────────────
  const headerH = 40;
  doc.save();
  doc.roundedRect(x0, y0, w, headerH, 8).fill(section.color);
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(14)
    .text(feature.name, x0 + 16, y0 + 13, { width: w - 110, ellipsis: true });
  // Right-aligned section tag
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(9)
    .text(section.nav.toUpperCase(), x0 + w - 96, y0 + 16, { width: 80, align: 'right', characterSpacing: 1 });
  doc.restore();

  let cursorY = y0 + headerH + 14;

  // ── 2. "What it does" paragraph ─────────────────────────────────────────
  doc.fillColor(section.color).font('Helvetica-Bold').fontSize(10)
    .text('WHAT IT DOES', x0, cursorY, { characterSpacing: 1 });
  cursorY = doc.y + 4;
  doc.fillColor(C.gray800).font('Helvetica').fontSize(10.5)
    .text(feature.what, x0, cursorY, { width: w, lineGap: 2 });
  cursorY = doc.y + 6;
  // Optional "Why it matters" tagline — pulled from manual_why.js by id.
  // Kept compact (italic, 9.5pt) so the page does not gain extra height.
  if (feature.why) {
    doc.fillColor(C.gray600).font('Helvetica-Oblique').fontSize(9.5)
      .text('Why it matters: ' + feature.why, x0, cursorY, { width: w, lineGap: 1.5 });
    cursorY = doc.y + 10;
  } else {
    cursorY += 8;
  }

  // ── 3. Screenshot embed ─────────────────────────────────────────────────
  const shot = feature.shot ? shotPath(feature.shot) : null;
  if (shot) {
    // Source images are 1440x900 (1.6 aspect). Cap height so we leave room
    // for the columns + how-to box below.
    const maxImgH = 270;
    const maxImgW = w;
    let imgW = maxImgW;
    let imgH = imgW / 1.6;
    if (imgH > maxImgH) {
      imgH = maxImgH;
      imgW = imgH * 1.6;
    }
    const imgX = x0 + (w - imgW) / 2;
    // Border + soft shadow
    doc.save();
    doc.roundedRect(imgX - 1, cursorY - 1, imgW + 2, imgH + 2, 6)
      .lineWidth(1).strokeColor(C.gray200).stroke();
    doc.restore();
    try {
      doc.image(shot, imgX, cursorY, { width: imgW, height: imgH });
    } catch (err) {
      // Fallback: leave a placeholder rectangle
      doc.save().rect(imgX, cursorY, imgW, imgH).fill(C.gray100).restore();
      doc.fillColor(C.gray400).font('Helvetica').fontSize(10)
        .text('[ screenshot unavailable ]', imgX, cursorY + imgH / 2 - 5, { width: imgW, align: 'center' });
    }
    // Caption
    doc.fillColor(C.gray400).font('Helvetica-Oblique').fontSize(8.5)
      .text(`Live view: ${feature.name}`, x0, cursorY + imgH + 6, { width: w, align: 'center' });
    cursorY = cursorY + imgH + 24;
  }

  // ── 4. Two-column Inputs / Outputs ──────────────────────────────────────
  const gap = 16;
  const colW = (w - gap) / 2;
  const colY = cursorY;

  // Column headers
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10)
    .text('INPUTS', x0, colY, { characterSpacing: 1, width: colW });
  doc.fillColor(C.navy).font('Helvetica-Bold').fontSize(10)
    .text('OUTPUTS', x0 + colW + gap, colY, { characterSpacing: 1, width: colW });

  const listStartY = colY + 16;

  // Left: inputs
  let ly = listStartY;
  feature.inputs.forEach(item => {
    doc.save().fillColor(section.color).circle(x0 + 3, ly + 5, 2).fill().restore();
    doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
      .text(item, x0 + 12, ly, { width: colW - 14, lineGap: 1.5 });
    ly = doc.y + 3;
  });
  const leftBottom = ly;

  // Right: outputs
  let ry = listStartY;
  feature.outputs.forEach(item => {
    doc.save().fillColor(section.color).circle(x0 + colW + gap + 3, ry + 5, 2).fill().restore();
    doc.fillColor(C.gray800).font('Helvetica').fontSize(9.5)
      .text(item, x0 + colW + gap + 12, ry, { width: colW - 14, lineGap: 1.5 });
    ry = doc.y + 3;
  });
  const rightBottom = ry;

  cursorY = Math.max(leftBottom, rightBottom) + 10;

  // ── 5. "How to use it" tinted box ───────────────────────────────────────
  // Measure first, then draw rect once, then draw text once (no double render).
  const padX = 14;
  const padY = 12;
  const labelH = 14;
  const howTextW = w - padX * 2;
  doc.font('Helvetica').fontSize(10);
  const howTextH = doc.heightOfString(feature.how, { width: howTextW, lineGap: 2 });
  const howBoxH = padY + labelH + 4 + howTextH + padY;

  doc.save();
  doc.roundedRect(x0, cursorY, w, howBoxH, 8).fill(C.gray100);
  // Left accent stripe
  doc.rect(x0, cursorY, 4, howBoxH).fill(section.color);
  doc.restore();

  doc.fillColor(section.color).font('Helvetica-Bold').fontSize(10)
    .text('HOW TO USE IT', x0 + padX, cursorY + padY, { characterSpacing: 1 });
  doc.fillColor(C.gray800).font('Helvetica').fontSize(10)
    .text(feature.how, x0 + padX, cursorY + padY + labelH + 4, { width: howTextW, lineGap: 2 });

  // Restore the original bottom margin so subsequent pages (TOC, glossary,
  // tips, etc.) get their normal footer-safe layout back.
  doc.page.margins.bottom = origBottom;
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

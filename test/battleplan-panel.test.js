'use strict';
// Source-audit lock for the Battle Plan React panel (components/features/analyse/Battleplan.tsx).
// Reads TSX as text — no React Testing Library (same pattern as test/analysis-restore-boot.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BATTLEPLAN = fs.readFileSync(
  path.join(__dirname, '..', 'components/features/analyse/Battleplan.tsx'),
  'utf8',
);
const VIEW_ROUTES = fs.readFileSync(
  path.join(__dirname, '..', 'lib/viewRoutes.ts'),
  'utf8',
);

test('Battleplan listens for analysis restore / update events', () => {
  assert.match(
    BATTLEPLAN,
    /addEventListener\(\s*['"]ig:analysis-ready['"]/,
    'listens for ig:analysis-ready on document',
  );
  assert.match(
    BATTLEPLAN,
    /addEventListener\(\s*['"]ig:analysis-updated['"]/,
    'listens for ig:analysis-updated',
  );
  assert.match(
    BATTLEPLAN,
    /window\.addEventListener\(\s*['"]ig:analysis-updated['"]/,
    'listens for ig:analysis-updated on window',
  );
  assert.match(
    BATTLEPLAN,
    /document\.addEventListener\(\s*['"]ig:analysis-updated['"]/,
    'listens for ig:analysis-updated on document',
  );
});

test('Battleplan empty state and section structure', () => {
  assert.match(BATTLEPLAN, /No Analysis Yet/, 'empty state heading');
  const sections = [
    'Exploit Their Weaknesses',
    'Keyword Attack Windows',
    'Creative Counter-Strategy',
    'Untapped Audience Segments',
    'Campaign Counter-Moves',
    'High-ROI Quick Wins',
  ];
  for (const title of sections) {
    assert.match(BATTLEPLAN, new RegExp(title), `section title: ${title}`);
  }
  assert.match(BATTLEPLAN, /Execute Top Priority/, 'hero CTA');
  assert.match(BATTLEPLAN, /Generate Attack Plan/, 'full attack plan CTA');
  assert.match(BATTLEPLAN, /Deep Intelligence/, 'deep intelligence link');
  assert.match(BATTLEPLAN, /Opportunity Score/, 'opportunity score block');
});

test('Battleplan null-safe campaign metrics and no dangerouslySetInnerHTML', () => {
  assert.doesNotMatch(
    BATTLEPLAN,
    /dangerouslySetInnerHTML/,
    'competitor-controlled strings are rendered as text, not HTML',
  );
  assert.match(
    BATTLEPLAN,
    /function fmtMetric|fmtMetric\(/,
    'null campaign metrics use a safe formatter',
  );
  assert.doesNotMatch(
    BATTLEPLAN,
    /\$\{camp\.ctr\}.*\$\{camp\.roas\}/,
    'does not interpolate raw camp.ctr / camp.roas without formatting',
  );
});

test('Battleplan first quick win tags estimated ROI copy', () => {
  const quickWinSection = BATTLEPLAN.match(/\/\/ ── 6\. Quick Wins[\s\S]*?const overviewMetrics/);
  assert.ok(quickWinSection, 'quick wins section present');
  const block = quickWinSection[0];
  assert.match(
    block,
    /firstQwCopy\s*=\s*c\.estimatedROI\s*\|\|\s*SYNTHETIC_QW_ROI/,
    'first quick win uses estimatedROI with synthetic CTR fallback',
  );
  assert.match(
    block,
    /SYNTHETIC_QW_ROI\s*=\s*["']\+25% CTR improvement via tighter audience segmentation["']/,
    'synthetic CTR fallback string is defined',
  );
  assert.match(
    block,
    /qi\s*===\s*0[\s\S]{0,250}<EstimateBadge/,
    'first quick-win card (qi === 0) includes EstimateBadge for estimated ROI copy',
  );
});

test('Battleplan honesty tagging and breadcrumb', () => {
  assert.match(
    BATTLEPLAN,
    /EstimateBadge/,
    'estimate / honesty tagging for synthetic metrics',
  );
  assert.match(
    BATTLEPLAN,
    /Know your competition/,
    'breadcrumb includes Know your competition',
  );
  assert.match(
    VIEW_ROUTES,
    /view:\s*["']battleplan["'][\s\S]*?label:\s*["']Battle Plan["']/,
    'viewRoutes battleplan label is Battle Plan',
  );
  assert.doesNotMatch(
    VIEW_ROUTES,
    /Marketing Plan \/ Battle Plan/,
    'old Marketing Plan / Battle Plan label removed',
  );
});

test('Battleplan attack plan select is controlled', () => {
  assert.match(
    BATTLEPLAN,
    /id=["']attackPlanCompSelect["'][\s\S]*?value=\{String\(idx\)\}/,
    'attack plan competitor select follows tab index',
  );
  assert.match(
    BATTLEPLAN,
    /onChange=\{.*switchComp/,
    'select onChange calls switchComp',
  );
});

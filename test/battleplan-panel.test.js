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

test('Battleplan honesty tagging and breadcrumb', () => {
  assert.match(
    BATTLEPLAN,
    /EstimateBadge|ESTIMATE|estimated/,
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

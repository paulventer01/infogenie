// Zero-click search readiness — featured snippets, PAA, AI overview signals.
// Builds on GEO/AEO page checks.

const { buildAeoReport } = require('../aeo/analyzer');

const SIGNALS = [
  { id: 'featured_snippet', label: 'Featured snippet readiness', weight: 20 },
  { id: 'paa', label: 'People Also Ask alignment', weight: 18 },
  { id: 'direct_answer', label: 'Direct answer block', weight: 18 },
  { id: 'structured_lists', label: 'Structured lists & tables', weight: 14 },
  { id: 'schema_faq', label: 'FAQ / HowTo schema', weight: 15 },
  { id: 'ai_overview', label: 'AI overview citation signals', weight: 15 },
];

function _grade(score) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

function _check(id, label, status, weight, message, fix) {
  const earned = status === 'pass' ? weight : status === 'warn' ? Math.round(weight * 0.5) : 0;
  return { id, label, status, weight, earned, message, fix };
}

function analyzeZeroClick(geoResult) {
  const checks = geoResult.checks || [];
  const summary = geoResult.summary || {};
  const words = summary.words || 0;
  const qHeadings = summary.qHeadings || 0;
  const schemaBlocks = summary.schemaBlocks || 0;

  const schemaCheck = checks.find((c) => c.id === 'schema');
  const leadCheck = checks.find((c) => c.id === 'lead_answer');
  const conciseCheck = checks.find((c) => c.id === 'concise_paras');
  const faqSchema = /faq/i.test(JSON.stringify(geoResult.checks || []));

  const signals = [];

  // Featured snippet: concise lead + lists
  const snippetReady = leadCheck?.status === 'pass' && (conciseCheck?.status === 'pass' || words < 1200);
  signals.push(_check(
    'featured_snippet',
    'Featured snippet readiness',
    snippetReady ? 'pass' : leadCheck?.status === 'warn' ? 'warn' : 'fail',
    20,
    snippetReady ? 'Lead paragraph and structure suit paragraph snippets.' : 'Add a 40–60 word direct answer under the H1.',
    'Place a concise definition or answer in the first paragraph (40–60 words) under a question-style H1.',
  ));

  signals.push(_check(
    'paa',
    'People Also Ask alignment',
    qHeadings >= 3 ? 'pass' : qHeadings >= 1 ? 'warn' : 'fail',
    18,
    qHeadings >= 3 ? `${qHeadings} question headings for PAA-style blocks.` : 'Few question-style headings.',
    'Add H2/H3 headings phrased as real user questions (with ?) matching PAA queries.',
  ));

  signals.push(_check(
    'direct_answer',
    'Direct answer block',
    leadCheck?.status === 'pass' ? 'pass' : leadCheck?.status === 'warn' ? 'warn' : 'fail',
    18,
    leadCheck?.message || 'Lead answer quality unknown.',
    leadCheck?.fix || 'Open with a direct answer before elaborating.',
  ));

  const listSignals = checks.filter((c) => /list|table|semantic/i.test(c.id + c.label));
  const listOk = listSignals.some((c) => c.status === 'pass') || qHeadings >= 2;
  signals.push(_check(
    'structured_lists',
    'Structured lists & tables',
    listOk ? 'pass' : 'warn',
    14,
    listOk ? 'Scannable lists or semantic chunks detected.' : 'Add bullet lists or comparison tables.',
    'Use <ul>/<ol> or tables for steps, comparisons, and specs — snippets favor structured lists.',
  ));

  signals.push(_check(
    'schema_faq',
    'FAQ / HowTo schema',
    schemaCheck?.status === 'pass' || faqSchema ? 'pass' : schemaCheck?.status === 'warn' ? 'warn' : 'fail',
    15,
    schemaBlocks ? `${schemaBlocks} schema block(s) on page.` : 'No schema detected.',
    'Add FAQPage JSON-LD for top questions — use Schema Generator or AEO FAQ export.',
  ));

  const aeo = buildAeoReport(geoResult);
  const aiOverviewOk = aeo.score >= 70 && schemaCheck?.status !== 'fail';
  signals.push(_check(
    'ai_overview',
    'AI overview citation signals',
    aiOverviewOk ? 'pass' : aeo.score >= 55 ? 'warn' : 'fail',
    15,
    `Composite AEO score ${aeo.score}/100 for AI citation potential.`,
    'Improve authority + schema pillars in AEO Optimizer; aim for 70+ before expecting AI Overview picks.',
  ));

  const weight = signals.reduce((s, c) => s + c.weight, 0);
  const earned = signals.reduce((s, c) => s + c.earned, 0);
  const score = weight ? Math.round((earned / weight) * 100) : 0;

  const fixes = signals
    .filter((c) => c.status !== 'pass' && c.fix)
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned))
    .slice(0, 6)
    .map((c) => ({ id: c.id, label: c.label, status: c.status, fix: c.fix }));

  const clicklessPct = Math.min(95, Math.round(score * 0.85 + (qHeadings >= 3 ? 10 : 0)));

  return {
    score,
    grade: _grade(score),
    signals,
    signalDefs: SIGNALS,
    fixes,
    clicklessImpressionPct: clicklessPct,
    aeoScore: aeo.score,
    aeoGrade: aeo.grade,
    priority: fixes[0]
      ? `Fix "${fixes[0].label}" first to improve zero-click visibility.`
      : 'Strong zero-click readiness — monitor SERP features in Rank Tracker.',
    url: geoResult.url,
    summary: geoResult.summary,
  };
}

module.exports = { SIGNALS, analyzeZeroClick };

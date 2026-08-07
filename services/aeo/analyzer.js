// AEO (Answer Engine Optimization) — four-pillar scoring framework.
// Built on: clear structure, direct answers, authority signals, AI-friendly formatting.

const PILLARS = [
  {
    id: 'structure',
    label: 'Clear content structure',
    description: 'Logical headings, scannable lists/tables, and a descriptive title so answer engines can parse your page hierarchy.',
    checkIds: ['q_headings', 'semantic_chunks', 'title'],
  },
  {
    id: 'direct_answers',
    label: 'Direct answers to user questions',
    description: 'Question-style headings, a lead paragraph that answers upfront, and concise snippets AI can lift verbatim.',
    checkIds: ['q_headings', 'lead_answer', 'concise_paras'],
  },
  {
    id: 'authority',
    label: 'Strong authority signals',
    description: 'E-E-A-T (author, bio, credentials), freshness dates, and internal links that prove topical depth.',
    checkIds: ['eeat', 'freshness', 'internal_links'],
  },
  {
    id: 'ai_formatting',
    label: 'AI-friendly formatting',
    description: 'JSON-LD (FAQPage, Article, Organization), /llms.txt, meta descriptions, and accessible alt text.',
    checkIds: ['schema', 'llms_txt', 'meta_desc', 'alt_text'],
  },
];

function _pillarScore(checks, checkIds) {
  const subset = checks.filter((c) => checkIds.includes(c.id));
  if (!subset.length) return { score: 0, earned: 0, weight: 0, checks: [] };
  const weight = subset.reduce((s, c) => s + c.weight, 0);
  const earned = subset.reduce((s, c) => s + c.earned, 0);
  return {
    score: weight ? Math.round((earned / weight) * 100) : 0,
    earned,
    weight,
    checks: subset,
  };
}

function buildAeoReport(geoResult) {
  const checks = geoResult.checks || [];
  const pillars = PILLARS.map((p) => ({
    ...p,
    ..._pillarScore(checks, p.checkIds),
  }));

  const totalWeight = pillars.reduce((s, p) => s + p.weight, 0);
  const totalEarned = pillars.reduce((s, p) => s + p.earned, 0);
  const score = totalWeight ? Math.round((totalEarned / totalWeight) * 100) : geoResult.score;
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  const fixes = checks
    .filter((c) => c.status !== 'pass' && c.fix)
    .sort((a, b) => (b.weight - b.earned) - (a.weight - a.earned))
    .slice(0, 8)
    .map((c) => ({ id: c.id, label: c.label, status: c.status, fix: c.fix }));

  const weakest = [...pillars].sort((a, b) => a.score - b.score)[0];

  return {
    score,
    grade,
    pillars,
    principles: PILLARS.map(({ id, label, description }) => ({ id, label, description })),
    fixes,
    priority: weakest
      ? `Strengthen "${weakest.label}" first (currently ${weakest.score}/100).`
      : 'All pillars look healthy — run a citation check to verify AI engines cite you.',
    summary: geoResult.summary,
    url: geoResult.url,
  };
}

module.exports = { PILLARS, buildAeoReport };

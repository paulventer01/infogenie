'use strict';

/**
 * Canonical 10-step revenue marketing plan.
 * Goal → Customer → Problem → Competition → Positioning → Offer → Channels → Conversion → Metrics → Optimization
 */
const STEPS = [
  {
    id: 1,
    key: 'goal',
    title: 'Define the Revenue Goal',
    advice: "Don't start with followers. Start with a number.",
    insight: 'Work backward: revenue → customers → AOV.',
    required: ['revenue_target', 'customers', 'aov'],
    fields: [
      { key: 'revenue_target', label: 'Revenue target', placeholder: 'e.g. $100,000', type: 'text' },
      { key: 'customers', label: 'Customers needed', placeholder: 'e.g. 1,000', type: 'text' },
      { key: 'aov', label: 'Average order value', placeholder: 'e.g. $100', type: 'text' },
      { key: 'timeframe', label: 'Timeframe', placeholder: 'e.g. next 90 days', type: 'text' },
    ],
    tools: [
      { view: 'agent-goals', label: 'Goals Hub' },
      { view: 'marketing-okr', label: 'OKRs' },
      { view: 'budget', label: 'Budget Hub' },
      { view: 'flywheel', label: 'Flywheel' },
    ],
  },
  {
    id: 2,
    key: 'customer',
    title: 'Define the Ideal Customer',
    advice: "Don't target “everyone who needs this.”",
    insight: 'Industry + Role + Problem + Buying trigger + Budget.',
    required: ['industry', 'role', 'problem'],
    fields: [
      { key: 'industry', label: 'Industry', placeholder: 'e.g. B2B SaaS / Forex / DTC', type: 'text' },
      { key: 'role', label: 'Role / buyer', placeholder: 'e.g. CMO, founder, media buyer', type: 'text' },
      { key: 'problem', label: 'Problem they feel', placeholder: 'The pain they would pay to remove', type: 'textarea' },
      { key: 'buying_trigger', label: 'Buying trigger', placeholder: 'What makes them buy now?', type: 'text' },
      { key: 'budget', label: 'Budget range', placeholder: 'e.g. $2k–$10k / month', type: 'text' },
    ],
    tools: [
      { view: 'icp-studio', label: 'ICP Studio' },
      { view: 'persona-studio', label: 'Persona Studio' },
      { view: 'audience', label: 'Audience Builder' },
    ],
  },
  {
    id: 3,
    key: 'problem',
    title: 'Find the Real Problem',
    advice: 'Interview 10–15 customers. Look for the problem they repeatedly describe.',
    insight: 'Customer language becomes your messaging.',
    required: ['repeated_problem'],
    fields: [
      { key: 'interviews', label: 'Interviews / reviews sampled', placeholder: 'e.g. 12 customer calls', type: 'text' },
      { key: 'repeated_problem', label: 'Problem they keep repeating', placeholder: 'Quote their words, not your assumption', type: 'textarea' },
      { key: 'customer_language', label: 'Phrases to use in copy', placeholder: 'Exact words they use', type: 'textarea' },
    ],
    tools: [
      { view: 'voc', label: 'Voice of Customer' },
      { view: 'surveys', label: 'Surveys' },
      { view: 'social-listening', label: 'Social Listening' },
      { view: 'review-aggregator', label: 'Reviews' },
    ],
  },
  {
    id: 4,
    key: 'competition',
    title: 'Map the Competition',
    advice: 'Study 5–10 competitors. Your opportunity is often hiding in the gaps.',
    insight: 'Promise · audience · price · praise · complaints.',
    required: ['competitors', 'gap'],
    fields: [
      { key: 'competitors', label: 'Competitors (5–10)', placeholder: 'Names or domains, one per line', type: 'textarea' },
      { key: 'they_promise', label: 'What they promise', placeholder: 'Common claims', type: 'textarea' },
      { key: 'they_charge', label: 'What they charge', placeholder: 'Price / packaging notes', type: 'text' },
      { key: 'gap', label: 'The gap you will own', placeholder: 'What customers praise or complain about that you can win', type: 'textarea' },
    ],
    tools: [
      { view: 'competitors', label: 'Competitor Profiles' },
      { view: 'battle-cards', label: 'Battle Cards' },
      { view: 'ad-library', label: 'Ad Library' },
      { view: 'pricing-watch', label: 'Pricing Watch' },
      { view: 'battleplan', label: 'Battle Plan' },
    ],
  },
  {
    id: 5,
    key: 'positioning',
    title: 'Build the Positioning',
    advice: "If you can't answer these clearly, don't scale the marketing yet.",
    insight: 'Who is it for? What problem? Why you instead?',
    required: ['who_for', 'what_problem', 'why_you'],
    fields: [
      { key: 'who_for', label: 'Who is it for?', placeholder: 'Specific ICP, not “everyone”', type: 'textarea' },
      { key: 'what_problem', label: 'What problem do you solve?', placeholder: 'One sentence', type: 'textarea' },
      { key: 'why_you', label: 'Why choose you instead?', placeholder: 'The contrast vs alternatives', type: 'textarea' },
    ],
    tools: [
      { view: 'brand-foundation', label: 'Brand Foundation' },
      { view: 'battleplan', label: 'Battle Plan' },
      { view: 'content-brief', label: 'Content Brief' },
    ],
  },
  {
    id: 6,
    key: 'offer',
    title: 'Create the Offer',
    advice: "Don't just package the product. Build the reason to buy now.",
    insight: 'Outcome · Proof · Risk reversal · Urgency.',
    required: ['outcome', 'proof'],
    fields: [
      { key: 'outcome', label: 'Outcome', placeholder: 'What they get / become', type: 'textarea' },
      { key: 'proof', label: 'Proof', placeholder: 'Case study, metric, logo, demo', type: 'textarea' },
      { key: 'risk_reversal', label: 'Risk reversal', placeholder: 'Guarantee, trial, cancel anytime', type: 'text' },
      { key: 'urgency', label: 'Urgency', placeholder: 'Why now — deadline, bonus, capacity', type: 'text' },
    ],
    tools: [
      { view: 'landing-pages', label: 'Landing Pages' },
      { view: 'conversion-boosters', label: 'Conversion Boosters' },
      { view: 'product-library', label: 'Product Library' },
      { view: 'linksell', label: 'Link-in-Bio offer' },
    ],
  },
  {
    id: 7,
    key: 'channels',
    title: 'Choose 2–3 Acquisition Channels',
    advice: "Don't launch on 7 platforms because everyone else does.",
    insight: 'Depth beats scattered distribution. Pick where attention already is.',
    required: ['channels'],
    fields: [
      { key: 'channels', label: 'Primary channels (pick 2–3)', placeholder: 'SEO, LinkedIn, Email', type: 'chips',
        options: ['SEO', 'LinkedIn', 'YouTube', 'Email', 'Paid Search', 'Paid Social', 'WhatsApp', 'Partnerships'] },
      { key: 'why_channels', label: 'Why these channels', placeholder: 'Where this ICP already pays attention', type: 'textarea' },
    ],
    tools: [
      { view: 'campaign-composer', label: 'Campaign Composer' },
      { view: 'paid-search-social', label: 'Paid Search & Social' },
      { view: 'content', label: 'Content' },
      { view: 'social-publisher', label: 'Social Publisher' },
    ],
  },
  {
    id: 8,
    key: 'conversion',
    title: 'Build the Conversion Path',
    advice: 'Every step should have one clear job.',
    insight: 'Content → CTA → Landing page → Offer → Purchase.',
    required: ['path_notes'],
    fields: [
      { key: 'content_job', label: 'Content job', placeholder: 'Attract / educate / prove', type: 'text' },
      { key: 'cta', label: 'Primary CTA', placeholder: 'e.g. Book a demo / Start trial', type: 'text' },
      { key: 'landing', label: 'Landing page', placeholder: 'URL or page name', type: 'text' },
      { key: 'path_notes', label: 'Path notes', placeholder: 'What happens after the click through to purchase', type: 'textarea' },
    ],
    tools: [
      { view: 'landing-pages', label: 'Landing Pages' },
      { view: 'journey-builder', label: 'Journey Builder' },
      { view: 'funnel-analytics', label: 'Funnel Analytics' },
      { view: 'bookings', label: 'Bookings' },
    ],
  },
  {
    id: 9,
    key: 'metrics',
    title: 'Set the Numbers',
    advice: 'Define your targets before launching.',
    insight: 'Example: 10,000 visitors → 500 leads → 50 customers.',
    required: ['visitors', 'leads', 'customers_target'],
    fields: [
      { key: 'visitors', label: 'Visitor target', placeholder: 'e.g. 10,000', type: 'text' },
      { key: 'leads', label: 'Lead target', placeholder: 'e.g. 500', type: 'text' },
      { key: 'customers_target', label: 'Customer target', placeholder: 'e.g. 50', type: 'text' },
      { key: 'notes', label: 'Assumptions', placeholder: 'CVR, CAC, payback window', type: 'textarea' },
    ],
    tools: [
      { view: 'funnel-analytics', label: 'Funnel Analytics' },
      { view: 'kpi-tracker', label: 'KPI Tracker' },
      { view: 'canonical-metrics', label: 'Metrics SSOT' },
      { view: 'budget', label: 'Budget Hub' },
    ],
  },
  {
    id: 10,
    key: 'optimization',
    title: 'Create the Testing Loop',
    advice: "Don't make a plan and disappear for 90 days. Review every 2–4 weeks.",
    insight: 'What worked? What didn’t? Why? What gets more budget?',
    required: ['cadence'],
    fields: [
      { key: 'cadence', label: 'Review cadence', placeholder: 'e.g. every 2 weeks', type: 'text' },
      { key: 'what_worked', label: 'What worked', placeholder: 'Filled on each review', type: 'textarea' },
      { key: 'what_didnt', label: "What didn't", placeholder: 'Filled on each review', type: 'textarea' },
      { key: 'budget_shift', label: 'What gets more budget', placeholder: 'Next allocation decision', type: 'textarea' },
    ],
    tools: [
      { view: 'ab-designer', label: 'A/B Designer' },
      { view: 'optimizer', label: 'AI Optimizer' },
      { view: 'weekly-report', label: 'Weekly Report' },
      { view: 'flywheel', label: 'Flywheel' },
    ],
  },
];

const FLOW = STEPS.map((s) => s.title.replace(/^(Define the |Find the |Map the |Build the |Create the |Choose |Set the )/, '').split(' ')[0]);

function emptySteps() {
  const out = {};
  for (const s of STEPS) {
    out[String(s.id)] = { completed: false, fields: {} };
  }
  return out;
}

function emptyPlan() {
  return {
    title: 'Revenue Marketing Plan',
    current_step: 1,
    steps: emptySteps(),
    updated_at: null,
  };
}

function stepComplete(stepDef, fields) {
  const f = fields || {};
  return (stepDef.required || []).every((k) => {
    const v = f[k];
    if (Array.isArray(v)) return v.filter(Boolean).length > 0;
    return String(v || '').trim().length > 0;
  });
}

function summarize(plan) {
  const steps = plan.steps || {};
  let completed = 0;
  for (const s of STEPS) {
    if (steps[String(s.id)]?.completed || stepComplete(s, steps[String(s.id)]?.fields)) completed++;
  }
  return {
    completed,
    total: STEPS.length,
    pct: Math.round((completed / STEPS.length) * 100),
  };
}

module.exports = { STEPS, FLOW, emptyPlan, emptySteps, stepComplete, summarize };

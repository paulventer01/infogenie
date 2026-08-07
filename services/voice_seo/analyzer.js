// Voice search readiness — conversational queries, speakable schema, answer length.

function _grade(score) {
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

function _check(id, label, status, weight, message, fix) {
  const earned = status === 'pass' ? weight : status === 'warn' ? Math.round(weight * 0.5) : 0;
  return { id, label, status, weight, earned, message, fix };
}

function analyzeVoiceSeo(geoResult) {
  const checks = geoResult.checks || [];
  const summary = geoResult.summary || {};
  const qHeadings = summary.qHeadings || 0;

  const lead = checks.find((c) => c.id === 'lead_answer');
  const schema = checks.find((c) => c.id === 'schema');
  const concise = checks.find((c) => c.id === 'concise_paras');
  const eeat = checks.find((c) => c.id === 'eeat');
  const meta = checks.find((c) => c.id === 'meta_desc');

  const signals = [];

  const conversational = qHeadings >= 2;
  signals.push(_check(
    'conversational_queries',
    'Conversational query headings',
    conversational ? 'pass' : qHeadings >= 1 ? 'warn' : 'fail',
    22,
    conversational ? `${qHeadings} natural-language question headings.` : 'Few voice-style questions.',
    'Phrase H2s as spoken questions: "What is…", "How do I…", "Near me" variants for local.',
  ));

  const answerLenOk = lead?.status === 'pass' || concise?.status === 'pass';
  signals.push(_check(
    'answer_length',
    'Speakable answer length (≈29 words)',
    answerLenOk ? 'pass' : 'warn',
    20,
    answerLenOk ? 'Lead paragraphs are concise enough for voice readouts.' : 'Answers may be too long for voice.',
    'Keep the first answer block under ~29 words — voice assistants read the shortest direct answer.',
  ));

  signals.push(_check(
    'speakable_schema',
    'Speakable / FAQ schema',
    schema?.status === 'pass' ? 'pass' : schema?.status === 'warn' ? 'warn' : 'fail',
    18,
    schema?.message || 'Schema status unknown.',
    'Add FAQPage or speakable structured data; pair with Schema Generator.',
  ));

  signals.push(_check(
    'local_voice',
    'Local "near me" signals',
    meta?.status === 'pass' && eeat?.status !== 'fail' ? 'pass' : 'warn',
    15,
    'Meta + trust signals support local voice queries.',
    'For local businesses: NAP consistency, Local SEO module, and location pages with FAQ blocks.',
  ));

  signals.push(_check(
    'featured_overlap',
    'Featured snippet overlap',
    lead?.status === 'pass' && qHeadings >= 2 ? 'pass' : 'warn',
    15,
    'Voice results often mirror featured snippets and PAA.',
    'Align with Zero-Click Hub fixes — voice and snippet optimization overlap heavily.',
  ));

  signals.push(_check(
    'mobile_friendly',
    'Mobile-readable structure',
    concise?.status !== 'fail' ? 'pass' : 'warn',
    10,
    'Short paragraphs suit mobile voice and screen readers.',
    'Break long blocks into 2–3 sentence paragraphs with clear subheadings.',
  ));

  const weight = signals.reduce((s, c) => s + c.weight, 0);
  const earned = signals.reduce((s, c) => s + c.earned, 0);
  const score = weight ? Math.round((earned / weight) * 100) : 0;

  const fixes = signals.filter((c) => c.status !== 'pass').map((c) => ({
    id: c.id, label: c.label, status: c.status, fix: c.fix,
  }));

  return {
    score,
    grade: _grade(score),
    signals,
    fixes,
    priority: fixes[0] ? `Voice priority: ${fixes[0].label}` : 'Voice-ready — test with branded conversational queries.',
    url: geoResult.url,
    summary: geoResult.summary,
  };
}

module.exports = { analyzeVoiceSeo };

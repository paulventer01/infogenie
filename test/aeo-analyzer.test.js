// test/aeo-analyzer.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildAeoReport, PILLARS } = require('../services/aeo/analyzer');

describe('AEO analyzer', () => {
  it('defines four pillars', () => {
    assert.equal(PILLARS.length, 4);
    assert.ok(PILLARS.find((p) => p.id === 'structure'));
    assert.ok(PILLARS.find((p) => p.id === 'direct_answers'));
    assert.ok(PILLARS.find((p) => p.id === 'authority'));
    assert.ok(PILLARS.find((p) => p.id === 'ai_formatting'));
  });

  it('groups geo checks into pillar scores', () => {
    const geo = {
      url: 'https://example.com',
      score: 72,
      checks: [
        { id: 'q_headings', label: 'Q headings', status: 'pass', weight: 12, earned: 12, message: 'ok' },
        { id: 'schema', label: 'Schema', status: 'fail', weight: 12, earned: 0, message: 'missing', fix: 'Add FAQPage' },
        { id: 'eeat', label: 'E-E-A-T', status: 'warn', weight: 10, earned: 5, message: 'partial' },
      ],
      summary: {},
    };
    const report = buildAeoReport(geo);
    assert.ok(report.score >= 0 && report.score <= 100);
    assert.equal(report.pillars.length, 4);
    assert.ok(report.fixes.length >= 1);
    assert.ok(report.priority.includes('Strengthen'));
  });
});

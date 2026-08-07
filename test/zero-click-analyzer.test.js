// test/zero-click-analyzer.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SIGNALS, analyzeZeroClick } = require('../services/zero_click/analyzer');

describe('Zero-click analyzer', () => {
  it('defines six SERP visibility signals', () => {
    assert.equal(SIGNALS.length, 6);
    assert.ok(SIGNALS.find((s) => s.id === 'featured_snippet'));
    assert.ok(SIGNALS.find((s) => s.id === 'ai_overview'));
  });

  it('scores geo checks into zero-click report', () => {
    const geo = {
      url: 'https://example.com/faq',
      checks: [
        { id: 'lead_answer', label: 'Lead answer', status: 'pass', weight: 12, earned: 12, message: 'ok' },
        { id: 'concise_paras', label: 'Concise', status: 'pass', weight: 10, earned: 10, message: 'ok' },
        { id: 'schema', label: 'Schema', status: 'pass', weight: 12, earned: 12, message: 'ok' },
        { id: 'q_headings', label: 'Q headings', status: 'pass', weight: 12, earned: 12, message: 'ok' },
      ],
      summary: { words: 800, qHeadings: 4, schemaBlocks: 2 },
    };
    const report = analyzeZeroClick(geo);
    assert.ok(report.score >= 0 && report.score <= 100);
    assert.ok(report.signals.length === 6);
    assert.ok(report.clicklessImpressionPct >= 0);
    assert.equal(report.url, geo.url);
    assert.ok(report.aeoScore >= 0);
  });

  it('surfaces fixes when signals fail', () => {
    const geo = {
      url: 'https://example.com/thin',
      checks: [
        { id: 'lead_answer', label: 'Lead answer', status: 'fail', weight: 12, earned: 0, message: 'missing', fix: 'Add lead answer' },
        { id: 'schema', label: 'Schema', status: 'fail', weight: 12, earned: 0, message: 'missing', fix: 'Add FAQ schema' },
      ],
      summary: { words: 200, qHeadings: 0, schemaBlocks: 0 },
    };
    const report = analyzeZeroClick(geo);
    assert.ok(report.fixes.length >= 1);
    assert.ok(report.priority.includes('Fix'));
  });
});

// test/lead-intelligence.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseAttribution } = require('../services/lead_intelligence/attribution');

describe('lead intelligence attribution', () => {
  it('parses UTM and gclid from page URL', () => {
    const a = parseAttribution('https://example.com/landing?utm_source=google&utm_campaign=brand&gclid=xyz');
    assert.equal(a.utm_source, 'google');
    assert.equal(a.utm_campaign, 'brand');
    assert.equal(a.gclid, 'xyz');
    assert.equal(a.platform, 'google');
  });

  it('detects meta from fbclid', () => {
    const a = parseAttribution('https://example.com/?fbclid=abc');
    assert.equal(a.platform, 'meta');
  });
});

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../services/serp_tracker/api');
const { appendAutoUtm, buildEmailUtm } = require('../services/email_ops/auto_utm');
const replies = require('../services/email_replies/api');

const { _normCountry, _normCompetitors, _ctr, _bucket } = api;

describe('serp-tracker country normalisation', () => {
  it('keeps global intact (not truncated to globa)', () => {
    assert.equal(_normCountry('global'), 'global');
    assert.equal(_normCountry('GLOBAL'), 'global');
  });

  it('heals the legacy slice(0,5) truncation', () => {
    assert.equal(_normCountry('globa'), 'global');
  });

  it('accepts mauritius', () => {
    assert.equal(_normCountry('mu'), 'mu');
  });

  it('accepts iso country codes from the Track form', () => {
    assert.equal(_normCountry('us'), 'us');
    assert.equal(_normCountry('gb'), 'gb');
    assert.equal(_normCountry('za'), 'za');
    assert.equal(_normCountry('ae'), 'ae');
  });

  it('falls back to us for unknown codes', () => {
    assert.equal(_normCountry('xx'), 'us');
    assert.equal(_normCountry(''), 'us');
    assert.equal(_normCountry(null), 'us');
  });
});

describe('serp-tracker competitive helpers', () => {
  it('normalises competitor domains', () => {
    assert.deepEqual(
      _normCompetitors(['https://www.Foo.com/x', 'foo.com', 'Bar.io', '']),
      ['foo.com', 'bar.io']
    );
  });

  it('CTR curve is descending', () => {
    assert.ok(_ctr(1) > _ctr(2));
    assert.ok(_ctr(3) > _ctr(10));
    assert.equal(_ctr(null), 0);
  });

  it('buckets positions', () => {
    assert.equal(_bucket(1), '1-3');
    assert.equal(_bucket(7), '4-10');
    assert.equal(_bucket(15), '11-20');
    assert.equal(_bucket(null), 'unranked');
  });
});

describe('auto-utm', () => {
  it('appends utm params to http links', () => {
    const html = '<a href="https://example.com/pricing">Go</a>';
    const out = appendAutoUtm(html, buildEmailUtm({ channel: 'drip', campaignName: 'Welcome Seq', stepLabel: 'day-0' }));
    assert.match(out, /utm_source=infogenie/);
    assert.match(out, /utm_medium=email/);
    assert.match(out, /utm_campaign=welcome-seq/);
    assert.match(out, /utm_content=day-0/);
  });

  it('skips unsubscribe links', () => {
    const html = '<a href="https://app.example.com/api/drips/unsubscribe?email=a@b.com">Unsub</a>';
    const out = appendAutoUtm(html, buildEmailUtm({ campaignName: 'x' }));
    assert.equal(out, html);
  });
});

describe('email replies helpers', () => {
  it('extracts email from angle-bracket form', () => {
    assert.equal(replies._extractEmail('Ada <ada@example.com>'), 'ada@example.com');
    assert.equal(replies._extractEmail('bob@example.com'), 'bob@example.com');
  });
});

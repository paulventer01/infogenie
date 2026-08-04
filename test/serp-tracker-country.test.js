'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../services/serp_tracker/api');

const { _normCountry } = api;

describe('serp-tracker country normalisation', () => {
  it('keeps global intact (not truncated to globa)', () => {
    assert.equal(_normCountry('global'), 'global');
    assert.equal(_normCountry('GLOBAL'), 'global');
  });

  it('heals the legacy slice(0,5) truncation', () => {
    assert.equal(_normCountry('globa'), 'global');
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

  it('old slice(0,5) would have broken global', () => {
    assert.equal(String('global').toLowerCase().slice(0, 5), 'globa');
  });
});

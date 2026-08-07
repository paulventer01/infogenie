'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('model-compare key resolution helpers', () => {
  it('exports _resolveKey and _providerAvailable', () => {
    const api = require('../services/model_compare/api');
    assert.equal(typeof api._resolveKey, 'function');
    assert.equal(typeof api._providerAvailable, 'function');
  });

  it('marks moonshot available when MOONSHOT_API_KEY is set', () => {
    const prev = process.env.MOONSHOT_API_KEY;
    process.env.MOONSHOT_API_KEY = 'sk-test-not-dummy';
    try {
      // Re-require fresh? module already cached — call with meta
      const api = require('../services/model_compare/api');
      assert.equal(
        api._providerAvailable({
          provider: 'moonshot',
          keys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
        }),
        true,
      );
    } finally {
      if (prev == null) delete process.env.MOONSHOT_API_KEY;
      else process.env.MOONSHOT_API_KEY = prev;
    }
  });

  it('rejects dummy keys', () => {
    const api = require('../services/model_compare/api');
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '_DUMMY_GEMINI';
    try {
      assert.equal(
        api._providerAvailable({ provider: 'google', keys: ['GEMINI_API_KEY'] }),
        false,
      );
    } finally {
      if (prev == null) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});

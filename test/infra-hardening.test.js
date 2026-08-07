// test/infra-hardening.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('infra hardening', () => {
  it('retry succeeds after transient failures', async () => {
    const { withRetry } = require('../services/infra/retry');
    let n = 0;
    const out = await withRetry(async () => {
      n += 1;
      if (n < 3) {
        const e = new Error('timeout');
        e.status = 503;
        throw e;
      }
      return 'ok';
    }, { retries: 3, minDelayMs: 1, maxDelayMs: 5 });
    assert.equal(out, 'ok');
    assert.equal(n, 3);
  });

  it('circuit breaker opens after threshold failures', async () => {
    const { createCircuitBreaker } = require('../services/infra/circuit_breaker');
    const b = createCircuitBreaker('test-cb', { failureThreshold: 2, openMs: 60_000 });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => b.exec(async () => { throw new Error('boom'); }));
    }
    await assert.rejects(() => b.exec(async () => 'never'), /circuit_open/);
    const snap = b.snapshot();
    assert.equal(snap.state, 'open');
  });

  it('prod defaults enforce on in production', () => {
    const prev = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.PERMISSION_ENFORCEMENT;
      delete process.env.MULTITENANT_ENFORCEMENT;
      delete process.env.SECURITY_CSRF;
      // Re-require fresh — modules read env dynamically via functions
      delete require.cache[require.resolve('../services/security/prod_defaults')];
      const d = require('../services/security/prod_defaults');
      assert.equal(d.permissionMode(), 'on');
      assert.equal(d.multitenantMode(), 'on');
      assert.equal(d.csrfMode(), 'on');
    } finally {
      process.env.NODE_ENV = prev.NODE_ENV;
      if (prev.PERMISSION_ENFORCEMENT != null) process.env.PERMISSION_ENFORCEMENT = prev.PERMISSION_ENFORCEMENT;
      else delete process.env.PERMISSION_ENFORCEMENT;
      if (prev.MULTITENANT_ENFORCEMENT != null) process.env.MULTITENANT_ENFORCEMENT = prev.MULTITENANT_ENFORCEMENT;
      else delete process.env.MULTITENANT_ENFORCEMENT;
      if (prev.SECURITY_CSRF != null) process.env.SECURITY_CSRF = prev.SECURITY_CSRF;
      else delete process.env.SECURITY_CSRF;
    }
  });

  it('object storage falls back to local without S3', async () => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    const { putObject, s3Configured } = require('../services/infra/object_storage');
    assert.equal(s3Configured(), false);
    const url = await putObject(`_test/hardening-${Date.now()}.txt`, 'hello', { contentType: 'text/plain' });
    assert.match(url, /^\/uploads\/_test\//);
  });

  it('aeo-style health router exports', () => {
    const router = require('../services/health/api');
    assert.ok(router);
  });
});

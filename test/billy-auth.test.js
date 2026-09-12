'use strict';

/**
 * Billy auth / credentials / permission slice.
 * Does not hit api.x.ai. Does not lower matrix or guardrail bars.
 */

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tokenGate = require('../services/security/billy_token');
const matrix = require('../services/tenants/permission_matrix');
const platformKeys = require('../services/credentials/platform_keys');

const savedEnv = {
  INFOGENIE_API_TOKEN: process.env.INFOGENIE_API_TOKEN,
  INFOGENIE_API_KEY: process.env.INFOGENIE_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};

function restoreEnv() {
  if (savedEnv.INFOGENIE_API_TOKEN === undefined) delete process.env.INFOGENIE_API_TOKEN;
  else process.env.INFOGENIE_API_TOKEN = savedEnv.INFOGENIE_API_TOKEN;
  if (savedEnv.INFOGENIE_API_KEY === undefined) delete process.env.INFOGENIE_API_KEY;
  else process.env.INFOGENIE_API_KEY = savedEnv.INFOGENIE_API_KEY;
  if (savedEnv.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedEnv.NODE_ENV;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function runGate(req) {
  const res = mockRes();
  let nextCalled = false;
  tokenGate(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

beforeEach(() => {
  restoreEnv();
  delete process.env.INFOGENIE_API_TOKEN;
  if (typeof tokenGate._resetDevOpenWarned === 'function') tokenGate._resetDevOpenWarned();
});

after(() => {
  restoreEnv();
});

test('token set + missing Bearer → 401, next() not called', () => {
  process.env.INFOGENIE_API_TOKEN = 'billy-secret-token';
  const { res, nextCalled } = runGate({ headers: {} });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'unauthorized');
});

test('token set + wrong Bearer → 401', () => {
  process.env.INFOGENIE_API_TOKEN = 'billy-secret-token';
  const { res, nextCalled } = runGate({
    headers: { authorization: 'Bearer wrong-token-value' },
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'unauthorized');
});

test('token set + correct Bearer → next()', () => {
  process.env.INFOGENIE_API_TOKEN = 'billy-secret-token';
  const { res, nextCalled } = runGate({
    headers: { authorization: 'Bearer billy-secret-token' },
  });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('token unset + NODE_ENV=production → 401', () => {
  delete process.env.INFOGENIE_API_TOKEN;
  process.env.NODE_ENV = 'production';
  const { res, nextCalled } = runGate({ headers: {} });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'token_required');
});

test('token unset + non-production → allowed', () => {
  delete process.env.INFOGENIE_API_TOKEN;
  process.env.NODE_ENV = 'test';
  const { res, nextCalled } = runGate({ headers: {} });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('INFOGENIE_API_KEY does not satisfy the /v1/billy token gate', () => {
  process.env.INFOGENIE_API_TOKEN = 'billy-secret-token';
  process.env.INFOGENIE_API_KEY = 'platform-api-key';
  const wrong = runGate({
    headers: { authorization: 'Bearer platform-api-key' },
  });
  assert.equal(wrong.nextCalled, false);
  assert.equal(wrong.res.statusCode, 401);

  const ok = runGate({
    headers: { authorization: 'Bearer billy-secret-token' },
  });
  assert.equal(ok.nextCalled, true);
});

test('client-supplied userId is not used for auth', () => {
  process.env.INFOGENIE_API_TOKEN = 'billy-secret-token';
  const missing = runGate({
    headers: {},
    body: { userId: 'admin', message: 'hi' },
    query: { userId: 'admin' },
  });
  assert.equal(missing.nextCalled, false);
  assert.equal(missing.res.statusCode, 401);

  const wrong = runGate({
    headers: { authorization: 'Bearer not-the-token' },
    body: { userId: 'owner-1' },
  });
  assert.equal(wrong.nextCalled, false);
  assert.equal(wrong.res.statusCode, 401);

  delete process.env.INFOGENIE_API_TOKEN;
  process.env.NODE_ENV = 'production';
  const prod = runGate({
    headers: {},
    body: { userId: 'anyone' },
  });
  assert.equal(prod.nextCalled, false);
  assert.equal(prod.res.statusCode, 401);
});

test('timing-safe path still used (safeEqualString, no === on tokens)', () => {
  const src = fs.readFileSync(
    require.resolve('../services/security/billy_token'),
    'utf8',
  );
  assert.match(src, /require\(['"]\.\/secrets['"]\)/);
  assert.match(src, /safeEqualString\s*\(/);
  assert.doesNotMatch(src, /presentedBearer\([^)]*\)\s*===/);
  assert.doesNotMatch(src, /expectedToken\(\)\s*===/);
  assert.doesNotMatch(src, /INFOGENIE_API_TOKEN[^;\n]*===/);
  assert.match(src, /INFOGENIE_API_TOKEN unset/);
  assert.doesNotMatch(src, /console\.(log|info|warn|error)\([^)]*(?:presentedBearer|expectedToken)/);
  assert.doesNotMatch(src, /console\.(log|info|warn|error)\(`[^`]*\$\{/);
});

test('/api/billy is mapped to dashboard.view in the matrix', () => {
  const read = matrix.requiredPermissionForRequest('/api/billy/chat', 'GET');
  assert.equal(read.matched, true);
  assert.equal(read.permission, 'dashboard.view');
  const write = matrix.requiredPermissionForRequest('/api/billy/chat', 'POST');
  assert.equal(write.matched, true);
  assert.equal(write.permission, 'dashboard.view');
  const stream = matrix.requiredPermissionForRequest('/api/billy/chat/stream', 'POST');
  assert.equal(stream.matched, true);
  assert.equal(stream.permission, 'dashboard.view');
});

test('XAI_API_KEY stays on the platform plane and is not tenant-settings writable', () => {
  const entry = platformKeys.REGISTRY.find((e) => e.key === 'XAI_API_KEY');
  assert.ok(entry, 'XAI_API_KEY is registered');
  assert.equal(entry.secret, true);
  assert.ok((entry.settingsIds || []).includes('xai'));
  assert.ok((entry.settingsIds || []).includes('grok'));
  assert.equal(platformKeys.isPlatformKeyName('xai'), true);
  assert.equal(platformKeys.isPlatformKeyName('grok'), true);
  assert.equal(platformKeys.isPlatformKeyName('XAI'), true);
});

test('GET /health is not coupled to services/billy/api', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(
    serverSrc,
    /app\.get\(\s*['"]\/health['"]\s*,\s*require\(['"]\.\/services\/billy\/api['"]\)/,
  );
  assert.match(serverSrc, /app\.get\(\s*['"]\/health['"]/);
  assert.match(serverSrc, /status:\s*['"]alive['"]/);
  assert.match(serverSrc, /require\(['"]\.\/services\/security\/billy_token['"]\)/);

  const billyApi = fs.readFileSync(
    path.join(__dirname, '..', 'services/billy/api.js'),
    'utf8',
  );
  assert.doesNotMatch(billyApi, /sendLiveness/);
});

test('in-memory thread map is process-local; userId is forwarded not used as tenant auth', () => {
  const billySrc = fs.readFileSync(
    path.join(__dirname, '..', 'services/ai/billy.js'),
    'utf8',
  );
  assert.match(billySrc, /const threadById = new Map\(\)/);
  assert.doesNotMatch(billySrc, /allowFallback/);
  assert.doesNotMatch(billySrc, /resolveTenantId/);

  const apiSrc = fs.readFileSync(
    path.join(__dirname, '..', 'services/billy/api.js'),
    'utf8',
  );
  assert.doesNotMatch(apiSrc, /allowFallback/);
  assert.match(apiSrc, /userId:\s*body\.userId/);
  assert.doesNotMatch(apiSrc, /req\.user\s*=\s*body\.userId/);
  assert.doesNotMatch(apiSrc, /req\.tenant/);
});

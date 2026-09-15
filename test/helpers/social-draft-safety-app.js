'use strict';

const express = require('express');

const PROHIBITED = 'guaranteed 100% returns with zero risk';
const SAFE_TEXT = 'Schedule a demo to learn how our platform helps marketing teams.';
const LEGACY_CAPTION_LIMIT = 10_000;
const LEGACY_ALT_LIMIT = 2_000;

function captionWithProhibitedSuffix() {
  return `${'x'.repeat(LEGACY_CAPTION_LIMIT + 1)}${PROHIBITED}`;
}

function altWithProhibitedSuffix() {
  return `${'a'.repeat(LEGACY_ALT_LIMIT + 1)}${PROHIBITED}`;
}

const db = require('../../db');
db.hasDb = () => false;

const tenantCtx = require('../../services/tenants/context');
tenantCtx.resolveTenantId = async (req) => {
  const h = req?.headers?.['x-test-tid'] || req?.headers?.['x-test-tenant'];
  return h ? parseInt(h, 10) : 11;
};

function mountApp() {
  delete require.cache[require.resolve('../../services/social_drafts/api')];
  const draftsRouter = require('../../services/social_drafts/api');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const tid = Number(req.headers['x-test-tid'] || req.headers['x-test-tenant'] || 11);
    req.user = { id: 3, email: 'safety@test.local' };
    req.tenant = { id: tid, name: 'Test', slug: 'test', status: 'active' };
    next();
  });
  app.use('/api/social-drafts', draftsRouter);
  return { app, draftsRouter };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function jsonFetch(server, method, path, { tid = 11, body, headers = {} } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-tid': String(tid), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

module.exports = {
  PROHIBITED,
  SAFE_TEXT,
  captionWithProhibitedSuffix,
  altWithProhibitedSuffix,
  mountApp,
  listen,
  jsonFetch,
};

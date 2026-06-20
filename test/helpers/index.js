// test/helpers/index.js — Single entry point for the integration test harness.
//
//   const harness = require('./helpers');           // from test/integration/*
//   const { bootApp, request, makeFixtures, installMailCapture } = harness;
//
// Requiring this module first runs ./env, which sets the test
// CREDENTIAL_ENCRYPTION_KEY / SESSION_SECRET before any vault or session code is
// loaded. See test/helpers/README.md for the full guide.

require('./env');

const { bootApp, buildApp } = require('./app');
const { request, sessionCookie } = require('./request');
const { makeFixtures, uniqueSuffix } = require('./fixtures');
const { installMailCapture, tokenFromText } = require('./mail');
const _db = require('../../db');

// Mirror db.hasDb() so suites can skip cleanly when DATABASE_URL is absent.
function hasDb() { return _db.hasDb(); }

// Convenience: POST /api/auth/login and return { cookie, status, json }. The
// returned cookie is ready to pass as request(..., { cookie }).
async function login(baseUrl, email, password) {
  const res = await request(baseUrl, 'POST', '/api/auth/login', { body: { email, password } });
  return { cookie: sessionCookie(res.cookies), status: res.status, json: res.json };
}

module.exports = {
  bootApp,
  buildApp,
  request,
  sessionCookie,
  login,
  makeFixtures,
  uniqueSuffix,
  installMailCapture,
  tokenFromText,
  hasDb,
};

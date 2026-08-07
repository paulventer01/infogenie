'use strict';

/**
 * Canonical synthetic journeys for Checkly / Better Stack.
 * External monitors should hit PUBLIC_BASE_URL (or CHECKLY_BASE_URL).
 */

const CHECK_DEFS = [
  {
    id: 'api-health',
    name: 'API health',
    method: 'GET',
    path: '/api/health',
    expectStatus: [200],
    expectBodyIncludes: ['ok'],
    critical: true,
  },
  {
    id: 'api-ready',
    name: 'API ready',
    method: 'GET',
    path: '/api/ready',
    expectStatus: [200],
    expectBodyIncludes: ['ok'],
    critical: true,
  },
  {
    id: 'login-page',
    name: 'Login page',
    method: 'GET',
    path: '/login',
    expectStatus: [200, 307, 308],
    critical: true,
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    method: 'GET',
    path: '/dashboard',
    expectStatus: [200, 307, 308],
    critical: true,
  },
  {
    id: 'ai-team',
    name: 'AI Team',
    method: 'GET',
    path: '/ai-team/ai-team',
    expectStatus: [200, 307, 308],
    critical: true,
  },
  {
    id: 'reports',
    name: 'Reports surface',
    method: 'GET',
    path: '/grow/weekly-report',
    expectStatus: [200, 307, 308],
    critical: false,
  },
];

function publicBaseUrl() {
  return (
    process.env.CHECKLY_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.BETTERSTACK_BASE_URL ||
    null
  );
}

module.exports = { CHECK_DEFS, publicBaseUrl };

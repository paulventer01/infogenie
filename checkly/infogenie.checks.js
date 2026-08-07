/**
 * Checkly check-as-code definitions for InfoGenie.
 * Deploy with Checkly CLI when CHECKLY_API_KEY is available:
 *   npx checkly deploy
 *
 * Env:
 *   CHECKLY_BASE_URL / PUBLIC_BASE_URL — production or preview origin
 */

const base = process.env.CHECKLY_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://example.com';

const journeys = [
  { name: 'API health', path: '/api/health', type: 'api' },
  { name: 'API ready', path: '/api/ready', type: 'api' },
  { name: 'Login', path: '/login', type: 'browser' },
  { name: 'Dashboard', path: '/dashboard', type: 'browser' },
  { name: 'AI Team', path: '/ai-team/ai-team', type: 'browser' },
  { name: 'Reports', path: '/grow/weekly-report', type: 'browser' },
];

module.exports = {
  base,
  journeys,
  /** Lightweight runner used by `node checkly/infogenie.checks.js` smoke */
  async smoke() {
    const http = require('http');
    const https = require('https');
    const { URL } = require('url');
    const results = [];
    for (const j of journeys) {
      const url = base.replace(/\/$/, '') + j.path;
      // eslint-disable-next-line no-await-in-loop
      const r = await new Promise((resolve) => {
        let parsed;
        try { parsed = new URL(url); } catch (e) {
          return resolve({ name: j.name, ok: false, error: e.message });
        }
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(parsed, { method: 'GET', timeout: 8000 }, (res) => {
          res.resume();
          resolve({ name: j.name, ok: res.statusCode < 500, status: res.statusCode });
        });
        req.on('error', (e) => resolve({ name: j.name, ok: false, error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ name: j.name, ok: false, error: 'timeout' }); });
        req.end();
      });
      results.push(r);
    }
    return results;
  },
};

if (require.main === module) {
  module.exports.smoke().then((r) => {
    console.log(JSON.stringify({ base, results: r }, null, 2));
    process.exit(r.every((x) => x.ok) ? 0 : 1);
  });
}

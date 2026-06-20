// test/helpers/request.js — One HTTP call → { status, headers, json, text }.
//
// Replaces the hand-rolled `http.request` blocks duplicated across every
// existing test. A single function issues a request to the harness app and
// returns the parsed result, with first-class support for the two auth modes
// the waves need:
//   • API-key auth   — opts.apiKey (true → use process.env.INFOGENIE_API_KEY,
//                       or pass an explicit key string). Sent as
//                       `Authorization: Bearer <key>`.
//   • Cookie session — opts.cookie ('infogenie.sid=…' from login()).

const http = require('node:http');

// Issue a request. `base` is the harness baseUrl (http://127.0.0.1:<port>).
// Returns { status, headers, json, text, cookies } where `json` is null when
// the body isn't JSON and `cookies` is the raw set-cookie array (if any).
function request(base, method, path, opts = {}) {
  const { body, headers = {}, apiKey, cookie } = opts;
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    let data = null;
    if (body !== undefined && body !== null) {
      data = typeof body === 'string' ? body : JSON.stringify(body);
      if (!h['content-type'] && !h['Content-Type']) h['content-type'] = 'application/json';
      h['content-length'] = Buffer.byteLength(data);
    }
    if (apiKey) {
      const key = typeof apiKey === 'string' ? apiKey : process.env.INFOGENIE_API_KEY;
      if (key) h['authorization'] = `Bearer ${key}`;
    }
    if (cookie) h['cookie'] = cookie;

    const r = http.request(base + path, { method, headers: h }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = buf ? JSON.parse(buf) : null; } catch (_) { /* non-JSON */ }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          cookies: res.headers['set-cookie'] || [],
          json,
          text: buf,
        });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Extract the infogenie.sid cookie pair ("infogenie.sid=…") from a set-cookie
// array so it can be replayed on subsequent requests as opts.cookie.
function sessionCookie(setCookieArray) {
  for (const c of setCookieArray || []) {
    const m = /^(infogenie\.sid=[^;]+)/.exec(c);
    if (m) return m[1];
  }
  return null;
}

module.exports = { request, sessionCookie };

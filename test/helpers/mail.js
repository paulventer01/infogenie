// test/helpers/mail.js — Outbound-mail interceptor for auth-lifecycle tests.
//
// The auth service (services/auth/api.js → _sendMail) delivers verification and
// password-reset emails by POSTing to https://api.resend.com/emails via the
// global fetch. In tests we must NOT send real mail (RESEND_API_KEY may be a
// live key), but auth-lifecycle tests still need to read the link/token that
// would have been emailed.
//
// installMailCapture() monkeypatches global.fetch so any call to the Resend
// send endpoint is recorded and answered with a fake 200 — no network, no real
// mail. Every other fetch is delegated to the original implementation untouched.
//
// Tokens can also be read straight out of the email_tokens table (see
// fixtures.latestEmailToken); mail capture is the complementary path that proves
// an email WAS dispatched and lets a test pull the token out of the link.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Pull the first /verify-email/:token or reset-password?token=… style token out
// of an email body. Returns null when no token-shaped string is present.
function tokenFromText(text) {
  if (!text) return null;
  const s = String(text);
  let m = s.match(/verify-email\/([a-f0-9]{64})/i);
  if (m) return m[1];
  m = s.match(/[?&]token=([a-f0-9]{64})/i);
  if (m) return m[1];
  // Fall back to any 64-char hex string (the createToken format).
  m = s.match(/\b([a-f0-9]{64})\b/i);
  return m ? m[1] : null;
}

function installMailCapture() {
  const messages = [];
  const originalFetch = global.fetch;

  global.fetch = async function patchedFetch(url, opts = {}) {
    const href = typeof url === 'string' ? url : (url && url.url) || '';
    if (href.startsWith(RESEND_ENDPOINT)) {
      let payload = {};
      try { payload = JSON.parse(opts.body || '{}'); } catch (_) { /* keep {} */ }
      const to = Array.isArray(payload.to) ? payload.to[0] : payload.to;
      messages.push({
        to,
        subject: payload.subject || '',
        html: payload.html || '',
        text: payload.text || '',
        token: tokenFromText(payload.text) || tokenFromText(payload.html),
        at: Date.now(),
      });
      // Mimic a successful Resend response shape (_sendMail calls r.json()).
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'test-message-' + messages.length }),
        text: async () => '',
      };
    }
    return originalFetch(url, opts);
  };

  return {
    messages,
    // Most-recent captured message addressed to `email` (case-insensitive).
    latestTo(email) {
      const e = String(email || '').toLowerCase();
      for (let i = messages.length - 1; i >= 0; i--) {
        if (String(messages[i].to || '').toLowerCase() === e) return messages[i];
      }
      return null;
    },
    reset() { messages.length = 0; },
    // Always call in an after()/finally so the global fetch is restored even if
    // a test throws — otherwise later suites inherit the patched fetch.
    restore() { global.fetch = originalFetch; },
  };
}

module.exports = { installMailCapture, tokenFromText, RESEND_ENDPOINT };

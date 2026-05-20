// services/auth/api.js — Platform Authentication Foundation
// Provides:
//   - DAO helpers (findUserByEmail, createUser, …)
//   - requireAuth middleware (populates req.user, returns 401 otherwise)
//   - Express router mounted at /api/auth with signup / login / logout /
//     verify-email / request-reset / reset-password / oauth start+callback /
//     me endpoints.
const express = require('express');
const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const _db     = require('../../db');

const SALT_ROUNDS    = 12;
const VERIFY_TTL_MIN = 60 * 24;     // 24h for email verification links
const RESET_TTL_MIN  = 60;          // 1h for password reset links
const SOCIAL_PROVIDERS = ['google', 'facebook', 'microsoft'];

// Email-format guard reused everywhere.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── DAO ──────────────────────────────────────────────────────────────────────
async function findUserByEmail(email) {
  if (!_db.hasDb()) return null;
  const r = await _db.getPool().query(
    'SELECT * FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1', [email]);
  return r.rows[0] || null;
}
async function findUserById(id) {
  if (!_db.hasDb() || !id) return null;
  const r = await _db.getPool().query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function countUsers() {
  if (!_db.hasDb()) return 0;
  const r = await _db.getPool().query('SELECT COUNT(*)::int AS n FROM users');
  return r.rows[0].n;
}
async function createUser({ email, password, name, emailVerified = false }) {
  const hash = password ? await bcrypt.hash(password, SALT_ROUNDS) : null;
  // Race-safe first-user-becomes-owner: hold a transactional advisory lock
  // (key = arbitrary constant 90210) so two concurrent signups can't both
  // observe "count==0" and both flip is_owner=TRUE.
  const pool = _db.getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [90210]);
    const c = await client.query('SELECT COUNT(*)::int AS n FROM users');
    const isOwner = c.rows[0].n === 0;
    const r = await client.query(`
      INSERT INTO users (email, password_hash, name, is_owner, email_verified_at)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [email.toLowerCase(), hash, name || '', isOwner, emailVerified ? new Date() : null]);
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch(_){}
    throw e;
  } finally {
    client.release();
  }
}
async function setUserPassword(userId, password) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await _db.getPool().query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, userId]);
}
async function markEmailVerified(userId) {
  await _db.getPool().query(
    'UPDATE users SET email_verified_at = now() WHERE id=$1 AND email_verified_at IS NULL',
    [userId]);
}
async function touchLastLogin(userId) {
  try { await _db.getPool().query('UPDATE users SET last_login_at=now() WHERE id=$1', [userId]); }
  catch (e) { /* non-fatal */ }
}
async function findIdentity(provider, providerUserId) {
  const r = await _db.getPool().query(
    'SELECT * FROM user_identities WHERE provider=$1 AND provider_user_id=$2 LIMIT 1',
    [provider, providerUserId]);
  return r.rows[0] || null;
}
async function linkIdentity(userId, provider, providerUserId, email) {
  await _db.getPool().query(`
    INSERT INTO user_identities (user_id, provider, provider_user_id, email)
    VALUES ($1,$2,$3,$4) ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [userId, provider, providerUserId, email || null]);
}
async function createToken(userId, purpose, ttlMin) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + ttlMin * 60_000);
  await _db.getPool().query(
    'INSERT INTO email_tokens (token,user_id,purpose,expires_at) VALUES ($1,$2,$3,$4)',
    [token, userId, purpose, exp]);
  return token;
}
async function consumeToken(token, purpose) {
  const r = await _db.getPool().query(
    `UPDATE email_tokens SET consumed_at = now()
     WHERE token=$1 AND purpose=$2 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`, [token, purpose]);
  return r.rows[0] ? r.rows[0].user_id : null;
}

// ── Public-user shape (never leak password_hash to clients) ─────────────────
function _publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name || '',
    isOwner: !!u.is_owner,
    emailVerified: !!u.email_verified_at,
    createdAt: u.created_at,
  };
}

// ── Auth middleware ─────────────────────────────────────────────────────────
// Loads req.user from the session if one is present. Does NOT 401 on its own
// — that's handled by the wider gate in server.js so unauthenticated public
// routes (e.g. /api/auth/login itself) can run.
async function loadUserFromSession(req, _res, next) {
  try {
    const uid = req.session && req.session.userId;
    if (uid) {
      const u = await findUserById(uid);
      if (u) { req.user = _publicUser(u); req.userRaw = u; }
      else   { try { req.session.destroy(()=>{}); } catch(_){} }
    }
  } catch (e) { /* never block on user lookup errors */ }
  next();
}

// Lightweight helper: callers can do `if (!requireAuthGuard(req,res)) return;`
function requireAuthGuard(req, res) {
  if (req.user) return true;
  res.status(401).json({ ok:false, error:'auth_required',
    hint:'Log in via /api/auth/login or include INFOGENIE_API_KEY.' });
  return false;
}

// ── Email sender (verification + reset) ─────────────────────────────────────
async function _sendMail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing — cannot send mail');
  const from = process.env.RESEND_FROM_EMAIL || 'InfoGenie <onboarding@resend.dev>';
  const r = await fetch('https://api.resend.com/emails', {
    method:'POST',
    headers:{ 'Authorization':`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ from, to:[to], subject, html, text }),
  });
  if (!r.ok) { const t = await r.text().catch(()=> ''); throw new Error(`Resend ${r.status}: ${t.slice(0,240)}`); }
  return r.json().catch(()=> ({}));
}
function _publicBaseUrl(req) {
  return process.env.PUBLIC_URL
      || (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : '')
      || `${req.protocol}://${req.get('host')}`;
}
function _verifyEmailTemplate(name, link) {
  const safeName = String(name || 'there').replace(/[<>&"]/g,'').slice(0,60);
  return {
    subject: 'Verify your InfoGenie email',
    text: `Hi ${safeName},\n\nClick this link to verify your InfoGenie account:\n${link}\n\nThe link expires in 24 hours.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#0066FF">Welcome to InfoGenie</h2>
      <p>Hi ${safeName}, please confirm your email address to finish setting up your account.</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#0066FF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Verify my email</a></p>
      <p style="font-size:0.78rem;color:#6B7280">Or paste this link into your browser:<br>${link}</p>
      <p style="font-size:0.74rem;color:#9CA3AF">This link expires in 24 hours. If you didn't sign up, you can ignore this email.</p>
    </div>`,
  };
}
function _resetEmailTemplate(name, link) {
  const safeName = String(name || 'there').replace(/[<>&"]/g,'').slice(0,60);
  return {
    subject: 'Reset your InfoGenie password',
    text: `Hi ${safeName},\n\nClick this link to reset your InfoGenie password:\n${link}\n\nThe link expires in 1 hour. If you didn't request a reset, ignore this email.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#0066FF">Reset your password</h2>
      <p>Hi ${safeName}, click the button below to choose a new password.</p>
      <p style="margin:24px 0"><a href="${link}" style="background:#0066FF;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">Set new password</a></p>
      <p style="font-size:0.78rem;color:#6B7280">Or paste this link into your browser:<br>${link}</p>
      <p style="font-size:0.74rem;color:#9CA3AF">This link expires in 1 hour. If you didn't ask for a reset, you can safely ignore this email — your password won't be changed.</p>
    </div>`,
  };
}

// ── OAuth provider configuration ────────────────────────────────────────────
// Each entry knows how to build the authorize URL, exchange the code for a
// token, and fetch the user profile. Returns { providerUserId, email, name }.
function _providerConfig(provider) {
  if (provider === 'google') {
    return {
      configured: !!(process.env.AUTH_GOOGLE_CLIENT_ID && process.env.AUTH_GOOGLE_CLIENT_SECRET),
      clientId: process.env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET,
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      scope: 'openid email profile',
      mapProfile: p => ({ providerUserId: p.sub, email: p.email, name: p.name || '' }),
    };
  }
  if (provider === 'facebook') {
    return {
      configured: !!(process.env.AUTH_FACEBOOK_CLIENT_ID && process.env.AUTH_FACEBOOK_CLIENT_SECRET),
      clientId: process.env.AUTH_FACEBOOK_CLIENT_ID,
      clientSecret: process.env.AUTH_FACEBOOK_CLIENT_SECRET,
      authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
      profileUrl: 'https://graph.facebook.com/me?fields=id,name,email',
      scope: 'email public_profile',
      mapProfile: p => ({ providerUserId: p.id, email: p.email, name: p.name || '' }),
    };
  }
  if (provider === 'microsoft') {
    return {
      configured: !!(process.env.AUTH_MICROSOFT_CLIENT_ID && process.env.AUTH_MICROSOFT_CLIENT_SECRET),
      clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      profileUrl: 'https://graph.microsoft.com/v1.0/me',
      scope: 'openid email profile User.Read',
      mapProfile: p => ({
        providerUserId: p.id,
        email: p.mail || p.userPrincipalName || '',
        name: p.displayName || '',
      }),
    };
  }
  return null;
}
function _redirectUri(req, provider) {
  return `${_publicBaseUrl(req)}/api/auth/oauth/${provider}/callback`;
}
async function _postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  const r = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json' },
    body,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`token-exchange ${r.status}: ${txt.slice(0,200)}`);
  try { return JSON.parse(txt); } catch { return Object.fromEntries(new URLSearchParams(txt)); }
}
async function _getJson(url, accessToken) {
  const r = await fetch(url, { headers:{ 'Authorization':`Bearer ${accessToken}`, 'Accept':'application/json' }});
  if (!r.ok) throw new Error(`profile-fetch ${r.status}`);
  return r.json();
}

// ── Router ──────────────────────────────────────────────────────────────────
const router = express.Router();

function _err(res, code, msg) { res.status(code).json({ ok:false, error: msg }); }
function _establishSession(req, user) {
  // Regenerate the session ID on every auth-boundary transition (signup,
  // login, password-reset success, OAuth callback) to defend against
  // session-fixation attacks. The pre-login session is destroyed and a
  // fresh sid is issued before we attach the user identity.
  return new Promise((resolve, reject) => {
    if (!req.session) return reject(new Error('session middleware not active'));
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.email  = user.email;
      req.session.save(err2 => err2 ? reject(err2) : resolve());
    });
  });
}

// GET /api/auth/me — who am I right now?
router.get('/me', (req, res) => {
  if (!req.user) return res.json({ ok:true, authenticated:false, user:null });
  res.json({ ok:true, authenticated:true, user: req.user });
});

// GET /api/auth/providers — which social providers are wired?
router.get('/providers', (_req, res) => {
  const out = {};
  for (const p of SOCIAL_PROVIDERS) out[p] = !!_providerConfig(p).configured;
  res.json({ ok:true, providers: out });
});

// POST /api/auth/signup — create account + send verification email
router.post('/signup', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'Database not configured.');
    const { email, password, name } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RX.test(e))             return _err(res, 400, 'Please enter a valid email address.');
    if (!password || password.length < 8) return _err(res, 400, 'Password must be at least 8 characters.');
    const existing = await findUserByEmail(e);
    if (existing) return _err(res, 409, 'An account with this email already exists. Try logging in instead.');
    const user = await createUser({ email: e, password, name });
    // Send verification email (best-effort — don't fail signup if mail provider down)
    let mailed = false, mailError = null;
    try {
      const token = await createToken(user.id, 'verify', VERIFY_TTL_MIN);
      const link = `${_publicBaseUrl(req)}/api/auth/verify-email/${token}`;
      const tpl = _verifyEmailTemplate(user.name, link);
      await _sendMail({ to: user.email, ...tpl });
      mailed = true;
    } catch (e2) {
      mailError = e2.message;
      console.warn('[auth/signup] verification email failed:', e2.message);
    }
    // Auto-log in the new account so they can use the app right away.
    await _establishSession(req, user);
    await touchLastLogin(user.id);
    res.json({ ok:true, user: _publicUser(user), verificationEmailSent: mailed, mailError });
  } catch (e) {
    console.error('[auth/signup] error:', e);
    _err(res, 500, 'Server error during signup.');
  }
});

// POST /api/auth/login — email + password
router.post('/login', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'Database not configured.');
    const { email, password } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RX.test(e)) return _err(res, 400, 'Please enter a valid email address.');
    const user = await findUserByEmail(e);
    if (!user || !user.password_hash) return _err(res, 401, 'Incorrect email or password.');
    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return _err(res, 401, 'Incorrect email or password.');
    await _establishSession(req, user);
    await touchLastLogin(user.id);
    res.json({ ok:true, user: _publicUser(user) });
  } catch (e) {
    console.error('[auth/login] error:', e);
    _err(res, 500, 'Server error during login.');
  }
});

// POST /api/auth/logout — destroy session
router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok:true });
  req.session.destroy(err => {
    if (err) return _err(res, 500, 'Could not log out.');
    res.clearCookie('infogenie.sid');
    res.json({ ok:true });
  });
});

// GET /api/auth/verify-email/:token — completes verification, then redirects to app
router.get('/verify-email/:token', async (req, res) => {
  try {
    const uid = await consumeToken(req.params.token, 'verify');
    if (!uid) return res.status(400).send(_simplePage('Verification link is invalid or has expired.', 'Try requesting a new verification email from your account menu.'));
    await markEmailVerified(uid);
    // If a session is already active on this browser, fine. Either way, send
    // them to /login? (or root) so the SPA picks them up.
    res.redirect('/?verified=1');
  } catch (e) {
    console.error('[auth/verify-email] error:', e);
    res.status(500).send(_simplePage('Server error verifying email.', e.message));
  }
});

// POST /api/auth/resend-verification — issue a new verification email for the
// currently-logged-in user.
router.post('/resend-verification', async (req, res) => {
  try {
    if (!req.user) return _err(res, 401, 'Log in first.');
    if (req.user.emailVerified) return res.json({ ok:true, alreadyVerified:true });
    const token = await createToken(req.user.id, 'verify', VERIFY_TTL_MIN);
    const link = `${_publicBaseUrl(req)}/api/auth/verify-email/${token}`;
    const tpl = _verifyEmailTemplate(req.user.name, link);
    await _sendMail({ to: req.user.email, ...tpl });
    res.json({ ok:true, sent:true });
  } catch (e) {
    console.error('[auth/resend-verification] error:', e);
    _err(res, 500, e.message || 'Could not send verification email.');
  }
});

// POST /api/auth/request-reset — sends password-reset email (always returns ok
// to avoid leaking which emails are registered)
router.post('/request-reset', async (req, res) => {
  try {
    if (!_db.hasDb()) return _err(res, 503, 'Database not configured.');
    const { email } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!EMAIL_RX.test(e)) return _err(res, 400, 'Please enter a valid email address.');
    const user = await findUserByEmail(e);
    if (user && user.password_hash) {
      try {
        const token = await createToken(user.id, 'reset', RESET_TTL_MIN);
        const link = `${_publicBaseUrl(req)}/reset-password.html?token=${token}`;
        const tpl = _resetEmailTemplate(user.name, link);
        await _sendMail({ to: user.email, ...tpl });
      } catch (e2) {
        console.warn('[auth/request-reset] mail failed:', e2.message);
      }
    }
    // Always identical response — anti-enumeration.
    res.json({ ok:true, message:'If that email is registered, a reset link is on its way.' });
  } catch (e) {
    console.error('[auth/request-reset] error:', e);
    _err(res, 500, 'Server error requesting reset.');
  }
});

// POST /api/auth/reset-password/:token — { password } body
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 8) return _err(res, 400, 'Password must be at least 8 characters.');
    const uid = await consumeToken(req.params.token, 'reset');
    if (!uid) return _err(res, 400, 'Reset link is invalid or has expired. Request a new one.');
    await setUserPassword(uid, password);
    const user = await findUserById(uid);
    await _establishSession(req, user);
    res.json({ ok:true, user: _publicUser(user) });
  } catch (e) {
    console.error('[auth/reset-password] error:', e);
    _err(res, 500, 'Server error resetting password.');
  }
});

// GET /api/auth/oauth/:provider/start — kicks off the OAuth flow
router.get('/oauth/:provider/start', (req, res) => {
  const { provider } = req.params;
  if (!SOCIAL_PROVIDERS.includes(provider)) return _err(res, 400, 'Unknown provider.');
  const cfg = _providerConfig(provider);
  if (!cfg.configured) return _err(res, 503,
    `${provider} login is not configured. Set AUTH_${provider.toUpperCase()}_CLIENT_ID + AUTH_${provider.toUpperCase()}_CLIENT_SECRET.`);
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  req.session.oauthProvider = provider;
  const params = new URLSearchParams({
    client_id:      cfg.clientId,
    redirect_uri:   _redirectUri(req, provider),
    response_type:  'code',
    scope:          cfg.scope,
    state,
    access_type:    'online',
    prompt:         'select_account',
  });
  res.redirect(`${cfg.authUrl}?${params.toString()}`);
});

// GET /api/auth/oauth/:provider/callback — handle OAuth response
router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  if (!SOCIAL_PROVIDERS.includes(provider)) return res.status(400).send(_simplePage('Unknown provider.'));
  const cfg = _providerConfig(provider);
  if (!cfg.configured) return res.status(503).send(_simplePage(`${provider} login not configured.`));
  try {
    const { code, state, error: oauthErr } = req.query;
    if (oauthErr) return res.status(400).send(_simplePage('Sign-in cancelled.', String(oauthErr)));
    if (!code) return res.status(400).send(_simplePage('Missing OAuth code.'));
    if (!state || state !== (req.session && req.session.oauthState)) {
      return res.status(400).send(_simplePage('Invalid OAuth state. Please try again.'));
    }
    delete req.session.oauthState;
    const tokenResp = await _postForm(cfg.tokenUrl, {
      code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
      redirect_uri: _redirectUri(req, provider),
      grant_type: 'authorization_code',
    });
    const accessToken = tokenResp.access_token;
    if (!accessToken) throw new Error('No access_token in provider response.');
    const profile = await _getJson(cfg.profileUrl, accessToken);
    const mapped = cfg.mapProfile(profile);
    if (!mapped.providerUserId) throw new Error('Provider returned no user id.');
    const ident = await findIdentity(provider, mapped.providerUserId);
    let user;
    if (ident) {
      user = await findUserById(ident.user_id);
    } else if (mapped.email) {
      // Link to existing email-based account if one exists, otherwise create.
      user = await findUserByEmail(mapped.email);
      if (!user) {
        user = await createUser({ email: mapped.email, password: null, name: mapped.name, emailVerified: true });
      } else if (!user.email_verified_at) {
        await markEmailVerified(user.id);
      }
      await linkIdentity(user.id, provider, mapped.providerUserId, mapped.email);
    } else {
      // No email returned and no existing identity — refuse, we need an email.
      return res.status(400).send(_simplePage('Sign-in failed.',
        `${provider} did not share an email address with InfoGenie. Try a different sign-in method.`));
    }
    await _establishSession(req, user);
    await touchLastLogin(user.id);
    res.redirect('/?social=' + encodeURIComponent(provider));
  } catch (e) {
    console.error(`[auth/oauth/${provider}] error:`, e);
    res.status(500).send(_simplePage('Sign-in failed.', e.message));
  }
});

// Tiny HTML page helper (returned to the browser tab after OAuth/verify links).
function _simplePage(title, detail) {
  const h = s => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title>
  <meta http-equiv="refresh" content="6;url=/">
  </head><body style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:80px auto;padding:24px;text-align:center">
  <h2 style="color:#0066FF">${h(title)}</h2>
  ${detail ? `<p style="color:#374151">${h(detail)}</p>` : ''}
  <p style="color:#6B7280;font-size:0.86rem">Returning to InfoGenie in a moment… <a href="/" style="color:#0066FF">Click here if not redirected.</a></p>
  </body></html>`;
}

module.exports = {
  router,
  loadUserFromSession,
  requireAuthGuard,
  // DAO + helpers (exported so other tiers can use them later)
  findUserByEmail, findUserById, createUser, countUsers,
};

// services/google_workspace/api.js
//
// Google Workspace OAuth + Gmail + Google Drive + Google Calendar
//
// Single OAuth consent grants all three sets of permissions at once.
// Scopes: gmail.readonly, gmail.send, drive.file, calendar.events, openid email
//
// Env vars (operator-level, set once per deployment):
//   GOOGLE_WORKSPACE_CLIENT_ID     — OAuth 2.0 client ID
//   GOOGLE_WORKSPACE_CLIENT_SECRET — OAuth 2.0 client secret
//
// Vault key: 'google_workspace'
// Redirects to: /?gw_connected=1&settings=integrations
//               /?gw_error=<code>&settings=integrations

'use strict';
const express = require('express');
const crypto  = require('crypto');
const _https  = require('https');
const vault   = require('../credentials/vault');

const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ');

const CALLBACK_PATH = '/api/integrations/workspace/oauth/callback';
const PLATFORM      = 'google_workspace';

function _clientCreds() {
  return {
    clientId:     process.env.GOOGLE_WORKSPACE_CLIENT_ID     || '',
    clientSecret: process.env.GOOGLE_WORKSPACE_CLIENT_SECRET || '',
  };
}

function _publicOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

function _redirectUri(req) {
  return `${_publicOrigin(req)}${CALLBACK_PATH}`;
}

function _back(res, q) {
  const p = new URLSearchParams(q || {});
  p.set('settings', 'integrations');
  return res.redirect('/?' + p.toString());
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function _postForm(hostname, path, body, headers = {}) {
  const bodyStr = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return new Promise(resolve => {
    const req = _https.request({
      hostname, path, method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: {} }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.setTimeout(15000, () => req.destroy());
    req.write(bodyStr); req.end();
  });
}

function _getJson(url, headers = {}) {
  return new Promise(resolve => {
    const u = new URL(url);
    const req = _https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers,
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: {} }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.setTimeout(15000, () => req.destroy());
    req.end();
  });
}

function _postJson(url, payload, headers = {}) {
  const bodyStr = JSON.stringify(payload);
  return new Promise(resolve => {
    const u = new URL(url);
    const req = _https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers,
      },
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: {} }); }
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.setTimeout(15000, () => req.destroy());
    req.write(bodyStr); req.end();
  });
}

function _deleteReq(url, headers = {}) {
  return new Promise(resolve => {
    const u = new URL(url);
    const req = _https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'DELETE', headers,
    }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode }));
    });
    req.on('error', () => resolve({ status: 0 }));
    req.setTimeout(10000, () => req.destroy());
    req.end();
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function _getAccessToken(userId) {
  const creds = await vault.getCredentials(userId, PLATFORM);
  if (!creds || !creds.refreshToken) throw new Error('google_workspace not connected');
  const { clientId, clientSecret } = _clientCreds();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_WORKSPACE_CLIENT_ID/SECRET not configured');
  const r = await _postForm('oauth2.googleapis.com', '/token', {
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: creds.refreshToken,
    grant_type:    'refresh_token',
  });
  if (!r.body.access_token) {
    throw new Error(`token_refresh_failed: ${r.body.error || r.status}`);
  }
  return r.body.access_token;
}

// ── 1. OAuth start ────────────────────────────────────────────────────────────
router.get('/oauth/start', (req, res) => {
  if (!req.user || !req.user.id) return _back(res, { gw_error: 'not_signed_in' });
  const { clientId } = _clientCreds();
  if (!clientId) return _back(res, { gw_error: 'operator_client_missing' });
  const state = crypto.randomBytes(24).toString('hex');
  req.session.gwOauthState  = state;
  req.session.gwOauthUserId = req.user.id;
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  _redirectUri(req),
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

// ── 2. OAuth callback ─────────────────────────────────────────────────────────
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return _back(res, { gw_error: error });
  if (!state || state !== req.session.gwOauthState) return _back(res, { gw_error: 'invalid_state' });
  const userId = req.session.gwOauthUserId;
  if (!userId) return _back(res, { gw_error: 'session_lost' });

  const { clientId, clientSecret } = _clientCreds();
  const token = await _postForm('oauth2.googleapis.com', '/token', {
    code,
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  _redirectUri(req),
    grant_type:    'authorization_code',
  });
  if (!token.body.refresh_token) {
    return _back(res, {
      gw_error:  'no_refresh_token',
      gw_detail: token.body.error || String(token.status),
    });
  }

  let email = '';
  try {
    const ui = await _getJson(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      { Authorization: `Bearer ${token.body.access_token}` }
    );
    email = ui.body.email || '';
  } catch (_) {}

  await vault.saveCredentials(userId, PLATFORM, {
    clientId, clientSecret, refreshToken: token.body.refresh_token, email,
  });
  delete req.session.gwOauthState;
  delete req.session.gwOauthUserId;
  return _back(res, { gw_connected: '1' });
});

// ── 3. Disconnect ─────────────────────────────────────────────────────────────
router.post('/disconnect', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    await vault.deleteCredentials(req.user.id, PLATFORM);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── 4. Summary (for Settings card hydration) ──────────────────────────────────
router.get('/summary', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { clientId, clientSecret } = _clientCreds();
  const operatorReady = !!(clientId && clientSecret);
  let connected = false, email = null;
  try {
    const creds = await vault.getCredentials(req.user.id, PLATFORM);
    if (creds && creds.refreshToken) { connected = true; email = creds.email || null; }
  } catch (_) {}
  res.json({ ok: true, operatorReady, connected, email });
});

// ═════════════════════════════════════════════════════════════════════════════
// GMAIL
// ═════════════════════════════════════════════════════════════════════════════

// GET /gmail/threads — list inbox threads (max 20)
router.get('/gmail/threads', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    const token = await _getAccessToken(req.user.id);
    const q          = req.query.q || 'in:inbox';
    const maxResults = Math.min(Number(req.query.max) || 20, 50);
    const list = await _getJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
      { Authorization: `Bearer ${token}` }
    );
    if (list.status !== 200) throw new Error(`gmail_list_${list.status}: ${list.body.error?.message || ''}`);
    const threads = (list.body.threads || []).slice(0, 20);

    const enriched = await Promise.all(threads.map(async t => {
      try {
        const td = await _getJson(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { Authorization: `Bearer ${token}` }
        );
        const msgs  = td.body.messages || [];
        const first = msgs[0] || {};
        const last  = msgs[msgs.length - 1] || {};
        const hdr = (m, name) => ((m.payload?.headers) || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        return {
          id:           t.id,
          snippet:      last.snippet || '',
          subject:      hdr(first, 'Subject') || '(no subject)',
          from:         hdr(last, 'From'),
          date:         hdr(last, 'Date'),
          messageCount: msgs.length,
          unread:       (last.labelIds || []).includes('UNREAD'),
        };
      } catch (_) {
        return { id: t.id, snippet: '', subject: '(no subject)', from: '', date: '', messageCount: 1, unread: false };
      }
    }));
    res.json({ ok: true, threads: enriched, total: list.body.resultSizeEstimate || enriched.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /gmail/threads/:id — get full thread with decoded bodies
router.get('/gmail/threads/:id', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    const token = await _getAccessToken(req.user.id);
    const td = await _getJson(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(req.params.id)}?format=full`,
      { Authorization: `Bearer ${token}` }
    );
    if (td.status !== 200) throw new Error(`gmail_thread_${td.status}`);

    const hdr = (m, name) => ((m.payload?.headers) || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    function extractBody(payload) {
      if (!payload) return '';
      if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf8');
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data)
            return Buffer.from(part.body.data, 'base64').toString('utf8');
        }
        for (const part of payload.parts) {
          const r = extractBody(part);
          if (r) return r;
        }
      }
      return '';
    }

    const messages = (td.body.messages || []).map(m => ({
      id:      m.id,
      snippet: m.snippet || '',
      subject: hdr(m, 'Subject'),
      from:    hdr(m, 'From'),
      to:      hdr(m, 'To'),
      date:    hdr(m, 'Date'),
      body:    extractBody(m.payload).slice(0, 3000),
      unread:  (m.labelIds || []).includes('UNREAD'),
    }));
    res.json({ ok: true, id: td.body.id, messages });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /gmail/reply — send a reply in a thread
router.post('/gmail/reply', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { threadId, to, subject, body } = req.body || {};
  if (!threadId || !to || !body) return res.status(400).json({ ok: false, error: 'threadId, to, body required' });
  try {
    const token = await _getAccessToken(req.user.id);
    const replySubject = subject ? (subject.startsWith('Re:') ? subject : `Re: ${subject}`) : 'Re:';
    const rawEmail = [
      `To: ${to}`,
      `Subject: ${replySubject}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body,
    ].join('\r\n');
    const encoded = Buffer.from(rawEmail).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await _postJson(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      { raw: encoded, threadId },
      { Authorization: `Bearer ${token}` }
    );
    if (r.status !== 200) throw new Error(`gmail_send_${r.status}: ${r.body.error?.message || ''}`);
    res.json({ ok: true, messageId: r.body.id });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE
// ═════════════════════════════════════════════════════════════════════════════

// POST /drive/upload — upload text content as a Drive file (drive.file scope)
router.post('/drive/upload', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { name, content, mimeType = 'text/plain', description = '' } = req.body || {};
  if (!name || !content) return res.status(400).json({ ok: false, error: 'name and content required' });
  try {
    const token = await _getAccessToken(req.user.id);
    const boundary = 'boundary_ig_' + Date.now();
    const metadata = JSON.stringify({ name, description, mimeType });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      Buffer.from(content, 'utf8'),
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const result = await new Promise(resolve => {
      const reqObj = _https.request({
        hostname: 'www.googleapis.com',
        path:     '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        method:   'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, r => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: r.statusCode, body: {} }); }
        });
      });
      reqObj.on('error', e => resolve({ status: 0, body: { error: e.message } }));
      reqObj.setTimeout(20000, () => reqObj.destroy());
      reqObj.write(body); reqObj.end();
    });

    if (result.status !== 200) throw new Error(`drive_upload_${result.status}: ${result.body.error?.message || ''}`);
    res.json({ ok: true, fileId: result.body.id, name: result.body.name, webViewLink: result.body.webViewLink });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// GET /drive/files — list recently uploaded files (drive.file scope = app files only)
router.get('/drive/files', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    const token = await _getAccessToken(req.user.id);
    const r = await _getJson(
      'https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=createdTime%20desc&fields=files(id,name,mimeType,createdTime,webViewLink)&q=trashed%3Dfalse',
      { Authorization: `Bearer ${token}` }
    );
    if (r.status !== 200) throw new Error(`drive_list_${r.status}`);
    res.json({ ok: true, files: r.body.files || [] });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR
// ═════════════════════════════════════════════════════════════════════════════

// GET /calendar/events — list events in a date range
router.get('/calendar/events', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    const token = await _getAccessToken(req.user.id);
    const now    = new Date();
    const timeMin = req.query.timeMin || new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const timeMax = req.query.timeMax || new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString();
    const r = await _getJson(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=100`,
      { Authorization: `Bearer ${token}` }
    );
    if (r.status !== 200) throw new Error(`calendar_list_${r.status}: ${r.body.error?.message || ''}`);
    res.json({
      ok: true,
      events: (r.body.items || []).map(e => ({
        id:          e.id,
        summary:     e.summary,
        description: e.description || '',
        start:       e.start?.dateTime || e.start?.date,
        end:         e.end?.dateTime   || e.end?.date,
        htmlLink:    e.htmlLink,
      })),
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /calendar/events — create a single event
router.post('/calendar/events', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { summary, description = '', startDateTime, endDateTime, startDate, endDate } = req.body || {};
  if (!summary) return res.status(400).json({ ok: false, error: 'summary required' });
  try {
    const token = await _getAccessToken(req.user.id);
    const event = { summary, description };
    if (startDateTime) {
      event.start = { dateTime: startDateTime, timeZone: 'UTC' };
      event.end   = { dateTime: endDateTime || startDateTime, timeZone: 'UTC' };
    } else {
      event.start = { date: startDate || new Date().toISOString().split('T')[0] };
      event.end   = { date: endDate || event.start.date };
    }
    const r = await _postJson(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      event,
      { Authorization: `Bearer ${token}` }
    );
    if (r.status !== 200) throw new Error(`calendar_create_${r.status}: ${r.body.error?.message || ''}`);
    res.json({ ok: true, eventId: r.body.id, htmlLink: r.body.htmlLink });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// DELETE /calendar/events/:id — delete an event
router.delete('/calendar/events/:id', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  try {
    const token = await _getAccessToken(req.user.id);
    const r = await _deleteReq(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(req.params.id)}`,
      { Authorization: `Bearer ${token}` }
    );
    if (r.status !== 204 && r.status !== 200) throw new Error(`calendar_delete_${r.status}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// POST /calendar/sync — bulk-push Brand Calendar items to Google Calendar
router.post('/calendar/sync', express.json(), async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ ok: false, error: 'not_signed_in' });
  const { items = [] } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ ok: false, error: 'items array required' });
  try {
    const token = await _getAccessToken(req.user.id);
    const results = [];
    for (const item of items.slice(0, 50)) {
      try {
        const dateStr = item.date ? String(item.date).split('T')[0] : new Date().toISOString().split('T')[0];
        const event = {
          summary: `[InfoGenie] ${item.title || 'Untitled'}`,
          description: [
            item.category ? `Category: ${item.category}` : '',
            item.channel  ? `Channel: ${item.channel}`   : '',
            item.notes    ? `Notes: ${item.notes}`        : '',
          ].filter(Boolean).join('\n'),
          start: { date: dateStr },
          end:   { date: dateStr },
        };
        const r = await _postJson(
          'https://www.googleapis.com/calendar/v3/calendars/primary/events',
          event,
          { Authorization: `Bearer ${token}` }
        );
        results.push({ id: item.id, ok: r.status === 200, gcalId: r.body.id, htmlLink: r.body.htmlLink });
      } catch (err) {
        results.push({ id: item.id, ok: false, error: err.message });
      }
    }
    const synced = results.filter(r => r.ok).length;
    res.json({ ok: true, synced, failed: results.length - synced, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

module.exports = router;

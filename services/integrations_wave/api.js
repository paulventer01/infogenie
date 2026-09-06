// Next-wave integrations: Grok (xAI), Fireflies, DeepL, Notion.
const express = require('express');
const https = require('https');
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const router = express.Router();
function _err(res, code, msg) { res.status(code).json({ ok: false, error: msg }); }
async function _tid(req, label) { return _tenantCtx.resolveTenantId(req, { label }); }
function _key(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && !/^_DUMMY/i.test(v)) return v;
  }
  return '';
}

async function _vaultKey(tid, platform) {
  if (!tid) return '';
  try {
    const vault = require('../credentials/vault');
    return (await vault.getApiKey(tid, platform)) || '';
  } catch { return ''; }
}

function _httpsJson(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname, path, method,
      headers: {
        ...headers,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; });
      r.on('end', () => {
        try {
          const json = d ? JSON.parse(d) : {};
          if (r.statusCode >= 400) return reject(new Error(`${hostname} ${r.statusCode}: ${d.slice(0, 220)}`));
          resolve(json);
        } catch (e) { reject(new Error(d.slice(0, 220) || e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(45000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

router.get('/status', async (req, res) => {
  const tid = await _tid(req, 'wave:status').catch(() => null);
  const [grokV, ffV, deeplV, notionV] = await Promise.all([
    _vaultKey(tid, 'xai'),
    _vaultKey(tid, 'fireflies'),
    _vaultKey(tid, 'deepl'),
    _vaultKey(tid, 'notion'),
  ]);
  res.json({
    ok: true,
    grok: !!( _key('XAI_API_KEY', 'GROK_API_KEY') || grokV ),
    fireflies: !!( _key('FIREFLIES_API_KEY') || ffV ),
    deepl: !!( _key('DEEPL_API_KEY', 'DEEPL_AUTH_KEY') || deeplV ),
    notion: !!( _key('NOTION_API_KEY', 'NOTION_TOKEN') || notionV ),
  });
});

// ── Grok / xAI visibility-style answer ───────────────────────────────────────
router.post('/grok/ask', async (req, res) => {
  try {
    const tid = await _tid(req, 'wave:grok');
    const prompt = String(req.body?.prompt || '').trim();
    const brand = String(req.body?.brand || '').trim();
    if (!prompt) return _err(res, 400, 'prompt required');
    const key = _key('XAI_API_KEY', 'GROK_API_KEY') || await _vaultKey(tid, 'xai');
    if (!key) {
      return res.json({
        ok: true,
        provider: 'offline',
        answer: `${brand || 'Your brand'} should publish quotable, structured answers for: “${prompt}”. Grok/xAI is not configured — add XAI_API_KEY to probe live answers.`,
        cited: [],
      });
    }
    const json = await _httpsJson('api.x.ai', '/v1/chat/completions', 'POST', {
      Authorization: `Bearer ${key}`,
    }, {
      model: 'grok-2-latest',
      messages: [
        { role: 'system', content: 'You are a concise marketing visibility analyst. Mention which brands you would cite.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
    });
    const answer = json.choices?.[0]?.message?.content || '';
    res.json({ ok: true, provider: 'grok', answer, raw: { id: json.id } });
  } catch (e) { _err(res, 502, e.message); }
});

// ── Fireflies transcript ingest → meeting notes store ────────────────────────
router.post('/fireflies/ingest', async (req, res) => {
  try {
    const tid = await _tid(req, 'wave:fireflies');
    const transcriptId = String(req.body?.transcript_id || '').trim();
    const key = _key('FIREFLIES_API_KEY') || await _vaultKey(tid, 'fireflies');
    let title = String(req.body?.title || 'Fireflies meeting').slice(0, 200);
    let transcript = String(req.body?.transcript || '').trim();
    let source = 'paste';

    if (!transcript && key && transcriptId) {
      // GraphQL best-effort fetch
      try {
        const gql = {
          query: `query($id:String!){ transcript(id:$id){ title sentences{ raw_text } } }`,
          variables: { id: transcriptId },
        };
        const json = await _httpsJson('api.fireflies.ai', '/graphql', 'POST', {
          Authorization: `Bearer ${key}`,
        }, gql);
        const t = json.data?.transcript;
        if (t) {
          title = t.title || title;
          transcript = (t.sentences || []).map((s) => s.raw_text).join(' ').trim();
          source = 'fireflies';
        }
      } catch (e) {
        return _err(res, 502, 'Fireflies fetch failed: ' + e.message);
      }
    }

    if (!transcript) return _err(res, 400, 'transcript or Fireflies transcript_id required');

    let id = null;
    if (_db.hasDb()) {
      const r = await _db.getPool().query(
        `INSERT INTO meeting_notes (tenant_id, title, transcript, source, created_at)
         VALUES ($1,$2,$3,$4,now()) RETURNING id`,
        [tid, title, transcript.slice(0, 100000), source]
      ).catch(() => null);
      // Fallback table shape if meeting_notes differs
      if (!r) {
        await _db.getPool().query(
          `CREATE TABLE IF NOT EXISTS fireflies_ingest (
             id BIGSERIAL PRIMARY KEY,
             tenant_id INT,
             title TEXT,
             transcript TEXT,
             source TEXT,
             created_at TIMESTAMPTZ DEFAULT now()
           )`
        ).catch(() => {});
        const r2 = await _db.getPool().query(
          `INSERT INTO fireflies_ingest (tenant_id, title, transcript, source) VALUES ($1,$2,$3,$4) RETURNING id`,
          [tid, title, transcript.slice(0, 100000), source]
        );
        id = r2.rows[0]?.id;
      } else {
        id = r.rows[0]?.id;
      }
    }

    res.json({
      ok: true,
      id,
      title,
      chars: transcript.length,
      source,
      next: 'Open Meeting Notes to run BANT summary on the ingested transcript.',
    });
  } catch (e) { _err(res, 500, e.message); }
});

// ── DeepL translate ──────────────────────────────────────────────────────────
router.post('/deepl/translate', async (req, res) => {
  try {
    const tid = await _tid(req, 'wave:deepl');
    const text = String(req.body?.text || '').trim();
    const target = String(req.body?.target_lang || 'ES').toUpperCase();
    const source = req.body?.source_lang ? String(req.body.source_lang).toUpperCase() : undefined;
    if (!text) return _err(res, 400, 'text required');
    const key = _key('DEEPL_API_KEY', 'DEEPL_AUTH_KEY') || await _vaultKey(tid, 'deepl');
    if (!key) {
      return res.json({
        ok: true,
        provider: 'offline',
        translations: [{ text: `[${target}] ${text}`, detected_source_language: source || 'EN' }],
        note: 'Add DEEPL_API_KEY for production-quality localization.',
      });
    }
    const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const params = new URLSearchParams();
    params.append('text', text.slice(0, 4500));
    params.append('target_lang', target);
    if (source) params.append('source_lang', source);
    const json = await new Promise((resolve, reject) => {
      const payload = params.toString();
      const req2 = https.request({
        hostname: host,
        path: '/v2/translate',
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => {
          try {
            if (r.statusCode >= 400) return reject(new Error(d.slice(0, 200)));
            resolve(JSON.parse(d));
          } catch (e) { reject(e); }
        });
      });
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });
    res.json({ ok: true, provider: 'deepl', translations: json.translations || [] });
  } catch (e) { _err(res, 502, e.message); }
});

// ── Notion page export ───────────────────────────────────────────────────────
router.post('/notion/export', async (req, res) => {
  try {
    const tid = await _tid(req, 'wave:notion');
    const title = String(req.body?.title || 'InfoGenie brief').slice(0, 200);
    const body = String(req.body?.body || req.body?.markdown || '').trim();
    const parentPageId = String(req.body?.parent_page_id || process.env.NOTION_PARENT_PAGE_ID || '').replace(/-/g, '');
    if (!body) return _err(res, 400, 'body required');
    const key = _key('NOTION_API_KEY', 'NOTION_TOKEN') || await _vaultKey(tid, 'notion');
    if (!key) {
      return res.json({
        ok: true,
        provider: 'offline',
        preview: { title, body: body.slice(0, 2000) },
        note: 'Add NOTION_API_KEY (+ optional NOTION_PARENT_PAGE_ID) to create pages in your workspace.',
      });
    }
    if (!parentPageId) return _err(res, 400, 'parent_page_id or NOTION_PARENT_PAGE_ID required');
    const children = body.split(/\n+/).filter(Boolean).slice(0, 40).map((line) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 1900) } }] },
    }));
    const json = await _httpsJson('api.notion.com', '/v1/pages', 'POST', {
      Authorization: `Bearer ${key}`,
      'Notion-Version': '2022-06-28',
    }, {
      parent: { page_id: parentPageId },
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children,
    });
    res.json({ ok: true, provider: 'notion', page_id: json.id, url: json.url });
  } catch (e) { _err(res, 502, e.message); }
});

module.exports = router;

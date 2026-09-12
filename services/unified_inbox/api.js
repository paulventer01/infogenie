// Tier 26 — Unified Conversation Inbox.
// Pulls items from every conversation surface InfoGenie already monitors
// (Reddit Pulse, Twitter/X Pulse, Reviews, Quora, Glassdoor, Newsletter mentions,
// Chatbot conversations) into one inbox-style stream with status tracking.
// Items dedupe via UNIQUE(tenant_id, source, source_id) so /ingest is idempotent.
const express = require('express');
const router = express.Router();
const _db = require('../../db');
const _tenantCtx = require('../tenants/context');

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });
async function _tid(req, label) {
  return await _tenantCtx.resolveTenantId(req, { label });
}

const SOURCES = ['reddit', 'twitter', 'review', 'quora', 'glassdoor', 'newsletter', 'chatbot', 'email'];
const STATUSES = ['new', 'replied', 'resolved', 'snoozed'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];

function _truncate(s, n) {
  if (!s) return null;
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

function _sentiment(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (raw > 0.15) return 'positive';
    if (raw < -0.15) return 'negative';
    return 'neutral';
  }
  const s = String(raw).toLowerCase();
  if (s.startsWith('pos')) return 'positive';
  if (s.startsWith('neg')) return 'negative';
  if (s.startsWith('neu')) return 'neutral';
  return null;
}

function _toDate(v) {
  if (!v) return null;
  try {
    const d = (typeof v === 'number' && v < 2e10) ? new Date(v * 1000) : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

// Bulk insert helper — leans on the UNIQUE(tenant_id, source, source_id) index.
async function _upsertMany(rows, tenantId) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let inserted = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !r.source_id) continue;
    const ins = await _db.getPool().query(
      `INSERT INTO unified_inbox_items
        (tenant_id, source, source_id, source_url, author, title, content, sentiment, score, raw, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (tenant_id, source, source_id) DO NOTHING
       RETURNING id`,
      [
        tenantId,
        r.source,
        String(r.source_id).slice(0, 200),
        _truncate(r.source_url, 1000),
        _truncate(r.author, 200),
        _truncate(r.title, 500),
        _truncate(r.content, 4000),
        r.sentiment || null,
        (r.score == null || isNaN(Number(r.score))) ? null : Number(r.score),
        r.raw ? JSON.stringify(r.raw) : null,
        _toDate(r.occurred_at),
      ]
    );
    if (ins.rowCount) inserted++;
  }
  return inserted;
}

function _safeMap(arr, fn) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    try { const r = fn(item); if (r) out.push(r); } catch (_) { /* swallow per-item */ }
  }
  return out;
}

router.get('/test', _safeAsync(async (req, res) => {
  res.json({
    ok: true,
    tier: 26,
    name: 'Unified Conversation Inbox',
    sources: SOURCES,
    statuses: STATUSES,
    db: !!(_db.hasDb && _db.hasDb()),
  });
}));

// Scan recent rows from each known source table, normalise into the inbox.
// All upstream SELECTs are filtered by tenant_id; all INSERTs stamp tenant_id.
// Idempotent — the UNIQUE(tenant_id, source, source_id) index absorbs re-runs.
router.post('/ingest', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const tid = await _tid(req, 'inbox:ingest');
  const counts = {};

  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, posts, created_at FROM reddit_pulse_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20`,
      [tid]
    );
    let rows = [];
    for (const run of r.rows) {
      rows = rows.concat(_safeMap(run.posts, (p) => ({
        source: 'reddit',
        source_id: p.id || p.permalink || p.url || ('r' + run.id + '-' + Math.random().toString(36).slice(2, 8)),
        source_url: p.url || p.permalink || null,
        author: p.author || null,
        title: p.title || null,
        content: p.body || p.selftext || p.content || p.title || null,
        sentiment: _sentiment(p.sentiment),
        score: p.score == null ? null : p.score,
        raw: { brand: run.brand, run_id: run.id, ...p },
        occurred_at: p.created_at || p.created_utc || run.created_at,
      })));
    }
    counts.reddit = await _upsertMany(rows, tid);
  } catch (e) { counts.reddit_error = e.message; }

  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, tweets, created_at FROM twitter_pulse_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20`,
      [tid]
    );
    let rows = [];
    for (const run of r.rows) {
      rows = rows.concat(_safeMap(run.tweets, (t) => ({
        source: 'twitter',
        source_id: t.id || t.tweet_id || t.url || ('t' + run.id + '-' + Math.random().toString(36).slice(2, 8)),
        source_url: t.url || (t.username && t.id ? `https://twitter.com/${t.username}/status/${t.id}` : null),
        author: t.author || t.username || t.handle || null,
        title: null,
        content: t.text || t.content || null,
        sentiment: _sentiment(t.sentiment),
        score: t.score == null ? null : t.score,
        raw: { brand: run.brand, run_id: run.id, ...t },
        occurred_at: t.created_at || run.created_at,
      })));
    }
    counts.twitter = await _upsertMany(rows, tid);
  } catch (e) { counts.twitter_error = e.message; }

  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, platform, reviews, created_at FROM review_aggregator_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20`,
      [tid]
    );
    let rows = [];
    for (const run of r.rows) {
      rows = rows.concat(_safeMap(run.reviews, (rv) => ({
        source: 'review',
        source_id: rv.id || rv.url || ('rv' + run.id + '-' + Math.random().toString(36).slice(2, 8)),
        source_url: rv.url || null,
        author: rv.author || rv.user || null,
        title: rv.title || (run.platform ? run.platform + ' review' : 'Review'),
        content: rv.body || rv.text || rv.content || null,
        sentiment: _sentiment(rv.sentiment != null ? rv.sentiment : (rv.rating != null ? (rv.rating - 3) / 2 : null)),
        score: rv.rating == null ? null : rv.rating,
        raw: { brand: run.brand, platform: run.platform, run_id: run.id, ...rv },
        occurred_at: rv.date || rv.created_at || run.created_at,
      })));
    }
    counts.review = await _upsertMany(rows, tid);
  } catch (e) { counts.review_error = e.message; }

  try {
    const r = await _db.getPool().query(
      `SELECT id, topic, questions, created_at FROM quora_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20`,
      [tid]
    );
    let rows = [];
    for (const run of r.rows) {
      rows = rows.concat(_safeMap(run.questions, (q) => ({
        source: 'quora',
        source_id: q.id || q.url || ('q' + run.id + '-' + Math.random().toString(36).slice(2, 8)),
        source_url: q.url || null,
        author: q.author || null,
        title: q.question || q.title || null,
        content: q.snippet || q.preview || q.question || null,
        sentiment: _sentiment(q.sentiment),
        score: q.followers == null ? null : q.followers,
        raw: { topic: run.topic, run_id: run.id, ...q },
        occurred_at: q.date || run.created_at,
      })));
    }
    counts.quora = await _upsertMany(rows, tid);
  } catch (e) { counts.quora_error = e.message; }

  try {
    const r = await _db.getPool().query(
      `SELECT id, company, reviews, created_at FROM glassdoor_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 20`,
      [tid]
    );
    let rows = [];
    for (const run of r.rows) {
      rows = rows.concat(_safeMap(run.reviews, (rv) => ({
        source: 'glassdoor',
        source_id: rv.id || rv.url || ('gd' + run.id + '-' + Math.random().toString(36).slice(2, 8)),
        source_url: rv.url || null,
        author: rv.role || rv.author || 'Anonymous employee',
        title: rv.title || 'Glassdoor review',
        content: [rv.pros, rv.cons, rv.advice].filter(Boolean).join(' \u2014 ') || null,
        sentiment: _sentiment(rv.sentiment != null ? rv.sentiment : (rv.rating != null ? (rv.rating - 3) / 2 : null)),
        score: rv.rating == null ? null : rv.rating,
        raw: { company: run.company, run_id: run.id, ...rv },
        occurred_at: rv.date || run.created_at,
      })));
    }
    counts.glassdoor = await _upsertMany(rows, tid);
  } catch (e) { counts.glassdoor_error = e.message; }

  try {
    const r = await _db.getPool().query(
      `SELECT i.id, i.subject, i.preview, i.url, i.captured_at, t.brand
       FROM newsletter_issues i
       LEFT JOIN newsletter_targets t ON t.id = i.target_id
       WHERE i.tenant_id=$1
       ORDER BY i.id DESC LIMIT 200`,
      [tid]
    );
    const rows = r.rows.map((n) => ({
      source: 'newsletter',
      source_id: 'n' + n.id,
      source_url: n.url || null,
      author: n.brand || null,
      title: n.subject || null,
      content: n.preview || null,
      sentiment: null,
      score: null,
      raw: n,
      occurred_at: n.captured_at,
    }));
    counts.newsletter = await _upsertMany(rows, tid);
  } catch (e) { counts.newsletter_error = e.message; }

  // Chatbot — table is optional and currently has no tenant_id column.
  // Fall back to a column-existence check and (if present) filter by tenant_id;
  // otherwise skip rather than risk cross-tenant leak.
  try {
    const exists = await _db.getPool().query(
      `SELECT 1 FROM information_schema.tables WHERE table_name='chatbot_conversations' LIMIT 1`
    );
    if (exists.rowCount) {
      const cols = await _db.getPool().query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='chatbot_conversations'`
      );
      const colset = new Set(cols.rows.map((r) => r.column_name));
      if (colset.has('id') && colset.has('tenant_id')) {
        const r = await _db.getPool().query(
          `SELECT * FROM chatbot_conversations WHERE tenant_id=$1 ORDER BY id DESC LIMIT 200`,
          [tid]
        );
        const rows = r.rows.map((c) => ({
          source: 'chatbot',
          source_id: 'c' + c.id,
          source_url: null,
          author: c.lead_email || c.email || c.name || 'Anonymous visitor',
          title: 'Chatbot conversation',
          content: c.last_message || c.first_message || c.summary || null,
          sentiment: null,
          score: null,
          raw: c,
          occurred_at: c.updated_at || c.created_at,
        }));
        counts.chatbot = await _upsertMany(rows, tid);
      } else {
        counts.chatbot_skipped = 'no tenant_id column on chatbot_conversations';
      }
    }
  } catch (e) { counts.chatbot_error = e.message; }

  res.json({ ok: true, counts });
}));

// Filter, paginate, search — always tenant-scoped.
router.get('/list', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, items: [] });
  const tid = await _tid(req, 'inbox:list');
  const where = ['tenant_id = $1'];
  const args = [tid];
  const source = String(req.query.source || '').trim();
  if (source && SOURCES.includes(source)) {
    args.push(source);
    where.push('source = $' + args.length);
  }
  const status = String(req.query.status || '').trim();
  if (status && STATUSES.includes(status)) {
    args.push(status);
    where.push('status = $' + args.length);
  }
  const sentiment = String(req.query.sentiment || '').trim();
  if (sentiment && SENTIMENTS.includes(sentiment)) {
    args.push(sentiment);
    where.push('sentiment = $' + args.length);
  }
  const q = String(req.query.q || '').trim();
  if (q) {
    args.push('%' + q.toLowerCase() + '%');
    where.push('(LOWER(COALESCE(title,\'\')) LIKE $' + args.length + ' OR LOWER(COALESCE(content,\'\')) LIKE $' + args.length + ' OR LOWER(COALESCE(author,\'\')) LIKE $' + args.length + ')');
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  args.push(limit);
  args.push(offset);
  const sql = `SELECT id, source, source_id, source_url, author, title, content, sentiment, score, status, assignee, tags, notes, occurred_at, ingested_at, updated_at, handled_at
               FROM unified_inbox_items
               WHERE ${where.join(' AND ')}
               ORDER BY COALESCE(occurred_at, ingested_at) DESC, id DESC
               LIMIT $${args.length - 1} OFFSET $${args.length}`;
  const r = await _db.getPool().query(sql, args);
  res.json({ ok: true, items: r.rows, total: r.rowCount });
}));

router.get('/stats', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, stats: {} });
  const tid = await _tid(req, 'inbox:stats');
  const pool = _db.getPool();
  const byStatus = await pool.query(
    `SELECT status, COUNT(*)::int AS n FROM unified_inbox_items WHERE tenant_id=$1 GROUP BY status`, [tid]
  );
  const bySource = await pool.query(
    `SELECT source, COUNT(*)::int AS n FROM unified_inbox_items WHERE tenant_id=$1 GROUP BY source`, [tid]
  );
  const bySent = await pool.query(
    `SELECT COALESCE(sentiment,'unknown') AS sentiment, COUNT(*)::int AS n FROM unified_inbox_items WHERE tenant_id=$1 GROUP BY 1`, [tid]
  );
  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM unified_inbox_items WHERE tenant_id=$1`, [tid]);
  const status = { new: 0, replied: 0, resolved: 0, snoozed: 0 };
  byStatus.rows.forEach((r) => { status[r.status] = r.n; });
  const source = {};
  bySource.rows.forEach((r) => { source[r.source] = r.n; });
  const sentiment = {};
  bySent.rows.forEach((r) => { sentiment[r.sentiment] = r.n; });
  res.json({ ok: true, stats: { total: total.rows[0].n, status, source, sentiment } });
}));

router.patch('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'Bad id');
  const tid = await _tid(req, 'inbox:patch');
  const sets = [];
  const args = [];
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return _err(res, 400, 'Bad status');
    args.push(b.status); sets.push('status = $' + args.length);
    if (b.status === 'replied' || b.status === 'resolved') {
      sets.push('handled_at = COALESCE(handled_at, now())');
    } else if (b.status === 'new') {
      sets.push('handled_at = NULL');
    }
  }
  if (b.assignee !== undefined) {
    args.push(b.assignee ? String(b.assignee).slice(0, 200) : null);
    sets.push('assignee = $' + args.length);
  }
  if (b.notes !== undefined) {
    args.push(b.notes ? String(b.notes).slice(0, 4000) : null);
    sets.push('notes = $' + args.length);
  }
  if (b.tags !== undefined) {
    args.push(JSON.stringify(Array.isArray(b.tags) ? b.tags : []));
    sets.push('tags = $' + args.length + '::jsonb');
  }
  if (!sets.length) return _err(res, 400, 'Nothing to update');
  sets.push('updated_at = now()');
  args.push(id);
  args.push(tid);
  const upd = await _db.getPool().query(
    `UPDATE unified_inbox_items SET ${sets.join(', ')} WHERE id = $${args.length - 1} AND tenant_id = $${args.length}`,
    args
  );
  if (!upd.rowCount) return _err(res, 404, 'Item not found');
  res.json({ ok: true });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'Bad id');
  const tid = await _tid(req, 'inbox:delete');
  const del = await _db.getPool().query(
    `DELETE FROM unified_inbox_items WHERE id = $1 AND tenant_id = $2`, [id, tid]
  );
  if (!del.rowCount) return _err(res, 404, 'Item not found');
  res.json({ ok: true });
}));

// ── POST /api/unified-inbox/ai-draft ─────────────────────────────────────────
// Context-only draft (no DB lookup) — used by the Gmail reply modal where
// there is no unified_inbox_items row. Accepts { author, subject, content,
// threadMessages } and returns a draft reply string.
router.post('/ai-draft', _safeAsync(async (req, res) => {
  const { author = '', subject = '', content = '', threadMessages = [] } = req.body || {};
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return _err(res, 400, 'OpenAI not configured');
  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });
  let ctx = `From: ${author}\nSubject: ${subject}\nMessage: ${String(content).slice(0, 800)}`;
  if (Array.isArray(threadMessages) && threadMessages.length) {
    ctx += '\n\nRecent thread:\n' + threadMessages.slice(-4)
      .map(m => `${m.from}: ${(m.body || m.snippet || '').slice(0, 400)}`).join('\n---\n');
  }
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Draft a professional, concise reply (under 120 words). Do not include subject line or opening salutation — start with the reply body directly.' },
        { role: 'user', content: `Draft a reply:\n\n${ctx}` },
      ],
      max_tokens: 250,
    });
    res.json({ ok: true, draft: r.choices[0].message.content?.trim() || '' });
  } catch (e) {
    console.warn('[inbox:ai-draft-ctx]', e.message);
    res.json({ ok: false, error: 'AI draft failed: ' + e.message });
  }
}));

// ── POST /api/unified-inbox/:id/ai-draft ─────────────────────────────────────
// Generates an AI reply draft for a given inbox item using GPT-4o-mini.
// For Gmail threads the caller passes { threadMessages } for richer context.
router.post('/:id/ai-draft', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'Bad id');
  const tid = await _tid(req, 'inbox:ai-draft');

  const { threadMessages } = req.body || {};

  const row = await _db.getPool().query(
    `SELECT source, author, title, content, notes, sentiment FROM unified_inbox_items WHERE id=$1 AND tenant_id=$2`,
    [id, tid]
  );
  if (!row.rows.length) return _err(res, 404, 'Item not found');
  const item = row.rows[0];

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return _err(res, 400, 'OpenAI not configured');
  }

  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY });

  let contextBlock = `Source: ${item.source || 'unknown'}
From: ${item.author || 'unknown'}
Subject / Title: ${item.title || '(none)'}
Message: ${(item.content || '').slice(0, 800)}`;

  if (item.notes) contextBlock += `\nInternal notes: ${item.notes}`;
  if (item.sentiment) contextBlock += `\nDetected sentiment: ${item.sentiment}`;

  if (Array.isArray(threadMessages) && threadMessages.length) {
    const history = threadMessages.slice(-4).map(m =>
      `${m.from}: ${(m.body || m.snippet || '').slice(0, 400)}`
    ).join('\n---\n');
    contextBlock += `\n\nRecent thread history:\n${history}`;
  }

  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: 'You are a helpful marketing assistant drafting professional, concise replies to customer messages. Match the tone to the sentiment (warm for negative, friendly for neutral). Keep replies under 120 words. Do not include subject lines or greetings like "Dear X" — start directly with the response body.',
      }, {
        role: 'user',
        content: `Draft a reply for this message:\n\n${contextBlock}`,
      }],
      max_tokens: 250,
    });
    const draft = r.choices[0].message.content?.trim() || '';
    res.json({ ok: true, draft });
  } catch (e) {
    console.warn('[inbox:ai-draft]', e.message);
    res.json({ ok: false, error: 'AI draft generation failed: ' + e.message });
  }
}));

module.exports = router;
module.exports._upsertMany = _upsertMany;
module.exports.SOURCES = SOURCES;

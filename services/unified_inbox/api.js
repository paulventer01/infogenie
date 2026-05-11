// Tier 26 — Unified Conversation Inbox.
// Pulls items from every conversation surface InfoGenie already monitors
// (Reddit Pulse, Twitter/X Pulse, Reviews, Quora, Glassdoor, Newsletter mentions,
// Chatbot conversations) into one inbox-style stream with status tracking.
// Items dedupe via UNIQUE(source, source_id) so /ingest is idempotent.
const express = require('express');
const router = express.Router();
const _db = require('../../db');

const _safeAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const _err = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

const SOURCES = ['reddit', 'twitter', 'review', 'quora', 'glassdoor', 'newsletter', 'chatbot'];
const STATUSES = ['new', 'replied', 'resolved', 'snoozed'];
const SENTIMENTS = ['positive', 'neutral', 'negative'];

function _truncate(s, n) {
  if (!s) return null;
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

// Normalise sentiment from various source shapes (-1/0/1, "pos"/"neg", numeric scores, etc.).
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

// Coerce a raw timestamp to a Date or null — never throw on garbage source data.
function _toDate(v) {
  if (!v) return null;
  try {
    const d = (typeof v === 'number' && v < 2e10) ? new Date(v * 1000) : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

// Bulk insert helper — leans on the UNIQUE(source, source_id) index for dedup.
async function _upsertMany(rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  let inserted = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object' || !r.source_id) continue;
    const ins = await _db.getPool().query(
      `INSERT INTO unified_inbox_items
        (source, source_id, source_url, author, title, content, sentiment, score, raw, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source, source_id) DO NOTHING
       RETURNING id`,
      [
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

// Per-item guard so one bad payload doesn't abort the whole source batch.
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
// Idempotent — the UNIQUE index absorbs re-runs.
router.post('/ingest', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const counts = {};

  // Reddit — posts JSONB array on each run
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, posts, created_at FROM reddit_pulse_runs ORDER BY id DESC LIMIT 20`
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
    counts.reddit = await _upsertMany(rows);
  } catch (e) { counts.reddit_error = e.message; }

  // Twitter/X — tweets JSONB array
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, tweets, created_at FROM twitter_pulse_runs ORDER BY id DESC LIMIT 20`
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
    counts.twitter = await _upsertMany(rows);
  } catch (e) { counts.twitter_error = e.message; }

  // Reviews — review_aggregator_runs has reviews JSONB
  try {
    const r = await _db.getPool().query(
      `SELECT id, brand, platform, reviews, created_at FROM review_aggregator_runs ORDER BY id DESC LIMIT 20`
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
    counts.review = await _upsertMany(rows);
  } catch (e) { counts.review_error = e.message; }

  // Quora — questions JSONB
  try {
    const r = await _db.getPool().query(
      `SELECT id, topic, questions, created_at FROM quora_runs ORDER BY id DESC LIMIT 20`
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
    counts.quora = await _upsertMany(rows);
  } catch (e) { counts.quora_error = e.message; }

  // Glassdoor — reviews JSONB
  try {
    const r = await _db.getPool().query(
      `SELECT id, company, reviews, created_at FROM glassdoor_runs ORDER BY id DESC LIMIT 20`
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
    counts.glassdoor = await _upsertMany(rows);
  } catch (e) { counts.glassdoor_error = e.message; }

  // Newsletter mentions — newsletter_issues table
  try {
    const r = await _db.getPool().query(
      `SELECT i.id, i.subject, i.preview, i.url, i.captured_at, t.brand
       FROM newsletter_issues i
       LEFT JOIN newsletter_targets t ON t.id = i.target_id
       ORDER BY i.id DESC LIMIT 200`
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
    counts.newsletter = await _upsertMany(rows);
  } catch (e) { counts.newsletter_error = e.message; }

  // Chatbot — only if a conversation table actually exists; ignore otherwise.
  try {
    const exists = await _db.getPool().query(
      `SELECT 1 FROM information_schema.tables WHERE table_name='chatbot_conversations' LIMIT 1`
    );
    if (exists.rowCount) {
      const cols = await _db.getPool().query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='chatbot_conversations'`
      );
      const colset = new Set(cols.rows.map((r) => r.column_name));
      if (colset.has('id')) {
        const r = await _db.getPool().query(
          `SELECT * FROM chatbot_conversations ORDER BY id DESC LIMIT 200`
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
        counts.chatbot = await _upsertMany(rows);
      }
    }
  } catch (e) { counts.chatbot_error = e.message; }

  res.json({ ok: true, counts });
}));

// Filter, paginate, search.
router.get('/list', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, items: [] });
  const where = [];
  const args = [];
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
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY COALESCE(occurred_at, ingested_at) DESC, id DESC
               LIMIT $${args.length - 1} OFFSET $${args.length}`;
  const r = await _db.getPool().query(sql, args);
  res.json({ ok: true, items: r.rows, total: r.rowCount });
}));

router.get('/stats', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return res.json({ ok: true, stats: {} });
  const byStatus = await _db.getPool().query(
    `SELECT status, COUNT(*)::int AS n FROM unified_inbox_items GROUP BY status`
  );
  const bySource = await _db.getPool().query(
    `SELECT source, COUNT(*)::int AS n FROM unified_inbox_items GROUP BY source`
  );
  const bySent = await _db.getPool().query(
    `SELECT COALESCE(sentiment,'unknown') AS sentiment, COUNT(*)::int AS n FROM unified_inbox_items GROUP BY 1`
  );
  const total = await _db.getPool().query(`SELECT COUNT(*)::int AS n FROM unified_inbox_items`);
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
  const upd = await _db.getPool().query(
    `UPDATE unified_inbox_items SET ${sets.join(', ')} WHERE id = $${args.length}`,
    args
  );
  if (!upd.rowCount) return _err(res, 404, 'Item not found');
  res.json({ ok: true });
}));

router.delete('/:id', _safeAsync(async (req, res) => {
  if (!_db.hasDb || !_db.hasDb()) return _err(res, 503, 'Database required.');
  const id = parseInt(req.params.id, 10);
  if (!id) return _err(res, 400, 'Bad id');
  const del = await _db.getPool().query(`DELETE FROM unified_inbox_items WHERE id = $1`, [id]);
  if (!del.rowCount) return _err(res, 404, 'Item not found');
  res.json({ ok: true });
}));

module.exports = router;
